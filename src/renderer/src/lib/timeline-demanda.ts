export const DEMANDA_SNAP_MINUTES = 15
export const DEMANDA_MIN_DURATION_MINUTES = 15

const EPSILON = 0.000001

interface NormalizeTimelineIntervalInput {
  startMin: number
  endMin: number
  axisOpenMin: number
  axisCloseMin: number
  boundsOpenMin?: number
  boundsCloseMin?: number
  minDurationMin?: number
  snapIntervalMin?: number
}

export interface NormalizedTimelineInterval {
  startMin: number
  endMin: number
}

interface BuildTimelineBarGeometryInput {
  startMin: number
  endMin: number
  axisOpenMin: number
  axisCloseMin: number
  boundsOpenMin?: number
  boundsCloseMin?: number
  minWidthPx?: number
}

export interface TimelineBarGeometry {
  startMin: number
  endMin: number
  leftPercent: number
  widthPercent: number
  widthStyle: string
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function snapMinutes(value: number, snapIntervalMin = DEMANDA_SNAP_MINUTES): number {
  if (snapIntervalMin <= 0) return value
  return Math.round(value / snapIntervalMin) * snapIntervalMin
}

export function normalizeTimelineInterval({
  startMin,
  endMin,
  axisOpenMin,
  axisCloseMin,
  boundsOpenMin,
  boundsCloseMin,
  minDurationMin = DEMANDA_MIN_DURATION_MINUTES,
  snapIntervalMin = DEMANDA_SNAP_MINUTES,
}: NormalizeTimelineIntervalInput): NormalizedTimelineInterval | null {
  const axisStart = Math.min(axisOpenMin, axisCloseMin)
  const axisEnd = Math.max(axisOpenMin, axisCloseMin)

  const windowStart = clamp(boundsOpenMin ?? axisStart, axisStart, axisEnd)
  const windowEnd = clamp(boundsCloseMin ?? axisEnd, windowStart, axisEnd)

  if (windowEnd - windowStart + EPSILON < minDurationMin) return null

  const snappedStart = snapMinutes(startMin, snapIntervalMin)
  const snappedEnd = snapMinutes(endMin, snapIntervalMin)

  let nextStart = clamp(Math.min(snappedStart, snappedEnd), windowStart, windowEnd)
  let nextEnd = clamp(Math.max(snappedStart, snappedEnd), windowStart, windowEnd)

  if (nextEnd - nextStart + EPSILON < minDurationMin) {
    const extendedEnd = nextStart + minDurationMin
    if (extendedEnd <= windowEnd + EPSILON) {
      nextEnd = Math.min(extendedEnd, windowEnd)
    } else {
      const shiftedStart = nextEnd - minDurationMin
      if (shiftedStart >= windowStart - EPSILON) {
        nextStart = Math.max(shiftedStart, windowStart)
      } else {
        return null
      }
    }
  }

  nextStart = clamp(nextStart, windowStart, windowEnd)
  nextEnd = clamp(nextEnd, nextStart, windowEnd)

  if (nextEnd - nextStart + EPSILON < minDurationMin) return null

  return { startMin: nextStart, endMin: nextEnd }
}

export function buildTimelineBarGeometry({
  startMin,
  endMin,
  axisOpenMin,
  axisCloseMin,
  boundsOpenMin,
  boundsCloseMin,
  minWidthPx = 0,
}: BuildTimelineBarGeometryInput): TimelineBarGeometry {
  const axisStart = Math.min(axisOpenMin, axisCloseMin)
  const axisEnd = Math.max(axisOpenMin, axisCloseMin)
  const axisSpan = Math.max(1, axisEnd - axisStart)

  const windowStart = clamp(boundsOpenMin ?? axisStart, axisStart, axisEnd)
  const windowEnd = clamp(boundsCloseMin ?? axisEnd, windowStart, axisEnd)

  const safeStart = clamp(Math.min(startMin, endMin), windowStart, windowEnd)
  const safeEnd = clamp(Math.max(startMin, endMin), safeStart, windowEnd)

  const leftPercent = clamp(((safeStart - axisStart) / axisSpan) * 100, 0, 100)
  const rawWidthPercent = clamp(((safeEnd - safeStart) / axisSpan) * 100, 0, 100)
  const maxWidthPercent = clamp(100 - leftPercent, 0, 100)
  const widthPercent = clamp(rawWidthPercent, 0, maxWidthPercent)

  const leftFixed = leftPercent.toFixed(6)
  const widthFixed = widthPercent.toFixed(6)
  const widthStyle = minWidthPx > 0
    ? `min(calc(100% - ${leftFixed}%), max(${widthFixed}%, ${minWidthPx}px))`
    : `${widthFixed}%`

  return {
    startMin: safeStart,
    endMin: safeEnd,
    leftPercent,
    widthPercent,
    widthStyle,
  }
}
