import { Fragment, useEffect, useMemo, useState } from 'react'
import { Badge } from '@/components/ui/badge'
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
import type {
  Alocacao,
  Colaborador,
  DiaSemana,
  Escala,
  Funcao,
  RegraHorarioColaborador,
} from '@shared/index'
import type { CicloViewMode } from '@/componentes/CicloViewToggle'

const DIAS_ORDEM: DiaSemana[] = ['SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB', 'DOM']
const DIAS_GETDAY: DiaSemana[] = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB']
const DIAS_CURTOS: Record<DiaSemana, string> = {
  SEG: 'Seg',
  TER: 'Ter',
  QUA: 'Qua',
  QUI: 'Qui',
  SEX: 'Sex',
  SAB: 'Sab',
  DOM: 'Dom',
}

type WeekMap = Record<DiaSemana, string | null>

interface EscalaCicloResumoProps {
  escala: Escala
  alocacoes: Alocacao[]
  colaboradores: Colaborador[]
  funcoes: Funcao[]
  regrasPadrao?: RegraHorarioColaborador[]
  onFolgaChange?: (colaboradorId: number, field: 'folga_fixa_dia_semana' | 'folga_variavel_dia_semana', value: DiaSemana | null) => void
  mostrarTodasSemanas?: boolean
  className?: string
  // Controlled view mode (optional — falls back to internal state)
  viewMode?: CicloViewMode
}

// ── Unified symbols (used in both views) ──

type Simbolo = 'T' | 'FF' | 'FV' | 'DT' | 'DF' | 'I' | '.' | '-'

const SIMBOLO_CLASSES: Record<Simbolo, {
  cell: string
  sigla: string
  swatch: string
  descricao: string
}> = {
  T: {
    cell: 'bg-success/10 text-success font-medium',
    sigla: 'T',
    swatch: 'bg-success/30 text-success',
    descricao: 'Trabalho',
  },
  FF: {
    cell: 'bg-slate-200 text-slate-700 font-semibold dark:bg-slate-700 dark:text-slate-200',
    sigla: 'FF',
    swatch: 'bg-slate-300 text-slate-700 dark:bg-slate-600 dark:text-slate-200',
    descricao: 'Folga fixa',
  },
  FV: {
    cell: 'bg-warning/10 text-warning font-semibold',
    sigla: 'FV',
    swatch: 'bg-warning/30 text-warning',
    descricao: 'Folga variavel',
  },
  DT: {
    cell: 'bg-warning/10 text-warning font-semibold ring-1 ring-inset ring-warning/40',
    sigla: 'DT',
    swatch: 'bg-warning/30 text-warning ring-1 ring-inset ring-warning/40',
    descricao: 'Dom trabalhado',
  },
  DF: {
    cell: 'bg-blue-100 text-blue-700 font-semibold ring-1 ring-inset ring-blue-400 dark:bg-blue-950 dark:text-blue-400 dark:ring-blue-600',
    sigla: 'DF',
    swatch: 'bg-blue-200 text-blue-700 ring-1 ring-inset ring-blue-400 dark:bg-blue-800 dark:text-blue-300',
    descricao: 'Dom folga',
  },
  I: {
    cell: 'bg-rose-100 text-rose-700 font-semibold dark:bg-rose-900 dark:text-rose-200',
    sigla: 'I',
    swatch: 'bg-rose-200 text-rose-700 dark:bg-rose-700 dark:text-rose-200',
    descricao: 'Indisponivel',
  },
  '.': {
    cell: 'text-muted-foreground',
    sigla: '\u00B7',
    swatch: 'bg-muted text-muted-foreground',
    descricao: 'Sem alocacao',
  },
  '-': {
    cell: 'text-muted-foreground',
    sigla: '\u2013',
    swatch: '',
    descricao: 'Sem titular',
  },
}

const LEGENDA: Simbolo[] = ['T', 'FF', 'FV', 'DT', 'DF', 'I', '.']

