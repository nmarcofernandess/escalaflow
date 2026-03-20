import { describe, it, expect } from 'vitest'
import { runPreviewMultiPass, type MultiPassInput } from '../../src/shared/preview-multi-pass'
import { resolveSundayRotatingDemand } from '../../src/shared/sunday-cycle'
import type { RuleConfig } from '../../src/shared/types'

/** Helper: builds a valid MultiPassInput with sane defaults.
 *  Override any field via partial. */
function makeInput(overrides: Partial<{
  N: number
  K: number
  rules: RuleConfig
  participants: MultiPassInput['participants']
  demandaPorDia: number[]
}>): MultiPassInput {
  const N = overrides.N ?? 6
  const K = overrides.K ?? 2
  const rules: RuleConfig = overrides.rules ?? {}
  const participants: MultiPassInput['participants'] = overrides.participants
    ?? Array.from({ length: N }, (_, i) => ({
      id: i + 1,
      nome: `Pessoa ${i + 1}`,
      sexo: (i % 2 === 0 ? 'M' : 'F') as 'M' | 'F',
    }))
  const demandaPorDia = overrides.demandaPorDia ?? [3, 3, 3, 3, 3, 3, K]

  return {
    fase1Input: { num_postos: N, trabalham_domingo: K },
    participants,
    demandaPorDia,
    trabalhamDomingo: K,
    rules,
  }
}

