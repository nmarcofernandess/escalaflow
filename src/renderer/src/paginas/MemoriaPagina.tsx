import { useState, useEffect } from 'react'
import {
  Brain,
  Database,
  FileText,
  Upload,
  Trash2,
  Loader2,
  BookOpen,
  User,
  Eye,
  Plus,
  Lightbulb,
  Network,
  RefreshCw,
  Sparkles,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { PageHeader } from '@/componentes/PageHeader'
import { EmptyState } from '@/componentes/EmptyState'
import { MemoriaItem } from '@/componentes/MemoriaItem'
import { AdicionarConhecimentoDialog } from '@/componentes/AdicionarConhecimentoDialog'
import { VerConhecimentoDialog } from '@/componentes/VerConhecimentoDialog'
import { useApiData } from '@/hooks/useApiData'
import { servicoConhecimento } from '@/servicos/conhecimento'
import { servicoMemorias } from '@/servicos/memorias'
import { toast } from 'sonner'
import { client } from '@/servicos/client'
import type { IaMemoria } from '@shared/types'

type FonteComChunks = {
  id: number
  tipo: string
  titulo: string
  importance: string
  ativo: boolean
  criada_em: string
  atualizada_em: string
  chunks_count: number
}

function formatarData(iso: string): string {
  try {
    const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z')
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
  } catch {
    return iso
  }
}

function badgeTipo(tipo: string, importance: string) {
  if (tipo === 'sistema') {
    return <Badge variant="secondary" className="text-xs">Sistema</Badge>
  }
  if (importance === 'LOW') {
    return <Badge variant="outline" className="text-xs">Auto</Badge>
  }
  return <Badge className="bg-green-600 text-xs hover:bg-green-700">Manual</Badge>
}

export function MemoriaPagina() {
  // --- Conhecimento (existente) ---
  const { data, loading, reload } = useApiData(
    () => servicoConhecimento.stats(),
    [],
  )
  const [removendoId, setRemovendoId] = useState<number | null>(null)
  const [dialogAdicionarAberto, setDialogAdicionarAberto] = useState(false)
  const [fonteParaVer, setFonteParaVer] = useState<{ id: number; titulo: string } | null>(null)
  const [iaDisponivel, setIaDisponivel] = useState(false)

  useEffect(() => {
    (client['ia.configuracao.obter']() as Promise<any>)
      .then((cfg: any) => setIaDisponivel(!!cfg?.ativo && !!cfg?.api_key))
      .catch(() => setIaDisponivel(false))
  }, [])

  const handleRemover = async (id: number) => {
    setRemovendoId(id)
    try {
      await servicoConhecimento.removerFonte(id)
      toast.success('Documento removido.')
      reload()
    } catch (err: any) {
      toast.error('Erro ao remover', { description: err?.message ?? 'Erro desconhecido' })
    } finally {
      setRemovendoId(null)
    }
  }

  const handleToggleAtivo = async (id: number, ativo: boolean) => {
    try {
      await servicoConhecimento.toggleAtivo(id, ativo)
      reload()
    } catch (err: any) {
      toast.error('Erro ao alterar status', { description: err?.message })
    }
  }

  const fontes = data?.fontes ?? []
  const totais = data?.totais ?? { total_fontes: 0, total_chunks: 0, total_sistema: 0, total_usuario: 0 }
  const [filtroDoc, setFiltroDoc] = useState<'usuario' | 'sistema' | 'automatico'>('usuario')
  const fontesFiltradas = fontes.filter((f) => {
    if (filtroDoc === 'sistema') return f.tipo === 'sistema'
    if (filtroDoc === 'automatico') return f.tipo === 'session' || f.tipo === 'auto_extract'
    return f.tipo === 'manual'
  })

  // --- Memoria Automatica ---
  const [memoriaAutomatica, setMemoriaAutomatica] = useState(true)
  const [loadingToggle, setLoadingToggle] = useState(false)

  useEffect(() => {
    servicoMemorias.getMemoriaAutomatica()
      .then((v) => setMemoriaAutomatica(v))
      .catch(() => {})
  }, [])

  const handleToggleMemoriaAutomatica = async (valor: boolean) => {
    setLoadingToggle(true)
    try {
      const result = await servicoMemorias.setMemoriaAutomatica(valor)
      setMemoriaAutomatica(result)
    } catch (err: any) {
      toast.error('Erro ao alterar', { description: err?.message })
    } finally {
      setLoadingToggle(false)
    }
  }

  // --- Memorias (novo) ---
  const [memorias, setMemorias] = useState<IaMemoria[]>([])
  const [contagem, setContagem] = useState({ total: 0, limite: 20 })
  const [loadingMemorias, setLoadingMemorias] = useState(true)
  const [novaMemoria, setNovaMemoria] = useState('')
  const [criando, setCriando] = useState(false)

  const carregarMemorias = async () => {
    setLoadingMemorias(true)
    try {
      const [lista, cnt] = await Promise.all([
        servicoMemorias.listar(),
        servicoMemorias.contar(),
      ])
      setMemorias(lista)
      setContagem(cnt)
    } finally {
      setLoadingMemorias(false)
    }
  }

  useEffect(() => { carregarMemorias() }, [])

  const handleCriarMemoria = async () => {
    if (!novaMemoria.trim() || criando) return
    setCriando(true)
    try {
      await servicoMemorias.salvar({ conteudo: novaMemoria.trim() })
      setNovaMemoria('')
      await carregarMemorias()
      toast.success('Memoria salva.')
    } catch (err: any) {
      toast.error('Erro ao salvar', { description: err?.message })
    } finally {
      setCriando(false)
    }
  }

  // --- Graph ---
  const [filtroGraph, setFiltroGraph] = useState<'usuario' | 'sistema'>('usuario')
  const [graphStats, setGraphStats] = useState<{
    entities_count: number
    relations_count: number
    tipos: Array<{ tipo: string; count: number }>
  } | null>(null)
  const [rebuildingGraph, setRebuildingGraph] = useState(false)

  const carregarGraphStats = async (origem?: 'usuario' | 'sistema') => {
    try {
      const stats = await servicoConhecimento.graphStats(origem ?? filtroGraph)
      setGraphStats(stats)
    } catch {
      setGraphStats(null)
    }
  }

  useEffect(() => { carregarGraphStats() }, [filtroGraph])

  const handleRebuildGraph = async () => {
    if (rebuildingGraph) return
    setRebuildingGraph(true)
    try {
      if (filtroGraph === 'sistema') {
        const result = await servicoConhecimento.rebuildAndExportSistema()
        toast.success(`Graph sistema: ${result.seed_entities} entidades, ${result.seed_relations} relacoes exportadas`)
        await carregarGraphStats('sistema')
      } else {
        const result = await servicoConhecimento.rebuildGraph('usuario')
        toast.success(`Grafo gerado: ${result.entities_count} entidades, ${result.relations_count} relacoes (${result.chunks_processados} chunks)`)
        await carregarGraphStats('usuario')
      }
    } catch (err: any) {
      toast.error('Erro ao gerar grafo', { description: err?.message ?? 'Erro desconhecido' })
    } finally {
      setRebuildingGraph(false)
    }
  }

  const handleSalvarMemoria = async (id: number, conteudo: string) => {
    await servicoMemorias.salvar({ id, conteudo })
    await carregarMemorias()
    toast.success('Memoria atualizada.')
  }

  const handleRemoverMemoria = async (id: number) => {
    await servicoMemorias.remover(id)
    await carregarMemorias()
    toast.success('Memoria removida.')
  }

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader
        breadcrumbs={[{ label: 'Dashboard', href: '/' }, { label: 'Memoria' }]}
      />

      <div className="flex flex-col gap-6 p-6">
        <Tabs defaultValue="memorias">
          <TabsList>
            <TabsTrigger value="memorias">
              <Brain className="mr-1.5 size-3.5" />
              Memorias
            </TabsTrigger>
            <TabsTrigger value="documentos">
              <BookOpen className="mr-1.5 size-3.5" />
              Documentos
            </TabsTrigger>
            <TabsTrigger value="relacoes">
              <Network className="mr-1.5 size-3.5" />
              Relacoes
              {graphStats && graphStats.entities_count > 0 && (
                <Badge variant="secondary" className="ml-1.5 px-1.5 py-0 text-[10px]">
                  {graphStats.entities_count}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>

          {/* ── TAB MEMORIAS ── */}
          <TabsContent value="memorias" className="mt-4 space-y-4">
            {/* Toggle Memoria Automatica */}
            <Card>
              <CardContent className="flex items-center justify-between py-4">
                <div className="space-y-0.5">
                  <p className="text-sm font-medium">Memoria Automatica</p>
                  <p className="text-xs text-muted-foreground">
                    Salva informacoes das conversas automaticamente ao trocar de chat
                  </p>
                </div>
                <Switch
                  checked={memoriaAutomatica}
                  onCheckedChange={handleToggleMemoriaAutomatica}
                  disabled={loadingToggle}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-base">Memorias do RH</CardTitle>
                    <CardDescription>
                      Fatos rapidos que a IA lembra em toda conversa
                    </CardDescription>
                  </div>
                  <Badge variant="outline">{contagem.total} / {contagem.limite}</Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {/* Input nova memoria */}
                <div className="flex gap-2">
                  <Textarea
                    rows={2}
                    value={novaMemoria}
                    onChange={(e) => setNovaMemoria(e.target.value)}
                    placeholder="Ex: Maria pediu pra nao trabalhar quinta"
                    className="resize-none text-sm"
                    maxLength={500}
                    disabled={contagem.total >= contagem.limite}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault()
                        handleCriarMemoria()
                      }
                    }}
                  />
                  <Button
                    size="sm"
                    onClick={handleCriarMemoria}
                    disabled={!novaMemoria.trim() || criando || contagem.total >= contagem.limite}
                    className="shrink-0 self-end"
                  >
                    {criando ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
                  </Button>
                </div>
                {contagem.total >= contagem.limite && (
                  <p className="text-xs text-amber-500">
                    Limite de {contagem.limite} memorias atingido. Remova uma para adicionar outra.
                  </p>
                )}

                <Separator />

                {/* Lista memorias */}
                {memorias.length === 0 && !loadingMemorias ? (
                  <EmptyState
                    icon={Brain}
                    title="Nenhuma memoria"
                    description="Adicione fatos que a IA deve lembrar em toda conversa."
                  />
                ) : (
                  <div className="space-y-2">
                    {memorias.map((m) => (
                      <MemoriaItem
                        key={m.id}
                        memoria={m}
                        onSalvar={handleSalvarMemoria}
                        onRemover={handleRemoverMemoria}
                      />
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Card informativo */}
            <Card className="bg-muted/30">
              <CardContent className="pt-4">
                <div className="flex gap-3">
                  <Lightbulb className="mt-0.5 size-4 shrink-0 text-amber-500" />
                  <div className="space-y-1 text-sm text-muted-foreground">
                    <p><strong>Memorias</strong> sao fatos curtos que voce ensina a IA. Ela lembra em TODA conversa automaticamente.</p>
                    <p><strong>Documentos</strong> sao textos longos (CLT, PDFs, manuais) que a IA consulta quando relevante.</p>
                    <p>Use memorias pra preferencias e excecoes. Use documentos pra regras e referencias.</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── TAB DOCUMENTOS ── */}
          <TabsContent value="documentos" className="mt-4 space-y-4">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Select value={filtroDoc} onValueChange={(v) => setFiltroDoc(v as 'usuario' | 'sistema' | 'automatico')}>
                      <SelectTrigger className="w-[220px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="usuario">
                          <span className="flex items-center gap-1.5">
                            <User className="size-3.5" />
                            Meus Documentos
                          </span>
                        </SelectItem>
                        <SelectItem value="automatico">
                          <span className="flex items-center gap-1.5">
                            <Sparkles className="size-3.5" />
                            Aprendizado Automatico
                          </span>
                        </SelectItem>
                        <SelectItem value="sistema">
                          <span className="flex items-center gap-1.5">
                            <BookOpen className="size-3.5" />
                            Sistema
                          </span>
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    <Badge variant="outline" className="text-xs">
                      {fontesFiltradas.length} {fontesFiltradas.length === 1 ? 'documento' : 'documentos'}
                    </Badge>
                  </div>
                  {filtroDoc === 'usuario' && (
                    <Button
                      size="sm"
                      onClick={() => setDialogAdicionarAberto(true)}
                    >
                      <Upload className="mr-1.5 size-3.5" />
                      Importar
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {fontesFiltradas.length === 0 && !loading ? (
                  filtroDoc === 'usuario' ? (
                    <EmptyState
                      icon={FileText}
                      title="Nenhum documento"
                      description="Importe arquivos .md, .txt ou .pdf para expandir a base de conhecimento da IA."
                      action={
                        <Button size="sm" variant="outline" onClick={() => setDialogAdicionarAberto(true)}>
                          <Upload className="mr-1.5 size-3.5" />
                          Importar
                        </Button>
                      }
                    />
                  ) : filtroDoc === 'automatico' ? (
                    <EmptyState
                      icon={Sparkles}
                      title="Nenhum aprendizado automatico"
                      description="Converse com a IA e troque de chat — memorias serao salvas automaticamente."
                    />
                  ) : (
                    <EmptyState
                      icon={Database}
                      title="Nenhum documento de sistema"
                      description="A base sera populada na primeira inicializacao."
                    />
                  )
                ) : (
                  <div className="space-y-2">
                    {fontesFiltradas.map((fonte) => (
                      <FonteItem
                        key={fonte.id}
                        fonte={fonte}
                        protegido={filtroDoc === 'sistema'}
                        onRemover={filtroDoc !== 'sistema' ? () => handleRemover(fonte.id) : undefined}
                        removendo={removendoId === fonte.id}
                        onVer={() => setFonteParaVer({ id: fonte.id, titulo: fonte.titulo })}
                        onToggleAtivo={(ativo) => handleToggleAtivo(fonte.id, ativo)}
                      />
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── TAB RELACOES ── */}
          <TabsContent value="relacoes" className="mt-4 space-y-4">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Select value={filtroGraph} onValueChange={(v) => setFiltroGraph(v as 'usuario' | 'sistema')}>
                      <SelectTrigger className="w-[180px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="usuario">
                          <span className="flex items-center gap-1.5">
                            <User className="size-3.5" />
                            Minhas Relacoes
                          </span>
                        </SelectItem>
                        <SelectItem value="sistema">
                          <span className="flex items-center gap-1.5">
                            <BookOpen className="size-3.5" />
                            Sistema
                          </span>
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    {graphStats && graphStats.entities_count > 0 && (
                      <Badge variant="outline" className="text-xs">
                        {graphStats.entities_count} entidades · {graphStats.relations_count} relacoes
                      </Badge>
                    )}
                  </div>
                  {filtroGraph === 'usuario' && (
                    <Button
                      size="sm"
                      onClick={handleRebuildGraph}
                      disabled={rebuildingGraph}
                    >
                      {rebuildingGraph ? (
                        <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                      ) : (
                        <RefreshCw className="mr-1.5 size-3.5" />
                      )}
                      {rebuildingGraph ? 'Analisando...' : 'Analisar Relacoes'}
                    </Button>
                  )}
                  {import.meta.env.DEV && filtroGraph === 'sistema' && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleRebuildGraph}
                      disabled={rebuildingGraph}
                    >
                      {rebuildingGraph ? (
                        <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                      ) : (
                        <Network className="mr-1.5 size-3.5" />
                      )}
                      {rebuildingGraph ? 'Extraindo...' : 'Rebuild Graph'}
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {!graphStats || (graphStats.entities_count === 0 && graphStats.relations_count === 0) ? (
                  <EmptyState
                    icon={Network}
                    title="Grafo vazio"
                    description={filtroGraph === 'usuario'
                      ? "Clique em 'Analisar Relacoes' para extrair entidades e relacoes dos seus documentos."
                      : "O grafo do sistema sera populado automaticamente."
                    }
                  />
                ) : (
                  <>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="rounded-lg border p-3 text-center">
                        <p className="text-2xl font-bold">{graphStats.entities_count}</p>
                        <p className="text-xs text-muted-foreground">Entidades</p>
                      </div>
                      <div className="rounded-lg border p-3 text-center">
                        <p className="text-2xl font-bold">{graphStats.relations_count}</p>
                        <p className="text-xs text-muted-foreground">Relacoes</p>
                      </div>
                    </div>

                    {graphStats.tipos.length > 0 && (
                      <div className="space-y-2">
                        <p className="text-sm font-medium">Entidades por tipo</p>
                        <div className="flex flex-wrap gap-2">
                          {graphStats.tipos.map(t => (
                            <Badge key={t.tipo} variant="outline" className="text-xs">
                              {t.tipo} ({t.count})
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}

                {filtroGraph === 'usuario' && (
                  <div className="rounded-lg bg-muted/30 px-4 py-3">
                    <div className="flex gap-3">
                      <Lightbulb className="mt-0.5 size-4 shrink-0 text-amber-500" />
                      <div className="space-y-1 text-xs text-muted-foreground">
                        <p>A analise faz <strong>1 chamada de IA por chunk</strong> dos documentos ativos. Pode levar alguns minutos e consumir creditos da API.</p>
                        <p>A IA usa o grafo automaticamente ao responder no chat (tool <code>explorar_relacoes</code>).</p>
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      <AdicionarConhecimentoDialog
        open={dialogAdicionarAberto}
        onOpenChange={setDialogAdicionarAberto}
        onSaved={reload}
        iaDisponivel={iaDisponivel}
      />
      <VerConhecimentoDialog
        open={!!fonteParaVer}
        onOpenChange={(open) => { if (!open) setFonteParaVer(null) }}
        fonte={fonteParaVer}
      />
    </div>
  )
}

function FonteItem({
  fonte,
  protegido,
  onRemover,
  removendo,
  onVer,
  onToggleAtivo,
}: {
  fonte: FonteComChunks
  protegido?: boolean
  onRemover?: () => void
  removendo?: boolean
  onVer?: () => void
  onToggleAtivo?: (ativo: boolean) => void
}) {
  return (
    <div className={`flex items-center justify-between rounded-lg border px-4 py-3 transition-opacity ${!fonte.ativo ? 'opacity-50' : ''}`}>
      <div className="flex items-center gap-3 min-w-0">
        <FileText className="size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{fonte.titulo}</p>
          <p className="text-xs text-muted-foreground">
            {fonte.chunks_count} chunks · Atualizado em {formatarData(fonte.atualizada_em)}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {badgeTipo(fonte.tipo, fonte.importance)}
        {onToggleAtivo && (
          <Switch
            checked={fonte.ativo}
            onCheckedChange={onToggleAtivo}
            className="scale-75"
          />
        )}
        {onVer && (
          <Button
            variant="ghost"
            size="icon"
            className="size-8 text-muted-foreground"
            onClick={onVer}
            title="Ver conteudo"
          >
            <Eye className="size-3.5" />
          </Button>
        )}
        {!protegido && onRemover && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-8 text-muted-foreground hover:text-destructive"
                disabled={removendo}
              >
                {removendo ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Trash2 className="size-3.5" />
                )}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Remover documento?</AlertDialogTitle>
                <AlertDialogDescription>
                  O documento "{fonte.titulo}" e todos os seus chunks serao removidos permanentemente da base de conhecimento.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction onClick={onRemover}>
                  Remover
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>
    </div>
  )
}
