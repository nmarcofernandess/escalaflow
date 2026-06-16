import { useState } from 'react'
import { Check, Copy, Pencil, RefreshCw } from 'lucide-react'
import {
  Message,
  MessageActions,
  MessageContent,
  MessageResponse,
} from '@/components/ai-elements/message'
import { Button } from '@/components/ui/button'
import { mapStoredMessageToUiMessage } from '@/lib/ai-elements-adapters'
import { cn } from '@/lib/utils'
import type { IaContextMeta, IaMensagem } from '@shared/index'

interface Props {
  msg: IaMensagem
  onEdit?: (msg: IaMensagem) => void
  onRegenerate?: (msg: IaMensagem) => void
  showActions?: boolean
  turnMeta?: IaContextMeta
}

export function FlowMessage({ msg, onEdit, onRegenerate, showActions = true, turnMeta }: Props) {
  const [copied, setCopied] = useState(false)
  const isUser = msg.papel === 'usuario'
  const isTool = msg.papel === 'tool_result'
  const uiMessage = mapStoredMessageToUiMessage(msg, turnMeta)

  async function handleCopy() {
    await navigator.clipboard.writeText(msg.conteudo)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Message
      from={isUser ? 'user' : 'assistant'}
      data-testid={isUser ? 'ia-user-message' : 'ia-assistant-message'}
      data-turn-meta={turnMeta ? JSON.stringify(turnMeta) : undefined}
      className={cn(isTool && 'font-mono text-xs')}
    >
      <MessageContent>
        {isUser || isTool ? (
          <div className="whitespace-pre-wrap break-words">{msg.conteudo}</div>
        ) : (
          uiMessage.parts.map((part, index) => {
            if (part.type === 'text') {
              return <MessageResponse key={index}>{part.text}</MessageResponse>
            }
            return null
          })
        )}
      </MessageContent>

      {showActions && msg.conteudo ? (
        <MessageActions>
          <Button variant="ghost" size="icon" className="size-6" onClick={handleCopy} title="Copiar">
            {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          </Button>
          {isUser && onEdit ? (
            <Button variant="ghost" size="icon" className="size-6" onClick={() => onEdit(msg)} title="Editar e reenviar">
              <Pencil className="size-3.5" />
            </Button>
          ) : null}
          {onRegenerate && !isTool ? (
            <Button variant="ghost" size="icon" className="size-6" onClick={() => onRegenerate(msg)} title="Regenerar">
              <RefreshCw className="size-3.5" />
            </Button>
          ) : null}
        </MessageActions>
      ) : null}
    </Message>
  )
}
