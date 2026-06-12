import { Badge } from '@/components/ui/badge'
import type { TipoTrabalhador } from '@shared/index'

const LABEL: Record<TipoTrabalhador, string> = {
  CLT: 'CLT',
  ESTAGIARIO: 'Estagiario',
  INTERMITENTE: 'Intermitente',
}

const CLASSNAME: Record<TipoTrabalhador, string> = {
  CLT: 'border-primary/20 bg-primary/10 text-primary',
  ESTAGIARIO: 'border-success/20 bg-success/10 text-success',
  INTERMITENTE: 'border-warning/30 bg-warning/10 text-warning',
}

export function TipoTrabalhadorBadge({ tipo }: { tipo: TipoTrabalhador }) {
  return (
    <Badge variant="outline" className={`whitespace-nowrap text-xs ${CLASSNAME[tipo]}`}>
      {LABEL[tipo]}
    </Badge>
  )
}
