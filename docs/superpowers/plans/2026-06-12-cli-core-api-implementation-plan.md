# CLI Core API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first slice of the official FlowKit/EscalaFlow CLI Core API: local HTTP contract, chat endpoint, CLI commands, MCP health resource, and EscalaFlow solver commands.

**Architecture:** Implement FlowKit first as the pilot because it already has `src/cli/index.ts`, `src/main/tool-server.ts`, and `src/mcp/*`. Keep the desktop app as the API owner: the CLI calls the running app on `127.0.0.1`, and the app reuses its existing DB, IA config, discovery, tools, RAG, and local LLM lifecycle. Port the same contract to EscalaFlow after FlowKit passes tests, then add EscalaFlow-only solver endpoints and commands.

**Tech Stack:** Electron main process, Node HTTP server, Commander CLI, Vitest, MCP SDK, PGlite, Vercel AI SDK, local `node-llama-cpp`, EscalaFlow OR-Tools bridge.

---

## Scope And Order

This plan implements the first spec only: `docs/superpowers/specs/2026-06-12-cli-core-api-design.md`.

Out of scope for this plan:

- Bulk RAG folder import jobs.
- Embedded terminal.
- `terminal.exec`.
- Remote API exposure.
- Persistent CLI chat conversations in the database.

The first chat endpoint uses a non-streaming response. Streaming can come later without changing the CLI command contract.

## Worktree Rule

Both current main worktrees are dirty. Do not implement in either main checkout.

Use two execution worktrees:

```bash
git -C /Users/marcoantonio/flowkit fetch --prune origin
git -C /Users/marcoantonio/flowkit worktree add ../flowkit-cli-core-api -b codex/cli-core-api origin/main

git -C /Users/marcoantonio/escalaflow fetch --prune origin
git -C /Users/marcoantonio/escalaflow worktree add ../escalaflow-cli-core-api -b codex/cli-core-api origin/main
```

If `origin/main` is not the correct branch in either repo at execution time, stop and inspect `git branch -vv` before creating the worktree.

## File Structure

### FlowKit

- Modify: `/Users/marcoantonio/flowkit-cli-core-api/src/main/tool-server.ts`
  - Keep `startToolServer()` and `stopToolServer()`.
  - Add `/chat`, `/jobs`, `/jobs/:id`, and `/jobs/:id/cancel`.
  - Expand `/health` with app name, DB status, IA config, and local model status.
  - Reject non-loopback `Host` headers.
- Create: `/Users/marcoantonio/flowkit-cli-core-api/src/main/jobs.ts`
  - Minimal in-memory job registry for Core API.
  - Bulk RAG will replace/add real jobs later.
- Modify: `/Users/marcoantonio/flowkit-cli-core-api/src/cli/index.ts`
  - Add `tool`, `chat`, `rag search`, `jobs`, and `mcp config`.
  - Preserve existing `search`, `import`, `status`, and `tools` as aliases where useful.
- Create: `/Users/marcoantonio/flowkit-cli-core-api/tests/main/tool-server-contract.spec.ts`
  - Tests route behavior through the real local HTTP server.
- Create: `/Users/marcoantonio/flowkit-cli-core-api/tests/cli/cli-format.spec.ts`
  - Tests JSON parsing and command output helpers if helpers are extracted.
- Modify: `/Users/marcoantonio/flowkit-cli-core-api/src/mcp/server.ts`
  - Add `app://health` resource.

### EscalaFlow

- Modify: `/Users/marcoantonio/escalaflow-cli-core-api/package.json`
  - Add `cli` script and `commander` dependency if missing.
- Modify: `/Users/marcoantonio/escalaflow-cli-core-api/package-lock.json`
  - Update after installing `commander`.
- Create: `/Users/marcoantonio/escalaflow-cli-core-api/src/cli/index.ts`
  - EscalaFlow CLI with common commands plus solver commands.
- Modify: `/Users/marcoantonio/escalaflow-cli-core-api/src/main/tool-server.ts`
  - Same Core API endpoints as FlowKit.
  - Add `/solver/preflight` and `/solver/generate`.
- Create: `/Users/marcoantonio/escalaflow-cli-core-api/src/main/jobs.ts`
  - Minimal in-memory job registry.
- Create: `/Users/marcoantonio/escalaflow-cli-core-api/src/main/motor/preflight-service.ts`
  - Move `buildEscalaPreflight()` out of `tipc.ts` so HTTP and IPC share one function.
- Modify: `/Users/marcoantonio/escalaflow-cli-core-api/src/main/tipc.ts`
  - Import `buildEscalaPreflight()` from the new service.
- Modify: `/Users/marcoantonio/escalaflow-cli-core-api/mcp-server/index.ts`
  - Add resource handling only if the current MCP SDK wrapper supports it cleanly; otherwise keep tool proxy and leave health exposed through `/health`.
- Create: `/Users/marcoantonio/escalaflow-cli-core-api/tests/main/tool-server-contract.spec.ts`
  - Tests common endpoints and EscalaFlow solver endpoints.

---

## Task 1: FlowKit Minimal Job Registry

**Files:**
- Create: `/Users/marcoantonio/flowkit-cli-core-api/src/main/jobs.ts`
- Test: `/Users/marcoantonio/flowkit-cli-core-api/tests/main/jobs.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/main/jobs.spec.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { cancelJob, createJob, getJob, listJobs, resetJobsForTests } from '../../src/main/jobs'

describe('jobs registry', () => {
  it('creates, lists, reads, and cancels jobs', () => {
    resetJobsForTests()

    const job = createJob({
      type: 'test',
      label: 'Contract test',
      metadata: { source: 'vitest' },
    })

    expect(job.id).toMatch(/^job_/)
    expect(job.status).toBe('pending')
    expect(listJobs()).toHaveLength(1)
    expect(getJob(job.id)?.label).toBe('Contract test')

    const cancelled = cancelJob(job.id)

    expect(cancelled.status).toBe('cancelled')
    expect(cancelled.finished_at).toEqual(expect.any(String))
  })

  it('throws a direct error for missing jobs', () => {
    resetJobsForTests()
    expect(() => cancelJob('job_missing')).toThrow('Job "job_missing" nao encontrado.')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd /Users/marcoantonio/flowkit-cli-core-api
npm run test -- tests/main/jobs.spec.ts
```

Expected: FAIL because `src/main/jobs.ts` does not exist.

