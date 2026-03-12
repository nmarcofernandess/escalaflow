import { useState } from 'react'
import type { Blocker } from 'react-router-dom'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { buttonVariants } from '@/components/ui/button'

type DirtyGuardDialogProps = {
  blocker: Blocker
  onSaveAndExit?: () => Promise<void> | void
}

/**
 * Dialog de confirmacao para dirty state.
 * Recebe o Blocker do useDirtyGuard e controla exibicao automaticamente.
 */
export function DirtyGuardDialog({ blocker, onSaveAndExit }: DirtyGuardDialogProps) {
  const [saving, setSaving] = useState(false)
  if (blocker.state !== 'blocked') return null

  const handleSaveAndExit = async () => {
    if (!onSaveAndExit) return
    setSaving(true)
    try {
      await onSaveAndExit()
      blocker.proceed?.()
    } finally {
      setSaving(false)
    }
  }

  return (
    <AlertDialog open>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Alteracoes nao salvas</AlertDialogTitle>
          <AlertDialogDescription>
            Voce tem alteracoes que nao foram salvas. Deseja sair mesmo assim?
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => blocker.reset?.()} disabled={saving}>
            Cancelar
          </AlertDialogCancel>
          {onSaveAndExit && (
            <AlertDialogAction onClick={handleSaveAndExit} disabled={saving}>
              {saving ? 'Salvando...' : 'Salvar e sair'}
            </AlertDialogAction>
          )}
          <AlertDialogAction
            onClick={() => blocker.proceed?.()}
            className={buttonVariants({ variant: 'destructive' })}
            disabled={saving}
          >
            Sair sem salvar
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
