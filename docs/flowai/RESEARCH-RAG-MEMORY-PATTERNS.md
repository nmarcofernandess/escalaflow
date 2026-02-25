# Research: RAG, Memory & Compaction Patterns

> Pesquisa sobre como OpenClaw e o mercado gerenciam RAG de conversas,
> auto-recall, compaction de historico, e o que aplicar no EscalaFlow.
>
> Data: 2026-02-24

---

## 1. Como o OpenClaw salva RAG de conversas

### 1.1 Filosofia: File-First

O OpenClaw segue uma filosofia **file-first**: Markdown files sao a fonte de verdade.
Tudo legivel por humano, editavel com qualquer editor, versionavel com Git.
Nada fica preso em blob opaco de vector DB.

```
~/.openclaw/agents/<id>/
  memory/         # Markdown files criados pelo agente ou pelo usuario
  qmd/
    sessions/     # Transcricoes de conversas (auto-indexadas)
  memory.sqlite   # Indice local (embeddings + FTS5)
```

### 1.2 O que e salvo e quando

| Trigger | O que salva | Onde |
|---------|-------------|------|
| **Fim de sessao** | Conversa inteira (sanitizada: so User/Assistant turns) como .md timestampado com slug descritivo gerado pelo LLM | `qmd/sessions/` |
| **Pre-compaction flush** | Memorias duraveis que o modelo julga importantes (turno silencioso antes de compactar) | `memory/*.md` |
| **Agente decide salvar** | Qualquer info que o modelo acha relevante durante a conversa (via `memory_search` tool) | `memory/*.md` |
| **Reindexacao periodica** | QMD re-indexa todos os .md a cada 5 min (debounce 15s) | `memory.sqlite` |

### 1.3 Regras de o que salvar (OpenClaw nativo)

O OpenClaw nativo NAO tem heuristica sofisticada de extracao. Ele salva a **conversa inteira** como sessao.
A inteligencia esta na BUSCA, nao na captura. Salva tudo, busca bem.

O que filtra:
- So conversas de DM (diretas) sao indexadas — grupo fica fora por padrao
- Sessoes vazias ou muito curtas podem ser ignoradas
- O slug descritivo e gerado pelo LLM (resume o tema da conversa)

### 1.4 Plugins de extracao mais sofisticados

Plugins como `openclaw-engram` e `mem0` adicionam extracao inteligente:

**openclaw-engram** (LLM-powered extraction):
- Uma chamada LLM produz memorias tipadas com confidence score
- 10 categorias: `fact`, `preference`, `correction`, `entity`, `decision`, `relationship`, `principle`, `commitment`, `moment`, `skill`
- Cada memoria com importance flag: `critical` / `high` / `normal` / `low`
- Armazena como Markdown + indice hibrido

**Mem0 plugin** (Auto-Capture):
- Envia cada exchange (user+assistant) para camada de extracao apos responder
- Mem0 decide: fatos novos → armazena, info desatualizada → atualiza, duplicatas → merge
- Separa escopos: long-term (user-scoped, persiste entre sessoes) vs short-term (session-scoped)

---

## 2. O que e BM25

### 2.1 Definicao

**BM25 (Best Match 25)** e um algoritmo de ranking para full-text search.
Tem 30+ anos e continua sendo o default no Elasticsearch, Lucene, SQLite FTS5, e ParadeDB.

### 2.2 Como funciona

BM25 e uma funcao "bag-of-words" — rankeia documentos pela presenca dos termos da query, sem considerar proximidade.

Tres componentes:

```
Score(D, Q) = SUM[ IDF(qi) * (TF(qi, D) * (k1 + 1)) / (TF(qi, D) + k1 * (1 - b + b * |D|/avgdl)) ]
```

| Componente | O que faz | Intuicao |
|------------|-----------|----------|
| **TF (Term Frequency)** | Quantas vezes o termo aparece no documento | Mais aparicoes = mais relevante, MAS com saturacao (retornos decrescentes) |
| **IDF (Inverse Document Frequency)** | Quao raro e o termo no corpus todo | Termos raros valem mais. "CLT" vale mais que "de" |
| **Document Length Normalization** | Penaliza documentos longos vs media | Documento curto com o termo e mais relevante que documento longo |

### 2.3 BM25 vs Vector Search

| Aspecto | BM25 | Vector Search |
|---------|------|---------------|
| Busca exata ("Art. 71 CLT") | Excelente | Ruim (pode achar coisas semanticamente parecidas mas nao exatas) |
| Busca semantica ("regra de almoco") | Ruim (nao entende sinonimos) | Excelente (entende que "almoco" ≈ "intervalo intrajornada") |
| Velocidade | Muito rapido | Mais lento (depende de embeddings) |
| Offline | Sim (FTS local) | Depende (precisa gerar embedding via API ou modelo local) |
| Melhor para | IDs, nomes proprios, termos tecnicos, codigos | Perguntas naturais, conceitos, relacoes |

### 2.4 Por que hibrido?

O mercado inteiro convergiu para **hybrid search**: BM25 + Vector + opcionalmente reranking.

```
Score_final = alpha * vector_score + (1 - alpha) * bm25_score
```

Alpha tipico: 0.7 (70% vector, 30% keyword) — exatamente o que o EscalaFlow ja usa.

### 2.5 Equivalencia no PGLite/Postgres

| BM25/FTS5 (SQLite) | Equivalente PGLite | EscalaFlow hoje |
|---------------------|---------------------|-----------------|
| FTS5 virtual table | `tsvector` + `ts_rank` + `plainto_tsquery` | Ja usa (knowledge_chunks.search_tsv) |
| BM25 ranking | `ts_rank` (nao e BM25 puro, e tf-idf based) | Ja usa |
| Trigram similarity | `pg_trgm` + `similarity()` | Ja usa como fallback |

> **Nota:** `ts_rank` do Postgres NAO e BM25 puro — e baseado em tf-idf.
> Para BM25 real no Postgres, existe o ParadeDB (`pg_search` extension), mas PGLite nao suporta.
> Na pratica, `ts_rank` + vector hybrid e suficiente pro nosso caso.

---

## 3. Auto-Recall: Como funciona a injecao automatica

### 3.1 O padrao OpenClaw

O OpenClaw usa um hook `before_agent_start` que:

1. Pega a mensagem do usuario
2. Gera embedding da mensagem
3. Faz hybrid search (BM25 + vector) nas memorias indexadas
4. Aplica MMR (Maximal Marginal Relevance) para diversidade
5. Injeta os resultados como `prependContext` no system prompt

```
[Usuario manda mensagem]
        |
        v
[Hook: before_agent_start]
        |
        v
[Embedding da mensagem] ---> [Hybrid Search: BM25 + Vector]
                                      |
                                      v
                              [MMR Reranking]
                                      |
                                      v
                        [Top-K chunks injetados no prompt]
                                      |
                                      v
                          [LLM recebe contexto enriched]
```

### 3.2 Embedding faz a busca, NAO o LLM

**A busca e 100% automatica por embedding.** O LLM nao decide o que buscar.

- A mensagem do usuario e transformada em embedding
- O embedding e comparado com todos os chunks indexados
- Os Top-K mais relevantes sao injetados antes do LLM ver qualquer coisa

O LLM so recebe o resultado ja pronto. Nao ha uma chamada extra de LLM para "decidir o que buscar" — isso seria caro e lento demais.

### 3.3 O que o EscalaFlow deveria fazer (gap principal)

Hoje o `buscar_conhecimento` e uma tool — depende do Gemini decidir chamar.
O padrao correto e:

```typescript
// ANTES (hoje) — depende do LLM
const tools = getVercelAiTools() // inclui buscar_conhecimento como tool
const result = await generateText({ model, system, messages, tools })

// DEPOIS (proposta) — automatico
const autoContext = await searchKnowledge(mensagemAtual) // embedding search
const enrichedSystem = autoContext.context_for_llm
  ? `${fullSystemPrompt}\n\n---\n${autoContext.context_for_llm}`
  : fullSystemPrompt
const result = await generateText({ model, system: enrichedSystem, messages, tools })
```

Custo: 1 chamada de embedding por mensagem do usuario (~0.001 centavo no Gemini).
Beneficio: conhecimento relevante SEMPRE disponivel, sem depender do LLM.

---

## 4. Context Compaction & Gerenciamento de Historico

### 4.1 O problema

Toda chamada de API envia o historico completo. Conforme a conversa cresce:
- Tokens crescem → custo cresce
- Chega no limite da context window → erro
- Mensagens antigas competem com as recentes por "atencao" do modelo (context rot)

### 4.2 Estrategias do mercado (mais simples → mais sofisticada)

#### Estrategia 1: Sliding Window (Truncamento simples)

