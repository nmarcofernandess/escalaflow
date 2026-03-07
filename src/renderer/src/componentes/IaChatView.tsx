import { useEffect, useRef, useState, useMemo, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import { Bot, Settings, Loader2, FileText, ImageIcon, AlertCircle } from 'lucide-react'
import { useNavigate, useLocation } from 'react-router-dom'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { useIaStore } from '@/store/iaStore'
import { useIaModelConfig } from '@/hooks/useIaModelConfig'
import { IaMensagemBubble } from './IaMensagemBubble'
import { IaChatInput } from './IaChatInput'
import { IaToolCallsCollapsible } from './IaToolCallsCollapsible'
import { toolLabel, toolEstimatedSeconds } from '@/lib/tool-labels'
import type { IaMensagem, IaAnexo, IaContexto, ToolCall, IaStreamEvent } from '@shared/index'
import { toast } from 'sonner'

// Token estimation constants
const CHARS_PER_TOKEN = 4
const SYSTEM_PROMPT_TOKENS = 2500
const TOOL_CALL_TOKENS = 350

function estimarTokens(mensagens: IaMensagem[]): number {
  let total = SYSTEM_PROMPT_TOKENS
  for (const m of mensagens) {
    total += Math.ceil(m.conteudo.length / CHARS_PER_TOKEN)
    if (m.tool_calls) total += m.tool_calls.length * TOOL_CALL_TOKENS
  }
  return total
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
    else if (path === '/ia') pagina = 'ia'

    return { rota: path, pagina, setor_id, colaborador_id }
  }, [location.pathname])
}

// Tool progress pill with countdown
function ToolProgressPill({ info }: { info: { tool_name: string; estimated_seconds?: number; started_at: number } }) {
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    const interval = setInterval(() => setElapsed(Math.floor((Date.now() - info.started_at) / 1000)), 1000)
    return () => clearInterval(interval)
  }, [info.started_at])

  const label = toolLabel(info.tool_name)
  const est = toolEstimatedSeconds(info.tool_name, info.estimated_seconds)

  return (
    <Badge variant="secondary" className="gap-1.5 text-xs animate-pulse py-1">
      <Loader2 className="size-3 animate-spin" />
      <span>{label}</span>
      {est ? (
        <span className="text-muted-foreground">({elapsed}s / ~{est}s)</span>
      ) : elapsed > 0 ? (
        <span className="text-muted-foreground">({elapsed}s)</span>
      ) : null}
    </Badge>
  )
}

