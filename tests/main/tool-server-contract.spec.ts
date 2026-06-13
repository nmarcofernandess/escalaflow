import { request } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { IA_TOOLS } from '../../src/main/ia/tools'
import { startToolServer, stopToolServer } from '../../src/main/tool-server'

let baseUrl = ''
let toolPort = 0

vi.mock('../../src/main/db/query', () => ({
  queryOne: vi.fn(async () => ({
    provider: 'local',
    modelo: 'gemma-4-e2b-it-q4',
    ativo: true,
  })),
  execute: vi.fn(async () => undefined),
}))

vi.mock('../../src/main/ia/readiness', () => ({
  getIaChatReadiness: vi.fn(async () => ({
    ok: true,
    provider: 'local',
    model: 'gemma-4-e2b-it-q4',
    reason: 'ready',
    message: 'IA local pronta.',
  })),
}))

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

async function startIsolatedToolServer(): Promise<void> {
  const server = startToolServer({ port: 0 })
  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve)
    server.once('error', reject)
  })
  const address = server.address() as AddressInfo
  toolPort = address.port
  baseUrl = `http://127.0.0.1:${toolPort}`
}

async function waitForHealth(): Promise<void> {
  const started = Date.now()
  while (Date.now() - started < 3000) {
    try {
      const res = await fetch(`${baseUrl}/health`)
      if (res.ok) return
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
  }
  throw new Error('tool server did not start')
}

async function requestWithHost(pathname: string, host: string): Promise<{ status: number, body: any }> {
  return new Promise((resolve, reject) => {
    const req = request({
      host: '127.0.0.1',
      port: toolPort,
      path: pathname,
      method: 'GET',
      headers: { Host: host },
    }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk) => chunks.push(chunk))
      res.on('end', () => {
        resolve({
          status: res.statusCode ?? 0,
          body: JSON.parse(Buffer.concat(chunks).toString()),
        })
      })
    })
    req.on('error', reject)
    req.end()
  })
}

describe('EscalaFlow tool server contract', () => {
  afterEach(() => {
    stopToolServer()
    baseUrl = ''
    toolPort = 0
    vi.clearAllMocks()
  })

  it('returns expanded health', async () => {
    await startIsolatedToolServer()
    await waitForHealth()

    const res = await fetch(`${baseUrl}/health`)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.status).toBe('ok')
    expect(body.app).toBe('EscalaFlow')
    expect(body.version).toBe('?')
    expect(body.db.connected).toBe(true)
    expect(body.tools).toBe(IA_TOOLS.length)
    expect(body.ia).toHaveProperty('provider')
    expect(body.ia).toHaveProperty('modelo')
    expect(body.ia).toHaveProperty('local_model')
  })

  it('rejects non-loopback Host headers', async () => {
    await startIsolatedToolServer()
    await waitForHealth()

    const { status, body } = await requestWithHost('/health', 'evil.example.com')

    expect(status).toBe(403)
    expect(body.message).toBe('Acesso permitido apenas via loopback local.')
  })

  it('runs chat endpoint', async () => {
    await startIsolatedToolServer()
    await waitForHealth()

    const res = await fetch(`${baseUrl}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'oi', stream: false }),
    })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.response).toBe('eco: oi')
  })

  it('runs solver preflight endpoint', async () => {
    await startIsolatedToolServer()
    await waitForHealth()

    const res = await fetch(`${baseUrl}/solver/preflight`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ setor_id: 2, data_inicio: '2026-07-01', data_fim: '2026-07-31' }),
    })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.preflight.ok).toBe(true)
  })

  it('runs solver generate endpoint in summary mode', async () => {
    await startIsolatedToolServer()
    await waitForHealth()

    const res = await fetch(`${baseUrl}/solver/generate`, {
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