```
Manter apenas as ultimas N mensagens. Descartar o resto.

[msg1, msg2, msg3, msg4, msg5, msg6, msg7, msg8]
                              ↓ window = 4
                    [msg5, msg6, msg7, msg8]
```

**Pros:** Simples, previsivel, barato.
**Cons:** Perde contexto importante do inicio da conversa.

#### Estrategia 2: Summary + Window (O que o OpenClaw faz)

```
Resumir mensagens antigas com LLM. Manter recentes intactas.

[msg1, msg2, msg3, msg4, msg5, msg6, msg7, msg8]
            ↓ summarize old, keep recent
[RESUMO_msg1-4, msg5, msg6, msg7, msg8]
```

**Como o OpenClaw implementa:**

1. Separa historico em "old" e "recent"
2. Chama LLM (mesmo modelo ou modelo menor) para resumir a parte "old"
3. Substitui mensagens antigas pelo resumo
4. Salva resumo no JSONL da sessao
5. Proxima chamada usa: `system_prompt + resumo + mensagens_recentes`

**Pros:** Preserva contexto essencial. Custo unico de resumo.
**Cons:** Resumo pode perder nuances. Custa 1 chamada extra.

#### Estrategia 3: Hierarchical Summarization

```
Resumos em camadas: conversa → resumo nv1 → resumo nv2

[conversa original: 50 msgs]
        ↓ resumo a cada 10 msgs
[resumo1, resumo2, resumo3, resumo4, resumo5]
        ↓ meta-resumo quando acumula
[meta-resumo dos resumos 1-3, resumo4, resumo5]
```

**Pros:** Escala infinitamente. Preserva info em camadas.
**Cons:** Mais complexo. Cada camada perde um pouco.

#### Estrategia 4: Token Budget Allocation

```
Distribui a context window em fatias fixas:

| Fatia              | % da Window | Exemplo (128K) |
|--------------------|-------------|-----------------|
| System Prompt      | 15%         | ~19K tokens     |
| Auto-Recall (RAG)  | 10%         | ~13K tokens     |
| Resumo historico    | 25%         | ~32K tokens     |
| Msgs recentes       | 30%         | ~38K tokens     |
| Buffer resposta     | 20%         | ~26K tokens     |
```

**Pros:** Previsivel, controlavel, nunca estoura.
**Cons:** Rigido. Precisa tuning.

### 4.3 Como o OpenClaw faz compaction (detalhes)

#### Deteccao de threshold

```
softThreshold = contextWindow - reserveTokensFloor - softThresholdTokens

Exemplo (Gemini 2.5 Flash, 1M tokens):
  contextWindow = 1_000_000
  reserveTokensFloor = 20_000
  softThresholdTokens = 4_000
  → flush trigger em ~976_000 tokens usados
```

#### Pre-compaction memory flush

Antes de compactar, dispara turno silencioso:

```
[Sistema detecta threshold]
  → Injeta mensagem interna: "Seu contexto vai ser compactado. Salve informacoes importantes agora."
  → Modelo escreve memorias duraveis em memory/*.md
  → Modelo responde NO_REPLY (usuario nao ve)
  → Counter incrementa (impede double-flush)
  → Compaction executa
```

#### Processo de compaction

```
1. Calcula split point: mensagens "old" vs "recent"
2. Envia "old" para LLM com prompt: "Resuma esta conversa preservando decisoes, fatos e contexto"
3. LLM retorna resumo compacto
4. Substitui mensagens old pelo resumo na sessao
5. Se ainda nao couber: trunca tool results grandes (pruning)
6. MAX_OVERFLOW_COMPACTION_ATTEMPTS = 3 — se nao resolver, erro
```

#### O que fica salvo no JSONL

```jsonl
{"role": "summary", "content": "Resumo da conversa ate aqui: ..."}
{"role": "user", "content": "mensagem recente 1"}
{"role": "assistant", "content": "resposta recente 1"}
...
```

### 4.4 Como saber quantos tokens o historico tem

#### Estimativa por caracteres (rapido, impreciso)

```typescript
// Regra de ouro: ~4 chars = 1 token (ingles), ~3 chars = 1 token (portugues)
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5)
}
```

#### Contagem real com tiktoken (preciso, so OpenAI)

```typescript
import { encoding_for_model } from 'tiktoken'
const enc = encoding_for_model('gpt-4o')
const tokens = enc.encode(text).length
```

#### Para Gemini (nosso caso)

O Gemini tem o endpoint `countTokens`:

```typescript
// Gemini countTokens API
const response = await fetch(`https://generativelanguage.googleapis.com/v1/models/${model}:countTokens`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
  body: JSON.stringify({ contents: [{ parts: [{ text }] }] })
})
const { totalTokens } = await response.json()
```

Mas na pratica, **estimativa por chars e suficiente** para decidir quando compactar.
A chamada de countTokens seria uma API call extra por mensagem — overhead desnecessario.

### 4.5 O EscalaFlow envia historico COMPLETO hoje?

**Sim.** Olhando `cliente.ts`, `buildChatMessages()` converte TODO o array `historico` em mensagens:

```typescript
function buildChatMessages(historico: IaMensagem[], currentMsg: string): ModelMessage[] {
    for (const h of historico) {
        // converte TODAS as mensagens — sem limite, sem resumo, sem truncamento
    }
    messages.push({ role: 'user', content: currentMsg })
    return messages
}
```

Nao ha sliding window, nao ha resumo, nao ha truncamento.
Se a conversa tiver 200 mensagens, TODAS vao na chamada.

---

## 5. Padroes de mercado consolidados

### 5.1 O que o mercado faz (convergencia 2025-2026)

| Pattern | Quem usa | Descricao |
|---------|----------|-----------|
| **Hybrid Search** | OpenClaw, Mem0, LangChain, LlamaIndex | BM25 + Vector + reranking |
| **Auto-Recall** | OpenClaw (plugins), Mem0, Zep | Embedding search automatico antes de responder |
| **Summary Buffer** | LangChain (ConversationSummaryBufferMemory), OpenClaw | Manter N recentes + resumo dos antigos |
| **Token Budget** | Microsoft Semantic Kernel, LangChain | Alocar % da window para cada componente |
| **Memory Flush** | OpenClaw | Salvar memorias antes de compactar |
| **Typed Extraction** | openclaw-engram, Mem0 | Classificar memorias em categorias com confidence |
| **Decay System** | OpenClaw, Mem0 | Memorias sem acesso decaem (lazy decay) |
| **Session Indexing** | OpenClaw QMD | Indexar conversas passadas para busca futura |

### 5.2 Benchmarks relevantes

- Mem0: 91% menos latencia que enviar contexto completo
- Summary Buffer: reduz tokens em 60-70% preservando info essencial
- Hybrid Search: 26% melhor qualidade de resposta vs keyword-only ou vector-only
- Context Rot (Chroma Research): apos ~40K tokens de input, qualidade do LLM degrada significativamente — menos e mais

---

## 6. O que aplicar no EscalaFlow

### 6.1 Prioridade 1: Auto-Recall (embedding automatico)

**O que:** Antes de cada chamada de IA, fazer embedding da mensagem do usuario e buscar chunks relevantes no knowledge layer. Injetar no system prompt automaticamente.

**Onde mudar:** `cliente.ts` → `buildFullSystemPrompt()` ou `_callWithVercelAiSdkTools()`

**Custo:** 1 embedding call por mensagem (~0.001 centavo)

**Impacto:** Conhecimento salvo SEMPRE disponivel, sem depender do LLM chamar tool.

### 6.2 Prioridade 2: History Compaction (Summary Buffer)

**O que:** Quando historico ultrapassar threshold (~30K tokens estimados), resumir mensagens antigas com LLM e manter so as N recentes intactas.

**Onde mudar:** `cliente.ts` → `buildChatMessages()`

**Implementacao sugerida:**

```typescript
const MAX_HISTORY_TOKENS = 30_000
const RECENT_MESSAGES_KEEP = 10

