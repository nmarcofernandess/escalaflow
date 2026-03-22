// =============================================================================
// LOCAL LLM — node-llama-cpp (Qwen 3.5)
// Download, lifecycle, chat com tool calling
// =============================================================================

import path from 'node:path'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import type { IaMensagem, IaContexto, IaAnexo, ToolCall, IaLocalStatus, IaStreamEvent } from '../../shared/types'

const _require = createRequire(import.meta.url)
const { BrowserWindow: _BW } = _require('electron') as typeof import('electron')

function broadcastToRenderer(channel: string, data: unknown): void {
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
  'qwen3.5-9b': {
    label: 'Qwen 3.5 9B',
    filename: 'Qwen3.5-9B-Q4_K_M.gguf',
    url: 'https://huggingface.co/unsloth/Qwen3.5-9B-GGUF/resolve/main/Qwen3.5-9B-Q4_K_M.gguf',
    size_bytes: 5_680_000_000,
    ram_minima_gb: 8,
    descricao: 'Melhor qualidade de respostas e tool calling. Recomendado para 8GB+ RAM.',
  },
  'qwen3.5-4b': {
    label: 'Qwen 3.5 4B',
    filename: 'Qwen3.5-4B-Q4_K_M.gguf',
    url: 'https://huggingface.co/unsloth/Qwen3.5-4B-GGUF/resolve/main/Qwen3.5-4B-Q4_K_M.gguf',
    size_bytes: 2_800_000_000,
    ram_minima_gb: 4,
    descricao: 'Equilíbrio entre qualidade e velocidade. Para 4GB+ RAM.',
  },
  'qwen3.5-2b': {
    label: 'Qwen 3.5 2B',
    filename: 'Qwen3.5-2B-Q4_K_M.gguf',
    url: 'https://huggingface.co/unsloth/Qwen3.5-2B-GGUF/resolve/main/Qwen3.5-2B-Q4_K_M.gguf',
    size_bytes: 1_500_000_000,
    ram_minima_gb: 3,
    descricao: 'Leve e rápido. Bom para enrichment com grammar enforcement.',
  },
  'qwen3.5-0.8b': {
    label: 'Qwen 3.5 0.8B',
    filename: 'Qwen3.5-0.8B-Q4_K_M.gguf',
    url: 'https://huggingface.co/unsloth/Qwen3.5-0.8B-GGUF/resolve/main/Qwen3.5-0.8B-Q4_K_M.gguf',
    size_bytes: 580_000_000,
    ram_minima_gb: 2,
    descricao: 'Ultra-leve (~580MB). Para tarefas simples e máquinas com pouca RAM.',
  },
} as const

export type LocalModelId = keyof typeof LOCAL_MODELS

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

function getModelDir(): string {
  try {
    const electron = _require('electron') as { app?: { getPath?: (name: string) => string } }
    const app = electron.app
    if (app?.getPath) {
      // userData: ~/Library/Application Support/EscalaFlow (Mac) — sobrevive a clean/dev/rebuild
      return path.join(app.getPath('userData'), 'models')
    }
  } catch { /* fallback */ }
  return path.join(__dirname, '../../data/models')
}

function getModelPath(modelId: LocalModelId): string {
  return path.join(getModelDir(), LOCAL_MODELS[modelId].filename)
}

function isModelDownloaded(modelId: LocalModelId): boolean {
  const modelPath = getModelPath(modelId)
  if (!fs.existsSync(modelPath)) return false
  const stat = fs.statSync(modelPath)
  return stat.size > LOCAL_MODELS[modelId].size_bytes * 0.95
}

function getActiveLocalModelId(): LocalModelId {
  // Prefere o maior disponível: 9B > 4B > 2B > 0.8B
  if (isModelDownloaded('qwen3.5-9b')) return 'qwen3.5-9b'
  if (isModelDownloaded('qwen3.5-4b')) return 'qwen3.5-4b'
  if (isModelDownloaded('qwen3.5-2b')) return 'qwen3.5-2b'
  if (isModelDownloaded('qwen3.5-0.8b')) return 'qwen3.5-0.8b'
  throw new Error('Nenhum modelo local baixado. Baixe um modelo em Configurações > IA Local.')
}

