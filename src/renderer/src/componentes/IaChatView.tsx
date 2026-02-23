import { useEffect, useRef, useState, useMemo } from 'react'
import { Bot, Settings } from 'lucide-react'
import { useNavigate, useLocation } from 'react-router-dom'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Button } from '@/components/ui/button'
import { useIaStore } from '@/store/iaStore'
import { IaMensagemBubble } from './IaMensagemBubble'
import { IaChatInput } from './IaChatInput'
import { IaToolCallsCollapsible } from './IaToolCallsCollapsible'
import type { IaMensagem, IaContexto, ToolCall } from '@shared/index'

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
  const { mensagens, carregando, setCarregando, conversa_ativa_id, adicionarMensagem } =
    useIaStore()
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

  const scrollAreaRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // Scroll only the chat viewport, never ancestor containers (main/page).
    const viewport = scrollAreaRef.current?.querySelector('[data-radix-scroll-area-viewport]')
    if (viewport) {
      viewport.scrollTo({ top: viewport.scrollHeight, behavior: 'smooth' })
    }
  }, [mensagens, carregando])

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
    setCarregando(true)

    try {
      const resp = await window.electron.ipcRenderer.invoke('ia.chat.enviar', {
        mensagem: msg.conteudo,
        historico: mensagens,
        contexto,
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

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <ScrollArea ref={scrollAreaRef} className="min-h-0 flex-1">
        <div className="flex min-w-0 max-w-full flex-col gap-3 p-4">
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
        modelo={modeloAtivo}
      />
    </div>
  )
}
