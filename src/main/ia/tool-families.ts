// =============================================================================
// TOOL FAMILIES — 30 tools internas colapsadas em 3 families LLM-facing
//
// O LLM vê apenas 3 tools. O roteamento interno traduz cada chamada
// para a tool interna correta + argumentos transformados.
// =============================================================================

import { z } from 'zod'

// ==================== SCHEMAS ====================

export const ConsultarContextoSchema = z.object({
  entidade: z.enum([
    'setor', 'colaborador', 'empresa', 'escala',
    'regras', 'contrato', 'feriados', 'excecoes',
    'conhecimento',
  ]).describe('Tipo de entidade a consultar. Use "conhecimento" para buscar na base de conhecimento (RAG).'),
  id: z.number().int().positive().optional().describe('ID da entidade. Obrigatório para setor, colaborador, escala.'),
  filtros: z.record(z.string(), z.any()).optional().describe('Filtros adicionais (ex: {"ativo": true}).'),
})

export const EditarFichaSchema = z.object({
  entidade: z.enum([
    'colaborador', 'setor', 'empresa', 'contrato',
    'excecao', 'demanda', 'feriado', 'feriados', 'posto', 'regra',
    'regra_horario', 'perfil_horario', 'horario_funcionamento',
    'memoria',
  ]).describe('Tipo de entidade a editar. Use "memoria" para salvar ou remover memorias do RH.'),
  id: z.number().int().positive().optional().describe('ID do registro. Omitir para criar novo.'),
  operacao: z.enum(['criar', 'atualizar', 'remover']).default('atualizar').describe('Tipo de operacao.'),
  dados: z.record(z.string(), z.any()).optional().describe('Campos a criar/atualizar. Use snake_case. Opcional para remover.'),
})

export const ExecutarAcaoSchema = z.object({
  acao: z.enum([
    'gerar_escala', 'oficializar', 'ajustar_celula',
    'ajustar_horario', 'preflight', 'diagnosticar',
    'diagnosticar_infeasible', 'explicar_violacao',
    'resumir_horas', 'backup', 'resetar_regras',
    'cadastrar_lote',
  ]).describe('Acao a executar.'),
  args: z.record(z.string(), z.any()).describe('Argumentos da acao. Variam por tipo.'),
})

export const SalvarMemoriaSchema = z.object({
  conteudo: z.string().min(1).describe('Fato curto a memorizar.'),
  id: z.number().int().positive().optional().describe('ID da memoria a atualizar. Omitir para criar nova.'),
})

export const RemoverMemoriaSchema = z.object({
  id: z.number().int().positive().describe('ID da memoria a remover.'),
})

// ==================== ROUTING MAPS ====================

const ENTIDADE_TO_TABLE: Record<string, string> = {
  setor: 'setores',
  colaborador: 'colaboradores',
  empresa: 'empresa',
  escala: 'escalas',
  regras: 'regra_empresa',
  contrato: 'tipos_contrato',
  feriados: 'feriados',
  excecoes: 'excecoes',
  demanda: 'demandas',
  feriado: 'feriados',
  posto: 'funcoes',
}

const EDITAR_ENTIDADE_TO_TABLE: Record<string, string> = {
  colaborador: 'colaboradores',
  setor: 'setores',
  empresa: 'empresa',
  contrato: 'tipos_contrato',
  excecao: 'excecoes',
  demanda: 'demandas',
  feriado: 'feriados',
}

const ACAO_TO_TOOL: Record<string, string> = {
  gerar_escala: 'gerar_escala',
  oficializar: 'oficializar_escala',
  ajustar_celula: 'ajustar_alocacao',
  ajustar_horario: 'ajustar_horario',
  preflight: 'preflight',
  diagnosticar: 'diagnosticar_escala',
  diagnosticar_infeasible: 'diagnosticar_infeasible',
  explicar_violacao: 'explicar_violacao',
  resumir_horas: 'resumir_horas_setor',
  backup: 'fazer_backup',
  resetar_regras: 'resetar_regras_empresa',
  cadastrar_lote: 'cadastrar_lote',
}

// ==================== ROUTING ====================

export interface FamilyRoute {
  internalTool: string
  internalArgs: Record<string, any>
}

