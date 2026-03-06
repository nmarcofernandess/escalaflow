import type {
  DiaSemana,
  Turno,
  StatusEscala,
  TipoExcecao,
  StatusAlocacao,
  Severidade,
  TipoTrabalhador,
  TipoFeriado,
  AcaoMotor,
  AntipatternTier,
  RegimeEscala,
} from './constants'

// ============================================================================
// ENTIDADES — v2 base + campos v3.1
// ============================================================================

export interface Empresa {
  id: number
  nome: string
  cnpj: string
  telefone: string
  corte_semanal: string
  tolerancia_semanal_min: number
  // v3.1
  min_intervalo_almoco_min: number        // default 60
  usa_cct_intervalo_reduzido: boolean     // default true
  grid_minutos: number                    // default 30, fixo
}

export interface TipoContrato {
  id: number
  nome: string
  horas_semanais: number
  regime_escala: RegimeEscala
  dias_trabalho: number
  max_minutos_dia: number
  protegido_sistema: boolean
}

export interface Setor {
  id: number
  nome: string
  icone: string | null
  hora_abertura: string
  hora_fechamento: string
  regime_escala: RegimeEscala
  ativo: boolean
}

export interface EmpresaHorarioSemana {
  id: number
  dia_semana: DiaSemana
  ativo: boolean
  hora_abertura: string
  hora_fechamento: string
}

export interface Demanda {
  id: number
  setor_id: number
  dia_semana: DiaSemana | null
  hora_inicio: string
  hora_fim: string
  min_pessoas: number                     // v3.1: semantica = target planejado
  // v3.1
  override: boolean                       // default false
}

export interface Colaborador {
  id: number
  setor_id: number
  tipo_contrato_id: number
  nome: string
  sexo: 'M' | 'F'
  horas_semanais: number
  rank: number
  prefere_turno: Turno | null
  evitar_dia_semana: DiaSemana | null
  ativo: boolean
  // v3.1
  tipo_trabalhador: TipoTrabalhador       // default 'CLT'
  funcao_id: number | null                // FK funcoes
}

export interface Excecao {
  id: number
  colaborador_id: number
  data_inicio: string
  data_fim: string
  tipo: TipoExcecao
  observacao: string | null
}

export interface Escala {
  id: number
  setor_id: number
  data_inicio: string
  data_fim: string
  status: StatusEscala
  pontuacao: number | null
  criada_em: string
  input_hash?: string | null
  simulacao_config_json?: string | null
}

/** Alocacao v2 — mantida pra compat do frontend ate S4 */
export interface Alocacao {
  id: number
  escala_id: number
  colaborador_id: number
  data: string
  status: StatusAlocacao
  hora_inicio: string | null
  hora_fim: string | null
  minutos: number | null
  // v3.1 campos opcionais (presentes se gerado pelo motor v3)
  minutos_trabalho?: number | null
  hora_almoco_inicio?: string | null
  hora_almoco_fim?: string | null
  minutos_almoco?: number | null
  intervalo_15min?: boolean
  funcao_id?: number | null
  // v19: H7 campos de intervalo 15min
  hora_intervalo_inicio?: string | null
  hora_intervalo_fim?: string | null
  hora_real_inicio?: string | null
  hora_real_fim?: string | null
}

// ============================================================================
// ENTIDADES NOVAS v3.1
// ============================================================================

export interface Funcao {
  id: number
  setor_id: number
  apelido: string
  tipo_contrato_id: number
  ativo: boolean
  ordem: number
  // v4
  cor_hex: string | null
}

export interface Feriado {
  id: number
  data: string                            // "2026-12-25"
  nome: string
  tipo: TipoFeriado
  proibido_trabalhar: boolean
  cct_autoriza: boolean
}

export interface SetorHorarioSemana {
  id: number
  setor_id: number
  dia_semana: DiaSemana
  ativo: boolean
  usa_padrao: boolean
  hora_abertura: string
  hora_fechamento: string
}

export interface EscalaDecisao {
  id: number
  escala_id: number
  colaborador_id: number | null
  data: string
  acao: AcaoMotor
  razao: string
  alternativas_tentadas: number
}

