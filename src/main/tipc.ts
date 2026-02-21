import { writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { getDb } from './db/database'
import { validarEscalaV3 } from './motor/validador'
import { buildSolverInput, computeSolverScenarioHash, runSolver } from './motor/solver-bridge'
import path from 'node:path'
import { iaEnviarMensagem, iaTestarConexao } from './ia/cliente'
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
const { dialog, BrowserWindow } = electron

type RegimeEscalaInput = '5X2' | '6X1'

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
  const piso = Math.max(1, Number(input.piso_operacional ?? 1))
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
    if (label === 'DOM' && input.colaboradores.every((c) => !c.trabalha_domingo)) {
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
    const requiredMin = Math.max(piso, peakDemand)
    const availableCount = input.colaboradores.filter((c) => {
      if (label === 'DOM' && !c.trabalha_domingo) return false
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
  // Verifica se a janela (fim_max - inicio_min) de cada dia multiplicada pelos dias de trabalho
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

function buildEscalaPreflight(
  setorId: number,
  dataInicio: string,
  dataFim: string,
  regimesOverride?: SimulacaoRegimeOverride[],
): EscalaPreflightResult {
  const db = getDb()
  const blockers: EscalaPreflightResult['blockers'] = []
  const warnings: EscalaPreflightResult['warnings'] = []

  const setor = db.prepare('SELECT id, ativo FROM setores WHERE id = ?').get(setorId) as { id: number; ativo: number } | undefined
  if (!setor || setor.ativo !== 1) {
    blockers.push({
      codigo: 'SETOR_INVALIDO',
      severidade: 'BLOCKER',
      mensagem: `Setor ${setorId} nao encontrado ou inativo.`,
    })
  }

  const colabsAtivos = (
    db.prepare('SELECT COUNT(*) as count FROM colaboradores WHERE setor_id = ? AND ativo = 1').get(setorId) as { count: number }
  ).count
  if (colabsAtivos === 0) {
    blockers.push({
      codigo: 'SEM_COLABORADORES',
      severidade: 'BLOCKER',
      mensagem: 'Setor nao tem colaboradores ativos.',
      detalhe: 'Cadastre ao menos 1 colaborador para gerar escala.',
    })
  }

  const demandasCount = (
    db.prepare('SELECT COUNT(*) as count FROM demandas WHERE setor_id = ?').get(setorId) as { count: number }
  ).count
  if (demandasCount === 0) {
    warnings.push({
      codigo: 'SEM_DEMANDA',
      severidade: 'WARNING',
      mensagem: 'Setor sem demanda planejada cadastrada.',
      detalhe: 'O motor vai considerar demanda zero nos slots sem segmento cadastrado.',
    })
  }

  const feriadosNoPeriodo = (
    db.prepare('SELECT COUNT(*) as count FROM feriados WHERE data BETWEEN ? AND ?').get(dataInicio, dataFim) as { count: number }
  ).count

  if (blockers.length === 0) {
    try {
      const input = buildSolverInput(setorId, dataInicio, dataFim, undefined, {
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
    const db = getDb()
    const empresa = db.prepare('SELECT * FROM empresa LIMIT 1').get()
    if (!empresa) throw new Error('Empresa nao configurada')
    return empresa
  })

const empresaAtualizar = t.procedure
  .input<{ nome: string; cnpj: string; telefone: string; corte_semanal: string; tolerancia_semanal_min: number; min_intervalo_almoco_min?: number; usa_cct_intervalo_reduzido?: boolean }>()
  .action(async ({ input }) => {
    const db = getDb()
    const empresa = db.prepare('SELECT id FROM empresa LIMIT 1').get() as { id: number } | undefined

    if (empresa) {
      db.prepare(`UPDATE empresa SET nome = ?, cnpj = ?, telefone = ?, corte_semanal = ?, tolerancia_semanal_min = ?,
        min_intervalo_almoco_min = ?, usa_cct_intervalo_reduzido = ? WHERE id = ?`)
        .run(
          input.nome, input.cnpj, input.telefone, input.corte_semanal, input.tolerancia_semanal_min,
          input.min_intervalo_almoco_min ?? 60,
          input.usa_cct_intervalo_reduzido !== false ? 1 : 0,
          empresa.id
        )
    } else {
      db.prepare(`INSERT INTO empresa (nome, cnpj, telefone, corte_semanal, tolerancia_semanal_min, min_intervalo_almoco_min, usa_cct_intervalo_reduzido)
        VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run(
          input.nome, input.cnpj, input.telefone, input.corte_semanal, input.tolerancia_semanal_min,
          input.min_intervalo_almoco_min ?? 60,
          input.usa_cct_intervalo_reduzido !== false ? 1 : 0
        )
    }

    return db.prepare('SELECT * FROM empresa LIMIT 1').get()
  })

// =============================================================================
// TIPOS CONTRATO (5 handlers)
// =============================================================================

const tiposContratoListar = t.procedure
  .action(async () => {
    const db = getDb()
    return db.prepare('SELECT * FROM tipos_contrato ORDER BY horas_semanais DESC').all()
  })

const tiposContratoBuscar = t.procedure
  .input<{ id: number }>()
  .action(async ({ input }) => {
    const db = getDb()
    const tipo = db.prepare('SELECT * FROM tipos_contrato WHERE id = ?').get(input.id)
    if (!tipo) throw new Error('Tipo de contrato nao encontrado')
    return tipo
  })

const tiposContratoCriar = t.procedure
  .input<{
    nome: string
    horas_semanais: number
    regime_escala?: '5X2' | '6X1'
    dias_trabalho?: number
    trabalha_domingo: boolean
    max_minutos_dia: number
  }>()
  .action(async ({ input }) => {
    const db = getDb()
    const regime = input.regime_escala ?? ((input.dias_trabalho ?? 6) <= 5 ? '5X2' : '6X1')
    const diasTrabalho = regime === '5X2' ? 5 : 6
    const result = db.prepare(`
      INSERT INTO tipos_contrato (nome, horas_semanais, regime_escala, dias_trabalho, trabalha_domingo, max_minutos_dia)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(input.nome, input.horas_semanais, regime, diasTrabalho, input.trabalha_domingo ? 1 : 0, input.max_minutos_dia)

    return db.prepare('SELECT * FROM tipos_contrato WHERE id = ?').get(result.lastInsertRowid)
  })

const tiposContratoAtualizar = t.procedure
  .input<{
    id: number
    nome: string
    horas_semanais: number
    regime_escala?: '5X2' | '6X1'
    dias_trabalho?: number
    trabalha_domingo: boolean
    max_minutos_dia: number
  }>()
  .action(async ({ input }) => {
    const db = getDb()
    const regime = input.regime_escala ?? ((input.dias_trabalho ?? 6) <= 5 ? '5X2' : '6X1')
    const diasTrabalho = regime === '5X2' ? 5 : 6
    db.prepare(`
      UPDATE tipos_contrato SET nome = ?, horas_semanais = ?, regime_escala = ?, dias_trabalho = ?,
      trabalha_domingo = ?, max_minutos_dia = ? WHERE id = ?
    `).run(input.nome, input.horas_semanais, regime, diasTrabalho, input.trabalha_domingo ? 1 : 0, input.max_minutos_dia, input.id)

    return db.prepare('SELECT * FROM tipos_contrato WHERE id = ?').get(input.id)
  })

const tiposContratoDeletar = t.procedure
  .input<{ id: number }>()
  .action(async ({ input }) => {
    const db = getDb()
    const count = db.prepare('SELECT COUNT(*) as count FROM colaboradores WHERE tipo_contrato_id = ?').get(input.id) as { count: number }
    if (count.count > 0) {
      throw new Error(`${count.count} colaboradores usam este contrato. Mova-os antes de deletar.`)
    }
    db.prepare('DELETE FROM tipos_contrato WHERE id = ?').run(input.id)
    return undefined
  })

// =============================================================================
// TIPOS CONTRATO — PERFIS DE HORÁRIO (4 handlers)
// =============================================================================

const tiposContratoListarPerfisHorario = t.procedure
  .input<{ tipo_contrato_id: number }>()
  .action(async ({ input }) => {
    const db = getDb()
    return db.prepare('SELECT * FROM contrato_perfis_horario WHERE tipo_contrato_id = ? ORDER BY ordem, id').all(input.tipo_contrato_id)
  })

const tiposContratoCriarPerfilHorario = t.procedure
  .input<{
    tipo_contrato_id: number
    nome: string
    inicio_min: string
    inicio_max: string
    fim_min: string
    fim_max: string
    preferencia_turno_soft?: string | null
    ordem?: number
  }>()
  .action(async ({ input }) => {
    const db = getDb()
    const result = db.prepare(`
      INSERT INTO contrato_perfis_horario (tipo_contrato_id, nome, inicio_min, inicio_max, fim_min, fim_max, preferencia_turno_soft, ordem)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.tipo_contrato_id, input.nome,
      input.inicio_min, input.inicio_max, input.fim_min, input.fim_max,
      input.preferencia_turno_soft ?? null, input.ordem ?? 0
    )
    return db.prepare('SELECT * FROM contrato_perfis_horario WHERE id = ?').get(result.lastInsertRowid)
  })

const tiposContratoAtualizarPerfilHorario = t.procedure
  .input<{
    id: number
    nome?: string
    ativo?: boolean
    inicio_min?: string
    inicio_max?: string
    fim_min?: string
    fim_max?: string
    preferencia_turno_soft?: string | null
    ordem?: number
  }>()
  .action(async ({ input }) => {
    const db = getDb()
    const { id, ...rest } = input
    const fields: string[] = []
    const values: unknown[] = []
    if (rest.nome !== undefined) { fields.push('nome = ?'); values.push(rest.nome) }
    if (rest.ativo !== undefined) { fields.push('ativo = ?'); values.push(rest.ativo ? 1 : 0) }
    if (rest.inicio_min !== undefined) { fields.push('inicio_min = ?'); values.push(rest.inicio_min) }
    if (rest.inicio_max !== undefined) { fields.push('inicio_max = ?'); values.push(rest.inicio_max) }
    if (rest.fim_min !== undefined) { fields.push('fim_min = ?'); values.push(rest.fim_min) }
    if (rest.fim_max !== undefined) { fields.push('fim_max = ?'); values.push(rest.fim_max) }
    if ('preferencia_turno_soft' in rest) { fields.push('preferencia_turno_soft = ?'); values.push(rest.preferencia_turno_soft ?? null) }
    if (rest.ordem !== undefined) { fields.push('ordem = ?'); values.push(rest.ordem) }
    if (fields.length > 0) {
      values.push(id)
      db.prepare(`UPDATE contrato_perfis_horario SET ${fields.join(', ')} WHERE id = ?`).run(...values)
    }
    return db.prepare('SELECT * FROM contrato_perfis_horario WHERE id = ?').get(id)
  })

const tiposContratoDeletarPerfilHorario = t.procedure
  .input<{ id: number }>()
  .action(async ({ input }) => {
    const db = getDb()
    db.prepare('DELETE FROM contrato_perfis_horario WHERE id = ?').run(input.id)
    return undefined
  })

// =============================================================================
// SETORES (5 handlers) + DEMANDAS (4 handlers) + RANK (1 handler)
// =============================================================================

const setoresListar = t.procedure
  .input<{ ativo?: boolean }>()
  .action(async ({ input }) => {
    const db = getDb()
    let sql = 'SELECT * FROM setores'
    const params: unknown[] = []

    if (input?.ativo !== undefined) {
      sql += ' WHERE ativo = ?'
      params.push(input.ativo ? 1 : 0)
    }
    sql += ' ORDER BY nome'

    return db.prepare(sql).all(...params)
  })

const setoresBuscar = t.procedure
  .input<{ id: number }>()
  .action(async ({ input }) => {
    const db = getDb()
    const setor = db.prepare('SELECT * FROM setores WHERE id = ?').get(input.id)
    if (!setor) throw new Error('Setor nao encontrado')
    return setor
  })

const setoresCriar = t.procedure
  .input<{ nome: string; hora_abertura: string; hora_fechamento: string; icone?: string | null; piso_operacional?: number }>()
  .action(async ({ input }) => {
    const db = getDb()
    if (input.piso_operacional !== undefined && (!Number.isInteger(input.piso_operacional) || input.piso_operacional < 1)) {
      throw new Error('piso_operacional deve ser inteiro >= 1')
    }
    const result = db.prepare(`
      INSERT INTO setores (nome, icone, hora_abertura, hora_fechamento, piso_operacional)
      VALUES (?, ?, ?, ?, ?)
    `).run(input.nome, input.icone ?? null, input.hora_abertura, input.hora_fechamento, input.piso_operacional ?? 1)

    return db.prepare('SELECT * FROM setores WHERE id = ?').get(result.lastInsertRowid)
  })

const setoresAtualizar = t.procedure
  .input<{ id: number; nome?: string; icone?: string | null; hora_abertura?: string; hora_fechamento?: string; ativo?: boolean; piso_operacional?: number }>()
  .action(async ({ input }) => {
    const db = getDb()
    const fields: string[] = []
    const values: unknown[] = []

    if (input.nome !== undefined) { fields.push('nome = ?'); values.push(input.nome) }
    if (input.icone !== undefined) { fields.push('icone = ?'); values.push(input.icone) }
    if (input.hora_abertura !== undefined) { fields.push('hora_abertura = ?'); values.push(input.hora_abertura) }
    if (input.hora_fechamento !== undefined) { fields.push('hora_fechamento = ?'); values.push(input.hora_fechamento) }
    if (input.ativo !== undefined) { fields.push('ativo = ?'); values.push(input.ativo ? 1 : 0) }
    if (input.piso_operacional !== undefined) {
      if (!Number.isInteger(input.piso_operacional) || input.piso_operacional < 1) {
        throw new Error('piso_operacional deve ser inteiro >= 1')
      }
      fields.push('piso_operacional = ?')
      values.push(input.piso_operacional)
    }

    if (fields.length > 0) {
      values.push(input.id)
      db.prepare(`UPDATE setores SET ${fields.join(', ')} WHERE id = ?`).run(...values)
    }

    return db.prepare('SELECT * FROM setores WHERE id = ?').get(input.id)
  })

const setoresDeletar = t.procedure
  .input<{ id: number }>()
  .action(async ({ input }) => {
    const db = getDb()
    db.prepare('DELETE FROM setores WHERE id = ?').run(input.id)
    return undefined
  })

// --- Demandas ---

const setoresListarDemandas = t.procedure
  .input<{ setor_id: number }>()
  .action(async ({ input }) => {
    const db = getDb()
    return db.prepare(`
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
    `).all(input.setor_id)
  })

const setoresCriarDemanda = t.procedure
  .input<{ setor_id: number; dia_semana?: string | null; hora_inicio: string; hora_fim: string; min_pessoas: number; override?: boolean }>()
  .action(async ({ input }) => {
    const db = getDb()
    const setor = db.prepare('SELECT * FROM setores WHERE id = ?').get(input.setor_id) as { hora_abertura: string; hora_fechamento: string } | undefined
    if (!setor) throw new Error('Setor nao encontrado')

    if (!Number.isInteger(input.min_pessoas) || input.min_pessoas < 1) {
      throw new Error('min_pessoas deve ser inteiro >= 1')
    }

    const horarioDia = input.dia_semana
      ? (db.prepare(`
          SELECT ativo, hora_abertura, hora_fechamento
          FROM setor_horario_semana
          WHERE setor_id = ? AND dia_semana = ?
        `).get(input.setor_id, input.dia_semana) as { ativo: number; hora_abertura: string; hora_fechamento: string } | undefined)
      : undefined

    if (horarioDia && horarioDia.ativo === 0) {
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

    const result = db.prepare(`
      INSERT INTO demandas (setor_id, dia_semana, hora_inicio, hora_fim, min_pessoas, override)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(input.setor_id, input.dia_semana ?? null, input.hora_inicio, input.hora_fim, input.min_pessoas, input.override ? 1 : 0)

    return db.prepare('SELECT * FROM demandas WHERE id = ?').get(result.lastInsertRowid)
  })

const setoresAtualizarDemanda = t.procedure
  .input<{ id: number; dia_semana?: string | null; hora_inicio?: string; hora_fim?: string; min_pessoas?: number; override?: boolean }>()
  .action(async ({ input }) => {
    const db = getDb()
    const demanda = db.prepare('SELECT * FROM demandas WHERE id = ?').get(input.id) as { setor_id: number; dia_semana: string | null; hora_inicio: string; hora_fim: string } | undefined
    if (!demanda) throw new Error('Demanda nao encontrada')

    const setor = db.prepare('SELECT * FROM setores WHERE id = ?').get(demanda.setor_id) as { hora_abertura: string; hora_fechamento: string }
    const diaSemAtual = input.dia_semana !== undefined ? input.dia_semana : demanda.dia_semana
    const horarioDia = diaSemAtual
      ? (db.prepare(`
          SELECT ativo, hora_abertura, hora_fechamento
          FROM setor_horario_semana
          WHERE setor_id = ? AND dia_semana = ?
        `).get(demanda.setor_id, diaSemAtual) as { ativo: number; hora_abertura: string; hora_fechamento: string } | undefined)
      : undefined

    if (horarioDia && horarioDia.ativo === 0) {
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
    if (input.override !== undefined) { fields.push('override = ?'); values.push(input.override ? 1 : 0) }

    if (fields.length > 0) {
      values.push(input.id)
      db.prepare(`UPDATE demandas SET ${fields.join(', ')} WHERE id = ?`).run(...values)
    }

    return db.prepare('SELECT * FROM demandas WHERE id = ?').get(input.id)
  })

const setoresDeletarDemanda = t.procedure
  .input<{ id: number }>()
  .action(async ({ input }) => {
    const db = getDb()
    db.prepare('DELETE FROM demandas WHERE id = ?').run(input.id)
    return undefined
  })

// --- Rank ---

const setoresReordenarRank = t.procedure
  .input<{ setor_id: number; colaborador_ids: number[] }>()
  .action(async ({ input }) => {
    const db = getDb()
    const updateRank = db.prepare('UPDATE colaboradores SET rank = ? WHERE id = ? AND setor_id = ?')

    const reorder = db.transaction(() => {
      for (let i = 0; i < input.colaborador_ids.length; i++) {
        updateRank.run(input.colaborador_ids.length - i, input.colaborador_ids[i], input.setor_id)
      }
    })
    reorder()

    return undefined
  })

// =============================================================================
// COLABORADORES (5 handlers)
// =============================================================================

const colaboradoresListar = t.procedure
  .input<{ setor_id?: number; ativo?: boolean }>()
  .action(async ({ input }) => {
    const db = getDb()
    let sql = 'SELECT * FROM colaboradores WHERE 1=1'
    const params: unknown[] = []

    if (input?.setor_id !== undefined) {
      sql += ' AND setor_id = ?'
      params.push(input.setor_id)
    }
    if (input?.ativo !== undefined) {
      sql += ' AND ativo = ?'
      params.push(input.ativo ? 1 : 0)
    }
    sql += ' ORDER BY rank DESC, nome'

    return db.prepare(sql).all(...params)
  })

const colaboradoresBuscar = t.procedure
  .input<{ id: number }>()
  .action(async ({ input }) => {
    const db = getDb()
    const colab = db.prepare('SELECT * FROM colaboradores WHERE id = ?').get(input.id)
    if (!colab) throw new Error('Colaborador nao encontrado')
    return colab
  })

const colaboradoresCriar = t.procedure
  .input<{ setor_id: number; tipo_contrato_id: number; nome: string; sexo: string; horas_semanais?: number; rank?: number; prefere_turno?: string | null; evitar_dia_semana?: string | null; tipo_trabalhador?: string; funcao_id?: number | null }>()
  .action(async ({ input }) => {
    const db = getDb()

    let horasSemanais = input.horas_semanais
    if (horasSemanais === undefined) {
      const tipo = db.prepare('SELECT horas_semanais FROM tipos_contrato WHERE id = ?').get(input.tipo_contrato_id) as { horas_semanais: number } | undefined
      if (!tipo) throw new Error('Tipo de contrato nao encontrado')
      horasSemanais = tipo.horas_semanais
    }

    const result = db.prepare(`
      INSERT INTO colaboradores (setor_id, tipo_contrato_id, nome, sexo, horas_semanais, rank, prefere_turno, evitar_dia_semana, tipo_trabalhador, funcao_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
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

    return db.prepare('SELECT * FROM colaboradores WHERE id = ?').get(result.lastInsertRowid)
  })

const colaboradoresAtualizar = t.procedure
  .input<{ id: number; setor_id?: number; tipo_contrato_id?: number; nome?: string; sexo?: string; horas_semanais?: number; rank?: number; prefere_turno?: string | null; evitar_dia_semana?: string | null; ativo?: boolean; tipo_trabalhador?: string; funcao_id?: number | null }>()
  .action(async ({ input }) => {
    const db = getDb()

    // Validacao: se mudar de setor, nao pode ter escala RASCUNHO aberta
    if (input.setor_id !== undefined) {
      const atual = db.prepare('SELECT setor_id FROM colaboradores WHERE id = ?').get(input.id) as { setor_id: number } | undefined
      if (atual && input.setor_id !== atual.setor_id) {
        const rascunho = db.prepare(`
          SELECT COUNT(*) as count FROM escalas e
          JOIN alocacoes a ON a.escala_id = e.id
          WHERE a.colaborador_id = ? AND e.status = 'RASCUNHO'
        `).get(input.id) as { count: number }
        if (rascunho.count > 0) {
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
    if (input.ativo !== undefined) { fields.push('ativo = ?'); values.push(input.ativo ? 1 : 0) }
    if (input.tipo_trabalhador !== undefined) { fields.push('tipo_trabalhador = ?'); values.push(input.tipo_trabalhador) }
    if (input.funcao_id !== undefined) { fields.push('funcao_id = ?'); values.push(input.funcao_id) }

    if (fields.length > 0) {
      values.push(input.id)
      db.prepare(`UPDATE colaboradores SET ${fields.join(', ')} WHERE id = ?`).run(...values)
    }

    return db.prepare('SELECT * FROM colaboradores WHERE id = ?').get(input.id)
  })

const colaboradoresDeletar = t.procedure
  .input<{ id: number }>()
  .action(async ({ input }) => {
    const db = getDb()
    db.prepare('DELETE FROM colaboradores WHERE id = ?').run(input.id)
    return undefined
  })

// =============================================================================
// EXCECOES (5 handlers)
// =============================================================================

const excecoesListar = t.procedure
  .input<{ colaborador_id: number }>()
  .action(async ({ input }) => {
    const db = getDb()
    return db.prepare('SELECT * FROM excecoes WHERE colaborador_id = ? ORDER BY data_inicio').all(input.colaborador_id)
  })

const excecoesListarAtivas = t.procedure
  .input<Record<string, never>>()
  .action(async () => {
    const db = getDb()
    const hoje = new Date().toISOString().split('T')[0]
    return db.prepare('SELECT * FROM excecoes WHERE data_inicio <= ? AND data_fim >= ? ORDER BY tipo, data_inicio').all(hoje, hoje)
  })

const excecoesCriar = t.procedure
  .input<{ colaborador_id: number; data_inicio: string; data_fim: string; tipo: string; observacao?: string | null }>()
  .action(async ({ input }) => {
    const db = getDb()
    const result = db.prepare(`
      INSERT INTO excecoes (colaborador_id, data_inicio, data_fim, tipo, observacao)
      VALUES (?, ?, ?, ?, ?)
    `).run(input.colaborador_id, input.data_inicio, input.data_fim, input.tipo, input.observacao ?? null)

    return db.prepare('SELECT * FROM excecoes WHERE id = ?').get(result.lastInsertRowid)
  })

const excecoesAtualizar = t.procedure
  .input<{ id: number; data_inicio: string; data_fim: string; tipo: string; observacao?: string | null }>()
  .action(async ({ input }) => {
    const db = getDb()
    db.prepare(`
      UPDATE excecoes SET data_inicio = ?, data_fim = ?, tipo = ?, observacao = ? WHERE id = ?
    `).run(input.data_inicio, input.data_fim, input.tipo, input.observacao ?? null, input.id)

    return db.prepare('SELECT * FROM excecoes WHERE id = ?').get(input.id)
  })

const excecoesDeletar = t.procedure
  .input<{ id: number }>()
  .action(async ({ input }) => {
    const db = getDb()
    db.prepare('DELETE FROM excecoes WHERE id = ?').run(input.id)
    return undefined
  })

// =============================================================================
// ESCALAS (6 handlers)
// =============================================================================

const escalasBuscar = t.procedure
  .input<{ id: number }>()
  .action(async ({ input }): Promise<EscalaCompletaV3> => {
    const db = getDb()
    const escala = db.prepare('SELECT * FROM escalas WHERE id = ?').get(input.id) as Escala | undefined
    if (!escala) throw new Error('Escala nao encontrada')

    const alocacoes = db
      .prepare('SELECT * FROM alocacoes WHERE escala_id = ? ORDER BY data, colaborador_id')
      .all(input.id) as Alocacao[]

    const snapshotDecisoes = db.prepare(`
      SELECT ed.*,
             COALESCE(c.nome, 'Sistema') as colaborador_nome
      FROM escala_decisoes ed
      LEFT JOIN colaboradores c ON c.id = ed.colaborador_id
      WHERE ed.escala_id = ?
      ORDER BY ed.data, ed.colaborador_id, ed.id
    `).all(input.id) as Array<{
      colaborador_id: number
      colaborador_nome: string
      data: string
      acao: 'ALOCADO' | 'FOLGA' | 'MOVIDO' | 'REMOVIDO'
      razao: string
      alternativas_tentadas: number
    }>

    const snapshotComparacao = db.prepare(`
      SELECT data, hora_inicio, hora_fim, planejado, executado, delta, override, justificativa
      FROM escala_comparacao_demanda
      WHERE escala_id = ?
      ORDER BY data, hora_inicio, hora_fim, id
    `).all(input.id) as Array<{
      data: string
      hora_inicio: string
      hora_fim: string
      planejado: number
      executado: number
      delta: number
      override: number | boolean
      justificativa: string | null
    }>

    const base = validarEscalaV3(input.id, db)
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
    const db = getDb()
    return db.prepare(`
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
    `).all() as { setor_id: number; data_inicio: string; data_fim: string; status: string }[]
  })

const escalasListarPorSetor = t.procedure
  .input<{ setor_id: number; status?: string }>()
  .action(async ({ input }) => {
    const db = getDb()
    let sql = 'SELECT * FROM escalas WHERE setor_id = ?'
    const params: unknown[] = [input.setor_id]

    if (input.status) {
      sql += ' AND status = ?'
      params.push(input.status)
    }
    sql += ' ORDER BY data_inicio DESC'

    return db.prepare(sql).all(...params)
  })

const escalasPreflight = t.procedure
  .input<{
    setor_id: number
    data_inicio: string
    data_fim: string
    regimes_override?: SimulacaoRegimeOverride[]
  }>()
  .action(async ({ input }): Promise<EscalaPreflightResult> => {
    return buildEscalaPreflight(
      input.setor_id,
      input.data_inicio,
      input.data_fim,
      normalizeRegimesOverride(input.regimes_override),
    )
  })

const escalasOficializar = t.procedure
  .input<{ id: number }>()
  .action(async ({ input }) => {
    const db = getDb()
    const escala = db.prepare('SELECT * FROM escalas WHERE id = ?').get(input.id) as {
      setor_id: number
      status: string
      data_inicio: string
      data_fim: string
      input_hash?: string | null
      simulacao_config_json?: string | null
    } | undefined
    if (!escala) throw new Error('Escala nao encontrada')

    if (escala.input_hash) {
      const cfg = parseEscalaSimulacaoConfig(escala.simulacao_config_json ?? null)
      const currentInput = buildSolverInput(escala.setor_id, escala.data_inicio, escala.data_fim, undefined, {
        regimesOverride: cfg.regimes_override,
      })
      const currentHash = computeSolverScenarioHash(currentInput)
      if (currentHash !== escala.input_hash) {
        throw new Error(
          'ESCALA_DESATUALIZADA: Houve mudancas no cenario (demanda/contratos/excecoes). Gere novamente a simulacao antes de oficializar.',
        )
      }
    }

    const { indicadores } = validarEscalaV3(input.id, db)

    if (indicadores.violacoes_hard > 0) {
      throw new Error(`Escala tem ${indicadores.violacoes_hard} violacoes criticas. Corrija antes de oficializar.`)
    }

    // Arquivar oficial anterior do mesmo setor
    db.prepare(`
      UPDATE escalas SET status = 'ARQUIVADA'
      WHERE setor_id = ? AND status = 'OFICIAL'
    `).run(escala.setor_id)

    // Oficializar esta
    db.prepare("UPDATE escalas SET status = 'OFICIAL' WHERE id = ?").run(input.id)

    return db.prepare('SELECT * FROM escalas WHERE id = ?').get(input.id)
  })

const escalasAjustar = t.procedure
  .input<{ id: number; alocacoes: { colaborador_id: number; data: string; status: 'TRABALHO' | 'FOLGA' | 'INDISPONIVEL'; hora_inicio?: string | null; hora_fim?: string | null }[] }>()
  .action(async ({ input }): Promise<EscalaCompletaV3> => {
    const db = getDb()
    const escalaId = input.id

    const escala = db.prepare('SELECT * FROM escalas WHERE id = ?').get(escalaId) as {
      setor_id: number
      data_inicio: string
      data_fim: string
      status: string
      simulacao_config_json?: string | null
    } | undefined
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
    const solverInput = buildSolverInput(
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
        const diag = buildEscalaPreflight(
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
    const persist = db.transaction(() => {
      db.prepare('DELETE FROM alocacoes WHERE escala_id = ?').run(escalaId)
      db.prepare('DELETE FROM escala_decisoes WHERE escala_id = ?').run(escalaId)
      db.prepare('DELETE FROM escala_comparacao_demanda WHERE escala_id = ?').run(escalaId)

      const insertAloc = db.prepare(`
        INSERT INTO alocacoes
          (escala_id, colaborador_id, data, status, hora_inicio, hora_fim,
           minutos, minutos_trabalho, hora_almoco_inicio, hora_almoco_fim,
           minutos_almoco, intervalo_15min, funcao_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      for (const a of solverResult.alocacoes!) {
        insertAloc.run(
          escalaId, a.colaborador_id, a.data, a.status,
          a.hora_inicio ?? null, a.hora_fim ?? null,
          a.minutos_trabalho ?? null, a.minutos_trabalho ?? null,
          a.hora_almoco_inicio ?? null, a.hora_almoco_fim ?? null,
          a.minutos_almoco ?? null,
          a.intervalo_15min ? 1 : 0,
          a.funcao_id ?? null
        )
      }

      const insertDecisao = db.prepare(`
        INSERT INTO escala_decisoes (escala_id, colaborador_id, data, acao, razao, alternativas_tentadas)
        VALUES (?, ?, ?, ?, ?, ?)
      `)
      for (const d of decisoes) {
        insertDecisao.run(escalaId, d.colaborador_id, d.data, d.acao, d.razao, d.alternativas_tentadas)
      }

      const insertComp = db.prepare(`
        INSERT INTO escala_comparacao_demanda (escala_id, data, hora_inicio, hora_fim, planejado, executado, delta, override, justificativa)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      for (const c of comparacao) {
        insertComp.run(escalaId, c.data, c.hora_inicio, c.hora_fim, c.planejado, c.executado, c.delta, c.override ? 1 : 0, c.justificativa ?? null)
      }

      db.prepare(`
        UPDATE escalas
        SET pontuacao = ?, cobertura_percent = ?, violacoes_hard = ?, violacoes_soft = ?, equilibrio = ?, input_hash = ?, simulacao_config_json = ?
        WHERE id = ?
      `).run(
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
    persist()

    const escalaAtual = db.prepare('SELECT * FROM escalas WHERE id = ?').get(escalaId) as Escala
    const alocacoesDB = db.prepare('SELECT * FROM alocacoes WHERE escala_id = ? ORDER BY data, colaborador_id').all(escalaId) as Alocacao[]

    return {
      escala: escalaAtual,
      alocacoes: alocacoesDB,
      indicadores: ind,
      violacoes: [],
      antipatterns: [],
      decisoes,
      comparacao_demanda: comparacao,
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
    const db = getDb()
    db.prepare('DELETE FROM escalas WHERE id = ?').run(input.id)
    return undefined
  })

// Gerar escala via Python OR-Tools solver
const escalasGerar = t.procedure
  .input<{
    setor_id: number
    data_inicio: string
    data_fim: string
    regimes_override?: SimulacaoRegimeOverride[]
  }>()
  .action(async ({ input }): Promise<EscalaCompletaV3> => {
    const db = getDb()
    const setorId = input.setor_id
    const regimesOverride = normalizeRegimesOverride(input.regimes_override)

    // Preflight antes de chamar solver
    const preflight = buildEscalaPreflight(setorId, input.data_inicio, input.data_fim, regimesOverride)
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

    // Build input e chamar solver Python
    const solverInput = buildSolverInput(setorId, input.data_inicio, input.data_fim, undefined, {
      regimesOverride,
    })
    const inputHash = computeSolverScenarioHash(solverInput)
    const solverResult = await runSolver(solverInput, undefined, sendLog)

    if (!solverResult.sucesso || !solverResult.alocacoes || !solverResult.indicadores) {
      if (solverResult.status === 'INFEASIBLE') {
        const diag = buildEscalaPreflight(setorId, input.data_inicio, input.data_fim, regimesOverride)
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
    const persist = db.transaction(() => {
      const result = db.prepare(`
        INSERT INTO escalas
          (setor_id, data_inicio, data_fim, status, pontuacao,
           cobertura_percent, violacoes_hard, violacoes_soft, equilibrio, input_hash, simulacao_config_json)
        VALUES (?, ?, ?, 'RASCUNHO', ?, ?, ?, ?, ?, ?, ?)
      `).run(
        setorId, input.data_inicio, input.data_fim,
        ind.pontuacao, ind.cobertura_percent, ind.violacoes_hard, ind.violacoes_soft, ind.equilibrio,
        inputHash,
        JSON.stringify({ regimes_override: regimesOverride } satisfies EscalaSimulacaoConfig),
      )

      const escalaId = result.lastInsertRowid

      const insertAloc = db.prepare(`
        INSERT INTO alocacoes
          (escala_id, colaborador_id, data, status, hora_inicio, hora_fim,
           minutos, minutos_trabalho, hora_almoco_inicio, hora_almoco_fim,
           minutos_almoco, intervalo_15min, funcao_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      for (const a of solverResult.alocacoes!) {
        insertAloc.run(
          escalaId, a.colaborador_id, a.data, a.status,
          a.hora_inicio ?? null, a.hora_fim ?? null,
          a.minutos_trabalho ?? null, a.minutos_trabalho ?? null,
          a.hora_almoco_inicio ?? null, a.hora_almoco_fim ?? null,
          a.minutos_almoco ?? null,
          a.intervalo_15min ? 1 : 0,
          a.funcao_id ?? null
        )
      }

      const insertDecisao = db.prepare(`
        INSERT INTO escala_decisoes (escala_id, colaborador_id, data, acao, razao, alternativas_tentadas)
        VALUES (?, ?, ?, ?, ?, ?)
      `)
      for (const d of decisoes) {
        insertDecisao.run(escalaId, d.colaborador_id, d.data, d.acao, d.razao, d.alternativas_tentadas)
      }

      const insertComp = db.prepare(`
        INSERT INTO escala_comparacao_demanda (escala_id, data, hora_inicio, hora_fim, planejado, executado, delta, override, justificativa)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      for (const c of comparacao) {
        insertComp.run(escalaId, c.data, c.hora_inicio, c.hora_fim, c.planejado, c.executado, c.delta, c.override ? 1 : 0, c.justificativa ?? null)
      }

      return escalaId
    })

    const escalaId = persist()
    const escalaAtual = db.prepare('SELECT * FROM escalas WHERE id = ?').get(escalaId) as Escala
    const alocacoesDB = db.prepare('SELECT * FROM alocacoes WHERE escala_id = ? ORDER BY data, colaborador_id').all(escalaId) as Alocacao[]

    return {
      escala: escalaAtual,
      alocacoes: alocacoesDB,
      indicadores: ind,
      violacoes: [],
      antipatterns: [],
      decisoes,
      comparacao_demanda: comparacao,
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
    const db = getDb()

    const totalSetores = (db.prepare('SELECT COUNT(*) as count FROM setores WHERE ativo = 1').get() as { count: number }).count
    const totalColaboradores = (db.prepare('SELECT COUNT(*) as count FROM colaboradores WHERE ativo = 1').get() as { count: number }).count

    const hoje = new Date().toISOString().split('T')[0]
    const totalEmFerias = (db.prepare(`
      SELECT COUNT(DISTINCT colaborador_id) as count FROM excecoes
      WHERE tipo = 'FERIAS' AND data_inicio <= ? AND data_fim >= ?
    `).get(hoje, hoje) as { count: number }).count

    const totalEmAtestado = (db.prepare(`
      SELECT COUNT(DISTINCT colaborador_id) as count FROM excecoes
      WHERE tipo = 'ATESTADO' AND data_inicio <= ? AND data_fim >= ?
    `).get(hoje, hoje) as { count: number }).count

    const setoresDb = db.prepare('SELECT * FROM setores WHERE ativo = 1 ORDER BY nome').all() as { id: number; nome: string; icone?: string | null }[]
    const setores: SetorResumo[] = setoresDb.map((s) => {
      const totalColab = (db.prepare('SELECT COUNT(*) as count FROM colaboradores WHERE setor_id = ? AND ativo = 1').get(s.id) as { count: number }).count
      const escalaAtual = db.prepare(`
        SELECT status FROM escalas WHERE setor_id = ? AND status IN ('RASCUNHO', 'OFICIAL')
        ORDER BY CASE status WHEN 'OFICIAL' THEN 1 WHEN 'RASCUNHO' THEN 2 END LIMIT 1
      `).get(s.id) as { status: string } | undefined

      return {
        id: s.id,
        nome: s.nome,
        icone: s.icone ?? null,
        total_colaboradores: totalColab,
        escala_atual: (escalaAtual?.status ?? 'SEM_ESCALA') as SetorResumo['escala_atual'],
        proxima_geracao: null,
        violacoes_pendentes: 0,
      }
    })

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
    const db = getDb()
    let sql = 'SELECT * FROM funcoes WHERE setor_id = ?'
    const params: unknown[] = [input.setor_id]
    if (input.ativo !== undefined) {
      sql += ' AND ativo = ?'
      params.push(input.ativo ? 1 : 0)
    }
    sql += ' ORDER BY ordem ASC, apelido'
    return db.prepare(sql).all(...params)
  })

const funcoesBuscar = t.procedure
  .input<{ id: number }>()
  .action(async ({ input }) => {
    const db = getDb()
    const funcao = db.prepare('SELECT * FROM funcoes WHERE id = ?').get(input.id)
    if (!funcao) throw new Error('Funcao nao encontrada')
    return funcao
  })

const funcoesCriar = t.procedure
  .input<{ setor_id: number; apelido: string; tipo_contrato_id: number; ordem?: number }>()
  .action(async ({ input }) => {
    const db = getDb()
    const result = db.prepare(`
      INSERT INTO funcoes (setor_id, apelido, tipo_contrato_id, ordem)
      VALUES (?, ?, ?, ?)
    `).run(input.setor_id, input.apelido, input.tipo_contrato_id, input.ordem ?? 0)
    return db.prepare('SELECT * FROM funcoes WHERE id = ?').get(result.lastInsertRowid)
  })

const funcoesAtualizar = t.procedure
  .input<{ id: number; apelido?: string; tipo_contrato_id?: number; ativo?: boolean; ordem?: number }>()
  .action(async ({ input }) => {
    const db = getDb()
    const fields: string[] = []
    const values: unknown[] = []
    if (input.apelido !== undefined) { fields.push('apelido = ?'); values.push(input.apelido) }
    if (input.tipo_contrato_id !== undefined) { fields.push('tipo_contrato_id = ?'); values.push(input.tipo_contrato_id) }
    if (input.ativo !== undefined) { fields.push('ativo = ?'); values.push(input.ativo ? 1 : 0) }
    if (input.ordem !== undefined) { fields.push('ordem = ?'); values.push(input.ordem) }
    if (fields.length > 0) {
      values.push(input.id)
      db.prepare(`UPDATE funcoes SET ${fields.join(', ')} WHERE id = ?`).run(...values)
    }
    return db.prepare('SELECT * FROM funcoes WHERE id = ?').get(input.id)
  })

const funcoesDeletar = t.procedure
  .input<{ id: number }>()
  .action(async ({ input }) => {
    const db = getDb()
    // Desassociar colaboradores antes de deletar
    db.prepare('UPDATE colaboradores SET funcao_id = NULL WHERE funcao_id = ?').run(input.id)
    db.prepare('DELETE FROM funcoes WHERE id = ?').run(input.id)
    return undefined
  })

// =============================================================================
// FERIADOS (3 handlers) — RFC §9 2.2
// =============================================================================

const feriadosListar = t.procedure
  .input<{ ano?: number }>()
  .action(async ({ input }) => {
    const db = getDb()
    if (input.ano !== undefined) {
      return db.prepare("SELECT * FROM feriados WHERE data LIKE ? ORDER BY data")
        .all(`${input.ano}-%`)
    }
    return db.prepare('SELECT * FROM feriados ORDER BY data').all()
  })

const feriadosCriar = t.procedure
  .input<{ data: string; nome: string; tipo: string; proibido_trabalhar?: boolean; cct_autoriza?: boolean }>()
  .action(async ({ input }) => {
    const db = getDb()
    const result = db.prepare(`
      INSERT INTO feriados (data, nome, tipo, proibido_trabalhar, cct_autoriza)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      input.data,
      input.nome,
      input.tipo,
      input.proibido_trabalhar ? 1 : 0,
      input.cct_autoriza !== false ? 1 : 0
    )
    return db.prepare('SELECT * FROM feriados WHERE id = ?').get(result.lastInsertRowid)
  })

const feriadosDeletar = t.procedure
  .input<{ id: number }>()
  .action(async ({ input }) => {
    const db = getDb()
    db.prepare('DELETE FROM feriados WHERE id = ?').run(input.id)
    return undefined
  })

// =============================================================================
// SETOR HORARIO SEMANA (3 handlers) — RFC §9 2.3 + 2.4
// =============================================================================

const setoresListarHorarioSemana = t.procedure
  .input<{ setor_id: number }>()
  .action(async ({ input }) => {
    const db = getDb()
    return db.prepare(`
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
    `).all(input.setor_id)
  })

const setoresUpsertHorarioSemana = t.procedure
  .input<{ setor_id: number; dia_semana: string; ativo: boolean; usa_padrao: boolean; hora_abertura: string; hora_fechamento: string }>()
  .action(async ({ input }) => {
    const db = getDb()
    db.prepare(`
      INSERT INTO setor_horario_semana (setor_id, dia_semana, ativo, usa_padrao, hora_abertura, hora_fechamento)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(setor_id, dia_semana) DO UPDATE SET
        ativo = excluded.ativo,
        usa_padrao = excluded.usa_padrao,
        hora_abertura = excluded.hora_abertura,
        hora_fechamento = excluded.hora_fechamento
    `).run(
      input.setor_id,
      input.dia_semana,
      input.ativo ? 1 : 0,
      input.usa_padrao ? 1 : 0,
      input.hora_abertura,
      input.hora_fechamento
    )
    return db.prepare('SELECT * FROM setor_horario_semana WHERE setor_id = ? AND dia_semana = ?')
      .get(input.setor_id, input.dia_semana)
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
    const db = getDb()

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

    const setor = db.prepare('SELECT id FROM setores WHERE id = ?').get(input.setor_id) as { id: number } | undefined
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

    const salvar = db.transaction(() => {
      // 1. Upsert horário do dia
      db.prepare(`
        INSERT INTO setor_horario_semana (setor_id, dia_semana, ativo, usa_padrao, hora_abertura, hora_fechamento)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(setor_id, dia_semana) DO UPDATE SET
          ativo = excluded.ativo,
          usa_padrao = excluded.usa_padrao,
          hora_abertura = excluded.hora_abertura,
          hora_fechamento = excluded.hora_fechamento
      `).run(
        input.setor_id,
        input.dia_semana,
        input.ativo ? 1 : 0,
        input.usa_padrao ? 1 : 0,
        input.hora_abertura,
        input.hora_fechamento
      )

      // 2. Apagar demandas existentes para este setor + dia
      db.prepare('DELETE FROM demandas WHERE setor_id = ? AND dia_semana = ?')
        .run(input.setor_id, input.dia_semana)

      // 3. Inserir novos segmentos
      const insertDemanda = db.prepare(`
        INSERT INTO demandas (setor_id, dia_semana, hora_inicio, hora_fim, min_pessoas, override)
        VALUES (?, ?, ?, ?, ?, ?)
      `)
      for (const seg of normalizados) {
        insertDemanda.run(
          input.setor_id,
          input.dia_semana,
          seg.hora_inicio,
          seg.hora_fim,
          seg.min_pessoas,
          seg.override ? 1 : 0
        )
      }
    })

    salvar()

    return {
      horario: db.prepare('SELECT * FROM setor_horario_semana WHERE setor_id = ? AND dia_semana = ?')
        .get(input.setor_id, input.dia_semana),
      demandas: db.prepare('SELECT * FROM demandas WHERE setor_id = ? AND dia_semana = ? ORDER BY hora_inicio')
        .all(input.setor_id, input.dia_semana),
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
    const db = getDb()
    let sql = 'SELECT * FROM demandas_excecao_data WHERE setor_id = ?'
    const params: unknown[] = [input.setor_id]
    if (input.data_inicio) { sql += ' AND data >= ?'; params.push(input.data_inicio) }
    if (input.data_fim) { sql += ' AND data <= ?'; params.push(input.data_fim) }
    sql += ' ORDER BY data, hora_inicio'
    return db.prepare(sql).all(...params)
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
    const db = getDb()
    const result = db.prepare(`
      INSERT INTO demandas_excecao_data (setor_id, data, hora_inicio, hora_fim, min_pessoas, override)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(input.setor_id, input.data, input.hora_inicio, input.hora_fim, input.min_pessoas, input.override ? 1 : 0)
    return db.prepare('SELECT * FROM demandas_excecao_data WHERE id = ?').get(result.lastInsertRowid)
  })

const setoresDeletarDemandaExcecaoData = t.procedure
  .input<{ id: number }>()
  .action(async ({ input }) => {
    const db = getDb()
    db.prepare('DELETE FROM demandas_excecao_data WHERE id = ?').run(input.id)
    return undefined
  })

// =============================================================================
// COLABORADORES — REGRAS DE HORÁRIO (5 handlers)
// =============================================================================

const colaboradoresBuscarRegraHorario = t.procedure
  .input<{ colaborador_id: number }>()
  .action(async ({ input }) => {
    const db = getDb()
    return db.prepare('SELECT * FROM colaborador_regra_horario WHERE colaborador_id = ?').get(input.colaborador_id) ?? null
  })

const colaboradoresSalvarRegraHorario = t.procedure
  .input<{
    colaborador_id: number
    ativo?: boolean
    perfil_horario_id?: number | null
    inicio_min?: string | null
    inicio_max?: string | null
    fim_min?: string | null
    fim_max?: string | null
    preferencia_turno_soft?: string | null
    domingo_ciclo_trabalho?: number
    domingo_ciclo_folga?: number
    folga_fixa_dia_semana?: string | null
  }>()
  .action(async ({ input }) => {
    const db = getDb()
    const existe = db.prepare('SELECT id FROM colaborador_regra_horario WHERE colaborador_id = ?').get(input.colaborador_id) as { id: number } | undefined
    if (existe) {
      db.prepare(`
        UPDATE colaborador_regra_horario SET
          ativo = COALESCE(?, ativo),
          perfil_horario_id = ?,
          inicio_min = ?, inicio_max = ?, fim_min = ?, fim_max = ?,
          preferencia_turno_soft = ?,
          domingo_ciclo_trabalho = COALESCE(?, domingo_ciclo_trabalho),
          domingo_ciclo_folga = COALESCE(?, domingo_ciclo_folga),
          folga_fixa_dia_semana = ?
        WHERE colaborador_id = ?
      `).run(
        input.ativo !== undefined ? (input.ativo ? 1 : 0) : null,
        input.perfil_horario_id ?? null,
        input.inicio_min ?? null, input.inicio_max ?? null, input.fim_min ?? null, input.fim_max ?? null,
        input.preferencia_turno_soft ?? null,
        input.domingo_ciclo_trabalho ?? null,
        input.domingo_ciclo_folga ?? null,
        input.folga_fixa_dia_semana ?? null,
        input.colaborador_id
      )
    } else {
      db.prepare(`
        INSERT INTO colaborador_regra_horario
          (colaborador_id, ativo, perfil_horario_id, inicio_min, inicio_max, fim_min, fim_max, preferencia_turno_soft, domingo_ciclo_trabalho, domingo_ciclo_folga, folga_fixa_dia_semana)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        input.colaborador_id,
        input.ativo !== undefined ? (input.ativo ? 1 : 0) : 1,
        input.perfil_horario_id ?? null,
        input.inicio_min ?? null, input.inicio_max ?? null, input.fim_min ?? null, input.fim_max ?? null,
        input.preferencia_turno_soft ?? null,
        input.domingo_ciclo_trabalho ?? 2,
        input.domingo_ciclo_folga ?? 1,
        input.folga_fixa_dia_semana ?? null
      )
    }
    return db.prepare('SELECT * FROM colaborador_regra_horario WHERE colaborador_id = ?').get(input.colaborador_id)
  })

const colaboradoresListarRegrasExcecaoData = t.procedure
  .input<{ colaborador_id: number }>()
  .action(async ({ input }) => {
    const db = getDb()
    return db.prepare('SELECT * FROM colaborador_regra_horario_excecao_data WHERE colaborador_id = ? ORDER BY data').all(input.colaborador_id)
  })

const colaboradoresUpsertRegraExcecaoData = t.procedure
  .input<{
    colaborador_id: number
    data: string
    ativo?: boolean
    inicio_min?: string | null
    inicio_max?: string | null
    fim_min?: string | null
    fim_max?: string | null
    preferencia_turno_soft?: string | null
    domingo_forcar_folga?: boolean
  }>()
  .action(async ({ input }) => {
    const db = getDb()
    const existe = db.prepare('SELECT id FROM colaborador_regra_horario_excecao_data WHERE colaborador_id = ? AND data = ?')
      .get(input.colaborador_id, input.data) as { id: number } | undefined
    if (existe) {
      db.prepare(`
        UPDATE colaborador_regra_horario_excecao_data SET
          ativo = COALESCE(?, ativo),
          inicio_min = ?, inicio_max = ?, fim_min = ?, fim_max = ?,
          preferencia_turno_soft = ?,
          domingo_forcar_folga = COALESCE(?, domingo_forcar_folga)
        WHERE id = ?
      `).run(
        input.ativo !== undefined ? (input.ativo ? 1 : 0) : null,
        input.inicio_min ?? null, input.inicio_max ?? null, input.fim_min ?? null, input.fim_max ?? null,
        input.preferencia_turno_soft ?? null,
        input.domingo_forcar_folga !== undefined ? (input.domingo_forcar_folga ? 1 : 0) : null,
        existe.id
      )
      return db.prepare('SELECT * FROM colaborador_regra_horario_excecao_data WHERE id = ?').get(existe.id)
    } else {
      const result = db.prepare(`
        INSERT INTO colaborador_regra_horario_excecao_data
          (colaborador_id, data, ativo, inicio_min, inicio_max, fim_min, fim_max, preferencia_turno_soft, domingo_forcar_folga)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        input.colaborador_id, input.data,
        input.ativo !== undefined ? (input.ativo ? 1 : 0) : 1,
        input.inicio_min ?? null, input.inicio_max ?? null, input.fim_min ?? null, input.fim_max ?? null,
        input.preferencia_turno_soft ?? null,
        input.domingo_forcar_folga ? 1 : 0
      )
      return db.prepare('SELECT * FROM colaborador_regra_horario_excecao_data WHERE id = ?').get(result.lastInsertRowid)
    }
  })

const colaboradoresDeletarRegraExcecaoData = t.procedure
  .input<{ id: number }>()
  .action(async ({ input }) => {
    const db = getDb()
    db.prepare('DELETE FROM colaborador_regra_horario_excecao_data WHERE id = ?').run(input.id)
    return undefined
  })

// =============================================================================
// ESCALAS — CICLO ROTATIVO (4 handlers)
// =============================================================================

const escalasDetectarCicloRotativo = t.procedure
  .input<{ escala_id: number }>()
  .action(async ({ input }) => {
    const db = getDb()
    const escala = db.prepare('SELECT * FROM escalas WHERE id = ?').get(input.escala_id) as { data_inicio: string; data_fim: string } | undefined
    if (!escala) throw new Error('Escala não encontrada')
    const start = new Date(escala.data_inicio)
    const end = new Date(escala.data_fim)
    const semanas = Math.max(1, Math.round((end.getTime() - start.getTime()) / (7 * 24 * 60 * 60 * 1000)))
    const r = db.prepare(`SELECT COUNT(DISTINCT colaborador_id) as p FROM alocacoes WHERE escala_id = ? AND tipo_dia != 'FOLGA'`).get(input.escala_id) as { p: number }
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
    const db = getDb()
    const insertModelo = db.prepare(`
      INSERT INTO escala_ciclo_modelos (setor_id, nome, semanas_no_ciclo, origem_escala_id)
      VALUES (?, ?, ?, ?)
    `)
    const insertItem = db.prepare(`
      INSERT INTO escala_ciclo_itens (ciclo_modelo_id, semana_idx, colaborador_id, dia_semana, trabalha, ancora_domingo, prioridade)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
    const transaction = db.transaction(() => {
      const res = insertModelo.run(input.setor_id, input.nome, input.semanas_no_ciclo, input.origem_escala_id ?? null)
      const modeloId = res.lastInsertRowid
      for (const item of input.itens) {
        insertItem.run(modeloId, item.semana_idx, item.colaborador_id, item.dia_semana, item.trabalha ? 1 : 0, item.ancora_domingo ? 1 : 0, item.prioridade ?? 0)
      }
      return modeloId
    })
    const modeloId = transaction()
    return db.prepare('SELECT * FROM escala_ciclo_modelos WHERE id = ?').get(modeloId)
  })

const escalasListarCiclosRotativos = t.procedure
  .input<{ setor_id: number }>()
  .action(async ({ input }) => {
    const db = getDb()
    return db.prepare('SELECT * FROM escala_ciclo_modelos WHERE setor_id = ? AND ativo = 1 ORDER BY criado_em DESC').all(input.setor_id)
  })

const escalasGerarPorCicloRotativo = t.procedure
  .input<{ ciclo_modelo_id: number; data_inicio: string; data_fim: string }>()
  .action(async ({ input }) => {
    const db = getDb()
    const modelo = db.prepare('SELECT * FROM escala_ciclo_modelos WHERE id = ?').get(input.ciclo_modelo_id) as { id: number; setor_id: number; nome: string; semanas_no_ciclo: number } | undefined
    if (!modelo) throw new Error('Modelo de ciclo não encontrado')
    const itens = db.prepare('SELECT * FROM escala_ciclo_itens WHERE ciclo_modelo_id = ? ORDER BY semana_idx, dia_semana').all(input.ciclo_modelo_id) as Array<{ semana_idx: number; colaborador_id: number; dia_semana: string; trabalha: number }>

    const diaSemanaMap: Record<string, number> = { DOM: 0, SEG: 1, TER: 2, QUA: 3, QUI: 4, SEX: 5, SAB: 6 }
    const numeroDiaSemana: Record<number, string> = { 0: 'DOM', 1: 'SEG', 2: 'TER', 3: 'QUA', 4: 'QUI', 5: 'SEX', 6: 'SAB' }

    // Criar escala RASCUNHO
    const escalaRes = db.prepare(`
      INSERT INTO escalas (setor_id, data_inicio, data_fim, status, criada_em)
      VALUES (?, ?, ?, 'RASCUNHO', datetime('now'))
    `).run(modelo.setor_id, input.data_inicio, input.data_fim)
    const escalaId = escalaRes.lastInsertRowid as number

    // Gerar alocações
    const insertAlocacao = db.prepare(`
      INSERT INTO alocacoes (escala_id, colaborador_id, data, tipo_dia, pinned)
      VALUES (?, ?, ?, ?, 0)
    `)
    const transaction = db.transaction(() => {
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
          insertAlocacao.run(escalaId, item.colaborador_id, dataStr, item.trabalha ? 'TRABALHO' : 'FOLGA')
        }
        current.setDate(current.getDate() + 1)
      }
    })
    transaction()

    // Retornar escala completa
    const escala = db.prepare('SELECT * FROM escalas WHERE id = ?').get(escalaId) as any
    const alocacoes = db.prepare('SELECT * FROM alocacoes WHERE escala_id = ? ORDER BY data, colaborador_id').all(escalaId)
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

const iaConfiguracaoObter = t.procedure
  .action(async () => {
    const db = getDb()
    const config = db.prepare('SELECT * FROM configuracao_ia LIMIT 1').get()
    return config || null
  })

const iaConfiguracaoSalvar = t.procedure
  .input<{ provider: string; api_key: string; modelo: string; ativo: boolean }>()
  .action(async ({ input }) => {
    const db = getDb()
    const existe = db.prepare('SELECT id FROM configuracao_ia LIMIT 1').get() as { id: number } | undefined

    if (existe) {
      db.prepare(`UPDATE configuracao_ia SET provider = ?, api_key = ?, modelo = ?, ativo = ?, atualizado_em = datetime('now') WHERE id = ?`)
        .run(input.provider, input.api_key, input.modelo, input.ativo ? 1 : 0, existe.id)
    } else {
      db.prepare(`INSERT INTO configuracao_ia (provider, api_key, modelo, ativo) VALUES (?, ?, ?, ?)`)
        .run(input.provider, input.api_key, input.modelo, input.ativo ? 1 : 0)
    }

    return db.prepare('SELECT * FROM configuracao_ia LIMIT 1').get()
  })

const iaConfiguracaoTestar = t.procedure
  .input<{ provider: string; api_key: string; modelo: string }>()
  .action(async ({ input }) => {
    try {
      return await iaTestarConexao(input.provider, input.api_key, input.modelo)
    } catch (error: any) {
      throw new Error(error.message || 'Erro desconhecido ao testar conexão.')
    }
  })

const iaChatEnviar = t.procedure
  .input<{ mensagem: string; historico: import('@shared/index').IaMensagem[] }>()
  .action(async ({ input }) => {
    return await iaEnviarMensagem(input.mensagem, input.historico)
  })

// =============================================================================
// IA HISTÓRICO DE CONVERSAS
// =============================================================================

const iaConversasListar = t.procedure
  .input<{ status?: string; busca?: string }>()
  .action(async ({ input }) => {
    const db = getDb()
    const status = input.status ?? 'ativo'
    const busca = input.busca ? `%${input.busca}%` : '%'
    return db
      .prepare(
        `SELECT * FROM ia_conversas WHERE status = ? AND titulo LIKE ? ORDER BY atualizado_em DESC`,
      )
      .all(status, busca) as import('@shared/index').IaConversa[]
  })

const iaConversasObter = t.procedure
  .input<{ id: string }>()
  .action(async ({ input }) => {
    const db = getDb()
    const conversa = db
      .prepare(`SELECT * FROM ia_conversas WHERE id = ?`)
      .get(input.id) as import('@shared/index').IaConversa | undefined
    if (!conversa) throw new Error('Conversa não encontrada')
    const mensagens = db
      .prepare(
        `SELECT id, conversa_id, papel, conteudo, timestamp FROM ia_mensagens WHERE conversa_id = ? ORDER BY timestamp ASC`,
      )
      .all(input.id) as import('@shared/index').IaMensagem[]
    return { conversa, mensagens }
  })

const iaConversasCriar = t.procedure
  .input<{ id?: string; titulo?: string }>()
  .action(async ({ input }) => {
    const db = getDb()
    const id = input.id ?? crypto.randomUUID()
    const titulo = input.titulo ?? 'Nova conversa'
    db.prepare(`INSERT INTO ia_conversas (id, titulo) VALUES (?, ?)`).run(id, titulo)
    return db
      .prepare(`SELECT * FROM ia_conversas WHERE id = ?`)
      .get(id) as import('@shared/index').IaConversa
  })

const iaConversasRenomear = t.procedure
  .input<{ id: string; titulo: string }>()
  .action(async ({ input }) => {
    const db = getDb()
    db.prepare(
      `UPDATE ia_conversas SET titulo = ?, atualizado_em = datetime('now') WHERE id = ?`,
    ).run(input.titulo, input.id)
  })

const iaConversasArquivar = t.procedure
  .input<{ id: string }>()
  .action(async ({ input }) => {
    const db = getDb()
    db.prepare(
      `UPDATE ia_conversas SET status = 'arquivado', atualizado_em = datetime('now') WHERE id = ?`,
    ).run(input.id)
  })

const iaConversasRestaurar = t.procedure
  .input<{ id: string }>()
  .action(async ({ input }) => {
    const db = getDb()
    db.prepare(
      `UPDATE ia_conversas SET status = 'ativo', atualizado_em = datetime('now') WHERE id = ?`,
    ).run(input.id)
  })

const iaConversasDeletar = t.procedure
  .input<{ id: string }>()
  .action(async ({ input }) => {
    const db = getDb()
    db.prepare(`DELETE FROM ia_conversas WHERE id = ?`).run(input.id)
  })

const iaMensagensSalvar = t.procedure
  .input<{ conversa_id: string; mensagem: import('@shared/index').IaMensagem }>()
  .action(async ({ input }) => {
    const db = getDb()
    const { conversa_id, mensagem } = input
    db.prepare(
      `INSERT OR IGNORE INTO ia_mensagens (id, conversa_id, papel, conteudo, timestamp) VALUES (?, ?, ?, ?, ?)`,
    ).run(mensagem.id, conversa_id, mensagem.papel, mensagem.conteudo, mensagem.timestamp)
    db.prepare(
      `UPDATE ia_conversas SET atualizado_em = datetime('now') WHERE id = ?`,
    ).run(conversa_id)
  })

const iaConversasArquivarTodas = t.procedure.action(async () => {
  const db = getDb()
  db.prepare(
    `UPDATE ia_conversas SET status = 'arquivado', atualizado_em = datetime('now') WHERE status = 'ativo'`,
  ).run()
})

const iaConversasDeletarArquivadas = t.procedure.action(async () => {
  const db = getDb()
  db.prepare(`DELETE FROM ia_conversas WHERE status = 'arquivado'`).run()
})

// =============================================================================
// ROUTER
// =============================================================================

export const router = {
  // Empresa
  'empresa.buscar': empresaBuscar,
  'empresa.atualizar': empresaAtualizar,
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
  // IA
  'ia.configuracao.obter': iaConfiguracaoObter,
  'ia.configuracao.salvar': iaConfiguracaoSalvar,
  'ia.configuracao.testar': iaConfiguracaoTestar,
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
}

export type Router = typeof router
