import { getDb } from '../db/database'
import { buildSolverInput, runSolver, persistirSolverResult, computeSolverScenarioHash } from '../motor/solver-bridge'
import { validarEscalaV3 } from '../motor/validador'
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

const HORA_HHMM_REGEX = /^\d{2}:\d{2}$/
const DiaSemanaSchema = z.enum(['SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB', 'DOM'])
const RegimeOverrideSchema = z.object({
  colaborador_id: z.number().int().positive().describe('ID do colaborador para override de regime.'),
  regime_escala: z.enum(['5X2', '6X1']).describe('Regime temporário de simulação para preflight/geração.')
})

function normalizeRegimesOverrideForTool(overrides?: Array<{ colaborador_id: number; regime_escala: '5X2' | '6X1' }>) {
  const map = new Map<number, '5X2' | '6X1'>()
  for (const o of overrides ?? []) {
    if (!Number.isInteger(o.colaborador_id) || o.colaborador_id <= 0) continue
    if (o.regime_escala !== '5X2' && o.regime_escala !== '6X1') continue
    map.set(o.colaborador_id, o.regime_escala)
  }
  return [...map.entries()]
    .map(([colaborador_id, regime_escala]) => ({ colaborador_id, regime_escala }))
    .sort((a, b) => a.colaborador_id - b.colaborador_id)
}

