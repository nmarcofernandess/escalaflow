/**
 * Toasts para fluxo de geracao de escala.
 * Erros criticos (preflight, INFEASIBLE, timeout) usam toast persistente:
 * nao some automaticamente, usuario fecha clicando no X.
 */
import { toast } from 'sonner'
import { mapError } from './formatadores'

export function toastErrorPersistent(msg: string): void {
  toast.error(msg, { duration: Number.POSITIVE_INFINITY })
}

/**
 * Exibe erro de geracao de escala com toast persistente.
 * Usa mapError para mensagem amigavel.
 */
export function toastErroGeracaoEscala(err: unknown): void {
  const msg = mapError(err)
  toastErrorPersistent(msg)
}
