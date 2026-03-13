import { queryOne, queryAll, execute, insertReturningId, transaction } from '../db/query'
import { minutesBetween as minutesBetweenUtil } from '../date-utils'
import { enrichPreflightWithCapacityChecks, normalizeRegimesOverride } from '../preflight-capacity'
import { buildSolverInput, runSolver, persistirSolverResult, computeSolverScenarioHash } from '../motor/solver-bridge'
import { inferGenerationModeForOverrides } from '../motor/rule-policy'
import { persistirResumoAutoritativoEscala } from '../tipc/escalas-utils'
import { salvarDetalheFuncao, deletarFuncao } from '../funcoes-service'
import { textoResumoCobertura, textoResumoViolacoesHard, textoResumoViolacoesSoft } from '../../shared/resumo-user'
import { coreAlerts } from './discovery'
import { validarEscalaV3 } from '../motor/validador'
import { searchKnowledge, exploreRelations } from '../knowledge/search'
import { ingestKnowledge } from '../knowledge/ingest'
import { z } from 'zod'
import { zodToJsonSchema } from 'zod-to-json-schema'

// ==================== HELPER: Zod → JSON Schema (Type-Safe) ====================

/**
 * Converte schema Zod para JSON Schema compatível com Gemini API.
 *
 * NOTA: O `as any` é necessário por incompatibilidade de tipos entre
 * zod@4.x e zod-to-json-schema@3.x. A conversão funciona perfeitamente
 * em runtime, mas TypeScript não reconhece a compatibilidade.
 *
 * IMPORTANTE: Remove o campo `$schema` que zod-to-json-schema adiciona
 * por padrão, pois Gemini API não aceita esse campo.
 *
 * Centralizar aqui permite:
 * - Usar schemas Zod com type-safety total
 * - Isolar o hack de tipo em UM lugar só
 * - Facilitar migração futura se necessário
 */
function toJsonSchema<T extends z.ZodTypeAny>(schema: T): Record<string, any> {
  // Zod v4 has native JSON Schema generation. Prefer it because zod-to-json-schema
  // can degrade to "{}" with some zod v4 schemas depending on runtime compatibility.
  const nativeToJsonSchema = (z as any).toJSONSchema
  const jsonSchema = typeof nativeToJsonSchema === 'function'
    ? nativeToJsonSchema(schema)
    : zodToJsonSchema(schema as any)
  // Remove $schema que Gemini API não aceita
  delete jsonSchema.$schema
  return jsonSchema
}

type ToolMeta = Record<string, unknown>

function toolOk<T extends Record<string, any>>(
  payload: T,
  options?: { summary?: string; meta?: ToolMeta }
) {
  return {
    status: 'ok' as const,
    ...(options?.summary ? { summary: options.summary } : {}),
    ...payload,
    ...(options?.meta ? { _meta: options.meta } : {}),
  }
}

function toolError(
  code: string,
  message: string,
  options?: { correction?: string; meta?: ToolMeta; details?: Record<string, unknown> }
) {
  return {
    status: 'error' as const,
    code,
    message,
    // Compat com UI/fluxos legados que procuram "erro"
    erro: message,
    ...(options?.correction ? { correction: options.correction } : {}),
    ...(options?.details ?? {}),
    ...(options?.meta ? { _meta: options.meta } : {}),
  }
}

function toolTruncated<T extends Record<string, any>>(
  payload: T,
  options?: { summary?: string; meta?: ToolMeta }
) {
  return {
    status: 'truncated' as const,
    ...(options?.summary ? { summary: options.summary } : {}),
    ...payload,
    ...(options?.meta ? { _meta: options.meta } : {}),
  }
}

