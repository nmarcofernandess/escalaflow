/**
 * Returns ISO 8601 week number for a date string (YYYY-MM-DD).
 * ISO weeks start on Monday. Week 1 is the week containing Jan 4th.
 */
export function getISOWeekNumber(dateStr: string): number {
  const d = new Date(dateStr + 'T00:00:00')
  const dayNum = d.getUTCDay() || 7 // Sunday = 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum) // Thursday of this week
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
}

/**
 * Format week label: "S10 -- 02/03 a 08/03/2026"
 */
export function formatWeekLabel(startDate: string, endDate: string): string {
  const weekNum = getISOWeekNumber(startDate)
  const fmt = (d: string) => {
    const [, m, dd] = d.split('-')
    return `${dd}/${m}`
  }
  const year = startDate.split('-')[0]
  return `S${weekNum} \u2014 ${fmt(startDate)} a ${fmt(endDate)}/${year}`
}

/**
 * Groups an array of date strings into ISO weeks.
 * Returns array of { semanaLabel, weekNumber, dates, startDate, endDate }
 */
export function agruparPorSemanaISO(dates: string[]): {
  semanaLabel: string
  weekNumber: number
  dates: string[]
  startDate: string
  endDate: string
}[] {
  if (dates.length === 0) return []

  const sorted = [...dates].sort()
  const weeks: Map<number, string[]> = new Map()

  for (const d of sorted) {
    const wn = getISOWeekNumber(d)
    if (!weeks.has(wn)) weeks.set(wn, [])
    weeks.get(wn)!.push(d)
  }

  return Array.from(weeks.entries())
    .sort(([a], [b]) => a - b)
    .map(([wn, wDates]) => ({
      semanaLabel: `S${wn}`,
      weekNumber: wn,
      dates: wDates,
      startDate: wDates[0],
      endDate: wDates[wDates.length - 1],
    }))
}
