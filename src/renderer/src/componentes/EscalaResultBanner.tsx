import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Eye,
  Download,
  ShieldCheck,
  Trash2,
  Loader2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { cn } from '@/lib/utils'
import { formatarData } from '@/lib/formatadores'
import type { DiagnosticoSolver, Indicadores } from '@shared/index'

interface EscalaResultBannerProps {
  diagnostico?: DiagnosticoSolver
  indicadores: Indicadores
  antipatterns: number
  dataInicio: string
  dataFim: string
  onAbrirDetalhes: () => void
  onExportar: () => void
  onOficializar: () => void
  onDescartar: () => void
  oficializando: boolean
  descartando: boolean
}

type Tier = 'verde' | 'amber' | 'vermelho'

function resolveTier(diagnostico?: DiagnosticoSolver, indicadores?: Indicadores): { tier: Tier; mensagem: string } {
  if (!diagnostico || diagnostico.status_cp_sat === 'INFEASIBLE') {
    return { tier: 'vermelho', mensagem: 'Impossivel gerar escala com as configuracoes atuais' }
  }

  const pass = diagnostico.pass_usado ?? 1
  const soft = indicadores?.violacoes_soft ?? 0

  if (pass === 3) {
    return {
      tier: 'vermelho',
      mensagem: soft > 0
        ? `Escala de EMERGENCIA gerada — CLT minimo, ${soft} aviso${soft > 1 ? 's' : ''}`
        : 'Escala de EMERGENCIA gerada — CLT minimo',
    }
  }

  if (pass === 2) {
    return {
      tier: 'amber',
      mensagem: soft > 0
        ? `Escala gerada com ajustes — ${soft} aviso${soft > 1 ? 's' : ''}`
        : 'Escala gerada com ajustes',
    }
  }

  // pass === 1
  return {
    tier: 'verde',
    mensagem: soft > 0
      ? `Escala gerada com sucesso! ${soft} aviso${soft > 1 ? 's' : ''}`
      : 'Escala gerada com sucesso!',
  }
}

const TIER_STYLES: Record<Tier, { border: string; bg: string; icon: string }> = {
  verde: {
    border: 'border-emerald-500/40',
    bg: 'bg-emerald-50 dark:bg-emerald-950/20',
    icon: 'text-emerald-600 dark:text-emerald-400',
  },
  amber: {
    border: 'border-amber-500/40',
    bg: 'bg-amber-50 dark:bg-amber-950/20',
    icon: 'text-amber-600 dark:text-amber-400',
  },
  vermelho: {
    border: 'border-red-500/40',
    bg: 'bg-red-50 dark:bg-red-950/20',
    icon: 'text-red-600 dark:text-red-400',
  },
}

const TIER_ICON: Record<Tier, typeof CheckCircle2> = {
  verde: CheckCircle2,
  amber: AlertTriangle,
  vermelho: XCircle,
}

export function EscalaResultBanner({
  diagnostico,
  indicadores,
  antipatterns,
  dataInicio,
  dataFim,
  onAbrirDetalhes,
  onExportar,
  onOficializar,
  onDescartar,
  oficializando,
  descartando,
}: EscalaResultBannerProps) {
  const { tier, mensagem } = resolveTier(diagnostico, indicadores)
  const styles = TIER_STYLES[tier]
  const Icon = TIER_ICON[tier]
  const podeOficializar = indicadores.violacoes_hard === 0

  return (
    <div className={cn('rounded-lg border-2 p-4', styles.border, styles.bg)}>
      <div className="flex items-start gap-3">
        <Icon className={cn('mt-0.5 size-5 shrink-0', styles.icon)} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-foreground">{mensagem}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {formatarData(dataInicio)} — {formatarData(dataFim)}
          </p>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <Button size="sm" className="gap-1.5" onClick={onExportar}>
            <Download className="size-3.5" />
            Exportar Ciclo
          </Button>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={onAbrirDetalhes}>
            <Eye className="size-3.5" />
            Ver completo
          </Button>

          {podeOficializar && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="sm" className="gap-1.5" disabled={oficializando}>
                  {oficializando ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <ShieldCheck className="size-3.5" />
                  )}
                  Oficializar
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Oficializar escala?</AlertDialogTitle>
                  <AlertDialogDescription>
                    A escala sera marcada como oficial. Rascunhos anteriores serao arquivados.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                  <AlertDialogAction onClick={onOficializar}>
                    Oficializar
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="ghost" size="icon" className="size-8 text-muted-foreground hover:text-destructive" disabled={descartando}>
                {descartando ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Trash2 className="size-3.5" />
                )}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Descartar escala?</AlertDialogTitle>
                <AlertDialogDescription>
                  O rascunho sera removido permanentemente. Voce pode gerar uma nova escala a qualquer momento.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction onClick={onDescartar} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                  Descartar
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>
    </div>
  )
}
