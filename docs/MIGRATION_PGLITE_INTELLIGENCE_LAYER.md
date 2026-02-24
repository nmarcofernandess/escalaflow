# MIGRATION — SQLite → PGlite + Intelligence Layer

> **Status: COMPLETO** — Todas as 8 fases implementadas. tsc 0 erros.
>
> **Objetivo:** Migrar EscalaFlow de better-sqlite3 para PGlite e implementar RAG + Knowledge Graph como blueprint replicavel.
>
> **Principio:** EscalaFlow = Laboratorio. O pattern final (Vercel AI SDK + Postgres + Tool Calling + RAG + Graph) sera replicado em DietFlow, CognitiveOverflow, etc.
>
> **Delta de estrategia:** Analise competitiva de OpenClaw e AutoClaude/Graphiti refinou o plano original com 7 melhorias: Dual Capture (HIGH/LOW), importance boost, temporal validity, lazy decay, graceful degradation, graph extraction condicional, access tracking.

---

## RESUMO DAS FASES

| Fase | Status | Resumo |
|------|--------|--------|
| 1 - Database Layer | DONE | `pglite.ts` singleton async + pgvector + pg_trgm |
| 2 - Query Helpers | DONE | `query.ts` — queryOne, queryAll, execute, insertReturningId, transaction, execDDL |
| 3 - Migracao 9 arquivos | DONE | 376 call sites migrados (tipc 166, tools 73, discovery 19, etc) |
| 4 - IA Layer | DONE | tools.ts + discovery.ts + cliente.ts — all async |
| 5 - Motor | DONE | solver-bridge.ts (18) + validador.ts (5) |
| 6 - Cleanup + Wiring | DONE | database.ts deletado, better-sqlite3 removido, config atualizada |
| 7 - Knowledge Layer | DONE | DDL_V7 (4 tabelas), embeddings, chunking, ingest (Dual Capture), search (hybrid + graceful degradation) |
| 8 - Knowledge Tools IA | DONE | 4 tools (buscar/salvar/explorar/listar), system-prompt s8, discovery stats, auto-capture hook |

---

## FASE 1-6: MIGRACAO CORE (COMPLETA)

### Superficie de Impacto Migrada

| Arquivo | Call sites | Tipo |
|---------|-----------|------|
| `tipc.ts` | 166 | .get→queryOne, .all→queryAll, .run→execute, lastInsertRowid→insertReturningId |
| `tools.ts` | 73 | Mesma conversao + SQL syntax (date, ILIKE, ON CONFLICT) |
| `discovery.ts` | 19 | Async + date functions Postgres |
| `solver-bridge.ts` | 18 | buildSolverInput + persistirSolverResult async |
| `schema.ts` | 26 | DDL rewrite completo (SERIAL, BOOLEAN, TIMESTAMPTZ) |
| `seed.ts` | 17 | Async + ON CONFLICT DO NOTHING |
| `seed-local.ts` | 41 | Async + booleans nativos |
| `validador.ts` | 5 | Async, sem db param |
| `cliente.ts` | 2 | queryOne async |
| **TOTAL** | **376** | — |

### Conversoes Aplicadas

| Pattern SQLite | Pattern Postgres |
|----------------|-----------------|
| `INTEGER PRIMARY KEY AUTOINCREMENT` | `SERIAL PRIMARY KEY` |
| `datetime('now')` | `NOW()` |
| `date('now')` / `date('now', '+N days')` | `CURRENT_DATE` / `CURRENT_DATE + INTERVAL 'N days'` |
| `INSERT OR REPLACE` | `INSERT ... ON CONFLICT DO UPDATE` |
| `INSERT OR IGNORE` | `INSERT ... ON CONFLICT DO NOTHING` |
| `LIKE ? COLLATE NOCASE` | `ILIKE $N` |
| `?` placeholders | `$1, $2, $3...` (auto via helper) |
| `.lastInsertRowid` | `RETURNING id` |
| `PRAGMA foreign_keys OFF/ON` | `SET session_replication_role = 'replica'/'origin'` |
| `BOOLEAN 1/0` | `BOOLEAN true/false` |

### Arquivos Core Criados

