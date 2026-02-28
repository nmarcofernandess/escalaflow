import type { DiaSemana } from '@shared/index'

export type EscalaPeriodoPreset = '3_MESES' | '6_MESES' | '1_ANO'

const DAY_INDEX: Record<DiaSemana, number> = {
  DOM: 0,
  SEG: 1,
  TER: 2,
  QUA: 3,
  QUI: 4,
  SEX: 5,
  SAB: 6,
}

const PRESET_WEEKS: Record<EscalaPeriodoPreset, number> = {
  '3_MESES': 13,
  '6_MESES': 26,
  '1_ANO': 52,
}

function toIsoDate(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function atMidnight(source: Date): Date {
  const date = new Date(source)
  date.setHours(0, 0, 0, 0)
  return date
}

function startOfWeek(date: Date, weekStart: DiaSemana): Date {
  const startIdx = DAY_INDEX[weekStart]
  const candidate = atMidnight(date)
  const diff = (candidate.getDay() - startIdx + 7) % 7
  candidate.setDate(candidate.getDate() - diff)
  return candidate
}

export function getNextWeekStart(date: Date, weekStart: DiaSemana = 'SEG'): Date {
  const today = atMidnight(date)
  const currentWeekStart = startOfWeek(today, weekStart)
  const next = new Date(currentWeekStart)
  next.setDate(next.getDate() + 7)
  return next
}

export function resolvePresetRange(
  preset: EscalaPeriodoPreset,
  now: Date = new Date(),
  weekStart: DiaSemana = 'SEG',
): { data_inicio: string; data_fim: string } {
  const start = getNextWeekStart(now, weekStart)
  const weeks = PRESET_WEEKS[preset]

  const end = new Date(start)
  end.setDate(end.getDate() + (weeks * 7) - 1)

  return {
    data_inicio: toIsoDate(start),
    data_fim: toIsoDate(end),
  }
}

export function getPresetLabel(preset: EscalaPeriodoPreset): string {
  switch (preset) {
    case '3_MESES':
      return '3 meses'
    case '6_MESES':
      return '6 meses'
    case '1_ANO':
      return '1 ano'
    default:
      return '3 meses'
  }
}
