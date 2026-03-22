import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { Copy, Check, Pencil, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { IaMensagem, IaContextMeta } from '@shared/index'

interface Props {
  msg: IaMensagem
  onEdit?: (msg: IaMensagem) => void
  onRegenerate?: (msg: IaMensagem) => void
  showActions?: boolean
  turnMeta?: IaContextMeta
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleDateString('pt-BR', { day: 'numeric', month: 'short', year: 'numeric' })
  } catch {
    return ''
  }
}

export function IaMensagemBubble({ msg, onEdit, onRegenerate, showActions = true, turnMeta }: Props) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(msg.conteudo)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const isUser = msg.papel === 'usuario'
  const isTool = msg.papel === 'tool_result'

  return (
    <div
      className={cn(
        'group flex flex-col text-sm',
        isUser ? 'items-end' : 'items-start',
      )}
    >
      {/* Conteudo */}
      {isUser ? (
        <div className="px-3.5 py-2.5 rounded-2xl rounded-br-sm max-w-[88%] leading-relaxed bg-primary text-primary-foreground whitespace-pre-wrap break-words">
          {msg.conteudo}
        </div>
      ) : isTool ? (
        <div className="px-3 py-2 rounded-2xl rounded-bl-sm max-w-[88%] leading-relaxed bg-warning/10 text-warning border border-warning/20 text-xs font-mono whitespace-pre-wrap break-words">
          {msg.conteudo}
        </div>
      ) : (
        <div
          data-testid="ia-assistant-message"
          data-turn-meta={turnMeta ? JSON.stringify(turnMeta) : undefined}
          className="max-w-[88%] leading-relaxed prose prose-sm dark:prose-invert
          prose-p:my-1.5 prose-ul:my-1.5 prose-ol:my-1.5 prose-li:my-0.5
          prose-headings:mt-3 prose-headings:mb-1.5 prose-headings:text-sm
          prose-table:text-xs prose-th:px-2 prose-td:px-2
          prose-code:text-xs prose-pre:my-2 prose-pre:overflow-x-auto prose-pre:max-w-full"
        >
          <ReactMarkdown>{msg.conteudo}</ReactMarkdown>
        </div>
      )}

      {/* Row abaixo — tudo no hover */}
      {showActions && msg.conteudo && (
        <div className={cn(
          'flex items-center gap-1.5 px-1 mt-1 opacity-0 group-hover:opacity-100 transition-opacity',
        )}>
          {/* Timestamp primeiro, so no user */}
          {isUser && (
            <span className="text-xs text-muted-foreground/50 select-none">
              {formatDate(msg.timestamp)}
            </span>
          )}

          <Button variant="ghost" size="icon" className="size-6" onClick={handleCopy} title="Copiar">
            {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5 text-muted-foreground/50" />}
          </Button>

          {isUser && onEdit && (
            <Button variant="ghost" size="icon" className="size-6" onClick={() => onEdit(msg)} title="Editar e reenviar">
              <Pencil className="size-3.5 text-muted-foreground/50" />
            </Button>
          )}

          {onRegenerate && !isTool && (
            <Button variant="ghost" size="icon" className="size-6" onClick={() => onRegenerate(msg)} title="Regenerar">
              <RefreshCw className="size-3.5 text-muted-foreground/50" />
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
