import { describe, it, expect } from 'vitest'
import { converterPreviewParaPinnedWithOrigin } from '../../src/shared/simula-ciclo'
import type { PinOrigin } from '../../src/shared/types'
import { PIN_WEIGHTS } from '../../src/shared/types'

describe('converterPreviewParaPinnedWithOrigin', () => {
  const mockOutput = {
    sucesso: true,
    grid: [
      {
        posto: 'Caixa 1',
        semanas: [{ dias: ['T', 'T', 'T', 'T', 'T', 'F', 'F'] }],
        folga_fixa_dia: 5,     // SAB
        folga_variavel_dia: null,
        cobertura_dia: [],
        ciclo_semanas: 1,
        stats: {} as any,
      },
    ],
    cobertura_dia: [],
    ciclo_semanas: 1,
    stats: {} as any,
  }

  it('marks auto origin for preview-decided pins when no overrides', () => {
    const result = converterPreviewParaPinnedWithOrigin(
      mockOutput as any,
      [{ funcao: { id: 1 }, titular: { id: 10 } }],
      [],  // no overrides
    )
    expect(result.every(p => p.origin === 'auto')).toBe(true)
    expect(result).toHaveLength(7)
  })

  it('marks manual origin for folga days matching override', () => {
    const overrides = [{ colaborador_id: 10, fixa: 'SAB' as any, variavel: null }]
    const result = converterPreviewParaPinnedWithOrigin(
      mockOutput as any,
      [{ funcao: { id: 1 }, titular: { id: 10 } }],
      overrides,
    )
    // SAB is day index 5, which is F in grid → should be 'manual'
    const sabPin = result.find(p => p.d === 5)
    expect(sabPin?.origin).toBe('manual')
    expect(sabPin?.weight).toBe(PIN_WEIGHTS.manual)
    // DOM is day index 6, also F but NOT in override → 'auto'
    const domPin = result.find(p => p.d === 6)
    expect(domPin?.origin).toBe('auto')
  })

  it('marks saved origin for folga days matching BD-backed folga', () => {
    const savedFolgas = [{ colaborador_id: 10, fixa: 'SAB' as any, variavel: null }]
    const result = converterPreviewParaPinnedWithOrigin(
      mockOutput as any,
      [{ funcao: { id: 1 }, titular: { id: 10 } }],
      [],  // no local overrides
      savedFolgas,
    )
    const sabPin = result.find(p => p.d === 5)
    expect(sabPin?.origin).toBe('saved')
    expect(sabPin?.weight).toBe(PIN_WEIGHTS.saved)
  })

  it('manual overrides take precedence over saved', () => {
    const overrides = [{ colaborador_id: 10, fixa: 'SAB' as any }]
    const savedFolgas = [{ colaborador_id: 10, fixa: 'SAB' as any }]
    const result = converterPreviewParaPinnedWithOrigin(
      mockOutput as any,
      [{ funcao: { id: 1 }, titular: { id: 10 } }],
      overrides,
      savedFolgas,
    )
    const sabPin = result.find(p => p.d === 5)
    expect(sabPin?.origin).toBe('manual')
  })

  it('includes weight field matching origin', () => {
    const result = converterPreviewParaPinnedWithOrigin(
      mockOutput as any,
      [{ funcao: { id: 1 }, titular: { id: 10 } }],
      [],
    )
    result.forEach(pin => {
      expect(pin.weight).toBeDefined()
      expect(typeof pin.weight).toBe('number')
      expect(pin.weight).toBe(PIN_WEIGHTS[pin.origin])
    })
  })

  it('work days are always auto', () => {
    const overrides = [{ colaborador_id: 10, fixa: 'SEG' as any }]
    const result = converterPreviewParaPinnedWithOrigin(
      mockOutput as any,
      [{ funcao: { id: 1 }, titular: { id: 10 } }],
      overrides,
    )
    // SEG is day 0, which is 'T' in grid → work day → always 'auto' even if in override
    const segPin = result.find(p => p.d === 0)
    expect(segPin?.origin).toBe('auto')
    expect(segPin?.band).toBe(3) // INTEGRAL
  })
})
