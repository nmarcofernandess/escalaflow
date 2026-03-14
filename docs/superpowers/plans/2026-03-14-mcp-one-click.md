# MCP One-Click Connect — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compilar o MCP server em binário nativo, empacotar no DMG, e oferecer botão de 1 clique na UI pra conectar Claude Code — sem Node, sem terminal, sem setup manual.

**Architecture:** O app já expõe 34 tools via HTTP em 127.0.0.1:17380. O MCP server (105 linhas) é um proxy stdio→HTTP. Compilamos com `bun build --compile`, empacotamos via `extraResources`, e a UI roda `claude mcp add` automaticamente. Novo endpoint `/discovery` expõe o contexto dinâmico (mesmo da IA interna).

**Tech Stack:** Bun compile, Electron IPC (tipc), React (shadcn/ui), child_process.execFile

**Spec:** `docs/superpowers/specs/2026-03-14-mcp-one-click-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/main/tool-server.ts` | Modify | Add GET /discovery endpoint |
| `src/main/ia/discovery.ts` | Modify | Add 'externo' to _dicaPagina() |
| `src/shared/types.ts` | Modify | Add 'externo' to IaContexto.pagina union |
| `src/main/mcp-path.ts` | Create | Resolve MCP binary path (dev/prod) |
| `src/main/tipc.ts` | Modify | Add 3 IPC handlers (mcp.*) |
| `src/renderer/src/paginas/ConfiguracoesPagina.tsx` | Modify | Redesign MCP card |
| `electron-builder.yml` | Modify | Add mcp-bin/ to extraResources |
| `.github/workflows/release.yml` | Modify | Add Bun install + MCP build steps |
| `package.json` | Modify | Add mcp:build script |
| `.gitignore` | Modify | Add mcp-bin/ |

---

## Chunk 1: Discovery Endpoint + Types

### Task 1: Add 'externo' to IaContexto pagina type

**Files:**
- Modify: `src/shared/types.ts:747`
- Modify: `src/main/ia/discovery.ts:536-551`

- [ ] **Step 1: Add 'externo' to the pagina union type**

In `src/shared/types.ts`, line 747, add `'externo'` to the union:

```typescript
pagina: 'dashboard' | 'setor_lista' | 'setor_detalhe' | 'escala' | 'escalas_hub' | 'colaborador_lista' | 'colaborador_detalhe' | 'contratos' | 'empresa' | 'feriados' | 'configuracoes' | 'regras' | 'ia' | 'outro' | 'externo'
```

- [ ] **Step 2: Add dica for 'externo' in _dicaPagina()**

In `src/main/ia/discovery.ts`, inside the `dicas` object in `_dicaPagina()`, add:

```typescript
externo: '\n💡 Contexto externo (MCP/terminal). Sem página visual — resolva nomes e IDs via tools.',
```

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: PASS (no errors)

- [ ] **Step 4: Commit**

```bash
git add src/shared/types.ts src/main/ia/discovery.ts
git commit -m "feat(mcp): add 'externo' pagina type for MCP discovery context"
```

### Task 2: Add GET /discovery endpoint to tool-server

**Files:**
- Modify: `src/main/tool-server.ts:1-2,41-44`

- [ ] **Step 1: Add import for buildContextBriefing**

In `src/main/tool-server.ts`, add import at the top (after line 2):

```typescript
import { buildContextBriefing } from './ia/discovery'
import type { IaContexto } from '../shared/types'
```

- [ ] **Step 2: Add /discovery handler**

In `src/main/tool-server.ts`, insert BEFORE the `/instructions` handler (before line 41). Parse URL to extract `setor` query param:

```typescript
      if (req.method === 'GET' && req.url?.startsWith('/discovery')) {
        const url = new URL(req.url, `http://127.0.0.1:${TOOL_PORT}`)
        const setorParam = url.searchParams.get('setor')
        const syntheticCtx: IaContexto = {
          rota: '/mcp',
          pagina: 'externo',
          setor_id: setorParam ? parseInt(setorParam, 10) || undefined : undefined,
          colaborador_id: undefined,
        }
        const briefing = await buildContextBriefing(syntheticCtx)
        return json(res, { discovery: briefing })
      }
