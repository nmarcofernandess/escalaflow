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

/**
 * Exibe erro INFEASIBLE com toast persistente e botao opcional "Analisar com IA".
 * O callback onAnalyze e passado pelo caller — mantem este arquivo desacoplado da store.
 */
export function toastInfeasible(mensagem: string, onAnalyze?: () => void): void {
  toast.error(mensagem, {
    duration: Number.POSITIVE_INFINITY,
    ...(onAnalyze ? {
      action: {
        label: 'Analisar com IA',
        onClick: onAnalyze,
      },
    } : {}),
  })
}
