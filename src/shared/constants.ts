// ============================================================================
// CONSTANTS v3.1 — Motor EscalaFlow
// Fonte: docs/MOTOR_V3_RFC.md §16 (CLT + ANTIPATTERNS)
// ============================================================================

// --- CLT Constants (imutaveis — hardcoded no motor) ---
export const CLT = {
  MAX_JORNADA_NORMAL_MIN: 480,              // 8h
  MAX_JORNADA_COM_EXTRA_MIN: 600,           // 10h
  MIN_DESCANSO_ENTRE_JORNADAS_MIN: 660,     // 11h
  DSR_INTERJORNADA_MIN: 2100,               // 35h (Sumula 110 TST)
  MAX_DIAS_CONSECUTIVOS: 6,                 // Art. 67 + OJ 410 TST
  ALMOCO_MIN_CLT_MIN: 60,                   // 1h padrao CLT
  ALMOCO_MIN_CCT_MIN: 30,                   // CCT FecomercioSP interior
  ALMOCO_MAX_MIN: 120,                      // 2h max
  INTERVALO_CURTO_MIN: 15,                  // Art. 71 §1
  LIMIAR_ALMOCO_MIN: 360,                   // >6h = almoco obrigatorio
  LIMIAR_INTERVALO_CURTO_MIN: 240,          // >4h = 15min obrigatorio
  MIN_JORNADA_DIA_MIN: 240,                 // 4h — decisao de produto
  MAX_DOMINGOS_CONSECUTIVOS: { M: 2, F: 1 } as const,
  FOLGA_COMPENSATORIA_DOM_DIAS: 7,          // Lei 605/1949
  ESTAGIARIO_MAX_JORNADA_MIN: 360,          // 6h/dia — Lei 11.788 Art. 10
  ESTAGIARIO_MAX_SEMANAL_MIN: 1800,         // 30h/sem
  GRID_MINUTOS: 15,
  MAX_COMPENSACAO_DIA_MIN: 585,             // 9h45 (compensacao CLT 44h/36h)
  COMPENSACAO_CONTRATOS: ['CLT 44h', 'CLT 36h'] as readonly string[],
  /** @deprecated Use MAX_JORNADA_COM_EXTRA_MIN — mantido pra compat motor v2 */
  MAX_JORNADA_DIARIA_MIN: 600,
} as const

// --- Antipatterns (pesos e thresholds) ---
export const ANTIPATTERNS = {
  // Tier 1
  CLOPENING_MIN_DESCANSO_CONFORTAVEL_MIN: 780,  // 13h
  ALMOCO_MAX_SIMULTANEO_PERCENT: 50,
  HORA_EXTRA_MARGEM_REDISTRIBUICAO_MIN: 60,
  MARATONA_PICO_MAX_CONSECUTIVOS: 2,
  JUNIOR_SOZINHO_RANK_MINIMO: 3,
  FIM_SEMANA_MAX_SEMANAS_SEM: 5,

  // Tier 2
  HORARIO_VARIACAO_MAX_IDEAL_MIN: 60,
  HORARIO_VARIACAO_MAX_ACEITAVEL_MIN: 120,
  ALMOCO_HORARIO_IDEAL_INICIO: '11:00',
  ALMOCO_HORARIO_IDEAL_FIM: '13:30',
  DIA_CURTO_MINIMO_PREFERIDO_MIN: 300,
  FAIRNESS_INDICE_MINIMO: 40,
  SCHEDULE_SHOCK_MAX_DIFF_MIN: 120,
  BACKWARD_ROTATION_THRESHOLD_MIN: 60,
  FECHAMENTO_MAX_CONSECUTIVO: 3,

  // Pesos Tier 1
  PESO_CLOPENING: -15,
  PESO_ALMOCO_SIMULTANEO: -20,
  PESO_HORA_EXTRA_EVITAVEL: -8,
  PESO_SEM_FIM_DE_SEMANA: -8,
  PESO_MARATONA_PICO: -6,
  PESO_JUNIOR_SOZINHO: -12,

  // Pesos Tier 2
  PESO_IOIO_GRAVE: -10,
  PESO_IOIO_MODERADO: -5,
  PESO_FOLGA_ISOLADA: -5,
  PESO_TURNOS_INJUSTOS: -3,
  PESO_ALMOCO_FORA_IDEAL: -3,
  PESO_ALMOCO_FORA_ACEITAVEL: -8,
  PESO_DIA_CURTO: -2,
  PESO_HORA_MORTA: -3,
  PESO_FAIRNESS_DRIFT: -4,
  PESO_SCHEDULE_SHOCK: -6,
  PESO_BACKWARD_ROTATION: -3,
  PESO_FECHAMENTO_SEQUENCIA: -4,
} as const

