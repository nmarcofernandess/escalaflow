# RAG Playground — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aba "Avançado" (DEV-only) na MemoriaPagina com retrieval test interativo, source tree, chunk inspector e heatmap de embeddings — permitindo explorar visualmente como o RAG funciona.

**Architecture:** Componente `RagPlayground` isolado, renderizado condicionalmente via `import.meta.env.DEV` como 4a tab na MemoriaPagina. Backend: 1 novo IPC handler (`knowledge.search`) que expõe `searchKnowledge()` já existente + 1 handler para listar chunks por source. Frontend: 3 painéis (source tree, results, inspector) usando shadcn/ui existentes.

**Tech Stack:** React 19, Tailwind, shadcn/ui (ScrollArea, Card, Badge, Input, Button, Select, Collapsible), IPC via @egoist/tipc, PGlite (pgvector + FTS)

**Mockup aprovado:** `.superpowers/brainstorm/38705-1773620474/rag-playground-shadcn.html`

---

## Como o RAG rankeia e descarta chunks

O `search.ts` tem 3 mecanismos de seleção natural:

| Mecanismo | O que faz | Efeito |
|-----------|-----------|--------|
| **Importance boost** | Chunks `high` (sistema/manual) ganham +0.15 no score combinado | Docs CLT sempre rankeiam melhor que sessions |
| **Access tracking** | Cada retrieval incrementa `access_count` e atualiza `last_accessed_at` | Chunks úteis sobem de relevância implícita |
| **Lazy decay 30d** | Chunks `low` + `access_count=0` + `criada_em > 30 dias` são EXCLUÍDOS da busca | Sessions nunca usadas morrem após 1 mês |

Chunks de session (importance=low) que nunca foram acessados pela IA desaparecem dos resultados após 30 dias. Os que são consultados sobrevivem indefinidamente.

## Graph — Decisão de simplificação

O graph NÃO separa mais "usuario" vs "sistema" na UI. É 1 graph só:
- Sistema (775 entidades CLT/regras) vem do seed e é imutável
- Usuário (entidades de docs importados + sessions) é mutável
- Ambos compartilham as mesmas tabelas e SE CONECTAM (uma "Cleunice" do usuario se liga a "CLT 44h" do sistema)
- 1 botão "Atualizar Relações" processa chunks do usuário e emaranha com o sistema
- Filtro por origem removido da aba Relações

---

## File Structure

| File | Responsibility | Action |
|------|---------------|--------|
| `src/main/tipc.ts` | 2 novos IPC handlers: `knowledge.search`, `knowledge.listarChunks` | Modify |
| `src/renderer/src/servicos/conhecimento.ts` | 2 novos métodos: `search()`, `listarChunks()` | Modify |
| `src/renderer/src/componentes/RagPlayground.tsx` | Componente principal (3 painéis) | Create |
| `src/renderer/src/paginas/MemoriaPagina.tsx` | Adicionar 4a tab "Avançado" DEV-only + simplificar graph (1 filtro, 1 botão) | Modify |

**Nota:** Nenhum componente shadcn novo precisa ser instalado. Todos os necessários já existem.

---

## Chunk 1: Backend — IPC Handlers

### Task 1: Handler `knowledge.search`

**Files:**
- Modify: `src/main/tipc.ts`
- Reference: `src/main/knowledge/search.ts` (searchKnowledge já existe)

- [ ] **Step 1: Ler o searchKnowledge existente para entender retorno**

Ler `src/main/knowledge/search.ts` — a função retorna `{ chunks, relations, context_for_llm }`. Cada chunk tem: `id, source_id, conteudo, importance, score`. O `score` é o combined hybrid score.

- [ ] **Step 2: Adicionar handler knowledge.search no tipc.ts**

Localizar a seção de handlers de knowledge (grep `knowledge.listarFontes`). Adicionar APÓS o último handler de knowledge:

