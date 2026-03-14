# EscalaFlow MCP Server — Design Spec

> Claude Code opera o EscalaFlow via MCP, usando as mesmas tools que a IA interna do app.
> App Electron aberto = banco protegido. Claude Code = poder extra (arquivos, HTMLs, terminal).

---

## Contexto

O EscalaFlow tem uma IA interna (Gemini/OpenRouter) com 35 tools que operam o sistema:
consultar dados, gerar escalas, ajustar alocacoes, diagnosticar violacoes, etc.

Essas tools sao funcoes TypeScript puras que chamam o banco PGlite. Nao dependem do Electron.
O `executeTool(name, args)` em `tools.ts:1033` ja faz validacao Zod, routing e retorno JSON padronizado.

**Problema:** O Claude Code (CLI) nao tem acesso a essas tools. O usuario precisa abrir o app
Electron pra qualquer operacao. O Claude Code e mais flexivel (le arquivos, cria HTMLs, roda
scripts), mas nao "fala" com o EscalaFlow.

**Solucao:** MCP Server que expoe todas as tools do EscalaFlow pro Claude Code, via HTTP bridge
com o Electron rodando.

---

## Decisoes de design

### D1: Por que HTTP bridge e nao PGlite direto?

PGlite e single-process — dois processos abrindo o mesmo `dataDir` corrompe o banco.
O Electron e o dono unico do PGlite. O MCP server se comunica via HTTP localhost, nunca
toca no banco diretamente.

**Beneficios:**
- Zero risco de corrupcao (Electron e dono unico do PGlite)
- Sandbox de seguranca (Claude so pode o que as tools permitem — sem SQL raw, sem DROP TABLE)
- Usuario ve resultado no app em tempo real (app ta aberto)
- Fonte de verdade unica (`tools.ts` serve app E MCP)

### D2: Por que todas as tools e nao um subset?

LLMs sao melhores quando veem o mapa completo. Esconder tools impede sugestoes uteis.
Separar em tiers cria risco de divergencia. Uma fonte, dois consumers.

### D3: Por que o MCP server e um proxy e nao tem logica?

Zero-logic no MCP server = zero duplicacao. Toda logica de negocio vive no Electron
(validacao Zod, enrichment, persistencia). O MCP server so traduz protocol MCP <-> HTTP.
Adicionar tool no app = aparece no MCP automaticamente (via GET /tools).

### D4: App precisa estar aberto

Nao e limitacao — e feature. Garante banco protegido, usuario ve resultado no app,
e o fluxo de seguranca do Electron (validacoes, FK checks, etc.) esta ativo.

---

## Arquitetura

```
Claude Code
  |
  | MCP protocol (stdio)
  v
escalaflow-mcp (Node.js, spawned pelo Claude Code)
  |  - Boot: GET /health → checa se Electron ta vivo
  |  - Boot: GET /tools → registra tools dinamicamente
  |  - Runtime: POST /tool → proxy puro, zero state
  |
  | HTTP localhost:17380
  v
Electron App (main process)
  |  - HTTP server minimo (node:http, 3 rotas, zero deps)
  |  - executeTool(name, args) → mesma funcao que a IA interna usa
  |
  v
PGlite (dono unico, seguro)
```

---

## Componente 1: HTTP Server no Electron

**Arquivo:** `src/main/tool-server.ts` (~40 linhas)

**Responsabilidade:** Receber POST com `{name, args}`, chamar `executeTool()`, retornar JSON.

**3 rotas:**

| Rota | Metodo | Uso |
|------|--------|-----|
| `/health` | GET | MCP server checa se Electron ta vivo |
| `/tool` | POST | Executa tool: `{name, args}` → resultado JSON |
| `/tools` | GET | Lista tools com name + description + parameters (JSON Schema) |

**Seguranca:**
- Bind em `127.0.0.1` only — nao aceita conexao externa
- Porta fixa `17380`
- Sem autenticacao (localhost, single user, app desktop offline)

**Integracao com index.ts:**
- `startToolServer()` chamado depois de `initDb()` + `createTables()`
- Nao bloqueia startup do app — server levanta em background

**Dependencia:** Nenhuma. Usa `node:http` nativo (3 rotas nao justificam Express).

### Codigo de referencia

