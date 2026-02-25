# SPEC UNIFICADA: Intelligence Layer — Implementação Consolidada

> **Status:** Fases 0-3 COMPLETAS | Fase 4 (MemoriaPagina refactor) próxima | Fases 5-6 backlog
> **Data:** 2026-02-24 (v2 — atualizado pós Fase 3)
> **Origem:** Merge de `SPEC-KNOWLEDGE-AUDIT.md` (sessão A) + `RESEARCH-RAG-MEMORY-PATTERNS.md` (sessão B)
> **Conflitos:** 7 resolvidos (ver seção "Conflitos Resolvidos")

---

## TL;DR

Fases 0-3 implementadas: embedding migration (768d), memórias backend (33 tools), Auto-RAG + context hints, importação completa (PDF, modal rico, IA metadata, toggle ativo). **Próxima:** Fase 4 (MemoriaPagina refactor com 2 tabs + CRUD memórias visual). **Backlog:** Session Indexing + Smart Extraction (Fase 5), Graph por Chunk (Fase 6).

---

## 1. O QUE JÁ EXISTE NO CÓDIGO (Fase 1 — sessão A)

### 1.1 Memórias (ia_memorias) — ✅ COMPLETO

| Item | Arquivo | Status |
|------|---------|--------|
| DDL `DDL_V8_MEMORIAS` | `schema.ts` | ✅ `ia_memorias (id SERIAL, conteudo TEXT, criada_em, atualizada_em)` |
| Interface `IaMemoria` | `types.ts` | ✅ `{ id, conteudo, criada_em, atualizada_em }` |
| 4 IPC handlers | `tipc.ts` | ✅ `ia.memorias.listar/salvar/remover/contar` |
| 3 IA tools | `tools.ts` | ✅ `salvar_memoria`, `listar_memorias`, `remover_memoria` |
| Discovery injection | `discovery.ts` | ✅ `_memorias()` → injeta TODAS no início do briefing |
| System prompt | `system-prompt.ts` | ✅ Seção 8 reescrita (Memórias + RAG separados) |
| Serviço renderer | `servicos/memorias.ts` | ✅ `listar/salvar/remover/contar` |
| **Total tools IA** | `tools.ts` | **33** (28 originais + explorar_relacoes + 3 memórias + salvar_conhecimento) |

**Funciona agora:** IA cria/lista/remove memórias via tools, discovery injeta 20 max, IPC pronto pra UI.
**NÃO funciona:** UI na MemoriaPagina (Fase 4), Auto-RAG (Fase 2).

### 1.2 Knowledge Layer — ✅ PARCIAL (existia antes da sessão A)

| Item | Status | Detalhe |
|------|--------|---------|
| `knowledge_sources` | ✅ | Tabela existe (DDL_V7_KNOWLEDGE) |
| `knowledge_chunks` | ✅ | Com `source_id` FK CASCADE, embedding vector(768), FTS |
| `knowledge_entities` | ✅ | Tabela existe, SEM source tracking (rebuild resolve) |
| `knowledge_relations` | ✅ | Tabela existe |
| Embedding model | ✅ | `Xenova/multilingual-e5-base` (768d, local ONNX) |
| `ingestKnowledge()` | ✅ | chunk → embed → INSERT. `entities_count` sempre 0 |
| `searchKnowledge()` | ✅ | Hybrid 70% vector + 30% FTS, lazy decay 30d |
| 4 knowledge tools | ✅ | buscar/salvar/listar/explorar_relacoes |
| `maybeAutoCapture()` | ✅ | Heurística regex CLT/CCT → salva como LOW |
| Campo `ativo` em sources | ✅ | Adicionado no DDL + migration (Fase 0) |
| Auto-RAG no discovery | ✅ | `_autoRag()` busca chunks, injeta título+hint (~300 chars) — Fase 2 |
| Context hints nos docs | ✅ | `<!-- quando_usar -->` em todos 9 .md — Fase 2 |
| Import completo (PDF, IA metadata) | ✅ | 5 handlers novos, 2 dialogs, toggle ativo — Fase 3 |
| `ia/config.ts` (helpers extraídos) | ✅ | `resolveProviderApiKey`, `resolveModel` reutilizáveis — Fase 3 |