function buildChatMessages(historico: IaMensagem[], currentMsg: string): ModelMessage[] {
    const estimatedTokens = historico.reduce((sum, h) => sum + estimateTokens(h.conteudo), 0)

    if (estimatedTokens > MAX_HISTORY_TOKENS && historico.length > RECENT_MESSAGES_KEEP) {
        const oldMessages = historico.slice(0, -RECENT_MESSAGES_KEEP)
        const recentMessages = historico.slice(-RECENT_MESSAGES_KEEP)

        // Resumir msgs antigas (pode ser feito async e cacheado)
        const summary = await summarizeMessages(oldMessages)

        return [
            { role: 'user', content: `[CONTEXTO DA CONVERSA ANTERIOR]\n${summary}` },
            ...convertMessages(recentMessages),
            { role: 'user', content: currentMsg }
        ]
    }

    return [...convertMessages(historico), { role: 'user', content: currentMsg }]
}
```

**Custo:** 1 chamada LLM extra quando threshold e atingido (pode cachear resumo).

**Impacto:** Conversas longas nao explodem tokens/custo. Modelo foca no recente.

### 6.3 Prioridade 3: RAG inteligente (substituir regex por LLM extraction)

**O que:** Substituir heuristica regex CLT/CCT por extracao baseada em LLM. Foco em:
- Preferencias do usuario ("gosto de escala 6x1", "nao coloque Maria no domingo")
- Fatos sobre colaboradores ("Joao tem restricao medica", "Ana esta gravida")
- Decisoes tomadas ("decidimos usar folga fixa pro acougue")
- Correcoes ("na verdade o contrato do Pedro e 36h, nao 44h")

**Onde mudar:** `cliente.ts` → `maybeAutoCapture()`

**Custo:** 1 chamada LLM extra com modelo barato (haiku/flash) para classificar o que vale salvar.

**Impacto:** RAG deixa de ser "enciclopedia CLT" e vira "memoria do RH".

### 6.4 Prioridade 4: Session Indexing

**O que:** Ao encerrar conversa, indexar transcricao completa no knowledge layer para busca futura.

**Onde mudar:** `iaStore.ts` → ao arquivar/encerrar conversa, chamar `ingestKnowledge()`.

**Custo:** 1 chamada de chunking + embedding por conversa encerrada.

**Impacto:** "O que discutimos sobre a escala do acougue semana passada?" funciona.

---

## 7. Diagrama: Arquitetura proposta

```
ANTES (hoje):
  [User msg] → [buildSystemPrompt + discovery] → [generateText com 28 tools]
                                                   ↑ historico COMPLETO

DEPOIS (proposta):
  [User msg]
      |
      ├─→ [Auto-Recall: embedding → hybrid search → top-K chunks]
      |       ↓
      ├─→ [History Compaction: estimar tokens → resumir se > threshold]
      |       ↓
      └─→ [buildSystemPrompt + discovery + auto_recall_context]
              ↓
          [generateText com 28 tools + historico compactado]

  [Assistant response]
      |
      └─→ [Auto-Capture: LLM extraction → tipagem → ingest se relevante]
```

---

## 8. FAQ — Perguntas do Marco (2026-02-24)

### 8.1 A reindexacao gasta API key ou usa modelo local?

**Gasta API key.** A reindexacao do OpenClaw gera embeddings — e embeddings precisam de modelo.

- **Default:** USA API key do provider configurado (OpenAI `text-embedding-3-small`, ou Gemini `text-embedding-004`)
- **Alternativa local:** Pode usar Ollama com `nomic-embed-text` (gratis, local), mas o plugin `memory-lancedb` originalmente so aceitava OpenAI. Tem PR aberto pra aceitar Ollama via endpoint compativel
- **Custo real:** Embedding e baratissimo. Gemini text-embedding-004 custa $0.00001/1K tokens. Reindexar 100 chunks = ~$0.001 (um decimo de centavo)
- **Frequencia:** QMD reindexa a cada 5 min com debounce de 15s. So reindexa o que MUDOU (diff), nao tudo de novo

**Pro EscalaFlow:** Nos ja usamos Gemini text-embedding-004 no `embeddings.ts`. O custo de reindexar conversas seria irrelevante — centavos por mes.

### 8.2 Como o OpenClaw sabe que a sessao acabou?

**Nao e timeout de inatividade.** Sao dois triggers:

| Trigger | Como funciona |
|---------|---------------|
| **Daily reset** | Padrao: 4h AM local. Sessao reseta automaticamente. Conversa anterior vira arquivo .md |
| **Idle timeout** | Configuravel via `idleMinutes`. Se setado, o que expirar primeiro (daily ou idle) ganha |
| **Manual** | Usuario pode digitar `/reset` ou `/compact` |
| **Novo chat** | Quando cria nova sessao, a anterior e finalizada e salva |

O que acontece no "fim":
1. Transcricao sanitizada (so user/assistant) → salva como `.md` timestampado
2. LLM gera slug descritivo pro arquivo (ex: `2026-02-24-escala-acougue-marco.md`)
3. Arquivo indexado no QMD (chunking + embedding)
4. Sessao limpa — proxima comeca do zero (mas com auto-recall das memorias)

**Pro EscalaFlow:** Nos ja temos o conceito de "conversas" com `ia_conversas`. O trigger natural seria: **quando o usuario cria um novo chat, a conversa anterior e indexada no knowledge**. Processamento em background, fire-and-forget.

### 8.3 Ele usa memory da sessao + historico continuado?

**Sim, mas sao camadas separadas:**

```
[System Prompt]
    +
[Auto-Recall: memorias de TODAS as sessoes passadas relevantes]  ← knowledge layer
    +
[Resumo compactado da sessao atual (se houve compaction)]         ← session summary
    +
[Mensagens recentes da sessao atual]                              ← historico vivo
    +
[Mensagem atual do usuario]
```

A sacada: o LLM nunca recebe "tudo de todas as conversas". Ele recebe:
- **Knowledge** (auto-recall): Top-K chunks relevantes de QUALQUER conversa passada
- **Summary** (se compactou): Resumo da conversa ATUAL ate o ponto de compactacao
- **Recentes**: Ultimas N mensagens da conversa ATUAL na integra

### 8.4 O compact fica la como memory? Se compactar de novo, atualiza?

**O resumo fica NA SESSAO, nao no knowledge.** E sim, se compactar de novo, o resumo anterior ENTRA no novo resumo (stacking).

```
Compactacao 1:
  [msg1..msg20] → [RESUMO_A] + [msg21..msg30]

Compactacao 2 (conversa continua):
  [RESUMO_A, msg21..msg40] → [RESUMO_B] + [msg41..msg50]
  (RESUMO_B inclui o conteudo de RESUMO_A + msg21..msg40)
```

**Problemas conhecidos do OpenClaw com stacking:**
- Double-compaction: pode disparar 2x seguidas, gerando resumo de resumo muito curto
- Se a conversa ja ta no limite quando compacta, o proprio resumo pode ser grande demais
- Sugestao deles: compactar a 60-70% da window (proativo), nao a 95% (reativo/panico)
- Usar modelo menor/mais barato pro resumo (nao precisa ser o mesmo da conversa)

**Pro EscalaFlow:** Nosso compaction seria mais simples — nos temos PGLite com as mensagens salvas. O resumo ficaria como campo `resumo_compactado` na tabela `ia_conversas`. Quando compactar de novo, atualiza o mesmo campo.

### 8.5 Com Vercel AI SDK v6, como implementar nativamente?

O AI SDK v6 tem **Language Model Middleware** — perfeito pros nossos casos:

#### Auto-Recall via Middleware (o mais nativo possivel)

```typescript
import { type LanguageModelV3Middleware } from 'ai'
import { searchKnowledge } from '../knowledge/search'
import { getLastUserMessageText, addToLastUserMessage } from 'ai' // helpers do SDK

export const autoRecallMiddleware: LanguageModelV3Middleware = {
  transformParams: async ({ params }) => {
    // 1. Pega ultima mensagem do usuario
    const lastMsg = getLastUserMessageText({ prompt: params.prompt })
    if (!lastMsg) return params

    // 2. Busca conhecimento relevante (embedding automatico)
    const result = await searchKnowledge(lastMsg, { limite: 3 })
    if (!result.context_for_llm) return params

    // 3. Injeta no prompt do usuario (antes do LLM ver)
    return addToLastUserMessage({
      params,
      text: `\n\n[Contexto de conversas anteriores]\n${result.context_for_llm}`
    })
  }
}

// Uso:
const model = wrapLanguageModel({
  model: google('gemini-2.5-flash'),
  middleware: autoRecallMiddleware
})
```

#### History Compaction (no buildChatMessages)

Nao precisa de middleware — fica na logica de montagem de mensagens:

```typescript
const TOKEN_THRESHOLD = 30_000
const KEEP_RECENT = 10

function estimateTokens(text: string): number {
  return Math.ceil((text?.length ?? 0) / 3.5)
}

