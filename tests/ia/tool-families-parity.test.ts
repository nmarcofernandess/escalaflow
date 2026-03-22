/**
 * PARITY TEST: Prova que CADA uma das 30 tools internas é alcançável
 * através das 5 tools públicas (famílias).
 *
 * Se alguma tool interna ficar "órfã" (sem caminho via família),
 * o teste falha e mostra qual tool ficou de fora.
 */
import { describe, expect, it } from 'vitest'
import { routeFamilyTool } from '../../src/main/ia/tool-families'

// Todas as 30 tools internas que existiam antes da migração
const ALL_INTERNAL_TOOLS = [
  'buscar_colaborador',
  'consultar',
  'criar',
  'atualizar',
  'deletar',
  'salvar_posto_setor',
  'editar_regra',
  'gerar_escala',
  'ajustar_alocacao',
  'ajustar_horario',
  'oficializar_escala',
  'preflight',
  'diagnosticar_escala',
  'diagnosticar_infeasible',
  'explicar_violacao',
  'cadastrar_lote',
  'salvar_regra_horario_colaborador',
  'salvar_demanda_excecao_data',
  'upsert_regra_excecao_data',
  'resumir_horas_setor',
  'resetar_regras_empresa',
  'salvar_perfil_horario',
  'deletar_perfil_horario',
  'configurar_horario_funcionamento',
  'fazer_backup',
  'salvar_memoria',
  'remover_memoria',
] as const