### 1.3 Docs de Knowledge (9 arquivos)

```
knowledge/
├── clt/
│   ├── contratos.md
│   ├── feriados-cct.md
│   ├── intervalos-descanso.md
│   └── jornada-regras.md
└── sistema/
    ├── entidades.md
    ├── fluxos-trabalho.md
    ├── perguntas-frequentes.md
    ├── regras-colaborador.md
    └── visao-geral.md
```

**Todos** têm context hint `<!-- quando_usar -->` — adicionados na Fase 2 e re-ingestados via migration v11.

---

## 2. CONFLITOS RESOLVIDOS (sessão A vs sessão B)

| # | Conflito | Sessão A diz | Sessão B diz | Resolução |
|---|----------|-------------|-------------|-----------|
| C1 | **Embedding model** | e5-small (384d) OK | Migrar pra modelo maior | **Revisado.** Qwen3 descartado (sem Transformers.js nativo). Migrado pra e5-base (768d) |
| C2 | **Vector dims** | 384 no schema | 768 necessário pra e5-base | **Implementado.** Migration pgvector 384→768 (Fase 0 COMPLETA) |
| C3 | **maybeAutoCapture** | Mantém (CLT/CCT regex) | Substituir por Smart Extraction (LLM ao mudar chat) | **Sessão B vence.** Remover heurística regex. Smart Extraction com LLM é superior. Fase 4 |
| C4 | **Auto-RAG** | Fase 2: `searchKnowledge(mensagem)` no discovery | D5: AI SDK Middleware `transformParams` | **Sessão B vence.** Middleware é mais limpo (desacoplado do discovery). Mas resultado similar |
| C5 | **Memórias dinâmicas (auto-extracted)** | Não previsto | D2: LLM extrai ao mudar de chat, max 100 LOW com decay | **Sessão B adiciona.** Não conflita com A — é feature nova |
| C6 | **History Compaction** | Não previsto | D6: Summary Buffer ~30K tokens | **Sessão B adiciona.** Não conflita — feature nova necessária |
| C7 | **Graph source tracking** | Não mencionado | D10: Rebuild completo, sem junction table | **Alinhados.** Spec A já diz "rebuild do zero". Sessão B formalizou |

---

## 3. DECISÕES CONSOLIDADAS (D1-D10)

### D1. Embedding: multilingual-e5-base ONNX (substitui e5-small) — ✅ IMPLEMENTADO
- 768d, ~110M params, mesma família do e5-small, português nativo
- 100% local via `@huggingface/transformers`, offline, zero API
- Prefixes obrigatórios: `query:` (busca) / `passage:` (indexação) para qualidade correta
- Trade-off: ~50-200ms vs 16ms. Aceitável (LLM leva 2-5s)
- **Qwen3-Embedding-0.6B descartado:** sem suporte nativo Transformers.js, ~600MB-1.2GB, 380ms
- **Impacto:** Migration pgvector 384→768, cleanup + re-seed de chunks

### D2. Smart Extraction: ao mudar de chat ou antes de compactar
- LLM extrai fatos/preferências/correções da conversa completa
- 1 chamada por conversa (não por mensagem)
- Merge inteligente: cosine > 0.85 = atualiza, senão insere
- Tipo LOW, max 100 entries, decay 30 dias

### D3. Modelo de extração: mesmo do chat (zero config)
- Sem dropdown extra. Sem `resolveExtractionModel()`.
- Se user tem Gemini configurado → Gemini extrai. Se Claude → Claude.

### D4. Toggle "Memória Automática" na MemoriaPagina
- ON: Session Indexing + Smart Extraction ao mudar de chat
- OFF: Só manual (chat "salva isso" ou importar doc)
- Memória manual funciona SEMPRE

