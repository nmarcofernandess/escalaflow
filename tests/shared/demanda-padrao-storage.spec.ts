import { describe, expect, it } from 'vitest'
import { parseDemandaPadraoSegmentos, stringifyDemandaPadraoSegmentos } from '../../src/shared/demanda-padrao-storage'

describe('demanda-padrao-storage', () => {
  it('parseia apenas segmentos válidos', () => {
    const parsed = parseDemandaPadraoSegmentos(JSON.stringify([
      { hora_inicio: '08:00', hora_fim: '12:00', min_pessoas: 2, override: false },
      { hora_inicio: '12:00', hora_fim: '18:00', min_pessoas: 3, override: true },
      { hora_inicio: '99:00', hora_fim: '18:00', min_pessoas: 0, override: false },
    ]))

    expect(parsed).toEqual([
      { hora_inicio: '08:00', hora_fim: '12:00', min_pessoas: 2, override: false },
      { hora_inicio: '12:00', hora_fim: '18:00', min_pessoas: 3, override: true },
    ])
  })

  it('serializa no formato esperado para persistência', () => {
    const raw = stringifyDemandaPadraoSegmentos([
      { hora_inicio: '10:15', hora_fim: '14:00', min_pessoas: 2, override: false },
    ])

    expect(parseDemandaPadraoSegmentos(raw)).toEqual([
      { hora_inicio: '10:15', hora_fim: '14:00', min_pessoas: 2, override: false },
    ])
  })
})