| Arquivo | Proposito |
|---------|-----------|
| `src/main/db/pglite.ts` | PGlite singleton, initDatabase(), pgvector + pg_trgm extensions |
| `src/main/db/query.ts` | Helpers: queryOne, queryAll, execute, insertReturningId, transaction, execDDL |

### Arquivos Core Modificados

| Arquivo | Mudanca |
|---------|---------|
| `src/main/db/schema.ts` | DDL rewrite 21 tabelas Postgres + migrations async |
| `src/main/db/seed.ts` | Async + syntax Postgres |
| `src/main/db/seed-local.ts` | Async + syntax Postgres |
| `src/main/db/database.ts` | **DELETADO** |
| `src/main/index.ts` | Boot async: await initDatabase → createTables → seeds |
| `src/main/tipc.ts` | 166 call sites |
| `src/main/ia/tools.ts` | 73 call sites |
| `src/main/ia/discovery.ts` | 19 call sites |
| `src/main/ia/cliente.ts` | 2 call sites |
| `src/main/motor/solver-bridge.ts` | 18 call sites async |
| `src/main/motor/validador.ts` | 5 call sites, async |
| `package.json` | -better-sqlite3, +@electric-sql/pglite |
| `electron.vite.config.ts` | Ajuste bundler (WASM) |
| `electron-builder.yml` | Removido better-sqlite3 references |

---

## FASE 7: KNOWLEDGE LAYER — SCHEMA + BACKEND (COMPLETA)

### 7.1 DDL_V7_KNOWLEDGE — 4 tabelas

Adicionado em `src/main/db/schema.ts`. Chamado via `await execDDL(DDL_V7_KNOWLEDGE)` no `createTables()`.

```sql
-- knowledge_sources: Fontes originais de conhecimento
CREATE TABLE IF NOT EXISTS knowledge_sources (
  id SERIAL PRIMARY KEY,
  tipo TEXT NOT NULL DEFAULT 'manual' CHECK (tipo IN ('manual', 'auto_capture')),
  titulo TEXT NOT NULL,
  conteudo_original TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  importance TEXT NOT NULL DEFAULT 'high' CHECK (importance IN ('high', 'low')),
  criada_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizada_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- knowledge_chunks: Chunks com embeddings (RAG)
CREATE TABLE IF NOT EXISTS knowledge_chunks (
  id SERIAL PRIMARY KEY,
  source_id INTEGER NOT NULL REFERENCES knowledge_sources(id) ON DELETE CASCADE,
  conteudo TEXT NOT NULL,
  embedding vector(768),          -- Gemini text-embedding-004 = 768 dims
  search_tsv TSVECTOR,            -- FTS portugues
  importance TEXT NOT NULL DEFAULT 'high' CHECK (importance IN ('high', 'low')),
  access_count INTEGER NOT NULL DEFAULT 0,
  last_accessed_at TIMESTAMPTZ,
  criada_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Indices: idx_chunks_tsv (GIN), idx_chunks_trgm (GIN gin_trgm_ops)
-- NOTA: IVFFlat index omitido (PGlite precisa de dados pra construir)

-- knowledge_entities: Entidades do Knowledge Graph
CREATE TABLE IF NOT EXISTS knowledge_entities (
  id SERIAL PRIMARY KEY,
  nome TEXT NOT NULL,
  tipo TEXT NOT NULL,              -- REGRA, LEI, CONCEITO, PROCEDIMENTO, PESSOA, SETOR
  embedding vector(768),
  valid_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  valid_to TIMESTAMPTZ DEFAULT NULL,  -- NULL = ainda valido (Temporal Validity)
  criada_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(nome, tipo)
);

-- knowledge_relations: Relacoes entre entidades
CREATE TABLE IF NOT EXISTS knowledge_relations (
  id SERIAL PRIMARY KEY,
  entity_from_id INTEGER NOT NULL REFERENCES knowledge_entities(id) ON DELETE CASCADE,
  entity_to_id INTEGER NOT NULL REFERENCES knowledge_entities(id) ON DELETE CASCADE,
  tipo_relacao TEXT NOT NULL,     -- EXIGE, PARTE_DE, RELACIONADO_A, SUBSTITUIDA_POR, APLICA_SE_A
  peso REAL NOT NULL DEFAULT 1.0,
  valid_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  valid_to TIMESTAMPTZ DEFAULT NULL,
  criada_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Indices: idx_relations_from, idx_relations_to
```