// --- Feriados CCT proibidos (MM-DD) ---
export const FERIADOS_CCT_PROIBIDOS = ['12-25', '01-01'] as const

// --- Dias da semana ---
export const DIAS_SEMANA = ['SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB', 'DOM'] as const
export type DiaSemana = (typeof DIAS_SEMANA)[number]

// --- Turnos ---
export const TURNOS = ['MANHA', 'TARDE'] as const
export type Turno = (typeof TURNOS)[number]

// --- Status de escala ---
export const STATUS_ESCALA = ['RASCUNHO', 'OFICIAL', 'ARQUIVADA'] as const
export type StatusEscala = (typeof STATUS_ESCALA)[number]

// --- Tipos de excecao ---
export const TIPOS_EXCECAO = ['FERIAS', 'ATESTADO', 'BLOQUEIO'] as const
export type TipoExcecao = (typeof TIPOS_EXCECAO)[number]

// --- Status de alocacao ---
export const STATUS_ALOCACAO = ['TRABALHO', 'FOLGA', 'INDISPONIVEL'] as const
export type StatusAlocacao = (typeof STATUS_ALOCACAO)[number]

// --- Severidade de violacao ---
export const SEVERIDADES = ['HARD', 'SOFT'] as const
export type Severidade = (typeof SEVERIDADES)[number]

// --- Tipos de trabalhador (v3) ---
export const TIPOS_TRABALHADOR = ['CLT', 'ESTAGIARIO', 'INTERMITENTE'] as const
export type TipoTrabalhador = (typeof TIPOS_TRABALHADOR)[number]

// --- Regimes de escala por contrato ---
export const REGIMES_ESCALA = ['5X2', '6X1'] as const
export type RegimeEscala = (typeof REGIMES_ESCALA)[number]

// --- Tipos de feriado (v3) ---
export const TIPOS_FERIADO = ['NACIONAL', 'ESTADUAL', 'MUNICIPAL'] as const
export type TipoFeriado = (typeof TIPOS_FERIADO)[number]

// --- Acoes do motor (v3 explicabilidade) ---
export const ACOES_MOTOR = ['ALOCADO', 'FOLGA', 'MOVIDO', 'REMOVIDO'] as const
export type AcaoMotor = (typeof ACOES_MOTOR)[number]

// --- Tiers de antipattern ---
export const ANTIPATTERN_TIERS = [1, 2, 3] as const
export type AntipatternTier = (typeof ANTIPATTERN_TIERS)[number]

// --- v4: Paleta fixa de cores para postos/funcoes (15 cores) ---
export const PALETA_FUNCAO_CORES = [
  '#3B82F6', // blue-500
  '#EF4444', // red-500
  '#10B981', // emerald-500
  '#F59E0B', // amber-500
  '#8B5CF6', // violet-500
  '#EC4899', // pink-500
  '#14B8A6', // teal-500
  '#F97316', // orange-500
  '#6366F1', // indigo-500
  '#84CC16', // lime-500
  '#06B6D4', // cyan-500
  '#D946EF', // fuchsia-500
  '#78716C', // stone-500
  '#0EA5E9', // sky-500
  '#A3E635', // lime-400
] as const

// --- v4: Ciclo domingo default ---
export const DOMINGO_CICLO_DEFAULT = { trabalho: 2, folga: 1 } as const
