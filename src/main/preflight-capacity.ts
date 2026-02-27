import { dayLabel, listDays, minutesBetween } from './date-utils'
import type { EscalaPreflightResult, SolverInput } from '../shared'

export type RegimeEscalaInput = '5X2' | '6X1'

export type SimulacaoRegimeOverride = {
  colaborador_id: number
  regime_escala: RegimeEscalaInput
}

export type EscalaSimulacaoConfig = {
  regimes_override?: SimulacaoRegimeOverride[]
}

export type PreflightIssue = EscalaPreflightResult['blockers'][number]

interface CapacityOptions {
  collectiveCode?: string
  collectiveMessageMode?: 'diaria' | 'coletiva'
  addNoBlockersWarning?: boolean
}

export function normalizeRegimesOverride(
  overrides?: SimulacaoRegimeOverride[],
): SimulacaoRegimeOverride[] {
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

export function parseEscalaSimulacaoConfig(
  raw: string | null | undefined,
): EscalaSimulacaoConfig {
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

export function enrichPreflightWithCapacityChecks(
  input: SolverInput,
  blockers: PreflightIssue[],
  warnings: PreflightIssue[],
  options?: CapacityOptions,
): void {
  const collectiveCode = options?.collectiveCode ?? 'CAPACIDADE_DIARIA_INSUFICIENTE'
  const collectiveMessageMode = options?.collectiveMessageMode ?? 'diaria'
  const addNoBlockersWarning = options?.addNoBlockersWarning ?? false

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

  const TIPOS_BLOQUEADOS_DOMINGO = new Set(['ESTAGIARIO', 'APRENDIZ'])
  function bloqueadoDomingo(c: (typeof input.colaboradores)[number]): boolean {
    if (TIPOS_BLOQUEADOS_DOMINGO.has(c.tipo_trabalhador)) return true
    if (c.domingo_ciclo_trabalho != null && c.domingo_ciclo_trabalho <= 0) return true
    return false
  }

  for (const day of days) {
    const dayDemand = demandByDay.get(day) ?? []
    if (dayDemand.length === 0) continue

    const label = dayLabel(day)
    if (label === 'DOM' && input.colaboradores.every(bloqueadoDomingo)) {
      blockers.push({
        codigo: 'DOMINGO_SEM_COLABORADORES',
        severidade: 'BLOCKER',
        mensagem: `Ha demanda no domingo (${day}), mas nenhum colaborador pode trabalhar domingo.`,
        detalhe: 'Todos sao estagiarios/aprendizes ou tem ciclo domingo=0. Ajuste contratos ou demanda.',
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
    const availableCount = input.colaboradores.filter((c) => {
      if (label === 'DOM' && bloqueadoDomingo(c)) return false
      if (holidayForbidden.has(day)) return false
      return !input.excecoes.some((e) => e.colaborador_id === c.id && e.data_inicio <= day && day <= e.data_fim)
    }).length

    if (availableCount < peakDemand) {
      const mensagem = collectiveMessageMode === 'coletiva'
        ? `Capacidade insuficiente em ${day}: demanda pico ${peakDemand}, disponiveis ${availableCount}.`
        : `Capacidade insuficiente em ${day}: disponiveis=${availableCount}, minimo requerido=${peakDemand}.`

      blockers.push({
        codigo: collectiveCode,
        severidade: 'BLOCKER',
        mensagem,
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

  const companyCapacity = input.colaboradores.reduce((acc, c) => {
    const minutosDia = Math.max(0, c.max_minutos_dia - (c.horas_semanais > 36 ? input.empresa.min_intervalo_almoco_min : 0))
    return acc + minutosDia * c.dias_trabalho
  }, 0)

  if (companyCapacity < requiredMinutes) {
    warnings.push({
      codigo: 'CAPACIDADE_TOTAL_ESTOURADA',
      severidade: 'WARNING',
      mensagem: `Demanda total do periodo (${Math.round(requiredMinutes / 60)}h) excede a capacidade nominal da equipe (${Math.round(companyCapacity / 60)}h).`,
      detalhe: 'O solver pode precisar relaxar preferencias e gerar avisos.',
    })
  }

  for (const c of input.colaboradores) {
    const horasSemanaisMinutos = c.horas_semanais * 60
    const toleranciaMinutos = input.empresa.tolerancia_semanal_min
    const limiteInferiorSemanal = Math.max(0, horasSemanaisMinutos - toleranciaMinutos)

    let maxJanelaDoColaborador = c.max_minutos_dia
    const regras = input.regras_colaborador_dia?.filter((r) => r.colaborador_id === c.id) || []
    const regraTipica = regras.find((r) => r.inicio_min || r.fim_max)

    if (regraTipica) {
      const startToUse = regraTipica.inicio_min || input.empresa.hora_abertura
      const endToUse = regraTipica.fim_max || input.empresa.hora_fechamento
      const possibleMinutes = minutesBetween(startToUse, endToUse)
      if (possibleMinutes > 0) {
        maxJanelaDoColaborador = Math.min(possibleMinutes, c.max_minutos_dia)
      }
    }

    let capacidadeDiaria = maxJanelaDoColaborador
    const metaDiariaMedia = horasSemanaisMinutos / c.dias_trabalho
    if (metaDiariaMedia > 360) {
      capacidadeDiaria -= input.empresa.min_intervalo_almoco_min
    }

    const capacidadeMaxSemanal = capacidadeDiaria * c.dias_trabalho
    if (capacidadeMaxSemanal < limiteInferiorSemanal) {
      blockers.push({
        codigo: 'CAPACIDADE_INDIVIDUAL_INSUFICIENTE',
        severidade: 'BLOCKER',
        mensagem: `A janela de disponibilidade de ${c.nome} torna a carga horaria incompativel.`,
        detalhe: `Capacidade maxima da jornada e ${Math.round(capacidadeMaxSemanal / 60)}h. Contrato exige minimo de ${Math.round(limiteInferiorSemanal / 60)}h.`,
      })
    }
  }

  if (addNoBlockersWarning && warnings.length === 0 && blockers.length === 0) {
    warnings.push({
      codigo: 'PREFLIGHT_COMPLETO_SEM_BLOCKERS',
      severidade: 'WARNING',
      mensagem: 'Preflight completo executado sem blockers adicionais.',
      detalhe: 'Capacidade basica e restricoes gerais parecem consistentes para o periodo.',
    })
  }
}