export interface EscalaComparacaoDemanda {
  id: number
  escala_id: number
  data: string
  hora_inicio: string
  hora_fim: string
  planejado: number
  executado: number
  delta: number
  override: boolean
  justificativa: string | null
}

// ============================================================================
// ENTIDADES NOVAS v4 — PRD Motor Python + Regras Colaborador + Grid 15min
// ============================================================================

export interface PerfilHorarioContrato {
  id: number
  tipo_contrato_id: number
  nome: string
  ativo: boolean
  inicio: string | null           // HH:MM — entrada fixa (motor forca slot exato)
  fim: string | null              // HH:MM — saida maxima (motor nao aloca alem)
  preferencia_turno_soft: Turno | null
  ordem: number
  horas_semanais: number | null   // override de horas do contrato (ex: perfis estagiario)
  max_minutos_dia: number | null  // override de max diario do contrato
}

export interface RegraHorarioColaborador {
  id: number
  colaborador_id: number
  dia_semana_regra: DiaSemana | null  // null = padrão (todos os dias), 'SEG'..'DOM' = dia específico
  ativo: boolean
  perfil_horario_id: number | null
  inicio: string | null           // HH:MM — entrada fixa
  fim: string | null              // HH:MM — saida maxima
  preferencia_turno_soft: Turno | null
  domingo_ciclo_trabalho: number  // default 2 (só na regra padrão)
  domingo_ciclo_folga: number     // default 1 (só na regra padrão)
  folga_fixa_dia_semana: DiaSemana | null  // só na regra padrão
  folga_variavel_dia_semana: DiaSemana | null  // só na regra padrão (SEG-SAB, condicional ao domingo)
}

export interface RegraHorarioColaboradorExcecaoData {
  id: number
  colaborador_id: number
  data: string
  ativo: boolean
  inicio: string | null           // HH:MM — entrada fixa nesta data
  fim: string | null              // HH:MM — saida maxima nesta data
  preferencia_turno_soft: Turno | null
  domingo_forcar_folga: boolean
}

export interface DemandaExcecaoData {
  id: number
  setor_id: number
  data: string
  hora_inicio: string
  hora_fim: string
  min_pessoas: number
  override: boolean
}

export interface ModeloCicloEscala {
  id: number
  setor_id: number
  nome: string
  semanas_no_ciclo: number
  ativo: boolean
  origem_escala_id: number | null
  criado_em: string
}

export interface ModeloCicloEscalaItem {
  id: number
  ciclo_modelo_id: number
  semana_idx: number
  colaborador_id: number
  dia_semana: DiaSemana
  trabalha: boolean
  ancora_domingo: boolean
  prioridade: number
}

// ============================================================================
// COMPOSTOS — Motor v3
// ============================================================================

export interface PinnedCell {
  colaborador_id: number
  data: string
  status?: StatusAlocacao
  hora_inicio?: string | null
  hora_fim?: string | null
}

export interface DecisaoMotor {
  colaborador_id: number
  colaborador_nome: string
  data: string
  acao: AcaoMotor
  razao: string
  alternativas_tentadas: number
}

export interface SlotComparacao {
  data: string
  hora_inicio: string
  hora_fim: string
  planejado: number
  executado: number
  delta: number
  override: boolean
  justificativa?: string
}

export interface AntipatternViolacao {
  tier: AntipatternTier
  antipattern: string
  nome_industria: string
  peso: number
  colaborador_id: number
  data?: string
  semana?: number
  mensagem_rh: string
  sugestao?: string
}

export interface GerarEscalaInput {
  setor_id: number
  data_inicio: string
  data_fim: string
  pinned_cells?: PinnedCell[]
  regimes_override?: Array<{
    colaborador_id: number
    regime_escala: RegimeEscala
  }>
}

export interface GerarEscalaOutput {
  sucesso: boolean
  escala?: EscalaCompletaV3
  erro?: {
    tipo: 'PREFLIGHT' | 'CONSTRAINT'
    regra: string
    mensagem: string
    sugestoes: string[]
    colaborador_id?: number
    data?: string
  }
}

