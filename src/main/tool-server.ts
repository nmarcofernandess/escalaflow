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
