import { writeFile, rm } from 'node:fs/promises'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import { queryOne, queryAll, execute, insertReturningId, transaction, execDDL } from './db/query'
import { validarEscalaV3 } from './motor/validador'
import { buildSolverInput, computeSolverScenarioHash, runSolver } from './motor/solver-bridge'
import path from 'node:path'
import { iaEnviarMensagem, iaEnviarMensagemStream, iaTestarConexao } from './ia/cliente'
import type {
  EscalaCompletaV3,
  EscalaPreflightResult,
  PinnedCell,
  Escala,
  Alocacao,
  DashboardResumo,
  SetorResumo,
  AlertaDashboard,
  SolverInput,
} from '../shared'

const require = createRequire(import.meta.url)
const electron = require('electron') as typeof import('electron')
const { tipc } = require('@egoist/tipc/main') as typeof import('@egoist/tipc/main')

const t = tipc.create()
const { dialog, BrowserWindow, app } = electron

type RegimeEscalaInput = '5X2' | '6X1'

// =============================================================================
// ANEXOS — persistência em disco
// =============================================================================

function getAnexosBaseDir(): string {
  try {
    if (app?.isPackaged && app.getPath) {
      return path.join(app.getPath('userData'), 'anexos')
    }
  } catch { /* fallback */ }
  return path.join(__dirname, '../../data/anexos')
}

function getAnexosConversaDir(conversa_id: string): string {
  const dir = path.join(getAnexosBaseDir(), conversa_id)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

function mimeToExt(mime: string): string {
  const map: Record<string, string> = {
    'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif',
    'image/webp': '.webp', 'image/bmp': '.bmp', 'application/pdf': '.pdf',
    'text/plain': '.txt', 'text/markdown': '.md',
  }
  return map[mime] || '.bin'
}

async function limparAnexosConversa(conversa_id: string): Promise<void> {
  const dir = path.join(getAnexosBaseDir(), conversa_id)
  if (existsSync(dir)) {
    await rm(dir, { recursive: true, force: true })
  }
}

async function limparAnexosArquivadas(): Promise<void> {
  const arquivadas = await queryAll<{ id: string }>(
    `SELECT id FROM ia_conversas WHERE status = 'arquivado'`
  )
  for (const c of arquivadas) {
    await limparAnexosConversa(c.id)
  }
}

type SimulacaoRegimeOverride = {
  colaborador_id: number
  regime_escala: RegimeEscalaInput
}

type EscalaSimulacaoConfig = {
  regimes_override?: SimulacaoRegimeOverride[]
}

function normalizeRegimesOverride(overrides?: SimulacaoRegimeOverride[]): SimulacaoRegimeOverride[] {
  const map = new Map<number, RegimeEscalaInput>()
  for (const o of overrides ?? []) {
    if (!Number.isInteger(o.colaborador_id) || o.colaborador_id <= 0) continue
    if (o.regime_escala !== '5X2' && o.regime_escala !== '6X1') continue
    map.set(o.colaborador_id, o.regime_escala)
  }
  return [...map.entries()]
    .map(([colaborador_id, regime_escala]) => ({ colaborador_id, regime_escala }))
    .sort((a, b) => a.colaborador_id - b.colaborador_id)
}

function parseEscalaSimulacaoConfig(raw: string | null | undefined): EscalaSimulacaoConfig {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as EscalaSimulacaoConfig
    return {
      regimes_override: normalizeRegimesOverride(parsed?.regimes_override),
    }
  } catch {
    return {}
  }
}

function listDays(dataInicio: string, dataFim: string): string[] {
  const out: string[] = []
  const start = new Date(`${dataInicio}T00:00:00`)
  const end = new Date(`${dataFim}T00:00:00`)
  const d = new Date(start.getTime())
  while (d <= end) {
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    out.push(iso)
    d.setDate(d.getDate() + 1)
  }
  return out
}

function dayLabel(isoDate: string): 'SEG' | 'TER' | 'QUA' | 'QUI' | 'SEX' | 'SAB' | 'DOM' {
  const d = new Date(`${isoDate}T00:00:00`)
  const week = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB'] as const
  return week[d.getDay()] === 'DOM' ? 'DOM' : week[d.getDay()]
}

function minutesBetween(h1: string, h2: string): number {
  const [aH, aM] = h1.split(':').map(Number)
  const [bH, bM] = h2.split(':').map(Number)
  return Math.max(0, (bH * 60 + bM) - (aH * 60 + aM))
}

function enrichPreflightWithCapacityChecks(
  input: SolverInput,
  blockers: EscalaPreflightResult['blockers'],
  warnings: EscalaPreflightResult['warnings'],
): void {
  const days = listDays(input.data_inicio, input.data_fim)
  const holidayForbidden = new Set(
    input.feriados.filter((f) => f.proibido_trabalhar).map((f) => f.data),
  )

  const demandByDay = new Map<string, Array<{ min_pessoas: number; hora_inicio: string; hora_fim: string }>>()
  for (const day of days) {
    const label = dayLabel(day)
    const active = input.demanda
      .filter((d) => d.dia_semana === null || d.dia_semana === label)
      .filter((d) => d.min_pessoas > 0)
      .map((d) => ({ min_pessoas: d.min_pessoas, hora_inicio: d.hora_inicio, hora_fim: d.hora_fim }))
    demandByDay.set(day, active)
  }

  for (const day of days) {
    const dayDemand = demandByDay.get(day) ?? []
    if (dayDemand.length === 0) continue

    const label = dayLabel(day)
    if (label === 'DOM' && input.colaboradores.every((c) => (c.domingo_ciclo_trabalho ?? 0) <= 0)) {
      blockers.push({
        codigo: 'DOMINGO_SEM_COLABORADORES',
        severidade: 'BLOCKER',
        mensagem: `Ha demanda no domingo (${day}), mas nenhum colaborador aceita domingo.`,
        detalhe: 'Ative domingo para alguem ou ajuste demanda.',
      })
      break
    }

    if (holidayForbidden.has(day)) {
      blockers.push({
        codigo: 'DEMANDA_EM_FERIADO_PROIBIDO',
        severidade: 'BLOCKER',
        mensagem: `Ha demanda no feriado proibido ${day}.`,
        detalhe: 'Ajuste demanda do dia ou permissao de feriado.',
      })
      break
    }

    const peakDemand = dayDemand.reduce((acc, d) => Math.max(acc, d.min_pessoas), 0)
    const requiredMin = peakDemand
    const availableCount = input.colaboradores.filter((c) => {
      if (label === 'DOM' && (c.domingo_ciclo_trabalho ?? 0) <= 0) return false
      if (holidayForbidden.has(day)) return false
      return !input.excecoes.some((e) => e.colaborador_id === c.id && e.data_inicio <= day && day <= e.data_fim)
    }).length

    if (availableCount < requiredMin) {
      blockers.push({
        codigo: 'CAPACIDADE_DIARIA_INSUFICIENTE',
        severidade: 'BLOCKER',
        mensagem: `Capacidade insuficiente em ${day}: disponiveis=${availableCount}, minimo requerido=${requiredMin}.`,
        detalhe: 'Revise piso operacional, excecoes, regime dos contratos ou demanda.',
      })
      break
    }
  }

  const requiredMinutes = days.reduce((accDay, day) => {
    const segments = demandByDay.get(day) ?? []
    return accDay + segments.reduce((accSeg, seg) => {
      return accSeg + minutesBetween(seg.hora_inicio, seg.hora_fim) * seg.min_pessoas
    }, 0)
  }, 0)

  const totalWeeksFactor = days.length / 7
  const availableContractMinutes = input.colaboradores.reduce((acc, c) => {
    return acc + (c.horas_semanais * 60 * totalWeeksFactor)
  }, 0)

  if (requiredMinutes > availableContractMinutes * 1.15) {
    warnings.push({
      codigo: 'DEMANDA_ACIMA_CAPACIDADE_ESTIMADA',
      severidade: 'WARNING',
      mensagem: 'Demanda do periodo parece acima da capacidade estimada da equipe.',
      detalhe: `Demanda≈${Math.round(requiredMinutes)}min vs capacidade≈${Math.round(availableContractMinutes)}min.`,
    })
  }

  // v4: Validar limite de capacidade individual por colaborador
  // Verifica se a janela (fim - inicio) de cada dia multiplicada pelos dias de trabalho
  // e apos deducao do intervalo de almoco obrigatorio nao torna a meta de horas matematicamente impossivel.
  for (const c of input.colaboradores) {
    if (c.tipo_trabalhador === 'ESTAGIARIO') continue;

    const horasSemanaisMinutos = c.horas_semanais * 60;
    const toleranciaMinutos = input.empresa.tolerancia_semanal_min;
    const limiteInferiorSemanal = Math.max(0, horasSemanaisMinutos - toleranciaMinutos);

    // Identificar a janela padrao do colaborador pelas regras
    let maxJanelaDoColaborador = c.max_minutos_dia;

    const regras = input.regras_colaborador_dia?.filter(r => r.colaborador_id === c.id) || [];

    // Simplificacao: preflight busca apenas detectar casos endemicos (padrao semanal de janela curta)
    if (regras.length > 0) {
      const regraTipica = regras.find(r => r.inicio_min || r.fim_max);

      if (regraTipica) {
        let janelaMinutos = c.max_minutos_dia; // default fallback

        let startToUse = regraTipica.inicio_min || input.empresa.hora_abertura;
        let endToUse = regraTipica.fim_max || input.empresa.hora_fechamento;

        const possibleMinutes = minutesBetween(startToUse, endToUse);
        if (possibleMinutes > 0 && possibleMinutes < janelaMinutos) {
          janelaMinutos = possibleMinutes;
        }

        maxJanelaDoColaborador = Math.min(janelaMinutos, c.max_minutos_dia);
      }
    }

    // Se a meta e > 6h (360 minutos), um almoco obrigatorio de X minutos sera descontado.
    let capacidadeDiaria = maxJanelaDoColaborador;
    const metaDiariaMedia = horasSemanaisMinutos / c.dias_trabalho;

    if (metaDiariaMedia > 360) {
      capacidadeDiaria -= input.empresa.min_intervalo_almoco_min;
    }

    const capacidadeMaxSemanal = capacidadeDiaria * c.dias_trabalho;

    // Se a capacidade total e menor que a tolerancia minima do contrato, o modelo VAI FALHAR
    if (capacidadeMaxSemanal < limiteInferiorSemanal) {
      blockers.push({
        codigo: 'CAPACIDADE_INDIVIDUAL_INSUFICIENTE',
        severidade: 'BLOCKER',
        mensagem: `A janela de disponibilidade de ${c.nome} torna a carga horaria incompativel.`,
        detalhe: `Capacidade max da jornada (descontando almoço) é ${Math.round(capacidadeMaxSemanal / 60)}h. Contrato exige minimo de ${Math.round(limiteInferiorSemanal / 60)}h. Altere a escala de horario dele ou reduza o contrato.`,
      });
    }
  }
}