```

- [ ] **Step 3: Test manually**

Run: `npm run dev` (wait for app to open)

In another terminal:
```bash
curl http://127.0.0.1:17380/discovery | head -c 500
```
Expected: JSON with `discovery` field containing markdown text with "CONTEXTO AUTOMÁTICO", setores, etc.

```bash
curl "http://127.0.0.1:17380/discovery?setor=2" | head -c 1000
```
Expected: Same + setor-specific context (collaborators, postos, demandas).

- [ ] **Step 4: Commit**

```bash
git add src/main/tool-server.ts
git commit -m "feat(mcp): add GET /discovery endpoint to tool-server"
```

---

## Chunk 2: MCP Binary Path Resolution

### Task 3: Create mcp-path.ts

**Files:**
- Create: `src/main/mcp-path.ts`

- [ ] **Step 1: Create the file**

Create `src/main/mcp-path.ts`:

```typescript
import { existsSync } from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

/**
 * Resolve the MCP server binary path.
 * Follows the same precedence as resolveSolverPath() in solver-bridge.ts.
 */
export function resolveMcpPath(): string {
  // 1. Explicit env var override
  const explicit = process.env.ESCALAFLOW_MCP_PATH?.trim()
  if (explicit) {
    if (existsSync(explicit)) return explicit
    throw new Error(`ESCALAFLOW_MCP_PATH aponta para arquivo inexistente: ${explicit}`)
  }

  const isWin = process.platform === 'win32'
  const binNames = isWin
    ? ['escalaflow-mcp.exe', 'escalaflow-mcp']
    : ['escalaflow-mcp']

  // Detect packaged Electron context
  let isPackaged = false
  try {
    const electron = require('electron') as { app?: { isPackaged?: boolean } }
    isPackaged = Boolean(electron.app?.isPackaged)
  } catch {
    // not in Electron context
  }

  // 2. Built binary in project root (dev after running mcp:build)
  for (const name of binNames) {
    const devBin = path.join(process.cwd(), 'mcp-bin', name)
    if (existsSync(devBin)) return devBin
  }

  // 3. Production: packaged with Electron resources
  if (isPackaged) {
    for (const name of binNames) {
      const prodBin = path.join(process.resourcesPath, 'mcp-bin', name)
      if (existsSync(prodBin)) return prodBin
    }
  }

  // 4. Fallback dev: source (requires Node + tsx)
  const devSource = path.join(process.cwd(), 'mcp-server', 'index.ts')
  if (existsSync(devSource)) return devSource

  throw new Error(
    'MCP server nao encontrado. Em dev, rode mcp:build ou use mcp:dev. ' +
    'Em producao, o binario deveria estar em Resources/mcp-bin/.'
  )
}

/**
 * Whether the resolved path is the TS source (needs npx tsx) vs compiled binary.
 */
export function isMcpSource(mcpPath: string): boolean {
  return mcpPath.endsWith('.ts')
}
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/main/mcp-path.ts
git commit -m "feat(mcp): add resolveMcpPath() for binary path resolution"
```

---

## Chunk 3: IPC Handlers

### Task 4: Add 3 MCP IPC handlers to tipc.ts

**Files:**
- Modify: `src/main/tipc.ts`

- [ ] **Step 1: Add imports**

At the top of `src/main/tipc.ts`, add:

```typescript
import { resolveMcpPath, isMcpSource } from './mcp-path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
const execFileAsync = promisify(execFile)
```

Note: `child_process` and `util` might already be imported. Check and add only what's missing.

- [ ] **Step 2: Add mcp.path handler**

Add handler (follow existing tipc pattern):

```typescript
const mcpPath = t.procedure.action(async () => {
  try {
    const resolved = resolveMcpPath()
    const isSource = isMcpSource(resolved)
    return { path: resolved, isSource }
  } catch (err) {
    return { path: null, isSource: false, error: String(err) }
  }
})
```

- [ ] **Step 3: Add mcp.connectClaudeCode handler**

```typescript
const mcpConnectClaudeCode = t.procedure.action(async () => {
  try {
    const resolved = resolveMcpPath()
    const isSource = isMcpSource(resolved)

    const args = ['mcp', 'add', 'escalaflow', '--transport', 'stdio', '--scope', 'user', '--']
    if (isSource) {
      args.push('npx', 'tsx', resolved)
    } else {
      args.push(resolved)
    }

    await execFileAsync('claude', args, { timeout: 15_000 })
    return { success: true, message: 'Conectado! Reinicie o Claude Code pra ativar.' }
  } catch (err: any) {
    const msg = err?.message ?? String(err)
    if (msg.includes('ENOENT') || msg.includes('not found')) {
      return { success: false, message: 'Claude Code nao encontrado. Instale em https://claude.ai/download' }
    }
    return { success: false, message: `Erro: ${msg}` }
  }
})
```

- [ ] **Step 4: Add mcp.configJson handler**

```typescript
const mcpConfigJson = t.procedure.action(async () => {
  try {
    const resolved = resolveMcpPath()
    const isSource = isMcpSource(resolved)

    const config: Record<string, unknown> = {
      mcpServers: {
        escalaflow: isSource
          ? { command: 'npx', args: ['tsx', resolved] }
          : { command: resolved }
      }
    }
    return { json: JSON.stringify(config, null, 2) }
  } catch (err) {
    return { json: null, error: String(err) }
  }
})
```

- [ ] **Step 5: Register handlers in the router**

Find the router export in tipc.ts and add the 3 handlers. The project uses dot-notation keys (e.g. `'ia.local.status': iaLocalStatus`). Follow that pattern:

```typescript
'mcp.path': mcpPath,
'mcp.connectClaudeCode': mcpConnectClaudeCode,
'mcp.configJson': mcpConfigJson,
```

- [ ] **Step 6: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/main/tipc.ts
git commit -m "feat(mcp): add IPC handlers for MCP path, connect, and config"
```