- [ ] **Step 3: Implement the job registry**

Create `src/main/jobs.ts`:

```ts
export type JobStatus = 'pending' | 'running' | 'done' | 'failed' | 'cancelled'

export interface AppJob {
  id: string
  type: string
  label: string
  status: JobStatus
  progress: {
    total: number
    done: number
  }
  metadata: Record<string, unknown>
  error_message: string | null
  created_at: string
  updated_at: string
  finished_at: string | null
}

const jobs = new Map<string, AppJob>()

function nowIso(): string {
  return new Date().toISOString()
}

function nextJobId(): string {
  return `job_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

export function createJob(input: {
  type: string
  label: string
  metadata?: Record<string, unknown>
  total?: number
}): AppJob {
  const timestamp = nowIso()
  const job: AppJob = {
    id: nextJobId(),
    type: input.type,
    label: input.label,
    status: 'pending',
    progress: {
      total: input.total ?? 0,
      done: 0,
    },
    metadata: input.metadata ?? {},
    error_message: null,
    created_at: timestamp,
    updated_at: timestamp,
    finished_at: null,
  }
  jobs.set(job.id, job)
  return job
}

export function listJobs(): AppJob[] {
  return [...jobs.values()].sort((a, b) => b.created_at.localeCompare(a.created_at))
}

export function getJob(id: string): AppJob | null {
  return jobs.get(id) ?? null
}

export function cancelJob(id: string): AppJob {
  const job = jobs.get(id)
  if (!job) throw new Error(`Job "${id}" nao encontrado.`)
  const timestamp = nowIso()
  const next: AppJob = {
    ...job,
    status: 'cancelled',
    updated_at: timestamp,
    finished_at: timestamp,
  }
  jobs.set(id, next)
  return next
}