```typescript
const knowledgeSearch = t.procedure
  .input<{ query: string; limite?: number; modo?: 'hybrid' | 'vector' | 'fts' }>()
  .action(async ({ input }) => {
    const { searchKnowledge } = await import('./knowledge/search')
    const result = await searchKnowledge(input.query, { limite: input.limite ?? 10 })
    // Enrich chunks com source info
    const enriched = []
    for (const chunk of result.chunks) {
      const source = await queryOne<{ titulo: string; tipo: string; metadata: string }>(
        'SELECT titulo, tipo, metadata::text as metadata FROM knowledge_sources WHERE id = $1',
        chunk.source_id,
      )
      enriched.push({
        ...chunk,
        source_titulo: source?.titulo ?? 'Desconhecido',
        source_tipo: source?.tipo ?? 'manual',
        source_metadata: source?.metadata ? JSON.parse(source.metadata) : {},
      })
    }
    return { chunks: enriched, relations: result.relations, total: enriched.length }
  })
```

- [ ] **Step 3: Registrar no router**

Encontrar o objeto router (grep `knowledge:` no tipc.ts). Adicionar `'knowledge.search': knowledgeSearch,` na seção de knowledge handlers.

- [ ] **Step 4: Verificar typecheck**

Run: `npm run typecheck`
Expected: 0 errors

- [ ] **Step 5: Commit**

```bash
git add src/main/tipc.ts
git commit -m "feat(ipc): add knowledge.search handler — exposes searchKnowledge via IPC"
```

### Task 2: Handler `knowledge.listarChunks`

**Files:**
- Modify: `src/main/tipc.ts`

- [ ] **Step 1: Adicionar handler para listar chunks de uma source**

```typescript
const knowledgeListarChunks = t.procedure
  .input<{ source_id: number }>()
  .action(async ({ input }) => {
    const chunks = await queryAll<{
      id: number
      source_id: number
      conteudo: string
      importance: string
      last_accessed_at: string | null
      access_count: number
    }>(
      `SELECT id, source_id, conteudo, importance,
              last_accessed_at::text, COALESCE(access_count, 0)::int as access_count
       FROM knowledge_chunks
       WHERE source_id = $1
       ORDER BY id ASC`,
      input.source_id,
    )
    return chunks
  })
```

- [ ] **Step 2: Registrar no router**

Adicionar `'knowledge.listarChunks': knowledgeListarChunks,` no router.

- [ ] **Step 3: Verificar typecheck**

Run: `npm run typecheck`
Expected: 0 errors

- [ ] **Step 4: Commit**

```bash
git add src/main/tipc.ts
git commit -m "feat(ipc): add knowledge.listarChunks handler"
```

### Task 3: Service layer no renderer

**Files:**
- Modify: `src/renderer/src/servicos/conhecimento.ts`

- [ ] **Step 1: Ler conhecimento.ts para entender o pattern**

Ler `src/renderer/src/servicos/conhecimento.ts`. Pattern: cada método chama `client['knowledge.xxx']()` e faz cast do retorno.

- [ ] **Step 2: Adicionar métodos search e listarChunks**

Adicionar ao objeto `servicoConhecimento`:

```typescript
  async search(query: string, limite?: number) {
    return (await client['knowledge.search']({ query, limite })) as {
      chunks: Array<{
        id: number
        source_id: number
        conteudo: string
        importance: string
        score: number
        source_titulo: string
        source_tipo: string
        source_metadata: Record<string, unknown>
        last_accessed_at: string | null
        access_count: number
      }>
      relations: Array<{
        from_nome: string
        to_nome: string
        tipo_relacao: string
        peso: number
      }>
      total: number
    }
  },

  async listarChunks(sourceId: number) {
    return (await client['knowledge.listarChunks']({ source_id: sourceId })) as Array<{
      id: number
      source_id: number
      conteudo: string
      importance: string
      last_accessed_at: string | null
      access_count: number
    }>
  },
```

- [ ] **Step 3: Verificar typecheck**

Run: `npm run typecheck`
Expected: 0 errors

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/servicos/conhecimento.ts
git commit -m "feat(service): add search + listarChunks to servicoConhecimento"
```

---

## Chunk 2: Frontend — RagPlayground Component

### Task 4: Criar RagPlayground.tsx — Shell + Source Tree (painel esquerdo)

**Files:**
- Create: `src/renderer/src/componentes/RagPlayground.tsx`

- [ ] **Step 1: Criar componente com layout 3 painéis e source tree**

O layout usa CSS grid com 3 colunas (280px | 1fr | 340px), altura total do viewport disponível. O painel esquerdo carrega sources via `servicoConhecimento.stats()` e agrupa por tipo (session/sistema/manual). Cada source é expandível e mostra seus chunks via `servicoConhecimento.listarChunks()`.

```tsx
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

