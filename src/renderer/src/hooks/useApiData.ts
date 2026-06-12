import { useState, useEffect, useCallback, useRef } from 'react'

export function useApiData<T>(fetcher: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // Descarta respostas fora de ordem quando dois fetches concorrem
  const reqIdRef = useRef(0)

  const load = useCallback((opts?: { silent?: boolean }) => {
    const reqId = ++reqIdRef.current
    if (!opts?.silent) setLoading(true)
    setError(null)
    fetcher()
      .then((result) => {
        if (reqId !== reqIdRef.current) return
        setData(result)
        setLoading(false)
      })
      .catch((err: Error) => {
        if (reqId !== reqIdRef.current) return
        setError(err.message)
        setLoading(false)
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  useEffect(() => {
    load()
  }, [load])

  // A6: revalida quando o main avisa que dados mudaram (IA tools / tipc emitem
  // 'data:invalidated'). Silencioso (sem spinner) + debounce pra rajadas de
  // broadcasts (ex: cadastrar_lote da IA). Sem filtro por entidade de
  // propósito: queries são locais (PGlite), refetch espúrio custa ms.
  const loadRef = useRef(load)
  useEffect(() => {
    loadRef.current = load
  }, [load])

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const cleanup = window.electron.ipcRenderer.on('data:invalidated', () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => loadRef.current({ silent: true }), 200)
    })
    return () => {
      if (timer) clearTimeout(timer)
      if (typeof cleanup === 'function') cleanup()
    }
  }, [])

  return { data, loading, error, reload: load }
}
