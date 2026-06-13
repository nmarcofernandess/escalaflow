// =============================================================================
// LOCAL LLM — Gemma 4 via llama-server
// Download, lifecycle, chat com tool calling
// =============================================================================

import path from 'node:path'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import type { IaMensagem, IaContexto, IaAnexo, ToolCall, IaLocalStatus, IaStreamEvent } from '../../shared/types'
import {
  getLocalLlamaServerStatus,
  localLlamaServerChat,
  localLlamaServerGenerateJson,
  stopLocalLlamaServer,
  validateLocalLlamaServerModel,
} from './llama-server-runtime'

const _require = createRequire(import.meta.url)
const { BrowserWindow: _BW } = _require('electron') as typeof import('electron')

function broadcastToRenderer(channel: string, data: unknown): void {
  if (!_BW?.getAllWindows) return
  for (const win of _BW.getAllWindows()) {
    win.webContents.send(channel, data)
  }
}

function emitStream(event: IaStreamEvent): void {
  broadcastToRenderer('ia:stream', event)
}

// ---------------------------------------------------------------------------
// Modelos disponíveis
// ---------------------------------------------------------------------------

export const LOCAL_MODELS = {
  'gemma-4-e2b-it-q4': {
    label: 'Gemma 4 E2B IT',
    filename: 'gemma-4-E2B-it-Q4_K_M.gguf',
    url: 'https://huggingface.co/unsloth/gemma-4-E2B-it-GGUF/resolve/main/gemma-4-E2B-it-Q4_K_M.gguf',
    size_bytes: 3_110_000_000,
    ram_minima_gb: 4,
    descricao: 'Gemma 4 Effective 2B instruction tuned, Q4_K_M GGUF. Padrão local para chat, tools e enrichment.',
  },
} as const

export type LocalModelId = keyof typeof LOCAL_MODELS

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

function getModelDir(): string {
  if (process.env.ESCALAFLOW_LOCAL_MODELS_DIR) {
    return process.env.ESCALAFLOW_LOCAL_MODELS_DIR
  }

  try {
    const electron = _require('electron') as { app?: { getPath?: (name: string) => string } }
    const app = electron.app
    if (app?.getPath) {
      // userData: ~/Library/Application Support/EscalaFlow (Mac) — sobrevive a clean/dev/rebuild
      return path.join(app.getPath('userData'), 'models')
    }
  } catch { /* fallback */ }
  if (process.platform === 'darwin' && process.env.HOME) {
    return path.join(process.env.HOME, 'Library/Application Support/EscalaFlow/models')
  }
  return path.join(__dirname, '../../data/models')
}

export function getModelPath(modelId: LocalModelId): string {
  return path.join(getModelDir(), LOCAL_MODELS[modelId].filename)
}

function isModelDownloaded(modelId: LocalModelId): boolean {
  const modelPath = getModelPath(modelId)
  if (!fs.existsSync(modelPath)) return false
  const stat = fs.statSync(modelPath)
  return stat.size > LOCAL_MODELS[modelId].size_bytes * 0.95
}