function listDaysForTool(dataInicio: string, dataFim: string): string[] {
  const out: string[] = []
  const start = new Date(`${dataInicio}T00:00:00`)
  const end = new Date(`${dataFim}T00:00:00`)
  const d = new Date(start.getTime())
  while (d <= end) {
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`)
    d.setDate(d.getDate() + 1)
  }
  return out
}

function dayLabelForTool(isoDate: string): 'SEG' | 'TER' | 'QUA' | 'QUI' | 'SEX' | 'SAB' | 'DOM' {
  const d = new Date(`${isoDate}T00:00:00`)
  const week = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB'] as const
  return week[d.getDay()]
}

function minutesBetweenTimes(h1: string, h2: string): number {
  const [aH, aM] = h1.split(':').map(Number)
  const [bH, bM] = h2.split(':').map(Number)
  return Math.max(0, (bH * 60 + bM) - (aH * 60 + aM))
}

function enrichPreflightWithCapacityChecksForTool(
  solverInput: any,
  blockers: Array<{ codigo: string; severidade: 'BLOCKER' | 'WARNING'; mensagem: string; detalhe?: string }>,
  warnings: Array<{ codigo: string; severidade: 'BLOCKER' | 'WARNING'; mensagem: string; detalhe?: string }>
) {
  const days = listDaysForTool(solverInput.data_inicio, solverInput.data_fim)
  const holidayForbidden = new Set((solverInput.feriados ?? []).filter((f: any) => f.proibido_trabalhar).map((f: any) => f.data))

  for (const day of days) {
    const label = dayLabelForTool(day)
    const dayDemand = (solverInput.demanda ?? [])
      .filter((d: any) => d.dia_semana === null || d.dia_semana === label)
      .filter((d: any) => (d.min_pessoas ?? 0) > 0)

    if (dayDemand.length === 0) continue

    if (label === 'DOM' && (solverInput.colaboradores ?? []).every((c: any) => !c.trabalha_domingo)) {
      blockers.push({
        codigo: 'DOMINGO_SEM_COLABORADORES',
        severidade: 'BLOCKER',
        mensagem: `Há demanda no domingo (${day}), mas nenhum colaborador aceita domingo.`,
        detalhe: 'Ative domingo para alguém ou ajuste a demanda.',
      })
      break
    }

    if (holidayForbidden.has(day)) {
      blockers.push({
        codigo: 'DEMANDA_EM_FERIADO_PROIBIDO',
        severidade: 'BLOCKER',
        mensagem: `Há demanda no feriado proibido ${day}.`,
        detalhe: 'Ajuste a demanda do dia ou a política de feriado.',
      })
      break
    }

    const peakDemand = dayDemand.reduce((acc: number, d: any) => Math.max(acc, d.min_pessoas ?? 0), 0)
    const availableCount = (solverInput.colaboradores ?? []).filter((c: any) => {
      if (label === 'DOM' && !c.trabalha_domingo) return false
      if (holidayForbidden.has(day)) return false
      return !(solverInput.excecoes ?? []).some((e: any) => e.colaborador_id === c.id && e.data_inicio <= day && day <= e.data_fim)
    }).length

    if (availableCount < peakDemand) {
      blockers.push({
        codigo: 'CAPACIDADE_COLETIVA_INSUFICIENTE',
        severidade: 'BLOCKER',
        mensagem: `Capacidade insuficiente em ${day}: demanda pico ${peakDemand}, disponíveis ${availableCount}.`,
        detalhe: 'Ajuste demanda, exceções, domingos/feriados ou quadro de colaboradores.',
      })
      break
    }
  }

  const empresa = solverInput.empresa
  if (!empresa || !(solverInput.colaboradores?.length)) return

  for (const c of solverInput.colaboradores as any[]) {
    const horasSemanaisMinutos = (c.horas_semanais ?? 0) * 60
    const toleranciaMinutos = empresa.tolerancia_semanal_min ?? 0
    const limiteInferiorSemanal = Math.max(0, horasSemanaisMinutos - toleranciaMinutos)

    let maxJanelaDoColaborador = c.max_minutos_dia ?? 0
    const regras = (solverInput.regras_colaborador_dia ?? []).filter((r: any) => r.colaborador_id === c.id)
    const regraTipica = regras.find((r: any) => r.inicio_min || r.fim_max)

    if (regraTipica) {
      const startToUse = regraTipica.inicio_min || empresa.hora_abertura
      const endToUse = regraTipica.fim_max || empresa.hora_fechamento
      const possibleMinutes = minutesBetweenTimes(startToUse, endToUse)
      if (possibleMinutes > 0) {
        maxJanelaDoColaborador = Math.min(possibleMinutes, c.max_minutos_dia ?? possibleMinutes)
      }
    }

    let capacidadeDiaria = maxJanelaDoColaborador
    const diasTrabalho = c.dias_trabalho ?? 1
    const metaDiariaMedia = diasTrabalho > 0 ? horasSemanaisMinutos / diasTrabalho : horasSemanaisMinutos
    if (metaDiariaMedia > 360) {
      capacidadeDiaria -= empresa.min_intervalo_almoco_min ?? 60
    }

    const capacidadeMaxSemanal = capacidadeDiaria * diasTrabalho
    if (capacidadeMaxSemanal < limiteInferiorSemanal) {
      blockers.push({
        codigo: 'CAPACIDADE_INDIVIDUAL_INSUFICIENTE',
        severidade: 'BLOCKER',
        mensagem: `A janela de disponibilidade de ${c.nome} torna a carga horária incompatível.`,
        detalhe: `Capacidade máxima ~${Math.round(capacidadeMaxSemanal / 60)}h. Contrato exige mínimo ~${Math.round(limiteInferiorSemanal / 60)}h.`,
      })
    }
  }

  if (warnings.length === 0 && blockers.length === 0) {
    warnings.push({
      codigo: 'PREFLIGHT_COMPLETO_SEM_BLOCKERS',
      severidade: 'WARNING',
      mensagem: 'Pré-flight completo executado sem blockers adicionais.',
      detalhe: 'Capacidade básica e restrições gerais parecem consistentes para o período.',
    })
  }
}

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

// ==================== ZOD SCHEMAS (Type-Safe) ====================

// consultar
const ConsultarSchema = z.object({
  entidade: z.enum([
    'colaboradores', 'setores', 'escalas', 'alocacoes', 'excecoes',
    'demandas', 'tipos_contrato', 'empresa', 'feriados', 'funcoes',
    'regra_definicao', 'regra_empresa',
    'demandas_excecao_data', 'colaborador_regra_horario_excecao_data'
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

// regras de horário por colaborador (semântica)
const ObterRegraHorarioColaboradorSchema = z.object({
  colaborador_id: z.number().int().positive().describe('ID do colaborador. Resolva via buscar_colaborador.')
})

const SalvarRegraHorarioColaboradorSchema = z.object({
  colaborador_id: z.number().int().positive().describe('ID do colaborador que receberá a regra.'),
  ativo: z.boolean().optional().describe('Se a regra individual fica ativa. Padrão do backend: true ao criar.'),
  perfil_horario_id: z.number().int().positive().nullable().optional().describe('ID de perfil de horário do contrato (ou null para remover vínculo).'),
  inicio_min: z.string().regex(HORA_HHMM_REGEX).nullable().optional().describe('Início mínimo permitido (HH:MM).'),
  inicio_max: z.string().regex(HORA_HHMM_REGEX).nullable().optional().describe('Início máximo permitido (HH:MM).'),
  fim_min: z.string().regex(HORA_HHMM_REGEX).nullable().optional().describe('Fim mínimo permitido (HH:MM).'),
  fim_max: z.string().regex(HORA_HHMM_REGEX).nullable().optional().describe('Fim máximo permitido (HH:MM).'),
  preferencia_turno_soft: z.string().nullable().optional().describe('Preferência soft de turno (ex: MANHA/TARDE/NOITE, conforme convenção local).'),
  domingo_ciclo_trabalho: z.number().int().min(0).max(10).optional().describe('Quantidade de domingos seguidos de trabalho no ciclo.'),
  domingo_ciclo_folga: z.number().int().min(0).max(10).optional().describe('Quantidade de domingos seguidos de folga no ciclo.'),
  folga_fixa_dia_semana: DiaSemanaSchema.nullable().optional().describe('Folga fixa semanal (SEG..DOM) ou null para remover.'),
})

const DefinirJanelaColaboradorSchema = z.object({
  colaborador_id: z.number().int().positive().describe('ID do colaborador.'),
  inicio_min: z.string().regex(HORA_HHMM_REGEX).optional().describe('Mais cedo que pode iniciar (HH:MM).'),
  inicio_max: z.string().regex(HORA_HHMM_REGEX).optional().describe('Mais tarde que pode iniciar (HH:MM).'),
  fim_min: z.string().regex(HORA_HHMM_REGEX).optional().describe('Mais cedo que pode sair (HH:MM).'),
  fim_max: z.string().regex(HORA_HHMM_REGEX).optional().describe('Mais tarde que pode sair (HH:MM).'),
  ativo: z.boolean().optional().describe('Ativa a regra ao salvar. Padrão: true.'),
}).refine((v) => v.inicio_min || v.inicio_max || v.fim_min || v.fim_max, {
  message: 'Informe pelo menos um limite de janela (inicio_min/inicio_max/fim_min/fim_max).',
})

// criar colaborador — validação específica para colaboradores
const CriarColaboradorSchema = z.object({
  nome: z.string().min(1).describe('Nome completo do colaborador.'),
  setor_id: z.number().int().positive().describe('ID do setor. Extraia do get_context() pelo nome do setor.'),
  tipo_contrato_id: z.number().int().positive().optional().describe('ID do tipo de contrato. Extraia de get_context().tipos_contrato pelo nome (ex: CLT 44h).'),
  sexo: z.enum(['M', 'F']).optional().describe('Sexo do colaborador: "M" ou "F".'),
  data_nascimento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('Data de nascimento no formato YYYY-MM-DD.'),
  tipo_trabalhador: z.string().optional().describe('Tipo de trabalhador (ex: regular, aprendiz, estagiario).'),
  hora_inicio_min: z.string().optional().describe('Horário mínimo de início permitido (HH:MM).'),
  hora_fim_max: z.string().optional().describe('Horário máximo de término permitido (HH:MM).'),
  ativo: z.number().int().min(0).max(1).optional().describe('1 = ativo, 0 = inativo.')
})

// criar — schema genérico
const CriarSchema = z.object({
  entidade: z.enum([
    'colaboradores', 'excecoes', 'demandas', 'tipos_contrato',
    'setores', 'feriados', 'funcoes'
  ]).describe('Entidade para criação. Prefira tools semânticas quando existirem; use esta como fallback.'),
  dados: z.record(z.string(), z.any()).describe('Objeto com campos da entidade escolhida. IDs devem ser resolvidos via get_context().')
})

// atualizar
const AtualizarSchema = z.object({
  entidade: z.enum(['colaboradores', 'empresa', 'tipos_contrato', 'setores', 'demandas']).describe('Entidade a atualizar.'),
  id: z.number().int().positive().describe('ID do registro a atualizar. Resolva via get_context() ou consulta prévia.'),
  dados: z.record(z.string(), z.any()).describe('Campos a atualizar (parcial).')
})

// deletar
const DeletarSchema = z.object({
  entidade: z.enum(['excecoes', 'demandas', 'feriados', 'funcoes']).describe('Entidade permitida para deleção.'),
  id: z.number().int().positive().describe('ID do registro a deletar.')
})

// editar_regra
const EditarRegraSchema = z.object({
  codigo: z.string().describe('Código da regra (ex: H1, H6, S_DEFICIT, AP3).'),
  status: z.enum(['HARD', 'SOFT', 'OFF', 'ON']).describe('Novo status da regra. HARD/SOFT para regras parametrizáveis, OFF/ON para toggles.')
})

// gerar_escala
const GerarEscalaSchema = z.object({
  setor_id: z.number().int().positive().describe('ID do setor. Extraia do get_context() a partir do nome citado pelo usuário.'),
  data_inicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('Data inicial da escala no formato YYYY-MM-DD.'),
  data_fim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('Data final da escala no formato YYYY-MM-DD.'),
  rules_override: z.record(z.string(), z.string()).optional().describe('Overrides opcionais de regras (codigo -> status), ex: {"H1":"SOFT"}')
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
  setor_id: z.number().int().positive().describe('ID do setor para validar viabilidade. Resolva via get_context() pelo nome do setor.'),
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
  escala_id: z.number().int().positive().describe('ID da escala (normalmente obtido via get_context/consultar).'),
  incluir_amostras: z.boolean().optional().describe('Se true, inclui amostras de violações/antipadrões no retorno. Padrão: true.')
})

// explicar_violacao
const ExplicarViolacaoSchema = z.object({
  codigo_regra: z.string().describe('Código da regra/violação para explicar (ex: H1, H14, S_DEFICIT, AP3).')
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
  setor_id: z.number().int().positive().describe('ID do setor. Resolva via get_context() pelo nome.'),
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('Data da demanda excepcional (YYYY-MM-DD). Ex: Black Friday, evento especial.'),
  hora_inicio: z.string().regex(HORA_HHMM_REGEX).describe('Início da faixa horária (HH:MM).'),
  hora_fim: z.string().regex(HORA_HHMM_REGEX).describe('Fim da faixa horária (HH:MM).'),
  min_pessoas: z.number().int().min(0).describe('Número mínimo de pessoas necessárias nesta faixa.'),
  override: z.boolean().optional().describe('Se true, substitui demanda regular do dia. Padrão: false.'),
})

// upsert_regra_excecao_data
const UpsertRegraExcecaoDataSchema = z.object({
  colaborador_id: z.number().int().positive().describe('ID do colaborador. Resolva via buscar_colaborador ou get_context().'),
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('Data do override pontual (YYYY-MM-DD).'),
  ativo: z.boolean().optional().describe('Se a exceção fica ativa. Padrão: true.'),
  inicio_min: z.string().regex(HORA_HHMM_REGEX).nullable().optional().describe('Início mínimo permitido neste dia (HH:MM) ou null.'),
  inicio_max: z.string().regex(HORA_HHMM_REGEX).nullable().optional().describe('Início máximo permitido neste dia (HH:MM) ou null.'),
  fim_min: z.string().regex(HORA_HHMM_REGEX).nullable().optional().describe('Fim mínimo permitido neste dia (HH:MM) ou null.'),
  fim_max: z.string().regex(HORA_HHMM_REGEX).nullable().optional().describe('Fim máximo permitido neste dia (HH:MM) ou null.'),
  preferencia_turno_soft: z.enum(['MANHA', 'TARDE']).nullable().optional().describe('Preferência de turno para este dia (MANHA/TARDE) ou null.'),
  domingo_forcar_folga: z.boolean().optional().describe('Se true, força folga neste dia. Padrão: false.'),
})

// resumir_horas_setor
const ResumirHorasSetorSchema = z.object({
  setor_id: z.number().int().positive().describe('ID do setor. Resolva via get_context().'),
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
  tipo_contrato_id: z.number().int().positive().describe('ID do tipo de contrato. Resolva via get_context() ou consultar("tipos_contrato").'),
})

// salvar_perfil_horario
const SalvarPerfilHorarioSchema = z.object({
  id: z.number().int().positive().optional().describe('ID do perfil para atualizar. Se omitido, cria um novo.'),
  tipo_contrato_id: z.number().int().positive().optional().describe('ID do tipo de contrato (obrigatório para criação).'),
  nome: z.string().min(1).optional().describe('Nome do perfil (ex: "MANHA_08_12", "TARDE_13_20"). Obrigatório para criação.'),
  inicio_min: z.string().regex(HORA_HHMM_REGEX).optional().describe('Horário mínimo de entrada (HH:MM).'),
  inicio_max: z.string().regex(HORA_HHMM_REGEX).optional().describe('Horário máximo de entrada (HH:MM).'),
  fim_min: z.string().regex(HORA_HHMM_REGEX).optional().describe('Horário mínimo de saída (HH:MM).'),
  fim_max: z.string().regex(HORA_HHMM_REGEX).optional().describe('Horário máximo de saída (HH:MM).'),
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
        name: 'buscar_colaborador',
        description: 'Resolve colaborador por ID ou nome (case-insensitive) e retorna dados úteis + setor/contrato. Prefira esta tool antes de consultar("colaboradores").',
        parameters: toJsonSchema(BuscarColaboradorSchema)
    },
    {
        name: 'obter_regra_horario_colaborador',
        description: 'Lê a regra individual de horário de um colaborador (janela, ciclo de domingo, folga fixa, etc). Use para confirmar estado antes de alterar.',
        parameters: toJsonSchema(ObterRegraHorarioColaboradorSchema)
    },
    {
        name: 'consultar',
        description: 'Consulta dados do banco de dados. Use quando precisar de informação DETALHADA que não está no get_context. Nunca pergunte ao usuário — busque aqui. Exemplos: consultar("alocacoes", {"escala_id": 15}) para ver alocações de uma escala, consultar("excecoes", {"colaborador_id": 5}) para exceções de uma pessoa. Filtros de texto são case-insensitive.',
        parameters: toJsonSchema(ConsultarSchema)
    },
    {
        name: 'criar',
        description: 'Cria registro em: colaboradores, excecoes, demandas, tipos_contrato, setores, feriados, funcoes. Prefira tools semânticas quando existirem (ex: salvar_demanda_excecao_data). Exemplo: criar({"entidade": "excecoes", "dados": {"colaborador_id": 5, "tipo": "FERIAS", "data_inicio": "2026-03-10", "data_fim": "2026-03-24"}}).',
        parameters: toJsonSchema(CriarSchema)
    },
    {
        name: 'atualizar',
        description: 'Atualiza registro em: colaboradores, empresa, tipos_contrato, setores, demandas. Requer id do registro. Exemplo: atualizar({"entidade": "colaboradores", "id": 5, "dados": {"nome": "João Silva Atualizado"}}).',
        parameters: toJsonSchema(AtualizarSchema)
    },
    {
        name: 'deletar',
        description: 'Remove registro de: excecoes, demandas, feriados, funcoes. Requer id. Exemplo: deletar({"entidade": "excecoes", "id": 12}).',
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
        description: 'Verifica viabilidade ANTES de gerar escala. Retorna blockers e warnings. IMPORTANTE: Chame get_context() PRIMEIRO para descobrir o setor_id pelo nome. Exemplo: get_context() → encontra setor "Açougue" com id=5 → preflight({"setor_id": 5, "data_inicio": "2026-03-01", "data_fim": "2026-03-31"}).',
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
        name: 'cadastrar_lote',
        description: 'Cadastra MÚLTIPLOS registros de uma vez (batch INSERT). Use quando o usuário cola uma lista, planilha ou CSV com vários itens. Muito mais eficiente que chamar "criar" várias vezes. Aceita até 200 registros por chamada. Cada registro segue as mesmas regras e defaults da tool "criar" (ex: colaboradores recebem defaults inteligentes de sexo, contrato, etc). Retorna resumo com total criado e eventuais erros individuais.',
        parameters: toJsonSchema(CadastrarLoteSchema)
    },
    {
        name: 'salvar_regra_horario_colaborador',
        description: 'Cria/atualiza a regra individual de horário de um colaborador (janela, ciclo de domingo, folga fixa, preferências).',
        parameters: toJsonSchema(SalvarRegraHorarioColaboradorSchema)
    },
    {
        name: 'definir_janela_colaborador',
        description: 'Wrapper semântico para definir limites de horário de um colaborador (ex.: "só pode de manhã"). Usa salvar_regra_horario_colaborador por baixo.',
        parameters: toJsonSchema(DefinirJanelaColaboradorSchema)
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
    }
]

const ENTIDADES_LEITURA_PERMITIDAS = new Set([
    'colaboradores', 'setores', 'escalas', 'alocacoes', 'excecoes',
    'demandas', 'tipos_contrato', 'empresa', 'feriados', 'funcoes',
    'regra_definicao', 'regra_empresa',
    'demandas_excecao_data', 'colaborador_regra_horario_excecao_data',
    'contrato_perfis_horario', 'empresa_horario_semana', 'setor_horario_semana',
    'escala_ciclo_modelos',
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
  demandas_excecao_data: new Set([
    'id', 'setor_id', 'data', 'hora_inicio', 'hora_fim', 'min_pessoas', 'override'
  ]),
  colaborador_regra_horario_excecao_data: new Set([
    'id', 'colaborador_id', 'data', 'ativo', 'inicio_min', 'inicio_max',
    'fim_min', 'fim_max', 'preferencia_turno_soft', 'domingo_forcar_folga'
  ]),
  contrato_perfis_horario: new Set([
    'id', 'tipo_contrato_id', 'nome', 'inicio_min', 'inicio_max',
    'fim_min', 'fim_max', 'preferencia_turno_soft', 'ativo', 'ordem'
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

const CONSULTAR_MODEL_ROW_LIMIT = 50

function getConsultarRelatedTools(entidade: string): string[] {
  const mapa: Record<string, string[]> = {
    colaboradores: ['atualizar', 'ajustar_alocacao', 'cadastrar_lote'],
    setores: ['preflight', 'gerar_escala', 'consultar'],
    escalas: ['ajustar_alocacao', 'oficializar_escala', 'consultar'],
    alocacoes: ['ajustar_alocacao', 'consultar'],
    excecoes: ['criar', 'deletar', 'consultar'],
    demandas: ['criar', 'atualizar', 'consultar'],
    tipos_contrato: ['criar', 'atualizar', 'consultar'],
    regra_definicao: ['editar_regra', 'consultar'],
    regra_empresa: ['editar_regra', 'consultar'],
    demandas_excecao_data: ['salvar_demanda_excecao_data', 'consultar'],
    colaborador_regra_horario_excecao_data: ['upsert_regra_excecao_data', 'consultar'],
  }
  return mapa[entidade] ?? ['consultar']
}

function enrichConsultarRows(db: any, entidade: string, rows: Array<Record<string, any>>) {
  const setorNomeCache = new Map<number, string | undefined>()
  const contratoNomeCache = new Map<number, string | undefined>()
  const colaboradorNomeCache = new Map<number, string | undefined>()
  const regraNomeCache = new Map<string, string | undefined>()

  const getSetorNome = (id: unknown): string | undefined => {
    if (typeof id !== 'number') return undefined
    if (!setorNomeCache.has(id)) {
      const row = db.prepare('SELECT id, nome FROM setores WHERE id = ?').get(id) as { nome?: string } | undefined
      setorNomeCache.set(id, row?.nome)
    }
    return setorNomeCache.get(id)
  }

  const getContratoNome = (id: unknown): string | undefined => {
    if (typeof id !== 'number') return undefined
    if (!contratoNomeCache.has(id)) {
      const row = db.prepare('SELECT id, nome FROM tipos_contrato WHERE id = ?').get(id) as { nome?: string } | undefined
      contratoNomeCache.set(id, row?.nome)
    }
    return contratoNomeCache.get(id)
  }

  const getColaboradorNome = (id: unknown): string | undefined => {
    if (typeof id !== 'number') return undefined
    if (!colaboradorNomeCache.has(id)) {
      const row = db.prepare('SELECT id, nome FROM colaboradores WHERE id = ?').get(id) as { nome?: string } | undefined
      colaboradorNomeCache.set(id, row?.nome)
    }
    return colaboradorNomeCache.get(id)
  }

  const getRegraNome = (codigo: unknown): string | undefined => {
    if (typeof codigo !== 'string') return undefined
    if (!regraNomeCache.has(codigo)) {
      const row = db.prepare('SELECT codigo, nome FROM regra_definicao WHERE codigo = ?').get(codigo) as { nome?: string } | undefined
      regraNomeCache.set(codigo, row?.nome)
    }
    return regraNomeCache.get(codigo)
  }

  return rows.map((row) => {
    const enriched = { ...row }

    if (entidade === 'colaboradores') {
      const setorNome = getSetorNome(row.setor_id)
      const contratoNome = getContratoNome(row.tipo_contrato_id)
      if (setorNome && !('setor_nome' in enriched)) enriched.setor_nome = setorNome
      if (contratoNome && !('tipo_contrato_nome' in enriched)) enriched.tipo_contrato_nome = contratoNome
      return enriched
    }

    if (entidade === 'escalas') {
      const setorNome = getSetorNome(row.setor_id)
      if (setorNome && !('setor_nome' in enriched)) enriched.setor_nome = setorNome
      return enriched
    }

    if (entidade === 'alocacoes') {
      const colaboradorNome = getColaboradorNome(row.colaborador_id)
      if (colaboradorNome && !('colaborador_nome' in enriched)) enriched.colaborador_nome = colaboradorNome
      return enriched
    }

    if (entidade === 'excecoes') {
      const colaboradorNome = getColaboradorNome(row.colaborador_id)
      if (colaboradorNome && !('colaborador_nome' in enriched)) enriched.colaborador_nome = colaboradorNome
      return enriched
    }

    if (entidade === 'demandas' || entidade === 'funcoes') {
      const setorNome = getSetorNome(row.setor_id)
      if (setorNome && !('setor_nome' in enriched)) enriched.setor_nome = setorNome
      if ('tipo_contrato_id' in enriched) {
        const contratoNome = getContratoNome(row.tipo_contrato_id)
        if (contratoNome && !('tipo_contrato_nome' in enriched)) enriched.tipo_contrato_nome = contratoNome
      }
      return enriched
    }

    if (entidade === 'regra_empresa') {
      const regraNome = getRegraNome(row.codigo)
      if (regraNome && !('regra_nome' in enriched)) enriched.regra_nome = regraNome
      return enriched
    }

    if (entidade === 'demandas_excecao_data') {
      const setorNome = getSetorNome(row.setor_id)
      if (setorNome && !('setor_nome' in enriched)) enriched.setor_nome = setorNome
      return enriched
    }

    if (entidade === 'colaborador_regra_horario_excecao_data') {
      const colaboradorNome = getColaboradorNome(row.colaborador_id)
      if (colaboradorNome && !('colaborador_nome' in enriched)) enriched.colaborador_nome = colaboradorNome
      return enriched
    }

    return enriched
  })
}

// ==================== VALIDAÇÃO RUNTIME (Zod) ====================

const TOOL_SCHEMAS: Record<string, z.ZodTypeAny | null> = {
  get_context: null, // Sem parâmetros
  buscar_colaborador: BuscarColaboradorSchema,
  obter_regra_horario_colaborador: ObterRegraHorarioColaboradorSchema,
  consultar: ConsultarSchema,
  criar: CriarSchema,
  atualizar: AtualizarSchema,
  deletar: DeletarSchema,
  editar_regra: EditarRegraSchema,
  gerar_escala: GerarEscalaSchema,
  ajustar_alocacao: AjustarAlocacaoSchema,
  ajustar_horario: AjustarHorarioSchema,
  oficializar_escala: OficializarEscalaSchema,
  preflight: PreflightSchema,
  preflight_completo: PreflightCompletoSchema,
  diagnosticar_escala: DiagnosticarEscalaSchema,
  explicar_violacao: ExplicarViolacaoSchema,
  cadastrar_lote: CadastrarLoteSchema,
  salvar_regra_horario_colaborador: SalvarRegraHorarioColaboradorSchema,
  definir_janela_colaborador: DefinirJanelaColaboradorSchema,
  salvar_demanda_excecao_data: SalvarDemandaExcecaoDataSchema,
  upsert_regra_excecao_data: UpsertRegraExcecaoDataSchema,
  resumir_horas_setor: ResumirHorasSetorSchema,
  resetar_regras_empresa: ResetarRegrasEmpresaSchema,
  listar_perfis_horario: ListarPerfisHorarioSchema,
  salvar_perfil_horario: SalvarPerfilHorarioSchema,
  deletar_perfil_horario: DeletarPerfilHorarioSchema,
  configurar_horario_funcionamento: ConfigurarHorarioFuncionamentoSchema,
  obter_alertas: ObterAlertasSchema,
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
            const timestamp = new Date().toISOString()
            return toolOk({
                version: '1.0',
                timestamp,
                stats,
                setores,
                colaboradores,
                tipos_contrato,  // FASE 2: Discovery explícito
                escalas,
                // Compat/transição: ainda útil enquanto o prompt continua orientado ao get_context.
                instructions: 'Use this structured data to resolve names to IDs. NEVER ask the user for IDs - extract them from this context. Example: user says "Caixa" → find setor with nome="Caixa" → use its id in other tool calls. For tipo_contrato_id, find the contract in tipos_contrato array by name.',
            }, {
                summary: `Contexto carregado com ${stats.setores_ativos} setor(es), ${stats.colaboradores_ativos} colaborador(es) ativo(s) e ${escalas.length} escala(s) ativa(s).`,
                meta: {
                  tool_kind: 'discovery',
                  next_tools_hint: ['consultar', 'preflight', 'gerar_escala', 'atualizar', 'criar', 'cadastrar_lote'],
                  ids_resolvable: ['setores.id', 'colaboradores.id', 'tipos_contrato.id', 'escalas.id'],
                  refreshed_at: timestamp,
                }
            })
        } catch (e: any) {
            return toolError(
              'GET_CONTEXT_FAILED',
              `Erro ao buscar contexto: ${e.message}`,
              {
                correction: 'Verifique o banco local e tente novamente. Se o problema persistir, use uma tool mais específica para diagnosticar.',
                meta: { tool_kind: 'discovery' }
              }
            )
        }
    }

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

            const runSearch = (whereParts: string[], params: unknown[]) => {
              let sql = selectBase
              if (whereParts.length > 0) sql += ' WHERE ' + whereParts.join(' AND ')
              sql += ' ORDER BY c.ativo DESC, c.nome'
              return db.prepare(sql).all(...params) as Array<Record<string, any>>
            }

            if (typeof args.id === 'number') {
              const whereParts = ['c.id = ?']
              const params: unknown[] = [args.id]
              if (ativoApenas) whereParts.push('c.ativo = 1')
              const rows = runSearch(whereParts, params)
              if (rows.length === 0) {
                return toolError(
                  'BUSCAR_COLABORADOR_NAO_ENCONTRADO',
                  `Colaborador ${args.id} não encontrado${ativoApenas ? ' (ativo)' : ''}.`,
                  {
                    correction: 'Use get_context()/buscar_colaborador por nome para resolver um ID válido.',
                    meta: { tool_kind: 'discovery', entidade: 'colaboradores', lookup: 'id', id: args.id }
                  }
                )
              }

              const colaborador = rows[0]
              return toolOk(
                { colaborador, encontrado_por: 'id' },
                {
                  summary: `Colaborador encontrado: ${colaborador.nome} (id ${colaborador.id}).`,
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
              baseWhere.push('c.ativo = 1')
            }

            let rows: Array<Record<string, any>> = []
            let encontradoPor: 'nome_exato' | 'nome_parcial' | 'nome_auto' = 'nome_auto'

            if (modo === 'EXATO' || modo === 'AUTO') {
              rows = runSearch(
                [...baseWhere, 'c.nome = ? COLLATE NOCASE'],
                [...baseParams, nomeBusca],
              )
              if (rows.length > 0) {
                encontradoPor = 'nome_exato'
              }
            }

            if (rows.length === 0 && (modo === 'PARCIAL' || modo === 'AUTO')) {
              rows = runSearch(
                [...baseWhere, 'c.nome LIKE ? COLLATE NOCASE'],
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
            return toolOk(
              { colaborador, encontrado_por: encontradoPor },
              {
                summary: `Colaborador encontrado: ${colaborador.nome} (id ${colaborador.id}).`,
                meta: {
                  tool_kind: 'discovery',
                  entidade: 'colaboradores',
                  resolution: 'single',
                  nome_busca: nomeBusca,
                    ids_usaveis_em: ['criar', 'ajustar_alocacao', 'atualizar', 'consultar', 'salvar_regra_horario_colaborador'],
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

    if (name === 'obter_regra_horario_colaborador') {
        try {
            const { colaborador_id } = args
            const colaborador = db.prepare(`
              SELECT c.id, c.nome, c.ativo, c.setor_id, s.nome as setor_nome
              FROM colaboradores c
              LEFT JOIN setores s ON s.id = c.setor_id
              WHERE c.id = ?
            `).get(colaborador_id) as {
              id: number
              nome: string
              ativo: number
              setor_id: number
              setor_nome?: string
            } | undefined

            if (!colaborador) {
              return toolError(
                'OBTER_REGRA_HORARIO_COLABORADOR_NAO_ENCONTRADO',
                `Colaborador ${colaborador_id} não encontrado.`,
                {
                  correction: 'Use buscar_colaborador para resolver um colaborador_id válido.',
                  meta: { tool_kind: 'discovery', entidade: 'colaborador_regra_horario', colaborador_id }
                }
              )
            }

            const regra = db.prepare('SELECT * FROM colaborador_regra_horario WHERE colaborador_id = ?').get(colaborador_id) as Record<string, any> | null

            return toolOk(
              {
                colaborador,
                regra,
                configurada: Boolean(regra),
              },
              {
                summary: regra
                  ? `Regra de horário encontrada para ${colaborador.nome} (id ${colaborador.id}).`
                  : `${colaborador.nome} (id ${colaborador.id}) não possui regra individual de horário cadastrada.`,
                meta: {
                  tool_kind: 'discovery',
                  entidade: 'colaborador_regra_horario',
                  colaborador_id,
                  configurada: Boolean(regra),
                  ids_usaveis_em: ['salvar_regra_horario_colaborador', 'definir_janela_colaborador'],
                }
              }
            )
        } catch (e: any) {
            return toolError(
              'OBTER_REGRA_HORARIO_COLABORADOR_FALHOU',
              `Erro ao buscar regra de horário do colaborador: ${e.message}`,
              {
                correction: 'Tente novamente. Se persistir, confirme o colaborador_id com buscar_colaborador.',
                meta: { tool_kind: 'discovery', entidade: 'colaborador_regra_horario' }
              }
            )
        }
    }

    if (name === 'diagnosticar_escala') {
        try {
            const { escala_id } = args
            const incluirAmostras = args.incluir_amostras !== false

            const escala = db.prepare(`
              SELECT e.*, s.nome as setor_nome
              FROM escalas e
              LEFT JOIN setores s ON s.id = e.setor_id
              WHERE e.id = ?
            `).get(escala_id) as (Record<string, any> & { setor_nome?: string }) | undefined

            if (!escala) {
              return toolError(
                'DIAGNOSTICAR_ESCALA_NAO_ENCONTRADA',
                `Escala ${escala_id} não encontrada.`,
                {
                  correction: 'Use get_context ou consultar("escalas") para localizar uma escala válida.',
                  meta: { tool_kind: 'diagnostic', entidade: 'escalas', escala_id }
                }
              )
            }

            const validacao = validarEscalaV3(escala_id, db as any)
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
                if (typeof v === 'string') return `${k} = ? COLLATE NOCASE`
                return `${k} = ?`
            })
            query += ' WHERE ' + conditions.join(' AND ')
            params.push(...Object.values(filtros))
        }

        try {
            const rows = db.prepare(query).all(...params) as Array<Record<string, any>>
            const total = rows.length
            const truncated = total > CONSULTAR_MODEL_ROW_LIMIT
            const slicedRows = truncated ? rows.slice(0, CONSULTAR_MODEL_ROW_LIMIT) : rows
            const dados = enrichConsultarRows(db, entidade, slicedRows)
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
                  summary: `Consulta em ${entidade} retornou ${total} registro(s); exibindo os primeiros ${dados.length}.`,
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
                summary: total === 0
                  ? `Nenhum registro encontrado em ${entidade} com os filtros informados.`
                  : `Consulta em ${entidade} retornou ${total} registro(s).`,
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
                  '❌ Campo obrigatório: "setor_id" (number). Use get_context() para descobrir o ID do setor pelo nome.',
                  { correction: 'Resolva o setor via get_context() e envie `dados.setor_id`.' }
                )
            }

            // Validar setor existe
            const setor = db.prepare('SELECT id, nome, hora_abertura, hora_fechamento FROM setores WHERE id = ? AND ativo = 1').get(dados.setor_id) as any
            if (!setor) {
                return toolError(
                  'CRIAR_COLABORADOR_SETOR_INVALIDO',
                  `❌ Setor ${dados.setor_id} não encontrado ou inativo. Use get_context() para ver setores disponíveis.`,
                  {
                    correction: 'Escolha um setor ativo válido usando get_context().',
                    meta: { setor_id: dados.setor_id }
                  }
                )
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
                return toolError(
                  'CRIAR_EXCECAO_COLABORADOR_ID_OBRIGATORIO',
                  '❌ Campo obrigatório: "colaborador_id" (number). Use get_context() para descobrir o ID pelo nome do colaborador.',
                  { correction: 'Resolva o colaborador via get_context() e envie `dados.colaborador_id`.' }
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

        const keys = Object.keys(dados)
        const placeholders = keys.map(() => '?').join(', ')
        const values = Object.values(dados)

        try {
            const res = db.prepare(`INSERT INTO ${entidade} (${keys.join(', ')}) VALUES (${placeholders})`).run(...values)
            return toolOk(
              {
                sucesso: true,
                id: res.lastInsertRowid,
                entidade,
              },
              {
                summary: `Registro criado em ${entidade} com sucesso (id: ${String(res.lastInsertRowid)}).`,
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
            if (e.message?.includes('NOT NULL constraint')) {
                const match = e.message.match(/NOT NULL constraint failed: \w+\.(\w+)/)
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
            if (e.message?.includes('UNIQUE constraint')) {
                return toolError(
                  'CRIAR_UNIQUE_CONSTRAINT',
                  `❌ Registro duplicado: ${entidade} com esses valores únicos já existe.`,
                  {
                    correction: 'Revise os campos únicos (nome/código/etc.) e tente outro valor.',
                    meta: { entidade }
                  }
                )
            }
            if (e.message?.includes('FOREIGN KEY constraint')) {
                return toolError(
                  'CRIAR_FOREIGN_KEY',
                  '❌ Referência inválida: um dos IDs fornecidos não existe no banco. Verifique setor_id, colaborador_id, etc.',
                  {
                    correction: 'Resolva novamente os IDs via get_context() antes de criar.',
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

        const sets = Object.keys(dados).map((k: string) => `${k} = ?`).join(', ')
        const values = [...Object.values(dados), id]

        try {
            const res = db.prepare(`UPDATE ${entidade} SET ${sets} WHERE id = ?`).run(...values)
            return toolOk(
              {
                sucesso: true,
                entidade,
                id,
                changes: typeof res?.changes === 'number' ? res.changes : undefined,
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
            const res = db.prepare(`DELETE FROM ${entidade} WHERE id = ?`).run(id)
            const changes = typeof res?.changes === 'number' ? res.changes : undefined

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

        const regra = db.prepare('SELECT codigo, nome, editavel FROM regra_definicao WHERE codigo = ?').get(codigo) as { codigo: string; nome: string; editavel: number } | undefined
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

        db.prepare(`INSERT OR REPLACE INTO regra_empresa (codigo, status) VALUES (?, ?)`).run(codigo, status)
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
        const { setor_id, data_inicio, data_fim, rules_override } = args

        try {
            const solverInput = buildSolverInput(setor_id, data_inicio, data_fim, undefined, {
                rulesOverride: rules_override,
            })
            const solverResult = await runSolver(solverInput, 60_000)

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

            const escalaId = persistirSolverResult(setor_id, data_inicio, data_fim, solverResult)

            // --- Revisão pós-geração: agregar dados que o solver já calcula ---
            const deficits = (solverResult.comparacao_demanda ?? [])
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

            return toolOk(
              {
                sucesso: true,
                escala_id: escalaId,
                solver_status: solverResult.status,
                indicadores: solverResult.indicadores,
                violacoes_hard: solverResult.indicadores.violacoes_hard,
                violacoes_soft: solverResult.indicadores.violacoes_soft,
                cobertura_percent: solverResult.indicadores.cobertura_percent,
                pontuacao: solverResult.indicadores.pontuacao,
                diagnostico: solverResult.diagnostico,
                revisao,
              },
              {
                summary: `Escala ${escalaId} gerada para setor ${setor_id} (${data_inicio} até ${data_fim}). Solver: ${solverResult.status}.`,
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
        } catch (e: any) {
            return toolError(
              'GERAR_ESCALA_FALHOU',
              e.message,
              {
                correction: 'Verifique os parâmetros da geração e a disponibilidade do solver.',
                details: { sucesso: false },
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

        const existing = db.prepare(
            'SELECT id FROM alocacoes WHERE escala_id = ? AND colaborador_id = ? AND data = ?'
        ).get(escala_id, colaborador_id, data)

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
            db.prepare(
                'UPDATE alocacoes SET status = ? WHERE escala_id = ? AND colaborador_id = ? AND data = ?'
            ).run(status, escala_id, colaborador_id, data)
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

        const existing = db.prepare(
          'SELECT id, status, hora_inicio, hora_fim FROM alocacoes WHERE escala_id = ? AND colaborador_id = ? AND data = ?'
        ).get(escala_id, colaborador_id, data) as Record<string, any> | undefined

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
          db.prepare(
            'UPDATE alocacoes SET status = ?, hora_inicio = ?, hora_fim = ?, minutos = ? WHERE escala_id = ? AND colaborador_id = ? AND data = ?'
          ).run(status, hora_inicio, hora_fim, minutos, escala_id, colaborador_id, data)

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

        const escala = db.prepare('SELECT id, status, violacoes_hard FROM escalas WHERE id = ?').get(escala_id) as { id: number; status: string; violacoes_hard: number } | undefined
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

        db.prepare("UPDATE escalas SET status = 'OFICIAL' WHERE id = ?").run(escala_id)
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
                meta: { tool_kind: 'validation', next_tools_hint: ['get_context'] }
              }
            )
        }
    }

    if (name === 'preflight_completo') {
        try {
            const { setor_id, data_inicio, data_fim } = args
            const regimesOverride = normalizeRegimesOverrideForTool(args.regimes_override as any[] | undefined)

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
                const solverInput = buildSolverInput(setor_id, data_inicio, data_fim, undefined, {
                  regimesOverride,
                })
                enrichPreflightWithCapacityChecksForTool(solverInput, blockers as any, warnings as any)
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
                meta: { tool_kind: 'validation', validation_level: 'completo', next_tools_hint: ['preflight', 'get_context'] }
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

        const resultados: Array<{ indice: number; sucesso: boolean; id?: number; erro?: string }> = []
        let criados = 0

        // Cache de setores pra não buscar N vezes
        const setorCache: Record<number, { id: number; nome: string; hora_abertura: string; hora_fechamento: string } | null> = {}
        function getSetor(setorId: number) {
            if (!(setorId in setorCache)) {
                setorCache[setorId] = db.prepare(
                    'SELECT id, nome, hora_abertura, hora_fechamento FROM setores WHERE id = ? AND ativo = 1'
                ).get(setorId) as any ?? null
            }
            return setorCache[setorId]
        }

        for (let i = 0; i < registros.length; i++) {
            const dados = { ...registros[i] }

            try {
                // Aplica mesma lógica de defaults da tool 'criar'
                if (entidade === 'colaboradores') {
                    if (!dados.nome || typeof dados.nome !== 'string') {
                        resultados.push({ indice: i, sucesso: false, erro: 'nome obrigatório' })
                        continue
                    }
                    if (!dados.setor_id || typeof dados.setor_id !== 'number') {
                        resultados.push({ indice: i, sucesso: false, erro: 'setor_id obrigatório' })
                        continue
                    }

                    const setor = getSetor(dados.setor_id)
                    if (!setor) {
                        resultados.push({ indice: i, sucesso: false, erro: `setor_id ${dados.setor_id} não encontrado` })
                        continue
                    }

                    if (!dados.sexo) dados.sexo = 'M'
                    if (!dados.tipo_contrato_id) dados.tipo_contrato_id = 1
                    if (!dados.tipo_trabalhador) dados.tipo_trabalhador = 'regular'
                    if (!dados.data_nascimento) {
                        const idade = 25 + Math.floor(Math.random() * 15)
                        const nasc = new Date()
                        nasc.setFullYear(nasc.getFullYear() - idade)
                        dados.data_nascimento = nasc.toISOString().split('T')[0]
                    }
                    if (!dados.hora_inicio_min) dados.hora_inicio_min = setor.hora_abertura
                    if (!dados.hora_fim_max) dados.hora_fim_max = setor.hora_fechamento
                    if (!dados.ativo) dados.ativo = 1
                    if (!dados.horas_semanais) {
                        const contrato = db.prepare('SELECT horas_semanais FROM tipos_contrato WHERE id = ?').get(dados.tipo_contrato_id) as { horas_semanais: number } | undefined
                        dados.horas_semanais = contrato?.horas_semanais ?? 44
                    }
                }

                if (entidade === 'excecoes') {
                    if (!dados.colaborador_id || !dados.tipo || !dados.data_inicio || !dados.data_fim) {
                        resultados.push({ indice: i, sucesso: false, erro: 'campos obrigatórios: colaborador_id, tipo, data_inicio, data_fim' })
                        continue
                    }
                    if (!dados.observacao) dados.observacao = dados.tipo
                }

                const keys = Object.keys(dados)
                const placeholders = keys.map(() => '?').join(', ')
                const values = Object.values(dados)
                const res = db.prepare(
                    `INSERT INTO ${entidade} (${keys.join(', ')}) VALUES (${placeholders})`
                ).run(...values)

                resultados.push({ indice: i, sucesso: true, id: res.lastInsertRowid as number })
                criados++
            } catch (e: any) {
                resultados.push({ indice: i, sucesso: false, erro: e.message })
            }
        }

        const erros = resultados.filter(r => !r.sucesso)
        const idsCriados = resultados.filter(r => r.sucesso).map(r => r.id)
        const payload = {
            sucesso: erros.length === 0,
            entidade,
            total_enviado: registros.length,
            total_criado: criados,
            total_erros: erros.length,
            erros: erros.length > 0 ? erros : undefined,
            ids_criados: idsCriados,
        }

        if (erros.length === 0) {
            return toolOk(payload, {
              summary: `Cadastro em lote concluído em ${entidade}: ${criados}/${registros.length} registro(s) criados.`,
              meta: {
                tool_kind: 'action',
                action: 'batch-create',
                entidade,
                partial_failure: false,
              }
            })
        }

        if (criados > 0) {
            return toolOk(payload, {
              summary: `Cadastro em lote parcial em ${entidade}: ${criados} criado(s), ${erros.length} erro(s).`,
              meta: {
                tool_kind: 'action',
                action: 'batch-create',
                entidade,
                partial_failure: true,
              }
            })
        }

        return toolError(
          'CADASTRAR_LOTE_FALHOU_TOTAL',
          `Nenhum registro foi criado em lote para '${entidade}'. ${erros.length} erro(s) encontrados.`,
          {
            correction: 'Revise os registros com erro e tente novamente.',
            details: payload,
            meta: {
              tool_kind: 'action',
              action: 'batch-create',
              entidade,
              partial_failure: false,
            }
          }
        )
    }

    if (name === 'salvar_regra_horario_colaborador') {
        const {
          colaborador_id,
          ativo,
          perfil_horario_id,
          inicio_min,
          inicio_max,
          fim_min,
          fim_max,
          preferencia_turno_soft,
          domingo_ciclo_trabalho,
          domingo_ciclo_folga,
          folga_fixa_dia_semana,
        } = args

        const colab = db.prepare('SELECT id, nome, setor_id, ativo FROM colaboradores WHERE id = ?').get(colaborador_id) as
          { id: number; nome: string; setor_id: number; ativo: number } | undefined

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

        const timePairs: Array<[string, unknown]> = [
          ['inicio_min', inicio_min],
          ['inicio_max', inicio_max],
          ['fim_min', fim_min],
          ['fim_max', fim_max],
        ]
        for (const [label, value] of timePairs) {
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

        const comparePair = (aLabel: string, aVal: unknown, bLabel: string, bVal: unknown) => {
          if (typeof aVal === 'string' && typeof bVal === 'string') {
            if (minutesBetweenTimes(aVal, bVal) <= 0) {
              return toolError(
                'SALVAR_REGRA_HORARIO_COLABORADOR_JANELA_INVALIDA',
                `Intervalo inválido em ${aLabel}/${bLabel}: ${aVal} -> ${bVal}.`,
                {
                  correction: `Garanta que ${bLabel} seja maior que ${aLabel} no mesmo dia.`,
                  meta: { tool_kind: 'action', action: 'save-collaborator-rule', colaborador_id, aLabel, bLabel }
                }
              )
            }
          }
          return null
        }

        const invalidPair =
          comparePair('inicio_min', inicio_min, 'inicio_max', inicio_max) ??
          comparePair('fim_min', fim_min, 'fim_max', fim_max) ??
          comparePair('inicio_min', inicio_min, 'fim_max', fim_max)
        if (invalidPair) return invalidPair

        try {
          const existe = db.prepare('SELECT id FROM colaborador_regra_horario WHERE colaborador_id = ?').get(colaborador_id) as { id: number } | undefined
          if (existe) {
            db.prepare(`
              UPDATE colaborador_regra_horario SET
                ativo = COALESCE(?, ativo),
                perfil_horario_id = ?,
                inicio_min = ?, inicio_max = ?, fim_min = ?, fim_max = ?,
                preferencia_turno_soft = ?,
                domingo_ciclo_trabalho = COALESCE(?, domingo_ciclo_trabalho),
                domingo_ciclo_folga = COALESCE(?, domingo_ciclo_folga),
                folga_fixa_dia_semana = ?
              WHERE colaborador_id = ?
            `).run(
              ativo !== undefined ? (ativo ? 1 : 0) : null,
              perfil_horario_id ?? null,
              inicio_min ?? null,
              inicio_max ?? null,
              fim_min ?? null,
              fim_max ?? null,
              preferencia_turno_soft ?? null,
              domingo_ciclo_trabalho ?? null,
              domingo_ciclo_folga ?? null,
              folga_fixa_dia_semana ?? null,
              colaborador_id,
            )
          } else {
            db.prepare(`
              INSERT INTO colaborador_regra_horario
                (colaborador_id, ativo, perfil_horario_id, inicio_min, inicio_max, fim_min, fim_max, preferencia_turno_soft, domingo_ciclo_trabalho, domingo_ciclo_folga, folga_fixa_dia_semana)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
              colaborador_id,
              ativo !== undefined ? (ativo ? 1 : 0) : 1,
              perfil_horario_id ?? null,
              inicio_min ?? null,
              inicio_max ?? null,
              fim_min ?? null,
              fim_max ?? null,
              preferencia_turno_soft ?? null,
              domingo_ciclo_trabalho ?? 2,
              domingo_ciclo_folga ?? 1,
              folga_fixa_dia_semana ?? null,
            )
          }

          const regra = db.prepare('SELECT * FROM colaborador_regra_horario WHERE colaborador_id = ?').get(colaborador_id) as Record<string, any> | null
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
                ids_usaveis_em: ['obter_regra_horario_colaborador', 'definir_janela_colaborador', 'gerar_escala', 'preflight_completo'],
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

    if (name === 'definir_janela_colaborador') {
        const {
          colaborador_id,
          inicio_min,
          inicio_max,
          fim_min,
          fim_max,
        } = args
        const ativo = args.ativo !== false

        const base = await executeTool('salvar_regra_horario_colaborador', {
          colaborador_id,
          ativo,
          inicio_min,
          inicio_max,
          fim_min,
          fim_max,
        })

        if (base?.status !== 'ok') {
          return {
            ...base,
            _meta: {
              ...(base?._meta ?? {}),
              semantic_wrapper: 'definir_janela_colaborador',
              wrapped_tool: 'salvar_regra_horario_colaborador',
            },
          }
        }

        const partes = [
          inicio_min ? `início >= ${inicio_min}` : null,
          inicio_max ? `início <= ${inicio_max}` : null,
          fim_min ? `fim >= ${fim_min}` : null,
          fim_max ? `fim <= ${fim_max}` : null,
        ].filter(Boolean)

        return toolOk(
          {
            sucesso: true,
            colaborador: base.colaborador,
            regra: base.regra,
            janela_definida: { inicio_min, inicio_max, fim_min, fim_max, ativo },
          },
          {
            summary: `Janela de horário definida para ${base.colaborador?.nome ?? `colaborador ${colaborador_id}`}: ${partes.join(', ')}.`,
            meta: {
              tool_kind: 'action',
              action: 'set-collaborator-window',
              colaborador_id,
              wrapped_tool: 'salvar_regra_horario_colaborador',
              next_tools_hint: ['obter_regra_horario_colaborador', 'preflight_completo', 'gerar_escala'],
            }
          }
        )
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
        const regra = db.prepare('SELECT nome, descricao FROM regra_definicao WHERE codigo = ?').get(codigo_regra) as { nome: string; descricao: string } | undefined
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
            const override = args.override ? 1 : 0

            const setor = db.prepare('SELECT id, nome FROM setores WHERE id = ? AND ativo = 1').get(setor_id) as { id: number; nome: string } | undefined
            if (!setor) {
                return toolError(
                  'SALVAR_DEMANDA_EXCECAO_SETOR_INVALIDO',
                  `Setor ${setor_id} não encontrado ou inativo.`,
                  {
                    correction: 'Use get_context() para resolver o setor_id correto.',
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

            const res = db.prepare(
              'INSERT INTO demandas_excecao_data (setor_id, data, hora_inicio, hora_fim, min_pessoas, override) VALUES (?, ?, ?, ?, ?, ?)'
            ).run(setor_id, data, hora_inicio, hora_fim, min_pessoas, override)

            const registro = db.prepare('SELECT * FROM demandas_excecao_data WHERE id = ?').get(res.lastInsertRowid) as Record<string, any>

            return toolOk(
              {
                sucesso: true,
                setor: { id: setor.id, nome: setor.nome },
                registro,
              },
              {
                summary: `Demanda excepcional criada para ${setor.nome} em ${data}: ${min_pessoas} pessoa(s) das ${hora_inicio} às ${hora_fim}.`,
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

            const colab = db.prepare('SELECT id, nome, setor_id FROM colaboradores WHERE id = ?').get(colaborador_id) as { id: number; nome: string; setor_id: number } | undefined
            if (!colab) {
                return toolError(
                  'UPSERT_REGRA_EXCECAO_COLAB_NAO_ENCONTRADO',
                  `Colaborador ${colaborador_id} não encontrado.`,
                  {
                    correction: 'Resolva o colaborador via buscar_colaborador ou get_context().',
                    meta: { tool_kind: 'action', action: 'upsert-date-exception-rule', colaborador_id }
                  }
                )
            }

            const timeFields = ['inicio_min', 'inicio_max', 'fim_min', 'fim_max'] as const
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

            const existing = db.prepare(
              'SELECT id FROM colaborador_regra_horario_excecao_data WHERE colaborador_id = ? AND data = ?'
            ).get(colaborador_id, data) as { id: number } | undefined

            const ativo = args.ativo !== false ? 1 : 0
            const domingo_forcar_folga = args.domingo_forcar_folga ? 1 : 0

            if (existing) {
                db.prepare(`
                  UPDATE colaborador_regra_horario_excecao_data SET
                    ativo = ?,
                    inicio_min = COALESCE(?, inicio_min),
                    inicio_max = COALESCE(?, inicio_max),
                    fim_min = COALESCE(?, fim_min),
                    fim_max = COALESCE(?, fim_max),
                    preferencia_turno_soft = COALESCE(?, preferencia_turno_soft),
                    domingo_forcar_folga = ?
                  WHERE id = ?
                `).run(
                  ativo,
                  args.inicio_min ?? null,
                  args.inicio_max ?? null,
                  args.fim_min ?? null,
                  args.fim_max ?? null,
                  args.preferencia_turno_soft ?? null,
                  domingo_forcar_folga,
                  existing.id,
                )
            } else {
                db.prepare(`
                  INSERT INTO colaborador_regra_horario_excecao_data
                    (colaborador_id, data, ativo, inicio_min, inicio_max, fim_min, fim_max, preferencia_turno_soft, domingo_forcar_folga)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                `).run(
                  colaborador_id,
                  data,
                  ativo,
                  args.inicio_min ?? null,
                  args.inicio_max ?? null,
                  args.fim_min ?? null,
                  args.fim_max ?? null,
                  args.preferencia_turno_soft ?? null,
                  domingo_forcar_folga,
                )
            }

            const regra = db.prepare(
              'SELECT * FROM colaborador_regra_horario_excecao_data WHERE colaborador_id = ? AND data = ?'
            ).get(colaborador_id, data) as Record<string, any>

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
                  next_tools_hint: ['obter_regra_horario_colaborador', 'gerar_escala'],
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

            const setor = db.prepare('SELECT id, nome FROM setores WHERE id = ? AND ativo = 1').get(setor_id) as { id: number; nome: string } | undefined
            if (!setor) {
                return toolError(
                  'RESUMIR_HORAS_SETOR_INVALIDO',
                  `Setor ${setor_id} não encontrado ou inativo.`,
                  {
                    correction: 'Use get_context() para resolver o setor_id correto.',
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

            query += ' GROUP BY c.id ORDER BY total_minutos DESC'

            const rows = db.prepare(query).all(...params) as Array<{
              id: number
              nome: string
              tipo_contrato_id: number
              dias_trabalho: number
              total_minutos: number
              dias_folga: number
            }>

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
            const count = (db.prepare('SELECT COUNT(*) as count FROM regra_empresa').get() as { count: number }).count

            if (count === 0) {
                return toolOk(
                  { sucesso: true, regras_removidas: 0, mensagem: 'Nenhuma regra customizada para resetar.' },
                  {
                    summary: 'Nenhuma regra customizada existia — já estava no padrão.',
                    meta: { tool_kind: 'action', action: 'reset-enterprise-rules', noop: true }
                  }
                )
            }

            db.prepare('DELETE FROM regra_empresa').run()

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
            const contrato = db.prepare('SELECT id, nome FROM tipos_contrato WHERE id = ?').get(tipo_contrato_id) as { id: number; nome: string } | undefined
            if (!contrato) {
                return toolError('CONTRATO_NAO_ENCONTRADO', `Tipo de contrato ${tipo_contrato_id} não encontrado.`, {
                  correction: 'Use get_context() ou consultar("tipos_contrato") para ver os IDs válidos.',
                  meta: { tool_kind: 'discovery' }
                })
            }
            const perfis = db.prepare('SELECT * FROM contrato_perfis_horario WHERE tipo_contrato_id = ? ORDER BY ordem, id').all(tipo_contrato_id)
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
        const { id, tipo_contrato_id, nome, inicio_min, inicio_max, fim_min, fim_max, preferencia_turno_soft, ordem, ativo } = args
        try {
            if (id) {
                // UPDATE
                const existing = db.prepare('SELECT id FROM contrato_perfis_horario WHERE id = ?').get(id)
                if (!existing) {
                    return toolError('PERFIL_NAO_ENCONTRADO', `Perfil ${id} não encontrado.`, { correction: 'Use listar_perfis_horario para ver os IDs válidos.', meta: { tool_kind: 'action' } })
                }
                const fields: string[] = []
                const values: unknown[] = []
                if (nome !== undefined) { fields.push('nome = ?'); values.push(nome) }
                if (inicio_min !== undefined) { fields.push('inicio_min = ?'); values.push(inicio_min) }
                if (inicio_max !== undefined) { fields.push('inicio_max = ?'); values.push(inicio_max) }
                if (fim_min !== undefined) { fields.push('fim_min = ?'); values.push(fim_min) }
                if (fim_max !== undefined) { fields.push('fim_max = ?'); values.push(fim_max) }
                if (preferencia_turno_soft !== undefined) { fields.push('preferencia_turno_soft = ?'); values.push(preferencia_turno_soft) }
                if (ordem !== undefined) { fields.push('ordem = ?'); values.push(ordem) }
                if (ativo !== undefined) { fields.push('ativo = ?'); values.push(ativo ? 1 : 0) }
                if (fields.length === 0) {
                    return toolError('PERFIL_NADA_PARA_ATUALIZAR', 'Nenhum campo informado para atualizar.', { correction: 'Informe ao menos um campo: nome, inicio_min, inicio_max, fim_min, fim_max, preferencia_turno_soft, ordem ou ativo.', meta: { tool_kind: 'action' } })
                }
                values.push(id)
                db.prepare(`UPDATE contrato_perfis_horario SET ${fields.join(', ')} WHERE id = ?`).run(...values)
                const updated = db.prepare('SELECT * FROM contrato_perfis_horario WHERE id = ?').get(id)
                return toolOk(
                  { perfil: updated, operacao: 'atualizado' },
                  { summary: `Perfil ${id} atualizado.`, meta: { tool_kind: 'action' } }
                )
            } else {
                // CREATE
                if (!tipo_contrato_id || !nome || !inicio_min || !inicio_max || !fim_min || !fim_max) {
                    return toolError('PERFIL_CAMPOS_OBRIGATORIOS', 'Para criar: tipo_contrato_id, nome, inicio_min, inicio_max, fim_min, fim_max são obrigatórios.', { correction: 'Inclua todos os campos obrigatórios. Horários no formato HH:MM (ex: "08:00").', meta: { tool_kind: 'action' } })
                }
                const result = db.prepare(`
                  INSERT INTO contrato_perfis_horario (tipo_contrato_id, nome, inicio_min, inicio_max, fim_min, fim_max, preferencia_turno_soft, ordem)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                `).run(tipo_contrato_id, nome, inicio_min, inicio_max, fim_min, fim_max, preferencia_turno_soft ?? null, ordem ?? 0)
                const created = db.prepare('SELECT * FROM contrato_perfis_horario WHERE id = ?').get(result.lastInsertRowid)
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
            const existing = db.prepare('SELECT id, nome FROM contrato_perfis_horario WHERE id = ?').get(id) as { id: number; nome: string } | undefined
            if (!existing) {
                return toolError('PERFIL_NAO_ENCONTRADO', `Perfil ${id} não encontrado.`, { correction: 'Use listar_perfis_horario para ver os IDs válidos.', meta: { tool_kind: 'action' } })
            }
            db.prepare('DELETE FROM contrato_perfis_horario WHERE id = ?').run(id)
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
                db.prepare(`
                  UPDATE empresa_horario_semana
                  SET ativo = ?, hora_abertura = ?, hora_fechamento = ?
                  WHERE dia_semana = ?
                `).run(diaAtivo ? 1 : 0, hora_abertura ?? '08:00', hora_fechamento ?? '22:00', dia_semana)
                const result = db.prepare('SELECT * FROM empresa_horario_semana WHERE dia_semana = ?').get(dia_semana)
                return toolOk(
                  { horario: result, nivel: 'empresa', operacao: 'atualizado' },
                  { summary: `Horário da empresa para ${dia_semana}: ${diaAtivo ? `${hora_abertura}–${hora_fechamento}` : 'FECHADO'}.`, meta: { tool_kind: 'action' } }
                )
            } else {
                // setor
                if (!setor_id) {
                    return toolError('HORARIO_SETOR_ID', 'setor_id é obrigatório quando nivel="setor".', { correction: 'Informe setor_id. Use consultar("setores") para ver os IDs válidos.', meta: { tool_kind: 'action' } })
                }
                const setor = db.prepare('SELECT id, nome FROM setores WHERE id = ?').get(setor_id) as { id: number; nome: string } | undefined
                if (!setor) {
                    return toolError('SETOR_NAO_ENCONTRADO', `Setor ${setor_id} não encontrado.`, { correction: 'Use consultar("setores") para ver os IDs válidos.', meta: { tool_kind: 'action' } })
                }
                db.prepare(`
                  INSERT INTO setor_horario_semana (setor_id, dia_semana, ativo, usa_padrao, hora_abertura, hora_fechamento)
                  VALUES (?, ?, ?, ?, ?, ?)
                  ON CONFLICT(setor_id, dia_semana) DO UPDATE SET
                    ativo = excluded.ativo,
                    usa_padrao = excluded.usa_padrao,
                    hora_abertura = excluded.hora_abertura,
                    hora_fechamento = excluded.hora_fechamento
                `).run(setor_id, dia_semana, diaAtivo ? 1 : 0, usa_padrao ? 1 : 0, hora_abertura ?? '08:00', hora_fechamento ?? '22:00')
                const result = db.prepare('SELECT * FROM setor_horario_semana WHERE setor_id = ? AND dia_semana = ?').get(setor_id, dia_semana)
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
            const alertas: Array<{ tipo: string; severidade: string; setor_id?: number; setor_nome?: string; escala_id?: number; mensagem: string }> = []

            // 1) Setores sem escala ou com poucos colaboradores
            const setoresQ = filtroSetorId
              ? db.prepare('SELECT id, nome FROM setores WHERE ativo = 1 AND id = ?').all(filtroSetorId) as Array<{ id: number; nome: string }>
              : db.prepare('SELECT id, nome FROM setores WHERE ativo = 1').all() as Array<{ id: number; nome: string }>

            for (const s of setoresQ) {
                const colabCount = (db.prepare('SELECT COUNT(*) as c FROM colaboradores WHERE setor_id = ? AND ativo = 1').get(s.id) as { c: number }).c
                if (colabCount < 2) {
                    alertas.push({ tipo: 'POUCOS_COLABORADORES', severidade: 'WARNING', setor_id: s.id, setor_nome: s.nome, mensagem: `${s.nome}: apenas ${colabCount} colaborador(es) ativo(s).` })
                }

                const temEscala = db.prepare("SELECT COUNT(*) as c FROM escalas WHERE setor_id = ? AND status IN ('RASCUNHO', 'OFICIAL')").get(s.id) as { c: number }
                if (temEscala.c === 0) {
                    alertas.push({ tipo: 'SEM_ESCALA', severidade: 'INFO', setor_id: s.id, setor_nome: s.nome, mensagem: `${s.nome}: nenhuma escala gerada.` })
                }
            }

            // 2) Escalas RASCUNHO com violações HARD
            const rascunhosHard = filtroSetorId
              ? db.prepare("SELECT e.id, e.setor_id, s.nome as setor_nome, e.violacoes_hard, e.data_inicio, e.data_fim FROM escalas e JOIN setores s ON e.setor_id = s.id WHERE e.status = 'RASCUNHO' AND e.violacoes_hard > 0 AND e.setor_id = ?").all(filtroSetorId) as any[]
              : db.prepare("SELECT e.id, e.setor_id, s.nome as setor_nome, e.violacoes_hard, e.data_inicio, e.data_fim FROM escalas e JOIN setores s ON e.setor_id = s.id WHERE e.status = 'RASCUNHO' AND e.violacoes_hard > 0").all() as any[]

            for (const e of rascunhosHard) {
                alertas.push({ tipo: 'VIOLACOES_HARD_PENDENTES', severidade: 'CRITICAL', setor_id: e.setor_id, setor_nome: e.setor_nome, escala_id: e.id, mensagem: `${e.setor_nome}: escala ${e.data_inicio}–${e.data_fim} tem ${e.violacoes_hard} violação(ões) HARD — não pode oficializar.` })
            }

            // 3) Escalas desatualizadas (input_hash diverge dos dados atuais)
            const rascunhos = filtroSetorId
              ? db.prepare("SELECT e.id, e.setor_id, s.nome as setor_nome, e.input_hash, e.simulacao_config_json, e.data_inicio, e.data_fim FROM escalas e JOIN setores s ON e.setor_id = s.id WHERE e.status = 'RASCUNHO' AND e.input_hash IS NOT NULL AND e.setor_id = ?").all(filtroSetorId) as any[]
              : db.prepare("SELECT e.id, e.setor_id, s.nome as setor_nome, e.input_hash, e.simulacao_config_json, e.data_inicio, e.data_fim FROM escalas e JOIN setores s ON e.setor_id = s.id WHERE e.status = 'RASCUNHO' AND e.input_hash IS NOT NULL").all() as any[]

            for (const e of rascunhos) {
                try {
                    const currentInput = buildSolverInput(e.setor_id, e.data_inicio, e.data_fim)
                    const currentHash = computeSolverScenarioHash(currentInput)
                    if (currentHash !== e.input_hash) {
                        alertas.push({ tipo: 'ESCALA_DESATUALIZADA', severidade: 'WARNING', setor_id: e.setor_id, setor_nome: e.setor_nome, escala_id: e.id, mensagem: `${e.setor_nome}: escala ${e.data_inicio}–${e.data_fim} está desatualizada — dados mudaram desde a geração. Regere antes de oficializar.` })
                    }
                } catch { /* skip — build pode falhar se dados mudaram drasticamente */ }
            }

            // 4) Exceções prestes a expirar (próximos 7 dias)
            const expirando = db.prepare(`
              SELECT e.tipo, e.data_fim, c.nome as colab_nome, c.setor_id, s.nome as setor_nome
              FROM excecoes e
              JOIN colaboradores c ON e.colaborador_id = c.id
              JOIN setores s ON c.setor_id = s.id
              WHERE c.ativo = 1 AND e.data_fim >= date('now') AND e.data_fim <= date('now', '+7 days')
              ${filtroSetorId ? 'AND c.setor_id = ?' : ''}
              ORDER BY e.data_fim
              LIMIT 10
            `).all(...(filtroSetorId ? [filtroSetorId] : [])) as any[]

            for (const ex of expirando) {
                alertas.push({ tipo: 'EXCECAO_EXPIRANDO', severidade: 'INFO', setor_id: ex.setor_id, setor_nome: ex.setor_nome, mensagem: `${ex.colab_nome} (${ex.setor_nome}): ${ex.tipo} termina em ${ex.data_fim}.` })
            }

            return toolOk(
              { alertas, total: alertas.length },
              { summary: alertas.length > 0 ? `${alertas.length} alerta(s) ativo(s).` : 'Nenhum alerta ativo.', meta: { tool_kind: 'discovery' } }
            )
        } catch (e: any) {
            return toolError('OBTER_ALERTAS_FALHOU', `Erro: ${e.message}`, { correction: 'Tente sem setor_id para alertas gerais, ou verifique se o setor_id existe.', meta: { tool_kind: 'discovery' } })
        }
    }

    return toolError('UNKNOWN_TOOL', `Tool '${name}' não reconhecida.`, {
      correction: 'Use apenas tools declaradas em IA_TOOLS.',
      meta: { tool_name: name }
    })
}
