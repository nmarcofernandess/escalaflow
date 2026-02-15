import { useCallback, useRef, useState } from 'react'
import { minutesToTime } from '@/lib/formatadores'

interface ResizeState {
  demandaId: number
  side: 'left' | 'right'
  initialX: number
  initialMinutes: number
  containerWidth: number
  totalMinutes: number
  openMin: number
}

interface ResizeResult {
  hora_inicio: string
  hora_fim: string
}

interface UseDemandaResizeOptions {
  openMin: number
  closeMin: number
  minDuration?: number  // minimum bar duration in minutes
  snapInterval?: number // snap granularity in minutes
  onResizeEnd: (demandaId: number, result: ResizeResult) => void
}

export function useDemandaResize({
  openMin,
  closeMin,
  minDuration = 60,
  snapInterval = 30,
  onResizeEnd,
}: UseDemandaResizeOptions) {
  const [resizingId, setResizingId] = useState<number | null>(null)
  const [preview, setPreview] = useState<{ id: number; hora_inicio: string; hora_fim: string } | null>(null)
  const stateRef = useRef<ResizeState | null>(null)
  const currentStartRef = useRef(0)
  const currentEndRef = useRef(0)

  const snap = (val: number) => Math.round(val / snapInterval) * snapInterval

  const handlePointerMove = useCallback((e: PointerEvent) => {
    const s = stateRef.current
    if (!s) return

    const dx = e.clientX - s.initialX
    const minutesDelta = (dx / s.containerWidth) * s.totalMinutes
    const snapped = snap(minutesDelta)

    let newStart = currentStartRef.current
    let newEnd = currentEndRef.current

    if (s.side === 'left') {
      newStart = snap(s.initialMinutes + snapped)
      newStart = Math.max(s.openMin, Math.min(newStart, newEnd - minDuration))
    } else {
      newEnd = snap(s.initialMinutes + snapped)
      newEnd = Math.min(closeMin, Math.max(newEnd, newStart + minDuration))
    }

    if (s.side === 'left') currentStartRef.current = newStart
    else currentEndRef.current = newEnd

    setPreview({
      id: s.demandaId,
      hora_inicio: minutesToTime(currentStartRef.current),
      hora_fim: minutesToTime(currentEndRef.current),
    })
  }, [closeMin, minDuration, snapInterval])

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
    const totalMinutes = closeMin - openMin

    currentStartRef.current = currentStartMin
    currentEndRef.current = currentEndMin

    stateRef.current = {
      demandaId,
      side,
      initialX: e.clientX,
      initialMinutes: side === 'left' ? currentStartMin : currentEndMin,
      containerWidth: rect.width,
      totalMinutes,
      openMin,
    }

    setResizingId(demandaId)
    document.addEventListener('pointermove', handlePointerMove)
    document.addEventListener('pointerup', handlePointerUp)
  }, [openMin, closeMin, handlePointerMove, handlePointerUp])

  return { resizingId, preview, startResize }
}
