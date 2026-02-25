import { useRef, useState } from 'react'
import { Plus, ArrowUp } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { IaModelPill } from './IaModelPill'
import { IaContextBadge } from './IaContextBadge'
import { IaAnexoPreviewStrip } from './IaAnexoPreviewStrip'
import type { IaProviderId, IaModelCatalogItem, IaAnexo } from '@shared/index'

const ACCEPTED_MIME_TYPES = new Set([
  'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp',
  'application/pdf', 'text/plain', 'text/markdown',
])
const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10 MB

const ipc = window.electron.ipcRenderer

interface Props {
  value: string
  onChange: (v: string) => void
  onEnviar: () => void
  disabled: boolean
  conversaId: string | null
  // Modelo
  provider: IaProviderId
  modelo: string
  modeloLabel: string
  modelOptions: IaModelCatalogItem[]
  onProviderChange: (p: IaProviderId) => Promise<void>
  onModeloChange: (m: string) => Promise<void>
  // Contexto
  tokensEstimados: number
  contextLength: number | null
  // Anexos
  supportsMultimodal: boolean
  anexos: IaAnexo[]
  onAnexosChange: (a: IaAnexo[]) => void
}

export function IaChatInput({
  value, onChange, onEnviar, disabled,
  conversaId,
  provider, modelo, modeloLabel, modelOptions, onProviderChange, onModeloChange,
  tokensEstimados, contextLength,
  supportsMultimodal, anexos, onAnexosChange,
}: Props) {
  const [isDragging, setIsDragging] = useState(false)
  const dragCounterRef = useRef(0)

  // Validate + read file from renderer, then persist to disk via IPC
  const processFile = async (file: File): Promise<IaAnexo | null> => {
    if (!ACCEPTED_MIME_TYPES.has(file.type)) {
      toast.error(`Formato não suportado: ${file.type || file.name.split('.').pop()}`, {
        description: 'Formatos aceitos: PNG, JPG, GIF, WebP, BMP, PDF, TXT, MD',
      })
      return null
    }
    if (file.size > MAX_FILE_SIZE) {
      toast.error(`Arquivo muito grande: ${file.name}`, {
        description: 'O tamanho máximo é 10 MB.',
      })
      return null
    }
    if (!conversaId) return null

    // Read as base64
    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onloadend = () => resolve((reader.result as string).split(',')[1])
      reader.onerror = () => reject(new Error('Falha ao ler arquivo'))
      reader.readAsDataURL(file)
    })

    const id = crypto.randomUUID()
    const tipo = file.type.startsWith('image/') ? 'image' as const : 'file' as const

    // Persist to disk
    const { file_path } = await ipc.invoke('ia.chat.salvarAnexo', {
      conversa_id: conversaId,
      id,
      data_base64: base64,
      mime_type: file.type,
      nome: file.name,
      tamanho_bytes: file.size,
    }) as { file_path: string }

    return {
      id, tipo, mime_type: file.type, nome: file.name,
      tamanho_bytes: file.size, file_path,
      preview_url: tipo === 'image' ? `data:${file.type};base64,${base64}` : undefined,
    }
  }

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounterRef.current++
    if (dragCounterRef.current === 1) setIsDragging(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounterRef.current--
    if (dragCounterRef.current === 0) setIsDragging(false)
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounterRef.current = 0
    setIsDragging(false)

    if (!supportsMultimodal) {
      toast.warning('Modelo atual não suporta anexos')
      return
    }

    const files = Array.from(e.dataTransfer.files)
    if (files.length === 0) return

    const novos: IaAnexo[] = []
    for (const file of files) {
      const anexo = await processFile(file)
      if (anexo) novos.push(anexo)
    }
    if (novos.length > 0) {
      onAnexosChange([...anexos, ...novos])
    }
  }

  const handleAttach = async () => {
    if (!conversaId) return
    try {
      const result = await ipc.invoke('ia.chat.lerArquivo', { conversa_id: conversaId }) as {
        id: string; data_base64: string; mime_type: string; nome: string; tamanho_bytes: number; file_path: string
      } | null
      if (!result) return
      const tipo = result.mime_type.startsWith('image/') ? 'image' as const : 'file' as const
      const previewUrl = tipo === 'image'
        ? `data:${result.mime_type};base64,${result.data_base64}`
        : undefined
      onAnexosChange([...anexos, {
        id: result.id, tipo, mime_type: result.mime_type, nome: result.nome,
        tamanho_bytes: result.tamanho_bytes, file_path: result.file_path,
        preview_url: previewUrl,
      }])
    } catch (err) {
      console.error('Erro ao ler arquivo:', err)
    }
  }

  const handlePaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    if (!supportsMultimodal) return
    const items = e.clipboardData?.items
    if (!items) return
    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) {
        e.preventDefault()
        const file = item.getAsFile()
        if (!file) continue
        const anexo = await processFile(
          new File([file], `clipboard-${Date.now()}.png`, { type: file.type })
        )
        if (anexo) onAnexosChange([...anexos, anexo])
        break
      }
    }
  }

  const canSend = !disabled && (value.trim().length > 0 || anexos.length > 0)

  return (
    <div
      className="p-3 shrink-0"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <div className={`rounded-xl border p-1 transition-colors ${isDragging ? 'border-primary bg-primary/5 ring-2 ring-primary/20' : 'bg-muted/30'}`}>
        {/* Preview strip de anexos */}
        <IaAnexoPreviewStrip
          anexos={anexos}
          onRemover={(id) => onAnexosChange(anexos.filter(a => a.id !== id))}
        />

        {/* Textarea sem borda */}
        <Textarea
          placeholder="Escreva sua mensagem..."
          className="border-0 bg-transparent shadow-none focus-visible:ring-0 resize-none min-h-[60px] text-sm"
          value={value}
          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => onChange(e.target.value)}
          onKeyDown={(e: React.KeyboardEvent<HTMLTextAreaElement>) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              if (canSend) onEnviar()
            }
          }}
          onPaste={handlePaste}
        />

        {/* Toolbar */}
        <div className="flex items-center gap-1.5 px-2 pb-1.5">
          {/* Esquerda: attach */}
          {supportsMultimodal && (
            <Button
              variant="ghost"
              size="icon"
              className="size-7 rounded-full"
              onClick={handleAttach}
              disabled={disabled || !conversaId}
            >
              <Plus className="size-4" />
            </Button>
          )}

          <div className="flex-1" />

          {/* Direita: context badge + modelo + send */}
          <IaContextBadge tokens={tokensEstimados} limit={contextLength} />

          <IaModelPill
            provider={provider}
            modelo={modelo}
            modeloLabel={modeloLabel}
            modelOptions={modelOptions}
            onProviderChange={onProviderChange}
            onModeloChange={onModeloChange}
          />

          <Button
            size="icon"
            className="size-8 rounded-full"
            disabled={!canSend}
            onClick={onEnviar}
          >
            <ArrowUp className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}
