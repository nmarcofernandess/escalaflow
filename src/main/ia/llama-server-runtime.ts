import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import process from 'node:process'
import { createRequire } from 'node:module'
import type { IaContexto, IaMensagem, IaStreamEvent, ToolCall } from '../../shared/types'

const _require = createRequire(import.meta.url)

type OpenAiToolCall = {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

type OpenAiMessage =
  | { role: 'system' | 'user' | 'assistant'; content: string; tool_calls?: OpenAiToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string }

type ChatCompletionResponse = {
  choices?: Array<{
    finish_reason?: string
    message?: {
      role?: string
      content?: string | null
      reasoning_content?: string | null
      tool_calls?: OpenAiToolCall[]
    }
  }>
  timings?: {
    predicted_per_second?: number
  }
  error?: unknown
}

type AssistantMessage = {
  role?: string
  content?: string | null
  reasoning_content?: string | null
  tool_calls?: OpenAiToolCall[]
}

type RuntimeState = {
  modelId: string
  modelPath: string
  port: number
  baseUrl: string
  process: ChildProcess
  lastLogs: string[]
  startedAt: number
}

let runtimeState: RuntimeState | null = null
let startingRuntime: Promise<RuntimeState> | null = null

function emitStream(streamSink: (event: IaStreamEvent) => void, event: IaStreamEvent): void {
  streamSink(event)
}

function binaryName(): string {
  return process.platform === 'win32' ? 'llama-server.exe' : 'llama-server'
}

function getEscalaFlowUserDataDir(): string | null {
  if (process.env.ESCALAFLOW_USER_DATA_DIR) return process.env.ESCALAFLOW_USER_DATA_DIR
  try {
    const electron = _require('electron') as { app?: { getPath?: (name: string) => string } }
    if (electron.app?.getPath) return electron.app.getPath('userData')
  } catch {
    // running outside Electron
  }
  if (process.platform === 'darwin' && process.env.HOME) {
    return path.join(process.env.HOME, 'Library/Application Support/EscalaFlow')
  }
  return null
}

export function findLlamaServerBinary(): string | null {
  const bin = binaryName()
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath
  const userDataDir = getEscalaFlowUserDataDir()
  const candidates = [
    process.env.ESCALAFLOW_LLAMA_SERVER_BIN,
    userDataDir ? path.join(userDataDir, 'runtimes', 'llama.cpp', `${process.platform}-${process.arch}`, bin) : null,
    path.join(process.cwd(), 'runtimes', 'llama.cpp', `${process.platform}-${process.arch}`, bin),
    path.join(process.cwd(), 'tmp', 'llama-gemma4-build', 'bin', bin),
    path.join(resourcesPath ?? '', 'llama.cpp', `${process.platform}-${process.arch}`, bin),
    path.join(resourcesPath ?? '', 'llama.cpp', bin),
  ].filter(Boolean) as string[]

  for (const candidate of candidates) {
    try {
      if (process.platform === 'win32') {
        if (fs.existsSync(candidate)) return candidate
      } else {
        fs.accessSync(candidate, fs.constants.X_OK)
        return candidate
      }
    } catch {
      // Keep searching. A stale/non-executable candidate should surface as
      // local_model_error readiness, not crash the main process during spawn.
    }
  }

  return null
}

function runtimeMissingMessage(): string {
  return [
    'Runtime local compatível com Gemma 4 não encontrado.',
    'O node-llama-cpp instalado não carrega arquitetura gemma4; o EscalaFlow precisa de um llama-server recente.',
    'Defina ESCALAFLOW_LLAMA_SERVER_BIN apontando para um llama-server atualizado ou rode o build local do llama.cpp.',
  ].join(' ')
}

function appendLog(state: RuntimeState, chunk: Buffer): void {
  const lines = chunk.toString('utf8').split(/\r?\n/).filter(Boolean)
  state.lastLogs.push(...lines)
  if (state.lastLogs.length > 80) {
    state.lastLogs.splice(0, state.lastLogs.length - 80)
  }
}

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close(() => {
        if (typeof address === 'object' && address?.port) resolve(address.port)
        else reject(new Error('Nao foi possivel reservar porta local para llama-server.'))
      })
    })
  })
}

async function sleep(ms: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, ms))
}

async function waitForHealth(state: RuntimeState, timeoutMs = 90_000): Promise<void> {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    if (state.process.exitCode !== null) {
      throw new Error(`llama-server encerrou durante o boot. Logs: ${state.lastLogs.slice(-12).join(' | ')}`)
    }

    try {
      const response = await fetch(`${state.baseUrl}/health`)
      if (response.ok) return
    } catch {
      // servidor ainda subindo
    }

    await sleep(250)
  }

  throw new Error(`Timeout aguardando llama-server carregar. Logs: ${state.lastLogs.slice(-12).join(' | ')}`)
}

