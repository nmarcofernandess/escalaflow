import type { ClipboardEventHandler } from 'react'
import { Paperclip } from 'lucide-react'
import {
  PromptInput,
  PromptInputBody,
  PromptInputButton,
  PromptInputSubmit,
  PromptInputTextarea,
} from '@/components/ai-elements/prompt-input'

interface Props {
  value: string
  onChange: (value: string) => void
  onEnviar: () => void
  disabled: boolean
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
  canAttach,
  onAttach,
  speechControl,
  hasAttachments = false,
  onPaste,
}: Props) {
  const canSend = !disabled && (value.trim().length > 0 || hasAttachments)
  // Barra de acao discreta no topo (mic + anexo). So renderiza se houver algo a
  // mostrar — o modelo agora vive apenas no IaModelPill, abaixo do input.
  const hasActions = Boolean(speechControl) || canAttach

  return (
    <PromptInput
      onSubmit={() => {
        if (canSend) onEnviar()
      }}
      className="rounded-md border bg-muted/30"
    >
      {hasActions ? (
        <div className="flex items-center justify-end gap-1 border-b px-3 py-2">
          {speechControl}
          {canAttach ? (
            <PromptInputButton type="button" aria-label="Anexar arquivo" onClick={onAttach}>
              <Paperclip className="size-4" />
            </PromptInputButton>
          ) : null}
        </div>
      ) : null}
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