describe('runPreviewMultiPass', () => {
  it('Pass 1 strict succeeds when K <= N/2', () => {
    // N=6, K=2 => kMaxSemTT=3, K<=3 => strict should work
    const result = runPreviewMultiPass(makeInput({ N: 6, K: 2 }))

    expect(result.pass_usado).toBe(1)
    expect(result.relaxed).toBe(false)
    expect(result.output.sucesso).toBe(true)
    expect(result.output.grid).toHaveLength(6)
  })

  it('Pass 2 relaxed when K > N/2 and H3 SOFT', () => {
    // N=6, K=4 => kMaxSemTT=3, K>3 => strict fails
    // H3 rules SOFT => can relax
    const result = runPreviewMultiPass(makeInput({
      N: 6,
      K: 4,
      rules: { H3_DOM_MAX_CONSEC_M: 'SOFT', H3_DOM_MAX_CONSEC_F: 'SOFT' },
    }))

    expect(result.pass_usado).toBe(2)
    expect(result.relaxed).toBe(true)
    expect(result.output.sucesso).toBe(true)
    expect(result.output.grid).toHaveLength(6)
  })

  it('Diagnostics show WARNING (not BLOCK) when relaxed with SOFT', () => {
    // Same scenario: relaxed pass with SOFT rules
    const result = runPreviewMultiPass(makeInput({
      N: 6,
      K: 4,
      rules: { H3_DOM_MAX_CONSEC_M: 'SOFT', H3_DOM_MAX_CONSEC_F: 'SOFT' },
    }))

    expect(result.relaxed).toBe(true)
    // Any H3 diagnostics should be warning, not error
    const h3Diags = result.diagnostics.filter(d => d.code.startsWith('H3_DOM_MAX_CONSEC'))
    for (const d of h3Diags) {
      expect(d.severity).toBe('warning')
      expect(d.gate).not.toBe('BLOCK')
    }
  })

  it('Returns pass1 when K > N/2 and H3 HARD (cannot relax)', () => {
    // N=6, K=4 => strict fails, H3 HARD => cannot relax
    // Advisory handles the proposal — no BLOCK diagnostic needed here
    const result = runPreviewMultiPass(makeInput({
      N: 6,
      K: 4,
      rules: { H3_DOM_MAX_CONSEC_M: 'HARD', H3_DOM_MAX_CONSEC_F: 'HARD' },
    }))

    expect(result.pass_usado).toBe(1)
    expect(result.relaxed).toBe(false)
    const blockedDiag = result.diagnostics.find(d => d.code === 'PREVIEW_ESTRITO_BLOQUEADO')
    expect(blockedDiag).toBeUndefined()
  })

  it('Passes domingo_ciclo_trabalho/folga to diagnostics (ciclo 1:1, capacity matches K)', () => {
    // N=6, K=3 => strict works (3 <= 3)
    // Give each non-dom participant a 1:1 cycle (trabalho=1, folga=1)
    // Exact capacity with 1:1 = floor(6 * 1/2) = 3, matches K=3
    const participants = Array.from({ length: 6 }, (_, i) => ({
      id: i + 1,
      nome: `Pessoa ${i + 1}`,
      sexo: (i % 2 === 0 ? 'M' : 'F') as 'M' | 'F',
      domingo_ciclo_trabalho: 1,
      domingo_ciclo_folga: 1,
    }))

    const result = runPreviewMultiPass(makeInput({
      N: 6,
      K: 3,
      participants,
      rules: { H3_DOM_CICLO_EXATO: 'SOFT' },
    }))

    expect(result.pass_usado).toBe(1)
    expect(result.output.sucesso).toBe(true)

    // With capacity=3 and K=3, no ciclo_exato diagnostic expected
    const cicloDiag = result.diagnostics.find(d => d.code === 'H3_DOM_CICLO_EXATO')
    expect(cicloDiag).toBeUndefined()
  })

  it('Detects ciclo exato insuficiente when capacity < K (ciclo 1:2)', () => {
    // N=6, K=3 => strict works
    // Cycle 1:2 (trabalho=1, folga=2) => capacity = floor(6 * 1/3) = 2 < K=3
    const participants = Array.from({ length: 6 }, (_, i) => ({
      id: i + 1,
      nome: `Pessoa ${i + 1}`,
      sexo: (i % 2 === 0 ? 'M' : 'F') as 'M' | 'F',
      domingo_ciclo_trabalho: 1,
      domingo_ciclo_folga: 2,
    }))

    const result = runPreviewMultiPass(makeInput({
      N: 6,
      K: 3,
      participants,
      rules: { H3_DOM_CICLO_EXATO: 'HARD' },
    }))

    expect(result.output.sucesso).toBe(true)
    // capacity = floor(6 * 1/3) = 2, but K=3 => should emit H3_DOM_CICLO_EXATO
    const cicloDiag = result.diagnostics.find(d => d.code === 'H3_DOM_CICLO_EXATO')
    expect(cicloDiag).toBeDefined()
    expect(cicloDiag!.severity).toBe('error')
    expect(cicloDiag!.gate).toBe('CONFIRM_OVERRIDE')
  })

  it('Pass 1 strict stays feasible when a fixed Sunday intermitente removes one DOM slot from the CLT pool', () => {
    const sunday = resolveSundayRotatingDemand({
      totalSundayDemand: 3,
      guaranteedSundayCoverage: 1,
      rotatingPoolSize: 5,
    })

    const participants = Array.from({ length: 5 }, (_, i) => ({
      id: i + 1,
      nome: `Pessoa ${i + 1}`,
      sexo: 'F' as const,
    }))

    const result = runPreviewMultiPass({
      fase1Input: {
        num_postos: 5,
        trabalham_domingo: sunday.effectiveSundayDemand,
        demanda_por_dia: [3, 3, 3, 3, 3, 3, sunday.residualSundayDemand],
      },
      participants,
      demandaPorDia: [3, 3, 3, 3, 3, 3, sunday.residualSundayDemand],
      trabalhamDomingo: sunday.effectiveSundayDemand,
      rules: { H3_DOM_MAX_CONSEC_F: 'HARD' },
    })

    expect(sunday.residualSundayDemand).toBe(2)
    expect(result.pass_usado).toBe(1)
    expect(result.relaxed).toBe(false)
    expect(result.output.sucesso).toBe(true)
    expect(result.diagnostics.find((diag) => diag.code === 'PREVIEW_INVALIDO')).toBeUndefined()
  })

  it('Returns diagnostics even when output fails (K > N)', () => {
    // K=8 > N=6 => impossible even relaxed
    const result = runPreviewMultiPass(makeInput({
      N: 6,
      K: 8,
      rules: { H3_DOM_MAX_CONSEC_M: 'SOFT', H3_DOM_MAX_CONSEC_F: 'SOFT' },
    }))

    expect(result.output.sucesso).toBe(false)
    expect(result.diagnostics.length).toBeGreaterThan(0)
    const previewDiag = result.diagnostics.find(d => d.code === 'PREVIEW_INVALIDO')
    expect(previewDiag).toBeDefined()
    expect(previewDiag!.gate).toBe('BLOCK')
    // K > N means causaEhTT is false (K > N, not K <= N), so no relaxation
    expect(result.relaxed).toBe(false)
    expect(result.pass_usado).toBe(1)
  })
})
