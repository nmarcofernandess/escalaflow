import type { DiaSemana, StatusAlocacao } from './constants'

type DiaSemanaSemDomingo = Exclude<DiaSemana, 'DOM'>

export interface FolgaInferenceAlocacao {
  data: string
  status: StatusAlocacao
}

export interface FolgaInferenceResult {
  fixa: DiaSemana | null
  variavel: DiaSemanaSemDomingo | null
}

const DIA_SEMANA_BY_UTC_DAY: DiaSemana[] = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB']
const DIAS_ORDENADOS: DiaSemana[] = ['SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB', 'DOM']
const DIAS_ORDENADOS_SEM_DOM: DiaSemanaSemDomingo[] = ['SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB']

function isoDateToUtcDate(value: string): Date {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(Date.UTC(year, (month ?? 1) - 1, day ?? 1))
}

function utcDateToIso(value: Date): string {
  return value.toISOString().slice(0, 10)
}

function diaSemanaFromIso(value: string): DiaSemana {
  return DIA_SEMANA_BY_UTC_DAY[isoDateToUtcDate(value).getUTCDay()] ?? 'SEG'
}

function pickMostFrequentDay<T extends string>(countByDay: Map<T, number>, order: readonly T[]): T | null {
  let bestDay: T | null = null
  let bestCount = 0

  for (const day of order) {
    const count = countByDay.get(day) ?? 0
    if (count > bestCount) {
      bestDay = day
      bestCount = count
    }
  }

  return bestDay
}

function detectFixedByFrequency(alocacoes: FolgaInferenceAlocacao[]): DiaSemana | null {
  const countByDay = new Map<DiaSemana, number>()

  for (const aloc of alocacoes) {
    if (aloc.status !== 'FOLGA') continue
    const day = diaSemanaFromIso(aloc.data)
    countByDay.set(day, (countByDay.get(day) ?? 0) + 1)
  }

  return pickMostFrequentDay(countByDay, DIAS_ORDENADOS)
}

function detectVariableFromWorkedSunday(
  alocacoes: FolgaInferenceAlocacao[],
  fixedDay: DiaSemana | null,
): DiaSemanaSemDomingo | null {
  const countByDay = new Map<DiaSemanaSemDomingo, number>()
  const statusByDate = new Map(alocacoes.map((aloc) => [aloc.data, aloc.status]))

  for (const aloc of alocacoes) {
    if (aloc.status !== 'TRABALHO') continue
    if (diaSemanaFromIso(aloc.data) !== 'DOM') continue

    const sunday = isoDateToUtcDate(aloc.data)
    // Same-week: olhar dias ANTES do domingo (offset -6..-1)
    for (let offset = -6; offset <= -1; offset += 1) {
      const prev = new Date(sunday)
      prev.setUTCDate(sunday.getUTCDate() + offset)
      const prevIso = utcDateToIso(prev)
      if (!statusByDate.has(prevIso)) continue // dia fora do periodo
      if (statusByDate.get(prevIso) !== 'FOLGA') continue

      const day = diaSemanaFromIso(prevIso)
      if (day === 'DOM' || day === fixedDay) continue

      countByDay.set(day, (countByDay.get(day) ?? 0) + 1)
    }
  }

  const order = fixedDay == null
    ? DIAS_ORDENADOS_SEM_DOM
    : DIAS_ORDENADOS_SEM_DOM.filter((day) => day !== fixedDay)

  return pickMostFrequentDay(countByDay, order)
}

function detectVariableByFrequency(
  alocacoes: FolgaInferenceAlocacao[],
  fixedDay: DiaSemana | null,
): DiaSemanaSemDomingo | null {
  const countByDay = new Map<DiaSemanaSemDomingo, number>()

  for (const aloc of alocacoes) {
    if (aloc.status !== 'FOLGA') continue
    const day = diaSemanaFromIso(aloc.data)
    if (day === 'DOM' || day === fixedDay) continue
    countByDay.set(day, (countByDay.get(day) ?? 0) + 1)
  }

  const order = fixedDay == null
    ? DIAS_ORDENADOS_SEM_DOM
    : DIAS_ORDENADOS_SEM_DOM.filter((day) => day !== fixedDay)

  return pickMostFrequentDay(countByDay, order)
}

export function inferFolgasFromAlocacoes(params: {
  alocacoes: FolgaInferenceAlocacao[]
  folgaFixaAtual?: DiaSemana | null
  folgaVariavelAtual?: DiaSemana | null
}): FolgaInferenceResult {
  const { alocacoes, folgaFixaAtual = null, folgaVariavelAtual = null } = params

  const fixa = folgaFixaAtual ?? detectFixedByFrequency(alocacoes)
  const explicitVariavel = folgaVariavelAtual && folgaVariavelAtual !== 'DOM' && folgaVariavelAtual !== fixa
    ? folgaVariavelAtual
    : null

  const variavel = explicitVariavel
    ?? detectVariableFromWorkedSunday(alocacoes, fixa)
    ?? detectVariableByFrequency(alocacoes, fixa)

  return {
    fixa,
    variavel: variavel && variavel !== fixa ? variavel : null,
  }
}
