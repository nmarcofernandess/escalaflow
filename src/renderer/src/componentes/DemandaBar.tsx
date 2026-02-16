import { useRef, useState } from 'react'
import { Trash2, Minus, Plus, Users, MoreHorizontal, Clock } from 'lucide-react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { toMinutes, formatarMinutos, minutesToTime } from '@/lib/formatadores'
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
  const totalMinutes = closeMin - openMin

  const horaInicio = previewHoraInicio ?? demanda.hora_inicio
  const horaFim = previewHoraFim ?? demanda.hora_fim

  const startMin = toMinutes(horaInicio)
  const endMin = toMinutes(horaFim)
  const duration = endMin - startMin

  const leftPercent = ((startMin - openMin) / totalMinutes) * 100
  const widthPercent = (duration / totalMinutes) * 100

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: demanda.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

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
    const newMin = toMinutes(value)
    if (field === 'inicio') {
      if (newMin >= openMin && endMin - newMin >= 60) {
        onUpdateTimes(demanda.id, value, horaFim)
      }
    } else {
      if (newMin <= closeMin && newMin - startMin >= 60) {
        onUpdateTimes(demanda.id, horaInicio, value)
      }
    }
  }

  return (
    <div
      ref={(node) => {
        setNodeRef(node)
        ;(containerRef as React.MutableRefObject<HTMLDivElement | null>).current = node
      }}
      style={style}
      className="group relative h-10"
    >
      {/* Track background */}
      <div className="absolute inset-0 rounded-md bg-muted/30 dark:bg-muted/20" />

      {/* The bar — positioned absolute inside the track */}
      <div
        className={cn(
          'absolute top-0 h-full rounded-md border flex items-center transition-shadow select-none',
          colors.bar, colors.text, colors.border,
          isResizing ? 'ring-2 ring-primary shadow-lg cursor-col-resize' : 'cursor-grab active:cursor-grabbing hover:shadow-md',
          isDragging && 'ring-2 ring-primary/60 shadow-lg',
          popoverOpen && 'ring-2 ring-primary/60 shadow-lg',
        )}
        style={{
          left: `${leftPercent}%`,
          width: `${widthPercent}%`,
          minWidth: '60px',
        }}
        {...attributes}
        {...listeners}
      >
        {/* Left resize handle */}
        <div
          data-resize-handle
          role="slider"
          aria-label={`Ajustar inicio da faixa ${horaInicio}`}
          aria-valuemin={openMin}
          aria-valuemax={endMin - 60}
          aria-valuenow={startMin}
          tabIndex={0}
          className={cn(
            'absolute left-0 top-0 h-full w-2 cursor-col-resize rounded-l-md opacity-0 transition-opacity z-10',
            'hover:opacity-100 group-hover:opacity-60',
            colors.handle,
          )}
          onPointerDown={handleResizeLeft}
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft') {
              const newStart = Math.max(openMin, startMin - 30)
              if (endMin - newStart >= 60) {
                onUpdateTimes(demanda.id, minutesToTime(newStart), minutesToTime(endMin))
              }
            } else if (e.key === 'ArrowRight') {
              const newStart = Math.min(endMin - 60, startMin + 30)
              onUpdateTimes(demanda.id, minutesToTime(newStart), minutesToTime(endMin))
            }
          }}
        />

        {/* Center label — Tooltip wraps this for hover info */}
        <Tooltip>
          <TooltipTrigger asChild>
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
          </TooltipTrigger>
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

        {/* Right side: badge + kebab menu with proper spacing */}
        <div className="flex shrink-0 items-center gap-2 mr-3">
          {/* People badge */}
          <div className={cn(
            'flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[10px] font-bold',
            colors.badge,
          )}>
            <Users className="size-2.5" />
            {demanda.min_pessoas}
          </div>

          {/* Kebab menu button — Popover trigger */}
          <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className={cn(
                  'flex items-center justify-center rounded size-6',
                  'opacity-0 group-hover:opacity-70 hover:!opacity-100 transition-opacity',
                  'hover:bg-black/10 dark:hover:bg-white/10',
                )}
                onClick={(e) => {
                  e.stopPropagation()
                }}
                onPointerDown={(e) => {
                  e.stopPropagation()
                }}
              >
                <MoreHorizontal className="size-3.5" />
              </button>
            </PopoverTrigger>

            <PopoverContent side="top" align="end" className="w-64 p-4 space-y-4">
              {/* Time inputs */}
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground">Horario</label>
                <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                  <Input
                    type="time"
                    defaultValue={horaInicio}
                    className="h-8 text-xs"
                    min={minutesToTime(openMin)}
                    max={minutesToTime(endMin - 60)}
                    onBlur={(e) => handleTimeChange('inicio', e.target.value)}
                  />
                  <span className="text-xs text-muted-foreground">ate</span>
                  <Input
                    type="time"
                    defaultValue={horaFim}
                    className="h-8 text-xs"
                    min={minutesToTime(startMin + 60)}
                    max={minutesToTime(closeMin)}
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
                  // Delete first — bar unmounts taking popover with it
                  onDelete(demanda.id)
                }}
              >
                <Trash2 className="mr-1.5 size-3.5" />
                Remover faixa
              </Button>
            </PopoverContent>
          </Popover>
        </div>

        {/* Right resize handle */}
        <div
          data-resize-handle
          role="slider"
          aria-label={`Ajustar fim da faixa ${horaFim}`}
          aria-valuemin={startMin + 60}
          aria-valuemax={closeMin}
          aria-valuenow={endMin}
          tabIndex={0}
          className={cn(
            'absolute right-0 top-0 h-full w-2 cursor-col-resize rounded-r-md opacity-0 transition-opacity z-10',
            'hover:opacity-100 group-hover:opacity-60',
            colors.handle,
          )}
          onPointerDown={handleResizeRight}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight') {
              const newEnd = Math.min(closeMin, endMin + 30)
              if (newEnd - startMin >= 60) {
                onUpdateTimes(demanda.id, minutesToTime(startMin), minutesToTime(newEnd))
              }
            } else if (e.key === 'ArrowLeft') {
              const newEnd = Math.max(startMin + 60, endMin - 30)
              onUpdateTimes(demanda.id, minutesToTime(startMin), minutesToTime(newEnd))
            }
          }}
        />
      </div>
    </div>
  )
}
