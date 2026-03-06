import { X, FileText } from 'lucide-react'
import type { IaAnexo } from '@shared/index'

interface Props {
  anexos: IaAnexo[]
  onRemover: (id: string) => void
}

function formatSize(bytes: number): string {
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${bytes} B`
}

export function IaAnexoPreviewStrip({ anexos, onRemover }: Props) {
  if (anexos.length === 0) return null

  return (
    <div className="flex gap-2 px-2 pt-2 flex-wrap">
      {anexos.map((a) => (
        <div
          key={a.id}
          className="group relative flex items-center gap-1.5 rounded-lg border bg-background px-2 py-1.5"
        >
          {a.tipo === 'image' && a.preview_url ? (
            <img
              src={a.preview_url}
              alt={a.nome}
              className="size-10 rounded object-cover"
            />
          ) : (
            <div className="flex size-10 items-center justify-center rounded bg-muted">
              <FileText className="size-5 text-muted-foreground" />
            </div>
          )}
          <div className="flex flex-col min-w-0 max-w-[100px]">
            <span className="text-xs font-medium truncate">{a.nome}</span>
            <span className="text-[9px] text-muted-foreground">{formatSize(a.tamanho_bytes)}</span>
          </div>
          <button
            onClick={() => onRemover(a.id)}
            className="absolute -top-1.5 -right-1.5 hidden group-hover:flex size-4 items-center justify-center rounded-full bg-destructive text-destructive-foreground"
          >
            <X className="size-2.5" />
          </button>
        </div>
      ))}
    </div>
  )
}
