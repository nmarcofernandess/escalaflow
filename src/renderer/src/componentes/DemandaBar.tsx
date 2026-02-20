import { useRef, useState } from 'react'
import { Trash2, Minus, Plus, Users, MoreHorizontal, Clock } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { toMinutes, formatarMinutos, minutesToTime } from '@/lib/formatadores'
import {
  buildTimelineBarGeometry,
  normalizeTimelineInterval,
  DEMANDA_MIN_DURATION_MINUTES,
  DEMANDA_SNAP_MINUTES,
} from '@/lib/timeline-demanda'
import type { Demanda } from '@shared/index'

const CORES_FAIXA = [
  {
    bar: 'bg-emerald-500/80 dark:bg-emerald-600/60',
    text: 'text-white dark:text-emerald-100',
    border: 'border-emerald-600 dark:border-emerald-500',
    handle: 'bg-emerald-700/60 dark:bg-emerald-400/40',
    badge: 'bg-emerald-700/80 dark:bg-emerald-500/60',
  },
  {
    bar: 'bg-blue-500/80 dark:bg-blue-600/60',
    text: 'text-white dark:text-blue-100',
    border: 'border-blue-600 dark:border-blue-500',
    handle: 'bg-blue-700/60 dark:bg-blue-400/40',
    badge: 'bg-blue-700/80 dark:bg-blue-500/60',
  },
  {
    bar: 'bg-purple-500/80 dark:bg-purple-600/60',
    text: 'text-white dark:text-purple-100',
    border: 'border-purple-600 dark:border-purple-500',
    handle: 'bg-purple-700/60 dark:bg-purple-400/40',
    badge: 'bg-purple-700/80 dark:bg-purple-500/60',
  },
  {
    bar: 'bg-amber-500/80 dark:bg-amber-600/60',
    text: 'text-white dark:text-amber-100',
    border: 'border-amber-600 dark:border-amber-500',
    handle: 'bg-amber-700/60 dark:bg-amber-400/40',
    badge: 'bg-amber-700/80 dark:bg-amber-500/60',
  },
  {
    bar: 'bg-pink-500/80 dark:bg-pink-600/60',
    text: 'text-white dark:text-pink-100',
    border: 'border-pink-600 dark:border-pink-500',
    handle: 'bg-pink-700/60 dark:bg-pink-400/40',
    badge: 'bg-pink-700/80 dark:bg-pink-500/60',
  },
] as const

interface DemandaBarProps {
  demanda: Demanda
  index: number
  openMin: number
  closeMin: number
  boundsOpenMin?: number
  boundsCloseMin?: number
  previewHoraInicio?: string
  previewHoraFim?: string
  isResizing: boolean
  onStartResize: (
    e: React.PointerEvent,
    demandaId: number,
    side: 'left' | 'right',
    currentStartMin: number,
    currentEndMin: number,
    containerEl: HTMLElement,
  ) => void
  onDelete: (id: number) => void
  onUpdatePessoas: (id: number, delta: number) => void
  onUpdateTimes: (id: number, hora_inicio: string, hora_fim: string) => void
}