export interface EscalaPreflightIssue {
  codigo: string
  severidade: 'BLOCKER' | 'WARNING'
  mensagem: string
  detalhe?: string
}

export interface EscalaPreflightResult {
  ok: boolean
  blockers: EscalaPreflightIssue[]
  warnings: EscalaPreflightIssue[]
  summary: {
    setor_id: number
    data_inicio: string
    data_fim: string
    colaboradores_ativos: number
    demandas_cadastradas: number
    feriados_no_periodo: number
    demanda_zero_fallback: boolean
  }
}

export interface EscalaCompletaV3 {
  escala: Escala
  alocacoes: Alocacao[]
  indicadores: Indicadores
  violacoes: Violacao[]
  antipatterns: AntipatternViolacao[]
  decisoes: DecisaoMotor[]
  comparacao_demanda: SlotComparacao[]
  diagnostico?: DiagnosticoSolver
  timing?: {
    fase0_ms: number
    fase1_ms: number
    fase2_ms: number
    fase3_ms: number
    fase4_ms: number
    fase5_ms: number
    fase6_ms: number
    fase7_ms: number
    total_ms: number
    otimizacao_ms?: number
    otimizacao_moves?: number
    otimizacao_neighborhoods?: Record<string, { attempts: number; accepted: number }>
    otimizacao_temperature?: number
    otimizacao_stagnation?: number
  }
}

/** Save transacional da timeline (1 dia) — RFC §11.1
 * segmentos aceita input bruto (com overlap/gap) e o backend normaliza.
 */
export interface SalvarTimelineDiaInput {
  setor_id: number
  dia_semana: DiaSemana
  ativo: boolean
  usa_padrao: boolean
  hora_abertura: string
  hora_fechamento: string
  segmentos: Array<{
    hora_inicio: string
    hora_fim: string
    min_pessoas: number
    override: boolean
  }>
}

export interface SalvarTimelineDiaOutput {
  horario: SetorHorarioSemana
  demandas: Demanda[]
  normalizacao: {
    slots_total: number
    slots_overlap_detectados: number
    slots_sem_demanda: number
  }
}

// ============================================================================
// COMPOSTOS — v2 (mantidos pra compat frontend)
// ============================================================================

export interface Violacao {
  severidade: Severidade
  regra: string
  colaborador_id: number | null
  colaborador_nome: string
  mensagem: string
  data: string | null
}

export interface Indicadores {
  cobertura_percent: number
  cobertura_efetiva_percent: number
  violacoes_hard: number
  violacoes_soft: number
  equilibrio: number
  pontuacao: number
}

/** EscalaCompleta v2 — mantida pra compat frontend ate S4 */
export interface EscalaCompleta {
  escala: Escala
  alocacoes: Alocacao[]
  indicadores: Indicadores
  violacoes: Violacao[]
}

export interface DashboardResumo {
  total_setores: number
  total_colaboradores: number
  total_em_ferias: number
  total_em_atestado: number
  setores: SetorResumo[]
  alertas: AlertaDashboard[]
}

export interface SetorResumo {
  id: number
  nome: string
  icone: string | null
  total_colaboradores: number
  escala_atual: 'SEM_ESCALA' | 'RASCUNHO' | 'OFICIAL'
  proxima_geracao: string | null
  violacoes_pendentes: number
  escala_desatualizada: boolean
}

export interface AlertaDashboard {
  tipo: 'ESCALA_VENCIDA' | 'VIOLACAO_HARD' | 'SEM_ESCALA' | 'POUCOS_COLABORADORES' | 'ESCALA_DESATUALIZADA'
  setor_id: number
  setor_nome: string
  mensagem: string
}

// ============================================================================
// REQUEST BODIES
// ============================================================================

export interface GerarEscalaRequest {
  data_inicio: string
  data_fim: string
}

export interface CriarColaboradorRequest {
  setor_id: number
  tipo_contrato_id: number
  nome: string
  sexo: 'M' | 'F'
  horas_semanais?: number
  rank?: number
  prefere_turno?: Turno | null
  evitar_dia_semana?: DiaSemana | null
  // v3.1
  tipo_trabalhador?: TipoTrabalhador
  funcao_id?: number | null
}

