import { useState, useEffect } from 'react'
import { Loader2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { servicoConhecimento } from '@/servicos/conhecimento'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  fonte: { id: number; titulo: string } | null
}

export function VerConhecimentoDialog({ open, onOpenChange, fonte }: Props) {
  const [carregando, setCarregando] = useState(false)
  const [conteudo, setConteudo] = useState('')
  const [contextHint, setContextHint] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !fonte) return
    setCarregando(true)
    setConteudo('')
    setContextHint(null)
    servicoConhecimento.obterTextoOriginal(fonte.id)
      .then((r) => {
        setConteudo(r.conteudo_original)
        setContextHint(r.context_hint)
      })
      .catch(() => setConteudo('Erro ao carregar conteúdo.'))
      .finally(() => setCarregando(false))
  }, [open, fonte])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="pr-6">{fonte?.titulo ?? 'Documento'}</DialogTitle>
          {contextHint && (
            <Badge variant="secondary" className="mt-1 w-fit text-xs font-normal">
              Consultar: {contextHint}
            </Badge>
          )}
        </DialogHeader>
        {carregando ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <ScrollArea className="max-h-[60vh]">
            <p className="whitespace-pre-wrap text-sm text-muted-foreground">{conteudo}</p>
          </ScrollArea>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
