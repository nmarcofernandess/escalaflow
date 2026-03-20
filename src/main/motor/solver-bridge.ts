/**
 * solver-bridge.ts — Bridge entre Node.js (main process) e Python OR-Tools solver
 *
 * Arquitetura: spawn(binário) + stdin(JSON) → stdout(JSON)
 * Python = função pura. TS = orquestrador (DB, persistência, IPC).
 */

import { spawn, execFileSync, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { queryOne, queryAll, execute, insertReturningId, transaction } from '../db/query'
import { buildEscalaEquipeSnapshot } from '../escala-equipe-snapshot'
import type {
  Colaborador,
  Funcao,
  GenerationMode,
  SolverInput,
  SolverOutput,
  SolverInputColab,
  SolverInputDemanda,
  SolverInputHint,
  SolverInputRegraColaboradorDia,
  SolverInputDemandaExcecaoData,
  PinnedCell,
  DiaSemana,
} from '../../shared'
import {
  hasGuaranteedSundayWindow,
  listEscalaParticipantes,
  normalizeSetorSimulacaoConfig,
  resolveSundayRotatingDemand,
} from '../../shared'
import { buildEffectiveRulePolicy } from './rule-policy'

const require = createRequire(import.meta.url)

type RegimeEscalaInput = '5X2' | '6X1'

export type SolveMode = 'rapido' | 'balanceado' | 'otimizado' | 'maximo'

export interface BuildSolverInputOptions {
  regimesOverride?: Array<{ colaborador_id: number; regime_escala: RegimeEscalaInput }>
  hintsEscalaId?: number
  solveMode?: SolveMode
  nivelRigor?: 'ALTO' | 'MEDIO' | 'BAIXO'
  generationMode?: GenerationMode
  maxTimeSeconds?: number
  /** Override in-memory de regras — sobrescreve empresa+sistema apenas para esta geração */
  rulesOverride?: Record<string, string>
  /** Padrão de folgas externo (da simulação Nível 1). Se fornecido, solver pula Phase 1. */
  pinnedFolgaExterno?: Array<{ c: number; d: number; band: number }>
}

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

export function resolveSolverPath(): string {
  const explicitPath = process.env.ESCALAFLOW_SOLVER_PATH?.trim()
  if (explicitPath) {
    if (existsSync(explicitPath)) return explicitPath
    throw new Error(`ESCALAFLOW_SOLVER_PATH aponta para arquivo inexistente: ${explicitPath}`)
  }

  const isWin = process.platform === 'win32'
  const binNames = isWin
    ? ['escalaflow-solver.exe', 'escalaflow-solver']
    : ['escalaflow-solver']

  // Dev source solver (always the freshest code path)
  const devPython = path.join(process.cwd(), 'solver', 'solver_ortools.py')
  const preferBinaryInDev = process.env.ESCALAFLOW_SOLVER_MODE === 'binary'

  // Detect packaged Electron context.
  let isPackaged = false
  try {
    const electron = require('electron') as { app?: { isPackaged?: boolean } }
    isPackaged = Boolean(electron.app?.isPackaged)
  } catch {
    // not in Electron context
  }

  // Default: prefer Python source unless explicitly forced to binary.
  if (!preferBinaryInDev && existsSync(devPython)) {
    return devPython
  }

  // Built binary (PyInstaller) in project (dev fallback / explicit binary mode).
  for (const name of binNames) {
    const devBin = path.join(process.cwd(), 'solver-bin', name)
    if (existsSync(devBin)) {
      return devBin
    }
  }

  // Production: packaged with Electron resources.
  if (isPackaged) {
    for (const name of binNames) {
      const prodBin = path.join(process.resourcesPath, 'solver-bin', name)
      if (existsSync(prodBin)) {
        return prodBin
      }
    }
  }

  // Last fallback: Python source (if binary was unavailable).
  if (existsSync(devPython)) {
    return devPython
  }

  throw new Error(
    'Solver nao encontrado. Em dev, certifique-se de que solver/solver_ortools.py existe. ' +
    'Em producao, rode solver:build antes de empacotar.'
  )
}

/**
 * Detect whether the solver path is a Python script or a compiled binary.
 */
function isPythonScript(solverPath: string): boolean {
  return solverPath.endsWith('.py')
}

/**
 * Resolve the best Python 3 command to use for the solver.
 * Avoids virtualenvs without ortools by probing candidates in order.
 * Result is cached after first successful probe.
 */
let _cachedPythonCmd: string | null = null

function resolvePythonCmd(): string {
  if (_cachedPythonCmd) return _cachedPythonCmd

  // 1. Explicit env var always wins
  const explicit = process.env.ESCALAFLOW_PYTHON?.trim()
  if (explicit) {
    _cachedPythonCmd = explicit
    return explicit
  }

  // 2. Probe candidates — prefer well-known system paths over bare `python3`
  //    (bare `python3` might resolve to a virtualenv without ortools)
  const candidates = [
    '/opt/homebrew/bin/python3',
    '/usr/local/bin/python3',
    '/usr/bin/python3',
    'python3',
  ]

  for (const candidate of candidates) {
    // Skip non-existent absolute paths
    if (candidate.startsWith('/') && !existsSync(candidate)) continue

    try {
      execFileSync(candidate, ['-c', 'import ortools'], {
        timeout: 5000,
        stdio: 'ignore',
      })
      _cachedPythonCmd = candidate
      console.log(`[solver-bridge] Python resolvido: ${candidate}`)
      return candidate
    } catch {
      // candidate doesn't have ortools — try next
    }
  }

  // 3. Fallback — will likely fail but gives a clear error message downstream
  console.warn('[solver-bridge] Nenhum Python com ortools encontrado. Usando python3 do PATH.')
  _cachedPythonCmd = 'python3'
  return 'python3'
}

// ---------------------------------------------------------------------------
// Calculo automatico do ciclo domingo
// ---------------------------------------------------------------------------

type SundayRuleEntry = {
  perfil_horario_id?: number | null
  inicio?: string | null
  fim?: string | null
  p_inicio?: string | null
  p_fim?: string | null
}

function contarIntermitentesGarantidosNoDomingo<TPadrao extends { folga_fixa_dia_semana: string | null; folga_variavel_dia_semana?: string | null } | null, TDia>(
  colabRows: { id: number; tipo_trabalhador: string | null }[],
  regraGroupByColab: Map<number, { padrao: TPadrao; dias: Map<string, TDia> }>,
): number {
  return colabRows.reduce((count, colab) => {
    if ((colab.tipo_trabalhador ?? 'CLT') !== 'INTERMITENTE') return count
    // Tipo B (com folga_variavel) entra no pool rotativo — nao conta como garantido
    const padrao = regraGroupByColab.get(colab.id)?.padrao
    if (padrao?.folga_variavel_dia_semana) return count
    const regraDomingo = regraGroupByColab.get(colab.id)?.dias.get('DOM')
    return count + (hasGuaranteedSundayWindow(regraDomingo as SundayRuleEntry | undefined) ? 1 : 0)
  }, 0)
}

export function calcularCicloDomingo<TPadrao extends { folga_fixa_dia_semana: string | null; folga_variavel_dia_semana?: string | null } | null, TDia>(
  demandaRows: { dia_semana: string | null; min_pessoas: number }[],
  colabRows: { id: number; tipo_trabalhador: string | null }[],
  regraGroupByColab: Map<number, { padrao: TPadrao; dias: Map<string, TDia> }>,
): { cicloTrabalho: number; cicloFolga: number } {
  // null = todos os dias (inclui domingo). Consistente com preflight-capacity.ts:70
  const domDemandas = demandaRows.filter(d => d.dia_semana === 'DOM' || d.dia_semana === null)
  const dDomBruta = domDemandas.length > 0 ? Math.max(...domDemandas.map(d => d.min_pessoas)) : 0

  const nDom = colabRows.filter(c => {
    if ((c.tipo_trabalhador ?? 'CLT') === 'INTERMITENTE') {
      const padrao = regraGroupByColab.get(c.id)?.padrao
      if (!padrao?.folga_variavel_dia_semana) return false  // Tipo A: exclude
      // Tipo B: stays in pool
    }
    const group = regraGroupByColab.get(c.id)
    if (group?.padrao?.folga_fixa_dia_semana === 'DOM') return false
    return true
  }).length

  const intermitentesGarantidos = contarIntermitentesGarantidosNoDomingo(colabRows, regraGroupByColab)
  const { effectiveSundayDemand: dDom } = resolveSundayRotatingDemand({
    totalSundayDemand: dDomBruta,
    guaranteedSundayCoverage: intermitentesGarantidos,
    rotatingPoolSize: nDom,
  })

  if (dDom === 0 || nDom === 0) return { cicloTrabalho: 0, cicloFolga: 1 }

  // Strict > (not >=) to ensure slack — exact equality means zero room for maneuver
  if (nDom * (1 / 3) > dDom) return { cicloTrabalho: 1, cicloFolga: 2 }
  if (nDom * (1 / 2) > dDom) return { cicloTrabalho: 1, cicloFolga: 1 }
  if (nDom * (2 / 3) > dDom) return { cicloTrabalho: 2, cicloFolga: 1 }
  if (nDom * (3 / 4) > dDom) return { cicloTrabalho: 3, cicloFolga: 1 }
  // Fallback: >= allows exact match as last resort
  if (nDom * (1 / 3) >= dDom) return { cicloTrabalho: 1, cicloFolga: 2 }
  if (nDom * (1 / 2) >= dDom) return { cicloTrabalho: 1, cicloFolga: 1 }
  if (nDom * (2 / 3) >= dDom) return { cicloTrabalho: 2, cicloFolga: 1 }
  if (nDom * (3 / 4) >= dDom) return { cicloTrabalho: 3, cicloFolga: 1 }
  return { cicloTrabalho: nDom, cicloFolga: 0 }
}

// ---------------------------------------------------------------------------
// Build SolverInput from DB
// ---------------------------------------------------------------------------

/**
 * B7: Derive tipo_trabalhador from contract name.
 * Ensures consistency even if the DB column is stale.
 * Mirrors frontend derivarTipoTrabalhadorPorContrato() in ColaboradorDetalhe.tsx.
 */
function derivarTipoTrabalhador(
  tipoColuna: string | null,
  contratoNome: string,
): Colaborador['tipo_trabalhador'] {
  // NFD normalization to strip accents (matches frontend logic)
  const nome = contratoNome.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  if (nome.includes('intermit')) return 'INTERMITENTE'
  if (nome.includes('estagi')) return 'ESTAGIARIO'
  return tipoColuna === 'INTERMITENTE' || tipoColuna === 'ESTAGIARIO' ? tipoColuna : 'CLT'
}

export async function buildSolverInput(
  setorId: number,
  dataInicio: string,
  dataFim: string,
  pinnedCells?: PinnedCell[],
  options: BuildSolverInputOptions = {},
): Promise<SolverInput> {
  const rulePolicy = await buildEffectiveRulePolicy({
    generationMode: options.generationMode ?? 'OFFICIAL',
    rulesOverride: options.rulesOverride,
  })
  const overrideByColab = new Map<number, RegimeEscalaInput>(
    (options.regimesOverride ?? []).map((o) => [o.colaborador_id, o.regime_escala]),
  )

  // Empresa
  const emp = await queryOne<{
    tolerancia_semanal_min: number
    min_intervalo_almoco_min: number
    usa_cct_intervalo_reduzido: number
    grid_minutos: number
  }>('SELECT * FROM empresa LIMIT 1')

  // Setor
  const setor = await queryOne<{
    id: number
    hora_abertura: string
    hora_fechamento: string
    regime_escala: '5X2' | '6X1'
  }>('SELECT * FROM setores WHERE id = ?', setorId)
  if (!setor) throw new Error(`Setor ${setorId} nao encontrado`)

  // Ler horarios por dia do setor (cascata: setor > empresa > default)
  const setorHorarios = await queryAll<{
    dia_semana: string; hora_abertura: string; hora_fechamento: string; ativo: boolean
  }>('SELECT * FROM setor_horario_semana WHERE setor_id = ? AND ativo = TRUE', setorId)
  const funcoesAtivas = await queryAll<Funcao>(`
    SELECT id, setor_id, apelido, tipo_contrato_id, ativo, ordem, cor_hex
    FROM funcoes
    WHERE setor_id = ? AND ativo = TRUE
    ORDER BY ordem ASC, apelido ASC
  `, setorId)

  const empresaHorarios = await queryAll<{
    dia_semana: string; hora_abertura: string; hora_fechamento: string
  }>('SELECT * FROM empresa_horario_semana')

  // Montar mapa dia_semana → {abertura, fechamento}
  // Cascata: setor_horario_semana > empresa_horario_semana > setor.hora_abertura/hora_fechamento
  const DIA_MAP: Record<string, number> = { DOM: 0, SEG: 1, TER: 2, QUA: 3, QUI: 4, SEX: 5, SAB: 6 }
  const horarioPorDia: Record<number, { abertura: string; fechamento: string }> = {}
  for (let d = 0; d < 7; d++) {
    horarioPorDia[d] = { abertura: setor.hora_abertura, fechamento: setor.hora_fechamento }
  }
  for (const eh of empresaHorarios) {
    const d = DIA_MAP[eh.dia_semana]
    if (d !== undefined) horarioPorDia[d] = { abertura: eh.hora_abertura, fechamento: eh.hora_fechamento }
  }
  for (const sh of setorHorarios) {
    const d = DIA_MAP[sh.dia_semana]
    if (d !== undefined) horarioPorDia[d] = { abertura: sh.hora_abertura, fechamento: sh.hora_fechamento }
  }

  // Colaboradores + TipoContrato
  const colabRows = await queryAll<{
    id: number; setor_id: number; tipo_contrato_id: number; nome: string; sexo: string; horas_semanais: number; rank: number;
    prefere_turno: string | null; evitar_dia_semana: string | null;
    tipo_trabalhador: string | null; funcao_id: number | null; ativo: number;
    regime_escala: '5X2' | '6X1' | null;
    dias_trabalho: number; max_minutos_dia: number;
    contrato_nome: string;
  }>(`
    SELECT c.id, c.setor_id, c.tipo_contrato_id, c.nome, c.sexo, c.horas_semanais, c.rank, c.prefere_turno, c.evitar_dia_semana,
           c.tipo_trabalhador, c.funcao_id, c.ativo, tc.regime_escala, tc.dias_trabalho, tc.max_minutos_dia,
           tc.nome AS contrato_nome
    FROM colaboradores c
    JOIN tipos_contrato tc ON tc.id = c.tipo_contrato_id
    WHERE c.setor_id = ? AND c.ativo = true
    ORDER BY c.rank ASC, c.nome ASC
  `, setorId)

  const colabRowsById = new Map(colabRows.map((row) => [row.id, row]))
  const colabRowsForHelper: Colaborador[] = colabRows.map((row) => ({
    id: row.id,
    setor_id: row.setor_id,
    tipo_contrato_id: row.tipo_contrato_id,
    nome: row.nome,
    sexo: row.sexo as 'M' | 'F',
    horas_semanais: row.horas_semanais,
    rank: row.rank ?? 0,
    prefere_turno: (row.prefere_turno as Colaborador['prefere_turno']) ?? null,
    evitar_dia_semana: (row.evitar_dia_semana as DiaSemana | null) ?? null,
    ativo: Boolean(row.ativo),
    tipo_trabalhador: derivarTipoTrabalhador(row.tipo_trabalhador, row.contrato_nome),
    funcao_id: row.funcao_id,
  }))
  const participantes = listEscalaParticipantes(colabRowsForHelper, funcoesAtivas)
  const participantIds = new Set(participantes.map(({ colaborador }) => colaborador.id))
  const colabRowsFiltered = participantes
    .map(({ colaborador }) => colabRowsById.get(colaborador.id) ?? null)
    .filter((row): row is NonNullable<typeof row> => row != null)

  const foraDaEscala = colabRows.filter((row) => !participantIds.has(row.id))
  if (foraDaEscala.length > 0) {
    console.log(`[solver-bridge] ${foraDaEscala.length} colab(s) fora da escala ativa: ${foraDaEscala.map(r => r.nome).join(', ')}`)
  }

  const colaboradores: SolverInputColab[] = colabRowsFiltered.map(r => {
    const regimeEfetivo = overrideByColab.get(r.id) ?? setor.regime_escala ?? r.regime_escala ?? (r.dias_trabalho <= 5 ? '5X2' : '6X1')
    const diasTrabalhoEfetivo = regimeEfetivo === '5X2' ? 5 : 6
    return ({
      id: r.id,
      nome: r.nome,
      horas_semanais: r.horas_semanais,
      regime_escala: regimeEfetivo,
      dias_trabalho: diasTrabalhoEfetivo,
      max_minutos_dia: r.max_minutos_dia,
      tipo_trabalhador: derivarTipoTrabalhador(r.tipo_trabalhador, r.contrato_nome),
      sexo: r.sexo,
      funcao_id: r.funcao_id,
      rank: r.rank ?? 0,
    })
  })

  // Demandas
  const demandaRows = await queryAll<{
    dia_semana: string | null; hora_inicio: string; hora_fim: string;
    min_pessoas: number; override: number;
  }>(`
    SELECT dia_semana, hora_inicio, hora_fim, min_pessoas, override
    FROM demandas
    WHERE setor_id = ?
    ORDER BY dia_semana, hora_inicio
  `, setorId)

  const demanda: SolverInputDemanda[] = demandaRows.map(r => ({
    dia_semana: r.dia_semana ?? null,
    hora_inicio: r.hora_inicio,
    hora_fim: r.hora_fim,
    min_pessoas: r.min_pessoas,
    override: Boolean(r.override),
  }))

  // Feriados no periodo (inclui cct_autoriza pra H18)
  const feriados = await queryAll<{
    data: string; nome: string; proibido_trabalhar: number; cct_autoriza: number;
  }>(`
    SELECT data, nome, proibido_trabalhar, cct_autoriza
    FROM feriados
    WHERE data BETWEEN ? AND ?
  `, dataInicio, dataFim)

  // Excecoes no periodo
  const excecoes = await queryAll<{
    colaborador_id: number; data_inicio: string; data_fim: string; tipo: string;
  }>(`
    SELECT colaborador_id, data_inicio, data_fim, tipo
    FROM excecoes
    WHERE data_inicio <= ? AND data_fim >= ?
  `, dataFim, dataInicio)

  // v4: Regras de horario por colaborador (v16: simplificado 2 campos inicio/fim)
  type RegraHorarioRow = {
    colaborador_id: number; ativo: number; perfil_horario_id: number | null;
    dia_semana_regra: string | null;
    inicio: string | null; fim: string | null;
    preferencia_turno_soft: string | null;
    folga_fixa_dia_semana: string | null;
    folga_variavel_dia_semana: string | null;
    p_inicio: string | null; p_fim: string | null;
    p_preferencia_turno_soft: string | null;
  }
  const regraHorarioRows = await queryAll<RegraHorarioRow>(`
    SELECT r.colaborador_id, r.ativo, r.perfil_horario_id,
           r.dia_semana_regra,
           r.inicio, r.fim,
           r.preferencia_turno_soft,
           r.folga_fixa_dia_semana, r.folga_variavel_dia_semana,
           p.inicio AS p_inicio, p.fim AS p_fim,
           p.preferencia_turno_soft AS p_preferencia_turno_soft
    FROM colaborador_regra_horario r
    LEFT JOIN contrato_perfis_horario p ON p.id = r.perfil_horario_id AND p.ativo = true
    WHERE r.ativo = true
      AND r.colaborador_id IN (SELECT id FROM colaboradores WHERE setor_id = ? AND ativo = true)
  `, setorId)
  const regraHorarioRowsFiltered = regraHorarioRows.filter((row) => participantIds.has(row.colaborador_id))

  // Agrupar regras: padrao (dia_semana_regra IS NULL) + por dia da semana
  type RegraGroup = { padrao: RegraHorarioRow | null; dias: Map<string, RegraHorarioRow> }
  const regraGroupByColab = new Map<number, RegraGroup>()
  for (const r of regraHorarioRowsFiltered) {
    let g = regraGroupByColab.get(r.colaborador_id)
    if (!g) { g = { padrao: null, dias: new Map() }; regraGroupByColab.set(r.colaborador_id, g) }
    if (r.dia_semana_regra === null) g.padrao = r
    else g.dias.set(r.dia_semana_regra, r)
  }

  // v4: Excecoes de horario por data (v16: 2 campos inicio/fim)
  const excecaoDataRows = await queryAll<{
    colaborador_id: number; data: string; ativo: number;
    inicio: string | null; fim: string | null;
    preferencia_turno_soft: string | null; domingo_forcar_folga: number;
  }>(`
    SELECT colaborador_id, data, ativo, inicio, fim,
           preferencia_turno_soft, domingo_forcar_folga
    FROM colaborador_regra_horario_excecao_data
    WHERE ativo = true
      AND data BETWEEN ? AND ?
      AND colaborador_id IN (SELECT id FROM colaboradores WHERE setor_id = ? AND ativo = true)
  `, dataInicio, dataFim, setorId)
  const excecaoDataMap = new Map<string, typeof excecaoDataRows[0]>()
  for (const ed of excecaoDataRows) {
    if (!participantIds.has(ed.colaborador_id)) continue
    excecaoDataMap.set(`${ed.colaborador_id}|${ed.data}`, ed)
  }

  // v4: Demanda excecao por data
  const demandaExcecaoRows = await queryAll<{
    setor_id: number; data: string; hora_inicio: string; hora_fim: string;
    min_pessoas: number; override: number;
  }>(`
    SELECT setor_id, data, hora_inicio, hora_fim, min_pessoas, override
    FROM demandas_excecao_data
    WHERE setor_id = ? AND data BETWEEN ? AND ?
  `, setorId, dataInicio, dataFim)

  // v4: Build regras_colaborador_dia[] — resolve precedencia por (colab, data)
  const DIAS_SEMANA_MAP: Record<number, DiaSemana> = {
    0: 'SEG', 1: 'TER', 2: 'QUA', 3: 'QUI', 4: 'SEX', 5: 'SAB', 6: 'DOM',
  }

  const regrasColaboradorDia: SolverInputRegraColaboradorDia[] = []
  {
    const start = new Date(dataInicio + 'T00:00:00')
    const end = new Date(dataFim + 'T00:00:00')
    for (const colab of colabRowsFiltered) {
      const group = regraGroupByColab.get(colab.id)
      const d = new Date(start)
      while (d <= end) {
        const isoDate = d.toISOString().slice(0, 10)
        const diaSemana = DIAS_SEMANA_MAP[d.getDay() === 0 ? 6 : d.getDay() - 1]

        const excecaoData = excecaoDataMap.get(`${colab.id}|${isoDate}`)
        const isIntermitente = (colab.tipo_trabalhador || 'CLT') === 'INTERMITENTE'

        // Precedencia: excecao_data > regra_dia_especifico > regra_padrao > perfil_contrato > sem regra
        // Intermitente: só dia_especifico conta (padrão não define disponibilidade)
        const regra = isIntermitente
          ? (group?.dias.get(diaSemana) ?? null)
          : (group?.dias.get(diaSemana) ?? group?.padrao ?? null)

        // v16: Resolve 2 campos (inicio, fim) e traduz para 4 campos que o Python espera
        let efetivo_inicio: string | null = null
        let efetivo_fim: string | null = null
        let pref_turno: string | null = null
        let dom_forcar_folga = false
        let folga_fixa = false

        if (excecaoData) {
          efetivo_inicio = excecaoData.inicio
          efetivo_fim = excecaoData.fim
          pref_turno = excecaoData.preferencia_turno_soft
          dom_forcar_folga = Boolean(excecaoData.domingo_forcar_folga)
        } else if (regra) {
          // Regra individual sobrescreve perfil (campos nao-null)
          efetivo_inicio = regra.inicio ?? regra.p_inicio
          efetivo_fim = regra.fim ?? regra.p_fim
          pref_turno = regra.preferencia_turno_soft ?? regra.p_preferencia_turno_soft
        } else if (isIntermitente) {
          // Intermitente sem regra pro dia = bloqueado (não escalado)
          folga_fixa = true
        }

        // Folga fixa: usar regra padrão (campo nível-colaborador, não nível-dia)
        // Não se aplica a intermitente (não tem conceito de folga fixa CLT)
        if (!isIntermitente && group?.padrao?.folga_fixa_dia_semana && group.padrao.folga_fixa_dia_semana === diaSemana) {
          folga_fixa = true
        }

        // D14: Quando fixa=DOM, a "variavel" vira 2ª folga fixa (não condicional).
        // XOR é pulado no solver (B1 guard), então forçar folga_fixa no dia da variavel.
        if (!isIntermitente && group?.padrao?.folga_fixa_dia_semana === 'DOM'
          && group?.padrao?.folga_variavel_dia_semana && group.padrao.folga_variavel_dia_semana === diaSemana) {
          folga_fixa = true
        }

        // Traduz 2→4: inicio fixo = inicio_min==inicio_max, fim = fim_max (fim_min=null)
        const inicio_min = efetivo_inicio
        const inicio_max = efetivo_inicio  // solver forca slot exato
        const fim_max = efetivo_fim        // teto de saida
        const fim_min: string | null = null // dead code no solver

        const intermitenteDisponivelSemJanela = isIntermitente && Boolean(regra) && !folga_fixa

        // Intermitente com dia ativo e sem horario explicito precisa entrar no payload
        // para o preflight distinguir "dia habilitado" de "dia bloqueado".
        if (inicio_min || inicio_max || fim_min || fim_max || pref_turno || dom_forcar_folga || folga_fixa || intermitenteDisponivelSemJanela) {
          regrasColaboradorDia.push({
            colaborador_id: colab.id,
            data: isoDate,
            inicio_min,
            inicio_max,
            fim_min,
            fim_max,
            preferencia_turno_soft: pref_turno,
            domingo_forcar_folga: dom_forcar_folga,
            folga_fixa,
          })
        }

        d.setDate(d.getDate() + 1)
      }
    }
  }

  // Enriquecer colaboradores com dados de regra padrão (campos nível-colaborador)
  for (const c of colaboradores) {
    const group = regraGroupByColab.get(c.id)
    const padrao = group?.padrao
    if (padrao) {
      // folga_fixa: stays NULL for intermitente (no CLT fixed day off concept)
      if (c.tipo_trabalhador !== 'INTERMITENTE') {
        c.folga_fixa_dia_semana = (padrao.folga_fixa_dia_semana as DiaSemana | null) ?? null
      }
      // folga_variavel: allowed for tipo B intermitente (enters sunday rotation)
      c.folga_variavel_dia_semana = (padrao.folga_variavel_dia_semana as DiaSemana | null) ?? null
    }

    // Intermitente: dias_trabalho = quantidade de dias com toggle ON
    // Evita INFEASIBLE: add_dias_trabalho usa dias_trabalho pra calcular target,
    // mas blocked_days não inclui folga_fixa de regras_colaborador_dia
    if (c.tipo_trabalhador === 'INTERMITENTE') {
      c.dias_trabalho = group?.dias.size ?? 0
      // Tipo B: XOR desconta 1 dia (variavel = nao trabalha nesse dia quando trabalha DOM)
      if (c.folga_variavel_dia_semana && c.dias_trabalho > 0) {
        c.dias_trabalho -= 1
      }
      if (c.dias_trabalho === 0) {
        console.warn(`[solver-bridge] Intermitente ${c.nome} (id=${c.id}) tem 0 dias ativos`)
      }
    }
  }

  // v22: Ciclo domingo calculado automaticamente (tenta 1/2 → 1/1 → 2/1)
  const { cicloTrabalho, cicloFolga } = calcularCicloDomingo(demandaRows, colabRowsFiltered, regraGroupByColab)
  for (const c of colaboradores) {
    // Tipo A (sem folga_variavel): fora do pool
    if (c.tipo_trabalhador === 'INTERMITENTE' && !c.folga_variavel_dia_semana) continue
    if (c.folga_fixa_dia_semana === 'DOM') {
      c.domingo_ciclo_trabalho = 0
      c.domingo_ciclo_folga = 1
      // D14: NÃO nullar folga_variavel — quando fixa=DOM, a "variavel" vira
      // "2ª folga fixa da semana" (RH escolhe o dia). O solver B1 guard já
      // pula o XOR, e add_folga_fixa_5x2 trata DOM como dia off.
      // Se variavel != null, o solver vai respeitar via regras_colaborador_dia.
      continue
    }
    c.domingo_ciclo_trabalho = cicloTrabalho
    c.domingo_ciclo_folga = cicloFolga
  }

  // Warm-start hints: reuse last schedule solution for same setor+period.
  const lastScale = options.hintsEscalaId !== undefined
    ? ({ id: options.hintsEscalaId } as { id: number })
    : await queryOne<{ id: number }>(`
        SELECT id
        FROM escalas
        WHERE setor_id = ? AND data_inicio = ? AND data_fim = ? AND status != 'ARQUIVADA'
        ORDER BY id DESC
        LIMIT 1
      `, setorId, dataInicio, dataFim)

  let hints: SolverInputHint[] | undefined
  if (lastScale) {
    const hintRows = await queryAll<{
      colaborador_id: number
      data: string
      status: 'TRABALHO' | 'FOLGA' | 'INDISPONIVEL'
      hora_inicio: string | null
      hora_fim: string | null
    }>(`
      SELECT colaborador_id, data, status, hora_inicio, hora_fim
      FROM alocacoes
      WHERE escala_id = ?
    `, lastScale.id)

    hints = hintRows
      .filter((hint) => participantIds.has(hint.colaborador_id))
      .map((h) => ({
      colaborador_id: h.colaborador_id,
      data: h.data,
      status: h.status,
      hora_inicio: h.hora_inicio,
      hora_fim: h.hora_fim,
    }))
  }

  return {
    setor_id: setorId,
    data_inicio: dataInicio,
    data_fim: dataFim,
    empresa: {
      tolerancia_semanal_min: emp?.tolerancia_semanal_min ?? 0,
      hora_abertura: setor.hora_abertura,
      hora_fechamento: setor.hora_fechamento,
      min_intervalo_almoco_min: emp?.min_intervalo_almoco_min ?? 60,
      max_intervalo_almoco_min: 120,
      grid_minutos: emp?.grid_minutos ?? 30,
      horario_por_dia: horarioPorDia,
    },
    colaboradores,
    demanda,
    feriados: feriados.map(f => ({
      data: f.data,
      nome: f.nome,
      // v4: so 25/12 e 01/01 sao hard-blocked (proibido_trabalhar=1 AND cct_autoriza=0)
      // Outros feriados: orientados por demanda (solver so nao aloca se demanda = 0)
      proibido_trabalhar: Boolean(f.proibido_trabalhar) && !Boolean(f.cct_autoriza),
    })),
    excecoes: excecoes
      .filter((excecao) => participantIds.has(excecao.colaborador_id))
      .map(e => ({
      colaborador_id: e.colaborador_id,
      data_inicio: e.data_inicio,
      data_fim: e.data_fim,
      tipo: e.tipo,
    })),
    pinned_cells: pinnedCells ?? [],
    hints,
    regras_colaborador_dia: regrasColaboradorDia.length > 0 ? regrasColaboradorDia : undefined,
    demanda_excecao_data: demandaExcecaoRows.length > 0
      ? demandaExcecaoRows.map(r => ({
          setor_id: r.setor_id,
          data: r.data,
          hora_inicio: r.hora_inicio,
          hora_fim: r.hora_fim,
          min_pessoas: r.min_pessoas,
          override: Boolean(r.override),
        }))
      : undefined,
    config: {
      solve_mode: options.solveMode ?? 'rapido',
      ...(options.maxTimeSeconds != null ? { max_time_seconds: options.maxTimeSeconds } : {}),
      num_workers: 8,
      generation_mode: rulePolicy.generationMode,
      ...(rulePolicy.adjustments.length > 0 ? { policy_adjustments: rulePolicy.adjustments } : {}),
      nivel_rigor: options.nivelRigor ?? 'ALTO',  // backward compat quando rules ausente
      rules: rulePolicy.solverRules,
      ...(options.pinnedFolgaExterno ? { pinned_folga_externo: options.pinnedFolgaExterno } : {}),
    },
  }
}

export function computeSolverScenarioHash(input: SolverInput): string {
  const norm = {
    setor_id: input.setor_id,
    data_inicio: input.data_inicio,
    data_fim: input.data_fim,
    empresa: {
      tolerancia_semanal_min: input.empresa.tolerancia_semanal_min,
      hora_abertura: input.empresa.hora_abertura,
      hora_fechamento: input.empresa.hora_fechamento,
      min_intervalo_almoco_min: input.empresa.min_intervalo_almoco_min,
      max_intervalo_almoco_min: input.empresa.max_intervalo_almoco_min,
      grid_minutos: input.empresa.grid_minutos,
      horario_por_dia: input.empresa.horario_por_dia ?? {},
    },
    colaboradores: [...input.colaboradores]
      .map((c) => ({
        id: c.id,
        horas_semanais: c.horas_semanais,
        regime_escala: c.regime_escala ?? (c.dias_trabalho <= 5 ? '5X2' : '6X1'),
        dias_trabalho: c.dias_trabalho,
        max_minutos_dia: c.max_minutos_dia,
        tipo_trabalhador: c.tipo_trabalhador,
        sexo: c.sexo,
        domingo_ciclo_trabalho: c.domingo_ciclo_trabalho ?? 2,
        domingo_ciclo_folga: c.domingo_ciclo_folga ?? 1,
        folga_fixa_dia_semana: c.folga_fixa_dia_semana ?? null,
        folga_variavel_dia_semana: c.folga_variavel_dia_semana ?? null,
      }))
      .sort((a, b) => a.id - b.id),
    demanda: [...input.demanda]
      .map((d) => ({
        dia_semana: d.dia_semana ?? null,
        hora_inicio: d.hora_inicio,
        hora_fim: d.hora_fim,
        min_pessoas: d.min_pessoas,
        override: Boolean(d.override),
      }))
      .sort((a, b) =>
        `${a.dia_semana ?? 'ALL'}|${a.hora_inicio}|${a.hora_fim}|${a.min_pessoas}|${a.override ? 1 : 0}`.localeCompare(
          `${b.dia_semana ?? 'ALL'}|${b.hora_inicio}|${b.hora_fim}|${b.min_pessoas}|${b.override ? 1 : 0}`,
        ),
      ),
    feriados: [...input.feriados]
      .map((f) => ({ data: f.data, proibido_trabalhar: f.proibido_trabalhar }))
      .sort((a, b) => a.data.localeCompare(b.data)),
    excecoes: [...input.excecoes]
      .map((e) => ({
        colaborador_id: e.colaborador_id,
        data_inicio: e.data_inicio,
        data_fim: e.data_fim,
        tipo: e.tipo,
      }))
      .sort((a, b) =>
        `${a.colaborador_id}|${a.data_inicio}|${a.data_fim}|${a.tipo}`.localeCompare(
          `${b.colaborador_id}|${b.data_inicio}|${b.data_fim}|${b.tipo}`,
        ),
      ),
    regras_colaborador_dia: [...(input.regras_colaborador_dia ?? [])]
      .sort((a, b) => `${a.colaborador_id}|${a.data}`.localeCompare(`${b.colaborador_id}|${b.data}`)),
    demanda_excecao_data: [...(input.demanda_excecao_data ?? [])]
      .sort((a, b) => `${a.data}|${a.hora_inicio}`.localeCompare(`${b.data}|${b.hora_inicio}`)),
    generation_mode: input.config.generation_mode ?? 'OFFICIAL',
    rules: input.config.rules
      ? Object.fromEntries(
          Object.entries(input.config.rules).sort(([a], [b]) => a.localeCompare(b)),
        )
      : {},
  }

  return createHash('sha256').update(JSON.stringify(norm)).digest('hex')
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Active solver child process (for cancellation)
// ---------------------------------------------------------------------------

let activeSolverChild: ChildProcess | null = null

export function cancelSolver(): boolean {
  if (activeSolverChild) {
    activeSolverChild.kill('SIGTERM')
    activeSolverChild = null
    return true
  }
  return false
}

// Run solver (with optional stderr streaming callback)
// ---------------------------------------------------------------------------

export function runSolver(
  input: SolverInput,
  timeoutMs = 3_660_000, // 61 min — matches Python HARD_TIME_CAP (3600s) + margin
  onLog?: (line: string) => void,
): Promise<SolverOutput> {
  return new Promise((resolve, reject) => {
    const solverPath = resolveSolverPath()
    const isPy = isPythonScript(solverPath)

    const cmd = isPy ? resolvePythonCmd() : solverPath
    const args = isPy ? [solverPath] : []

    let child
    try {
      child = spawn(cmd, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
      })
    } catch (err: any) {
      reject(new Error(`Falha ao iniciar solver: ${err.message}`))
      return
    }

    activeSolverChild = child

    let stdout = ''
    let stderrBuf = ''
    let settled = false

    const settle = () => {
      settled = true
      activeSolverChild = null
    }

    const timer = setTimeout(() => {
      if (!settled) {
        settle()
        child.kill('SIGKILL')
        reject(new Error(
          `Solver excedeu timeout de ${Math.round(timeoutMs / 1000)}s. ` +
          'Tente um periodo menor ou menos colaboradores.'
        ))
      }
    }, timeoutMs)

    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString() })

    child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString()
      stderrBuf += text

      // Stream lines to callback for real-time progress
      if (onLog) {
        const lines = text.split('\n')
        for (const line of lines) {
          const trimmed = line.trim()
          if (trimmed) {
            onLog(trimmed)
          }
        }
      }
    })

    child.on('error', (err) => {
      if (!settled) {
        settle()
        clearTimeout(timer)
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          reject(new Error(
            `Solver nao encontrado em "${cmd}". ` +
            (isPy ? 'Instale Python 3 e ortools.' : 'Rode solver:build.')
          ))
        } else {
          reject(new Error(`Erro ao executar solver: ${err.message}`))
        }
      }
    })

    child.on('close', (code) => {
      if (settled) return
      settle()
      clearTimeout(timer)

      if (stderrBuf.trim() && !onLog) {
        console.error('[SOLVER stderr]', stderrBuf.trim())
      }

      if (code !== 0 && !stdout.trim()) {
        reject(new Error(
          `Solver saiu com codigo ${code}. ${stderrBuf.trim() || 'Sem detalhes.'}`
        ))
        return
      }

      try {
        const raw = stdout.trim()
        let result: SolverOutput
        try {
          // Fast path: solver returned pure JSON.
          result = JSON.parse(raw)
        } catch {
          // Defensive path: OR-Tools progress logs may appear before final JSON line.
          const lastLine = raw
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean)
            .at(-1)

          if (!lastLine) throw new Error('stdout vazio')
          result = JSON.parse(lastLine)
        }
        resolve(result)
      } catch {
        reject(new Error(
          `Resposta invalida do solver (exit ${code}): ${stdout.substring(0, 200)}`
        ))
      }
    })

    // Prevent uncaught EPIPE if the child dies before we finish writing
    child.stdin.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code !== 'EPIPE') {
        console.error('[solver-bridge] stdin error:', err.message)
      }
      // EPIPE is handled by the 'close' event which fires with a non-zero exit code
    })

    // Send input and close stdin
    const inputJson = JSON.stringify(input)
    child.stdin.write(inputJson)
    child.stdin.end()
  })
}