export interface ReordenarRankRequest {
  colaborador_ids: number[]
}

export interface AjustarAlocacaoRequest {
  alocacoes: {
    colaborador_id: number
    data: string
    status: StatusAlocacao
    hora_inicio?: string | null
    hora_fim?: string | null
  }[]
}

export interface ColaboradorPostoSnapshotItem {
  colaborador_id: number
  funcao_id: number | null
}

export interface AtribuirPostoResult {
  snapshot_antes: ColaboradorPostoSnapshotItem[]
  snapshot_depois: ColaboradorPostoSnapshotItem[]
}

// ============================================================================
// SOLVER BRIDGE — Python OR-Tools I/O contracts
// ============================================================================

export interface SolverInputColab {
  id: number
  nome: string
  horas_semanais: number
  regime_escala?: RegimeEscala
  dias_trabalho: number
  max_minutos_dia: number
  tipo_trabalhador: string
  sexo: string
  funcao_id: number | null
  rank: number
  // v4: regras individuais
  domingo_ciclo_trabalho?: number
  domingo_ciclo_folga?: number
  folga_fixa_dia_semana?: DiaSemana | null
  folga_variavel_dia_semana?: DiaSemana | null
}

export interface SolverInputDemanda {
  dia_semana: string | null
  hora_inicio: string
  hora_fim: string
  min_pessoas: number
  override?: boolean
}

export interface SolverInputHint {
  colaborador_id: number
  data: string
  status: 'TRABALHO' | 'FOLGA' | 'INDISPONIVEL'
  hora_inicio?: string | null
  hora_fim?: string | null
}

export interface SolverInputRegraColaboradorDia {
  colaborador_id: number
  data: string
  inicio_min: string | null
  inicio_max: string | null
  fim_min: string | null
  fim_max: string | null
  preferencia_turno_soft: string | null
  domingo_forcar_folga: boolean
  folga_fixa: boolean
}

export interface SolverInputDemandaExcecaoData {
  setor_id: number
  data: string
  hora_inicio: string
  hora_fim: string
  min_pessoas: number
  override: boolean
}

// ============================================================================
// ENGINE DE REGRAS — v6
// ============================================================================

export type RuleStatus = 'HARD' | 'SOFT' | 'OFF' | 'ON'

export interface RuleDefinition {
  codigo: string
  nome: string
  descricao: string
  categoria: 'CLT' | 'SOFT' | 'ANTIPATTERN'
  status_sistema: RuleStatus
  editavel: boolean
  aviso_dependencia: string | null
  ordem: number
  /** Computed: regra_empresa.status ?? status_sistema */
  status_efetivo: RuleStatus
}

/** Map de código → status aplicado para uma geração */
export type RuleConfig = Record<string, RuleStatus>

export interface SolverInput {
  setor_id: number
  data_inicio: string
  data_fim: string
  empresa: {
    tolerancia_semanal_min: number
    hora_abertura: string
    hora_fechamento: string
    min_intervalo_almoco_min: number
    max_intervalo_almoco_min: number
    grid_minutos: number
    /** Horário de funcionamento por dia da semana (0=DOM..6=SAB). Cascata: setor > empresa > default. */
    horario_por_dia?: Record<number, { abertura: string; fechamento: string }>
  }
  colaboradores: SolverInputColab[]
  demanda: SolverInputDemanda[]
  feriados: { data: string; nome: string; proibido_trabalhar: boolean }[]
  excecoes: { colaborador_id: number; data_inicio: string; data_fim: string; tipo: string }[]
  pinned_cells: PinnedCell[]
  hints?: SolverInputHint[]
  // v4: regras individuais por colaborador/dia
  regras_colaborador_dia?: SolverInputRegraColaboradorDia[]
  // v4: excecoes de demanda por data
  demanda_excecao_data?: SolverInputDemandaExcecaoData[]
  config: {
    max_time_seconds?: number
    num_workers: number
    solve_mode?: 'rapido' | 'balanceado' | 'otimizado' | 'maximo'
    nivel_rigor?: 'ALTO' | 'MEDIO' | 'BAIXO'  // backward compat
    rules?: RuleConfig                           // v6: granular, substitui nivel_rigor quando presente
  }
}

