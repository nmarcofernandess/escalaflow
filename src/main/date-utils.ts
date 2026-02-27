export type DiaSemana = 'SEG' | 'TER' | 'QUA' | 'QUI' | 'SEX' | 'SAB' | 'DOM'

const WEEK_LABELS: readonly DiaSemana[] = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB'] as const

export function listDays(dataInicio: string, dataFim: string): string[] {
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

export function dayLabel(isoDate: string): DiaSemana {
  const d = new Date(`${isoDate}T00:00:00`)
  return WEEK_LABELS[d.getDay()]
}

export function minutesBetween(h1: string, h2: string): number {
  const [aH, aM] = h1.split(':').map(Number)
  const [bH, bM] = h2.split(':').map(Number)
  return Math.max(0, (bH * 60 + bM) - (aH * 60 + aM))
}
