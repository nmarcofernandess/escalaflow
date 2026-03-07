import { useState, useEffect } from 'react'

let cached: string | null = null

/** Retorna a versão real do app (package.json) via IPC. */
export function useAppVersion(): string | null {
  const [version, setVersion] = useState<string | null>(cached)

  useEffect(() => {
    if (cached) {
      setVersion(cached)
      return
    }
    window.electron.ipcRenderer
      .invoke('app:version')
      .then((v: string) => {
        cached = v
        setVersion(v)
      })
      .catch(() => setVersion(null))
  }, [])

  return version
}

/** Obtém a versão de forma assíncrona (para uso fora de componentes React). */
export async function getAppVersion(): Promise<string> {
  if (cached) return cached
  const v = await window.electron.ipcRenderer.invoke('app:version') as string
  cached = v
  return v
}
