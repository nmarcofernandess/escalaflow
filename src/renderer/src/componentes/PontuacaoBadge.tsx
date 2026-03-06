import { CheckCircle2, AlertTriangle, XCircle } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

export function PontuacaoBadge({ pontuacao }: { pontuacao: number }) {
  let color = 'border-success/20 bg-success/10 text-success'
  let icon = <CheckCircle2 className="size-3.5" />

  if (pontuacao < 70) {
    color = 'border-destructive/20 bg-destructive/10 text-destructive'
    icon = <XCircle className="size-3.5" />
  } else if (pontuacao < 85) {
    color = 'border-warning/20 bg-warning/10 text-warning'
    icon = <AlertTriangle className="size-3.5" />
  }

  return (
    <Badge variant="outline" className={cn('gap-1.5', color)}>
      {icon}
      {pontuacao}
    </Badge>
  )
}
