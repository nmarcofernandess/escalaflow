import { describe, expect, it } from 'vitest'
import { inferFolgasFromAlocacoes, type FolgaInferenceAlocacao } from '../../src/shared/folga-inference'

describe('inferFolgasFromAlocacoes', () => {
  it('não confunde a folga fixa com a variável após domingo trabalhado', () => {
    const alocacoes: FolgaInferenceAlocacao[] = [
      { data: '2026-03-29', status: 'TRABALHO' },
      { data: '2026-03-30', status: 'TRABALHO' },
      { data: '2026-03-31', status: 'FOLGA' },
      { data: '2026-04-01', status: 'TRABALHO' },
      { data: '2026-04-02', status: 'FOLGA' },
      { data: '2026-04-03', status: 'TRABALHO' },
      { data: '2026-04-04', status: 'TRABALHO' },

      { data: '2026-04-05', status: 'TRABALHO' },
      { data: '2026-04-06', status: 'TRABALHO' },
      { data: '2026-04-07', status: 'FOLGA' },
      { data: '2026-04-08', status: 'TRABALHO' },
      { data: '2026-04-09', status: 'FOLGA' },
      { data: '2026-04-10', status: 'TRABALHO' },
      { data: '2026-04-11', status: 'TRABALHO' },
    ]

    const result = inferFolgasFromAlocacoes({
      alocacoes,
      folgaFixaAtual: 'TER',
    })

    expect(result.fixa).toBe('TER')
    expect(result.variavel).toBe('QUI')
  })

  it('faz fallback por frequência quando a variável não ativou por domingo no período', () => {
    const alocacoes: FolgaInferenceAlocacao[] = [
      { data: '2026-04-06', status: 'TRABALHO' },
      { data: '2026-04-07', status: 'TRABALHO' },
      { data: '2026-04-08', status: 'FOLGA' },
      { data: '2026-04-09', status: 'TRABALHO' },
      { data: '2026-04-10', status: 'FOLGA' },
      { data: '2026-04-11', status: 'TRABALHO' },
      { data: '2026-04-12', status: 'FOLGA' },

      { data: '2026-04-13', status: 'TRABALHO' },
      { data: '2026-04-14', status: 'TRABALHO' },
      { data: '2026-04-15', status: 'FOLGA' },
      { data: '2026-04-16', status: 'TRABALHO' },
      { data: '2026-04-17', status: 'FOLGA' },
      { data: '2026-04-18', status: 'TRABALHO' },
      { data: '2026-04-19', status: 'FOLGA' },
    ]

    const result = inferFolgasFromAlocacoes({
      alocacoes,
      folgaFixaAtual: 'QUA',
    })

    expect(result.fixa).toBe('QUA')
    expect(result.variavel).toBe('SEX')
  })
})
