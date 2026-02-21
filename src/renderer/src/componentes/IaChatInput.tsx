import { Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

interface Props {
  value: string
  onChange: (v: string) => void
  onEnviar: () => void
  disabled: boolean
}

export function IaChatInput({ value, onChange, onEnviar, disabled }: Props) {
  return (
    <div className="p-3 shrink-0">
      <div className="relative">
        <Textarea
          placeholder="Escreva sua mensagem..."
          className="min-h-[68px] pr-12 resize-none rounded-xl text-sm"
          value={value}
          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => onChange(e.target.value)}
          onKeyDown={(e: React.KeyboardEvent<HTMLTextAreaElement>) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              onEnviar()
            }
          }}
        />
        <Button
          size="icon"
          className="absolute bottom-2 right-2 rounded-full size-8"
          disabled={disabled || !value.trim()}
          onClick={onEnviar}
        >
          <Send className="size-4" />
        </Button>
      </div>
      <p className="text-[10px] text-muted-foreground/50 mt-1 text-center">
        Shift+Enter nova linha · Enter envia
      </p>
    </div>
  )
}