### D5. Auto-Recall via Middleware (grátis, a cada mensagem)
- Embedding da pergunta → hybrid search → Top-K chunks → injeta no prompt
- Via `LanguageModelV3Middleware.transformParams` (AI SDK v6)
- Custo zero (embedding local + SQL)

### D6. History Compaction (Summary Buffer)
- Quando > ~30K tokens → resume msgs antigas, mantém N recentes
- Resumo cacheado em `ia_conversas.resumo_compactado`
- Não empilha: compacta de novo = sobrescreve

### D7. Session Indexing: conversa vira doc no Knowledge
- Ao fechar conversa → transcrição sanitizada → chunk → embed → INSERT
- Tipo "session", importance LOW, decay 30 dias
- Dedup por conversa_id em metadata
- Max 50 transcrições indexadas

### D8. Auto-update/merge de memórias dinâmicas
- Cosine > 0.85 entre memória nova e existente = substitui (info mais recente ganha)
- Corrections SEMPRE substituem facts anteriores

### D9. Limites de armazenamento

| Tipo | Max entries | Título | Conteúdo | Cleanup |
|------|------------|--------|----------|---------|
| Permanente (manual, HIGH) | 20 | 100 chars | 500 chars | User decide. Sem auto-remove |
| Dinâmica (auto, LOW) | 100 | 200 chars | 500 chars | FIFO por acesso + decay 30d |
| Session transcripts (LOW) | 50 | — | — | Oldest never-accessed first + decay 30d |

### D10. Graph: rebuild completo, sem source tracking
- Botão "Analisar Relações" → DELETE ALL → re-extrai de chunks ativos
- Idempotente: deletou doc = próximo rebuild não o inclui
- Sem junction table. Dado derivado, não fonte de verdade.

---

## 4. PLANO DE IMPLEMENTAÇÃO UNIFICADO

### Fase 0 — Migração Embedding — ✅ COMPLETA

> **Decisão revisada:** Qwen3-Embedding-0.6B descartado (sem Transformers.js nativo, 600MB+, 380ms).
> Migrado para `Xenova/multilingual-e5-base` (768d, mesma família, ~150-440MB, ~50-200ms).

| # | Ação | Arquivo | Status |
|---|------|---------|--------|
| 0.1 | Trocar modelo embedding + prefixes query/passage | `knowledge/embeddings.ts` | ✅ e5-base 768d, q8 |
| 0.2 | Migration pgvector 384→768 + campo `ativo` | `schema.ts` | ✅ DDL + migration cleanup |
| 0.3 | Download script atualizado | `scripts/download-embedding-model.ts` | ✅ e5-base + validação 768d |
| 0.4 | Ingest com prefix passage | `knowledge/ingest.ts` | ✅ `generatePassageEmbeddings()` |
| 0.5 | Search com prefix query | `knowledge/search.ts` | ✅ `generateQueryEmbedding()` |

### Fase 1 — Memórias Backend — ✅ COMPLETA
> 33 tools, 4 IPC handlers, discovery injection, serviço renderer. Ver SPEC-KNOWLEDGE-AUDIT.md.

### Fase 2 — Auto-RAG + Context Hints — ✅ COMPLETA
> `_autoRag()` no discovery, hints nos 9 .md, filtro `ativo = true` no search. Ver SPEC-KNOWLEDGE-AUDIT.md.

### Fase 3 — Importação de Conhecimento + UI — ✅ COMPLETA
> pdf-parse@1.1.1, 5 IPC novos, `ia/config.ts` (helpers extraídos), `AdicionarConhecimentoDialog`, `VerConhecimentoDialog`, toggle ativo, IA metadata. Ver SPEC-KNOWLEDGE-AUDIT.md.

### Fase 4 — Refatorar MemoriaPagina (⏳ PRÓXIMA)

> **100% frontend.** Backend e serviços já existem. Reorganizar a página em 2 tabs, adicionar seção Memórias com CRUD visual.

