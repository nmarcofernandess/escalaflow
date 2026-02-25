import { Fragment, useState, useMemo } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { Alocacao, Colaborador, Setor, Demanda, TipoContrato, SetorHorarioSemana } from '@shared/index'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { CORES_CONTRATO, CORES_GENERO } from '@/lib/cores'
import { toMinutes, formatarMinutos, iniciais, formatarData } from '@/lib/formatadores'

const SLOT_SIZE = 15 // minutes per slot
const ROW_HEIGHT = 52 // px per collaborator row
const DIAS_SEMANA_NOME = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']

const DIAS_MAP: Record<number, string> = { 0: 'DOM', 1: 'SEG', 2: 'TER', 3: 'QUA', 4: 'QUI', 5: 'SEX', 6: 'SAB' }

interface TimelineGridProps {
  colaboradores: Colaborador[]
  alocacoes: Alocacao[]
  setor: Setor
  dataSelecionada: string // YYYY-MM-DD format
  dataInicio: string // period start for nav bounds
  dataFim: string // period end for nav bounds
  demandas?: Demanda[]
  tiposContrato?: TipoContrato[]
  horariosSemana?: SetorHorarioSemana[]
  readOnly?: boolean
  onCelulaClick?: (colaboradorId: number, data: string, statusAtual: string) => void
  loadingCell?: { colaboradorId: number; data: string } | null
  changedCells?: Set<string>
  violatedCells?: Set<string>
}

