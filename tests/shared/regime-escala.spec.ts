import { describe, expect, it } from 'vitest'
import {
  resolverRegimeEscala,
  resolverRegimeEscalaAgregado,
} from '../../src/shared/regime-escala'

describe('resolverRegimeEscala', () => {
  it('mantem a cascata curta quando setor tem regime definido', () => {
    expect(resolverRegimeEscala({
      setor: '5X2',
      contrato: '6X1',
      dias_trabalho: 6,
    })).toBe('5X2')
  })
})

describe('resolverRegimeEscalaAgregado', () => {
  it('respeita regime definido no setor antes de olhar contratos do pool', () => {
    const result = resolverRegimeEscalaAgregado({
      setor: '5X2',
      contratos: [
        { regime_escala: '6X1', dias_trabalho: 6 },
        { regime_escala: '6X1', dias_trabalho: 6 },
      ],
    })

    expect(result).toEqual({ regime: '5X2' })
  })

  it('usa regime homogeneo do pool quando setor nao tem regime definido', () => {
    const result = resolverRegimeEscalaAgregado({
      setor: null,
      contratos: [
        { regime_escala: '6X1', dias_trabalho: 6 },
        { regime_escala: '6X1', dias_trabalho: 6 },
      ],
    })

    expect(result).toEqual({ regime: '6X1' })
  })

  it('usa regime majoritario do pool misto sem depender da ordem da query', () => {
    const result = resolverRegimeEscalaAgregado({
      setor: null,
      contratos: [
        { regime_escala: '5X2', dias_trabalho: 5 },
        { regime_escala: '6X1', dias_trabalho: 6 },
        { regime_escala: '6X1', dias_trabalho: 6 },
      ],
    })

    expect(result).toEqual({ regime: '6X1' })
  })

  it('desempata pool misto em 6x1 e devolve observacao para a IA', () => {
    const result = resolverRegimeEscalaAgregado({
      setor: null,
      contratos: [
        { regime_escala: '5X2', dias_trabalho: 5 },
        { regime_escala: '6X1', dias_trabalho: 6 },
      ],
    })

    expect(result.regime).toBe('6X1')
    expect(result.observacao).toMatch(/empate/i)
    expect(result.observacao).toMatch(/6x1/i)
  })

  it('com pool vazio cai no fallback conservador existente', () => {
    const result = resolverRegimeEscalaAgregado({
      setor: null,
      contratos: [],
    })

    expect(result).toEqual({ regime: '6X1' })
  })
})
