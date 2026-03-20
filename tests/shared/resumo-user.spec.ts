import { describe, it, expect } from 'vitest'
import { textoResumoRelaxacoes, NOMES_HUMANOS_REGRAS } from '../../src/shared/resumo-user'

describe('textoResumoRelaxacoes', () => {
  it('returns null when pass 1 and no relaxations', () => {
    expect(textoResumoRelaxacoes(1, [])).toBeNull()
  })

  it('returns null when pass 1 even with empty regras', () => {
    expect(textoResumoRelaxacoes(1, [])).toBeNull()
  })

  it('returns adjustment text for pass 2 with one rule', () => {
    const result = textoResumoRelaxacoes(2, ['DIAS_TRABALHO'])
    expect(result).toContain('dias de trabalho por semana')
    expect(result).toContain('ajustados')
    expect(result).not.toContain('limitações')
  })

  it('returns adjustment text for pass 2 with multiple rules', () => {
    const result = textoResumoRelaxacoes(2, ['DIAS_TRABALHO', 'MIN_DIARIO'])
    expect(result).toContain('dias de trabalho por semana')
    expect(result).toContain('jornada mínima diária')
    expect(result).not.toContain('limitações')
  })

  it('returns limitation text for pass 3', () => {
    const result = textoResumoRelaxacoes(3, ['FOLGA_FIXA', 'TIME_WINDOW'])
    expect(result).toContain('limitações')
    expect(result).toContain('folga fixa semanal')
    expect(result).toContain('horário de entrada/saída')
  })

  it('returns limitation text for EXPLORATORY mode', () => {
    const result = textoResumoRelaxacoes(2, ['H1'], 'EXPLORATORY')
    expect(result).toContain('limitações')
  })

  it('falls back to raw code for unknown rule', () => {
    const result = textoResumoRelaxacoes(2, ['REGRA_DESCONHECIDA'])
    expect(result).toContain('REGRA_DESCONHECIDA')
  })

  it('NOMES_HUMANOS_REGRAS is exported and has standard entries', () => {
    expect(NOMES_HUMANOS_REGRAS['DIAS_TRABALHO']).toBe('dias de trabalho por semana')
    expect(NOMES_HUMANOS_REGRAS['MIN_DIARIO']).toBe('jornada mínima diária')
    expect(NOMES_HUMANOS_REGRAS['H6']).toBe('intervalo de almoço')
    expect(NOMES_HUMANOS_REGRAS['TIME_WINDOW']).toBe('horário de entrada/saída')
    expect(NOMES_HUMANOS_REGRAS['FOLGA_VARIAVEL']).toBe('rodízio de folga/domingo')
  })
})
