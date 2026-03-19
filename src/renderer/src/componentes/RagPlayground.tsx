import { useState, useEffect, useCallback } from 'react'
import { Search, ChevronRight, ChevronDown, Zap, Loader2 } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableRow, TableCell } from '@/components/ui/table'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { servicoConhecimento } from '@/servicos/conhecimento'
import { cn } from '@/lib/utils'

type SourceInfo = {
  id: number
  tipo: string
  titulo: string
  importance: string
  chunks_count: number
}

type ChunkInfo = {
  id: number
  source_id: number
  conteudo: string
  importance: string
  last_accessed_at: string | null
  access_count: number
  enriched_at?: string | null
  enrichment_json?: string | null
}

type SearchChunk = ChunkInfo & {
  score: number
  source_titulo: string
  source_tipo: string
  source_metadata: Record<string, unknown>
}

const BADGE_COLORS: Record<string, string> = {
  session: 'bg-orange-900/50 text-orange-400',
  sistema: 'bg-blue-900/50 text-blue-400',
  manual: 'bg-green-900/50 text-green-400',
  auto_capture: 'bg-purple-900/50 text-purple-400',
  importacao_usuario: 'bg-green-900/50 text-green-400',
}

export function RagPlayground() {
  const [sources, setSources] = useState<SourceInfo[]>([])
  const [loadingSources, setLoadingSources] = useState(true)
  const [expandedSources, setExpandedSources] = useState<Set<number>>(new Set())
  const [sourceChunks, setSourceChunks] = useState<Record<number, ChunkInfo[]>>({})
  const [filterType, setFilterType] = useState<string>('todos')

  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [results, setResults] = useState<SearchChunk[]>([])
  const [searchTime, setSearchTime] = useState<number | null>(null)

  const [selectedChunk, setSelectedChunk] = useState<SearchChunk | ChunkInfo | null>(null)
  const [selectedSource, setSelectedSource] = useState<SourceInfo | null>(null)

  useEffect(() => {
    setLoadingSources(true)
    servicoConhecimento.stats()
      .then((data) => setSources(data.fontes ?? []))
      .finally(() => setLoadingSources(false))
  }, [])

  const toggleSource = useCallback(async (source: SourceInfo) => {
    const id = source.id
    setExpandedSources(prev => {
      const next = new Set(prev)
      if (next.has(id)) { next.delete(id) } else { next.add(id) }
      return next
    })
    if (!sourceChunks[id]) {
      const chunks = await servicoConhecimento.listarChunks(id)
      setSourceChunks(prev => ({ ...prev, [id]: chunks }))
    }
  }, [sourceChunks])

  const handleSearch = useCallback(async () => {
    if (!query.trim()) return
    setSearching(true)
    const start = performance.now()
    try {
      const result = await servicoConhecimento.search(query.trim(), 10)
      setResults(result.chunks)
      setSearchTime(Math.round(performance.now() - start))
    } catch {
      setResults([])
    } finally {
      setSearching(false)
    }
  }, [query])

  const filteredSources = filterType === 'todos'
    ? sources
    : sources.filter(s => s.tipo === filterType)

  const grouped = filteredSources.reduce<Record<string, SourceInfo[]>>((acc, s) => {
    const key = s.tipo
    if (!acc[key]) acc[key] = []
    acc[key].push(s)
    return acc
  }, {})

  const scoreColor = (score: number) =>
    score >= 0.7 ? 'text-green-400' : score >= 0.5 ? 'text-amber-400' : 'text-zinc-500'

  const scoreBarColor = (score: number) =>
    score >= 0.7 ? 'bg-green-400' : score >= 0.5 ? 'bg-amber-400' : 'bg-zinc-600'

  return (
    <Card
      className="grid overflow-hidden"
      style={{ gridTemplateColumns: '280px 1fr 340px', height: 'calc(100vh - 220px)' }}
    >
      {/* ── LEFT: Source Tree ── */}
      <div className="flex min-h-0 flex-col border-r">
        <div className="flex items-center justify-between px-3 py-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Sources & Chunks
          </span>
          <Select value={filterType} onValueChange={setFilterType}>
            <SelectTrigger className="h-7 w-[100px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos</SelectItem>
              <SelectItem value="session">Session</SelectItem>
              <SelectItem value="sistema">Sistema</SelectItem>
              <SelectItem value="manual">Manual</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Separator />

        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-0.5 p-2">
            {loadingSources ? (
              <div className="space-y-2 p-2">
                {Array.from({ length: 8 }).map((_, i) => (
                  <Skeleton key={i} className={cn('h-6', i % 3 === 2 ? 'w-3/4' : 'w-full')} />
                ))}
              </div>
            ) : (
              Object.entries(grouped).map(([tipo, srcs]) => (
                <div key={tipo}>
                  {srcs.map(source => (
                    <Collapsible
                      key={source.id}
                      open={expandedSources.has(source.id)}
                      onOpenChange={() => toggleSource(source)}
                    >
                      <CollapsibleTrigger asChild>
                        <button className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent">
                          {expandedSources.has(source.id)
                            ? <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
                            : <ChevronRight className="size-3 shrink-0 text-muted-foreground" />}
                          <Badge variant="outline" className={cn('shrink-0 px-1.5 py-0 text-[9px]', BADGE_COLORS[source.tipo])}>
                            {source.tipo}
                          </Badge>
                          <span className="flex-1 truncate text-xs">{source.titulo}</span>
                          <span className="text-[10px] text-muted-foreground">{source.chunks_count}</span>
                        </button>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <div className="ml-4 space-y-0.5">
                          {sourceChunks[source.id] ? (
                            sourceChunks[source.id].map(chunk => (
                              <button
                                key={chunk.id}
                                className={cn(
                                  'flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-xs text-muted-foreground hover:bg-accent hover:text-foreground',
                                  selectedChunk?.id === chunk.id && 'bg-accent text-blue-400',
                                )}
                                onClick={() => {
                                  setSelectedChunk(chunk)
                                  setSelectedSource(source)
                                }}
                              >
                                <span className="shrink-0 font-mono text-[10px] text-zinc-600">#{chunk.id}</span>
                                <span className="truncate">{chunk.conteudo.slice(0, 60)}</span>
                              </button>
                            ))
                          ) : (
                            <div className="space-y-1 py-1">
                              <Skeleton className="h-5 w-full" />
                              <Skeleton className="h-5 w-3/4" />
                              <Skeleton className="h-5 w-1/2" />
                            </div>
                          )}
                        </div>
                      </CollapsibleContent>
                    </Collapsible>
                  ))}
                  <Separator className="my-2" />
                </div>
              ))
            )}
          </div>
        </ScrollArea>
      </div>

      {/* ── CENTER: Search + Results ── */}
      <div className="flex min-h-0 flex-col">
        <div className="space-y-2 p-3">
          <div className="flex gap-2">
            <Input
              placeholder="Digite uma query pra testar o retrieval..."
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleSearch() }}
              className="text-sm"
            />
            <Button onClick={handleSearch} disabled={searching || !query.trim()} size="sm">
              {searching ? <Loader2 className="size-3.5 animate-spin" /> : <Search className="size-3.5" />}
            </Button>
          </div>
        </div>

        <Separator />

        {results.length > 0 && (
          <>
            <div className="flex items-center justify-between px-3 py-1.5 text-xs text-muted-foreground">
              <span>{results.length} chunks · {searchTime}ms · hybrid search</span>
              <span className="text-green-500">Embedding: offline (e5-base ONNX)</span>
            </div>
            <Separator />
          </>
        )}

        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-2 p-3">
            {results.length === 0 && !searching && (
              <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                <Search className="mb-3 size-8 opacity-30" />
                <p className="text-sm">Digite uma query e clique Buscar</p>
                <p className="text-xs">Testa o retrieval hibrido (70% vector + 30% FTS)</p>
              </div>
            )}

            {searching && (
              <div className="space-y-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Card key={i} className="p-3 shadow-none">
                    <div className="mb-2 flex items-center justify-between">
                      <Skeleton className="h-6 w-12" />
                      <Skeleton className="h-4 w-32" />
                    </div>
                    <Skeleton className="mb-1 h-3 w-full" />
                    <Skeleton className="mb-1 h-3 w-full" />
                    <Skeleton className="h-3 w-2/3" />
                  </Card>
                ))}
              </div>
            )}

            {results.map(chunk => (
              <Card
                key={chunk.id}
                className={cn(
                  'relative cursor-pointer shadow-none transition-colors hover:border-zinc-600',
                  selectedChunk?.id === chunk.id && 'border-purple-500 bg-purple-500/5',
                )}
                onClick={() => {
                  setSelectedChunk(chunk)
                  setSelectedSource(sources.find(s => s.id === chunk.source_id) ?? null)
                }}
              >
                <div className={cn('absolute bottom-0 left-0 top-0 w-[3px] rounded-l-xl', scoreBarColor(chunk.score))} />
                <CardContent className="p-3">
                  <div className="mb-1.5 flex items-center justify-between">
                    <span className={cn('text-lg font-bold tabular-nums', scoreColor(chunk.score))}>
                      {chunk.score.toFixed(2)}
                    </span>
                    <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <Badge variant="outline" className={cn('px-1 py-0 text-[8px]', BADGE_COLORS[chunk.source_tipo])}>
                        {chunk.source_tipo}
                      </Badge>
                      {chunk.source_titulo} · #{chunk.id}
                    </div>
                  </div>
                  <p className="line-clamp-3 text-xs leading-relaxed text-muted-foreground">
                    {chunk.conteudo.slice(0, 250)}
                  </p>
                  <div className="mt-2 flex gap-3 font-mono text-[10px] text-zinc-600">
                    <span>score: {chunk.score.toFixed(2)}</span>
                    <span>imp: {chunk.importance}</span>
                    {chunk.access_count > 0 && <span>acessos: {chunk.access_count}x</span>}
                    {chunk.score < 0.5 && <span className="text-red-400">abaixo threshold</span>}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </ScrollArea>
      </div>

      {/* ── RIGHT: Inspector ── */}
      <div className="flex min-h-0 flex-col border-l">
        <div className="flex items-center justify-between px-3 py-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Chunk Inspector
          </span>
          {selectedChunk && (
            <Badge variant="outline" className="text-xs text-purple-400">#{selectedChunk.id}</Badge>
          )}
        </div>

        <Separator />

        <ScrollArea className="min-h-0 flex-1">
          {!selectedChunk ? (
            <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
              <Zap className="mb-3 size-8 opacity-30" />
              <p className="text-xs">Selecione um chunk pra inspecionar</p>
            </div>
          ) : (
            <div className="space-y-4 p-3">
              {/* Stats grid */}
              <div className="grid grid-cols-2 gap-1.5">
                <Card className="p-2.5 shadow-none">
                  <div className="text-[10px] uppercase text-muted-foreground">Chunk ID</div>
                  <div className="text-base font-bold">#{selectedChunk.id}</div>
                </Card>
                <Card className="p-2.5 shadow-none">
                  <div className="text-[10px] uppercase text-muted-foreground">Score</div>
                  <div className={cn('text-base font-bold', 'score' in selectedChunk ? scoreColor((selectedChunk as SearchChunk).score) : '')}>
                    {'score' in selectedChunk ? (selectedChunk as SearchChunk).score.toFixed(2) : '\u2014'}
                  </div>
                </Card>
                <Card className="p-2.5 shadow-none">
                  <div className="text-[10px] uppercase text-muted-foreground">Chars</div>
                  <div className="text-base font-bold">{selectedChunk.conteudo.length}</div>
                </Card>
                <Card className="p-2.5 shadow-none">
                  <div className="text-[10px] uppercase text-muted-foreground">Source</div>
                  <div className="truncate text-xs font-bold">{selectedSource?.titulo ?? '\u2014'}</div>
                </Card>
              </div>

              {/* Full text */}
              <div>
                <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Texto Completo
                </div>
                <Card className="shadow-none">
                  <ScrollArea className="max-h-[200px]">
                    <div className="whitespace-pre-wrap p-3 text-xs leading-relaxed text-muted-foreground">
                      {selectedChunk.conteudo}
                    </div>
                  </ScrollArea>
                </Card>
              </div>

              {/* Metadata */}
              <div>
                <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Metadata
                </div>
                <Card className="shadow-none">
                  <Table>
                    <TableBody>
                      <TableRow>
                        <TableCell className="py-1.5 text-xs text-muted-foreground">tipo</TableCell>
                        <TableCell className="py-1.5 text-right">
                          <Badge variant="outline" className={cn('px-1.5 py-0 text-[9px]', BADGE_COLORS[selectedSource?.tipo ?? ''])}>
                            {selectedSource?.tipo}
                          </Badge>
                        </TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell className="py-1.5 text-xs text-muted-foreground">importance</TableCell>
                        <TableCell className="py-1.5 text-right font-mono text-xs text-muted-foreground">
                          {selectedChunk.importance}
                        </TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell className="py-1.5 text-xs text-muted-foreground">access_count</TableCell>
                        <TableCell className="py-1.5 text-right font-mono text-xs text-muted-foreground">
                          {selectedChunk.access_count ?? 0}
                        </TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell className="py-1.5 text-xs text-muted-foreground">last_accessed</TableCell>
                        <TableCell className="py-1.5 text-right font-mono text-xs text-muted-foreground">
                          {selectedChunk.last_accessed_at ?? 'nunca'}
                        </TableCell>
                      </TableRow>
                      <TableRow className="border-0">
                        <TableCell className="py-1.5 text-xs text-muted-foreground">enriched_at</TableCell>
                        <TableCell className="py-1.5 text-right font-mono text-xs">
                          {selectedChunk.enriched_at ? (
                            <span className="text-green-400">
                              {new Date(selectedChunk.enriched_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                            </span>
                          ) : (
                            <span className="text-zinc-600">pendente</span>
                          )}
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </Card>
              </div>

              {/* Enrichment */}
              {(() => {
                const raw = selectedChunk.enrichment_json
                if (!raw) return null
                try {
                  const enr = JSON.parse(raw) as { resumo: string; tags: string[]; entidades: number; relacoes: number }
                  return (
                    <div>
                      <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                        Enrichment
                      </div>
                      <Card className="space-y-2 p-3 shadow-none">
                        <p className="text-xs leading-relaxed text-foreground">{enr.resumo}</p>
                        <div className="flex flex-wrap gap-1">
                          {enr.tags.map((tag, i) => (
                            <Badge key={i} variant="outline" className="px-1.5 py-0 text-[9px] text-purple-400">
                              {tag}
                            </Badge>
                          ))}
                        </div>
                        <div className="flex gap-3 font-mono text-[10px] text-zinc-600">
                          <span>{enr.entidades} entidades</span>
                          <span>{enr.relacoes} relações</span>
                        </div>
                      </Card>
                    </div>
                  )
                } catch { return null }
              })()}

              {/* Neighbors */}
              {selectedSource && sourceChunks[selectedSource.id] && (
                <div>
                  <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Chunks Vizinhos ({sourceChunks[selectedSource.id].length} no source)
                  </div>
                  <div className="space-y-1">
                    {sourceChunks[selectedSource.id].map(c => (
                      <button
                        key={c.id}
                        className={cn(
                          'flex w-full items-center gap-2 rounded-lg border bg-card px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-accent',
                          c.id === selectedChunk.id && 'ring-1 ring-purple-500',
                        )}
                        onClick={() => setSelectedChunk(c)}
                      >
                        <span className="shrink-0 font-mono text-[10px] text-zinc-600">#{c.id}</span>
                        <span className={cn('truncate', c.id === selectedChunk.id ? 'text-purple-400' : 'text-muted-foreground')}>
                          {c.id === selectedChunk.id ? 'selecionado' : c.conteudo.slice(0, 50)}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </ScrollArea>
      </div>
    </Card>
  )
}
