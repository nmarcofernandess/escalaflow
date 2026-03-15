import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import {
  DIAS_CURTOS,
  DIAS_HEADER,
  DIAS_ORDEM,
  LEGENDA_SIMBOLOS,
  SIMBOLO_CONFIG,
  type CicloGridData,
  type Simbolo,
} from '@/lib/ciclo-grid-types'
import type { DiaSemana } from '@shared/index'

// ─── Props ───────────────────────────────────────────────────────────────────

interface CicloGridProps {
  data: CicloGridData
  mode: 'edit' | 'view'
  onFolgaChange?: (
    colaboradorId: number,
    field: 'folga_fixa_dia_semana' | 'folga_variavel_dia_semana',
    value: DiaSemana | null,
  ) => void
  className?: string
}

// ─── Internal: FolgaSelect ────────────────────────────────────────────────────

interface FolgaSelectProps {
  colaboradorId: number
  field: 'folga_fixa_dia_semana' | 'folga_variavel_dia_semana'
  value: DiaSemana | null
  /** Valor do outro campo (fixa ou variavel) — impede selecionar o mesmo dia */
  otherValue?: DiaSemana | null
  mode: 'edit' | 'view'
  blocked: boolean
  onFolgaChange?: CicloGridProps['onFolgaChange']
}