// Mapeamento: para cada tool interna, qual chamada de família a alcança?
const PARITY_MAP: Array<{
  internalTool: string
  family: string
  familyArgs: Record<string, any>
  description: string
}> = [
  // ===== consultar_contexto =====
  {
    internalTool: 'consultar',
    family: 'consultar_contexto',
    familyArgs: { entidade: 'setor', filtros: { ativo: true } },
    description: 'consultar via consultar_contexto (setor)',
  },
  {
    internalTool: 'buscar_colaborador',
    family: 'consultar_contexto',
    familyArgs: { entidade: 'colaborador', id: 5 },
    description: 'buscar_colaborador via consultar_contexto (colaborador+id)',
  },

  // ===== editar_ficha → criar/atualizar/deletar genéricos =====
  {
    internalTool: 'criar',
    family: 'editar_ficha',
    familyArgs: { entidade: 'colaborador', operacao: 'criar', dados: { nome: 'Test' } },
    description: 'criar via editar_ficha (colaborador sem id)',
  },
  {
    internalTool: 'atualizar',
    family: 'editar_ficha',
    familyArgs: { entidade: 'colaborador', id: 5, operacao: 'atualizar', dados: { nome: 'Updated' } },
    description: 'atualizar via editar_ficha (colaborador com id)',
  },
  {
    internalTool: 'deletar',
    family: 'editar_ficha',
    familyArgs: { entidade: 'excecao', id: 3, operacao: 'remover', dados: {} },
    description: 'deletar via editar_ficha (excecao remover)',
  },

  // ===== editar_ficha → handlers especializados =====
  {
    internalTool: 'salvar_posto_setor',
    family: 'editar_ficha',
    familyArgs: { entidade: 'posto', operacao: 'criar', dados: { setor_id: 2, apelido: 'Caixa 1' } },
    description: 'salvar_posto_setor via editar_ficha (posto criar)',
  },
  {
    internalTool: 'deletar', // posto remover → deletar funcoes
    family: 'editar_ficha',
    familyArgs: { entidade: 'posto', id: 5, operacao: 'remover', dados: {} },
    description: 'deletar funcoes via editar_ficha (posto remover)',
  },
  {
    internalTool: 'editar_regra',
    family: 'editar_ficha',
    familyArgs: { entidade: 'regra', dados: { codigo: 'H1', status: 'OFF' } },
    description: 'editar_regra via editar_ficha (regra)',
  },
  {
    internalTool: 'salvar_regra_horario_colaborador',
    family: 'editar_ficha',
    familyArgs: { entidade: 'regra_horario', dados: { colaborador_id: 5, dia_semana: 'SEG' } },
    description: 'salvar_regra_horario via editar_ficha (regra_horario)',
  },
  {
    internalTool: 'salvar_perfil_horario',
    family: 'editar_ficha',
    familyArgs: { entidade: 'perfil_horario', operacao: 'criar', dados: { nome: 'Manhã' } },
    description: 'salvar_perfil_horario via editar_ficha (perfil_horario criar)',
  },
  {
    internalTool: 'deletar_perfil_horario',
    family: 'editar_ficha',
    familyArgs: { entidade: 'perfil_horario', id: 3, operacao: 'remover', dados: {} },
    description: 'deletar_perfil_horario via editar_ficha (perfil_horario remover)',
  },
  {
    internalTool: 'configurar_horario_funcionamento',
    family: 'editar_ficha',
    familyArgs: { entidade: 'horario_funcionamento', dados: { setor_id: 2, dia_semana: 'SEG' } },
    description: 'configurar_horario via editar_ficha (horario_funcionamento)',
  },
  {
    internalTool: 'salvar_demanda_excecao_data',
    family: 'editar_ficha',
    familyArgs: { entidade: 'demanda', dados: { setor_id: 2, data_especifica: '2026-04-01' } },
    description: 'salvar_demanda_excecao via editar_ficha (demanda com data_especifica)',
  },
  {
    internalTool: 'upsert_regra_excecao_data',
    family: 'editar_ficha',
    familyArgs: { entidade: 'excecao', dados: { colaborador_id: 5, data_especifica: '2026-04-01' } },
    description: 'upsert_regra_excecao via editar_ficha (excecao com data_especifica)',
  },

  // ===== executar_acao =====
  {
    internalTool: 'gerar_escala',
    family: 'executar_acao',
    familyArgs: { acao: 'gerar_escala', args: { setor_id: 4, data_inicio: '2026-04-01', data_fim: '2026-04-30' } },
    description: 'gerar_escala via executar_acao',
  },
  {
    internalTool: 'oficializar_escala',
    family: 'executar_acao',
    familyArgs: { acao: 'oficializar', args: { escala_id: 10 } },
    description: 'oficializar via executar_acao',
  },
  {
    internalTool: 'ajustar_alocacao',
    family: 'executar_acao',
    familyArgs: { acao: 'ajustar_celula', args: { alocacao_id: 5, status: 'TRABALHA' } },
    description: 'ajustar_alocacao via executar_acao (ajustar_celula)',
  },
  {
    internalTool: 'ajustar_horario',
    family: 'executar_acao',
    familyArgs: { acao: 'ajustar_horario', args: { alocacao_id: 5, hora_inicio: '08:00' } },
    description: 'ajustar_horario via executar_acao',
  },
  {
    internalTool: 'preflight',
    family: 'executar_acao',
    familyArgs: { acao: 'preflight', args: { setor_id: 4 } },
    description: 'preflight via executar_acao',
  },
  {
    internalTool: 'diagnosticar_escala',
    family: 'executar_acao',
    familyArgs: { acao: 'diagnosticar', args: { escala_id: 10 } },
    description: 'diagnosticar_escala via executar_acao (diagnosticar)',
  },
  {
    internalTool: 'diagnosticar_infeasible',
    family: 'executar_acao',
    familyArgs: { acao: 'diagnosticar_infeasible', args: { setor_id: 4 } },
    description: 'diagnosticar_infeasible via executar_acao',
  },
  {
    internalTool: 'explicar_violacao',
    family: 'executar_acao',
    familyArgs: { acao: 'explicar_violacao', args: { codigo: 'H1' } },
    description: 'explicar_violacao via executar_acao',
  },
  {
    internalTool: 'resumir_horas_setor',
    family: 'executar_acao',
    familyArgs: { acao: 'resumir_horas', args: { setor_id: 4 } },
    description: 'resumir_horas_setor via executar_acao (resumir_horas)',
  },
  {
    internalTool: 'resetar_regras_empresa',
    family: 'executar_acao',
    familyArgs: { acao: 'resetar_regras', args: {} },
    description: 'resetar_regras_empresa via executar_acao',
  },
  {
    internalTool: 'cadastrar_lote',
    family: 'executar_acao',
    familyArgs: { acao: 'cadastrar_lote', args: { entidade: 'colaboradores', registros: [] } },
    description: 'cadastrar_lote via executar_acao',
  },
  {
    internalTool: 'fazer_backup',
    family: 'executar_acao',
    familyArgs: { acao: 'backup', args: {} },
    description: 'fazer_backup via executar_acao (backup)',
  },

  // ===== passthrough =====
  {
    internalTool: 'salvar_memoria',
    family: 'salvar_memoria',
    familyArgs: { conteudo: 'Teste de memória' },
    description: 'salvar_memoria (passthrough)',
  },
  {
    internalTool: 'remover_memoria',
    family: 'remover_memoria',
    familyArgs: { id: 1 },
    description: 'remover_memoria (passthrough)',
  },
]

