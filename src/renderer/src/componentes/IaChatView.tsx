import { useEffect, useRef, useState } from 'react'
import { Bot } from 'lucide-react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { useIaStore } from '@/store/iaStore'
import { IaMensagemBubble } from './IaMensagemBubble'
import { IaChatInput } from './IaChatInput'
import type { IaMensagem } from '@shared/index'

export function IaChatView() {
  const { mensagens, carregando, setCarregando, conversa_ativa_id, adicionarMensagem } =
    useIaStore()
  const [texto, setTexto] = useState('')
  const msgEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    msgEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [mensagens, carregando])

  const enviar = async () => {
    if (!texto.trim() || carregando || !conversa_ativa_id) return

    const config = await window.electron.ipcRenderer.invoke('ia.configuracao.obter')
    const now = new Date().toISOString()

    if (!config?.ativo || !config?.api_key) {
      await adicionarMensagem({
        id: crypto.randomUUID(),
        timestamp: now,
        papel: 'assistente',
        conteudo:
          '⚠️ IA não está ativa ou API Key está faltando.\nAcesse Configurações > Inteligência Artificial.',
      })
      return
    }

    const msg: IaMensagem = {
      id: crypto.randomUUID(),
      timestamp: now,
      papel: 'usuario',
      conteudo: texto,
    }
    await adicionarMensagem(msg)
    setTexto('')
    setCarregando(true)

    try {
      const resp = await window.electron.ipcRenderer.invoke('ia.chat.enviar', {
        mensagem: msg.conteudo,
        historico: mensagens,
      })
      await adicionarMensagem({
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        papel: 'assistente',
        conteudo: resp.resposta,
      })
      if (resp.acoes?.length > 0) {
        for (const acao of resp.acoes) {
          await adicionarMensagem({
            id: crypto.randomUUID(),
            timestamp: new Date().toISOString(),
            papel: 'tool_result',
            conteudo: `🔧 ${acao.name}\n${JSON.stringify(acao.result, null, 2)}`,
          })
        }
      }
    } catch (err: any) {
      await adicionarMensagem({
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        papel: 'assistente',
        conteudo: `❌ Erro: ${err.message}`,
      })
    } finally {
      setCarregando(false)
    }
  }

  return (
    <>
      <ScrollArea className="flex-1">
        <div className="flex flex-col gap-3 p-4">
          {mensagens.length === 0 && (
            <div className="flex flex-col items-center justify-center text-center gap-3 text-muted-foreground py-16">
              <Bot className="size-12 opacity-20" />
              <div>
                <p className="text-sm font-medium">Olá! 👋</p>
                <p className="text-xs mt-1 max-w-[240px] leading-relaxed">
                  Posso gerar escalas, consultar dados, verificar conflitos e muito mais.
                </p>
              </div>
            </div>
          )}

          {mensagens.map((m) => (
            <IaMensagemBubble key={m.id} msg={m} />
          ))}

          {carregando && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-2xl rounded-bl-sm bg-muted border text-muted-foreground text-sm max-w-[70%]">
              <div className="flex gap-1">
                <span className="size-1.5 rounded-full bg-current animate-bounce [animation-delay:0ms]" />
                <span className="size-1.5 rounded-full bg-current animate-bounce [animation-delay:150ms]" />
                <span className="size-1.5 rounded-full bg-current animate-bounce [animation-delay:300ms]" />
              </div>
              Pensando...
            </div>
          )}
          <div ref={msgEndRef} />
        </div>
      </ScrollArea>

      <Separator />

      <IaChatInput
        value={texto}
        onChange={setTexto}
        onEnviar={enviar}
        disabled={carregando || !conversa_ativa_id}
      />
    </>
  )
}