export function IaChatView() {
  const {
    mensagens, carregando, conversa_ativa_id, adicionarMensagem,
    texto_parcial, tool_calls_parciais, tools_em_andamento,
    stream_id_ativo,
    iniciarStream, processarStreamEvent, finalizarStream, cancelarStream,
    editarEReenviar,
  } = useIaStore()
  const [texto, setTexto] = useState('')
  const [anexos, setAnexos] = useState<IaAnexo[]>([])
  const msgEndRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  const contexto = useIaContexto()

  const modelConfig = useIaModelConfig()

  const tokensEstimados = useMemo(() => estimarTokens(mensagens), [mensagens])

  // Edit state
  const [editingMsgId, setEditingMsgId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')

  // Timeout banner
  const [lastEventAt, setLastEventAt] = useState(Date.now())
  const [showTimeoutBanner, setShowTimeoutBanner] = useState(false)

  // Safety: if carregando is stuck without an active stream, reset it.
  // This can happen if a stream event was lost during re-render.
  useEffect(() => {
    if (carregando && !stream_id_ativo) {
      cancelarStream()
    }
  }, [carregando, stream_id_ativo, cancelarStream])

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
    // .on() returns a disposer that removes only THIS handler (not all listeners)
    const dispose = window.electron.ipcRenderer.on('ia:stream', handler)
    return () => { dispose?.() }
  }, [processarStreamEventStable])

  // Reset lastEventAt on any stream activity
  useEffect(() => {
    setLastEventAt(Date.now())
    setShowTimeoutBanner(false)
  }, [texto_parcial, tools_em_andamento, tool_calls_parciais])

  // Timeout banner — 15s sem atividade
  useEffect(() => {
    if (!carregando) { setShowTimeoutBanner(false); return }
    const timer = setInterval(() => {
      if (Date.now() - lastEventAt > 15_000) setShowTimeoutBanner(true)
    }, 1000)
    return () => clearInterval(timer)
  }, [carregando, lastEventAt])

  const scrollAreaRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // Scroll only the chat viewport, never ancestor containers (main/page).
    const viewport = scrollAreaRef.current?.querySelector('[data-radix-scroll-area-viewport]')
    if (viewport) {
      viewport.scrollTo({ top: viewport.scrollHeight, behavior: 'smooth' })
    }
  }, [mensagens, carregando, texto_parcial])

  const inputDisabled = carregando || !conversa_ativa_id || modelConfig.isLoading || !modelConfig.canSendMessages
  const activeProviderLabel = modelConfig.providerOptions.find((option) => option.provider === modelConfig.provider)?.label || 'Provider ativo'
  const showAvailabilityCard = !modelConfig.isLoading && !modelConfig.canSendMessages && (!modelConfig.showUnconfiguredState || mensagens.length > 0)

  const isProviderAvailabilityError = (message?: string) => {
    const normalized = (message || '').toLowerCase()
    return normalized.includes('não configurad')
      || normalized.includes('nao configurad')
      || normalized.includes('token do openrouter')
      || normalized.includes('api key do gemini')
      || normalized.includes('modelo local')
      || normalized.includes('erro ao carregar modelo local')
      || normalized.includes('available vram')
      || normalized.includes('context size')
      || normalized.includes('memória insuficiente')
      || normalized.includes('memoria insuficiente')
      || normalized.includes('provider cloud')
  }

  const enviar = async (conteudoOverride?: string) => {
    const conteudo = conteudoOverride ?? texto
    if ((!conteudo.trim() && anexos.length === 0) || inputDisabled) return

    const now = new Date().toISOString()
    const msg: IaMensagem = {
      id: crypto.randomUUID(),
      timestamp: now,
      papel: 'usuario',
      conteudo,
      anexos: anexos.length > 0 ? anexos : undefined,
    }

    // Se e override (edit+reenviar), nao persiste de novo — ja foi feito pelo store
    if (!conteudoOverride) {
      await adicionarMensagem(msg)
    }

    const currentAnexos = conteudoOverride ? [] : [...anexos]
    if (!conteudoOverride) {
      setTexto('')
      setAnexos([])
    }

    const streamId = crypto.randomUUID()
    iniciarStream(streamId)

    try {
      const resp = await window.electron.ipcRenderer.invoke('ia.chat.enviar', {
        mensagem: conteudo,
        historico: conteudoOverride ? useIaStore.getState().mensagens.slice(0, -1) : mensagens,
        contexto,
        stream_id: streamId,
        conversa_id: conversa_ativa_id,
        anexos: currentAnexos,
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

      await adicionarMensagem(mensagemAssistente)
      finalizarStream()
    } catch (err: any) {
      if (isProviderAvailabilityError(err?.message)) {
        toast.error(err.message)
        cancelarStream()
        return
      }
      await adicionarMensagem({
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        papel: 'assistente',
        conteudo: `Erro: ${err.message}`,
      })
      cancelarStream()
    }
  }

  // Edit handlers
  const handleStartEdit = (msg: IaMensagem) => {
    if (carregando || !modelConfig.canSendMessages) return
    setEditingMsgId(msg.id)
    setEditText(msg.conteudo)
  }

  const handleConfirmEdit = async () => {
    if (!editingMsgId || !editText.trim() || carregando || !modelConfig.canSendMessages) return
    const novoConteudo = await editarEReenviar(editingMsgId, editText.trim())
    setEditingMsgId(null)
    setEditText('')
    if (novoConteudo) {
      await enviar(novoConteudo)
    }
  }

  const handleCancelEdit = () => {
    setEditingMsgId(null)
    setEditText('')
  }

  // Regenerate: find last user msg up to (and including) this msg, re-send it
  const handleRegenerate = async (msg: IaMensagem) => {
    if (carregando || !modelConfig.canSendMessages) return
    // For user msg: re-send that same msg. For assistant msg: find the user msg right before it.
    let userMsg: IaMensagem | undefined
    if (msg.papel === 'usuario') {
      userMsg = msg
    } else {
      const idx = mensagens.findIndex((m) => m.id === msg.id)
      for (let i = idx - 1; i >= 0; i--) {
        if (mensagens[i].papel === 'usuario') {
          userMsg = mensagens[i]
          break
        }
      }
    }
    if (!userMsg) return
    const novoConteudo = await editarEReenviar(userMsg.id, userMsg.conteudo)
    if (novoConteudo) {
      await enviar(novoConteudo)
    }
  }

  const toolsEmAndamentoEntries = Object.entries(tools_em_andamento)
  const hasStreamingContent = texto_parcial.length > 0 || toolsEmAndamentoEntries.length > 0 || tool_calls_parciais.length > 0

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <ScrollArea ref={scrollAreaRef} className="min-h-0 flex-1">
        <div className="flex min-w-0 max-w-full flex-col gap-4 p-4">
          {mensagens.length === 0 && modelConfig.showUnconfiguredState && (
            <div className="flex flex-col items-center justify-center text-center gap-4 text-muted-foreground py-16">
              <Bot className="size-12 opacity-20" />
              <div className="space-y-1">
                <p className="text-sm font-medium text-foreground">Nenhuma IA disponível</p>
                <p className="text-xs max-w-[260px] leading-relaxed">
                  Configure Gemini/OpenRouter ou baixe um modelo local para liberar o assistente.
                </p>
              </div>
              <Button size="sm" variant="outline" onClick={() => navigate('/configuracoes')}>
                <Settings className="mr-1.5 size-3.5" />
                Abrir configurações
              </Button>
            </div>
          )}

          {mensagens.length === 0 && !modelConfig.showUnconfiguredState && (
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
                {editingMsgId === m.id ? (
                  <div className="flex flex-col gap-2 w-full max-w-[88%] ml-auto">
                    <Textarea
                      value={editText}
                      onChange={e => setEditText(e.target.value)}
                      className="resize-none text-sm"
                      rows={3}
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault()
                          handleConfirmEdit()
                        }
                        if (e.key === 'Escape') handleCancelEdit()
                      }}
                    />
                    <div className="flex gap-1 justify-end">
                      <Button size="sm" variant="ghost" onClick={handleCancelEdit}>Cancelar</Button>
                      <Button size="sm" onClick={handleConfirmEdit} disabled={!editText.trim()}>Reenviar</Button>
                    </div>
                  </div>
                ) : (
                  <IaMensagemBubble
                    msg={m}
                    onEdit={m.papel === 'usuario' ? handleStartEdit : undefined}
                    onRegenerate={handleRegenerate}
                    showActions={!carregando && modelConfig.canSendMessages}
                  />
                )}
                {m.papel === 'usuario' && m.anexos && m.anexos.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1 justify-end">
                    {m.anexos.map(a => (
                      <Badge key={a.id} variant="secondary" className="text-xs gap-1">
                        {a.tipo === 'image' ? <ImageIcon className="size-2.5" /> : <FileText className="size-2.5" />}
                        {a.nome}
                      </Badge>
                    ))}
                  </div>
                )}
                {m.papel === 'assistente' && m.tool_calls && m.tool_calls.length > 0 && (
                  <div className="mt-2 min-w-0 max-w-full">
                    <IaToolCallsCollapsible toolCalls={m.tool_calls} />
                  </div>
                )}
              </div>
            ))}

          {carregando && (
            <div className="min-w-0 max-w-full space-y-2">
              {/* Tools em andamento — pills com countdown */}
              {toolsEmAndamentoEntries.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {toolsEmAndamentoEntries.map(([id, info]) => (
                    <ToolProgressPill key={id} info={info} />
                  ))}
                </div>
              )}

              {/* Tool calls já concluídas nesse stream */}
              {tool_calls_parciais.length > 0 && (
                <div className="min-w-0 max-w-full">
                  <IaToolCallsCollapsible toolCalls={tool_calls_parciais} />
                </div>
              )}

              {/* Texto parcial — mesma aparência do IaMensagemBubble + cursor pulsante */}
              {texto_parcial.length > 0 && (
                <div className="max-w-[88%] leading-relaxed text-sm">
                  <div className="prose prose-sm dark:prose-invert
                    prose-p:my-1.5 prose-ul:my-1.5 prose-ol:my-1.5 prose-li:my-0.5
                    prose-headings:mt-3 prose-headings:mb-1.5 prose-headings:text-sm
                    prose-table:text-xs prose-th:px-2 prose-td:px-2
                    prose-code:text-xs prose-pre:my-2 prose-pre:overflow-x-auto prose-pre:max-w-full">
                    <ReactMarkdown>{texto_parcial}</ReactMarkdown>
                  </div>
                  <span className="inline-block w-1.5 h-4 ml-0.5 bg-foreground/60 animate-pulse rounded-sm align-text-bottom" />
                </div>
              )}

              {/* Timeout banner */}
              {showTimeoutBanner && (
                <div className="text-xs text-muted-foreground text-center py-1 animate-pulse">
                  Ainda processando... A IA esta trabalhando na resposta.
                </div>
              )}

              {/* Fallback — bouncing dots quando nenhum indicador está ativo */}
              {!hasStreamingContent && !showTimeoutBanner && (
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

      {showAvailabilityCard && (
        <div className="px-3 pt-3">
          <Alert className="border-amber-200 bg-amber-50/60 text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-100 [&>svg]:text-amber-600 dark:[&>svg]:text-amber-400">
            <AlertCircle className="size-4" />
            <AlertDescription className="flex items-center justify-between gap-3 text-xs leading-relaxed">
              <span>
                {modelConfig.showUnconfiguredState
                  ? 'Nenhum provider está disponível no momento.'
                  : `${activeProviderLabel} indisponível: ${modelConfig.activeProviderReason || 'configure o provider ou troque pelo seletor.'}`}
              </span>
              {modelConfig.showUnconfiguredState ? (
                <Button size="sm" variant="outline" onClick={() => navigate('/configuracoes')}>
                  Configurar
                </Button>
              ) : null}
            </AlertDescription>
          </Alert>
        </div>
      )}

      <IaChatInput
        value={texto}
        onChange={setTexto}
        onEnviar={enviar}
        disabled={inputDisabled}
        conversaId={conversa_ativa_id}
        provider={modelConfig.provider}
        providerOptions={modelConfig.providerOptions}
        modelo={modelConfig.modelo}
        modeloLabel={modelConfig.modeloLabel}
        modelOptions={modelConfig.modelOptions}
        modelSelectDisabled={modelConfig.modelSelectDisabled}
        onProviderChange={modelConfig.setProvider}
        onModeloChange={modelConfig.setModelo}
        tokensEstimados={tokensEstimados}
        contextLength={modelConfig.contextLength}
        supportsMultimodal={modelConfig.supportsMultimodal}
        anexos={anexos}
        onAnexosChange={setAnexos}
      />
    </div>
  )
}
