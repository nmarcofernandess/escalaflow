# Provas Terminal IA — EscalaFlow

Data/hora: 2026-06-14 02:56:18 -03

Worktree: `/Users/marcoantonio/escalaflow-terminal-ia`
Branch: `codex/terminal-ia-persona`

## Ambiente de prova

Config local isolada:

```bash
ESCALAFLOW_DB_PATH=/tmp/escalaflow-terminal-ia-db
ESCALAFLOW_USER_DATA_DIR=/tmp/escalaflow-terminal-ia-userdata
ESCALAFLOW_LOCAL_MODELS_DIR="$HOME/Library/Application Support/EscalaFlow/models"
ESCALAFLOW_LLAMA_SERVER_BIN="$HOME/Library/Application Support/FlowKit/runtimes/llama.cpp/darwin-arm64/llama-server"
ESCALAFLOW_TOOL_SERVER_TOKEN=escalaflow-terminal-proof
```

Observacao honesta: o modelo GGUF existia em `~/Library/Application Support/EscalaFlow/models`, mas o runtime `llama-server` usado na prova veio do FlowKit via `ESCALAFLOW_LLAMA_SERVER_BIN`.

## Readiness e bloqueio sem config

Com DB limpo, sem `configuracao_ia`, o launcher bloqueou antes de abrir Terminal:

```http
HTTP/1.1 409 Conflict

{
  "status": "error",
  "result": {
    "opened": false,
    "status": "blocked",
    "error_message": "Configure provider e modelo antes de abrir o Terminal.",
    "readiness": {
      "ok": false,
      "code": "configMissing",
      "runtime": {
        "provider": null,
        "model": null,
        "toolsCount": 30
      }
    }
  }
}
```

Depois de configurar provider local:

```http
HTTP/1.1 200 OK

{
  "status": "ok",
  "readiness": {
    "ok": true,
    "code": "ready",
    "runtime": {
      "provider": "local",
      "model": "gemma-4-e2b-it-q4",
      "toolsAvailable": true,
      "toolsCount": 30
    },
    "command": "npm --prefix '/Users/marcoantonio/escalaflow-terminal-ia' run cli -- chat --attach"
  }
}
```

## Persona e UI

Screenshots gerados:

- RH final restrito: `/tmp/escalaflow-rh-final-terminal.png`
- Admin launcher: `/tmp/escalaflow-admin-terminal-launcher.png`
- Chat lateral: `/tmp/escalaflow-side-chat-padeiro.png`

Prova de persona:

```json
{
  "rhLauncherButtons": 0,
  "rhHasRestrictedCopy": true,
  "adminHasLauncher": true,
  "adminHasResolvedModel": true
}
```

Prova de ausencia de input interativo visivel na pagina Terminal IA:

```json
{
  "allInputsInMain": [
    {
      "tag": "textarea",
      "placeholder": "Escreva sua mensagem...",
      "disabled": true,
      "ariaHiddenAncestor": true,
      "visible": false
    }
  ],
  "visibleInteractiveInputs": []
}
```

## Chat lateral

Readiness no mesmo processo Electron antes de abrir `/ia`:

```json
{
  "ok": true,
  "code": "ready",
  "runtime": {
    "provider": "local",
    "model": "gemma-4-e2b-it-q4",
    "toolsAvailable": true,
    "toolsCount": 30
  }
}
```

Transcript exato salvo de `/tmp/escalaflow-side-chat-padeiro.json`:

```text
Usuario:
me conta uma piada de padeiro

Assistente:
Que tal uma piada? Como gestora de RH, meu foco é otimizar processos, então vou te dar uma piada rápida e objetiva! 😉

**Por que o padeiro não gosta de ir à praia?**

... Porque ele tem medo de fazer **pão de queijo** na areia!

Se precisar de ajuda para montar uma escala, ajustar regras ou qualquer outra coisa do RH, é só me chamar! Estou aqui para resolver.
```

## CLI fechado

Comando:

```bash
ESCALAFLOW_TOOL_SERVER=http://127.0.0.1:17380 \
ESCALAFLOW_TOOL_SERVER_TOKEN=escalaflow-terminal-proof \
npm run cli -- chat "me conta uma piada de padeiro"
```

Transcript:

```text
Que tal uma piada? Como gestora de RH, meu foco é otimizar processos, então vou te dar uma piada rápida e objetiva! 😉

**Por que o padeiro não gosta de ir à praia?**

... Porque ele tem medo de fazer **pão de queijo** na areia!

Se precisar de ajuda para montar uma escala, ajustar regras ou qualquer outra coisa do RH, é só me chamar! Estou aqui para resolver.
```

## Terminal do sistema

Antes/depois da abertura via `/terminal/open-ai-terminal`:

```text
before=5 after=6
```

Resposta HTTP:

```http
HTTP/1.1 200 OK

{
  "status": "ok",
  "result": {
    "opened": true,
    "status": "dispatched",
    "cwd": "/tmp/EscalaFlow Proof Path With Spaces",
    "command": "npm --prefix '/Users/marcoantonio/escalaflow-terminal-ia' run cli -- chat --attach",
    "readiness": {
      "ok": true,
      "code": "ready",
      "runtime": {
        "provider": "local",
        "model": "gemma-4-e2b-it-q4"
      }
    }
  }
}
```

