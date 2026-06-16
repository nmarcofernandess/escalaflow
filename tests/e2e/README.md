# E2E (Playwright + Electron real)

Não usa browser em `localhost:5173` nem a CLI `ia:chat` como substituto do app: o Playwright sobe o binário **Electron** com `out/main/index.js` (preload + IPC + `window.electron`).

## Pré-requisitos

1. **Build** do app (main/preload/renderer em `out/`):

   ```bash
   npm run build
   ```

2. **Variáveis de ambiente** (recomendado em um único comando):

   - `ESCALAFLOW_E2E=1` — injetado pelo helper de launch; ativa o seed [`seed-e2e.ts`](../../src/main/db/seed-e2e.ts) (setor **Padaria**, colaboradores E2E, demanda mínima).
   - `GEMINI_API_KEY` **ou** `OPENROUTER_API_KEY` — copiadas para `configuracao_ia` no primeiro bootstrap quando o seed E2E roda (para o chat IA nos testes).
   - O diretório PGlite e o userData ficam em `tmp/e2e-pglite` e `tmp/e2e-user-data` (limpos no `global-setup`).

3. Testes que chamam o modelo são **ignorados** se não houver chave (`test.describe.skip` em [`ia-chat-tool-calls.spec.ts`](./ia-chat-tool-calls.spec.ts)); o smoke [`electron-smoke.spec.ts`](./electron-smoke.spec.ts) roda sempre.

## Modo IA local (sem chave cloud)

Alternativa à chave cloud: provar o chat com o **Gemma local** via `llama-server`.

```bash
ESCALAFLOW_E2E_LOCAL=1 \
  ESCALAFLOW_LLAMA_SERVER_BIN=/caminho/para/llama-server \
  ESCALAFLOW_LOCAL_MODELS_DIR="$HOME/Library/Application Support/EscalaFlow/models" \
  npm run test:e2e:build
```

- `ESCALAFLOW_E2E_LOCAL=1` — liga o gate do `ia-chat-tool-calls.spec.ts` e faz o seed configurar `provider=local` + **validar** o modelo (sobe o llama-server + smoke → `usable`), no lugar do clique manual em "Testar conexão".
- `ESCALAFLOW_LLAMA_SERVER_BIN` — `llama-server` recente que carrega `gemma4` (o `node-llama-cpp` empacotado **não** carrega). Baixe um build do llama.cpp (ex.: release `bin-macos-arm64`) e aponte aqui.
- `ESCALAFLOW_LOCAL_MODELS_DIR` — dir do GGUF (o E2E usa `--user-data-dir` isolado, então precisa apontar pro dir real dos modelos).

**Prova:** infra viva — app sobe, Gemma local responde, contexto RH (setor/folgas/escala) injeta e renderiza no AI Elements. **5/6 testes de contexto passam.**

**Limitação honesta (não é bug da migração):** o Gemma E2B (modelo local padrão, 2B) é inconsistente — em perguntas ambíguas pode pedir "qual setor" mesmo com o setor no contexto, e não copia UUID exato via tool call (`salvar_memoria`). O contexto **está** injetado (provado pelos testes que passam); é capacidade do modelo 2B. Para gate de **qualidade** determinístico, use cloud (Gemini/OpenRouter) ou um modelo local maior.

## Comandos

```bash
npm run build && npm run test:e2e
# ou
npm run test:e2e:build
```

Para o gate completo de CI:

```bash
npm run ci:verify
```

Esse comando roda typecheck, unit tests, build, E2E e tambem
`npm run test:ci-seed`, que cria um PGlite descartavel em
`tmp/ci-solver-pglite`, apaga o diretorio antes do run e reinjeta o seed
versionado [`seed-ci.ts`](../../src/main/db/seed-ci.ts). Esse seed cobre um
baseline 5x2 e um 6x1 dificil com intermitente somente em domingos alternados.

## O que é coberto

| Arquivo | Conteúdo |
|---------|----------|
| `electron-smoke.spec.ts` | Abre Electron, lista setores, texto **Padaria** (seed E2E). |
| `ia-chat-tool-calls.spec.ts` | Painel IA (`#tour-ia-toggle`), mensagens reais, tool calls (`data-testid="ia-tool-call"`), contexto de rota `/setores/:id`, efeito **salvar_memoria** visível na aba Memorias (`tabpanel`). |

## IDs e dados estáveis

- Nome do setor E2E: **Padaria** (constante alinhada em `constants.ts` e `seed-e2e.ts`).
- A navegação usa o cartão ou a tabela na lista de setores (evita depender de `setores.id` quando há `seed-local`).
- Seed de solver/CI: **CI Padaria 5x2** e **CI Mercearia 6x1 dificil** (nao aparecem no app normal; só em DB temporario de teste).

## Limitações

- **LLM não determinístico**: asserções de texto são leves; tool names vêm do DOM quando o painel existe.
- **CI sem GPU/display**: pode exigir ajustes (ex.: Linux + `xvfb`); desenvolvido para macOS local.
- **Chave de API**: sem ela, só o smoke Electron + seed roda de forma significativa para a pipeline.
