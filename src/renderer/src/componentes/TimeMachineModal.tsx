import { useState, useEffect } from 'react'
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
import { History, RotateCcw, Trash2, Clock, Bot, Hand, Power, Save, Loader2, Eye } from 'lucide-react'
import { toast } from 'sonner'
import type { SnapshotInfo } from '../../../shared/types'
import { useRestorePreviewStore } from '@/store/restorePreviewStore'

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
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false)
  const [confirmRestore, setConfirmRestore] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [visualizing, setVisualizing] = useState(false)
  const [creatingFirst, setCreatingFirst] = useState(false)
  const entrarPreview = useRestorePreviewStore((s) => s.entrarPreview)

  async function loadSnapshots() {
    const LISTAR_TIMEOUT_MS = 6000
    try {
      const list = await Promise.race([
        window.electron.ipcRenderer.invoke('backup.snapshots.listar') as Promise<SnapshotInfo[]>,
        new Promise<SnapshotInfo[]>((_, reject) =>
          setTimeout(() => reject(new Error('timeout')), LISTAR_TIMEOUT_MS),
        ),
      ])
      setSnapshots(list ?? [])
    } catch (err) {
      console.error('Erro ao listar snapshots:', err)
      setSnapshots([])
      if ((err as Error).message === 'timeout') {
        toast.error('Listagem demorou demais', { description: 'Feche e abra a Maquina do Tempo de novo.' })
      }
    } finally {
      setHasLoadedOnce(true)
    }
  }

  // Disparar carga ao abrir o modal (onOpenChange nem sempre e chamado quando open vira true pelo estado)
  useEffect(() => {
    if (open) {
      setSelected(null)
      setHasLoadedOnce(false)
      setLoading(true)
      loadSnapshots().finally(() => setLoading(false))
    }
  }, [open])

  async function handleRestore() {
    if (!selected) return
    setRestoring(true)
    try {
      const result = await window.electron.ipcRenderer.invoke('backup.snapshots.restaurar', { filename: selected }) as { tabelas: number; registros: number; preRestoreFilename: string | null }
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

  async function handleVisualizar() {
    if (!selected) return
    const snap = snapshots.find((s) => s.filename === selected)
    if (!snap) return
    setVisualizing(true)
    try {
      const result = await window.electron.ipcRenderer.invoke('backup.snapshots.restaurar', { filename: selected }) as { tabelas: number; registros: number; preRestoreFilename: string | null }
      const label = formatDate(snap.meta.criado_em)
      entrarPreview(label, result.preRestoreFilename)
      onOpenChange(false)
      toast.success('Modo visualizacao ativo', {
        description: `Backup de ${label}. Use a sidebar para Aplicar ou Sair da visualizacao.`,
        duration: 8000,
      })
    } catch (err) {
      toast.error('Erro ao visualizar', { description: (err as Error).message })
    } finally {
      setVisualizing(false)
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

  async function handleCriarPrimeiroBackup() {
    setCreatingFirst(true)
    try {
      await window.electron.ipcRenderer.invoke('backup.snapshots.criar', { trigger: 'manual', scope: 'full' })
      toast.success('Backup criado')
      await loadSnapshots()
    } catch (err) {
      toast.error('Erro ao criar backup', { description: (err as Error).message })
    } finally {
      setCreatingFirst(false)
    }
  }

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={onOpenChange}
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
            <div className="px-0.5 py-0.5">
            {(loading || (!hasLoadedOnce && snapshots.length === 0)) ? (
              <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
                Carregando snapshots...
              </div>
            ) : snapshots.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-4 py-12 text-sm text-muted-foreground">
                <History className="size-8 opacity-30" />
                <p className="text-center">Nenhum snapshot ainda.</p>
                <p className="text-center text-xs">O primeiro backup e criado ao fechar o app — ou crie agora:</p>
                <Button
                  variant="default"
                  size="sm"
                  onClick={handleCriarPrimeiroBackup}
                  disabled={creatingFirst}
                >
                  {creatingFirst ? (
                    <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                  ) : (
                    <Save className="mr-1.5 size-3.5" />
                  )}
                  {creatingFirst ? 'Criando...' : 'Criar backup agora'}
                </Button>
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
                          ? 'bg-primary/10 ring-1 ring-primary/30 ring-inset'
                          : 'hover:bg-muted/50'
                      }`}
                      onClick={() => setSelected(snap.filename)}
                      onKeyDown={(e) => { if (e.key === 'Enter') setSelected(snap.filename) }}
                    >
                      <Icon className="size-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1 overflow-hidden">
                        <div className="truncate font-medium">{formatDate(snap.meta.criado_em)}</div>
                        <div className="truncate text-xs text-muted-foreground">
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
            </div>
          </ScrollArea>

          {selected && (
            <div className="flex justify-end gap-2 border-t pt-2">
              <Button
                variant="outline"
                onClick={handleVisualizar}
                disabled={visualizing || restoring}
              >
                {visualizing ? (
                  <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                ) : (
                  <Eye className="mr-1.5 size-3.5" />
                )}
                {visualizing ? 'Visualizando...' : 'Visualizar'}
              </Button>
              <Button onClick={() => setConfirmRestore(true)} disabled={visualizing || restoring}>
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
