import { describe, it, expect } from 'vitest'

describe('isIntermitenteTipoA / isIntermitenteTipoB', () => {
  const load = async () => import('@shared/sunday-cycle')

  it('CLT nao e tipo A nem tipo B', async () => {
    const { isIntermitenteTipoA, isIntermitenteTipoB } = await load()
    const clt = { tipo_trabalhador: 'CLT', folga_variavel_dia_semana: 'SEG' as const }
    expect(isIntermitenteTipoA(clt)).toBe(false)
    expect(isIntermitenteTipoB(clt)).toBe(false)
  })

  it('intermitente sem folga_variavel e tipo A', async () => {
    const { isIntermitenteTipoA, isIntermitenteTipoB } = await load()
    const tipoA = { tipo_trabalhador: 'INTERMITENTE', folga_variavel_dia_semana: null }
    expect(isIntermitenteTipoA(tipoA)).toBe(true)
    expect(isIntermitenteTipoB(tipoA)).toBe(false)
  })

  it('intermitente com folga_variavel e tipo B', async () => {
    const { isIntermitenteTipoA, isIntermitenteTipoB } = await load()
    const tipoB = { tipo_trabalhador: 'INTERMITENTE', folga_variavel_dia_semana: 'SEG' as const }
    expect(isIntermitenteTipoA(tipoB)).toBe(false)
    expect(isIntermitenteTipoB(tipoB)).toBe(true)
  })

  it('undefined tipo_trabalhador default CLT', async () => {
    const { isIntermitenteTipoA } = await load()
    expect(isIntermitenteTipoA({ folga_variavel_dia_semana: null })).toBe(false)
  })

  it('undefined folga_variavel_dia_semana = tipo A', async () => {
    const { isIntermitenteTipoA } = await load()
    expect(isIntermitenteTipoA({ tipo_trabalhador: 'INTERMITENTE' })).toBe(true)
  })
})