export function resetJobsForTests(): void {
  jobs.clear()
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
cd /Users/marcoantonio/flowkit-cli-core-api
npm run test -- tests/main/jobs.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/marcoantonio/flowkit-cli-core-api
git add src/main/jobs.ts tests/main/jobs.spec.ts
git commit -m "feat(cli): add local job registry"
```

---

## Task 2: FlowKit Core API Endpoints

**Files:**
- Modify: `/Users/marcoantonio/flowkit-cli-core-api/src/main/tool-server.ts`
- Test: `/Users/marcoantonio/flowkit-cli-core-api/tests/main/tool-server-contract.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/main/tool-server-contract.spec.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest'
import { startToolServer, stopToolServer } from '../../src/main/tool-server'

const BASE = 'http://127.0.0.1:17380'

async function waitForHealth(): Promise<void> {
  const started = Date.now()
  while (Date.now() - started < 3000) {
    try {
      const res = await fetch(`${BASE}/health`)
      if (res.ok) return
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
  }
  throw new Error('tool server did not start')
}

describe('tool server core contract', () => {
  afterEach(() => {
    stopToolServer()
  })

  it('returns expanded health', async () => {
    startToolServer()
    await waitForHealth()

    const res = await fetch(`${BASE}/health`)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.status).toBe('ok')
    expect(body.app).toBe('FlowKit')
    expect(body.tools).toEqual(expect.any(Number))
    expect(body.db.connected).toBe(true)
    expect(body.ia).toEqual(expect.objectContaining({
      provider: expect.anything(),
      modelo: expect.anything(),
    }))
  })

  it('rejects unknown tools with a direct message', async () => {
    startToolServer()
    await waitForHealth()

    const res = await fetch(`${BASE}/tool`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'nao_existe', args: {} }),
    })
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.status).toBe('error')
    expect(body.message).toBe(`Tool 'nao_existe' nao existe`)
  })

  it('lists and cancels jobs', async () => {
    startToolServer()
    await waitForHealth()

    const jobsRes = await fetch(`${BASE}/jobs`)
    const jobsBody = await jobsRes.json()

    expect(jobsRes.status).toBe(200)
    expect(jobsBody.jobs).toEqual([])

    const missingRes = await fetch(`${BASE}/jobs/job_missing/cancel`, { method: 'POST' })
    const missingBody = await missingRes.json()

    expect(missingRes.status).toBe(404)
    expect(missingBody.message).toBe('Job "job_missing" nao encontrado.')
  })

  it('rejects non-loopback Host headers', async () => {
    startToolServer()
    await waitForHealth()

    const res = await fetch(`${BASE}/health`, {
      headers: { Host: 'evil.example.com' },
    })
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body.message).toBe('Acesso permitido apenas via loopback local.')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd /Users/marcoantonio/flowkit-cli-core-api
npm run test -- tests/main/tool-server-contract.spec.ts
```

Expected: FAIL because `/health` lacks `app`, `db`, and `ia`, `/jobs` does not exist, and Host validation does not exist.

- [ ] **Step 3: Modify `src/main/tool-server.ts`**

Apply these changes:

```ts
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { executeTool, IA_TOOLS } from './ia/tools'
import { buildContextBriefing } from './ia/discovery'
import { queryOne } from './db/query'
import { cancelJob, getJob, listJobs } from './jobs'
import type { IaContexto } from '../shared/types'
```

Add helpers above `startToolServer()`:

```ts
function isLoopbackHost(req: IncomingMessage): boolean {
  const host = String(req.headers.host ?? '').toLowerCase()
  return host.startsWith('127.0.0.1:') || host.startsWith('localhost:') || host === '127.0.0.1' || host === 'localhost'
}

async function buildHealth() {
  let version = '?'
  try { version = require('electron').app.getVersion() } catch { /* dev/non-electron fallback */ }

  const ia = await queryOne<{ provider: string; modelo: string; ativo: boolean }>(
    'SELECT provider, modelo, ativo FROM configuracao_ia LIMIT 1',
  ).catch(() => null)

  let local_model: unknown = null
  try {
    const { getLocalStatus } = await import('./ia/local-llm')
    local_model = await getLocalStatus()
  } catch {
    local_model = null
  }

  return {
    status: 'ok',
    app: 'FlowKit',
    version,
    tools: IA_TOOLS.length,
    db: { connected: true },
    ia: {
      provider: ia?.provider ?? null,
      modelo: ia?.modelo ?? null,
      ativo: Boolean(ia?.ativo),
      local_model,
    },
  }
}

function parsePath(req: IncomingMessage): URL {
  return new URL(req.url ?? '/', `http://127.0.0.1:${TOOL_PORT}`)
}
```

Inside the request handler, before route checks, add:

```ts
if (!isLoopbackHost(req)) {
  return json(res, { status: 'error', message: 'Acesso permitido apenas via loopback local.' }, 403)
}

const url = parsePath(req)
```

Replace direct `req.url` comparisons with `url.pathname`. Add these routes:

```ts
if (req.method === 'GET' && url.pathname === '/health') {
  return json(res, await buildHealth())
}

if (req.method === 'GET' && url.pathname === '/jobs') {
  return json(res, { jobs: listJobs() })
}

if (req.method === 'GET' && url.pathname.startsWith('/jobs/')) {
  const id = decodeURIComponent(url.pathname.split('/')[2] ?? '')
  const job = getJob(id)
  if (!job) return json(res, { status: 'error', message: `Job "${id}" nao encontrado.` }, 404)
  return json(res, { job })
}

if (req.method === 'POST' && url.pathname.startsWith('/jobs/') && url.pathname.endsWith('/cancel')) {
  const id = decodeURIComponent(url.pathname.split('/')[2] ?? '')
  try {
    return json(res, { job: cancelJob(id) })
  } catch (err) {
    return json(res, { status: 'error', message: (err as Error).message }, 404)
  }
}
```

Leave existing `/tools`, `/tool`, `/discovery`, and `/instructions` behavior intact, but switch them to `url.pathname`.

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
cd /Users/marcoantonio/flowkit-cli-core-api
npm run test -- tests/main/tool-server-contract.spec.ts tests/main/jobs.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/marcoantonio/flowkit-cli-core-api
git add src/main/tool-server.ts src/main/jobs.ts tests/main/tool-server-contract.spec.ts tests/main/jobs.spec.ts
git commit -m "feat(cli): expose core tool server contract"
```

---

## Task 3: FlowKit `/chat` Endpoint

**Files:**
- Modify: `/Users/marcoantonio/flowkit-cli-core-api/src/main/tool-server.ts`
- Test: `/Users/marcoantonio/flowkit-cli-core-api/tests/main/tool-server-chat.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/main/tool-server-chat.spec.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { startToolServer, stopToolServer } from '../../src/main/tool-server'

vi.mock('../../src/main/ia/cliente', () => ({
  iaEnviarMensagem: vi.fn(async (message: string) => ({
    resposta: `eco: ${message}`,
    acoes: [],
  })),
}))

const BASE = 'http://127.0.0.1:17380'

async function waitForHealth(): Promise<void> {
  const started = Date.now()
  while (Date.now() - started < 3000) {
    try {
      const res = await fetch(`${BASE}/health`)
      if (res.ok) return
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
  }
  throw new Error('tool server did not start')
}

describe('tool server chat contract', () => {
  afterEach(() => {
    stopToolServer()
    vi.clearAllMocks()
  })

  it('runs a non-streaming chat turn through the app IA client', async () => {
    startToolServer()
    await waitForHealth()

    const res = await fetch(`${BASE}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'oi',
        history: [],
        context: { page: 'cli', route: '/cli' },
        stream: false,
      }),
    })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.response).toBe('eco: oi')
    expect(body.actions).toEqual([])
  })

  it('rejects empty chat messages', async () => {
    startToolServer()
    await waitForHealth()

    const res = await fetch(`${BASE}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: '   ' }),
    })
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.message).toBe('Campo "message" é obrigatório.')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd /Users/marcoantonio/flowkit-cli-core-api
npm run test -- tests/main/tool-server-chat.spec.ts
```

Expected: FAIL because `/chat` returns 404.

- [ ] **Step 3: Implement `/chat`**

In `src/main/tool-server.ts`, add this route before the final 404:

```ts
if (req.method === 'POST' && url.pathname === '/chat') {
  const body = JSON.parse(await readBody(req)) as {
    message?: string
    history?: import('../shared/types').IaMensagem[]
    context?: IaContexto
    conversation_id?: string
    stream?: boolean
  }

  const message = body.message?.trim()
  if (!message) {
    return json(res, { status: 'error', message: 'Campo "message" é obrigatório.' }, 400)
  }
  if (body.stream) {
    return json(res, { status: 'error', message: 'Streaming ainda não é suportado neste endpoint.' }, 400)
  }

  const { iaEnviarMensagem } = await import('./ia/cliente')
  const result = await iaEnviarMensagem(
    message,
    body.history ?? [],
    body.context ?? { pagina: 'cli', rota: '/cli' } as IaContexto,
    body.conversation_id,
  )

  return json(res, {
    status: 'ok',
    response: result.resposta,
    actions: result.acoes,
  })
}
```

- [ ] **Step 4: Run tests**

Run:

```bash
cd /Users/marcoantonio/flowkit-cli-core-api
npm run test -- tests/main/tool-server-chat.spec.ts tests/main/tool-server-contract.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/marcoantonio/flowkit-cli-core-api
git add src/main/tool-server.ts tests/main/tool-server-chat.spec.ts
git commit -m "feat(cli): add local chat endpoint"
```

---

## Task 4: FlowKit CLI Commands

**Files:**
- Modify: `/Users/marcoantonio/flowkit-cli-core-api/src/cli/index.ts`
- Test: `/Users/marcoantonio/flowkit-cli-core-api/tests/cli/cli-offline.spec.ts`

- [ ] **Step 1: Write the failing offline CLI test**

Create `tests/cli/cli-offline.spec.ts`:

```ts
import { execFile } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const root = path.resolve(__dirname, '../..')

async function runCli(args: string[]) {
  return execFileAsync('npx', ['tsx', 'src/cli/index.ts', ...args], {
    cwd: root,
    env: { ...process.env, FLOWKIT_TOOL_SERVER: 'http://127.0.0.1:9' },
  })
}

describe('flowkit cli offline behavior', () => {
  it('prints a useful message when the app is closed', async () => {
    await expect(runCli(['status'])).rejects.toMatchObject({
      stderr: expect.stringContaining('FlowKit nao esta rodando. Abra o app primeiro.'),
    })
  })

  it('rejects invalid JSON passed to tool', async () => {
    await expect(runCli(['tool', 'buscar_conhecimento', '--json', '{'])).rejects.toMatchObject({
      stderr: expect.stringContaining('JSON invalido em --json.'),
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd /Users/marcoantonio/flowkit-cli-core-api
npm run test -- tests/cli/cli-offline.spec.ts
```

Expected: FAIL because `FLOWKIT_TOOL_SERVER` is ignored and `tool` command does not exist.

- [ ] **Step 3: Update CLI config and helpers**

At the top of `src/cli/index.ts`, replace the hard-coded server constant:

```ts
const TOOL_SERVER = process.env.FLOWKIT_TOOL_SERVER || 'http://127.0.0.1:17380'
```

Add:

```ts
function parseJsonArg(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('JSON precisa ser um objeto.')
    }
    return parsed as Record<string, unknown>
  } catch (err) {
    console.error(`JSON invalido em --json. ${(err as Error).message}`)
    process.exit(1)
  }
}

async function postJson(pathname: string, body: Record<string, unknown>): Promise<unknown> {
  try {
    const res = await fetch(`${TOOL_SERVER}${pathname}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const text = await res.text()
      console.error(`Erro do servidor (${res.status}):`, text)
      process.exit(1)
    }
    return await res.json()
  } catch (err: unknown) {
    if (isConnectionRefused(err)) console.error(NOT_RUNNING_MSG)
    else console.error('Erro de conexao:', (err as Error).message)
    process.exit(1)
  }
}

