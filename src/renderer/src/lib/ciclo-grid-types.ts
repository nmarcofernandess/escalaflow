import type { DiaSemana } from '@shared/index'

export type Simbolo = 'T' | 'FF' | 'FV' | 'DT' | 'DF' | 'I' | 'NT' | '.' | '-'

export interface CicloGridRow {
  id: number
  nome: string
  posto: string
  variavel: DiaSemana | null
  fixa: DiaSemana | null
  blocked: boolean
  blockedFixa?: boolean
  overrideVariavelLocal?: boolean
  overrideFixaLocal?: boolean
  baseVariavelColaborador?: boolean
  baseFixaColaborador?: boolean
  semanas: Simbolo[][]
}

export interface CicloGridData {
  rows: CicloGridRow[]
  cobertura: number[][]
  demanda: number[]
  cicloSemanas: number
}

export interface CicloGridCoverageActions {
  onResetAutomatico?: () => void
  onRestaurarColaboradores?: () => void
}

export const DIAS_ORDEM: DiaSemana[] = ['SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB', 'DOM']
export const DIAS_GETDAY: DiaSemana[] = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB']
export const DIAS_CURTOS: Record<DiaSemana, string> = {
  SEG: 'Seg', TER: 'Ter', QUA: 'Qua', QUI: 'Qui', SEX: 'Sex', SAB: 'Sab', DOM: 'Dom',
}
export const DIAS_HEADER = ['S', 'T', 'Q', 'Q', 'S', 'S', 'D']

export const SIMBOLO_CONFIG: Record<Simbolo, {
  cell: string
  swatch: string
  label: string
}> = {
  T: {
    cell: 'bg-success/10 text-success font-semibold',
    swatch: 'bg-success/30 text-success',
    label: 'Trabalho',
  },
  FF: {
    cell: 'bg-muted text-muted-foreground font-semibold',
    swatch: 'bg-muted/80 text-muted-foreground',
    label: 'Folga fixa',
  },
  FV: {
    cell: 'bg-warning/10 text-warning font-semibold',
    swatch: 'bg-warning/30 text-warning',
    label: 'Folga variavel',
  },
  DT: {
    cell: 'bg-warning/10 text-warning font-semibold ring-1 ring-inset ring-warning/40',
    swatch: 'bg-warning/30 text-warning ring-1 ring-inset ring-warning/40',
    label: 'Dom trabalhado',
  },
  DF: {
    cell: 'bg-primary/10 text-primary font-semibold ring-1 ring-inset ring-primary/30',
    swatch: 'bg-primary/20 text-primary ring-1 ring-inset ring-primary/30',
    label: 'Dom folga',
  },
  I: {
    cell: 'bg-destructive/10 text-destructive font-semibold',
    swatch: 'bg-destructive/20 text-destructive',
    label: 'Indisponivel',
  },
  NT: {
    cell: 'bg-muted/50 text-muted-foreground/60 font-normal',
    swatch: 'bg-muted/40 text-muted-foreground/60',
    label: 'Nao trabalha',
  },
  '.': {
    cell: 'text-muted-foreground',
    swatch: 'bg-muted text-muted-foreground',
    label: 'Sem alocacao',
  },
  '-': {
    cell: 'text-muted-foreground',
    swatch: '',
    label: 'Sem titular',
  },
}

export const LEGENDA_SIMBOLOS: Simbolo[] = ['T', 'FF', 'FV', 'DT', 'DF', 'I', 'NT']
