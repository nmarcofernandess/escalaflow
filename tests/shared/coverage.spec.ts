import { describe, expect, it } from 'vitest'
import { calcularCoberturaDemanda } from '../../src/shared/coverage'

describe('calcularCoberturaDemanda', () => {
  it('usa a formula canonica do validador: percentual inteiro de slots plenamente cobertos', () => {
    const resultado = calcularCoberturaDemanda([
      { data: '2026-06-15', hora_inicio: '08:00', hora_fim: '08:15', planejado: 2, executado: 2 },
      { data: '2026-06-15', hora_inicio: '08:15', hora_fim: '08:30', planejado: 2, executado: 1 },
      { data: '2026-06-15', hora_inicio: '08:30', hora_fim: '08:45', planejado: 1, executado: 1 },
    ])

    expect(resultado).toMatchObject({
      cobertura_percent: 67,
      cobertura_efetiva_percent: 67,
      slots_total: 3,
      slots_cobertos: 2,
    })
  })

  it('mantem a tolerancia efetiva de transicao para deficit de uma pessoa', () => {
    const resultado = calcularCoberturaDemanda([
      { data: '2026-06-15', hora_inicio: '07:00', hora_fim: '07:15', planejado: 2, executado: 1 },
      { data: '2026-06-15', hora_inicio: '08:00', hora_fim: '08:15', planejado: 2, executado: 1 },
    ])

    expect(resultado.cobertura_percent).toBe(0)
    expect(resultado.cobertura_efetiva_percent).toBe(50)
  })

  it('ignora slots fechados ou proibidos quando o chamador marca o slot fora da base', () => {
    const resultado = calcularCoberturaDemanda([
      { data: '2026-06-15', hora_inicio: '08:00', hora_fim: '08:15', planejado: 1, executado: 1 },
      { data: '2026-06-15', hora_inicio: '08:15', hora_fim: '08:30', planejado: 5, executado: 0, ignorar_cobertura: true },
    ])

    expect(resultado.cobertura_percent).toBe(100)
    expect(resultado.slots_total).toBe(1)
  })
})