Transcript capturado do Terminal.app:

```text
EscalaFlow IA no Terminal
CWD: /tmp/EscalaFlow Proof Path With Spaces
Comando: npm --prefix '/Users/marcoantonio/escalaflow-terminal-ia' run cli -- chat --attach

> escalaflow@1.11.1 cli
> npx tsx src/cli/index.ts chat --attach

EscalaFlow chat conectado e IA validada. Digite "sair" para encerrar.
Voce > me conta uma piada de padeiro
IA > Que tal uma piada? Como gestora de RH, meu foco é otimizar processos, então vou te dar uma piada rápida e objetiva! 😉

**Por que o padeiro não gosta de ir à praia?**

... Porque ele tem medo de fazer **pão de queijo** na areia!

Se precisar de ajuda para montar uma escala, ajustar regras ou qualquer outra coisa do RH, é só me chamar! Estou aqui para resolver.
Voce >
```

Falha encontrada e corrigida: a primeira abertura do Terminal retornou `opened:true`, mas o CLI morreu com `401` porque a janela do Terminal nao herdava `ESCALAFLOW_TOOL_SERVER_TOKEN`. O wrapper agora exporta `ESCALAFLOW_TOOL_SERVER`, `ESCALAFLOW_TOOL_SERVER_TOKEN` e `ESCALAFLOW_USER_DATA_DIR`.

## Tools e Terminal Harness

Tool publica real:

```bash
ESCALAFLOW_TOOL_SERVER=http://127.0.0.1:17380 \
ESCALAFLOW_TOOL_SERVER_TOKEN=escalaflow-terminal-proof \
npm run cli -- tool fazer_backup --json '{}'
```

Resultado:

```json
{
  "status": "ok",
  "mensagem": "Backup criado com sucesso",
  "criado_em": "2026-06-14T05:55:48.267Z",
  "tamanho_kb": 2,
  "total_registros": 41
}
```

Arquivo criado:

```text
/Users/marcoantonio/Library/Application Support/Electron/backups/escalaflow-backup-2026-06-14T05-55-48-267.zip
-rw-rw-rw- 2.1K
```

Terminal Harness com path contendo espaco:

```http
POST /terminal/exec

{
  "command": "printf escalaflow-terminal-tool-proof > proof.txt && cat proof.txt",
  "cwd": "/tmp/EscalaFlow Proof Path With Spaces",
  "timeout_ms": 5000
}
```

Resultado:

```json
{
  "status": "ok",
  "result": {
    "exit_code": 0,
    "stdout": "escalaflow-terminal-tool-proof",
    "cwd": "/tmp/EscalaFlow Proof Path With Spaces"
  }
}
```

Arquivo:

```text
/tmp/EscalaFlow Proof Path With Spaces/proof.txt
escalaflow-terminal-tool-proof
```

## Testes automatizados

Passou:

```bash
npm run typecheck
npx vitest run \
  tests/main/terminal/ai-terminal-builders.spec.ts \
  tests/main/terminal/harness.spec.ts \
  tests/main/ia/runtime-readiness.spec.ts \
  tests/renderer/terminal-page.spec.tsx
npm run build
```

Resultado: 27 testes passaram no recorte relevante; build passou.

Suite completa:

```bash
npm run typecheck && npm test
```

Resultado: `typecheck` passou, mas `npm test` falhou por timeouts/timeout solver preexistentes em:

- `tests/main/operational-floor.spec.ts`
- `tests/main/python-cycle-parity.spec.ts`
- `tests/main/solver-pass1-regressions.spec.ts`
- `tests/main/solver-warm-start-hints.spec.ts`
- `tests/main/solver-intermitente-domingo.spec.ts`
- `tests/main/solver-intermitente-tipo-b.spec.ts`

Essas falhas nao tocaram os contratos novos de Terminal IA, mas a suite completa nao esta verde.

## Falhas e correcoes feitas

- `configMissing` bloqueou corretamente sem abrir Terminal.
- O Playwright inicial do chat lateral ficou preso em input hidden do painel lateral; a prova final usou `/ia`, que compartilha o mesmo motor de chat, apos validar readiness via `terminal.aiStatus`.
- O Terminal abriu mas o CLI falhou com `401`; corrigido exportando token/URL no wrapper.
- `terminal_exec` nao existe como tool publica no EscalaFlow; a prova de tool publica foi feita com `fazer_backup`, e a prova de terminal/arquivo foi feita com `/terminal/exec`.

## Bloqueios / riscos residuais

- A prova local de IA dependeu de `ESCALAFLOW_LLAMA_SERVER_BIN` apontando para o runtime do FlowKit. Sem runtime compativel, EscalaFlow local entra em readiness bloqueado por carregamento/runtime.
- A suite completa ainda tem falhas de solver por timeout; nao declarar `npm test` verde.
