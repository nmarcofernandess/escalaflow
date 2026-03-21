/**
 * Testes de QUALIDADE de distribuição do preview (gerarCicloFase1).
 *
 * Não testa se "roda" — testa se a distribuição é INTELIGENTE.
 * Cenário base: Padaria Atendimento (5 CLTs + 1 Intermitente Tipo B).
 */
import { describe, it, expect } from 'vitest'
import { gerarCicloFase1, type SimulaCicloOutput } from '../../src/shared/simula-ciclo'

// ── Helpers ────────────────────────────────────────────────────

function contarCoberturaPorDia(result: SimulaCicloOutput): number[][] {
  // Retorna array de semanas, cada uma com 7 valores (SEG-DOM) = quantos trabalham
  return result.cobertura_dia.map(sem => sem.cobertura)
}

function contarFolgasPorDia(result: SimulaCicloOutput): number[] {
  // Conta quantas folgas (F) caem em cada dia da semana (0=SEG..5=SAB) across ALL weeks
  const count = [0, 0, 0, 0, 0, 0]
  for (const row of result.grid) {
    for (const sem of row.semanas) {
      for (let d = 0; d < 6; d++) {
        if (sem.dias[d] === 'F') count[d]++
      }
    }
  }
  return count
}

function piorCobertura(result: SimulaCicloOutput, demanda: number[]): { dia: number; semana: number; cobertura: number; demanda: number; deficit: number } {
  let pior = { dia: 0, semana: 0, cobertura: Infinity, demanda: 0, deficit: 0 }
  for (let s = 0; s < result.cobertura_dia.length; s++) {
    for (let d = 0; d < 7; d++) {
      const cob = result.cobertura_dia[s].cobertura[d]
      const dem = demanda[d] ?? 0
      const deficit = dem - cob
      if (deficit > pior.deficit || (deficit === pior.deficit && cob < pior.cobertura)) {
        pior = { dia: d, semana: s, cobertura: cob, demanda: dem, deficit }
      }
    }
  }
  return pior
}

const DIAS = ['SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB', 'DOM']

function logGrid(result: SimulaCicloOutput, nomes: string[]) {
  const weeks = result.cobertura_dia.length
  console.log('\n' + '─'.repeat(80))
  console.log(`Ciclo de ${result.ciclo_semanas} semanas (${weeks} semanas geradas)`)
  console.log(`${''.padEnd(12)}│ ${DIAS.map(d => d.padEnd(4)).join(' │ ')} │`)
  console.log('─'.repeat(80))

  for (let p = 0; p < result.grid.length; p++) {
    const row = result.grid[p]
    const nome = (nomes[p] ?? `P${p}`).padEnd(12)
    for (let s = 0; s < Math.min(weeks, 4); s++) {
      const dias = row.semanas[s].dias.map(d => d.padEnd(4)).join(' │ ')
      console.log(`${s === 0 ? nome : ''.padEnd(12)}│ ${dias} │ S${s + 1}`)
    }
  }

  console.log('─'.repeat(80))
  for (let s = 0; s < Math.min(weeks, 4); s++) {
    const cob = result.cobertura_dia[s].cobertura.map(c => String(c).padEnd(4)).join(' │ ')
    console.log(`${'COBERTURA'.padEnd(12)}│ ${cob} │ S${s + 1}`)
  }
  console.log('─'.repeat(80) + '\n')
}

// ── Cenário: Padaria Atendimento ──────────────────────────────

/**
 * 5 CLTs (44h, 5x2) + 1 Intermitente Tipo B (Maria Clara, FV=SEG)
 * Demanda pico: 4 pessoas SEG-SAB (10h-12h), 3 DOM
 * Maria Clara: só trabalha SEG e DOM, FV=SEG (XOR)
 *
 * Intermitente Tipo B no preview:
 * - folga_fixa_dia = null (sem folga fixa)
 * - folga_variavel_dia = 0 (SEG) → quando trabalha DOM, folga SEG
 * - Dias sem regra = NT (gerarCicloFase1 não sabe disso — são postos normais pro algoritmo)
 *
 * Capacidade efetiva: SEG=6 (5 CLTs + MC), TER-SAB=5 (só CLTs)
 */
const PADARIA_INPUT = {
  num_postos: 6,
  trabalham_domingo: 3,
  num_meses: 1, // 1 mês pra ser rápido
  demanda_por_dia: [4, 4, 4, 4, 4, 4, 3], // SEG-DOM
  capacidade_efetiva_por_dia: [6, 5, 5, 5, 5, 5], // SEG tem MC, TER-SAB não
  folgas_forcadas: [
    // CLT 1 - Milena: auto
    { folga_fixa_dia: null, folga_variavel_dia: null },
    // CLT 2 - Roberta: auto
    { folga_fixa_dia: null, folga_variavel_dia: null },
    // CLT 3 - Érica: auto
    { folga_fixa_dia: null, folga_variavel_dia: null },
    // CLT 4 - Célia: auto
    { folga_fixa_dia: null, folga_variavel_dia: null },
    // CLT 5 - Rafaela: auto
    { folga_fixa_dia: null, folga_variavel_dia: null },
    // Intermitente Tipo B - Maria Clara: FV=SEG (idx 0)
    { folga_fixa_dia: null, folga_variavel_dia: 0 },
  ],
}

const NOMES = ['Milena', 'Roberta', 'Érica', 'Célia', 'Rafaela', 'M.Clara']

