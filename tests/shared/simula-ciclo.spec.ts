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

describe('gerarCicloFase1 com demanda_por_dia', () => {
  it('distribui folgas nos dias com menos demanda', () => {
    // SEG=1 (baixa), TER=1 (baixa), QUA=3 (alta), QUI=3, SEX=4 (pico), SAB=2, DOM=2
    const result = gerarCicloFase1({
      num_postos: 5,
      trabalham_domingo: 2,
      demanda_por_dia: [1, 1, 3, 3, 4, 2, 2],
    })

    expect(result.sucesso).toBe(true)

    const folgasPorDia = [0, 0, 0, 0, 0, 0]
    for (const row of result.grid) {
      for (const semana of row.semanas) {
        for (let d = 0; d < 6; d++) {
          if (semana.dias[d] === 'F') folgasPorDia[d]++
        }
      }
    }

    // More folgas on low-demand days than high-demand
    expect(folgasPorDia[0] + folgasPorDia[1]).toBeGreaterThan(folgasPorDia[4])

    // Coverage balance: folgas SPREAD across days
    for (const cob of result.cobertura_dia) {
      const weekdayCov = cob.cobertura.slice(0, 6)
      const cobMax = Math.max(...weekdayCov)
      const cobMin = Math.min(...weekdayCov)
      expect(cobMax - cobMin).toBeLessThanOrEqual(3)
    }
  })

  it('funciona sem demanda_por_dia (fallback p%6)', () => {
    const result = gerarCicloFase1({
      num_postos: 5,
      trabalham_domingo: 2,
    })
    expect(result.sucesso).toBe(true)
    expect(result.stats.h1_violacoes).toBe(0)
  })

  it('demanda_por_dia com folgas_forcadas respeita forcadas', () => {
    const result = gerarCicloFase1({
      num_postos: 4,
      trabalham_domingo: 1,
      demanda_por_dia: [1, 1, 3, 3, 4, 2, 1],
      folgas_forcadas: [
        { folga_fixa_dia: 2, folga_variavel_dia: null },
        { folga_fixa_dia: null, folga_variavel_dia: null },
        { folga_fixa_dia: null, folga_variavel_dia: null },
        { folga_fixa_dia: null, folga_variavel_dia: null },
      ],
    })
    expect(result.sucesso).toBe(true)
    for (const semana of result.grid[0].semanas) {
      expect(semana.dias[2]).toBe('F')
    }
  })
})
