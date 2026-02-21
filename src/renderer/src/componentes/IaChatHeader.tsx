import { ChevronLeft, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useIaStore } from '@/store/iaStore'

export function IaChatHeader() {
  const { tela, setTela, conversa_ativa_titulo, novaConversa, listarConversas } = useIaStore()

  const irParaHistorico = async () => {
    await listarConversas()
    setTela('historico')
  }

  const handleNovaConversa = async () => {
    await novaConversa()
  }

  if (tela === 'chat') {
    return (
      <div className="flex items-center gap-1 px-2 h-14 shrink-0 border-b">
        <Button
          variant="ghost"
          size="sm"
          className="gap-1 text-muted-foreground h-8 px-2 shrink-0"
          onClick={irParaHistorico}
        >
          <ChevronLeft className="size-3.5" />
          <span className="text-xs">Histórico</span>
        </Button>
        <span
          className="text-sm font-semibold flex-1 truncate text-center"
          title={conversa_ativa_titulo}
        >
          {conversa_ativa_titulo}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="size-8 shrink-0"
          onClick={handleNovaConversa}
          title="Nova conversa"
        >
          <Plus className="size-4" />
        </Button>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-1 px-2 h-14 shrink-0 border-b">
      <Button
        variant="ghost"
        size="sm"
        className="gap-1 text-muted-foreground h-8 px-2 shrink-0"
        onClick={() => setTela('chat')}
        title="Voltar ao chat"
      >
        <ChevronLeft className="size-3.5" />
        <span className="text-xs">Voltar</span>
      </Button>
      <span className="text-sm font-semibold flex-1 text-center">Histórico</span>
      <Button
        variant="ghost"
        size="icon"
        className="size-8 shrink-0"
        onClick={handleNovaConversa}
        title="Nova conversa"
      >
        <Plus className="size-4" />
      </Button>
    </div>
  )
}