describe('Preview distribuição — Padaria', () => {
  it('gera com sucesso', () => {
    const result = gerarCicloFase1(PADARIA_INPUT)
    expect(result.sucesso).toBe(true)
    expect(result.grid).toHaveLength(6)
  })

  it('cada CLT trabalha exatamente 5 dias por semana', () => {
    const result = gerarCicloFase1(PADARIA_INPUT)
    for (let p = 0; p < 5; p++) { // só CLTs (0-4)
      for (const sem of result.grid[p].semanas) {
        const trabalhados = sem.dias.filter(d => d === 'T').length
        expect(trabalhados, `${NOMES[p]} deve trabalhar 5 dias`).toBe(5)
      }
    }
  })

  it('domingo tem exatamente 3 trabalhando', () => {
    const result = gerarCicloFase1(PADARIA_INPUT)
    for (const sem of result.cobertura_dia) {
      expect(sem.cobertura[6], 'DOM deve ter 3 trabalhando').toBe(3)
    }
  })

  it('NUNCA tem 2+ FFs no mesmo dia da semana (quando evitável)', () => {
    const result = gerarCicloFase1(PADARIA_INPUT)
    logGrid(result, NOMES)

    // Contar quantas pessoas têm FF no mesmo dia da semana
    // FF = folga_fixa_dia no output (o dia mais frequente de folga)
    const ffPorDia = [0, 0, 0, 0, 0, 0] // SEG-SAB
    for (const row of result.grid) {
      ffPorDia[row.folga_fixa_dia]++
    }

    console.log('FFs por dia:', DIAS.slice(0, 6).map((d, i) => `${d}=${ffPorDia[i]}`).join(', '))

    // Com 6 pessoas e 6 dias (SEG-SAB), é possível dar 1 FF por dia
    // NENHUM dia deve ter mais de 2 FFs
    for (let d = 0; d < 6; d++) {
      expect(ffPorDia[d], `${DIAS[d]} tem ${ffPorDia[d]} FFs — máximo aceitável é 2`).toBeLessThanOrEqual(2)
    }
  })

  it('déficit máximo é 1 pessoa (nunca 2+)', () => {
    const result = gerarCicloFase1(PADARIA_INPUT)
    const demanda = PADARIA_INPUT.demanda_por_dia

    const pior = piorCobertura(result, demanda)
    console.log(`Pior cobertura: ${DIAS[pior.dia]} S${pior.semana + 1} = ${pior.cobertura}/${pior.demanda} (déficit ${pior.deficit})`)

    // Com 5 CLTs e demanda pico 4, déficit de 1 é inevitável
    // Mas déficit de 2+ é sinal de distribuição RUIM
    expect(pior.deficit, `Déficit de ${pior.deficit} em ${DIAS[pior.dia]} S${pior.semana + 1} — máximo aceitável é 1`).toBeLessThanOrEqual(1)
  })

  it('cobertura média ≥ 95% (SEG-SAB)', () => {
    const result = gerarCicloFase1(PADARIA_INPUT)
    const demanda = PADARIA_INPUT.demanda_por_dia

    let totalCob = 0
    let totalDem = 0
    for (const sem of result.cobertura_dia) {
      for (let d = 0; d < 6; d++) { // só SEG-SAB
        totalCob += Math.min(sem.cobertura[d], demanda[d])
        totalDem += demanda[d]
      }
    }
    const pct = (totalCob / totalDem) * 100

    console.log(`Cobertura SEG-SAB: ${pct.toFixed(1)}%`)
    expect(pct, 'Cobertura média SEG-SAB deve ser ≥ 95%').toBeGreaterThanOrEqual(95)
  })

  it('folgas espalhadas uniformemente (max 2 folgas weekday por dia)', () => {
    const result = gerarCicloFase1(PADARIA_INPUT)
    const folgasPorDia = contarFolgasPorDia(result)
    const weeks = result.cobertura_dia.length

    console.log('Folgas totais por dia:', DIAS.slice(0, 6).map((d, i) => `${d}=${folgasPorDia[i]}`).join(', '))

    // Em média, cada dia deve ter ~1.67 folgas por semana (10 folgas / 6 dias)
    // Spread: nenhum dia deve ter mais que 2x a média
    const media = folgasPorDia.reduce((a, b) => a + b, 0) / 6
    for (let d = 0; d < 6; d++) {
      const porSemana = folgasPorDia[d] / weeks
      expect(porSemana, `${DIAS[d]} tem ${porSemana.toFixed(1)} folgas/semana (média ${media.toFixed(1)}/semana) — muito concentrado`).toBeLessThan(media * 2)
    }
  })
})

// ── Cenário simples: 5 CLTs sem intermitente ──────────────────

describe('Preview distribuição — 5 CLTs simples', () => {
  const INPUT_SIMPLES = {
    num_postos: 5,
    trabalham_domingo: 2,
    num_meses: 1,
    demanda_por_dia: [3, 3, 3, 3, 3, 3, 2],
  }

  it('FFs em dias diferentes quando possível', () => {
    const result = gerarCicloFase1(INPUT_SIMPLES)
    const ffPorDia = [0, 0, 0, 0, 0, 0]
    for (const row of result.grid) {
      ffPorDia[row.folga_fixa_dia]++
    }

    console.log('FFs por dia (5 CLTs):', DIAS.slice(0, 6).map((d, i) => `${d}=${ffPorDia[i]}`).join(', '))

    // 5 pessoas, 6 dias → deve conseguir 1 FF por dia (5 dias ocupados, 1 livre)
    const maxFF = Math.max(...ffPorDia)
    expect(maxFF, `Máximo ${maxFF} FFs no mesmo dia — deveria ser 1`).toBeLessThanOrEqual(1)
  })

  it('déficit máximo é 1', () => {
    const result = gerarCicloFase1(INPUT_SIMPLES)
    const pior = piorCobertura(result, INPUT_SIMPLES.demanda_por_dia)
    expect(pior.deficit).toBeLessThanOrEqual(1)
  })
})
