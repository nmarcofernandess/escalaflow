# EscalaFlow MCP Server — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose EscalaFlow's IA tools to Claude Code via MCP protocol, using the Electron app as a secure HTTP bridge.

**Architecture:** Electron main process runs a minimal `node:http` server (3 routes) that proxies `executeTool()` calls. A separate MCP stdio server (spawned by Claude Code) translates MCP protocol to HTTP requests. Zero new dependencies on Electron side; one new package (`@modelcontextprotocol/sdk`) in a standalone `mcp-server/` folder.

**Tech Stack:** Node.js `node:http`, `@modelcontextprotocol/sdk`, TypeScript, tsx

**Spec:** `docs/superpowers/specs/2026-03-13-escalaflow-mcp-server-design.md`

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `src/main/tool-server.ts` | HTTP server (node:http): 4 routes `/health`, `/tools`, `/tool`, `/instructions` |
| Create | `mcp-server/index.ts` | MCP stdio server: proxy MCP protocol <-> HTTP |
| Create | `mcp-server/package.json` | Dependencies for MCP server (standalone) |
| Create | `mcp-server/tsconfig.json` | TypeScript config for MCP server (Node ESM) |
| Create | `.mcp.json` | Claude Code MCP config (project-level) |
| Modify | `src/main/index.ts:260-357` | Add `startToolServer()` on boot, `stopToolServer()` on quit |
| Modify | `src/main/ia/system-prompt.ts:593` | Add `buildMcpInstructions()` export |
| Modify | `package.json:10-41` | Add `mcp:dev` and `mcp:install` scripts |

---

## Chunk 1: HTTP Tool Server no Electron

### Task 1: Criar o HTTP server

**Files:**
- Create: `src/main/tool-server.ts`

- [ ] **Step 1: Create `src/main/tool-server.ts`**

```typescript
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { executeTool, IA_TOOLS } from './ia/tools'

const TOOL_PORT = 17380
let httpServer: ReturnType<typeof createServer> | null = null

function json(res: ServerResponse, data: unknown, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(data))
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks).toString()))
    req.on('error', reject)
  })
}

export function startToolServer() {
  httpServer = createServer(async (req, res) => {
    try {
      if (req.method === 'GET' && req.url === '/health') {
        let version = '?'
        try { version = require('electron').app.getVersion() } catch { /* dev/non-electron fallback */ }
        return json(res, { status: 'ok', version, tools: IA_TOOLS.length })
      }
      if (req.method === 'GET' && req.url === '/tools') {
        return json(res, IA_TOOLS.map(t => ({ name: t.name, description: t.description, parameters: t.parameters })))
      }
      if (req.method === 'POST' && req.url === '/tool') {
        const body = JSON.parse(await readBody(req))
        const { name, args } = body
        if (!name || !IA_TOOLS.find(t => t.name === name)) {
          return json(res, { status: 'error', message: `Tool '${name}' nao existe` }, 400)
        }
        const result = await executeTool(name, args ?? {})
        return json(res, result)
      }
      json(res, { status: 'error', message: 'Not found' }, 404)
    } catch (err) {
      json(res, { status: 'error', message: String(err) }, 500)
    }
  })

  httpServer.on('error', (e: NodeJS.ErrnoException) => {
    if (e.code === 'EADDRINUSE') {
      console.warn(`[TOOL-SERVER] Porta ${TOOL_PORT} em uso — MCP server nao vai funcionar`)
    } else {
      console.error('[TOOL-SERVER] Erro:', e)
    }
  })

  httpServer.listen(TOOL_PORT, '127.0.0.1', () => {
    console.log(`[TOOL-SERVER] Listening on 127.0.0.1:${TOOL_PORT}`)
  })
}

export function stopToolServer() {
  httpServer?.close()
  httpServer = null
}
```

- [ ] **Step 2: Verify typecheck passes**

Run: `npm run typecheck:node`
Expected: 0 errors (tool-server.ts only uses node:http + existing exports from tools.ts)

- [ ] **Step 3: Commit**

```bash
git add src/main/tool-server.ts
git commit -m "feat(mcp): add HTTP tool server for MCP bridge"
```

---

### Task 2: Integrar tool server no bootstrap do Electron

**Files:**
- Modify: `src/main/index.ts:260-357`

- [ ] **Step 1: Add import at the top of `index.ts` (after line 9)**

Add after the `import { initDb, closeDb } from './db/pglite'` line:

```typescript
import { startToolServer, stopToolServer } from './tool-server'
```

- [ ] **Step 2: Call `startToolServer()` after database init**

In the `bootstrap()` function, add after `await seedLocalData()` (line 264):

```typescript
  startToolServer()
```

- [ ] **Step 3: Call `stopToolServer()` on quit**

In the `before-quit` handler (line 334), add before the `closeDb()` call (line 355):