async function buildChatMessages(
  historico: IaMensagem[],
  currentMsg: string,
  conversaId: number
): Promise<ModelMessage[]> {
  const totalTokens = historico.reduce(
    (sum, h) => sum + estimateTokens(h.conteudo), 0
  )

  // Se dentro do threshold, envia tudo (comportamento atual)
  if (totalTokens <= TOKEN_THRESHOLD || historico.length <= KEEP_RECENT) {
    return [...convertMessages(historico), { role: 'user', content: currentMsg }]
  }

  // Busca resumo cacheado ou gera novo
  let resumo = await getCachedSummary(conversaId)
  if (!resumo) {
    const oldMsgs = historico.slice(0, -KEEP_RECENT)
    resumo = await generateSummary(oldMsgs) // 1 chamada LLM (modelo barato)
    await cacheSummary(conversaId, resumo)   // salva pra nao refazer
  }

  const recent = historico.slice(-KEEP_RECENT)
  return [
    { role: 'user', content: `[Resumo do contexto anterior]\n${resumo}` },
    ...convertMessages(recent),
    { role: 'user', content: currentMsg }
  ]
}
```

#### Auto-Capture pos-resposta (substituir regex)

```typescript
// Em vez de regex CLT/CCT, usar generateObject com schema simples
import { generateObject } from 'ai'
import { z } from 'zod'

const ExtractionSchema = z.object({
  worth_saving: z.boolean(),
  category: z.enum([
    'fact', 'preference', 'correction', 'decision', 'entity'
  ]).optional(),
  summary: z.string().max(200).optional(),
  importance: z.enum(['high', 'normal', 'low']).optional()
})

async function smartAutoCapture(
  userMsg: string,
  assistantResponse: string
): Promise<void> {
  if (assistantResponse.length < 80) return

  const { object } = await generateObject({
    model: google('gemini-2.0-flash-lite'), // modelo baratissimo
    schema: ExtractionSchema,
    prompt: `Analise esta troca de mensagens e determine se contem informacao
que vale salvar para memoria de longo prazo (preferencias do usuario,
fatos sobre colaboradores, decisoes tomadas, correcoes).
NAO salve: cumprimentos, perguntas genericas, dados que ja existem no banco.

Usuario: ${userMsg.slice(0, 500)}
Assistente: ${assistantResponse.slice(0, 1000)}`,
  })

  if (object.worth_saving && object.summary) {
    await ingestKnowledge(
      `[${object.category}] ${object.summary}`,
      `${userMsg}\n---\n${assistantResponse.slice(0, 1500)}`,
      object.importance === 'high' ? 'high' : 'low'
    )
  }
}
```

### 8.6 Vale a pena salvar TODAS as mensagens e a inteligencia estar na busca?

**Sim, e esse e o consenso do mercado.** Razoes:

1. **Custo de armazenamento e irrelevante** — textos em PGLite sao bytes, embeddings sao ~3KB por chunk. 1000 conversas = poucos MB
2. **Custo de indexacao e irrelevante** — embedding de texto custa centavos
3. **Voce nao sabe o que sera util depois** — a preferencia "nao ponha Maria no domingo" pode parecer trivial hoje, mas e gold daqui 3 meses
4. **Busca hibrida resolve o noise** — se salvar tudo mas buscar bem, so o relevante aparece
5. **Processamento e instantaneo ao trocar de chat** — os dados ja estao no PGLite com embeddings. `searchKnowledge()` roda em <50ms local

**O processamento NAO acontece ao trocar de chat.** Acontece:
- **Ao salvar**: cada mensagem ja e persistida em `ia_mensagens` (ja fazemos isso)
- **Ao fechar/arquivar conversa**: chunking + embedding da transcricao completa (background, fire-and-forget)
- **Ao abrir novo chat**: auto-recall busca chunks relevantes (busca no indice ja pronto, instantaneo)

### 8.7 O processo de transformar dados do chat em arquivos (OpenClaw) vs nosso approach (PGLite)

**O approach deles (Markdown files) tem vantagens e desvantagens vs o nosso (PGLite):**

| Aspecto | OpenClaw (files) | EscalaFlow (PGLite) |
|---------|------------------|---------------------|
| **Legibilidade** | Humano pode ler/editar os .md | Precisa de query pra ver |
| **Versionamento** | Git-friendly | Nao versionavel facilmente |
| **Busca** | Precisa de sidecar (QMD + SQLite) | Nativo (pgvector + tsvector JA no DB) |
| **Atomicidade** | Nenhuma (pode corromper mid-write) | Transacional |
| **Performance** | Precisa reindexar periodicamente | Indice sempre atualizado |
| **Simplicidade** | Mais partes moveis (files + sqlite + qmd) | Tudo num lugar so |
| **Offline** | Funciona | Funciona |

**Insights pra roubar deles:**

1. **Slug descritivo por LLM** — quando fechar conversa, gerar titulo automatico (ja fazemos com `auto-titulo` na 1a msg, mas poderiamos regenerar um titulo mais completo ao fechar)

2. **Sanitizacao** — nao indexar tool calls/results brutas. Salvar so user + assistant text. Isso evita poluir o knowledge com JSON de tools

3. **Debounce na indexacao** — nao indexar conversa ativa. Esperar ela "fechar" (novo chat criado ou arquivada). Evita reindexar a cada msg

4. **Session como unidade atomica** — cada conversa vira UM documento de conhecimento com titulo, nao N chunks soltos. O chunking acontece dentro desse documento, mas a unidade de "foi isso que discutimos" e a conversa inteira

5. **O resumo da compaction NAO vai pro knowledge** — fica so na sessao. O knowledge recebe a transcricao real, porque o resumo perde nuances que a busca semantica pode pegar

---

## 9. Estado real do EscalaFlow (corrigido)

### 9.1 Embedding: JA E LOCAL E GRATUITO

**CORRECAO:** O doc original dizia que usamos Gemini text-embedding-004. ERRADO.

O EscalaFlow usa `Xenova/multilingual-e5-base` via `@huggingface/transformers` (ONNX Runtime):
- **768 dimensoes**, ~150-440MB quantizado (q8)
- **100% offline**, sem API, sem internet, sem custo
- Roda dentro do Electron main process
- Graceful degradation: retorna null se modelo indisponivel
- Prefixes obrigatorios: `query:` (busca) / `passage:` (indexacao)

**Vantagem sobre OpenClaw:** OpenClaw depende de API (OpenAI/Ollama) pra embedding.
Nos ja temos modelo local de fabrica. Zero config do usuario.

### 9.2 O que funciona hoje (e o que nao)

| Componente | Status | Custo |
|-----------|--------|-------|
| **FTS** (`tsvector` + `ts_rank`) | Funciona no ingest | Zero (SQL puro) |
| **Vector** (`multilingual-e5-base`, 768d) | Funciona no ingest | Zero (modelo local ONNX) |
| **Hybrid search** (70% vector + 30% FTS) | Funciona no search | Zero |
| **Chunking** (~1500 chars, 200 overlap) | Funciona no ingest | Zero |
| **Trigram fallback** (`pg_trgm`) | Funciona se embedding offline | Zero |
| **Graph** (entities/relations) | **NAO funciona automatico** — `entities_count` retorna sempre 0. So via tool `salvar_conhecimento` manual com a LLM do chat | Gasta API do provider (LLM) |
| **Auto-capture** (regex CLT/CCT) | Funciona mas burro — so pega legislacao | Zero |
| **Diff/dedup** | **NAO existe** — reindexar duplica | - |
| **Auto-recall antes de responder** | **NAO existe** — depende da tool | - |
| **Session indexing ao fechar chat** | **NAO existe** | - |
| **History compaction** | **NAO existe** — envia tudo | - |

### 9.3 O que PRECISA de API paga vs o que e gratuito

| Operacao | Modelo usado | Custo |
|----------|-------------|-------|
| Embedding (chunking + indexacao) | `multilingual-e5-base` local | **Gratuito** |
| FTS indexacao | SQL `to_tsvector()` | **Gratuito** |
| Hybrid search | SQL + cosine local | **Gratuito** |
| Graph extraction | LLM do chat (Gemini/Claude) | **Pago** (usa API do provider) |
| History compaction (resumo) | LLM do chat ou modelo menor | **Pago** (1 chamada quando trigga) |
| Smart extraction (substituir regex) | LLM menor (Flash Lite) | **Pago** (baratissimo) |

**Conclusao:** Auto-recall + session indexing sao 100% gratuitos (usam embedding local + SQL).
So compaction e smart extraction precisam de LLM pago.

---

## 10. DECISOES DE ARQUITETURA (consolidado — Marco 2026-02-24)

### 10.1 Modelo de embedding: multilingual-e5-base (substitui e5-small) — ✅ IMPLEMENTADO

**Decisao revisada:** Qwen3-Embedding-0.6B **DESCARTADO** — sem suporte nativo em Transformers.js
(nossa runtime ONNX), ~600MB-1.2GB, 380ms por query. Pesado demais para Electron.

**Decisao final:** Migrar para `Xenova/multilingual-e5-base` (768d, ~110M params).
Mesma familia do modelo atual — upgrade seguro, Transformers.js nativo, portugues nativo.

| | e5-small (antigo) | e5-base (atual) |
|---|---|---|
| Dimensoes | 384 | **768** |
| Latencia CPU | ~16ms | **~50-200ms** |
| Tamanho ONNX q8 | ~118MB | **~150-440MB** |
| Compativel Transformers.js | Sim | Sim (mesma API, nativo) |
| Portugues nativo | Sim | Sim |
| Prefixes obrigatorios | Nao | **Sim** (`query:` / `passage:`) |

**Implementado:** pgvector 384→768, prefixes query/passage encapsulados em embeddings.ts,
migration com cleanup de dados antigos, download script validando 768d.

### 10.2 Quando salvar memoria automatica

**Decisao:** NAO salvar a cada exchange. Salvar apenas em 2 momentos:

| Trigger | O que faz |
|---------|-----------|
| **Mudar de chat** (criar novo) | Indexa conversa anterior (embedding local, gratis) + extrai memorias via LLM |
| **Antes de compactar** (threshold atingido) | Extrai memorias da parte que sera resumida, via LLM |

**Por que essa decisao:**
- Menos chamadas LLM = mais barato
- Historico COMPLETO da conversa disponivel = extracao MELHOR (mais contexto)
- Nao gasta API a cada "bom dia" / "obrigado"
- Momento natural: trocar de chat = "acabou o assunto, hora de guardar"

### 10.3 LLM para extracao: usa o mesmo modelo do chat

**Decisao:** Usar EXATAMENTE o modelo ja configurado pelo usuario pro chat.
Nao escolher modelo menor. Nao adicionar config extra.

**Por que:**
- Zero fricao pro usuario (nao precisa configurar nada alem do que ja tem)
- Menos ruido na programacao (nao precisa de resolveExtractionModel)
- O modelo do chat ja conhece o dominio (RH, CLT, escalas)
- Custo e irrelevante (1 chamada ao trocar de chat)

### 10.4 Toggle na pagina de Memoria

**Decisao:** Adicionar toggle "Memoria Automatica" na MemoriaPagina.

```
┌─────────────────────────────────────────────┐
│ Memoria Automatica               [toggle]   │
│ Salva informacoes importantes das conversas │
│ automaticamente ao trocar de chat            │
└─────────────────────────────────────────────┘
```

- **ON:** Ao mudar de chat ou antes de compactar → LLM extrai + salva
- **OFF:** Nada automatico. So salva se user pedir via chat ou importar

A memoria manual (user pede "salva isso", ou importa documento) funciona
independente do toggle — sempre disponivel.

### 10.5 Fluxo completo (versao final)

```
=== A CADA MENSAGEM (gratis, automatico, sem toggle) ===