// ---------------------------------------------------------------------------
// Download com progresso + resume
// ---------------------------------------------------------------------------

let _downloadAbort: AbortController | null = null
let _downloadInProgress: LocalModelId | null = null

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

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        fileStream.write(Buffer.from(value))
        downloaded += value.byteLength
        onProgress(downloaded, total)
      }
    } finally {
      fileStream.end()
      await new Promise<void>((resolve) => fileStream.on('finish', resolve))
    }

    // Renomear .part → .gguf
    fs.renameSync(partPath, finalPath)
    console.log(`[LOCAL-LLM] Download concluído: ${modelId} (${(downloaded / 1e9).toFixed(1)} GB)`)
  } catch (err: any) {
    if (err.name === 'AbortError') {
      console.log(`[LOCAL-LLM] Download cancelado: ${modelId}`)
      return
    }
    throw err
  } finally {
    _downloadAbort = null
    _downloadInProgress = null
  }
}

export function cancelDownload(): void {
  if (_downloadAbort) {
    _downloadAbort.abort()
    _downloadAbort = null
    _downloadInProgress = null
  }
}

export function deleteModel(modelId: LocalModelId): void {
  const modelPath = getModelPath(modelId)
  const partPath = modelPath + '.part'
  if (fs.existsSync(modelPath)) fs.unlinkSync(modelPath)
  if (fs.existsSync(partPath)) fs.unlinkSync(partPath)
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

export async function ensureModelLoaded(): Promise<{ model: any; context: any }> {
  resetIdleTimer()
  const targetModelId = getActiveLocalModelId()

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
  _model = await _llama.loadModel({ modelPath })
  _context = await _model.createContext()
  _loadedModelId = targetModelId

  const elapsed = ((Date.now() - startMs) / 1000).toFixed(1)
  console.log(`[LOCAL-LLM] Modelo carregado em ${elapsed}s`)

  return { model: _model, context: _context }
}

export async function unloadModel(): Promise<void> {
  clearIdleTimer()

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

  for (const [id, m] of Object.entries(LOCAL_MODELS)) {
    const modelPath = getModelPath(id as LocalModelId)
    const partPath = modelPath + '.part'
    const baixado = isModelDownloaded(id as LocalModelId)
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
    }
  }

  return {
    modelos,
    modelo_ativo: _loadedModelId ?? undefined,
    modelo_carregado: !!_model && !!_context,
    ..._downloadInProgress ? {
      download_em_andamento: _downloadInProgress,
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
  let loaded: { model: any; context: any }
  try {
    loaded = await ensureModelLoaded()
  } catch (err: any) {
    const msg = err.message?.includes('memory') || err.message?.includes('OOM')
      ? 'Memória insuficiente para carregar o modelo local. Tente o modelo menor (4B) ou use um provider cloud.'
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

  // Build tools for node-llama-cpp (5 family tools instead of 30 atomic)
  const { IA_TOOLS_PUBLIC } = await import('./tools')
  const { FAMILY_SCHEMAS, executeFamilyTool } = await import('./tool-families')
  const { defineChatSessionFunction } = await getLlamaCpp()

  const functions: Record<string, any> = {}
  const toolCallsCollected: ToolCall[] = []
  let toolCallCounter = 0

  for (const t of IA_TOOLS_PUBLIC) {
    const zodSchema = FAMILY_SCHEMAS[t.name]
    if (!zodSchema) continue

    // Convert Zod to JSON Schema for node-llama-cpp
    const { zodToJsonSchema } = await import('zod-to-json-schema')
    const jsonSchema = zodToJsonSchema(zodSchema as any, { target: 'openApi3' })

    functions[t.name] = defineChatSessionFunction({
      description: t.description,
      params: jsonSchema as any,
      handler: async (params: any) => {
        const callId = `local_${++toolCallCounter}`
        const est = t.name === 'executar_acao' && params?.acao === 'gerar_escala' ? 90
          : t.name === 'executar_acao' && (params?.acao === 'preflight') ? 10
          : undefined
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

  // Build conversation history for node-llama-cpp
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
