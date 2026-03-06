import { useState, useRef, useEffect } from 'react'
import { MessageSquare, MoreHorizontal, Archive, Trash2, RotateCcw, Pencil } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
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
import { useIaStore } from '@/store/iaStore'
import { cn } from '@/lib/utils'
import type { IaConversa } from '@shared/index'

function tempoRelativo(iso: string): string {
  // SQLite datetime('now') retorna UTC sem 'Z' — forçar interpretação UTC
  const normalizado = iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z'
  const diff = Date.now() - new Date(normalizado).getTime()
  const rtf = new Intl.RelativeTimeFormat('pt-BR', { numeric: 'auto' })
  const minutos = Math.floor(diff / 60000)
  if (minutos < 1) return 'agora mesmo'
  if (minutos < 60) return rtf.format(-minutos, 'minute')
  const horas = Math.floor(minutos / 60)
  if (horas < 24) return rtf.format(-horas, 'hour')
  const dias = Math.floor(horas / 24)
  if (dias < 30) return rtf.format(-dias, 'day')
  const meses = Math.floor(dias / 30)
  return rtf.format(-meses, 'month')
}

interface Props {
  conversa: IaConversa
  onAbrir: (id: string) => void
  tipo: 'ativa' | 'arquivada'
}

export function IaConversaItem({ conversa, onAbrir, tipo }: Props) {
  const { arquivarConversa, restaurarConversa, deletarConversa, renomearConversa, conversa_ativa_id } =
    useIaStore()
  const [editando, setEditando] = useState(false)
  const [tituloEdit, setTituloEdit] = useState(conversa.titulo)
  const [confirmarDeletar, setConfirmarDeletar] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editando) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [editando])

  const salvarRename = async () => {
    const novo = tituloEdit.trim()
    if (novo && novo !== conversa.titulo) {
      await renomearConversa(conversa.id, novo)
    } else {
      setTituloEdit(conversa.titulo)
    }
    setEditando(false)
  }

  const ativa = conversa_ativa_id === conversa.id

  return (
    <>
      <div
        className={cn(
          'group flex items-start gap-2 px-2 py-2 rounded-lg cursor-pointer hover:bg-muted/60 transition-colors',
          ativa && 'bg-muted',
        )}
        onClick={() => !editando && onAbrir(conversa.id)}
      >
        <MessageSquare className="size-3.5 mt-0.5 shrink-0 text-muted-foreground" />

        <div className="flex-1 min-w-0">
          {editando ? (
            <Input
              ref={inputRef}
              value={tituloEdit}
              onChange={(e) => setTituloEdit(e.target.value)}
              className="h-5 text-xs px-1 py-0"
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                if (e.key === 'Enter') salvarRename()
                if (e.key === 'Escape') {
                  setTituloEdit(conversa.titulo)
                  setEditando(false)
                }
              }}
              onBlur={salvarRename}
            />
          ) : (
            <p className="text-xs font-medium truncate">{conversa.titulo}</p>
          )}
          <p className="text-xs text-muted-foreground mt-0.5">
            {tempoRelativo(conversa.atualizado_em)}
          </p>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-6 opacity-0 group-hover:opacity-100 shrink-0"
              onClick={(e) => e.stopPropagation()}
            >
              <MoreHorizontal className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
            {tipo === 'ativa' && (
              <>
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation()
                    setTituloEdit(conversa.titulo)
                    setEditando(true)
                  }}
                >
                  <Pencil className="size-3.5 mr-2" />
                  Renomear
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation()
                    arquivarConversa(conversa.id)
                  }}
                >
                  <Archive className="size-3.5 mr-2" />
                  Arquivar
                </DropdownMenuItem>
              </>
            )}
            {tipo === 'arquivada' && (
              <>
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation()
                    restaurarConversa(conversa.id)
                  }}
                >
                  <RotateCcw className="size-3.5 mr-2" />
                  Restaurar
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onClick={(e) => {
                    e.stopPropagation()
                    setConfirmarDeletar(true)
                  }}
                >
                  <Trash2 className="size-3.5 mr-2" />
                  Deletar
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <AlertDialog open={confirmarDeletar} onOpenChange={setConfirmarDeletar}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deletar conversa?</AlertDialogTitle>
            <AlertDialogDescription>
              Essa ação não pode ser desfeita. Todas as mensagens desta conversa serão removidas
              permanentemente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90"
              onClick={() => deletarConversa(conversa.id)}
            >
              Deletar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