[User envia mensagem]
    |
    ├─ [Auto-Recall] Embedding local (Qwen3) → PGLite hybrid search → Top-K
    |   → Injeta no system prompt via AI SDK Middleware
    |
    ├─ [History Compaction] Estima tokens do historico
    |   → Se > threshold: resume msgs antigas com LLM do chat (1 chamada)
    |   → Cacheia resumo em ia_conversas.resumo_compactado
    |
    └─ [Monta prompt] system + discovery + auto_recall + resumo? + recentes + msg
        → generateText/streamText com 32 tools


=== AO MUDAR DE CHAT (toggle "Memoria Automatica" ON) ===

[User cria novo chat]
    |
    ├─ [Session Indexing] Conversa anterior:
    |   → Sanitiza (so user + assistant text, sem tool JSON)
    |   → Chunka + embedding local (Qwen3) → salva no knowledge
    |   → Dedup por conversa_id (nao duplica)
    |   → Importancia: LOW (decai em 30 dias se nunca acessada)
    |   → GRATIS (embedding local)
    |
    └─ [Smart Extraction] Conversa anterior:
        → Envia historico completo pro LLM do chat
        → LLM extrai: facts, preferences, corrections, decisions, entities
        → Salva items extraidos no knowledge com importancia adequada
        → PAGO (1 chamada LLM, modelo do chat)


=== ANTES DE COMPACTAR (toggle "Memoria Automatica" ON) ===

[Threshold de tokens atingido]
    |
    ├─ [Smart Extraction] Msgs que serao resumidas:
    |   → Mesma logica do "ao mudar de chat"
    |   → Salva antes de perder detalhes no resumo
    |
    └─ [Compaction] Resume msgs antigas → cacheia


=== MANUAL (sempre disponivel, independente do toggle) ===

[User pede "salva isso" no chat]
    → IA chama tool salvar_conhecimento → importance HIGH

[User importa documento na pagina Memoria]
    → Upload .md/.txt → ingestKnowledge() → importance HIGH

[User pede "organizar memoria" na pagina Memoria]
    → Graph extraction via LLM → entities + relations
```

### 10.6 Smart Extraction — schema e prompt

```typescript
// Usa generateObject do Vercel AI SDK com o MESMO modelo do chat
import { generateObject } from 'ai'
import { z } from 'zod'

const MemoryExtractionSchema = z.object({
  items: z.array(z.object({
    category: z.enum(['fact', 'preference', 'correction', 'decision', 'entity']),
    summary: z.string().max(200).describe('Resumo curto do que salvar'),
    importance: z.enum(['high', 'low']),
  })).describe('Lista de informacoes que valem salvar. Pode ser vazia se nada relevante.')
})

async function extractMemoriesFromConversation(
  historico: IaMensagem[],
  model: any, // mesmo modelo do chat, ja instanciado
): Promise<void> {
  // Sanitizar historico
  const transcript = historico
    .filter(m => m.papel === 'usuario' || m.papel === 'assistente')
    .filter(m => m.conteudo?.trim())
    .map(m => `${m.papel === 'usuario' ? 'User' : 'Assistant'}: ${m.conteudo}`)
    .join('\n')
    .slice(0, 8000) // limitar input

  if (transcript.length < 100) return

  const { object } = await generateObject({
    model,
    schema: MemoryExtractionSchema,
    prompt: `Analise esta conversa de RH e extraia APENAS informacoes que valem
salvar para memoria de longo prazo. Exemplos do que salvar:
- Preferencias do usuario ("prefiro escala 6x1", "nao coloque Maria no domingo")
- Fatos sobre colaboradores ("Joao tem restricao medica", "Ana esta gravida")
- Decisoes tomadas ("folga fixa pro acougue", "contrato 36h pro novo")
- Correcoes ("na verdade e 36h, nao 44h")
- Entidades novas ("novo funcionario Pedro no setor Padaria")

NAO salve: cumprimentos, perguntas genericas, dados que ja existem no banco
(escalas, alocacoes, demandas — isso ja esta no sistema).
Se nada relevante, retorne items vazio.

Conversa:
${transcript}`,
  })

  for (const item of object.items) {
    await ingestKnowledge(
      `[${item.category}] ${item.summary}`,
      item.summary,
      item.importance,
      { tipo: 'auto_extract', category: item.category }
    )
  }
}
```

---

## 11. Resumo: O que e gratuito vs pago (versao final)

```
GRATUITO (Qwen3-Embedding-0.6B local ONNX, zero API):
  ✅ Auto-Recall (a cada msg)       — embedding + PGLite search
  ✅ Session Indexing (ao mudar chat) — chunking + embedding + PGLite insert
  ✅ FTS indexacao                    — SQL puro (to_tsvector)
  ✅ Hybrid search                   — SQL + cosine local
  ✅ Dedup por conversa_id           — SQL query

PAGO (usa LLM do chat, mesmo modelo ja configurado):
  💰 History Compaction              — 1 chamada ao atingir threshold
  💰 Smart Extraction                — 1 chamada ao mudar de chat
  💰 Graph extraction                — manual, quando user pede

TOGGLE "Memoria Automatica":
  ON  → Session Indexing (gratis) + Smart Extraction (pago) rodam ao mudar de chat
  OFF → Nada automatico. So manual.

NAO PRECISA de API key extra:
  ✅ Embedding e 100% local (Qwen3-Embedding-0.6B ONNX)
  ✅ LLM extraction usa o mesmo provider/modelo do chat
  ✅ Zero config adicional pro usuario