```typescript
    stopToolServer()
```

The resulting block around line 353-356 should look like:

```typescript
    // 3. Cleanup (AFTER snapshot)
    stopToolServer()
    void import('./ia/local-llm').then(m => m.unloadModel()).catch(() => {})
    void closeDb().catch(() => {})
    app.quit()
```

- [ ] **Step 4: Verify typecheck passes**

Run: `npm run typecheck:node`
Expected: 0 errors

- [ ] **Step 5: Manual smoke test — HTTP server responds**

1. Run `npm run dev` (starts Electron with hot reload)
2. In another terminal: `curl http://127.0.0.1:17380/health`
   Expected: `{"status":"ok","tools":35}` (or similar count)
3. `curl http://127.0.0.1:17380/tools | head -c 200`
   Expected: JSON array with tool objects `[{"name":"buscar_colaborador",...},...]`
4. `curl -X POST http://127.0.0.1:17380/tool -H 'Content-Type: application/json' -d '{"name":"obter_alertas","args":{}}'`
   Expected: JSON with `{"status":"ok",...}` containing alerts data

- [ ] **Step 6: Commit**

```bash
git add src/main/index.ts
git commit -m "feat(mcp): integrate tool server in Electron bootstrap"
```

---

## Chunk 2: MCP Server (stdio proxy)

### Task 3: Scaffold do MCP server

**Files:**
- Create: `mcp-server/package.json`
- Create: `mcp-server/tsconfig.json`

- [ ] **Step 1: Create `mcp-server/package.json`**

```json
{
  "name": "escalaflow-mcp",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "start": "tsx index.ts"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.12.1"
  },
  "devDependencies": {
    "tsx": "^4.21.0"
  }
}
```

- [ ] **Step 2: Create `mcp-server/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "."
  },
  "include": ["*.ts"]
}
```

- [ ] **Step 3: Install dependencies**

Run: `cd mcp-server && npm install`
Expected: `node_modules/` created with `@modelcontextprotocol/sdk`

- [ ] **Step 4: Commit**

```bash
git add mcp-server/package.json mcp-server/tsconfig.json mcp-server/package-lock.json
git commit -m "feat(mcp): scaffold mcp-server package"
```

---

### Task 4: Implementar o MCP server

**Files:**
- Create: `mcp-server/index.ts`

- [ ] **Step 1: Create `mcp-server/index.ts`**

```typescript
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'

const TOOL_URL = process.env.ESCALAFLOW_URL || 'http://127.0.0.1:17380'
const TOOL_TIMEOUT = 300_000  // 5min — solver Python pode demorar em periodos longos

// ==================== BOOT ====================

// Health check — garante que o Electron ta rodando
try {
  const health = await fetch(`${TOOL_URL}/health`, { signal: AbortSignal.timeout(5000) })
  if (!health.ok) throw new Error(`HTTP ${health.status}`)
  const info = await health.json() as { status: string; tools: number; version?: string }
  console.error(`[escalaflow-mcp] Conectado ao EscalaFlow (${info.tools} tools, v${info.version ?? '?'})`)
} catch {
  console.error('[escalaflow-mcp] EscalaFlow nao esta aberto. Abra o app e reinicie o MCP server.')
  process.exit(1)
}

// Busca catalogo de tools do Electron (JSON Schema raw — ja convertido de Zod no app)
const toolsRes = await fetch(`${TOOL_URL}/tools`)
const tools = await toolsRes.json() as Array<{
  name: string
  description: string
  parameters: Record<string, unknown>
}>

console.error(`[escalaflow-mcp] ${tools.length} tools registradas`)

// ==================== MCP SERVER ====================

const server = new Server(
  { name: 'escalaflow', version: '1.0.0' },
  { capabilities: { tools: {} } },
)

// tools/list — retorna catalogo com inputSchema (JSON Schema raw)
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: tools.map(t => ({
    name: t.name,
    description: t.description,
    inputSchema: t.parameters as any,
  })),
}))

// tools/call — proxy pra POST /tool no Electron
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params

  try {
    const res = await fetch(`${TOOL_URL}/tool`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, args: args ?? {} }),
      signal: AbortSignal.timeout(TOOL_TIMEOUT),
    })

    if (!res.ok) {
      const body = await res.text()
      return {
        content: [{ type: 'text' as const, text: `Erro HTTP ${res.status}: ${body}` }],
        isError: true,
      }
    }

    const result = await res.json()
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // Detectar conexao perdida
    const isConnectionLost = message.includes('fetch failed') || message.includes('ECONNREFUSED')
    const userMsg = isConnectionLost
      ? `Conexao com EscalaFlow perdida. O app foi fechado?\n\nErro: ${message}`
      : `Erro ao chamar tool '${name}': ${message}`

    return {
      content: [{ type: 'text' as const, text: userMsg }],
      isError: true,
    }
  }
})

// ==================== CONNECT ====================

const transport = new StdioServerTransport()
await server.connect(transport)
console.error('[escalaflow-mcp] MCP server conectado via stdio')
```

