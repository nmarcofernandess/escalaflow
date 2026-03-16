import { describe, it, expect } from 'vitest'
import { getISOWeekNumber, agruparPorSemanaISO, formatWeekLabel } from '../../src/renderer/src/lib/date-helpers'

describe('getISOWeekNumber', () => {
  it('returns correct ISO week for 2026-03-01 (Sunday)', () => {
    // 2026-03-01 is a Sunday — ISO week assigns it to the week of the preceding Monday
    const result = getISOWeekNumber('2026-03-01')
    expect(result).toBe(9) // ISO: Sunday belongs to previous week
  })

  it('returns S10 for 2026-03-02 (Monday)', () => {
    expect(getISOWeekNumber('2026-03-02')).toBe(10)
  })

  it('returns S2 for 2026-01-05 (Monday)', () => {
    expect(getISOWeekNumber('2026-01-05')).toBe(2)
  })

  it('returns S1 for 2026-01-01 (Thursday)', () => {
    expect(getISOWeekNumber('2026-01-01')).toBe(1)
  })

  it('returns S53 for 2026-12-31 (Thursday) — year-end week', () => {
    // 2026-12-31 is a Thursday. Its ISO Thursday falls in 2026,
    // so it belongs to ISO week 53 of 2026 (not week 1 of 2027).
    expect(getISOWeekNumber('2026-12-31')).toBe(53)
  })
})

describe('formatWeekLabel', () => {
  it('formats label correctly for S10', () => {
    const label = formatWeekLabel('2026-03-02', '2026-03-08')
    expect(label).toBe('S10 \u2014 02/03 a 08/03/2026')
  })

  it('formats label for cross-month week', () => {
    const label = formatWeekLabel('2026-02-23', '2026-03-01')
    expect(label).toBe('S9 \u2014 23/02 a 01/03/2026')
  })
})

describe('agruparPorSemanaISO', () => {
  it('groups dates into ISO weeks', () => {
    const dates = ['2026-03-01', '2026-03-02', '2026-03-08', '2026-03-09']
    const result = agruparPorSemanaISO(dates)
    expect(result.length).toBeGreaterThanOrEqual(2)
    expect(result[0].semanaLabel).toMatch(/^S\d+/)
  })

  it('returns empty array for empty input', () => {
    expect(agruparPorSemanaISO([])).toEqual([])
  })

  it('sorts dates within each week', () => {
    const dates = ['2026-03-05', '2026-03-02', '2026-03-04', '2026-03-03']
    const result = agruparPorSemanaISO(dates)
    expect(result).toHaveLength(1)
    expect(result[0].dates).toEqual(['2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05'])
    expect(result[0].startDate).toBe('2026-03-02')
    expect(result[0].endDate).toBe('2026-03-05')
  })

  it('groups multi-week range correctly', () => {
    // 7 days spanning two ISO weeks: S9 (Sun) and S10 (Mon-Sat)
    const dates = [
      '2026-03-01', // Sun → S9
      '2026-03-02', // Mon → S10
      '2026-03-03', // Tue → S10
      '2026-03-04', // Wed → S10
      '2026-03-05', // Thu → S10
      '2026-03-06', // Fri → S10
      '2026-03-07', // Sat → S10
    ]
    const result = agruparPorSemanaISO(dates)
    expect(result).toHaveLength(2)
    expect(result[0].weekNumber).toBe(9)
    expect(result[0].dates).toEqual(['2026-03-01'])
    expect(result[1].weekNumber).toBe(10)
    expect(result[1].dates).toHaveLength(6)
  })
})
