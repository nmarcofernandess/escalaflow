import { Loader2, Check } from 'lucide-react'
import type { AutoSaveStatus } from '@/hooks/useAutoSave'

interface SaveIndicatorProps {
  status: AutoSaveStatus
  error?: string | null
}

export function SaveIndicator({ status, error }: SaveIndicatorProps) {
  if (status === 'idle') return null

  if (status === 'saving') {
    return <Loader2 className="size-3 animate-spin text-muted-foreground" />
  }

  if (status === 'saved') {
    return <Check className="size-3 text-success animate-in fade-in duration-200" />
  }

  if (status === 'error') {
    return (
      <span className="text-xs text-destructive">
        {error || 'Erro'}
      </span>
    )
  }

  return null
}
