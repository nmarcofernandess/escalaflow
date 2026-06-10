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

// ─────────────────────────────────────────────────────────────────────────────
// Regime 6X1 — 1 folga/semana (XOR puro com domingo)
// ─────────────────────────────────────────────────────────────────────────────

describe('gerarCicloFase1 — regime 6X1', () => {
  it('rodizio: ~1 folga/semana (folga extra apenas na transicao que evitaria 7+ dias corridos)', () => {
    const result = gerarCicloFase1({
      num_postos: 6,
      trabalham_domingo: 3,
      regime: '6X1',
    })
    expect(result.sucesso).toBe(true)
    expect(result.grid).toHaveLength(6)
    let semanasCom1Folga = 0
    let totalSemanas = 0
    for (const row of result.grid) {
      for (const semana of row.semanas) {
        const folgas = semana.dias.filter(d => d === 'F').length
        // Matemática do 6x1 em semanas civis: na transição "trabalha DOM →
        // folga DOM", 6 dias exatos nas duas semanas forçariam 7+ dias
        // corridos (viola H1). O repair injeta 1 folga extra nessa semana —
        // mesmo comportamento do solver real (relaxa DIAS_TRABALHO no pass 2).
        expect(folgas, `${row.posto}: 1 folga (2 na transição)`).toBeGreaterThanOrEqual(1)
        expect(folgas).toBeLessThanOrEqual(2)
        expect(semana.dias_trabalhados).toBeGreaterThanOrEqual(5)
        expect(semana.dias_trabalhados).toBeLessThanOrEqual(6)
        totalSemanas++
        if (folgas === 1) semanasCom1Folga++
      }
    }
    // A maioria das semanas tem exatamente 1 folga (6 dias de trabalho)
    expect(semanasCom1Folga / totalSemanas).toBeGreaterThan(0.5)
    expect(result.stats.folgas_por_pessoa_semana).toBeLessThan(1.6)
  })

  it('rodizio: semana que trabalha DOM folga no dia variavel; folga fixa é null', () => {
    const result = gerarCicloFase1({
      num_postos: 4,
      trabalham_domingo: 2,
      regime: '6X1',
    })
    expect(result.sucesso).toBe(true)
    for (const row of result.grid) {
      expect(row.folga_fixa_dia, 'rodizio 6x1 nao tem folga fixa').toBeNull()
      expect(row.folga_variavel_dia).not.toBeNull()
      for (const semana of row.semanas) {
        const folgasSemana = semana.dias.slice(0, 6).filter(d => d === 'F').length
        if (semana.trabalhou_domingo) {
          // O repair só ADICIONA folga — o dia variável permanece F
          expect(semana.dias[row.folga_variavel_dia!]).toBe('F')
        } else {
          // Folgou DOM: no máximo 1 folga extra em SEG-SAB (repair de transição)
          expect(folgasSemana).toBeLessThanOrEqual(1)
        }
      }
    }
  })

  it('folga_fixa_dom: folga todo DOM e trabalha SEG-SAB inteiro', () => {
    const result = gerarCicloFase1({
      num_postos: 4,
      trabalham_domingo: 2,
      regime: '6X1',
      folgas_forcadas: [
        { folga_fixa_dia: null, folga_variavel_dia: null, folga_fixa_dom: true },
        { folga_fixa_dia: null, folga_variavel_dia: null },
        { folga_fixa_dia: null, folga_variavel_dia: null },
        { folga_fixa_dia: null, folga_variavel_dia: null },
      ],
    })
    expect(result.sucesso).toBe(true)
    for (const semana of result.grid[0].semanas) {
      expect(semana.dias[6]).toBe('F')
      expect(semana.dias.slice(0, 6).every(d => d === 'T')).toBe(true)
      expect(semana.dias_trabalhados).toBe(6)
    }
  })

  it('folga fixa SEG-SAB forcada: F nesse dia toda semana e trabalha TODOS os domingos', () => {
    const result = gerarCicloFase1({
      num_postos: 4,
      trabalham_domingo: 2,
      regime: '6X1',
      folgas_forcadas: [
        { folga_fixa_dia: 2, folga_variavel_dia: null }, // QUA
        { folga_fixa_dia: null, folga_variavel_dia: null },
        { folga_fixa_dia: null, folga_variavel_dia: null },
        { folga_fixa_dia: null, folga_variavel_dia: null },
      ],
    })
    expect(result.sucesso).toBe(true)
    const p0 = result.grid[0]
    expect(p0.folga_fixa_dia).toBe(2)
    expect(p0.folga_variavel_dia).toBeNull()
    for (const semana of p0.semanas) {
      expect(semana.dias[2]).toBe('F')
      expect(semana.dias[6], 'fixa em 6x1 implica trabalhar todo DOM').toBe('T')
      expect(semana.dias_trabalhados).toBe(6)
    }
  })

  it('dia variavel forcado é respeitado nas semanas que trabalha DOM', () => {
    const result = gerarCicloFase1({
      num_postos: 4,
      trabalham_domingo: 2,
      regime: '6X1',
      folgas_forcadas: [
        { folga_fixa_dia: null, folga_variavel_dia: 4 }, // SEX
        { folga_fixa_dia: null, folga_variavel_dia: null },
        { folga_fixa_dia: null, folga_variavel_dia: null },
        { folga_fixa_dia: null, folga_variavel_dia: null },
      ],
    })
    expect(result.sucesso).toBe(true)
    const p0 = result.grid[0]
    expect(p0.folga_variavel_dia).toBe(4)
    for (const semana of p0.semanas) {
      if (semana.trabalhou_domingo) expect(semana.dias[4]).toBe('F')
    }
  })

  it('regressao 5x2: default continua com 2 folgas por semana', () => {
    const result = gerarCicloFase1({
      num_postos: 5,
      trabalham_domingo: 2,
    })
    expect(result.sucesso).toBe(true)
    expect(result.stats.folgas_por_pessoa_semana).toBeCloseTo(2, 0)
    for (const row of result.grid) {
      expect(row.folga_fixa_dia).not.toBeNull()
    }
  })
})