export function validateDownloadedModelArtifact(modelId: LocalModelId, filePath: string): void {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Arquivo baixado nao encontrado: ${filePath}`)
  }

  const stat = fs.statSync(filePath)
  const minimumSize = LOCAL_MODELS[modelId].size_bytes * 0.95
  if (stat.size < minimumSize) {
    throw new Error(`Download incompleto: esperado ao menos ${(minimumSize / 1e9).toFixed(2)} GB, recebido ${(stat.size / 1e9).toFixed(2)} GB.`)
  }

  const fd = fs.openSync(filePath, 'r')
  try {
    const magic = Buffer.alloc(4)
    fs.readSync(fd, magic, 0, magic.length, 0)
    if (magic.toString('ascii') !== 'GGUF') {
      throw new Error('Arquivo baixado nao parece ser um GGUF valido.')
    }
  } finally {
    fs.closeSync(fd)
  }
}

function getActiveLocalModelId(preferredModelId?: LocalModelId): LocalModelId {
  if (preferredModelId) {
    if (isModelDownloaded(preferredModelId)) return preferredModelId
    throw new Error(`Modelo local "${preferredModelId}" nao baixado. Baixe em Configurações > IA Local.`)
  }

  if (isModelDownloaded('gemma-4-e2b-it-q4')) return 'gemma-4-e2b-it-q4'
  throw new Error('Nenhum modelo local baixado. Baixe um modelo em Configurações > IA Local.')
}

function shouldUseLlamaServerRuntime(modelId: LocalModelId): boolean {
  // Gemma 4 usa arquitetura "gemma4"; node-llama-cpp 3.18.1 ainda falha com
  // "unknown model architecture: 'gemma4'". llama-server recente carrega e
  // emite tool_calls estruturados.
  return modelId === 'gemma-4-e2b-it-q4'
}

function isLocalRuntimeLoadFailure(message: string): boolean {
  const lower = message.toLowerCase()
  return lower.includes('runtime local compatível')
    || lower.includes('encerrou durante o boot')
    || lower.includes('failed to load model')
    || lower.includes('failed to open gguf')
    || lower.includes('model loading error')
    || lower.includes('unknown model architecture')
}

// ---------------------------------------------------------------------------
// Download com progresso + resume
// ---------------------------------------------------------------------------

let _downloadAbort: AbortController | null = null
let _downloadInProgress: LocalModelId | null = null
let _downloadState: {
  modelId: LocalModelId
  downloaded: number
  total: number
  status: 'idle' | 'downloading' | 'cancelled' | 'failed' | 'done'
  error?: string
} | null = null
const _modelValidation = new Map<LocalModelId, {
  usable: boolean
  error?: string
  validatedAt?: string
}>()

function broadcastLocalStatus(): void {
  broadcastToRenderer('ia:local:status-changed', getLocalStatus())
}

function setModelValidation(modelId: LocalModelId, value: { usable: boolean; error?: string }): void {
  _modelValidation.set(modelId, {
    ...value,
    validatedAt: new Date().toISOString(),
  })
}

function markModelValidation(modelId: LocalModelId, value: { usable: boolean; error?: string }): void {
  setModelValidation(modelId, value)
  broadcastLocalStatus()
}

export async function downloadModel(modelId: LocalModelId, onProgress: (downloaded: number, total: number) => void): Promise<void> {
  if (_downloadInProgress) {
    throw new Error(`Já existe um download em andamento: ${_downloadInProgress}`)
  }

  const model = LOCAL_MODELS[modelId]
  const dir = getModelDir()
  fs.mkdirSync(dir, { recursive: true })

  const partPath = getModelPath(modelId) + '.part'
  const finalPath = getModelPath(modelId)

  // Resume: checar tamanho do .part existente
  let existingBytes = 0
  if (fs.existsSync(partPath)) {
    existingBytes = fs.statSync(partPath).size
  }

  _downloadAbort = new AbortController()
  _downloadInProgress = modelId
  _downloadState = {
    modelId,
    downloaded: existingBytes,
    total: model.size_bytes,
    status: 'downloading',
  }
  broadcastLocalStatus()

  try {
    const headers: Record<string, string> = {}
    if (existingBytes > 0) {
      headers['Range'] = `bytes=${existingBytes}-`
    }

    const response = await fetch(model.url, {
      headers,
      signal: _downloadAbort.signal,
    })

    if (!response.ok && response.status !== 206) {
      throw new Error(`Download falhou: HTTP ${response.status}`)
    }

    const isResume = response.status === 206
    const totalFromHeader = response.headers.get('content-length')
    const contentLength = totalFromHeader ? parseInt(totalFromHeader, 10) : model.size_bytes
    const total = isResume ? existingBytes + contentLength : contentLength

    const body = response.body
    if (!body) throw new Error('Resposta sem body')

    const fileStream = fs.createWriteStream(partPath, { flags: isResume ? 'a' : 'w' })
    const reader = body.getReader()
    let downloaded = existingBytes
    _downloadState = { modelId, downloaded, total, status: 'downloading' }
    onProgress(downloaded, total)
    broadcastLocalStatus()

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        fileStream.write(Buffer.from(value))
        downloaded += value.byteLength
        _downloadState = { modelId, downloaded, total, status: 'downloading' }
        onProgress(downloaded, total)
        broadcastLocalStatus()
      }
    } finally {
      fileStream.end()
      await new Promise<void>((resolve) => fileStream.on('finish', resolve))
    }

    validateDownloadedModelArtifact(modelId, partPath)

    // Renomear .part → .gguf
    fs.renameSync(partPath, finalPath)
    _modelValidation.delete(modelId)
    _downloadState = { modelId, downloaded, total, status: 'done' }
    broadcastLocalStatus()
    console.log(`[LOCAL-LLM] Download concluído: ${modelId} (${(downloaded / 1e9).toFixed(1)} GB)`)
  } catch (err: any) {
    if (err.name === 'AbortError') {
      _downloadState = {
        modelId,
        downloaded: fs.existsSync(partPath) ? fs.statSync(partPath).size : existingBytes,
        total: _downloadState?.total ?? model.size_bytes,
        status: 'cancelled',
      }
      broadcastLocalStatus()
      console.log(`[LOCAL-LLM] Download cancelado: ${modelId}`)
      return
    }
    _downloadState = {
      modelId,
      downloaded: fs.existsSync(partPath) ? fs.statSync(partPath).size : existingBytes,
      total: _downloadState?.total ?? model.size_bytes,
      status: 'failed',
      error: err?.message || String(err),
    }
    broadcastLocalStatus()
    throw err
  } finally {
    _downloadAbort = null
    _downloadInProgress = null
    broadcastLocalStatus()
  }
}

export function cancelDownload(): void {
  if (_downloadAbort) {
    _downloadAbort.abort()
    _downloadAbort = null
    _downloadInProgress = null
  }
  broadcastLocalStatus()
}

export function deleteModel(modelId: LocalModelId): void {
  const modelPath = getModelPath(modelId)
  const partPath = modelPath + '.part'
  if (fs.existsSync(modelPath)) fs.unlinkSync(modelPath)
  if (fs.existsSync(partPath)) fs.unlinkSync(partPath)
  _modelValidation.delete(modelId)
  if (_downloadState?.modelId === modelId) _downloadState = null
  broadcastLocalStatus()
  console.log(`[LOCAL-LLM] Modelo deletado: ${modelId}`)
}

export function listDownloadedModels(): LocalModelId[] {
  return (Object.keys(LOCAL_MODELS) as LocalModelId[]).filter(isModelDownloaded)
}

// ---------------------------------------------------------------------------
// Lifecycle — singleton lazy
// ---------------------------------------------------------------------------

type LlamaTypes = typeof import('node-llama-cpp')

let _llama: any = null
let _model: any = null
let _context: any = null
let _loadedModelId: LocalModelId | null = null
let _unloadTimer: ReturnType<typeof setTimeout> | null = null
let _lastTps = 0

const IDLE_TIMEOUT_MS = 5 * 60 * 1000 // 5 min

async function getLlamaCpp(): Promise<LlamaTypes> {
  return await import('node-llama-cpp')
}

export async function ensureModelLoaded(preferredModelId?: LocalModelId): Promise<{ model: any; context: any }> {
  resetIdleTimer()
  const targetModelId = getActiveLocalModelId(preferredModelId)

  // Se já está carregado com o mesmo modelo, retorna
  if (_model && _context && _loadedModelId === targetModelId) {
    return { model: _model, context: _context }
  }

  // Se mudou de modelo, descarrega o anterior
  if (_model && _loadedModelId !== targetModelId) {
    await unloadModel()
  }

  console.log(`[LOCAL-LLM] Carregando modelo: ${targetModelId}...`)
  const startMs = Date.now()

  const { getLlama } = await getLlamaCpp()

  if (!_llama) {
    _llama = await getLlama()
    console.log(`[LOCAL-LLM] GPU: ${_llama.gpu}`)
  }

  const modelPath = getModelPath(targetModelId)
  try {
    _model = await _llama.loadModel({ modelPath })
    _context = await _model.createContext()
    _loadedModelId = targetModelId
    markModelValidation(targetModelId, { usable: true })
  } catch (err: any) {
    const message = err?.message || String(err)
    markModelValidation(targetModelId, { usable: false, error: message })
    _model = null
    _context = null
    _loadedModelId = null
    throw err
  }

  const elapsed = ((Date.now() - startMs) / 1000).toFixed(1)
  console.log(`[LOCAL-LLM] Modelo carregado em ${elapsed}s`)

  return { model: _model, context: _context }
}

export async function validateLocalModel(modelId: LocalModelId): Promise<IaLocalStatus['modelos'][string]> {
  if (shouldUseLlamaServerRuntime(modelId)) {
    resetIdleTimer()
    try {
      await validateLocalLlamaServerModel({ modelId, modelPath: getModelPath(modelId) })
      markModelValidation(modelId, { usable: true })
      return getLocalStatus().modelos[modelId]
    } catch (err: any) {
      const message = err?.message || String(err)
      markModelValidation(modelId, { usable: false, error: message })
      clearIdleTimer()
      throw err
    }
  }

  await ensureModelLoaded(modelId)
  return getLocalStatus().modelos[modelId]
}

export async function unloadModel(): Promise<void> {
  clearIdleTimer()
  await stopLocalLlamaServer()

  if (_context) {
    await _context.dispose?.()
    _context = null
  }
  if (_model) {
    await _model.dispose?.()
    _model = null
  }
  _loadedModelId = null
  _lastTps = 0
  console.log('[LOCAL-LLM] Modelo descarregado')
}

export async function localLlmGenerateJson(
  prompt: string,
  options?: { modelId?: LocalModelId; maxTokens?: number },
): Promise<string> {
  const modelId = getActiveLocalModelId(options?.modelId)
  if (shouldUseLlamaServerRuntime(modelId)) {
    resetIdleTimer()
    try {
      const response = await localLlamaServerGenerateJson({
        modelId,
        modelPath: getModelPath(modelId),
        prompt,
        maxTokens: options?.maxTokens,
      })
      markModelValidation(modelId, { usable: true })
      return response
    } catch (err: any) {
      const message = err?.message || String(err)
      markModelValidation(modelId, { usable: false, error: message })
      clearIdleTimer()
      throw err
    }
  }

  const { context } = await ensureModelLoaded(options?.modelId)
  resetIdleTimer()

  const { LlamaChatSession } = await getLlamaCpp()
  const session = new LlamaChatSession({
    contextSequence: context.getSequence(),
    systemPrompt: 'Responda somente JSON valido, sem markdown, sem comentarios e sem texto fora do objeto JSON.',
  })

  try {
    const response = await session.prompt(prompt, {
      maxTokens: options?.maxTokens ?? 4096,
    })
    return String(response ?? '')
  } finally {
    session.dispose?.()
  }
}

function resetIdleTimer(): void {
  clearIdleTimer()
  _unloadTimer = setTimeout(() => {
    console.log('[LOCAL-LLM] Idle timeout — descarregando modelo')
    void unloadModel()
  }, IDLE_TIMEOUT_MS)
}

function clearIdleTimer(): void {
  if (_unloadTimer) {
    clearTimeout(_unloadTimer)
    _unloadTimer = null
  }
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

export function getLocalStatus(): IaLocalStatus {
  const modelos: IaLocalStatus['modelos'] = {}
  const serverStatus = getLocalLlamaServerStatus()

  for (const [id, m] of Object.entries(LOCAL_MODELS)) {
    const modelPath = getModelPath(id as LocalModelId)
    const partPath = modelPath + '.part'
    const baixado = isModelDownloaded(id as LocalModelId)
    const modelId = id as LocalModelId
    const validation = _modelValidation.get(modelId)
    const isActiveLoaded = _loadedModelId === modelId && !!_model && !!_context
    const isServerLoaded = serverStatus.running && serverStatus.modelId === modelId
    const hasLoadError = Boolean(validation?.error)
    const downloadForModel = _downloadState?.modelId === modelId ? _downloadState : null
    let tamanho_atual_bytes: number | undefined

    if (!baixado && fs.existsSync(partPath)) {
      tamanho_atual_bytes = fs.statSync(partPath).size
    } else if (baixado && fs.existsSync(modelPath)) {
      tamanho_atual_bytes = fs.statSync(modelPath).size
    }

    modelos[id] = {
      baixado,
      tamanho_bytes: m.size_bytes,
      ...(tamanho_atual_bytes !== undefined ? { tamanho_atual_bytes } : {}),
      usable: baixado && !hasLoadError && (isActiveLoaded || isServerLoaded || validation?.usable === true),
      requires_validation: baixado && !hasLoadError && !isActiveLoaded && !isServerLoaded && validation?.usable !== true,
      ...(validation?.error ? { load_error: validation.error } : {}),
      ...(validation?.validatedAt ? { validated_at: validation.validatedAt } : {}),
      download_status: downloadForModel?.status ?? 'idle',
      ...(downloadForModel ? {
        download_progresso: downloadForModel.total > 0 ? downloadForModel.downloaded / downloadForModel.total : 0,
        download_bytes_total: downloadForModel.total,
        download_bytes_feitos: downloadForModel.downloaded,
        ...(downloadForModel.error ? { download_error: downloadForModel.error } : {}),
      } : {}),
    }
  }

  return {
    modelos,
    modelo_ativo: _loadedModelId ?? serverStatus.modelId ?? undefined,
    modelo_carregado: (!!_model && !!_context) || serverStatus.running,
    ..._downloadInProgress ? {
      download_em_andamento: _downloadInProgress,
      download_progresso: _downloadState && _downloadState.total > 0 ? _downloadState.downloaded / _downloadState.total : undefined,
      download_bytes_total: _downloadState?.total,
      download_bytes_feitos: _downloadState?.downloaded,
    } : {},
    gpu_detectada: _llama?.gpu ?? undefined,
    tokens_por_segundo: _lastTps || undefined,
  }
}

// ---------------------------------------------------------------------------
// Chat com tool calling
// ---------------------------------------------------------------------------

export async function localLlmChat(
  currentMsg: string,
  historico: IaMensagem[],
  streamId: string,
  contexto?: IaContexto,
  conversa_id?: string,
  _anexos?: IaAnexo[],
): Promise<{ resposta: string; acoes: ToolCall[] }> {
  let targetModelId: LocalModelId
  try {
    targetModelId = getActiveLocalModelId()
  } catch (err: any) {
    const msg = err?.message || String(err)
    emitStream({ type: 'error', stream_id: streamId, message: msg })
    throw new Error(msg)
  }

  if (shouldUseLlamaServerRuntime(targetModelId)) {
    resetIdleTimer()
    try {
      const result = await localLlamaServerChat({
        modelId: targetModelId,
        modelPath: getModelPath(targetModelId),
        currentMsg,
        historico,
        streamId,
        contexto,
        streamSink: emitStream,
      })
      if (result.tokensPerSecond && result.tokensPerSecond > 0) {
        _lastTps = Math.round(result.tokensPerSecond)
      }
      markModelValidation(targetModelId, { usable: true })
      return { resposta: result.resposta, acoes: result.acoes }
    } catch (err: any) {
      const message = err?.message || String(err)
      const isLoadFailure = isLocalRuntimeLoadFailure(message)
      if (isLoadFailure) {
        markModelValidation(targetModelId, { usable: false, error: message })
        clearIdleTimer()
      } else {
        markModelValidation(targetModelId, { usable: true })
      }
      const msg = isLoadFailure
        ? `Erro ao carregar modelo local: ${message}`
        : `Erro ao executar IA local: ${message}`
      emitStream({ type: 'error', stream_id: streamId, message: msg })
      throw new Error(msg)
    }
  }

  let loaded: { model: any; context: any }
  try {
    loaded = await ensureModelLoaded()
  } catch (err: any) {
    const msg = err.message?.includes('memory') || err.message?.includes('OOM')
      ? 'Memória insuficiente para carregar o modelo local. Feche apps pesados, descarregue o modelo local ou use Gemini/OpenRouter.'
      : `Erro ao carregar modelo local: ${err.message}`
    emitStream({ type: 'error', stream_id: streamId, message: msg })
    throw new Error(msg)
  }
  const { context } = loaded
  resetIdleTimer()

  const { LlamaChatSession } = await getLlamaCpp()

  // Build system prompt trimado para modelo local
  const { buildLocalSystemPrompt } = await import('./system-prompt')
  const systemPrompt = await buildLocalSystemPrompt(contexto, currentMsg)

  // Context window guard — trim histórico se muito longo
  const MAX_HISTORY_MSGS = 20
  if (historico.length > MAX_HISTORY_MSGS) {
    console.log(`[LOCAL-LLM] Trimming histórico: ${historico.length} → ${MAX_HISTORY_MSGS} mensagens`)
    historico = historico.slice(-MAX_HISTORY_MSGS)
    emitStream({ type: 'text-delta', stream_id: streamId, delta: '_Conversa longa — usando contexto recente para IA local._\n\n' })
  }

  // Legacy node-llama-cpp fallback path also uses 3 family tools instead of 30 atomic.
  const { IA_TOOLS_PUBLIC } = await import('./tools')
  const { FAMILY_SCHEMAS, executeFamilyTool } = await import('./tool-families')
  const { defineChatSessionFunction } = await getLlamaCpp()

  const functions: Record<string, any> = {}
  const toolCallsCollected: ToolCall[] = []
  let toolCallCounter = 0

  for (const t of IA_TOOLS_PUBLIC) {
    const zodSchema = FAMILY_SCHEMAS[t.name]
    if (!zodSchema) continue

    // Convert Zod to JSON Schema for the fallback runtime.
    const { zodToJsonSchema } = await import('zod-to-json-schema')
    const jsonSchema = zodToJsonSchema(zodSchema as any, { target: 'openApi3' })

    functions[t.name] = defineChatSessionFunction({
      description: t.description,
      params: jsonSchema as any,
      handler: async (params: any) => {
        const callId = `local_${++toolCallCounter}`
        const est: number | undefined = undefined
        emitStream({ type: 'tool-call-start', stream_id: streamId, tool_call_id: callId, tool_name: t.name, args: params, estimated_seconds: est })

        try {
          const result = await executeFamilyTool(t.name, params)
          emitStream({ type: 'tool-result', stream_id: streamId, tool_call_id: callId, tool_name: t.name, result })
          toolCallsCollected.push({ id: callId, name: t.name, args: params, result })
          return result
        } catch (err: any) {
          const errorResult = { status: 'error', message: err.message }
          emitStream({ type: 'tool-result', stream_id: streamId, tool_call_id: callId, tool_name: t.name, result: errorResult })
          toolCallsCollected.push({ id: callId, name: t.name, args: params, result: errorResult })
          return errorResult
        }
      },
    })
  }

  // Build conversation history for the fallback runtime.
  const chatHistory = buildLlamaChatHistory(historico, systemPrompt)

  const session = new LlamaChatSession({
    contextSequence: context.getSequence(),
    systemPrompt,
  })

  // If there's chat history, load it
  if (chatHistory.length > 0) {
    session.setChatHistory(chatHistory)
  }

  let fullText = ''
  let stepIndex = 0
  emitStream({ type: 'start-step', stream_id: streamId, step_index: stepIndex })

  try {
    const startTokens = Date.now()
    let tokenCount = 0

    const response = await session.prompt(currentMsg, {
      functions,
      maxTokens: 4096,
      onTextChunk: (chunk: string) => {
        fullText += chunk
        tokenCount++
        emitStream({ type: 'text-delta', stream_id: streamId, delta: chunk })
      },
    })

    const elapsed = (Date.now() - startTokens) / 1000
    if (elapsed > 0) {
      _lastTps = Math.round(tokenCount / elapsed)
    }

    emitStream({ type: 'step-finish', stream_id: streamId, step_index: stepIndex })

    // Append tok/s info
    if (_lastTps > 0) {
      const tpsNote = `\n\n---\n_~${_lastTps} tok/s · modelo local_`
      fullText += tpsNote
      emitStream({ type: 'text-delta', stream_id: streamId, delta: tpsNote })
    }

    const resposta = fullText || response || '(Resposta vazia)'
    emitStream({ type: 'finish', stream_id: streamId, resposta, acoes: toolCallsCollected })

    return { resposta, acoes: toolCallsCollected }
  } catch (err: any) {
    console.error('[LOCAL-LLM] Erro no chat:', err.message)
    emitStream({ type: 'error', stream_id: streamId, message: err.message })
    throw err
  } finally {
    session.dispose?.()
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildLlamaChatHistory(historico: IaMensagem[], _systemPrompt: string): any[] {
  if (!historico || historico.length === 0) return []

  const history: any[] = []

  for (const msg of historico) {
    if (msg.papel === 'usuario') {
      history.push({ type: 'user', text: msg.conteudo })
    } else if (msg.papel === 'assistente') {
      history.push({ type: 'model', response: [msg.conteudo] })
    }
    // tool_result messages são internos ao step, não precisam ser reenviados
  }

  return history
}
