import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type FakeChild = EventEmitter & {
  exitCode: number | null
  stdout: EventEmitter
  stderr: EventEmitter
  kill: ReturnType<typeof vi.fn>
}

const { children, spawnMock, behavior } = vi.hoisted(() => ({
  children: [] as FakeChild[],
  spawnMock: vi.fn(),
  behavior: { ignoreSigterm: false },
}))

vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process')
  return { ...actual, spawn: spawnMock }
})

describe('llama-server timeout cleanup', () => {
  const originalBinary = process.env.ESCALAFLOW_LLAMA_SERVER_BIN

  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('model loading')))
    children.length = 0
    behavior.ignoreSigterm = false
    spawnMock.mockImplementation(() => {
      const child = new EventEmitter() as FakeChild
      child.exitCode = null
      child.stdout = new EventEmitter()
      child.stderr = new EventEmitter()
      child.kill = vi.fn((signal: NodeJS.Signals) => {
        if (signal === 'SIGTERM' && behavior.ignoreSigterm) return true
        child.exitCode = 0
        queueMicrotask(() => child.emit('exit', 0, signal))
        return true
      })
      children.push(child)
      return child
    })
    process.env.ESCALAFLOW_LLAMA_SERVER_BIN = process.execPath
  })

  afterEach(() => {
    if (originalBinary === undefined) delete process.env.ESCALAFLOW_LLAMA_SERVER_BIN
    else process.env.ESCALAFLOW_LLAMA_SERVER_BIN = originalBinary
    vi.unstubAllGlobals()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('waits beyond 90 seconds through public validation before running the chat smoke', async () => {
    const runtime = await import('../../../src/main/ia/llama-server-runtime')
    const startedAt = Date.now()
    const events: string[] = []
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/health')) {
        if (Date.now() - startedAt < 120_000) {
          events.push('health:503')
          return { ok: false, status: 503 } as Response
        }
        events.push('health:200')
        return { ok: true, status: 200 } as Response
      }
      if (url.endsWith('/v1/chat/completions')) {
        events.push('chat')
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ choices: [{ message: { content: 'ok' } }] }),
        } as Response
      }
      throw new Error(`unexpected URL: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    let settled = false
    const validation = runtime.validateLocalLlamaServerModel({
      modelId: 'gemma-4-e2b-it-q4',
      modelPath: '/tmp/escalaflow-test-model.gguf',
    }).then(() => {
      settled = true
    })

    await vi.advanceTimersByTimeAsync(90_000)
    expect(settled).toBe(false)

    await vi.advanceTimersByTimeAsync(30_000)
    await validation

    expect(settled).toBe(true)
    expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith('/health'))).toBe(true)
    expect(fetchMock.mock.calls.filter(([input]) => String(input).endsWith('/v1/chat/completions'))).toHaveLength(1)
    expect(events.at(-2)).toBe('health:200')
    expect(events.at(-1)).toBe('chat')

    await runtime.stopLocalLlamaServer()
  })

  it('kills the child and clears stale running state when health times out', async () => {
    const runtime = await import('../../../src/main/ia/llama-server-runtime')
    const validation = runtime.validateLocalLlamaServerModel({
      modelId: 'gemma-4-e2b-it-q4',
      modelPath: '/tmp/escalaflow-test-model.gguf',
    })
    const rejection = expect(validation).rejects.toThrow('Timeout aguardando llama-server carregar')

    await vi.advanceTimersByTimeAsync(5 * 60_000)
    await rejection

    expect(children).toHaveLength(1)
    expect(children[0].kill).toHaveBeenCalledWith('SIGTERM')
    expect(runtime.getLocalLlamaServerStatus()).toEqual({ running: false })
  })

  it('escalates to SIGKILL when the child ignores SIGTERM', async () => {
    const runtime = await import('../../../src/main/ia/llama-server-runtime')
    behavior.ignoreSigterm = true
    const validation = runtime.validateLocalLlamaServerModel({
      modelId: 'gemma-4-e2b-it-q4',
      modelPath: '/tmp/escalaflow-test-model.gguf',
    })
    const rejection = expect(validation).rejects.toThrow('Timeout aguardando llama-server carregar')

    await vi.advanceTimersByTimeAsync(5 * 60_000 + 2_000)
    await rejection

    expect(children).toHaveLength(1)
    expect(children[0].kill.mock.calls.map(([signal]) => signal)).toEqual(['SIGTERM', 'SIGKILL'])
    expect(runtime.getLocalLlamaServerStatus()).toEqual({ running: false })
  })

  it('permite uma nova validação depois de um timeout', async () => {
    const runtime = await import('../../../src/main/ia/llama-server-runtime')
    let firstChildHealth = true
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/health')) {
        if (firstChildHealth) return { ok: false, status: 503 } as Response
        return { ok: true, status: 200 } as Response
      }
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ choices: [{ message: { content: 'ok' } }] }),
      } as Response
    }))

    const firstValidation = runtime.validateLocalLlamaServerModel({
      modelId: 'gemma-4-e2b-it-q4',
      modelPath: '/tmp/escalaflow-test-model.gguf',
    })
    const firstRejection = expect(firstValidation).rejects.toThrow('Timeout aguardando llama-server carregar')
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    await firstRejection
    expect(runtime.getLocalLlamaServerStatus()).toEqual({ running: false })

    firstChildHealth = false
    await runtime.validateLocalLlamaServerModel({
      modelId: 'gemma-4-e2b-it-q4',
      modelPath: '/tmp/escalaflow-test-model.gguf',
    })

    expect(children).toHaveLength(2)
    expect(runtime.getLocalLlamaServerStatus().running).toBe(true)
    await runtime.stopLocalLlamaServer()
  })
})
