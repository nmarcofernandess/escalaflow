import { useCallback, useRef, useState } from 'react'
import { minutesToTime } from '@/lib/formatadores'
import { normalizeTimelineInterval } from '@/lib/timeline-demanda'

interface ResizeState {
  demandaId: number
  side: 'left' | 'right'
  initialX: number
  initialMinutes: number
  containerWidth: number
  axisOpenMin: number
  axisCloseMin: number
  axisTotalMinutes: number
  boundOpenMin: number
  boundCloseMin: number
}

interface ResizeResult {
  hora_inicio: string
  hora_fim: string
}

interface UseDemandaResizeOptions {
  axisOpenMin: number
  axisCloseMin: number
  boundsOpenMin?: number
  boundsCloseMin?: number
  minDuration?: number  // minimum bar duration in minutes
  snapInterval?: number // snap granularity in minutes
  onResizeEnd: (demandaId: number, result: ResizeResult) => void
}

export function useDemandaResize({
  axisOpenMin,
  axisCloseMin,
  boundsOpenMin,
  boundsCloseMin,
  minDuration = 60,
  snapInterval = 30,
  onResizeEnd,
}: UseDemandaResizeOptions) {
  const [resizingId, setResizingId] = useState<number | null>(null)
  const [preview, setPreview] = useState<{ id: number; hora_inicio: string; hora_fim: string } | null>(null)
  const stateRef = useRef<ResizeState | null>(null)
  const currentStartRef = useRef(0)
  const currentEndRef = useRef(0)

  const handlePointerMove = useCallback((e: PointerEvent) => {
    const s = stateRef.current
    if (!s) return

    if (s.containerWidth <= 0) return

    const dx = e.clientX - s.initialX
    const minutesDelta = (dx / s.containerWidth) * s.axisTotalMinutes

    const candidateStart = s.side === 'left'
      ? s.initialMinutes + minutesDelta
      : currentStartRef.current
    const candidateEnd = s.side === 'right'
      ? s.initialMinutes + minutesDelta
      : currentEndRef.current

    const normalized = normalizeTimelineInterval({
      startMin: candidateStart,
      endMin: candidateEnd,
      axisOpenMin: s.axisOpenMin,
      axisCloseMin: s.axisCloseMin,
      boundsOpenMin: s.boundOpenMin,
      boundsCloseMin: s.boundCloseMin,
      minDurationMin: minDuration,
      snapIntervalMin: snapInterval,
    })
    if (!normalized) return

    currentStartRef.current = normalized.startMin
    currentEndRef.current = normalized.endMin

    setPreview({
      id: s.demandaId,
      hora_inicio: minutesToTime(currentStartRef.current),
      hora_fim: minutesToTime(currentEndRef.current),
    })
  }, [minDuration, snapInterval])

  const handlePointerUp = useCallback(() => {
    const s = stateRef.current
    if (!s) return

    document.removeEventListener('pointermove', handlePointerMove)
    document.removeEventListener('pointerup', handlePointerUp)

    onResizeEnd(s.demandaId, {
      hora_inicio: minutesToTime(currentStartRef.current),
      hora_fim: minutesToTime(currentEndRef.current),
    })

    setResizingId(null)
    setPreview(null)
    stateRef.current = null
  }, [handlePointerMove, onResizeEnd])

  const startResize = useCallback((
    e: React.PointerEvent,
    demandaId: number,
    side: 'left' | 'right',
    currentStartMin: number,
    currentEndMin: number,
    containerEl: HTMLElement,
  ) => {
    e.preventDefault()
    e.stopPropagation()

    const rect = containerEl.getBoundingClientRect()
    const axisTotalMinutes = axisCloseMin - axisOpenMin

    currentStartRef.current = currentStartMin
    currentEndRef.current = currentEndMin

    stateRef.current = {
      demandaId,
      side,
      initialX: e.clientX,
      initialMinutes: side === 'left' ? currentStartMin : currentEndMin,
      containerWidth: rect.width,
      axisOpenMin,
      axisCloseMin,
      axisTotalMinutes,
      boundOpenMin: boundsOpenMin ?? axisOpenMin,
      boundCloseMin: boundsCloseMin ?? axisCloseMin,
    }

    setResizingId(demandaId)
    document.addEventListener('pointermove', handlePointerMove)
    document.addEventListener('pointerup', handlePointerUp)
  }, [axisOpenMin, axisCloseMin, boundsOpenMin, boundsCloseMin, handlePointerMove, handlePointerUp])

  return { resizingId, preview, startResize }
}