function hasOwnField<T extends object>(value: T, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

const HORA_HHMM_REGEX = /^\d{2}:\d{2}$/
const DiaSemanaSchema = z.enum(['SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB', 'DOM'])
const RegimeOverrideSchema = z.object({
  colaborador_id: z.number().int().positive().describe('ID do colaborador para override de regime.'),
  regime_escala: z.enum(['5X2', '6X1']).describe('Regime temporário de simulação para preflight/geração.')
})

const minutesBetweenTimes = minutesBetweenUtil

function summarizeViolacoesTop(items: Array<{ codigo?: string }> | undefined, limit = 5) {
  const counts = new Map<string, number>()
  for (const item of items ?? []) {
    const code = item?.codigo
    if (!code) continue
    counts.set(code, (counts.get(code) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([codigo, count]) => ({ codigo, count }))
}

async function getTitularAtualPostoId(funcaoId: number): Promise<number | null> {
  const titular = await queryOne<{ id: number }>(
    'SELECT id FROM colaboradores WHERE funcao_id = ? AND ativo = true LIMIT 1',
    funcaoId,
  )
  return titular?.id ?? null
}

async function getPostoToolView(funcaoId: number): Promise<Record<string, any> | undefined> {
  return queryOne<Record<string, any>>(
    `
      SELECT
        f.id,
        f.setor_id,
        f.apelido,
        f.tipo_contrato_id,
        f.ordem,
        f.ativo,
        f.cor_hex,
        s.nome AS setor_nome,
        t.nome AS tipo_contrato_nome,
        c.id AS titular_colaborador_id,
        c.nome AS titular_nome
      FROM funcoes f
      LEFT JOIN setores s ON s.id = f.setor_id
      LEFT JOIN tipos_contrato t ON t.id = f.tipo_contrato_id
      LEFT JOIN colaboradores c ON c.funcao_id = f.id AND c.ativo = true
      WHERE f.id = ?
      LIMIT 1
    `,
    funcaoId,
  )
}

// ==================== ZOD SCHEMAS (Type-Safe) ====================

// consultar
const ConsultarSchema = z.object({
  entidade: z.enum([
    'colaboradores', 'setores', 'escalas', 'alocacoes', 'excecoes',
    'demandas', 'tipos_contrato', 'empresa', 'feriados', 'funcoes',
    'regra_definicao', 'regra_empresa',
    'demandas_excecao_data', 'colaborador_regra_horario_excecao_data',
    'colaborador_regra_horario'
  ]).describe('Entidade do banco a consultar. Use os nomes exatamente como no enum (ex: "colaboradores", "setores", "escalas").'),
  filtros: z.record(z.string(), z.any()).optional().describe('Filtros por igualdade (campo -> valor). Use apenas campos válidos da entidade; strings são comparadas sem diferenciar maiúsculas/minúsculas.')
})

// buscar_colaborador (semântica)
const BuscarColaboradorSchema = z.object({
  id: z.number().int().positive().optional().describe('ID do colaborador. Se informado, a busca é direta por ID.'),
  nome: z.string().min(2).optional().describe('Nome do colaborador para busca por texto (case-insensitive).'),
  setor_id: z.number().int().positive().optional().describe('Opcional: restringe a busca a um setor específico.'),
  ativo_apenas: z.boolean().optional().describe('Se true, considera apenas colaboradores ativos. Padrão: true.'),
  modo: z.enum(['AUTO', 'EXATO', 'PARCIAL']).optional().describe('AUTO tenta EXATO primeiro e cai para PARCIAL se necessário.'),
}).refine((v) => v.id !== undefined || (typeof v.nome === 'string' && v.nome.trim().length >= 2), {
  message: 'Informe `id` ou `nome` para buscar colaborador.',
})

const SalvarRegraHorarioColaboradorSchema = z.object({
  colaborador_id: z.number().int().positive().describe('ID do colaborador que receberá a regra.'),
  dia_semana_regra: DiaSemanaSchema.nullable().optional().describe('Dia da semana específico (SEG..DOM). NULL ou omitido = regra padrão (todos os dias). Ex: "QUA" = só quartas.'),
  ativo: z.boolean().optional().describe('Se a regra individual fica ativa. Padrão do backend: true ao criar.'),
  perfil_horario_id: z.number().int().positive().nullable().optional().describe('ID de perfil de horário do contrato (ou null para remover vínculo).'),
  inicio: z.string().regex(HORA_HHMM_REGEX).nullable().optional()
    .describe('Horário fixo de entrada (HH:MM). Motor força início exato. NULL = motor livre.'),
  fim: z.string().regex(HORA_HHMM_REGEX).nullable().optional()
    .describe('Horário máximo de saída (HH:MM). Motor não aloca além. NULL = motor livre.'),
  preferencia_turno_soft: z.string().nullable().optional().describe('Preferência soft de turno (ex: MANHA/TARDE/NOITE, conforme convenção local).'),
  domingo_ciclo_trabalho: z.number().int().min(0).max(10).optional().describe('Quantidade de domingos seguidos de trabalho no ciclo (só na regra padrão).'),
  domingo_ciclo_folga: z.number().int().min(0).max(10).optional().describe('Quantidade de domingos seguidos de folga no ciclo (só na regra padrão).'),
  folga_fixa_dia_semana: DiaSemanaSchema.nullable().optional().describe('Folga fixa semanal (SEG..DOM) ou null para remover (só na regra padrão).'),
  folga_variavel_dia_semana: z.enum(['SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB']).nullable().optional()
    .describe('Dia da 2a folga semanal (SEG..SAB, nunca DOM). Se trabalhou domingo, folga neste dia na semana seguinte. NULL para remover. Só na regra padrão.'),
})

// criar colaborador — validação específica para colaboradores
const CriarColaboradorSchema = z.object({
  nome: z.string().min(1).describe('Nome completo do colaborador.'),
  setor_id: z.number().int().positive().describe('ID do setor. Use o contexto automático injetado pelo sistema.'),
  tipo_contrato_id: z.number().int().positive().optional().describe('ID do tipo de contrato. Contexto automático disponibiliza contratos. Default: CLT 44h (id=1).'),
  sexo: z.enum(['M', 'F']).optional().describe('Sexo do colaborador: "M" ou "F".'),
  data_nascimento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('Data de nascimento no formato YYYY-MM-DD.'),
  tipo_trabalhador: z.string().optional().describe('Tipo de trabalhador (ex: regular, aprendiz, estagiario).'),
  hora_inicio_min: z.string().optional().describe('Horário mínimo de início permitido (HH:MM).'),
  hora_fim_max: z.string().optional().describe('Horário máximo de término permitido (HH:MM).'),
  ativo: z.boolean().optional().describe('true = ativo, false = inativo.')
})

// criar — schema genérico
const CriarSchema = z.object({
  entidade: z.enum([
    'colaboradores', 'excecoes', 'demandas', 'tipos_contrato',
    'setores', 'feriados', 'funcoes'
  ]).describe('Entidade para criação. Prefira tools semânticas quando existirem; use esta como fallback.'),
  dados: z.record(z.string(), z.any()).describe('Objeto com campos da entidade escolhida. IDs são resolvidos via contexto automático ou consultar.')
})

// atualizar
const AtualizarSchema = z.object({
  entidade: z.enum(['colaboradores', 'empresa', 'tipos_contrato', 'setores', 'demandas', 'excecoes', 'funcoes']).describe('Entidade a atualizar. Para postos/funções, prefira `salvar_posto_setor`.'),
  id: z.number().int().positive().describe('ID do registro a atualizar. Resolva via contexto automático ou consultar.'),
  dados: z.record(z.string(), z.any()).describe('Campos a atualizar (parcial).')
})

// deletar
const DeletarSchema = z.object({
  entidade: z.enum(['excecoes', 'demandas', 'feriados', 'funcoes']).describe('Entidade permitida para deleção.'),
  id: z.number().int().positive().describe('ID do registro a deletar.')
})

const SalvarPostoSetorSchema = z.object({
  id: z.number().int().positive().optional().describe('ID do posto para edição. Omitido = cria um novo posto.'),
  setor_id: z.number().int().positive().describe('ID do setor dono do posto. Resolva via contexto automático ou consultar("setores").'),
  apelido: z.string().min(1).describe('Nome/apelido do posto. Ex: "Caixa 1", "Açougue Balcão", "Repositor".'),
  tipo_contrato_id: z.number().int().positive().describe('ID do contrato exigido pelo posto. Resolva via consultar("tipos_contrato").'),
  titular_colaborador_id: z.number().int().positive().nullable().optional().describe('ID do titular atual do posto. Null remove o titular e manda o posto para reserva de postos. Omitido mantém o titular atual ao editar; na criação, omitido = sem titular.'),
})

// editar_regra
const EditarRegraSchema = z.object({
  codigo: z.string().describe('Código da regra (ex: H1, H6, S_DEFICIT, AP3).'),
  status: z.enum(['HARD', 'SOFT', 'OFF', 'ON']).describe('Novo status da regra. HARD/SOFT para regras parametrizáveis, OFF/ON para toggles.')
})

// gerar_escala
const GerarEscalaSchema = z.object({
  setor_id: z.number().int().positive().describe('ID do setor. Use o contexto automático injetado pelo sistema.'),
  data_inicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('Data inicial da escala no formato YYYY-MM-DD.'),
  data_fim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('Data final da escala no formato YYYY-MM-DD.'),
  solve_mode: z.enum(['rapido', 'balanceado', 'otimizado', 'maximo']).optional().describe('Modo de resolução: "rapido" (~45s), "balanceado" (~3min), "otimizado" (~10min) ou "maximo" (~30min). Padrão: rapido.'),
  rules_override: z.record(z.string(), z.string()).optional().describe('Overrides temporários de regras (codigo -> status). Endurecer regra mantém geração OFFICIAL; relaxar regra que hoje está HARD torna a geração EXPLORATORY. Ex: {"H10":"HARD"} ou {"H6":"SOFT"}')
})

// ajustar_alocacao
const AjustarAlocacaoSchema = z.object({
  escala_id: z.number().int().positive().describe('ID da escala (RASCUNHO/OFICIAL) que será ajustada.'),
  colaborador_id: z.number().int().positive().describe('ID do colaborador a ajustar na célula.'),
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('Data da célula a ajustar no formato YYYY-MM-DD.'),
  status: z.enum(['TRABALHO', 'FOLGA', 'INDISPONIVEL']).describe('Novo status da alocação: TRABALHO, FOLGA ou INDISPONIVEL.')
})

// ajustar_horario (semântica)
const AjustarHorarioSchema = z.object({
  escala_id: z.number().int().positive().describe('ID da escala que será ajustada.'),
  colaborador_id: z.number().int().positive().describe('ID do colaborador na alocação alvo.'),
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('Data da célula no formato YYYY-MM-DD.'),
  hora_inicio: z.string().regex(HORA_HHMM_REGEX).describe('Horário de início (HH:MM).'),
  hora_fim: z.string().regex(HORA_HHMM_REGEX).describe('Horário de fim (HH:MM).'),
  status: z.enum(['TRABALHO', 'FOLGA', 'INDISPONIVEL']).optional().describe('Status da célula após ajuste. Padrão: TRABALHO.'),
})

// oficializar_escala
const OficializarEscalaSchema = z.object({
  escala_id: z.number().int().positive().describe('ID da escala a oficializar. Só funciona se violacoes_hard = 0.')
})

// preflight
const PreflightSchema = z.object({
  setor_id: z.number().int().positive().describe('ID do setor para validar viabilidade. Resolva via contexto automático ou consultar.'),
  data_inicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('Data inicial do período no formato YYYY-MM-DD.'),
  data_fim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('Data final do período no formato YYYY-MM-DD.')
})

const PreflightCompletoSchema = z.object({
  setor_id: z.number().int().positive().describe('ID do setor para validação completa.'),
  data_inicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('Data inicial do período (YYYY-MM-DD).'),
  data_fim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('Data final do período (YYYY-MM-DD).'),
  regimes_override: z.array(RegimeOverrideSchema).optional().describe('Overrides opcionais de regime por colaborador para simulação do preflight completo.')
})

const DiagnosticarEscalaSchema = z.object({
  escala_id: z.number().int().positive().describe('ID da escala (normalmente obtido via contexto automático ou consultar).'),
  incluir_amostras: z.boolean().optional().describe('Se true, inclui amostras de violações/antipadrões no retorno. Padrão: true.')
})

// explicar_violacao
const ExplicarViolacaoSchema = z.object({
  codigo_regra: z.string().describe('Código da regra/violação para explicar (ex: H1, H14, S_DEFICIT, AP3).')
})

// diagnosticar_infeasible
const DiagnosticarInfeasibleSchema = z.object({
  setor_id: z.number().int().positive().describe('ID do setor que deu INFEASIBLE.'),
  data_inicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('Data inicial do período (YYYY-MM-DD).'),
  data_fim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('Data final do período (YYYY-MM-DD).'),
})

// cadastrar_lote
const CadastrarLoteSchema = z.object({
  entidade: z.enum([
    'colaboradores', 'excecoes', 'demandas', 'tipos_contrato',
    'setores', 'feriados', 'funcoes'
  ]).describe('Entidade para inserção em lote. Use quando o usuário enviar planilha/CSV/lista.'),
  registros: z.array(z.record(z.string(), z.any())).min(1).max(200).describe('Lista de registros para inserir (mínimo 1, máximo 200).')
})

// salvar_demanda_excecao_data
const SalvarDemandaExcecaoDataSchema = z.object({
  setor_id: z.number().int().positive().describe('ID do setor. Resolva via contexto automático ou consultar.'),
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('Data da demanda excepcional (YYYY-MM-DD). Ex: Black Friday, evento especial.'),
  hora_inicio: z.string().regex(HORA_HHMM_REGEX).describe('Início da faixa horária (HH:MM).'),
  hora_fim: z.string().regex(HORA_HHMM_REGEX).describe('Fim da faixa horária (HH:MM).'),
  min_pessoas: z.number().int().min(0).describe('Número mínimo de pessoas necessárias nesta faixa.'),
  override: z.boolean().optional().describe('Se true, substitui demanda regular do dia. Padrão: false.'),
})

// upsert_regra_excecao_data
const UpsertRegraExcecaoDataSchema = z.object({
  colaborador_id: z.number().int().positive().describe('ID do colaborador. Resolva via buscar_colaborador ou consultar.'),
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('Data do override pontual (YYYY-MM-DD).'),
  ativo: z.boolean().optional().describe('Se a exceção fica ativa. Padrão: true.'),
  inicio: z.string().regex(HORA_HHMM_REGEX).nullable().optional()
    .describe('Horário fixo de entrada neste dia (HH:MM). Motor força início exato. NULL = motor livre.'),
  fim: z.string().regex(HORA_HHMM_REGEX).nullable().optional()
    .describe('Horário máximo de saída neste dia (HH:MM). Motor não aloca além. NULL = motor livre.'),
  preferencia_turno_soft: z.enum(['MANHA', 'TARDE']).nullable().optional().describe('Preferência de turno para este dia (MANHA/TARDE) ou null.'),
  domingo_forcar_folga: z.boolean().optional().describe('Se true, força folga neste dia. Padrão: false.'),
})

// resumir_horas_setor
const ResumirHorasSetorSchema = z.object({
  setor_id: z.number().int().positive().describe('ID do setor. Resolva via contexto automático ou consultar.'),
  data_inicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('Início do período (YYYY-MM-DD).'),
  data_fim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('Fim do período (YYYY-MM-DD).'),
  escala_id: z.number().int().positive().optional().describe('Opcional: restringe a uma escala específica.'),
})

// resetar_regras_empresa
const ResetarRegrasEmpresaSchema = z.object({
  confirmar: z.literal(true).describe('Safety check: deve ser true para confirmar o reset de todas as regras.'),
})

// listar_perfis_horario
const ListarPerfisHorarioSchema = z.object({
  tipo_contrato_id: z.number().int().positive().describe('ID do tipo de contrato. Resolva via contexto automático ou consultar("tipos_contrato").'),
})

// salvar_perfil_horario
const SalvarPerfilHorarioSchema = z.object({
  id: z.number().int().positive().optional().describe('ID do perfil para atualizar. Se omitido, cria um novo.'),
  tipo_contrato_id: z.number().int().positive().optional().describe('ID do tipo de contrato (obrigatório para criação).'),
  nome: z.string().min(1).optional().describe('Nome do perfil (ex: "MANHA_08_12", "TARDE_13_20"). Obrigatório para criação.'),
  inicio: z.string().regex(HORA_HHMM_REGEX).nullable().optional().describe('Horário de entrada do perfil (HH:MM) ou null.'),
  fim: z.string().regex(HORA_HHMM_REGEX).nullable().optional().describe('Horário de saída do perfil (HH:MM) ou null.'),
  preferencia_turno_soft: z.enum(['MANHA', 'TARDE']).nullable().optional().describe('Preferência de turno (MANHA/TARDE) ou null.'),
  ordem: z.number().int().min(0).optional().describe('Ordem de exibição.'),
  ativo: z.boolean().optional().describe('Se false, desativa o perfil (soft delete).'),
})

// deletar_perfil_horario
const DeletarPerfilHorarioSchema = z.object({
  id: z.number().int().positive().describe('ID do perfil de horário a deletar.'),
})

// configurar_horario_funcionamento
const ConfigurarHorarioFuncionamentoSchema = z.object({
  nivel: z.enum(['empresa', 'setor']).describe('"empresa" para horário global, "setor" para override de setor específico.'),
  setor_id: z.number().int().positive().optional().describe('ID do setor (obrigatório se nivel="setor").'),
  dia_semana: DiaSemanaSchema.describe('Dia da semana (SEG, TER, QUA, QUI, SEX, SAB, DOM).'),
  ativo: z.boolean().describe('Se o estabelecimento funciona neste dia.'),
  hora_abertura: z.string().regex(HORA_HHMM_REGEX).optional().describe('Horário de abertura (HH:MM). Obrigatório se ativo=true.'),
  hora_fechamento: z.string().regex(HORA_HHMM_REGEX).optional().describe('Horário de fechamento (HH:MM). Obrigatório se ativo=true.'),
  usa_padrao: z.boolean().optional().describe('Só para setor: se true, herda horário da empresa neste dia.'),
})

// obter_alertas
const ObterAlertasSchema = z.object({
  setor_id: z.number().int().positive().optional().describe('Se informado, filtra alertas para este setor. Se omitido, retorna alertas de todos os setores.'),
})

// buscar_conhecimento
const BuscarConhecimentoSchema = z.object({
  consulta: z.string().min(1).describe('Texto da pergunta ou termos para buscar na base de conhecimento.'),
  limite: z.number().int().min(1).max(10).default(5).describe('Máximo de resultados.'),
})

// salvar_conhecimento
const SalvarConhecimentoSchema = z.object({
  titulo: z.string().min(1).describe('Título descritivo do conhecimento.'),
  conteudo: z.string().min(1).describe('Texto completo a ser indexado.'),
  importance: z.enum(['high', 'low']).default('high').describe('high=salvamento explícito do usuário, low=auto-capture pela IA.'),
})

// listar_conhecimento
const ListarConhecimentoSchema = z.object({
  tipo: z.enum(['todos', 'manual', 'auto_capture']).default('todos').describe('Filtro por tipo de fonte.'),
  limite: z.number().int().min(1).max(50).default(20).describe('Máximo de fontes.'),
})

// explorar_relacoes
const ExplorarRelacoesSchema = z.object({
  entidade: z.string().min(1).describe('Nome da entidade a explorar no knowledge graph (ex: "Cleunice", "CLT 44h").'),
  profundidade: z.number().int().min(1).max(3).default(2).describe('Profundidade do traversal no grafo (1-3). Padrão: 2.'),
})

// ==================== MEMÓRIAS IA ====================

const SalvarMemoriaSchema = z.object({
  conteudo: z.string().min(1).describe('Fato curto a memorizar (ex: "Cleunice nunca troca turno", "Black Friday precisa de 8 no Caixa").'),
  id: z.number().int().positive().optional().describe('ID da memória a atualizar. Se omitido, cria nova.'),
})

const ListarMemoriasSchema = z.object({})

const RemoverMemoriaSchema = z.object({
  id: z.number().int().positive().describe('ID da memória a remover.'),
})

// ==================== IA_TOOLS (Gemini API Format) ====================

export const IA_TOOLS = [
    {
        name: 'buscar_colaborador',
        description: 'Resolve colaborador por ID ou nome (case-insensitive). Match único retorna retrato completo: perfil, contrato, regras de horário (padrão + por dia), exceções por data, férias/atestados ativos, perfil de horário. Múltiplos candidatos retorna lista resumida para refinamento.',
        parameters: toJsonSchema(BuscarColaboradorSchema)
    },
    {
        name: 'consultar',
        description: 'Consulta dados do banco de dados. Use para informação detalhada com filtros. Nunca pergunte ao usuário — busque aqui. Exemplos: consultar("alocacoes", {"escala_id": 15}) para ver alocações de uma escala, consultar("excecoes", {"colaborador_id": 5}) para exceções de uma pessoa. Filtros de texto são case-insensitive.',
        parameters: toJsonSchema(ConsultarSchema)
    },
    {
        name: 'criar',
        description: 'Cria registro em: colaboradores, excecoes, demandas, tipos_contrato, setores, feriados e, como fallback, funcoes. Prefira tools semânticas quando existirem (ex: salvar_demanda_excecao_data, salvar_posto_setor). Exemplo: criar({"entidade": "excecoes", "dados": {"colaborador_id": 5, "tipo": "FERIAS", "data_inicio": "2026-03-10", "data_fim": "2026-03-24"}}).',
        parameters: toJsonSchema(CriarSchema)
    },
    {
        name: 'atualizar',
        description: 'Atualiza registro em: colaboradores, empresa, tipos_contrato, setores, demandas, excecoes e, como fallback, funcoes. Para postos/funções, prefira salvar_posto_setor porque ele já trata titular opcional, swap e reserva de postos.',
        parameters: toJsonSchema(AtualizarSchema)
    },
    {
        name: 'deletar',
        description: 'Remove registro de: excecoes, demandas, feriados, funcoes. Para funcoes/postos, a deleção passa pela regra de negócio oficial (desanexa titular antes e preserva histórico por snapshot). Requer id.',
        parameters: toJsonSchema(DeletarSchema)
    },
    {
        name: 'salvar_posto_setor',
        description: 'Cria ou edita um posto do setor com contrato do posto e titular opcional. Use esta tool para CRUD de postos. Ela já trata posto sem titular = reserva de postos, troca de titular com semântica de swap e remoção de titular sem apagar o posto.',
        parameters: toJsonSchema(SalvarPostoSetorSchema)
    },
    {
        name: 'editar_regra',
        description: 'Altera o status de uma regra do motor OR-Tools. Apenas regras marcadas como editavel=1 podem ser alteradas. Regras fixas por lei (H2, H4, H5, H11-H18) são imutáveis.',
        parameters: toJsonSchema(EditarRegraSchema)
    },
    {
        name: 'gerar_escala',
        description: 'Roda o motor OR-Tools CP-SAT para gerar uma escala. Salva como RASCUNHO. Use o setor_id do contexto automático. Exemplo: gerar_escala({"setor_id": 3, "data_inicio": "2026-03-01", "data_fim": "2026-03-31"}). Retorna escala_id, indicadores e diagnostico.',
        parameters: toJsonSchema(GerarEscalaSchema)
    },
    {
        name: 'ajustar_alocacao',
        description: 'Fixa uma alocação específica de uma pessoa em um dia. O motor respeita essa fixação ao regerar.',
        parameters: toJsonSchema(AjustarAlocacaoSchema)
    },
    {
        name: 'ajustar_horario',
        description: 'Ajusta horário de uma alocação existente (hora_inicio/hora_fim) e opcionalmente status. Use para correções manuais de escala sem usar SQL.',
        parameters: toJsonSchema(AjustarHorarioSchema)
    },
    {
        name: 'oficializar_escala',
        description: 'Trava a escala como OFICIAL. Só é possível quando violacoes_hard = 0. Se o usuário já informou `escala_id` e pediu para oficializar, chame esta tool diretamente (ela já valida e recusa se houver violação HARD).',
        parameters: toJsonSchema(OficializarEscalaSchema)
    },
    {
        name: 'preflight',
        description: 'Verifica viabilidade ANTES de gerar escala. Retorna blockers e warnings. Use o setor_id do contexto automático. Exemplo: preflight({"setor_id": 5, "data_inicio": "2026-03-01", "data_fim": "2026-03-31"}).',
        parameters: toJsonSchema(PreflightSchema)
    },
    {
        name: 'preflight_completo',
        description: 'Pré-flight ampliado (inclui checks de capacidade via buildSolverInput) para aproximar a visão da UI e reduzir falsos positivos de viabilidade.',
        parameters: toJsonSchema(PreflightCompletoSchema)
    },
    {
        name: 'diagnosticar_escala',
        description: 'Revalida e resume uma escala existente (indicadores, top violações/antipadrões e próximas ações possíveis). Use quando o usuário pedir diagnóstico/análise/explicação. Não use como passo obrigatório antes de `oficializar_escala` quando o usuário já deu um `escala_id` explícito.',
        parameters: toJsonSchema(DiagnosticarEscalaSchema)
    },
    {
        name: 'explicar_violacao',
        description: 'Explica uma regra CLT/CCT ou antipadrão pelo código (ex: H1, H2, H14, S_DEFICIT, AP3).',
        parameters: toJsonSchema(ExplicarViolacaoSchema)
    },
    {
        name: 'diagnosticar_infeasible',
        description: 'Investiga POR QUE uma geração de escala deu INFEASIBLE. Roda o solver múltiplas vezes em modo exploratório desligando regras editáveis críticas uma a uma para identificar qual combinação causa o conflito. Use após gerar_escala retornar INFEASIBLE. Retorna capacidade vs demanda e a lista de regras culpadas.',
        parameters: toJsonSchema(DiagnosticarInfeasibleSchema)
    },
    {
        name: 'cadastrar_lote',
        description: 'Cadastra MÚLTIPLOS registros de uma vez (batch INSERT). Use quando o usuário cola uma lista, planilha ou CSV com vários itens. Muito mais eficiente que chamar "criar" várias vezes. Aceita até 200 registros por chamada. Cada registro segue as mesmas regras e defaults da tool "criar" (ex: colaboradores recebem defaults inteligentes de sexo, contrato, etc). Retorna resumo com total criado e eventuais erros individuais.',
        parameters: toJsonSchema(CadastrarLoteSchema)
    },
    {
        name: 'salvar_regra_horario_colaborador',
        description: 'Cria/atualiza regra de horário individual. Pode ser padrão (dia_semana_regra omitido = todos os dias) ou específica de um dia (ex: dia_semana_regra="QUA" para só quartas). Campos de ciclo domingo e folga fixa só se aplicam à regra padrão.',
        parameters: toJsonSchema(SalvarRegraHorarioColaboradorSchema)
    },
    {
        name: 'salvar_demanda_excecao_data',
        description: 'Cria demanda excepcional por data (ex: Black Friday precisa de 8 pessoas). Insere na tabela demandas_excecao_data.',
        parameters: toJsonSchema(SalvarDemandaExcecaoDataSchema)
    },
    {
        name: 'upsert_regra_excecao_data',
        description: 'Override pontual de horário por colaborador/data (ex: "segunda o João entra às 10h"). Upsert em colaborador_regra_horario_excecao_data.',
        parameters: toJsonSchema(UpsertRegraExcecaoDataSchema)
    },
    {
        name: 'resumir_horas_setor',
        description: 'KPIs de horas e dias trabalhados por colaborador num período. Agrega alocações por pessoa com totais e médias.',
        parameters: toJsonSchema(ResumirHorasSetorSchema)
    },
    {
        name: 'resetar_regras_empresa',
        description: 'Volta TODAS as regras da empresa pro padrão original (deleta overrides em regra_empresa). Requer confirmar=true.',
        parameters: toJsonSchema(ResetarRegrasEmpresaSchema)
    },
    {
        name: 'listar_perfis_horario',
        description: 'Lista perfis de horário de um tipo de contrato (janelas de entrada/saída). Usado para ver perfis de estagiário, CLT etc.',
        parameters: toJsonSchema(ListarPerfisHorarioSchema)
    },
    {
        name: 'salvar_perfil_horario',
        description: 'Cria ou atualiza um perfil de horário de contrato. Para criar: tipo_contrato_id + nome + janelas. Para atualizar: id + campos a mudar.',
        parameters: toJsonSchema(SalvarPerfilHorarioSchema)
    },
    {
        name: 'deletar_perfil_horario',
        description: 'Remove um perfil de horário de contrato.',
        parameters: toJsonSchema(DeletarPerfilHorarioSchema)
    },
    {
        name: 'configurar_horario_funcionamento',
        description: 'Configura horário de funcionamento por dia da semana, a nível de empresa (global) ou setor (override). Exemplo: "sábado fecha às 20h" ou "açougue não abre domingo".',
        parameters: toJsonSchema(ConfigurarHorarioFuncionamentoSchema)
    },
    {
        name: 'obter_alertas',
        description: 'Retorna alertas ativos do sistema: setores sem escala, poucos colaboradores, escalas desatualizadas (dados mudaram desde geração), violações HARD pendentes. Use para dar contexto proativo ao usuário.',
        parameters: toJsonSchema(ObterAlertasSchema)
    },
    {
        name: 'buscar_conhecimento',
        description: 'Busca semântica na base de conhecimento (RAG). Retorna chunks relevantes + relações do knowledge graph. Use para perguntas sobre regras, procedimentos, legislação que não estão nas outras tools. Diferente de `consultar` (dados estruturados), esta busca em texto livre e semântico.',
        parameters: toJsonSchema(BuscarConhecimentoSchema)
    },
    {
        name: 'salvar_conhecimento',
        description: 'Salva conhecimento na base de conhecimento. importance=high: salvamento explícito do usuário. importance=low: auto-capture pela IA. Use quando o usuário pedir "registra que...", "salva que...", "anota que...".',
        parameters: toJsonSchema(SalvarConhecimentoSchema)
    },
    {
        name: 'listar_conhecimento',
        description: 'Lista fontes de conhecimento salvas com estatísticas (chunks, entidades, último acesso). Use para "o que temos salvo?", "quantas fontes temos?". Filtrável por tipo (manual/auto_capture).',
        parameters: toJsonSchema(ListarConhecimentoSchema)
    },
    {
        name: 'explorar_relacoes',
        description: 'Explora relações no knowledge graph a partir de uma entidade. O graph precisa ter sido gerado (via botão "Organizar Memória" na página de Memória). Se retornar vazio, o graph ainda não foi populado.',
        parameters: toJsonSchema(ExplorarRelacoesSchema)
    },
    {
        name: 'salvar_memoria',
        description: 'Salva uma memória curta do RH (max 20). Use quando o usuário diz "lembra que...", "anota que...", "registra que...". Para atualizar, passe o id.',
        parameters: toJsonSchema(SalvarMemoriaSchema)
    },
    {
        name: 'listar_memorias',
        description: 'Lista todas as memórias do RH salvas (max 20). Use para "o que eu pedi pra lembrar?", "quais anotações temos?".',
        parameters: toJsonSchema(ListarMemoriasSchema)
    },
    {
        name: 'remover_memoria',
        description: 'Remove uma memória do RH por id. Use quando o usuário diz "esquece que...", "remove aquela anotação sobre...".',
        parameters: toJsonSchema(RemoverMemoriaSchema)
    }
]

const ENTIDADES_LEITURA_PERMITIDAS = new Set([
    'colaboradores', 'setores', 'escalas', 'alocacoes', 'excecoes',
    'demandas', 'tipos_contrato', 'empresa', 'feriados', 'funcoes',
    'regra_definicao', 'regra_empresa',
    'demandas_excecao_data', 'colaborador_regra_horario_excecao_data',
    'contrato_perfis_horario', 'empresa_horario_semana', 'setor_horario_semana',
    'escala_ciclo_modelos', 'colaborador_regra_horario',
])

// Mapa de campos válidos por entidade (protege contra SQL injection e erros de campo inexistente)
const CAMPOS_VALIDOS: Record<string, Set<string>> = {
  colaboradores: new Set([
    'id', 'nome', 'setor_id', 'tipo_contrato_id', 'sexo', 'ativo', 'rank',
    'prefere_turno', 'evitar_dia_semana', 'horas_semanais', 'tipo_trabalhador',
    'data_nascimento', 'hora_inicio_min', 'hora_fim_max'
  ]),
  setores: new Set([
    'id', 'nome', 'icone', 'hora_abertura', 'hora_fechamento', 'regime_escala', 'ativo'
  ]),
  escalas: new Set([
    'id', 'setor_id', 'data_inicio', 'data_fim', 'status', 'pontuacao',
    'cobertura_percent', 'violacoes_hard', 'violacoes_soft'
  ]),
  alocacoes: new Set([
    'id', 'escala_id', 'colaborador_id', 'data', 'status',
    'hora_inicio', 'hora_fim', 'minutos'
  ]),
  excecoes: new Set([
    'id', 'colaborador_id', 'data_inicio', 'data_fim', 'tipo', 'observacao', 'motivo'
  ]),
  demandas: new Set([
    'id', 'setor_id', 'dia_semana', 'hora_inicio', 'hora_fim', 'min_pessoas'
  ]),
  tipos_contrato: new Set([
    'id', 'nome', 'horas_semanais', 'regime_escala', 'dias_trabalho',
    'max_minutos_dia'
  ]),
  empresa: new Set([
    'id', 'nome', 'cnpj', 'telefone', 'corte_semanal', 'tolerancia_semanal_min'
  ]),
  feriados: new Set([
    'id', 'data', 'nome', 'tipo', 'proibido_trabalhar', 'cct_autoriza'
  ]),
  funcoes: new Set([
    'id', 'setor_id', 'apelido', 'tipo_contrato_id', 'ativo', 'ordem'
  ]),
  regra_definicao: new Set([
    'codigo', 'nome', 'descricao', 'tipo', 'editavel'
  ]),
  regra_empresa: new Set([
    'codigo', 'status'
  ]),
  demandas_excecao_data: new Set([
    'id', 'setor_id', 'data', 'hora_inicio', 'hora_fim', 'min_pessoas', 'override'
  ]),
  colaborador_regra_horario_excecao_data: new Set([
    'id', 'colaborador_id', 'data', 'ativo', 'inicio', 'fim',
    'preferencia_turno_soft', 'domingo_forcar_folga'
  ]),
  contrato_perfis_horario: new Set([
    'id', 'tipo_contrato_id', 'nome', 'inicio', 'fim',
    'preferencia_turno_soft', 'ativo', 'ordem', 'horas_semanais', 'max_minutos_dia'
  ]),
  empresa_horario_semana: new Set([
    'id', 'dia_semana', 'ativo', 'hora_abertura', 'hora_fechamento'
  ]),
  setor_horario_semana: new Set([
    'id', 'setor_id', 'dia_semana', 'ativo', 'usa_padrao', 'hora_abertura', 'hora_fechamento'
  ]),
  escala_ciclo_modelos: new Set([
    'id', 'setor_id', 'nome', 'semanas_no_ciclo', 'ativo', 'origem_escala_id'
  ]),
  colaborador_regra_horario: new Set([
    'colaborador_id', 'dia_semana_regra', 'inicio', 'fim',
    'folga_fixa_dia_semana', 'folga_variavel_dia_semana', 'domingo_ciclo_trabalho',
    'domingo_ciclo_folga', 'perfil_horario_id', 'ativo'
  ]),
}

const ENTIDADES_CRIACAO_PERMITIDAS = new Set([
    'colaboradores', 'excecoes', 'demandas', 'tipos_contrato', 'setores', 'feriados', 'funcoes',
])

const ENTIDADES_ATUALIZACAO_PERMITIDAS = new Set([
    'colaboradores', 'empresa', 'tipos_contrato', 'setores', 'demandas', 'excecoes', 'funcoes',
])

const ENTIDADES_DELECAO_PERMITIDAS = new Set([
    'excecoes', 'demandas', 'feriados', 'funcoes',
])

const CONSULTAR_MODEL_ROW_LIMIT = 50

function getConsultarRelatedTools(entidade: string): string[] {
  const mapa: Record<string, string[]> = {
    colaboradores: ['atualizar', 'ajustar_alocacao', 'cadastrar_lote'],
    setores: ['preflight', 'gerar_escala', 'consultar'],
    escalas: ['ajustar_alocacao', 'oficializar_escala', 'consultar'],
    alocacoes: ['ajustar_alocacao', 'consultar'],
    excecoes: ['criar', 'deletar', 'consultar'],
    demandas: ['criar', 'atualizar', 'consultar'],
    funcoes: ['salvar_posto_setor', 'deletar', 'consultar'],
    tipos_contrato: ['criar', 'atualizar', 'consultar'],
    regra_definicao: ['editar_regra', 'consultar'],
    regra_empresa: ['editar_regra', 'consultar'],
    demandas_excecao_data: ['salvar_demanda_excecao_data', 'consultar'],
    colaborador_regra_horario_excecao_data: ['upsert_regra_excecao_data', 'consultar'],
    colaborador_regra_horario: ['salvar_regra_horario_colaborador', 'consultar'],
  }
  return mapa[entidade] ?? ['consultar']
}

async function enrichConsultarRows(entidade: string, rows: Array<Record<string, any>>): Promise<Array<Record<string, any>>> {
  const setorNomeCache = new Map<number, string | undefined>()
  const contratoNomeCache = new Map<number, string | undefined>()
  const colaboradorNomeCache = new Map<number, string | undefined>()
  const regraNomeCache = new Map<string, string | undefined>()

  const getSetorNome = async (id: unknown): Promise<string | undefined> => {
    if (typeof id !== 'number') return undefined
    if (!setorNomeCache.has(id)) {
      const row = await queryOne<{ nome?: string }>('SELECT id, nome FROM setores WHERE id = ?', id)
      setorNomeCache.set(id, row?.nome)
    }
    return setorNomeCache.get(id)
  }

  const getContratoNome = async (id: unknown): Promise<string | undefined> => {
    if (typeof id !== 'number') return undefined
    if (!contratoNomeCache.has(id)) {
      const row = await queryOne<{ nome?: string }>('SELECT id, nome FROM tipos_contrato WHERE id = ?', id)
      contratoNomeCache.set(id, row?.nome)
    }
    return contratoNomeCache.get(id)
  }

  const getColaboradorNome = async (id: unknown): Promise<string | undefined> => {
    if (typeof id !== 'number') return undefined
    if (!colaboradorNomeCache.has(id)) {
      const row = await queryOne<{ nome?: string }>('SELECT id, nome FROM colaboradores WHERE id = ?', id)
      colaboradorNomeCache.set(id, row?.nome)
    }
    return colaboradorNomeCache.get(id)
  }

  const getRegraNome = async (codigo: unknown): Promise<string | undefined> => {
    if (typeof codigo !== 'string') return undefined
    if (!regraNomeCache.has(codigo)) {
      const row = await queryOne<{ nome?: string }>('SELECT codigo, nome FROM regra_definicao WHERE codigo = ?', codigo)
      regraNomeCache.set(codigo, row?.nome)
    }
    return regraNomeCache.get(codigo)
  }

  const enrichedRows: Array<Record<string, any>> = []
  for (const row of rows) {
    const enriched = { ...row }

    if (entidade === 'colaboradores') {
      const setorNome = await getSetorNome(row.setor_id)
      const contratoNome = await getContratoNome(row.tipo_contrato_id)
      if (setorNome && !('setor_nome' in enriched)) enriched.setor_nome = setorNome
      if (contratoNome && !('tipo_contrato_nome' in enriched)) enriched.tipo_contrato_nome = contratoNome
      enrichedRows.push(enriched)
      continue
    }

    if (entidade === 'escalas') {
      const setorNome = await getSetorNome(row.setor_id)
      if (setorNome && !('setor_nome' in enriched)) enriched.setor_nome = setorNome
      enrichedRows.push(enriched)
      continue
    }

    if (entidade === 'alocacoes') {
      const colaboradorNome = await getColaboradorNome(row.colaborador_id)
      if (colaboradorNome && !('colaborador_nome' in enriched)) enriched.colaborador_nome = colaboradorNome
      enrichedRows.push(enriched)
      continue
    }

    if (entidade === 'excecoes') {
      const colaboradorNome = await getColaboradorNome(row.colaborador_id)
      if (colaboradorNome && !('colaborador_nome' in enriched)) enriched.colaborador_nome = colaboradorNome
      enrichedRows.push(enriched)
      continue
    }

    if (entidade === 'demandas' || entidade === 'funcoes') {
      const setorNome = await getSetorNome(row.setor_id)
      if (setorNome && !('setor_nome' in enriched)) enriched.setor_nome = setorNome
      if ('tipo_contrato_id' in enriched) {
        const contratoNome = await getContratoNome(row.tipo_contrato_id)
        if (contratoNome && !('tipo_contrato_nome' in enriched)) enriched.tipo_contrato_nome = contratoNome
      }
      enrichedRows.push(enriched)
      continue
    }

    if (entidade === 'regra_empresa') {
      const regraNome = await getRegraNome(row.codigo)
      if (regraNome && !('regra_nome' in enriched)) enriched.regra_nome = regraNome
      enrichedRows.push(enriched)
      continue
    }

    if (entidade === 'demandas_excecao_data') {
      const setorNome = await getSetorNome(row.setor_id)
      if (setorNome && !('setor_nome' in enriched)) enriched.setor_nome = setorNome
      enrichedRows.push(enriched)
      continue
    }

    if (entidade === 'colaborador_regra_horario_excecao_data') {
      const colaboradorNome = await getColaboradorNome(row.colaborador_id)
      if (colaboradorNome && !('colaborador_nome' in enriched)) enriched.colaborador_nome = colaboradorNome
      enrichedRows.push(enriched)
      continue
    }

    if (entidade === 'colaborador_regra_horario') {
      const colaboradorNome = await getColaboradorNome(row.colaborador_id)
      if (colaboradorNome && !('colaborador_nome' in enriched)) enriched.colaborador_nome = colaboradorNome
      enrichedRows.push(enriched)
      continue
    }

    enrichedRows.push(enriched)
  }
  return enrichedRows
}

// ==================== VALIDAÇÃO RUNTIME (Zod) ====================

export const TOOL_SCHEMAS: Record<string, z.ZodTypeAny | null> = {
  buscar_colaborador: BuscarColaboradorSchema,
  consultar: ConsultarSchema,
  criar: CriarSchema,
  atualizar: AtualizarSchema,
  deletar: DeletarSchema,
  salvar_posto_setor: SalvarPostoSetorSchema,
  editar_regra: EditarRegraSchema,
  gerar_escala: GerarEscalaSchema,
  ajustar_alocacao: AjustarAlocacaoSchema,
  ajustar_horario: AjustarHorarioSchema,
  oficializar_escala: OficializarEscalaSchema,
  preflight: PreflightSchema,
  preflight_completo: PreflightCompletoSchema,
  diagnosticar_escala: DiagnosticarEscalaSchema,
  explicar_violacao: ExplicarViolacaoSchema,
  diagnosticar_infeasible: DiagnosticarInfeasibleSchema,
  cadastrar_lote: CadastrarLoteSchema,
  salvar_regra_horario_colaborador: SalvarRegraHorarioColaboradorSchema,
  salvar_demanda_excecao_data: SalvarDemandaExcecaoDataSchema,
  upsert_regra_excecao_data: UpsertRegraExcecaoDataSchema,
  resumir_horas_setor: ResumirHorasSetorSchema,
  resetar_regras_empresa: ResetarRegrasEmpresaSchema,
  listar_perfis_horario: ListarPerfisHorarioSchema,
  salvar_perfil_horario: SalvarPerfilHorarioSchema,
  deletar_perfil_horario: DeletarPerfilHorarioSchema,
  configurar_horario_funcionamento: ConfigurarHorarioFuncionamentoSchema,
  obter_alertas: ObterAlertasSchema,
  buscar_conhecimento: BuscarConhecimentoSchema,
  salvar_conhecimento: SalvarConhecimentoSchema,
  listar_conhecimento: ListarConhecimentoSchema,
  explorar_relacoes: ExplorarRelacoesSchema,
  salvar_memoria: SalvarMemoriaSchema,
  listar_memorias: ListarMemoriasSchema,
  remover_memoria: RemoverMemoriaSchema,
}

const DICIONARIO_VIOLACOES: Record<string, string> = {
    'H1': 'Máximo de dias consecutivos sem folga. Por padrão, limite de 6 dias (CLT Art. 67). Colaborador trabalhou mais dias seguidos do que o permitido pela regra H1.',
    'H2': 'Descanso interjornada mínimo de 11 horas obrigatório entre o fim de um turno e o início do próximo (CLT Art. 66). Esta regra é FIXA por lei e não pode ser desativada.',
    'H3': 'Descanso semanal remunerado mínimo de 24h consecutivas (CLT Art. 67). No EscalaFlow esta regra é SOFT — não bloqueia oficialização, mas penaliza a pontuação.',
    'H4': 'Jornada máxima diária incluindo horas extras (CLT Art. 59). Regra FIXA por lei.',
    'H5': 'Limite de horas extras semanais (CLT Art. 59). Regra FIXA por lei.',
    'H6': 'Horas semanais abaixo do mínimo do contrato. O colaborador está sendo escalado com menos horas do que previsto em seu contrato de trabalho.',
    'H10': 'Janela de horário do colaborador violada. O turno atribuído está fora da janela permitida (início mínimo/máximo ou fim mínimo/máximo configurados na regra individual do colaborador).',
    'H11': 'Menor aprendiz trabalhando em domingo ou feriado proibido. Vedado pelo ECA Art. 67.',
    'H12': 'Menor aprendiz em período noturno (entre 22h e 5h). Vedado pelo ECA Art. 67.',
    'H13': 'Estagiário excedendo limite de 6h/dia ou 30h/semana. Vedado pela Lei 11.788/2008.',
    'H14': 'Trabalho em feriado proibido por CCT. Os dias 25/12 (Natal) e 01/01 (Ano Novo) são hard-blocked por CCT FecomercioSP × FECOMERCIARIOS. Nenhum colaborador pode trabalhar nesses dias.',
    'H15': 'Restrição de tipo de trabalhador especial (regime diferenciado, noturno ou aprendiz).',
    'H16': 'Restrição de jornada para tipo de contrato com limite especial.',
    'H17': 'Restrição de hora extra para tipo de trabalhador não elegível a horas extras.',
    'H18': 'Restrição de feriado para tipo de trabalhador com proteção legal adicional.',
    'S_DEFICIT': 'Déficit de cobertura de demanda. A escala não atende o número mínimo de pessoas planejado em um ou mais slots de horário. Cada slot abaixo do mínimo penaliza a pontuação.',
    'S_DOMINGO_CICLO': 'Ciclo de domingos irregular. A meta padrão é 2 domingos trabalhados para cada 1 de folga. Desvios do ciclo configurado geram penalidade soft.',
    'S_TURNO_PREF': 'Preferência de turno do colaborador ignorada. O colaborador tem preferência de turno configurada (manhã/tarde/noite) e foi escalado fora dela.',
    'S_CONSISTENCIA': 'Inconsistência de horários entre dias da mesma semana. O colaborador tem horários muito variados ao longo da semana.',
    'S_SPREAD': 'Spread de jornada semanal desigual entre colaboradores do mesmo setor.',
    'AP1': 'Antipadrão: excesso de horas em um único dia (mais de 8h de trabalho efetivo).',
    'AP2': 'Antipadrão: almoços simultâneos — muitos colaboradores do mesmo setor almoçando no mesmo slot de horário.',
    'AP3': 'Antipadrão: almoço muito cedo ou muito tarde (fora da janela ideal 11h–14h).',
    'DIAS_TRABALHO': 'Dias de trabalho por semana abaixo ou acima do previsto no contrato (regime 5X2 ou 6X1).',
    'MIN_DIARIO': 'Jornada diária abaixo do mínimo configurado para o tipo de contrato.',
    'FOLGA_VARIAVEL': 'Folga variável condicional: se trabalhou no domingo da semana anterior, deve folgar no dia variável configurado da semana seguinte (e vice-versa). Regra HARD do regime 5x2.',
}

// ==================== VERCEL AI SDK FORMAT ====================

/**
 * Converte tools pro formato Vercel AI SDK.
 * Reutiliza schemas Zod + executeTool().
 */
export function getVercelAiTools() {
    const tools: Record<string, any> = {}

    for (const t of IA_TOOLS) {
        const zodSchema = TOOL_SCHEMAS[t.name] || z.object({})

        tools[t.name] = {
            description: t.description,
            parameters: zodSchema,
            execute: async (args: Record<string, any>) => {
                return await executeTool(t.name, args)
            }
        }
    }

    return tools
}

// ==================== HELPERS: Enrichment de Colaborador (Single Match) ====================

async function enrichColaboradorSingle(colaborador: Record<string, any>) {
  const colabId = colaborador.id

  const [regras, excecoesPorData, excecoesGerais] = await Promise.all([
    queryAll<Record<string, any>>(
      'SELECT * FROM colaborador_regra_horario WHERE colaborador_id = ? AND ativo = true ORDER BY dia_semana_regra NULLS FIRST',
      colabId
    ),
    queryAll<Record<string, any>>(
      "SELECT * FROM colaborador_regra_horario_excecao_data WHERE colaborador_id = ? AND ativo = true AND data::date >= CURRENT_DATE ORDER BY data",
      colabId
    ),
    queryAll<Record<string, any>>(
      "SELECT * FROM excecoes WHERE colaborador_id = ? AND data_fim::date >= CURRENT_DATE ORDER BY data_inicio",
      colabId
    ),
  ])

  const padrao = regras.find((r) => r.dia_semana_regra === null) ?? null
  const por_dia = regras.filter((r) => r.dia_semana_regra !== null)

  let perfil_horario = null
  if (padrao?.perfil_horario_id) {
    perfil_horario = await queryOne<Record<string, any>>(
      'SELECT id, nome, inicio, fim, preferencia_turno_soft FROM contrato_perfis_horario WHERE id = ? AND ativo = true',
      padrao.perfil_horario_id
    )
  }

  return {
    regras_horario: { configurada: regras.length > 0, padrao, por_dia },
    excecoes_data: excecoesPorData,
    excecoes_gerais: excecoesGerais,
    perfil_horario,
  }
}

function buildColaboradorSummary(
  colab: Record<string, any>,
  enrich: Awaited<ReturnType<typeof enrichColaboradorSingle>>
): string {
  const parts: string[] = []
  parts.push(`${colab.nome} (id ${colab.id}, ${colab.tipo_contrato_nome ?? '?'}, setor ${colab.setor_nome ?? '?'})`)

  const { regras_horario } = enrich
  if (regras_horario.configurada) {
    const rParts: string[] = []
    if (regras_horario.padrao) rParts.push('1 padrão')
    if (regras_horario.por_dia.length > 0) {
      rParts.push(`${regras_horario.por_dia.length} por dia (${regras_horario.por_dia.map((r) => r.dia_semana_regra).join(', ')})`)
    }
    parts.push(rParts.join(' + '))
  } else {
    parts.push('sem regra individual')
  }

  if (enrich.excecoes_data.length > 0) {
    parts.push(`${enrich.excecoes_data.length} exceção(ões) data`)
  }

  for (const exc of enrich.excecoes_gerais) {
    parts.push(`${exc.tipo} ${exc.data_inicio}–${exc.data_fim}`)
  }

  return parts.join('. ') + '.'
}

function buildConsultarSummary(entidade: string, rows: any[], total: number): string {
    if (total === 0) return `Nenhum registro encontrado em ${entidade}.`
    if (entidade === 'alocacoes') {
        const byStatus = new Map<string, number>()
        for (const r of rows) byStatus.set(r.status ?? '?', (byStatus.get(r.status ?? '?') ?? 0) + 1)
        return `${total} alocações: ${[...byStatus.entries()].map(([s, c]) => `${c} ${s}`).join(', ')}`
    }
    if (entidade === 'colaboradores') {
        const byContrato = new Map<string, number>()
        for (const r of rows) byContrato.set(r.tipo_contrato_nome ?? '?', (byContrato.get(r.tipo_contrato_nome ?? '?') ?? 0) + 1)
        return `${total} colaboradores: ${[...byContrato.entries()].map(([t, c]) => `${c} ${t}`).join(', ')}`
    }
    if (entidade === 'excecoes') {
        const byTipo = new Map<string, number>()
        for (const r of rows) byTipo.set(r.tipo ?? '?', (byTipo.get(r.tipo ?? '?') ?? 0) + 1)
        return `${total} exceções: ${[...byTipo.entries()].map(([t, c]) => `${c} ${t}`).join(', ')}`
    }
    return `${total} registro(s) de ${entidade}`
}

async function applyColaboradorDefaults(
    dados: Record<string, any>,
    setor?: { hora_abertura?: string; hora_fechamento?: string } | null
): Promise<Record<string, any>> {
    if (!dados.tipo_contrato_id) dados.tipo_contrato_id = 1
    if (!dados.tipo_trabalhador) dados.tipo_trabalhador = 'regular'
    if (!dados.data_nascimento) {
        const age = Math.floor(Math.random() * 16) + 25
        const year = new Date().getFullYear() - age
        dados.data_nascimento = `${year}-01-01`
    }
    if (setor) {
        if (!dados.hora_inicio_min && setor.hora_abertura) dados.hora_inicio_min = setor.hora_abertura
        if (!dados.hora_fim_max && setor.hora_fechamento) dados.hora_fim_max = setor.hora_fechamento
    }
    if (dados.ativo === undefined) dados.ativo = true
    return dados
}

export async function executeTool(name: string, args: Record<string, any>): Promise<any> {
    // ==================== VALIDAÇÃO ZOD RUNTIME ====================
    const schema = TOOL_SCHEMAS[name]
    if (schema) {
        const validation = schema.safeParse(args)
        if (!validation.success) {
            const errors = validation.error.issues.map((issue) => {
                const path = issue.path.length > 0 ? issue.path.join('.') : 'root'
                return `  • ${path}: ${issue.message}`
            }).join('\n')
            return toolError(
              'INVALID_TOOL_ARGUMENTS',
              `❌ Validação falhou para tool '${name}':\n\n${errors}\n\n💡 Verifique os tipos e valores permitidos.`,
              {
                correction: 'Corrija os argumentos com base no schema da tool e tente novamente.',
                meta: { tool_name: name, stage: 'schema-validation' }
              }
            )
        }
        // Se válido, usar validated data (garantido type-safe)
        args = validation.data as Record<string, any>
    }

    // ==================== HANDLERS ====================

    if (name === 'buscar_colaborador') {
        try {
            const ativoApenas = args.ativo_apenas !== false
            const modo = (args.modo ?? 'AUTO') as 'AUTO' | 'EXATO' | 'PARCIAL'
            const setorId = typeof args.setor_id === 'number' ? args.setor_id : undefined

            const selectBase = `
              SELECT
                c.*,
                s.nome as setor_nome,
                t.nome as tipo_contrato_nome
              FROM colaboradores c
              LEFT JOIN setores s ON s.id = c.setor_id
              LEFT JOIN tipos_contrato t ON t.id = c.tipo_contrato_id
            `

            const runSearch = async (whereParts: string[], params: unknown[]) => {
              let sql = selectBase
              if (whereParts.length > 0) sql += ' WHERE ' + whereParts.join(' AND ')
              sql += ' ORDER BY c.ativo DESC, c.nome'
              return await queryAll<Record<string, any>>(sql, ...params)
            }

            if (typeof args.id === 'number') {
              const whereParts = ['c.id = ?']
              const params: unknown[] = [args.id]
              if (ativoApenas) whereParts.push('c.ativo = true')
              const rows = await runSearch(whereParts, params)
              if (rows.length === 0) {
                return toolError(
                  'BUSCAR_COLABORADOR_NAO_ENCONTRADO',
                  `Colaborador ${args.id} não encontrado${ativoApenas ? ' (ativo)' : ''}.`,
                  {
                    correction: 'Use o contexto automático ou buscar_colaborador por nome para resolver um ID válido.',
                    meta: { tool_kind: 'discovery', entidade: 'colaboradores', lookup: 'id', id: args.id }
                  }
                )
              }

              const colaborador = rows[0]
              const enrich = await enrichColaboradorSingle(colaborador)
              return toolOk(
                { colaborador, encontrado_por: 'id', ...enrich },
                {
                  summary: buildColaboradorSummary(colaborador, enrich),
                  meta: {
                    tool_kind: 'discovery',
                    entidade: 'colaboradores',
                    resolution: 'single',
                    ids_usaveis_em: ['consultar', 'criar', 'ajustar_alocacao', 'atualizar', 'salvar_regra_horario_colaborador'],
                  }
                }
              )
            }

            const nomeBusca = String(args.nome ?? '').trim()
            const baseWhere: string[] = []
            const baseParams: unknown[] = []
            if (setorId !== undefined) {
              baseWhere.push('c.setor_id = ?')
              baseParams.push(setorId)
            }
            if (ativoApenas) {
              baseWhere.push('c.ativo = true')
            }

            let rows: Array<Record<string, any>> = []
            let encontradoPor: 'nome_exato' | 'nome_parcial' | 'nome_auto' = 'nome_auto'

            if (modo === 'EXATO' || modo === 'AUTO') {
              rows = await runSearch(
                [...baseWhere, 'LOWER(c.nome) = LOWER(?)'],
                [...baseParams, nomeBusca],
              )
              if (rows.length > 0) {
                encontradoPor = 'nome_exato'
              }
            }

            if (rows.length === 0 && (modo === 'PARCIAL' || modo === 'AUTO')) {
              rows = await runSearch(
                [...baseWhere, 'c.nome ILIKE ?'],
                [...baseParams, `%${nomeBusca}%`],
              )
              encontradoPor = 'nome_parcial'
            }

            if (rows.length === 0) {
              return toolError(
                'BUSCAR_COLABORADOR_NAO_ENCONTRADO',
                `Nenhum colaborador encontrado para "${nomeBusca}".`,
                {
                  correction: 'Tente outro nome (ou parte do nome) e, se possível, restrinja por setor_id.',
                  meta: {
                    tool_kind: 'discovery',
                    entidade: 'colaboradores',
                    lookup: 'nome',
                    nome: nomeBusca,
                    setor_id: setorId,
                    ativo_apenas: ativoApenas,
                    modo,
                  }
                }
              )
            }

            const modelRows = rows.slice(0, 10)
            if (rows.length > 1) {
              const payload = {
                ambiguous: true,
                total: rows.length,
                candidatos: modelRows,
                encontrado_por: encontradoPor,
              }

              if (rows.length > 10) {
                return toolTruncated(payload, {
                  summary: `Busca de colaborador retornou ${rows.length} candidatos para "${nomeBusca}". Exibindo os primeiros 10.`,
                  meta: {
                    tool_kind: 'discovery',
                    entidade: 'colaboradores',
                    resolution: 'ambiguous',
                    nome: nomeBusca,
                    retornados: 10,
                    total: rows.length,
                    ids_usaveis_em: ['buscar_colaborador', 'consultar'],
                  }
                })
              }

              return toolOk(payload, {
                summary: `Busca de colaborador retornou ${rows.length} candidatos para "${nomeBusca}". Refine o nome ou use o ID.`,
                meta: {
                  tool_kind: 'discovery',
                  entidade: 'colaboradores',
                  resolution: 'ambiguous',
                  nome: nomeBusca,
                  ids_usaveis_em: ['buscar_colaborador', 'consultar'],
                }
              })
            }

            const colaborador = rows[0]
            const enrich = await enrichColaboradorSingle(colaborador)
            return toolOk(
              { colaborador, encontrado_por: encontradoPor, ...enrich },
              {
                summary: buildColaboradorSummary(colaborador, enrich),
                meta: {
                  tool_kind: 'discovery',
                  entidade: 'colaboradores',
                  resolution: 'single',
                  nome_busca: nomeBusca,
                  ids_usaveis_em: ['consultar', 'criar', 'ajustar_alocacao', 'atualizar', 'salvar_regra_horario_colaborador'],
                }
              }
            )
        } catch (e: any) {
            return toolError(
              'BUSCAR_COLABORADOR_FALHOU',
              `Erro ao buscar colaborador: ${e.message}`,
              {
                correction: 'Tente novamente com ID ou um nome mais específico.',
                meta: { tool_kind: 'discovery', entidade: 'colaboradores' }
              }
            )
        }
    }

    if (name === 'diagnosticar_escala') {
        try {
            const { escala_id } = args
            const incluirAmostras = args.incluir_amostras !== false

            const escala = await queryOne<Record<string, any> & { setor_nome?: string }>(`
              SELECT e.*, s.nome as setor_nome
              FROM escalas e
              LEFT JOIN setores s ON s.id = e.setor_id
              WHERE e.id = ?
            `, escala_id)

            if (!escala) {
              return toolError(
                'DIAGNOSTICAR_ESCALA_NAO_ENCONTRADA',
                `Escala ${escala_id} não encontrada.`,
                {
                  correction: 'Use o contexto automático ou consultar("escalas") para localizar uma escala válida.',
                  meta: { tool_kind: 'diagnostic', entidade: 'escalas', escala_id }
                }
              )
            }

            const validacao = await validarEscalaV3(escala_id)
            const indicadores = validacao.indicadores ?? {}
            const violacoes = Array.isArray((validacao as any).violacoes) ? (validacao as any).violacoes : []
            const antipatterns = Array.isArray((validacao as any).antipatterns) ? (validacao as any).antipatterns : []

            const topViolacoes = summarizeViolacoesTop(violacoes, 5)
            const topAntipatterns = summarizeViolacoesTop(antipatterns as any, 5)
            const hard = Number((indicadores as any).violacoes_hard ?? 0)
            const soft = Number((indicadores as any).violacoes_soft ?? 0)
            const podeOficializar = escala.status === 'RASCUNHO' && hard === 0

            const proximas_acoes_possiveis = [
              ...(hard > 0 ? ['explicar_violacao', 'ajustar_horario', 'ajustar_alocacao'] : []),
              ...(podeOficializar ? ['oficializar_escala'] : []),
              ...(escala.status === 'RASCUNHO' ? ['consultar'] : []),
            ]

            const ind = indicadores as { cobertura_percent?: number; cobertura_efetiva_percent?: number; pontuacao?: number }
            const coberturaResumo = textoResumoCobertura(
              ind.cobertura_percent ?? 0,
              ind.cobertura_efetiva_percent ?? ind.cobertura_percent ?? 0,
            )
            const resumo_user = {
              cobertura: coberturaResumo.principal,
              ...(coberturaResumo.secundaria ? { cobertura_secundaria: coberturaResumo.secundaria } : {}),
              problemas_oficializar: textoResumoViolacoesHard(hard),
              avisos: textoResumoViolacoesSoft(soft),
              qualidade: ind.pontuacao ?? 0,
              pode_oficializar: podeOficializar,
            }

            const payload: Record<string, any> = {
              escala: {
                id: escala.id,
                setor_id: escala.setor_id,
                setor_nome: escala.setor_nome,
                status: escala.status,
                data_inicio: escala.data_inicio,
                data_fim: escala.data_fim,
              },
              indicadores,
              resumo_user,
              diagnostico: {
                violacoes_hard: hard,
                violacoes_soft: soft,
                total_violacoes: violacoes.length,
                total_antipatterns: antipatterns.length,
                pode_oficializar: podeOficializar,
                top_violacoes: topViolacoes,
                top_antipatterns: topAntipatterns,
                proximas_acoes_possiveis,
              },
            }

            if (incluirAmostras) {
              payload.amostras = {
                violacoes: violacoes.slice(0, 5),
                antipatterns: antipatterns.slice(0, 5),
              }
            }

            return toolOk(payload, {
              summary: hard > 0
                ? `Diagnóstico da escala ${escala_id}: ${hard} violação(ões) HARD e ${soft} SOFT.`
                : `Diagnóstico da escala ${escala_id}: sem violações HARD${soft > 0 ? `, com ${soft} SOFT` : ''}.`,
              meta: {
                tool_kind: 'diagnostic',
                entidade: 'escalas',
                escala_id,
                pode_oficializar: podeOficializar,
                next_tools_hint: proximas_acoes_possiveis,
              }
            })
        } catch (e: any) {
            return toolError(
              'DIAGNOSTICAR_ESCALA_FALHOU',
              `Erro ao diagnosticar escala: ${e.message}`,
              {
                correction: 'Confirme o escala_id e tente novamente. Se necessário, recarregue contexto/escala.',
                meta: { tool_kind: 'diagnostic', entidade: 'escalas' }
              }
            )
        }
    }

    if (name === 'diagnosticar_infeasible') {
        const { setor_id, data_inicio, data_fim } = args

        try {
            // Regras editáveis críticas testadas em modo exploratório para isolamento de causa
            const RELAXABLE_RULES = ['H1', 'H6', 'H10', 'DIAS_TRABALHO', 'MIN_DIARIO'] as const

            // 1. Capacidade vs demanda
            const solverInput = await buildSolverInput(setor_id, data_inicio, data_fim)
            const colabs = solverInput.colaboradores
            const totalDias = Math.ceil(
                (new Date(data_fim + 'T00:00:00').getTime() - new Date(data_inicio + 'T00:00:00').getTime()) / 86400000
            ) + 1
            const gridMin = solverInput.empresa.grid_minutos
            const capacidadeMaxMinutos = colabs.reduce((sum, c) => {
                return sum + c.max_minutos_dia * totalDias
            }, 0)
            const demandaTotalSlots = solverInput.demanda.reduce((sum, d) => {
                const faixaSlots = (
                    (parseInt(d.hora_fim.split(':')[0]) * 60 + parseInt(d.hora_fim.split(':')[1]))
                    - (parseInt(d.hora_inicio.split(':')[0]) * 60 + parseInt(d.hora_inicio.split(':')[1]))
                ) / gridMin
                const diasAplicaveis = d.dia_semana ? Math.ceil(totalDias / 7) : totalDias
                return sum + d.min_pessoas * faixaSlots * diasAplicaveis
            }, 0)

            // 2. Testar desligando cada regra individualmente
            const resultadosTeste: Array<{
                regra_desligada: string
                status: string
                resolveu: boolean
                tempo_ms: number
            }> = []

            for (const regra of RELAXABLE_RULES) {
                const override: Record<string, string> = { [regra]: 'OFF' }
                const testInput = await buildSolverInput(setor_id, data_inicio, data_fim, undefined, {
                    solveMode: 'rapido',
                    generationMode: 'EXPLORATORY',
                    maxTimeSeconds: 10,
                    rulesOverride: override,
                })
                const testResult = await runSolver(testInput, 15_000)
                resultadosTeste.push({
                    regra_desligada: regra,
                    status: testResult.status,
                    resolveu: testResult.sucesso,
                    tempo_ms: testResult.solve_time_ms,
                })
            }

            // 3. Testar com tudo relaxável OFF (identifica se é CLT puro ou demanda)
            const allOff: Record<string, string> = {}
            for (const r of RELAXABLE_RULES) allOff[r] = 'OFF'
            const baseInput = await buildSolverInput(setor_id, data_inicio, data_fim, undefined, {
                solveMode: 'rapido',
                generationMode: 'EXPLORATORY',
                maxTimeSeconds: 10,
                rulesOverride: allOff,
            })
            const baseResult = await runSolver(baseInput, 15_000)

            const regrasQueResolvem = resultadosTeste.filter(r => r.resolveu).map(r => r.regra_desligada)
            const regrasQueNaoResolvem = resultadosTeste.filter(r => !r.resolveu).map(r => r.regra_desligada)

            const analise: Record<string, any> = {
                setor_id,
                periodo: `${data_inicio} a ${data_fim}`,
                total_dias: totalDias,
                total_colaboradores: colabs.length,
                capacidade_vs_demanda: {
                    capacidade_max_minutos: capacidadeMaxMinutos,
                    demanda_total_slots: Math.round(demandaTotalSlots),
                    ratio_estimado: demandaTotalSlots > 0 ? +(capacidadeMaxMinutos / (demandaTotalSlots * gridMin)).toFixed(2) : 999,
                },
                teste_base_sem_product_rules: {
                    status: baseResult.status,
                    resolveu: baseResult.sucesso,
                    conclusao: baseResult.sucesso
                        ? 'O problema está nas regras de produto (não CLT). Relaxar regras resolve.'
                        : 'Mesmo sem regras de produto, CLT puro falha. Faltam colaboradores ou há conflitos em exceções/pinned_cells.',
                },
                testes_individuais: resultadosTeste,
                regras_que_resolvem_ao_desligar: regrasQueResolvem,
                regras_que_nao_resolvem_ao_desligar: regrasQueNaoResolvem,
                diagnostico_resumido: regrasQueResolvem.length > 0
                    ? `Desligar ${regrasQueResolvem.join(' + ')} resolve o INFEASIBLE. Considere usar rules_override em gerar_escala ou ajustar a configuração dessas regras. Se rebaixar uma regra que hoje está HARD, a geração ficará EXPLORATORY.`
                    : baseResult.sucesso
                        ? 'Nenhuma regra individual resolve sozinha, mas desligar todas as product rules resolve. É uma combinação de múltiplas regras apertadas.'
                        : 'INFEASIBLE é causado por falta de capacidade (CLT). Aumente colaboradores, reduza demanda ou encurte o período.',
            }

            return toolOk(analise, {
                summary: `Diagnóstico de INFEASIBLE: ${regrasQueResolvem.length > 0 ? `regras culpadas: ${regrasQueResolvem.join(', ')}` : baseResult.sucesso ? 'combinação de múltiplas regras' : 'falta de capacidade CLT'}`,
                meta: {
                    tool_kind: 'diagnostic',
                    action: 'infeasible-analysis',
                    setor_id,
                    regras_culpadas: regrasQueResolvem,
                    next_tools_hint: ['editar_regra', 'gerar_escala', 'explicar_violacao'],
                },
            })
        } catch (e: any) {
            return toolError(
                'DIAGNOSTICAR_INFEASIBLE_FALHOU',
                `Erro ao diagnosticar INFEASIBLE: ${e.message}`,
                {
                    correction: 'Verifique se o setor_id está correto e se o período é válido.',
                    meta: { tool_kind: 'diagnostic', action: 'infeasible-analysis', setor_id },
                }
            )
        }
    }

    if (name === 'consultar') {
        const { entidade, filtros } = args

        if (!ENTIDADES_LEITURA_PERMITIDAS.has(entidade)) {
            return toolError(
              'CONSULTAR_ENTIDADE_INVALIDA',
              `Entidade '${entidade}' não permitida. Use: ${[...ENTIDADES_LEITURA_PERMITIDAS].join(' | ')}`,
              {
                correction: 'Escolha uma entidade do enum permitido para a tool consultar.',
                meta: { entidade_solicitada: entidade, entidades_permitidas: [...ENTIDADES_LEITURA_PERMITIDAS] }
              }
            )
        }

        // VALIDAÇÃO DE CAMPOS (Fase 1: protege contra SQL injection e erros de campo inexistente)
        if (filtros && Object.keys(filtros).length > 0) {
            const camposValidos = CAMPOS_VALIDOS[entidade]
            if (!camposValidos) {
                return toolError(
                  'CONSULTAR_MAPA_CAMPOS_AUSENTE',
                  `Entidade '${entidade}' não tem mapa de campos válidos.`,
                  {
                    correction: 'Use outra entidade suportada ou corrija o mapeamento de campos válidos no backend.',
                    meta: { entidade }
                  }
                )
            }

            for (const campo of Object.keys(filtros)) {
                if (!camposValidos.has(campo)) {
                    return toolError(
                      'CONSULTAR_CAMPO_INVALIDO',
                      `❌ Campo inválido: "${campo}" não existe em ${entidade}.\n\n💡 Campos disponíveis: ${[...camposValidos].join(', ')}`,
                      {
                        correction: `Use apenas campos válidos de ${entidade}.`,
                        meta: { entidade, campo_invalido: campo, campos_validos: [...camposValidos] }
                      }
                    )
                }
            }
        }

        let query = `SELECT * FROM ${entidade}`
        const params: unknown[] = []

        if (filtros && Object.keys(filtros).length > 0) {
            const conditions = Object.entries(filtros).map(([k, v]) => {
                if (typeof v === 'string') return `LOWER(${k}) = LOWER(?)`
                return `${k} = ?`
            })
            query += ' WHERE ' + conditions.join(' AND ')
            params.push(...Object.values(filtros))
        }

        try {
            const rows = await queryAll<Record<string, any>>(query, ...params)
            const total = rows.length
            const truncated = total > CONSULTAR_MODEL_ROW_LIMIT
            const slicedRows = truncated ? rows.slice(0, CONSULTAR_MODEL_ROW_LIMIT) : rows
            const dados = await enrichConsultarRows(entidade, slicedRows)
            const commonMeta = {
              tool_kind: 'discovery',
              entidade,
              filtros_aplicados: filtros ?? {},
              ids_usaveis_em: getConsultarRelatedTools(entidade),
              campos_validos: [...(CAMPOS_VALIDOS[entidade] ?? [])],
              total,
              retornados: dados.length,
            }

            if (truncated) {
              return toolTruncated(
                {
                  entidade,
                  total,
                  retornados: dados.length,
                  dados,
                },
                {
                  summary: buildConsultarSummary(entidade, dados, total),
                  meta: {
                    ...commonMeta,
                    suggested_next_step: 'Refine os filtros para reduzir o volume antes de decidir a próxima ação.',
                  }
                }
              )
            }

            return toolOk(
              {
                entidade,
                total,
                dados,
              },
              {
                summary: buildConsultarSummary(entidade, dados, total),
                meta: commonMeta
              }
            )
        } catch (e: any) {
            return toolError(
              'CONSULTAR_EXECUCAO_FALHOU',
              e.message,
              {
                correction: 'Revise entidade/filtros e tente novamente. Se necessário, simplifique a consulta.',
                meta: { entidade, filtros_aplicados: filtros ?? {} }
              }
            )
        }
    }

    if (name === 'salvar_posto_setor') {
        const titularColaboradorId = hasOwnField(args, 'titular_colaborador_id')
          ? (args.titular_colaborador_id ?? null)
          : (args.id ? await getTitularAtualPostoId(args.id) : null)

        try {
            const posto = await salvarDetalheFuncao({
              id: args.id,
              setor_id: args.setor_id,
              apelido: args.apelido.trim(),
              tipo_contrato_id: args.tipo_contrato_id,
              titular_colaborador_id: titularColaboradorId,
            })

            const view = await getPostoToolView(posto.id)
            const operacao = args.id ? 'atualizado' : 'criado'
            const resumoTitular = view?.titular_nome
              ? `Titular atual: ${view.titular_nome}.`
              : 'Sem titular: posto está na reserva de postos.'

            return toolOk(
              {
                sucesso: true,
                operacao,
                posto: view ?? posto,
              },
              {
                summary: `Posto ${operacao}: ${posto.apelido}. ${resumoTitular}`,
                meta: {
                  tool_kind: 'action',
                  action: 'save-posto',
                  entidade: 'funcoes',
                  id: posto.id,
                  ids_usaveis_em: ['consultar', 'salvar_posto_setor', 'deletar'],
                }
              }
            )
        } catch (e: any) {
            return toolError(
              'SALVAR_POSTO_SETOR_FALHOU',
              `Erro ao salvar posto: ${e.message}`,
              {
                correction: 'Revise setor, contrato e titular. O titular deve pertencer ao mesmo setor do posto.',
                meta: { tool_kind: 'action', action: 'save-posto', entidade: 'funcoes', id: args.id ?? null }
              }
            )
        }
    }

    if (name === 'criar') {
        const { entidade, dados } = args

        if (!ENTIDADES_CRIACAO_PERMITIDAS.has(entidade)) {
            return toolError(
              'CRIAR_ENTIDADE_NAO_PERMITIDA',
              `❌ Criação não permitida para '${entidade}'. Entidades permitidas: ${[...ENTIDADES_CRIACAO_PERMITIDAS].join(', ')}`,
              {
                correction: 'Escolha uma entidade permitida para criação ou use outra tool específica.',
                meta: { entidade_solicitada: entidade, entidades_permitidas: [...ENTIDADES_CRIACAO_PERMITIDAS] }
              }
            )
        }

        // VALIDAÇÃO ESPECÍFICA + DEFAULTS INTELIGENTES
        if (entidade === 'colaboradores') {
            // Campos obrigatórios
            if (!dados.nome || typeof dados.nome !== 'string') {
                return toolError(
                  'CRIAR_COLABORADOR_NOME_OBRIGATORIO',
                  '❌ Campo obrigatório: "nome" (string). Exemplo: { "nome": "João Silva", "setor_id": 1 }',
                  { correction: 'Informe o nome do colaborador em `dados.nome`.' }
                )
            }
            if (!dados.setor_id || typeof dados.setor_id !== 'number') {
                return toolError(
                  'CRIAR_COLABORADOR_SETOR_ID_OBRIGATORIO',
                  '❌ Campo obrigatório: "setor_id" (number). Resolva via contexto automático ou consultar("setores").',
                  { correction: 'Resolva o setor via contexto automático ou consultar e envie `dados.setor_id`.' }
                )
            }

            // Validar setor existe
            const setor = await queryOne<any>('SELECT id, nome, hora_abertura, hora_fechamento FROM setores WHERE id = ? AND ativo = true', dados.setor_id)
            if (!setor) {
                return toolError(
                  'CRIAR_COLABORADOR_SETOR_INVALIDO',
                  `❌ Setor ${dados.setor_id} não encontrado ou inativo.`,
                  {
                    correction: 'Escolha um setor ativo válido via contexto automático ou consultar("setores").',
                    meta: { setor_id: dados.setor_id }
                  }
                )
            }

            // Validar sexo obrigatório
            if (!dados.sexo || (dados.sexo !== 'M' && dados.sexo !== 'F')) {
                return toolError(
                  'CRIAR_COLABORADOR_SEXO_OBRIGATORIO',
                  '❌ Campo obrigatório: "sexo" (M ou F). Pergunte ao usuário.',
                  { correction: 'Pergunte ao usuário se o colaborador é do sexo masculino (M) ou feminino (F) antes de cadastrar.' }
                )
            }

            // Defaults inteligentes para campos opcionais
            await applyColaboradorDefaults(dados, setor)
        }

        if (entidade === 'excecoes') {
            // Campos obrigatórios
            if (!dados.colaborador_id) {
                return toolError(
                  'CRIAR_EXCECAO_COLABORADOR_ID_OBRIGATORIO',
                  '❌ Campo obrigatório: "colaborador_id" (number). Resolva via buscar_colaborador pelo nome.',
                  { correction: 'Resolva o colaborador via buscar_colaborador e envie `dados.colaborador_id`.' }
                )
            }
            if (!dados.tipo) {
                return toolError(
                  'CRIAR_EXCECAO_TIPO_OBRIGATORIO',
                  '❌ Campo obrigatório: "tipo" (string). Valores permitidos: FERIAS, ATESTADO, BLOQUEIO',
                  { correction: 'Informe `dados.tipo` com um valor permitido.' }
                )
            }
            if (!dados.data_inicio || !dados.data_fim) {
                return toolError(
                  'CRIAR_EXCECAO_PERIODO_OBRIGATORIO',
                  '❌ Campos obrigatórios: "data_inicio" e "data_fim" (YYYY-MM-DD)',
                  { correction: 'Informe `dados.data_inicio` e `dados.data_fim` no formato YYYY-MM-DD.' }
                )
            }

            // Validar tipo
            const tiposValidos = ['FERIAS', 'ATESTADO', 'BLOQUEIO']
            if (!tiposValidos.includes(dados.tipo)) {
                return toolError(
                  'CRIAR_EXCECAO_TIPO_INVALIDO',
                  `❌ Tipo inválido: "${dados.tipo}". Valores permitidos: ${tiposValidos.join(', ')}`,
                  {
                    correction: 'Use um dos valores permitidos para `dados.tipo`.',
                    meta: { tipo_informado: dados.tipo, tipos_validos: tiposValidos }
                  }
                )
            }

            // Default observacao (coluna real da tabela excecoes)
            if (!dados.observacao) dados.observacao = dados.tipo
        }

        // Warning de capacidade para demandas
        let avisoCapacidadeCriar: string | undefined
        if (entidade === 'demandas' && dados.setor_id && dados.min_pessoas) {
            const totalColabs = await queryOne<{ total: number }>(
              'SELECT COUNT(*) as total FROM colaboradores WHERE setor_id = ? AND ativo = true', dados.setor_id
            )
            const totalNoSetor = totalColabs?.total ?? 0
            if (dados.min_pessoas > totalNoSetor) {
              avisoCapacidadeCriar = `⚠️ ATENÇÃO: min_pessoas (${dados.min_pessoas}) excede o total de colaboradores ativos no setor (${totalNoSetor}). O motor pode retornar INFEASIBLE.`
            }
        }

        if (entidade === 'funcoes') {
            if (!dados.setor_id || typeof dados.setor_id !== 'number') {
                return toolError(
                  'CRIAR_POSTO_SETOR_ID_OBRIGATORIO',
                  '❌ Campo obrigatório: "setor_id" (number). Resolva via contexto automático ou consultar("setores").',
                  { correction: 'Informe `dados.setor_id` ou use a tool `salvar_posto_setor`.' }
                )
            }
            if (!dados.apelido || typeof dados.apelido !== 'string') {
                return toolError(
                  'CRIAR_POSTO_APELIDO_OBRIGATORIO',
                  '❌ Campo obrigatório: "apelido" (string).',
                  { correction: 'Informe `dados.apelido` ou use a tool `salvar_posto_setor`.' }
                )
            }
            if (!dados.tipo_contrato_id || typeof dados.tipo_contrato_id !== 'number') {
                return toolError(
                  'CRIAR_POSTO_CONTRATO_OBRIGATORIO',
                  '❌ Campo obrigatório: "tipo_contrato_id" (number).',
                  { correction: 'Informe `dados.tipo_contrato_id` ou use `salvar_posto_setor`.' }
                )
            }

            try {
                const posto = await salvarDetalheFuncao({
                  setor_id: dados.setor_id,
                  apelido: dados.apelido.trim(),
                  tipo_contrato_id: dados.tipo_contrato_id,
                  titular_colaborador_id: hasOwnField(dados, 'titular_colaborador_id')
                    ? (dados.titular_colaborador_id ?? null)
                    : null,
                })
                const view = await getPostoToolView(posto.id)
                return toolOk(
                  {
                    sucesso: true,
                    id: posto.id,
                    entidade,
                    posto: view ?? posto,
                  },
                  {
                    summary: `Posto criado com sucesso (id: ${String(posto.id)}). Prefira \`salvar_posto_setor\` nas próximas alterações de posto.`,
                    meta: {
                      tool_kind: 'action',
                      action: 'create',
                      entidade,
                      ids_usaveis_em: ['consultar', 'salvar_posto_setor', 'deletar'],
                    }
                  }
                )
            } catch (e: any) {
                return toolError(
                  'CRIAR_POSTO_FALHOU',
                  `❌ Erro ao criar posto: ${e.message}`,
                  {
                    correction: 'Revise setor, contrato e titular. Prefira a tool `salvar_posto_setor`.',
                    meta: { entidade }
                  }
                )
            }
        }

        const keys = Object.keys(dados)
        const placeholders = keys.map(() => '?').join(', ')
        const values = Object.values(dados)

        try {
            const newId = await insertReturningId(`INSERT INTO ${entidade} (${keys.join(', ')}) VALUES (${placeholders})`, ...values)
            return toolOk(
              {
                sucesso: true,
                id: newId,
                entidade,
                ...(avisoCapacidadeCriar ? { aviso_capacidade: avisoCapacidadeCriar } : {}),
              },
              {
                summary: `Registro criado em ${entidade} com sucesso (id: ${String(newId)}).${avisoCapacidadeCriar ? ` ${avisoCapacidadeCriar}` : ''}`,
                meta: {
                  tool_kind: 'action',
                  action: 'create',
                  entidade,
                  ids_usaveis_em: ['consultar', 'atualizar'],
                }
              }
            )
        } catch (e: any) {
            // Traduz erros SQL pra mensagens acionáveis
            if (e.message?.includes('NOT NULL') || e.message?.includes('not-null')) {
                const match = e.message.match(/column "(\w+)"/) ?? e.message.match(/NOT NULL constraint failed: \w+\.(\w+)/)
                const campo = match?.[1] || 'desconhecido'
                return toolError(
                  'CRIAR_NOT_NULL',
                  `❌ Campo obrigatório faltando: "${campo}". Verifique a estrutura da entidade ${entidade}.`,
                  {
                    correction: `Preencha o campo obrigatório "${campo}" em \`dados\` e tente novamente.`,
                    meta: { entidade, campo }
                  }
                )
            }
            if (e.message?.includes('UNIQUE') || e.message?.includes('unique') || e.message?.includes('duplicate key')) {
                return toolError(
                  'CRIAR_UNIQUE_CONSTRAINT',
                  `❌ Registro duplicado: ${entidade} com esses valores únicos já existe.`,
                  {
                    correction: 'Revise os campos únicos (nome/código/etc.) e tente outro valor.',
                    meta: { entidade }
                  }
                )
            }
            if (e.message?.includes('FOREIGN KEY') || e.message?.includes('foreign key') || e.message?.includes('violates foreign key')) {
                return toolError(
                  'CRIAR_FOREIGN_KEY',
                  '❌ Referência inválida: um dos IDs fornecidos não existe no banco. Verifique setor_id, colaborador_id, etc.',
                  {
                    correction: 'Resolva os IDs via contexto automático ou consultar antes de criar.',
                    meta: { entidade }
                  }
                )
            }
            return toolError(
              'CRIAR_FALHOU',
              `❌ Erro ao criar ${entidade}: ${e.message}`,
              {
                correction: 'Revise os campos enviados e tente novamente.',
                meta: { entidade }
              }
            )
        }
    }

    if (name === 'atualizar') {
        const { entidade, id, dados } = args

        if (!ENTIDADES_ATUALIZACAO_PERMITIDAS.has(entidade)) {
            return toolError(
              'ATUALIZAR_ENTIDADE_NAO_PERMITIDA',
              `Atualização não permitida para '${entidade}'. Para alterar regras, use a tool editar_regra.`,
              {
                correction: 'Use uma entidade permitida ou a tool específica correta.',
                meta: { entidade_solicitada: entidade, entidades_permitidas: [...ENTIDADES_ATUALIZACAO_PERMITIDAS] }
              }
            )
        }

        if (entidade === 'funcoes') {
            const postoAtual = await queryOne<{ id: number; setor_id: number; apelido: string; tipo_contrato_id: number }>(
              'SELECT id, setor_id, apelido, tipo_contrato_id FROM funcoes WHERE id = ?',
              id,
            )

            if (!postoAtual) {
                return toolError(
                  'ATUALIZAR_POSTO_NAO_ENCONTRADO',
                  `Posto ${id} não encontrado.`,
                  {
                    correction: 'Confirme o ID com consultar("funcoes") ou use `salvar_posto_setor`.',
                    meta: { entidade, id }
                  }
                )
            }

            try {
                const titularAtualId = await getTitularAtualPostoId(id)
                const posto = await salvarDetalheFuncao({
                  id,
                  setor_id: typeof dados.setor_id === 'number' ? dados.setor_id : postoAtual.setor_id,
                  apelido: typeof dados.apelido === 'string' ? dados.apelido.trim() : postoAtual.apelido,
                  tipo_contrato_id: typeof dados.tipo_contrato_id === 'number' ? dados.tipo_contrato_id : postoAtual.tipo_contrato_id,
                  titular_colaborador_id: hasOwnField(dados, 'titular_colaborador_id')
                    ? (dados.titular_colaborador_id ?? null)
                    : titularAtualId,
                })
                const view = await getPostoToolView(posto.id)
                return toolOk(
                  {
                    sucesso: true,
                    entidade,
                    id,
                    posto: view ?? posto,
                  },
                  {
                    summary: `Posto ${id} atualizado com sucesso. Prefira \`salvar_posto_setor\` para futuras mudanças de posto.`,
                    meta: {
                      tool_kind: 'action',
                      action: 'update',
                      entidade,
                      id,
                      campos_atualizados: Object.keys(dados),
                    }
                  }
                )
            } catch (e: any) {
                return toolError(
                  'ATUALIZAR_POSTO_FALHOU',
                  `Erro ao atualizar posto: ${e.message}`,
                  {
                    correction: 'Revise setor, contrato e titular. O titular deve pertencer ao mesmo setor.',
                    meta: { entidade, id, campos_atualizados: Object.keys(dados) }
                  }
                )
            }
        }

        const sets = Object.keys(dados).map((k: string) => `${k} = ?`).join(', ')
        const values = [...Object.values(dados), id]

        try {
            const res = await execute(`UPDATE ${entidade} SET ${sets} WHERE id = ?`, ...values)
            return toolOk(
              {
                sucesso: true,
                entidade,
                id,
                changes: res.changes,
              },
              {
                summary: `Registro ${id} de ${entidade} atualizado com sucesso.`,
                meta: {
                  tool_kind: 'action',
                  action: 'update',
                  entidade,
                  id,
                  campos_atualizados: Object.keys(dados),
                }
              }
            )
        } catch (e: any) {
            return toolError(
              'ATUALIZAR_FALHOU',
              e.message,
              {
                correction: 'Revise o ID e os campos enviados em `dados`.',
                meta: { entidade, id, campos_atualizados: Object.keys(dados) }
              }
            )
        }
    }

    if (name === 'deletar') {
        const { entidade, id } = args

        if (!ENTIDADES_DELECAO_PERMITIDAS.has(entidade)) {
            return toolError(
              'DELETAR_ENTIDADE_NAO_PERMITIDA',
              `Deleção não permitida para '${entidade}'.`,
              {
                correction: 'Use `deletar` apenas nas entidades permitidas por IA_TOOLS.',
                meta: { tool_kind: 'action', action: 'delete', entidade, id }
              }
            )
        }

        try {
            if (entidade === 'funcoes') {
                const postoAtual = await queryOne<{ id: number; apelido: string }>(
                  'SELECT id, apelido FROM funcoes WHERE id = ?',
                  id,
                )

                if (!postoAtual) {
                    return toolError(
                      'DELETAR_NAO_ENCONTRADO',
                      `Nenhum registro com id ${id} foi encontrado em '${entidade}'.`,
                      {
                        correction: 'Confirme o ID consultando a entidade antes de deletar.',
                        meta: { tool_kind: 'action', action: 'delete', entidade, id }
                      }
                    )
                }

                await deletarFuncao(id)
                return toolOk(
                  {
                    sucesso: true,
                    entidade,
                    id,
                    changes: 1,
                    posto_removido: postoAtual.apelido,
                  },
                  {
                    summary: `Posto ${postoAtual.apelido} removido com sucesso. O histórico das escalas permanece preservado.`,
                    meta: { tool_kind: 'action', action: 'delete', entidade, id }
                  }
                )
            }

            const res = await execute(`DELETE FROM ${entidade} WHERE id = ?`, id)
            const changes = res.changes

            if (changes === 0) {
                return toolError(
                  'DELETAR_NAO_ENCONTRADO',
                  `Nenhum registro com id ${id} foi encontrado em '${entidade}'.`,
                  {
                    correction: 'Confirme o ID consultando a entidade antes de deletar.',
                    meta: { tool_kind: 'action', action: 'delete', entidade, id }
                  }
                )
            }

            return toolOk(
              {
                sucesso: true,
                entidade,
                id,
                changes,
              },
              {
                summary: `Registro ${id} de ${entidade} deletado com sucesso.`,
                meta: { tool_kind: 'action', action: 'delete', entidade, id }
              }
            )
        } catch (e: any) {
            return toolError(
              'DELETAR_FALHOU',
              e.message,
              {
                correction: 'Verifique se o registro não está referenciado por outras tabelas.',
                meta: { tool_kind: 'action', action: 'delete', entidade, id }
              }
            )
        }
    }

    if (name === 'editar_regra') {
        const { codigo, status } = args

        const validStatuses = ['HARD', 'SOFT', 'OFF', 'ON']
        if (!validStatuses.includes(status)) {
            return toolError(
              'EDITAR_REGRA_STATUS_INVALIDO',
              `Status '${status}' inválido. Use: HARD, SOFT, OFF ou ON.`,
              {
                correction: 'Escolha exatamente um dos valores permitidos: HARD, SOFT, OFF, ON.',
                meta: { tool_kind: 'action', action: 'edit-rule', codigo, status }
              }
            )
        }

        const regra = await queryOne<{ codigo: string; nome: string; editavel: boolean }>('SELECT codigo, nome, editavel FROM regra_definicao WHERE codigo = ?', codigo)
        if (!regra) {
            return toolError(
              'EDITAR_REGRA_NAO_ENCONTRADA',
              `Regra '${codigo}' não encontrada. Use consultar com entidade 'regra_definicao' para ver todas as regras disponíveis.`,
              {
                correction: "Use `consultar` na entidade 'regra_definicao' para localizar o código correto.",
                meta: { tool_kind: 'action', action: 'edit-rule', codigo, status }
              }
            )
        }

        if (!regra.editavel) {
            return toolError(
              'EDITAR_REGRA_NAO_EDITAVEL',
              `Regra '${codigo}' (${regra.nome}) é fixa por lei (CLT/CCT) e não pode ser alterada. Regras editáveis incluem: H1, H6, H10, DIAS_TRABALHO, MIN_DIARIO e todas SOFT/ANTIPATTERN.`,
              {
                correction: 'Edite apenas regras marcadas como editáveis na tabela regra_definicao.',
                meta: { tool_kind: 'action', action: 'edit-rule', codigo, status }
              }
            )
        }

        await execute(`INSERT INTO regra_empresa (codigo, status) VALUES (?, ?) ON CONFLICT(codigo) DO UPDATE SET status = excluded.status`, codigo, status)
        return toolOk(
          {
            sucesso: true,
            codigo,
            regra_nome: regra.nome,
            novo_status: status,
            mensagem: `Regra ${codigo} (${regra.nome}) alterada para ${status}. A próxima geração de escala usará esta configuração.`
          },
          {
            summary: `Regra ${codigo} alterada para ${status}.`,
            meta: {
              tool_kind: 'action',
              action: 'edit-rule',
              codigo,
              regra_nome: regra.nome,
              novo_status: status,
            }
          }
        )
    }

    if (name === 'gerar_escala') {
        const { setor_id, data_inicio, data_fim, solve_mode, rules_override } = args

        try {
            const generationMode = await inferGenerationModeForOverrides(rules_override)
            const solverInput = await buildSolverInput(setor_id, data_inicio, data_fim, undefined, {
                solveMode: solve_mode ?? 'rapido',
                generationMode,
                rulesOverride: rules_override,
            })
            const solverMode = solve_mode ?? 'rapido'
            const timeoutMsByMode: Record<typeof solverMode, number> = {
                rapido: 60_000,
                balanceado: 240_000,
                otimizado: 720_000,
                maximo: 1_920_000,
            }
            const timeoutMs = timeoutMsByMode[solverMode]
            const solverResult = await runSolver(solverInput, timeoutMs)

            if (!solverResult.sucesso || !solverResult.alocacoes || !solverResult.indicadores) {
                return toolError(
                  'GERAR_ESCALA_SOLVER_FALHOU',
                  solverResult.erro?.mensagem ?? `Solver retornou ${solverResult.status}: impossível gerar escala com as restrições atuais.`,
                  {
                    correction: 'Rode `preflight`, revise demanda/equipe/regras e tente novamente.',
                    details: {
                      sucesso: false,
                      solver_status: solverResult.status,
                      diagnostico: solverResult.diagnostico,
                      resumo_user: {
                        mensagem: 'Não foi possível gerar a escala com as restrições atuais. Rode o preflight e revise demanda, equipe e regras.',
                      },
                    },
                    meta: {
                      tool_kind: 'action',
                      action: 'generate-schedule',
                      setor_id,
                      data_inicio,
                      data_fim,
                      solver_status: solverResult.status,
                    }
                  }
                )
            }

            const escalaId = await persistirSolverResult(setor_id, data_inicio, data_fim, solverResult)
            const validacao = await validarEscalaV3(escalaId)
            await persistirResumoAutoritativoEscala(escalaId, validacao)

            // --- Revisão pós-geração: agregar dados que o solver já calcula ---
            const deficits = (validacao.comparacao_demanda ?? [])
                .filter(s => s.delta < 0)
                .sort((a, b) => a.delta - b.delta)
                .slice(0, 10)
                .map(s => ({
                    data: s.data,
                    faixa: `${s.hora_inicio}-${s.hora_fim}`,
                    faltam: Math.abs(s.delta),
                    tem: s.executado,
                    precisa: s.planejado,
                }))

            const alocacoes = solverResult.alocacoes ?? []
            const cargaPorColab: Record<number, { nome: string; dias: number; minutos: number }> = {}
            for (const a of alocacoes) {
                if (a.status !== 'TRABALHO') continue
                if (!cargaPorColab[a.colaborador_id]) {
                    const dec = (solverResult.decisoes ?? []).find(d => d.colaborador_id === a.colaborador_id)
                    cargaPorColab[a.colaborador_id] = {
                        nome: dec?.colaborador_nome ?? `#${a.colaborador_id}`,
                        dias: 0,
                        minutos: 0,
                    }
                }
                cargaPorColab[a.colaborador_id].dias++
                cargaPorColab[a.colaborador_id].minutos += a.minutos_trabalho
            }
            const carga = Object.values(cargaPorColab).map(c => ({
                ...c,
                horas: +(c.minutos / 60).toFixed(1),
            }))

            const revisao = {
                piores_deficits: deficits,
                carga_colaboradores: carga,
                total_alocacoes: alocacoes.length,
                dias_periodo: new Set(alocacoes.map(a => a.data)).size,
            }

            const ind = validacao.indicadores
            if (!ind) {
              return toolError(
                'GERAR_ESCALA_VALIDACAO_SEM_INDICADORES',
                `Escala ${escalaId} foi gerada, mas a validação autoritativa não retornou indicadores.`,
                {
                  correction: 'Tente diagnosticar a escala recém-gerada para recalcular os indicadores.',
                  meta: { tool_kind: 'action', action: 'generate-schedule', escala_id: escalaId }
                }
              )
            }
            const coberturaResumo = textoResumoCobertura(ind.cobertura_percent, ind.cobertura_efetiva_percent ?? ind.cobertura_percent)
            const resumo_user = {
                cobertura: coberturaResumo.principal,
                ...(coberturaResumo.secundaria ? { cobertura_secundaria: coberturaResumo.secundaria } : {}),
                problemas_oficializar: textoResumoViolacoesHard(ind.violacoes_hard),
                avisos: textoResumoViolacoesSoft(ind.violacoes_soft),
                qualidade: ind.pontuacao,
            }

            return toolOk(
              {
                sucesso: true,
                escala_id: escalaId,
                solver_status: solverResult.status,
                indicadores: ind,
                violacoes_hard: ind.violacoes_hard,
                violacoes_soft: ind.violacoes_soft,
                cobertura_percent: ind.cobertura_percent,
                pontuacao: ind.pontuacao,
                diagnostico: solverResult.diagnostico,
                revisao,
                resumo_user,
              },
              {
                summary: `Escala ${escalaId} gerada para setor ${setor_id} (${data_inicio} até ${data_fim}). Solver: ${solverResult.status}.`,
                meta: {
                  tool_kind: 'action',
                  action: 'generate-schedule',
                  setor_id,
                  data_inicio,
                  data_fim,
                  generation_mode: generationMode,
                  solver_status: solverResult.status,
                }
              }
            )
        } catch (e: any) {
            return toolError(
              'GERAR_ESCALA_FALHOU',
              e.message,
              {
                correction: 'Verifique os parâmetros da geração e a disponibilidade do solver.',
                details: {
                  sucesso: false,
                  resumo_user: {
                    mensagem: 'Não foi possível gerar a escala. Verifique os parâmetros e tente novamente.',
                  },
                },
                meta: { tool_kind: 'action', action: 'generate-schedule', setor_id, data_inicio, data_fim }
              }
            )
        }
    }

    if (name === 'ajustar_alocacao') {
        const { escala_id, colaborador_id, data, status } = args

        const statusValidos = ['TRABALHO', 'FOLGA', 'INDISPONIVEL']
        if (!statusValidos.includes(status)) {
            return toolError(
              'AJUSTAR_ALOCACAO_STATUS_INVALIDO',
              `Status '${status}' inválido. Use: TRABALHO | FOLGA | INDISPONIVEL`,
              {
                correction: 'Escolha exatamente um status entre TRABALHO, FOLGA ou INDISPONIVEL.',
                meta: { tool_kind: 'action', action: 'adjust-allocation', escala_id, colaborador_id, data, status }
              }
            )
        }

        const existing = await queryOne<{ id: number }>(
            'SELECT id FROM alocacoes WHERE escala_id = ? AND colaborador_id = ? AND data = ?',
            escala_id, colaborador_id, data
        )

        if (!existing) {
            return toolError(
              'AJUSTAR_ALOCACAO_NAO_ENCONTRADA',
              `Alocação não encontrada para escala ${escala_id}, colaborador ${colaborador_id}, data ${data}.`,
              {
                correction: 'Confirme a escala, colaborador e data com `consultar` em alocacoes antes de ajustar.',
                meta: { tool_kind: 'action', action: 'adjust-allocation', escala_id, colaborador_id, data, status }
              }
            )
        }

        try {
            await execute(
                'UPDATE alocacoes SET status = ? WHERE escala_id = ? AND colaborador_id = ? AND data = ?',
                status, escala_id, colaborador_id, data
            )
            return toolOk(
              {
                sucesso: true,
                escala_id,
                colaborador_id,
                data,
                novo_status: status,
                mensagem: `Alocação ajustada: colaborador ${colaborador_id} em ${data} → ${status}. Regenere a escala para que o motor respeite este ajuste.`
              },
              {
                summary: `Alocação ajustada para ${status} (colaborador ${colaborador_id}, ${data}).`,
                meta: {
                  tool_kind: 'action',
                  action: 'adjust-allocation',
                  escala_id,
                  colaborador_id,
                  data,
                  novo_status: status,
                }
              }
            )
        } catch (e: any) {
            return toolError(
              'AJUSTAR_ALOCACAO_FALHOU',
              e.message,
              {
                correction: 'Tente novamente e valide se a alocação ainda existe.',
                meta: { tool_kind: 'action', action: 'adjust-allocation', escala_id, colaborador_id, data, status }
              }
            )
        }
    }

    if (name === 'ajustar_horario') {
        const { escala_id, colaborador_id, data, hora_inicio, hora_fim } = args
        const status = (args.status ?? 'TRABALHO') as 'TRABALHO' | 'FOLGA' | 'INDISPONIVEL'

        if (!HORA_HHMM_REGEX.test(hora_inicio) || !HORA_HHMM_REGEX.test(hora_fim)) {
            return toolError(
              'AJUSTAR_HORARIO_FORMATO_INVALIDO',
              'Horários inválidos. Use o formato HH:MM para `hora_inicio` e `hora_fim`.',
              {
                correction: 'Exemplo: `hora_inicio: "08:00", hora_fim: "16:20"`.',
                meta: { tool_kind: 'action', action: 'adjust-shift-time', escala_id, colaborador_id, data }
              }
            )
        }

        const minutos = minutesBetweenTimes(hora_inicio, hora_fim)
        if (minutos <= 0) {
            return toolError(
              'AJUSTAR_HORARIO_INTERVALO_INVALIDO',
              `Intervalo inválido: ${hora_inicio} → ${hora_fim}. O fim deve ser maior que o início no mesmo dia.`,
              {
                correction: 'Informe um intervalo positivo (mesmo dia) com `hora_fim` maior que `hora_inicio`.',
                meta: { tool_kind: 'action', action: 'adjust-shift-time', escala_id, colaborador_id, data }
              }
            )
        }

        const existing = await queryOne<Record<string, any>>(
          'SELECT id, status, hora_inicio, hora_fim FROM alocacoes WHERE escala_id = ? AND colaborador_id = ? AND data = ?',
          escala_id, colaborador_id, data
        )

        if (!existing) {
          return toolError(
            'AJUSTAR_HORARIO_ALOCACAO_NAO_ENCONTRADA',
            `Alocação não encontrada para escala ${escala_id}, colaborador ${colaborador_id}, data ${data}.`,
            {
              correction: 'Confirme a célula com `consultar("alocacoes")` (e, se necessário, `consultar("escalas")`) antes de ajustar horário.',
              meta: { tool_kind: 'action', action: 'adjust-shift-time', escala_id, colaborador_id, data }
            }
          )
        }

        try {
          await execute(
            'UPDATE alocacoes SET status = ?, hora_inicio = ?, hora_fim = ?, minutos = ? WHERE escala_id = ? AND colaborador_id = ? AND data = ?',
            status, hora_inicio, hora_fim, minutos, escala_id, colaborador_id, data
          )

          return toolOk(
            {
              sucesso: true,
              escala_id,
              colaborador_id,
              data,
              novo_status: status,
              hora_inicio,
              hora_fim,
              minutos,
              mensagem: `Horário ajustado para ${hora_inicio}-${hora_fim} (${minutos} min) na escala ${escala_id}.`,
            },
            {
              summary: `Horário ajustado (${hora_inicio}-${hora_fim}) para colaborador ${colaborador_id} em ${data}.`,
              meta: {
                tool_kind: 'action',
                action: 'adjust-shift-time',
                escala_id,
                colaborador_id,
                data,
                minutos,
                next_tools_hint: ['diagnosticar_escala', 'oficializar_escala'],
              }
            }
          )
        } catch (e: any) {
          return toolError(
            'AJUSTAR_HORARIO_FALHOU',
            e.message,
            {
              correction: 'Tente novamente. Se persistir, confirme se a escala/alocação ainda existe.',
              meta: { tool_kind: 'action', action: 'adjust-shift-time', escala_id, colaborador_id, data }
            }
          )
        }
    }

    if (name === 'oficializar_escala') {
        const { escala_id } = args

        const escala = await queryOne<{ id: number; status: string; violacoes_hard: number }>('SELECT id, status, violacoes_hard FROM escalas WHERE id = ?', escala_id)
        if (!escala) {
            return toolError(
              'OFICIALIZAR_ESCALA_NAO_ENCONTRADA',
              `Escala ${escala_id} não encontrada.`,
              {
                correction: 'Consulte as escalas existentes e use um `escala_id` válido.',
                meta: { tool_kind: 'action', action: 'officialize-schedule', escala_id }
              }
            )
        }
        if (escala.status === 'OFICIAL') {
            return toolOk(
              {
                sucesso: true,
                escala_id,
                ja_estava_oficial: true,
                aviso: `Escala ${escala_id} já está OFICIAL.`
              },
              {
                summary: `Escala ${escala_id} já estava OFICIAL.`,
                meta: { tool_kind: 'action', action: 'officialize-schedule', escala_id, noop: true }
              }
            )
        }
        if (escala.violacoes_hard > 0) {
            return toolError(
              'OFICIALIZAR_ESCALA_COM_VIOLACAO_HARD',
              `Não é possível oficializar: a escala tem ${escala.violacoes_hard} violação(ões) HARD. Corrija as violações antes de oficializar.`,
              {
                correction: 'Corrija as violações HARD antes de oficializar a escala.',
                details: { violacoes_hard: escala.violacoes_hard },
                meta: { tool_kind: 'action', action: 'officialize-schedule', escala_id }
              }
            )
        }

        await execute("UPDATE escalas SET status = 'OFICIAL' WHERE id = ?", escala_id)
        return toolOk(
          {
            sucesso: true,
            escala_id,
            mensagem: `Escala ${escala_id} oficializada com sucesso. Ela está travada definitivamente.`
          },
          {
            summary: `Escala ${escala_id} oficializada com sucesso.`,
            meta: { tool_kind: 'action', action: 'officialize-schedule', escala_id }
          }
        )
    }

    if (name === 'preflight') {
        try {
            const { setor_id, data_inicio, data_fim } = args
            const blockers: Array<{ codigo: string; severidade: string; mensagem: string; detalhe?: string }> = []
            const warnings: Array<{ codigo: string; severidade: string; mensagem: string; detalhe?: string }> = []

            const setor = await queryOne<{ id: number; ativo: boolean }>('SELECT id, ativo FROM setores WHERE id = ?', setor_id)
            if (!setor || !setor.ativo) {
                blockers.push({
                    codigo: 'SETOR_INVALIDO',
                    severidade: 'BLOCKER',
                    mensagem: `Setor ${setor_id} não encontrado ou inativo.`
                })
            }

            const colabsAtivos = (
                await queryOne<{ count: number }>('SELECT COUNT(*)::int as count FROM colaboradores WHERE setor_id = ? AND ativo = true', setor_id)
            )!.count
            if (colabsAtivos === 0) {
                blockers.push({
                    codigo: 'SEM_COLABORADORES',
                    severidade: 'BLOCKER',
                    mensagem: 'Setor não tem colaboradores ativos.',
                    detalhe: 'Cadastre ao menos 1 colaborador para gerar escala.'
                })
            }

            const demandasCount = (
                await queryOne<{ count: number }>('SELECT COUNT(*)::int as count FROM demandas WHERE setor_id = ?', setor_id)
            )!.count
            if (demandasCount === 0) {
                warnings.push({
                    codigo: 'SEM_DEMANDA',
                    severidade: 'WARNING',
                    mensagem: 'Setor sem demanda planejada cadastrada.',
                    detalhe: 'O motor vai considerar demanda zero — todos os slots serão de livre distribuição.'
                })
            }

            const feriadosNoPeriodo = (
                await queryOne<{ count: number }>('SELECT COUNT(*)::int as count FROM feriados WHERE data BETWEEN ? AND ?', data_inicio, data_fim)
            )!.count

            const ok = blockers.length === 0
            return toolOk({
                ok,
                blockers,
                warnings,
                diagnostico: {
                    setor_id,
                    data_inicio,
                    data_fim,
                    colaboradores_ativos: colabsAtivos,
                    demandas_cadastradas: demandasCount,
                    feriados_no_periodo: feriadosNoPeriodo,
                },
            }, {
                summary: ok
                  ? `Preflight OK para setor ${setor_id}. ${warnings.length} warning(s), 0 blocker(s).`
                  : `Preflight encontrou ${blockers.length} blocker(s) e ${warnings.length} warning(s) para o setor ${setor_id}.`,
                meta: {
                  tool_kind: 'validation',
                  can_proceed_to: ok ? ['gerar_escala'] : [],
                  blockers_count: blockers.length,
                  warnings_count: warnings.length,
                }
            })
        } catch (e: any) {
            return toolError(
              'PREFLIGHT_FAILED',
              `Erro ao executar preflight: ${e.message}`,
              {
                correction: 'Verifique se o setor_id e o período estão corretos e tente novamente.',
                meta: { tool_kind: 'validation', next_tools_hint: ['consultar'] }
              }
            )
        }
    }

    if (name === 'preflight_completo') {
        try {
            const { setor_id, data_inicio, data_fim } = args
            const regimesOverride = normalizeRegimesOverride(args.regimes_override as any[] | undefined)

            const base = await executeTool('preflight', { setor_id, data_inicio, data_fim })
            if (base?.status === 'error') {
              return {
                ...base,
                _meta: {
                  ...(base?._meta ?? {}),
                  semantic_wrapper: 'preflight_completo',
                },
              }
            }

            const blockers = Array.isArray(base?.blockers) ? [...base.blockers] : []
            const warnings = Array.isArray(base?.warnings) ? [...base.warnings] : []

            if (base?.ok !== false) {
              try {
                const solverInput = await buildSolverInput(setor_id, data_inicio, data_fim, undefined, {
                  regimesOverride,
                })
                enrichPreflightWithCapacityChecks(solverInput as any, blockers as any, warnings as any, {
                  collectiveCode: 'CAPACIDADE_COLETIVA_INSUFICIENTE',
                  collectiveMessageMode: 'coletiva',
                  addNoBlockersWarning: true,
                })
              } catch (err: any) {
                warnings.push({
                  codigo: 'PREFLIGHT_COMPLETO_DIAGNOSTICO_INDISPONIVEL',
                  severidade: 'WARNING',
                  mensagem: 'Não foi possível executar checks completos de capacidade.',
                  detalhe: err?.message ?? String(err),
                })
              }
            }

            const ok = blockers.length === 0
            const diagnostico = {
              ...(base?.diagnostico ?? {}),
              demanda_zero_fallback: (base?.diagnostico?.demandas_cadastradas ?? 0) === 0,
              checks_capacidade_executados: base?.ok !== false,
              regimes_override_count: regimesOverride.length,
            }

            return toolOk(
              {
                ok,
                blockers,
                warnings,
                diagnostico,
              },
              {
                summary: ok
                  ? `Preflight completo OK para setor ${setor_id}. ${warnings.length} warning(s), 0 blocker(s).`
                  : `Preflight completo encontrou ${blockers.length} blocker(s) e ${warnings.length} warning(s) para o setor ${setor_id}.`,
                meta: {
                  tool_kind: 'validation',
                  validation_level: 'completo',
                  can_proceed_to: ok ? ['gerar_escala'] : [],
                  blockers_count: blockers.length,
                  warnings_count: warnings.length,
                  regimes_override_count: regimesOverride.length,
                }
              }
            )
        } catch (e: any) {
            return toolError(
              'PREFLIGHT_COMPLETO_FAILED',
              `Erro ao executar preflight completo: ${e.message}`,
              {
                correction: 'Verifique setor_id, período e overrides. Se necessário, rode `preflight` simples primeiro.',
                meta: { tool_kind: 'validation', validation_level: 'completo', next_tools_hint: ['preflight', 'consultar'] }
              }
            )
        }
    }

    if (name === 'cadastrar_lote') {
        const { entidade, registros } = args

        if (!ENTIDADES_CRIACAO_PERMITIDAS.has(entidade)) {
            return toolError(
              'CADASTRAR_LOTE_ENTIDADE_NAO_PERMITIDA',
              `❌ Criação em lote não permitida para '${entidade}'. Entidades permitidas: ${[...ENTIDADES_CRIACAO_PERMITIDAS].join(', ')}`,
              {
                correction: 'Escolha uma entidade permitida para cadastro em lote.',
                meta: { entidade_solicitada: entidade, entidades_permitidas: [...ENTIDADES_CRIACAO_PERMITIDAS] }
              }
            )
        }

        // Cache de setores pra não buscar N vezes
        const setorCache: Record<number, { id: number; nome: string; hora_abertura: string; hora_fechamento: string } | null> = {}
        async function getSetor(setorId: number) {
            if (!(setorId in setorCache)) {
                setorCache[setorId] = await queryOne<{ id: number; nome: string; hora_abertura: string; hora_fechamento: string }>(
                    'SELECT id, nome, hora_abertura, hora_fechamento FROM setores WHERE id = ? AND ativo = true', setorId
                ) ?? null
            }
            return setorCache[setorId]
        }

        // Validação prévia completa (sem INSERT)
        const validados: Array<{ dados: Record<string, any>; indice: number }> = []
        for (let i = 0; i < registros.length; i++) {
            const dados = { ...registros[i] }

            if (entidade === 'colaboradores') {
                if (!dados.nome || typeof dados.nome !== 'string') {
                    return toolError(
                      'CADASTRAR_LOTE_VALIDACAO_FALHOU',
                      `Registro ${i + 1}: nome obrigatorio.`,
                      {
                        correction: 'Corrija o campo `nome` e tente novamente.',
                        details: { entidade, indice: i, erro: 'nome obrigatorio' },
                        meta: { tool_kind: 'action', action: 'batch-create', entidade, atomic: true },
                      },
                    )
                }
                if (!dados.setor_id || typeof dados.setor_id !== 'number') {
                    return toolError(
                      'CADASTRAR_LOTE_VALIDACAO_FALHOU',
                      `Registro ${i + 1}: setor_id obrigatorio.`,
                      {
                        correction: 'Informe `setor_id` valido e tente novamente.',
                        details: { entidade, indice: i, erro: 'setor_id obrigatorio' },
                        meta: { tool_kind: 'action', action: 'batch-create', entidade, atomic: true },
                      },
                    )
                }

                if (!dados.sexo || (dados.sexo !== 'M' && dados.sexo !== 'F')) {
                    return toolError(
                      'CADASTRAR_LOTE_VALIDACAO_FALHOU',
                      `Registro ${i + 1}: sexo obrigatorio (M/F) para "${dados.nome}".`,
                      {
                        correction: 'Use `sexo` = "M" ou "F".',
                        details: { entidade, indice: i, erro: 'sexo obrigatorio (M/F)' },
                        meta: { tool_kind: 'action', action: 'batch-create', entidade, atomic: true },
                      },
                    )
                }

                const setor = await getSetor(dados.setor_id)
                if (!setor) {
                    return toolError(
                      'CADASTRAR_LOTE_VALIDACAO_FALHOU',
                      `Registro ${i + 1}: setor_id ${dados.setor_id} nao encontrado.`,
                      {
                        correction: 'Use um setor ativo valido.',
                        details: { entidade, indice: i, erro: `setor_id ${dados.setor_id} nao encontrado` },
                        meta: { tool_kind: 'action', action: 'batch-create', entidade, atomic: true },
                      },
                    )
                }

                await applyColaboradorDefaults(dados, setor)
                if (!dados.horas_semanais) {
                    const contrato = await queryOne<{ horas_semanais: number }>('SELECT horas_semanais FROM tipos_contrato WHERE id = ?', dados.tipo_contrato_id)
                    dados.horas_semanais = contrato?.horas_semanais ?? 44
                }
            }

            if (entidade === 'excecoes') {
                if (!dados.colaborador_id || !dados.tipo || !dados.data_inicio || !dados.data_fim) {
                    return toolError(
                      'CADASTRAR_LOTE_VALIDACAO_FALHOU',
                      `Registro ${i + 1}: campos obrigatorios ausentes em excecoes.`,
                      {
                        correction: 'Informe colaborador_id, tipo, data_inicio e data_fim.',
                        details: { entidade, indice: i, erro: 'campos obrigatorios ausentes em excecoes' },
                        meta: { tool_kind: 'action', action: 'batch-create', entidade, atomic: true },
                      },
                    )
                }
                if (!dados.observacao) dados.observacao = dados.tipo
            }

            validados.push({ dados, indice: i })
        }

        const idsCriados: number[] = []
        try {
            await transaction(async () => {
              for (const { dados, indice } of validados) {
                  const keys = Object.keys(dados)
                  const placeholders = keys.map(() => '?').join(', ')
                  const values = Object.values(dados)
                  let newId: number
                  try {
                    newId = await insertReturningId(
                      `INSERT INTO ${entidade} (${keys.join(', ')}) VALUES (${placeholders})`, ...values,
                    )
                  } catch (insertErr: any) {
                    const enriched = new Error(insertErr?.message ?? 'Falha de insert')
                    ;(enriched as Error & { indice?: number }).indice = indice
                    throw enriched
                  }
                  idsCriados.push(newId)
              }
            })
        } catch (e: any) {
            const indiceFalha = typeof e?.indice === 'number' ? e.indice : null
            return toolError(
              'CADASTRAR_LOTE_ATOMICO_FALHOU',
              `Cadastro em lote abortado para '${entidade}'. Nenhum registro foi persistido.`,
              {
                correction: 'Corrija o registro inválido e execute novamente.',
                details: {
                  entidade,
                  total_enviado: registros.length,
                  total_criado: 0,
                  total_erros: 1,
                  indice_primeira_falha: indiceFalha,
                  causa_erro: e?.message ?? 'Falha desconhecida',
                },
                meta: {
                  tool_kind: 'action',
                  action: 'batch-create',
                  entidade,
                  atomic: true,
                },
              },
            )
        }

        return toolOk(
          {
            sucesso: true,
            entidade,
            total_enviado: registros.length,
            total_criado: idsCriados.length,
            total_erros: 0,
            ids_criados: idsCriados,
          },
          {
            summary: `Cadastro em lote concluido em ${entidade}: ${idsCriados.length}/${registros.length} registro(s) criados.`,
            meta: {
              tool_kind: 'action',
              action: 'batch-create',
              entidade,
              atomic: true,
              partial_failure: false,
            },
          },
        )
    }

    if (name === 'salvar_regra_horario_colaborador') {
        const {
          colaborador_id,
          dia_semana_regra,
          ativo,
          perfil_horario_id,
          inicio,
          fim,
          preferencia_turno_soft,
          domingo_ciclo_trabalho,
          domingo_ciclo_folga,
          folga_fixa_dia_semana,
          folga_variavel_dia_semana,
        } = args

        const diaSemana = dia_semana_regra ?? null
        const isDiaEspecifico = diaSemana !== null

        const colab = await queryOne<{ id: number; nome: string; setor_id: number; ativo: boolean }>('SELECT id, nome, setor_id, ativo FROM colaboradores WHERE id = ?', colaborador_id)

        if (!colab) {
          return toolError(
            'SALVAR_REGRA_HORARIO_COLABORADOR_NAO_ENCONTRADO',
            `Colaborador ${colaborador_id} não encontrado.`,
            {
              correction: 'Resolva um colaborador válido com `buscar_colaborador` e tente novamente.',
              meta: { tool_kind: 'action', action: 'save-collaborator-rule', colaborador_id }
            }
          )
        }

        // Validar formato HH:MM
        for (const [label, value] of [['inicio', inicio], ['fim', fim]] as const) {
          if (value !== undefined && value !== null && (typeof value !== 'string' || !HORA_HHMM_REGEX.test(value))) {
            return toolError(
              'SALVAR_REGRA_HORARIO_COLABORADOR_HORA_INVALIDA',
              `Campo ${label} inválido: use HH:MM.`,
              {
                correction: `Corrija ${label} para o formato HH:MM ou envie null para limpar o campo.`,
                meta: { tool_kind: 'action', action: 'save-collaborator-rule', colaborador_id, campo: label }
              }
            )
          }
        }

        try {
          // Buscar existente com match exato de dia_semana_regra (NULL-safe)
          const existe = diaSemana === null
            ? await queryOne<{
              id: number
              ativo: boolean
              perfil_horario_id: number | null
              inicio: string | null
              fim: string | null
              preferencia_turno_soft: string | null
              domingo_ciclo_trabalho: number
              domingo_ciclo_folga: number
              folga_fixa_dia_semana: string | null
              folga_variavel_dia_semana: string | null
            }>('SELECT * FROM colaborador_regra_horario WHERE colaborador_id = ? AND dia_semana_regra IS NULL', colaborador_id)
            : await queryOne<{
              id: number
              ativo: boolean
              perfil_horario_id: number | null
              inicio: string | null
              fim: string | null
              preferencia_turno_soft: string | null
              domingo_ciclo_trabalho: number
              domingo_ciclo_folga: number
              folga_fixa_dia_semana: string | null
              folga_variavel_dia_semana: string | null
            }>('SELECT * FROM colaborador_regra_horario WHERE colaborador_id = ? AND dia_semana_regra = ?', colaborador_id, diaSemana)

          const nextAtivo = ativo !== undefined
            ? ativo
            : (existe?.ativo ?? true)
          const nextPerfilHorarioId = hasOwnField(args, 'perfil_horario_id')
            ? (perfil_horario_id ?? null)
            : (existe?.perfil_horario_id ?? null)
          const nextInicio = hasOwnField(args, 'inicio')
            ? (inicio ?? null)
            : (existe?.inicio ?? null)
          const nextFim = hasOwnField(args, 'fim')
            ? (fim ?? null)
            : (existe?.fim ?? null)
          const nextPreferenciaTurnoSoft = hasOwnField(args, 'preferencia_turno_soft')
            ? (preferencia_turno_soft ?? null)
            : (existe?.preferencia_turno_soft ?? null)

          // Regras de dia específico não carregam campos de ciclo/folga no schema.
          const domCicloTrabalho = isDiaEspecifico
            ? 2
            : (hasOwnField(args, 'domingo_ciclo_trabalho')
                ? (domingo_ciclo_trabalho ?? 2)
                : (existe?.domingo_ciclo_trabalho ?? 2))
          const domCicloFolga = isDiaEspecifico
            ? 1
            : (hasOwnField(args, 'domingo_ciclo_folga')
                ? (domingo_ciclo_folga ?? 1)
                : (existe?.domingo_ciclo_folga ?? 1))
          const folgaFixa = isDiaEspecifico
            ? null
            : (hasOwnField(args, 'folga_fixa_dia_semana')
                ? (folga_fixa_dia_semana ?? null)
                : (existe?.folga_fixa_dia_semana ?? null))
          const folgaVariavel = isDiaEspecifico
            ? null
            : (hasOwnField(args, 'folga_variavel_dia_semana')
                ? (folga_variavel_dia_semana ?? null)
                : (existe?.folga_variavel_dia_semana ?? null))

          if (existe) {
            await execute(`
              UPDATE colaborador_regra_horario SET
                ativo = ?,
                perfil_horario_id = ?,
                inicio = ?, fim = ?,
                preferencia_turno_soft = ?,
                domingo_ciclo_trabalho = ?,
                domingo_ciclo_folga = ?,
                folga_fixa_dia_semana = ?,
                folga_variavel_dia_semana = ?
              WHERE id = ?
            `,
              nextAtivo,
              nextPerfilHorarioId,
              nextInicio,
              nextFim,
              nextPreferenciaTurnoSoft,
              domCicloTrabalho,
              domCicloFolga,
              folgaFixa,
              folgaVariavel,
              existe.id,
            )
          } else {
            await execute(`
              INSERT INTO colaborador_regra_horario
                (colaborador_id, dia_semana_regra, ativo, perfil_horario_id, inicio, fim, preferencia_turno_soft, domingo_ciclo_trabalho, domingo_ciclo_folga, folga_fixa_dia_semana, folga_variavel_dia_semana)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `,
              colaborador_id,
              diaSemana,
              nextAtivo,
              nextPerfilHorarioId,
              nextInicio,
              nextFim,
              nextPreferenciaTurnoSoft,
              domCicloTrabalho,
              domCicloFolga,
              folgaFixa,
              folgaVariavel,
            )
          }

          const regra = diaSemana === null
            ? await queryOne<Record<string, any>>('SELECT * FROM colaborador_regra_horario WHERE colaborador_id = ? AND dia_semana_regra IS NULL', colaborador_id)
            : await queryOne<Record<string, any>>('SELECT * FROM colaborador_regra_horario WHERE colaborador_id = ? AND dia_semana_regra = ?', colaborador_id, diaSemana)
          return toolOk(
            {
              sucesso: true,
              colaborador: { id: colab.id, nome: colab.nome, setor_id: colab.setor_id, ativo: colab.ativo },
              regra,
            },
            {
              summary: `Regra de horário salva para ${colab.nome} (id ${colab.id}).`,
              meta: {
                tool_kind: 'action',
                action: 'save-collaborator-rule',
                colaborador_id: colab.id,
                ids_usaveis_em: ['buscar_colaborador', 'salvar_regra_horario_colaborador', 'gerar_escala', 'preflight_completo'],
              }
            }
          )
        } catch (e: any) {
          return toolError(
            'SALVAR_REGRA_HORARIO_COLABORADOR_FALHOU',
            `Erro ao salvar regra de horário do colaborador: ${e.message}`,
            {
              correction: 'Revise os campos enviados (janela, ciclo e folga fixa) e tente novamente.',
              meta: { tool_kind: 'action', action: 'save-collaborator-rule', colaborador_id }
            }
          )
        }
    }

    if (name === 'explicar_violacao') {
        const { codigo_regra } = args
        const explicacao = DICIONARIO_VIOLACOES[codigo_regra]
        if (explicacao) {
            return toolOk(
              { codigo: codigo_regra, explicacao },
              {
                summary: `Explicação da regra ${codigo_regra}.`,
                meta: { tool_kind: 'reference', source: 'violations-dictionary', codigo_regra, encontrada: true }
              }
            )
        }
        const regra = await queryOne<{ nome: string; descricao: string }>('SELECT nome, descricao FROM regra_definicao WHERE codigo = ?', codigo_regra)
        if (regra) {
            return toolOk(
              { codigo: codigo_regra, explicacao: `${regra.nome}: ${regra.descricao}` },
              {
                summary: `Explicação da regra ${codigo_regra} obtida da tabela regra_definicao.`,
                meta: { tool_kind: 'reference', source: 'regra_definicao', codigo_regra, encontrada: true }
              }
            )
        }
        return toolOk(
          {
            codigo: codigo_regra,
            explicacao: 'Regra não encontrada no dicionário. Consulte o MOTOR_V3_RFC.md para a lista completa de regras CLT/CCT aplicáveis.'
          },
          {
            summary: `Regra ${codigo_regra} não foi encontrada no dicionário local.`,
            meta: { tool_kind: 'reference', source: 'fallback', codigo_regra, encontrada: false }
          }
        )
    }

    if (name === 'salvar_demanda_excecao_data') {
        try {
            const { setor_id, data, hora_inicio, hora_fim, min_pessoas } = args
            const override = args.override ?? false

            const setor = await queryOne<{ id: number; nome: string }>('SELECT id, nome FROM setores WHERE id = ? AND ativo = true', setor_id)
            if (!setor) {
                return toolError(
                  'SALVAR_DEMANDA_EXCECAO_SETOR_INVALIDO',
                  `Setor ${setor_id} não encontrado ou inativo.`,
                  {
                    correction: 'Use o contexto automático ou consultar("setores") para resolver o setor_id correto.',
                    meta: { tool_kind: 'action', action: 'create-demand-exception', setor_id }
                  }
                )
            }

            if (minutesBetweenTimes(hora_inicio, hora_fim) <= 0) {
                return toolError(
                  'SALVAR_DEMANDA_EXCECAO_FAIXA_INVALIDA',
                  `Faixa inválida: ${hora_inicio} → ${hora_fim}. O fim deve ser maior que o início.`,
                  {
                    correction: 'Corrija hora_inicio/hora_fim para uma faixa válida.',
                    meta: { tool_kind: 'action', action: 'create-demand-exception', setor_id }
                  }
                )
            }

            // Check total colaboradores do setor para warning de viabilidade
            const totalColabs = await queryOne<{ total: number }>(
              'SELECT COUNT(*) as total FROM colaboradores WHERE setor_id = ? AND ativo = true', setor_id
            )
            const totalNoSetor = totalColabs?.total ?? 0
            const avisoCapacidade = min_pessoas > totalNoSetor
              ? `⚠️ ATENÇÃO: min_pessoas (${min_pessoas}) excede o total de colaboradores ativos no setor (${totalNoSetor}). O motor pode retornar INFEASIBLE.`
              : undefined

            const newId = await insertReturningId(
              'INSERT INTO demandas_excecao_data (setor_id, data, hora_inicio, hora_fim, min_pessoas, override) VALUES (?, ?, ?, ?, ?, ?)',
              setor_id, data, hora_inicio, hora_fim, min_pessoas, override
            )

            const registro = await queryOne<Record<string, any>>('SELECT * FROM demandas_excecao_data WHERE id = ?', newId)

            return toolOk(
              {
                sucesso: true,
                setor: { id: setor.id, nome: setor.nome },
                total_colaboradores_setor: totalNoSetor,
                ...(avisoCapacidade ? { aviso_capacidade: avisoCapacidade } : {}),
                registro,
              },
              {
                summary: `Demanda excepcional criada para ${setor.nome} em ${data}: ${min_pessoas} pessoa(s) das ${hora_inicio} às ${hora_fim}.${avisoCapacidade ? ` ${avisoCapacidade}` : ''}`,
                meta: {
                  tool_kind: 'action',
                  action: 'create-demand-exception',
                  next_tools_hint: ['preflight', 'gerar_escala'],
                }
              }
            )
        } catch (e: any) {
            return toolError(
              'SALVAR_DEMANDA_EXCECAO_FALHOU',
              `Erro ao salvar demanda excepcional: ${e.message}`,
              {
                correction: 'Revise os campos e tente novamente.',
                meta: { tool_kind: 'action', action: 'create-demand-exception' }
              }
            )
        }
    }

    if (name === 'upsert_regra_excecao_data') {
        try {
            const { colaborador_id, data } = args

            const colab = await queryOne<{ id: number; nome: string; setor_id: number }>('SELECT id, nome, setor_id FROM colaboradores WHERE id = ?', colaborador_id)
            if (!colab) {
                return toolError(
                  'UPSERT_REGRA_EXCECAO_COLAB_NAO_ENCONTRADO',
                  `Colaborador ${colaborador_id} não encontrado.`,
                  {
                    correction: 'Resolva o colaborador via buscar_colaborador ou consultar.',
                    meta: { tool_kind: 'action', action: 'upsert-date-exception-rule', colaborador_id }
                  }
                )
            }

            const timeFields = ['inicio', 'fim'] as const
            for (const field of timeFields) {
                const val = args[field]
                if (val !== undefined && val !== null && (typeof val !== 'string' || !HORA_HHMM_REGEX.test(val))) {
                    return toolError(
                      'UPSERT_REGRA_EXCECAO_HORA_INVALIDA',
                      `Campo ${field} inválido: use HH:MM ou null.`,
                      {
                        correction: `Corrija ${field} para o formato HH:MM ou envie null.`,
                        meta: { tool_kind: 'action', action: 'upsert-date-exception-rule', colaborador_id, campo: field }
                      }
                    )
                }
            }

            const existing = await queryOne<{ id: number }>(
              'SELECT id FROM colaborador_regra_horario_excecao_data WHERE colaborador_id = ? AND data = ?',
              colaborador_id, data
            )

            const ativo = args.ativo !== false
            const domingo_forcar_folga = args.domingo_forcar_folga ?? false

            if (existing) {
                await execute(`
                  UPDATE colaborador_regra_horario_excecao_data SET
                    ativo = ?,
                    inicio = COALESCE(?, inicio),
                    fim = COALESCE(?, fim),
                    preferencia_turno_soft = COALESCE(?, preferencia_turno_soft),
                    domingo_forcar_folga = ?
                  WHERE id = ?
                `,
                  ativo,
                  args.inicio ?? null,
                  args.fim ?? null,
                  args.preferencia_turno_soft ?? null,
                  domingo_forcar_folga,
                  existing.id,
                )
            } else {
                await execute(`
                  INSERT INTO colaborador_regra_horario_excecao_data
                    (colaborador_id, data, ativo, inicio, fim, preferencia_turno_soft, domingo_forcar_folga)
                  VALUES (?, ?, ?, ?, ?, ?, ?)
                `,
                  colaborador_id,
                  data,
                  ativo,
                  args.inicio ?? null,
                  args.fim ?? null,
                  args.preferencia_turno_soft ?? null,
                  domingo_forcar_folga,
                )
            }

            const regra = await queryOne<Record<string, any>>(
              'SELECT * FROM colaborador_regra_horario_excecao_data WHERE colaborador_id = ? AND data = ?',
              colaborador_id, data
            )

            return toolOk(
              {
                sucesso: true,
                colaborador: { id: colab.id, nome: colab.nome, setor_id: colab.setor_id },
                regra_excecao: regra,
                modo: existing ? 'atualizado' : 'criado',
              },
              {
                summary: `Exceção de horário ${existing ? 'atualizada' : 'criada'} para ${colab.nome} em ${data}.`,
                meta: {
                  tool_kind: 'action',
                  action: 'upsert-date-exception-rule',
                  next_tools_hint: ['buscar_colaborador', 'gerar_escala'],
                }
              }
            )
        } catch (e: any) {
            return toolError(
              'UPSERT_REGRA_EXCECAO_FALHOU',
              `Erro ao salvar exceção de horário por data: ${e.message}`,
              {
                correction: 'Revise colaborador_id, data e campos de horário.',
                meta: { tool_kind: 'action', action: 'upsert-date-exception-rule' }
              }
            )
        }
    }

    if (name === 'resumir_horas_setor') {
        try {
            const { setor_id, data_inicio, data_fim, escala_id } = args

            const setor = await queryOne<{ id: number; nome: string }>('SELECT id, nome FROM setores WHERE id = ? AND ativo = true', setor_id)
            if (!setor) {
                return toolError(
                  'RESUMIR_HORAS_SETOR_INVALIDO',
                  `Setor ${setor_id} não encontrado ou inativo.`,
                  {
                    correction: 'Use o contexto automático ou consultar("setores") para resolver o setor_id correto.',
                    meta: { tool_kind: 'discovery', action: 'summarize-hours', setor_id }
                  }
                )
            }

            let query = `
              SELECT c.id, c.nome, c.tipo_contrato_id,
                     COUNT(CASE WHEN a.status = 'TRABALHO' THEN 1 END) as dias_trabalho,
                     SUM(CASE WHEN a.status = 'TRABALHO' THEN a.minutos ELSE 0 END) as total_minutos,
                     COUNT(CASE WHEN a.status = 'FOLGA' THEN 1 END) as dias_folga
              FROM alocacoes a
              JOIN colaboradores c ON c.id = a.colaborador_id
              JOIN escalas e ON e.id = a.escala_id
              WHERE e.setor_id = ?
                AND a.data BETWEEN ? AND ?
            `
            const params: unknown[] = [setor_id, data_inicio, data_fim]

            if (escala_id) {
                query += ' AND a.escala_id = ?'
                params.push(escala_id)
            }

            query += ' GROUP BY c.id, c.nome, c.tipo_contrato_id ORDER BY total_minutos DESC'

            const rows = await queryAll<{
              id: number
              nome: string
              tipo_contrato_id: number
              dias_trabalho: number
              total_minutos: number
              dias_folga: number
            }>(query, ...params)

            const colaboradores = rows.map(r => ({
              id: r.id,
              nome: r.nome,
              tipo_contrato_id: r.tipo_contrato_id,
              dias_trabalho: r.dias_trabalho,
              dias_folga: r.dias_folga,
              total_horas: +(r.total_minutos / 60).toFixed(1),
              total_minutos: r.total_minutos,
              media_horas_dia: r.dias_trabalho > 0 ? +((r.total_minutos / 60) / r.dias_trabalho).toFixed(1) : 0,
            }))

            const totalMinutos = rows.reduce((acc, r) => acc + r.total_minutos, 0)
            const totalDias = rows.reduce((acc, r) => acc + r.dias_trabalho, 0)

            return toolOk(
              {
                setor: { id: setor.id, nome: setor.nome },
                periodo: { data_inicio, data_fim },
                colaboradores,
                totais: {
                  pessoas: rows.length,
                  total_horas: +(totalMinutos / 60).toFixed(1),
                  total_dias_trabalho: totalDias,
                  media_horas_pessoa: rows.length > 0 ? +((totalMinutos / 60) / rows.length).toFixed(1) : 0,
                },
              },
              {
                summary: `Resumo de horas do setor ${setor.nome}: ${rows.length} colaborador(es), ${+(totalMinutos / 60).toFixed(1)}h total no período ${data_inicio} a ${data_fim}.`,
                meta: { tool_kind: 'discovery' }
              }
            )
        } catch (e: any) {
            return toolError(
              'RESUMIR_HORAS_SETOR_FALHOU',
              `Erro ao resumir horas: ${e.message}`,
              {
                correction: 'Verifique setor_id e período.',
                meta: { tool_kind: 'discovery', action: 'summarize-hours' }
              }
            )
        }
    }

    if (name === 'resetar_regras_empresa') {
        if (args.confirmar !== true) {
            return toolError(
              'RESETAR_REGRAS_CONFIRMACAO_AUSENTE',
              'Parâmetro confirmar deve ser true para executar o reset.',
              {
                correction: 'Envie confirmar: true para confirmar o reset de todas as regras.',
                meta: { tool_kind: 'action', action: 'reset-enterprise-rules' }
              }
            )
        }

        try {
            const count = (await queryOne<{ count: number }>('SELECT COUNT(*)::int as count FROM regra_empresa'))!.count

            if (count === 0) {
                return toolOk(
                  { sucesso: true, regras_removidas: 0, mensagem: 'Nenhuma regra customizada para resetar.' },
                  {
                    summary: 'Nenhuma regra customizada existia — já estava no padrão.',
                    meta: { tool_kind: 'action', action: 'reset-enterprise-rules', noop: true }
                  }
                )
            }

            await execute('DELETE FROM regra_empresa')

            return toolOk(
              {
                sucesso: true,
                regras_removidas: count,
                mensagem: `${count} regra(s) customizada(s) removida(s). Todas as regras voltaram ao padrão do sistema.`,
              },
              {
                summary: `${count} regra(s) resetada(s) para o padrão.`,
                meta: { tool_kind: 'action', action: 'reset-enterprise-rules' }
              }
            )
        } catch (e: any) {
            return toolError(
              'RESETAR_REGRAS_FALHOU',
              `Erro ao resetar regras: ${e.message}`,
              {
                correction: 'Tente novamente.',
                meta: { tool_kind: 'action', action: 'reset-enterprise-rules' }
              }
            )
        }
    }

    // ==================== listar_perfis_horario ====================
    if (name === 'listar_perfis_horario') {
        const { tipo_contrato_id } = args
        if (!tipo_contrato_id) {
            return toolError('LISTAR_PERFIS_PARAM', 'tipo_contrato_id é obrigatório.', {
              correction: 'Informe o ID do tipo de contrato.',
              meta: { tool_kind: 'discovery' }
            })
        }
        try {
            const contrato = await queryOne<{ id: number; nome: string }>('SELECT id, nome FROM tipos_contrato WHERE id = ?', tipo_contrato_id)
            if (!contrato) {
                return toolError('CONTRATO_NAO_ENCONTRADO', `Tipo de contrato ${tipo_contrato_id} não encontrado.`, {
                  correction: 'Use o contexto automático ou consultar("tipos_contrato") para ver os IDs válidos.',
                  meta: { tool_kind: 'discovery' }
                })
            }
            const perfis = await queryAll('SELECT * FROM contrato_perfis_horario WHERE tipo_contrato_id = ? ORDER BY ordem, id', tipo_contrato_id)
            return toolOk(
              { contrato: { id: contrato.id, nome: contrato.nome }, perfis, total: (perfis as any[]).length },
              { summary: `${(perfis as any[]).length} perfil(is) de horário para ${contrato.nome}.`, meta: { tool_kind: 'discovery' } }
            )
        } catch (e: any) {
            return toolError('LISTAR_PERFIS_FALHOU', `Erro: ${e.message}`, { correction: 'Verifique se o tipo_contrato_id existe com consultar("tipos_contrato").', meta: { tool_kind: 'discovery' } })
        }
    }

    // ==================== salvar_perfil_horario ====================
    if (name === 'salvar_perfil_horario') {
        const { id, tipo_contrato_id, nome, inicio, fim, preferencia_turno_soft, ordem, ativo } = args
        try {
            if (id) {
                // UPDATE
                const existing = await queryOne('SELECT id FROM contrato_perfis_horario WHERE id = ?', id)
                if (!existing) {
                    return toolError('PERFIL_NAO_ENCONTRADO', `Perfil ${id} não encontrado.`, { correction: 'Use listar_perfis_horario para ver os IDs válidos.', meta: { tool_kind: 'action' } })
                }
                const fields: string[] = []
                const values: unknown[] = []
                if (nome !== undefined) { fields.push('nome = ?'); values.push(nome) }
                if (inicio !== undefined) { fields.push('inicio = ?'); values.push(inicio) }
                if (fim !== undefined) { fields.push('fim = ?'); values.push(fim) }
                if (preferencia_turno_soft !== undefined) { fields.push('preferencia_turno_soft = ?'); values.push(preferencia_turno_soft) }
                if (ordem !== undefined) { fields.push('ordem = ?'); values.push(ordem) }
                if (ativo !== undefined) { fields.push('ativo = ?'); values.push(ativo) }
                if (fields.length === 0) {
                    return toolError('PERFIL_NADA_PARA_ATUALIZAR', 'Nenhum campo informado para atualizar.', { correction: 'Informe ao menos um campo: nome, inicio, fim, preferencia_turno_soft, ordem ou ativo.', meta: { tool_kind: 'action' } })
                }
                values.push(id)
                await execute(`UPDATE contrato_perfis_horario SET ${fields.join(', ')} WHERE id = ?`, ...values)
                const updated = await queryOne('SELECT * FROM contrato_perfis_horario WHERE id = ?', id)
                return toolOk(
                  { perfil: updated, operacao: 'atualizado' },
                  { summary: `Perfil ${id} atualizado.`, meta: { tool_kind: 'action' } }
                )
            } else {
                // CREATE
                if (!tipo_contrato_id || !nome) {
                    return toolError('PERFIL_CAMPOS_OBRIGATORIOS', 'Para criar: tipo_contrato_id e nome são obrigatórios.', { correction: 'Inclua tipo_contrato_id e nome. Horários (inicio/fim) no formato HH:MM (ex: "08:00").', meta: { tool_kind: 'action' } })
                }
                const newId = await insertReturningId(`
                  INSERT INTO contrato_perfis_horario (tipo_contrato_id, nome, inicio, fim, preferencia_turno_soft, ordem)
                  VALUES (?, ?, ?, ?, ?, ?)
                `, tipo_contrato_id, nome, inicio ?? null, fim ?? null, preferencia_turno_soft ?? null, ordem ?? 0)
                const created = await queryOne('SELECT * FROM contrato_perfis_horario WHERE id = ?', newId)
                return toolOk(
                  { perfil: created, operacao: 'criado' },
                  { summary: `Perfil "${nome}" criado para contrato ${tipo_contrato_id}.`, meta: { tool_kind: 'action' } }
                )
            }
        } catch (e: any) {
            return toolError('SALVAR_PERFIL_FALHOU', `Erro: ${e.message}`, { correction: 'Verifique se tipo_contrato_id existe e horários estão no formato HH:MM.', meta: { tool_kind: 'action' } })
        }
    }

    // ==================== deletar_perfil_horario ====================
    if (name === 'deletar_perfil_horario') {
        const { id } = args
        if (!id) {
            return toolError('DELETAR_PERFIL_PARAM', 'id é obrigatório.', { correction: 'Informe o id do perfil. Use listar_perfis_horario para ver os IDs válidos.', meta: { tool_kind: 'action' } })
        }
        try {
            const existing = await queryOne<{ id: number; nome: string }>('SELECT id, nome FROM contrato_perfis_horario WHERE id = ?', id)
            if (!existing) {
                return toolError('PERFIL_NAO_ENCONTRADO', `Perfil ${id} não encontrado.`, { correction: 'Use listar_perfis_horario para ver os IDs válidos.', meta: { tool_kind: 'action' } })
            }
            await execute('DELETE FROM contrato_perfis_horario WHERE id = ?', id)
            return toolOk(
              { sucesso: true, perfil_removido: existing.nome },
              { summary: `Perfil "${existing.nome}" removido.`, meta: { tool_kind: 'action' } }
            )
        } catch (e: any) {
            return toolError('DELETAR_PERFIL_FALHOU', `Erro: ${e.message}`, { correction: 'Verifique se o id do perfil está correto.', meta: { tool_kind: 'action' } })
        }
    }

    // ==================== configurar_horario_funcionamento ====================
    if (name === 'configurar_horario_funcionamento') {
        const { nivel, setor_id, dia_semana, ativo: diaAtivo, hora_abertura, hora_fechamento, usa_padrao } = args
        if (!nivel || !dia_semana) {
            return toolError('HORARIO_PARAM', 'nivel e dia_semana são obrigatórios.', { correction: 'nivel: "empresa" ou "setor". dia_semana: "SEG"|"TER"|"QUA"|"QUI"|"SEX"|"SAB"|"DOM".', meta: { tool_kind: 'action' } })
        }
        if (diaAtivo && (!hora_abertura || !hora_fechamento)) {
            return toolError('HORARIO_PARAM', 'hora_abertura e hora_fechamento são obrigatórios quando ativo=true.', { correction: 'Informe hora_abertura e hora_fechamento no formato HH:MM (ex: "08:00", "22:00").', meta: { tool_kind: 'action' } })
        }

        try {
            if (nivel === 'empresa') {
                await execute(`
                  UPDATE empresa_horario_semana
                  SET ativo = ?, hora_abertura = ?, hora_fechamento = ?
                  WHERE dia_semana = ?
                `, diaAtivo, hora_abertura ?? '08:00', hora_fechamento ?? '22:00', dia_semana)
                const result = await queryOne('SELECT * FROM empresa_horario_semana WHERE dia_semana = ?', dia_semana)
                return toolOk(
                  { horario: result, nivel: 'empresa', operacao: 'atualizado' },
                  { summary: `Horário da empresa para ${dia_semana}: ${diaAtivo ? `${hora_abertura}–${hora_fechamento}` : 'FECHADO'}.`, meta: { tool_kind: 'action' } }
                )
            } else {
                // setor
                if (!setor_id) {
                    return toolError('HORARIO_SETOR_ID', 'setor_id é obrigatório quando nivel="setor".', { correction: 'Informe setor_id. Use consultar("setores") para ver os IDs válidos.', meta: { tool_kind: 'action' } })
                }
                const setor = await queryOne<{ id: number; nome: string }>('SELECT id, nome FROM setores WHERE id = ?', setor_id)
                if (!setor) {
                    return toolError('SETOR_NAO_ENCONTRADO', `Setor ${setor_id} não encontrado.`, { correction: 'Use consultar("setores") para ver os IDs válidos.', meta: { tool_kind: 'action' } })
                }
                await execute(`
                  INSERT INTO setor_horario_semana (setor_id, dia_semana, ativo, usa_padrao, hora_abertura, hora_fechamento)
                  VALUES (?, ?, ?, ?, ?, ?)
                  ON CONFLICT(setor_id, dia_semana) DO UPDATE SET
                    ativo = excluded.ativo,
                    usa_padrao = excluded.usa_padrao,
                    hora_abertura = excluded.hora_abertura,
                    hora_fechamento = excluded.hora_fechamento
                `, setor_id, dia_semana, diaAtivo, usa_padrao ?? false, hora_abertura ?? '08:00', hora_fechamento ?? '22:00')
                const result = await queryOne('SELECT * FROM setor_horario_semana WHERE setor_id = ? AND dia_semana = ?', setor_id, dia_semana)
                return toolOk(
                  { horario: result, nivel: 'setor', setor_nome: setor.nome, operacao: 'upsert' },
                  { summary: `Horário do ${setor.nome} para ${dia_semana}: ${diaAtivo ? (usa_padrao ? 'herda empresa' : `${hora_abertura}–${hora_fechamento}`) : 'FECHADO'}.`, meta: { tool_kind: 'action' } }
                )
            }
        } catch (e: any) {
            return toolError('CONFIGURAR_HORARIO_FALHOU', `Erro: ${e.message}`, { correction: 'Verifique nivel ("empresa"/"setor"), dia_semana e formato dos horários HH:MM.', meta: { tool_kind: 'action' } })
        }
    }

    // ==================== obter_alertas ====================
    if (name === 'obter_alertas') {
        const { setor_id: filtroSetorId } = args
        try {
            const alertas = await coreAlerts(filtroSetorId as number | undefined)
            return toolOk(
              { alertas, total: alertas.length },
              { summary: alertas.length > 0 ? `${alertas.length} alerta(s) ativo(s).` : 'Nenhum alerta ativo.', meta: { tool_kind: 'discovery' } }
            )
        } catch (e: any) {
            return toolError('OBTER_ALERTAS_FALHOU', `Erro: ${e.message}`, { correction: 'Tente sem setor_id para alertas gerais, ou verifique se o setor_id existe.', meta: { tool_kind: 'discovery' } })
        }
    }

    // ==================== KNOWLEDGE LAYER TOOLS ====================

    if (name === 'buscar_conhecimento') {
        const { consulta, limite } = args
        try {
            const result = await searchKnowledge(consulta as string, { limite: limite as number | undefined })
            if (result.chunks.length === 0) {
                return toolOk(
                  { chunks: [], relations: [], context_for_llm: '' },
                  { summary: 'Nenhum conhecimento encontrado para esta busca.', meta: { tool_kind: 'knowledge' } }
                )
            }
            return toolOk(
              {
                total: result.chunks.length,
                context_for_llm: result.context_for_llm,
              },
              { summary: `${result.chunks.length} resultado(s) encontrado(s).`, meta: { tool_kind: 'knowledge' } }
            )
        } catch (e: any) {
            return toolError('BUSCAR_CONHECIMENTO_FALHOU', `Erro na busca: ${e.message}`, { correction: 'Tente reformular a consulta ou use termos mais específicos.', meta: { tool_kind: 'knowledge' } })
        }
    }

    if (name === 'salvar_conhecimento') {
        const { titulo, conteudo, importance } = args
        try {
            const result = await ingestKnowledge(titulo as string, conteudo as string, importance as 'high' | 'low')
            return toolOk(
              { source_id: result.source_id, chunks_count: result.chunks_count, entities_count: result.entities_count },
              { summary: `Conhecimento salvo: ${result.chunks_count} chunk(s)${result.entities_count > 0 ? `, ${result.entities_count} entidade(s) extraída(s)` : ''}.`, meta: { tool_kind: 'knowledge' } }
            )
        } catch (e: any) {
            return toolError('SALVAR_CONHECIMENTO_FALHOU', `Erro ao salvar: ${e.message}`, { correction: 'Verifique se título e conteúdo não estão vazios e tente novamente.', meta: { tool_kind: 'knowledge' } })
        }
    }

    if (name === 'listar_conhecimento') {
        const { tipo, limite } = args
        try {
            const sources = tipo === 'todos'
              ? await queryAll<{ id: number; tipo: string; titulo: string; importance: string; criada_em: string; atualizada_em: string }>(
                  'SELECT id, tipo, titulo, importance, criada_em, atualizada_em FROM knowledge_sources ORDER BY atualizada_em DESC LIMIT $1',
                  limite as number,
                )
              : await queryAll<{ id: number; tipo: string; titulo: string; importance: string; criada_em: string; atualizada_em: string }>(
                  'SELECT id, tipo, titulo, importance, criada_em, atualizada_em FROM knowledge_sources WHERE tipo = $1 ORDER BY atualizada_em DESC LIMIT $2',
                  tipo as string,
                  limite as number,
                )

            // Stats
            const totalSources = (await queryOne<{ c: number }>('SELECT COUNT(*)::int as c FROM knowledge_sources'))?.c ?? 0
            const totalChunks = (await queryOne<{ c: number }>('SELECT COUNT(*)::int as c FROM knowledge_chunks'))?.c ?? 0
            const totalEntities = (await queryOne<{ c: number }>("SELECT COUNT(*)::int as c FROM knowledge_entities WHERE valid_to IS NULL"))?.c ?? 0
            const totalRelations = (await queryOne<{ c: number }>("SELECT COUNT(*)::int as c FROM knowledge_relations WHERE valid_to IS NULL"))?.c ?? 0

            return toolOk(
              {
                sources,
                stats: { total_sources: totalSources, total_chunks: totalChunks, total_entities: totalEntities, total_relations: totalRelations },
              },
              { summary: `${sources.length} fonte(s) listada(s) de ${totalSources} total. ${totalChunks} chunks, ${totalEntities} entidades, ${totalRelations} relações.`, meta: { tool_kind: 'knowledge' } }
            )
        } catch (e: any) {
            return toolError('LISTAR_CONHECIMENTO_FALHOU', `Erro: ${e.message}`, { correction: 'Tente sem filtro de tipo.', meta: { tool_kind: 'knowledge' } })
        }
    }

    if (name === 'explorar_relacoes') {
        const { entidade, profundidade } = args
        try {
            const result = await exploreRelations(entidade as string, (profundidade as number) ?? 2)
            if (!result.entidade_raiz) {
                return toolError('NOT_FOUND', `Entidade "${entidade}" não encontrada no knowledge graph.`, {
                    correction: 'Verifique o nome exato. O graph só contém entidades extraídas de documentos indexados.',
                    meta: { tool_kind: 'knowledge' }
                })
            }
            return toolOk(
              { entidade_raiz: result.entidade_raiz, entidades: result.entidades, relacoes: result.relacoes },
              {
                summary: `Grafo explorado para "${result.entidade_raiz}": ${result.entidades.length} entidade(s), ${result.relacoes.length} relação(ões).`,
                meta: { tool_kind: 'knowledge' }
              }
            )
        } catch (e: any) {
            return toolError('EXPLORAR_RELACOES_FALHOU', `Erro ao explorar relações: ${e.message}`, {
                correction: 'Verifique o nome da entidade e tente novamente.',
                meta: { tool_kind: 'knowledge' }
            })
        }
    }

    // ==================== MEMÓRIAS IA ====================

    if (name === 'salvar_memoria') {
        const { conteudo, id } = args as { conteudo: string; id?: number }
        try {
            const { generateQueryEmbedding } = await import('../knowledge/embeddings')
            const countRow = await queryOne<{ c: number }>('SELECT COUNT(*)::int as c FROM ia_memorias')
            const total = countRow?.c ?? 0

            // Gera embedding local (grátis)
            let embeddingStr: string | null = null
            try {
                const emb = await generateQueryEmbedding(conteudo)
                if (emb) embeddingStr = `[${emb.join(',')}]`
            } catch { /* embedding opcional */ }

            if (id) {
                // Update
                if (embeddingStr) {
                    await execute('UPDATE ia_memorias SET conteudo = $1, embedding = $2::vector, atualizada_em = NOW() WHERE id = $3', conteudo, embeddingStr, id)
                } else {
                    await execute('UPDATE ia_memorias SET conteudo = $1, atualizada_em = NOW() WHERE id = $2', conteudo, id)
                }
                return toolOk(
                    { id, conteudo, total },
                    { summary: `Memória #${id} atualizada.`, meta: { tool_kind: 'memoria' } }
                )
            }

            // Create — check limit
            if (total >= 50) {
                return toolError('LIMITE_MEMORIAS', `Limite de 50 memórias atingido (${total}/50).`, {
                    correction: 'Use listar_memorias para ver as existentes e remover_memoria para liberar espaço.',
                    meta: { tool_kind: 'memoria' }
                })
            }

            const newId = embeddingStr
                ? await insertReturningId(`INSERT INTO ia_memorias (conteudo, origem, embedding) VALUES ($1, 'manual', $2::vector)`, conteudo, embeddingStr)
                : await insertReturningId(`INSERT INTO ia_memorias (conteudo, origem) VALUES ($1, 'manual')`, conteudo)
            return toolOk(
                { id: newId, conteudo, total: total + 1 },
                { summary: `Memória salva (${total + 1}/50): "${conteudo.slice(0, 50)}..."`, meta: { tool_kind: 'memoria' } }
            )
        } catch (e: any) {
            return toolError('SALVAR_MEMORIA_FALHOU', `Erro ao salvar memória: ${e.message}`, {
                correction: 'Tente novamente.',
                meta: { tool_kind: 'memoria' }
            })
        }
    }

    if (name === 'listar_memorias') {
        try {
            const rows = await queryAll<{ id: number; conteudo: string; origem: string; criada_em: string; atualizada_em: string }>(
                'SELECT * FROM ia_memorias ORDER BY atualizada_em DESC')
            return toolOk(
                { memorias: rows, total: rows.length, limite: 50 },
                { summary: `${rows.length} memória(s) salva(s) (max 50).`, meta: { tool_kind: 'memoria' } }
            )
        } catch (e: any) {
            return toolError('LISTAR_MEMORIAS_FALHOU', `Erro ao listar memórias: ${e.message}`, {
                correction: 'Tente novamente.',
                meta: { tool_kind: 'memoria' }
            })
        }
    }

    if (name === 'remover_memoria') {
        const { id } = args as { id: number }
        try {
            const existe = await queryOne<{ id: number }>('SELECT id FROM ia_memorias WHERE id = $1', id)
            if (!existe) {
                return toolError('NOT_FOUND', `Memória #${id} não encontrada.`, {
                    correction: 'Use listar_memorias para ver os IDs disponíveis.',
                    meta: { tool_kind: 'memoria' }
                })
            }
            await execute('DELETE FROM ia_memorias WHERE id = $1', id)
            const countRow = await queryOne<{ c: number }>('SELECT COUNT(*)::int as c FROM ia_memorias')
            return toolOk(
                { id, total: countRow?.c ?? 0 },
                { summary: `Memória #${id} removida.`, meta: { tool_kind: 'memoria' } }
            )
        } catch (e: any) {
            return toolError('REMOVER_MEMORIA_FALHOU', `Erro ao remover memória: ${e.message}`, {
                correction: 'Tente novamente.',
                meta: { tool_kind: 'memoria' }
            })
        }
    }

    return toolError('UNKNOWN_TOOL', `Tool '${name}' não reconhecida.`, {
      correction: 'Use apenas tools declaradas em IA_TOOLS.',
      meta: { tool_name: name }
    })
}