```

---

## 12. CONSOLIDADO FINAL — Decisoes, Motivos e Descartados

> Esta secao e o TL;DR executivo. Se voce esta lendo este doc pela primeira vez
> ou voltando meses depois, leia APENAS esta secao. O resto e pesquisa de apoio.

### 12.1 DECISOES APROVADAS

#### D1. Modelo de Embedding: multilingual-e5-base ONNX (substitui e5-small) — ✅ IMPLEMENTADO

**Decisao revisada:** Qwen3-Embedding-0.6B **DESCARTADO** — sem suporte nativo Transformers.js,
~600MB-1.2GB, 380ms. Pesado demais para Electron.

**O que mudou:** Trocar `Xenova/multilingual-e5-small` (384d, 33M params, 118MB)
por `Xenova/multilingual-e5-base` ONNX (768d, ~110M params, ~150-440MB q8).

**Por que e5-base:**
- Mesma familia do modelo atual — upgrade seguro sem surpresas
- Suporte nativo em Transformers.js (nossa runtime)
- Portugues nativo, 100+ idiomas
- Prefixes `query:`/`passage:` melhoram qualidade de retrieval
- Peso razoavel para Electron (~150-440MB vs 600MB+ do Qwen3)

**Trade-off aceito:** Latencia sobe de ~16ms para ~50-200ms no CPU.
Aceitavel porque o usuario ja espera 2-5s pela resposta da LLM.

**O ONNX PRECISA DE API? NAO.**
O e5-base ONNX roda 100% local dentro do Electron via
`@huggingface/transformers` + ONNX Runtime.
NAO usa OpenRouter, NAO usa Gemini API, NAO usa internet.
O modelo e bundled dentro do app (em `models/embeddings/` ou `extraResources`).
Funciona offline. Funciona sem API key nenhuma configurada.

Embedding e LLM sao coisas completamente separadas:
- **Embedding** (e5-base ONNX) → local, gratis, offline, sempre funciona
- **LLM** (Gemini/OpenRouter) → API, pago, precisa internet e config
- Um NAO depende do outro

#### D2. Quando salvar memoria automatica: ao MUDAR DE CHAT ou ANTES DE COMPACTAR

**O que:** A extracao inteligente de memorias roda em 2 momentos:
1. Quando o usuario cria um novo chat (conversa anterior e processada)
2. Antes de compactar o historico (msgs que serao resumidas sao processadas antes)

**Por que:**
- Historico COMPLETO da conversa disponivel = extracao com mais contexto = melhor
- 1 chamada LLM por conversa inteira vs N chamadas por exchange = mais barato
- Nao gasta API com "bom dia" / "obrigado" / perguntas triviais
- Momento natural: trocar de chat = "acabou o assunto, hora de guardar"
- OpenClaw faz o mesmo (indexa ao fechar sessao, nao a cada mensagem)

#### D3. LLM para extracao: MESMO MODELO do chat (zero config extra)

**O que:** A extracao de memorias usa exatamente o mesmo modelo que o usuario
ja configurou pro chat (seja Gemini, Claude via OpenRouter, ou qualquer outro).

**Por que:**
- Zero fricao pro usuario final (pais do Marco, nao tecnicos)
- Menos codigo: nao precisa de `resolveExtractionModel()`, config separada, UI extra
- O modelo do chat ja "conhece" o dominio (RH, CLT, escalas)
- Custo irrelevante: 1 chamada ao trocar de chat, nao a cada mensagem
- Principio: menos ruido na programacao

#### D4. Toggle "Memoria Automatica" na pagina de Memoria

**O que:** Switch on/off na MemoriaPagina que controla se o sistema
salva memorias automaticamente.

**Comportamento:**
- **ON:** Ao mudar de chat → Session Indexing (gratis) + Smart Extraction (pago)
- **OFF:** Nada automatico. So salva se user pedir via chat ou importar documento

A memoria manual (user fala "salva isso" no chat, ou importa .md) funciona
SEMPRE, independente do toggle.

#### D5. Auto-Recall via AI SDK Middleware (gratis, a cada mensagem)

**O que:** Antes de cada chamada de IA, automaticamente:
1. Gera embedding da mensagem do usuario (Qwen3 local, gratis)
2. Faz hybrid search no PGLite (FTS + vector, gratis)
3. Injeta Top-K chunks relevantes no system prompt via Middleware

**Por que:**
- Conhecimento de conversas passadas SEMPRE disponivel
- Nao depende da LLM decidir chamar a tool `buscar_conhecimento`
- Custo zero (tudo local)
- Implementacao limpa via `LanguageModelV3Middleware.transformParams` do AI SDK v6

#### D6. History Compaction com Summary Buffer

**O que:** Quando o historico da conversa atual ultrapassa ~30K tokens estimados,
resume as mensagens antigas com LLM e mantem so as N recentes intactas.

**Por que:**
- Hoje enviamos historico COMPLETO (sem limite, sem resumo, sem truncamento)
- Context rot: apos ~40K tokens, qualidade do LLM degrada (Chroma Research)
- Custo cresce linearmente com historico
- OpenClaw e LangChain usam o mesmo pattern (Summary + Window)

**Resumo cacheado** em `ia_conversas.resumo_compactado`.
Se compactar de novo, sobrescreve (nao empilha).

#### D7. Session Indexing: conversa vira documento no Knowledge

**O que:** Ao fechar conversa (criar novo chat ou arquivar), a transcricao
sanitizada (so user + assistant text, sem tool JSON) e indexada no knowledge layer.

**Por que:**
- "O que discutimos sobre a escala do acougue semana passada?" passa a funcionar
- Custo zero (embedding local)
- Dedup por conversa_id (nao duplica se processar 2x)
- Importancia LOW (decai em 30 dias se nunca acessada via busca)

#### D8. Auto-update de memorias dinamicas (merge inteligente)

**O que:** Ao extrair memorias de uma conversa, o sistema verifica se a info
ja existe no knowledge. Se sim, ATUALIZA em vez de duplicar.

**Comportamento:**

```
LLM extrai: "[fact] Pedro tem contrato 36h"

Check dedup (embedding cosine):
  → Existe "[fact] Pedro tem contrato 44h" com cosine > 0.85?
  → SIM: SUBSTITUI o antigo pelo novo (info mais recente ganha)
  → NAO: INSERE como nova memoria
```

**Regras de merge:**
- Cosine similarity > 0.85 entre summary novo e existente = provavel duplicata/atualizacao
- Info mais recente SEMPRE ganha (substitui a antiga)
- Se categorias diferentes mas conteudo similar = mantem ambas (pode ser contexto diferente)
- Corrections SEMPRE substituem facts anteriores sobre o mesmo assunto

**Por que:**
- Sem merge, o knowledge enche de versoes conflitantes ("Pedro 44h" + "Pedro 36h")
- A IA ficaria confusa ao encontrar info contraditoria no auto-recall
- Mem0 faz exatamente isso: "new facts get stored, outdated ones get updated, duplicates get merged"

#### D9. Limites de armazenamento por tipo de memoria

**O que:** Limites claros para cada tipo de memoria, evitando crescimento infinito.

##### Memoria PERMANENTE (manual, importance HIGH)

| Limite | Valor | Motivo |
|--------|-------|--------|
| Max entradas | **20** | Escopo fechado (RH de supermercado). 20 fatos permanentes cobrem tudo |
| Max titulo | **100 chars** | Titulo curto e descritivo |
| Max conteudo | **500 chars** | Fato + contexto minimo. Se precisar de mais, e um documento (importar .md) |

Quando atingir 20 entradas permanentes:
- Sistema avisa: "Limite de memorias permanentes atingido (20/20). Remova uma para adicionar."
- NAO remove automaticamente. User decide o que descartar.
- UI mostra lista com opcao de remover individualmente

##### Memoria DINAMICA (auto-extracted, importance LOW)

| Limite | Valor | Motivo |
|--------|-------|--------|
| Max entradas | **100** | Suficiente para meses de uso. Decay cuida do resto |
| Max titulo | **200 chars** | Gerado pelo LLM, pode ser mais descritivo |
| Max conteudo por item | **500 chars** | Resumo da LLM, nao a conversa toda |
| Lazy decay | **30 dias sem acesso** | Se ninguem buscou em 30 dias, vira invisivel |

Quando atingir 100 entradas dinamicas:
- Sistema remove automaticamente a MAIS ANTIGA que nao foi acessada (lowest access_count + oldest)
- FIFO com peso de acesso: entradas nunca acessadas saem primeiro
- Entradas acessadas recentemente sobrevivem mesmo sendo antigas

##### Session Transcripts (conversas indexadas, importance LOW)

| Limite | Valor | Motivo |
|--------|-------|--------|
| Max conversas indexadas | **50** | ~2-3 meses de uso diario |
| Lazy decay | **30 dias sem acesso** | Conversas nunca referenciadas decaem |

Quando atingir 50 transcricoes:
- Remove automaticamente a mais antiga nunca acessada
- Conversas cujos chunks foram acessados via auto-recall sobrevivem

##### Resumo de limites

```
PERMANENTE (manual, HIGH):
  20 entradas max | 100 chars titulo | 500 chars conteudo
  Nao remove automatico. User gerencia.

DINAMICA (auto-extracted, LOW):
  100 entradas max | 200 chars titulo | 500 chars conteudo
  Remove automatico: FIFO ponderado por acesso + decay 30 dias

