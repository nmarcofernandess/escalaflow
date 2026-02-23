import { useEffect, useRef, useState, useMemo, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import { Bot, Settings, Loader2 } from 'lucide-react'
import { useNavigate, useLocation } from 'react-router-dom'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useIaStore } from '@/store/iaStore'
import { IaMensagemBubble } from './IaMensagemBubble'
import { IaChatInput } from './IaChatInput'
import { IaToolCallsCollapsible } from './IaToolCallsCollapsible'
import type { IaMensagem, IaContexto, ToolCall, IaStreamEvent } from '@shared/index'

// We intentionally keep tool output only in the in-memory UI message.
// Persisted chat history stores a sanitized version without `result` to avoid giant JSON payloads in SQLite.
function stripToolCallResult(call: ToolCall): ToolCall {
  const sanitized: ToolCall = {
    id: call.id,
    name: call.name,
  }

  if (Object.prototype.hasOwnProperty.call(call, 'args')) {
    sanitized.args = call.args
  }

  return sanitized
}

function useIaContexto(): IaContexto {
  const location = useLocation()
  return useMemo(() => {
    const path = location.pathname
    const setorMatch = path.match(/^\/setores\/(\d+)/)
    const colabMatch = path.match(/^\/colaboradores\/(\d+)/)
    const setor_id = setorMatch ? Number(setorMatch[1]) : undefined
    const colaborador_id = colabMatch ? Number(colabMatch[1]) : undefined

    let pagina: IaContexto['pagina'] = 'outro'
    if (path === '/') pagina = 'dashboard'
    else if (path === '/setores') pagina = 'setor_lista'
    else if (setorMatch && path.endsWith('/escala')) pagina = 'escala'
    else if (setorMatch) pagina = 'setor_detalhe'
    else if (path === '/escalas') pagina = 'escalas_hub'
    else if (path === '/colaboradores') pagina = 'colaborador_lista'
    else if (colabMatch) pagina = 'colaborador_detalhe'
    else if (path === '/tipos-contrato') pagina = 'contratos'
    else if (path === '/empresa') pagina = 'empresa'
    else if (path === '/feriados') pagina = 'feriados'
    else if (path === '/configuracoes') pagina = 'configuracoes'
    else if (path === '/regras') pagina = 'regras'

    return { rota: path, pagina, setor_id, colaborador_id }
  }, [location.pathname])
}

