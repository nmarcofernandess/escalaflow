import type { ClipboardEventHandler } from 'react'
import { Paperclip } from 'lucide-react'
import {
  PromptInput,
  PromptInputBody,
  PromptInputButton,
  PromptInputSubmit,
  PromptInputTextarea,
} from '@/components/ai-elements/prompt-input'
import { Badge } from '@/components/ui/badge'

interface Props {
  value: string
  onChange: (value: string) => void
  onEnviar: () => void
  disabled: boolean
  modelLabel: string
  canAttach: boolean
  onAttach?: () => void
  speechControl?: React.ReactNode
  /** Permite enviar quando ha anexos mesmo sem texto digitado. */
  hasAttachments?: boolean
  onPaste?: ClipboardEventHandler<HTMLTextAreaElement>
}

export function FlowPromptInput({
  value,
  onChange,
  onEnviar,
  disabled,
  modelLabel,
  canAttach,
  onAttach,
  speechControl,
  hasAttachments = false,
  onPaste,
}: Props) {
  const canSend = !disabled && (value.trim().length > 0 || hasAttachments)

  return (
    <PromptInput
      onSubmit={() => {
        if (canSend) onEnviar()
      }}
      className="rounded-md border bg-muted/30"
    >
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <Badge variant={disabled ? 'secondary' : 'outline'}>{modelLabel}</Badge>
        <div className="flex items-center gap-1">
          {speechControl}
          {canAttach ? (
            <PromptInputButton type="button" aria-label="Anexar arquivo" onClick={onAttach}>
              <Paperclip className="size-4" />
            </PromptInputButton>
          ) : null}
        </div>
      </div>
      <PromptInputBody>
        <PromptInputTextarea
          data-testid="ia-chat-input"
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              if (canSend) onEnviar()
            }
          }}
          onPaste={onPaste}
          placeholder="Escreva sua mensagem..."
          aria-label="Mensagem"
        />
        <PromptInputSubmit data-testid="ia-chat-send" disabled={!canSend} aria-label="Enviar" />
      </PromptInputBody>
    </PromptInput>
  )
}
