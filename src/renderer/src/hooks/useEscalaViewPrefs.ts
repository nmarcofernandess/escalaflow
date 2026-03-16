import { useState, useCallback } from 'react'

export interface EscalaViewPrefs {
  showCiclo: boolean
  showSemanal: boolean
  showTimeline: boolean
  timelineView: 'barras' | 'grid'
}

const STORAGE_KEY = 'escala-view-prefs'
const DEFAULTS: EscalaViewPrefs = {
  showCiclo: true,
  showSemanal: true,
  showTimeline: true,
  timelineView: 'barras',
}

export function useEscalaViewPrefs() {
  const [prefs, setPrefs] = useState<EscalaViewPrefs>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : DEFAULTS
    } catch {
      return DEFAULTS
    }
  })

  const update = useCallback((partial: Partial<EscalaViewPrefs>) => {
    setPrefs((prev) => {
      const next = { ...prev, ...partial }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      return next
    })
  }, [])

  return [prefs, update] as const
}