function printJson(data: unknown): void {
  console.log(JSON.stringify(data, null, 2))
}
```

- [ ] **Step 4: Add `tool`, `chat`, `rag`, `jobs`, and `mcp` commands**

Add these command blocks before `program.parse()`:

```ts
program
  .command('tool')
  .description('Executa uma tool do app')
  .argument('<name>', 'Nome da tool')
  .option('--json <json>', 'Argumentos da tool em JSON')
  .action(async (name: string, options: { json?: string }) => {
    const args = parseJsonArg(options.json)
    const data = await callTool(name, args)
    printJson(data)
  })

program
  .command('chat')
  .description('Conversa com a IA do FlowKit pelo app aberto')
  .argument('[message]', 'Mensagem unica. Sem mensagem, abre REPL.')
  .option('--attach', 'Alias semantico para conectar ao app aberto')
  .action(async (message?: string) => {
    if (message && message.trim()) {
      const data = await postJson('/chat', {
        message,
        history: [],
        context: { page: 'cli', route: '/cli' },
        stream: false,
      }) as { response?: string }
      console.log(data.response ?? '')
      return
    }

    const readline = await import('node:readline/promises')
    const { stdin, stdout } = await import('node:process')
    const rl = readline.createInterface({ input: stdin, output: stdout })
    const history: Array<{ papel: 'usuario' | 'assistente'; conteudo: string; timestamp: string }> = []
    console.log('FlowKit chat conectado. Digite "sair" para encerrar.')

    while (true) {
      const input = await rl.question('Voce > ')
      const trimmed = input.trim()
      if (!trimmed) continue
      if (trimmed.toLowerCase() === 'sair' || trimmed.toLowerCase() === 'exit') break

      const data = await postJson('/chat', {
        message: trimmed,
        history,
        context: { page: 'cli', route: '/cli' },
        stream: false,
      }) as { response?: string }
      const response = data.response ?? ''
      console.log(`IA > ${response}`)
      history.push({ papel: 'usuario', conteudo: trimmed, timestamp: new Date().toISOString() })
      history.push({ papel: 'assistente', conteudo: response, timestamp: new Date().toISOString() })
    }

    rl.close()
  })

const rag = program.command('rag').description('Comandos de RAG')

rag
  .command('search')
  .description('Busca na base RAG')
  .argument('<query>', 'Consulta')
  .action(async (query: string) => {
    const data = await callTool('buscar_conhecimento', { consulta: query })
    formatSearchResults(data as ToolResponse, query)
  })

rag
  .command('import')
  .description('Importacao em lote sera implementada na spec Bulk RAG')
  .argument('<path>', 'Arquivo ou pasta')
  .option('--group <name>', 'Nome do grupo')
  .action(() => {
    console.error('Bulk RAG import ainda nao foi implementado. Use o comando import <file> para arquivo unico.')
    process.exit(1)
  })

const jobs = program.command('jobs').description('Jobs locais')

jobs.command('list').action(async () => {
  printJson(await fetchJson(`${TOOL_SERVER}/jobs`))
})

jobs.command('cancel').argument('<id>').action(async (id: string) => {
  printJson(await postJson(`/jobs/${encodeURIComponent(id)}/cancel`, {}))
})

program
  .command('mcp')
  .description('Utilitarios MCP')
  .command('config')
  .description('Imprime configuracao MCP local')
  .action(() => {
    printJson({
      mcpServers: {
        flowkit: {
          command: 'npm',
          args: ['run', 'mcp'],
          cwd: process.cwd(),
        },
      },
    })
  })