describe('gerarCicloFase1 — recorrência semanal', () => {
  const semRecorrencia = { folga_fixa_dia: null, folga_variavel_dia: null }

  it('1/1 com offset 0: semanas alternadas inteiras de folga', () => {
    const result = gerarCicloFase1({
      num_postos: 4,
      trabalham_domingo: 2,
      num_meses: 1, // 4 semanas
      folgas_forcadas: [
        { ...semRecorrencia, recorrencia: { semanas_trabalho: 1, semanas_folga: 1, offset_semanas: 0 } },
        { ...semRecorrencia },
        { ...semRecorrencia },
        { ...semRecorrencia },
      ],
    })
    expect(result.sucesso).toBe(true)
    const pessoa = result.grid[0]
    // offset 0 → semana 0 ON, semana 1 OFF, semana 2 ON, semana 3 OFF
    for (let w = 0; w < pessoa.semanas.length; w++) {
      const dias = pessoa.semanas[w].dias
      if (w % 2 === 1) {
        expect(dias.every((d) => d === 'F'), `semana ${w} deveria ser toda F`).toBe(true)
      } else {
        expect(dias.some((d) => d === 'T'), `semana ${w} deveria ter trabalho`).toBe(true)
      }
    }
  })

  it('offset desloca o ciclo (offset 1 → primeira semana já é OFF)', () => {
    const result = gerarCicloFase1({
      num_postos: 4,
      trabalham_domingo: 2,
      num_meses: 1,
      folgas_forcadas: [
        { ...semRecorrencia, recorrencia: { semanas_trabalho: 1, semanas_folga: 1, offset_semanas: 1 } },
        { ...semRecorrencia },
        { ...semRecorrencia },
        { ...semRecorrencia },
      ],
    })
    expect(result.sucesso).toBe(true)
    expect(result.grid[0].semanas[0].dias.every((d) => d === 'F')).toBe(true)
    expect(result.grid[0].semanas[1].dias.some((d) => d === 'T')).toBe(true)
  })

  it('2/1: duas semanas ON, uma OFF', () => {
    const result = gerarCicloFase1({
      num_postos: 4,
      trabalham_domingo: 2,
      num_meses: 1,
      folgas_forcadas: [
        { ...semRecorrencia, recorrencia: { semanas_trabalho: 2, semanas_folga: 1, offset_semanas: 0 } },
        { ...semRecorrencia },
        { ...semRecorrencia },
        { ...semRecorrencia },
      ],
    })
    expect(result.sucesso).toBe(true)
    const semanas = result.grid[0].semanas
    expect(semanas[0].dias.some((d) => d === 'T')).toBe(true)
    expect(semanas[1].dias.some((d) => d === 'T')).toBe(true)
    expect(semanas[2].dias.every((d) => d === 'F')).toBe(true)
    expect(semanas[3].dias.some((d) => d === 'T')).toBe(true)
  })

  it('cobertura reflete a ausência nas semanas OFF', () => {
    const com = gerarCicloFase1({
      num_postos: 4, trabalham_domingo: 2, num_meses: 1,
      folgas_forcadas: [
        { ...semRecorrencia, recorrencia: { semanas_trabalho: 1, semanas_folga: 1, offset_semanas: 0 } },
        { ...semRecorrencia },
        { ...semRecorrencia },
        { ...semRecorrencia },
      ],
    })
    const sem = gerarCicloFase1({ num_postos: 4, trabalham_domingo: 2, num_meses: 1 })
    expect(com.stats.cobertura_min).toBeLessThanOrEqual(sem.stats.cobertura_min)
  })

  it('recorrência funciona junto com regime 6X1', () => {
    const result = gerarCicloFase1({
      num_postos: 4, trabalham_domingo: 2, num_meses: 1, regime: '6X1',
      folgas_forcadas: [
        { ...semRecorrencia, recorrencia: { semanas_trabalho: 1, semanas_folga: 1, offset_semanas: 0 } },
        { ...semRecorrencia },
        { ...semRecorrencia },
        { ...semRecorrencia },
      ],
    })
    expect(result.sucesso).toBe(true)
    expect(result.grid[0].semanas[1].dias.every((d) => d === 'F')).toBe(true)
    expect(result.grid[0].semanas[0].dias.some((d) => d === 'T')).toBe(true)
  })
})
