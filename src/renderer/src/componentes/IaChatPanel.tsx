import { useEffect, useRef, useState } from 'react'
import { Trash2, Send, Bot, User, Settings2, BrainCircuit } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { useIaStore } from '@/store/iaStore'
import { cn } from '@/lib/utils'
import type { IaMensagem } from '@shared/index'

export function IaChatPanel() {
    const { aberto, historico, adicionarMensagem, limparHistorico, carregando, setCarregando } = useIaStore()
    const [mensagemTemp, setMensagemTemp] = useState('')
    const msgEndRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        msgEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, [historico, carregando])

    const checkConfig = async () => {
        const config = await window.electron.ipcRenderer.invoke('ia.configuracao.obter')
        return !!(config && config.ativo && config.api_key)
    }

    const enviar = async () => {
        if (!mensagemTemp.trim() || carregando) return

        const configOk = await checkConfig()
        const now = new Date().toISOString()

        if (!configOk) {
            adicionarMensagem({
                id: crypto.randomUUID(),
                timestamp: now,
                papel: 'assistente',
                conteudo: '⚠️ IA não está ativa ou API Key está faltando.\nAcesse Configurações > Inteligência Artificial.',
            })
            return
        }

        const msg: IaMensagem = {
            id: crypto.randomUUID(),
            timestamp: now,
            papel: 'usuario',
            conteudo: mensagemTemp,
        }
        adicionarMensagem(msg)
        setMensagemTemp('')
        setCarregando(true)

        try {
            const resp = await window.electron.ipcRenderer.invoke('ia.chat.enviar', {
                mensagem: msg.conteudo,
                historico,
            })
            adicionarMensagem({
                id: crypto.randomUUID(),
                timestamp: new Date().toISOString(),
                papel: 'assistente',
                conteudo: resp.resposta,
            })
            if (resp.acoes?.length > 0) {
                for (const acao of resp.acoes) {
                    adicionarMensagem({
                        id: crypto.randomUUID(),
                        timestamp: new Date().toISOString(),
                        papel: 'tool_result',
                        conteudo: `🔧 ${acao.name}\n${JSON.stringify(acao.result, null, 2)}`,
                    })
                }
            }
        } catch (err: any) {
            adicionarMensagem({
                id: crypto.randomUUID(),
                timestamp: new Date().toISOString(),
                papel: 'assistente',
                conteudo: `❌ Erro: ${err.message}`,
            })
        } finally {
            setCarregando(false)
        }
    }

    if (!aberto) return null

    return (
        <aside className="w-[380px] h-full shrink-0 overflow-hidden border-l bg-background flex flex-col">
            {/* Header do painel */}
            <div className="flex items-center gap-2 px-4 h-14 shrink-0 border-b">
                <BrainCircuit className="size-4 text-primary" />
                <span className="text-sm font-semibold flex-1">Assistente IA</span>
                <Button
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    onClick={limparHistorico}
                    title="Limpar conversa"
                >
                    <Trash2 className="size-3.5" />
                </Button>
            </div>

            {/* Mensagens */}
            <ScrollArea className="flex-1">
                <div className="flex flex-col gap-3 p-4">
                    {historico.length === 0 && (
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

                    {historico.map((m) => (
                        <div
                            key={m.id}
                            className={cn(
                                'flex flex-col gap-0.5 text-sm',
                                m.papel === 'usuario' ? 'items-end' : 'items-start',
                            )}
                        >
                            <div
                                className={cn(
                                    'px-3 py-2 rounded-2xl max-w-[88%] break-words whitespace-pre-wrap leading-relaxed',
                                    m.papel === 'usuario'
                                        ? 'bg-primary text-primary-foreground rounded-br-sm'
                                        : m.papel === 'tool_result'
                                            ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/20 rounded-bl-sm text-xs font-mono'
                                            : 'bg-muted text-foreground border rounded-bl-sm',
                                )}
                            >
                                {m.conteudo}
                            </div>
                            <span className="text-[10px] text-muted-foreground/60 px-1 flex items-center gap-1">
                                {m.papel === 'usuario' ? (
                                    <User className="size-2.5" />
                                ) : m.papel === 'assistente' ? (
                                    <Bot className="size-2.5" />
                                ) : (
                                    <Settings2 className="size-2.5" />
                                )}
                                {m.papel === 'tool_result' ? 'ferramenta' : m.papel}
                            </span>
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

            {/* Input */}
            <div className="p-3 shrink-0">
                <div className="relative">
                    <Textarea
                        placeholder="Escreva sua mensagem..."
                        className="min-h-[68px] pr-12 resize-none rounded-xl text-sm"
                        value={mensagemTemp}
                        onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setMensagemTemp(e.target.value)}
                        onKeyDown={(e: React.KeyboardEvent<HTMLTextAreaElement>) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault()
                                enviar()
                            }
                        }}
                    />
                    <Button
                        size="icon"
                        className="absolute bottom-2 right-2 rounded-full size-8"
                        disabled={carregando || !mensagemTemp.trim()}
                        onClick={enviar}
                    >
                        <Send className="size-4" />
                    </Button>
                </div>
                <p className="text-[10px] text-muted-foreground/50 mt-1 text-center">
                    Shift+Enter nova linha · Enter envia
                </p>
            </div>
        </aside>
    )
}