```typescript
// src/main/tool-server.ts
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
        return json(res, { status: 'ok', version: process.env.npm_package_version, tools: IA_TOOLS.length })
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

---

## Componente 2: MCP Server (stdio)

**Pasta:** `mcp-server/` (fora de `src/` — nao compilado pelo electron-vite)

**Responsabilidade:** Traduzir protocol MCP <-> HTTP. Proxy puro, zero logica de negocio.

**Arquivos:**

```
mcp-server/
  ├── index.ts          ← MCP server (~80 linhas)
  ├── package.json      ← dep: @modelcontextprotocol/sdk
  └── tsconfig.json     ← Node ESM standalone
```

**Fluxo de boot:**

```
1. fetch GET /health → se falha: "Abra o EscalaFlow primeiro"
2. fetch GET /tools → recebe [{name, description, parameters}]
3. Registra handler tools/list → retorna tools com inputSchema (JSON Schema raw)
4. Registra handler tools/call → POST /tool {name, args} → retorna resultado
5. Conecta via StdioServerTransport
```

**Registro dinamico:** O MCP server NAO hardcoda tools. Ele le do Electron via GET /tools.
Adicionar uma tool no app = ela aparece automaticamente no Claude Code (restart do MCP).

**Por que `Server` low-level e nao `McpServer`:**
O `McpServer.tool()` espera schemas Zod como `inputSchema`. Nossas tools ja exportam
JSON Schema pre-convertido (via `toJsonSchema()` em tools.ts:33). O `Server` low-level
aceita JSON Schema raw nos handlers `tools/list` e `tools/call` — perfeito pra um proxy
que recebe schemas prontos via HTTP. Menos codigo, zero dependencia de Zod no MCP server.

### Codigo de referencia

```typescript
// mcp-server/index.ts
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'

const TOOL_URL = process.env.ESCALAFLOW_URL || 'http://127.0.0.1:17380'
const TOOL_TIMEOUT = 300_000  // 5min — solver Python pode demorar em periodos longos

// ==================== BOOT ====================

// Health check
try {
  const health = await fetch(`${TOOL_URL}/health`, { signal: AbortSignal.timeout(5000) })
  if (!health.ok) throw new Error(`HTTP ${health.status}`)
} catch {
  console.error('EscalaFlow nao esta aberto. Abra o app e reinicie o MCP server.')
  process.exit(1)
}

// Busca tools do Electron (JSON Schema raw — ja convertido de Zod no app)
const toolsRes = await fetch(`${TOOL_URL}/tools`)
const tools = await toolsRes.json() as Array<{
  name: string
  description: string
  parameters: Record<string, unknown>  // JSON Schema object
}>

// ==================== MCP SERVER ====================

const server = new Server(
  { name: 'escalaflow', version: '1.0.0' },
  { capabilities: { tools: {} } },
)

// tools/list — retorna catalogo de tools com inputSchema (JSON Schema)
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: tools.map(t => ({
    name: t.name,
    description: t.description,
    inputSchema: t.parameters as any,  // JSON Schema raw — MCP protocol aceita
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
    const result = await res.json()
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    }
  } catch (err) {
    return {
      content: [{ type: 'text', text: `Erro ao chamar tool '${name}': ${err}` }],
      isError: true,
    }
  }
})

// ==================== CONNECT ====================