### 7.2 Types — 4 interfaces em `src/shared/types.ts`

- `KnowledgeSource` — tipo, titulo, importance, metadata JSONB
- `KnowledgeChunk` — conteudo, importance, access_count, last_accessed_at
- `KnowledgeEntity` — nome, tipo, valid_from, valid_to (temporal validity)
- `KnowledgeRelation` — entity_from_id, entity_to_id, tipo_relacao, peso, valid_from, valid_to

### 7.3 Embeddings — `src/main/knowledge/embeddings.ts`

- Resolve provider via `configuracao_ia` (mesmo pattern do `cliente.ts`)
- Gemini: `text-embedding-004` → 768 dims
- `generateEmbedding(text)` → `number[] | null`
- `generateEmbeddings(texts)` → `number[][] | null`
- **Graceful degradation:** NUNCA lanca erro — retorna null

### 7.4 Chunking — `src/main/knowledge/chunking.ts`

- Recursive text splitter: `\n\n` → `\n` → `. ` → fallback por tamanho
- Default: 1500 chars max, 200 overlap
- Retorna `string[]`

### 7.5 Ingest — `src/main/knowledge/ingest.ts` (Dual Capture)

Pipeline `ingestKnowledge(titulo, conteudo, importance)`:

1. INSERT em `knowledge_sources` (tipo=manual se HIGH, auto_capture se LOW)
2. `chunkText(conteudo)` → chunks
3. `generateEmbeddings(chunks)` → embeddings (ou null se API offline)
4. INSERT em `knowledge_chunks` com embedding::vector + to_tsvector('portuguese')
5. **SOMENTE se importance='high':** Graph extraction via LLM (`generateObject` com Zod schema)
6. INSERT entidades (idempotente: check antes de INSERT) + relacoes

**Delta #1 (Dual Capture):** HIGH = full pipeline + graph. LOW = chunk + embed only.
**Delta #7 (Graph condicional):** `if (importance === 'high')` — LOW NUNCA chama LLM.

### 7.6 Search — `src/main/knowledge/search.ts` (Hybrid + Graceful Degradation)

**Funcoes exportadas:**
- `searchKnowledge(query, options)` — entry point
- `exploreRelations(entidade, profundidade)` — CTE recursivo

**Estrategia de busca (3 camadas):**

1. **Hybrid Search:** 70% vector + 30% FTS via FULL OUTER JOIN
   - CTE `vector_results` (cosine similarity) + `fts_results` (ts_rank)
   - **Delta #4 (Lazy Decay):** `NOT (importance = 'low' AND access_count = 0 AND criada_em < NOW() - INTERVAL '30 days')`
   - **Delta #5 (Importance Boost):** HIGH ganha +0.15 no score. LOW precisa score > 0.6.
2. **Graph Enrichment:** Busca relacoes validas das entidades nos chunks
   - **Delta #3 (Temporal Validity):** Filtra `valid_to IS NULL OR valid_to > NOW()` em entities E relations
3. **Access Tracking:** UPDATE `access_count + 1` e `last_accessed_at = NOW()` nos chunks retornados
   - **Delta #2 (Access Tracking):** Alimenta lazy decay e analytics