export interface SolverOutputAlocacao {
  colaborador_id: number
  data: string
  status: 'TRABALHO' | 'FOLGA'
  hora_inicio: string | null
  hora_fim: string | null
  minutos_trabalho: number
  hora_almoco_inicio: string | null
  hora_almoco_fim: string | null
  minutos_almoco: number
  intervalo_15min: boolean
  funcao_id: number | null
  // v19: H7 campos de intervalo 15min
  hora_intervalo_inicio: string | null
  hora_intervalo_fim: string | null
  hora_real_inicio: string | null
  hora_real_fim: string | null
}

export interface DiagnosticoSolver {
  status_cp_sat: 'OPTIMAL' | 'FEASIBLE' | 'INFEASIBLE' | 'UNKNOWN'
  solve_time_ms: number
  regras_ativas: string[]
  regras_off: string[]
  motivo_infeasible?: string
  num_colaboradores: number
  num_dias: number
  /** Graceful degradation: which pass solved (1=normal, 2=relaxed product rules, 3=CLT skeleton) */
  pass_usado?: 1 | 2 | 3
  /** Which rules were relaxed in the successful pass */
  regras_relaxadas?: string[]
  /** Pre-solve capacity analysis */
  capacidade_vs_demanda?: {
    total_slots_demanda: number
    max_slots_disponiveis: number
    ratio_cobertura_max: number
    cobertura_matematicamente_possivel: boolean
  }
  /** True when Pass 3 stripped hard time windows and folga_fixa — review carefully */
  modo_emergencia?: boolean
  /** Optimality gap (0 = proven optimal, >0 = solver stopped before proving) */
  gap_percent?: number
  /** Raw objective value (debug) */
  objective_value?: number
  /** Cycle length in weeks (N / gcd(N, D_sunday)) */
  cycle_length_weeks?: number
  /** Phase 1 (Folga Pattern) result status */
  phase1_status?: 'OK' | 'SKIPPED' | 'INFEASIBLE'
  /** Phase 1 solve time in milliseconds */
  phase1_solve_time_ms?: number
  /** Phase 1 cycle length in days */
  phase1_cycle_days?: number
  /** Phase 1 shift band distribution */
  phase1_bands_pinned?: { off: number; manha: number; tarde: number; integral: number }
}

export interface SolverOutput {
  sucesso: boolean
  status: string
  solve_time_ms: number
  diagnostico?: DiagnosticoSolver
  alocacoes?: SolverOutputAlocacao[]
  indicadores?: Indicadores
  decisoes?: DecisaoMotor[]
  comparacao_demanda?: SlotComparacao[]
  erro?: {
    tipo: 'PREFLIGHT' | 'CONSTRAINT'
    regra: string
    mensagem: string
    sugestoes: string[]
  }
}

// ============================================================================
// ASSISTENTE DE IA
// ============================================================================

export interface IaContexto {
  rota: string
  pagina: 'dashboard' | 'setor_lista' | 'setor_detalhe' | 'escala' | 'escalas_hub' | 'colaborador_lista' | 'colaborador_detalhe' | 'contratos' | 'empresa' | 'feriados' | 'configuracoes' | 'regras' | 'ia' | 'outro'
  setor_id?: number
  colaborador_id?: number
}

export interface ToolCall {
  id: string
  name: string
  // Optional because historical rows (and some fallback payloads) may contain only id/name.
  args?: Record<string, unknown>
  result?: unknown
}

export interface IaAnexo {
  id: string
  tipo: 'image' | 'file'
  mime_type: string
  nome: string
  tamanho_bytes: number
  data_base64?: string        // transient — renderer only, never persisted
  file_path?: string          // persisted — disk location relative to data dir
  preview_url?: string        // transient — blob URL for renderer
}

