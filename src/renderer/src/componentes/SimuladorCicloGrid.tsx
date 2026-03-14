import { Fragment } from 'react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'
import type { DiaSemana } from '@shared/index'
import type { DiaStatus, SimulaCicloOutput, SimulaCicloRow } from '@shared/simula-ciclo'
import type { CicloViewMode } from '@/componentes/CicloViewToggle'

const DIAS_ORDEM: DiaSemana[] = ['SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB', 'DOM']
const DIAS_CURTOS: Record<DiaSemana, string> = {
  SEG: 'Seg',
  TER: 'Ter',
  QUA: 'Qua',
  QUI: 'Qui',
  SEX: 'Sex',
  SAB: 'Sab',
  DOM: 'Dom',
}

const CELULA_CLASSES: Record<string, string> = {
  T: 'bg-success/10 text-success font-medium',
  F: 'bg-slate-200 text-slate-700 font-semibold dark:bg-slate-700 dark:text-slate-200',
  FF: 'bg-slate-200 text-slate-700 font-semibold dark:bg-slate-700 dark:text-slate-200',
  FV: 'bg-warning/10 text-warning font-semibold',
  DT: 'bg-warning/10 text-warning font-semibold ring-1 ring-inset ring-warning/40',
  DF: 'bg-blue-100 text-blue-700 font-semibold ring-1 ring-inset ring-blue-400 dark:bg-blue-950 dark:text-blue-400 dark:ring-blue-600',
}

function resolveSimbolo(
  status: DiaStatus,
  dIdx: number,
  row: { folga_fixa_dia: number; folga_variavel_dia: number | null },
): string {
  const isDomingo = dIdx === 6
  if (status === 'T') return isDomingo ? 'DT' : 'T'
  if (isDomingo) return 'DF'
  if (dIdx === row.folga_variavel_dia) return 'FV'
  if (dIdx === row.folga_fixa_dia) return 'FF'
  return 'F'
}

function getFixaDia(row: SimulaCicloRow): DiaSemana | null {
  return DIAS_ORDEM[row.folga_fixa_dia] ?? null
}

function getVariavelDia(row: SimulaCicloRow): DiaSemana | null {
  return row.folga_variavel_dia != null ? (DIAS_ORDEM[row.folga_variavel_dia] ?? null) : null
}

