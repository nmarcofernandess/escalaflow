import { useState, useRef, useCallback, useEffect } from 'react'

export type AutoSaveStatus = 'idle' | 'saving' | 'saved' | 'error'

interface UseAutoSaveOptions {
  saveFn: () => Promise<void>
  validate?: () => boolean
}

interface UseAutoSaveReturn {
  status: AutoSaveStatus
  error: string | null
  trigger: () => void
}

export function useAutoSave({ saveFn, validate }: UseAutoSaveOptions): UseAutoSaveReturn {
  const [status, setStatus] = useState<AutoSaveStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const savingRef = useRef(false)

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  const trigger = useCallback(() => {
    if (savingRef.current) return

    if (validate && !validate()) {
      setStatus('error')
      setError('Valor invalido')
      timerRef.current = setTimeout(() => {
        setStatus('idle')
        setError(null)
      }, 3000)
      return
    }

    savingRef.current = true
    setStatus('saving')
    setError(null)

    saveFn()
      .then(() => {
        setStatus('saved')
        if (timerRef.current) clearTimeout(timerRef.current)
        timerRef.current = setTimeout(() => setStatus('idle'), 2000)
      })
      .catch((err) => {
        setStatus('error')
        setError(err instanceof Error ? err.message : 'Erro ao salvar')
        if (timerRef.current) clearTimeout(timerRef.current)
        timerRef.current = setTimeout(() => {
          setStatus('idle')
          setError(null)
        }, 3000)
      })
      .finally(() => {
        savingRef.current = false
      })
  }, [saveFn, validate])

  return { status, error, trigger }
}