// ---------------------------------------------------------------------------
// Persistência de resultado do solver no banco
// Extrai a lógica inline do tipc.ts escalasGerar para reuso pelas tools da IA
// ---------------------------------------------------------------------------

/**
 * Persiste o resultado de uma execução bem-sucedida do solver no banco de dados.
 * Cria os registros em: escalas, alocacoes, escala_decisoes.
 * escala_comparacao_demanda é preenchida depois por persistirResumoAutoritativoEscala (após validarEscalaV3).
 * Retorna o id da escala criada.
 */
export async function persistirSolverResult(
  setorId: number,
  dataInicio: string,
  dataFim: string,
  solverResult: SolverOutput,
  inputHash?: string,
  regimesOverride?: Array<{ colaborador_id: number; regime_escala: string }>,
): Promise<number> {
  const ind = solverResult.indicadores!
  const decisoes = solverResult.decisoes ?? []
  // comparacao_demanda NÃO é inserida aqui: é gravada só em persistirResumoAutoritativoEscala
  // após validarEscalaV3(), evitando duplicate key (escala_comparacao_demanda_pkey)
  const equipeSnapshot = await buildEscalaEquipeSnapshot(setorId)
  const setor = await queryOne<{ simulacao_config_json?: string | null }>(
    'SELECT simulacao_config_json FROM setores WHERE id = ?',
    setorId,
  )
  const setorSimulacao = normalizeSetorSimulacaoConfig(setor?.simulacao_config_json ?? null)
  const simulacaoConfigJson = JSON.stringify({
    regimes_override: regimesOverride ?? [],
    setor_overrides_locais: setorSimulacao.setor.overrides_locais,
  })

  return await transaction(async () => {
    const escalaId = await insertReturningId(`
      INSERT INTO escalas
        (setor_id, data_inicio, data_fim, status, pontuacao,
         cobertura_percent, violacoes_hard, violacoes_soft, equilibrio, input_hash, simulacao_config_json, equipe_snapshot_json)
      VALUES (?, ?, ?, 'RASCUNHO', ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      setorId, dataInicio, dataFim,
      ind.pontuacao, ind.cobertura_percent, ind.violacoes_hard, ind.violacoes_soft, ind.equilibrio,
      inputHash ?? null,
      simulacaoConfigJson,
      JSON.stringify(equipeSnapshot),
    )

    for (const a of solverResult.alocacoes!) {
      await execute(`
        INSERT INTO alocacoes
          (escala_id, colaborador_id, data, status, hora_inicio, hora_fim,
           minutos, minutos_trabalho, hora_almoco_inicio, hora_almoco_fim,
           minutos_almoco, intervalo_15min, funcao_id,
           hora_intervalo_inicio, hora_intervalo_fim, hora_real_inicio, hora_real_fim)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
        escalaId, a.colaborador_id, a.data, a.status,
        a.hora_inicio ?? null, a.hora_fim ?? null,
        a.minutos_trabalho ?? null, a.minutos_trabalho ?? null,
        a.hora_almoco_inicio ?? null, a.hora_almoco_fim ?? null,
        a.minutos_almoco ?? null,
        a.intervalo_15min ?? false,
        a.funcao_id ?? null,
        a.hora_intervalo_inicio ?? null,
        a.hora_intervalo_fim ?? null,
        a.hora_real_inicio ?? null,
        a.hora_real_fim ?? null,
      )
    }

    for (const d of decisoes) {
      await execute(`
        INSERT INTO escala_decisoes (escala_id, colaborador_id, data, acao, razao, alternativas_tentadas)
        VALUES (?, ?, ?, ?, ?, ?)
      `, escalaId, d.colaborador_id, d.data, d.acao, d.razao, d.alternativas_tentadas)
    }

    return escalaId
  })
}