Note: `console.error` is used intentionally — MCP stdio uses stdout for protocol messages, so logs go to stderr.

- [ ] **Step 2: Verify MCP server compiles**

Run: `cd mcp-server && npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add mcp-server/index.ts
git commit -m "feat(mcp): implement MCP stdio server with dynamic tool registration"
```

---

## Chunk 3: Config, Instructions e Integracao Final

### Task 5: Criar config MCP pro Claude Code

**Files:**
- Create: `.mcp.json`

- [ ] **Step 1: Create `.mcp.json` in project root**

```json
{
  "mcpServers": {
    "escalaflow": {
      "type": "stdio",
      "command": "npx",
      "args": ["tsx", "mcp-server/index.ts"],
      "cwd": "/Users/marcofernandes/escalaflow"
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add .mcp.json
git commit -m "feat(mcp): add Claude Code MCP config"
```

---

### Task 6: Adicionar `buildMcpInstructions()` ao system-prompt.ts

**Files:**
- Modify: `src/main/ia/system-prompt.ts` (append after `buildLocalSystemPrompt` function, ~line 593)

- [ ] **Step 1: Add `buildMcpInstructions()` at end of file**

Append after the closing `}` of `buildLocalSystemPrompt()` (line 593):

```typescript

/**
 * Instructions de dominio para o MCP server.
 * Extrai secoes por header (## N)) do SYSTEM_PROMPT — robusto contra reordenacao.
 * Exclui: identidade da IA do app, formatacao, conduta especifica do chat.
 * Adaptado: Claude Code tem capacidades extras (arquivos, terminal, scripts).
 */
export function buildMcpInstructions(): string {
  // Extrair secoes por header numerico — mais robusto que split('---')
  const sectionRegex = /## (\d+)\)/g
  const matches = [...SYSTEM_PROMPT.matchAll(sectionRegex)]

  // Secoes desejadas: 1 (CLT), 2 (Motor), 3 (Entidades), 4 (Tools), 5 (Schema), 6 (Workflows), 8 (Memorias)
  const wantedSections = [1, 2, 3, 4, 5, 6, 8]
  const extractedParts: string[] = []

  for (const wanted of wantedSections) {
    const matchIdx = matches.findIndex(m => m[1] === String(wanted))
    if (matchIdx === -1) continue
    const start = matches[matchIdx].index!
    const end = matchIdx + 1 < matches.length ? matches[matchIdx + 1].index! : SYSTEM_PROMPT.length
    extractedParts.push(SYSTEM_PROMPT.slice(start, end).trim())
  }

  const domainContent = extractedParts.join('\n\n---\n\n')

  return `# EscalaFlow — Contexto de Dominio

Voce esta operando o EscalaFlow via MCP tools. O app Electron esta aberto e voce se comunica
com ele via HTTP. Todas as tools executam no contexto do app — o banco PGlite e protegido.

Voce tem MAIS poder que a IA interna do app:
- Pode criar arquivos no Mac (HTMLs, CSVs, relatorios)
- Pode ler planilhas e documentos do usuario
- Pode rodar scripts e usar o terminal
- Pode fazer analises multi-step sem limite de tool calls

Regras de ouro:
- Resolva nomes e IDs sozinho via tools. NAO peca ID ao usuario.
- Use dados reais das tools. NUNCA invente dados.
- Erros de tool: leia o campo "correction", corrija args e tente de novo.
- Respostas de tools usam 3 status: "ok", "error", "truncated". Leia o status.
- Apos gerar escala, analise indicadores e sugira melhorias.
- NUNCA oficialize escala com violacoes_hard > 0.

${domainContent}
`
}
```

- [ ] **Step 2: Verify typecheck passes**

Run: `npm run typecheck:node`
Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add src/main/ia/system-prompt.ts
git commit -m "feat(mcp): add buildMcpInstructions() for MCP domain context"
```

---

### Task 7: Servir instructions via HTTP + consumir no MCP server

**Files:**
- Modify: `src/main/tool-server.ts` (add `/instructions` route)
- Modify: `mcp-server/index.ts` (fetch and use instructions)

- [ ] **Step 1: Add `/instructions` route to `tool-server.ts`**

Add a new route inside the `createServer` callback, after the `/tools` route and before the `404`:

```typescript
      if (req.method === 'GET' && req.url === '/instructions') {
        const { buildMcpInstructions } = await import('./ia/system-prompt')
        return json(res, { instructions: buildMcpInstructions() })
      }
```

- [ ] **Step 2: Fetch instructions in MCP server boot**

In `mcp-server/index.ts`, add after the tools fetch block (after `console.error(...tools registered...)`):

```typescript

