import { useState, useRef, useEffect } from 'react'
import { Pencil, Trash2, Loader2, Check, X, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
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
import type { IaMemoria } from '@shared/types'

function formatarData(iso: string): string {
  try {
    const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z')
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
  } catch {
    return iso
  }
}

interface MemoriaItemProps {
  memoria: IaMemoria
  onSalvar: (id: number, conteudo: string) => Promise<void>
  onRemover: (id: number) => Promise<void>
}

export function MemoriaItem({ memoria, onSalvar, onRemover }: MemoriaItemProps) {
  const [editando, setEditando] = useState(false)
  const [conteudoEdit, setConteudoEdit] = useState(memoria.conteudo)
  const [salvando, setSalvando] = useState(false)
  const [confirmarDeletar, setConfirmarDeletar] = useState(false)
  const [removendo, setRemovendo] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (editando) {
      textareaRef.current?.focus()
      textareaRef.current?.select()
    }
  }, [editando])

  const salvar = async () => {
    const novo = conteudoEdit.trim()
    if (!novo || novo === memoria.conteudo) {
      setConteudoEdit(memoria.conteudo)
      setEditando(false)
      return
    }
    setSalvando(true)
    try {
      await onSalvar(memoria.id, novo)
      setEditando(false)
    } finally {
      setSalvando(false)
    }
  }

  const cancelar = () => {
    setConteudoEdit(memoria.conteudo)
    setEditando(false)
  }

  const remover = async () => {
    setRemovendo(true)
    try {
      await onRemover(memoria.id)
    } finally {
      setRemovendo(false)
    }
  }

  if (editando) {
    return (
      <div className="rounded-lg border p-3 space-y-2">
        <Textarea
          ref={textareaRef}
          rows={2}
          value={conteudoEdit}
          onChange={(e) => setConteudoEdit(e.target.value)}
          className="resize-none text-sm"
          maxLength={500}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              salvar()
            }
            if (e.key === 'Escape') cancelar()
          }}
          disabled={salvando}
        />
        <div className="flex justify-end gap-1.5">
          <Button variant="ghost" size="sm" onClick={cancelar} disabled={salvando}>
            <X className="mr-1 size-3" /> Cancelar
          </Button>
          <Button size="sm" onClick={salvar} disabled={salvando || !conteudoEdit.trim()}>
            {salvando ? (
              <Loader2 className="mr-1 size-3 animate-spin" />
            ) : (
              <Check className="mr-1 size-3" />
            )}
            Salvar
          </Button>
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="group flex items-start justify-between gap-3 rounded-lg border px-4 py-3">
        <div className="min-w-0 flex-1" onDoubleClick={() => setEditando(true)}>
          <div className="flex items-center gap-1.5">
            <p className="text-sm">{memoria.conteudo}</p>
            {memoria.origem === 'auto' && (
              <Badge variant="outline" className="shrink-0 gap-0.5 px-1.5 py-0 text-xs text-muted-foreground">
                <Sparkles className="size-2.5" />
                Auto
              </Badge>
            )}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {formatarData(memoria.criada_em)}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <Button
            variant="ghost"
            size="icon"
            className="size-7 text-muted-foreground"
            onClick={() => {
              setConteudoEdit(memoria.conteudo)
              setEditando(true)
            }}
            title="Editar"
          >
            <Pencil className="size-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 text-muted-foreground hover:text-destructive"
            onClick={() => setConfirmarDeletar(true)}
            disabled={removendo}
            title="Remover"
          >
            {removendo ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <Trash2 className="size-3" />
            )}
          </Button>
        </div>
      </div>

      <AlertDialog open={confirmarDeletar} onOpenChange={setConfirmarDeletar}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover memoria?</AlertDialogTitle>
            <AlertDialogDescription>
              A IA nao vai mais lembrar desse fato nas conversas.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90"
              onClick={remover}
            >
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
