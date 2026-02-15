import { CheckCircle2, Clock } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { CORES_STATUS_ESCALA } from '@/lib/cores'

export function StatusBadge({ status }: { status: 'OFICIAL' | 'RASCUNHO' | 'SEM_ESCALA' }) {
  if (status === 'OFICIAL') {
    return (
      <Badge variant="outline" className={CORES_STATUS_ESCALA.OFICIAL}>
        <CheckCircle2 className="mr-1 size-3" /> Oficial
      </Badge>
    )
  }

  if (status === 'RASCUNHO') {
    return (
      <Badge variant="outline" className={CORES_STATUS_ESCALA.RASCUNHO}>
        <Clock className="mr-1 size-3" /> Rascunho
      </Badge>
    )
  }

  return (
    <Badge variant="outline" className={CORES_STATUS_ESCALA.SEM_ESCALA}>
      Sem Escala
    </Badge>
  )
}
