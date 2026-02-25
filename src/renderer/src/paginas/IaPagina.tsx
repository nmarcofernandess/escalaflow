import { useEffect, useRef, useState } from 'react'
import { PanelLeft, PanelLeftClose, Plus, MoreVertical, Copy, FileDown, FileJson } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useIaStore } from '@/store/iaStore'
import { PageHeader } from '@/componentes/PageHeader'
import { IaChatView } from '@/componentes/IaChatView'
import { IaHistoricoView } from '@/componentes/IaHistoricoView'
import { formatChatAsMarkdown } from '@/lib/chat-export'
import { toast } from 'sonner'

export function IaPagina() {
  const { inicializar, novaConversa, conversa_ativa_id, conversa_ativa_titulo, mensagens } = useIaStore()
  const inicializadoRef = useRef(false)
  const [sidebarAberta, setSidebarAberta] = useState(true)

  useEffect(() => {
    if (!inicializadoRef.current) {
      inicializadoRef.current = true
      inicializar()
    }
  }, [inicializar])

  const hasMensagens = mensagens.length > 0

  const handleCopiarChat = async () => {
    if (!hasMensagens) return
    const md = formatChatAsMarkdown(mensagens, conversa_ativa_titulo)
    await navigator.clipboard.writeText(md)
    toast.success('Chat copiado!')
  }

  const handleExportar = async (formato: 'md' | 'json') => {
    if (!conversa_ativa_id || !hasMensagens) return
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

  // Esquerda: toggle historico + titulo do chat
  const afterBreadcrumb = (
    <div className="flex items-center gap-1.5 min-w-0">
      <Separator orientation="vertical" className="!h-4" />
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 shrink-0"
            onClick={() => setSidebarAberta((v) => !v)}
          >
            {sidebarAberta ? (
              <PanelLeftClose className="size-4" />
            ) : (
              <PanelLeft className="size-4" />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          {sidebarAberta ? 'Fechar historico' : 'Abrir historico'}
        </TooltipContent>
      </Tooltip>
      <span
        className="text-sm text-muted-foreground truncate"
        title={conversa_ativa_titulo}
      >
        {conversa_ativa_titulo}
      </span>
    </div>
  )

  // Direita: + nova conversa, ... menu
  const headerActions = (
    <div className="flex items-center gap-0.5">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={() => novaConversa()}
          >
            <Plus className="size-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">Nova conversa</TooltipContent>
      </Tooltip>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="size-7">
            <MoreVertical className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={handleCopiarChat} disabled={!hasMensagens}>
            <Copy className="mr-2 size-3.5" />
            Copiar chat
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => handleExportar('md')} disabled={!hasMensagens}>
            <FileDown className="mr-2 size-3.5" />
            Exportar .md
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => handleExportar('json')} disabled={!hasMensagens}>
            <FileJson className="mr-2 size-3.5" />
            Exportar .json
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        breadcrumbs={[{ label: 'Assistente IA' }]}
        afterBreadcrumb={afterBreadcrumb}
        actions={headerActions}
      />

      <div className="flex flex-1 min-h-0">
        {sidebarAberta && (
          <div className="w-[380px] shrink-0 flex flex-col border-r min-h-0">
            <IaHistoricoView />
          </div>
        )}

        <div className="flex flex-1 min-h-0 min-w-0 justify-center">
          <div className="flex flex-col min-h-0 w-full max-w-5xl">
            <IaChatView />
          </div>
        </div>
      </div>
    </div>
  )
}
