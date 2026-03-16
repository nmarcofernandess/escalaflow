import { useState, useEffect, useCallback } from 'react'
import { Search, ChevronRight, ChevronDown, Zap, Loader2 } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
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
  // --- Sources ---
  const [sources, setSources] = useState<SourceInfo[]>([])
  const [loadingSources, setLoadingSources] = useState(true)
  const [expandedSources, setExpandedSources] = useState<Set<number>>(new Set())
  const [sourceChunks, setSourceChunks] = useState<Record<number, ChunkInfo[]>>({})
  const [filterType, setFilterType] = useState<string>('todos')

  // --- Search ---
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [results, setResults] = useState<SearchChunk[]>([])
  const [searchTime, setSearchTime] = useState<number | null>(null)

  // --- Inspector ---
  const [selectedChunk, setSelectedChunk] = useState<SearchChunk | ChunkInfo | null>(null)
  const [selectedSource, setSelectedSource] = useState<SourceInfo | null>(null)

  // Load sources
  useEffect(() => {
    setLoadingSources(true)
    servicoConhecimento.stats()
      .then((data) => setSources(data.fontes ?? []))
      .finally(() => setLoadingSources(false))
  }, [])

  // Toggle source expand
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

  // Search
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

  // Filter sources
  const filteredSources = filterType === 'todos'
    ? sources
    : sources.filter(s => s.tipo === filterType)

  // Group by type
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
    <div className="grid overflow-hidden rounded-lg border border-border"
         style={{ gridTemplateColumns: '280px 1fr 340px', height: 'calc(100vh - 220px)' }}>

      {/* LEFT: Source Tree */}
      <div className="flex flex-col border-r border-border">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Sources & Chunks</span>
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
        <ScrollArea className="flex-1">
          <div className="p-2 space-y-0.5">
            {Object.entries(grouped).map(([tipo, srcs]) => (
              <div key={tipo}>
                {srcs.map(source => (
                  <div key={source.id}>
                    <button
                      className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
                      onClick={() => toggleSource(source)}
                    >
                      {expandedSources.has(source.id)
                        ? <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
                        : <ChevronRight className="size-3 shrink-0 text-muted-foreground" />}
                      <Badge variant="outline" className={cn('text-[9px] px-1.5 py-0 shrink-0', BADGE_COLORS[source.tipo])}>
                        {source.tipo}
                      </Badge>
                      <span className="flex-1 truncate text-xs">{source.titulo}</span>
                      <span className="text-[10px] text-muted-foreground">{source.chunks_count}</span>
                    </button>
                    {expandedSources.has(source.id) && sourceChunks[source.id] && (
                      <div className="ml-4 space-y-0.5">
                        {sourceChunks[source.id].map(chunk => (
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
                        ))}
                      </div>
                    )}
                  </div>
                ))}
                <div className="my-2 h-px bg-border" />
              </div>
            ))}
            {loadingSources && (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="size-4 animate-spin text-muted-foreground" />
              </div>
            )}
          </div>
        </ScrollArea>
      </div>

      {/* CENTER: Search + Results */}
      <div className="flex flex-col">
        {/* Search bar */}
        <div className="border-b border-border p-3 space-y-2">
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

        {/* Results header */}
        {results.length > 0 && (
          <div className="flex items-center justify-between border-b border-border px-3 py-1.5 text-xs text-muted-foreground">
            <span>{results.length} chunks · {searchTime}ms · hybrid search</span>
            <span className="text-green-400">Embedding: offline (e5-base ONNX)</span>
          </div>
        )}

        {/* Results */}
        <ScrollArea className="flex-1">
          <div className="space-y-2 p-3">
            {results.length === 0 && !searching && (
              <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                <Search className="mb-3 size-8 opacity-30" />
                <p className="text-sm">Digite uma query e clique Buscar</p>
                <p className="text-xs">Testa o retrieval hibrido (70% vector + 30% FTS)</p>
              </div>
            )}
            {results.map(chunk => (
              <button
                key={chunk.id}
                className={cn(
                  'relative w-full rounded-lg border border-border p-3 text-left transition-colors hover:border-zinc-600',
                  selectedChunk?.id === chunk.id && 'border-purple-500 bg-purple-500/5',
                )}
                onClick={() => {
                  setSelectedChunk(chunk)
                  setSelectedSource(sources.find(s => s.id === chunk.source_id) ?? null)
                }}
              >
                {/* Score bar */}
                <div className={cn('absolute left-0 top-0 bottom-0 w-[3px] rounded-l-lg', scoreBarColor(chunk.score))} />
                {/* Top row */}
                <div className="flex items-center justify-between mb-1.5">
                  <span className={cn('text-lg font-bold tabular-nums', scoreColor(chunk.score))}>
                    {chunk.score.toFixed(2)}
                  </span>
                  <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <Badge variant="outline" className={cn('text-[8px] px-1 py-0', BADGE_COLORS[chunk.source_tipo])}>
                      {chunk.source_tipo}
                    </Badge>
                    {chunk.source_titulo} · #{chunk.id}
                  </div>
                </div>
                {/* Text preview */}
                <p className="text-xs leading-relaxed text-muted-foreground line-clamp-3">
                  {chunk.conteudo.slice(0, 250)}
                </p>
                {/* Meta */}
                <div className="mt-2 flex gap-3 font-mono text-[10px] text-zinc-600">
                  <span>score: {chunk.score.toFixed(2)}</span>
                  <span>imp: {chunk.importance}</span>
                  {chunk.access_count > 0 && <span>acessos: {chunk.access_count}x</span>}
                  {chunk.score < 0.5 && <span className="text-red-400">abaixo threshold</span>}
                </div>
              </button>
            ))}
          </div>
        </ScrollArea>
      </div>

      {/* RIGHT: Inspector */}
      <div className="flex flex-col border-l border-border">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Chunk Inspector</span>
          {selectedChunk && (
            <span className="text-xs text-purple-400">#{selectedChunk.id}</span>
          )}
        </div>
        <ScrollArea className="flex-1">
          {!selectedChunk ? (
            <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
              <Zap className="mb-3 size-8 opacity-30" />
              <p className="text-xs">Selecione um chunk pra inspecionar</p>
            </div>
          ) : (
            <div className="space-y-4 p-3">
              {/* Stats grid */}
              <div className="grid grid-cols-2 gap-1.5">
                <div className="rounded-md bg-accent p-2.5">
                  <div className="text-[10px] uppercase text-zinc-500">Chunk ID</div>
                  <div className="text-base font-bold">#{selectedChunk.id}</div>
                </div>
                <div className="rounded-md bg-accent p-2.5">
                  <div className="text-[10px] uppercase text-zinc-500">Score</div>
                  <div className={cn('text-base font-bold', 'score' in selectedChunk ? scoreColor((selectedChunk as SearchChunk).score) : '')}>
                    {'score' in selectedChunk ? (selectedChunk as SearchChunk).score.toFixed(2) : '\u2014'}
                  </div>
                </div>
                <div className="rounded-md bg-accent p-2.5">
                  <div className="text-[10px] uppercase text-zinc-500">Chars</div>
                  <div className="text-base font-bold">{selectedChunk.conteudo.length}</div>
                </div>
                <div className="rounded-md bg-accent p-2.5">
                  <div className="text-[10px] uppercase text-zinc-500">Source</div>
                  <div className="truncate text-xs font-bold">{selectedSource?.titulo ?? '\u2014'}</div>
                </div>
              </div>

              {/* Full text */}
              <div>
                <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Texto Completo</div>
                <ScrollArea className="max-h-[200px]">
                  <div className="whitespace-pre-wrap rounded-md bg-accent p-3 text-xs leading-relaxed text-muted-foreground">
                    {selectedChunk.conteudo}
                  </div>
                </ScrollArea>
              </div>

              {/* Metadata */}
              <div>
                <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Metadata</div>
                <div className="divide-y divide-border rounded-md border border-border">
                  <div className="flex justify-between px-3 py-1.5 text-xs">
                    <span className="text-zinc-500">tipo</span>
                    <span className={BADGE_COLORS[selectedSource?.tipo ?? ''] ?? ''}>{selectedSource?.tipo}</span>
                  </div>
                  <div className="flex justify-between px-3 py-1.5 text-xs">
                    <span className="text-zinc-500">importance</span>
                    <span className="font-mono text-muted-foreground">{selectedChunk.importance}</span>
                  </div>
                  <div className="flex justify-between px-3 py-1.5 text-xs">
                    <span className="text-zinc-500">access_count</span>
                    <span className="font-mono text-muted-foreground">{selectedChunk.access_count ?? 0}</span>
                  </div>
                  <div className="flex justify-between px-3 py-1.5 text-xs">
                    <span className="text-zinc-500">last_accessed</span>
                    <span className="font-mono text-muted-foreground">{selectedChunk.last_accessed_at ?? 'nunca'}</span>
                  </div>
                </div>
              </div>

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
                          'flex w-full items-center gap-2 rounded-md bg-accent px-2.5 py-1.5 text-left text-xs hover:bg-accent/80',
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
    </div>
  )
}
