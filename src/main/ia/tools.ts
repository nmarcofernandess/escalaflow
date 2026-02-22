import { getDb } from '../db/database'
import { buildSolverInput, runSolver, persistirSolverResult } from '../motor/solver-bridge'
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
  const jsonSchema = zodToJsonSchema(schema as any)
  // Remove $schema que Gemini API não aceita
  delete jsonSchema.$schema
  return jsonSchema
}

// ==================== ZOD SCHEMAS (Type-Safe) ====================

// consultar
const ConsultarSchema = z.object({
  entidade: z.enum([
    'colaboradores', 'setores', 'escalas', 'alocacoes', 'excecoes',
    'demandas', 'tipos_contrato', 'empresa', 'feriados', 'funcoes',
    'regra_definicao', 'regra_empresa'
  ]),
  filtros: z.record(z.string(), z.any()).optional()
})

// criar colaborador — validação específica para colaboradores
const CriarColaboradorSchema = z.object({
  nome: z.string().min(1),
  setor_id: z.number().int().positive(),
  tipo_contrato_id: z.number().int().positive().optional(),
  sexo: z.enum(['M', 'F']).optional(),
  data_nascimento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  tipo_trabalhador: z.string().optional(),
  hora_inicio_min: z.string().optional(),
  hora_fim_max: z.string().optional(),
  ativo: z.number().int().min(0).max(1).optional()
})

// criar exceção — validação específica para exceções
const CriarExcecaoSchema = z.object({
  colaborador_id: z.number().int().positive(),
  tipo: z.enum(['FERIAS', 'ATESTADO', 'BLOQUEIO']),
  data_inicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  data_fim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  motivo: z.string().optional(),
  observacao: z.string().optional()
})

// criar — schema genérico
const CriarSchema = z.object({
  entidade: z.enum([
    'colaboradores', 'excecoes', 'demandas', 'tipos_contrato',
    'setores', 'feriados', 'funcoes'
  ]),
  dados: z.record(z.string(), z.any())
})

// atualizar
const AtualizarSchema = z.object({
  entidade: z.enum(['colaboradores', 'empresa', 'tipos_contrato', 'setores', 'demandas']),
  id: z.number().int().positive(),
  dados: z.record(z.string(), z.any())
})

// deletar
const DeletarSchema = z.object({
  entidade: z.enum(['excecoes', 'demandas', 'feriados', 'funcoes']),
  id: z.number().int().positive()
})

// editar_regra
const EditarRegraSchema = z.object({
  codigo: z.string(),
  status: z.enum(['HARD', 'SOFT', 'OFF', 'ON'])
})

// gerar_escala
const GerarEscalaSchema = z.object({
  setor_id: z.number().int().positive(),
  data_inicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  data_fim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  rules_override: z.record(z.string(), z.string()).optional()
})

// ajustar_alocacao
const AjustarAlocacaoSchema = z.object({
  escala_id: z.number().int().positive(),
  colaborador_id: z.number().int().positive(),
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  status: z.enum(['TRABALHO', 'FOLGA', 'INDISPONIVEL'])
})

// oficializar_escala
const OficializarEscalaSchema = z.object({
  escala_id: z.number().int().positive()
})

// preflight
const PreflightSchema = z.object({
  setor_id: z.number().int().positive(),
  data_inicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  data_fim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
})

// explicar_violacao
const ExplicarViolacaoSchema = z.object({
  codigo_regra: z.string()
})

// ==================== IA_TOOLS (Gemini API Format) ====================

