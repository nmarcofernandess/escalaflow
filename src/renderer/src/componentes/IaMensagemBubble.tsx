import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { Bot, User, Settings2, Copy, Check, Pencil } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { IaMensagem } from '@shared/index'

interface Props {
  msg: IaMensagem
  onEdit?: (msg: IaMensagem) => void
  showActions?: boolean
}

export function IaMensagemBubble({ msg, onEdit, showActions = true }: Props) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(msg.conteudo)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div
      className={cn(
        'group flex flex-col gap-0.5 text-sm',
        msg.papel === 'usuario' ? 'items-end' : 'items-start',
      )}
    >
      <div className="relative">
        <div
          className={cn(
            'px-3 py-2 rounded-2xl max-w-[88%] leading-relaxed',
            msg.papel === 'usuario'
              ? 'bg-primary text-primary-foreground rounded-br-sm whitespace-pre-wrap break-words'
              : msg.papel === 'tool_result'
                ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/20 rounded-bl-sm text-xs font-mono whitespace-pre-wrap break-words'
                : 'bg-muted text-foreground border rounded-bl-sm',
          )}
        >
          {msg.papel === 'assistente' ? (
            <div className="prose prose-sm dark:prose-invert max-w-none
              prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5
              prose-headings:mt-3 prose-headings:mb-1 prose-headings:text-sm
              prose-table:text-xs prose-th:px-2 prose-td:px-2">
              <ReactMarkdown>{msg.conteudo}</ReactMarkdown>
            </div>
          ) : (
            msg.conteudo
          )}
        </div>

        {showActions && msg.conteudo && (
          <div className="absolute -bottom-3 right-2 opacity-0 group-hover:opacity-100 transition-opacity flex gap-0.5 z-10">
            <button
              onClick={handleCopy}
              className="size-6 rounded-md bg-background border shadow-sm flex items-center justify-center hover:bg-muted transition-colors"
              title="Copiar"
            >
              {copied ? <Check className="size-3 text-green-500" /> : <Copy className="size-3 text-muted-foreground" />}
            </button>
            {msg.papel === 'usuario' && onEdit && (
              <button
                onClick={() => onEdit(msg)}
                className="size-6 rounded-md bg-background border shadow-sm flex items-center justify-center hover:bg-muted transition-colors"
                title="Editar e reenviar"
              >
                <Pencil className="size-3 text-muted-foreground" />
              </button>
            )}
          </div>
        )}
      </div>
      <span className="text-[10px] text-muted-foreground/60 px-1 flex items-center gap-1">
        {msg.papel === 'usuario' ? (
          <User className="size-2.5" />
        ) : msg.papel === 'assistente' ? (
          <Bot className="size-2.5" />
        ) : (
          <Settings2 className="size-2.5" />
        )}
        {msg.papel === 'tool_result' ? 'ferramenta' : msg.papel}
      </span>
    </div>
  )
}