export function routeFamilyTool(familyName: string, args: Record<string, any>): FamilyRoute {
  // --- consultar_contexto ---
  if (familyName === 'consultar_contexto') {
    const { entidade, id, filtros } = args

    // conhecimento -> buscar_conhecimento (RAG search)
    if (entidade === 'conhecimento') {
      return {
        internalTool: 'buscar_conhecimento',
        internalArgs: { consulta: filtros?.consulta ?? filtros?.query ?? '', limite: filtros?.limite },
      }
    }

    // colaborador com id -> buscar_colaborador (retrato completo)
    if (entidade === 'colaborador' && id) {
      return {
        internalTool: 'buscar_colaborador',
        internalArgs: { id, ...(filtros ?? {}) },
      }
    }

    // Fallback generico -> consultar
    const tabela = ENTIDADE_TO_TABLE[entidade] ?? entidade
    const internalArgs: Record<string, any> = { entidade: tabela }
    if (filtros || id) {
      const f = { ...(filtros ?? {}) }
      if (id) f.id = id
      internalArgs.filtros = f
    }
    return { internalTool: 'consultar', internalArgs }
  }

  // --- editar_ficha ---
  if (familyName === 'editar_ficha') {
    const { entidade, id, operacao, dados } = args

    // Special cases first (entidade-specific tools)
    if (entidade === 'posto') {
      if (operacao === 'remover') {
        return { internalTool: 'deletar', internalArgs: { entidade: 'funcoes', id: id ?? dados?.id } }
      }
      return {
        internalTool: 'salvar_posto_setor',
        internalArgs: { ...(dados ?? {}), ...(id ? { id } : {}) },
      }
    }

    if (entidade === 'regra') {
      return {
        internalTool: 'editar_regra',
        internalArgs: { ...(dados ?? {}), ...(id ? { id } : {}) },
      }
    }

    if (entidade === 'regra_horario') {
      return {
        internalTool: 'salvar_regra_horario_colaborador',
        internalArgs: { ...(dados ?? {}), ...(id ? { id } : {}) },
      }
    }

    if (entidade === 'perfil_horario' && operacao === 'remover') {
      return {
        internalTool: 'deletar_perfil_horario',
        internalArgs: { id: id ?? dados?.id },
      }
    }

    if (entidade === 'perfil_horario') {
      return {
        internalTool: 'salvar_perfil_horario',
        internalArgs: { ...(dados ?? {}), ...(id ? { id } : {}) },
      }
    }

    if (entidade === 'horario_funcionamento') {
      return {
        internalTool: 'configurar_horario_funcionamento',
        internalArgs: { ...(dados ?? {}) },
      }
    }

    // memoria -> salvar_memoria / remover_memoria
    if (entidade === 'memoria') {
      if (operacao === 'remover') {
        return { internalTool: 'remover_memoria', internalArgs: { id: id ?? dados?.id } }
      }
      return { internalTool: 'salvar_memoria', internalArgs: { conteudo: dados?.conteudo, ...(id ? { id } : {}) } }
    }

    // demanda com data_especifica -> salvar_demanda_excecao_data
    if (entidade === 'demanda' && dados?.data_especifica) {
      return {
        internalTool: 'salvar_demanda_excecao_data',
        internalArgs: { ...(dados ?? {}) },
      }
    }

    // excecao com data_especifica -> upsert_regra_excecao_data
    if (entidade === 'excecao' && dados?.data_especifica) {
      return {
        internalTool: 'upsert_regra_excecao_data',
        internalArgs: { ...(dados ?? {}) },
      }
    }

    // Generic CRUD via operacao
    if (operacao === 'remover') {
      const tabela = EDITAR_ENTIDADE_TO_TABLE[entidade] ?? entidade
      return {
        internalTool: 'deletar',
        internalArgs: { entidade: tabela, id: id ?? dados?.id },
      }
    }

    if (id) {
      const tabela = EDITAR_ENTIDADE_TO_TABLE[entidade] ?? entidade
      return {
        internalTool: 'atualizar',
        internalArgs: { entidade: tabela, id, dados: dados ?? {} },
      }
    }

    // No id -> criar
    const tabela = EDITAR_ENTIDADE_TO_TABLE[entidade] ?? entidade
    return {
      internalTool: 'criar',
      internalArgs: { entidade: tabela, dados: dados ?? {} },
    }
  }

  // --- executar_acao ---
  if (familyName === 'executar_acao') {
    const { acao, args: acaoArgs } = args
    const internalTool = ACAO_TO_TOOL[acao]
    if (!internalTool) {
      return { internalTool: 'UNKNOWN', internalArgs: {} }
    }
    return { internalTool, internalArgs: acaoArgs ?? {} }
  }

  return { internalTool: 'UNKNOWN', internalArgs: {} }
}

// ==================== EXECUTE ====================

export async function executeFamilyTool(familyName: string, args: Record<string, any>): Promise<any> {
  // Lazy import para evitar dependencia circular (tools.ts importa tool-families.ts)
  const { executeTool } = await import('./tools')

  const route = routeFamilyTool(familyName, args)

  if (route.internalTool === 'UNKNOWN') {
    return {
      status: 'error' as const,
      code: 'UNKNOWN_ACTION',
      message: `Acao desconhecida: ${JSON.stringify(args)}`,
      correction: 'Verifique o nome da acao ou entidade.',
    }
  }

  return executeTool(route.internalTool, route.internalArgs)
}

// ==================== FAMILY TOOL DEFINITIONS ====================

export const FAMILY_TOOLS = [
  {
    name: 'consultar_contexto',
    description: 'Consulta dados de qualquer entidade do sistema. O contexto automatico ja traz resumo do setor, preview e alertas — use esta tool quando precisar de detalhes extras ou filtros especificos. Use entidade "conhecimento" com filtros.consulta para buscar na base de conhecimento.',
  },
  {
    name: 'editar_ficha',
    description: 'Cria, atualiza ou remove registros. Cobre tudo: colaboradores, excecoes, demandas, regras, postos, horarios, perfis, memorias. Use entidade "memoria" para salvar ou remover memorias do RH. Sempre use snake_case nos campos.',
  },
  {
    name: 'executar_acao',
    description: 'Executa acoes de dominio: gerar escala, oficializar, ajustar celula, preflight, diagnosticar, backup, etc.',
  },
] as const

export const FAMILY_SCHEMAS: Record<string, z.ZodTypeAny> = {
  consultar_contexto: ConsultarContextoSchema,
  editar_ficha: EditarFichaSchema,
  executar_acao: ExecutarAcaoSchema,
}