function FolgaSelect({
  colaboradorId,
  field,
  value,
  otherValue,
  mode,
  blocked,
  onFolgaChange,
}: FolgaSelectProps) {
  const isEditable = mode === 'edit' && !blocked && onFolgaChange != null

  const dias = DIAS_ORDEM.filter((dia) => {
    if (field === 'folga_variavel_dia_semana') return dia !== 'DOM'
    // Impedir fixa == variavel (mesmo dia)
    if (otherValue && otherValue === dia) return false
    return true
  })

  if (!isEditable) {
    return (
      <span
        className={cn(
          'text-xs',
          value ? 'text-foreground' : 'text-muted-foreground',
          blocked && 'text-muted-foreground',
        )}
        title={blocked ? 'Edicao bloqueada neste contexto.' : undefined}
      >
        {value ? DIAS_CURTOS[value] : '-'}
      </span>
    )
  }

  return (
    <Select
      value={value ?? '__none__'}
      onValueChange={(val) => {
        onFolgaChange(
          colaboradorId,
          field,
          val === '__none__' ? null : (val as DiaSemana),
        )
      }}
    >
      <SelectTrigger className="h-7 w-[62px] px-2 text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__none__" className="text-xs">
          -
        </SelectItem>
        {dias.map((dia) => (
          <SelectItem key={dia} value={dia} className="text-xs">
            {DIAS_CURTOS[dia]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export function CicloGrid({ data, mode, onFolgaChange, className }: CicloGridProps) {
  const { rows, cobertura, demanda, cicloSemanas } = data

  // Total number of weeks shown = derived from rows[0].semanas.length (or 0)
  const totalSemanas = rows.length > 0 ? rows[0].semanas.length : 0

  // ─── Empty state ────────────────────────────────────────────────────────────
  if (rows.length === 0) {
    return (
      <div
        className={cn(
          'rounded-md border border-dashed border-border px-6 py-8 text-center text-sm text-muted-foreground',
          className,
        )}
      >
        Nenhum posto definido para gerar o ciclo.
      </div>
    )
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  // Is this the last day of a full cycle? (end of cicloSemanas-th week)
  function isCycleEnd(semanaIdx: number, diaIdx: number): boolean {
    // The last day of week (semanaIdx+1) when (semanaIdx+1) % cicloSemanas === 0
    const weekNumber = semanaIdx + 1 // 1-based
    return weekNumber % cicloSemanas === 0 && diaIdx === 6
  }

  // Is this the first day of a new week (adds wkb border-left)?
  function isWeekStart(semanaIdx: number): boolean {
    return semanaIdx > 0
  }

  // ─── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      {/* Grid wrapper — border + rounded + horizontal scroll */}
      <div className="print-colors overflow-x-auto rounded-md border border-border">
        {/*
          We intentionally use a raw <table> here (not the shadcn Table wrapper)
          because the shadcn Table wraps in an overflow-auto div which conflicts
          with our own scroll container and breaks sticky columns.
        */}
        <table className="w-full caption-bottom border-collapse whitespace-nowrap" style={{ fontSize: 14 }}>
          {/* ── THEAD ── */}
          <thead>
            {/* Row 1: transparent — "Ciclo de N semanas" + S1, S2, ... labels */}
            <tr>
              {/* Sticky col 1: label */}
              <th
                className="sticky left-0 z-20 bg-background px-3 pb-1 pt-2.5 text-left text-xs font-medium text-muted-foreground"
                style={{ width: 130, minWidth: 130 }}
              >
                Ciclo de {cicloSemanas} semanas
              </th>
              {/* Sticky col 2: Var (empty in row 1) */}
              <th
                className="sticky z-20 bg-background pb-1 pt-2.5"
                style={{ left: 130, width: 50, minWidth: 50 }}
              />
              {/* Sticky col 3: Fixo (empty in row 1) */}
              <th
                className="sticky z-20 bg-background pb-1 pt-2.5 border-r border-border"
                style={{ left: 180, width: 50, minWidth: 50 }}
              />
              {/* Week span headers: S1, S2, ... */}
              {Array.from({ length: totalSemanas }).map((_, semanaIdx) => (
                <th
                  key={semanaIdx}
                  colSpan={7}
                  className={cn(
                    'pb-1 pt-2.5 text-center text-xs font-normal text-muted-foreground',
                    isWeekStart(semanaIdx) && 'border-l border-border',
                    // cycle-end marker on the header span (right border of last week in cycle)
                    (semanaIdx + 1) % cicloSemanas === 0 && 'border-r-2 border-r-purple-500',
                  )}
                >
                  S{semanaIdx + 1}
                </th>
              ))}
            </tr>

            {/* Row 2: with bg-muted/50 — empty | Var | Fixo | S T Q Q S S D... */}
            <tr className="border-b border-border bg-muted/50">
              {/* Sticky col 1: empty */}
              <th
                className="sticky left-0 z-20 bg-muted/50 px-3 py-2.5 text-left"
                style={{ width: 130, minWidth: 130 }}
              />
              {/* Sticky col 2: "Var" */}
              <th
                className="sticky z-20 bg-muted/50 px-1 py-2.5 text-center text-xs font-medium text-muted-foreground"
                style={{ left: 130, width: 50, minWidth: 50 }}
              >
                Var
              </th>
              {/* Sticky col 3: "Fixo" */}
              <th
                className="sticky z-20 bg-muted/50 px-1 py-2.5 text-center text-xs font-medium text-muted-foreground border-r border-border"
                style={{ left: 180, width: 50, minWidth: 50 }}
              >
                Fixo
              </th>
              {/* Day headers for every week */}
              {Array.from({ length: totalSemanas }).map((_, semanaIdx) =>
                DIAS_HEADER.map((letra, diaIdx) => {
                  const isDom = diaIdx === 6
                  const isFirst = diaIdx === 0 && isWeekStart(semanaIdx)
                  const isCycleEndCell = isCycleEnd(semanaIdx, diaIdx)
                  return (
                    <th
                      key={`${semanaIdx}-${diaIdx}`}
                      className={cn(
                        'px-1.5 py-2.5 text-center text-xs font-medium text-muted-foreground',
                        isDom && 'font-semibold text-warning',
                        isFirst && 'border-l border-border',
                        isCycleEndCell && 'border-r-2 border-r-purple-500',
                      )}
                    >
                      {letra}
                    </th>
                  )
                }),
              )}
            </tr>
          </thead>

          {/* ── TBODY ── */}
          <tbody>
            {/* Colaborador rows */}
            {rows.map((row) => (
              <tr
                key={row.id}
                className="group border-b border-border/50 transition-colors hover:bg-muted/40"
              >
                {/* Col 1: Name + Posto (sticky) */}
                <td
                  className="sticky left-0 z-10 bg-background px-2.5 py-1.5 text-left group-hover:bg-muted/40"
                  style={{ width: 130, minWidth: 130 }}
                >
                  <div className="flex flex-col leading-snug">
                    <span className="text-[13px] font-medium text-foreground">{row.nome}</span>
                    <span className="text-xs text-muted-foreground">{row.posto}</span>
                  </div>
                </td>

                {/* Col 2: Var folga select (sticky) */}
                <td
                  className="sticky z-10 bg-background px-1 py-1.5 text-center align-middle group-hover:bg-muted/40"
                  style={{ left: 130, width: 46, minWidth: 46 }}
                >
                  <FolgaSelect
                    colaboradorId={row.id}
                    field="folga_variavel_dia_semana"
                    value={row.variavel}
                    otherValue={row.fixa}
                    mode={mode}
                    blocked={row.blocked}
                    onFolgaChange={onFolgaChange}
                  />
                </td>

                {/* Col 3: Fixo folga select (sticky) */}
                <td
                  className="sticky z-10 bg-background px-1 py-1.5 text-center align-middle border-r border-border group-hover:bg-muted/40"
                  style={{ left: 176, width: 46, minWidth: 46 }}
                >
                  <FolgaSelect
                    colaboradorId={row.id}
                    field="folga_fixa_dia_semana"
                    value={row.fixa}
                    otherValue={row.variavel}
                    mode={mode}
                    blocked={row.blocked}
                    onFolgaChange={onFolgaChange}
                  />
                </td>

                {/* Symbol cells for each day of each week */}
                {row.semanas.map((semana, semanaIdx) =>
                  semana.map((simbolo, diaIdx) => {
                    const config = SIMBOLO_CONFIG[simbolo as Simbolo] ?? SIMBOLO_CONFIG['.']
                    const isFirst = diaIdx === 0 && isWeekStart(semanaIdx)
                    const isCycleEndCell = isCycleEnd(semanaIdx, diaIdx)
                    return (
                      <td
                        key={`${semanaIdx}-${diaIdx}`}
                        className={cn(
                          'px-0.5 py-1.5 text-center align-middle',
                          isFirst && 'border-l border-border',
                          isCycleEndCell && 'border-r-2 border-r-purple-500',
                        )}
                      >
                        <span
                          className={cn(
                            'inline-block min-w-[26px] rounded px-0.5 py-0.5 text-xs font-semibold',
                            config.cell,
                          )}
                        >
                          {simbolo === '.' ? '\u00B7' : simbolo === '-' ? '\u2013' : simbolo}
                        </span>
                      </td>
                    )
                  }),
                )}
              </tr>
            ))}

            {/* COBERTURA row */}
            <tr className="border-t-2 border-border">
              {/* Label (sticky) */}
              <td
                className="sticky left-0 z-10 bg-background px-2.5 py-2 text-left text-xs font-semibold text-blue-500 border-t-2 border-border"
                style={{ width: 130, minWidth: 130 }}
              >
                COBERTURA
              </td>
              {/* Empty Var cell (sticky) */}
              <td
                className="sticky z-10 bg-background px-1 py-2 border-t-2 border-border"
                style={{ left: 130, width: 46, minWidth: 46 }}
              />
              {/* Empty Fixo cell (sticky) */}
              <td
                className="sticky z-10 bg-background px-1 py-2 border-r border-border border-t-2"
                style={{ left: 176, width: 46, minWidth: 46 }}
              />

              {/* Coverage cells */}
              {Array.from({ length: totalSemanas }).map((_, semanaIdx) =>
                Array.from({ length: 7 }).map((_, diaIdx) => {
                  const cob = cobertura[semanaIdx]?.[diaIdx] ?? 0
                  const dem = demanda[diaIdx] ?? 0
                  const isDeficit = cob < dem
                  const isOk = dem > 0 && cob >= dem
                  const isFirst = diaIdx === 0 && isWeekStart(semanaIdx)
                  const isCycleEndCell = isCycleEnd(semanaIdx, diaIdx)
                  return (
                    <td
                      key={`cov-${semanaIdx}-${diaIdx}`}
                      className={cn(
                        'px-0.5 py-2 text-center align-middle text-xs font-bold',
                        isFirst && 'border-l border-border',
                        isCycleEndCell && 'border-r-2 border-r-purple-500',
                        isDeficit && 'text-destructive',
                        isOk && 'text-success',
                        !isDeficit && !isOk && 'text-foreground',
                      )}
                    >
                      {cob}
                      <span className="text-[10px] font-normal text-muted-foreground">
                        /{dem}
                      </span>
                    </td>
                  )
                }),
              )}
            </tr>
          </tbody>
        </table>
      </div>

      {/* ── Legenda ── */}
      <div className="flex flex-wrap items-center gap-3.5 text-xs text-muted-foreground">
        {LEGENDA_SIMBOLOS.map((sim) => {
          const config = SIMBOLO_CONFIG[sim]
          return (
            <span key={sim} className="flex items-center gap-1.5">
              <span
                className={cn(
                  'flex h-[18px] w-[18px] items-center justify-center rounded text-[9px] font-bold',
                  config.swatch,
                )}
              >
                {sim}
              </span>
              {config.label}
            </span>
          )
        })}

        {/* Fim do ciclo */}
        <span className="flex items-center gap-1.5 border-l border-border pl-3">
          <span className="h-[14px] w-[3px] rounded-sm bg-purple-500" />
          Fim do ciclo
        </span>

        {/* Deficit example */}
        <span className="flex items-center gap-1.5 border-l border-border pl-3">
          <span className="text-xs font-semibold text-destructive">
            3
            <span className="text-[10px] font-normal text-muted-foreground">/4</span>
          </span>
          Deficit
        </span>
      </div>
    </div>
  )
}
