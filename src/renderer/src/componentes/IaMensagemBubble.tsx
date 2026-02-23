import ReactMarkdown from 'react-markdown'
import { Bot, User, Settings2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { IaMensagem } from '@shared/index'

interface Props {
  msg: IaMensagem
}

export function IaMensagemBubble({ msg }: Props) {
  return (
    <div
      className={cn(
        'flex flex-col gap-0.5 text-sm',
        msg.papel === 'usuario' ? 'items-end' : 'items-start',
      )}
    >
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