export interface IaMensagem {
  id: string
  papel: 'usuario' | 'assistente' | 'tool_result'
  conteudo: string
  timestamp: string
  tool_calls?: ToolCall[]
  anexos?: IaAnexo[]
}

export interface IaConfiguracao {
  id: number
  provider: 'gemini' | 'openrouter' | 'local'
  api_key: string
  modelo: string
  // JSON string with provider-specific settings (auth mode, token/login state, local CLI paths, etc).
  // Kept as raw string in DB shape for backward compatibility with existing queries.
  provider_configs_json?: string
  ativo: boolean
  memoria_automatica: boolean
  criado_em: string
  atualizado_em: string
}

export interface IaConversa {
  id: string
  titulo: string
  status: 'ativo' | 'arquivado'
  resumo_compactado?: string | null
  criado_em: string
  atualizado_em: string
}

export interface IaMensagemDB extends IaMensagem {
  conversa_id: string
}

export type IaStreamEvent =
  | { type: 'text-delta'; stream_id: string; delta: string }
  | { type: 'tool-call-start'; stream_id: string; tool_call_id: string; tool_name: string; args: Record<string, unknown>; estimated_seconds?: number }
  | { type: 'tool-result'; stream_id: string; tool_call_id: string; tool_name: string; result: unknown }
  | { type: 'start-step'; stream_id: string; step_index: number }
  | { type: 'step-finish'; stream_id: string; step_index: number }
  | { type: 'follow-up-start'; stream_id: string }
  | { type: 'finish'; stream_id: string; resposta: string; acoes: ToolCall[] }
  | { type: 'error'; stream_id: string; message: string }

// ============================================================================
// CATÁLOGO DE MODELOS IA
// ============================================================================

// ============================================================================
// MEMORIAS IA — fatos curtos do RH, sempre injetados
// ============================================================================

export interface IaMemoria {
  id: number
  conteudo: string
  origem: 'manual' | 'auto'
  criada_em: string
  atualizada_em: string
}

// ============================================================================
// KNOWLEDGE LAYER — RAG + Knowledge Graph
// ============================================================================

export interface KnowledgeSource {
  id: number
  tipo: 'manual' | 'auto_capture' | 'sistema' | 'importacao_usuario'
  titulo: string
  conteudo_original: string
  metadata: Record<string, unknown>
  importance: 'high' | 'low'
  ativo: boolean
  criada_em: string
  atualizada_em: string
}

export interface KnowledgeChunk {
  id: number
  source_id: number
  conteudo: string
  importance: 'high' | 'low'
  access_count: number
  last_accessed_at: string | null
  criada_em: string
}

export interface KnowledgeEntity {
  id: number
  nome: string
  tipo: string
  origem: 'sistema' | 'usuario'
  valid_from: string
  valid_to: string | null
  criada_em: string
}

export interface KnowledgeRelation {
  id: number
  entity_from_id: number
  entity_to_id: number
  tipo_relacao: string
  peso: number
  valid_from: string
  valid_to: string | null
}

export type IaProviderId = 'gemini' | 'openrouter' | 'local'

export interface IaLocalStatus {
  modelos: Record<string, {
    baixado: boolean
    tamanho_bytes: number
    tamanho_atual_bytes?: number
  }>
  modelo_ativo?: string
  modelo_carregado: boolean
  download_em_andamento?: string
  download_progresso?: number
  download_bytes_total?: number
  download_bytes_feitos?: number
  ram_modelo_mb?: number
  gpu_detectada?: string
  tokens_por_segundo?: number
}

export interface IaModelCatalogItem {
  id: string
  label: string
  provider: IaProviderId
  source: 'static' | 'api' | 'fallback'
  description?: string
  context_length?: number
  pricing?: { prompt?: string; completion?: string }
  is_free?: boolean
  supports_tools?: boolean
  is_agentic?: boolean
  tags?: string[]
}

export interface IaModelCatalogResult {
  provider: IaProviderId
  source: 'static' | 'api' | 'fallback'
  models: IaModelCatalogItem[]
  fetched_at: string
  cached: boolean
  message?: string
}
