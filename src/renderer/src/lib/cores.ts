// ═══════════════════════════════════════════════════════════════
// SEMANTIC COLOR SYSTEM
// ───────────────────────────────────────────────────────────────
// success (emerald)     → OK, meta atingida, pode oficializar
// warning (amber)       → aviso, SOFT violation, abaixo da meta
// destructive (red)     → erro critico, HARD violation, delete
// muted                 → inativo, arquivado, texto secundario
// ═══════════════════════════════════════════════════════════════

export const CORES_STATUS_ESCALA = {
  OFICIAL:
    'border-success/20 bg-success/10 text-success',
  RASCUNHO:
    'border-warning/20 bg-warning/10 text-warning',
  ARQUIVADA: 'border-muted-foreground/20 bg-muted text-muted-foreground',
  SEM_ESCALA: 'border-muted-foreground/20 bg-muted text-muted-foreground',
} as const

export const CORES_ALOCACAO = {
  TRABALHO:
    'bg-success/10 text-success border-success/20',
  TRABALHO_DOMINGO:
    'bg-sky-100 dark:bg-sky-950/30 text-sky-800 dark:text-sky-300 border-sky-200 dark:border-sky-800',
  FOLGA:
    'bg-muted/60 dark:bg-muted/40 text-muted-foreground border-border dark:border-muted-foreground/20',
  INDISPONIVEL:
    'bg-warning/10 text-warning border-warning/20',
} as const

export const CORES_EXCECAO = {
  FERIAS: 'text-success',
  ATESTADO: 'text-warning',
  BLOQUEIO: 'text-destructive',
} as const

export const CORES_VIOLACAO = {
  HARD: {
    border: 'border-destructive/20',
    bg: 'bg-destructive/10',
    text: 'text-destructive',
    textLight: 'text-destructive',
  },
  SOFT: {
    border: 'border-warning/20',
    bg: 'bg-warning/10',
    text: 'text-warning',
    textLight: 'text-warning',
  },
} as const

/** Gender avatar colors — visual, not semantic */
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

/** Contract type colors for timeline bars — visual rotation, not semantic */
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
