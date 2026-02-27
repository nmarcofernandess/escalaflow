import { useEffect } from 'react'
import { useBlocker } from 'react-router-dom'
import type { Blocker } from 'react-router-dom'

/**
 * Protege navegacao quando um form tem alteracoes nao salvas.
 * Usa useBlocker (react-router data router) para interceptar navegacao interna
 * e beforeunload para interceptar fechamento de janela/aba.
 *
 * Retorna o Blocker object para uso com DirtyGuardDialog.
 */
export function useDirtyGuard({
  isDirty,
  message = 'Voce tem alteracoes que nao foram salvas. Deseja sair mesmo assim?',
}: {
  isDirty: boolean
  message?: string
}): Blocker {
  // Bloqueia navegacao interna via react-router
  const blocker = useBlocker(isDirty)

  // Fallback: intercepta fechamento de janela/aba (Electron ou browser)
  useEffect(() => {
    if (!isDirty) return

    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      // Browsers modernos ignoram returnValue customizado, mas e necessario pra trigger
      e.returnValue = message
      return message
    }

    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [isDirty, message])

  return blocker
}