function FolgaSelect({
  colabId,
  field,
  inferredFolgas,
  onFolgaChange,
}: {
  colabId: number | null
  field: 'folga_fixa_dia_semana' | 'folga_variavel_dia_semana'
  inferredFolgas: Map<number, { fixa: DiaSemana | null; variavel: DiaSemana | null }>
  onFolgaChange?: (colaboradorId: number, field: 'folga_fixa_dia_semana' | 'folga_variavel_dia_semana', value: DiaSemana | null) => void
}) {
  if (!colabId) return <span className="text-xs text-muted-foreground">-</span>

  const inf = inferredFolgas.get(colabId)
  const current = field === 'folga_fixa_dia_semana' ? inf?.fixa : inf?.variavel

  if (!onFolgaChange) {
    return (
      <span className={cn('text-xs', current ? 'text-foreground' : 'text-muted-foreground')}>
        {current ? DIAS_CURTOS[current] : '-'}
      </span>
    )
  }

  return (
    <Select
      value={current ?? '__none__'}
      onValueChange={(val) => {
        onFolgaChange(colabId, field, val === '__none__' ? null : (val as DiaSemana))
      }}
    >
      <SelectTrigger className="h-7 w-[70px] px-2 text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__none__" className="text-xs">-</SelectItem>
        {DIAS_ORDEM
          .filter(dia => field === 'folga_fixa_dia_semana' || dia !== 'DOM')
          .map((dia) => (
            <SelectItem key={dia} value={dia} className="text-xs">{DIAS_CURTOS[dia]}</SelectItem>
          ))}
      </SelectContent>
    </Select>
  )
}