| # | Ação | Arquivo | Detalhes |
|---|------|---------|----------|
| 4.1 | 2 tabs: Usuário e Sistema | `MemoriaPagina.tsx` | `Tabs` shadcn. Tab Usuário = memórias + docs user. Tab Sistema = docs seed read-only |
| 4.2 | Seção Memórias (tab Usuário) | `MemoriaPagina.tsx` | Cards editáveis inline, badge "X/20", botão "+ Nova Memória", remover com confirmação |
| 4.3 | Separação Sistema vs Usuário | `MemoriaPagina.tsx` | Tab Sistema: `tipo='sistema'` read-only. Tab Usuário: `tipo != 'sistema'` com controles |
| 4.4 | Seção Graph placeholder | `MemoriaPagina.tsx` | Status "Não analisado", botão disabled (Fase 6) |
| 4.5 | Stats cards por tab | `MemoriaPagina.tsx` | Contadores relevantes por contexto |

### Fase 5 — Session Indexing + Smart Extraction + Compaction (⏳ P2)

> **Inteligência de longo prazo:** IA "lembra" de conversas passadas.

| # | Ação | Arquivo | Detalhes |
|---|------|---------|----------|
| 5.1 | Session Indexing ao mudar chat | `tipc.ts` ou `cliente.ts` | Transcrição sanitizada → ingestKnowledge tipo "session" |
| 5.2 | Smart Extraction ao mudar chat | `cliente.ts` | LLM extrai fatos → merge com existentes (cosine > 0.85) |
| 5.3 | Remover `maybeAutoCapture()` | `cliente.ts` | Substituído por Smart Extraction |
| 5.4 | History Compaction | `cliente.ts` | Summary Buffer: resume msgs antigas quando > ~30K tokens |
| 5.5 | Campo `resumo_compactado` | `schema.ts` (migration) | `ALTER TABLE ia_conversas ADD COLUMN IF NOT EXISTS resumo_compactado TEXT` |
| 5.6 | Toggle "Memória Automática" | `MemoriaPagina.tsx` | Switch ON/OFF controla Session Indexing |
| 5.7 | Respeitar limites D9 | `knowledge/ingest.ts` | Max 100 dinâmicas, max 50 transcripts |

### Fase 6 — Graph por Chunk (⏳ P3/Backlog)

> **Extrair relações entre entidades dos docs.** Caro (LLM por chunk). Manual.

| # | Ação | Arquivo | Detalhes |
|---|------|---------|----------|
| 6.1 | `extractEntitiesFromChunk()` | `knowledge/graph.ts` (novo) | generateObject + Zod schema |
| 6.2 | `rebuildGraph()` | `knowledge/graph.ts` | DELETE ALL → lê chunks ativos → extrai → merge → insere |
| 6.3 | IPC `knowledge.analisarRelacoes` | `tipc.ts` | Chama rebuildGraph, retorna stats |
| 6.4 | UI: ativar botão + lista entidades | `MemoriaPagina.tsx` | "Analisar Relações" + loading + resultado expandível |

---

## 5. DEPENDÊNCIAS E PRIORIDADES

```
✅ Fase 0 (embedding 768d) — COMPLETA
✅ Fase 1 (memórias backend) — COMPLETA
✅ Fase 2 (Auto-RAG + hints) — COMPLETA
✅ Fase 3 (import + UI) — COMPLETA

⏳ Fase 4 (MemoriaPagina refactor) — PRÓXIMA
   └── 100% frontend, zero backend novo
   └── Backend de memórias (Fase 1) + conhecimento (Fase 3) pronto

⏳ Fase 5 (Session Indexing + Smart Extraction) — P2
   └── depende de embedding (Fase 0 ✅) pra merge cosine
   └── depende de campo ativo (Fase 2 ✅) pra filtrar

⏳ Fase 6 (Graph por Chunk) — P3
   └── depende de embedding (Fase 0 ✅)
   └── depende de IA configurada (LLM por chunk)
```

---

