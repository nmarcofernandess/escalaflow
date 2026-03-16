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
    'bg-primary/10 text-primary border-primary/20',
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

/** Gender avatar colors — secondary/muted semântico */
export const CORES_GENERO = {
  F: 'bg-secondary text-secondary-foreground',
  M: 'bg-muted text-muted-foreground',
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

/** Cor única semântica para barras de turno na timeline */
export const COR_TURNO = {
  bar: 'bg-primary/80',
  text: 'text-primary-foreground',
  border: 'border-primary',
  handle: 'bg-primary-foreground/30',
} as const
