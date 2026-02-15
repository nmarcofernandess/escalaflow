import { useState, useEffect } from 'react'
import { CalendarDays, Building2, Zap, CheckCircle2, ChevronLeft, ChevronRight } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

const STORAGE_KEY = 'escalaflow-onboarding-v1'

const PASSOS = [
  {
    titulo: 'Bem-vindo ao EscalaFlow',
    descricao:
      'O EscalaFlow ajuda voce a criar e gerenciar escalas de trabalho para seu supermercado. Cadastre setores, colaboradores e demandas, depois gere escalas automaticas que respeitam a legislacao trabalhista.',
    icon: CalendarDays,
  },
  {
    titulo: 'Cadastre seu setor',
    descricao:
      'Va em Setores e crie os departamentos (Caixa, Acougue, etc.). Em cada setor, cadastre os colaboradores e defina as faixas de demanda (horarios e quantidade minima de pessoas por periodo).',
    icon: Building2,
  },
  {
    titulo: 'Gere a escala',
    descricao:
      'Na aba Simulacao, selecione o periodo e clique em Gerar Escala. O sistema calcula automaticamente os horarios, distribuindo folgas e trabalho de forma equilibrada.',
    icon: Zap,
  },
  {
    titulo: 'Ajuste e oficialize',
    descricao:
      'Clique nas celulas do grid para alternar entre Trabalho e Folga. O sistema recalcula o resto automaticamente. Revise os indicadores e, quando estiver satisfeito, clique em Oficializar.',
    icon: CheckCircle2,
  },
] as const

export function OnboardingTour() {
  const [open, setOpen] = useState(false)
  const [passo, setPasso] = useState(0)
  const [naoMostrar, setNaoMostrar] = useState(false)

  useEffect(() => {
    const jaViu = localStorage.getItem(STORAGE_KEY)
    if (!jaViu) {
      setOpen(true)
    }
  }, [])

  useEffect(() => {
    const handler = () => {
      localStorage.removeItem(STORAGE_KEY)
      setOpen(true)
      setPasso(0)
    }
    window.addEventListener('escalaflow:open-onboarding', handler)
    return () => window.removeEventListener('escalaflow:open-onboarding', handler)
  }, [])

  function handleConcluir() {
    if (naoMostrar) {
      localStorage.setItem(STORAGE_KEY, '1')
    }
    setOpen(false)
  }

  function handleProximo() {
    if (passo < PASSOS.length - 1) {
      setPasso((p) => p + 1)
    } else {
      handleConcluir()
    }
  }

  function handleAnterior() {
    if (passo > 0) {
      setPasso((p) => p - 1)
    }
  }

  const atual = PASSOS[passo]
  const Icon = atual.icon
  const isUltimo = passo === PASSOS.length - 1

  function handleOpenChange(next: boolean) {
    if (!next) {
      if (naoMostrar) localStorage.setItem(STORAGE_KEY, '1')
      setOpen(false)
    } else {
      setOpen(true)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="sm:max-w-md"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="flex size-12 items-center justify-center rounded-full bg-primary/10">
              <Icon className="size-6 text-primary" />
            </div>
            <div>
              <DialogTitle className="text-lg">{atual.titulo}</DialogTitle>
              <p className="text-xs text-muted-foreground">
                Passo {passo + 1} de {PASSOS.length}
              </p>
            </div>
          </div>
          <DialogDescription className="pt-2 text-left">
            {atual.descricao}
          </DialogDescription>
        </DialogHeader>

        {isUltimo && (
          <div className="flex items-center space-x-2 rounded-lg border p-3">
            <Checkbox
              id="nao-mostrar"
              checked={naoMostrar}
              onCheckedChange={(c) => setNaoMostrar(!!c)}
            />
            <Label
              htmlFor="nao-mostrar"
              className="cursor-pointer text-sm font-normal"
            >
              Nao mostrar novamente
            </Label>
          </div>
        )}

        <DialogFooter className="flex-row justify-between sm:justify-between">
          <Button
            variant="outline"
            onClick={handleAnterior}
            disabled={passo === 0}
            className={cn(passo === 0 && 'invisible')}
          >
            <ChevronLeft className="mr-1 size-4" />
            Anterior
          </Button>
          <Button onClick={handleProximo}>
            {isUltimo ? (
              'Concluir'
            ) : (
              <>
                Proximo
                <ChevronRight className="ml-1 size-4" />
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
