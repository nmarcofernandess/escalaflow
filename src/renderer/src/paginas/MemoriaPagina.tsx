import { useState, useEffect, useRef, lazy, Suspense } from 'react'
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
  Zap,
} from 'lucide-react'

const RagPlayground = lazy(() =>
  import('@/componentes/RagPlayground').then(m => ({ default: m.RagPlayground }))
)
import { Card, CardContent, CardHeader } from '@/components/ui/card'
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
import { GraphVisualizer } from '@/componentes/GraphVisualizer'
import type { GraphNode, GraphLink } from '@/componentes/GraphVisualizer'
import { useApiData } from '@/hooks/useApiData'
import { servicoConhecimento } from '@/servicos/conhecimento'
import { servicoMemorias } from '@/servicos/memorias'
import { toast } from 'sonner'
import { client } from '@/servicos/client'
import { ENTITY_TYPE_COLORS } from '@/lib/cores'
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

function badgeTipo(tipo: string) {
  if (tipo === 'sistema') {
    return <Badge variant="secondary" className="text-xs">Sistema</Badge>
  }
  return <Badge className="bg-success text-success-foreground text-xs hover:bg-success/90">Manual</Badge>
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
  const [filtroDoc, setFiltroDoc] = useState<'usuario' | 'sistema'>('usuario')
  const fontesFiltradas = fontes.filter((f) => {
    if (filtroDoc === 'sistema') return f.tipo === 'sistema'
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

  // --- Memorias ---
  const [filtroMem, setFiltroMem] = useState<'manual' | 'auto'>('manual')
  const [memorias, setMemorias] = useState<IaMemoria[]>([])
  const [contagem, setContagem] = useState({ total: 0, limite: 50 })
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

  const memoriasFiltradas = memorias.filter(m =>
    filtroMem === 'auto' ? m.origem === 'auto' : m.origem !== 'auto',
  )

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
  const [graphStats, setGraphStats] = useState<{
    entities_count: number
    relations_count: number
    tipos: Array<{ tipo: string; count: number }>
  } | null>(null)
  const [rebuildingGraph, setRebuildingGraph] = useState(false)
  const [graphNodes, setGraphNodes] = useState<GraphNode[]>([])
  const [graphLinks, setGraphLinks] = useState<GraphLink[]>([])
  const [loadingGraph, setLoadingGraph] = useState(false)
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null)
  const [exploredData, setExploredData] = useState<{
    entidade_raiz: string | null
    entidades: Array<{ nome: string; tipo: string; nivel: number }>
    relacoes: Array<{ from_nome: string; to_nome: string; tipo_relacao: string; peso: number }>
  } | null>(null)
  const [activeTypes, setActiveTypes] = useState<string[]>([])
  const graphContainerRef = useRef<HTMLDivElement>(null)
  const [graphWidth, setGraphWidth] = useState(800)

  const carregarGraphStats = async () => {
    try {
      const stats = await servicoConhecimento.graphStats()
      setGraphStats(stats)
      // Init active types from stats
      if (stats.tipos.length > 0) {
        setActiveTypes(stats.tipos.map(t => t.tipo))
      }
    } catch {
      setGraphStats(null)
    }
  }

  const carregarGraphData = async () => {
    setLoadingGraph(true)
    try {
      const result = await servicoConhecimento.graphData(undefined, 300)
      setGraphNodes(result.nodes)
      setGraphLinks(result.links)
    } catch {
      setGraphNodes([])
      setGraphLinks([])
    } finally {
      setLoadingGraph(false)
    }
  }

  useEffect(() => {
    carregarGraphStats()
    carregarGraphData()
  }, [])

  // Measure container width for responsive graph
  useEffect(() => {
    const el = graphContainerRef.current
    if (!el) return
    const obs = new ResizeObserver(entries => {
      for (const entry of entries) {
        setGraphWidth(entry.contentRect.width)
      }
    })
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  const handleNodeClick = async (node: GraphNode) => {
    setSelectedNode(node)
    try {
      const result = await servicoConhecimento.graphExplore(node.nome, 2)
      setExploredData(result)
    } catch {
      setExploredData(null)
    }
  }

  const toggleType = (tipo: string) => {
    setActiveTypes(prev =>
      prev.includes(tipo) ? prev.filter(t => t !== tipo) : [...prev, tipo],
    )
  }

  // Filtered graph data based on active types
  const filteredNodes = activeTypes.length > 0
    ? graphNodes.filter(n => activeTypes.includes(n.tipo))
    : graphNodes
  const filteredNodeIds = new Set(filteredNodes.map(n => n.id))
  const filteredLinks = graphLinks.filter(
    l => filteredNodeIds.has(l.source) && filteredNodeIds.has(l.target),
  )

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
                <Badge variant="secondary" className="ml-1.5 px-1.5 py-0 text-xs">
                  {graphStats.entities_count}
                </Badge>
              )}
            </TabsTrigger>
            {import.meta.env.DEV && (
              <TabsTrigger value="avancado">
                <Zap className="mr-1.5 size-3.5" />
                Avancado
                <Badge className="ml-1.5 bg-orange-900/50 px-1.5 py-0 text-[9px] text-orange-400 hover:bg-orange-900/50">
                  DEV
                </Badge>
              </TabsTrigger>
            )}
          </TabsList>

          {/* ── TAB MEMORIAS ── */}
          <TabsContent value="memorias" className="mt-4 space-y-4">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Select value={filtroMem} onValueChange={(v) => setFiltroMem(v as 'manual' | 'auto')}>
                      <SelectTrigger className="w-[220px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="manual">
                          <span className="flex items-center gap-1.5">
                            <Brain className="size-3.5" />
                            Memorias do RH
                          </span>
                        </SelectItem>
                        <SelectItem value="auto">
                          <span className="flex items-center gap-1.5">
                            <Sparkles className="size-3.5" />
                            Memorias Automaticas
                          </span>
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    <Badge variant="outline" className="text-xs">
                      {memoriasFiltradas.length} / {contagem.limite}
                    </Badge>
                  </div>
                  {filtroMem === 'auto' && (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">Ativo</span>
                      <Switch
                        checked={memoriaAutomatica}
                        onCheckedChange={handleToggleMemoriaAutomatica}
                        disabled={loadingToggle}
                      />
                    </div>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {filtroMem === 'manual' && (
                  <>
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
                      <p className="text-xs text-warning">
                        Limite de {contagem.limite} memorias atingido. Remova uma para adicionar outra.
                      </p>
                    )}
                    <Separator />
                  </>
                )}

                {/* Lista memorias filtradas */}
                {memoriasFiltradas.length === 0 && !loadingMemorias ? (
                  <EmptyState
                    icon={filtroMem === 'manual' ? Brain : Sparkles}
                    title={filtroMem === 'manual' ? 'Nenhuma memoria' : 'Nenhuma memoria automatica'}
                    description={filtroMem === 'manual'
                      ? 'Adicione fatos que a IA deve lembrar em toda conversa.'
                      : 'Converse com a IA e troque de chat — fatos relevantes serao extraidos automaticamente.'
                    }
                  />
                ) : (
                  <div className="space-y-2">
                    {memoriasFiltradas.map((m) => (
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
                  <Lightbulb className="mt-0.5 size-4 shrink-0 text-warning" />
                  <div className="space-y-1 text-sm text-muted-foreground">
                    <p><strong>Memorias do RH</strong> sao fatos que voce ensina a IA. Ela lembra em TODA conversa.</p>
                    <p><strong>Memorias Automaticas</strong> sao extraidas das conversas quando voce troca de chat.</p>
                    <p><strong>Documentos</strong> sao textos longos (CLT, PDFs, manuais) que a IA consulta quando relevante.</p>
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
                    <Select value={filtroDoc} onValueChange={(v) => setFiltroDoc(v as 'usuario' | 'sistema')}>
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

          {/* ── TAB AVANCADO (DEV-only) ── */}
          {import.meta.env.DEV && (
            <TabsContent value="avancado" className="mt-4">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Zap className="size-4 text-purple-400" />
                  <span className="text-sm font-semibold">RAG Playground</span>
                </div>
                <div className="flex gap-4 text-xs text-muted-foreground">
                  <span>Modelo: <strong className="text-foreground">e5-base ONNX</strong></span>
                  <span>Embeddings: <strong className="text-foreground">768d</strong></span>
                </div>
              </div>
              <Suspense fallback={
                <div className="flex h-96 items-center justify-center">
                  <Loader2 className="size-6 animate-spin text-muted-foreground" />
                </div>
              }>
                <RagPlayground />
              </Suspense>
            </TabsContent>
          )}

          {/* ── TAB RELACOES ── */}
          <TabsContent value="relacoes" className="mt-4 space-y-4">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Network className="size-4 text-muted-foreground" />
                    <span className="text-sm font-medium">Grafo de Conhecimento</span>
                    {graphStats && graphStats.entities_count > 0 && (
                      <Badge variant="outline" className="text-xs">
                        {graphStats.entities_count} entidades · {graphStats.relations_count} relacoes
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      onClick={async () => {
                        setRebuildingGraph(true)
                        try {
                          const result = await servicoConhecimento.rebuildGraph('usuario')
                          toast.success(`Grafo atualizado: ${result.entities_count} entidades, ${result.relations_count} relacoes`)
                          await carregarGraphStats()
                          await carregarGraphData()
                        } catch (err: any) {
                          toast.error('Erro ao gerar grafo', { description: err?.message })
                        } finally {
                          setRebuildingGraph(false)
                        }
                      }}
                      disabled={rebuildingGraph}
                    >
                      {rebuildingGraph ? (
                        <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                      ) : (
                        <RefreshCw className="mr-1.5 size-3.5" />
                      )}
                      {rebuildingGraph ? 'Analisando...' : 'Atualizar Relacoes'}
                    </Button>
                    {import.meta.env.DEV && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={async () => {
                          setRebuildingGraph(true)
                          try {
                            const result = await servicoConhecimento.rebuildAndExportSistema()
                            toast.success(`Sistema: ${result.seed_entities} entidades exportadas`)
                            await carregarGraphStats()
                            await carregarGraphData()
                          } catch (err: any) {
                            toast.error('Erro', { description: err?.message })
                          } finally {
                            setRebuildingGraph(false)
                          }
                        }}
                        disabled={rebuildingGraph}
                      >
                        <Network className="mr-1.5 size-3.5" />
                        Rebuild Sistema
                      </Button>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4" ref={graphContainerRef}>
                {!graphStats || (graphStats.entities_count === 0 && graphStats.relations_count === 0) ? (
                  <EmptyState
                    icon={Network}
                    title="Grafo vazio"
                    description="Clique em 'Atualizar Relacoes' para extrair entidades e relacoes dos seus documentos."
                  />
                ) : (
                  <>
                    {/* Type filter badges */}
                    {graphStats.tipos.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {graphStats.tipos.map(t => {
                          const isActive = activeTypes.includes(t.tipo)
                          const color = ENTITY_TYPE_COLORS[t.tipo] ?? '#6b7280'
                          return (
                            <button
                              key={t.tipo}
                              onClick={() => toggleType(t.tipo)}
                              className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors ${
                                isActive
                                  ? 'border-transparent text-white'
                                  : 'border-border text-muted-foreground opacity-50'
                              }`}
                              style={isActive ? { backgroundColor: color } : undefined}
                            >
                              {t.tipo} ({t.count})
                            </button>
                          )
                        })}
                      </div>
                    )}

                    {/* Graph visualizer */}
                    {loadingGraph ? (
                      <div className="flex h-[500px] items-center justify-center">
                        <Loader2 className="size-6 animate-spin text-muted-foreground" />
                      </div>
                    ) : (
                      <GraphVisualizer
                        nodes={filteredNodes}
                        links={filteredLinks}
                        onNodeClick={handleNodeClick}
                        selectedNodeId={selectedNode?.id ?? null}
                        width={graphWidth}
                        height={500}
                      />
                    )}

                    {/* Entity detail card */}
                    {selectedNode && (
                      <Card className="border-l-4" style={{ borderLeftColor: ENTITY_TYPE_COLORS[selectedNode.tipo] ?? '#6b7280' }}>
                        <CardContent className="py-4">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <h3 className="text-sm font-semibold">{selectedNode.nome}</h3>
                              <Badge
                                variant="outline"
                                className="text-xs text-white"
                                style={{ backgroundColor: ENTITY_TYPE_COLORS[selectedNode.tipo] ?? '#6b7280' }}
                              >
                                {selectedNode.tipo}
                              </Badge>
                            </div>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => { setSelectedNode(null); setExploredData(null) }}
                            >
                              Fechar
                            </Button>
                          </div>

                          {exploredData && exploredData.relacoes.length > 0 ? (
                            <div className="mt-3 space-y-1.5">
                              <p className="text-xs font-medium text-muted-foreground">
                                Conexoes ({exploredData.relacoes.length})
                              </p>
                              <div className="max-h-[200px] overflow-y-auto space-y-1">
                                {exploredData.relacoes.map((r, i) => (
                                  <div key={i} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                    <span className="font-medium text-foreground">{r.from_nome}</span>
                                    <span className="text-muted-foreground">→</span>
                                    <Badge variant="outline" className="px-1.5 py-0 text-xs">
                                      {r.tipo_relacao}
                                    </Badge>
                                    <span className="text-muted-foreground">→</span>
                                    <span className="font-medium text-foreground">{r.to_nome}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ) : exploredData ? (
                            <p className="mt-2 text-xs text-muted-foreground">Nenhuma conexao encontrada.</p>
                          ) : (
                            <div className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                              <Loader2 className="size-3 animate-spin" /> Carregando conexoes...
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    )}
                  </>
                )}

                {graphStats && graphStats.entities_count === 0 && (
                  <div className="rounded-lg bg-muted/30 px-4 py-3">
                    <div className="flex gap-3">
                      <Lightbulb className="mt-0.5 size-4 shrink-0 text-warning" />
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
        {badgeTipo(fonte.tipo)}
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
