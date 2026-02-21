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
          'px-3 py-2 rounded-2xl max-w-[88%] break-words whitespace-pre-wrap leading-relaxed',
          msg.papel === 'usuario'
            ? 'bg-primary text-primary-foreground rounded-br-sm'
            : msg.papel === 'tool_result'
              ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/20 rounded-bl-sm text-xs font-mono'
              : 'bg-muted text-foreground border rounded-bl-sm',
        )}
      >
        {msg.conteudo}
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