/** Format a Date to YYYY-MM-DD string */
function toDateStr(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function TimelineGrid({
  colaboradores,
  alocacoes,
  setor,
  dataSelecionada,
  dataInicio,
  dataFim,
  demandas = [],
  tiposContrato = [],
  horariosSemana = [],
  readOnly = false,
  onCelulaClick,
  loadingCell,
  changedCells = new Set(),
  violatedCells = new Set(),
}: TimelineGridProps) {
  const [currentDate, setCurrentDate] = useState(dataSelecionada)

  // Time slots calculation
  const { totalSlots, timeLabels } = useMemo(() => {
    const openMin = toMinutes(setor.hora_abertura)
    const closeMin = toMinutes(setor.hora_fechamento)
    const totalMinutes = closeMin - openMin
    const slots = Math.ceil(totalMinutes / SLOT_SIZE)

    const labels: string[] = []
    let currentHour = openMin
    while (currentHour < closeMin) {
      const h = Math.floor(currentHour / 60)
      labels.push(`${String(h).padStart(2, '0')}:00`)
      currentHour += 60
    }

    return { totalSlots: slots, timeLabels: labels }
  }, [setor.hora_abertura, setor.hora_fechamento])

  // Data maps
  const alocacaoMap = useMemo(() => {
    const map = new Map<string, Alocacao[]>()
    for (const a of alocacoes) {
      if (a.data !== currentDate) continue
      const key = String(a.colaborador_id)
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(a)
    }
    // Sort by hora_inicio for each colaborador
    for (const allocs of map.values()) {
      allocs.sort((a, b) => toMinutes(a.hora_inicio ?? '') - toMinutes(b.hora_inicio ?? ''))
    }
    return map
  }, [alocacoes, currentDate])

  const contratoMap = useMemo(() => {
    const map = new Map<number, TipoContrato>()
    for (const tc of tiposContrato) {
      map.set(tc.id, tc)
    }
    return map
  }, [tiposContrato])

  // Sort colaboradores by rank
  const sortedColaboradores = useMemo(() => {
    return [...colaboradores].sort((a, b) => a.rank - b.rank)
  }, [colaboradores])

  // Helper: calculate bar position in grid
  function calcBarPosition(horaInicio: string, horaFim: string): { start: number; end: number } {
    const openMin = toMinutes(setor.hora_abertura)
    const startOffset = toMinutes(horaInicio) - openMin
    const endOffset = toMinutes(horaFim) - openMin
    const gridStart = Math.floor(startOffset / SLOT_SIZE) + 2 // col 1 is sidebar
    const gridEnd = Math.ceil(endOffset / SLOT_SIZE) + 2
    return { start: gridStart, end: gridEnd }
  }

  // Helper: valid lunch window fully inside work shift
  function getLunchWindow(alloc: Alocacao): { start: string; end: string } | null {
    if (!alloc.hora_inicio || !alloc.hora_fim || !alloc.hora_almoco_inicio || !alloc.hora_almoco_fim) {
      return null
    }

    const workStart = toMinutes(alloc.hora_inicio)
    const workEnd = toMinutes(alloc.hora_fim)
    const lunchStart = toMinutes(alloc.hora_almoco_inicio)
    const lunchEnd = toMinutes(alloc.hora_almoco_fim)

    if (workEnd <= workStart || lunchEnd <= lunchStart) return null
    if (lunchStart < workStart || lunchEnd > workEnd) return null

    return { start: alloc.hora_almoco_inicio, end: alloc.hora_almoco_fim }
  }

  function splitWorkSegments(alloc: Alocacao): Array<{ start: string; end: string }> {
    if (!alloc.hora_inicio || !alloc.hora_fim) return []

    const lunch = getLunchWindow(alloc)
    if (!lunch) return [{ start: alloc.hora_inicio, end: alloc.hora_fim }]

    return [
      { start: alloc.hora_inicio, end: lunch.start },
      { start: lunch.end, end: alloc.hora_fim },
    ].filter((segment) => toMinutes(segment.end) > toMinutes(segment.start))
  }

  function isWorkingAtSlotStart(alloc: Alocacao, slotStartMin: number): boolean {
    if (alloc.status !== 'TRABALHO' || !alloc.hora_inicio || !alloc.hora_fim) return false

    const workStart = toMinutes(alloc.hora_inicio)
    const workEnd = toMinutes(alloc.hora_fim)
    if (!(workStart <= slotStartMin && workEnd > slotStartMin)) return false

    const lunch = getLunchWindow(alloc)
    if (!lunch) return true

    const lunchStart = toMinutes(lunch.start)
    const lunchEnd = toMinutes(lunch.end)
    return !(lunchStart <= slotStartMin && lunchEnd > slotStartMin)
  }

  // Helper: get bar color from contract type
  function getBarColor(tipoContratoId: number): { bar: string; text: string; border: string } {
    const contrato = contratoMap.get(tipoContratoId)
    if (!contrato) return CORES_CONTRATO.DEFAULT
    return CORES_CONTRATO[contrato.nome] || CORES_CONTRATO.DEFAULT
  }

  // Day navigation
  const prevDay = () => {
    const d = new Date(currentDate + 'T00:00:00')
    d.setDate(d.getDate() - 1)
    const newDate = toDateStr(d)
    if (newDate >= dataInicio) setCurrentDate(newDate)
  }

  const nextDay = () => {
    const d = new Date(currentDate + 'T00:00:00')
    d.setDate(d.getDate() + 1)
    const newDate = toDateStr(d)
    if (newDate <= dataFim) setCurrentDate(newDate)
  }

  const atStart = currentDate <= dataInicio
  const atEnd = currentDate >= dataFim

  // Format current date display
  const currentDateObj = new Date(currentDate + 'T00:00:00')
  const dow = currentDateObj.getDay()

  // Coverage calculation per slot
  const coverageData = useMemo(() => {
    const data: { count: number; needed: number }[] = []
    const openMin = toMinutes(setor.hora_abertura)
    const diaSemana = DIAS_MAP[dow]

    for (let slotIndex = 0; slotIndex < totalSlots; slotIndex++) {
      const slotStartMin = openMin + slotIndex * SLOT_SIZE

      // Count workers in this slot
      let count = 0
      for (const colab of sortedColaboradores) {
        const allocs = alocacaoMap.get(String(colab.id)) || []
        for (const alloc of allocs) {
          if (isWorkingAtSlotStart(alloc, slotStartMin)) {
            count++
            break
          }
        }
      }

      // Find max needed from demandas
      let needed = 0
      for (const d of demandas) {
        if (d.dia_semana !== null && d.dia_semana !== diaSemana) continue
        const demandaStart = toMinutes(d.hora_inicio)
        const demandaEnd = toMinutes(d.hora_fim)
        if (demandaStart <= slotStartMin && demandaEnd > slotStartMin) {
          needed = Math.max(needed, d.min_pessoas)
        }
      }

      data.push({ count, needed })
    }
    return data
  }, [totalSlots, setor.hora_abertura, dow, sortedColaboradores, alocacaoMap, demandas])

  // Collect unique contract types for legend
  const contractTypes = useMemo(() => {
    const types = new Set<string>()
    for (const colab of colaboradores) {
      const contrato = contratoMap.get(colab.tipo_contrato_id)
      if (contrato) types.add(contrato.nome)
    }
    return Array.from(types)
  }, [colaboradores, contratoMap])

  // Hour boundary indices for vertical guides
  const hourBoundaries = useMemo(() => {
    const indices: number[] = []
    for (let i = 0; i < timeLabels.length; i++) {
      indices.push(i * 4) // each hour = 4 slots (15min each)
    }
    return indices
  }, [timeLabels, setor.hora_abertura])

  // Operational range for current day (per-day override or setor default)
  const { offSlotsLeft, offSlotsRight } = useMemo(() => {
    const openMin = toMinutes(setor.hora_abertura)
    const diaSemana = DIAS_MAP[dow]
    const override = horariosSemana.find(h => h.dia_semana === diaSemana && h.ativo && !h.usa_padrao)
    const opOpen = override ? toMinutes(override.hora_abertura) : openMin
    const opClose = override ? toMinutes(override.hora_fechamento) : toMinutes(setor.hora_fechamento)

    const leftSlots = Math.max(0, Math.floor((opOpen - openMin) / SLOT_SIZE))
    const rightSlots = Math.max(0, Math.floor((toMinutes(setor.hora_fechamento) - opClose) / SLOT_SIZE))
    return { offSlotsLeft: leftSlots, offSlotsRight: rightSlots }
  }, [dow, setor.hora_abertura, setor.hora_fechamento, horariosSemana])

  return (
    <div className="space-y-4">
      {/* Day Navigation */}
      <div className="flex items-center justify-between rounded-lg border bg-muted/20 px-4 py-2.5">
        <Button
          variant="outline"
          size="icon"
          className="size-8"
          onClick={prevDay}
          disabled={atStart}
        >
          <ChevronLeft className="size-4" />
        </Button>
        <div className="text-center">
          <span className="text-sm font-semibold text-foreground">
            {DIAS_SEMANA_NOME[currentDateObj.getDay()]}
          </span>
          <span className="ml-2 text-sm text-muted-foreground">
            {formatarData(currentDate)}
          </span>
        </div>
        <Button
          variant="outline"
          size="icon"
          className="size-8"
          onClick={nextDay}
          disabled={atEnd}
        >
          <ChevronRight className="size-4" />
        </Button>
      </div>

      {/* Timeline Grid */}
      <div className="overflow-x-auto rounded-lg border bg-background">
        <div
          className="relative min-w-[800px]"
          style={{
            display: 'grid',
            gridTemplateColumns: `200px repeat(${totalSlots}, 1fr)`,
            gridTemplateRows: `auto repeat(${sortedColaboradores.length}, ${ROW_HEIGHT}px) ${demandas.length > 0 ? '40px' : ''}`,
          }}
        >
          {/* HEADER ROW */}
          <div className="sticky left-0 z-20 bg-muted/50 border-b border-r px-4 py-2.5 flex items-end">
            <span className="text-xs font-semibold text-foreground">
              Colaborador
              <span className="ml-1.5 text-[10px] font-normal text-muted-foreground">
                ({sortedColaboradores.length})
              </span>
            </span>
          </div>
          {/* Time labels - one per hour spanning 2 columns */}
          {timeLabels.map((label, i) => (
            <div
              key={label}
              className="border-b border-l bg-muted/50 px-1 py-2.5 text-center text-[11px] font-medium text-muted-foreground"
              style={{ gridColumn: `${i * 4 + 2} / ${i * 4 + 6}` }}
            >
              {label}
            </div>
          ))}

          {/* Off-hours overlay (slots before/after operational window for this day) */}
          {offSlotsLeft > 0 && (
            <div
              className="pointer-events-none bg-muted/40 dark:bg-muted/30 border-r border-dashed border-border/50"
              style={{
                gridRow: `1 / -1`,
                gridColumn: `2 / ${2 + offSlotsLeft}`,
              }}
            />
          )}
          {offSlotsRight > 0 && (
            <div
              className="pointer-events-none bg-muted/40 dark:bg-muted/30 border-l border-dashed border-border/50"
              style={{
                gridRow: `1 / -1`,
                gridColumn: `${totalSlots + 2 - offSlotsRight} / ${totalSlots + 2}`,
              }}
            />
          )}

          {/* COLLABORATOR ROWS */}
          {sortedColaboradores.map((colab, rowIndex) => {
            const allocsToday = alocacaoMap.get(String(colab.id)) || []
            const contrato = contratoMap.get(colab.tipo_contrato_id)
            const colors = getBarColor(colab.tipo_contrato_id)
            const isViolatedRow = violatedCells.has(`${colab.id}-${currentDate}`)
            const hasWork = allocsToday.some((a) => a.status === 'TRABALHO')
            const isFolga = !hasWork && allocsToday.some((a) => a.status === 'FOLGA')
            const isIndisponivel = allocsToday.some((a) => a.status === 'INDISPONIVEL')
            const gridRow = rowIndex + 2
            const isEvenRow = rowIndex % 2 === 0

            return (
              <>
                {/* Sidebar cell - sticky left */}
                <div
                  key={`sidebar-${colab.id}`}
                  className={cn(
                    'sticky left-0 z-10 border-b border-r px-4 flex items-center gap-2.5',
                    isViolatedRow ? 'bg-destructive/5' : isEvenRow ? 'bg-background' : 'bg-muted/10'
                  )}
                  style={{ gridRow, gridColumn: 1 }}
                >
                  <div
                    className={cn(
                      'flex size-8 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold',
                      colab.sexo === 'F' ? CORES_GENERO.F : CORES_GENERO.M
                    )}
                  >
                    {iniciais(colab.nome)}
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-medium leading-tight text-foreground truncate">
                      {colab.nome.split(' ').slice(0, 2).join(' ')}
                    </div>
                    <div className="text-[10px] text-muted-foreground truncate">
                      {contrato?.nome ?? 'Contrato'}
                    </div>
                  </div>
                </div>

                {/* Background for the entire row (alternating + grid lines) */}
                <div
                  key={`bg-${colab.id}`}
                  className={cn(
                    'border-b',
                    isViolatedRow ? 'bg-destructive/5' : isEvenRow ? 'bg-background' : 'bg-muted/10'
                  )}
                  style={{ gridRow, gridColumn: `2 / ${totalSlots + 2}` }}
                />

                {/* Vertical hour guides */}
                {hourBoundaries.map((slotIdx) => (
                  <div
                    key={`vline-${colab.id}-${slotIdx}`}
                    className="border-l border-border/30 pointer-events-none"
                    style={{ gridRow, gridColumn: `${slotIdx + 2} / ${slotIdx + 3}` }}
                  />
                ))}

                {/* Shift bars */}
                {hasWork &&
                  allocsToday
                    .filter((a) => a.status === 'TRABALHO' && a.hora_inicio && a.hora_fim)
                    .map((alloc, i) => {
                      const lunch = getLunchWindow(alloc)
                      const workSegments = splitWorkSegments(alloc)
                      const isChanged = changedCells.has(`${colab.id}-${currentDate}`)
                      const isLoading =
                        loadingCell?.colaboradorId === colab.id &&
                        loadingCell?.data === currentDate
                      const totalShift = toMinutes(alloc.hora_fim!) - toMinutes(alloc.hora_inicio!)
                      const lunchMinutes = lunch ? toMinutes(lunch.end) - toMinutes(lunch.start) : 0
                      const lunchPos = lunch ? calcBarPosition(lunch.start, lunch.end) : null
                      const paidDuration = alloc.minutos_trabalho ?? alloc.minutos ?? Math.max(0, totalShift - lunchMinutes)
                      const segmentDurations = workSegments.map((segment) => toMinutes(segment.end) - toMinutes(segment.start))
                      const longestSegmentIndex = segmentDurations.reduce(
                        (maxIndex, value, index, arr) => (value > arr[maxIndex] ? index : maxIndex),
                        0
                      )

                      return (
                        <Fragment key={`alloc-${colab.id}-${i}`}>
                          {workSegments.map((segment, segmentIndex) => {
                            const pos = calcBarPosition(segment.start, segment.end)
                            const segmentMinutes = toMinutes(segment.end) - toMinutes(segment.start)
                            const showLabel = paidDuration >= 90 && segmentIndex === longestSegmentIndex && segmentMinutes >= 90

                            return (
                              <Tooltip key={`work-${colab.id}-${i}-${segmentIndex}`}>
                                <TooltipTrigger asChild>
                                  <div
                                    className={cn(
                                      'flex items-center justify-center rounded-md mx-0.5 my-2 text-[11px] font-medium cursor-default shadow-sm',
                                      colors.bar,
                                      colors.text,
                                      colors.border,
                                      'border',
                                      !readOnly &&
                                        alloc.status !== 'INDISPONIVEL' &&
                                        'cursor-pointer hover:opacity-90 hover:shadow-md transition-all',
                                      isLoading && 'opacity-60',
                                      isChanged && 'ring-2 ring-primary ring-offset-1',
                                      isViolatedRow && 'ring-2 ring-destructive'
                                    )}
                                    style={{ gridRow, gridColumn: `${pos.start} / ${pos.end}` }}
                                    onClick={() => {
                                      if (!readOnly && onCelulaClick) {
                                        onCelulaClick(colab.id, currentDate, alloc.status)
                                      }
                                    }}
                                  >
                                    {showLabel ? `${segment.start} - ${segment.end}` : ''}
                                  </div>
                                </TooltipTrigger>
                                <TooltipContent side="top" className="text-xs space-y-1">
                                  <p className="font-semibold">{colab.nome}</p>
                                  <p>{contrato?.nome ?? 'Contrato'}</p>
                                  <p>
                                    {alloc.hora_inicio} → {alloc.hora_fim}
                                  </p>
                                  {lunch && (
                                    <p>
                                      Almoço: {lunch.start} → {lunch.end}
                                    </p>
                                  )}
                                  {(alloc.minutos_trabalho ?? alloc.minutos) != null && (
                                    <p>Total: {formatarMinutos(alloc.minutos_trabalho ?? alloc.minutos ?? 0)}</p>
                                  )}
                                </TooltipContent>
                              </Tooltip>
                            )
                          })}

                          {lunch && (
                            <Tooltip key={`lunch-${colab.id}-${i}`}>
                              <TooltipTrigger asChild>
                                <div
                                  className={cn(
                                    'flex items-center justify-center rounded mx-0.5 my-2 text-[9px] font-semibold border border-dashed border-amber-300/80 text-amber-800 dark:text-amber-300 bg-amber-50/80 dark:bg-amber-950/40',
                                    !readOnly &&
                                      alloc.status !== 'INDISPONIVEL' &&
                                      'cursor-pointer hover:opacity-90 transition-all',
                                    isLoading && 'opacity-60',
                                    isChanged && 'ring-2 ring-primary ring-offset-1',
                                    isViolatedRow && 'ring-2 ring-destructive'
                                  )}
                                  style={{
                                    gridRow,
                                    gridColumn: `${lunchPos!.start} / ${lunchPos!.end}`,
                                  }}
                                  onClick={() => {
                                    if (!readOnly && onCelulaClick) {
                                      onCelulaClick(colab.id, currentDate, alloc.status)
                                    }
                                  }}
                                >
                                  ALM
                                </div>
                              </TooltipTrigger>
                              <TooltipContent side="top" className="text-xs space-y-1">
                                <p className="font-semibold">{colab.nome}</p>
                                <p>Almoço: {lunch.start} → {lunch.end}</p>
                                <p>Pausa no fluxo</p>
                              </TooltipContent>
                            </Tooltip>
                          )}
                        </Fragment>
                      )
                    })}

                {/* Intervals between work blocks */}
                {hasWork &&
                  (() => {
                    const workAllocs = allocsToday
                      .filter((a) => a.status === 'TRABALHO' && a.hora_inicio && a.hora_fim)
                      .sort((a, b) => toMinutes(a.hora_inicio!) - toMinutes(b.hora_inicio!))
                    const intervals = []
                    for (let i = 0; i < workAllocs.length - 1; i++) {
                      const gapStart = workAllocs[i].hora_fim!
                      const gapEnd = workAllocs[i + 1].hora_inicio!
                      if (toMinutes(gapEnd) > toMinutes(gapStart)) {
                        intervals.push({ start: gapStart, end: gapEnd })
                      }
                    }
                    return intervals.map((gap, i) => {
                      const pos = calcBarPosition(gap.start, gap.end)
                      return (
                        <div
                          key={`gap-${colab.id}-${i}`}
                          className="flex items-center justify-center rounded mx-0.5 my-2.5 text-[9px] text-muted-foreground bg-muted/40 dark:bg-muted/30 border border-dashed border-muted-foreground/20"
                          style={{ gridRow, gridColumn: `${pos.start} / ${pos.end}` }}
                        >
                          Intervalo
                        </div>
                      )
                    })
                  })()}

                {/* FOLGA badge */}
                {isFolga && !hasWork && (
                  <div
                    key={`folga-${colab.id}`}
                    className="flex items-center justify-center my-2"
                    style={{ gridRow, gridColumn: `2 / ${totalSlots + 2}` }}
                  >
                    <Badge variant="outline" className="text-[10px] text-muted-foreground">
                      FOLGA
                    </Badge>
                  </div>
                )}

                {/* INDISPONIVEL badge */}
                {isIndisponivel && (
                  <div
                    key={`indisponivel-${colab.id}`}
                    className="flex items-center justify-center my-2 rounded bg-amber-50/50 dark:bg-amber-950/20"
                    style={{
                      gridRow,
                      gridColumn: `2 / ${totalSlots + 2}`,
                      backgroundImage:
                        'repeating-linear-gradient(45deg, transparent, transparent 4px, rgba(251,191,36,0.1) 4px, rgba(251,191,36,0.1) 8px)',
                    }}
                  >
                    <Badge
                      variant="outline"
                      className="text-[10px] text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-700"
                    >
                      AUS.
                    </Badge>
                  </div>
                )}
              </>
            )
          })}

          {/* COVERAGE ROW */}
          {demandas.length > 0 && (
            <>
              <div
                className="sticky left-0 z-10 bg-muted/40 border-t-2 border-r px-4 flex items-center"
                style={{
                  gridRow: sortedColaboradores.length + 2,
                  gridColumn: 1,
                }}
              >
                <span className="text-[11px] font-semibold text-foreground">Cobertura</span>
              </div>

              {coverageData.map((cov, slotIndex) => {
                const ok = cov.count >= cov.needed
                return (
                  <div
                    key={`cov-${slotIndex}`}
                    className={cn(
                      'flex items-center justify-center text-[10px] font-semibold border-t-2 px-0.5',
                      ok
                        ? 'text-emerald-600 dark:text-emerald-400 bg-emerald-50/30 dark:bg-emerald-950/20'
                        : 'text-amber-600 dark:text-amber-400 bg-amber-50/30 dark:bg-amber-950/20'
                    )}
                    style={{
                      gridRow: sortedColaboradores.length + 2,
                      gridColumn: `${slotIndex + 2} / ${slotIndex + 3}`,
                    }}
                  >
                    {cov.needed > 0 ? `${cov.count}/${cov.needed}` : ''}
                  </div>
                )
              })}
            </>
          )}
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border bg-muted/20 px-4 py-2.5 text-[11px] text-muted-foreground">
        {contractTypes.map((nome) => {
          const colors = CORES_CONTRATO[nome] || CORES_CONTRATO.DEFAULT
          return (
            <div key={nome} className="flex items-center gap-1.5">
              <div
                className={cn('h-3 w-5 rounded border shadow-sm', colors.bar, colors.border)}
              />
              {nome}
            </div>
          )
        })}

        <div className="flex items-center gap-1.5">
          <div className="h-3 w-5 rounded border border-dashed border-muted-foreground/20 bg-muted/40 dark:bg-muted/30" />
          Intervalo
        </div>

        <div className="flex items-center gap-1.5">
          <div className="h-3 w-5 rounded border border-dashed border-amber-300/80 bg-amber-50/80 dark:bg-amber-950/40" />
          ALM
        </div>

        <div className="flex items-center gap-1.5">
          <div className="h-3 w-5 rounded border border-border bg-muted/60" />
          Folga
        </div>

        <div className="flex items-center gap-1.5">
          <div
            className="h-3 w-5 rounded border border-amber-300 dark:border-amber-700 bg-amber-50/50 dark:bg-amber-950/20"
            style={{
              backgroundImage:
                'repeating-linear-gradient(45deg, transparent, transparent 2px, rgba(251,191,36,0.15) 2px, rgba(251,191,36,0.15) 4px)',
            }}
          />
          Ausente
        </div>
      </div>
    </div>
  )
}
