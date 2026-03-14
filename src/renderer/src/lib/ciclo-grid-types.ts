import type { DiaSemana } from '@shared/index'

export type Simbolo = 'T' | 'FF' | 'FV' | 'DT' | 'DF' | 'I' | '.' | '-'

export interface CicloGridRow {
  id: number
  nome: string
  posto: string
  variavel: DiaSemana | null
  fixa: DiaSemana | null
  blocked: boolean
  semanas: Simbolo[][]
}

export interface CicloGridData {
  rows: CicloGridRow[]
  cobertura: number[][]
  demanda: number[]
  cicloSemanas: number
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
    cell: 'bg-slate-200 text-slate-700 font-semibold dark:bg-slate-700 dark:text-slate-200',
    swatch: 'bg-slate-300 text-slate-700 dark:bg-slate-600 dark:text-slate-200',
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
    cell: 'bg-blue-100 text-blue-700 font-semibold ring-1 ring-inset ring-blue-400 dark:bg-blue-950 dark:text-blue-400 dark:ring-blue-600',
    swatch: 'bg-blue-200 text-blue-700 ring-1 ring-inset ring-blue-400 dark:bg-blue-800 dark:text-blue-300',
    label: 'Dom folga',
  },
  I: {
    cell: 'bg-rose-100 text-rose-700 font-semibold dark:bg-rose-900 dark:text-rose-200',
    swatch: 'bg-rose-200 text-rose-700 dark:bg-rose-700 dark:text-rose-200',
    label: 'Indisponivel',
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

export const LEGENDA_SIMBOLOS: Simbolo[] = ['T', 'FF', 'FV', 'DT', 'DF', 'I']