export const IA_TOOLS = [
    {
        name: 'get_context',
        description: '🚨 CRITICAL: ALWAYS call this FIRST before answering ANY question or calling other tools. Returns complete structured context with ALL setores (IDs + names), colaboradores (IDs + names + setor), and escalas. This is your discovery tool — it gives you the full map of the system so you NEVER need to ask the user for IDs or names. Call this, extract the IDs you need, then use other tools.',
        parameters: {
            type: 'object',
            properties: {}
        }
    },
    {
        name: 'consultar',
        description: 'Consulta dados do banco de dados. Use quando precisar de informação DETALHADA que não está no get_context. Nunca pergunte ao usuário — busque aqui. Exemplos: consultar("alocacoes", {"escala_id": 15}) para ver alocações de uma escala, consultar("excecoes", {"colaborador_id": 5}) para exceções de uma pessoa. Filtros de texto são case-insensitive.',
        parameters: toJsonSchema(ConsultarSchema)
    },
    {
        name: 'criar',
        description: 'Cria um novo registro no sistema.',
        parameters: toJsonSchema(CriarSchema)
    },
    {
        name: 'atualizar',
        description: 'Atualiza um registro existente.',
        parameters: toJsonSchema(AtualizarSchema)
    },
    {
        name: 'deletar',
        description: 'Remove um registro.',
        parameters: toJsonSchema(DeletarSchema)
    },
    {
        name: 'editar_regra',
        description: 'Altera o status de uma regra do motor OR-Tools. Apenas regras marcadas como editavel=1 podem ser alteradas. Regras fixas por lei (H2, H4, H5, H11-H18) são imutáveis.',
        parameters: toJsonSchema(EditarRegraSchema)
    },
    {
        name: 'gerar_escala',
        description: 'Roda o motor OR-Tools CP-SAT para gerar uma escala. Salva como RASCUNHO. IMPORTANTE: Chame get_context() PRIMEIRO para descobrir o setor_id pelo nome. Exemplo: get_context() → encontra setor "Caixa" com id=3 → gerar_escala({"setor_id": 3, "data_inicio": "2026-03-01", "data_fim": "2026-03-31"}). Retorna escala_id, indicadores e diagnostico.',
        parameters: toJsonSchema(GerarEscalaSchema)
    },
    {
        name: 'ajustar_alocacao',
        description: 'Fixa uma alocação específica de uma pessoa em um dia. O motor respeita essa fixação ao regerar.',
        parameters: toJsonSchema(AjustarAlocacaoSchema)
    },
    {
        name: 'oficializar_escala',
        description: 'Trava a escala como OFICIAL. Só é possível quando violacoes_hard = 0.',
        parameters: toJsonSchema(OficializarEscalaSchema)
    },
    {
        name: 'preflight',
        description: 'Verifica viabilidade ANTES de gerar escala. Retorna blockers e warnings. IMPORTANTE: Chame get_context() PRIMEIRO para descobrir o setor_id pelo nome. Exemplo: get_context() → encontra setor "Açougue" com id=5 → preflight({"setor_id": 5, "data_inicio": "2026-03-01", "data_fim": "2026-03-31"}).',
        parameters: toJsonSchema(PreflightSchema)
    },
    {
        name: 'resumo_sistema',
        description: 'Relatório gerencial rápido: total de setores, colaboradores, escalas por status. DEPRECATED: use get_context() ao invés desta tool — ela retorna informação mais completa e estruturada.',
        parameters: { type: 'object', properties: {} }
    },
    {
        name: 'explicar_violacao',
        description: 'Explica uma regra CLT/CCT ou antipadrão pelo código (ex: H1, H2, H14, S_DEFICIT, AP3).',
        parameters: toJsonSchema(ExplicarViolacaoSchema)
    }
]

const ENTIDADES_LEITURA_PERMITIDAS = new Set([
    'colaboradores', 'setores', 'escalas', 'alocacoes', 'excecoes',
    'demandas', 'tipos_contrato', 'empresa', 'feriados', 'funcoes',
    'regra_definicao', 'regra_empresa',
])