const transport = new StdioServerTransport()
await server.connect(transport)
```

---

## Componente 3: Conhecimento de Dominio

O Claude precisa saber CLT, CCT, entidades e workflows pra usar as tools com contexto.

**3 camadas:**

| Camada | Fonte | Cobertura |
|--------|-------|-----------|
| Tool descriptions | `IA_TOOLS[].description` (ja existe) | ~70% — cada tool explica o que faz |
| MCP instructions | Extraido de `system-prompt.ts` | ~25% — CLT/CCT, motor, entidades, workflows |
| Discovery tool | `obter_alertas` (ja existe) | ~5% — contexto dinamico (alertas, feriados) |

**MCP instructions — o que entra:**

| Secao do system-prompt.ts | Entra? | Razao |
|---------------------------|--------|-------|
| Identidade ("gestora de RH") | Nao | Claude Code tem propria identidade |
| CLT/CCT (contratos, regras) | Sim | Conhecimento de dominio essencial |
| Motor (passes, flags, solve modes) | Sim | Precisa pra gerar_escala/diagnosticar |
| Entidades (schema, relacoes) | Sim | Precisa pra consultar/criar/atualizar |
| Tool patterns (3-status, enrichment) | Sim | Precisa pra interpretar respostas |
| Workflows (gerar→diagnosticar→ajustar) | Sim | Sequencia correta de operacoes |
| Conduta ("nao peca ID ao usuario") | Parcial | Adaptar pro contexto CLI |

**Fonte de verdade unica:** `buildMcpInstructions()` em `system-prompt.ts` extrai as secoes
relevantes do `SYSTEM_PROMPT` existente. Atualizar o prompt do app = atualiza o MCP.

---

## Estrutura de arquivos

```
escalaflow/
├── mcp-server/                    ← NOVO
│   ├── index.ts                   ← MCP server stdio (~80 linhas)
│   ├── package.json               ← dep: @modelcontextprotocol/sdk
│   └── tsconfig.json              ← Node ESM standalone
│
├── src/main/
│   ├── tool-server.ts             ← NOVO (~40 linhas)
│   ├── ia/
│   │   ├── tools.ts               ← SEM MUDANCAS
│   │   └── system-prompt.ts       ← EDITAR: +buildMcpInstructions()
│   └── index.ts                   ← EDITAR: +startToolServer()
│
├── .mcp.json                      ← NOVO (config MCP pro Claude Code)
└── package.json                   ← EDITAR: +2 scripts mcp (zero deps novas)
```

**Impacto no existente:**

| Arquivo | Mudanca | Linhas |
|---------|---------|--------|
| `tools.ts` | Nenhuma | 0 |
| `tipc.ts` | Nenhuma | 0 |
| `pglite.ts` | Nenhuma | 0 |
| `system-prompt.ts` | +1 funcao exportada | ~20 |
| `index.ts` | +2 imports, +startToolServer(), +stopToolServer() on quit | 5 |
| `package.json` | +2 scripts (mcp:dev, mcp:install) | 2 |

**Config MCP (`.mcp.json`):**

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

---

## Error handling

| Cenario | Tratamento |
|---------|-----------|
| App fechado | MCP server: health check falha no boot → "Abra o EscalaFlow primeiro" |
| App fecha no meio | POST falha → "Conexao com EscalaFlow perdida. O app foi fechado?" |
| Tool args invalidos | `executeTool` ja trata (Zod safeParse + campo `correction`) |
| Solver lento (30s+) | Timeout 300s (5min) no POST — cobre periodos longos e modo otimizado |
| Porta 17380 em uso | Electron loga warning via `server.on('error')`, nao levanta server |
| 2 sessoes Claude Code | Requests async interleavam em `await` boundaries — na pratica inofensivo pra reads. Para `gerar_escala`, risco baixo (usuario teria que disparar 2 ao mesmo tempo) |
| App quit | `stopToolServer()` chamado no evento `before-quit` — shutdown graceful |

---

## Dependencias novas

| Pacote | Onde | Tamanho | Proposito |
|--------|------|---------|-----------|
| Nenhum | Electron (package.json raiz) | 0 | HTTP server usa `node:http` nativo |
| `@modelcontextprotocol/sdk` | mcp-server/package.json | ~50KB | Protocol MCP (stdio) |

**Total: 1 pacote novo, ~50KB. Zero deps novas no Electron.**

---

## O que o Claude Code ganha vs IA do app

| Capacidade | IA do App | Claude Code + MCP |
|-----------|-----------|-------------------|
| Todas as tools EscalaFlow | Sim | Sim (mesmas) |
| Criar arquivos no Mac | Nao | Sim |
| Ler planilhas/CSVs | Nao | Sim |
| Gerar HTML bonito | Nao | Sim |
| Rodar scripts | Nao | Sim |
| Usar terminal | Nao | Sim |
| Analisar imagens | Nao | Sim |
| Multi-step complexo | Limitado (10 tool steps) | Ilimitado |
| Ver resultado no app | Automatico | Sim (app aberto) |

---

## Scripts

```json
{
  "mcp:dev": "npx tsx mcp-server/index.ts",
  "mcp:install": "cd mcp-server && npm install"
}
```

---

## Sequencia de implementacao sugerida

1. **HTTP server no Electron** — `tool-server.ts` + chamada no `index.ts`
2. **MCP server** — `mcp-server/` com package.json e index.ts
3. **MCP instructions** — `buildMcpInstructions()` em system-prompt.ts
4. **Config** — `.mcp.json` na raiz
5. **Teste manual** — abrir app, abrir Claude Code, chamar uma tool
6. **Refinamento** — ajustar instructions baseado no uso real