---

## Chunk 4: UI Card Redesign

### Task 5: Redesign MCP card in ConfiguracoesPagina

**Files:**
- Modify: `src/renderer/src/paginas/ConfiguracoesPagina.tsx`

- [ ] **Step 1: Find and replace the current Claude Code card**

Search for the existing "Claude Code" card (look for `Claude Code` text or the MCP setup section). Replace it with a compact card using shadcn components. The card should be positioned below the IA config card.

The file uses `window.electron.ipcRenderer.invoke()` for IPC (NOT a tipc client). Follow that pattern. `Terminal` icon is already imported at line 27 — do NOT add a duplicate import.

```tsx
// MCP Card — compact, below IA card
function McpCard() {
  const [connecting, setConnecting] = useState(false)
  const [status, setStatus] = useState<string | null>(null)

  async function handleConnect() {
    setConnecting(true)
    setStatus(null)
    try {
      const result = await window.electron.ipcRenderer.invoke('mcp.connectClaudeCode') as { success: boolean; message: string }
      setStatus(result.message)
    } catch (err) {
      setStatus(`Erro: ${err}`)
    } finally {
      setConnecting(false)
    }
  }

  async function handleCopyConfig() {
    try {
      const result = await window.electron.ipcRenderer.invoke('mcp.configJson') as { json: string | null; error?: string }
      if (result.json) {
        await navigator.clipboard.writeText(result.json)
        setStatus('Config copiado! Cole no config da sua IA.')
      } else {
        setStatus(result.error ?? 'Erro ao gerar config')
      }
    } catch (err) {
      setStatus(`Erro: ${err}`)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Terminal className="h-5 w-5" />
          Controle via Terminal
        </CardTitle>
        <CardDescription>
          Use qualquer IA com MCP pra operar o EscalaFlow direto do terminal. O app precisa estar aberto.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex gap-2">
          <Button onClick={handleConnect} disabled={connecting} variant="default" size="sm">
            {connecting ? 'Conectando...' : 'Conectar Claude Code'}
          </Button>
          <Button onClick={handleCopyConfig} variant="outline" size="sm">
            Copiar Config MCP
          </Button>
        </div>
        {status && (
          <p className="text-sm text-muted-foreground">{status}</p>
        )}
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 2: Verify existing imports**

Check that `Terminal` (lucide-react), `Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`, `Button`, `useState` are already imported. They should be — do NOT add duplicates.

- [ ] **Step 3: Place the card in the page layout**

Find where the IA config card is rendered and place `<McpCard />` right after it.

- [ ] **Step 4: Remove the old Claude Code card**

Delete the previous Claude Code setup card entirely (the one with the `claude mcp add` command display).

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 6: Visual test**

Run: `npm run dev`
Navigate to Configurações page. Verify:
- New "Controle via Terminal" card appears below IA card
- "Conectar Claude Code" button is clickable
- "Copiar Config MCP" copies JSON to clipboard
- Old card is gone

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/paginas/ConfiguracoesPagina.tsx
git commit -m "feat(mcp): redesign MCP card with 1-click connect button"
```

