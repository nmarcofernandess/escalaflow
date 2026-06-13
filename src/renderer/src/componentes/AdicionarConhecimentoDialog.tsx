import { useState, useCallback, useEffect, useRef } from 'react'
import { ArrowLeft, ChevronDown, FolderOpen, Loader2, Sparkles, Upload, FileText, Pause, Play, X } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from '@/components/ui/collapsible'
import { servicoConhecimento } from '@/servicos/conhecimento'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import type { AppJob } from '@shared/types'

const MAX_PREVIEW_CHARS = 50_000

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
  iaDisponivel: boolean
}

export function AdicionarConhecimentoDialog({ open, onOpenChange, onSaved, iaDisponivel }: Props) {
  const [step, setStep] = useState<1 | 2>(1)
  const [conteudo, setConteudo] = useState('')
  const [titulo, setTitulo] = useState('')
  const [quandoConsultar, setQuandoConsultar] = useState('')
  const [arquivoNome, setArquivoNome] = useState<string | null>(null)
  const [gerando, setGerando] = useState({ titulo: false, quando: false })
  const [salvando, setSalvando] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [previewAberto, setPreviewAberto] = useState(false)
  const [bulkPath, setBulkPath] = useState<string | null>(null)
  const [bulkGroupName, setBulkGroupName] = useState('')
  const [bulkJob, setBulkJob] = useState<AppJob | null>(null)

  const conteudoCompletoRef = useRef('')

  const alguemGerando = gerando.titulo || gerando.quando

  const resetState = useCallback(() => {
    setStep(1)
    setConteudo('')
    setTitulo('')
    setQuandoConsultar('')
    setArquivoNome(null)
    setGerando({ titulo: false, quando: false })
    setSalvando(false)
    setDragging(false)
    setPreviewAberto(false)
    setBulkPath(null)
    setBulkGroupName('')
    setBulkJob(null)
    conteudoCompletoRef.current = ''
  }, [])

  const handleOpenChange = useCallback((v: boolean) => {
    if (!v) resetState()
    onOpenChange(v)
  }, [onOpenChange, resetState])

  const populateFromText = useCallback(async (texto: string, nome?: string) => {
    conteudoCompletoRef.current = texto
    setConteudo(texto.length > MAX_PREVIEW_CHARS ? texto.slice(0, MAX_PREVIEW_CHARS) : texto)
    if (nome) {
      setArquivoNome(nome)
      setTitulo(nome)
    }
    setStep(2)

    if (iaDisponivel && texto.length > 20) {
      setGerando({ titulo: true, quando: true })
      const [tituloRes, quandoRes] = await Promise.allSettled([
        servicoConhecimento.gerarMetadataIa(texto, 'titulo'),
        servicoConhecimento.gerarMetadataIa(texto, 'quando_consultar'),
      ])
      if (tituloRes.status === 'fulfilled') setTitulo(tituloRes.value.resultado)
      if (quandoRes.status === 'fulfilled') setQuandoConsultar(quandoRes.value.resultado)
      setGerando({ titulo: false, quando: false })
    }
  }, [iaDisponivel])

  const handleExtrairArquivo = useCallback(async (caminho: string) => {
    try {
      const result = await servicoConhecimento.extrairTexto(caminho)
      await populateFromText(result.texto, result.nome_arquivo)
    } catch (err: any) {
      toast.error('Erro ao extrair texto', { description: err?.message })
    }
  }, [populateFromText])

  const handleEscolherArquivo = useCallback(async () => {
    const caminho = await servicoConhecimento.escolherArquivo()
    if (caminho) await handleExtrairArquivo(caminho)
  }, [handleExtrairArquivo])

  const handleEscolherPasta = useCallback(async () => {
    const caminho = await servicoConhecimento.escolherPasta()
    if (!caminho) return
    const nome = caminho.split(/[\\/]/).filter(Boolean).pop() || 'Importacao RAG'
    setBulkPath(caminho)
    setBulkGroupName(nome)
    setBulkJob(null)
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragging(false)
  }, [])

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (!file) return
    const filePath = (file as any).path as string | undefined
    if (filePath) {
      await handleExtrairArquivo(filePath)
    } else {
      try {
        const text = await file.text()
        await populateFromText(text, file.name.replace(/\.[^.]+$/, ''))
      } catch {
        toast.error('Não foi possível ler o arquivo.')
      }
    }
  }, [handleExtrairArquivo, populateFromText])

  const handleGerarCampo = useCallback(async (campo: 'titulo' | 'quando_consultar') => {
    const texto = conteudoCompletoRef.current || conteudo
    if (!texto || texto.length < 10) {
      toast.error('Adicione texto antes de usar a IA.')
      return
    }

    const key = campo === 'quando_consultar' ? 'quando' : campo
    setGerando((prev) => ({ ...prev, [key]: true }))
    try {
      const result = await servicoConhecimento.gerarMetadataIa(texto, campo)
      if (campo === 'titulo') setTitulo(result.resultado)
      else setQuandoConsultar(result.resultado)
    } catch (err: any) {
      toast.error(`Erro ao gerar ${campo}`, { description: err?.message })
    } finally {
      setGerando((prev) => ({ ...prev, [key]: false }))
    }
  }, [conteudo])

  const handleProximo = useCallback(() => {
    const texto = conteudoCompletoRef.current || conteudo
    if (texto.trim().length < 20) {
      toast.error('Cole um texto com pelo menos 20 caracteres.')
      return
    }
    populateFromText(texto)
  }, [conteudo, populateFromText])

  const handleVoltar = useCallback(() => {
    setStep(1)
    setPreviewAberto(false)
  }, [])

  const handleSalvar = useCallback(async () => {
    if (!titulo.trim() || !quandoConsultar.trim()) return
    setSalvando(true)
    try {
      const textoFinal = conteudoCompletoRef.current || conteudo
      const result = await servicoConhecimento.importarCompleto(titulo.trim(), textoFinal, quandoConsultar.trim())
      toast.success('Conhecimento adicionado!', {
        description: `${result.chunks_count} chunks criados.`,
      })
      resetState()
      onOpenChange(false)
      onSaved()
    } catch (err: any) {
      toast.error('Erro ao salvar', { description: err?.message })
    } finally {
      setSalvando(false)
    }
  }, [titulo, quandoConsultar, conteudo, resetState, onOpenChange, onSaved])

  const handleBulkImport = useCallback(async () => {
    if (!bulkPath || !bulkGroupName.trim()) {
      toast.error('Informe a pasta e o nome do grupo.')
      return
    }

    setSalvando(true)
    try {
      const job = await servicoConhecimento.iniciarBulkImport({
        path: bulkPath,
        group_name: bulkGroupName.trim(),
      })
      setBulkJob(job)
      toast.success('Importação em massa iniciada.')
    } catch (err: any) {
      toast.error('Erro ao iniciar importação', { description: err?.message })
    } finally {
      setSalvando(false)
    }
  }, [bulkPath, bulkGroupName])

  const handleBulkPause = useCallback(async () => {
    if (!bulkJob) return
    try {
      const result = await servicoConhecimento.pausarJob(bulkJob.id)
      setBulkJob(result.job)
    } catch (err: any) {
      toast.error('Erro ao pausar importação', { description: err?.message })
    }
  }, [bulkJob])

  const handleBulkResume = useCallback(async () => {
    if (!bulkJob) return
    try {
      const result = await servicoConhecimento.retomarJob(bulkJob.id)
      setBulkJob(result.job)
    } catch (err: any) {
      toast.error('Erro ao retomar importação', { description: err?.message })
    }
  }, [bulkJob])

  const handleBulkCancel = useCallback(async () => {
    if (!bulkJob) return
    try {
      const result = await servicoConhecimento.cancelarJob(bulkJob.id)
      setBulkJob(result.job)
    } catch (err: any) {
      toast.error('Erro ao cancelar importação', { description: err?.message })
    }
  }, [bulkJob])

  useEffect(() => {
    if (!bulkJob || ['done', 'failed', 'cancelled'].includes(bulkJob.status)) return

    const timer = window.setInterval(async () => {
      try {
        const result = await servicoConhecimento.obterJob(bulkJob.id)
        if (!result.job) return
        setBulkJob(result.job)

        if (result.job.status === 'done') {
          toast.success('Importação em massa concluída.', {
            description: `${result.job.metadata.imported_files ?? 0} arquivos · ${result.job.metadata.chunks_count ?? 0} chunks`,
          })
          onSaved()
        } else if (result.job.status === 'failed') {
          toast.error('Importação em massa falhou', {
            description: result.job.error_message ?? 'Erro desconhecido',
          })
        }
      } catch {
        // polling best-effort
      }
    }, 1000)

    return () => window.clearInterval(timer)
  }, [bulkJob, onSaved])

  const podeSalvar = titulo.trim().length > 0 && quandoConsultar.trim().length > 0 && conteudo.trim().length > 0
  const textoCompleto = conteudoCompletoRef.current || conteudo
  const charCount = textoCompleto.length
  const bulkProgress = bulkJob && bulkJob.progress.total > 0
    ? Math.round((bulkJob.progress.done / bulkJob.progress.total) * 100)
    : 0

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-x-hidden overflow-y-auto">
        <DialogHeader className="pr-8">
          <DialogTitle>Importar Documento</DialogTitle>
        </DialogHeader>

        {step === 1 && (
          <>
            {/* Drop Zone */}
            <div
              className={cn("flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-8 transition-colors cursor-pointer", dragging ? "border-primary bg-primary/5" : "border-muted-foreground/25 hover:border-muted-foreground/50")}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={handleEscolherArquivo}
            >
              <Upload className="size-8 text-muted-foreground" />
              <p className="text-sm font-medium">Arraste um arquivo (.md .txt .jsonl .pdf .json .zip)</p>
              <p className="text-xs text-muted-foreground">ou clique para selecionar</p>
            </div>

            <div className="flex justify-center">
              <Button type="button" variant="outline" size="sm" onClick={handleEscolherPasta}>
                <FolderOpen className="mr-1.5 size-3.5" />
                Pasta
              </Button>
            </div>

            {bulkPath && (
              <div className="flex min-w-0 max-w-full flex-col gap-3 overflow-hidden rounded-md border p-3">
                <div className="flex min-w-0 max-w-full items-center gap-2 text-sm">
                  <FolderOpen className="size-4 shrink-0 text-muted-foreground" />
                  <span className="block min-w-0 flex-1 truncate" title={bulkPath}>{bulkPath}</span>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="bulk-group">Grupo</Label>
                  <Input
                    id="bulk-group"
                    value={bulkGroupName}
                    onChange={(e) => setBulkGroupName(e.target.value)}
                    maxLength={120}
                  />
                </div>
                {bulkJob && (
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>{bulkJob.status}</span>
                      <span>{bulkJob.progress.done}/{bulkJob.progress.total}</span>
                    </div>
                    <Progress value={bulkProgress} />
                    {!['done', 'failed', 'cancelled'].includes(bulkJob.status) && (
                      <div className="flex flex-wrap gap-2">
                        {bulkJob.status === 'paused' ? (
                          <Button type="button" size="sm" variant="outline" onClick={handleBulkResume}>
                            <Play className="mr-1.5 size-3.5" />
                            Retomar
                          </Button>
                        ) : (
                          <Button type="button" size="sm" variant="outline" onClick={handleBulkPause}>
                            <Pause className="mr-1.5 size-3.5" />
                            Pausar
                          </Button>
                        )}
                        <Button type="button" size="sm" variant="outline" onClick={handleBulkCancel}>
                          <X className="mr-1.5 size-3.5" />
                          Cancelar
                        </Button>
                      </div>
                    )}
                  </div>
                )}
                <Button
                  type="button"
                  size="sm"
                  onClick={handleBulkImport}
                  disabled={salvando || Boolean(bulkJob && !['done', 'failed', 'cancelled'].includes(bulkJob.status))}
                >
                  {salvando && <Loader2 className="mr-1.5 size-3.5 animate-spin" />}
                  Importar Pasta
                </Button>
              </div>
            )}

            <div className="relative flex items-center gap-3">
              <Separator className="flex-1" />
              <span className="text-xs text-muted-foreground">ou</span>
              <Separator className="flex-1" />
            </div>

            {/* Textarea para colar */}
            <Textarea
              rows={6}
              value={conteudo}
              onChange={(e) => {
                setConteudo(e.target.value)
                conteudoCompletoRef.current = e.target.value
              }}
              placeholder="Cole o conteúdo aqui..."
              className="resize-none font-mono text-xs"
            />

            <DialogFooter>
              <Button variant="outline" onClick={() => handleOpenChange(false)}>
                Cancelar
              </Button>
              <Button onClick={handleProximo} disabled={conteudo.trim().length < 20}>
                Próximo →
              </Button>
            </DialogFooter>
          </>
        )}

        {step === 2 && (
          <>
            {/* Info card */}
            <div className="flex items-center gap-2 rounded-md bg-muted px-3 py-2 text-sm">
              <FileText className="size-4 shrink-0 text-muted-foreground" />
              <span className="truncate">
                {arquivoNome || 'Texto colado'}
              </span>
              <span className="ml-auto text-xs text-muted-foreground">
                {charCount.toLocaleString()} caracteres
              </span>
            </div>

            {/* Título */}
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="titulo">Título</Label>
                {iaDisponivel && !gerando.titulo && conteudo && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-6"
                    disabled={alguemGerando}
                    onClick={() => handleGerarCampo('titulo')}
                    title="Regenerar título com IA"
                  >
                    <Sparkles className="size-3.5" />
                  </Button>
                )}
              </div>
              {gerando.titulo ? (
                <Skeleton className="h-9 w-full" />
              ) : (
                <Input
                  id="titulo"
                  value={titulo}
                  onChange={(e) => setTitulo(e.target.value)}
                  placeholder="Ex: Documentacao do Projeto"
                  maxLength={120}
                />
              )}
            </div>

            {/* Sobre o quê */}
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="quando">Sobre o quê?</Label>
                {iaDisponivel && !gerando.quando && conteudo && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-6"
                    disabled={alguemGerando}
                    onClick={() => handleGerarCampo('quando_consultar')}
                    title="Regenerar sugestão com IA"
                  >
                    <Sparkles className="size-3.5" />
                  </Button>
                )}
              </div>
              {gerando.quando ? (
                <Skeleton className="h-9 w-full" />
              ) : (
                <Input
                  id="quando"
                  value={quandoConsultar}
                  onChange={(e) => setQuandoConsultar(e.target.value)}
                  placeholder="Ex: Arquitetura do sistema, fluxo de deploy, stack tecnologica"
                  maxLength={250}
                />
              )}
              <p className="text-xs text-muted-foreground">
                Ajuda a IA a saber quando consultar este documento
              </p>
            </div>

            {/* Preview colapsável */}
            <Collapsible open={previewAberto} onOpenChange={setPreviewAberto}>
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm" className="h-7 gap-1.5 px-2 text-xs text-muted-foreground">
                  <ChevronDown className={cn("size-3.5 transition-transform", previewAberto && "rotate-180")} />
                  Ver conteúdo
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="mt-2 max-h-60 overflow-y-auto rounded-md border bg-muted/50 p-3">
                  <p className="whitespace-pre-wrap text-xs text-muted-foreground">{conteudo}</p>
                  {charCount > MAX_PREVIEW_CHARS && (
                    <p className="mt-2 text-xs text-warning">
                      Preview truncado em {MAX_PREVIEW_CHARS.toLocaleString()} caracteres. O texto completo será salvo.
                    </p>
                  )}
                </div>
              </CollapsibleContent>
            </Collapsible>

            <DialogFooter>
              <Button variant="outline" onClick={handleVoltar} disabled={salvando}>
                <ArrowLeft className="mr-1.5 size-3.5" />
                Voltar
              </Button>
              <Button onClick={handleSalvar} disabled={!podeSalvar || salvando || alguemGerando}>
                {salvando && <Loader2 className="mr-1.5 size-3.5 animate-spin" />}
                Salvar
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