## 6. LAYOUT DA MEMORIAPAGINA (CONSOLIDADO)

```
MemoriaPagina
│
├── [Tab: Usuário]  [Tab: Sistema]
│
├── Se tab USUARIO:
│   │
│   ├── HEADER: Toggle "Memória Automática" [ON/OFF]
│   │   └── Descrição: "Quando ativa, a IA salva automaticamente..."
│   │
│   ├── SEÇÃO: Memórias (fatos do RH)
│   │   ├── Card: "Cleunice entra 08:00" [Editar] [Remover]
│   │   ├── Card: "Black Friday = 8 no Caixa" [Editar] [Remover]
│   │   ├── [+ Nova Memória]
│   │   └── Badge: "2/20"
│   │
│   ├── SEÇÃO: Conhecimento (docs processados)
│   │   ├── Item: "Política de Férias" | ● Ativo | 3 chunks | [Ver] [Toggle] [Remover]
│   │   ├── Item: "Acordo Coletivo" | ○ Inativo | 5 chunks | [Ver] [Toggle] [Remover]
│   │   └── [+ Adicionar Conhecimento]  ← abre modal
│   │
│   └── SEÇÃO: Relações (Graph)
│       ├── Status: "42 entidades, 67 relações" ou "Não analisado"
│       ├── [Analisar Relações]  ← rebuild do zero
│       └── Lista de entidades expandível
│
└── Se tab SISTEMA:
    │
    ├── SEÇÃO: Conhecimento do Sistema (read-only)
    │   ├── Item: "Regras de Jornada CLT" | 8 chunks
    │   ├── Item: "Visão Geral do Sistema" | 4 chunks
    │   └── ... (9 docs, sem editar/remover)
    │
    └── SEÇÃO: Relações do Sistema (read-only)
        └── Status + lista (se populado)
```

---

## 7. MODAL "ADICIONAR CONHECIMENTO" (CONSOLIDADO)

```
┌───────────────────────────────────────────────────┐
│  Adicionar Conhecimento                      [X]  │
│───────────────────────────────────────────────────│
│                                                   │
│  ┌───────────────────────────────────────────┐    │
│  │   Arraste um arquivo aqui                 │    │
│  │   (.txt  .md  .pdf)                       │    │
│  │   ou clique para selecionar               │    │
│  │          ──── ou ────                     │    │
│  │   Cole o texto diretamente abaixo ↓       │    │
│  └───────────────────────────────────────────┘    │
│                                                   │
│  Texto ─────────────────────────────── [✨ IA]    │
│  ┌───────────────────────────────────────────┐    │
│  │  (textarea editável)                      │    │
│  │  (pós-arquivo: texto extraído)            │    │
│  │  (manual: user cola/escreve)              │    │
│  └───────────────────────────────────────────┘    │
│                                                   │
│  Título ──────────────────────────── [✨ IA]      │
│  ┌───────────────────────────────────────────┐    │
│  │ Política de férias                        │    │
│  └───────────────────────────────────────────┘    │
│                                                   │
│  Quando a IA deve consultar ─────── [✨ IA]       │
│  ┌───────────────────────────────────────────┐    │
│  │ Perguntas sobre férias, antecedência...   │    │
│  └───────────────────────────────────────────┘    │
│                                                   │
│  [Cancelar]                          [Salvar]     │
│  (Salvar desabilitado se título ou desc vazio)    │
└───────────────────────────────────────────────────┘
```

**Botão ✨ IA nos 3 campos:**
- **Texto:** formata e corrige português SEM mudar conteúdo
- **Título:** gera título descritivo
- **Quando consultar:** gera context hint (amplia espaço semântico do embedding)

Se arquivo importado + IA configurada: 3 campos auto-preenchidos. User revisa.
Se IA não configurada: campos vazios, user preenche manual.

---

## 8. ANTI-PATTERNS (NÃO FAZER)

