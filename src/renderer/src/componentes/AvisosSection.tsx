import { AlertTriangle, Info, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
export type { Aviso } from '@/lib/humanizar-operacao'
import type { Aviso } from '@/lib/humanizar-operacao'

interface AvisosSectionProps {
  avisos: Aviso[]
  onAnalisarIa?: () => void
}

const NIVEL_CONFIG = {
  error: {
    icon: AlertTriangle,
    card: 'border bg-rose-500/10 border-rose-500/20 dark:border-rose-500/15 text-rose-700 dark:text-rose-400',
    icon_class: 'text-rose-600 dark:text-rose-400',
  },
  warning: {
    icon: AlertTriangle,
    card: 'border bg-yellow-500/10 border-yellow-500/20 dark:border-yellow-500/15 text-yellow-800 dark:text-yellow-400',
    icon_class: 'text-yellow-600 dark:text-yellow-400',
  },
  info: {
    icon: Info,
    card: 'border bg-indigo-500/10 border-indigo-500/20 dark:border-indigo-500/15 text-indigo-700 dark:text-indigo-400',
    icon_class: 'text-indigo-600 dark:text-indigo-400',
  },
} as const

export function AvisosSection({ avisos, onAnalisarIa }: AvisosSectionProps) {
  if (avisos.length === 0) return null

  return (
    <div className="mt-4">
      <div className="mb-2.5 flex items-center gap-2">
        <span className="text-sm font-semibold text-muted-foreground">
          Avisos ({avisos.length})
        </span>
        <div className="flex-1" />
        {onAnalisarIa && (
          <Button variant="outline" size="sm" onClick={onAnalisarIa}>
            <Sparkles className="size-4" />
            Analisar com IA
          </Button>
        )}
      </div>

      <div className="space-y-1.5">
        {avisos.map(aviso => {
          const config = NIVEL_CONFIG[aviso.nivel]
          const Icon = config.icon
          return (
            <div
              key={aviso.id}
              className={cn('flex items-start gap-2.5 rounded-md px-4 py-3', config.card)}
            >
              <Icon className={cn('mt-0.5 size-4 shrink-0', config.icon_class)} />
              <div className="flex-1">
                <p className="text-sm font-semibold">{aviso.titulo}</p>
                <p className="text-[13px] opacity-80">{aviso.descricao}</p>
                {aviso.acao && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="mt-1.5 h-7 px-2 text-xs"
                    onClick={aviso.acao.handler}
                  >
                    {aviso.acao.label}
                  </Button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
