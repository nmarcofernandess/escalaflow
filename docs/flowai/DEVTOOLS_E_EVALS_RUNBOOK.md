# Runbook — AI SDK DevTools + Evals (EscalaFlow)

## Objetivo

Dar um fluxo pratico para:

- visualizar step-by-step do tool calling (AI SDK DevTools)
- rodar eval batch local (DIY)
- rodar smoke live de provider + tool calling

## 1) AI SDK DevTools (viewer local da Vercel / AI SDK)

### O que e

Viewer local que mostra:

- input completo (system + messages)
- cada tool call (nome + args)
- cada tool result
- steps, timing e uso de tokens

## 2) Status no projeto

Ja implementado:

- middleware DevTools no runtime de IA (modo local/dev)
- import via `@ai-sdk/devtools` (compativel com `ai@6.0.97`)

Arquivo:

- `/Users/marcofernandes/escalaflow/src/main/ia/cliente.ts`

### Como usar

Terminal 1 (viewer):

```bash
npx @ai-sdk/devtools
```

Abra:

- `http://localhost:4983`

Terminal 2 (app):

```bash
npm run dev
```

Use o chat da IA normalmente. As chamadas devem aparecer no viewer.

### Controle por ambiente

- `ESCALAFLOW_AI_DEVTOOLS=1` -> força ligar
- `ESCALAFLOW_AI_DEVTOOLS=0` -> desliga

Comportamento padrao:

- ligado fora de `production`

## 3) Eval batch DIY (`test:ia:eval`)

### O que faz

Roda uma bateria de cenarios contra o runtime real de IA (mesmo `SYSTEM_PROMPT` + mesmas tools) e aplica scorers deterministicos:

- tool correta
- args corretos (subset)
- tools proibidas no cenario
- budget de steps
- texto contem trecho esperado (quando aplicavel)

### Arquivos

- `/Users/marcofernandes/escalaflow/tests/ia/evals/dataset.ts`
- `/Users/marcofernandes/escalaflow/tests/ia/evals/scorers.ts`
- `/Users/marcofernandes/escalaflow/tests/ia/evals/run-evals.ts`

### Comando basico

```bash
npm run test:ia:eval
```

Se nao houver API key, o script faz `skip` por padrao (exit 0) e explica como configurar.

### Variaveis uteis

- `ESCALAFLOW_EVAL_PROVIDER=gemini|openrouter`
- `ESCALAFLOW_EVAL_MODEL=<modelo>`
- `GOOGLE_GENERATIVE_AI_API_KEY=<token>` ou `GEMINI_API_KEY=<token>`
- `OPENROUTER_API_KEY=<token>`
- `ESCALAFLOW_EVAL_CASES=explicar-h14,resumo-sistema`
- `ESCALAFLOW_EVAL_LIMIT=3`
- `ESCALAFLOW_EVAL_INCLUDE_SLOW=1` (inclui cenarios com solver)
- `ESCALAFLOW_EVAL_VERBOSE=1`
- `ESCALAFLOW_EVAL_STRICT=0` (nao falhar processo em caso de falha de cenario)
- `ESCALAFLOW_EVAL_REQUIRE_LIVE=1` (falha se API key ausente)
- `ESCALAFLOW_EVAL_DEVTOOLS=1` (liga DevTools durante o eval)

### Exemplo (Gemini)

```bash
GOOGLE_GENERATIVE_AI_API_KEY=... \
ESCALAFLOW_EVAL_CASES=explicar-h14,resumo-sistema,preflight-explicito \
npm run test:ia:eval
```

## 4) Smoke live (`test:ia:live`)

### O que faz

Smoke curto em 2 etapas:

1. texto simples (`Responda OK`)
2. tool calling real (`explicar_violacao` via prompt "Explique a H14...")

### Comando

```bash
npm run test:ia:live
```

Usa as mesmas variaveis de provider/model/API key do eval.

## 5) Problema comum: ABI do `better-sqlite3`

Como o projeto e Electron, pode acontecer mismatch entre binario compilado para Electron e Node do `tsx`.

Sintoma tipico:

- erro com `NODE_MODULE_VERSION` ao importar runtime/tools

O que fazer:

1. Rebuild do modulo nativo para o Node local (se for rodar scripts via `tsx`)
2. Ou rodar o script via Electron/Node compativel (similar ao padrao de `solver:test:real`)
3. Ou manter eval local em ambiente onde o modulo nativo esteja alinhado

## 6) Uso recomendado (pratico)

1. Antes de mexer em tools/prompt:
   - abrir DevTools
2. Depois de mexer:
   - rodar `test:ia:eval`
3. Antes de merge:
   - rodar `test:ia:live` (smoke)