export function IaChatView() {
  const {
    mensagens, carregando, conversa_ativa_id, adicionarMensagem,
    texto_parcial, tool_calls_parciais, tools_em_andamento,
    iniciarStream, processarStreamEvent, finalizarStream, cancelarStream,
  } = useIaStore()
  const [texto, setTexto] = useState('')
  const [configurado, setConfigurado] = useState<boolean | null>(null)
  const [modeloAtivo, setModeloAtivo] = useState<string | null>(null)
  const msgEndRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  const contexto = useIaContexto()

  const refreshConfig = () => {
    window.electron.ipcRenderer.invoke('ia.configuracao.obter').then((config: any) => {
      if (!config) {
        setConfigurado(false)
        setModeloAtivo(null)
        return
      }
      const temApiKey = !!config.api_key
      const providerConfigs = config.provider_configs ?? {}
      const temTokenEmAlgumProvider = Object.values(providerConfigs).some(
        (pc: any) => pc?.token?.trim()
      )
      setConfigurado(temApiKey || temTokenEmAlgumProvider)
      setModeloAtivo(config.modelo || null)
    })
  }

  useEffect(() => { refreshConfig() }, [conversa_ativa_id])

  useEffect(() => {
    window.addEventListener('ia-config-changed', refreshConfig)
    return () => window.removeEventListener('ia-config-changed', refreshConfig)
  }, [])

  // Stream event listener
  const processarStreamEventStable = useCallback(
    (event: IaStreamEvent) => processarStreamEvent(event),
    [processarStreamEvent]
  )

  useEffect(() => {
    const handler = (...args: unknown[]) => {
      const event = args[0] as IaStreamEvent
      if (event) processarStreamEventStable(event)
    }
    window.electron.ipcRenderer.on('ia:stream', handler)
    return () => window.electron.ipcRenderer.removeAllListeners('ia:stream')
  }, [processarStreamEventStable])

  const scrollAreaRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // Scroll only the chat viewport, never ancestor containers (main/page).
    const viewport = scrollAreaRef.current?.querySelector('[data-radix-scroll-area-viewport]')
    if (viewport) {
      viewport.scrollTo({ top: viewport.scrollHeight, behavior: 'smooth' })
    }
  }, [mensagens, carregando, texto_parcial])

  const enviar = async () => {
    if (!texto.trim() || carregando || !conversa_ativa_id) return

    const now = new Date().toISOString()
    const msg: IaMensagem = {
      id: crypto.randomUUID(),
      timestamp: now,
      papel: 'usuario',
      conteudo: texto,
    }
    await adicionarMensagem(msg)
    setTexto('')

    const streamId = crypto.randomUUID()
    iniciarStream(streamId)

    try {
      const resp = await window.electron.ipcRenderer.invoke('ia.chat.enviar', {
        mensagem: msg.conteudo,
        historico: mensagens,
        contexto,
        stream_id: streamId,
      })
      const toolCallsAoVivo = Array.isArray(resp?.acoes) ? (resp.acoes as ToolCall[]) : []
      const timestamp = new Date().toISOString()
      const mensagemId = crypto.randomUUID()

      const mensagemAssistente: IaMensagem = {
        id: mensagemId,
        timestamp,
        papel: 'assistente',
        conteudo: resp.resposta,
        tool_calls: toolCallsAoVivo.length > 0 ? toolCallsAoVivo : undefined,
      }

      const mensagemPersistida: IaMensagem = {
        ...mensagemAssistente,
        // Keep args for debugging/history context, drop result to keep DB rows compact.
        tool_calls: toolCallsAoVivo.length > 0
          ? toolCallsAoVivo.map(stripToolCallResult)
          : undefined,
      }

      await adicionarMensagem(mensagemAssistente, { mensagemPersistida })
      finalizarStream()
    } catch (err: any) {
      await adicionarMensagem({
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        papel: 'assistente',
        conteudo: `Erro: ${err.message}`,
      })
      cancelarStream()
    }
  }

  if (configurado === false) {
    return (
      <div className="flex flex-col items-center justify-center flex-1 gap-4 text-center p-6">
        <Bot className="size-12 opacity-20 text-muted-foreground" />
        <div className="space-y-1">
          <p className="text-sm font-medium">Assistente não configurado</p>
          <p className="text-xs text-muted-foreground max-w-[220px] leading-relaxed">
            Configure um provedor de IA (Gemini ou OpenRouter) para usar o assistente.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => navigate('/configuracoes')}>
          <Settings className="mr-1.5 size-3.5" />
          Abrir configurações
        </Button>
      </div>
    )
  }

  const toolsEmAndamentoEntries = Object.entries(tools_em_andamento)
  const hasStreamingContent = texto_parcial.length > 0 || toolsEmAndamentoEntries.length > 0 || tool_calls_parciais.length > 0

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <ScrollArea ref={scrollAreaRef} className="min-h-0 flex-1">
        <div className="flex min-w-0 max-w-full flex-col gap-3 p-4">
          {mensagens.length === 0 && (
            <div className="flex flex-col items-center justify-center text-center gap-3 text-muted-foreground py-16">
              <Bot className="size-12 opacity-20" />
              <div>
                <p className="text-sm font-medium">Olá!</p>
                <p className="text-xs mt-1 max-w-[240px] leading-relaxed">
                  Posso gerar escalas, consultar dados, verificar conflitos e muito mais.
                </p>
              </div>
            </div>
          )}

          {mensagens
            .filter((m) => m.papel !== 'tool_result')
            .map((m) => (
              <div key={m.id} className="min-w-0 max-w-full">
                <IaMensagemBubble msg={m} />
                {m.papel === 'assistente' && m.tool_calls && m.tool_calls.length > 0 && (
                  <div className="mt-2 min-w-0 max-w-full">
                    <IaToolCallsCollapsible toolCalls={m.tool_calls} />
                  </div>
                )}
              </div>
            ))}

          {carregando && (
            <div className="min-w-0 max-w-full space-y-2">
              {/* Tools em andamento — pills animadas */}
              {toolsEmAndamentoEntries.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {toolsEmAndamentoEntries.map(([id, info]) => (
                    <Badge key={id} variant="secondary" className="gap-1.5 text-xs animate-pulse">
                      <Loader2 className="size-3 animate-spin" />
                      {info.tool_name}
                    </Badge>
                  ))}
                </div>
              )}

              {/* Tool calls já concluídas nesse stream */}
              {tool_calls_parciais.length > 0 && (
                <div className="min-w-0 max-w-full">
                  <IaToolCallsCollapsible toolCalls={tool_calls_parciais} />
                </div>
              )}

              {/* Texto parcial — bubble com cursor pulsante */}
              {texto_parcial.length > 0 && (
                <div className="px-3 py-2 rounded-2xl rounded-bl-sm bg-muted border text-sm max-w-[85%]">
                  <div className="prose prose-sm dark:prose-invert max-w-none
                    prose-p:my-1 prose-ul:my-1 prose-ol:my-1">
                    <ReactMarkdown>{texto_parcial}</ReactMarkdown>
                  </div>
                  <span className="inline-block w-1.5 h-4 ml-0.5 bg-foreground/60 animate-pulse rounded-sm align-text-bottom" />
                </div>
              )}

              {/* Fallback — bouncing dots quando nenhum indicador está ativo */}
              {!hasStreamingContent && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-2xl rounded-bl-sm bg-muted border text-muted-foreground text-sm max-w-[70%]">
                  <div className="flex gap-1">
                    <span className="size-1.5 rounded-full bg-current animate-bounce [animation-delay:0ms]" />
                    <span className="size-1.5 rounded-full bg-current animate-bounce [animation-delay:150ms]" />
                    <span className="size-1.5 rounded-full bg-current animate-bounce [animation-delay:300ms]" />
                  </div>
                  Pensando...
                </div>
              )}
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
        modelo={modeloAtivo}
      />
    </div>
  )
}