SESSION TRANSCRIPTS (conversas, LOW):
  50 transcricoes max | decay 30 dias
  Remove automatico: oldest + never accessed first

TOTAL ESTIMADO NO PIOR CASO:
  20 permanentes × ~3 chunks = ~60 chunks
  100 dinamicas × ~1 chunk = ~100 chunks
  50 transcricoes × ~5 chunks = ~250 chunks
  Total: ~410 chunks × 1024d embedding × 4 bytes = ~1.6 MB em vetores
  Irrelevante pro PGLite.
```

---

### 12.2 DESCARTADOS E POR QUE

#### X1. DESCARTADO: Auto-capture a cada exchange (como Mem0 faz)

**O que seria:** Apos cada troca user/assistant, analisar e extrair memorias.

**Por que descartamos:**
- Muitas chamadas LLM = caro e lento
- A maioria dos exchanges nao tem info util ("bom dia", "obrigado", "ok")
- Sem contexto da conversa completa, extracao e pior (nao sabe se "Maria" e a do acougue ou padaria)
- Salvar ao mudar de chat com historico completo e superior em tudo

#### X2. DESCARTADO: Modelo LLM separado/menor para extracao

**O que seria:** Usar Gemini Flash Lite ou modelo mais barato especificamente
para a extracao de memorias, diferente do modelo do chat.

**Por que descartamos:**
- Adiciona config extra (qual modelo? onde configurar?)
- Fricao pro usuario nao-tecnico
- Mais codigo: precisa de `resolveExtractionModel()`, fallback, error handling separado
- Custo ja e irrelevante (1 chamada por conversa)
- Principio do Marco: "menos ruido na programacao"

#### X3. DESCARTADO: Modelo Qwen3 0.6B LLM para extracao/classificacao

**O que seria:** Usar o Qwen3 0.6B como LLM local (nao embedding) para decidir
o que salvar, rodar inference local sem API.

**Por que descartamos:**
- Qwen3 0.6B **LLM** != Qwen3 0.6B **Embedding**. Sao modelos diferentes.
- O LLM de 0.6B e fraco pra tarefas estruturadas (extrair JSON, classificar)
- Seria lento (~2.5GB RAM, 50-200ms por token = segundos de inference)
- Melhor usar a LLM do chat que ja e boa e esta paga

#### X4. DESCARTADO: Usar embedding para DECIDIR o que salvar (sem LLM)

**O que seria:** Comparar embedding da mensagem com vetores de referencia
("isso e trivial?" → cosine similarity) em vez de usar LLM.

**Por que descartamos:**
- Embedding compara SIMILARIDADE, nao IMPORTANCIA
- "A Maria nao pode trabalhar domingo" e semanticamente similar a "horario de trabalho"
  mas o FATO sobre a Maria e muito mais importante
- Pra decidir "isso e uma preferencia, fato, correcao?" precisa de ENTENDIMENTO
- Poderia ser usado como pre-filtro, mas adiciona complexidade sem necessidade
  (ja que so roda 1x por conversa, a LLM da conta)

#### X5. DESCARTADO: Escolher LLM para extracao na UI (config separada)

**O que seria:** Dropdown na pagina de Memoria para o usuario escolher
qual modelo usar para extracao automatica.

**Por que descartamos:**
- Usuarios sao RH de supermercado, nao tecnicos
- "Escolha o modelo de extracao" e jargao incompreensivel
- Adiciona complexidade na UI e no backend sem ganho real
- Principio: menor fricao possivel

#### X6. DESCARTADO: Manter multilingual-e5-small para auto-recall (hibrido)

**O que seria:** Usar e5-small (16ms) para auto-recall (precisa ser rapido)
e Qwen3 (380ms) para indexacao (qualidade importa mais).

**Por que descartamos:**
- Vetores de dimensoes diferentes (384 vs 1024) sao INCOMPATIVEIS
- Nao da pra indexar com 1024d e buscar com 384d
- Teria que manter 2 modelos, 2 pipelines, 2 colunas de embedding
- Complexidade absurda pra ganhar 360ms
- 380ms e aceitavel (user espera 2-5s da LLM de qualquer forma)

#### X7. DESCARTADO: Approach file-first do OpenClaw (Markdown como fonte de verdade)

**O que seria:** Salvar conversas como arquivos .md e indexar a partir deles,
como o OpenClaw faz.

**Por que descartamos:**
- Nos ja temos PGLite com pgvector + tsvector (busca nativa, atomica)
- Files adicionam partes moveis (sidecar de indexacao, reindexacao periodica)
- PGLite e transacional (nao corrompe mid-write)
- Indice sempre atualizado (sem esperar 5 min de reindex)
- Nosso approach e MELHOR pro nosso caso — so roubamos insights deles

**Insights que ADOTAMOS do OpenClaw:**
- Sanitizar transcricao (so user + assistant, sem tool JSON)
- Debounce: indexar ao fechar conversa, nao a cada mensagem
- Conversa como unidade atomica de conhecimento
- Resumo de compaction NAO vai pro knowledge (fica na sessao)

#### X8. DESCARTADO: Reindexacao periodica (a cada 5 min como OpenClaw)

**O que seria:** Timer que reindexa knowledge a cada N minutos.

**Por que descartamos:**
- PGLite indexa na hora do INSERT (tsvector e embedding sao gerados inline)
- Nao tem "indice desatualizado" — o indice E o banco
- Reindexacao periodica e workaround do OpenClaw porque files ≠ indice
- No nosso caso, dados entram ja indexados. Zero necessidade de reindex

---

### 12.3 PERGUNTAS FREQUENTES (pra relembrar)

**P: O embedding local (ONNX) precisa de internet/API/OpenRouter configurado?**
R: NAO. O Qwen3-Embedding-0.6B ONNX e bundled dentro do app Electron.
Roda via `@huggingface/transformers` + ONNX Runtime no processo principal.
Funciona offline, sem API key, sem provider configurado. E completamente
independente do Gemini/OpenRouter/Claude.

**P: E se o usuario nao configurou NENHUM provider de IA?**
R: Auto-Recall e Session Indexing funcionam (sao gratis, embedding local).
Smart Extraction NAO funciona (precisa de LLM). Mas o toggle so aparece
se o provider estiver configurado — sem provider, sem chat, sem extracao.

**P: BM25/FTS precisa de IA?**
R: NAO. FTS e SQL puro (`to_tsvector('portuguese', texto)`). Zero IA.
Embedding precisa do modelo local (Qwen3 ONNX). Sao 2 coisas separadas
que rodam juntas no hybrid search (70% vector + 30% FTS).

**P: O que e embedding vs LLM vs FTS?**
R: Tres tecnologias DIFERENTES:
- **FTS** (Full-Text Search): busca por PALAVRAS. SQL puro. Zero IA.
- **Embedding**: transforma texto em VETOR numerico. Modelo local pequeno. Busca por SIGNIFICADO.
- **LLM**: ENTENDE texto, gera respostas, extrai informacao. Modelo grande. Pago via API.

**P: O graph (knowledge_entities/relations) como funciona?**
R: O graph e extraido por LLM (nao por embedding). Hoje so funciona via
tool `salvar_conhecimento` manual ou botao "Organizar Memoria".
NAO e automatico. E uma feature separada do RAG de conversas.

**P: O Mem0 e o engram sao o que?**
R: Plugins do OpenClaw (nao nossos). Mem0 = servico cloud que extrai memorias.
Engram = plugin local que usa LLM pra extrair. Ambos sao AUTOMATICOS (rodam
a cada exchange). Nos descartamos esse approach (X1) em favor de extrair
ao mudar de chat com a conversa completa.

**P: O historico e enviado completo pra API hoje?**
R: SIM. Hoje `buildChatMessages()` converte TODAS as mensagens sem limite.
Com History Compaction (D6), passara a resumir msgs antigas e manter so
as N recentes quando ultrapassar ~30K tokens estimados.

---

### 12.4 DELETAR DOC/FONTE LIMPA AUTOMATICAMENTE O RAG

**Principio:** RAG nao e um artefato gerado que precisa "regerar". E um indice.

```
UPLOAD (1x):
  Doc → chunking (fatia) → embedding (vetor) → INSERT no PGLite
  knowledge_sources:  { id: 5, titulo: "Manual RH" }
  knowledge_chunks:   { source_id: 5, conteudo: "pedaco 1", embedding: [...] }
                      { source_id: 5, conteudo: "pedaco 2", embedding: [...] }

QUERY (a cada pergunta):
  Pergunta → embedding → hybrid search → chunks relevantes → injeta no prompt → LLM responde

DELETE:
  DELETE FROM knowledge_chunks WHERE source_id = 5;
  DELETE FROM knowledge_sources WHERE id = 5;
  → Chunks somem. Proxima busca nao acha. Limpo. Sem fantasma.