async function startRuntime(modelId: string, modelPath: string): Promise<RuntimeState> {
  if (runtimeState?.modelId === modelId && runtimeState.process.exitCode === null) {
    return runtimeState
  }

  if (startingRuntime) return startingRuntime

  startingRuntime = (async () => {
    await stopLocalLlamaServer()

    const executable = findLlamaServerBinary()
    if (!executable) throw new Error(runtimeMissingMessage())

    const port = await getFreePort()
    const baseUrl = `http://127.0.0.1:${port}`
    const binDir = path.dirname(executable)
    const child = spawn(executable, [
      '-m', modelPath,
      '--host', '127.0.0.1',
      '--port', String(port),
      '-c', '8192',
      '--jinja',
      '--reasoning', 'off',
    ], {
      cwd: binDir,
      env: {
        ...process.env,
        DYLD_LIBRARY_PATH: [binDir, process.env.DYLD_LIBRARY_PATH].filter(Boolean).join(':'),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    const state: RuntimeState = {
      modelId,
      modelPath,
      port,
      baseUrl,
      process: child,
      lastLogs: [],
      startedAt: Date.now(),
    }

    child.stdout?.on('data', chunk => appendLog(state, chunk))
    child.stderr?.on('data', chunk => appendLog(state, chunk))
    const spawnError = new Promise<never>((_, reject) => {
      child.once('error', (error) => {
        if (runtimeState === state) runtimeState = null
        appendLog(state, Buffer.from(`spawn error: ${error.message}`))
        reject(new Error(`llama-server nao iniciou: ${error.message}`))
      })
    })
    child.once('exit', (code, signal) => {
      if (runtimeState === state) runtimeState = null
      state.lastLogs.push(`process exited code=${code ?? 'null'} signal=${signal ?? 'null'}`)
    })

    runtimeState = state
    await Promise.race([waitForHealth(state), spawnError])
    return state
  })()

  try {
    return await startingRuntime
  } finally {
    startingRuntime = null
  }
}

export function getLocalLlamaServerStatus(): { running: boolean; modelId?: string; port?: number; started_at?: string } {
  if (!runtimeState || runtimeState.process.exitCode !== null) return { running: false }
  return {
    running: true,
    modelId: runtimeState.modelId,
    port: runtimeState.port,
    started_at: new Date(runtimeState.startedAt).toISOString(),
  }
}

export async function stopLocalLlamaServer(): Promise<void> {
  const state = runtimeState
  runtimeState = null
  if (!state || state.process.exitCode !== null) return

  state.process.kill('SIGTERM')
  await Promise.race([
    new Promise<void>(resolve => state.process.once('exit', () => resolve())),
    sleep(2_000).then(() => {
      if (state.process.exitCode === null) state.process.kill('SIGKILL')
    }),
  ])
}

async function postChatCompletion(state: RuntimeState, body: Record<string, unknown>): Promise<ChatCompletionResponse> {
  const response = await fetch(`${state.baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: path.basename(state.modelPath),
      temperature: 0,
      ...body,
    }),
  })

  const text = await response.text()
  let parsed: ChatCompletionResponse
  try {
    parsed = text ? JSON.parse(text) : {}
  } catch {
    parsed = { error: text }
  }

  if (!response.ok) {
    throw new Error(`llama-server HTTP ${response.status}: ${text.slice(0, 800)}`)
  }

  if (parsed.error) {
    throw new Error(`llama-server error: ${JSON.stringify(parsed.error).slice(0, 800)}`)
  }

  return parsed
}

function getAssistantMessage(response: ChatCompletionResponse): AssistantMessage {
  const choice = response.choices?.[0]
  const message = choice?.message
  if (!message) throw new Error(`Resposta invalida do llama-server: ${JSON.stringify(response).slice(0, 800)}`)
  return message
}

function parseToolArgs(raw: string): Record<string, unknown> {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return { _raw: raw }
  }
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function buildMessages(systemPrompt: string, historico: IaMensagem[], currentMsg: string): OpenAiMessage[] {
  const messages: OpenAiMessage[] = [{ role: 'system', content: systemPrompt }]
  for (const msg of historico.slice(-20)) {
    if (msg.papel === 'usuario') {
      messages.push({ role: 'user', content: msg.conteudo })
    } else if (msg.papel === 'assistente') {
      messages.push({ role: 'assistant', content: msg.conteudo })
    }
  }
  messages.push({ role: 'user', content: currentMsg })
  return messages
}

export async function validateLocalLlamaServerModel(input: {
  modelId: string
  modelPath: string
}): Promise<void> {
  const state = await startRuntime(input.modelId, input.modelPath)
  const response = await postChatCompletion(state, {
    messages: [{ role: 'user', content: 'Responda apenas: ok' }],
    max_tokens: 16,
  })
  const text = String(getAssistantMessage(response).content ?? '').trim().toLowerCase()
  if (!text.includes('ok')) {
    throw new Error(`llama-server carregou, mas respondeu de forma inesperada no smoke test: ${text || '(vazio)'}`)
  }
}

export async function localLlamaServerGenerateJson(input: {
  modelId: string
  modelPath: string
  prompt: string
  maxTokens?: number
}): Promise<string> {
  const state = await startRuntime(input.modelId, input.modelPath)
  const response = await postChatCompletion(state, {
    messages: [
      { role: 'system', content: 'Responda somente JSON valido, sem markdown, sem comentarios e sem texto fora do objeto JSON.' },
      { role: 'user', content: input.prompt },
    ],
    max_tokens: input.maxTokens ?? 4096,
  })
  return String(getAssistantMessage(response).content ?? '')
}

export async function localLlamaServerChat(input: {
  modelId: string
  modelPath: string
  currentMsg: string
  historico: IaMensagem[]
  streamId: string
  contexto?: IaContexto
  streamSink: (event: IaStreamEvent) => void
}): Promise<{ resposta: string; acoes: ToolCall[]; tokensPerSecond?: number }> {
  const state = await startRuntime(input.modelId, input.modelPath)

  const { buildLocalSystemPrompt } = await import('./system-prompt')
  const { IA_TOOLS_PUBLIC } = await import('./tools')
  const { executeFamilyTool } = await import('./tool-families')

  const systemPrompt = await buildLocalSystemPrompt(input.contexto, input.currentMsg)
  const messages = buildMessages(systemPrompt, input.historico, input.currentMsg)
  const tools = IA_TOOLS_PUBLIC.map(tool => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }))

  const collected: ToolCall[] = []
  let fullText = ''
  let tokensPerSecond: number | undefined

  for (let stepIndex = 0; stepIndex < 10; stepIndex++) {
    emitStream(input.streamSink, { type: 'start-step', stream_id: input.streamId, step_index: stepIndex })
    const response = await postChatCompletion(state, {
      messages,
      tools,
      tool_choice: 'auto',
      max_tokens: 2048,
    })
    tokensPerSecond = response.timings?.predicted_per_second ?? tokensPerSecond
    const message = getAssistantMessage(response)
    const toolCalls = message.tool_calls ?? []

    emitStream(input.streamSink, { type: 'step-finish', stream_id: input.streamId, step_index: stepIndex })

    if (toolCalls.length === 0) {
      const text = String(message.content ?? '')
      if (text) {
        fullText += text
        emitStream(input.streamSink, { type: 'text-delta', stream_id: input.streamId, delta: text })
      }
      const resposta = fullText || '(Resposta vazia)'
      emitStream(input.streamSink, { type: 'finish', stream_id: input.streamId, resposta, acoes: collected })
      return { resposta, acoes: collected, tokensPerSecond }
    }

    messages.push({
      role: 'assistant',
      content: String(message.content ?? ''),
      tool_calls: toolCalls,
    })

    for (const call of toolCalls) {
      const args = parseToolArgs(call.function.arguments)
      emitStream(input.streamSink, {
        type: 'tool-call-start',
        stream_id: input.streamId,
        tool_call_id: call.id,
        tool_name: call.function.name,
        args,
      })

      let result: unknown
      try {
        result = await executeFamilyTool(call.function.name, args)
      } catch (err: any) {
        result = { status: 'error', message: err?.message ?? String(err) }
      }

      collected.push({ id: call.id, name: call.function.name, args, result })
      emitStream(input.streamSink, {
        type: 'tool-result',
        stream_id: input.streamId,
        tool_call_id: call.id,
        tool_name: call.function.name,
        result,
      })
      messages.push({ role: 'tool', tool_call_id: call.id, content: safeJson(result) })
    }
  }

  throw new Error('IA local excedeu 10 rodadas de tool calling sem finalizar resposta.')
}

process.once('exit', () => {
  const state = runtimeState
  if (state?.process.exitCode === null) state.process.kill('SIGTERM')
})
