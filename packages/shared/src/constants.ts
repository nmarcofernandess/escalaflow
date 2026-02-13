// ─── CLT Constants (imutaveis — hardcoded no motor) ─────────────────────
export const CLT = {
  MAX_DIAS_CONSECUTIVOS: 6,
  MIN_DESCANSO_ENTRE_JORNADAS_MIN: 660, // 11h em minutos
  MAX_JORNADA_DIARIA_MIN: 600,          // 10h em minutos
  MAX_DOMINGOS_CONSECUTIVOS: {
    M: 2,
    F: 1,
  },
} as const

// ─── Dias da semana ─────────────────────────────────────────────────────
export const DIAS_SEMANA = ['SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB', 'DOM'] as const
export type DiaSemana = typeof DIAS_SEMANA[number]

// ─── Turnos ─────────────────────────────────────────────────────────────
export const TURNOS = ['MANHA', 'TARDE'] as const
export type Turno = typeof TURNOS[number]

// ─── Status de escala ───────────────────────────────────────────────────
export const STATUS_ESCALA = ['RASCUNHO', 'OFICIAL', 'ARQUIVADA'] as const
export type StatusEscala = typeof STATUS_ESCALA[number]

// ─── Tipos de excecao ───────────────────────────────────────────────────
export const TIPOS_EXCECAO = ['FERIAS', 'ATESTADO', 'BLOQUEIO'] as const
export type TipoExcecao = typeof TIPOS_EXCECAO[number]

// ─── Status de alocacao ─────────────────────────────────────────────────
export const STATUS_ALOCACAO = ['TRABALHO', 'FOLGA', 'INDISPONIVEL'] as const
export type StatusAlocacao = typeof STATUS_ALOCACAO[number]

// ─── Severidade de violacao ─────────────────────────────────────────────
export const SEVERIDADES = ['HARD', 'SOFT'] as const
export type Severidade = typeof SEVERIDADES[number]
