import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../components/ui/alert-dialog'
import { Button } from '../components/ui/button'
import { ScrollArea } from '../components/ui/scroll-area'
import { History, RotateCcw, Trash2, Clock, Bot, Hand, Power } from 'lucide-react'
import { toast } from 'sonner'
import type { SnapshotInfo } from '../../../shared/types'

interface TimeMachineModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const TRIGGER_LABELS: Record<string, { label: string; icon: typeof Clock }> = {
  auto_close: { label: 'ao fechar', icon: Power },
  auto_intervalo: { label: 'automatico', icon: Clock },
  manual: { label: 'manual', icon: Hand },
  ia: { label: 'via IA', icon: Bot },
  auto_pre_restore: { label: 'pre-restauracao', icon: RotateCcw },
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const isToday = d.toDateString() === now.toDateString()
  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  const isYesterday = d.toDateString() === yesterday.toDateString()

  const time = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  if (isToday) return `Hoje, ${time}`
  if (isYesterday) return `Ontem, ${time}`
  return `${d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}, ${time}`
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

export function TimeMachineModal({ open, onOpenChange }: TimeMachineModalProps) {
  const [snapshots, setSnapshots] = useState<SnapshotInfo[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [confirmRestore, setConfirmRestore] = useState(false)
  const [restoring, setRestoring] = useState(false)

  async function loadSnapshots() {
    try {
      const list = await window.electron.ipcRenderer.invoke('backup.snapshots.listar') as SnapshotInfo[]
      setSnapshots(list)
    } catch (err) {
      console.error('Erro ao listar snapshots:', err)
    }
  }

  async function handleRestore() {
    if (!selected) return
    setRestoring(true)
    try {
      const result = await window.electron.ipcRenderer.invoke('backup.snapshots.restaurar', { filename: selected }) as { tabelas: number; registros: number }
      toast.success('Restaurado com sucesso!', {
        description: `${result.tabelas} tabelas, ${result.registros} registros. Reinicie o sistema para aplicar.`,
        duration: 10000,
      })
      setConfirmRestore(false)
      onOpenChange(false)
    } catch (err) {
      toast.error('Erro ao restaurar', { description: (err as Error).message })
    } finally {
      setRestoring(false)
    }
  }

  async function handleDelete(filename: string) {
    try {
      await window.electron.ipcRenderer.invoke('backup.snapshots.deletar', { filename })
      setSnapshots((prev) => prev.filter((s) => s.filename !== filename))
      if (selected === filename) setSelected(null)
      toast.success('Snapshot removido')
    } catch (err) {
      toast.error('Erro ao remover', { description: (err as Error).message })
    }
  }

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(v) => {
          onOpenChange(v)
          if (v) {
            setLoading(true)
            loadSnapshots().finally(() => setLoading(false))
            setSelected(null)
          }
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <History className="size-5" />
              Maquina do Tempo
            </DialogTitle>
            <DialogDescription>
              Selecione um ponto no tempo para restaurar o sistema.
            </DialogDescription>
          </DialogHeader>

          <ScrollArea className="h-[400px] pr-3">
            {loading ? (
              <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
                Carregando snapshots...
              </div>
            ) : snapshots.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
                <History className="size-8 opacity-30" />
                <p>Nenhum snapshot encontrado.</p>
                <p>O primeiro backup sera criado ao fechar o sistema.</p>
              </div>
            ) : (
              <div className="space-y-1">
                {snapshots.map((snap) => {
                  const trigger = TRIGGER_LABELS[snap.meta.trigger] ?? TRIGGER_LABELS.manual
                  const Icon = trigger.icon
                  const isSelected = selected === snap.filename

                  return (
                    <div
                      key={snap.filename}
                      role="button"
                      tabIndex={0}
                      className={`flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
                        isSelected
                          ? 'bg-primary/10 ring-1 ring-primary/30'
                          : 'hover:bg-muted/50'
                      }`}
                      onClick={() => setSelected(snap.filename)}
                      onKeyDown={(e) => { if (e.key === 'Enter') setSelected(snap.filename) }}
                    >
                      <Icon className="size-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <div className="font-medium">{formatDate(snap.meta.criado_em)}</div>
                        <div className="text-xs text-muted-foreground">
                          {trigger.label} &middot; {formatSize(snap.tamanho_bytes)} &middot; v{snap.meta.versao}
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7 shrink-0 text-muted-foreground hover:text-destructive"
                        onClick={(e) => {
                          e.stopPropagation()
                          handleDelete(snap.filename)
                        }}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  )
                })}
              </div>
            )}
          </ScrollArea>

          {selected && (
            <div className="flex justify-end border-t pt-2">
              <Button onClick={() => setConfirmRestore(true)}>
                <RotateCcw className="mr-1.5 size-3.5" />
                Restaurar este ponto
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmRestore} onOpenChange={setConfirmRestore}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restaurar sistema?</AlertDialogTitle>
            <AlertDialogDescription>
              Restaurar substitui TODOS os dados atuais. O sistema criara um backup automatico do estado atual antes de restaurar.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={restoring}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleRestore} disabled={restoring}>
              {restoring ? 'Restaurando...' : 'Confirmar restauracao'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
