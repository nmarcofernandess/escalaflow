export const CORES_STATUS_ESCALA = {
  OFICIAL:
    'border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300',
  RASCUNHO:
    'border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300',
  ARQUIVADA: 'border-muted-foreground/20 bg-muted text-muted-foreground',
  SEM_ESCALA: 'border-muted-foreground/20 bg-muted text-muted-foreground',
} as const

export const CORES_ALOCACAO = {
  TRABALHO:
    'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800',
  TRABALHO_DOMINGO:
    'bg-sky-100 dark:bg-sky-950/30 text-sky-800 dark:text-sky-300 border-sky-200 dark:border-sky-800',
  FOLGA:
    'bg-muted/60 dark:bg-muted/40 text-muted-foreground border-border dark:border-muted-foreground/20',
  INDISPONIVEL:
    'bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800',
} as const

export const CORES_EXCECAO = {
  FERIAS: 'text-emerald-600 dark:text-emerald-400',
  ATESTADO: 'text-amber-600 dark:text-amber-400',
  BLOQUEIO: 'text-red-600 dark:text-red-400',
} as const

export const CORES_VIOLACAO = {
  HARD: {
    border: 'border-red-200 dark:border-red-800',
    bg: 'bg-red-50/50 dark:bg-red-950/30',
    text: 'text-red-800 dark:text-red-300',
    textLight: 'text-red-700 dark:text-red-400',
  },
  SOFT: {
    border: 'border-amber-200 dark:border-amber-800',
    bg: 'bg-amber-50/50 dark:bg-amber-950/30',
    text: 'text-amber-800 dark:text-amber-300',
    textLight: 'text-amber-700 dark:text-amber-400',
  },
} as const

/** Gender avatar colors used across the app */
export const CORES_GENERO = {
  F: 'bg-pink-100 dark:bg-pink-950/30 text-pink-700 dark:text-pink-300',
  M: 'bg-sky-100 dark:bg-sky-950/30 text-sky-700 dark:text-sky-300',
} as const

/** Knowledge Graph entity type colors (hex for Canvas) */
export const ENTITY_TYPE_COLORS: Record<string, string> = {
  pessoa: '#3b82f6',
  contrato: '#8b5cf6',
  setor: '#10b981',
  regra: '#f59e0b',
  feriado: '#ef4444',
  funcao: '#06b6d4',
  conceito: '#6b7280',
}

/** Contract type colors for timeline bars */
export const CORES_CONTRATO: Record<string, { bar: string; text: string; border: string }> = {
  'CLT 44h': {
    bar: 'bg-emerald-500/80 dark:bg-emerald-600/70',
    text: 'text-white dark:text-emerald-100',
    border: 'border-emerald-600 dark:border-emerald-500',
  },
  'CLT 36h': {
    bar: 'bg-blue-500/80 dark:bg-blue-600/70',
    text: 'text-white dark:text-blue-100',
    border: 'border-blue-600 dark:border-blue-500',
  },
  'Estagiario 20h': {
    bar: 'bg-purple-500/80 dark:bg-purple-600/70',
    text: 'text-white dark:text-purple-100',
    border: 'border-purple-600 dark:border-purple-500',
  },
  DEFAULT: {
    bar: 'bg-slate-500/80 dark:bg-slate-600/70',
    text: 'text-white dark:text-slate-100',
    border: 'border-slate-600 dark:border-slate-500',
  },
}
