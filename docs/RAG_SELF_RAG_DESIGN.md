# Self-RAG — Design para EscalaFlow

## O que temos hoje (RAG 2.0)

```
┌──────────────────────────────────────────────────────────┐
│  FLUXO ATUAL: RAG Passivo                                │
│                                                          │
│  Usuário pergunta                                        │
│       │                                                  │
│       ▼                                                  │
│  ┌─────────────┐   auto-RAG (discovery.ts)               │
│  │  discovery   │──► searchKnowledge(mensagem, limite=3)  │
│  │  _autoRag()  │   resultado: só títulos + hints         │
│  └──────┬──────┘   (NÃO manda chunks pro LLM)            │
│         │                                                │
│         ▼                                                │
│  ┌─────────────┐                                         │
│  │  LLM recebe │   system prompt + discovery context     │
│  │  tudo junto  │   + "Conhecimento relevante: [títulos]" │
│  └──────┬──────┘                                         │
│         │                                                │
│         ├─── LLM decide chamar buscar_conhecimento? ──┐  │
│         │   (por conta própria, se achar necessário)   │  │
│         │                                              │  │
│         │ NÃO                                    SIM   │  │
│         │                                              ▼  │
│         │                                 ┌──────────────┐│
│         │                                 │ tool:         ││
│         │                                 │ buscar_       ││
│         │                                 │ conhecimento  ││
│         │                                 └──────┬───────┘│
│         │                                        │        │
│         │                     ┌───────────────────┤        │
│         │                     │                   │        │
│         │              embedding search    graph enrichment│
│         │              (70% vec + 30% FTS) (entidades nos  │
│         │                     │            chunks)         │
│         │                     ▼                   │        │
│         │              context_for_llm ◄──────────┘        │
│         │                     │                            │
│         │                     ▼                            │
│         │              LLM recebe chunks + relações        │
│         │                     │                            │
│         ▼                     ▼                            │
│  ┌──────────────────────────────────┐                     │
│  │         RESPOSTA FINAL           │                     │
│  └──────────────────────────────────┘                     │
└──────────────────────────────────────────────────────────┘
```

### Problemas do fluxo atual

1. **Auto-RAG é cego**: busca pela mensagem inteira do usuário, que pode ter ruído
2. **Busca única**: se o resultado é ruim, ninguém avalia e tenta de novo
3. **Graph é passivo**: só enriquece SE chunks mencionam entidades (string match)
4. **Chunks sem contexto**: texto cru, sem tags, sem resumo, sem metadata semântica
5. **LLM não avalia qualidade**: aceita o que vier, mesmo se irrelevante

---

## O que queremos (Self-RAG via Tool Calling)

```
┌────────────────────────────────────────────────────────────────┐
│  FLUXO PROPOSTO: Self-RAG com Avaliação + Re-busca            │
│                                                                │
│  Usuário pergunta                                              │
│       │                                                        │
│       ▼                                                        │
│  ┌─────────────┐   auto-RAG (igual ao atual, leve)             │
│  │  discovery   │──► hints das sources relevantes               │
│  └──────┬──────┘                                               │
│         │                                                      │
│         ▼                                                      │
│  ┌─────────────────────────────────────────┐                   │
│  │  LLM recebe contexto + hint de sources  │                   │
│  │                                         │                   │
│  │  Decisão 1: PRECISO BUSCAR?             │                   │
│  │  ├── Não → responde direto              │                   │
│  │  └── Sim → formula query otimizada      │                   │
│  │           (não a mensagem crua!)        │                   │
│  └──────────────┬──────────────────────────┘                   │
│                 │                                              │
│                 ▼                                              │
│  ┌─────────────────────────────────┐                           │
│  │  tool: buscar_conhecimento_v2   │                           │
│  │  query: "regra CLT interjornada │                           │
│  │          11 horas descanso"     │  ◄── query REFORMULADA    │
│  └──────────────┬──────────────────┘                           │
│                 │                                              │
│        embedding + FTS + graph                                 │
│                 │                                              │
│                 ▼                                              │
│  ┌─────────────────────────────────────────┐                   │
│  │  Retorno inclui campo NOVO:             │                   │
│  │  - chunks[] com scores                  │                   │
│  │  - relations[]                          │                   │
│  │  - melhor_score: 0.42                   │  ◄── SCORE BAIXO  │
│  │  - sugestao_refinamento:                │                   │
│  │    "tente: descanso entre jornadas CLT" │                   │
│  └──────────────┬──────────────────────────┘                   │
│                 │                                              │
│                 ▼                                              │
│  ┌─────────────────────────────────────────┐                   │
│  │  Decisão 2: RESULTADO BOM?              │                   │
│  │                                         │                   │
│  │  LLM avalia:                            │                   │
│  │  - melhor_score > 0.6? → BOM, usa       │                   │
│  │  - melhor_score < 0.4? → RUIM           │                   │
│  │    ├── Tenta query alternativa          │                   │
│  │    │   (sinônimos, reformulação)        │                   │
│  │    └── OU: responde sem RAG             │                   │
│  │       (admite que não tem na base)      │                   │
│  └──────────────┬──────────────────────────┘                   │
│                 │                                              │
│          ┌──────┴──────┐                                       │
│          │             │                                       │
│     BOM (usa)    RUIM (re-busca, max 2x)                       │
│          │             │                                       │
│          │         ┌───┴───────────────────┐                   │
│          │         │ tool: buscar_         │                   │
│          │         │ conhecimento_v2       │                   │
│          │         │ query REFORMULADA #2  │                   │
│          │         └───────┬───────────────┘                   │
│          │                 │                                   │
│          ▼                 ▼                                   │
│  ┌──────────────────────────────────┐                          │
│  │       RESPOSTA FINAL             │                          │
│  │  (com citação dos chunks usados) │                          │
│  └──────────────────────────────────┘                          │
└────────────────────────────────────────────────────────────────┘
```

