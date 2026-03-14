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