```

- [ ] **Step 5: Run CLI tests**

Run:

```bash
cd /Users/marcoantonio/flowkit-cli-core-api
npm run test -- tests/cli/cli-offline.spec.ts
```

Expected: PASS.

- [ ] **Step 6: Run typecheck**

Run:

```bash
cd /Users/marcoantonio/flowkit-cli-core-api
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
cd /Users/marcoantonio/flowkit-cli-core-api
git add src/cli/index.ts tests/cli/cli-offline.spec.ts
git commit -m "feat(cli): add chat tool jobs and mcp commands"
```

---

## Task 5: FlowKit MCP Health Resource

**Files:**
- Modify: `/Users/marcoantonio/flowkit-cli-core-api/src/mcp/server.ts`
- Test: `/Users/marcoantonio/flowkit-cli-core-api/tests/mcp/health-resource.spec.ts`

- [ ] **Step 1: Write the test**

Create `tests/mcp/health-resource.spec.ts`:

```ts
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('FlowKit MCP health resource', () => {
  it('registers app://health resource', () => {
    const source = readFileSync(path.resolve(__dirname, '../../src/mcp/server.ts'), 'utf-8')
    expect(source).toContain("server.resource('app-health', 'app://health'")
    expect(source).toContain("fetchJson(`${TOOL_SERVER}/health`)")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd /Users/marcoantonio/flowkit-cli-core-api
npm run test -- tests/mcp/health-resource.spec.ts
```

Expected: FAIL because the resource is not registered.

- [ ] **Step 3: Add `app://health`**

In `src/mcp/server.ts`, inside `createFlowKitMcpServer()` after existing resources, add:

```ts
  server.resource('app-health', 'app://health', async (uri) => {
    try {
      const data = await fetchJson(`${TOOL_SERVER}/health`)
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify(data, null, 2),
          },
        ],
      }
    } catch (err) {
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'text/plain',
            text: friendlyError(err),
          },
        ],
      }
    }
  })
```

- [ ] **Step 4: Run tests**

Run:

```bash
cd /Users/marcoantonio/flowkit-cli-core-api
npm run test -- tests/mcp/health-resource.spec.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/marcoantonio/flowkit-cli-core-api
git add src/mcp/server.ts tests/mcp/health-resource.spec.ts
git commit -m "feat(mcp): expose app health resource"
```

---

## Task 6: FlowKit Full Verification

**Files:**
- No new files.

- [ ] **Step 1: Run focused tests**

Run:

```bash
cd /Users/marcoantonio/flowkit-cli-core-api
npm run test -- tests/main/jobs.spec.ts tests/main/tool-server-contract.spec.ts tests/main/tool-server-chat.spec.ts tests/cli/cli-offline.spec.ts tests/mcp/health-resource.spec.ts
```

Expected: PASS.

- [ ] **Step 2: Run full typecheck**

Run:

```bash
cd /Users/marcoantonio/flowkit-cli-core-api
npm run typecheck
```

Expected: PASS.

- [ ] **Step 3: Run build**

Run:

```bash
cd /Users/marcoantonio/flowkit-cli-core-api
npm run build
```

Expected: PASS.

- [ ] **Step 4: Manual smoke with running app**

Start the app:

```bash
cd /Users/marcoantonio/flowkit-cli-core-api
npm run dev
```

In another terminal:

```bash
cd /Users/marcoantonio/flowkit-cli-core-api
npm run cli -- status
npm run cli -- tools
npm run cli -- tool status_sistema --json '{}'
npm run cli -- rag search "knowledge"
```

Expected:

- `status` prints app version and stats.
- `tools` lists tool names.
- `tool status_sistema` returns JSON.
- `rag search` returns no crash, either results or a direct "Nenhum resultado" message.

- [ ] **Step 5: Commit verification note if docs changed**

If no files changed during verification, do not commit. If a README note is added, commit it separately:

```bash
cd /Users/marcoantonio/flowkit-cli-core-api
git add README.md
git commit -m "docs(cli): document core api smoke commands"
```

---

## Task 7: EscalaFlow Preflight Service Extraction

**Files:**
- Create: `/Users/marcoantonio/escalaflow-cli-core-api/src/main/motor/preflight-service.ts`
- Modify: `/Users/marcoantonio/escalaflow-cli-core-api/src/main/tipc.ts`
- Test: `/Users/marcoantonio/escalaflow-cli-core-api/tests/main/preflight-service.spec.ts`

- [ ] **Step 1: Write a service existence test**

Create `tests/main/preflight-service.spec.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { buildEscalaPreflight } from '../../src/main/motor/preflight-service'

describe('preflight service', () => {
  it('exports the shared UI/CLI preflight function', () => {
    expect(typeof buildEscalaPreflight).toBe('function')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd /Users/marcoantonio/escalaflow-cli-core-api
npm run test -- tests/main/preflight-service.spec.ts
```

Expected: FAIL because `src/main/motor/preflight-service.ts` does not exist.

- [ ] **Step 3: Move preflight code**

Create `src/main/motor/preflight-service.ts` by moving the existing `buildEscalaPreflight()` function from `src/main/tipc.ts`. Include these imports:

```ts
import { queryOne } from '../db/query'
import { buildSolverInput } from './solver-bridge'
import { enrichPreflightWithCapacityChecks, normalizeRegimesOverride, type SimulacaoRegimeOverride } from '../preflight-capacity'
import type { EscalaPreflightResult } from '../../shared'

export async function buildEscalaPreflight(
  setorId: number,
  dataInicio: string,
  dataFim: string,
  regimesOverride?: SimulacaoRegimeOverride[],
): Promise<EscalaPreflightResult> {
  const blockers: EscalaPreflightResult['blockers'] = []
  const warnings: EscalaPreflightResult['warnings'] = []

  const setor = await queryOne<{ id: number; ativo: boolean }>('SELECT id, ativo FROM setores WHERE id = ?', setorId)
  if (!setor || !setor.ativo) {
    blockers.push({
      codigo: 'SETOR_INVALIDO',
      severidade: 'BLOCKER',
      mensagem: `Setor ${setorId} nao encontrado ou inativo.`,
    })
  }

  const colabsRow = await queryOne<{ count: number }>('SELECT COUNT(*)::int as count FROM colaboradores WHERE setor_id = ? AND ativo = TRUE', setorId)
  const colabsAtivos = colabsRow?.count ?? 0
  if (colabsAtivos === 0) {
    blockers.push({
      codigo: 'SEM_COLABORADORES',
      severidade: 'BLOCKER',
      mensagem: 'Setor nao tem colaboradores ativos.',
      detalhe: 'Cadastre ao menos 1 colaborador para gerar escala.',
    })
  }

  const demandasRow = await queryOne<{ count: number }>('SELECT COUNT(*)::int as count FROM demandas WHERE setor_id = ?', setorId)
  const demandasCount = demandasRow?.count ?? 0
  if (demandasCount === 0) {
    warnings.push({
      codigo: 'SEM_DEMANDA',
      severidade: 'WARNING',
      mensagem: 'Setor sem demanda planejada cadastrada.',
      detalhe: 'Sem demanda cadastrada, o sistema não terá meta de cobertura para o período.',
    })
  }

  const feriadosRow = await queryOne<{ count: number }>('SELECT COUNT(*)::int as count FROM feriados WHERE data BETWEEN ? AND ?', dataInicio, dataFim)
  const feriadosNoPeriodo = feriadosRow?.count ?? 0

  if (blockers.length === 0) {
    try {
      const input = await buildSolverInput(setorId, dataInicio, dataFim, undefined, {
        regimesOverride: normalizeRegimesOverride(regimesOverride),
      })
      enrichPreflightWithCapacityChecks(input, blockers, warnings)
    } catch (err) {
      warnings.push({
        codigo: 'PREFLIGHT_DIAGNOSTICO_INDISPONIVEL',
        severidade: 'WARNING',
        mensagem: 'Nao foi possivel rodar a verificação detalhada de capacidade.',
        detalhe: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return {
    ok: blockers.length === 0,
    blockers,
    warnings,
    summary: {
      setor_id: setorId,
      data_inicio: dataInicio,
      data_fim: dataFim,
      colaboradores_ativos: colabsAtivos,
      demandas_cadastradas: demandasCount,
      feriados_no_periodo: feriadosNoPeriodo,
      demanda_zero_fallback: demandasCount === 0,
    },
  }
}
```

In `src/main/tipc.ts`, remove the local `buildEscalaPreflight()` function and import it:

```ts
import { buildEscalaPreflight } from './motor/preflight-service'
```

Keep all call sites unchanged.

- [ ] **Step 4: Run focused tests**

Run:

```bash
cd /Users/marcoantonio/escalaflow-cli-core-api
npm run test -- tests/main/preflight-service.spec.ts tests/ia/tools/preflight.spec.ts
npm run typecheck:node
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/marcoantonio/escalaflow-cli-core-api
git add src/main/motor/preflight-service.ts src/main/tipc.ts tests/main/preflight-service.spec.ts
git commit -m "refactor(preflight): share escala preflight service"
```

---

## Task 8: EscalaFlow Core API And Solver Endpoints

**Files:**
- Create: `/Users/marcoantonio/escalaflow-cli-core-api/src/main/jobs.ts`
- Modify: `/Users/marcoantonio/escalaflow-cli-core-api/src/main/tool-server.ts`
- Test: `/Users/marcoantonio/escalaflow-cli-core-api/tests/main/tool-server-contract.spec.ts`

- [ ] **Step 1: Copy the FlowKit job registry**

Create `src/main/jobs.ts` in EscalaFlow with the same code from FlowKit Task 1.

- [ ] **Step 2: Write the EscalaFlow tool server test**

Create `tests/main/tool-server-contract.spec.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { startToolServer, stopToolServer } from '../../src/main/tool-server'

vi.mock('../../src/main/ia/cliente', () => ({
  iaEnviarMensagem: vi.fn(async (message: string) => ({
    resposta: `eco: ${message}`,
    acoes: [],
  })),
}))

vi.mock('../../src/main/motor/preflight-service', () => ({
  buildEscalaPreflight: vi.fn(async () => ({
    ok: true,
    blockers: [],
    warnings: [],
    summary: {
      setor_id: 2,
      data_inicio: '2026-07-01',
      data_fim: '2026-07-31',
      colaboradores_ativos: 4,
      demandas_cadastradas: 7,
      feriados_no_periodo: 0,
      demanda_zero_fallback: false,
    },
  })),
}))

vi.mock('../../src/main/motor/solver-bridge', () => ({
  buildSolverInput: vi.fn(async () => ({ colaboradores: [], demanda: [] })),
  runSolver: vi.fn(async () => ({
    status: 'OPTIMAL',
    indicadores: { cobertura_percentual: 100 },
    diagnostico: { mocked: true },
    alocacoes: [],
    decisoes: [],
    comparacao_demanda: [],
  })),
}))

const BASE = 'http://127.0.0.1:17380'

async function waitForHealth(): Promise<void> {
  const started = Date.now()
  while (Date.now() - started < 3000) {
    try {
      const res = await fetch(`${BASE}/health`)
      if (res.ok) return
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
  }
  throw new Error('tool server did not start')
}

describe('EscalaFlow tool server contract', () => {
  afterEach(() => {
    stopToolServer()
    vi.clearAllMocks()
  })

  it('returns expanded health', async () => {
    startToolServer()
    await waitForHealth()

    const res = await fetch(`${BASE}/health`)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.app).toBe('EscalaFlow')
    expect(body.db.connected).toBe(true)
    expect(body.tools).toEqual(expect.any(Number))
  })

  it('runs chat endpoint', async () => {
    startToolServer()
    await waitForHealth()

    const res = await fetch(`${BASE}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'oi', stream: false }),
    })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.response).toBe('eco: oi')
  })

  it('runs solver preflight endpoint', async () => {
    startToolServer()
    await waitForHealth()

    const res = await fetch(`${BASE}/solver/preflight`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ setor_id: 2, data_inicio: '2026-07-01', data_fim: '2026-07-31' }),
    })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.preflight.ok).toBe(true)
  })

  it('runs solver generate endpoint in summary mode', async () => {
    startToolServer()
    await waitForHealth()

    const res = await fetch(`${BASE}/solver/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ setor_id: 2, data_inicio: '2026-07-01', data_fim: '2026-07-31', summary: true }),
    })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.result.status).toBe('OPTIMAL')
    expect(body.result.indicadores.cobertura_percentual).toBe(100)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run:

```bash
cd /Users/marcoantonio/escalaflow-cli-core-api
npm run test -- tests/main/tool-server-contract.spec.ts
```

Expected: FAIL because endpoints are missing.

- [ ] **Step 4: Update EscalaFlow `src/main/tool-server.ts`**

Apply the same common changes from FlowKit Tasks 2 and 3, with these EscalaFlow-specific differences:

```ts
return {
  status: 'ok',
  app: 'EscalaFlow',
  version,
  tools: IA_TOOLS.length,
  db: { connected: true },
  ia: {
    provider: ia?.provider ?? null,
    modelo: ia?.modelo ?? null,
    ativo: Boolean(ia?.ativo),
    local_model,
  },
}
```

For `/discovery`, preserve the existing setor-aware query parsing:

```ts
const setorParam = url.searchParams.get('setor')
const syntheticCtx: IaContexto = {
  rota: '/mcp',
  pagina: 'externo',
  setor_id: setorParam ? parseInt(setorParam, 10) || undefined : undefined,
  colaborador_id: undefined,
}
```

Add `/solver/preflight`:

```ts
if (req.method === 'POST' && url.pathname === '/solver/preflight') {
  const body = JSON.parse(await readBody(req)) as {
    setor_id?: number
    data_inicio?: string
    data_fim?: string
    regimes_override?: Array<{ colaborador_id: number; regime_escala: string }>
  }
  if (!body.setor_id || !body.data_inicio || !body.data_fim) {
    return json(res, { status: 'error', message: 'Campos setor_id, data_inicio e data_fim são obrigatórios.' }, 400)
  }
  const { buildEscalaPreflight } = await import('./motor/preflight-service')
  const preflight = await buildEscalaPreflight(body.setor_id, body.data_inicio, body.data_fim, body.regimes_override as any)
  return json(res, { status: 'ok', preflight })
}
```

Add `/solver/generate`:

```ts
if (req.method === 'POST' && url.pathname === '/solver/generate') {
  const body = JSON.parse(await readBody(req)) as {
    setor_id?: number
    data_inicio?: string
    data_fim?: string
    summary?: boolean
    max_time_ms?: number
  }
  if (!body.setor_id || !body.data_inicio || !body.data_fim) {
    return json(res, { status: 'error', message: 'Campos setor_id, data_inicio e data_fim são obrigatórios.' }, 400)
  }

  const { buildSolverInput, runSolver } = await import('./motor/solver-bridge')
  const input = await buildSolverInput(body.setor_id, body.data_inicio, body.data_fim, undefined, {
    solveMode: 'rapido',
    nivelRigor: 'ALTO',
  })
  const solverResult = await runSolver(input, body.max_time_ms)

  const result = body.summary
    ? {
        status: solverResult.status,
        indicadores: solverResult.indicadores,
        diagnostico: solverResult.diagnostico,
      }
    : solverResult

  return json(res, { status: 'ok', result })
}
```

- [ ] **Step 5: Run tests**

Run:

```bash
cd /Users/marcoantonio/escalaflow-cli-core-api
npm run test -- tests/main/tool-server-contract.spec.ts tests/main/preflight-service.spec.ts
npm run typecheck:node
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd /Users/marcoantonio/escalaflow-cli-core-api
git add src/main/jobs.ts src/main/tool-server.ts tests/main/tool-server-contract.spec.ts
git commit -m "feat(cli): expose core api and solver endpoints"
```

---

## Task 9: EscalaFlow CLI

**Files:**
- Modify: `/Users/marcoantonio/escalaflow-cli-core-api/package.json`
- Modify: `/Users/marcoantonio/escalaflow-cli-core-api/package-lock.json`
- Create: `/Users/marcoantonio/escalaflow-cli-core-api/src/cli/index.ts`
- Test: `/Users/marcoantonio/escalaflow-cli-core-api/tests/cli/cli-offline.spec.ts`

- [ ] **Step 1: Add Commander**

Run:

```bash
cd /Users/marcoantonio/escalaflow-cli-core-api
npm install commander@^14.0.3
```

Add script to `package.json`:

```json
"cli": "npx tsx src/cli/index.ts"
```

- [ ] **Step 2: Write offline CLI test**

Create `tests/cli/cli-offline.spec.ts`:

```ts
import { execFile } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const root = path.resolve(__dirname, '../..')

async function runCli(args: string[]) {
  return execFileAsync('npx', ['tsx', 'src/cli/index.ts', ...args], {
    cwd: root,
    env: { ...process.env, ESCALAFLOW_TOOL_SERVER: 'http://127.0.0.1:9' },
  })
}

describe('escalaflow cli offline behavior', () => {
  it('prints a useful message when the app is closed', async () => {
    await expect(runCli(['status'])).rejects.toMatchObject({
      stderr: expect.stringContaining('EscalaFlow nao esta rodando. Abra o app primeiro.'),
    })
  })

  it('rejects invalid JSON passed to tool', async () => {
    await expect(runCli(['tool', 'gerar_escala', '--json', '{'])).rejects.toMatchObject({
      stderr: expect.stringContaining('JSON invalido em --json.'),
    })
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run:

```bash
cd /Users/marcoantonio/escalaflow-cli-core-api
npm run test -- tests/cli/cli-offline.spec.ts
```

Expected: FAIL because `src/cli/index.ts` does not exist.

- [ ] **Step 4: Create EscalaFlow CLI**

Create `src/cli/index.ts` using the FlowKit CLI from Task 4, with these EscalaFlow values:

```ts
#!/usr/bin/env node
import { Command } from 'commander'

const TOOL_SERVER = process.env.ESCALAFLOW_TOOL_SERVER || 'http://127.0.0.1:17380'
const NOT_RUNNING_MSG = 'EscalaFlow nao esta rodando. Abra o app primeiro.'
```

Use the same helper functions:

- `isConnectionRefused`
- `fetchJson`
- `postJson`
- `callTool`
- `parseJsonArg`
- `printJson`

Use common commands:

- `status`
- `tools`
- `tool <name> --json`
- `chat [message] --attach`
- `jobs list`
- `jobs cancel <id>`
- `mcp config`

Add solver commands:

```ts
const solver = program.command('solver').description('Comandos do motor de escalas')

solver
  .command('list-setores')
  .description('Lista setores via tool consultar')
  .action(async () => {
    printJson(await callTool('consultar', { entidade: 'setor', limite: 100 }))
  })

solver
  .command('preflight')
  .requiredOption('--setor <id>', 'ID do setor')
  .requiredOption('--inicio <date>', 'Data inicial YYYY-MM-DD')
  .requiredOption('--fim <date>', 'Data final YYYY-MM-DD')
  .action(async (options: { setor: string; inicio: string; fim: string }) => {
    printJson(await postJson('/solver/preflight', {
      setor_id: Number(options.setor),
      data_inicio: options.inicio,
      data_fim: options.fim,
    }))
  })

solver
  .command('generate')
  .requiredOption('--setor <id>', 'ID do setor')
  .requiredOption('--inicio <date>', 'Data inicial YYYY-MM-DD')
  .requiredOption('--fim <date>', 'Data final YYYY-MM-DD')
  .option('--full', 'Retorna output completo do solver')
  .action(async (options: { setor: string; inicio: string; fim: string; full?: boolean }) => {
    printJson(await postJson('/solver/generate', {
      setor_id: Number(options.setor),
      data_inicio: options.inicio,
      data_fim: options.fim,
      summary: !options.full,
    }))
  })
```

- [ ] **Step 5: Run CLI tests and typecheck**

Run:

```bash
cd /Users/marcoantonio/escalaflow-cli-core-api
npm run test -- tests/cli/cli-offline.spec.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd /Users/marcoantonio/escalaflow-cli-core-api
git add package.json package-lock.json src/cli/index.ts tests/cli/cli-offline.spec.ts
git commit -m "feat(cli): add escalaflow command line interface"
```

---

## Task 10: EscalaFlow MCP And Verification

**Files:**
- Modify: `/Users/marcoantonio/escalaflow-cli-core-api/mcp-server/index.ts`
- Test: `/Users/marcoantonio/escalaflow-cli-core-api/tests/mcp/mcp-contract.spec.ts`

- [ ] **Step 1: Write MCP contract smoke test**

Create `tests/mcp/mcp-contract.spec.ts`:

```ts
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('EscalaFlow MCP contract', () => {
  it('keeps MCP as a proxy to the local tool server', () => {
    const source = readFileSync(path.resolve(__dirname, '../../mcp-server/index.ts'), 'utf-8')
    expect(source).toContain("const TOOL_URL = process.env.ESCALAFLOW_URL || 'http://127.0.0.1:17380'")
    expect(source).toContain("fetch(`${TOOL_URL}/tools`)")
    expect(source).toContain("fetch(`${TOOL_URL}/tool`")
  })
})
```

- [ ] **Step 2: Run MCP test**

Run:

```bash
cd /Users/marcoantonio/escalaflow-cli-core-api
npm run test -- tests/mcp/mcp-contract.spec.ts
```

Expected: PASS unless the current MCP file changed unexpectedly.

- [ ] **Step 3: Add `/health` note to MCP startup**

In `mcp-server/index.ts`, the existing health check already calls `/health`. After Core API expansion, update the log line to include app name if present:

```ts
const info = await health.json() as { status: string; tools: number; version?: string; app?: string }
console.error(`[escalaflow-mcp] Conectado ao ${info.app ?? 'EscalaFlow'} (${info.tools} tools, v${info.version ?? '?'})`)
```

- [ ] **Step 4: Run full EscalaFlow verification**

Run:

```bash
cd /Users/marcoantonio/escalaflow-cli-core-api
npm run test -- tests/main/preflight-service.spec.ts tests/main/tool-server-contract.spec.ts tests/cli/cli-offline.spec.ts tests/mcp/mcp-contract.spec.ts
npm run typecheck
npm run build
```

Expected: PASS.

- [ ] **Step 5: Manual smoke with running app**

Start the app:

```bash
cd /Users/marcoantonio/escalaflow-cli-core-api
npm run dev
```

In another terminal:

```bash
cd /Users/marcoantonio/escalaflow-cli-core-api
npm run cli -- status
npm run cli -- tools
npm run cli -- tool listar_conhecimento --json '{}'
npm run cli -- solver preflight --setor 2 --inicio 2026-07-01 --fim 2026-07-31
npm run cli -- solver generate --setor 2 --inicio 2026-07-01 --fim 2026-07-07
```

Expected:

- `status` prints EscalaFlow health.
- `tools` lists IA tools.
- `listar_conhecimento` returns JSON.
- `solver preflight` returns `preflight.ok`.
- `solver generate` returns solver summary with `status`, `indicadores`, and `diagnostico`.

- [ ] **Step 6: Commit**

```bash
cd /Users/marcoantonio/escalaflow-cli-core-api
git add mcp-server/index.ts tests/mcp/mcp-contract.spec.ts
git commit -m "feat(mcp): align escalaflow mcp with core api"
```

---

## Task 11: Final Cross-Repo Review

**Files:**
- Modify only if review finds a real defect.

- [ ] **Step 1: Compare command parity**

Run:

```bash
cd /Users/marcoantonio/flowkit-cli-core-api
npm run cli -- --help
npm run cli -- rag --help
npm run cli -- jobs --help

cd /Users/marcoantonio/escalaflow-cli-core-api
npm run cli -- --help
npm run cli -- solver --help
npm run cli -- jobs --help
```

Expected:

- Both CLIs expose `status`, `tools`, `tool`, `chat`, `jobs`, and `mcp config`.
- FlowKit exposes `rag`.
- EscalaFlow exposes `solver`.

- [ ] **Step 2: Run final automated checks**

Run:

```bash
cd /Users/marcoantonio/flowkit-cli-core-api
npm run test -- tests/main/jobs.spec.ts tests/main/tool-server-contract.spec.ts tests/main/tool-server-chat.spec.ts tests/cli/cli-offline.spec.ts tests/mcp/health-resource.spec.ts
npm run typecheck
npm run build

cd /Users/marcoantonio/escalaflow-cli-core-api
npm run test -- tests/main/preflight-service.spec.ts tests/main/tool-server-contract.spec.ts tests/cli/cli-offline.spec.ts tests/mcp/mcp-contract.spec.ts
npm run typecheck
npm run build
```

Expected: all commands pass.

- [ ] **Step 3: Record implementation notes**

If implementation differs from this plan, add a short note to each repo:

```bash
docs/cli-core-api.md
```

The note must include:

- Commands added.
- Endpoints added.
- Known limits: non-streaming chat, no Bulk RAG job implementation, no terminal execution.
- Manual smoke commands.

- [ ] **Step 4: Commit notes if created**

```bash
cd /Users/marcoantonio/flowkit-cli-core-api
git add docs/cli-core-api.md
git commit -m "docs(cli): document core api"

cd /Users/marcoantonio/escalaflow-cli-core-api
git add docs/cli-core-api.md
git commit -m "docs(cli): document core api"
```

Only run these commits if the docs files were created.

---

## Self-Review

Spec coverage:

- Local API contract: Tasks 2, 3, and 8.
- CLI commands: Tasks 4 and 9.
- MCP health/resource alignment: Tasks 5 and 10.
- FlowKit pilot: Tasks 1 through 6.
- EscalaFlow port: Tasks 7 through 10.
- Solver endpoints: Tasks 7, 8, and 9.
- Testing contract: Tasks 1 through 11.
- No terminal execution: explicitly excluded in scope and non-goals.

Placeholder scan:

- No unresolved markers.
- No deferred implementation labels.
- No vague filler language.
- Bulk RAG and terminal execution are named as separate specs, not unresolved work.

Type consistency:

- Job ids are strings.
- Chat request uses `message`, `history`, `context`, `conversation_id`, and `stream`.
- Chat response uses `response` and `actions`.
- EscalaFlow solver requests use `setor_id`, `data_inicio`, `data_fim`, and `summary`.
- CLI environment variables are `FLOWKIT_TOOL_SERVER` and `ESCALAFLOW_TOOL_SERVER`.

Risk notes:

- Port `17380` is fixed today. Tests call `stopToolServer()` after each run; if another app instance is open during tests, tests may fail with `EADDRINUSE`. Close running FlowKit/EscalaFlow apps before focused tool-server tests.
- The non-streaming `/chat` endpoint can take as long as the active provider/model takes. CLI users should see direct provider errors.
- EscalaFlow `solver generate` can run longer than ordinary HTTP calls. The first slice supports summary output but does not add a progress stream.
