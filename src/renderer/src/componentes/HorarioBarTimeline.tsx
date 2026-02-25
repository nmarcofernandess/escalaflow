import { useRef, useCallback } from 'react'
import { cn } from '@/lib/utils'
import { toMinutes, minutesToTime } from '@/lib/formatadores'
import {
  buildTimelineBarGeometry,
  normalizeTimelineInterval,
} from '@/lib/timeline-demanda'

const SNAP_MINUTES = 15
const MIN_DURATION_MINUTES = 60

interface HorarioBarTimelineProps {
  startTime: string
  endTime: string
  axisOpenMin: number
  axisCloseMin: number
  onChange: (start: string, end: string) => void
}

export function HorarioBarTimeline({
  startTime,
  endTime,
  axisOpenMin,
  axisCloseMin,
  onChange,
}: HorarioBarTimelineProps) {
  const trackRef = useRef<HTMLDivElement>(null)

  const startMin = toMinutes(startTime)
  const endMin = toMinutes(endTime)

  const geo = buildTimelineBarGeometry({
    startMin,
    endMin,
    axisOpenMin,
    axisCloseMin,
  })

  // Generate hour ticks for the track
  const ticks: number[] = []
  const firstTick = Math.ceil(axisOpenMin / 120) * 120
  for (let m = firstTick; m <= axisCloseMin; m += 120) {
    ticks.push(m)
  }
  const axisSpan = axisCloseMin - axisOpenMin

  const handlePointerDown = useCallback(
    (e: React.PointerEvent, side: 'left' | 'right') => {
      e.preventDefault()
      e.stopPropagation()
      const track = trackRef.current
      if (!track) return

      const trackRect = track.getBoundingClientRect()
      const trackWidth = trackRect.width
      const startClientX = e.clientX
      const origStartMin = toMinutes(startTime)
      const origEndMin = toMinutes(endTime)

      const onMove = (ev: PointerEvent) => {
        const deltaX = ev.clientX - startClientX
        const deltaMin = (deltaX / trackWidth) * (axisCloseMin - axisOpenMin)

        let candidateStart = origStartMin
        let candidateEnd = origEndMin

        if (side === 'left') {
          candidateStart = origStartMin + deltaMin
        } else {
          candidateEnd = origEndMin + deltaMin
        }

        const normalized = normalizeTimelineInterval({
          startMin: candidateStart,
          endMin: candidateEnd,
          axisOpenMin,
          axisCloseMin,
          minDurationMin: MIN_DURATION_MINUTES,
          snapIntervalMin: SNAP_MINUTES,
        })
        if (!normalized) return

        onChange(
          minutesToTime(normalized.startMin),
          minutesToTime(normalized.endMin),
        )
      }

      const onUp = () => {
        document.removeEventListener('pointermove', onMove)
        document.removeEventListener('pointerup', onUp)
      }

      document.addEventListener('pointermove', onMove)
      document.addEventListener('pointerup', onUp)
    },
    [startTime, endTime, axisOpenMin, axisCloseMin, onChange],
  )

  // Also support dragging the bar body to move the whole interval
  const handleBarPointerDown = useCallback(
    (e: React.PointerEvent) => {
      // Don't intercept handle drags
      if ((e.target as HTMLElement).closest('[data-handle]')) return
      e.preventDefault()
      e.stopPropagation()
      const track = trackRef.current
      if (!track) return

      const trackRect = track.getBoundingClientRect()
      const trackWidth = trackRect.width
      const startClientX = e.clientX
      const origStartMin = toMinutes(startTime)
      const origEndMin = toMinutes(endTime)
      const duration = origEndMin - origStartMin

      const onMove = (ev: PointerEvent) => {
        const deltaX = ev.clientX - startClientX
        const deltaMin = (deltaX / trackWidth) * (axisCloseMin - axisOpenMin)

        let candidateStart = origStartMin + deltaMin
        let candidateEnd = candidateStart + duration

        // Clamp
        if (candidateStart < axisOpenMin) {
          candidateStart = axisOpenMin
          candidateEnd = candidateStart + duration
        }
        if (candidateEnd > axisCloseMin) {
          candidateEnd = axisCloseMin
          candidateStart = candidateEnd - duration
        }

        const snappedStart = Math.round(candidateStart / SNAP_MINUTES) * SNAP_MINUTES
        const snappedEnd = snappedStart + duration

        if (snappedStart >= axisOpenMin && snappedEnd <= axisCloseMin) {
          onChange(minutesToTime(snappedStart), minutesToTime(snappedEnd))
        }
      }

      const onUp = () => {
        document.removeEventListener('pointermove', onMove)
        document.removeEventListener('pointerup', onUp)
      }

      document.addEventListener('pointermove', onMove)
      document.addEventListener('pointerup', onUp)
    },
    [startTime, endTime, axisOpenMin, axisCloseMin, onChange],
  )

  return (
    <div
      ref={trackRef}
      className="group relative h-9 w-full rounded-md bg-muted/40 dark:bg-muted/25"
    >
      {/* Hour tick marks */}
      {ticks.map((m) => {
        const pct = ((m - axisOpenMin) / axisSpan) * 100
        return (
          <div
            key={m}
            className="absolute top-0 h-full w-px bg-border/40"
            style={{ left: `${pct}%` }}
          >
            <span className="absolute -top-4 left-1/2 -translate-x-1/2 text-[9px] text-muted-foreground/60 tabular-nums">
              {minutesToTime(m).slice(0, 2)}h
            </span>
          </div>
        )
      })}

      {/* The bar */}
      <div
        className={cn(
          'absolute top-0 h-full rounded-md border flex items-center select-none',
          'bg-sky-500/80 dark:bg-sky-600/60 border-sky-600 dark:border-sky-500 text-white',
          'cursor-grab active:cursor-grabbing hover:shadow-md transition-shadow',
        )}
        style={{
          left: `${geo.leftPercent}%`,
          width: geo.widthStyle,
        }}
        onPointerDown={handleBarPointerDown}
      >
        {/* Left handle */}
        <div
          data-handle
          className={cn(
            'absolute left-0 top-0 h-full w-2.5 cursor-col-resize rounded-l-md',
            'bg-sky-700/50 dark:bg-sky-400/30',
            'opacity-0 group-hover:opacity-100 transition-opacity',
          )}
          onPointerDown={(e) => handlePointerDown(e, 'left')}
        />

        {/* Center label */}
        <div className="flex flex-1 items-center justify-center overflow-hidden px-3 text-xs font-medium min-w-0">
          <span className="truncate tabular-nums">
            {startTime} - {endTime}
          </span>
        </div>

        {/* Right handle */}
        <div
          data-handle
          className={cn(
            'absolute right-0 top-0 h-full w-2.5 cursor-col-resize rounded-r-md',
            'bg-sky-700/50 dark:bg-sky-400/30',
            'opacity-0 group-hover:opacity-100 transition-opacity',
          )}
          onPointerDown={(e) => handlePointerDown(e, 'right')}
        />
      </div>
    </div>
  )
}
