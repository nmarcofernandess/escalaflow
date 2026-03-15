import { Check, Lightbulb, PlusCircle, Zap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { cn } from '@/lib/utils'
import type { DiaSemana } from '@shared/index'
import type { SugestaoFolgaItem } from '@shared/sugestao-folgas'
import { DIAS_CURTOS } from '@/lib/ciclo-grid-types'

export type SugestaoFolga = SugestaoFolgaItem

interface SugestaoSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  sugestoes: SugestaoFolga[]
  resultados?: string[]
  /** Fire-and-forget: aceita async (salva no banco) — feedback via toast */
  onAceitar: () => void
  onDescartar: () => void
}

function fmtDia(dia: DiaSemana | null): string {
  return dia ? DIAS_CURTOS[dia] : '-'
}

function DiffCell({ atual, proposta }: { atual: DiaSemana | null; proposta: DiaSemana | null }) {
  if (atual === proposta) {
    return <span className="text-muted-foreground">{fmtDia(atual)}</span>
  }
  if (!atual && proposta) {
    return (
      <span className="font-semibold text-success">
        - &rarr; {fmtDia(proposta)} <PlusCircle className="ml-0.5 inline size-3" />
      </span>
    )
  }
  return (
    <span>
      <span className="text-muted-foreground">{fmtDia(atual)}</span>
      <span className="mx-1 text-muted-foreground">&rarr;</span>
      <span className="font-semibold text-warning">
        {fmtDia(proposta)} <Zap className="ml-0.5 inline size-3" />
      </span>
    </span>
  )
}

export function SugestaoSheet({
  open,
  onOpenChange,
  sugestoes,
  resultados = [],
  onAceitar,
  onDescartar,
}: SugestaoSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[70vh] overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Lightbulb className="size-5" />
            Sugestao do Sistema
          </SheetTitle>
          <SheetDescription>
            O sistema sugere ajustes nas folgas para resolver os problemas de cobertura.
          </SheetDescription>
        </SheetHeader>

        <div className="py-4">
          {/* Diff table */}
          <div className="rounded-md border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/30">
                  <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Colaborador</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Variavel</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Fixo</th>
                </tr>
              </thead>
              <tbody>
                {sugestoes.map((s) => (
                  <tr key={s.colaborador_id} className="border-b border-border/50">
                    <td className="px-3 py-2 font-medium">{s.nome}</td>
                    <td className="px-3 py-2">
                      <DiffCell atual={s.variavel_atual} proposta={s.variavel_proposta} />
                    </td>
                    <td className="px-3 py-2">
                      <DiffCell atual={s.fixa_atual} proposta={s.fixa_proposta} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Legenda */}
          <div className="mt-3 flex gap-4 text-xs text-muted-foreground">
            <span>sem icone = manteve</span>
            <span className="text-warning"><Zap className="mr-0.5 inline size-3" /> mudou</span>
            <span className="text-success"><PlusCircle className="mr-0.5 inline size-3" /> adicionou</span>
          </div>

          {/* Resultados */}
          {resultados.length > 0 && (
            <div className="mt-4 space-y-1">
              {resultados.map((r, i) => (
                <div key={i} className="flex items-center gap-2 text-sm">
                  <Check className="size-4 text-success" />
                  {r}
                </div>
              ))}
            </div>
          )}
        </div>

        <SheetFooter className="flex-row gap-2 sm:justify-start">
          <Button onClick={onAceitar} className="bg-success text-success-foreground hover:bg-success/90">
            Aceitar sugestao
          </Button>
          <Button variant="outline" onClick={onDescartar}>
            Descartar
          </Button>
          <span className="ml-auto text-xs text-muted-foreground">
            Aceitar salva as folgas nos colaboradores
          </span>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