type SearchRelation = {
  from_nome: string
  to_nome: string
  tipo_relacao: string
  peso: number
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
  const [relations, setRelations] = useState<SearchRelation[]>([])
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
      setRelations(result.relations)
      setSearchTime(Math.round(performance.now() - start))
    } catch {
      setResults([])
      setRelations([])
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

      {/* ═══ LEFT: Source Tree ═══ */}
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

      {/* ═══ CENTER: Search + Results ═══ */}
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
                <p className="text-xs">Testa o retrieval híbrido (70% vector + 30% FTS)</p>
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
                  {chunk.access_count > 0 && <span>👁 {chunk.access_count}x</span>}
                  {chunk.score < 0.5 && <span className="text-red-400">⚠ abaixo threshold</span>}
                </div>
              </button>
            ))}
          </div>
        </ScrollArea>
      </div>

      {/* ═══ RIGHT: Inspector ═══ */}
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
                    {'score' in selectedChunk ? (selectedChunk as SearchChunk).score.toFixed(2) : '—'}
                  </div>
                </div>
                <div className="rounded-md bg-accent p-2.5">
                  <div className="text-[10px] uppercase text-zinc-500">Chars</div>
                  <div className="text-base font-bold">{selectedChunk.conteudo.length}</div>
                </div>
                <div className="rounded-md bg-accent p-2.5">
                  <div className="text-[10px] uppercase text-zinc-500">Source</div>
                  <div className="truncate text-xs font-bold">{selectedSource?.titulo ?? '—'}</div>
                </div>
              </div>

              {/* Full text */}
              <div>
                <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Texto Completo</div>
                <div className="max-h-[200px] overflow-y-auto whitespace-pre-wrap rounded-md bg-accent p-3 text-xs leading-relaxed text-muted-foreground">
                  {selectedChunk.conteudo}
                </div>
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
```

- [ ] **Step 2: Verificar typecheck**

Run: `npm run typecheck`
Expected: 0 errors (componente não está montado ainda, mas imports devem resolver)

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/componentes/RagPlayground.tsx
git commit -m "feat(ui): create RagPlayground component — 3-panel layout with source tree, search, inspector"
```

### Task 5: Montar na MemoriaPagina como 4a tab DEV-only

**Files:**
- Modify: `src/renderer/src/paginas/MemoriaPagina.tsx`

- [ ] **Step 1: Adicionar import lazy do RagPlayground**

No topo de MemoriaPagina.tsx, após os imports existentes:

```typescript
import { lazy, Suspense } from 'react'
import { Zap } from 'lucide-react'

const RagPlayground = lazy(() =>
  import('@/componentes/RagPlayground').then(m => ({ default: m.RagPlayground }))
)
```

Adicionar `Zap` ao import de lucide-react existente (não duplicar o import). Adicionar `Suspense` ao import de react existente.

- [ ] **Step 2: Adicionar TabsTrigger DEV-only**

Dentro do `<TabsList>`, após o trigger de "relacoes", adicionar:

```tsx
{import.meta.env.DEV && (
  <TabsTrigger value="avancado">
    <Zap className="mr-1.5 size-3.5" />
    Avançado
    <Badge className="ml-1.5 bg-orange-900/50 px-1.5 py-0 text-[9px] text-orange-400 hover:bg-orange-900/50">
      DEV
    </Badge>
  </TabsTrigger>
)}
```

- [ ] **Step 3: Adicionar TabsContent DEV-only**

Antes do fechamento `</Tabs>`, adicionar:

```tsx
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
```

- [ ] **Step 4: Verificar typecheck**

Run: `npm run typecheck`
Expected: 0 errors

- [ ] **Step 5: Testar visualmente**

