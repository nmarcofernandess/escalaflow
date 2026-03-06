import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { IaConversaItem } from './IaConversaItem'
import { cn } from '@/lib/utils'
import type { IaConversa } from '@shared/index'
import type { LucideProps } from 'lucide-react'

interface AcaoBulk {
  icon: React.ComponentType<LucideProps>
  tooltip: string
  onClick: () => void
  confirmacao?: string
  variant?: 'ghost' | 'destructive'
}

interface Props {
  titulo: string
  conversas: IaConversa[]
  acaoBulk?: AcaoBulk
  collapsible?: boolean
  onAbrir: (id: string) => void
  tipo: 'ativa' | 'arquivada'
}

export function IaSecaoConversas({ titulo, conversas, acaoBulk, collapsible, onAbrir, tipo }: Props) {
  const [expandido, setExpandido] = useState(true)
  const [confirmar, setConfirmar] = useState(false)

  if (conversas.length === 0 && tipo === 'arquivada') return null

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between px-1 py-1">
        <div
          className={cn(
            'flex items-center gap-1.5',
            collapsible && 'cursor-pointer select-none',
          )}
          onClick={() => collapsible && setExpandido((v) => !v)}
        >
          {collapsible && (
            <span className="text-muted-foreground">
              {expandido ? (
                <ChevronDown className="size-3.5" />
              ) : (
                <ChevronRight className="size-3.5" />
              )}
            </span>
          )}
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {titulo}
          </span>
          <Badge variant="secondary" className="text-[9px] h-4 px-1.5">
            {conversas.length}
          </Badge>
        </div>

        {acaoBulk && conversas.length > 0 && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-6 text-muted-foreground hover:text-foreground"
                  onClick={() => (acaoBulk.confirmacao ? setConfirmar(true) : acaoBulk.onClick())}
                >
                  <acaoBulk.icon className="size-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="left">
                <p className="text-xs">{acaoBulk.tooltip}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>

      {expandido && (
        <div className="flex flex-col gap-0.5">
          {conversas.map((c) => (
            <IaConversaItem key={c.id} conversa={c} onAbrir={onAbrir} tipo={tipo} />
          ))}
        </div>
      )}

      {acaoBulk?.confirmacao && (
        <AlertDialog open={confirmar} onOpenChange={setConfirmar}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{acaoBulk.tooltip}?</AlertDialogTitle>
              <AlertDialogDescription>{acaoBulk.confirmacao}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction
                className={
                  acaoBulk.variant === 'destructive'
                    ? 'bg-destructive hover:bg-destructive/90'
                    : ''
                }
                onClick={() => {
                  setConfirmar(false)
                  acaoBulk.onClick()
                }}
              >
                Confirmar
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  )
}