**Graceful Degradation (Delta #6):**
```
searchKnowledge()
  → generateEmbedding(query) OK? → hybridSearch (vector + FTS)
  → embedding null/falhou?       → keywordOnlySearch (FTS + trigram)
  → tudo falhou?                  → emptyResult() (NUNCA lanca erro)
```

`keywordOnlySearch` aplica os mesmos filtros de lazy decay e importance boost.

---

## FASE 8: KNOWLEDGE TOOLS IA (COMPLETA)

### 8.1 — 4 Tools em `src/main/ia/tools.ts`

| Tool | Schema Zod | Handler | Chama |
|------|-----------|---------|-------|
| `buscar_conhecimento` | consulta (string), limite (1-10, default 5) | Retorna chunks + relations + context_for_llm | `searchKnowledge()` |
| `salvar_conhecimento` | titulo, conteudo, importance (high/low, default high) | Retorna source_id, chunks_count, entities_count | `ingestKnowledge()` |
| `explorar_relacoes` | entidade (string), profundidade (1-3, default 2) | Retorna entidades + relacoes em arvore | `exploreRelations()` |
| `listar_conhecimento` | tipo (todos/manual/auto_capture), limite (1-50, default 20) | Retorna sources + stats globais | queryAll + stats |

Todos seguem patterns existentes: `toolOk/toolError`, Zod `.describe()`, `correction` em erros.

### 8.2 — TOOL_SCHEMAS sincronizado: 32/32

4 entries adicionadas em `IA_TOOLS` (Gemini format) + 4 em `TOOL_SCHEMAS` (Zod validation).

### 8.3 — Auto-capture hook em `cliente.ts`

```typescript
async function maybeAutoCapture(response: string): Promise<void> {
  // Heuristica: regex pra Art., CLT, CCT, Lei, Portaria, NR, ECA, interjornada/intrajornada
  // Se match: extrai trecho relevante, chama ingestKnowledge(titulo_auto, conteudo, 'low')
  // Fire-and-forget: .catch(() => {}) — NUNCA bloqueia a resposta
  // Conservador: na duvida, NAO salva
}
```

Chamado em 3 pontos: fim do `_callWithVercelAiSdkTools` + 2 returns do `_callWithVercelAiSdkToolsStreaming`.

### 8.4 — System Prompt secao 8 (Base de Conhecimento)

Adicionada em `system-prompt.ts`:
- Quando usar cada tool
- Diferenca com `consultar` (dados estruturados vs texto livre semantico)
- Regras de auto-capture (conservador, sem poluir)

### 8.5 — Discovery stats em `discovery.ts`

```typescript
async function _statsKnowledge(): Promise<string | null>
// Retorna: "X fonte(s) | Y chunks indexados | Z entidade(s) ativa(s)"
// Filtra entidades por valid_to IS NULL (temporal validity)
```

---

## DELTA COMPETITIVO — 7 REFINAMENTOS IMPLEMENTADOS

Todos os 7 refinamentos da analise competitiva (OpenClaw, AutoClaude/Graphiti) foram implementados:

| # | Refinamento | Origem | Status | Evidencia |
|---|------------|--------|--------|-----------|
| 1 | **Dual Capture** (HIGH=full, LOW=chunk+embed only) | Graphiti | DONE | `ingest.ts:72` if importance=high |
| 2 | **importance + access_count + last_accessed_at** | OpenClaw | DONE | DDL, types, trackAccess() |
| 3 | **Temporal Validity** (valid_from/valid_to em entities+relations) | Graphiti | DONE | DDL, search WHERE filters, CTE recursivo |
| 4 | **Lazy Decay** (LOW 30d sem acesso → invisivel) | OpenClaw | DONE | WHERE clause em hybrid + keyword search |
| 5 | **Importance Boost** (HIGH +0.15, LOW threshold 0.6) | AutoClaude | DONE | CASE WHEN no SQL, WHERE importance='high' OR score>0.6 |
| 6 | **Graceful Degradation** (embedding→keyword→empty, nunca throw) | Best practice | DONE | try/catch chain, null returns |
| 7 | **Graph only for HIGH** (LOW nunca chama LLM) | Economia | DONE | Condicional em ingest.ts |

---

## CHECKLIST DE VALIDACAO

### Fases 1-6: Migracao Core
- [x] PGlite inicializa sem erro
- [x] pgvector e pg_trgm carregados
- [x] 21 tabelas criadas com schema Postgres correto
- [x] Migrations idempotentes funcionando
- [x] Query helpers funcionando (queryOne, queryAll, execute, insertReturningId, transaction)
- [x] Conversao `?` → `$1` automatica
- [x] `npm run typecheck` — 0 erros
- [x] 376 call sites migrados em 9 arquivos
- [x] database.ts deletado
- [x] better-sqlite3 removido do package.json
- [x] Boot async funcionando

### Fase 7: Knowledge Layer Backend
- [x] DDL_V7_KNOWLEDGE — 4 tabelas criadas
- [x] 4 interfaces TypeScript em types.ts
- [x] Embedding via Gemini text-embedding-004 (768d)
- [x] Chunking recursivo (1500 chars, 200 overlap)
- [x] Ingestao Dual Capture (HIGH=full pipeline, LOW=sem graph)
- [x] Hybrid search (70% vector + 30% FTS)
- [x] Keyword-only fallback (FTS + trigram)
- [x] Graph traversal via CTE recursivo
- [x] Temporal validity em entities + relations
- [x] Lazy decay (LOW 30d sem acesso = invisivel)
- [x] Importance boost (+0.15 HIGH, threshold 0.6 LOW)
- [x] Graceful degradation (embedding→keyword→empty)
- [x] Access tracking (count + last_accessed_at)

### Fase 8: Knowledge Tools IA
- [x] 4 tools registradas (buscar, salvar, explorar, listar)
- [x] TOOL_SCHEMAS sincronizado (32/32)
- [x] System prompt secao 8 adicionada
- [x] Discovery expandido com knowledge stats
- [x] Auto-capture hook em cliente.ts (regex heuristica, fire-and-forget)
- [x] Handlers com toolOk/toolError + correction

### Verificacao Final
- [x] `npm run typecheck` — 0 erros (node + web)
- [x] snake_case mantido em todo campo banco/IPC/TS
- [x] `better-sqlite3` nao aparece em nenhum import
- [x] `TOOL_SCHEMAS` = 32 entries sincronizado com `IA_TOOLS`

---

## ARQUIVOS CRIADOS

| Arquivo | Proposito |
|---------|-----------|
| `src/main/db/pglite.ts` | PGlite singleton, initDatabase(), extensions |
| `src/main/db/query.ts` | Query helpers (queryOne, queryAll, execute, insertReturningId, transaction, execDDL) |
| `src/main/knowledge/embeddings.ts` | Embedding via AI SDK (Gemini text-embedding-004, 768d) |
| `src/main/knowledge/chunking.ts` | Recursive text splitter |
| `src/main/knowledge/ingest.ts` | Dual Capture pipeline (RAG + Graph condicional) |
| `src/main/knowledge/search.ts` | Hybrid search + graceful degradation + graph traversal |

## ARQUIVOS MODIFICADOS

| Arquivo | Mudanca |
|---------|---------|
| `src/main/db/schema.ts` | DDL rewrite Postgres + DDL_V7_KNOWLEDGE (4 tabelas knowledge) |
| `src/main/db/seed.ts` | Async + syntax Postgres |
| `src/main/db/seed-local.ts` | Async + syntax Postgres |
| `src/main/db/database.ts` | **DELETADO** (substituido por pglite.ts) |
| `src/main/index.ts` | Boot async |
| `src/main/tipc.ts` | 166 call sites migrados |
| `src/main/ia/tools.ts` | 73 call sites + 4 tools knowledge (32 total) |
| `src/main/ia/discovery.ts` | 19 call sites + _statsKnowledge() |
| `src/main/ia/cliente.ts` | 2 call sites + maybeAutoCapture() |
| `src/main/ia/system-prompt.ts` | +Secao 8 (Base de Conhecimento) |
| `src/main/motor/solver-bridge.ts` | 18 call sites async |
| `src/main/motor/validador.ts` | 5 call sites, async |
| `src/shared/types.ts` | +4 interfaces Knowledge |
| `package.json` | -better-sqlite3, +@electric-sql/pglite |
| `electron.vite.config.ts` | Ajuste bundler WASM |
| `electron-builder.yml` | Removido better-sqlite3 |

---

## NOTAS TECNICAS

### Embedding Dimension
- Gemini `text-embedding-004` = **768 dims** (provider principal do EscalaFlow)
- Se trocar pra OpenAI `text-embedding-3-small` = 1536 dims (requer ALTER TABLE)

### IVFFlat Index
- Omitido do DDL porque PGlite pode nao suportar criacao em tabelas vazias
- Busca funciona sem ele (scan sequencial) — so fica mais lento com muitos dados
- Pode ser adicionado manualmente apos acumular dados suficientes

### Auto-capture Heuristica
- Regex: `/\b(Art\.\s*\d+|CLT|CCT|Lei\s+\d+|Portaria|NR-?\d+|ECA|interjornada|intrajornada)\b/i`
- Conservador: na duvida, NAO salva (melhor perder do que poluir)
- Fire-and-forget: nunca bloqueia a resposta da IA

---

*Concluido: 2026-02-23 | EscalaFlow Intelligence Layer v1.0*