---

## Chunk 5: Build Pipeline + Packaging

### Task 6: Add mcp-bin/ to .gitignore and mcp:build script

**Files:**
- Modify: `.gitignore`
- Modify: `package.json`

- [ ] **Step 1: Add mcp-bin/ to .gitignore**

After the `solver-bin/` line (line 43), add:

```
# MCP server build artifacts
mcp-bin/
```

- [ ] **Step 2: Add mcp:build script to package.json**

In `package.json` scripts section, replace the existing `mcp:dev` and `mcp:install` lines with:

```json
"mcp:dev": "npx tsx mcp-server/index.ts",
"mcp:build": "cd mcp-server && bun install && cd .. && bun build --compile mcp-server/index.ts --outfile mcp-bin/escalaflow-mcp",
"mcp:install": "cd mcp-server && npm install"
```

- [ ] **Step 3: Commit**

```bash
git add .gitignore package.json
git commit -m "chore(mcp): add mcp-bin/ to gitignore and mcp:build script"
```

### Task 7: Add mcp-bin/ to electron-builder extraResources

**Files:**
- Modify: `electron-builder.yml:8-21`

- [ ] **Step 1: Add mcp-bin resource**

After the `knowledge/` extraResource block (after line 21), add:

```yaml
  - from: 'mcp-bin/'
    to: 'mcp-bin/'
    filter:
      - '**/*'
```

- [ ] **Step 2: Commit**

```bash
git add electron-builder.yml
git commit -m "chore(mcp): bundle mcp-bin/ in electron-builder extraResources"
```

### Task 8: Add Bun + MCP build steps to CI

**Files:**
- Modify: `.github/workflows/release.yml`

- [ ] **Step 1: Add matrix variable for MCP binary name**

In the `matrix.include` section (around line 16), add `mcp-bin` to each entry:

```yaml
        include:
          - os: macos-latest
            platform: mac
            solver-bin: escalaflow-solver
            mcp-bin: escalaflow-mcp
          - os: windows-latest
            platform: win
            solver-bin: escalaflow-solver.exe
            mcp-bin: escalaflow-mcp.exe
```

- [ ] **Step 2: Add Bun setup + MCP build steps**

After the "Verify solver binary" step (after line 52), add:

```yaml
      - name: Setup Bun
        uses: oven-sh/setup-bun@v2

      - name: Install MCP server dependencies
        run: cd mcp-server && bun install

      - name: Build MCP binary
        shell: bash
        run: bun build --compile mcp-server/index.ts --outfile mcp-bin/${{ matrix.mcp-bin }}

      - name: Verify MCP binary
        shell: bash
        run: |
          ls -la mcp-bin/
          file mcp-bin/${{ matrix.mcp-bin }} || true
```

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci(mcp): add Bun setup and MCP binary build to release workflow"
```

---

## Chunk 6: Smoke Test

### Task 9: Build and test MCP binary locally

- [ ] **Step 1: Install Bun (if not installed)**

Run: `brew install oven-sh/bun/bun` (or check `bun --version`)

- [ ] **Step 2: Build MCP binary**

Run: `npm run mcp:build`
Expected: Binary created at `mcp-bin/escalaflow-mcp`

- [ ] **Step 3: Check binary size**

Run: `ls -lh mcp-bin/escalaflow-mcp`
Expected: ~80-100MB

- [ ] **Step 4: Test binary with running app**

Ensure `npm run dev` is running (app open). Then:

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}' | ./mcp-bin/escalaflow-mcp 2>/dev/null | head -c 500
```

Expected: JSON response with `serverInfo.name: "escalaflow"` and capabilities.

- [ ] **Step 5: Test full MCP flow with Claude Code (if installed)**

Run: `claude mcp add escalaflow-test --transport stdio --scope local -- ./mcp-bin/escalaflow-mcp`

Open new Claude Code session and try: "Liste os setores do EscalaFlow"

Expected: Claude Code uses the MCP tools to query the running app.

Clean up: `claude mcp remove escalaflow-test --scope local`

- [ ] **Step 6: Run full typecheck**

Run: `npm run typecheck`
Expected: PASS
