# Tool Calling Playbook — De Zero a 30 Tools em Producao

> **Proposito:** Guia reproduzivel e definitivo. Leia este doc e replique toda a estrategia de tool calling do EscalaFlow — patterns, stack, discovery, testes, prompts — em qualquer projeto.
>
> **Baseado em:** Implementacao real com 30 tools, guia de estudo (tool-calling-guide-v3-2), e Vercel AI SDK v6.
>
> **Atualizado:** 2026-02-24
>
> **Cleanup v2 (2026-02-24):** 3 tools redundantes removidas (get_context, obter_regra_horario_colaborador, obter_regras_horario_setor). Discovery auto cobre. TOOL_RESULT_MAX_CHARS 400→1500. Follow-up com tools habilitado.

---

## Indice

1. [Modelo mental — o que a IA realmente ve](#1-modelo-mental)
2. [Stack e wiring — o loop agentico completo](#2-stack-e-wiring)
3. [Zod como GPS — schemas que ensinam a IA](#3-zod-como-gps)
4. [Discovery Design — a IA descobre aos poucos](#4-discovery-design)
5. [Respostas ricas — o pattern 3-status](#5-respostas-ricas)
6. [System prompt — arquitetura de 9 secoes](#6-system-prompt)
7. [Auto-correcao — 3 mecanismos](#7-auto-correcao)
8. [Historico e continuidade](#8-historico-e-continuidade)
9. [Testes — 5 camadas de validacao](#9-testes)
10. [Observabilidade — DevTools e telemetria](#10-observabilidade)
11. [Formatacao de respostas — Markdown no chat](#11-formatacao-de-respostas)
12. [Catalogo de patterns consolidado](#12-catalogo-de-patterns)
13. [Checklist de implementacao](#13-checklist)
14. [Anti-patterns mortais](#14-anti-patterns)

---

## 1. Modelo Mental

### O que a IA realmente "ve"

Quando voce define tools com Zod + Vercel AI SDK, o SDK **converte o schema pra JSON Schema** e manda pro modelo junto com a mensagem. A IA nao ve seu TypeScript. Ela ve um JSON descritivo.

```
Tu escreve:
  z.object({ setor_id: z.number().int().positive().describe('ID do setor') })

IA recebe:
  { "properties": { "setor_id": { "type": "integer", "minimum": 1, "description": "ID do setor" } } }
```

A IA le **3 coisas** pra decidir se e como chamar uma tool:

| O que | De onde vem | Impacto |
|-------|-------------|---------|
| **Nome da tool** | `name` no objeto tool | Identifica o que faz |
| **Description da tool** | `description` no objeto tool | Entende QUANDO usar |
| **Schema dos parametros** (incluindo `.describe()`) | Zod → JSON Schema | Entende O QUE passar |

> **Principio #1:** A IA e tao inteligente quanto o contexto que voce da. Descriptions ricas + respostas com dados contextuais + schema com `.describe()` = IA que parece magica. Descriptions pobres + dados crus + schema sem describe = IA que parece burra.

### Quem faz o que

```
Usuario (React) → IPC → Main Process (Node.js) → Vercel AI SDK generateText/streamText
                                                    ↕ tools loop (max 10 steps)
                                                    → system-prompt.ts (prompt estático)
                                                    → discovery.ts (auto-contexto por request)
                                                    → tools.ts (30 tools, schemas Zod + handlers)
```

O SDK orquestra o loop. Voce define as tools. A IA decide quais chamar e em que ordem.

---

## 2. Stack e Wiring

### Dependencias

```bash
# Core (obrigatorio)
pnpm add ai zod
# Provider (escolha um ou mais)
pnpm add @ai-sdk/google          # Gemini
pnpm add @openrouter/ai-sdk-provider  # OpenRouter (multi-modelo)
# Dev
pnpm add -D @ai-sdk/devtools     # Viewer local
```

### O loop agentico — codigo funcional minimo

```typescript
import { generateText, tool, stepCountIs } from 'ai'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { z } from 'zod'

const google = createGoogleGenerativeAI({ apiKey: process.env.GEMINI_KEY })

const result = await generateText({
  model: google('gemini-2.5-flash'),
  system: 'Voce e assistente de RH...',
  messages: [{ role: 'user', content: 'Quem trabalha no acougue?' }],
  stopWhen: stepCountIs(10),   // max 10 turnos de tool calling

  tools: {
    consultar: tool({
      description: 'Consulta dados do banco',
      parameters: z.object({
        entidade: z.enum(['colaboradores', 'setores']).describe('Tabela a consultar'),
        filtros: z.record(z.any()).optional().describe('Filtros campo:valor'),
      }),
      execute: async ({ entidade, filtros }) => {
        const rows = db.prepare(buildQuery(entidade, filtros)).all()
        return { status: 'ok', total: rows.length, dados: rows }
      }
    }),
  },
})
```

### Mecanica interna de um step

```
1. IA le system prompt + messages + tools disponiveis
2. IA decide chamar tool: { tool: "consultar", args: { entidade: "colaboradores" } }
3. SDK executa a funcao execute() (await — sincrono por step)
4. Teu codigo retorna: { status: "ok", dados: [...] }
5. SDK faz JSON.stringify(resultado)
6. SDK cria mensagem tool_result e manda de volta pro modelo
7. IA le o resultado como texto plano no context window
8. IA decide: chamar outra tool OU gerar texto pro user
9. Repete ate stopWhen ou IA gerar texto final
```

> **FATO CRUCIAL:** Nao existe "canal separado". O execute() retorna um objeto, o SDK serializa pra string, e a IA le como texto. Nao tem campo "so pra IA" vs "so pro user". Tudo que voce retorna, ela le.

### generateText vs streamText

| Aspecto | generateText | streamText |
|---------|-------------|------------|
| Retorno | Bloqueia ate tudo acabar | Envia tokens em tempo real |
| UX pro user | Spinner → resposta completa | Texto aparece gradualmente |
| Tool calls visiveis? | So depois de acabar (`result.steps`) | Eventos em tempo real (`onToolCall`) |
| Loop agentico | `stopWhen` funciona | `stopWhen` funciona |
| Quando usar | Server-side, Electron main process | Edge, browser, UX moderna |

### Streaming no Electron (EscalaFlow)

```typescript
// Main process: consome fullStream e emite eventos IPC pro renderer
const result = streamText({ model, system, messages, tools, stopWhen: stepCountIs(10) })

for await (const part of result.fullStream) {
  if (part.type === 'text-delta') {
    broadcastToRenderer('ia:stream', { type: 'text-delta', delta: part.text })
  } else if (part.type === 'tool-call') {
    broadcastToRenderer('ia:stream', { type: 'tool-call-start', tool_name: part.toolName })
  } else if (part.type === 'tool-result') {
    broadcastToRenderer('ia:stream', { type: 'tool-result', tool_name: part.toolName, result: part.output })
  }
}
```

### Follow-up silencioso (quando a IA so chama tools e nao gera texto)

Problema comum: a IA executa 3 tools, resolve tudo, mas nao gera texto final. O SDK termina com `text = ""`.

Solucao (implementada no EscalaFlow):

```typescript
if ((!finalText || finalText.trim().length === 0) && acoes.length > 0) {
  // Envia result.response.messages (inclui tool results reais) + nudge
  const followUpMessages = [
    ...result.response.messages,
    { role: 'user', content: 'Com base nos resultados das ferramentas, responda ao usuario.' },
  ]
  const finalResult = await generateText({ model, system, messages: followUpMessages })
  finalText = finalResult.text || 'Feito!'
}
```

> **Nota:** Com respostas ricas (status + _meta), esse follow-up tende a ser cada vez menos necessario. A IA entende que ja tem tudo e responde naturalmente.

---

## 3. Zod como GPS

### O que a IA ve vs o que nao ve

| Recurso Zod | IA ve? | Detalhe |
|-------------|--------|---------|
| `z.string()` / `z.number()` | Sim | Tipo basico |
| `.describe('...')` | **SIM — CHAVE** | Vira `"description"` no JSON Schema |
| `z.enum(['A','B'])` | Sim | Lista exata de opcoes validas |
| `.optional()` | Sim | IA sabe que pode omitir |
| `.min()` / `.max()` | Sim | Constraints numericos |
| `.regex()` | Sim | Pattern de validacao |
| `.refine()` | **NAO** | E funcao JS, nao vira JSON Schema |
| `.transform()` | **NAO** | Idem |
| `z.custom()` | **NAO** | Validacao custom invisivel |

### O .describe() e o segredo

```typescript
// SEM describe — IA adivinha
z.object({ data: z.string(), tipo: z.string() })

// COM describe — IA SABE o que fazer
z.object({
  data: z.string().describe('Data no formato YYYY-MM-DD. Ex: 2026-02-22'),
  tipo: z.enum(['folga', 'feriado']).describe('Tipo de afastamento'),
})
```

### Schema dinamico (dados do banco em runtime)

```typescript
// Busca do banco ANTES de montar o schema
const setores = db.prepare('SELECT nome FROM setores WHERE ativo=1').all()
const nomes = setores.map(s => s.nome) as [string, ...string[]]

// Schema com dados reais!
z.object({
  setor: z.enum(nomes).describe('Nome do setor')
})
// IA recebe: enum: ["Caixa", "Acougue", "Padaria"]
```

### Limites do enum dinamico

| Quantidade | Viabilidade | Nota |
|-----------|-------------|------|
| 5–20 itens | Perfeito | IA ve todas as opcoes |
| 50–100 itens | Funciona | Polui contexto mas rola |
| 500+ itens | Nao escala | Use tool de busca em vez de enum |

> **Regra de ouro:** Poucos valores conhecidos? → `z.enum()` com dados do banco. Muitos ou imprevisiveis? → Tool de busca + tool de acao (Discovery Design).

### Exemplo real: schemas do EscalaFlow

```typescript
// Cada campo tem .describe() — a IA sabe O QUE, DE ONDE, e COMO
const GerarEscalaSchema = z.object({
  setor_id: z.number().int().positive()
    .describe('ID do setor. Extraia do discovery auto no prompt a partir do nome citado pelo usuario.'),
  data_inicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
    .describe('Data inicial da escala no formato YYYY-MM-DD.'),
  data_fim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
    .describe('Data final da escala no formato YYYY-MM-DD.'),
  rules_override: z.record(z.string(), z.string()).optional()
    .describe('Overrides opcionais de regras (codigo -> status), ex: {"H1":"SOFT"}'),
})
```

---

## 4. Discovery Design

A IA nao sabe tudo. Ela **descobre aos poucos**, chamando tools em sequencia. Cada resultado informa a proxima decisao.

### Duas estrategias complementares

#### A. Discovery no System Prompt (passivo — dados injetados)

A cada mensagem do usuario, monta-se um "briefing" com dados frescos do banco e injeta no system prompt. A IA ja recebe o contexto sem gastar tool calls.

```typescript
// discovery.ts — roda A CADA MENSAGEM
export function buildContextBriefing(contexto?: IaContexto): string {
  const db = getDb()
  const sections = []

  // Resumo global (sempre)
  sections.push(`Setores ativos: ${count('setores')}`)
  sections.push(`Colaboradores ativos: ${count('colaboradores')}`)

  // Feriados proximos 30 dias
  // Regras com override da empresa
  // Excecoes ativas (ferias/atestados)

  // Se usuario esta num setor especifico: colaboradores, demandas, escala atual
  if (contexto?.setor_id) sections.push(infoSetor(db, contexto.setor_id))

  // Alertas proativos (violacoes HARD, escalas desatualizadas, excecoes expirando)
  sections.push(alertasProativos(db, contexto?.setor_id))

  // Dica de pagina (contexto da UI)
  sections.push(dicaPagina(contexto?.pagina))

  return sections.join('\n')
}

// Injection no system prompt
const fullSystemPrompt = contextBriefing
  ? `${SYSTEM_PROMPT}\n\n---\n${contextBriefing}`
  : SYSTEM_PROMPT
```

**Quando usar:** Dados cabem no prompt (<3k tokens). Zero tool calls. Funciona bem com poucos setores/colaboradores.

#### B. Discovery via Tool Call (ativo — IA pede)

Tools de leitura que a IA chama quando precisa de mais contexto:

```
consultar(entidade, filtros)        → SQL-like generico
buscar_colaborador(nome/id)         → Busca semantica por pessoa
buscar_conhecimento(query)          → Busca hibrida na knowledge base (vector + FTS)
listar_perfis_horario(contrato_id)  → Perfis por contrato
obter_alertas()                     → Agregacao de problemas
preflight(setor_id, datas)          → Viabilidade pre-geracao
```

> **Nota (Cleanup v2):** `get_context` foi removida — o discovery auto (injetado no system prompt a cada request) cobre o mesmo papel sem gastar tool call. `obter_regra_horario_colaborador` e `obter_regras_horario_setor` tambem removidas — `consultar` com filtros resolve.

**Quando usar:** Dados que nao estao no discovery automatico, ou que a IA precisa buscar sob demanda.

### As 3 camadas de tools

```
LAYER 1 — DISCOVERY (read-only, barata)
  discovery auto (injetado no prompt), consultar, buscar_colaborador, listar_perfis,
  obter_alertas, resumir_horas_setor, preflight, diagnosticar_escala, explicar_violacao,
  buscar_conhecimento, listar_conhecimento, explorar_relacoes

LAYER 2 — VALIDACAO (regras de negocio)
  preflight_completo (capacity checks completos antes de gerar)

LAYER 3 — ACAO (write, com cuidado)
  criar, atualizar, deletar, cadastrar_lote,
  gerar_escala, ajustar_alocacao, ajustar_horario, oficializar_escala,
  editar_regra, salvar_regra_horario, definir_janela, resetar_regras,
  upsert_regra_excecao_data, salvar_demanda_excecao_data, salvar_conhecimento, ...
```

### Fluxo real de discovery

```
User: "Gera escala do Acougue pra marco"

IA pensa: "Preciso do setor_id do Acougue"
  → Le o discovery no system prompt: "Acougue (ID: 2)"
  → Ja tem! Sem tool call.

IA pensa: "Vou gerar"
  → gerar_escala({ setor_id: 2, data_inicio: '2026-03-02', data_fim: '2026-03-29' })

IA recebe: { status: 'ok', escala_id: 15, indicadores: { cobertura: 87%, score: 82 } }

IA responde: "Escala gerada pro Acougue! Score 82/100, cobertura 87%. Quer oficializar?"
```

**Sem discovery no prompt**, o fluxo seria:
```
Step 1: consultar({ entidade: 'setores' }) → busca tudo (1 tool call extra)
Step 2: gerar_escala(...)
```

> **Discovery automatico economiza 1+ tool calls por mensagem.** A IA ja recebe setores, colaboradores, escala atual, alertas — tudo pronto pra agir. Por isso `get_context` foi removida no Cleanup v2 — era redundante.

### O que o discovery injeta (implementacao real)

| Secao | Conteudo | Quando |
|-------|----------|--------|
| Resumo global | Setores, colabs, escalas RASCUNHO/OFICIAL | Sempre |
| Feriados proximos | Proximos 30 dias com flag "proibido" | Sempre |
| Regras custom | Overrides empresa vs default sistema | Se houver |
| Setores | Lista com nome, ID, horario, num colabs | Sempre |
| Setor em foco | Colabs, excecoes, demandas, escala atual | Se `contexto.setor_id` |
| Colaborador em foco | Contrato, restricoes, excecoes | Se `contexto.colaborador_id` |
| Alertas proativos | Violacoes HARD, escalas desatualizadas (hash), excecoes expirando | Sempre |
| Dica de pagina | Contexto da UI ("usuario esta na pagina de escala") | Sempre |

---

## 5. Respostas Ricas — O Pattern 3-Status

### O principio

A IA le **tudo** que o `execute()` retorna. A resposta da tool contextualiza os dados pra IA. Nao retorna dado cru — retorna dados com status, nomes legiveis, e contexto de navegacao.

### 3 helpers centralizados

```typescript
function toolOk<T>(payload: T, options?: { summary?: string; meta?: ToolMeta }) {
  return { status: 'ok', ...payload, ...(options?.meta ? { _meta: options.meta } : {}) }
}

function toolError(code: string, message: string, options?: { correction?: string }) {
  return { status: 'error', code, message, ...(options?.correction ? { correction: options.correction } : {}) }
}

function toolTruncated<T>(payload: T, options?: { summary?: string; meta?: ToolMeta }) {
  return { status: 'truncated', ...payload, ...(options?.meta ? { _meta: options.meta } : {}) }
}
```

### Regra dos 3 status

| Status | O que contem | IA faz o que |
|--------|-------------|--------------|
| **ok** | Dados ricos + `_meta` + nomes legiveis | Decide sozinha: responde OU encadeia |
| **error** | Mensagem clara + `correction` (instrucao de fix) + valores validos | Corrige parametros e tenta de novo |
| **truncated** | Dados parciais + aviso + sugestao de filtro | Refaz com parametros mais especificos |

### Antes vs Depois

```typescript
// ANTES — array cru do banco
return db.prepare(query).all()
// IA recebe: [{id:3, tipo_contrato_id:1, setor_id:2, ...}]
// Problemas: tipo_contrato_id:1 = ??? setor_id:2 = ???

// DEPOIS — dados ricos
return toolOk({
  total: rows.length,
  dados: rows.map(enrichRow),  // FK traduzida: setor_id:2 → setor_nome:"Acougue"
}, { meta: { ids_usaveis_em: ['gerar_escala', 'atualizar'] } })
// IA recebe: { status:"ok", total:1, dados:[{id:3, nome:"Cleunice", setor:"Acougue", contrato:"CLT 44h"}], _meta:... }
```

### FK enrichment (traduzir IDs em nomes)

```typescript
// Helper que traduz foreign keys em nomes legiveis
function enrichConsultarRows(entidade: string, rows: any[]): any[] {
  if (entidade === 'colaboradores') {
    return rows.map(r => ({
      ...r,
      setor_nome: lookupName('setores', r.setor_id),
      contrato_nome: lookupName('tipos_contrato', r.tipo_contrato_id),
      funcao_nome: r.funcao_id ? lookupName('funcoes', r.funcao_id) : null,
    }))
  }
  // ... outros entidades
  return rows
}
```

### Navigation metadata (_meta)

```typescript
// Diz pra IA quais tools aceitam os IDs retornados
_meta: {
  ids_usaveis_em: ['gerar_escala', 'atualizar', 'ajustar_alocacao'],
  next_tools_hint: 'Use gerar_escala com o setor_id retornado'
}
```

### Error correction

```typescript
// Em caso de erro, SEMPRE inclui correction (instrucao de fix pro LLM)
return toolError(
  'ENTIDADE_INVALIDA',
  `Entidade "${entidade}" nao permitida.`,
  { correction: 'Entidades validas: colaboradores, setores, escalas, ...' }
)
```

### Truncation

```typescript
const CONSULTAR_MODEL_ROW_LIMIT = 50

if (rows.length > CONSULTAR_MODEL_ROW_LIMIT) {
  return toolTruncated({
    total: rows.length,
    retornados: CONSULTAR_MODEL_ROW_LIMIT,
    dados: enriched.slice(0, CONSULTAR_MODEL_ROW_LIMIT),
    aviso: `Mostrando ${CONSULTAR_MODEL_ROW_LIMIT} de ${rows.length}. Adicione filtros.`,
  }, { meta: { ids_usaveis_em: getConsultarRelatedTools(entidade) } })
}
```

### SQL error translation

```typescript
// Traduz erros SQLite cripticos em mensagens acionaveis
if (err.message?.includes('NOT NULL')) {
  return toolError('NOT_NULL', 'Campo obrigatorio nao informado.', {
    correction: 'Campos obrigatorios: nome, setor_id, tipo_contrato_id'
  })
}
if (err.message?.includes('UNIQUE')) {
  return toolError('UNIQUE', 'Ja existe registro com esses dados.', {
    correction: 'Verifique se o registro ja existe antes de criar.'
  })
}
if (err.message?.includes('FOREIGN KEY')) {
  return toolError('FK_VIOLATION', 'ID referenciado nao existe.', {
    correction: 'Consulte IDs validos com consultar() ou buscar_colaborador().'
  })
}
```

---

## 6. System Prompt — Arquitetura de 9 Secoes

### Estrutura

| Secao | Conteudo | Linhas | Objetivo |
|-------|----------|--------|----------|
| Identidade | Tom, persona, regras de ouro | ~15 | Define QUEM a IA e e COMO se comporta |
| CLT/CCT | Contratos, regras legais, grid, precedencia | ~50 | Conhecimento de cor — nao precisa de tool |
| Motor | Fluxo, INFEASIBLE, lifecycle, modos, diagnostico | ~40 | Entende o solver sem ver codigo |
| Entidades | Modelo mental (nao lista de campos) | ~30 | Sabe o que e o que no dominio |
| Tools por intencao | 30 tools organizadas por workflow | ~40 | Sabe QUANDO usar cada uma |
| Schema de referencia | Tabelas com FKs explicitas | ~30 | Sabe WHERE/JOIN/FK sem adivinhar |
| Workflows | 8 receitas prontas (gerar, ferias, INFEASIBLE, etc) | ~50 | Few-shot examples de resolucao |
| Base de Conhecimento | Knowledge Layer: busca, salvar, explorar relacoes | ~20 | Memoria persistente CLT/CCT/procedimentos |
| Conduta | Limitacoes, proibicoes | ~15 | Guardrails |

### Principios

1. **Nao pecar por excesso**: modelo capaz nao precisa de repeticao. "Nunca peca ID" uma vez basta.
2. **Workflows > descripcoes**: few-shot examples de resolucao real valem mais que descricoes genericas.
3. **Knowledge de cor**: regras CLT que a IA sabe sem tool call economizam steps.
4. **Discovery complementa**: o prompt estatico + discovery dinamico = IA sempre contextualizada.

### Exemplo de workflow no prompt

```
### Receita: Gerar escala
1. Identifique setor pelo nome no MAPA (discovery)
2. Defina periodo (o usuario diz "marco" → 2026-03-02 a 2026-03-29)
3. Rode preflight(setor_id, datas) — verifique viabilidade
4. Se ok: gerar_escala(setor_id, data_inicio, data_fim)
5. Reporte indicadores: score, cobertura, violacoes
6. Pergunte se quer oficializar (so se violacoes_hard = 0)
```

---

## 7. Auto-correcao — 3 Mecanismos

### 1. Loop natural (built-in no SDK)

Quando a tool falha, o SDK manda o erro de volta como `tool-error`. A IA le, entende, e tenta de novo:

```typescript
execute: async ({ setor_id }) => {
  const setor = db.prepare('SELECT * FROM setores WHERE id = ?').get(setor_id)
  if (!setor) {
    return toolError('SETOR_NAO_ENCONTRADO', `Setor ${setor_id} nao existe.`, {
      correction: 'IDs validos: 1 (Caixa), 2 (Acougue). Tente novamente.'
    })
  }
  // ... execucao normal
}
```

### 2. Runtime validation com safeParse

```typescript
execute: async (rawArgs) => {
  const parsed = GerarEscalaSchema.safeParse(rawArgs)
  if (!parsed.success) {
    const issues = parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`)
    return toolError('VALIDATION_FAILED', `Argumentos invalidos: ${issues.join('; ')}`, {
      correction: 'Verifique os tipos e formatos dos campos no schema.'
    })
  }
  // ... execucao com parsed.data
}
```

### 3. experimental_repairToolCall (AI SDK v6)

Intercepta quando o JSON gerado nao bate com o schema:

```typescript
const result = await generateText({
  model, tools, messages,
  experimental_repairToolCall: async ({ toolCall, tools, error }) => {
    if (error.name === 'InvalidToolArgumentsError') {
      const fixed = await generateText({
        model,
        prompt: `Fix JSON. Error: ${error.message}\nSchema: ${JSON.stringify(tools[toolCall.toolName])}\nInvalid: ${toolCall.args}`,
      })
      return { ...toolCall, args: fixed.text }
    }
    return null  // nao conseguiu consertar
  },
})
```

### Fluxo completo

```
1. IA chama tool com args errados
2. Zod valida → falha → repairToolCall tenta consertar
3. Se consertou → executa
4. Se nao → IA recebe tool-error
5. IA tenta de novo com args diferentes (le o campo `correction`)
6. stopWhen: stepCountIs(10) previne loop infinito
```

---

## 8. Historico e Continuidade

### Cada request e stateless

A IA recebe a cada chamada:
1. **System prompt** (incluindo discovery dinamico)
2. **Messages** (historico completo da conversa)
3. **Tools** (definicoes disponiveis)

### Formato do historico (AI SDK v6)

```typescript
function buildChatMessages(historico: IaMensagem[], currentMsg: string): ModelMessage[] {
  for (const h of historico) {
    if (h.papel === 'usuario') {
      messages.push({ role: 'user', content: h.conteudo })
    }
    if (h.papel === 'assistente') {
      if (h.tool_calls?.length > 0) {
        // Mensagem assistant com tool-call parts
        messages.push({ role: 'assistant', content: [
          { type: 'text', text: h.conteudo },
          ...h.tool_calls.map(tc => ({ type: 'tool-call', toolCallId: tc.id, toolName: tc.name, input: tc.args }))
        ]})
        // Mensagem tool com tool-result parts (pareada)
        messages.push({ role: 'tool', content:
          h.tool_calls.map(tc => ({ type: 'tool-result', toolCallId: tc.id, toolName: tc.name, output: tc.result }))
        })
      } else {
        messages.push({ role: 'assistant', content: h.conteudo })
      }
    }
  }
  messages.push({ role: 'user', content: currentMsg })
}
```

> **CRITICO:** Incluir tool_results no historico preserva contexto de tool calls anteriores entre mensagens. Sem eles, a IA "esquece" o que descobriu na mensagem anterior.

### Persistencia (EscalaFlow)

- **SQLite:** `ia_conversas` + `ia_mensagens`
- **tool_calls_json:** array serializado de `ToolCall[]` no campo da mensagem assistente
- **Auto-titulo:** gerado na 1a mensagem via LLM ou heuristica

### Padroes de gerenciamento

| Padrao | Trade-off |
|--------|-----------|
| Historico completo (user + assistant + tool) | Melhor contexto, mais tokens |
| Ultimas N mensagens | Perde contexto antigo, barato |
| Sliding window com ancora | Preserva setup + contexto recente |
| Sumarizacao periodica | Complexo mas escala |

---

## 9. Testes — 5 Camadas de Validacao

### Camada 1: Unit tests dos handlers (vitest)

Testam cada tool isoladamente: schema valida? handler retorna formato correto? edge cases cobertos?

```typescript
// tests/ia/tools/consultar.spec.ts
describe('consultar', () => {
  it('retorna toolOk com dados enriched', () => {
    const result = handler({ entidade: 'colaboradores', filtros: { setor_id: 1 } })
    expect(result.status).toBe('ok')
    expect(result.dados[0].setor_nome).toBeDefined()  // FK traduzida
  })

  it('retorna toolError para entidade invalida', () => {
    const result = handler({ entidade: 'tabela_inexistente' })
    expect(result.status).toBe('error')
    expect(result.correction).toBeDefined()  // tem instrucao de fix
  })

  it('retorna toolTruncated acima do limite', () => {
    const result = handler({ entidade: 'alocacoes', filtros: {} })
    if (result.total > 50) {
      expect(result.status).toBe('truncated')
      expect(result.retornados).toBe(50)
    }
  })
})
```

### Camada 2: Schema validation tests

Verifica que TODOS os schemas tem `.describe()` e que TOOL_SCHEMAS esta sincronizado com IA_TOOLS:

```typescript
// tests/ia/tools/schema-descriptions.spec.ts
describe('schema descriptions', () => {
  it('todos os campos de todos os schemas tem .describe()', () => {
    for (const [name, schema] of Object.entries(ALL_SCHEMAS)) {
      const jsonSchema = zodToJsonSchema(schema)
      for (const [field, def] of Object.entries(jsonSchema.properties)) {
        expect(def.description, `${name}.${field} falta .describe()`).toBeDefined()
      }
    }
  })

  it('TOOL_SCHEMAS tem exatamente as mesmas keys que IA_TOOLS', () => {
    const toolNames = Object.keys(IA_TOOLS).sort()
    const schemaNames = Object.keys(TOOL_SCHEMAS).sort()
    expect(schemaNames).toEqual(toolNames)  // 30 = 30
  })
})
```

### Camada 3: Evals com Banco Real (SAVEPOINT/ROLLBACK)

A joia da coroa dos testes. Roda `generateText` real contra o banco de producao do dev, valida tool calling com 7 scorers, e **protege o DB com SAVEPOINT/ROLLBACK** pra que testes mutativos (INSERT/UPDATE/DELETE) nao sujem os dados.

#### Arquitetura dos evals

```
tests/ia/evals/
├── run-evals.ts    # Runner: carrega runtime real, roda cada caso, SAVEPOINT/ROLLBACK
├── dataset.ts      # 20+ test cases com expectations + dbVerify callbacks
└── scorers.ts      # 7 scorers (correct_tool, args, forbidden, steps, text, db_effect)
```

#### O pattern SAVEPOINT/ROLLBACK

**Problema:** Como testar que `criar({ entidade: 'excecoes', ... })` realmente insere no banco, sem sujar o banco?

**Solucao:** SQLite SAVEPOINT antes do caso, scoring (incluindo `dbVerify`) ANTES do rollback, e ROLLBACK depois.

```typescript
// run-evals.ts — trecho simplificado
for (const tc of selected) {
  const useSavepoint = !!tc.mutates

  // 1. SAVEPOINT — congela estado do DB
  if (useSavepoint) {
    db.exec(`SAVEPOINT eval_${tc.id}`)
  }

  try {
    // 2. RODA — IA chama tools reais, que fazem INSERT/UPDATE/DELETE no DB
    const output = await runCase(tc, { model, tools, systemPrompt, buildContextBriefing })

    // 3. SCORE — avalia tudo, incluindo dbVerify (que le o DB ANTES do rollback)
    const evalResult = evaluateCase(output, tc, useSavepoint ? db : undefined)

  } finally {
    // 4. ROLLBACK — desfaz tudo, DB volta ao estado original
    if (useSavepoint) {
      db.exec(`ROLLBACK TO eval_${tc.id}`)
      db.exec(`RELEASE eval_${tc.id}`)
    }
  }
}
```

**Fluxo temporal:**
```
DB estado limpo
  → SAVEPOINT
    → IA chama criar({ entidade: 'excecoes', ... })
    → INSERT INTO excecoes VALUES(...)   ← ACONTECE DE VERDADE
    → dbVerify: "excecao criada? ✅"      ← VERIFICA ANTES DO ROLLBACK
  → ROLLBACK TO                           ← DB VOLTA AO ESTADO ORIGINAL
DB estado limpo (de novo)
```

#### Interface do test case

```typescript
// dataset.ts
interface EscalaFlowEvalCase {
  id: string                      // ID unico (ex: 'explicar-h14')
  label: string                   // Descricao curta
  input: string                   // Mensagem do usuario
  contexto?: IaContexto           // Pagina/setor simulado (default: dashboard)
  expected: EvalExpected          // Expectations (ver scorers)
  enabledByDefault?: boolean      // false = so roda com INCLUDE_SLOW=1 (ex: gerar_escala)
  tags?: string[]                 // Tags livres (ex: ['slow', 'solver', 'negativa'])
  mutates?: boolean               // Marca caso que faz INSERT/UPDATE/DELETE
  dbVerify?: (db) => { ok, detail }  // Callback que verifica efeito no DB
}
```

#### 8 categorias de test cases (20+ casos)

| Categoria | ID prefix | Exemplos | Mutates? |
|-----------|-----------|----------|----------|
| **A — Discovery/leitura** | explicar-*, resumo-*, listar-* | Explica H14, lista setores, lista colabs | Nao |
| **B — CRUD via genericas** | criar-*, deletar-* | Cria excecao ferias, deleta feriado | **Sim** |
| **C — Regras** | editar-regra-*, negar-*, explicar-regra-* | Edita H1→SOFT, recusa editar H2 (fixa), explica S_DEFICIT | Parcial |
| **D — Escala** | preflight-*, oficializar-*, gerar-* | Preflight setor, oficializar escala, gerar escala (slow) | Parcial |
| **E — Regras individuais** | definir-janela-*, obter-regra-* | Janela "so de manha", consulta regra colab | Parcial |
| **F — Busca fuzzy** | buscar-* | Busca "Maria" por nome | Nao |
| **G — Import/lote** | cadastrar-lote-* | Cadastro em lote 3 pessoas | **Sim** |
| **H — Tools P1/P2** | salvar-demanda-*, upsert-*, resumir-*, resetar-* | Black Friday, override pontual, KPIs, reset regras | **Sim** |

#### Exemplo de caso mutativo com dbVerify

```typescript
{
  id: 'criar-excecao-generica',
  label: 'Criar exceção usa tool genérica criar',
  input: 'Cadastra férias para o colaborador 5 de 2026-04-01 a 2026-04-15.',
  mutates: true,  // ← ativa SAVEPOINT/ROLLBACK
  dbVerify: (db) => {
    // Verifica ANTES do rollback que o INSERT realmente aconteceu
    const row = db.prepare(
      `SELECT * FROM excecoes WHERE colaborador_id = 5 AND tipo = 'FERIAS' ORDER BY id DESC LIMIT 1`
    ).get()
    return {
      ok: !!row && row.data_inicio === '2026-04-01' && row.data_fim === '2026-04-15',
      detail: row
        ? `Exceção criada: id=${row.id} tipo=${row.tipo} ${row.data_inicio}→${row.data_fim}`
        : 'Exceção não encontrada no DB (INSERT falhou)',
    }
  },
  expected: {
    shouldCallTool: 'criar',
    toolArgsMustInclude: { entidade: 'excecoes' },
    shouldNotCallTools: ['gerar_escala'],
    maxSteps: 6,
  },
}
```

#### 7 scorers (dimensoes de avaliacao)

```typescript
// scorers.ts — cada dimensao e independente
function evaluateCase(output: EvalRunOutput, evalCase: EscalaFlowEvalCase, db?: any): EvalCaseResult {
  const scores = []

  // 1. correct_tool — chamou a tool EXATA esperada?
  if (expected.shouldCallTool) {
    scores.push({ name: 'correct_tool', passed: toolCalls.includes(expected.shouldCallTool) })
  }

  // 2. correct_tool_any_of — chamou QUALQUER UMA de um conjunto aceitavel?
  if (expected.shouldCallAnyOf) {
    scores.push({ name: 'correct_tool_any_of', passed: anyOf.some(t => toolCalls.includes(t)) })
  }

  // 3. forbidden_tools — NAO chamou tools proibidas neste cenario?
  if (expected.shouldNotCallTools) {
    scores.push({ name: 'forbidden_tools', passed: !violator })
  }

  // 4. correct_args_subset — args contem o subset esperado? (deep match)
  if (expected.toolArgsMustInclude) {
    scores.push({ name: 'correct_args_subset', passed: objectContainsSubset(actualArgs, expectedArgs) })
  }

  // 5. steps_budget — nao excedeu limite de steps?
  if (expected.maxSteps) {
    scores.push({ name: 'steps_budget', passed: output.stepsCount <= expected.maxSteps })
  }

  // 6. text_contains / text_excludes — texto final contem/exclui trechos?
  if (expected.textShouldInclude) { ... }
  if (expected.textShouldNotInclude) { ... }

  // 7. db_effect — efeito real no banco confirmado via dbVerify callback?
  if (evalCase.dbVerify && db) {
    const { ok, detail } = evalCase.dbVerify(db)
    scores.push({ name: 'db_effect', passed: ok, detail })
  }

  return { passed: scores.every(s => s.passed), scores }
}
```

> **Nota sobre `objectContainsSubset`:** Faz deep match recursivo. `{ entidade: 'excecoes' }` bate contra `{ entidade: 'excecoes', dados: { ... } }`. Nao exige match exato — so que os campos esperados estejam presentes com os valores certos.

#### Configuracao via env vars

```bash
# Provider e modelo
ESCALAFLOW_EVAL_PROVIDER=gemini          # gemini | openrouter
ESCALAFLOW_EVAL_MODEL=gemini-2.5-flash   # modelo especifico (default: gemini-2.5-flash | claude-sonnet-4)

# Controle de execucao
ESCALAFLOW_EVAL_STRICT=1                 # exit(1) se qualquer caso falha (default: true)
ESCALAFLOW_EVAL_INCLUDE_SLOW=1           # inclui casos lentos (gerar_escala → solver)
ESCALAFLOW_EVAL_CASES=explicar-h14,criar-excecao-generica  # roda SO esses IDs
ESCALAFLOW_EVAL_LIMIT=5                  # limita a N casos (debug rapido)
ESCALAFLOW_EVAL_VERBOSE=1               # mostra detalhes de todos os casos (nao so falhas)
ESCALAFLOW_EVAL_REQUIRE_LIVE=1           # falha se API key ausente (CI)

# DevTools durante eval
ESCALAFLOW_EVAL_DEVTOOLS=1               # ativa AI SDK DevTools (abrir localhost:4983)
```

#### Exemplo de output

```
[ia-eval] Iniciando batch: 20 caso(s) | provider=gemini | model=gemini-2.5-flash
[ia-eval] DB: escalaflow.db | contexto: dashboard (real)
[PASS] explicar-h14 (Explica H14) | steps=2 | tokens=1234 | 1.2s
[PASS] criar-excecao-generica (Criar exceção) | steps=3 | tokens=2100 | 2.4s [mut→rollback]
[FAIL] editar-regra-h1-soft (Editar regra H1) | steps=5 | tokens=3200 | 3.1s [mut→rollback]
  tools: consultar, editar_regra
  ❌ correct_args_subset: Args de editar_regra nao batem.
  ✅ correct_tool: Chamou editar_regra.

[ia-eval] Resumo
- Passou: 18/20
- Falhou: 2/20
- Média de steps: 3.45
- Casos com falha:
  - editar-regra-h1-soft: correct_args_subset
  - definir-janela-manha: correct_tool_any_of
```

#### Como carregar o runtime real nos evals

O segredo: os evals importam o runtime REAL da aplicacao, nao mocks.

```typescript
// run-evals.ts — carrega tudo do src/main/ia/ e src/main/db/
async function loadRuntimeBits() {
  const [{ getVercelAiTools }, { SYSTEM_PROMPT }, { buildContextBriefing }, { getDb }] = await Promise.all([
    import('../../../src/main/ia/tools'),        // 30 tools reais
    import('../../../src/main/ia/system-prompt'), // system prompt real
    import('../../../src/main/ia/discovery'),     // discovery real
    import('../../../src/main/db/database'),      // banco real (better-sqlite3)
  ])
  return { getVercelAiTools, SYSTEM_PROMPT, buildContextBriefing, getDb }
}
```

**O banco e REAL.** Mesmos dados que o dev usa no app. Discovery injeta contexto real (setores, colaboradores, alertas). Tools fazem INSERT/UPDATE/DELETE reais. SAVEPOINT/ROLLBACK garante que nada suja.

```typescript
// Cada caso recebe discovery real — IA ve o mesmo contexto que veria no app
async function runCase(tc, deps) {
  const contexto = tc.contexto ?? DEFAULT_EVAL_CONTEXTO  // default: { pagina: 'dashboard' }
  const contextBriefing = deps.buildContextBriefing(contexto)  // ← DB real!
  const system = `${deps.systemPrompt}\n\n---\n${contextBriefing}`

  return await generateText({
    model: deps.model,
    system,
    messages: [{ role: 'user', content: tc.input }],
    tools: deps.tools,
    temperature: 0,           // determinismo
    stopWhen: stepCountIs(10), // limite
  })
}
```

### Camada 4: Live smoke tests

Validacao rapida com API real — confirma que o pipeline todo (provider → modelo → tools) funciona end-to-end.

```typescript
// tests/ia/live/live-smoke.ts — 2 fases
async function main() {
  // FASE 1: Texto puro — modelo responde "OK"?
  const textOnly = await generateText({ model, prompt: 'Responda apenas OK' })
  assert(textOnly.text.includes('OK'))

  // FASE 2: Tool calling — modelo chama explicar_violacao?
  const result = await generateText({
    model,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: 'Explique a regra H14 em uma frase.' }],
    tools: getVercelAiTools(),
    stopWhen: stepCountIs(6),
  })
  assert(toolNames.includes('explicar_violacao'))
}
```

**Graceful skip:** Se `ESCALAFLOW_EVAL_REQUIRE_LIVE` nao esta setado e falta API key, o smoke test sai com `exit(0)` (nao falha CI).

```bash
# Roda smoke (pula silenciosamente se sem API key)
npm run test:ia:live

# Exige API key (falha se ausente — pra CI)
ESCALAFLOW_EVAL_REQUIRE_LIVE=1 npm run test:ia:live
```

### Camada 5: CLI Interativo (teste manual qualitativo)

O CLI e a ferramenta de desenvolvimento que mais se usa no dia-a-dia. Carrega o runtime REAL da aplicacao (tools, system prompt, discovery, banco) e permite testar tool calling conversacionalmente.

```
tests/ia/live/ia-chat-cli.ts
```

#### O que carrega

```typescript
// Importa os 3 modulos do sistema de IA — MESMOS que o app usa
async function loadRuntime() {
  const [{ getVercelAiTools }, { SYSTEM_PROMPT }, { buildContextBriefing }] = await Promise.all([
    import('../../../src/main/ia/tools'),        // 30 tools reais
    import('../../../src/main/ia/system-prompt'), // prompt real
    import('../../../src/main/ia/discovery'),     // discovery real
  ])
  return { getVercelAiTools, SYSTEM_PROMPT, buildContextBriefing }
}
```

**Isso e crucial.** Nao e um mock, nao e uma versao simplificada. E literalmente o mesmo runtime que roda dentro do Electron. Se funciona aqui, funciona no app.

#### Multi-turn com historico

```typescript
let history: HistoryMsg[] = []

while (true) {
  const input = await rl.question('Voce > ')
  history.push({ role: 'user', content: input })

  const result = await generateText({
    model,
    system: systemPrompt,
    messages: history,
    tools,
    stopWhen: stepCountIs(10),
    onStepFinish({ toolCalls }) {
      // Log colorido de cada tool call em tempo real
      for (const tc of toolCalls) {
        console.log(`  [TOOL] ${tc.toolName} ${JSON.stringify(tc.input).slice(0, 100)}`)
      }
    },
  })

  // Follow-up silencioso — se IA so rodou tools sem texto
  if (!result.text.trim() && result.steps?.length > 0) {
    const followUp = await generateText({
      model, system: systemPrompt,
      messages: [...result.response.messages, { role: 'user', content: 'Responda ao usuario.' }],
    })
    finalText = followUp.text
  }

  history.push({ role: 'assistant', content: finalText })
}
```

#### Multi-provider

```bash
# Gemini (default)
npm run ia:chat

# OpenRouter (Claude, etc)
npm run ia:chat -- --provider openrouter
```

O CLI detecta automaticamente qual API key usar:
- `gemini` → `GOOGLE_GENERATIVE_AI_API_KEY` ou `GEMINI_API_KEY`
- `openrouter` → `OPENROUTER_API_KEY`

#### Comandos internos

| Comando | Efeito |
|---------|--------|
| `/clear` | Limpa historico (novo contexto) |
| `/tools` | Lista as 30 tools disponiveis |
| `sair` | Encerra o CLI |

#### Output colorido

```
╔══════════════════════════════════════════════╗
║  EscalaFlow IA — CLI Chat                   ║
╠══════════════════════════════════════════════╣
║  Provider: gemini                            ║
║  Model:    gemini-2.5-flash                  ║
╠══════════════════════════════════════════════╣
║  /clear  limpa historico                     ║
║  /tools  lista tools disponiveis             ║
║  sair    encerra                             ║
╚══════════════════════════════════════════════╝

[OK] Runtime carregado — 30 tools

Voce > Quem trabalha no acougue?
  [TOOL] consultar {"entidade":"colaboradores","filtros":{"setor_id":2}}
  [RESULT] consultar: {"status":"ok","total":5,"dados":[{"id":3,"nome":"Cleunice"...

IA > No Açougue trabalham 5 colaboradores: Cleunice, ...
```

#### Por que ter um CLI separado do app?

| Cenario | CLI | App Electron |
|---------|-----|-------------|
| Testar nova tool que acabou de criar | ✅ Roda em 2s | ❌ Precisa rebuildar |
| Debug de system prompt | ✅ Ve resposta imediata | ❌ Precisa navegar ate o chat |
| Testar multi-turn conversacional | ✅ Historico preservado | ✅ Idem |
| Comparar providers (Gemini vs Claude) | ✅ `--provider openrouter` | ❌ Precisa mudar config |
| Compartilhar output com alguem | ✅ Copy/paste do terminal | ❌ Screenshot |

#### Setup do ambiente (load-env)

```typescript
// tests/setup/load-env.ts — carrega .env.local com API keys
import { config } from 'dotenv'
config({ path: resolve(__dirname, '../../.env.local') })
```

Todos os testes (CLI, evals, smoke) importam esse setup como primeira linha. As API keys ficam em `.env.local` (gitignored).

### Comandos

```bash
npm run test            # vitest (unit tests, inclui tools)
npm run test:ia:eval    # Evals batch (scoring automatico, SAVEPOINT/ROLLBACK)
npm run test:ia:live    # Smoke test API real (2 fases)
npm run ia:chat         # CLI interativo (runtime real, multi-turn, multi-provider)
```

---

## 10. Observabilidade

### AI SDK DevTools (gratis, local, zero config)

```typescript
import { wrapLanguageModel } from 'ai'

async function maybeWrapModelWithDevTools(model) {
  if (process.env.NODE_ENV === 'production') return model
  const { devToolsMiddleware } = await import('@ai-sdk/devtools')
  return wrapLanguageModel({ model, middleware: devToolsMiddleware() })
}

// Terminal separado:
// $ npx @ai-sdk/devtools → abre http://localhost:4983
```

O viewer mostra:

| O que ve | Por que importa |
|----------|-----------------|
| Input completo (system + messages) | Confirma que discovery esta chegando |
| Cada tool call com args | IA escolheu a tool certa? com quais params? |
| Cada tool result | **VE O QUE A IA RECEBEU** — aqui descobre se retorno ta rico ou cru |
| Token usage por step | Qual tool ta gastando demais |
| Timing por step | Identifica gargalos (solver lento? query pesada?) |

### Proximos passos (quando crescer)

| Fase | Ferramenta | Setup |
|------|-----------|-------|
| Dev | AI SDK DevTools | 3 linhas de codigo |
| Beta testers | Langfuse (self-host) | OpenTelemetry span processor |
| CI/CD | Braintrust | Evals automaticos em cada PR |

---

## 11. Formatacao de Respostas — Markdown no Chat

### O que o modelo manda
LLMs retornam texto puro com markup Markdown. Nao existe campo "rich text" separado na API — o tom e a formatacao sao controlados 100% via system prompt.

### O que o frontend faz
O renderer parseia Markdown → HTML estilizado via `react-markdown` + Tailwind Typography (`prose`).

Elementos suportados: **negrito**, *italico*, listas (- e 1.), tabelas, headings (###), `codigo inline`, blockquotes.

### Regras no system prompt
O system prompt inclui secao dedicada de formatacao (secao 7) que instrui o modelo a:
- Priorizar respostas curtas e escaneáveis (2-3 paragrafos max)
- Usar negrito em nomes e numeros-chave
- Preferir bullet lists a paragrafos longos
- Usar tabelas pequenas (max 5 col, 10 linhas)
- Emojis com parcimonia (✅ ⚠️ ❌)
- Nunca usar headers grandes (## ou #) em chat

### Implementacao no Electron
- `IaMensagemBubble.tsx`: Mensagens do assistente renderizadas com `<ReactMarkdown className="prose prose-sm dark:prose-invert">`
- `IaChatView.tsx`: Texto parcial (streaming) tambem renderizado com ReactMarkdown
- Mensagens do usuario continuam como texto puro (sem parsing)
- Classes `prose-sm` + overrides de espacamento pra contexto compacto de chat

---

## 12. Catalogo de Patterns Consolidado

### Pattern 1: 3-Status Response
Toda tool retorna `{ status: 'ok' | 'error' | 'truncated', ...dados }`. Helpers centralizados `toolOk/toolError/toolTruncated`.

### Pattern 2: FK Enrichment
Traduz foreign keys em nomes legiveis antes de retornar. `setor_id:2` → `setor_nome:"Acougue"`. Helper `enrichConsultarRows()`.

### Pattern 3: Navigation Metadata
`_meta: { ids_usaveis_em: ['gerar_escala', 'atualizar'] }` — diz pra IA quais tools aceitam os IDs retornados.

### Pattern 4: Error Correction
Todo `toolError()` inclui campo `correction` com instrucao de como a IA deve corrigir. IA le e tenta de novo automaticamente.

### Pattern 5: Discovery Layering
System prompt recebe discovery automatico (dados frescos do banco). Tools de discovery servem como refresh/deep-dive quando precisa de mais.

### Pattern 6: Schema Descriptions
Todo campo Zod tem `.describe()` explicando DE ONDE pegar o valor e COMO formatar.

### Pattern 7: Whitelists por Operacao
Tools de escrita (criar/atualizar/deletar) tem whitelists explicitas de entidades permitidas via `z.enum()`. Nao e SQL aberto.

### Pattern 8: Truncation com Aviso
Resultados acima de N linhas (ex: 50) retornam `status: 'truncated'` com `aviso` sugerindo filtros.

### Pattern 9: SQL Error Translation
Erros SQLite cripticos (NOT NULL, UNIQUE, FK) traduzidos em mensagens acionaveis com `correction`.

### Pattern 10: Preflight antes de Acao Pesada
Antes de rodar o solver (caro, ~30s), roda preflight que detecta blockers baratos (sem colabs, sem demanda, domingo impossivel).

### Pattern 11: Follow-up Silencioso
Se a IA so chamou tools e nao gerou texto, faz follow-up com `result.response.messages` pra forcar resposta natural.

### Pattern 12: Zod → JSON Schema Centralizado
Helper `toJsonSchema()` centraliza conversao Zod→JSON Schema, remove `$schema` (Gemini rejeita), isola hacks de compatibilidade.

---

## 13. Checklist de Implementacao

### Do zero ao MVP (1 dia)

- [ ] Instalar: `ai`, `zod`, provider (`@ai-sdk/google` ou similar)
- [ ] Criar 1 tool simples (busca) com `stopWhen: stepCountIs(5)`
- [ ] Testar o loop completo antes de complicar
- [ ] Adicionar `.describe()` em TODOS os campos Zod

### Qualidade (3 dias)

- [ ] Implementar helpers `toolOk/toolError/toolTruncated`
- [ ] FK enrichment: traduzir IDs em nomes legiveis
- [ ] `_meta.ids_usaveis_em` em toda tool de leitura
- [ ] `correction` em todo `toolError`
- [ ] Truncation com limite (ex: 50 rows)

### Discovery (2 dias)

- [ ] `buildContextBriefing()` — injeta dados do banco no system prompt a cada request
- [ ] System prompt estruturado (identidade + conhecimento + tools + workflows)
- [ ] Alertas proativos (violacoes, dados desatualizados, excecoes expirando)
- [ ] Dica de pagina (contexto da UI)

### Testes (2 dias)

- [ ] Unit tests dos handlers (vitest)
- [ ] Schema validation tests (todo campo tem .describe()? TOOL_SCHEMAS sincronizado?)
- [ ] Eval dataset (10-20 casos com scoring)
- [ ] Live smoke test com API real

### Observabilidade (1 hora)

- [ ] `@ai-sdk/devtools` — 3 linhas de codigo
- [ ] `npx @ai-sdk/devtools` — visualizar cada step

### Producao

- [ ] Follow-up silencioso (tools sem texto → forcar resposta)
- [ ] Whitelists de entidades em tools de escrita
- [ ] SQL error translation
- [ ] Historico com tool_results preservados

---

## 14. Anti-patterns Mortais

### 1. Array cru do banco

```typescript
// ERRADO
return db.prepare(query).all()  // [{id:3, tipo_contrato_id:1, setor_id:2}]
// IA nao sabe que tipo_contrato_id:1 = "CLT 44h"
```

### 2. Instrucao diretiva fixa

```typescript
// ERRADO
return { dados: results, instrucao: "Apresente ao usuario" }
// Se IA esta encadeando 5 tools, instrucao "apresente" PARA o fluxo
```

### 3. IDs criptograficos sem traducao

```typescript
// ERRADO
return [{ uuid: "a7f3e2b1-9d4c...", fk_setor: 2, tc_id: 1 }]
// IA adivinha que tc_id e tipo_contrato
```

### 4. Tool generica demais

```typescript
// CUIDADO
consultar(entidade, filtros)  // IA precisa saber nomes de tabelas e campos
// MELHOR: manter como escape hatch, mas criar tools semanticas pros fluxos comuns
```

### 5. Discovery duplicado

```typescript
// ERRADO: injeta no prompt E manda "sempre chame get_context() primeiro"
// Resultado: IA gasta 1 tool call buscando dados que ja tem
// FIX: discovery auto no prompt cobre o contexto. get_context() foi removida (Cleanup v2).
// Use consultar() com filtros quando precisar de deep-dive alem do discovery.
```

### 6. Schema sem .describe()

```typescript
// ERRADO
z.number().int().positive()  // IA sabe que e inteiro positivo, mas nao sabe de onde pegar
// CERTO
z.number().int().positive().describe('ID do setor. Extraia do discovery auto no prompt.')
```

### 7. Historico sem tool_results

```typescript
// ERRADO: filtrar tool_results do historico
messages.filter(m => m.papel !== 'tool_result')
// IA perde contexto de descobertas anteriores entre mensagens
```

---

## Apendice: Numeros Reais do EscalaFlow

| Metrica | Valor |
|---------|-------|
| Tools totais | 30 |
| Schemas Zod | 30 (todos com .describe() em cada campo) |
| System prompt | ~408 linhas, 9 secoes |
| Discovery | ~9 secoes condicionais injetadas por request |
| Eval dataset | 20+ casos |
| Unit tests IA | 42+ |
| Max steps (loop) | 10 |
| Truncation limit | 50 rows |
| Grid | 15 minutos |
| Entidades DB | 21 tabelas |
| IPC handlers | 80+ |

> **Principio Final:** A inteligencia de uma IA com tools e **80% qualidade dos dados retornados** e 20% capacidade do modelo. Um modelo mediano com respostas ricas (status claro, nomes traduzidos, _meta de navegacao) supera um modelo genial com arrays crus.
