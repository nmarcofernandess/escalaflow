import { describe, it, expect } from 'vitest'
import { computeAdvisoryInputHash } from '../../src/shared/advisory-hash'
import type { EscalaAdvisoryInput } from '../../src/shared/advisory-types'

describe('computeAdvisoryInputHash', () => {
  const baseInput = {
    setor_id: 2,
    data_inicio: '2026-03-02',
    data_fim: '2026-03-08',
    pinned_folga_externo: [],
    current_folgas: [
      { colaborador_id: 1, fixa: 'SEG' as const, variavel: 'QUA' as const, origem_fixa: 'COLABORADOR' as const, origem_variavel: 'COLABORADOR' as const },
      { colaborador_id: 2, fixa: 'TER' as const, variavel: 'QUI' as const, origem_fixa: 'COLABORADOR' as const, origem_variavel: 'COLABORADOR' as const },
    ],
  } as EscalaAdvisoryInput

  it('produces a 16-char hex string', () => {
    const hash = computeAdvisoryInputHash(baseInput)
    expect(hash).toMatch(/^[0-9a-f]{16}$/)
  })

  it('is deterministic for same input', () => {
    const h1 = computeAdvisoryInputHash(baseInput)
    const h2 = computeAdvisoryInputHash(baseInput)
    expect(h1).toBe(h2)
  })

  it('is order-independent for current_folgas', () => {
    const reversed = {
      ...baseInput,
      current_folgas: [...baseInput.current_folgas].reverse(),
    }
    expect(computeAdvisoryInputHash(baseInput)).toBe(computeAdvisoryInputHash(reversed))
  })

  it('changes when folgas change', () => {
    const modified = {
      ...baseInput,
      current_folgas: baseInput.current_folgas.map((f, i) =>
        i === 0 ? { ...f, variavel: 'SEX' as const } : f,
      ),
    }
    expect(computeAdvisoryInputHash(baseInput)).not.toBe(computeAdvisoryInputHash(modified))
  })
})
