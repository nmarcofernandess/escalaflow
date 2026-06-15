import { describe, expect, it } from 'vitest'
import { SYSTEM_PROMPT } from '../../src/main/ia/system-prompt'
import { FAMILY_SCHEMAS, routeFamilyTool } from '../../src/main/ia/tool-families'

const documentedCalls = [
  {
    name: 'editar_ficha',
    args: {
      entidade: 'contrato',
      dados: { regime_escala: '6X1' },
    },
    expectedInternalTool: 'criar',
  },
  {
    name: 'editar_ficha',
    args: {
      entidade: 'setor',
      id: 2,
      dados: { regime_escala: '6X1' },
    },
    expectedInternalTool: 'atualizar',
  },
  {
    name: 'executar_acao',
    args: {
      acao: 'ajustar_celula',
      args: {
        escala_id: 12,
        colaborador_id: 5,
        data: '2026-03-15',
        status: 'TRABALHO',
      },
    },
    expectedInternalTool: 'ajustar_alocacao',
  },
] as const

describe('system prompt public family contract', () => {
  it('does not teach internal table or tool names as public family arguments', () => {
    expect(SYSTEM_PROMPT).not.toContain('entidade: "tipos_contrato"')
    expect(SYSTEM_PROMPT).not.toContain('acao: "ajustar_alocacao"')
  })

  it('keeps documented family calls parseable and routable', () => {
    for (const call of documentedCalls) {
      const parsed = FAMILY_SCHEMAS[call.name].safeParse(call.args)
      expect(parsed.success, `${call.name} should parse ${JSON.stringify(call.args)}`).toBe(true)

      const route = routeFamilyTool(call.name, call.args)
      expect(route.internalTool).toBe(call.expectedInternalTool)
      expect(route.internalTool).not.toBe('UNKNOWN')
      if (call.expectedInternalTool === 'atualizar') {
        expect(route.internalArgs).toMatchObject({ id: 2 })
      }
    }
  })
})
