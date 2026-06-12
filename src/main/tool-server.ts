import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { createRequire } from 'node:module'
import { executeTool, IA_TOOLS } from './ia/tools'
import { buildContextBriefing } from './ia/discovery'
import { queryOne } from './db/query'
import { cancelJob, getJob, listJobs } from './jobs'
import type { SimulacaoRegimeOverride } from './preflight-capacity'
import type { IaContexto, IaMensagem } from '../shared/types'

const TOOL_PORT = 17380
let httpServer: ReturnType<typeof createServer> | null = null
const require = createRequire(import.meta.url)

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

function isLoopbackHost(hostHeader: string | undefined): boolean {
  if (!hostHeader) return true
  try {
    const host = new URL(`http://${hostHeader}`).hostname
    return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]'
  } catch {
    return false
  }
}

function normalizeChatContext(context: unknown): IaContexto {
  if (context && typeof context === 'object') {
    const value = context as Record<string, unknown>
    return {
      pagina: String(value.pagina ?? value.page ?? 'externo') as IaContexto['pagina'],
      rota: String(value.rota ?? value.route ?? '/cli'),
      setor_id: typeof value.setor_id === 'number' ? value.setor_id : undefined,
      colaborador_id: typeof value.colaborador_id === 'number' ? value.colaborador_id : undefined,
      store_snapshot: value.store_snapshot as IaContexto['store_snapshot'],
    }
  }

  return { pagina: 'externo', rota: '/cli' }
}

async function buildHealthPayload() {
  let version = '?'
  try { version = require('electron').app.getVersion() } catch { /* dev/non-electron fallback */ }

  const ia = await queryOne<{ provider: string | null; modelo: string | null; ativo: boolean | number | null }>(
    'SELECT provider, modelo, ativo FROM configuracao_ia LIMIT 1',
  ).catch(() => null)

  let local_model: unknown = null
  try {
    const { getLocalStatus } = await import('./ia/local-llm')
    local_model = getLocalStatus()
  } catch {
    local_model = null
  }

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
}

export function startToolServer() {
  httpServer = createServer(async (req, res) => {
    try {
      if (!isLoopbackHost(req.headers.host)) {
        return json(res, { status: 'error', message: 'Acesso permitido apenas via loopback local.' }, 403)
      }

      const url = new URL(req.url ?? '/', `http://127.0.0.1:${TOOL_PORT}`)

      if (req.method === 'GET' && url.pathname === '/health') {
        return json(res, await buildHealthPayload())
      }
      if (req.method === 'GET' && url.pathname === '/tools') {
        return json(res, IA_TOOLS.map(t => ({ name: t.name, description: t.description, parameters: t.parameters })))
      }
      if (req.method === 'POST' && url.pathname === '/tool') {
        const body = JSON.parse(await readBody(req))
        const { name, args } = body
        if (!name || !IA_TOOLS.find(t => t.name === name)) {
          return json(res, { status: 'error', message: `Tool '${name}' nao existe` }, 400)
        }
        const result = await executeTool(name, args ?? {})
        return json(res, result)
      }
      if (req.method === 'GET' && url.pathname === '/jobs') {
        return json(res, { jobs: listJobs() })
      }
      const jobMatch = url.pathname.match(/^\/jobs\/([^/]+)(?:\/(cancel))?$/)
      if (jobMatch && req.method === 'GET' && !jobMatch[2]) {
        const id = decodeURIComponent(jobMatch[1])
        const job = getJob(id)
        if (!job) return json(res, { status: 'error', message: `Job "${id}" nao encontrado.` }, 404)
        return json(res, { job })
      }
      if (jobMatch && req.method === 'POST' && jobMatch[2] === 'cancel') {
        const id = decodeURIComponent(jobMatch[1])
        try {
          return json(res, { job: cancelJob(id) })
        } catch (err) {
          return json(res, { status: 'error', message: err instanceof Error ? err.message : String(err) }, 404)
        }
      }
      if (req.method === 'POST' && url.pathname === '/chat') {
        const body = JSON.parse(await readBody(req)) as {
          message?: string
          history?: IaMensagem[]
          context?: unknown
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
          normalizeChatContext(body.context),
          body.conversation_id,
        )

        return json(res, {
          status: 'ok',
          response: result.resposta,
          actions: result.acoes,
        })
      }
      if (req.method === 'POST' && url.pathname === '/solver/preflight') {
        const body = JSON.parse(await readBody(req)) as {
          setor_id?: number
          data_inicio?: string
          data_fim?: string
          regimes_override?: SimulacaoRegimeOverride[]
        }
        if (!body.setor_id || !body.data_inicio || !body.data_fim) {
          return json(res, { status: 'error', message: 'Campos setor_id, data_inicio e data_fim são obrigatórios.' }, 400)
        }
        const { buildEscalaPreflight } = await import('./motor/preflight-service')
        const preflight = await buildEscalaPreflight(body.setor_id, body.data_inicio, body.data_fim, body.regimes_override)
        return json(res, { status: 'ok', preflight })
      }
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
      if (req.method === 'GET' && url.pathname === '/discovery') {
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
      if (req.method === 'GET' && url.pathname === '/instructions') {
        const { buildMcpInstructions } = await import('./ia/system-prompt')
        return json(res, { instructions: buildMcpInstructions() })
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
