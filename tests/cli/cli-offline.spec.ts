import { execFile } from 'node:child_process'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'

const execFileAsync = promisify(execFile)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const AUTH_TOKEN = 'cli-test-token'

let fakeServer: Server | null = null

async function runCli(args: string[], env: Record<string, string> = {}) {
  return execFileAsync('npx', ['tsx', 'src/cli/index.ts', ...args], {
    cwd: root,
    env: {
      ...process.env,
      ESCALAFLOW_TOOL_SERVER: 'http://127.0.0.1:9',
      ...env,
    },
  })
}

describe('escalaflow cli offline behavior', () => {
  afterEach(async () => {
    vi.restoreAllMocks()
    if (fakeServer) {
      await new Promise<void>((resolve) => fakeServer?.close(() => resolve()))
      fakeServer = null
    }
  })

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

  it('asks for a baker joke through chat after successful readiness preflight', async () => {
    const requests: Array<{ method?: string; url?: string; auth?: string; body?: unknown }> = []
    fakeServer = createServer(async (req, res) => {
      const chunks: Buffer[] = []
      for await (const chunk of req) chunks.push(Buffer.from(chunk))
      const rawBody = Buffer.concat(chunks).toString('utf8')
      requests.push({
        method: req.method,
        url: req.url,
        auth: req.headers.authorization,
        body: rawBody ? JSON.parse(rawBody) : undefined,
      })

      res.setHeader('Content-Type', 'application/json')
      if (req.headers.authorization !== `Bearer ${AUTH_TOKEN}`) {
        res.writeHead(401)
        res.end(JSON.stringify({ status: 'error', message: 'token ausente' }))
        return
      }
      if (req.method === 'GET' && req.url === '/chat/preflight') {
        res.end(JSON.stringify({
          status: 'ok',
          readiness: {
            ok: true,
            provider: 'local',
            model: 'gemma-4-e2b-it-q4',
            reason: 'ready',
            message: 'IA local pronta.',
          },
        }))
        return
      }
      if (req.method === 'POST' && req.url === '/chat') {
        res.end(JSON.stringify({
          status: 'ok',
          response: 'Por que o padeiro foi promovido? Porque ele sempre fazia a massa crescer.',
          actions: [],
        }))
        return
      }
      res.writeHead(404)
      res.end(JSON.stringify({ status: 'error', message: 'not found' }))
    })
    await new Promise<void>((resolve) => fakeServer?.listen(0, '127.0.0.1', resolve))
    const port = (fakeServer.address() as AddressInfo).port

    const result = await runCli(['chat', 'Me conta uma piada de padeiro.'], {
      ESCALAFLOW_TOOL_SERVER: `http://127.0.0.1:${port}`,
      ESCALAFLOW_TOOL_SERVER_TOKEN: AUTH_TOKEN,
    })

    expect(result.stdout).toContain('Por que o padeiro foi promovido?')
    expect(requests.map((request) => `${request.method} ${request.url}`)).toEqual([
      'GET /chat/preflight',
      'POST /chat',
    ])
    expect(requests.every((request) => request.auth === `Bearer ${AUTH_TOKEN}`)).toBe(true)
    expect(requests[1]?.body).toMatchObject({
      message: 'Me conta uma piada de padeiro.',
      context: { page: 'cli', route: '/cli' },
      stream: false,
    })
  })

  it('does not send chat when readiness says the configured IA cannot load', async () => {
    let chatCalled = false
    fakeServer = createServer(async (req, res) => {
      res.setHeader('Content-Type', 'application/json')
      if (req.headers.authorization !== `Bearer ${AUTH_TOKEN}`) {
        res.writeHead(401)
        res.end(JSON.stringify({ status: 'error', message: 'token ausente' }))
        return
      }
      if (req.method === 'GET' && req.url === '/chat/preflight') {
        res.writeHead(409)
        res.end(JSON.stringify({
          status: 'error',
          message: 'Runtime local compatível com Gemma 4 não encontrado.',
          readiness: {
            ok: false,
            provider: 'local',
            model: 'gemma-4-e2b-it-q4',
            reason: 'local_model_error',
            message: 'Runtime local compatível com Gemma 4 não encontrado.',
            action: 'Instale llama-server atualizado ou escolha outro provider.',
          },
        }))
        return
      }
      if (req.method === 'POST' && req.url === '/chat') {
        chatCalled = true
      }
      res.writeHead(500)
      res.end(JSON.stringify({ status: 'error', message: 'unexpected' }))
    })
    await new Promise<void>((resolve) => fakeServer?.listen(0, '127.0.0.1', resolve))
    const port = (fakeServer.address() as AddressInfo).port

    await expect(runCli(['chat', 'Me conta uma piada de padeiro.'], {
      ESCALAFLOW_TOOL_SERVER: `http://127.0.0.1:${port}`,
      ESCALAFLOW_TOOL_SERVER_TOKEN: AUTH_TOKEN,
    })).rejects.toMatchObject({
      stderr: expect.stringContaining('Erro do EscalaFlow (409): Runtime local compatível com Gemma 4 não encontrado.'),
    })
    expect(chatCalled).toBe(false)
  })
})
