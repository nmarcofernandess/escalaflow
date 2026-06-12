import { dayLabel, listDays, minutesBetween } from './date-utils'
import { derivarTipoTrabalhador, type DiaSemana, type EscalaPreflightResult, type SolverInput } from '../shared'

export type RegimeEscalaInput = '5X2' | '6X1'

export type SimulacaoRegimeOverride = {
  colaborador_id: number
  regime_escala: RegimeEscalaInput
}

export type EscalaSimulacaoConfig = {
  regimes_override?: SimulacaoRegimeOverride[]
  setor_overrides_locais?: Record<string, { fixa?: DiaSemana | null; variavel?: DiaSemana | null }>
}

export type PreflightIssue = EscalaPreflightResult['blockers'][number]

interface CapacityOptions {
  collectiveCode?: string
  collectiveMessageMode?: 'diaria' | 'coletiva'
  addNoBlockersWarning?: boolean
}

const DIA_SEMANA_INDEX: Record<DiaSemana, number> = {
  DOM: 0,
  SEG: 1,
  TER: 2,
  QUA: 3,
  QUI: 4,
  SEX: 5,
  SAB: 6,
}

function timeToMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number)
  return hours * 60 + minutes
}

function minutesToTime(minutes: number): string {
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`
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
      setor_overrides_locais: parsed?.setor_overrides_locais ?? {},
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
  const pisoOperacional = Math.max(0, Math.floor(input.piso_operacional ?? 1))

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

  const regraPorColabDia = new Map<string, NonNullable<SolverInput['regras_colaborador_dia']>[number]>()
  for (const regra of input.regras_colaborador_dia ?? []) {
    regraPorColabDia.set(`${regra.colaborador_id}|${regra.data}`, regra)
  }

  const TIPOS_BLOQUEADOS_DOMINGO = new Set<string>([])
  const tipoDoColaborador = (c: (typeof input.colaboradores)[number]) =>
    derivarTipoTrabalhador({ tipo_colaborador: c.tipo_trabalhador })

  function bloqueadoDomingo(c: (typeof input.colaboradores)[number]): boolean {
    if (TIPOS_BLOQUEADOS_DOMINGO.has(tipoDoColaborador(c))) return true
    if (c.domingo_ciclo_trabalho != null && c.domingo_ciclo_trabalho <= 0) return true
    return false
  }

  function indisponivelPorRegra(
    c: (typeof input.colaboradores)[number],
    day: string,
    label: DiaSemana,
  ): boolean {
    const regra = regraPorColabDia.get(`${c.id}|${day}`)
    if (tipoDoColaborador(c) === 'INTERMITENTE') {
      if (!regra) return true
      if (regra.folga_fixa) return true
      if (label === 'DOM' && regra.domingo_forcar_folga) return true
      return false
    }
    if (!regra) return false
    if (regra.folga_fixa) return true
    if (label === 'DOM' && regra.domingo_forcar_folga) return true
    return false
  }

  function indisponivelNoDia(c: (typeof input.colaboradores)[number], day: string, label: DiaSemana): boolean {
    if (label === 'DOM' && bloqueadoDomingo(c)) return true
    if (holidayForbidden.has(day)) return true
    if (indisponivelPorRegra(c, day, label)) return true
    return input.excecoes.some((e) => e.colaborador_id === c.id && e.data_inicio <= day && day <= e.data_fim)
  }

  function janelaOperacional(label: DiaSemana): { abertura: string; fechamento: string } {
    const horarioDoDia = input.empresa.horario_por_dia?.[DIA_SEMANA_INDEX[label]]
    return {
      abertura: horarioDoDia?.abertura ?? input.empresa.hora_abertura,
      fechamento: horarioDoDia?.fechamento ?? input.empresa.hora_fechamento,
    }
  }

  function janelaColaborador(
    c: (typeof input.colaboradores)[number],
    day: string,
    label: DiaSemana,
  ): { inicio: string; fim: string; inicioMin: number; fimMax: number } {
    const empresaWindow = janelaOperacional(label)
    const regra = regraPorColabDia.get(`${c.id}|${day}`)
    const inicio = regra?.inicio_min ?? empresaWindow.abertura
    const fim = regra?.fim_max ?? empresaWindow.fechamento
    return {
      inicio,
      fim,
      inicioMin: timeToMinutes(inicio),
      fimMax: timeToMinutes(fim),
    }
  }

  const MAX_SLOT_FLOOR_WARNINGS = 20
  let slotFloorWarnings = 0

  for (const day of days) {
    const dayDemand = demandByDay.get(day) ?? []
    if (dayDemand.length === 0) continue

    const label = dayLabel(day)
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
    const availableToday = input.colaboradores.filter((c) => !indisponivelNoDia(c, day, label))
    const availableCount = availableToday.length

    if (label === 'DOM' && availableCount === 0) {
      blockers.push({
        codigo: 'DOMINGO_SEM_COLABORADORES',
        severidade: 'BLOCKER',
        mensagem: `Ha demanda no domingo (${day}), mas nenhum colaborador pode trabalhar domingo.`,
        detalhe: 'Todos estao bloqueados por contrato, ciclo, regra de horario ou excecao nesse domingo.',
      })
      break
    }

    const floorRequired = Math.min(pisoOperacional, peakDemand)
    if (floorRequired > 0 && availableCount < floorRequired) {
      warnings.push({
        codigo: 'PISO_OPERACIONAL_IMPOSSIVEL',
        severidade: 'WARNING',
        mensagem: `Piso operacional impossivel em ${day}: piso ${floorRequired}, disponiveis ${availableCount}.`,
        detalhe: 'O solver limita o piso pela disponibilidade fisica do slot; revise excecoes, regras de horario ou o piso do setor.',
      })
    }

    for (const seg of dayDemand) {
      if (slotFloorWarnings >= MAX_SLOT_FLOOR_WARNINGS) break

      const requiredInSegment = Math.min(pisoOperacional, seg.min_pessoas)
      if (requiredInSegment <= 0) continue

      const grid = Math.max(1, input.empresa.grid_minutos || 30)
      const segmentStart = timeToMinutes(seg.hora_inicio)
      const segmentEnd = timeToMinutes(seg.hora_fim)

      for (let slotStart = segmentStart; slotStart < segmentEnd; slotStart += grid) {
        if (slotFloorWarnings >= MAX_SLOT_FLOOR_WARNINGS) break

        const slotEnd = Math.min(slotStart + grid, segmentEnd)
        const slotAvailable = availableToday.filter((c) => {
          const janela = janelaColaborador(c, day, label)
          return janela.inicioMin <= slotStart && janela.fimMax >= slotEnd
        })

        if (slotAvailable.length >= requiredInSegment) continue

        const quaseCobre = availableToday
          .filter((c) => !slotAvailable.some((available) => available.id === c.id))
          .slice(0, 3)
          .map((c) => {
            const janela = janelaColaborador(c, day, label)
            return `${c.nome} (${janela.inicio}-${janela.fim})`
          })

        warnings.push({
          codigo: 'PISO_OPERACIONAL_SLOT_IMPOSSIVEL',
          severidade: 'WARNING',
          mensagem: `Piso operacional impossivel em ${day} ${minutesToTime(slotStart)}-${minutesToTime(slotEnd)}: piso ${requiredInSegment}, disponiveis ${slotAvailable.length}.`,
          detalhe: quaseCobre.length > 0
            ? `Quase cobre: ${quaseCobre.join(', ')}. Revise regras de horario, excecoes ou piso do setor.`
            : 'Nenhum colaborador elegivel no dia cobre a faixa. Revise regras de horario, excecoes ou piso do setor.',
        })
        slotFloorWarnings += 1
      }
    }

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

    // max_minutos_dia já é tempo de trabalho efetivo (exclui almoço),
    // então NÃO subtrair almoço aqui — o solver gerencia almoço separadamente.
    const capacidadeMaxSemanal = maxJanelaDoColaborador * c.dias_trabalho
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
