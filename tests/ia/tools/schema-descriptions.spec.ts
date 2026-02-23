import { describe, expect, it } from 'vitest'
import { IA_TOOLS } from '../../../src/main/ia/tools'

function getToolParameters(name: string): any {
  const tool = IA_TOOLS.find((t) => t.name === name)
  expect(tool, `Tool ${name} não encontrada`).toBeDefined()
  return tool!.parameters
}

describe('IA tool schemas (.describe -> JSON Schema)', () => {
  it('mantém o registry enxuto (baseline atual = 23 tools)', () => {
    expect(IA_TOOLS).toHaveLength(23)
  })

  it('não expõe resumo_sistema no registry de tools da IA (deprecated)', () => {
    expect(IA_TOOLS.some((t) => t.name === 'resumo_sistema')).toBe(false)
  })

  it('não expõe wrappers semânticos que só duplicavam genericas', () => {
    for (const removed of ['listar_setores', 'listar_colaboradores_do_setor', 'obter_escala_atual', 'criar_excecao'] as const) {
      expect(IA_TOOLS.some((t) => t.name === removed)).toBe(false)
    }
  })

  it('expõe descriptions em preflight', () => {
    const params = getToolParameters('preflight')

    expect(params.properties.setor_id.description).toMatch(/get_context/i)
    expect(params.properties.data_inicio.description).toMatch(/YYYY-MM-DD/i)
    expect(params.properties.data_fim.description).toMatch(/YYYY-MM-DD/i)
  })

  it('expõe descriptions em gerar_escala e ajustar_alocacao', () => {
    const gerar = getToolParameters('gerar_escala')
    const ajustar = getToolParameters('ajustar_alocacao')

    expect(gerar.properties.setor_id.description).toMatch(/nome citado pelo usu[áa]rio/i)
    expect(gerar.properties.rules_override.description).toMatch(/override/i)
    expect(ajustar.properties.status.description).toMatch(/TRABALHO/i)
    expect(ajustar.properties.data.description).toMatch(/YYYY-MM-DD/i)
  })

  it('expõe descriptions nas novas tools semânticas da Fase 4', () => {
    const buscar = getToolParameters('buscar_colaborador')

    expect(buscar.properties.nome.description).toMatch(/case-insensitive/i)
    expect(buscar.properties.modo.description).toMatch(/AUTO/i)
  })

  it('expõe descriptions nas tools da Onda 1 restante', () => {
    const preflightCompleto = getToolParameters('preflight_completo')
    const obterRegra = getToolParameters('obter_regra_horario_colaborador')
    const salvarRegra = getToolParameters('salvar_regra_horario_colaborador')
    const definirJanela = getToolParameters('definir_janela_colaborador')
    const ajustarHorario = getToolParameters('ajustar_horario')
    const diagnosticarEscala = getToolParameters('diagnosticar_escala')

    expect(preflightCompleto.properties.regimes_override.description).toMatch(/override/i)
    expect(obterRegra.properties.colaborador_id.description).toMatch(/buscar_colaborador/i)
    expect(salvarRegra.properties.folga_fixa_dia_semana.description).toMatch(/SEG\.\.DOM|SEG/i)
    expect(definirJanela.properties.fim_max.description).toMatch(/HH:MM/i)
    expect(ajustarHorario.properties.hora_inicio.description).toMatch(/HH:MM/i)
    expect(diagnosticarEscala.properties.escala_id.description).toMatch(/get_context|consultar/i)
  })
})