function toIsoDate(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function makeEmptyWeek(): WeekMap {
  return {
    SEG: null,
    TER: null,
    QUA: null,
    QUI: null,
    SEX: null,
    SAB: null,
    DOM: null,
  }
}

function gcd(a: number, b: number): number {
  let x = Math.abs(a)
  let y = Math.abs(b)
  while (y !== 0) {
    const t = y
    y = x % y
    x = t
  }
  return Math.max(1, x)
}

function mode(numbers: number[]): number | null {
  if (numbers.length === 0) return null
  const count = new Map<number, number>()
  for (const n of numbers) count.set(n, (count.get(n) ?? 0) + 1)
  let best: number | null = null
  let bestCount = -1
  for (const [n, c] of count.entries()) {
    if (c > bestCount) {
      best = n
      bestCount = c
    }
  }
  return best
}

export function EscalaCicloResumo({
  escala,
  alocacoes,
  colaboradores,
  funcoes,
  regrasPadrao = [],
  onFolgaChange,
  mostrarTodasSemanas = false,
  className,
  viewMode: controlledViewMode,
}: EscalaCicloResumoProps) {
  const alocMap = useMemo(() => {
    const map = new Map<string, Alocacao>()
    for (const a of alocacoes) {
      map.set(`${a.colaborador_id}-${a.data}`, a)
    }
    return map
  }, [alocacoes])

  const regrasMap = useMemo(() => {
    const map = new Map<number, RegraHorarioColaborador>()
    for (const regra of regrasPadrao) map.set(regra.colaborador_id, regra)
    return map
  }, [regrasPadrao])

  const postosOrdenados = useMemo(
    () => [...funcoes].sort((a, b) => a.ordem - b.ordem || a.apelido.localeCompare(b.apelido)),
    [funcoes],
  )

  const titularPorPosto = useMemo(() => {
    const map = new Map<number, Colaborador>()
    for (const colab of colaboradores) {
      if (colab.funcao_id != null) map.set(colab.funcao_id, colab)
    }
    return map
  }, [colaboradores])

  const rows = useMemo(() => {
    return postosOrdenados.map((posto) => {
      const titular = titularPorPosto.get(posto.id) ?? null
      return {
        posto,
        titular,
        regra: titular ? (regrasMap.get(titular.id) ?? null) : null,
      }
    })
  }, [postosOrdenados, regrasMap, titularPorPosto])

  const weeks = useMemo(() => {
    const start = new Date(`${escala.data_inicio}T00:00:00`)
    const end = new Date(`${escala.data_fim}T00:00:00`)
    const dates: Date[] = []

    const cursor = new Date(start)
    while (cursor <= end) {
      dates.push(new Date(cursor))
      cursor.setDate(cursor.getDate() + 1)
    }

    const grouped: WeekMap[] = []
    let currentWeek = makeEmptyWeek()
    let countInWeek = 0

    for (const date of dates) {
      const dia = DIAS_GETDAY[date.getDay()]
      currentWeek[dia] = toIsoDate(date)
      countInWeek += 1

      if (countInWeek === 7) {
        grouped.push(currentWeek)
        currentWeek = makeEmptyWeek()
        countInWeek = 0
      }
    }

    if (countInWeek > 0) {
      grouped.push(currentWeek)
    }

    return grouped
  }, [escala.data_inicio, escala.data_fim])

  const periodoCiclo = useMemo(() => {
    if (weeks.length === 0) return 0
    const totalPostos = rows.length
    if (totalPostos <= 0) return weeks.length

    const sundayWorkers = weeks
      .map((week) => {
        const sunday = week.DOM
        if (!sunday) return 0

        let worked = 0
        for (const row of rows) {
          if (!row.titular) continue
          const alloc = alocMap.get(`${row.titular.id}-${sunday}`)
          if (alloc?.status === 'TRABALHO') worked += 1
        }
        return worked
      })
      .filter((count) => count > 0)

    const domDemand = mode(sundayWorkers) ?? 1
    const base = Math.floor(totalPostos / gcd(totalPostos, domDemand))
    return Math.max(1, Math.min(weeks.length, base))
  }, [weeks, rows, alocMap])

  // Week selection always internal (S1/S2 buttons live inside the component)
  const [selectedWeek, setSelectedWeek] = useState(0)
  const [internalViewMode, setInternalViewMode] = useState<CicloViewMode>('tabela')

  const activeViewMode = controlledViewMode ?? internalViewMode

  useEffect(() => {
    if (periodoCiclo <= 0) {
      setSelectedWeek(0)
      return
    }
    if (selectedWeek >= periodoCiclo) {
      setSelectedWeek(Math.max(0, periodoCiclo - 1))
    }
  }, [periodoCiclo])

  const week = weeks[selectedWeek] ?? makeEmptyWeek()

  // Inferir folga fixa vs variavel: 3 cenarios
  // 1) Ambos definidos na regra → usar direto
  // 2) So fixa definida → fixa da regra, variavel null
  // 3) Nenhum → inferir do padrao de alocacoes
  const inferredFolgas = useMemo(() => {
    const cicloWeeks = weeks.slice(0, Math.max(1, periodoCiclo))
    const map = new Map<number, { fixa: DiaSemana | null; variavel: DiaSemana | null }>()

    for (const row of rows) {
      if (!row.titular) continue
      const colabId = row.titular.id

      const regra = regrasMap.get(colabId)

      // Caso 1: ambos definidos explicitamente
      if (regra?.folga_fixa_dia_semana && regra?.folga_variavel_dia_semana) {
        map.set(colabId, {
          fixa: regra.folga_fixa_dia_semana,
          variavel: regra.folga_variavel_dia_semana,
        })
        continue
      }

      // Caso 2: so fixa definida (variavel nao configurada)
      if (regra?.folga_fixa_dia_semana) {
        map.set(colabId, {
          fixa: regra.folga_fixa_dia_semana,
          variavel: null,
        })
        continue
      }

      // Caso 3: nenhum definido — inferir do padrao de alocacoes
      const folgaCount = new Map<DiaSemana, number>()
      for (const w of cicloWeeks) {
        for (const dia of DIAS_ORDEM) {
          const dateStr = w[dia]
          if (!dateStr) continue
          const alloc = alocMap.get(`${colabId}-${dateStr}`)
          if (alloc && alloc.status !== 'TRABALHO' && alloc.status !== 'INDISPONIVEL') {
            folgaCount.set(dia, (folgaCount.get(dia) ?? 0) + 1)
          }
        }
      }

      if (folgaCount.size === 0) {
        map.set(colabId, { fixa: null, variavel: null })
        continue
      }

      // Dia com mais folgas = fixa, segundo = variavel
      const sorted = [...folgaCount.entries()]
        .filter(([dia]) => dia !== 'DOM') // domingo nao e fixa nem variavel
        .sort((a, b) => b[1] - a[1])
      const fixaDia = sorted[0]?.[0] ?? null
      const variavelDia = sorted.length > 1 ? sorted[1][0] : null

      map.set(colabId, { fixa: fixaDia, variavel: variavelDia })
    }

    return map
  }, [rows, weeks, periodoCiclo, alocMap, regrasMap])

  const pendentesFolgaConfig = useMemo(
    () => rows.filter((row) => {
      if (!row.titular) return false
      const inf = inferredFolgas.get(row.titular.id)
      return !inf?.fixa || !inf?.variavel
    }).length,
    [rows, inferredFolgas],
  )

  function resolveSymbol(colab: Colaborador | null, dia: DiaSemana, dateStr: string | null): Simbolo {
    if (!colab) return '-'
    if (!dateStr) return '-'

    const alloc = alocMap.get(`${colab.id}-${dateStr}`)
    if (!alloc) return '.'

    if (alloc.status === 'TRABALHO') {
      return dia === 'DOM' ? 'DT' : 'T'
    }
    if (alloc.status === 'INDISPONIVEL') return 'I'

    // Folga — domingo gets DF, otherwise check fixed vs variable
    if (dia === 'DOM') return 'DF'
    const inf = inferredFolgas.get(colab.id)
    // Classificar: FF so se dia bate com fixa, FV so se bate com variavel
    if (inf?.fixa && inf.fixa === dia) return 'FF'
    if (inf?.variavel && inf.variavel === dia) return 'FV'
    // Folga nao classificada — default FF
    return 'FF'
  }

  if (rows.length === 0) {
    return (
      <div className={cn('rounded-md border border-dashed px-4 py-6 text-sm text-muted-foreground', className)}>
        Nenhum posto definido para gerar o ciclo.
      </div>
    )
  }

  const isResumo = !mostrarTodasSemanas && activeViewMode === 'resumo'

  const weeksToRender = mostrarTodasSemanas
    ? weeks.slice(0, Math.max(1, periodoCiclo))
    : [week]

  function renderTable(weekData: WeekMap, weekLabel?: string) {
    return (
      <div key={weekLabel} className="space-y-1">
        {weekLabel && (
          <h3 className="text-xs font-semibold text-muted-foreground">{weekLabel}</h3>
        )}
        <div className="rounded-md border print-colors">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30">
                <TableHead className="w-[120px]">Posto</TableHead>
                <TableHead className="w-[180px]">Titular</TableHead>
                <TableHead className="w-[86px] text-center">Variavel</TableHead>
                <TableHead className="w-[70px] text-center">Fixo</TableHead>
                {DIAS_ORDEM.map((dia) => (
                  <TableHead key={dia} className="w-[54px] text-center">{dia}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ posto, titular }) => (
                <TableRow key={posto.id} className="hover:bg-muted/20">
                  <TableCell className="font-medium">{posto.apelido}</TableCell>
                  <TableCell className={cn('text-sm', !titular && 'italic text-muted-foreground')}>
                    {titular?.nome ?? '(sem titular)'}
                  </TableCell>
                  <TableCell className="p-1 text-center">
                    <FolgaSelect
                      colabId={titular?.id ?? null}
                      field="folga_variavel_dia_semana"
                      inferredFolgas={inferredFolgas}
                      onFolgaChange={mostrarTodasSemanas ? undefined : onFolgaChange}
                    />
                  </TableCell>
                  <TableCell className="p-1 text-center">
                    <FolgaSelect
                      colabId={titular?.id ?? null}
                      field="folga_fixa_dia_semana"
                      inferredFolgas={inferredFolgas}
                      onFolgaChange={mostrarTodasSemanas ? undefined : onFolgaChange}
                    />
                  </TableCell>
                  {DIAS_ORDEM.map((dia) => {
                    const simbolo = resolveSymbol(titular, dia, weekData[dia])
                    const estado = SIMBOLO_CLASSES[simbolo]
                    return (
                      <TableCell
                        key={`${posto.id}-${dia}`}
                        className={cn(
                          'text-center text-sm select-none',
                          estado.cell,
                        )}
                        title={estado.descricao}
                        aria-label={estado.descricao}
                      >
                        {estado.sigla}
                      </TableCell>
                    )
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    )
  }

  function renderResumoGrid() {
    return (
      <div className="overflow-x-auto rounded-md border print-colors">
        <Table>
          <TableHeader>
            {/* Row 1: Week group headers */}
            <TableRow className="bg-muted/30">
              <TableHead
                rowSpan={2}
                className="sticky left-0 z-20 w-[100px] min-w-[100px] bg-muted"
              >
                Posto
              </TableHead>
              <TableHead
                rowSpan={2}
                className="sticky left-[100px] z-20 w-[140px] min-w-[140px] border-r bg-muted"
              >
                Titular
              </TableHead>
              {weeks.map((_, idx) => {
                const isCycleEnd = periodoCiclo > 0 && (idx + 1) % periodoCiclo === 0 && idx < weeks.length - 1
                return (
                  <TableHead
                    key={`wh-${idx}`}
                    colSpan={7}
                    className={cn(
                      'text-center text-xs font-semibold',
                      isCycleEnd && 'border-r-2 border-r-purple-400 dark:border-r-purple-500',
                    )}
                  >
                    S{idx + 1}
                  </TableHead>
                )
              })}
            </TableRow>
            {/* Row 2: Day-of-week labels */}
            <TableRow className="bg-muted/30">
              {weeks.map((_, weekIdx) => (
                <Fragment key={`dl-${weekIdx}`}>
                  {DIAS_ORDEM.map((dia, diaIdx) => {
                    const isLastDay = diaIdx === 6
                    const isCycleEnd = periodoCiclo > 0 && (weekIdx + 1) % periodoCiclo === 0 && weekIdx < weeks.length - 1
                    return (
                      <TableHead
                        key={`${weekIdx}-${dia}`}
                        className={cn(
                          'w-9 min-w-[36px] px-0 text-center text-[10px] font-medium',
                          dia === 'DOM' && 'font-semibold text-warning',
                          isLastDay && isCycleEnd && 'border-r-2 border-r-purple-400 dark:border-r-purple-500',
                          isLastDay && !isCycleEnd && weekIdx < weeks.length - 1 && 'border-r',
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
            {rows.map(({ posto, titular }) => (
              <TableRow key={posto.id} className="hover:bg-muted/20">
                <TableCell className="sticky left-0 z-10 w-[100px] min-w-[100px] truncate bg-background font-medium">
                  {posto.apelido}
                </TableCell>
                <TableCell
                  className={cn(
                    'sticky left-[100px] z-10 w-[140px] min-w-[140px] truncate border-r bg-background',
                    !titular && 'italic text-muted-foreground',
                  )}
                >
                  {titular?.nome ?? '(sem titular)'}
                </TableCell>
                {weeks.map((weekData, weekIdx) => (
                  <Fragment key={`r-${posto.id}-${weekIdx}`}>
                    {DIAS_ORDEM.map((dia, diaIdx) => {
                      const simbolo = resolveSymbol(titular, dia, weekData[dia])
                      const estado = SIMBOLO_CLASSES[simbolo]
                      const dateStr = weekData[dia]
                      const isLastDay = diaIdx === 6
                      const isCycleEnd = periodoCiclo > 0 && (weekIdx + 1) % periodoCiclo === 0 && weekIdx < weeks.length - 1
                      return (
                        <TableCell
                          key={`${weekIdx}-${dia}`}
                          className={cn(
                            'w-9 min-w-[36px] px-0 py-1 text-center text-xs select-none',
                            estado.cell,
                            isLastDay && isCycleEnd && 'border-r-2 border-r-purple-400 dark:border-r-purple-500',
                            isLastDay && !isCycleEnd && weekIdx < weeks.length - 1 && 'border-r',
                          )}
                          title={
                            dateStr
                              ? `${DIAS_CURTOS[dia]} ${dateStr.slice(8)}/${dateStr.slice(5, 7)} — ${estado.descricao}`
                              : estado.descricao
                          }
                        >
                          {estado.sigla}
                        </TableCell>
                      )
                    })}
                  </Fragment>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    )
  }

  return (
    <div className={cn('space-y-3', className)}>
      {/* Controls row: toggle (only uncontrolled) + S1/S2 week selector + pendentes badge */}
      {!mostrarTodasSemanas && (
        <div className="flex flex-wrap items-center gap-3">
          {/* Inline toggle only when viewMode is NOT controlled externally */}
          {controlledViewMode == null && (
            <div className="inline-flex rounded-lg border bg-muted p-0.5">
              <button
                type="button"
                className={cn(
                  'rounded-md px-3 py-1 text-xs font-medium transition-colors',
                  internalViewMode === 'tabela'
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                )}
                onClick={() => setInternalViewMode('tabela')}
              >
                Tabela
              </button>
              <button
                type="button"
                className={cn(
                  'rounded-md px-3 py-1 text-xs font-medium transition-colors',
                  internalViewMode === 'resumo'
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                )}
                onClick={() => setInternalViewMode('resumo')}
              >
                Resumo
              </button>
            </div>
          )}

          {/* S1/S2 week selector — always inside, only in tabela mode */}
          {activeViewMode === 'tabela' && periodoCiclo > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              {Array.from({ length: periodoCiclo }, (_, idx) => idx).map((idx) => (
                <button
                  key={idx}
                  type="button"
                  className={cn(
                    'h-8 min-w-10 rounded-md border px-2 text-xs font-medium transition-colors',
                    idx === selectedWeek
                      ? 'bg-secondary text-secondary-foreground'
                      : 'bg-background text-foreground hover:bg-muted',
                  )}
                  onClick={() => setSelectedWeek(idx)}
                >
                  S{idx + 1}
                </button>
              ))}
            </div>
          )}

          {activeViewMode === 'tabela' && pendentesFolgaConfig > 0 && (
            <Badge variant="outline" className="border-warning/20 text-xs text-warning">
              {pendentesFolgaConfig} pendente(s) F/V
            </Badge>
          )}
        </div>
      )}

      {mostrarTodasSemanas
        ? weeksToRender.map((w, idx) => renderTable(w, `Semana ${idx + 1}`))
        : isResumo
          ? renderResumoGrid()
          : renderTable(week)
      }

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-4 pt-1 text-xs text-muted-foreground">
        {LEGENDA.map((simbolo) => {
          const estado = SIMBOLO_CLASSES[simbolo]
          return (
            <span key={simbolo} className="inline-flex items-center gap-1.5">
              <span
                className={cn(
                  'flex size-4 items-center justify-center rounded-sm text-[7px] font-bold',
                  estado.swatch,
                )}
              >
                {estado.sigla}
              </span>
              <span>{estado.descricao}</span>
            </span>
          )
        })}
        {isResumo && periodoCiclo > 0 && (
          <span className="inline-flex items-center gap-1.5 border-l border-border pl-4">
            <span className="h-3 w-0.5 rounded-full bg-purple-400 dark:bg-purple-500" />
            <span>Fim do ciclo</span>
          </span>
        )}
      </div>
    </div>
  )
}