```

**Nao precisa "regerar" nada.** Os chunks daquele doc simplesmente desaparecem do indice.
A proxima busca nao vai encontra-los. Cada fonte e uma caixa. Deletar a caixa = deletar
tudo que veio dela.

**Para docs importados:** Chunk + embed + context hint = suficiente. Nao precisa de RAG
separado. O proprio chunking + embedding do doc JA E o RAG.

**Para auto-capture de conversa:** Fica separado (tipo "auto_capture" ou "session"). Cada
fonte tem sua origem rastreavel via `source_id`. Deletar conversa = deletar chunks da
conversa. Simples.

```
Tipos de fonte e o que acontece ao deletar:
  "sistema"       → Protegido, nao deletavel (CLT/CCT)
  "manual"        → Upload user: DELETE cascade chunks
  "auto_capture"  → Memoria dinamica: DELETE cascade chunks
  "session"       → Transcricao conversa: DELETE cascade chunks
```

### 12.5 GRAPH: PROBLEMA DE RASTREABILIDADE DE ORIGEM

**Estado atual do schema:**

```sql
knowledge_entities (id, nome, tipo, embedding, valid_from, valid_to)
  -- SEM source_id. Entidade nao sabe de onde veio.

knowledge_relations (id, entity_from_id, entity_to_id, tipo_relacao, peso, valid_from, valid_to)
  -- Liga entidades entre si. Tambem SEM source_id.
```

**Problema identificado:** Entidades e relacoes NAO apontam pra fonte de origem.
Se o user deleta um doc, os chunks somem (CASCADE via source_id), mas as entidades/relacoes
extraidas daquele doc FICAM orfas no graph. Nao tem como saber "essa entidade veio daquele doc".

**Como o mercado resolve graph com historicos grandes:**

1. **Chunk-level extraction (mais comum)**
   - NAO processa o documento inteiro numa chamada LLM
   - Extrai entidades/relacoes de CADA CHUNK individualmente (~1500 chars, cabe facil no contexto)
   - Merge: se entidade "Pedro" ja existe, nao duplica — atualiza ou ignora
   - Custo: 1 chamada LLM por chunk (caro pra docs grandes)

2. **Summary-then-extract (mais economico)**
   - Resume o doc primeiro (1 chamada LLM)
   - Extrai entidades/relacoes do resumo (1 chamada LLM)
   - Perde detalhes mas e 2 chamadas vs N

3. **Incremental (como OpenClaw engram)**
   - Nao processa tudo de uma vez
   - Processa o que e NOVO (conversa atual, doc recem importado)
   - Merge com graph existente via nome de entidade (dedup)

**Sobre deletar doc vs graph — 3 abordagens do mercado:**

| Abordagem | Como funciona | Pros | Cons |
|-----------|---------------|------|------|
| **Source tracking** | `knowledge_entities.source_ids[]` (array de fontes) | Sabe de onde veio, pode limpar | Schema mais complexo, merge de arrays |
| **Soft-delete temporal** | `valid_to = NOW()` na entidade quando fonte morre | Simples, reversivel | Graph acumula lixo invisivel |
| **Rebuild on delete** | Deleta TODAS as entidades e regenera do zero a partir das fontes restantes | Sempre limpo | Caro (re-extrai tudo), lento |

**Decisao (D10): Graph e rebuild completo — sem source tracking**

O graph e IDEMPOTENTE. Nao precisa de junction table pra rastrear origem.

```
Rebuild graph (botao "Organizar Memoria"):
  1. DELETE FROM knowledge_relations;
  2. DELETE FROM knowledge_entities;
  3. Para cada knowledge_source VIVA → pega chunks → LLM extrai → INSERT entidades/relacoes
  4. Pronto. Graph reflete exatamente o que existe no momento.
```

**Por que nao precisa de source tracking:**
- Graph e dado DERIVADO, nao fonte de verdade
- Fontes de verdade = knowledge_sources + knowledge_chunks
- Graph e como uma "materialized view" — regenera a partir das fontes
- Deletou um doc? Na proxima regeneracao, o doc nao existe, entidades dele nao voltam
- Zero complexidade extra: sem junction table, sem cleanup, sem triggers

**Custo do rebuild:**
- ~1 chamada LLM por chunk para extrair entidades
- 100 chunks = ~100 chamadas (caro, por isso graph e P3/manual)
- Mas so roda quando o user aperta o botao — nao e automatico

**DESCARTADO: Junction table `knowledge_entity_sources`**
- So faria sentido se graph fosse incremental (adiciona sem nunca reconstruir)
- No nosso caso rebuild completo e mais simples e sempre correto
- Over-engineering pra um problema que nao existe

### 12.6 FASES DE IMPLEMENTACAO (ordem de prioridade)

| Fase | O que | Custo | Depende de | Estimativa |
|------|-------|-------|------------|------------|
| **0** | Migrar embedding pra Qwen3-Embedding-0.6B ONNX | Gratis | Nada | ~3h (trocar modelo, migration pgvector 384→1024, rebuild embeddings) |
| **1** | Auto-Recall via AI SDK Middleware | Gratis | Fase 0 | ~2h |
| **2** | Session Indexing ao mudar de chat | Gratis | Fase 0 | ~3h |
| **3** | History Compaction (Summary Buffer) | Pago (LLM) | Nada | ~4h |
| **4** | Smart Extraction ao mudar de chat + toggle UI | Pago (LLM) | Fase 2 | ~4h |

Fases 0-2 sao gratis e independentes da config de LLM.
Fases 3-4 precisam de provider configurado.
Fase 0 e prerequisito pra 1 e 2 (novo modelo de embedding).

---

## Sources

### OpenClaw Memory & RAG
- [Memory - OpenClaw (docs oficiais)](https://docs.openclaw.ai/concepts/memory)
- [Compaction - OpenClaw (docs oficiais)](https://docs.openclaw.ai/concepts/compaction)
- [Deep Dive: How OpenClaw's Memory System Works](https://snowan.gitbook.io/study-notes/ai-blogs/openclaw-memory-system-deep-dive)
- [OpenClaw Memory Architecture Explained - Medium](https://medium.com/@shivam.agarwal.in/agentic-ai-openclaw-moltbot-clawdbots-memory-architecture-explained-61c3b9697488)
- [Context Management & Auto-Compaction - DeepWiki](https://deepwiki.com/openclaw/openclaw/5.5-context-overflow-and-auto-compaction)
- [Local-First RAG: Using SQLite for AI Agent Memory with OpenClaw](https://www.pingcap.com/blog/local-first-rag-using-sqlite-ai-agent-memory-openclaw/)
- [openclaw-engram - GitHub](https://github.com/joshuaswarren/openclaw-engram)

### Mem0
- [We Built Persistent Memory for OpenClaw - Mem0](https://mem0.ai/blog/mem0-memory-for-openclaw)
- [Mem0: Building Production-Ready AI Agents with Scalable Long-Term Memory](https://arxiv.org/html/2504.19413v1)

### BM25
- [Understanding the BM25 Algorithm - Evan Schwartz](https://emschwartz.me/understanding-the-bm25-full-text-search-algorithm/)
- [What is BM25 - GeeksforGeeks](https://www.geeksforgeeks.org/nlp/what-is-bm25-best-matching-25-algorithm/)
- [BM25 - ParadeDB](https://www.paradedb.com/learn/search-concepts/bm25)

### History Management
- [LLM Chat History Summarization Guide - Mem0](https://mem0.ai/blog/llm-chat-history-summarization-guide-2025)
- [Context Window Management Strategies - apxml](https://apxml.com/courses/langchain-production-llm/chapter-3-advanced-memory-management/context-window-management)
- [Managing Chat History for LLMs - Microsoft Semantic Kernel](https://devblogs.microsoft.com/semantic-kernel/managing-chat-history-for-large-language-models-llms/)
- [Context Rot: How Increasing Input Tokens Impacts LLM Performance - Chroma Research](https://research.trychroma.com/context-rot)

### Token Counting
- [Token Counting Explained: tiktoken, Anthropic, and Gemini - Propel](https://www.propelcode.ai/blog/token-counting-tiktoken-anthropic-gemini-guide-2025)
- [How to Count Tokens Before API Request - Vellum](https://www.vellum.ai/blog/count-openai-tokens-programmatically-with-tiktoken-and-vellum)

### Vercel AI SDK
- [AI SDK Core: Language Model Middleware](https://ai-sdk.dev/docs/ai-sdk-core/middleware)
- [AI SDK 6 - Vercel](https://vercel.com/blog/ai-sdk-6)
- [Community Providers: Mem0](https://ai-sdk.dev/providers/community-providers/mem0)
- [OpenClaw Session Management](https://docs.openclaw.ai/concepts/session)
