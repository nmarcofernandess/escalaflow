import { useState } from 'react'
import { Search, MessageSquareDashed, Archive, Trash2 } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { useIaStore } from '@/store/iaStore'
import { IaSecaoConversas } from './IaSecaoConversas'

export function IaHistoricoView() {
  const {
    conversas,
    busca_titulo,
    setBuscaTitulo,
    carregarConversa,
    arquivarTodas,
    deletarArquivadas,
  } = useIaStore()

  const filtradas = busca_titulo
    ? conversas.filter((c) => c.titulo.toLowerCase().includes(busca_titulo.toLowerCase()))
    : conversas

  const ativas = filtradas.filter((c) => c.status === 'ativo')
  const arquivadas = filtradas.filter((c) => c.status === 'arquivado')

  return (
    <ScrollArea className="flex-1">
      <div className="flex flex-col gap-3 p-3">
        {/* Busca */}
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
          <Input
            placeholder="Buscar conversas..."
            className="pl-8 h-8 text-xs"
            value={busca_titulo}
            onChange={(e) => setBuscaTitulo(e.target.value)}
          />
        </div>

        {/* Empty state global */}
        {ativas.length === 0 && arquivadas.length === 0 && (
          <div className="flex flex-col items-center justify-center text-center gap-3 text-muted-foreground py-16">
            <MessageSquareDashed className="size-10 opacity-20" />
            <p className="text-xs">
              {busca_titulo ? 'Nenhuma conversa encontrada' : 'Nenhuma conversa ainda'}
            </p>
          </div>
        )}

        {/* Seção Ativas */}
        {ativas.length > 0 && (
          <IaSecaoConversas
            titulo="Ativas"
            conversas={ativas}
            tipo="ativa"
            onAbrir={carregarConversa}
            acaoBulk={{
              icon: Archive,
              tooltip: 'Arquivar todas',
              onClick: arquivarTodas,
              confirmacao: `Arquivar ${ativas.length} conversa${ativas.length > 1 ? 's' : ''} ativa${ativas.length > 1 ? 's' : ''}? Elas poderão ser restauradas depois.`,
            }}
          />
        )}

        {/* Separador entre seções */}
        {ativas.length > 0 && arquivadas.length > 0 && <Separator />}

        {/* Seção Arquivadas */}
        <IaSecaoConversas
          titulo="Arquivadas"
          conversas={arquivadas}
          tipo="arquivada"
          onAbrir={carregarConversa}
          collapsible
          acaoBulk={{
            icon: Trash2,
            tooltip: 'Deletar todas',
            onClick: deletarArquivadas,
            confirmacao: `Deletar ${arquivadas.length} conversa${arquivadas.length > 1 ? 's' : ''} arquivada${arquivadas.length > 1 ? 's' : ''}? Isso não pode ser desfeito.`,
            variant: 'destructive',
          }}
        />
      </div>
    </ScrollArea>
  )
}