// Mapa de campos válidos por entidade (protege contra SQL injection e erros de campo inexistente)
const CAMPOS_VALIDOS: Record<string, Set<string>> = {
  colaboradores: new Set([
    'id', 'nome', 'setor_id', 'tipo_contrato_id', 'sexo', 'ativo', 'rank',
    'prefere_turno', 'evitar_dia_semana', 'horas_semanais', 'tipo_trabalhador',
    'data_nascimento', 'hora_inicio_min', 'hora_fim_max'
  ]),
  setores: new Set([
    'id', 'nome', 'icone', 'hora_abertura', 'hora_fechamento', 'ativo'
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
    'trabalha_domingo', 'max_minutos_dia'
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
}

const ENTIDADES_CRIACAO_PERMITIDAS = new Set([
    'colaboradores', 'excecoes', 'demandas', 'tipos_contrato', 'setores', 'feriados', 'funcoes',
])

const ENTIDADES_ATUALIZACAO_PERMITIDAS = new Set([
    'colaboradores', 'empresa', 'tipos_contrato', 'setores', 'demandas',
])

const ENTIDADES_DELECAO_PERMITIDAS = new Set([
    'excecoes', 'demandas', 'feriados', 'funcoes',
])

// ==================== VALIDAÇÃO RUNTIME (Zod) ====================

const TOOL_SCHEMAS: Record<string, z.ZodTypeAny | null> = {
  get_context: null, // Sem parâmetros
  consultar: ConsultarSchema,
  criar: CriarSchema,
  atualizar: AtualizarSchema,
  deletar: DeletarSchema,
  editar_regra: EditarRegraSchema,
  gerar_escala: GerarEscalaSchema,
  ajustar_alocacao: AjustarAlocacaoSchema,
  oficializar_escala: OficializarEscalaSchema,
  preflight: PreflightSchema,
  resumo_sistema: null, // Sem parâmetros
  explicar_violacao: ExplicarViolacaoSchema,
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

export async function executeTool(name: string, args: Record<string, any>): Promise<any> {
    // Support mock DB for testing
    const db = (global as any).mockDb || getDb()

    // ==================== VALIDAÇÃO ZOD RUNTIME ====================
    const schema = TOOL_SCHEMAS[name]
    if (schema) {
        const validation = schema.safeParse(args)
        if (!validation.success) {
            const errors = validation.error.issues.map((issue) => {
                const path = issue.path.length > 0 ? issue.path.join('.') : 'root'
                return `  • ${path}: ${issue.message}`
            }).join('\n')
            return {
                erro: `❌ Validação falhou para tool '${name}':\n\n${errors}\n\n💡 Verifique os tipos e valores permitidos.`
            }
        }
        // Se válido, usar validated data (garantido type-safe)
        args = validation.data as Record<string, any>
    }

    // ==================== HANDLERS ====================

    if (name === 'get_context') {
        // DISCOVERY TOOL — retorna contexto completo estruturado
        try {
            // Setores com contagens
            const setores = db.prepare(`
                SELECT
                    s.id,
                    s.nome,
                    s.hora_abertura,
                    s.hora_fechamento,
                    s.ativo,
                    COUNT(DISTINCT c.id) as colaboradores_count,
                    COUNT(DISTINCT e.id) as escalas_count
                FROM setores s
                LEFT JOIN colaboradores c ON c.setor_id = s.id AND c.ativo = 1
                LEFT JOIN escalas e ON e.setor_id = s.id AND e.status IN ('RASCUNHO', 'OFICIAL')
                WHERE s.ativo = 1
                GROUP BY s.id
                ORDER BY s.nome
            `).all() as Array<{
                id: number
                nome: string
                hora_abertura: string
                hora_fechamento: string
                ativo: number
                colaboradores_count: number
                escalas_count: number
            }>

            // Colaboradores ativos com setor e contrato
            const colaboradores = db.prepare(`
                SELECT
                    c.id,
                    c.nome,
                    c.setor_id,
                    s.nome as setor_nome,
                    c.tipo_contrato_id,
                    t.nome as contrato_nome,
                    t.horas_semanais,
                    c.tipo_trabalhador
                FROM colaboradores c
                JOIN setores s ON c.setor_id = s.id
                JOIN tipos_contrato t ON c.tipo_contrato_id = t.id
                WHERE c.ativo = 1
                ORDER BY s.nome, c.nome
            `).all() as Array<{
                id: number
                nome: string
                setor_id: number
                setor_nome: string
                tipo_contrato_id: number
                contrato_nome: string
                horas_semanais: number
                tipo_trabalhador: string
            }>

            // Tipos de contrato disponíveis (Fase 2: Discovery explícito)
            const tipos_contrato = db.prepare(`
                SELECT
                    id,
                    nome,
                    horas_semanais,
                    regime_escala,
                    dias_trabalho,
                    trabalha_domingo,
                    max_minutos_dia
                FROM tipos_contrato
                ORDER BY horas_semanais DESC
            `).all() as Array<{
                id: number
                nome: string
                horas_semanais: number
                regime_escala: string
                dias_trabalho: number
                trabalha_domingo: number
                max_minutos_dia: number
            }>

            // Escalas ativas (RASCUNHO ou OFICIAL)
            const escalas = db.prepare(`
                SELECT
                    e.id,
                    e.setor_id,
                    s.nome as setor_nome,
                    e.status,
                    e.data_inicio,
                    e.data_fim,
                    e.pontuacao,
                    e.cobertura_percent,
                    e.violacoes_hard,
                    e.violacoes_soft
                FROM escalas e
                JOIN setores s ON e.setor_id = s.id
                WHERE e.status IN ('RASCUNHO', 'OFICIAL')
                ORDER BY
                    CASE e.status
                        WHEN 'RASCUNHO' THEN 0
                        WHEN 'OFICIAL' THEN 1
                        ELSE 2
                    END,
                    e.id DESC
            `).all() as Array<{
                id: number
                setor_id: number
                setor_nome: string
                status: string
                data_inicio: string
                data_fim: string
                pontuacao: number
                cobertura_percent: number
                violacoes_hard: number
                violacoes_soft: number
            }>

            // Resumo estatístico
            const stats = {
                setores_ativos: setores.length,
                colaboradores_ativos: colaboradores.length,
                escalas_rascunho: escalas.filter(e => e.status === 'RASCUNHO').length,
                escalas_oficiais: escalas.filter(e => e.status === 'OFICIAL').length,
            }

            return {
                version: '1.0',
                timestamp: new Date().toISOString(),
                stats,
                setores,
                colaboradores,
                tipos_contrato,  // FASE 2: Discovery explícito
                escalas,
                instructions: 'Use this structured data to resolve names to IDs. NEVER ask the user for IDs - extract them from this context. Example: user says "Caixa" → find setor with nome="Caixa" → use its id in other tool calls. For tipo_contrato_id, find the contract in tipos_contrato array by name.',
            }
        } catch (e: any) {
            return { erro: `Erro ao buscar contexto: ${e.message}` }
        }
    }

    if (name === 'consultar') {
        const { entidade, filtros } = args

        if (!ENTIDADES_LEITURA_PERMITIDAS.has(entidade)) {
            return { erro: `Entidade '${entidade}' não permitida. Use: ${[...ENTIDADES_LEITURA_PERMITIDAS].join(' | ')}` }
        }

        // VALIDAÇÃO DE CAMPOS (Fase 1: protege contra SQL injection e erros de campo inexistente)
        if (filtros && Object.keys(filtros).length > 0) {
            const camposValidos = CAMPOS_VALIDOS[entidade]
            if (!camposValidos) {
                return { erro: `Entidade '${entidade}' não tem mapa de campos válidos.` }
            }

            for (const campo of Object.keys(filtros)) {
                if (!camposValidos.has(campo)) {
                    return {
                        erro: `❌ Campo inválido: "${campo}" não existe em ${entidade}.\n\n💡 Campos disponíveis: ${[...camposValidos].join(', ')}`
                    }
                }
            }
        }

        let query = `SELECT * FROM ${entidade}`
        const params: unknown[] = []

        if (filtros && Object.keys(filtros).length > 0) {
            const conditions = Object.entries(filtros).map(([k, v]) => {
                if (typeof v === 'string') return `${k} = ? COLLATE NOCASE`
                return `${k} = ?`
            })
            query += ' WHERE ' + conditions.join(' AND ')
            params.push(...Object.values(filtros))
        }

        try {
            return db.prepare(query).all(...params)
        } catch (e: any) {
            return { erro: e.message }
        }
    }

    if (name === 'criar') {
        const { entidade, dados } = args

        if (!ENTIDADES_CRIACAO_PERMITIDAS.has(entidade)) {
            return { erro: `❌ Criação não permitida para '${entidade}'. Entidades permitidas: ${[...ENTIDADES_CRIACAO_PERMITIDAS].join(', ')}` }
        }

        // VALIDAÇÃO ESPECÍFICA + DEFAULTS INTELIGENTES
        if (entidade === 'colaboradores') {
            // Campos obrigatórios
            if (!dados.nome || typeof dados.nome !== 'string') {
                return { erro: '❌ Campo obrigatório: "nome" (string). Exemplo: { "nome": "João Silva", "setor_id": 1 }' }
            }
            if (!dados.setor_id || typeof dados.setor_id !== 'number') {
                return { erro: '❌ Campo obrigatório: "setor_id" (number). Use get_context() para descobrir o ID do setor pelo nome.' }
            }

            // Validar setor existe
            const setor = db.prepare('SELECT id, nome, hora_abertura, hora_fechamento FROM setores WHERE id = ? AND ativo = 1').get(dados.setor_id) as any
            if (!setor) {
                return { erro: `❌ Setor ${dados.setor_id} não encontrado ou inativo. Use get_context() para ver setores disponíveis.` }
            }

            // Defaults inteligentes para campos opcionais
            if (!dados.sexo) dados.sexo = 'M'
            if (!dados.tipo_contrato_id) dados.tipo_contrato_id = 1  // CLT 44h (6x1) — mais comum
            if (!dados.tipo_trabalhador) dados.tipo_trabalhador = 'regular'
            if (!dados.data_nascimento) {
                // Gera idade aleatória entre 25-40 anos
                const idadeAleatoria = 25 + Math.floor(Math.random() * 15)
                const nascimento = new Date()
                nascimento.setFullYear(nascimento.getFullYear() - idadeAleatoria)
                dados.data_nascimento = nascimento.toISOString().split('T')[0]
            }
            if (!dados.hora_inicio_min) dados.hora_inicio_min = setor.hora_abertura
            if (!dados.hora_fim_max) dados.hora_fim_max = setor.hora_fechamento
            if (!dados.ativo) dados.ativo = 1
        }

        if (entidade === 'excecoes') {
            // Campos obrigatórios
            if (!dados.colaborador_id) {
                return { erro: '❌ Campo obrigatório: "colaborador_id" (number). Use get_context() para descobrir o ID pelo nome do colaborador.' }
            }
            if (!dados.tipo) {
                return { erro: '❌ Campo obrigatório: "tipo" (string). Valores permitidos: FERIAS, ATESTADO, BLOQUEIO' }
            }
            if (!dados.data_inicio || !dados.data_fim) {
                return { erro: '❌ Campos obrigatórios: "data_inicio" e "data_fim" (YYYY-MM-DD)' }
            }

            // Validar tipo
            const tiposValidos = ['FERIAS', 'ATESTADO', 'BLOQUEIO']
            if (!tiposValidos.includes(dados.tipo)) {
                return { erro: `❌ Tipo inválido: "${dados.tipo}". Valores permitidos: ${tiposValidos.join(', ')}` }
            }

            // Default motivo
            if (!dados.motivo) dados.motivo = dados.tipo
        }

        const keys = Object.keys(dados)
        const placeholders = keys.map(() => '?').join(', ')
        const values = Object.values(dados)

        try {
            const res = db.prepare(`INSERT INTO ${entidade} (${keys.join(', ')}) VALUES (${placeholders})`).run(...values)
            return { sucesso: true, id: res.lastInsertRowid }
        } catch (e: any) {
            // Traduz erros SQL pra mensagens acionáveis
            if (e.message?.includes('NOT NULL constraint')) {
                const match = e.message.match(/NOT NULL constraint failed: \w+\.(\w+)/)
                const campo = match?.[1] || 'desconhecido'
                return { erro: `❌ Campo obrigatório faltando: "${campo}". Verifique a estrutura da entidade ${entidade}.` }
            }
            if (e.message?.includes('UNIQUE constraint')) {
                return { erro: `❌ Registro duplicado: ${entidade} com esses valores únicos já existe.` }
            }
            if (e.message?.includes('FOREIGN KEY constraint')) {
                return { erro: `❌ Referência inválida: um dos IDs fornecidos não existe no banco. Verifique setor_id, colaborador_id, etc.` }
            }
            return { erro: `❌ Erro ao criar ${entidade}: ${e.message}` }
        }
    }

    if (name === 'atualizar') {
        const { entidade, id, dados } = args

        if (!ENTIDADES_ATUALIZACAO_PERMITIDAS.has(entidade)) {
            return { erro: `Atualização não permitida para '${entidade}'. Para alterar regras, use a tool editar_regra.` }
        }

        const sets = Object.keys(dados).map((k: string) => `${k} = ?`).join(', ')
        const values = [...Object.values(dados), id]

        try {
            db.prepare(`UPDATE ${entidade} SET ${sets} WHERE id = ?`).run(...values)
            return { sucesso: true }
        } catch (e: any) {
            return { erro: e.message }
        }
    }

    if (name === 'deletar') {
        const { entidade, id } = args

        if (!ENTIDADES_DELECAO_PERMITIDAS.has(entidade)) {
            return { erro: `Deleção não permitida para '${entidade}'.` }
        }

        try {
            db.prepare(`DELETE FROM ${entidade} WHERE id = ?`).run(id)
            return { sucesso: true }
        } catch (e: any) {
            return { erro: e.message }
        }
    }

    if (name === 'editar_regra') {
        const { codigo, status } = args

        const validStatuses = ['HARD', 'SOFT', 'OFF', 'ON']
        if (!validStatuses.includes(status)) {
            return { erro: `Status '${status}' inválido. Use: HARD, SOFT, OFF ou ON.` }
        }

        const regra = db.prepare('SELECT codigo, nome, editavel FROM regra_definicao WHERE codigo = ?').get(codigo) as { codigo: string; nome: string; editavel: number } | undefined
        if (!regra) {
            return { erro: `Regra '${codigo}' não encontrada. Use consultar com entidade 'regra_definicao' para ver todas as regras disponíveis.` }
        }

        if (!regra.editavel) {
            return { erro: `Regra '${codigo}' (${regra.nome}) é fixa por lei (CLT/CCT) e não pode ser alterada. Regras editáveis incluem: H1, H6, H10, DIAS_TRABALHO, MIN_DIARIO e todas SOFT/ANTIPATTERN.` }
        }

        db.prepare(`INSERT OR REPLACE INTO regra_empresa (codigo, status) VALUES (?, ?)`).run(codigo, status)
        return {
            sucesso: true,
            mensagem: `Regra ${codigo} (${regra.nome}) alterada para ${status}. A próxima geração de escala usará esta configuração.`
        }
    }

    if (name === 'gerar_escala') {
        const { setor_id, data_inicio, data_fim, rules_override } = args

        try {
            const solverInput = buildSolverInput(setor_id, data_inicio, data_fim, undefined, {
                rulesOverride: rules_override,
            })
            const solverResult = await runSolver(solverInput, 60_000)

            if (!solverResult.sucesso || !solverResult.alocacoes || !solverResult.indicadores) {
                return {
                    sucesso: false,
                    status: solverResult.status,
                    diagnostico: solverResult.diagnostico,
                    erro: solverResult.erro?.mensagem ?? `Solver retornou ${solverResult.status}: impossível gerar escala com as restrições atuais.`,
                }
            }

            const escalaId = persistirSolverResult(setor_id, data_inicio, data_fim, solverResult)
            return {
                sucesso: true,
                escala_id: escalaId,
                status: solverResult.status,
                indicadores: solverResult.indicadores,
                violacoes_hard: solverResult.indicadores.violacoes_hard,
                violacoes_soft: solverResult.indicadores.violacoes_soft,
                cobertura_percent: solverResult.indicadores.cobertura_percent,
                pontuacao: solverResult.indicadores.pontuacao,
                diagnostico: solverResult.diagnostico,
            }
        } catch (e: any) {
            return { sucesso: false, erro: e.message }
        }
    }

    if (name === 'ajustar_alocacao') {
        const { escala_id, colaborador_id, data, status } = args

        const statusValidos = ['TRABALHO', 'FOLGA', 'INDISPONIVEL']
        if (!statusValidos.includes(status)) {
            return { erro: `Status '${status}' inválido. Use: TRABALHO | FOLGA | INDISPONIVEL` }
        }

        const existing = db.prepare(
            'SELECT id FROM alocacoes WHERE escala_id = ? AND colaborador_id = ? AND data = ?'
        ).get(escala_id, colaborador_id, data)

        if (!existing) {
            return { erro: `Alocação não encontrada para escala ${escala_id}, colaborador ${colaborador_id}, data ${data}.` }
        }

        try {
            db.prepare(
                'UPDATE alocacoes SET status = ? WHERE escala_id = ? AND colaborador_id = ? AND data = ?'
            ).run(status, escala_id, colaborador_id, data)
            return {
                sucesso: true,
                mensagem: `Alocação ajustada: colaborador ${colaborador_id} em ${data} → ${status}. Regenere a escala para que o motor respeite este ajuste.`
            }
        } catch (e: any) {
            return { erro: e.message }
        }
    }

    if (name === 'oficializar_escala') {
        const { escala_id } = args

        const escala = db.prepare('SELECT id, status, violacoes_hard FROM escalas WHERE id = ?').get(escala_id) as { id: number; status: string; violacoes_hard: number } | undefined
        if (!escala) {
            return { erro: `Escala ${escala_id} não encontrada.` }
        }
        if (escala.status === 'OFICIAL') {
            return { aviso: `Escala ${escala_id} já está OFICIAL.` }
        }
        if (escala.violacoes_hard > 0) {
            return {
                erro: `Não é possível oficializar: a escala tem ${escala.violacoes_hard} violação(ões) HARD. Corrija as violações antes de oficializar.`
            }
        }

        db.prepare("UPDATE escalas SET status = 'OFICIAL' WHERE id = ?").run(escala_id)
        return { sucesso: true, mensagem: `Escala ${escala_id} oficializada com sucesso. Ela está travada definitivamente.` }
    }

    if (name === 'preflight') {
        const { setor_id, data_inicio, data_fim } = args
        const blockers: Array<{ codigo: string; severidade: string; mensagem: string; detalhe?: string }> = []
        const warnings: Array<{ codigo: string; severidade: string; mensagem: string; detalhe?: string }> = []

        const setor = db.prepare('SELECT id, ativo FROM setores WHERE id = ?').get(setor_id) as { id: number; ativo: number } | undefined
        if (!setor || setor.ativo !== 1) {
            blockers.push({
                codigo: 'SETOR_INVALIDO',
                severidade: 'BLOCKER',
                mensagem: `Setor ${setor_id} não encontrado ou inativo.`
            })
        }

        const colabsAtivos = (
            db.prepare('SELECT COUNT(*) as count FROM colaboradores WHERE setor_id = ? AND ativo = 1').get(setor_id) as { count: number }
        ).count
        if (colabsAtivos === 0) {
            blockers.push({
                codigo: 'SEM_COLABORADORES',
                severidade: 'BLOCKER',
                mensagem: 'Setor não tem colaboradores ativos.',
                detalhe: 'Cadastre ao menos 1 colaborador para gerar escala.'
            })
        }

        const demandasCount = (
            db.prepare('SELECT COUNT(*) as count FROM demandas WHERE setor_id = ?').get(setor_id) as { count: number }
        ).count
        if (demandasCount === 0) {
            warnings.push({
                codigo: 'SEM_DEMANDA',
                severidade: 'WARNING',
                mensagem: 'Setor sem demanda planejada cadastrada.',
                detalhe: 'O motor vai considerar demanda zero — todos os slots serão de livre distribuição.'
            })
        }

        const feriadosNoPeriodo = (
            db.prepare('SELECT COUNT(*) as count FROM feriados WHERE data BETWEEN ? AND ?').get(data_inicio, data_fim) as { count: number }
        ).count

        return {
            ok: blockers.length === 0,
            blockers,
            warnings,
            summary: {
                setor_id,
                data_inicio,
                data_fim,
                colaboradores_ativos: colabsAtivos,
                demandas_cadastradas: demandasCount,
                feriados_no_periodo: feriadosNoPeriodo,
            },
        }
    }

    if (name === 'resumo_sistema') {
        const colabs = (db.prepare('SELECT count(*) as c FROM colaboradores WHERE ativo = 1').get() as any).c
        const setores = (db.prepare('SELECT count(*) as c FROM setores WHERE ativo = 1').get() as any).c
        const rascunhos = (db.prepare("SELECT count(*) as c FROM escalas WHERE status = 'RASCUNHO'").get() as any).c
        const oficiais = (db.prepare("SELECT count(*) as c FROM escalas WHERE status = 'OFICIAL'").get() as any).c
        const regrasCustomizadas = (db.prepare('SELECT count(*) as c FROM regra_empresa').get() as any).c
        return {
            setores_ativos: setores,
            colaboradores_ativos: colabs,
            escalas_rascunho: rascunhos,
            escalas_oficiais: oficiais,
            regras_customizadas_pela_empresa: regrasCustomizadas,
        }
    }

    if (name === 'explicar_violacao') {
        const { codigo_regra } = args
        const explicacao = DICIONARIO_VIOLACOES[codigo_regra]
        if (explicacao) {
            return { codigo: codigo_regra, explicacao }
        }
        const regra = db.prepare('SELECT nome, descricao FROM regra_definicao WHERE codigo = ?').get(codigo_regra) as { nome: string; descricao: string } | undefined
        if (regra) {
            return { codigo: codigo_regra, explicacao: `${regra.nome}: ${regra.descricao}` }
        }
        return { codigo: codigo_regra, explicacao: 'Regra não encontrada no dicionário. Consulte o MOTOR_V3_RFC.md para a lista completa de regras CLT/CCT aplicáveis.' }
    }

    return { erro: `Tool '${name}' não reconhecida.` }
}