async function buildEscalaPreflight(
  setorId: number,
  dataInicio: string,
  dataFim: string,
  regimesOverride?: SimulacaoRegimeOverride[],
): Promise<EscalaPreflightResult> {
  const blockers: EscalaPreflightResult['blockers'] = []
  const warnings: EscalaPreflightResult['warnings'] = []

  const setor = await queryOne<{ id: number; ativo: boolean }>('SELECT id, ativo FROM setores WHERE id = ?', setorId)
  if (!setor || !setor.ativo) {
    blockers.push({
      codigo: 'SETOR_INVALIDO',
      severidade: 'BLOCKER',
      mensagem: `Setor ${setorId} nao encontrado ou inativo.`,
    })
  }

  const colabsRow = await queryOne<{ count: number }>('SELECT COUNT(*)::int as count FROM colaboradores WHERE setor_id = ? AND ativo = TRUE', setorId)
  const colabsAtivos = colabsRow?.count ?? 0
  if (colabsAtivos === 0) {
    blockers.push({
      codigo: 'SEM_COLABORADORES',
      severidade: 'BLOCKER',
      mensagem: 'Setor nao tem colaboradores ativos.',
      detalhe: 'Cadastre ao menos 1 colaborador para gerar escala.',
    })
  }

  const demandasRow = await queryOne<{ count: number }>('SELECT COUNT(*)::int as count FROM demandas WHERE setor_id = ?', setorId)
  const demandasCount = demandasRow?.count ?? 0
  if (demandasCount === 0) {
    warnings.push({
      codigo: 'SEM_DEMANDA',
      severidade: 'WARNING',
      mensagem: 'Setor sem demanda planejada cadastrada.',
      detalhe: 'O motor vai considerar demanda zero nos slots sem segmento cadastrado.',
    })
  }

  const feriadosRow = await queryOne<{ count: number }>('SELECT COUNT(*)::int as count FROM feriados WHERE data BETWEEN ? AND ?', dataInicio, dataFim)
  const feriadosNoPeriodo = feriadosRow?.count ?? 0

  if (blockers.length === 0) {
    try {
      const input = await buildSolverInput(setorId, dataInicio, dataFim, undefined, {
        regimesOverride: normalizeRegimesOverride(regimesOverride),
      })
      enrichPreflightWithCapacityChecks(input, blockers, warnings)
    } catch (err) {
      warnings.push({
        codigo: 'PREFLIGHT_DIAGNOSTICO_INDISPONIVEL',
        severidade: 'WARNING',
        mensagem: 'Nao foi possivel rodar o diagnostico de capacidade completo.',
        detalhe: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return {
    ok: blockers.length === 0,
    blockers,
    warnings,
    summary: {
      setor_id: setorId,
      data_inicio: dataInicio,
      data_fim: dataFim,
      colaboradores_ativos: colabsAtivos,
      demandas_cadastradas: demandasCount,
      feriados_no_periodo: feriadosNoPeriodo,
      demanda_zero_fallback: demandasCount === 0,
    },
  }
}

// =============================================================================
// EMPRESA (2 handlers)
// =============================================================================

const empresaBuscar = t.procedure
  .action(async () => {
    const empresa = await queryOne('SELECT * FROM empresa LIMIT 1')
    if (!empresa) throw new Error('Empresa nao configurada')
    return empresa
  })

const empresaAtualizar = t.procedure
  .input<{ nome: string; cnpj: string; telefone: string; corte_semanal: string; tolerancia_semanal_min: number; min_intervalo_almoco_min?: number; usa_cct_intervalo_reduzido?: boolean }>()
  .action(async ({ input }) => {
    const empresa = await queryOne<{ id: number }>('SELECT id FROM empresa LIMIT 1')

    if (empresa) {
      await execute(`UPDATE empresa SET nome = ?, cnpj = ?, telefone = ?, corte_semanal = ?, tolerancia_semanal_min = ?,
        min_intervalo_almoco_min = ?, usa_cct_intervalo_reduzido = ? WHERE id = ?`,
          input.nome, input.cnpj, input.telefone, input.corte_semanal, input.tolerancia_semanal_min,
          input.min_intervalo_almoco_min ?? 60,
          input.usa_cct_intervalo_reduzido !== false,
          empresa.id
        )
    } else {
      await execute(`INSERT INTO empresa (nome, cnpj, telefone, corte_semanal, tolerancia_semanal_min, min_intervalo_almoco_min, usa_cct_intervalo_reduzido)
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
          input.nome, input.cnpj, input.telefone, input.corte_semanal, input.tolerancia_semanal_min,
          input.min_intervalo_almoco_min ?? 60,
          input.usa_cct_intervalo_reduzido !== false
        )
    }

    return await queryOne('SELECT * FROM empresa LIMIT 1')
  })

// =============================================================================
// TIPOS CONTRATO (5 handlers)
// =============================================================================

const tiposContratoListar = t.procedure
  .action(async () => {
    return await queryAll('SELECT * FROM tipos_contrato ORDER BY horas_semanais DESC')
  })

const tiposContratoBuscar = t.procedure
  .input<{ id: number }>()
  .action(async ({ input }) => {
    const tipo = await queryOne('SELECT * FROM tipos_contrato WHERE id = ?', input.id)
    if (!tipo) throw new Error('Tipo de contrato nao encontrado')
    return tipo
  })

const tiposContratoCriar = t.procedure
  .input<{
    nome: string
    horas_semanais: number
    regime_escala?: '5X2' | '6X1'
    dias_trabalho?: number
    max_minutos_dia: number
  }>()
  .action(async ({ input }) => {
    const regime = input.regime_escala ?? ((input.dias_trabalho ?? 6) <= 5 ? '5X2' : '6X1')
    const diasTrabalho = regime === '5X2' ? 5 : 6
    const id = await insertReturningId(`
      INSERT INTO tipos_contrato (nome, horas_semanais, regime_escala, dias_trabalho, max_minutos_dia)
      VALUES (?, ?, ?, ?, ?)
    `, input.nome, input.horas_semanais, regime, diasTrabalho, input.max_minutos_dia)

    return await queryOne('SELECT * FROM tipos_contrato WHERE id = ?', id)
  })

const tiposContratoAtualizar = t.procedure
  .input<{
    id: number
    nome: string
    horas_semanais: number
    regime_escala?: '5X2' | '6X1'
    dias_trabalho?: number
    max_minutos_dia: number
  }>()
  .action(async ({ input }) => {
    const regime = input.regime_escala ?? ((input.dias_trabalho ?? 6) <= 5 ? '5X2' : '6X1')
    const diasTrabalho = regime === '5X2' ? 5 : 6
    await execute(`
      UPDATE tipos_contrato SET nome = ?, horas_semanais = ?, regime_escala = ?, dias_trabalho = ?,
      max_minutos_dia = ? WHERE id = ?
    `, input.nome, input.horas_semanais, regime, diasTrabalho, input.max_minutos_dia, input.id)

    return await queryOne('SELECT * FROM tipos_contrato WHERE id = ?', input.id)
  })

const tiposContratoDeletar = t.procedure
  .input<{ id: number }>()
  .action(async ({ input }) => {
    const count = await queryOne<{ count: number }>('SELECT COUNT(*)::int as count FROM colaboradores WHERE tipo_contrato_id = ?', input.id)
    if (count && count.count > 0) {
      throw new Error(`${count.count} colaboradores usam este contrato. Mova-os antes de deletar.`)
    }
    await execute('DELETE FROM tipos_contrato WHERE id = ?', input.id)
    return undefined
  })

// =============================================================================
// TIPOS CONTRATO — PERFIS DE HORÁRIO (4 handlers)
// =============================================================================

const tiposContratoListarPerfisHorario = t.procedure
  .input<{ tipo_contrato_id: number }>()
  .action(async ({ input }) => {
    return await queryAll('SELECT * FROM contrato_perfis_horario WHERE tipo_contrato_id = ? ORDER BY ordem, id', input.tipo_contrato_id)
  })

const tiposContratoCriarPerfilHorario = t.procedure
  .input<{
    tipo_contrato_id: number
    nome: string
    inicio?: string | null
    fim?: string | null
    preferencia_turno_soft?: string | null
    ordem?: number
    horas_semanais?: number | null
    max_minutos_dia?: number | null
  }>()
  .action(async ({ input }) => {
    const id = await insertReturningId(`
      INSERT INTO contrato_perfis_horario (tipo_contrato_id, nome, inicio, fim, preferencia_turno_soft, ordem, horas_semanais, max_minutos_dia)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
      input.tipo_contrato_id, input.nome,
      input.inicio ?? null, input.fim ?? null,
      input.preferencia_turno_soft ?? null, input.ordem ?? 0,
      input.horas_semanais ?? null, input.max_minutos_dia ?? null
    )
    return await queryOne('SELECT * FROM contrato_perfis_horario WHERE id = ?', id)
  })

const tiposContratoAtualizarPerfilHorario = t.procedure
  .input<{
    id: number
    nome?: string
    ativo?: boolean
    inicio?: string | null
    fim?: string | null
    preferencia_turno_soft?: string | null
    ordem?: number
    horas_semanais?: number | null
    max_minutos_dia?: number | null
  }>()
  .action(async ({ input }) => {
    const { id, ...rest } = input
    const fields: string[] = []
    const values: unknown[] = []
    if (rest.nome !== undefined) { fields.push('nome = ?'); values.push(rest.nome) }
    if (rest.ativo !== undefined) { fields.push('ativo = ?'); values.push(rest.ativo) }
    if ('inicio' in rest) { fields.push('inicio = ?'); values.push(rest.inicio ?? null) }
    if ('fim' in rest) { fields.push('fim = ?'); values.push(rest.fim ?? null) }
    if ('preferencia_turno_soft' in rest) { fields.push('preferencia_turno_soft = ?'); values.push(rest.preferencia_turno_soft ?? null) }
    if (rest.ordem !== undefined) { fields.push('ordem = ?'); values.push(rest.ordem) }
    if ('horas_semanais' in rest) { fields.push('horas_semanais = ?'); values.push(rest.horas_semanais ?? null) }
    if ('max_minutos_dia' in rest) { fields.push('max_minutos_dia = ?'); values.push(rest.max_minutos_dia ?? null) }
    if (fields.length > 0) {
      values.push(id)
      await execute(`UPDATE contrato_perfis_horario SET ${fields.join(', ')} WHERE id = ?`, ...values)
    }
    return await queryOne('SELECT * FROM contrato_perfis_horario WHERE id = ?', id)
  })

const tiposContratoDeletarPerfilHorario = t.procedure
  .input<{ id: number }>()
  .action(async ({ input }) => {
    await execute('DELETE FROM contrato_perfis_horario WHERE id = ?', input.id)
    return undefined
  })

// =============================================================================
// SETORES (5 handlers) + DEMANDAS (4 handlers) + RANK (1 handler)
// =============================================================================

const setoresListar = t.procedure
  .input<{ ativo?: boolean }>()
  .action(async ({ input }) => {
    let sql = 'SELECT * FROM setores'
    const params: unknown[] = []

    if (input?.ativo !== undefined) {
      sql += ' WHERE ativo = ?'
      params.push(input.ativo)
    }
    sql += ' ORDER BY nome'

    return await queryAll(sql, ...params)
  })

const setoresBuscar = t.procedure
  .input<{ id: number }>()
  .action(async ({ input }) => {
    const setor = await queryOne('SELECT * FROM setores WHERE id = ?', input.id)
    if (!setor) throw new Error('Setor nao encontrado')
    return setor
  })

const setoresCriar = t.procedure
  .input<{ nome: string; hora_abertura: string; hora_fechamento: string; icone?: string | null }>()
  .action(async ({ input }) => {
    const id = await insertReturningId(`
      INSERT INTO setores (nome, icone, hora_abertura, hora_fechamento)
      VALUES (?, ?, ?, ?)
    `, input.nome, input.icone ?? null, input.hora_abertura, input.hora_fechamento)

    return await queryOne('SELECT * FROM setores WHERE id = ?', id)
  })

const setoresAtualizar = t.procedure
  .input<{ id: number; nome?: string; icone?: string | null; hora_abertura?: string; hora_fechamento?: string; ativo?: boolean }>()
  .action(async ({ input }) => {
    const fields: string[] = []
    const values: unknown[] = []

    if (input.nome !== undefined) { fields.push('nome = ?'); values.push(input.nome) }
    if (input.icone !== undefined) { fields.push('icone = ?'); values.push(input.icone) }
    if (input.hora_abertura !== undefined) { fields.push('hora_abertura = ?'); values.push(input.hora_abertura) }
    if (input.hora_fechamento !== undefined) { fields.push('hora_fechamento = ?'); values.push(input.hora_fechamento) }
    if (input.ativo !== undefined) { fields.push('ativo = ?'); values.push(input.ativo) }

    if (fields.length > 0) {
      values.push(input.id)
      await execute(`UPDATE setores SET ${fields.join(', ')} WHERE id = ?`, ...values)
    }

    return await queryOne('SELECT * FROM setores WHERE id = ?', input.id)
  })

const setoresDeletar = t.procedure
  .input<{ id: number }>()
  .action(async ({ input }) => {
    await execute('DELETE FROM setores WHERE id = ?', input.id)
    return undefined
  })

// --- Demandas ---

const setoresListarDemandas = t.procedure
  .input<{ setor_id: number }>()
  .action(async ({ input }) => {
    return await queryAll(`
      SELECT * FROM demandas
      WHERE setor_id = ?
      ORDER BY CASE dia_semana
        WHEN 'SEG' THEN 1
        WHEN 'TER' THEN 2
        WHEN 'QUA' THEN 3
        WHEN 'QUI' THEN 4
        WHEN 'SEX' THEN 5
        WHEN 'SAB' THEN 6
        WHEN 'DOM' THEN 7
        ELSE 8
      END, hora_inicio, hora_fim, id
    `, input.setor_id)
  })

const setoresCriarDemanda = t.procedure
  .input<{ setor_id: number; dia_semana?: string | null; hora_inicio: string; hora_fim: string; min_pessoas: number; override?: boolean }>()
  .action(async ({ input }) => {
    const setor = await queryOne<{ hora_abertura: string; hora_fechamento: string }>('SELECT * FROM setores WHERE id = ?', input.setor_id)
    if (!setor) throw new Error('Setor nao encontrado')

    if (!Number.isInteger(input.min_pessoas) || input.min_pessoas < 1) {
      throw new Error('min_pessoas deve ser inteiro >= 1')
    }

    const horarioDia = input.dia_semana
      ? await queryOne<{ ativo: boolean; hora_abertura: string; hora_fechamento: string }>(`
          SELECT ativo, hora_abertura, hora_fechamento
          FROM setor_horario_semana
          WHERE setor_id = ? AND dia_semana = ?
        `, input.setor_id, input.dia_semana)
      : undefined

    if (horarioDia && !horarioDia.ativo) {
      throw new Error(`Dia ${input.dia_semana} esta inativo no horario semanal do setor`)
    }

    const abertura = horarioDia?.hora_abertura ?? setor.hora_abertura
    const fechamento = horarioDia?.hora_fechamento ?? setor.hora_fechamento

    if (input.hora_inicio < abertura) {
      throw new Error(`Faixa inicia antes da abertura do setor (${abertura})`)
    }
    if (input.hora_fim > fechamento) {
      throw new Error(`Faixa termina depois do fechamento do setor (${fechamento})`)
    }

    const id = await insertReturningId(`
      INSERT INTO demandas (setor_id, dia_semana, hora_inicio, hora_fim, min_pessoas, override)
      VALUES (?, ?, ?, ?, ?, ?)
    `, input.setor_id, input.dia_semana ?? null, input.hora_inicio, input.hora_fim, input.min_pessoas, input.override ?? false)

    return await queryOne('SELECT * FROM demandas WHERE id = ?', id)
  })

const setoresAtualizarDemanda = t.procedure
  .input<{ id: number; dia_semana?: string | null; hora_inicio?: string; hora_fim?: string; min_pessoas?: number; override?: boolean }>()
  .action(async ({ input }) => {
    const demanda = await queryOne<{ setor_id: number; dia_semana: string | null; hora_inicio: string; hora_fim: string }>('SELECT * FROM demandas WHERE id = ?', input.id)
    if (!demanda) throw new Error('Demanda nao encontrada')

    const setor = await queryOne<{ hora_abertura: string; hora_fechamento: string }>('SELECT * FROM setores WHERE id = ?', demanda.setor_id)
    if (!setor) throw new Error('Setor nao encontrado')
    const diaSemAtual = input.dia_semana !== undefined ? input.dia_semana : demanda.dia_semana
    const horarioDia = diaSemAtual
      ? await queryOne<{ ativo: boolean; hora_abertura: string; hora_fechamento: string }>(`
          SELECT ativo, hora_abertura, hora_fechamento
          FROM setor_horario_semana
          WHERE setor_id = ? AND dia_semana = ?
        `, demanda.setor_id, diaSemAtual)
      : undefined

    if (horarioDia && !horarioDia.ativo) {
      throw new Error(`Dia ${diaSemAtual} esta inativo no horario semanal do setor`)
    }

    const abertura = horarioDia?.hora_abertura ?? setor.hora_abertura
    const fechamento = horarioDia?.hora_fechamento ?? setor.hora_fechamento

    const horaInicio = input.hora_inicio ?? demanda.hora_inicio
    const horaFim = input.hora_fim ?? demanda.hora_fim

    if (horaInicio < abertura) {
      throw new Error(`Faixa inicia antes da abertura do setor (${abertura})`)
    }
    if (horaFim > fechamento) {
      throw new Error(`Faixa termina depois do fechamento do setor (${fechamento})`)
    }
    if (input.min_pessoas !== undefined && (!Number.isInteger(input.min_pessoas) || input.min_pessoas < 1)) {
      throw new Error('min_pessoas deve ser inteiro >= 1')
    }

    const fields: string[] = []
    const values: unknown[] = []
    if (input.dia_semana !== undefined) { fields.push('dia_semana = ?'); values.push(input.dia_semana) }
    if (input.hora_inicio != null) { fields.push('hora_inicio = ?'); values.push(input.hora_inicio) }
    if (input.hora_fim != null) { fields.push('hora_fim = ?'); values.push(input.hora_fim) }
    if (input.min_pessoas != null) { fields.push('min_pessoas = ?'); values.push(input.min_pessoas) }
    if (input.override !== undefined) { fields.push('override = ?'); values.push(input.override) }

    if (fields.length > 0) {
      values.push(input.id)
      await execute(`UPDATE demandas SET ${fields.join(', ')} WHERE id = ?`, ...values)
    }

    return await queryOne('SELECT * FROM demandas WHERE id = ?', input.id)
  })

const setoresDeletarDemanda = t.procedure
  .input<{ id: number }>()
  .action(async ({ input }) => {
    await execute('DELETE FROM demandas WHERE id = ?', input.id)
    return undefined
  })

// --- Rank ---

const setoresReordenarRank = t.procedure
  .input<{ setor_id: number; colaborador_ids: number[] }>()
  .action(async ({ input }) => {
    await transaction(async () => {
      for (let i = 0; i < input.colaborador_ids.length; i++) {
        await execute('UPDATE colaboradores SET rank = ? WHERE id = ? AND setor_id = ?',
          input.colaborador_ids.length - i, input.colaborador_ids[i], input.setor_id)
      }
    })

    return undefined
  })

// =============================================================================
// COLABORADORES (5 handlers)
// =============================================================================

const colaboradoresListar = t.procedure
  .input<{ setor_id?: number; ativo?: boolean }>()
  .action(async ({ input }) => {
    let sql = 'SELECT * FROM colaboradores WHERE 1=1'
    const params: unknown[] = []

    if (input?.setor_id !== undefined) {
      sql += ' AND setor_id = ?'
      params.push(input.setor_id)
    }
    if (input?.ativo !== undefined) {
      sql += ' AND ativo = ?'
      params.push(input.ativo)
    }
    sql += ' ORDER BY rank DESC, nome'

    return await queryAll(sql, ...params)
  })

const colaboradoresBuscar = t.procedure
  .input<{ id: number }>()
  .action(async ({ input }) => {
    const colab = await queryOne('SELECT * FROM colaboradores WHERE id = ?', input.id)
    if (!colab) throw new Error('Colaborador nao encontrado')
    return colab
  })

const colaboradoresCriar = t.procedure
  .input<{ setor_id: number; tipo_contrato_id: number; nome: string; sexo: string; horas_semanais?: number; rank?: number; prefere_turno?: string | null; evitar_dia_semana?: string | null; tipo_trabalhador?: string; funcao_id?: number | null }>()
  .action(async ({ input }) => {
    let horasSemanais = input.horas_semanais
    if (horasSemanais === undefined) {
      const tipo = await queryOne<{ horas_semanais: number }>('SELECT horas_semanais FROM tipos_contrato WHERE id = ?', input.tipo_contrato_id)
      if (!tipo) throw new Error('Tipo de contrato nao encontrado')
      horasSemanais = tipo.horas_semanais
    }

    const id = await insertReturningId(`
      INSERT INTO colaboradores (setor_id, tipo_contrato_id, nome, sexo, horas_semanais, rank, prefere_turno, evitar_dia_semana, tipo_trabalhador, funcao_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      input.setor_id,
      input.tipo_contrato_id,
      input.nome,
      input.sexo,
      horasSemanais,
      input.rank ?? 0,
      input.prefere_turno ?? null,
      input.evitar_dia_semana ?? null,
      input.tipo_trabalhador ?? 'CLT',
      input.funcao_id ?? null
    )

    return await queryOne('SELECT * FROM colaboradores WHERE id = ?', id)
  })

const colaboradoresAtualizar = t.procedure
  .input<{ id: number; setor_id?: number; tipo_contrato_id?: number; nome?: string; sexo?: string; horas_semanais?: number; rank?: number; prefere_turno?: string | null; evitar_dia_semana?: string | null; ativo?: boolean; tipo_trabalhador?: string; funcao_id?: number | null }>()
  .action(async ({ input }) => {
    // Validacao: se mudar de setor, nao pode ter escala RASCUNHO aberta
    if (input.setor_id !== undefined) {
      const atual = await queryOne<{ setor_id: number }>('SELECT setor_id FROM colaboradores WHERE id = ?', input.id)
      if (atual && input.setor_id !== atual.setor_id) {
        const rascunho = await queryOne<{ count: number }>(`
          SELECT COUNT(*)::int as count FROM escalas e
          JOIN alocacoes a ON a.escala_id = e.id
          WHERE a.colaborador_id = ? AND e.status = 'RASCUNHO'
        `, input.id)
        if (rascunho && rascunho.count > 0) {
          throw new Error('Colaborador tem escala em rascunho no setor atual. Descarte antes de mover.')
        }
      }
    }

    const fields: string[] = []
    const values: unknown[] = []

    if (input.setor_id !== undefined) { fields.push('setor_id = ?'); values.push(input.setor_id) }
    if (input.tipo_contrato_id !== undefined) { fields.push('tipo_contrato_id = ?'); values.push(input.tipo_contrato_id) }
    if (input.nome !== undefined) { fields.push('nome = ?'); values.push(input.nome) }
    if (input.sexo !== undefined) { fields.push('sexo = ?'); values.push(input.sexo) }
    if (input.horas_semanais !== undefined) { fields.push('horas_semanais = ?'); values.push(input.horas_semanais) }
    if (input.rank !== undefined) { fields.push('rank = ?'); values.push(input.rank) }
    if (input.prefere_turno !== undefined) { fields.push('prefere_turno = ?'); values.push(input.prefere_turno) }
    if (input.evitar_dia_semana !== undefined) { fields.push('evitar_dia_semana = ?'); values.push(input.evitar_dia_semana) }
    if (input.ativo !== undefined) { fields.push('ativo = ?'); values.push(input.ativo) }
    if (input.tipo_trabalhador !== undefined) { fields.push('tipo_trabalhador = ?'); values.push(input.tipo_trabalhador) }
    if (input.funcao_id !== undefined) { fields.push('funcao_id = ?'); values.push(input.funcao_id) }

    if (fields.length > 0) {
      values.push(input.id)
      await execute(`UPDATE colaboradores SET ${fields.join(', ')} WHERE id = ?`, ...values)
    }

    return await queryOne('SELECT * FROM colaboradores WHERE id = ?', input.id)
  })

const colaboradoresDeletar = t.procedure
  .input<{ id: number }>()
  .action(async ({ input }) => {
    await execute('DELETE FROM colaboradores WHERE id = ?', input.id)
    return undefined
  })

// =============================================================================
// EXCECOES (5 handlers)
// =============================================================================

const excecoesListar = t.procedure
  .input<{ colaborador_id: number }>()
  .action(async ({ input }) => {
    return await queryAll('SELECT * FROM excecoes WHERE colaborador_id = ? ORDER BY data_inicio', input.colaborador_id)
  })

const excecoesListarAtivas = t.procedure
  .input<Record<string, never>>()
  .action(async () => {
    const hoje = new Date().toISOString().split('T')[0]
    return await queryAll('SELECT * FROM excecoes WHERE data_inicio <= ? AND data_fim >= ? ORDER BY tipo, data_inicio', hoje, hoje)
  })

const excecoesCriar = t.procedure
  .input<{ colaborador_id: number; data_inicio: string; data_fim: string; tipo: string; observacao?: string | null }>()
  .action(async ({ input }) => {
    const id = await insertReturningId(`
      INSERT INTO excecoes (colaborador_id, data_inicio, data_fim, tipo, observacao)
      VALUES (?, ?, ?, ?, ?)
    `, input.colaborador_id, input.data_inicio, input.data_fim, input.tipo, input.observacao ?? null)

    return await queryOne('SELECT * FROM excecoes WHERE id = ?', id)
  })

const excecoesAtualizar = t.procedure
  .input<{ id: number; data_inicio: string; data_fim: string; tipo: string; observacao?: string | null }>()
  .action(async ({ input }) => {
    await execute(`
      UPDATE excecoes SET data_inicio = ?, data_fim = ?, tipo = ?, observacao = ? WHERE id = ?
    `, input.data_inicio, input.data_fim, input.tipo, input.observacao ?? null, input.id)

    return await queryOne('SELECT * FROM excecoes WHERE id = ?', input.id)
  })

const excecoesDeletar = t.procedure
  .input<{ id: number }>()
  .action(async ({ input }) => {
    await execute('DELETE FROM excecoes WHERE id = ?', input.id)
    return undefined
  })

// =============================================================================
// ESCALAS (6 handlers)
// =============================================================================

const escalasBuscar = t.procedure
  .input<{ id: number }>()
  .action(async ({ input }): Promise<EscalaCompletaV3> => {
    const escala = await queryOne<Escala>('SELECT * FROM escalas WHERE id = ?', input.id)
    if (!escala) throw new Error('Escala nao encontrada')

    const alocacoes = await queryAll<Alocacao>('SELECT * FROM alocacoes WHERE escala_id = ? ORDER BY data, colaborador_id', input.id)

    const snapshotDecisoes = await queryAll<{
      colaborador_id: number
      colaborador_nome: string
      data: string
      acao: 'ALOCADO' | 'FOLGA' | 'MOVIDO' | 'REMOVIDO'
      razao: string
      alternativas_tentadas: number
    }>(`
      SELECT ed.*,
             COALESCE(c.nome, 'Sistema') as colaborador_nome
      FROM escala_decisoes ed
      LEFT JOIN colaboradores c ON c.id = ed.colaborador_id
      WHERE ed.escala_id = ?
      ORDER BY ed.data, ed.colaborador_id, ed.id
    `, input.id)

    const snapshotComparacao = await queryAll<{
      data: string
      hora_inicio: string
      hora_fim: string
      planejado: number
      executado: number
      delta: number
      override: number | boolean
      justificativa: string | null
    }>(`
      SELECT data, hora_inicio, hora_fim, planejado, executado, delta, override, justificativa
      FROM escala_comparacao_demanda
      WHERE escala_id = ?
      ORDER BY data, hora_inicio, hora_fim, id
    `, input.id)

    const base = await validarEscalaV3(input.id)
    const hasSnapshot = snapshotDecisoes.length > 0 || snapshotComparacao.length > 0
    if (!hasSnapshot) return base

    return {
      ...base,
      escala,
      alocacoes,
      decisoes: snapshotDecisoes.map((d) => ({
        colaborador_id: d.colaborador_id,
        colaborador_nome: d.colaborador_nome,
        data: d.data,
        acao: d.acao,
        razao: d.razao,
        alternativas_tentadas: d.alternativas_tentadas ?? 0,
      })),
      comparacao_demanda: snapshotComparacao.map((c) => ({
        data: c.data,
        hora_inicio: c.hora_inicio,
        hora_fim: c.hora_fim,
        planejado: c.planejado,
        executado: c.executado,
        delta: c.delta,
        override: Boolean(c.override),
        justificativa: c.justificativa ?? undefined,
      })),
    }
  })

const escalasResumoPorSetor = t.procedure
  .action(async () => {
    return await queryAll<{ setor_id: number; data_inicio: string; data_fim: string; status: string }>(`
      SELECT e.setor_id, e.data_inicio, e.data_fim, e.status
      FROM escalas e
      INNER JOIN (
        SELECT setor_id, MAX(
          CASE status WHEN 'OFICIAL' THEN 2 WHEN 'RASCUNHO' THEN 1 ELSE 0 END * 1000000 + id
        ) as prio
        FROM escalas
        WHERE status IN ('RASCUNHO', 'OFICIAL')
        GROUP BY setor_id
      ) latest ON e.setor_id = latest.setor_id
        AND (CASE e.status WHEN 'OFICIAL' THEN 2 WHEN 'RASCUNHO' THEN 1 ELSE 0 END * 1000000 + e.id) = latest.prio
    `)
  })

const escalasListarPorSetor = t.procedure
  .input<{ setor_id: number; status?: string }>()
  .action(async ({ input }) => {
    let sql = 'SELECT * FROM escalas WHERE setor_id = ?'
    const params: unknown[] = [input.setor_id]

    if (input.status) {
      sql += ' AND status = ?'
      params.push(input.status)
    }
    sql += ' ORDER BY data_inicio DESC'

    return await queryAll(sql, ...params)
  })

const escalasPreflight = t.procedure
  .input<{
    setor_id: number
    data_inicio: string
    data_fim: string
    regimes_override?: SimulacaoRegimeOverride[]
  }>()
  .action(async ({ input }): Promise<EscalaPreflightResult> => {
    return await buildEscalaPreflight(
      input.setor_id,
      input.data_inicio,
      input.data_fim,
      normalizeRegimesOverride(input.regimes_override),
    )
  })

const escalasOficializar = t.procedure
  .input<{ id: number }>()
  .action(async ({ input }) => {
    const escala = await queryOne<{
      setor_id: number
      status: string
      data_inicio: string
      data_fim: string
      input_hash?: string | null
      simulacao_config_json?: string | null
    }>('SELECT * FROM escalas WHERE id = ?', input.id)
    if (!escala) throw new Error('Escala nao encontrada')

    if (escala.input_hash) {
      const cfg = parseEscalaSimulacaoConfig(escala.simulacao_config_json ?? null)
      const currentInput = await buildSolverInput(escala.setor_id, escala.data_inicio, escala.data_fim, undefined, {
        regimesOverride: cfg.regimes_override,
      })
      const currentHash = computeSolverScenarioHash(currentInput)
      if (currentHash !== escala.input_hash) {
        throw new Error(
          'ESCALA_DESATUALIZADA: Houve mudancas no cenario (demanda/contratos/excecoes). Gere novamente a simulacao antes de oficializar.',
        )
      }
    }

    const { indicadores } = await validarEscalaV3(input.id)

    if (indicadores.violacoes_hard > 0) {
      throw new Error(`Escala tem ${indicadores.violacoes_hard} violacoes criticas. Corrija antes de oficializar.`)
    }

    // Arquivar oficial anterior do mesmo setor
    await execute(`
      UPDATE escalas SET status = 'ARQUIVADA'
      WHERE setor_id = ? AND status = 'OFICIAL'
    `, escala.setor_id)

    // Oficializar esta
    await execute("UPDATE escalas SET status = 'OFICIAL' WHERE id = ?", input.id)

    return await queryOne('SELECT * FROM escalas WHERE id = ?', input.id)
  })

const escalasAjustar = t.procedure
  .input<{ id: number; alocacoes: { colaborador_id: number; data: string; status: 'TRABALHO' | 'FOLGA' | 'INDISPONIVEL'; hora_inicio?: string | null; hora_fim?: string | null }[] }>()
  .action(async ({ input }): Promise<EscalaCompletaV3> => {
    const escalaId = input.id

    const escala = await queryOne<{
      setor_id: number
      data_inicio: string
      data_fim: string
      status: string
      simulacao_config_json?: string | null
    }>('SELECT * FROM escalas WHERE id = ?', escalaId)
    if (!escala) throw new Error('Escala nao encontrada')
    if (escala.status !== 'RASCUNHO') {
      throw new Error('So e possivel ajustar escalas em rascunho')
    }
    if (!input.alocacoes || input.alocacoes.length === 0) {
      throw new Error('Nenhuma alocacao fornecida para ajuste')
    }

    // Converter alocacoes do usuario em PinnedCell[] para o solver
    const pinnedCells: PinnedCell[] = input.alocacoes.map(a => ({
      colaborador_id: a.colaborador_id,
      data: a.data,
      status: a.status,
      hora_inicio: a.hora_inicio ?? undefined,
      hora_fim: a.hora_fim ?? undefined,
    }))

    // Build input e chamar solver Python
    const cfg = parseEscalaSimulacaoConfig(escala.simulacao_config_json ?? null)
    const solverInput = await buildSolverInput(
      escala.setor_id,
      escala.data_inicio,
      escala.data_fim,
      pinnedCells,
      {
        regimesOverride: cfg.regimes_override,
        hintsEscalaId: escalaId,
      },
    )
    const inputHash = computeSolverScenarioHash(solverInput)
    const solverResult = await runSolver(solverInput)

    if (!solverResult.sucesso || !solverResult.alocacoes || !solverResult.indicadores) {
      if (solverResult.status === 'INFEASIBLE') {
        const diag = await buildEscalaPreflight(
          escala.setor_id,
          escala.data_inicio,
          escala.data_fim,
          cfg.regimes_override,
        )
        const blocker = diag.blockers[0]
        if (blocker) {
          throw new Error(`INFEASIBLE: ${blocker.mensagem}${blocker.detalhe ? ` (${blocker.detalhe})` : ''}`)
        }
      }
      throw new Error(solverResult.erro?.mensagem ?? 'Erro ao gerar escala via solver')
    }

    const ind = solverResult.indicadores
    const decisoes = solverResult.decisoes ?? []
    const comparacao = solverResult.comparacao_demanda ?? []

    // Persistir resultado do solver (substituir alocacoes + decisoes + comparacao)
    await transaction(async () => {
      await execute('DELETE FROM alocacoes WHERE escala_id = ?', escalaId)
      await execute('DELETE FROM escala_decisoes WHERE escala_id = ?', escalaId)
      await execute('DELETE FROM escala_comparacao_demanda WHERE escala_id = ?', escalaId)

      for (const a of solverResult.alocacoes!) {
        await execute(`
          INSERT INTO alocacoes
            (escala_id, colaborador_id, data, status, hora_inicio, hora_fim,
             minutos, minutos_trabalho, hora_almoco_inicio, hora_almoco_fim,
             minutos_almoco, intervalo_15min, funcao_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
          escalaId, a.colaborador_id, a.data, a.status,
          a.hora_inicio ?? null, a.hora_fim ?? null,
          a.minutos_trabalho ?? null, a.minutos_trabalho ?? null,
          a.hora_almoco_inicio ?? null, a.hora_almoco_fim ?? null,
          a.minutos_almoco ?? null,
          a.intervalo_15min ?? false,
          a.funcao_id ?? null
        )
      }

      for (const d of decisoes) {
        await execute(`
          INSERT INTO escala_decisoes (escala_id, colaborador_id, data, acao, razao, alternativas_tentadas)
          VALUES (?, ?, ?, ?, ?, ?)
        `, escalaId, d.colaborador_id, d.data, d.acao, d.razao, d.alternativas_tentadas)
      }

      for (const c of comparacao) {
        await execute(`
          INSERT INTO escala_comparacao_demanda (escala_id, data, hora_inicio, hora_fim, planejado, executado, delta, override, justificativa)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, escalaId, c.data, c.hora_inicio, c.hora_fim, c.planejado, c.executado, c.delta, c.override ?? false, c.justificativa ?? null)
      }

      await execute(`
        UPDATE escalas
        SET pontuacao = ?, cobertura_percent = ?, violacoes_hard = ?, violacoes_soft = ?, equilibrio = ?, input_hash = ?, simulacao_config_json = ?
        WHERE id = ?
      `,
        ind.pontuacao,
        ind.cobertura_percent,
        ind.violacoes_hard,
        ind.violacoes_soft,
        ind.equilibrio,
        inputHash,
        JSON.stringify({ regimes_override: cfg.regimes_override ?? [] } satisfies EscalaSimulacaoConfig),
        escalaId,
      )
    })

    const escalaAtual = await queryOne<Escala>('SELECT * FROM escalas WHERE id = ?', escalaId)
    const alocacoesDB = await queryAll<Alocacao>('SELECT * FROM alocacoes WHERE escala_id = ? ORDER BY data, colaborador_id', escalaId)

    return {
      escala: escalaAtual!,
      alocacoes: alocacoesDB,
      indicadores: ind,
      violacoes: [],
      antipatterns: [],
      decisoes,
      comparacao_demanda: comparacao,
      diagnostico: solverResult.diagnostico,
      timing: {
        fase0_ms: 0, fase1_ms: 0, fase2_ms: 0, fase3_ms: 0,
        fase4_ms: 0, fase5_ms: 0, fase6_ms: 0, fase7_ms: 0,
        total_ms: solverResult.solve_time_ms,
      },
    }
  })

const escalasDeletar = t.procedure
  .input<{ id: number }>()
  .action(async ({ input }) => {
    await execute('DELETE FROM escalas WHERE id = ?', input.id)
    return undefined
  })

// Gerar escala via Python OR-Tools solver
const escalasGerar = t.procedure
  .input<{
    setor_id: number
    data_inicio: string
    data_fim: string
    regimes_override?: SimulacaoRegimeOverride[]
    solve_mode?: 'rapido' | 'otimizado'
    max_time_seconds?: number
    rules_override?: Record<string, string>
  }>()
  .action(async ({ input }): Promise<EscalaCompletaV3> => {
    const setorId = input.setor_id
    const regimesOverride = normalizeRegimesOverride(input.regimes_override)

    // Preflight antes de chamar solver
    const preflight = await buildEscalaPreflight(setorId, input.data_inicio, input.data_fim, regimesOverride)
    if (!preflight.ok) {
      const msg = preflight.blockers[0]?.mensagem ?? 'Preflight falhou'
      throw new Error(msg)
    }

    // Send solver logs to renderer for progress UI
    const sendLog = (line: string) => {
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send('solver-log', line)
      }
    }

    sendLog('Montando modelo...')

    // Build input e chamar solver Python (agora com solveMode + rulesOverride)
    const solverInput = await buildSolverInput(setorId, input.data_inicio, input.data_fim, undefined, {
      regimesOverride,
      solveMode: input.solve_mode,
      maxTimeSeconds: input.max_time_seconds,
      rulesOverride: input.rules_override as Record<string, string> | undefined,
    })
    const inputHash = computeSolverScenarioHash(solverInput)
    const solverResult = await runSolver(solverInput, undefined, sendLog)

    if (!solverResult.sucesso || !solverResult.alocacoes || !solverResult.indicadores) {
      if (solverResult.status === 'INFEASIBLE') {
        const diag = await buildEscalaPreflight(setorId, input.data_inicio, input.data_fim, regimesOverride)
        const blocker = diag.blockers[0]
        if (blocker) {
          throw new Error(`INFEASIBLE: ${blocker.mensagem}${blocker.detalhe ? ` (${blocker.detalhe})` : ''}`)
        }
      }
      throw new Error(solverResult.erro?.mensagem ?? 'Erro ao gerar escala via solver')
    }

    const ind = solverResult.indicadores
    const decisoes = solverResult.decisoes ?? []
    const comparacao = solverResult.comparacao_demanda ?? []

    // Persist escala + alocacoes + decisoes + comparacao em transaction
    const escalaId = await transaction(async () => {
      const newId = await insertReturningId(`
        INSERT INTO escalas
          (setor_id, data_inicio, data_fim, status, pontuacao,
           cobertura_percent, violacoes_hard, violacoes_soft, equilibrio, input_hash, simulacao_config_json)
        VALUES (?, ?, ?, 'RASCUNHO', ?, ?, ?, ?, ?, ?, ?)
      `,
        setorId, input.data_inicio, input.data_fim,
        ind.pontuacao, ind.cobertura_percent, ind.violacoes_hard, ind.violacoes_soft, ind.equilibrio,
        inputHash,
        JSON.stringify({ regimes_override: regimesOverride } satisfies EscalaSimulacaoConfig),
      )

      for (const a of solverResult.alocacoes!) {
        await execute(`
          INSERT INTO alocacoes
            (escala_id, colaborador_id, data, status, hora_inicio, hora_fim,
             minutos, minutos_trabalho, hora_almoco_inicio, hora_almoco_fim,
             minutos_almoco, intervalo_15min, funcao_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
          newId, a.colaborador_id, a.data, a.status,
          a.hora_inicio ?? null, a.hora_fim ?? null,
          a.minutos_trabalho ?? null, a.minutos_trabalho ?? null,
          a.hora_almoco_inicio ?? null, a.hora_almoco_fim ?? null,
          a.minutos_almoco ?? null,
          a.intervalo_15min ?? false,
          a.funcao_id ?? null
        )
      }

      for (const d of decisoes) {
        await execute(`
          INSERT INTO escala_decisoes (escala_id, colaborador_id, data, acao, razao, alternativas_tentadas)
          VALUES (?, ?, ?, ?, ?, ?)
        `, newId, d.colaborador_id, d.data, d.acao, d.razao, d.alternativas_tentadas)
      }

      for (const c of comparacao) {
        await execute(`
          INSERT INTO escala_comparacao_demanda (escala_id, data, hora_inicio, hora_fim, planejado, executado, delta, override, justificativa)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, newId, c.data, c.hora_inicio, c.hora_fim, c.planejado, c.executado, c.delta, c.override ?? false, c.justificativa ?? null)
      }

      return newId
    })

    const escalaAtual = await queryOne<Escala>('SELECT * FROM escalas WHERE id = ?', escalaId)
    const alocacoesDB = await queryAll<Alocacao>('SELECT * FROM alocacoes WHERE escala_id = ? ORDER BY data, colaborador_id', escalaId)

    return {
      escala: escalaAtual!,
      alocacoes: alocacoesDB,
      indicadores: ind,
      violacoes: [],
      antipatterns: [],
      decisoes,
      comparacao_demanda: comparacao,
      diagnostico: solverResult.diagnostico,
      timing: {
        fase0_ms: 0, fase1_ms: 0, fase2_ms: 0, fase3_ms: 0,
        fase4_ms: 0, fase5_ms: 0, fase6_ms: 0, fase7_ms: 0,
        total_ms: solverResult.solve_time_ms,
      },
    }
  })

// =============================================================================
// DASHBOARD (1 handler)
// =============================================================================

const dashboardResumo = t.procedure
  .action(async (): Promise<DashboardResumo> => {
    const totalSetoresRow = await queryOne<{ count: number }>('SELECT COUNT(*)::int as count FROM setores WHERE ativo = TRUE')
    const totalSetores = totalSetoresRow?.count ?? 0
    const totalColaboradoresRow = await queryOne<{ count: number }>('SELECT COUNT(*)::int as count FROM colaboradores WHERE ativo = TRUE')
    const totalColaboradores = totalColaboradoresRow?.count ?? 0

    const hoje = new Date().toISOString().split('T')[0]
    const totalEmFeriasRow = await queryOne<{ count: number }>(`
      SELECT COUNT(DISTINCT colaborador_id) as count FROM excecoes
      WHERE tipo = 'FERIAS' AND data_inicio <= ? AND data_fim >= ?
    `, hoje, hoje)
    const totalEmFerias = totalEmFeriasRow?.count ?? 0

    const totalEmAtestadoRow = await queryOne<{ count: number }>(`
      SELECT COUNT(DISTINCT colaborador_id) as count FROM excecoes
      WHERE tipo = 'ATESTADO' AND data_inicio <= ? AND data_fim >= ?
    `, hoje, hoje)
    const totalEmAtestado = totalEmAtestadoRow?.count ?? 0

    const setoresDb = await queryAll<{ id: number; nome: string; icone?: string | null }>('SELECT * FROM setores WHERE ativo = TRUE ORDER BY nome')
    const setores: SetorResumo[] = []
    for (const s of setoresDb) {
      const totalColabRow = await queryOne<{ count: number }>('SELECT COUNT(*)::int as count FROM colaboradores WHERE setor_id = ? AND ativo = TRUE', s.id)
      const totalColab = totalColabRow?.count ?? 0
      const escalaAtual = await queryOne<{ status: string }>(`
        SELECT status FROM escalas WHERE setor_id = ? AND status IN ('RASCUNHO', 'OFICIAL')
        ORDER BY CASE status WHEN 'OFICIAL' THEN 1 WHEN 'RASCUNHO' THEN 2 END LIMIT 1
      `, s.id)

      setores.push({
        id: s.id,
        nome: s.nome,
        icone: s.icone ?? null,
        total_colaboradores: totalColab,
        escala_atual: (escalaAtual?.status ?? 'SEM_ESCALA') as SetorResumo['escala_atual'],
        proxima_geracao: null,
        violacoes_pendentes: 0,
      })
    }

    const alertas: AlertaDashboard[] = []
    for (const s of setores) {
      if (s.escala_atual === 'SEM_ESCALA') {
        alertas.push({
          tipo: 'SEM_ESCALA',
          setor_id: s.id,
          setor_nome: s.nome,
          mensagem: `${s.nome}: sem escala gerada`,
        })
      }
      if (s.total_colaboradores < 2) {
        alertas.push({
          tipo: 'POUCOS_COLABORADORES',
          setor_id: s.id,
          setor_nome: s.nome,
          mensagem: `${s.nome}: apenas ${s.total_colaboradores} colaborador(es)`,
        })
      }
    }

    return {
      total_setores: totalSetores,
      total_colaboradores: totalColaboradores,
      total_em_ferias: totalEmFerias,
      total_em_atestado: totalEmAtestado,
      setores,
      alertas,
    }
  })

// =============================================================================
// EXPORT (4 handlers)
// =============================================================================

const exportSalvarHTML = t.procedure
  .input<{ html: string; filename?: string }>()
  .action(async ({ input }): Promise<{ filepath: string } | null> => {
    const result = await dialog.showSaveDialog({
      defaultPath: input.filename || 'escala.html',
      filters: [{ name: 'HTML', extensions: ['html'] }],
    })

    if (result.canceled || !result.filePath) return null

    await writeFile(result.filePath, input.html, 'utf-8')
    return { filepath: result.filePath }
  })

const exportImprimirPDF = t.procedure
  .input<{ html: string; filename?: string }>()
  .action(async ({ input }): Promise<{ filepath: string } | null> => {
    const win = new BrowserWindow({
      show: false,
      width: 794,
      height: 1123,
      webPreferences: { offscreen: true },
    })

    try {
      await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(input.html)}`)

      const pdfBuffer = await win.webContents.printToPDF({
        pageSize: 'A4',
        printBackground: true,
        margins: { top: 0.4, bottom: 0.4, left: 0.4, right: 0.4 },
      })

      const result = await dialog.showSaveDialog({
        defaultPath: input.filename || 'escala.pdf',
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
      })

      if (result.canceled || !result.filePath) return null

      await writeFile(result.filePath, pdfBuffer)
      return { filepath: result.filePath }
    } finally {
      win.close()
    }
  })

const exportSalvarCSV = t.procedure
  .input<{ csv: string; filename?: string }>()
  .action(async ({ input }): Promise<{ filepath: string } | null> => {
    const result = await dialog.showSaveDialog({
      defaultPath: input.filename || 'escala.csv',
      filters: [{ name: 'CSV', extensions: ['csv'] }],
    })

    if (result.canceled || !result.filePath) return null

    // BOM prefix for UTF-8 so Excel opens with correct encoding
    await writeFile(result.filePath, '\uFEFF' + input.csv, 'utf-8')
    return { filepath: result.filePath }
  })

const exportBatchHTML = t.procedure
  .input<{ arquivos: { nome: string; html: string }[] }>()
  .action(async ({ input }): Promise<{ pasta: string; count: number } | null> => {
    if (!input.arquivos || input.arquivos.length === 0) {
      throw new Error('Nenhum arquivo fornecido para exportacao em lote')
    }

    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
    })

    if (result.canceled || !result.filePaths[0]) return null

    const pasta = result.filePaths[0]
    let count = 0

    for (const arq of input.arquivos) {
      const filename = arq.nome.endsWith('.html') ? arq.nome : `${arq.nome}.html`
      const filepath = path.join(pasta, filename)
      await writeFile(filepath, arq.html, 'utf-8')
      count++
    }

    return { pasta, count }
  })

// =============================================================================
// FUNCOES (5 handlers) — RFC §9 2.1
// =============================================================================

const funcoesListar = t.procedure
  .input<{ setor_id: number; ativo?: boolean }>()
  .action(async ({ input }) => {
    let sql = 'SELECT * FROM funcoes WHERE setor_id = ?'
    const params: unknown[] = [input.setor_id]
    if (input.ativo !== undefined) {
      sql += ' AND ativo = ?'
      params.push(input.ativo)
    }
    sql += ' ORDER BY ordem ASC, apelido'
    return await queryAll(sql, ...params)
  })

const funcoesBuscar = t.procedure
  .input<{ id: number }>()
  .action(async ({ input }) => {
    const funcao = await queryOne('SELECT * FROM funcoes WHERE id = ?', input.id)
    if (!funcao) throw new Error('Funcao nao encontrada')
    return funcao
  })

const funcoesCriar = t.procedure
  .input<{ setor_id: number; apelido: string; tipo_contrato_id: number; ordem?: number }>()
  .action(async ({ input }) => {
    const id = await insertReturningId(`
      INSERT INTO funcoes (setor_id, apelido, tipo_contrato_id, ordem)
      VALUES (?, ?, ?, ?)
    `, input.setor_id, input.apelido, input.tipo_contrato_id, input.ordem ?? 0)
    return await queryOne('SELECT * FROM funcoes WHERE id = ?', id)
  })

const funcoesAtualizar = t.procedure
  .input<{ id: number; apelido?: string; tipo_contrato_id?: number; ativo?: boolean; ordem?: number }>()
  .action(async ({ input }) => {
    const fields: string[] = []
    const values: unknown[] = []
    if (input.apelido !== undefined) { fields.push('apelido = ?'); values.push(input.apelido) }
    if (input.tipo_contrato_id !== undefined) { fields.push('tipo_contrato_id = ?'); values.push(input.tipo_contrato_id) }
    if (input.ativo !== undefined) { fields.push('ativo = ?'); values.push(input.ativo) }
    if (input.ordem !== undefined) { fields.push('ordem = ?'); values.push(input.ordem) }
    if (fields.length > 0) {
      values.push(input.id)
      await execute(`UPDATE funcoes SET ${fields.join(', ')} WHERE id = ?`, ...values)
    }
    return await queryOne('SELECT * FROM funcoes WHERE id = ?', input.id)
  })

const funcoesDeletar = t.procedure
  .input<{ id: number }>()
  .action(async ({ input }) => {
    // Desassociar colaboradores antes de deletar
    await execute('UPDATE colaboradores SET funcao_id = NULL WHERE funcao_id = ?', input.id)
    await execute('DELETE FROM funcoes WHERE id = ?', input.id)
    return undefined
  })

// =============================================================================
// FERIADOS (3 handlers) — RFC §9 2.2
// =============================================================================

const feriadosListar = t.procedure
  .input<{ ano?: number }>()
  .action(async ({ input }) => {
    if (input.ano !== undefined) {
      return await queryAll("SELECT * FROM feriados WHERE data LIKE ? ORDER BY data", `${input.ano}-%`)
    }
    return await queryAll('SELECT * FROM feriados ORDER BY data')
  })

const feriadosCriar = t.procedure
  .input<{ data: string; nome: string; tipo: string; proibido_trabalhar?: boolean; cct_autoriza?: boolean }>()
  .action(async ({ input }) => {
    const id = await insertReturningId(`
      INSERT INTO feriados (data, nome, tipo, proibido_trabalhar, cct_autoriza)
      VALUES (?, ?, ?, ?, ?)
    `,
      input.data,
      input.nome,
      input.tipo,
      input.proibido_trabalhar ?? false,
      input.cct_autoriza !== false
    )
    return await queryOne('SELECT * FROM feriados WHERE id = ?', id)
  })

const feriadosDeletar = t.procedure
  .input<{ id: number }>()
  .action(async ({ input }) => {
    await execute('DELETE FROM feriados WHERE id = ?', input.id)
    return undefined
  })

// =============================================================================
// SETOR HORARIO SEMANA (3 handlers) — RFC §9 2.3 + 2.4
// =============================================================================

const setoresListarHorarioSemana = t.procedure
  .input<{ setor_id: number }>()
  .action(async ({ input }) => {
    return await queryAll(`
      SELECT * FROM setor_horario_semana
      WHERE setor_id = ?
      ORDER BY CASE dia_semana
        WHEN 'SEG' THEN 1
        WHEN 'TER' THEN 2
        WHEN 'QUA' THEN 3
        WHEN 'QUI' THEN 4
        WHEN 'SEX' THEN 5
        WHEN 'SAB' THEN 6
        WHEN 'DOM' THEN 7
      END
    `, input.setor_id)
  })

const setoresUpsertHorarioSemana = t.procedure
  .input<{ setor_id: number; dia_semana: string; ativo: boolean; usa_padrao: boolean; hora_abertura: string; hora_fechamento: string }>()
  .action(async ({ input }) => {
    await execute(`
      INSERT INTO setor_horario_semana (setor_id, dia_semana, ativo, usa_padrao, hora_abertura, hora_fechamento)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(setor_id, dia_semana) DO UPDATE SET
        ativo = excluded.ativo,
        usa_padrao = excluded.usa_padrao,
        hora_abertura = excluded.hora_abertura,
        hora_fechamento = excluded.hora_fechamento
    `,
      input.setor_id,
      input.dia_semana,
      input.ativo,
      input.usa_padrao,
      input.hora_abertura,
      input.hora_fechamento
    )
    return await queryOne('SELECT * FROM setor_horario_semana WHERE setor_id = ? AND dia_semana = ?',
      input.setor_id, input.dia_semana)
  })

/** Salva horário do dia + segmentos de demanda de forma transacional (RFC §11.1) */
const setoresSalvarTimelineDia = t.procedure
  .input<{
    setor_id: number
    dia_semana: string
    ativo: boolean
    usa_padrao: boolean
    hora_abertura: string
    hora_fechamento: string
    segmentos: Array<{ hora_inicio: string; hora_fim: string; min_pessoas: number; override: boolean }>
  }>()
  .action(async ({ input }) => {
    const toMin = (hhmm: string): number => {
      const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm)
      if (!m) throw new Error(`Horario invalido: "${hhmm}"`)
      return Number(m[1]) * 60 + Number(m[2])
    }
    const toHHMM = (min: number): string => {
      const hh = Math.floor(min / 60)
      const mm = min % 60
      return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
    }

    const aberturaMin = toMin(input.hora_abertura)
    const fechamentoMin = toMin(input.hora_fechamento)
    if (aberturaMin >= fechamentoMin) {
      throw new Error('Horario invalido: abertura deve ser menor que fechamento')
    }
    if (aberturaMin % 30 !== 0 || fechamentoMin % 30 !== 0) {
      throw new Error('Horario de abertura/fechamento deve respeitar grid de 30min')
    }
    const duracaoJanela = fechamentoMin - aberturaMin
    if (duracaoJanela % 30 !== 0) {
      throw new Error('Janela diaria deve ser multipla de 30 minutos')
    }

    const setor = await queryOne<{ id: number }>('SELECT id FROM setores WHERE id = ?', input.setor_id)
    if (!setor) throw new Error('Setor nao encontrado')

    if (!input.ativo && input.segmentos.length > 0) {
      throw new Error('Dia inativo nao pode ter segmentos de demanda')
    }

    type SegmentoNormalizado = {
      hora_inicio: string
      hora_fim: string
      min_pessoas: number
      override: boolean
    }

    const parsedSegments = input.segmentos.map((seg, idx) => {
      const inicio = toMin(seg.hora_inicio)
      const fim = toMin(seg.hora_fim)

      if (!Number.isInteger(seg.min_pessoas) || seg.min_pessoas < 1) {
        throw new Error(`Segmento ${idx + 1}: min_pessoas invalido`)
      }
      if (inicio % 30 !== 0 || fim % 30 !== 0) {
        throw new Error(`Segmento ${idx + 1}: horarios devem respeitar grid de 30min`)
      }
      if (inicio >= fim) {
        throw new Error(`Segmento ${idx + 1}: hora_inicio deve ser menor que hora_fim`)
      }
      if (inicio < aberturaMin || fim > fechamentoMin) {
        throw new Error(`Segmento ${idx + 1}: fora da janela de abertura/fechamento`)
      }

      return {
        inicio,
        fim,
        min_pessoas: seg.min_pessoas,
        override: Boolean(seg.override),
      }
    })

    const slotsTotal = input.ativo ? Math.max(0, duracaoJanela / 30) : 0
    let slotsOverlapDetectados = 0
    let slotsPreenchidosComPiso = 0

    let normalizados: SegmentoNormalizado[] = []

    if (input.ativo) {
      const slotState = Array.from({ length: slotsTotal }, () => ({
        pessoas: 0,
        override: false,
        layers: 0,
      }))

      for (const seg of parsedSegments) {
        const startIdx = Math.floor((seg.inicio - aberturaMin) / 30)
        const endIdx = Math.floor((seg.fim - aberturaMin) / 30)

        for (let idx = startIdx; idx < endIdx; idx++) {
          const slot = slotState[idx]
          slot.pessoas += seg.min_pessoas
          slot.override = slot.override || seg.override
          slot.layers += 1
        }
      }

      for (const slot of slotState) {
        if (slot.layers > 1) slotsOverlapDetectados += 1
        if (slot.pessoas === 0) slotsPreenchidosComPiso += 1
      }

      if (slotState.length > 0) {
        let segStartIdx = 0
        let segPeople = slotState[0].pessoas
        let segOverride = slotState[0].override

        for (let idx = 1; idx < slotState.length; idx++) {
          const slot = slotState[idx]
          if (slot.pessoas === segPeople && slot.override === segOverride) continue

          normalizados.push({
            hora_inicio: toHHMM(aberturaMin + segStartIdx * 30),
            hora_fim: toHHMM(aberturaMin + idx * 30),
            min_pessoas: segPeople,
            override: segOverride,
          })
          segStartIdx = idx
          segPeople = slot.pessoas
          segOverride = slot.override
        }

        normalizados.push({
          hora_inicio: toHHMM(aberturaMin + segStartIdx * 30),
          hora_fim: toHHMM(fechamentoMin),
          min_pessoas: segPeople,
          override: segOverride,
        })
      }
    }

    await transaction(async () => {
      // 1. Upsert horario do dia
      await execute(`
        INSERT INTO setor_horario_semana (setor_id, dia_semana, ativo, usa_padrao, hora_abertura, hora_fechamento)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(setor_id, dia_semana) DO UPDATE SET
          ativo = excluded.ativo,
          usa_padrao = excluded.usa_padrao,
          hora_abertura = excluded.hora_abertura,
          hora_fechamento = excluded.hora_fechamento
      `,
        input.setor_id,
        input.dia_semana,
        input.ativo,
        input.usa_padrao,
        input.hora_abertura,
        input.hora_fechamento
      )

      // 2. Apagar demandas existentes para este setor + dia
      await execute('DELETE FROM demandas WHERE setor_id = ? AND dia_semana = ?',
        input.setor_id, input.dia_semana)

      // 3. Inserir novos segmentos
      for (const seg of normalizados) {
        await execute(`
          INSERT INTO demandas (setor_id, dia_semana, hora_inicio, hora_fim, min_pessoas, override)
          VALUES (?, ?, ?, ?, ?, ?)
        `,
          input.setor_id,
          input.dia_semana,
          seg.hora_inicio,
          seg.hora_fim,
          seg.min_pessoas,
          seg.override
        )
      }
    })

    return {
      horario: await queryOne('SELECT * FROM setor_horario_semana WHERE setor_id = ? AND dia_semana = ?',
        input.setor_id, input.dia_semana),
      demandas: await queryAll('SELECT * FROM demandas WHERE setor_id = ? AND dia_semana = ? ORDER BY hora_inicio',
        input.setor_id, input.dia_semana),
      normalizacao: {
        slots_total: slotsTotal,
        slots_overlap_detectados: slotsOverlapDetectados,
        slots_sem_demanda: slotsPreenchidosComPiso,
      },
    }
  })

// =============================================================================
// SETORES — DEMANDAS EXCECAO POR DATA (3 handlers)
// =============================================================================

const setoresListarDemandasExcecaoData = t.procedure
  .input<{ setor_id: number; data_inicio?: string; data_fim?: string }>()
  .action(async ({ input }) => {
    let sql = 'SELECT * FROM demandas_excecao_data WHERE setor_id = ?'
    const params: unknown[] = [input.setor_id]
    if (input.data_inicio) { sql += ' AND data >= ?'; params.push(input.data_inicio) }
    if (input.data_fim) { sql += ' AND data <= ?'; params.push(input.data_fim) }
    sql += ' ORDER BY data, hora_inicio'
    return await queryAll(sql, ...params)
  })

const setoresSalvarDemandaExcecaoData = t.procedure
  .input<{
    setor_id: number
    data: string
    hora_inicio: string
    hora_fim: string
    min_pessoas: number
    override?: boolean
  }>()
  .action(async ({ input }) => {
    const id = await insertReturningId(`
      INSERT INTO demandas_excecao_data (setor_id, data, hora_inicio, hora_fim, min_pessoas, override)
      VALUES (?, ?, ?, ?, ?, ?)
    `, input.setor_id, input.data, input.hora_inicio, input.hora_fim, input.min_pessoas, input.override ?? false)
    return await queryOne('SELECT * FROM demandas_excecao_data WHERE id = ?', id)
  })

const setoresDeletarDemandaExcecaoData = t.procedure
  .input<{ id: number }>()
  .action(async ({ input }) => {
    await execute('DELETE FROM demandas_excecao_data WHERE id = ?', input.id)
    return undefined
  })

// =============================================================================
// COLABORADORES — REGRAS DE HORÁRIO (5 handlers)
// =============================================================================

const colaboradoresBuscarRegraHorario = t.procedure
  .input<{ colaborador_id: number }>()
  .action(async ({ input }) => {
    return await queryAll('SELECT * FROM colaborador_regra_horario WHERE colaborador_id = ? ORDER BY dia_semana_regra NULLS FIRST', input.colaborador_id)
  })

const colaboradoresSalvarRegraHorario = t.procedure
  .input<{
    colaborador_id: number
    dia_semana_regra?: string | null
    ativo?: boolean
    perfil_horario_id?: number | null
    inicio?: string | null
    fim?: string | null
    preferencia_turno_soft?: string | null
    domingo_ciclo_trabalho?: number
    domingo_ciclo_folga?: number
    folga_fixa_dia_semana?: string | null
  }>()
  .action(async ({ input }) => {
    const diaSemana = input.dia_semana_regra ?? null
    const isDiaEspecifico = diaSemana !== null

    // Buscar existente com match exato de dia_semana_regra (NULL-safe)
    const existe = diaSemana === null
      ? await queryOne<{ id: number }>('SELECT id FROM colaborador_regra_horario WHERE colaborador_id = ? AND dia_semana_regra IS NULL', input.colaborador_id)
      : await queryOne<{ id: number }>('SELECT id FROM colaborador_regra_horario WHERE colaborador_id = ? AND dia_semana_regra = ?', input.colaborador_id, diaSemana)

    // Para regras de dia específico, forçar defaults em campos nível-colaborador
    const domCicloTrabalho = isDiaEspecifico ? 2 : (input.domingo_ciclo_trabalho ?? 2)
    const domCicloFolga = isDiaEspecifico ? 1 : (input.domingo_ciclo_folga ?? 1)
    const folgaFixa = isDiaEspecifico ? null : (input.folga_fixa_dia_semana ?? null)

    if (existe) {
      await execute(`
        UPDATE colaborador_regra_horario SET
          ativo = COALESCE(?, ativo),
          perfil_horario_id = ?,
          inicio = ?, fim = ?,
          preferencia_turno_soft = ?,
          domingo_ciclo_trabalho = COALESCE(?, domingo_ciclo_trabalho),
          domingo_ciclo_folga = COALESCE(?, domingo_ciclo_folga),
          folga_fixa_dia_semana = ?
        WHERE id = ?
      `,
        input.ativo !== undefined ? input.ativo : null,
        input.perfil_horario_id ?? null,
        input.inicio ?? null, input.fim ?? null,
        input.preferencia_turno_soft ?? null,
        domCicloTrabalho,
        domCicloFolga,
        folgaFixa,
        existe.id
      )
      return await queryOne('SELECT * FROM colaborador_regra_horario WHERE id = ?', existe.id)
    } else {
      const id = await insertReturningId(`
        INSERT INTO colaborador_regra_horario
          (colaborador_id, dia_semana_regra, ativo, perfil_horario_id, inicio, fim, preferencia_turno_soft, domingo_ciclo_trabalho, domingo_ciclo_folga, folga_fixa_dia_semana)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
        input.colaborador_id,
        diaSemana,
        input.ativo !== undefined ? input.ativo : true,
        input.perfil_horario_id ?? null,
        input.inicio ?? null, input.fim ?? null,
        input.preferencia_turno_soft ?? null,
        domCicloTrabalho,
        domCicloFolga,
        folgaFixa
      )
      return await queryOne('SELECT * FROM colaborador_regra_horario WHERE id = ?', id)
    }
  })

const colaboradoresDeletarRegraHorario = t.procedure
  .input<{ id: number }>()
  .action(async ({ input }) => {
    await execute('DELETE FROM colaborador_regra_horario WHERE id = ?', input.id)
    return undefined
  })

const colaboradoresListarRegrasExcecaoData = t.procedure
  .input<{ colaborador_id: number }>()
  .action(async ({ input }) => {
    return await queryAll('SELECT * FROM colaborador_regra_horario_excecao_data WHERE colaborador_id = ? ORDER BY data', input.colaborador_id)
  })

const colaboradoresUpsertRegraExcecaoData = t.procedure
  .input<{
    colaborador_id: number
    data: string
    ativo?: boolean
    inicio?: string | null
    fim?: string | null
    preferencia_turno_soft?: string | null
    domingo_forcar_folga?: boolean
  }>()
  .action(async ({ input }) => {
    const existe = await queryOne<{ id: number }>('SELECT id FROM colaborador_regra_horario_excecao_data WHERE colaborador_id = ? AND data = ?',
      input.colaborador_id, input.data)
    if (existe) {
      await execute(`
        UPDATE colaborador_regra_horario_excecao_data SET
          ativo = COALESCE(?, ativo),
          inicio = ?, fim = ?,
          preferencia_turno_soft = ?,
          domingo_forcar_folga = COALESCE(?, domingo_forcar_folga)
        WHERE id = ?
      `,
        input.ativo !== undefined ? input.ativo : null,
        input.inicio ?? null, input.fim ?? null,
        input.preferencia_turno_soft ?? null,
        input.domingo_forcar_folga !== undefined ? input.domingo_forcar_folga : null,
        existe.id
      )
      return await queryOne('SELECT * FROM colaborador_regra_horario_excecao_data WHERE id = ?', existe.id)
    } else {
      const id = await insertReturningId(`
        INSERT INTO colaborador_regra_horario_excecao_data
          (colaborador_id, data, ativo, inicio, fim, preferencia_turno_soft, domingo_forcar_folga)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
        input.colaborador_id, input.data,
        input.ativo !== undefined ? input.ativo : true,
        input.inicio ?? null, input.fim ?? null,
        input.preferencia_turno_soft ?? null,
        input.domingo_forcar_folga ?? false
      )
      return await queryOne('SELECT * FROM colaborador_regra_horario_excecao_data WHERE id = ?', id)
    }
  })

const colaboradoresDeletarRegraExcecaoData = t.procedure
  .input<{ id: number }>()
  .action(async ({ input }) => {
    await execute('DELETE FROM colaborador_regra_horario_excecao_data WHERE id = ?', input.id)
    return undefined
  })

// =============================================================================
// ESCALAS — CICLO ROTATIVO (4 handlers)
// =============================================================================

const escalasDetectarCicloRotativo = t.procedure
  .input<{ escala_id: number }>()
  .action(async ({ input }) => {
    const escala = await queryOne<{ data_inicio: string; data_fim: string }>('SELECT * FROM escalas WHERE id = ?', input.escala_id)
    if (!escala) throw new Error('Escala nao encontrada')
    const start = new Date(escala.data_inicio)
    const end = new Date(escala.data_fim)
    const semanas = Math.max(1, Math.round((end.getTime() - start.getTime()) / (7 * 24 * 60 * 60 * 1000)))
    const r = await queryOne<{ p: number }>(`SELECT COUNT(DISTINCT colaborador_id) as p FROM alocacoes WHERE escala_id = ? AND status != 'FOLGA'`, input.escala_id)
    const P = r?.p ?? 0
    return {
      ciclo_detectado: semanas >= 2 && P > 0,
      T: semanas,
      P,
      semanas,
      match_percent: semanas >= 2 ? 80 : 0,
    }
  })

const escalasSalvarCicloRotativo = t.procedure
  .input<{
    setor_id: number
    nome: string
    semanas_no_ciclo: number
    origem_escala_id?: number | null
    itens: Array<{
      semana_idx: number
      colaborador_id: number
      dia_semana: string
      trabalha: boolean
      ancora_domingo?: boolean
      prioridade?: number
    }>
  }>()
  .action(async ({ input }) => {
    const modeloId = await transaction(async () => {
      const newId = await insertReturningId(`
        INSERT INTO escala_ciclo_modelos (setor_id, nome, semanas_no_ciclo, origem_escala_id)
        VALUES (?, ?, ?, ?)
      `, input.setor_id, input.nome, input.semanas_no_ciclo, input.origem_escala_id ?? null)
      for (const item of input.itens) {
        await execute(`
          INSERT INTO escala_ciclo_itens (ciclo_modelo_id, semana_idx, colaborador_id, dia_semana, trabalha, ancora_domingo, prioridade)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `, newId, item.semana_idx, item.colaborador_id, item.dia_semana, item.trabalha, item.ancora_domingo ?? false, item.prioridade ?? 0)
      }
      return newId
    })
    return await queryOne('SELECT * FROM escala_ciclo_modelos WHERE id = ?', modeloId)
  })

const escalasListarCiclosRotativos = t.procedure
  .input<{ setor_id: number }>()
  .action(async ({ input }) => {
    return await queryAll('SELECT * FROM escala_ciclo_modelos WHERE setor_id = ? AND ativo = TRUE ORDER BY criado_em DESC', input.setor_id)
  })

const escalasGerarPorCicloRotativo = t.procedure
  .input<{ ciclo_modelo_id: number; data_inicio: string; data_fim: string }>()
  .action(async ({ input }) => {
    const modelo = await queryOne<{ id: number; setor_id: number; nome: string; semanas_no_ciclo: number }>('SELECT * FROM escala_ciclo_modelos WHERE id = ?', input.ciclo_modelo_id)
    if (!modelo) throw new Error('Modelo de ciclo nao encontrado')
    const itens = await queryAll<{ semana_idx: number; colaborador_id: number; dia_semana: string; trabalha: boolean | number }>('SELECT * FROM escala_ciclo_itens WHERE ciclo_modelo_id = ? ORDER BY semana_idx, dia_semana', input.ciclo_modelo_id)

    const numeroDiaSemana: Record<number, string> = { 0: 'DOM', 1: 'SEG', 2: 'TER', 3: 'QUA', 4: 'QUI', 5: 'SEX', 6: 'SAB' }

    // Criar escala RASCUNHO
    const escalaId = await insertReturningId(`
      INSERT INTO escalas (setor_id, data_inicio, data_fim, status, criada_em)
      VALUES (?, ?, ?, 'RASCUNHO', NOW())
    `, modelo.setor_id, input.data_inicio, input.data_fim)

    // Gerar alocacoes
    await transaction(async () => {
      const start = new Date(input.data_inicio)
      const end = new Date(input.data_fim)
      const T = modelo.semanas_no_ciclo
      let current = new Date(start)
      let semanaOffset = 0
      while (current <= end) {
        const diaSemanaNum = current.getDay()
        const diaSemanaStr = numeroDiaSemana[diaSemanaNum]
        const dataStr = current.toISOString().slice(0, 10)
        if (diaSemanaNum === 1) semanaOffset++ // incrementa na segunda-feira
        const semanaIdx = ((semanaOffset - 1) % T + T) % T
        const itensHoje = itens.filter(i => i.dia_semana === diaSemanaStr && i.semana_idx === semanaIdx)
        for (const item of itensHoje) {
          await execute(`
            INSERT INTO alocacoes (escala_id, colaborador_id, data, status)
            VALUES (?, ?, ?, ?)
          `, escalaId, item.colaborador_id, dataStr, item.trabalha ? 'TRABALHO' : 'FOLGA')
        }
        current.setDate(current.getDate() + 1)
      }
    })

    // Retornar escala completa
    const escala = await queryOne('SELECT * FROM escalas WHERE id = ?', escalaId) as any
    const alocacoes = await queryAll('SELECT * FROM alocacoes WHERE escala_id = ? ORDER BY data, colaborador_id', escalaId)
    return {
      ...escala,
      alocacoes,
      indicadores: { total_horas: 0, media_horas: 0, violacoes_hard: 0, violacoes_soft: 0 },
      violacoes: [],
      pinned_cells: [],
    }
  })

// =============================================================================
// IA CONFIGURAÇÃO
// =============================================================================

type IaProviderKey = 'gemini' | 'openrouter'

type IaProviderConfig = {
  token?: string
  modelo?: string
  favoritos?: string[]
}

type IaProviderConfigs = Partial<Record<IaProviderKey, IaProviderConfig>>

function parseIaProviderConfigs(raw: unknown): IaProviderConfigs {
  if (!raw) return {}
  if (typeof raw === 'object' && raw !== null) return raw as IaProviderConfigs
  if (typeof raw !== 'string') return {}
  try {
    const parsed = JSON.parse(raw)
    return typeof parsed === 'object' && parsed !== null ? (parsed as IaProviderConfigs) : {}
  } catch {
    return {}
  }
}

function serializeIaProviderConfigs(configs: IaProviderConfigs): string {
  try {
    return JSON.stringify(configs ?? {})
  } catch {
    return '{}'
  }
}

function normalizeIaConfigRow(raw: any) {
  if (!raw) return null
  const providerConfigs = parseIaProviderConfigs(raw.provider_configs_json)
  return {
    ...raw,
    provider_configs_json: serializeIaProviderConfigs(providerConfigs),
    provider_configs: providerConfigs,
  }
}

type IaModelCatalogProvider = 'gemini' | 'openrouter'

type IaModelCatalogItem = {
  id: string
  label: string
  provider: IaModelCatalogProvider
  source: 'static' | 'api' | 'fallback'
  description?: string
  context_length?: number
  pricing?: { prompt?: string; completion?: string }
  is_free?: boolean
  supports_tools?: boolean
  is_agentic?: boolean
  tags?: string[]
}

type IaModelCatalogResult = {
  provider: IaModelCatalogProvider
  source: 'static' | 'api' | 'fallback'
  models: IaModelCatalogItem[]
  fetched_at: string
  cached: boolean
  message?: string
}

const IA_MODEL_CATALOG_CACHE_TTL_MS = 15 * 60 * 1000
const iaModelCatalogCache = new Map<string, { at: number; value: IaModelCatalogResult }>()

function makeCatalogCacheKey(provider: IaModelCatalogProvider, cfg?: IaProviderConfig): string {
  const tokenPresent = Boolean(cfg?.token?.trim())
  return `${provider}:${tokenPresent ? 'token' : 'no-token'}`
}

function parsePrice(raw: unknown): number {
  const n = typeof raw === 'string' ? Number(raw) : typeof raw === 'number' ? raw : 0
  return Number.isFinite(n) ? n : 0
}

function staticGeminiCatalog(): IaModelCatalogResult {
  const models: IaModelCatalogItem[] = [
    { id: 'gemini-3-flash-preview', label: 'Gemini 3 Flash Preview', provider: 'gemini', source: 'static', is_agentic: true, supports_tools: true, context_length: 1_000_000, tags: ['flash', 'preview'] },
    { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', provider: 'gemini', source: 'static', is_agentic: true, supports_tools: true, context_length: 1_048_576, tags: ['flash'] },
    { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', provider: 'gemini', source: 'static', is_agentic: true, supports_tools: true, context_length: 1_048_576, tags: ['pro'] },
    { id: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash-Lite', provider: 'gemini', source: 'static', is_agentic: true, supports_tools: true, context_length: 1_048_576, tags: ['flash-lite'] },
    { id: 'gemini-2.0-flash-thinking-exp-1219', label: 'Gemini 2.0 Flash Thinking Exp', provider: 'gemini', source: 'static', is_agentic: true, supports_tools: true, context_length: 32_767, tags: ['thinking', 'exp'] },
  ]
  return {
    provider: 'gemini',
    source: 'static',
    models,
    fetched_at: new Date().toISOString(),
    cached: false,
    message: 'Catálogo Gemini estático (pode ficar desatualizado; adicionar endpoint oficial depois).',
  }
}

async function fetchOpenRouterCatalog(): Promise<IaModelCatalogResult> {
  const response = await fetch('https://openrouter.ai/api/v1/models', {
    headers: { 'Content-Type': 'application/json' },
  })
  if (!response.ok) {
    throw new Error(`OpenRouter API error: ${response.status}`)
  }
  const data = await response.json() as { data?: any[] }
  const models: IaModelCatalogItem[] = (data.data ?? [])
    .map((m) => {
      const prompt = String(m?.pricing?.prompt ?? '0')
      const completion = String(m?.pricing?.completion ?? '0')
      const isFree = parsePrice(prompt) === 0 && parsePrice(completion) === 0
      const supportsTools = Array.isArray(m?.supported_parameters) ? m.supported_parameters.includes('tools') : false
      return {
        id: String(m.id),
        label: m.name ? String(m.name) : String(m.id),
        provider: 'openrouter' as const,
        source: 'api' as const,
        description: typeof m.description === 'string' ? m.description : undefined,
        context_length: Number.isFinite(Number(m.context_length)) ? Number(m.context_length) : undefined,
        pricing: { prompt, completion },
        is_free: isFree,
        supports_tools: supportsTools,
        // Command Center intelligence: "agentic" here means tool-capable in practice.
        is_agentic: supportsTools,
        tags: [
          ...(isFree ? ['free'] : []),
          ...(supportsTools ? ['tools', 'agentic'] : []),
        ],
      }
    })
    .sort((a, b) => {
      if (a.is_free && !b.is_free) return -1
      if (!a.is_free && b.is_free) return 1
      if (a.supports_tools && !b.supports_tools) return -1
      if (!a.supports_tools && b.supports_tools) return 1
      return a.label.localeCompare(b.label)
    })

  return {
    provider: 'openrouter',
    source: 'api',
    models,
    fetched_at: new Date().toISOString(),
    cached: false,
    message: 'Catálogo em tempo real do OpenRouter com metadados free/tools (agêntico).',
  }
}

async function getIaModelCatalog(provider: IaModelCatalogProvider, cfg?: IaProviderConfig, forceRefresh = false): Promise<IaModelCatalogResult> {
  const cacheKey = makeCatalogCacheKey(provider, cfg)
  const now = Date.now()
  const cached = iaModelCatalogCache.get(cacheKey)
  if (!forceRefresh && cached && now - cached.at < IA_MODEL_CATALOG_CACHE_TTL_MS) {
    return { ...cached.value, cached: true }
  }

  let result: IaModelCatalogResult
  if (provider === 'gemini') {
    result = staticGeminiCatalog()
  } else {
    result = await fetchOpenRouterCatalog()
  }

  iaModelCatalogCache.set(cacheKey, { at: now, value: { ...result, cached: false } })
  return result
}

const iaConfiguracaoObter = t.procedure
  .action(async () => {
    const config = await queryOne('SELECT * FROM configuracao_ia LIMIT 1')
    return normalizeIaConfigRow(config)
  })

const iaConfiguracaoSalvar = t.procedure
  .input<{ provider: string; api_key: string; modelo: string; provider_configs_json?: string }>()
  .action(async ({ input }) => {
    const existe = await queryOne<{ id: number }>('SELECT id FROM configuracao_ia LIMIT 1')
    const providerConfigsJson = serializeIaProviderConfigs(parseIaProviderConfigs(input.provider_configs_json))

    if (existe) {
      await execute(`UPDATE configuracao_ia SET provider = ?, api_key = ?, modelo = ?, provider_configs_json = ?, ativo = TRUE, atualizado_em = NOW() WHERE id = ?`,
        input.provider, input.api_key, input.modelo, providerConfigsJson, existe.id)
    } else {
      await execute(`INSERT INTO configuracao_ia (provider, api_key, modelo, provider_configs_json, ativo) VALUES (?, ?, ?, ?, TRUE)`,
        input.provider, input.api_key, input.modelo, providerConfigsJson)
    }

    return normalizeIaConfigRow(await queryOne('SELECT * FROM configuracao_ia LIMIT 1'))
  })

const iaConfiguracaoTestar = t.procedure
  .input<{ provider: string; api_key: string; modelo: string; provider_configs_json?: string }>()
  .action(async ({ input }) => {
    try {
      if (input.provider === 'openrouter') {
        const providerConfigs = parseIaProviderConfigs(input.provider_configs_json)
        const providerCfg = providerConfigs.openrouter
        if (!providerCfg?.token?.trim()) {
          throw new Error('Token/OpenRouter API Key não configurado.')
        }
        const ping = await iaTestarConexao('openrouter', providerCfg.token.trim(), input.modelo)
        const catalog = await getIaModelCatalog('openrouter', providerCfg, true)
        return {
          sucesso: true,
          mensagem: `${ping.mensagem} · Catálogo: ${catalog.models.length} modelos`,
          detalhes: { ping, catalog },
        }
      }

      return await iaTestarConexao(input.provider, input.api_key, input.modelo)
    } catch (error: any) {
      throw new Error(error.message || 'Erro desconhecido ao testar conexão.')
    }
  })

const iaModelosCatalogo = t.procedure
  .input<{ provider: IaModelCatalogProvider; provider_config?: IaProviderConfig; force_refresh?: boolean }>()
  .action(async ({ input }) => {
    return await getIaModelCatalog(input.provider, input.provider_config, Boolean(input.force_refresh))
  })

const iaChatLerArquivo = t.procedure
  .input<{ conversa_id: string }>()
  .action(async ({ input }) => {
    const win = BrowserWindow.getFocusedWindow()
    if (!win) throw new Error('Nenhuma janela ativa')
    const result = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters: [
        { name: 'Imagens e Documentos', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'pdf', 'txt', 'md'] },
      ],
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const filePath = result.filePaths[0]
    const buf = readFileSync(filePath)
    if (buf.length > 10 * 1024 * 1024) throw new Error('Arquivo excede 10 MB')
    const ext = path.extname(filePath).toLowerCase()
    const mimeMap: Record<string, string> = {
      '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
      '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp',
      '.pdf': 'application/pdf', '.txt': 'text/plain', '.md': 'text/markdown',
    }
    const mime = mimeMap[ext] || 'application/octet-stream'
    const id = crypto.randomUUID()
    // Salvar em disco
    const dir = getAnexosConversaDir(input.conversa_id)
    const destExt = mimeToExt(mime)
    const destPath = path.join(dir, `${id}${destExt}`)
    writeFileSync(destPath, buf)
    return {
      id,
      data_base64: buf.toString('base64'),
      mime_type: mime,
      nome: path.basename(filePath),
      tamanho_bytes: buf.length,
      file_path: destPath,
    }
  })

// Salvar anexo vindo do renderer (drag & drop, paste) em disco
const iaChatSalvarAnexo = t.procedure
  .input<{ conversa_id: string; id: string; data_base64: string; mime_type: string; nome: string; tamanho_bytes: number }>()
  .action(async ({ input }) => {
    const dir = getAnexosConversaDir(input.conversa_id)
    const ext = mimeToExt(input.mime_type)
    const destPath = path.join(dir, `${input.id}${ext}`)
    const buf = Buffer.from(input.data_base64, 'base64')
    writeFileSync(destPath, buf)
    return { file_path: destPath }
  })

// Ler anexo do disco pra preview (ao recarregar histórico)
const iaChatLerAnexoPreview = t.procedure
  .input<{ file_path: string }>()
  .action(async ({ input }) => {
    if (!existsSync(input.file_path)) return null
    const buf = readFileSync(input.file_path)
    return { data_base64: buf.toString('base64') }
  })

const iaChatEnviar = t.procedure
  .input<{ mensagem: string; historico: import('@shared/index').IaMensagem[]; contexto?: import('@shared/index').IaContexto; stream_id?: string; conversa_id?: string; anexos?: import('@shared/index').IaAnexo[] }>()
  .action(async ({ input }) => {
    if (input.stream_id) {
      return await iaEnviarMensagemStream(input.mensagem, input.historico, input.stream_id, input.contexto, input.conversa_id, input.anexos)
    }
    return await iaEnviarMensagem(input.mensagem, input.historico, input.contexto, input.conversa_id, input.anexos)
  })

// =============================================================================
// IA HISTÓRICO DE CONVERSAS
// =============================================================================

const iaConversasListar = t.procedure
  .input<{ status?: string; busca?: string }>()
  .action(async ({ input }) => {
    const status = input.status ?? 'ativo'
    const busca = input.busca ? `%${input.busca}%` : '%'
    return await queryAll<import('@shared/index').IaConversa>(
      `SELECT * FROM ia_conversas WHERE status = ? AND titulo LIKE ? ORDER BY atualizado_em DESC`,
      status, busca)
  })

const iaConversasObter = t.procedure
  .input<{ id: string }>()
  .action(async ({ input }) => {
    const conversa = await queryOne<import('@shared/index').IaConversa>(
      `SELECT * FROM ia_conversas WHERE id = ?`, input.id)
    if (!conversa) throw new Error('Conversa não encontrada')

    // FASE 4: Carregar tool_calls_json e deserializar
    const mensagensRaw = await queryAll<{
      id: string
      conversa_id: string
      papel: string
      conteudo: string
      timestamp: string
      tool_calls_json: string | null
      anexos_meta_json: string | null
    }>(
      `SELECT id, conversa_id, papel, conteudo, timestamp, tool_calls_json, anexos_meta_json FROM ia_mensagens WHERE conversa_id = ? ORDER BY timestamp ASC`,
      input.id)

    const mensagens: import('@shared/index').IaMensagem[] = mensagensRaw.map((m) => ({
      id: m.id,
      conversa_id: m.conversa_id,
      papel: m.papel as import('@shared/index').IaMensagem['papel'],
      conteudo: m.conteudo,
      timestamp: m.timestamp,
      tool_calls: m.tool_calls_json
        ? JSON.parse(m.tool_calls_json)
        : undefined,
      anexos: m.anexos_meta_json
        ? JSON.parse(m.anexos_meta_json)
        : undefined,
    }))

    return { conversa, mensagens }
  })

const iaConversasCriar = t.procedure
  .input<{ id?: string; titulo?: string }>()
  .action(async ({ input }) => {
    const id = input.id ?? crypto.randomUUID()
    const titulo = input.titulo ?? 'Nova conversa'
    await execute(`INSERT INTO ia_conversas (id, titulo) VALUES (?, ?)`, id, titulo)
    return await queryOne<import('@shared/index').IaConversa>(
      `SELECT * FROM ia_conversas WHERE id = ?`, id) as import('@shared/index').IaConversa
  })

const iaConversasRenomear = t.procedure
  .input<{ id: string; titulo: string }>()
  .action(async ({ input }) => {
    await execute(
      `UPDATE ia_conversas SET titulo = ?, atualizado_em = NOW() WHERE id = ?`,
      input.titulo, input.id)
  })

const iaConversasArquivar = t.procedure
  .input<{ id: string }>()
  .action(async ({ input }) => {
    await execute(
      `UPDATE ia_conversas SET status = 'arquivado', atualizado_em = NOW() WHERE id = ?`,
      input.id)
    await limparAnexosConversa(input.id)
  })

const iaConversasRestaurar = t.procedure
  .input<{ id: string }>()
  .action(async ({ input }) => {
    await execute(
      `UPDATE ia_conversas SET status = 'ativo', atualizado_em = NOW() WHERE id = ?`,
      input.id)
  })

const iaConversasDeletar = t.procedure
  .input<{ id: string }>()
  .action(async ({ input }) => {
    await limparAnexosConversa(input.id)
    await execute(`DELETE FROM ia_conversas WHERE id = ?`, input.id)
  })

const iaMensagensSalvar = t.procedure
  .input<{ conversa_id: string; mensagem: import('@shared/index').IaMensagem }>()
  .action(async ({ input }) => {
    const { conversa_id, mensagem } = input

    // FASE 4: Serializar tool_calls se existir
    const toolCallsJson = mensagem.tool_calls
      ? JSON.stringify(mensagem.tool_calls)
      : null

    const anexosMetaJson = mensagem.anexos && mensagem.anexos.length > 0
      ? JSON.stringify(mensagem.anexos.map(a => ({ id: a.id, tipo: a.tipo, mime_type: a.mime_type, nome: a.nome, tamanho_bytes: a.tamanho_bytes, file_path: a.file_path })))
      : null

    await execute(
      `INSERT INTO ia_mensagens (id, conversa_id, papel, conteudo, timestamp, tool_calls_json, anexos_meta_json) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
      mensagem.id,
      conversa_id,
      mensagem.papel,
      mensagem.conteudo,
      mensagem.timestamp,
      toolCallsJson,
      anexosMetaJson
    )
    // Invalidar cache de compaction (nova msg muda o historico)
    await execute(
      `UPDATE ia_conversas SET atualizado_em = NOW(), resumo_compactado = NULL WHERE id = ?`,
      conversa_id)
  })

const iaConversasArquivarTodas = t.procedure.action(async () => {
  // Busca IDs ativas ANTES de arquivar (pra limpar anexos)
  const ativas = await queryAll<{ id: string }>(
    `SELECT id FROM ia_conversas WHERE status = 'ativo'`)
  await execute(
    `UPDATE ia_conversas SET status = 'arquivado', atualizado_em = NOW() WHERE status = 'ativo'`)
  for (const c of ativas) {
    await limparAnexosConversa(c.id)
  }
})

const iaConversasDeletarArquivadas = t.procedure.action(async () => {
  await limparAnexosArquivadas()
  await execute(`DELETE FROM ia_conversas WHERE status = 'arquivado'`)
})

// =============================================================================
// IA MENSAGENS — Edit + Export
// =============================================================================

const iaMensagensAtualizar = t.procedure
  .input<{ id: string; conteudo: string }>()
  .action(async ({ input }) => {
    await execute('UPDATE ia_mensagens SET conteudo = ? WHERE id = ?', input.conteudo, input.id)
    return { ok: true }
  })

const iaMensagensDeletarApos = t.procedure
  .input<{ conversa_id: string; timestamp: string }>()
  .action(async ({ input }) => {
    await execute(
      'DELETE FROM ia_mensagens WHERE conversa_id = ? AND timestamp > ?',
      input.conversa_id,
      input.timestamp,
    )
    // Invalida compaction (edicao muda historico)
    await execute(
      'UPDATE ia_conversas SET resumo_compactado = NULL WHERE id = ?',
      input.conversa_id,
    )
    return { ok: true }
  })

const iaConversasExportar = t.procedure
  .input<{ conversa_id: string; formato: 'md' | 'json' }>()
  .action(async ({ input }) => {
    const { dialog } = await import('electron')
    const { writeFile } = await import('node:fs/promises')

    const msgs = await queryAll<{
      papel: string; conteudo: string; timestamp: string
      tool_calls_json: string | null; anexos_meta_json: string | null
    }>(
      'SELECT papel, conteudo, timestamp, tool_calls_json, anexos_meta_json FROM ia_mensagens WHERE conversa_id = ? ORDER BY timestamp',
      input.conversa_id,
    )
    const conversa = await queryOne<{ titulo: string }>(
      'SELECT titulo FROM ia_conversas WHERE id = ?',
      input.conversa_id,
    )
    const titulo = conversa?.titulo ?? 'Chat IA'

    const mensagens = msgs.map(m => ({
      ...m,
      tool_calls: m.tool_calls_json ? JSON.parse(m.tool_calls_json) : undefined,
      anexos: m.anexos_meta_json ? JSON.parse(m.anexos_meta_json) : undefined,
    }))

    let content: string
    let ext: string
    if (input.formato === 'json') {
      content = JSON.stringify({ titulo, exportado_em: new Date().toISOString(), mensagens }, null, 2)
      ext = 'json'
    } else {
      // Gera markdown inline (sem importar do renderer)
      const lines: string[] = [`# ${titulo}`, `*Exportado em ${new Date().toLocaleString('pt-BR')}*`, '']
      for (const m of mensagens) {
        if (m.papel === 'tool_result') continue
        lines.push(`### ${m.papel === 'usuario' ? '**Voce**' : '**IA**'}`)
        lines.push(m.conteudo)
        if (m.tool_calls?.length) {
          lines.push('', '<details><summary>Ferramentas utilizadas</summary>', '')
          for (const tc of m.tool_calls) {
            lines.push(`- **${tc.name}**${tc.args ? `: \`${JSON.stringify(tc.args)}\`` : ''}`)
          }
          lines.push('</details>')
        }
        if (m.anexos?.length) {
          lines.push('')
          for (const a of m.anexos) lines.push(`> Anexo: ${a.nome} (${a.mime_type})`)
        }
        lines.push('', '---', '')
      }
      content = lines.join('\n')
      ext = 'md'
    }

    const slug = titulo.slice(0, 30).replace(/[^a-zA-Z0-9]/g, '-').replace(/-+/g, '-')
    const { filePath } = await dialog.showSaveDialog({
      title: 'Exportar conversa',
      defaultPath: `escalaflow-chat-${slug}.${ext}`,
      filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
    })

    if (filePath) {
      await writeFile(filePath, content, 'utf-8')
      return { exportado: true, caminho: filePath }
    }
    return { exportado: false }
  })

// =============================================================================
// IA SESSION PROCESSING — Phase 5
// =============================================================================

const iaSessaoProcessar = t.procedure
  .input<{ conversa_id: string }>()
  .action(async ({ input }) => {
    const { extractMemories } = await import('./ia/session-processor')
    const { buildModelFactory } = await import('./ia/config')

    // Carrega config
    const config = await queryOne<import('@shared/index').IaConfiguracao>(
      'SELECT * FROM configuracao_ia LIMIT 1')
    if (!config) return { ok: true }

    // Carrega conversa + mensagens
    const conversa = await queryOne<{ id: string; titulo: string }>(
      'SELECT id, titulo FROM ia_conversas WHERE id = ?', input.conversa_id)
    if (!conversa) return { ok: true }

    const mensagensRaw = await queryAll<{
      id: string; conversa_id: string; papel: string; conteudo: string; timestamp: string
    }>(
      'SELECT id, conversa_id, papel, conteudo, timestamp FROM ia_mensagens WHERE conversa_id = ? ORDER BY timestamp ASC',
      input.conversa_id)

    if (mensagensRaw.length < 2) return { ok: true }

    const mensagens: import('@shared/index').IaMensagem[] = mensagensRaw.map((m) => ({
      id: m.id,
      papel: m.papel as import('@shared/index').IaMensagem['papel'],
      conteudo: m.conteudo,
      timestamp: m.timestamp,
    }))

    // Smart Extraction — só se toggle ON + API configurada
    if (config.memoria_automatica) {
      const factory = buildModelFactory(config)
      if (factory) {
        try {
          await extractMemories(input.conversa_id, mensagens, factory.createModel, factory.modelo)
          console.log('[Session] Extracted memories:', conversa.titulo)
        } catch (err) {
          console.warn('[Session] extractMemories falhou:', (err as Error).message)
        }
      }
    }

    return { ok: true }
  })

const iaConfigMemoriaAutomatica = t.procedure
  .input<{ valor?: boolean }>()
  .action(async ({ input }) => {
    if (input.valor !== undefined) {
      await execute(
        'UPDATE configuracao_ia SET memoria_automatica = ? WHERE id = 1',
        input.valor)
    }
    const config = await queryOne<{ memoria_automatica: boolean }>(
      'SELECT memoria_automatica FROM configuracao_ia LIMIT 1')
    return { memoria_automatica: config?.memoria_automatica ?? true }
  })

// =============================================================================
// EMPRESA HORÁRIO SEMANA (2 handlers) — v5
// =============================================================================

const empresaHorariosListar = t.procedure
  .action(async () => {
    return await queryAll(`
      SELECT * FROM empresa_horario_semana
      ORDER BY CASE dia_semana
        WHEN 'SEG' THEN 1
        WHEN 'TER' THEN 2
        WHEN 'QUA' THEN 3
        WHEN 'QUI' THEN 4
        WHEN 'SEX' THEN 5
        WHEN 'SAB' THEN 6
        WHEN 'DOM' THEN 7
      END
    `)
  })

const empresaHorariosAtualizar = t.procedure
  .input<{ dia_semana: string; ativo: boolean; hora_abertura: string; hora_fechamento: string }>()
  .action(async ({ input }) => {
    await execute(`
      UPDATE empresa_horario_semana
      SET ativo = ?, hora_abertura = ?, hora_fechamento = ?
      WHERE dia_semana = ?
    `, input.ativo, input.hora_abertura, input.hora_fechamento, input.dia_semana)
    return await queryOne('SELECT * FROM empresa_horario_semana WHERE dia_semana = ?', input.dia_semana)
  })

// =============================================================================
// REGRAS DO MOTOR — v6 SPEC-02B
// =============================================================================

const regrasListar = t.procedure.action(async () => {
  return await queryAll(`
    SELECT rd.codigo, rd.nome, rd.descricao, rd.categoria,
           rd.status_sistema, rd.editavel, rd.aviso_dependencia, rd.ordem,
           COALESCE(re.status, rd.status_sistema) as status_efetivo
    FROM regra_definicao rd
    LEFT JOIN regra_empresa re ON rd.codigo = re.codigo
    ORDER BY rd.ordem
  `)
})

const regrasAtualizar = t.procedure
  .input<{ codigo: string; status: string }>()
  .action(async ({ input }) => {
    await execute(`
      INSERT INTO regra_empresa (codigo, status, atualizado_em)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(codigo) DO UPDATE SET
        status = excluded.status,
        atualizado_em = excluded.atualizado_em
    `, input.codigo, input.status)
  })

const regrasResetarEmpresa = t.procedure.action(async () => {
  await execute('DELETE FROM regra_empresa')
})

const regrasResetarRegra = t.procedure
  .input<{ codigo: string }>()
  .action(async ({ input }) => {
    await execute('DELETE FROM regra_empresa WHERE codigo = ?', input.codigo)
  })

// =============================================================================
// BACKUP / RESTORE (2 handlers)
// =============================================================================

// Tabelas agrupadas por categoria para backup seletivo
// Estrutura do ZIP:
//   _meta.json
//   cadastros/empresa.json, cadastros/setores.json, ...
//   conhecimento/ia_memorias.json, conhecimento/knowledge_chunks.json, ...
//   conversas/ia_conversas.json, conversas/ia_mensagens.json

const BACKUP_CATEGORIAS = {
  cadastros: [
    'empresa', 'tipos_contrato', 'setores', 'demandas', 'colaboradores',
    'excecoes', 'escalas', 'alocacoes', 'funcoes', 'feriados',
    'setor_horario_semana', 'empresa_horario_semana', 'contrato_perfis_horario',
    'colaborador_regra_horario', 'colaborador_regra_horario_excecao_data',
    'demandas_excecao_data', 'escala_ciclo_modelos', 'escala_ciclo_itens',
    'escala_decisoes', 'escala_comparacao_demanda', 'configuracao_ia', 'regra_empresa',
  ],
  conhecimento: [
    'ia_memorias', 'knowledge_sources', 'knowledge_chunks',
    'knowledge_entities', 'knowledge_relations',
  ],
  conversas: [
    'ia_conversas', 'ia_mensagens',
  ],
} as const

// Ordem de import (pais antes de filhas por FK)
const IMPORT_ORDER = [
  'empresa', 'tipos_contrato', 'setores', 'funcoes', 'contrato_perfis_horario',
  'colaboradores', 'demandas', 'excecoes', 'setor_horario_semana', 'empresa_horario_semana',
  'colaborador_regra_horario', 'colaborador_regra_horario_excecao_data',
  'demandas_excecao_data', 'feriados', 'escalas', 'alocacoes',
  'escala_decisoes', 'escala_comparacao_demanda', 'escala_ciclo_modelos', 'escala_ciclo_itens',
  'configuracao_ia', 'regra_empresa',
  'ia_memorias', 'knowledge_sources', 'knowledge_chunks', 'knowledge_entities', 'knowledge_relations',
  'ia_conversas', 'ia_mensagens',
] as const

type BackupOpcoes = {
  incluir_cadastros?: boolean
  incluir_conhecimento?: boolean
  incluir_historico_chat?: boolean
}

const dadosExportar = t.procedure
  .input<BackupOpcoes>()
  .action(async ({ input }): Promise<{ filepath: string; tamanho_mb: number } | null> => {
  const AdmZip = (await import('adm-zip')).default

  const incluir = {
    cadastros: input?.incluir_cadastros !== false,
    conhecimento: input?.incluir_conhecimento !== false,
    conversas: input?.incluir_historico_chat !== false,
  }

  const categoriasAtivas = Object.entries(incluir)
    .filter(([, v]) => v)
    .map(([k]) => k as keyof typeof BACKUP_CATEGORIAS)

  if (categoriasAtivas.length === 0) return null

  const now = new Date()
  const ts = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`
  const result = await dialog.showSaveDialog({
    defaultPath: `escalaflow-backup-${ts}.zip`,
    filters: [{ name: 'EscalaFlow Backup', extensions: ['zip'] }],
  })

  if (result.canceled || !result.filePath) return null

  const zip = new AdmZip()
  let totalTabelas = 0
  let totalRegistros = 0

  for (const categoria of categoriasAtivas) {
    const tables = BACKUP_CATEGORIAS[categoria]
    for (const table of tables) {
      try {
        const rows = await queryAll(`SELECT * FROM ${table}`)
        if (rows.length > 0) {
          zip.addFile(
            `${categoria}/${table}.json`,
            Buffer.from(JSON.stringify(rows, null, 2), 'utf-8'),
          )
          totalTabelas++
          totalRegistros += rows.length
        }
      } catch {
        // tabela pode não existir em DBs antigos — ignora
      }
    }
  }

  // Metadata no root do zip
  const meta = {
    app: 'escalaflow',
    versao: app.getVersion(),
    criado_em: now.toISOString(),
    tabelas: totalTabelas,
    registros: totalRegistros,
    categorias: incluir,
  }
  zip.addFile('_meta.json', Buffer.from(JSON.stringify(meta, null, 2), 'utf-8'))

  zip.writeZip(result.filePath)

  const stats = await import('node:fs/promises').then(fs => fs.stat(result.filePath))
  const tamanhoMb = Math.round((stats.size / 1024 / 1024) * 100) / 100

  return { filepath: result.filePath, tamanho_mb: tamanhoMb }
})

const dadosImportar = t.procedure.action(async (): Promise<{ tabelas: number; registros: number; categorias: string[] } | null> => {
  const result = await dialog.showOpenDialog({
    filters: [
      { name: 'EscalaFlow Backup', extensions: ['zip'] },
      { name: 'JSON (legado)', extensions: ['json'] },
    ],
    properties: ['openFile'],
  })

  if (result.canceled || !result.filePaths[0]) return null

  const filePath = result.filePaths[0]

  // Detecta formato: ZIP ou JSON legado
  const isZip = filePath.toLowerCase().endsWith('.zip')

  // Parseia o backup — normaliza ambos formatos pra { dados: Record<table, rows[]>, categorias: string[] }
  let dados: Record<string, unknown[]> = {}
  let categorias: string[] = []

  if (isZip) {
    const AdmZip = (await import('adm-zip')).default
    const zip = new AdmZip(filePath)
    const entries = zip.getEntries()

    // Valida meta
    const metaEntry = entries.find(e => e.entryName === '_meta.json')
    if (!metaEntry) throw new Error('Arquivo ZIP invalido. Nenhum _meta.json encontrado.')
    const meta = JSON.parse(metaEntry.getData().toString('utf-8'))
    if (meta?.app !== 'escalaflow') throw new Error('Arquivo de backup invalido. Selecione um backup do EscalaFlow.')

    // Lê cada JSON dentro das pastas
    for (const entry of entries) {
      if (entry.isDirectory || entry.entryName === '_meta.json') continue
      const parts = entry.entryName.split('/')
      if (parts.length !== 2) continue
      const [categoria, filename] = parts
      const table = filename.replace('.json', '')
      if (!categorias.includes(categoria)) categorias.push(categoria)
      try {
        const rows = JSON.parse(entry.getData().toString('utf-8'))
        if (Array.isArray(rows)) dados[table] = rows
      } catch {
        // arquivo corrompido dentro do zip — ignora
      }
    }
  } else {
    // JSON legado
    const raw = readFileSync(filePath, 'utf-8')
    const backup = JSON.parse(raw) as { _meta?: { app?: string }; dados?: Record<string, unknown[]> }
    if (!backup?._meta?.app || backup._meta.app !== 'escalaflow') {
      throw new Error('Arquivo de backup invalido. Selecione um arquivo exportado pelo EscalaFlow.')
    }
    if (!backup.dados || typeof backup.dados !== 'object') {
      throw new Error('Arquivo de backup corrompido. Nenhum dado encontrado.')
    }
    dados = backup.dados
    categorias = ['legado']
  }

  if (Object.keys(dados).length === 0) {
    throw new Error('Nenhuma tabela encontrada no backup.')
  }

  let totalTabelas = 0
  let totalRegistros = 0

  return await transaction(async () => {
    await execDDL('SET session_replication_role = \'replica\'')

    try {
      // Só limpa tabelas presentes no backup
      const backupTables = new Set(Object.keys(dados))
      for (let i = IMPORT_ORDER.length - 1; i >= 0; i--) {
        const table = IMPORT_ORDER[i]
        if (!backupTables.has(table)) continue
        try {
          await execute(`DELETE FROM ${table}`)
        } catch {
          // tabela pode não existir
        }
      }

      // Insere na ordem certa (pais antes de filhas)
      for (const table of IMPORT_ORDER) {
        const rows = dados[table]
        if (!rows || !Array.isArray(rows) || rows.length === 0) continue

        const sample = rows[0] as Record<string, unknown>
        const columns = Object.keys(sample)
        const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ')

        for (const row of rows) {
          const r = row as Record<string, unknown>
          const values = columns.map((col) => r[col] ?? null)
          await execute(
            `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`,
            ...values,
          )
        }

        totalTabelas++
        totalRegistros += rows.length
      }
    } finally {
      await execDDL('SET session_replication_role = \'origin\'')
    }

    return { tabelas: totalTabelas, registros: totalRegistros, categorias }
  })
})

// =============================================================================
// IA MEMÓRIAS (4 handlers)
// =============================================================================

const IA_MEMORIAS_LIMIT = 50

const iaMemoriasListar = t.procedure.action(async () => {
  return await queryAll<import('@shared/index').IaMemoria>(
    'SELECT * FROM ia_memorias ORDER BY atualizada_em DESC')
})

const iaMemoriasSalvar = t.procedure
  .input<{ id?: number; conteudo: string }>()
  .action(async ({ input }) => {
    // Gera embedding local (grátis, ONNX)
    let embeddingStr: string | null = null
    try {
      const { generateQueryEmbedding } = await import('./knowledge/embeddings')
      const emb = await generateQueryEmbedding(input.conteudo)
      if (emb) embeddingStr = `[${emb.join(',')}]`
    } catch { /* embedding opcional — continua sem */ }

    if (input.id) {
      if (embeddingStr) {
        await execute(
          'UPDATE ia_memorias SET conteudo = $1, embedding = $2::vector, atualizada_em = NOW() WHERE id = $3',
          input.conteudo, embeddingStr, input.id)
      } else {
        await execute(
          'UPDATE ia_memorias SET conteudo = $1, atualizada_em = NOW() WHERE id = $2',
          input.conteudo, input.id)
      }
      return await queryOne<import('@shared/index').IaMemoria>(
        'SELECT * FROM ia_memorias WHERE id = $1', input.id)
    }
    // Soft limit
    const countRow = await queryOne<{ c: number }>('SELECT COUNT(*)::int as c FROM ia_memorias')
    if ((countRow?.c ?? 0) >= IA_MEMORIAS_LIMIT) {
      throw new Error(`Limite de ${IA_MEMORIAS_LIMIT} memórias atingido. Remova uma antes de adicionar.`)
    }
    const id = embeddingStr
      ? await insertReturningId(
          `INSERT INTO ia_memorias (conteudo, origem, embedding) VALUES ($1, 'manual', $2::vector)`,
          input.conteudo, embeddingStr)
      : await insertReturningId(
          `INSERT INTO ia_memorias (conteudo, origem) VALUES ($1, 'manual')`,
          input.conteudo)
    return await queryOne<import('@shared/index').IaMemoria>(
      'SELECT * FROM ia_memorias WHERE id = $1', id)
  })

const iaMemoriasRemover = t.procedure
  .input<{ id: number }>()
  .action(async ({ input }) => {
    await execute('DELETE FROM ia_memorias WHERE id = $1', input.id)
  })

const iaMemoriasContar = t.procedure.action(async () => {
  const row = await queryOne<{ c: number }>('SELECT COUNT(*)::int as c FROM ia_memorias')
  return { total: row?.c ?? 0, limite: IA_MEMORIAS_LIMIT }
})

// =============================================================================
// KNOWLEDGE
// =============================================================================

const knowledgeListarFontes = t.procedure.action(async () => {
  return await queryAll<{
    id: number
    tipo: string
    titulo: string
    importance: string
    criada_em: string
    atualizada_em: string
  }>('SELECT id, tipo, titulo, importance, criada_em, atualizada_em FROM knowledge_sources ORDER BY atualizada_em DESC')
})

const knowledgeStats = t.procedure.action(async () => {
  const fontes = await queryAll<{
    id: number
    tipo: string
    titulo: string
    importance: string
    ativo: boolean
    criada_em: string
    atualizada_em: string
    chunks_count: number
  }>(`
    SELECT ks.id, ks.tipo, ks.titulo, ks.importance, ks.ativo, ks.criada_em, ks.atualizada_em,
           COUNT(kc.id)::int as chunks_count
    FROM knowledge_sources ks
    LEFT JOIN knowledge_chunks kc ON kc.source_id = ks.id
    GROUP BY ks.id
    ORDER BY ks.atualizada_em DESC
  `)

  const totais = await queryOne<{
    total_fontes: number
    total_chunks: number
    total_sistema: number
    total_usuario: number
  }>(`
    SELECT
      (SELECT COUNT(*)::int FROM knowledge_sources) as total_fontes,
      (SELECT COUNT(*)::int FROM knowledge_chunks) as total_chunks,
      (SELECT COUNT(*)::int FROM knowledge_sources WHERE tipo = 'sistema') as total_sistema,
      (SELECT COUNT(*)::int FROM knowledge_sources WHERE tipo != 'sistema') as total_usuario
  `)

  return { fontes, totais: totais ?? { total_fontes: 0, total_chunks: 0, total_sistema: 0, total_usuario: 0 } }
})

const knowledgeEscolherArquivo = t.procedure.action(async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [
      { name: 'Documentos', extensions: ['md', 'txt', 'pdf'] }
    ]
  })
  if (result.canceled || !result.filePaths.length) return null
  return result.filePaths[0]
})

const knowledgeImportar = t.procedure
  .input<{ caminho_arquivo: string }>()
  .action(async ({ input }) => {
  const fs = require('node:fs') as typeof import('node:fs')
  const p = require('node:path') as typeof import('node:path')
  const { ingestKnowledge } = await import('./knowledge/ingest')

  if (!fs.existsSync(input.caminho_arquivo)) {
    throw new Error(`Arquivo não encontrado: ${input.caminho_arquivo}`)
  }

  const conteudo = fs.readFileSync(input.caminho_arquivo, 'utf-8')
  const titulo = p.basename(input.caminho_arquivo, p.extname(input.caminho_arquivo))
  const result = await ingestKnowledge(titulo, conteudo, 'high', {
    tipo: 'importacao_usuario',
    arquivo_original: input.caminho_arquivo,
  })

  return result
})

const knowledgeRemoverFonte = t.procedure
  .input<{ id: number }>()
  .action(async ({ input }) => {
  await execute('DELETE FROM knowledge_sources WHERE id = $1', input.id)
  return { ok: true }
})

const knowledgeToggleAtivo = t.procedure
  .input<{ id: number; ativo: boolean }>()
  .action(async ({ input }) => {
  await execute(
    'UPDATE knowledge_sources SET ativo = $1, atualizada_em = NOW() WHERE id = $2',
    input.ativo,
    input.id,
  )
  return { ok: true }
})

const knowledgeObterTextoOriginal = t.procedure
  .input<{ id: number }>()
  .action(async ({ input }) => {
  const row = await queryOne<{
    titulo: string
    conteudo_original: string
    metadata: string
  }>(
    'SELECT titulo, conteudo_original, metadata::text as metadata FROM knowledge_sources WHERE id = $1',
    input.id,
  )
  if (!row) throw new Error('Fonte não encontrada')
  let context_hint: string | null = null
  try {
    const meta = JSON.parse(row.metadata)
    context_hint = meta?.context_hint ?? null
  } catch { /* ok */ }
  return { titulo: row.titulo, conteudo_original: row.conteudo_original, context_hint }
})

const knowledgeExtrairTexto = t.procedure
  .input<{ caminho_arquivo: string }>()
  .action(async ({ input }) => {
  const fs = require('node:fs') as typeof import('node:fs')
  const p = require('node:path') as typeof import('node:path')

  if (!fs.existsSync(input.caminho_arquivo)) {
    throw new Error(`Arquivo não encontrado: ${input.caminho_arquivo}`)
  }

  const ext = p.extname(input.caminho_arquivo).toLowerCase()
  const nome_arquivo = p.basename(input.caminho_arquivo, ext)

  if (ext === '.pdf') {
    try {
      // pdf-parse v1 exports a single function
      const pdfParse = require('pdf-parse') as (buffer: Buffer) => Promise<{ text: string }>
      const buffer = fs.readFileSync(input.caminho_arquivo)
      const data = await pdfParse(buffer)
      return { texto: data.text, nome_arquivo }
    } catch (err: any) {
      throw new Error(`Não foi possível extrair texto do PDF. Tente copiar e colar o conteúdo. (${err?.message})`)
    }
  }

  // .md, .txt, ou qualquer texto
  const texto = fs.readFileSync(input.caminho_arquivo, 'utf-8')
  return { texto, nome_arquivo }
})

const knowledgeGerarMetadataIa = t.procedure
  .input<{ texto: string; campo: 'titulo' | 'quando_consultar' | 'texto' }>()
  .action(async ({ input }) => {
  const { generateText } = await import('ai')
  const { createGoogleGenerativeAI } = await import('@ai-sdk/google')
  const { createOpenRouter } = await import('@openrouter/ai-sdk-provider')
  const { resolveProviderApiKey, resolveModel } = await import('./ia/config')

  const config = await queryOne<{
    provider: 'gemini' | 'openrouter'
    api_key: string
    modelo: string
    provider_configs_json?: string
  }>('SELECT * FROM configuracao_ia LIMIT 1')

  if (!config) throw new Error('IA não configurada.')

  const apiKey = resolveProviderApiKey(config as any)
  if (!apiKey) throw new Error('API Key não configurada.')

  const modelo = resolveModel(config as any, config.provider)

  let createModel: (m: string) => any
  if (config.provider === 'gemini') {
    const google = createGoogleGenerativeAI({ apiKey })
    createModel = (m) => google(m)
  } else {
    const openrouter = createOpenRouter({ apiKey })
    createModel = (m) => openrouter(m)
  }

  const prompts: Record<string, string> = {
    titulo: `Gere um título curto (máximo 80 caracteres) para o seguinte documento. Responda APENAS com o título, sem aspas, sem explicação.\n\n${input.texto.slice(0, 3000)}`,
    quando_consultar: `Gere uma frase curta (máximo 200 caracteres) descrevendo QUANDO a IA deve consultar este documento. Exemplo: "Quando o usuário perguntar sobre regras de hora extra" ou "Quando precisar de informações sobre o acordo coletivo". Responda APENAS com a frase, sem aspas.\n\n${input.texto.slice(0, 3000)}`,
    texto: `Corrija a ortografia e gramática do texto abaixo SEM mudar o conteúdo ou significado. Mantenha a formatação original (markdown, listas, etc). Responda APENAS com o texto corrigido.\n\n${input.texto.slice(0, 8000)}`,
  }

  const prompt = prompts[input.campo]
  if (!prompt) throw new Error(`Campo inválido: ${input.campo}`)

  const result = await generateText({
    model: createModel(modelo),
    prompt,
  })

  return { resultado: result.text.trim() }
})

const knowledgeImportarCompleto = t.procedure
  .input<{ titulo: string; conteudo: string; quando_consultar: string }>()
  .action(async ({ input }) => {
  const { ingestKnowledge } = await import('./knowledge/ingest')

  // Prepend context hint como HTML comment
  const conteudoComHint = input.quando_consultar
    ? `<!-- quando_usar: ${input.quando_consultar} -->\n${input.conteudo}`
    : input.conteudo

  const result = await ingestKnowledge(input.titulo, conteudoComHint, 'high', {
    tipo: 'manual',
    context_hint: input.quando_consultar,
  })

  return result
})

// =============================================================================
// KNOWLEDGE GRAPH — Fase 6
// =============================================================================

const knowledgeRebuildGraph = t.procedure
  .input<{ origem?: 'sistema' | 'usuario' }>()
  .action(async ({ input }) => {
    const { rebuildGraph } = await import('./knowledge/graph')
    const { buildModelFactory } = await import('./ia/config')

    const config = await queryOne<import('@shared/index').IaConfiguracao>(
      'SELECT * FROM configuracao_ia LIMIT 1')
    if (!config) throw new Error('IA nao configurada. Configure um provider nas Configuracoes.')

    const factory = buildModelFactory(config)
    if (!factory) throw new Error('API Key nao configurada. Configure nas Configuracoes.')

    const origem = input?.origem ?? 'usuario'
    const result = await rebuildGraph(factory.createModel, factory.modelo, origem)
    return result
  })

const knowledgeGraphStats = t.procedure
  .input<{ origem?: 'sistema' | 'usuario' }>()
  .action(async ({ input }) => {
    const { graphStats } = await import('./knowledge/graph')
    return await graphStats(input?.origem)
  })

/**
 * DEV-ONLY: Rebuild graph do sistema (LLM) + export seed JSON.
 * O JSON gerado é commitado no repo e usado pelo seed em produção (sem LLM).
 */
const knowledgeRebuildAndExportSistema = t.procedure.action(async () => {
  const { rebuildGraph, exportGraphSeed } = await import('./knowledge/graph')
  const { buildModelFactory } = await import('./ia/config')

  const config = await queryOne<import('@shared/index').IaConfiguracao>(
    'SELECT * FROM configuracao_ia LIMIT 1')
  if (!config) throw new Error('IA nao configurada.')

  const factory = buildModelFactory(config)
  if (!factory) throw new Error('API Key nao configurada.')

  // 1. Rebuild com LLM
  const result = await rebuildGraph(factory.createModel, factory.modelo, 'sistema')

  // 2. Export seed JSON pra knowledge/sistema/
  const seed = await exportGraphSeed('sistema')
  const fs = require('node:fs') as typeof import('node:fs')
  const path = require('node:path') as typeof import('node:path')
  const seedPath = path.join(process.cwd(), 'knowledge', 'sistema', 'graph-seed.json')
  fs.writeFileSync(seedPath, JSON.stringify(seed, null, 2))

  console.log(`[GRAPH] Sistema: ${seed.entities.length} entidades, ${seed.relations.length} relacoes → ${seedPath}`)

  return {
    ...result,
    seed_entities: seed.entities.length,
    seed_relations: seed.relations.length,
    exported_to: seedPath,
  }
})

// =============================================================================
// KNOWLEDGE GRAPH VISUALIZER (2 handlers)
// =============================================================================

const knowledgeGraphData = t.procedure
  .input<{ origem?: 'sistema' | 'usuario'; limite?: number }>()
  .action(async ({ input }) => {
    const origem = input?.origem ?? 'usuario'
    const limite = input?.limite ?? 300

    const entities = await queryAll<{ id: number; nome: string; tipo: string }>(
      `SELECT id, nome, tipo FROM knowledge_entities
       WHERE origem = $1 AND (valid_to IS NULL OR valid_to > NOW())
       ORDER BY criada_em DESC
       LIMIT $2`,
      origem, limite,
    )

    const entityIds = entities.map(e => e.id)
    if (entityIds.length === 0) {
      return { nodes: [], links: [] }
    }

    const relations = await queryAll<{
      source: number; target: number; tipo_relacao: string; peso: number
    }>(
      `SELECT kr.entity_from_id AS source, kr.entity_to_id AS target,
              kr.tipo_relacao, kr.peso
       FROM knowledge_relations kr
       WHERE kr.entity_from_id = ANY($1::int[])
         AND kr.entity_to_id = ANY($1::int[])
         AND (kr.valid_to IS NULL OR kr.valid_to > NOW())`,
      `{${entityIds.join(',')}}`,
    )

    return {
      nodes: entities.map(e => ({ id: e.id, nome: e.nome, tipo: e.tipo })),
      links: relations,
    }
  })

const knowledgeGraphExplore = t.procedure
  .input<{ entidade: string; profundidade?: number }>()
  .action(async ({ input }) => {
    const { exploreRelations } = await import('./knowledge/search')
    return await exploreRelations(input.entidade, input.profundidade ?? 2)
  })

// =============================================================================
// ROUTER
// =============================================================================

export const router = {
  // Empresa
  'empresa.buscar': empresaBuscar,
  'empresa.atualizar': empresaAtualizar,
  'empresa.horarios.listar': empresaHorariosListar,
  'empresa.horarios.atualizar': empresaHorariosAtualizar,
  // Tipos Contrato
  'tiposContrato.listar': tiposContratoListar,
  'tiposContrato.buscar': tiposContratoBuscar,
  'tiposContrato.criar': tiposContratoCriar,
  'tiposContrato.atualizar': tiposContratoAtualizar,
  'tiposContrato.deletar': tiposContratoDeletar,
  'tiposContrato.listarPerfisHorario': tiposContratoListarPerfisHorario,
  'tiposContrato.criarPerfilHorario': tiposContratoCriarPerfilHorario,
  'tiposContrato.atualizarPerfilHorario': tiposContratoAtualizarPerfilHorario,
  'tiposContrato.deletarPerfilHorario': tiposContratoDeletarPerfilHorario,
  // Setores
  'setores.listar': setoresListar,
  'setores.buscar': setoresBuscar,
  'setores.criar': setoresCriar,
  'setores.atualizar': setoresAtualizar,
  'setores.deletar': setoresDeletar,
  'setores.listarDemandas': setoresListarDemandas,
  'setores.criarDemanda': setoresCriarDemanda,
  'setores.atualizarDemanda': setoresAtualizarDemanda,
  'setores.deletarDemanda': setoresDeletarDemanda,
  'setores.reordenarRank': setoresReordenarRank,
  'setores.listarHorarioSemana': setoresListarHorarioSemana,
  'setores.upsertHorarioSemana': setoresUpsertHorarioSemana,
  'setores.salvarTimelineDia': setoresSalvarTimelineDia,
  'setores.listarDemandasExcecaoData': setoresListarDemandasExcecaoData,
  'setores.salvarDemandaExcecaoData': setoresSalvarDemandaExcecaoData,
  'setores.deletarDemandaExcecaoData': setoresDeletarDemandaExcecaoData,
  // Funcoes
  'funcoes.listar': funcoesListar,
  'funcoes.buscar': funcoesBuscar,
  'funcoes.criar': funcoesCriar,
  'funcoes.atualizar': funcoesAtualizar,
  'funcoes.deletar': funcoesDeletar,
  // Feriados
  'feriados.listar': feriadosListar,
  'feriados.criar': feriadosCriar,
  'feriados.deletar': feriadosDeletar,
  // Colaboradores
  'colaboradores.listar': colaboradoresListar,
  'colaboradores.buscar': colaboradoresBuscar,
  'colaboradores.criar': colaboradoresCriar,
  'colaboradores.atualizar': colaboradoresAtualizar,
  'colaboradores.deletar': colaboradoresDeletar,
  'colaboradores.buscarRegraHorario': colaboradoresBuscarRegraHorario,
  'colaboradores.salvarRegraHorario': colaboradoresSalvarRegraHorario,
  'colaboradores.deletarRegraHorario': colaboradoresDeletarRegraHorario,
  'colaboradores.listarRegrasExcecaoData': colaboradoresListarRegrasExcecaoData,
  'colaboradores.upsertRegraExcecaoData': colaboradoresUpsertRegraExcecaoData,
  'colaboradores.deletarRegraExcecaoData': colaboradoresDeletarRegraExcecaoData,
  // Excecoes
  'excecoes.listar': excecoesListar,
  'excecoes.listarAtivas': excecoesListarAtivas,
  'excecoes.criar': excecoesCriar,
  'excecoes.atualizar': excecoesAtualizar,
  'excecoes.deletar': excecoesDeletar,
  // Escalas
  'escalas.buscar': escalasBuscar,
  'escalas.resumoPorSetor': escalasResumoPorSetor,
  'escalas.listarPorSetor': escalasListarPorSetor,
  'escalas.preflight': escalasPreflight,
  'escalas.oficializar': escalasOficializar,
  'escalas.ajustar': escalasAjustar,
  'escalas.deletar': escalasDeletar,
  'escalas.gerar': escalasGerar,
  'escalas.detectarCicloRotativo': escalasDetectarCicloRotativo,
  'escalas.salvarCicloRotativo': escalasSalvarCicloRotativo,
  'escalas.listarCiclosRotativos': escalasListarCiclosRotativos,
  'escalas.gerarPorCicloRotativo': escalasGerarPorCicloRotativo,
  // Dashboard
  'dashboard.resumo': dashboardResumo,
  // Export
  'export.salvarHTML': exportSalvarHTML,
  'export.imprimirPDF': exportImprimirPDF,
  'export.salvarCSV': exportSalvarCSV,
  'export.batchHTML': exportBatchHTML,
  // Regras do Motor
  'regras.listar': regrasListar,
  'regras.atualizar': regrasAtualizar,
  'regras.resetarEmpresa': regrasResetarEmpresa,
  'regras.resetarRegra': regrasResetarRegra,
  // IA
  'ia.configuracao.obter': iaConfiguracaoObter,
  'ia.configuracao.salvar': iaConfiguracaoSalvar,
  'ia.configuracao.testar': iaConfiguracaoTestar,
  'ia.modelos.catalogo': iaModelosCatalogo,
  'ia.chat.lerArquivo': iaChatLerArquivo,
  'ia.chat.salvarAnexo': iaChatSalvarAnexo,
  'ia.chat.lerAnexoPreview': iaChatLerAnexoPreview,
  'ia.chat.enviar': iaChatEnviar,
  'ia.conversas.listar': iaConversasListar,
  'ia.conversas.obter': iaConversasObter,
  'ia.conversas.criar': iaConversasCriar,
  'ia.conversas.renomear': iaConversasRenomear,
  'ia.conversas.arquivar': iaConversasArquivar,
  'ia.conversas.restaurar': iaConversasRestaurar,
  'ia.conversas.deletar': iaConversasDeletar,
  'ia.conversas.arquivarTodas': iaConversasArquivarTodas,
  'ia.conversas.deletarArquivadas': iaConversasDeletarArquivadas,
  'ia.mensagens.salvar': iaMensagensSalvar,
  'ia.mensagens.atualizar': iaMensagensAtualizar,
  'ia.mensagens.deletarApos': iaMensagensDeletarApos,
  'ia.conversas.exportar': iaConversasExportar,
  // Session Processing
  'ia.sessao.processar': iaSessaoProcessar,
  'ia.config.memoriaAutomatica': iaConfigMemoriaAutomatica,
  // Memórias IA
  'ia.memorias.listar': iaMemoriasListar,
  'ia.memorias.salvar': iaMemoriasSalvar,
  'ia.memorias.remover': iaMemoriasRemover,
  'ia.memorias.contar': iaMemoriasContar,
  // Knowledge
  'knowledge.listarFontes': knowledgeListarFontes,
  'knowledge.stats': knowledgeStats,
  'knowledge.escolherArquivo': knowledgeEscolherArquivo,
  'knowledge.importar': knowledgeImportar,
  'knowledge.removerFonte': knowledgeRemoverFonte,
  'knowledge.toggleAtivo': knowledgeToggleAtivo,
  'knowledge.obterTextoOriginal': knowledgeObterTextoOriginal,
  'knowledge.extrairTexto': knowledgeExtrairTexto,
  'knowledge.gerarMetadataIa': knowledgeGerarMetadataIa,
  'knowledge.importarCompleto': knowledgeImportarCompleto,
  'knowledge.rebuildGraph': knowledgeRebuildGraph,
  'knowledge.graphStats': knowledgeGraphStats,
  'knowledge.rebuildAndExportSistema': knowledgeRebuildAndExportSistema,
  'knowledge.graphData': knowledgeGraphData,
  'knowledge.graphExplore': knowledgeGraphExplore,
  // Backup / Restore
  'dados.exportar': dadosExportar,
  'dados.importar': dadosImportar,
}

export type Router = typeof router
