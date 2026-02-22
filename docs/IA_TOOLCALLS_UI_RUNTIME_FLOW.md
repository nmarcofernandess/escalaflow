# IA Tool Calls UI + Runtime (Contrato Anti-Quebra)

## Objetivo

Este documento explica o contrato entre:

- `src/main/ia/cliente.ts` (mapper do AI SDK -> `ToolCall[]`)
- `src/renderer/src/componentes/IaChatView.tsx` (mensagem UI vs mensagem persistida)
- `src/renderer/src/componentes/IaToolCallsCollapsible.tsx` (render de args/output)
- `src/renderer/src/store/iaStore.ts` (persistência via IPC)

Motivo: esse fluxo quebra com frequência quando uma IA altera detalhes "pequenos" como nomes de campos (`input/output`) ou checks de truthy/falsy.

## TL;DR (regras que nao podem quebrar)

1. AI SDK v6 usa `toolCall.input` e `toolResult.output` (nao `args/result`).
2. UI deve checar **presenca de propriedade** (`hasOwnProperty`), nao truthiness.
3. `args = {}` e `result = null/false/0` sao validos e devem renderizar.
4. `result` **nao e persistido no SQLite** (fica so na mensagem em memoria da sessao atual).
5. Historico recarregado pode ter `ToolCall` sem `args/result` (legado) e a UI deve degradar com `Sem output`.

## Fluxo de dados (runtime -> UI -> persistencia)

### 1) Runtime IA (`src/main/ia/cliente.ts`)

Quando `generateText()` retorna `steps`, cada step pode ter:

- `step.toolCalls[]` com `toolCallId`, `toolName`, `input`
- `step.toolResults[]` com `toolCallId`, `output` (ou erro)

O mapper converte isso para `ToolCall[]` compartilhado:

- `id <- toolCallId`
- `name <- toolName`
- `args <- input` (normalizado para objeto)
- `result <- output` (ou fallback compat)

### 2) Renderer (mensagem assistente)

`IaChatView` cria duas versoes da mesma mensagem:

- **Mensagem UI (in-memory):** inclui `tool_calls[].result`
- **Mensagem persistida (SQLite):** remove `tool_calls[].result`, preserva `args`

Isso permite:

- debug visual durante a conversa atual
- banco enxuto (sem JSON gigante)

### 3) Renderer (collapsible)

`IaToolCallsCollapsible`:

- renderiza `Argumentos:` quando `args` existe, inclusive `{}`.
- renderiza `Ver output` quando `result` existe, inclusive `null/false/0`.
- mostra `Output nao persistido` quando `result` nao existe (historico/legado).

## Por que o bug aconteceu (raiz)

Foram duas quebras combinadas:

### A. Mudanca de contrato no AI SDK

Codigo esperava:

- `tc.args`
- `tr.result`

Mas no `ai@6` o shape usado no fluxo de tool calling e:

- `tc.input`
- `tr.output`

Resultado: `tool_calls_json` estava sendo salvo so com `id` + `name`.

### B. Checks de truthy/falsy na UI

A UI fazia algo como:

- `call.args && Object.keys(call.args).length > 0`
- `call.result && (...)`

Isso esconde valores validos:

- `{}` (args vazio)
- `null`, `false`, `0` (outputs validos em alguns casos)

## Invariantes (se mexer aqui, respeita isso)

### Invariante 1: pair toolCall/toolResult por `toolCallId`

Nao assuma que `toolCalls[i]` sempre combina com `toolResults[i]`.

- Primeiro: mapear por `toolCallId`
- Depois: usar indice como fallback

### Invariante 2: usar `hasOwnProperty` na UI

A pergunta correta nao e "o valor e truthy?"

A pergunta correta e:

- "essa propriedade existe no payload?"

Porque:

- `result: null` significa "houve output e ele e null"
- ausencia de `result` significa "nao temos output (nao persistido/legado)"

### Invariante 3: `result` nao vai para o banco

Esse e o comportamento esperado atual.

Consequencias:

- Na conversa atual: botao `Ver output` funciona
- Ao recarregar historico: output some e UI mostra fallback neutro

## Arquivos-chave e responsabilidades

### `src/main/ia/cliente.ts`

- Normaliza `step.toolCalls/toolResults` do AI SDK
- Mantem compat para payloads antigos (`args/result`)
- Garante `ToolCall[]` consistente para o renderer

### `src/renderer/src/componentes/IaChatView.tsx`

- Cria a mensagem assistente final
- Separa payload de UI vs payload persistido

### `src/renderer/src/store/iaStore.ts`

- Persiste via IPC
- Aceita `mensagemPersistida` override para salvar menos do que mostra na UI

### `src/renderer/src/componentes/IaToolCallsCollapsible.tsx`

- Faz render resiliente a dados legados/incompletos
- Resolve layout/overflow para JSON grande

## Troubleshooting rapido (quando "sumir" de novo)

### Sintoma: tools listam, mas sem args/output

Checklist:

1. Verificar mapper em `src/main/ia/cliente.ts`:
   - esta lendo `input/output`?
2. Inspecionar `resp.acoes` no renderer:
   - `tool_calls` tem `args`?
   - `tool_calls` tem `result` na mensagem UI?
3. Inspecionar DB:
   - esperado: **sem** `result`
   - esperado: **com** `args` (quando houver)

### Sintoma: botao "Ver output" nao aparece

Checklist:

1. UI usa `hasOwnProperty` ou voltou pra `if (call.result)`?
2. `result` esta presente mas falsy (`null/false/0`)?
3. Mensagem veio do historico (sem `result` por design)?

### Sintoma: sidebar quebra com JSON gigante

Checklist:

1. `pre` tem `max-h-[400px] overflow-y-auto overflow-x-auto`?
2. wrappers tem `min-w-0 max-w-full`?
3. container da sidebar/chat ainda tem `overflow-hidden` + `min-w-0`?

## Teste manual recomendado (sempre apos mexer)

1. Rodar uma tool com `get_context`.
2. Confirmar:
   - `Argumentos:` renderiza `{}`.
   - botao `Ver output` aparece.
   - expand/collapse funciona.
3. Abrir output grande:
   - scroll interno no JSON
   - sidebar fixa
4. Reabrir historico:
   - tools listadas
   - sem output (fallback neutro)

## Decisao atual (2026-02-22)

- Persistir `args`: **SIM**
- Persistir `result`: **NAO**
- Output ao vivo: **SIM, so na sessao atual**

