import { Lightbulb, Loader2, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import {
  DIAS_CURTOS,
  type CicloGridCoverageActions,
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
  /** 'app' = interactive with sticky cols + scroll. 'export' = static, paginated for print. */
  variant?: 'app' | 'export'
  onFolgaChange?: (
    colaboradorId: number,
    field: 'fixa' | 'variavel',
    value: DiaSemana | null,
  ) => void
  className?: string
  frameBorderClassName?: string
  coverageActions?: CicloGridCoverageActions
  /** Folgas auto-redistribuidas pelo preview (visual feedback) */
  redistributions?: Array<{ pessoa: number; de_dia: number; para_dia: number }>
}

// ─── Layout constants ────────────────────────────────────────────────────────

// App variant widths (original)
const LABEL_COL_WIDTH = 130
const FOLGA_COL_WIDTH = 84
const VAR_COL_LEFT = LABEL_COL_WIDTH
const FIXO_COL_LEFT = LABEL_COL_WIDTH + FOLGA_COL_WIDTH

// Export variant widths (compact for A4 landscape)
const EXPORT_LABEL_COL_WIDTH = 90
const EXPORT_FOLGA_COL_WIDTH = 30

// Max weeks per block when variant='export'
const MAX_WEEKS_PER_BLOCK = 4

// ─── Internal: FolgaSelect ────────────────────────────────────────────────────

interface FolgaSelectProps {
  colaboradorId: number
  field: 'fixa' | 'variavel'
  value: DiaSemana | null
  /** Valor do outro campo (fixa ou variavel) — impede selecionar o mesmo dia */
  otherValue?: DiaSemana | null
  overrideLocal?: boolean
  baseColaborador?: boolean
  mode: 'edit' | 'view'
  blocked: boolean
  onFolgaChange?: CicloGridProps['onFolgaChange']
}

function FolgaSelect({
  colaboradorId,
  field,
  value,
  otherValue,
  overrideLocal = false,
  baseColaborador = false,
  mode,
  blocked,
  onFolgaChange,
}: FolgaSelectProps) {
  const isEditable = mode === 'edit' && !blocked && onFolgaChange != null
  const label = value ? DIAS_CURTOS[value] : '-'

  const dias = DIAS_ORDEM.filter((dia) => {
    if (field === 'variavel') return dia !== 'DOM'
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
      <SelectTrigger
        className={cn(
          'h-7 w-[62px] px-2 text-xs',
          baseColaborador && !overrideLocal && 'border-primary text-primary',
          overrideLocal && 'border-foreground text-foreground',
        )}
      >
        <span className={cn('truncate', !value && 'text-muted-foreground')}>
          {label}
        </span>
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectItem value="__none__" className="text-xs">
            -
          </SelectItem>
          {dias.map((dia) => (
            <SelectItem key={dia} value={dia} className="text-xs">
              {DIAS_CURTOS[dia]}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export function CicloGrid({
  data,
  mode,
  variant = 'app',
  onFolgaChange,
  className,
  frameBorderClassName,
  coverageActions,
  redistributions,
}: CicloGridProps) {
  const { rows, cobertura, demanda, cicloSemanas } = data
  const isExport = variant === 'export'

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
  // Note: semanaIdx here is ABSOLUTE (0-based across all weeks), not relative to a block.
  function isCycleEnd(semanaIdx: number, diaIdx: number): boolean {
    const weekNumber = semanaIdx + 1 // 1-based
    return weekNumber % cicloSemanas === 0 && diaIdx === 6
  }

  // Is this the first day of a new week within a block (adds border-left)?
  // localSemanaIdx is 0-based within the block.
  function isWeekStartInBlock(localSemanaIdx: number): boolean {
    return localSemanaIdx > 0
  }

  const showCoverageReset = !isExport && mode === 'edit'
    && (coverageActions?.onResetAutomatico != null || coverageActions?.onRestaurarColaboradores != null)

  // ─── renderTableBlock ───────────────────────────────────────────────────────
  // Renders a single <table> for weeks [startWeek, endWeek) (0-based indices).
  // For variant='app', called once with (0, totalSemanas).
  // For variant='export', called per block.

  function renderTableBlock(startWeek: number, endWeek: number) {
    const blockWeekCount = endWeek - startWeek

    // Layout values depend on variant
    const labelW = isExport ? EXPORT_LABEL_COL_WIDTH : LABEL_COL_WIDTH
    const folgaW = isExport ? EXPORT_FOLGA_COL_WIDTH : FOLGA_COL_WIDTH
    const varLeft = labelW
    const fixoLeft = labelW + folgaW

    return (
      <table
        className={cn(
          'w-full caption-bottom border-collapse whitespace-nowrap',
          isExport && 'print-colors',
        )}
        style={{
          fontSize: isExport ? 10 : 14,
          tableLayout: isExport ? 'fixed' : undefined,
        }}
      >
        {/* ── THEAD ── */}
        <thead>
          {/* Row 1: "Ciclo de N semanas" + S1, S2, ... labels */}
          <tr>
            {/* Col 1: label */}
            <th
              className={cn(
                'pl-2.5 pr-1 pt-2 pb-0.5 text-left text-xs font-medium text-muted-foreground',
                !isExport && 'sticky left-0 z-20 bg-background',
              )}
              style={isExport
                ? { width: labelW }
                : { width: labelW, minWidth: labelW }}
            >
              Ciclo de {cicloSemanas} semanas
            </th>
            {/* Col 2: Var (empty in row 1) */}
            <th
              className={cn(
                'pt-2 pb-0.5',
                !isExport && 'sticky z-20 bg-background',
              )}
              style={isExport
                ? { width: folgaW }
                : { left: varLeft, width: folgaW, minWidth: folgaW }}
            />
            {/* Col 3: Fixo (empty in row 1) */}
            <th
              className={cn(
                'pt-2 pb-0.5 border-r border-border',
                !isExport && 'sticky z-20 bg-background',
              )}
              style={isExport
                ? { width: folgaW }
                : { left: fixoLeft, width: folgaW, minWidth: folgaW }}
            />
            {/* Week span headers: S{n}, S{n+1}, ... */}
            {Array.from({ length: blockWeekCount }).map((_, localIdx) => {
              const absIdx = startWeek + localIdx
              return (
                <th
                  key={absIdx}
                  colSpan={7}
                  className={cn(
                    'pt-2 pb-0.5 text-center text-xs font-normal text-muted-foreground',
                    isWeekStartInBlock(localIdx) && 'border-l border-border',
                    (absIdx + 1) % cicloSemanas === 0 && 'border-r-2 border-r-purple-500',
                  )}
                >
                  S{absIdx + 1}
                </th>
              )
            })}
          </tr>

          {/* Row 2: bg-muted — empty | Var | Fixo | S T Q Q S S D... */}
          <tr className="border-b border-border bg-muted">
            {/* Col 1: empty */}
            <th
              className={cn(
                'pl-2.5 pr-1 py-2 text-left',
                !isExport && 'sticky left-0 z-20 bg-muted',
              )}
              style={isExport
                ? { width: labelW }
                : { width: labelW, minWidth: labelW }}
            />
            {/* Col 2: "Var" */}
            <th
              className={cn(
                'px-1 py-2 text-center text-xs font-medium text-muted-foreground',
                !isExport && 'sticky z-20 bg-muted',
              )}
              style={isExport
                ? { width: folgaW }
                : { left: varLeft, width: folgaW, minWidth: folgaW }}
            >
              Var
            </th>
            {/* Col 3: "Fixo" */}
            <th
              className={cn(
                'px-1 py-2 text-center text-xs font-medium text-muted-foreground border-r border-border',
                !isExport && 'sticky z-20 bg-muted',
              )}
              style={isExport
                ? { width: folgaW }
                : { left: fixoLeft, width: folgaW, minWidth: folgaW }}
            >
              Fixo
            </th>
            {/* Day headers for every week in this block */}
            {Array.from({ length: blockWeekCount }).map((_, localIdx) => {
              const absIdx = startWeek + localIdx
              return DIAS_HEADER.map((letra, diaIdx) => {
                const isDom = diaIdx === 6
                const isFirst = diaIdx === 0 && isWeekStartInBlock(localIdx)
                const isCycleEndCell = isCycleEnd(absIdx, diaIdx)
                return (
                  <th
                    key={`${absIdx}-${diaIdx}`}
                    className={cn(
                      'px-[3px] py-2 text-center text-xs font-medium text-muted-foreground',
                      isDom && 'font-semibold text-warning',
                      isFirst && 'border-l border-border',
                      isCycleEndCell && 'border-r-2 border-r-purple-500',
                    )}
                  >
                    {letra}
                  </th>
                )
              })
            })}
          </tr>
        </thead>

        {/* ── TBODY ── */}
        <tbody>
          {/* Colaborador rows */}
          {rows.map((row, rowIdx) => (
            <tr
              key={row.id}
              className={cn(
                'border-b border-border/50',
                !isExport && 'group transition-colors hover:bg-muted',
              )}
            >
              {/* Col 1: Name + Posto */}
              <td
                className={cn(
                  'pl-2.5 pr-1 py-1.5 text-left',
                  !isExport && 'sticky left-0 z-10 bg-background',
                )}
                style={isExport
                  ? { width: labelW }
                  : { width: labelW, minWidth: labelW }}
              >
                <div className="flex flex-col">
                  <span
                    className={cn(
                      'font-medium text-foreground',
                      isExport ? 'text-[10px]' : 'text-[13px]',
                    )}
                    style={{ lineHeight: 1.3 }}
                  >
                    {row.nome}
                  </span>
                  <span
                    className={cn(
                      'text-muted-foreground',
                      isExport ? 'text-[8px]' : 'text-[11px]',
                    )}
                    style={{ lineHeight: 1.3 }}
                  >
                    {row.posto}
                  </span>
                </div>
              </td>

              {/* Col 2: Var folga */}
              <td
                className={cn(
                  'px-1 py-1.5 text-center align-middle',
                  !isExport && 'sticky z-10 bg-background',
                )}
                style={isExport
                  ? { width: folgaW }
                  : { left: varLeft, width: folgaW, minWidth: folgaW }}
              >
                {isExport ? (
                  <span className={cn('text-[9px]', row.variavel ? 'text-foreground' : 'text-muted-foreground')}>
                    {row.variavel ? DIAS_CURTOS[row.variavel] : '-'}
                  </span>
                ) : (
                  <FolgaSelect
                    colaboradorId={row.id}
                    field="variavel"
                    value={row.variavel}
                    otherValue={row.fixa}
                    overrideLocal={row.overrideVariavelLocal}
                    baseColaborador={row.baseVariavelColaborador}
                    mode={mode}
                    blocked={row.blocked}
                    onFolgaChange={onFolgaChange}
                  />
                )}
              </td>

              {/* Col 3: Fixo folga */}
              <td
                className={cn(
                  'px-1 py-1.5 text-center align-middle border-r border-border',
                  !isExport && 'sticky z-10 bg-background',
                )}
                style={isExport
                  ? { width: folgaW }
                  : { left: fixoLeft, width: folgaW, minWidth: folgaW }}
              >
                {isExport ? (
                  <span className={cn('text-[9px]', row.fixa ? 'text-foreground' : 'text-muted-foreground')}>
                    {row.fixa ? DIAS_CURTOS[row.fixa] : '-'}
                  </span>
                ) : (
                  <FolgaSelect
                    colaboradorId={row.id}
                    field="fixa"
                    value={row.fixa}
                    otherValue={row.variavel}
                    overrideLocal={row.overrideFixaLocal}
                    baseColaborador={row.baseFixaColaborador}
                    mode={mode}
                    blocked={row.blockedFixa ?? row.blocked}
                    onFolgaChange={onFolgaChange}
                  />
                )}
              </td>

              {/* Symbol cells for each day of each week in this block */}
              {row.semanas.slice(startWeek, endWeek).map((semana, localIdx) => {
                const absIdx = startWeek + localIdx
                return semana.map((simbolo, diaIdx) => {
                  const config = SIMBOLO_CONFIG[simbolo as Simbolo] ?? SIMBOLO_CONFIG['.']
                  const isFirst = diaIdx === 0 && isWeekStartInBlock(localIdx)
                  const isCycleEndCell = isCycleEnd(absIdx, diaIdx)
                  const isRedist = redistributions?.some(r => r.pessoa === rowIdx && r.para_dia === diaIdx)
                  return (
                    <td
                      key={`${absIdx}-${diaIdx}`}
                      className={cn(
                        'px-[3px] py-1.5 text-center align-middle',
                        isFirst && 'border-l border-border',
                        isCycleEndCell && 'border-r-2 border-r-purple-500',
                      )}
                      title={isRedist ? 'O sistema moveu esta folga para melhorar a cobertura' : undefined}
                    >
                      <span
                        className={cn(
                          'inline-block rounded px-0.5 text-xs font-semibold',
                          isExport ? 'py-0.5' : 'min-w-[30px] py-1',
                          config.cell,
                        )}
                      >
                        {simbolo === '.' ? '\u00B7' : simbolo === '-' ? '\u2013' : simbolo}
                        {isRedist && <span className="text-[8px] text-blue-500 align-super">&#8635;</span>}
                      </span>
                    </td>
                  )
                })
              })}
            </tr>
          ))}

          {/* COBERTURA row */}
          <tr className="border-t-2 border-border">
            {/* Label */}
            <td
              className={cn(
                'pl-2.5 pr-1 py-2 text-left text-xs font-semibold text-blue-600 dark:text-blue-500 border-t-2 border-border',
                !isExport && 'sticky left-0 z-10 bg-background',
              )}
              style={isExport
                ? { width: labelW }
                : { width: labelW, minWidth: labelW }}
            >
              COBERTURA
            </td>
            {/* Var cell — Sugerir button */}
            <td
              className={cn(
                'px-1 py-2 border-t-2 border-border',
                !isExport && 'sticky z-10 bg-background',
              )}
              style={isExport
                ? { width: folgaW }
                : { left: varLeft, width: folgaW, minWidth: folgaW }}
            >
              {showCoverageReset && coverageActions?.onSuggest && (
                <div className="flex justify-center">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    title="Sugerir arranjo"
                    onClick={coverageActions.onSuggest}
                    disabled={coverageActions.suggestLoading}
                  >
                    {coverageActions.suggestLoading
                      ? <Loader2 className="size-4 animate-spin" />
                      : <Lightbulb className="size-4" />
                    }
                  </Button>
                </div>
              )}
            </td>
            {/* Empty Fixo cell */}
            <td
              className={cn(
                'px-1 py-2 border-r border-border border-t-2',
                !isExport && 'sticky z-10 bg-background',
              )}
              style={isExport
                ? { width: folgaW }
                : { left: fixoLeft, width: folgaW, minWidth: folgaW }}
            >
              {showCoverageReset && (
                <div className="flex justify-center">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7"
                        title="Resetar simulacao"
                      >
                        <RotateCcw className="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                      {coverageActions?.onResetAutomatico && (
                        <DropdownMenuItem onClick={coverageActions.onResetAutomatico}>
                          Voltar ao automatico
                        </DropdownMenuItem>
                      )}
                      {coverageActions?.onRestaurarColaboradores && (
                        <DropdownMenuItem onClick={coverageActions.onRestaurarColaboradores}>
                          Restaurar dos colaboradores
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              )}
            </td>

            {/* Coverage cells for weeks in this block */}
            {Array.from({ length: blockWeekCount }).map((_, localIdx) => {
              const absIdx = startWeek + localIdx
              return Array.from({ length: 7 }).map((_, diaIdx) => {
                const cob = cobertura[absIdx]?.[diaIdx] ?? 0
                const dem = demanda[diaIdx] ?? 0
                const isDeficit = cob < dem
                const isOk = dem > 0 && cob >= dem
                const isFirst = diaIdx === 0 && isWeekStartInBlock(localIdx)
                const isCycleEndCell = isCycleEnd(absIdx, diaIdx)
                return (
                  <td
                    key={`cov-${absIdx}-${diaIdx}`}
                    className={cn(
                      'px-[3px] py-2 text-center align-middle text-xs font-bold',
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
              })
            })}
          </tr>
        </tbody>
      </table>
    )
  }

  // ─── renderLegenda ──────────────────────────────────────────────────────────

  function renderLegenda() {
    return (
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
          <span className="h-[14px] w-[3px] rounded-sm bg-purple-500 dark:bg-purple-400" />
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
    )
  }

  // ─── Render (export variant — paginated) ────────────────────────────────────

  if (isExport && totalSemanas > MAX_WEEKS_PER_BLOCK) {
    const blocks: { start: number; end: number }[] = []
    for (let i = 0; i < totalSemanas; i += MAX_WEEKS_PER_BLOCK) {
      blocks.push({ start: i, end: Math.min(i + MAX_WEEKS_PER_BLOCK, totalSemanas) })
    }

    return (
      <div className={cn('flex flex-col gap-3', className)}>
        {blocks.map((block, blockIdx) => (
          <div
            key={blockIdx}
            style={{ breakInside: 'avoid', pageBreakInside: 'avoid' }}
          >
            {blocks.length > 1 && (
              <div className="mb-1 pl-1.5 text-[10px] font-semibold text-muted-foreground">
                S{block.start + 1} &ndash; S{block.end}
              </div>
            )}
            <div className="print-colors rounded-md border border-border">
              {renderTableBlock(block.start, block.end)}
            </div>
          </div>
        ))}
        {renderLegenda()}
      </div>
    )
  }

  // ─── Render (export variant — single block, <= 4 weeks) ─────────────────────

  if (isExport) {
    return (
      <div className={cn('flex flex-col gap-3', className)}>
        <div className="print-colors rounded-md border border-border">
          {renderTableBlock(0, totalSemanas)}
        </div>
        {renderLegenda()}
      </div>
    )
  }

  // ─── Render (app variant — original behavior) ──────────────────────────────

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      {/* Grid wrapper — border + rounded + horizontal scroll */}
      <div className={cn('print-colors overflow-x-auto rounded-md border', frameBorderClassName ?? 'border-border')}>
        {/*
          We intentionally use a raw <table> here (not the shadcn Table wrapper)
          because the shadcn Table wraps in an overflow-auto div which conflicts
          with our own scroll container and breaks sticky columns.
        */}
        {renderTableBlock(0, totalSemanas)}
      </div>
      {renderLegenda()}
    </div>
  )
}
