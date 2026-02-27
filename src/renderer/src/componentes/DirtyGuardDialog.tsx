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

/**
 * Dialog de confirmacao para dirty state.
 * Recebe o Blocker do useDirtyGuard e controla exibicao automaticamente.
 */
export function DirtyGuardDialog({ blocker }: { blocker: Blocker }) {
  if (blocker.state !== 'blocked') return null

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
          <AlertDialogCancel onClick={() => blocker.reset?.()}>
            Continuar editando
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={() => blocker.proceed?.()}
            className={buttonVariants({ variant: 'destructive' })}
          >
            Sair sem salvar
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
