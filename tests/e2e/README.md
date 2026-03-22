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

## Comandos

```bash
npm run build && npm run test:e2e
# ou
npm run test:e2e:build
```

## O que é coberto

| Arquivo | Conteúdo |
|---------|----------|
| `electron-smoke.spec.ts` | Abre Electron, lista setores, texto **Padaria** (seed E2E). |
| `ia-chat-tool-calls.spec.ts` | Painel IA (`#tour-ia-toggle`), mensagens reais, tool calls (`data-testid="ia-tool-call"`), contexto de rota `/setores/:id`, efeito **salvar_memoria** visível na aba Memorias (`tabpanel`). |

## IDs e dados estáveis

- Nome do setor E2E: **Padaria** (constante alinhada em `constants.ts` e `seed-e2e.ts`).
- A navegação usa o cartão ou a tabela na lista de setores (evita depender de `setores.id` quando há `seed-local`).

## Limitações

- **LLM não determinístico**: asserções de texto são leves; tool names vêm do DOM quando o painel existe.
- **CI sem GPU/display**: pode exigir ajustes (ex.: Linux + `xvfb`); desenvolvido para macOS local.
- **Chave de API**: sem ela, só o smoke Electron + seed roda de forma significativa para a pipeline.
