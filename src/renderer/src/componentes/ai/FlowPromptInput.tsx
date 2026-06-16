import type { ClipboardEventHandler, ReactNode } from 'react'
import { Paperclip } from 'lucide-react'
import {
  PromptInput,
  PromptInputBody,
  PromptInputButton,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from '@/components/ai-elements/prompt-input'

interface Props {
  value: string
  onChange: (value: string) => void
  onEnviar: () => void
  disabled: boolean
  canAttach: boolean
  onAttach?: () => void
  speechControl?: ReactNode
  /** Seletor de modelo (renderizado na barra inferior, lado direito). */
  modelControl?: ReactNode
  /** Indicador de contexto (renderizado na barra inferior, antes do enviar). */
  contextControl?: ReactNode
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
  modelControl,
  contextControl,
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
      {/* Textarea limpo no topo: largura cheia, placeholder a esquerda. */}
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
      </PromptInputBody>

      {/* Barra unica de controles: mic+anexo a esquerda, modelo+contexto+enviar a direita. */}
      <PromptInputFooter>
        <PromptInputTools>
          {speechControl}
          {canAttach ? (
            <PromptInputButton type="button" aria-label="Anexar arquivo" onClick={onAttach}>
              <Paperclip className="size-4" />
            </PromptInputButton>
          ) : null}
        </PromptInputTools>
        <PromptInputTools>
          {modelControl}
          {contextControl}
          <PromptInputSubmit data-testid="ia-chat-send" disabled={!canSend} aria-label="Enviar" />
        </PromptInputTools>
      </PromptInputFooter>
    </PromptInput>
  )
}