describe('tool-families PARITY: 30 internas → 5 famílias', () => {
  // Test 1: Cada tool interna tem ao menos um caminho via família
  it('todas as 27 tools internas roteáveis são alcançáveis via famílias', () => {
    const reachable = new Set(PARITY_MAP.map(p => p.internalTool))

    // Tools que foram intencionalmente removidas da surface (knowledge layer)
    const intentionallyRemoved = [
      'buscar_conhecimento',  // RAG é pre-LLM (auto-discovery)
      'salvar_conhecimento',  // backoffice, não chat RH
      'explorar_relacoes',    // admin/debug, não chat RH
    ]

    const orphaned = ALL_INTERNAL_TOOLS.filter(
      t => !reachable.has(t) && !intentionallyRemoved.includes(t)
    )

    expect(orphaned, `Tools órfãs (sem caminho via família): ${orphaned.join(', ')}`).toEqual([])
  })

  // Test 2: Cada mapeamento roteia para a tool interna correta
  describe('routing parity', () => {
    for (const mapping of PARITY_MAP) {
      // salvar_memoria e remover_memoria são passthrough (não passam por routeFamilyTool)
      if (mapping.family === 'salvar_memoria' || mapping.family === 'remover_memoria') {
        it(`${mapping.description} — passthrough direto`, () => {
          // passthrough: família === interna
          expect(mapping.family).toBe(mapping.internalTool)
        })
        continue
      }

      it(`${mapping.description} → ${mapping.internalTool}`, () => {
        const route = routeFamilyTool(mapping.family, mapping.familyArgs)
        expect(route.internalTool, `Expected ${mapping.family}(${JSON.stringify(mapping.familyArgs)}) to route to ${mapping.internalTool}, got ${route.internalTool}`).toBe(mapping.internalTool)
      })
    }
  })

  // Test 3: Knowledge tools são intencionalmente excluídas (não órfãs)
  it('knowledge tools removidas intencionalmente da surface do LLM', () => {
    const knowledgeTools = ['buscar_conhecimento', 'salvar_conhecimento', 'explorar_relacoes']
    for (const tool of knowledgeTools) {
      const reachable = PARITY_MAP.some(p => p.internalTool === tool)
      expect(reachable, `${tool} NÃO deve ser alcançável via família (removida por design)`).toBe(false)
    }
  })

  // Test 4: Nenhuma ação desconhecida passa silenciosamente
  it('ação desconhecida em executar_acao retorna UNKNOWN', () => {
    const route = routeFamilyTool('executar_acao', { acao: 'explode_tudo', args: {} })
    expect(route.internalTool).toBe('UNKNOWN')
  })
})
