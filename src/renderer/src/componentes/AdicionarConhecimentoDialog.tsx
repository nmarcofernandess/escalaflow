import { useState, useCallback, useRef } from 'react'
import { ArrowLeft, ChevronDown, Loader2, Sparkles, Upload, FileText } from 'lucide-react'
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
import { Skeleton } from '@/components/ui/skeleton'
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from '@/components/ui/collapsible'
import { servicoConhecimento } from '@/servicos/conhecimento'
import { toast } from 'sonner'

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

  const podeSalvar = titulo.trim().length > 0 && quandoConsultar.trim().length > 0 && conteudo.trim().length > 0
  const textoCompleto = conteudoCompletoRef.current || conteudo
  const charCount = textoCompleto.length

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Importar Documento</DialogTitle>
        </DialogHeader>

        {step === 1 && (
          <>
            {/* Drop Zone */}
            <div
              className={`flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-8 transition-colors cursor-pointer ${
                dragging ? 'border-primary bg-primary/5' : 'border-muted-foreground/25 hover:border-muted-foreground/50'
              }`}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={handleEscolherArquivo}
            >
              <Upload className="size-8 text-muted-foreground" />
              <p className="text-sm font-medium">Arraste um arquivo (.md .txt .pdf)</p>
              <p className="text-xs text-muted-foreground">ou clique para selecionar</p>
            </div>

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
            <div className="space-y-1.5">
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
                  placeholder="Ex: Acordo Coletivo 2026"
                  maxLength={120}
                />
              )}
            </div>

            {/* Sobre o quê */}
            <div className="space-y-1.5">
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
                  placeholder="Ex: Hora extra, banco de horas, adicional noturno"
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
                  <ChevronDown className={`size-3.5 transition-transform ${previewAberto ? 'rotate-180' : ''}`} />
                  Ver conteúdo
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="mt-2 max-h-60 overflow-y-auto rounded-md border bg-muted/50 p-3">
                  <p className="whitespace-pre-wrap text-xs text-muted-foreground">{conteudo}</p>
                  {charCount > MAX_PREVIEW_CHARS && (
                    <p className="mt-2 text-xs text-amber-500">
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