### O que muda na prática

| Aspecto | Hoje | Self-RAG |
|---------|------|----------|
| Quem formula a query | discovery.ts (mensagem crua) | LLM (query otimizada) |
| Avaliação de resultado | Nenhuma | LLM julga score + relevância |
| Re-busca | Nunca | Até 2x com query reformulada |
| Graph | Passivo (string match) | Ativo (LLM pode pedir `explorar_relacoes` se precisar) |
| Chunks no retorno | `context_for_llm` (texto truncado) | Chunks com score + sugestão de refinamento |

### Implementação mínima (3 mudanças)

**Mudança 1: System prompt** — Adicionar instrução:
```
Quando precisar buscar conhecimento:
1. Formule uma query ESPECÍFICA (não use a mensagem do usuário inteira)
2. Avalie o melhor_score do retorno
3. Se < 0.4, reformule com sinônimos/termos alternativos e busque de novo (max 2x)
4. Se após 2 tentativas ainda < 0.4, admita que não tem na base
```

**Mudança 2: Tool `buscar_conhecimento`** — Adicionar no retorno:
```typescript
return toolOk({
  total: result.chunks.length,
  melhor_score: Math.max(...result.chunks.map(c => c.score)),
  context_for_llm: result.context_for_llm,
  // NOVO: ajuda a LLM a reformular se score baixo
  sugestao_refinamento: result.chunks[0]?.score < 0.5
    ? 'Score baixo. Tente reformular com termos mais específicos ou sinônimos.'
    : null,
})
```

**Mudança 3: Discovery _autoRag** — Mandar melhor_score junto:
```typescript
// Hoje: só manda títulos
return `### Conhecimento relevante\n${lines.join('\n')}`