export function SimuladorCicloGrid({
  resultado,
  viewMode,
  selectedWeek,
  onSelectedWeekChange,
  rowLabels,
  blockedRows = [],
  onFolgaChange,
  allowDomingoNaFixa = true,
  domingoTarget,
}: {
  resultado: SimulaCicloOutput
  viewMode: CicloViewMode
  selectedWeek: number
  onSelectedWeekChange: (next: number) => void
  rowLabels?: string[]
  blockedRows?: number[]
  onFolgaChange?: (rowIndex: number, field: 'fixa' | 'variavel', value: DiaSemana | null) => void
  allowDomingoNaFixa?: boolean
  domingoTarget?: number
}) {
  if (!resultado.sucesso) return null

  const blockedSet = new Set(blockedRows)
  const weeksCount = resultado.cobertura_dia.length
  const weeksTabela = resultado.ciclo_semanas > 0 ? resultado.ciclo_semanas : 1
  const selectedWeekClamped =
    viewMode === 'tabela'
      ? Math.min(selectedWeek, Math.max(0, weeksTabela - 1))
      : Math.min(selectedWeek, Math.max(0, weeksCount - 1))

  function renderFolgaCell(row: SimulaCicloRow, rowIndex: number, field: 'fixa' | 'variavel') {
    const disabled = blockedSet.has(rowIndex) || !onFolgaChange
    const current = field === 'fixa' ? getFixaDia(row) : getVariavelDia(row)

    if (disabled) {
      return (
        <span className={cn('text-xs', current ? 'text-muted-foreground' : 'text-muted-foreground/70')}>
          {current ? DIAS_CURTOS[current] : '-'}
        </span>
      )
    }

    return (
      <Select
        value={current ?? '__none__'}
        onValueChange={(value) => {
          onFolgaChange(
            rowIndex,
            field,
            value === '__none__' ? null : (value as DiaSemana),
          )
        }}
      >
        <SelectTrigger className="h-7 w-[74px] px-2 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__none__" className="text-xs">-</SelectItem>
          {DIAS_ORDEM
            .filter((dia) => {
              if (field === 'variavel') return dia !== 'DOM'
              return allowDomingoNaFixa || dia !== 'DOM'
            })
            .map((dia) => (
              <SelectItem key={dia} value={dia} className="text-xs">
                {DIAS_CURTOS[dia]}
              </SelectItem>
            ))}
        </SelectContent>
      </Select>
    )
  }

  if (viewMode === 'tabela') {
    return (
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {Array.from({ length: weeksTabela }, (_, idx) => (
            <button
              key={idx}
              type="button"
              className={cn(
                'h-8 min-w-10 rounded-md border px-2 text-xs font-medium transition-colors',
                idx === selectedWeekClamped
                  ? 'bg-secondary text-secondary-foreground'
                  : 'bg-background text-foreground hover:bg-muted',
              )}
              onClick={() => onSelectedWeekChange(idx)}
            >
              S{idx + 1}
            </button>
          ))}
        </div>

        <div className="overflow-x-auto rounded-md border print-colors">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30">
                <TableHead className="w-[120px]">Posto</TableHead>
                <TableHead className="w-[84px] text-center">Variável</TableHead>
                <TableHead className="w-[70px] text-center">Fixo</TableHead>
                {DIAS_ORDEM.map((dia) => (
                  <TableHead
                    key={dia}
                    className={cn(
                      'w-[54px] text-center',
                      dia === 'DOM' && 'font-semibold text-warning',
                    )}
                  >
                    {dia}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {resultado.grid.map((row, rowIndex) => {
                const sem = row.semanas[selectedWeekClamped]
                if (!sem) return null
                const rowLabel = rowLabels?.[rowIndex] ?? row.posto

                return (
                  <TableRow key={`${rowLabel}-${rowIndex}`} className="hover:bg-muted/20">
                    <TableCell className="font-medium">{rowLabel}</TableCell>
                    <TableCell className="text-center">
                      {renderFolgaCell(row, rowIndex, 'variavel')}
                    </TableCell>
                    <TableCell className="text-center">
                      {renderFolgaCell(row, rowIndex, 'fixa')}
                    </TableCell>
                    {sem.dias.map((status, dIdx) => {
                      const simbolo = resolveSimbolo(status, dIdx, row)
                      const hasViolation = sem.consecutivos_max > 6
                      const sigla = simbolo === 'DT' ? 'T' : simbolo === 'DF' ? 'F' : simbolo
                      return (
                        <TableCell
                          key={dIdx}
                          className={cn(
                            'text-center text-sm select-none',
                            CELULA_CLASSES[simbolo] ?? CELULA_CLASSES.F,
                            hasViolation && 'ring-1 ring-red-500',
                          )}
                        >
                          {sigla}
                        </TableCell>
                      )
                    })}
                  </TableRow>
                )
              })}
              <TableRow className="border-t-2 bg-muted/20">
                <TableCell className="font-medium text-blue-600 dark:text-blue-400">COBERTURA</TableCell>
                <TableCell colSpan={2} />
                {resultado.cobertura_dia[selectedWeekClamped]?.cobertura.map((val, dIdx) => (
                  <TableCell
                    key={dIdx}
                    className={cn(
                      'text-center text-sm font-bold',
                      dIdx === 6
                        ? (val >= (domingoTarget ?? 0)
                            ? 'text-blue-600 dark:text-blue-400'
                            : 'text-red-500')
                        : 'text-muted-foreground',
                    )}
                  >
                    {val}
                  </TableCell>
                ))}
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </div>
    )
  }

  return (
    <div className="overflow-x-auto rounded-md border print-colors">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/30">
            <TableHead className="sticky left-0 z-20 w-[120px] min-w-[120px] bg-muted">Posto</TableHead>
            <TableHead className="sticky left-[120px] z-20 w-[84px] min-w-[84px] border-r bg-muted text-center text-xs">Variável</TableHead>
            <TableHead className="sticky left-[204px] z-20 w-[70px] min-w-[70px] border-r bg-muted text-center text-xs">Fixo</TableHead>
            {resultado.cobertura_dia.map((_, weekIdx) => {
              const isCycleEnd =
                resultado.ciclo_semanas > 0 &&
                (weekIdx + 1) % resultado.ciclo_semanas === 0 &&
                weekIdx < resultado.cobertura_dia.length - 1
              return (
                <TableHead
                  key={`wh-${weekIdx}`}
                  colSpan={7}
                  className={cn(
                    'text-center text-xs font-semibold',
                    isCycleEnd && 'border-r-2 border-r-purple-400 dark:border-r-purple-500',
                  )}
                >
                  S{weekIdx + 1}
                </TableHead>
              )
            })}
          </TableRow>
          <TableRow className="bg-muted/30">
            <TableHead className="sticky left-0 z-20 w-[120px] min-w-[120px] bg-muted" />
            <TableHead className="sticky left-[120px] z-20 w-[84px] min-w-[84px] border-r bg-muted" />
            <TableHead className="sticky left-[204px] z-20 w-[70px] min-w-[70px] border-r bg-muted" />
            {resultado.cobertura_dia.map((_, weekIdx) => (
              <Fragment key={`dl-${weekIdx}`}>
                {DIAS_ORDEM.map((dia, dayIdx) => {
                  const isLastDay = dayIdx === 6
                  const isCycleEnd =
                    resultado.ciclo_semanas > 0 &&
                    (weekIdx + 1) % resultado.ciclo_semanas === 0 &&
                    weekIdx < resultado.cobertura_dia.length - 1
                  return (
                    <TableHead
                      key={`${weekIdx}-${dia}`}
                      className={cn(
                        'w-9 min-w-[36px] px-0 text-center text-[10px] font-medium',
                        dia === 'DOM' && 'font-semibold text-warning',
                        isLastDay && isCycleEnd && 'border-r-2 border-r-purple-400 dark:border-r-purple-500',
                        isLastDay && !isCycleEnd && weekIdx < resultado.cobertura_dia.length - 1 && 'border-r',
                      )}
                    >
                      {dia[0]}
                    </TableHead>
                  )
                })}
              </Fragment>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {resultado.grid.map((row, rowIndex) => {
            const rowLabel = rowLabels?.[rowIndex] ?? row.posto
            return (
              <TableRow key={`${rowLabel}-${rowIndex}`} className="hover:bg-muted/20">
                <TableCell className="sticky left-0 z-10 w-[120px] min-w-[120px] truncate bg-background font-medium">
                  {rowLabel}
                </TableCell>
                <TableCell className="sticky left-[120px] z-10 w-[84px] min-w-[84px] border-r bg-background text-center text-xs text-muted-foreground">
                  {getVariavelDia(row) ? DIAS_CURTOS[getVariavelDia(row)!] : '-'}
                </TableCell>
                <TableCell className="sticky left-[204px] z-10 w-[70px] min-w-[70px] border-r bg-background text-center text-xs text-muted-foreground">
                  {getFixaDia(row) ? DIAS_CURTOS[getFixaDia(row)!] : '-'}
                </TableCell>
                {row.semanas.flatMap((sem, weekIdx) =>
                  sem.dias.map((status, dayIdx) => {
                    const simbolo = resolveSimbolo(status, dayIdx, row)
                    const hasViolation = sem.consecutivos_max > 6
                    const isLastDay = dayIdx === 6
                    const isCycleEnd =
                      resultado.ciclo_semanas > 0 &&
                      (weekIdx + 1) % resultado.ciclo_semanas === 0 &&
                      weekIdx < resultado.cobertura_dia.length - 1
                    const sigla = simbolo === 'DT' ? 'T' : simbolo === 'DF' ? 'F' : simbolo
                    return (
                      <TableCell
                        key={`${weekIdx}-${dayIdx}`}
                        className={cn(
                          'w-9 min-w-[36px] px-0 py-1 text-center text-xs select-none',
                          CELULA_CLASSES[simbolo] ?? CELULA_CLASSES.F,
                          hasViolation && 'ring-1 ring-red-500',
                          isLastDay && isCycleEnd && 'border-r-2 border-r-purple-400 dark:border-r-purple-500',
                          isLastDay && !isCycleEnd && weekIdx < resultado.cobertura_dia.length - 1 && 'border-r',
                        )}
                      >
                        {sigla}
                      </TableCell>
                    )
                  }),
                )}
              </TableRow>
            )
          })}
          <TableRow className="border-t-2 bg-muted/20">
            <TableCell className="sticky left-0 z-10 w-[120px] min-w-[120px] truncate bg-muted font-medium text-blue-600 dark:text-blue-400">
              COBERTURA
            </TableCell>
            <TableCell colSpan={2} className="sticky left-[120px] z-10 border-r bg-muted" />
            {resultado.cobertura_dia.flatMap((cob, weekIdx) =>
              cob.cobertura.map((val, dayIdx) => {
                const isLastDay = dayIdx === 6
                const isCycleEnd =
                  resultado.ciclo_semanas > 0 &&
                  (weekIdx + 1) % resultado.ciclo_semanas === 0 &&
                  weekIdx < resultado.cobertura_dia.length - 1
                return (
                  <TableCell
                    key={`${weekIdx}-${dayIdx}`}
                    className={cn(
                      'w-9 min-w-[36px] px-0 py-1 text-center text-xs font-bold',
                      dayIdx === 6
                        ? (val >= (domingoTarget ?? 0) ? 'text-blue-600 dark:text-blue-400' : 'text-red-500')
                        : 'text-muted-foreground',
                      isLastDay && isCycleEnd && 'border-r-2 border-r-purple-400 dark:border-r-purple-500',
                      isLastDay && !isCycleEnd && weekIdx < resultado.cobertura_dia.length - 1 && 'border-r',
                    )}
                  >
                    {val}
                  </TableCell>
                )
              }),
            )}
          </TableRow>
        </TableBody>
      </Table>
    </div>
  )
}
