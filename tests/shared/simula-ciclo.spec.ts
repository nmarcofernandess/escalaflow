import { describe, it, expect } from 'vitest'
import { gerarCicloFase1 } from '../../src/shared/simula-ciclo'

describe('gerarCicloFase1', () => {
  it('gera ciclo basico 5 pessoas, K=2', () => {
    const result = gerarCicloFase1({
      num_postos: 5,
      trabalham_domingo: 2,
    })
    expect(result.sucesso).toBe(true)
    expect(result.grid).toHaveLength(5)
    for (const row of result.grid) {
      expect(row.semanas.length).toBeGreaterThan(0)
    }
    expect(result.stats.h1_violacoes).toBe(0)
    expect(result.stats.cobertura_min).toBeGreaterThan(0)
  })

  it('trata folga_fixa_dom: todos domingos F, nao participa da rotacao', () => {
    const result = gerarCicloFase1({
      num_postos: 5,
      trabalham_domingo: 2,
      folgas_forcadas: [
        { folga_fixa_dia: null, folga_variavel_dia: null, folga_fixa_dom: true },
        { folga_fixa_dia: null, folga_variavel_dia: null },
        { folga_fixa_dia: null, folga_variavel_dia: null },
        { folga_fixa_dia: null, folga_variavel_dia: null },
        { folga_fixa_dia: null, folga_variavel_dia: null },
      ],
    })

    expect(result.sucesso).toBe(true)

    // Person 0 (folga_fixa_dom) must have ALL Sundays as F
    const person0 = result.grid[0]
    for (const semana of person0.semanas) {
      expect(semana.dias[6]).toBe('F')
    }

    // Person 0 should still have ~2 folgas per week (DOM + 1 weekday)
    for (const semana of person0.semanas) {
      const folgas = semana.dias.filter(d => d === 'F').length
      expect(folgas).toBeGreaterThanOrEqual(2)
    }

    // Other people should still participate in Sunday rotation
    let anyoneWorksSunday = false
    for (let p = 1; p < 5; p++) {
      for (const semana of result.grid[p].semanas) {
        if (semana.dias[6] === 'T') anyoneWorksSunday = true
      }
    }
    expect(anyoneWorksSunday).toBe(true)
  })

  it('H1 nao viola com folga_fixa_dom', () => {
    const result = gerarCicloFase1({
      num_postos: 4,
      trabalham_domingo: 1,
      folgas_forcadas: [
        { folga_fixa_dia: 2, folga_variavel_dia: null, folga_fixa_dom: true },
        { folga_fixa_dia: null, folga_variavel_dia: null },
        { folga_fixa_dia: null, folga_variavel_dia: null },
        { folga_fixa_dia: null, folga_variavel_dia: null },
      ],
    })

    expect(result.sucesso).toBe(true)
    expect(result.stats.h1_violacoes).toBe(0)

    const person0 = result.grid[0]
    for (const semana of person0.semanas) {
      expect(semana.dias[6]).toBe('F')
      expect(semana.dias[2]).toBe('F')
    }
  })

  it('K=0 com folga_fixa_dom nao explode', () => {
    const result = gerarCicloFase1({
      num_postos: 3,
      trabalham_domingo: 0,
      folgas_forcadas: [
        { folga_fixa_dia: null, folga_variavel_dia: null, folga_fixa_dom: true },
        { folga_fixa_dia: null, folga_variavel_dia: null },
        { folga_fixa_dia: null, folga_variavel_dia: null },
      ],
    })

    expect(result.sucesso).toBe(true)
    for (const row of result.grid) {
      for (const semana of row.semanas) {
        expect(semana.dias[6]).toBe('F')
      }
    }
  })
})