| Tentação | Por que não |
|----------|-----------|
| Aceitar .docx/.xlsx | Conversão complexa, user copia texto |
| Modos "sempre/nunca/IA decide" no doc | Toggle ativo/inativo é suficiente |
| Mostrar chunks/scores pro user | Infra invisível. User quer "conhecimento" |
| Memórias com embedding/search | Max 20, SEMPRE injetadas. Search é overkill |
| Graph automático no ingest | Caro, precisa visão global. Botão manual |
| Guardar arquivo original | Sempre texto processado |
| Junction table pra graph | Graph é rebuild completo, idempotente |
| RAG separado pra docs imported | Chunking + embedding JÁ É o RAG |
| maybeAutoCapture (regex CLT) | Substituído por Smart Extraction (D2) |
| Modelo separado pra extração | Mesmo do chat (D3). Zero config |
| Auto-capture a cada exchange | Caro e ruidoso. Ao mudar de chat (D2) |
| Reindexação periódica | PGLite indexa inline no INSERT |

---

## 9. SCHEMA COMPLETO (PÓS-MIGRATION)

```
MEMÓRIAS ✅ EXISTE
┌─────────────────────────────────────────────┐
│ ia_memorias                                 │
├─────────────────────────────────────────────┤
│ id            SERIAL PK                     │
│ conteudo      TEXT NOT NULL                 │
│ criada_em     TIMESTAMPTZ DEFAULT NOW()     │
│ atualizada_em TIMESTAMPTZ DEFAULT NOW()     │
└─────────────────────────────────────────────┘
Soft limit: 20 (permanente) via app

CONHECIMENTO ✅ (ativo implementado, import completo, vector 768d)
┌─────────────────────────────────────────────┐
│ knowledge_sources                           │
├─────────────────────────────────────────────┤
│ id                SERIAL PK                 │
│ tipo              sistema/manual/auto_capture/importacao_usuario │
│ titulo            TEXT NOT NULL              │
│ conteudo_original TEXT NOT NULL              │
│ metadata          JSONB {context_hint, ...}  │
│ importance        high/low                  │
│ ativo             BOOLEAN DEFAULT true ✅    │
│ criada_em / atualizada_em TIMESTAMPTZ       │
└─────────────────────────────────────────────┘
         │ 1:N CASCADE
┌─────────────────────────────────────────────┐
│ knowledge_chunks                            │
├─────────────────────────────────────────────┤
│ id            SERIAL PK                     │
│ source_id     FK → knowledge_sources        │
│ conteudo      TEXT                          │
│ embedding     vector(768) ✅                 │
│ search_tsv    TSVECTOR                      │
│ importance    high/low                      │
│ access_count  INTEGER DEFAULT 0             │
│ last_accessed_at TIMESTAMPTZ               │
└─────────────────────────────────────────────┘

CONVERSAS — PENDENTE (Fase 5)
┌─────────────────────────────────────────────┐
│ ia_conversas                                │
├─────────────────────────────────────────────┤
│ ...campos existentes...                     │
│ resumo_compactado TEXT  ←PENDENTE (Fase 5)  │
└─────────────────────────────────────────────┘

GRAPH — EXISTE (sem alteração, rebuild completo — Fase 6)
┌────────────────────────┐    ┌────────────────────────┐
│ knowledge_entities     │    │ knowledge_relations    │
├────────────────────────┤    ├────────────────────────┤
│ id, nome, tipo         │    │ entity_from_id FK      │
│ embedding vector(768)  │    │ entity_to_id FK        │
│ valid_from, valid_to   │    │ tipo_relacao, peso     │
└────────────────────────┘    └────────────────────────┘
```

---

## 10. REFERÊNCIAS

- Pesquisa completa: `docs/flowai/RESEARCH-RAG-MEMORY-PATTERNS.md`
- Spec original sessão A: `specs/knowledge-layer-audit/SPEC-KNOWLEDGE-AUDIT.md`
- Decisões detalhadas D1-D10: seção 12 do Research doc
- Descartados X1-X8: seção 12.2 do Research doc