Run: `npm run dev`
- Navegar até Memória
- Deve aparecer 4a aba "Avançado" com badge DEV
- Clicar → RagPlayground renderiza com 3 painéis
- Source tree carrega as fontes existentes
- Expandir source → mostra chunks
- Digitar query → resultados com scores aparecem
- Clicar result → inspector mostra detalhes

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/paginas/MemoriaPagina.tsx
git commit -m "feat(ui): add RAG Playground as DEV-only tab in MemoriaPagina"
```

---

### Task 6: Simplificar aba Relações — 1 graph unificado, sem filtro origem

**Files:**
- Modify: `src/renderer/src/paginas/MemoriaPagina.tsx`

- [ ] **Step 1: Remover Select de filtro usuario/sistema na aba Relações**

No `TabsContent value="relacoes"`, remover o `<Select value={filtroGraph}>` e todo o bloco SelectContent/SelectItem. Substituir por um título simples:

```tsx
<div className="flex items-center gap-2">
  <Network className="size-4 text-muted-foreground" />
  <span className="text-sm font-medium">Grafo de Conhecimento</span>
  {graphStats && graphStats.entities_count > 0 && (
    <Badge variant="outline" className="text-xs">
      {graphStats.entities_count} entidades · {graphStats.relations_count} relacoes
    </Badge>
  )}
</div>
```

- [ ] **Step 2: Mudar state e calls do graph pra não filtrar por origem**

Remover o state `filtroGraph`. Mudar `carregarGraphStats()` e `carregarGraphData()` pra chamar sem parâmetro de `origem` (retorna tudo). Remover o `useEffect` que depende de `[filtroGraph]` e substituir por um `useEffect([], [])` que carrega uma vez.

- [ ] **Step 3: Simplificar botão "Atualizar Relações"**

Manter 1 único botão que:
- Sempre visível (não condicional a filtro)
- Em dev: label "Rebuild Graph" (processa tudo)
- Em prod: label "Atualizar Relações" (processa só chunks do usuário)
- Remover o botão "Rebuild Graph" separado do sistema

```tsx
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
  {rebuildingGraph ? 'Analisando...' : 'Atualizar Relacoes'}
</Button>
```

Atualizar `handleRebuildGraph` pra sempre chamar `rebuildGraph('usuario')` — o emaranhamento com sistema acontece naturalmente porque as entidades do seed já existem na tabela.

- [ ] **Step 4: Verificar typecheck**

Run: `npm run typecheck`
Expected: 0 errors

- [ ] **Step 5: Testar visualmente**

Run: `npm run dev`
- Navegar até Memória → Relações
- NÃO deve ter dropdown usuario/sistema
- Deve mostrar graph unificado (sistema + usuario juntos)
- Botão "Atualizar Relações" deve funcionar

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/paginas/MemoriaPagina.tsx
git commit -m "refactor(ui): unify graph view — remove origin filter, single update button"
```

---

## Notas de Design

### O que NÃO está no escopo (backlog)

- **Embedding heatmap visual**: mostrado no mockup mas é puramente estético. Os embeddings não são retornados pelo IPC atual. Pode ser adicionado depois se quiser (novo handler que retorna o array float[768]).
- **FTS tokens (tsvector)**: requer query `ts_debug()` do Postgres. Possível mas não essencial agora.
- **Filtro por modo de busca** (vector-only, fts-only): `searchKnowledge` hoje só faz hybrid. Precisaria refatorar pra aceitar modo. Backlog.
- **Embedding Space** (tab com t-SNE/UMAP): requer computação heavy. Backlog futuro.
- **Tab "Todos os Chunks"**: lista paginada de todos os chunks. Simples mas não essencial pro playground.

### Decisões

- **Lazy load**: RagPlayground é carregado via `React.lazy` pra não pesar no bundle de produção (dead code elimination do Vite remove a tab DEV-only, mas o lazy garante que o código do componente nem é importado).
- **Sem componente shadcn novo**: usa apenas os 32 que já existem.
- **Sem estado global (Zustand)**: estado local no componente. É uma ferramenta dev, não precisa de store.
- **Scroll independente por painel**: cada painel tem seu próprio `ScrollArea`, não compete com o `<main>` do App.tsx (respeita o Layout Contract).
