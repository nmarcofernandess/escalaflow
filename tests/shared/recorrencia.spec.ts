import { describe, expect, it } from 'vitest'
import {
  inicioDaSemana,
  indiceSemanaRecorrencia,
  semanaEhOff,
  expandirSemanasOff,
} from '../../src/shared/recorrencia'

// Calendário de referência: 2026-03-02 é SEGUNDA-feira.

describe('inicioDaSemana', () => {
  it('corte SEG_DOM: qualquer dia da semana volta pra segunda', () => {
    expect(inicioDaSemana('2026-03-02', 'SEG_DOM')).toBe('2026-03-02') // SEG
    expect(inicioDaSemana('2026-03-04', 'SEG_DOM')).toBe('2026-03-02') // QUA
    expect(inicioDaSemana('2026-03-08', 'SEG_DOM')).toBe('2026-03-02') // DOM
    expect(inicioDaSemana('2026-03-09', 'SEG_DOM')).toBe('2026-03-09') // SEG seguinte
  })

  it('corte DOM_SAB: semana começa no domingo', () => {
    expect(inicioDaSemana('2026-03-02', 'DOM_SAB')).toBe('2026-03-01') // SEG → DOM anterior
    expect(inicioDaSemana('2026-03-01', 'DOM_SAB')).toBe('2026-03-01') // DOM
    expect(inicioDaSemana('2026-03-07', 'DOM_SAB')).toBe('2026-03-01') // SAB
  })
})

describe('indiceSemanaRecorrencia', () => {
  it('mesma semana = 0, semanas seguintes incrementam', () => {
    expect(indiceSemanaRecorrencia('2026-03-05', '2026-03-02', 'SEG_DOM')).toBe(0)
    expect(indiceSemanaRecorrencia('2026-03-09', '2026-03-02', 'SEG_DOM')).toBe(1)
    expect(indiceSemanaRecorrencia('2026-03-29', '2026-03-02', 'SEG_DOM')).toBe(3)
  })

  it('data antes da ancora = índice negativo', () => {
    expect(indiceSemanaRecorrencia('2026-02-23', '2026-03-02', 'SEG_DOM')).toBe(-1)
  })
})

describe('semanaEhOff', () => {
  const rec11 = { semanas_trabalho: 1, semanas_folga: 1, ancora: '2026-03-02' }

  it('1/1: semana da âncora é ON, alterna a partir dela', () => {
    expect(semanaEhOff('2026-03-02', rec11, 'SEG_DOM')).toBe(false) // semana 0 → ON
    expect(semanaEhOff('2026-03-09', rec11, 'SEG_DOM')).toBe(true)  // semana 1 → OFF
    expect(semanaEhOff('2026-03-16', rec11, 'SEG_DOM')).toBe(false) // semana 2 → ON
  })

  it('1/1: período ANTES da âncora segue o mesmo ciclo (módulo correto p/ negativo)', () => {
    expect(semanaEhOff('2026-02-23', rec11, 'SEG_DOM')).toBe(true)  // semana -1 → OFF
    expect(semanaEhOff('2026-02-16', rec11, 'SEG_DOM')).toBe(false) // semana -2 → ON
  })

  it('2/1: duas ON, uma OFF', () => {
    const rec21 = { semanas_trabalho: 2, semanas_folga: 1, ancora: '2026-03-02' }
    expect(semanaEhOff('2026-03-02', rec21, 'SEG_DOM')).toBe(false) // 0 → ON
    expect(semanaEhOff('2026-03-09', rec21, 'SEG_DOM')).toBe(false) // 1 → ON
    expect(semanaEhOff('2026-03-16', rec21, 'SEG_DOM')).toBe(true)  // 2 → OFF
    expect(semanaEhOff('2026-03-23', rec21, 'SEG_DOM')).toBe(false) // 3 → ON
  })
})

describe('expandirSemanasOff', () => {
  it('1/1 em 4 semanas exatas: ranges das semanas 2 e 4', () => {
    const ranges = expandirSemanasOff({
      data_inicio: '2026-03-02',
      data_fim: '2026-03-29',
      corte_semanal: 'SEG_DOM',
      recorrencia: { semanas_trabalho: 1, semanas_folga: 1, ancora: '2026-03-02' },
    })
    expect(ranges).toEqual([
      { data_inicio: '2026-03-09', data_fim: '2026-03-15' },
      { data_inicio: '2026-03-23', data_fim: '2026-03-29' },
    ])
  })

  it('período cortando semana OFF no meio: range parcial', () => {
    const ranges = expandirSemanasOff({
      data_inicio: '2026-03-11', // QUA da semana OFF
      data_fim: '2026-03-20',
      corte_semanal: 'SEG_DOM',
      recorrencia: { semanas_trabalho: 1, semanas_folga: 1, ancora: '2026-03-02' },
    })
    expect(ranges).toEqual([{ data_inicio: '2026-03-11', data_fim: '2026-03-15' }])
  })

  it('sem semana OFF no período: array vazio', () => {
    const ranges = expandirSemanasOff({
      data_inicio: '2026-03-02',
      data_fim: '2026-03-08',
      corte_semanal: 'SEG_DOM',
      recorrencia: { semanas_trabalho: 1, semanas_folga: 1, ancora: '2026-03-02' },
    })
    expect(ranges).toEqual([])
  })
})