export function DemandaBar({
  demanda,
  index,
  openMin,
  closeMin,
  boundsOpenMin,
  boundsCloseMin,
  previewHoraInicio,
  previewHoraFim,
  isResizing,
  onStartResize,
  onDelete,
  onUpdatePessoas,
  onUpdateTimes,
}: DemandaBarProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [popoverOpen, setPopoverOpen] = useState(false)
  const colors = CORES_FAIXA[index % CORES_FAIXA.length]
  const minBound = boundsOpenMin ?? openMin
  const maxBound = boundsCloseMin ?? closeMin

  const horaInicio = previewHoraInicio ?? demanda.hora_inicio
  const horaFim = previewHoraFim ?? demanda.hora_fim

  const rawStartMin = toMinutes(horaInicio)
  const rawEndMin = toMinutes(horaFim)
  const barGeometry = buildTimelineBarGeometry({
    startMin: rawStartMin,
    endMin: rawEndMin,
    axisOpenMin: openMin,
    axisCloseMin: closeMin,
    boundsOpenMin: minBound,
    boundsCloseMin: maxBound,
  })
  const startMin = barGeometry.startMin
  const endMin = barGeometry.endMin
  const duration = endMin - startMin

  const handleResizeLeft = (e: React.PointerEvent) => {
    if (!containerRef.current) return
    const grid = containerRef.current.closest('[data-demanda-grid]') as HTMLElement
    if (!grid) return
    onStartResize(e, demanda.id, 'left', startMin, endMin, grid)
  }

  const handleResizeRight = (e: React.PointerEvent) => {
    if (!containerRef.current) return
    const grid = containerRef.current.closest('[data-demanda-grid]') as HTMLElement
    if (!grid) return
    onStartResize(e, demanda.id, 'right', startMin, endMin, grid)
  }

  const handleTimeChange = (field: 'inicio' | 'fim', value: string) => {
    if (!value.match(/^\d{2}:\d{2}$/)) return
    const candidateStart = field === 'inicio' ? toMinutes(value) : startMin
    const candidateEnd = field === 'fim' ? toMinutes(value) : endMin
    const normalized = normalizeTimelineInterval({
      startMin: candidateStart,
      endMin: candidateEnd,
      axisOpenMin: openMin,
      axisCloseMin: closeMin,
      boundsOpenMin: minBound,
      boundsCloseMin: maxBound,
      minDurationMin: DEMANDA_MIN_DURATION_MINUTES,
      snapIntervalMin: DEMANDA_SNAP_MINUTES,
    })
    if (!normalized) return

    onUpdateTimes(
      demanda.id,
      minutesToTime(normalized.startMin),
      minutesToTime(normalized.endMin),
    )
  }

  return (
    <div
      ref={containerRef}
      className="group relative h-10"
    >
      {/* Track background */}
      <div className="absolute inset-0 rounded-md bg-muted/30 dark:bg-muted/20" />

      <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
        {/* The bar — positioned absolute inside the track */}
        <Tooltip>
          <PopoverTrigger asChild>
            <TooltipTrigger asChild>
              <div
                role="button"
                tabIndex={0}
                className={cn(
                  'absolute top-0 h-full rounded-md border flex items-center transition-shadow select-none',
                  colors.bar, colors.text, colors.border,
                  isResizing ? 'ring-2 ring-primary shadow-lg cursor-col-resize' : 'cursor-pointer hover:shadow-md',
                  popoverOpen && 'ring-2 ring-primary/60 shadow-lg',
                )}
                style={{
                  left: `${barGeometry.leftPercent}%`,
                  width: barGeometry.widthStyle,
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    setPopoverOpen(true)
                  }
                }}
              >
                {/* Left resize handle */}
                <div
                  data-resize-handle
                  role="slider"
                  aria-label={`Ajustar inicio da faixa ${horaInicio}`}
                  aria-valuemin={minBound}
                  aria-valuemax={endMin - DEMANDA_MIN_DURATION_MINUTES}
                  aria-valuenow={startMin}
                  tabIndex={0}
                  className={cn(
                    'absolute left-0 top-0 h-full w-2 cursor-col-resize rounded-l-md opacity-0 transition-opacity z-10',
                    'hover:opacity-100 group-hover:opacity-60',
                    colors.handle,
                  )}
                  onPointerDown={handleResizeLeft}
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowLeft') {
                      const newStart = Math.max(minBound, startMin - DEMANDA_SNAP_MINUTES)
                      if (endMin - newStart >= DEMANDA_MIN_DURATION_MINUTES) {
                        onUpdateTimes(demanda.id, minutesToTime(newStart), minutesToTime(endMin))
                      }
                    } else if (e.key === 'ArrowRight') {
                      const newStart = Math.min(endMin - DEMANDA_MIN_DURATION_MINUTES, startMin + DEMANDA_SNAP_MINUTES)
                      onUpdateTimes(demanda.id, minutesToTime(newStart), minutesToTime(endMin))
                    }
                  }}
                />

                {/* Center label */}
                <div className="flex flex-1 items-center justify-center gap-1.5 overflow-hidden px-3 text-xs font-medium min-w-0">
                  <span className="truncate">
                    {horaInicio} - {horaFim}
                  </span>
                  {isResizing && (
                    <span className="shrink-0 text-[10px] opacity-80">
                      ({formatarMinutos(duration)})
                    </span>
                  )}
                </div>

                {/* Right side: badge + icon */}
                <div className="flex shrink-0 items-center gap-2 mr-3">
                  <div className={cn(
                    'flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[10px] font-bold',
                    colors.badge,
                  )}>
                    <Users className="size-2.5" />
                    {demanda.min_pessoas}
                  </div>
                  <div className={cn(
                    'flex items-center justify-center rounded size-6 pointer-events-none',
                    'opacity-0 group-hover:opacity-70 transition-opacity',
                  )}>
                    <MoreHorizontal className="size-3.5" />
                  </div>
                </div>

                {/* Right resize handle */}
                <div
                  data-resize-handle
                  role="slider"
                  aria-label={`Ajustar fim da faixa ${horaFim}`}
                  aria-valuemin={startMin + DEMANDA_MIN_DURATION_MINUTES}
                  aria-valuemax={maxBound}
                  aria-valuenow={endMin}
                  tabIndex={0}
                  className={cn(
                    'absolute right-0 top-0 h-full w-2 cursor-col-resize rounded-r-md opacity-0 transition-opacity z-10',
                    'hover:opacity-100 group-hover:opacity-60',
                    colors.handle,
                  )}
                  onPointerDown={handleResizeRight}
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowRight') {
                      const newEnd = Math.min(maxBound, endMin + DEMANDA_SNAP_MINUTES)
                      if (newEnd - startMin >= DEMANDA_MIN_DURATION_MINUTES) {
                        onUpdateTimes(demanda.id, minutesToTime(startMin), minutesToTime(newEnd))
                      }
                    } else if (e.key === 'ArrowLeft') {
                      const newEnd = Math.max(startMin + DEMANDA_MIN_DURATION_MINUTES, endMin - DEMANDA_SNAP_MINUTES)
                      onUpdateTimes(demanda.id, minutesToTime(startMin), minutesToTime(newEnd))
                    }
                  }}
                />
              </div>
            </TooltipTrigger>
          </PopoverTrigger>

          <TooltipContent side="top" className="space-y-1 text-xs">
            <div className="flex items-center gap-1.5 font-medium">
              <Clock className="size-3" />
              {horaInicio} - {horaFim}
            </div>
            <div className="flex items-center justify-between gap-4 text-primary-foreground/80">
              <span>Duracao: {formatarMinutos(duration)}</span>
              <span>{demanda.min_pessoas} {demanda.min_pessoas === 1 ? 'pessoa' : 'pessoas'}</span>
            </div>
          </TooltipContent>
        </Tooltip>

        <PopoverContent side="top" align="end" className="w-64 p-4 space-y-4">
          {/* Time inputs */}
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">Horario</label>
            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
              <Input
                type="time"
                defaultValue={horaInicio}
                className="h-8 text-xs"
                step={DEMANDA_SNAP_MINUTES * 60}
                min={minutesToTime(minBound)}
                max={minutesToTime(endMin - DEMANDA_MIN_DURATION_MINUTES)}
                onBlur={(e) => handleTimeChange('inicio', e.target.value)}
              />
              <span className="text-xs text-muted-foreground">ate</span>
              <Input
                type="time"
                defaultValue={horaFim}
                className="h-8 text-xs"
                step={DEMANDA_SNAP_MINUTES * 60}
                min={minutesToTime(startMin + DEMANDA_MIN_DURATION_MINUTES)}
                max={minutesToTime(maxBound)}
                onBlur={(e) => handleTimeChange('fim', e.target.value)}
              />
            </div>
            <p className="text-[10px] text-muted-foreground text-center">
              Duracao: {formatarMinutos(duration)}
            </p>
          </div>

          {/* People stepper */}
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">Min. pessoas</label>
            <div className="flex items-center justify-center gap-3">
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="size-8"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation()
                  e.preventDefault()
                  onUpdatePessoas(demanda.id, -1)
                }}
                disabled={demanda.min_pessoas <= 1}
              >
                <Minus className="size-3.5" />
              </Button>
              <span className="w-8 text-center text-base font-bold tabular-nums">{demanda.min_pessoas}</span>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="size-8"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation()
                  e.preventDefault()
                  onUpdatePessoas(demanda.id, 1)
                }}
              >
                <Plus className="size-3.5" />
              </Button>
            </div>
          </div>

          {/* Delete */}
          <Button
            variant="ghost"
            size="sm"
            className="w-full text-destructive hover:text-destructive hover:bg-destructive/10"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation()
              e.preventDefault()
              onDelete(demanda.id)
            }}
          >
            <Trash2 className="mr-1.5 size-3.5" />
            Remover faixa
          </Button>
        </PopoverContent>
      </Popover>
    </div>
  )
}