// Proposto: manda score pra LLM saber se vale a pena mergulhar
const bestScore = Math.max(...result.chunks.map(c => c.score))
return `### Conhecimento relevante (confiança: ${(bestScore * 100).toFixed(0)}%)\n${lines.join('\n')}`
```

---

## Arquitetura: Router/Orchestrator

```
┌────────────────────────────────────────────────────────────────┐
│  OPÇÃO 3: Router AI Separada                                   │
│                                                                │
│  Usuário pergunta                                              │
│       │                                                        │
│       ▼                                                        │
│  ┌──────────────────────────┐                                  │
│  │  ROUTER (modelo pequeno) │  ◄── IA separada, rápida         │
│  │                          │                                  │
│  │  Classificação:          │                                  │
│  │  1. Precisa de RAG?      │                                  │
│  │  2. Qual retriever?      │                                  │
│  │     - Vetor (semântico)  │                                  │
│  │     - FTS (keyword)      │                                  │
│  │     - Graph (relações)   │                                  │
│  │     - SQL (dados)        │                                  │
│  │     - Nenhum             │                                  │
│  │  3. Query reformulada    │                                  │
│  └──────────┬───────────────┘                                  │
│             │                                                  │
│      ┌──────┼──────┬────────┐                                  │
│      ▼      ▼      ▼        ▼                                  │
│   Vetor   FTS   Graph    SQL/tool                              │
│      │      │      │        │                                  │
│      └──────┼──────┘        │                                  │
│             ▼               │                                  │
│     ┌───────────────┐       │                                  │
│     │  RE-RANKER     │       │  ◄── outro modelo pequeno        │
│     │  (cross-       │       │      avalia relevância chunk     │
│     │   encoder)     │       │      a chunk                     │
│     └───────┬───────┘       │                                  │
│             │               │                                  │
│             ▼               ▼                                  │
│     Top-K chunks limpos + dados SQL                            │
│             │                                                  │
│             ▼                                                  │
│  ┌──────────────────┐                                          │
│  │  LLM PRINCIPAL   │  ◄── recebe só o ouro, sem ruído         │
│  │  (Gemini/Qwen)   │                                          │
│  └──────────────────┘                                          │
│             │                                                  │
│             ▼                                                  │
│       RESPOSTA FINAL                                           │
└────────────────────────────────────────────────────────────────┘
```

### Router offline: é viável?

| Componente | Tamanho | RAM | Offline? | O que faz |
|------------|---------|-----|:--------:|-----------|
| **Embedding** (e5-base) | ~440MB | ~500MB | ✅ | Vetorizar texto (já temos) |
| **Cross-encoder re-ranker** | ~100-400MB | ~300MB | ✅ | Avaliar relevância par-a-par |
| **Router classificador** | ~50-200MB | ~200MB | ✅ | Classificar tipo de query |
| **Router com reformulação** | ~2-4GB | ~3-5GB | ⚠️ | Precisa de modelo generativo |

**Conclusão**: Um router CLASSIFICADOR (regras + modelo tiny) roda offline tranquilo.
Um router que REFORMULA queries precisa de um modelo generativo (~2GB+), que é
basicamente a mesma coisa que a nossa IA Local (Qwen 3.5).

Para o EscalaFlow, o **Self-RAG via tool calling (Opção 2)** é melhor custo-benefício
porque a LLM principal JÁ ESTÁ rodando — basta instruí-la a avaliar e re-buscar.

---

## Diagnóstico do RAG Atual

### Embedding: e5-base ONNX (768d)

**O que é**: multilingual-e5-base da Microsoft, ~110M parâmetros, quantizado Q8.
**Prós**: offline, zero custo, multilingual, bom para buscas diretas.
**Contras para o EscalaFlow**:

| Limitação | Impacto | Exemplo |
|-----------|---------|---------|
| Modelo BASE (não LARGE) | Compreensão semântica limitada | "inveja" ≠ "ressentimento no trabalho" |
| Sem expansão de query | Sinônimos não são capturados | "folga" vs "descanso" vs "day off" |
| Chunks sem contexto | Embedding do texto cru | Chunk isolado perde sentido do documento |
| Quantização Q8 | Perda marginal de qualidade | ~2-5% vs float32 |

### Alternativas de embedding

| Modelo | Params | Dims | Tamanho | Melhoria esperada |
|--------|--------|------|---------|-------------------|
| **e5-base** (atual) | 110M | 768 | ~440MB | baseline |
| **e5-large** | 335M | 1024 | ~1.2GB | +15-20% semântico |
| **BGE-M3** | 568M | 1024 | ~2.2GB | +25-30% (melhor multilingual) |
| **nomic-embed-v2** | 137M | 768 | ~550MB | +10% (Matryoshka, mais eficiente) |

### Chunking: sem inteligência

O chunking atual é puramente textual (split por `\n\n` → `\n` → `. `).
Os chunks NÃO recebem:
- ❌ Tags semânticas (conceitos, tópicos)
- ❌ Resumo do chunk
- ❌ Contexto do documento pai
- ❌ Entidades mencionadas
- ❌ Metadata do domínio (ex: "esta é uma regra CLT sobre descanso")

Isso significa que o embedding é feito sobre texto cru sem nenhum enriquecimento.

### Knowledge Graph: passivo e frágil

O graph enrichment atual funciona assim:
1. Search retorna chunks
2. `getRelatedEntities()` carrega TODOS os nomes de entidades do graph
3. Faz `string.includes()` no texto concatenado dos chunks
4. Retorna relações das entidades cujo NOME aparece literalmente nos chunks

**Problemas**:
- Se o chunk fala de "descanso entre jornadas" mas a entidade se chama "Interjornada",
  o match por string NÃO conecta.
- O graph só enriquece se o retrieval já foi bom. Se o retrieval falhou, o graph não salva.
- A LLM recebe relações mas não pode pedir "me mostra o graph de X" proativamente
  (precisa chamar `explorar_relacoes` explicitamente).

---

## Plano de evolução (priorizado)

### Fase 1: Self-RAG (esforço: pequeno, impacto: alto)
- [ ] Atualizar system prompt com instrução de avaliação + re-busca
- [ ] Adicionar `melhor_score` e `sugestao_refinamento` no retorno da tool
- [ ] Discovery: incluir score de confiança no hint
- [ ] Testar com queries que hoje falham ("inveja", "folga", sinônimos)

### Fase 2: Contextual Chunking (esforço: médio, impacto: alto)
- [ ] Na ingestão, prepend título + resumo do source ao chunk
- [ ] Extrair tags/conceitos por chunk (pode usar LLM durante ingest)
- [ ] Incluir tags no texto antes de gerar embedding
- [ ] Re-indexar chunks existentes

### Fase 3: Upgrade Embedding (esforço: médio, impacto: médio)
- [ ] Testar e5-large vs BGE-M3 vs nomic-embed-v2
- [ ] Benchmark com queries reais do RH
- [ ] Se e5-large ganhar: trocar modelo, re-embedar tudo
- [ ] Atualizar dims no pgvector se necessário (768 → 1024)

### Fase 4: Graph Ativo (esforço: alto, impacto: médio)
- [ ] Graph enrichment por embedding (não string match)
- [ ] LLM pode solicitar exploração proativa do graph
- [ ] Entidades com sinônimos/aliases

### Fase 5: Re-ranker (esforço: médio, impacto: médio)
- [ ] Cross-encoder local para re-rankear top-20 → top-5
- [ ] Modelo: ms-marco-MiniLM ou similar (~100MB)
- [ ] Roda após retrieval, antes de montar context_for_llm

---

## Status de implementação

### Implementado (2026-03-18)

**Self-RAG (Fase 1):**
- [x] `system-prompt.ts`: instrução de avaliação + re-busca (query específica, avaliar score, reformular 2x)
- [x] `tools.ts`: `buscar_conhecimento` retorna `melhor_score` + `sugestao_refinamento`
- [x] `discovery.ts`: `_autoRag` inclui confiança% no header (e aviso se < 60%)

**Enrichment Pipeline (Fase 2):**
- [x] `schema.ts`: migration v28 — coluna `enriched_at` em `knowledge_chunks`
- [x] `enrichment.ts`: pipeline completo (batch 10 chunks por LLM call, agrupado por source)
- [x] `tipc.ts`: handler `knowledge.enrich` (sourceTipo? + forceAll?)
- [x] Enriquecimento: resumo + tags (com sinônimos) + entidades + relações
- [x] Re-embedding com texto enriquecido (prefix [Resumo: ...] [Tags: ...])
- [x] Graph persistence incremental (entidades existentes passadas como contexto pro LLM)

**Graph (Fase 4 parcial):**
- [x] Graph cresce junto com enrichment (mesma chamada LLM extrai entities+relations)
- [x] Entidades existentes passadas pro LLM pra usar nomes canônicos
- [ ] Graph enrichment por embedding (não string match) — pendente

### Decisões de design

**Batch por source, não por seção:** Chunks são agrupados por `knowledge_source`
(sistema, manual, etc) e processados em batches de ~10. O LLM vê chunks sequenciais
do mesmo documento, mantendo contexto. Isso é mais eficiente que 1 chunk por call
(50 calls → ~5 calls) e mais inteligente que batch aleatório.

**Enriquecimento NÃO altera `conteudo`:** O campo `conteudo` permanece com o texto
original (pra display). O texto enriquecido (com prefix de resumo + tags) é usado
apenas para gerar o novo embedding e o search_tsv. Marcado com `enriched_at` timestamp.

**Graph incremental:** Não precisa ler o graph inteiro. Cada batch adiciona entidades
novas com `ON CONFLICT DO UPDATE`. A lista de nomes existentes é passada pro LLM como
contexto leve (~1KB) pra favorecer nomes canônicos.

**Memórias IA:** Hoje as memórias (`ia_memorias`) são salvas como texto curto sem
enriquecimento. Uma evolução futura seria: ao salvar memória, extrair entidades e
adicionar ao graph. Isso faria o graph crescer organicamente com o uso do sistema.

### Como usar

```typescript
// Via IPC (renderer → main)
await client['knowledge.enrich'].invoke({ sourceTipo: 'sistema' }) // só sistema
await client['knowledge.enrich'].invoke({ sourceTipo: 'manual' })  // só manuais
await client['knowledge.enrich'].invoke({})                         // todos os não-enriquecidos
await client['knowledge.enrich'].invoke({ forceAll: true })         // re-enriquece tudo
```
