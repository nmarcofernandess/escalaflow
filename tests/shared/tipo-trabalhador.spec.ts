import { describe, expect, it } from 'vitest'
import { derivarTipoTrabalhador } from '../../src/shared/tipo-trabalhador'

describe('derivarTipoTrabalhador', () => {
  it('deriva intermitente e estagiario pelo nome do contrato quando a coluna do colaborador esta stale', () => {
    expect(derivarTipoTrabalhador({ tipo_colaborador: 'CLT', contrato_nome: 'Intermitente' })).toBe('INTERMITENTE')
    expect(derivarTipoTrabalhador({ tipo_colaborador: 'CLT', contrato_nome: 'Estagiario Manha' })).toBe('ESTAGIARIO')
  })

  it('usa a classe legal do contrato quando ela existir', () => {
    expect(derivarTipoTrabalhador({
      tipo_colaborador: 'CLT',
      contrato_nome: 'Plantao Especial',
      contrato_tipo_trabalhador: 'INTERMITENTE',
    })).toBe('INTERMITENTE')
  })

  it('mantem fallback para coluna do colaborador quando o contrato nao informa classe', () => {
    expect(derivarTipoTrabalhador({ tipo_colaborador: 'ESTAGIARIO', contrato_nome: 'Bolsa Jovem' })).toBe('ESTAGIARIO')
    expect(derivarTipoTrabalhador({ tipo_colaborador: 'NAO_EXISTE', contrato_nome: 'Contrato Geral' })).toBe('CLT')
  })
})