// Busca instructions de dominio (CLT, motor, entidades, workflows)
let instructions = ''
try {
  const instrRes = await fetch(`${TOOL_URL}/instructions`)
  const data = await instrRes.json() as { instructions: string }
  instructions = data.instructions
  console.error(`[escalaflow-mcp] Instructions carregadas (${instructions.length} chars)`)
} catch {
  console.error('[escalaflow-mcp] Aviso: instructions nao carregadas — tools funcionam sem contexto de dominio')
}
```

Then pass instructions to the server. **IMPORTANT: Verify SDK API at implementation time.** Try these approaches in order:

**Approach A (preferred):** Pass `instructions` in ServerOptions:
```typescript
const server = new Server(
  { name: 'escalaflow', version: '1.0.0' },
  { capabilities: { tools: {} }, instructions },
)
```

**Approach B (if A doesn't compile):** Override the initialize handler:
```typescript
import { InitializeRequestSchema } from '@modelcontextprotocol/sdk/types.js'

// After creating server, before setting other handlers:
server.setRequestHandler(InitializeRequestSchema, async () => ({
  protocolVersion: '2024-11-05',
  serverInfo: { name: 'escalaflow', version: '1.0.0' },
  capabilities: { tools: {} },
  instructions,
}))
```

**Approach C (safest fallback):** Skip instructions in MCP protocol, instead create a `CLAUDE.md` or skill file that loads the domain context. The tools will still work — Claude just won't have pre-loaded CLT/CCT knowledge, but the tool descriptions cover 70% of what's needed.

- [ ] **Step 3: Verify typecheck**

Run: `npm run typecheck:node && cd mcp-server && npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 4: Commit**

```bash
git add src/main/tool-server.ts mcp-server/index.ts
git commit -m "feat(mcp): serve domain instructions via HTTP and consume in MCP server"
```

---

### Task 8: Adicionar scripts ao package.json

**Files:**
- Modify: `package.json:10-41` (scripts section)

- [ ] **Step 1: Add MCP scripts**

Add these two entries to the `"scripts"` section in `package.json`:

```json
    "mcp:dev": "npx tsx mcp-server/index.ts",
    "mcp:install": "cd mcp-server && npm install",
```

- [ ] **Step 2: Commit**

```bash
git add package.json
git commit -m "feat(mcp): add mcp:dev and mcp:install scripts"
```

---

## Chunk 4: Teste End-to-End e Refinamento

### Task 9: Teste end-to-end manual

This task verifies the entire pipeline works: Claude Code -> MCP server -> HTTP -> Electron -> tool -> response.

- [ ] **Step 1: Instalar dependencias do MCP server**

Run: `npm run mcp:install`
Expected: `mcp-server/node_modules/` created

- [ ] **Step 2: Verificar que o app Electron esta rodando**

Run: `npm run dev` (in one terminal)
Verify: `curl http://127.0.0.1:17380/health` returns `{"status":"ok",...}`

- [ ] **Step 3: Testar MCP server standalone (sem Claude Code)**

Run: `npm run mcp:dev`
Expected: stderr shows `[escalaflow-mcp] Conectado ao EscalaFlow (35 tools, v1.5.6)`
Then Ctrl+C to stop.

- [ ] **Step 4: Testar com Claude Code**

1. Restart Claude Code (so it picks up `.mcp.json`)
2. Run: `/mcp` — verify `escalaflow` server appears as connected
3. Ask Claude: "Use a tool obter_alertas do escalaflow" — should call the MCP tool and return alerts
4. Ask Claude: "Consulta os setores cadastrados no EscalaFlow" — should call `consultar` tool
5. Verify the app Electron shows the data was queried (check terminal for `[TOOL-SERVER]` logs)

- [ ] **Step 5: Testar error cases**

1. Close the Electron app
2. In Claude Code, ask to use an EscalaFlow tool
3. Expected: error message "EscalaFlow nao esta aberto" or "Conexao perdida"
4. Reopen the app, restart MCP (`/mcp` -> restart escalaflow)
5. Verify tools work again

- [ ] **Step 6: Verify gitignore covers mcp-server/node_modules**

Run: `git status mcp-server/node_modules/` — should show nothing (already covered by root `node_modules/` pattern in `.gitignore`).
If it shows files, add `mcp-server/node_modules/` to `.gitignore` and commit.

---

### Task 10: Typecheck final e validacao

- [ ] **Step 1: Run full typecheck**

Run: `npm run typecheck`
Expected: 0 errors

- [ ] **Step 2: Run existing tests (sanity check — nothing broke)**

Run: `npm run test`
Expected: All existing tests pass. No regressions.

- [ ] **Step 3: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix(mcp): address typecheck or test issues"
```
