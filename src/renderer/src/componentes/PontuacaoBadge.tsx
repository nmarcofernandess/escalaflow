import { CheckCircle2, AlertTriangle, XCircle } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

export function PontuacaoBadge({ pontuacao }: { pontuacao: number }) {
  let color = 'border-emerald-200 dark:border-emerald-800 bg-emerald-100 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-300'
  let icon = <CheckCircle2 className="size-3.5" />

  if (pontuacao < 70) {
    color = 'border-red-200 dark:border-red-800 bg-red-100 dark:bg-red-950/30 text-red-800 dark:text-red-300'
    icon = <XCircle className="size-3.5" />
  } else if (pontuacao < 85) {
    color = 'border-amber-200 dark:border-amber-800 bg-amber-100 dark:bg-amber-950/30 text-amber-800 dark:text-amber-300'
    icon = <AlertTriangle className="size-3.5" />
  }

  return (
    <Badge variant="outline" className={cn('gap-1.5', color)}>
      {icon}
      {pontuacao}
    </Badge>
  )
}
