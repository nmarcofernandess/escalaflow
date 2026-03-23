import { ChevronLeft, Plus, MoreVertical, Copy, FileDown, FileJson, History } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useIaStore } from '@/store/iaStore'
import { formatChatAsMarkdown } from '@/lib/chat-export'
import { toast } from 'sonner'

export function IaChatHeader() {
  const { tela, setTela, conversa_ativa_id, conversa_ativa_titulo, mensagens, novaConversa, listarConversas } = useIaStore()

  const irParaHistorico = async () => {
    await listarConversas()
    setTela('historico')
  }

  const handleNovaConversa = async () => {
    await novaConversa()
  }

  const handleCopiarChat = async () => {
    if (mensagens.length === 0) return
    const md = formatChatAsMarkdown(mensagens, conversa_ativa_titulo)
    await navigator.clipboard.writeText(md)
    toast.success('Chat copiado!')
  }

  const handleExportar = async (formato: 'md' | 'json') => {
    if (!conversa_ativa_id || mensagens.length === 0) return
    try {
      const result = await window.electron.ipcRenderer.invoke('ia.conversas.exportar', {
        conversa_id: conversa_ativa_id,
        formato,
      }) as { exportado: boolean; caminho?: string }
      if (result.exportado) {
        toast.success(`Chat exportado como .${formato}`)
      }
    } catch (err: any) {
      toast.error('Erro ao exportar', { description: err?.message })
    }
  }

  const hasMensagens = mensagens.length > 0

  if (tela === 'chat') {
    return (
      <div className="flex items-center gap-1 px-2 h-14 shrink-0 border-b">
        <span
          className="text-sm font-semibold flex-1 truncate pl-1"
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
          <Plus />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="size-8 shrink-0">
              <MoreVertical />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={irParaHistorico}>
              <History />
              Historico
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleCopiarChat} disabled={!hasMensagens}>
              <Copy />
              Copiar chat
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleExportar('md')} disabled={!hasMensagens}>
              <FileDown />
              Exportar .md
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleExportar('json')} disabled={!hasMensagens}>
              <FileJson />
              Exportar .json
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
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
        <ChevronLeft />
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
        <Plus />
      </Button>
    </div>
  )
}
