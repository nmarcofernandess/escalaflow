import { generateText, streamText, stepCountIs, wrapLanguageModel } from 'ai'
import type { ModelMessage } from '@ai-sdk/provider-utils'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOpenRouter } from '@openrouter/ai-sdk-provider'
import { SYSTEM_PROMPT } from './system-prompt'
import { getVercelAiTools } from './tools'
import { buildContextBriefing } from './discovery'
import { ingestKnowledge } from '../knowledge/ingest'
import { queryOne } from '../db/query'
import type { IaMensagem, ToolCall, IaConfiguracao, IaContexto, IaStreamEvent } from '../../shared/types'

import { createRequire } from 'node:module'
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

let _devToolsModeResolved = false
let _devToolsEnabled = false
let _devToolsMiddlewareFactory: null | (() => any) = null

const TOOL_RESULT_MAX_CHARS = 400
const TOOL_RESULT_LEGACY_MAX_CHARS = 320

function shouldEnableAiDevTools() {
    const explicit = process.env.ESCALAFLOW_AI_DEVTOOLS?.trim()
    if (explicit === '0' || explicit?.toLowerCase() === 'false') return false
    if (explicit === '1' || explicit?.toLowerCase() === 'true') return true
    return process.env.NODE_ENV !== 'production'
}

async function maybeWrapModelWithDevTools(model: any) {
    if (!shouldEnableAiDevTools()) return model

    if (!_devToolsModeResolved) {
        _devToolsModeResolved = true
        try {
            const mod = await import('@ai-sdk/devtools')
            if (typeof mod.devToolsMiddleware === 'function') {
                _devToolsMiddlewareFactory = mod.devToolsMiddleware
                _devToolsEnabled = true
                console.log('[AI SDK] DevTools middleware ativo (local). Rode `npx @ai-sdk/devtools` e abra http://localhost:4983')
            } else {
                console.warn('[AI SDK] @ai-sdk/devtools carregado, mas devToolsMiddleware não foi encontrado. Seguiremos sem viewer.')
            }
        } catch (err: any) {
            console.warn('[AI SDK] DevTools indisponível; seguindo sem middleware.', err?.message ?? err)
        }
    }

    if (!_devToolsEnabled || !_devToolsMiddlewareFactory) return model

    return wrapLanguageModel({
        model,
        middleware: _devToolsMiddlewareFactory(),
    })
}

// Tool calls UI depends on property presence (including falsy values like null/false/0),
// so we must preserve whether a field existed instead of relying on truthiness.
function hasOwn(value: unknown, key: string): boolean {
    return typeof value === 'object' && value !== null && Object.prototype.hasOwnProperty.call(value, key)
}

// AI SDK v6 tool call input can be non-object in some providers/edge cases.
// We normalize to a record because our shared ToolCall contract stores args as an object.
function normalizeToolArgs(rawArgs: unknown): Record<string, unknown> | undefined {
    if (rawArgs === undefined) return undefined
    if (typeof rawArgs === 'object' && rawArgs !== null && !Array.isArray(rawArgs)) {
        return rawArgs as Record<string, unknown>
    }
    return { value: rawArgs }
}

function truncateText(text: string, maxChars: number): string {
    if (text.length <= maxChars) return text
    return `${text.slice(0, Math.max(0, maxChars - 1))}…`
}

function safeCompactJson(value: unknown, maxChars: number): string {
    try {
        const raw = typeof value === 'string' ? value : JSON.stringify(value)
        return truncateText(raw, maxChars)
    } catch {
        return truncateText(String(value), maxChars)
    }
}

function toolResultToText(result: unknown): string {
    if (result === undefined) return 'resultado_nao_persistido'
    if (result === null) return 'null'
    return safeCompactJson(result, TOOL_RESULT_MAX_CHARS)
}

function buildLegacyToolResultHistoryContent(msg: IaMensagem): string {
    const compact = truncateText(msg.conteudo ?? '', TOOL_RESULT_LEGACY_MAX_CHARS)
    return `[TOOL_RESULT_LEGADO]\n${compact}`
}

function buildChatMessages(historico: IaMensagem[], currentMsg: string): ModelMessage[] {
    const messages: ModelMessage[] = []

    for (const h of historico) {
        if (h.papel === 'usuario') {
            messages.push({ role: 'user', content: h.conteudo })
            continue
        }

        if (h.papel === 'assistente') {
            const toolCalls = h.tool_calls
            if (toolCalls && toolCalls.length > 0) {
                // Structured assistant message with tool-call parts
                const contentParts: Array<{ type: 'text'; text: string } | { type: 'tool-call'; toolCallId: string; toolName: string; input: unknown }> = []
                if (h.conteudo?.trim()) {
                    contentParts.push({ type: 'text', text: h.conteudo })
                }
                for (const tc of toolCalls) {
                    contentParts.push({
                        type: 'tool-call',
                        toolCallId: tc.id,
                        toolName: tc.name,
                        input: tc.args ?? {},
                    })
                }
                messages.push({ role: 'assistant', content: contentParts })

                // Paired tool message with tool-result parts
                const resultParts: Array<{ type: 'tool-result'; toolCallId: string; toolName: string; output: { type: 'text'; value: string } }> = []
                for (const tc of toolCalls) {
                    resultParts.push({
                        type: 'tool-result',
                        toolCallId: tc.id,
                        toolName: tc.name,
                        output: { type: 'text', value: toolResultToText(tc.result) },
                    })
                }
                messages.push({ role: 'tool', content: resultParts })
            } else {
                // Plain text assistant message
                messages.push({ role: 'assistant', content: h.conteudo ?? '' })
            }
            continue
        }

        if (h.papel === 'tool_result') {
            // Legacy tool_result rows from before structured messages — keep as assistant text
            messages.push({
                role: 'assistant',
                content: buildLegacyToolResultHistoryContent(h),
            })
        }
    }

    messages.push({ role: 'user', content: currentMsg })
    return messages
}

async function buildFullSystemPrompt(contexto?: IaContexto) {
    const contextBriefing = await buildContextBriefing(contexto)
    return contextBriefing
        ? `${SYSTEM_PROMPT}\n\n---\n${contextBriefing}`
        : SYSTEM_PROMPT
}

function extractToolCallsFromSteps(steps: any[] | undefined): ToolCall[] {
    const acoes: ToolCall[] = []
    if (!steps) return acoes

    for (const step of steps) {
        if (!step.toolCalls || step.toolCalls.length === 0) continue

        const stepToolResults = (step.toolResults ?? []) as any[]
        const toolResultsById = new Map<string, any>()

        for (const tr of stepToolResults) {
            if (tr?.toolCallId) {
                toolResultsById.set(tr.toolCallId, tr)
            }
        }

        for (let i = 0; i < step.toolCalls.length; i++) {
            const tc = step.toolCalls[i] as any
            // Pair by toolCallId first. Array index is only a compatibility fallback.
            const tr = toolResultsById.get(tc.toolCallId) ?? stepToolResults[i]
            // AI SDK v6 uses input/output. Keep args/result fallbacks for compatibility with older payloads.
            const args = normalizeToolArgs(tc?.input ?? tc?.args)

            const hasResultProp =
                hasOwn(tr, 'output') ||
                hasOwn(tr, 'result') ||
                hasOwn(tr, 'error')

            const resultValue = hasOwn(tr, 'output')
                ? tr.output
                : hasOwn(tr, 'result')
                    ? tr.result
                    : hasOwn(tr, 'error')
                        ? tr.error
                        : undefined

            acoes.push({
                id: tc.toolCallId,
                name: tc.toolName,
                ...(args !== undefined ? { args } : {}),
                ...(hasResultProp ? { result: resultValue } : {})
            })
        }
    }

    return acoes
}

/**
 * Auto-capture conservador: salva como LOW importance se a resposta contém
 * fatos CLT/legislativos explícitos que não são meros dados do banco.
 * Fire-and-forget — falha silenciosamente.
 */
async function maybeAutoCapture(response: string): Promise<void> {
    try {
        if (!response || response.length < 100) return
        // Heurística: menção a artigo de lei, CLT, CCT, legislação
        const legalKeywords = /\b(Art\.\s*\d+|CLT|CCT|Lei\s+\d+|Portaria|NR-?\d+|ECA|interjornada|intrajornada)\b/i
        if (!legalKeywords.test(response)) return

        // Extrai um título a partir dos primeiros 80 chars da resposta
        const titulo = `Auto: ${response.slice(0, 80).replace(/\n/g, ' ').trim()}...`
        // Salva apenas o trecho relevante (primeiros 2000 chars)
        const conteudo = response.slice(0, 2000)

        await ingestKnowledge(titulo, conteudo, 'low')
        console.log('[AI SDK] Auto-capture: conhecimento salvo como LOW')
    } catch {
        // Non-critical — falha silenciosa
    }
}

// Test hooks for unit tests of mapper/history behavior.
// Keeping these internal helpers accessible avoids mocking the whole provider stack.
export const __iaClienteTestables = {
    normalizeToolArgs,
    buildChatMessages,
    extractToolCallsFromSteps,
    buildFullSystemPrompt,
}

async function _callWithVercelAiSdkTools(
    providerLabel: 'gemini' | 'openrouter',
    config: IaConfiguracao,
    currentMsg: string,
    historico: IaMensagem[],
    contexto: IaContexto | undefined,
    createModel: (modelo: string) => any,
): Promise<{ resposta: string; acoes: ToolCall[] }> {
    const modelo = config.modelo || (providerLabel === 'openrouter' ? 'anthropic/claude-sonnet-4' : 'gemini-2.5-flash')

    const fullSystemPrompt = await buildFullSystemPrompt(contexto)
    const messages = buildChatMessages(historico, currentMsg)
    const tools = getVercelAiTools()
    const model = await maybeWrapModelWithDevTools(createModel(modelo))

    const result = await generateText({
        model,
        system: fullSystemPrompt,
        messages,
        tools,
        stopWhen: stepCountIs(10),
        onStepFinish({ text, toolCalls, finishReason, usage }) {
            console.log(`[AI SDK:${providerLabel}] Step:`, {
                finishReason,
                hasText: !!text,
                toolCalls: toolCalls?.length ?? 0,
                tokens: usage?.totalTokens,
            })
        },
    })

    const acoes = extractToolCallsFromSteps(result.steps as any[] | undefined)

    // If model ran tools but produced no final text, do a clean follow-up
    // using the structured response messages (preserves real tool results).
    let finalText = result.text

    if ((!finalText || finalText.trim().length === 0) && acoes.length > 0) {
        console.log(`[AI SDK:${providerLabel}] Executou tools sem texto final. Follow-up com response.messages...`)

        const followUpMessages: ModelMessage[] = [
            ...result.response.messages,
            { role: 'user', content: 'Com base nos resultados das ferramentas, responda ao usuario.' },
        ]

        const finalResult = await generateText({
            model,
            system: fullSystemPrompt,
            messages: followUpMessages,
        })

        finalText = finalResult.text || 'Feito!'
        console.log(`[AI SDK:${providerLabel}] Follow-up:`, finalText.substring(0, 80))
    }

    const resposta = finalText || '(Resposta vazia)'

    // Auto-capture fire-and-forget
    maybeAutoCapture(resposta).catch(() => {})

    return { resposta, acoes }
}

async function _callWithVercelAiSdkToolsStreaming(
    providerLabel: 'gemini' | 'openrouter',
    config: IaConfiguracao,
    currentMsg: string,
    historico: IaMensagem[],
    streamId: string,
    contexto: IaContexto | undefined,
    createModel: (modelo: string) => any,
): Promise<{ resposta: string; acoes: ToolCall[] }> {
    const modelo = config.modelo || (providerLabel === 'openrouter' ? 'anthropic/claude-sonnet-4' : 'gemini-2.5-flash')

    const fullSystemPrompt = await buildFullSystemPrompt(contexto)
    const messages = buildChatMessages(historico, currentMsg)
    const tools = getVercelAiTools()
    const model = await maybeWrapModelWithDevTools(createModel(modelo))

    let stepIndex = 0

    try {
        const result = streamText({
            model,
            system: fullSystemPrompt,
            messages,
            tools,
            stopWhen: stepCountIs(10),
            onStepFinish({ text, toolCalls, finishReason, usage }) {
                console.log(`[AI SDK:${providerLabel}:stream] Step ${stepIndex}:`, {
                    finishReason,
                    hasText: !!text,
                    toolCalls: toolCalls?.length ?? 0,
                    tokens: usage?.totalTokens,
                })
                emitStream({ type: 'step-finish', stream_id: streamId, step_index: stepIndex })
                stepIndex++
            },
        })

        for await (const part of result.fullStream) {
            if (part.type === 'text-delta') {
                emitStream({ type: 'text-delta', stream_id: streamId, delta: part.text })
            } else if (part.type === 'tool-call') {
                emitStream({
                    type: 'tool-call-start',
                    stream_id: streamId,
                    tool_call_id: part.toolCallId,
                    tool_name: part.toolName,
                    args: normalizeToolArgs(part.input) ?? {},
                })
            } else if (part.type === 'tool-result') {
                emitStream({
                    type: 'tool-result',
                    stream_id: streamId,
                    tool_call_id: part.toolCallId,
                    tool_name: part.toolName,
                    result: part.output,
                })
            }
        }

        const finalText = await result.text
        const steps = await result.steps
        const acoes = extractToolCallsFromSteps(steps as any[] | undefined)

        // Follow-up: if tools ran but no final text, do a streaming follow-up
        if ((!finalText || finalText.trim().length === 0) && acoes.length > 0) {
            console.log(`[AI SDK:${providerLabel}:stream] Tools sem texto final. Follow-up streaming...`)
            emitStream({ type: 'follow-up-start', stream_id: streamId })

            const responseMessages = await result.response
            const followUpMessages: ModelMessage[] = [
                ...responseMessages.messages,
                { role: 'user', content: 'Com base nos resultados das ferramentas, responda ao usuario.' },
            ]

            const followUp = streamText({
                model,
                system: fullSystemPrompt,
                messages: followUpMessages,
            })

            for await (const part of followUp.fullStream) {
                if (part.type === 'text-delta') {
                    emitStream({ type: 'text-delta', stream_id: streamId, delta: part.text })
                }
            }

            const followUpText = await followUp.text
            const resposta = followUpText || 'Feito!'

            emitStream({ type: 'finish', stream_id: streamId, resposta, acoes })
            maybeAutoCapture(resposta).catch(() => {})
            return { resposta, acoes }
        }

        const resposta = finalText || '(Resposta vazia)'
        emitStream({ type: 'finish', stream_id: streamId, resposta, acoes })
        maybeAutoCapture(resposta).catch(() => {})
        return { resposta, acoes }
    } catch (err: any) {
        console.error(`[AI SDK:${providerLabel}:stream] Erro:`, err.message)
        emitStream({ type: 'error', stream_id: streamId, message: err.message })
        throw err
    }
}

export async function iaEnviarMensagemStream(
    mensagem: string,
    historico: IaMensagem[],
    streamId: string,
    contexto?: IaContexto
): Promise<{ resposta: string; acoes: ToolCall[] }> {
    const config = await queryOne<IaConfiguracao>('SELECT * FROM configuracao_ia LIMIT 1')

    if (!config) {
        throw new Error('Assistente IA não configurado.')
    }

    const apiKey = resolveProviderApiKey(config)

    if (config.provider === 'gemini') {
        if (!apiKey) throw new Error('API Key do Gemini não configurada.')
        const google = createGoogleGenerativeAI({ apiKey })
        return _callWithVercelAiSdkToolsStreaming('gemini', { ...config, api_key: apiKey }, mensagem, historico, streamId, contexto, (modelo) => google(modelo))
    }

    if (config.provider === 'openrouter') {
        if (!apiKey) throw new Error('Token do OpenRouter não configurado.')
        const openrouter = createOpenRouter({ apiKey })
        return _callWithVercelAiSdkToolsStreaming('openrouter', { ...config, api_key: apiKey }, mensagem, historico, streamId, contexto, (modelo) => openrouter(modelo))
    }

    throw new Error(`Provider "${config.provider}" não suportado.`)
}

function resolveProviderApiKey(config: IaConfiguracao): string | undefined {
    // provider_configs_json tem prioridade — é onde a UI multi-provider salva tokens
    if (config.provider_configs_json) {
        try {
            const configs = typeof config.provider_configs_json === 'string'
                ? JSON.parse(config.provider_configs_json)
                : config.provider_configs_json
            const providerCfg = configs?.[config.provider]
            if (providerCfg?.token?.trim()) return providerCfg.token.trim()
        } catch { /* fallback to api_key */ }
    }
    return config.api_key || undefined
}

export async function iaEnviarMensagem(
    mensagem: string,
    historico: IaMensagem[],
    contexto?: IaContexto
): Promise<{ resposta: string; acoes: ToolCall[] }> {
    const config = await queryOne<IaConfiguracao>('SELECT * FROM configuracao_ia LIMIT 1')

    if (!config) {
        throw new Error('Assistente IA não configurado.')
    }

    const apiKey = resolveProviderApiKey(config)

    if (config.provider === 'gemini') {
        if (!apiKey) {
            throw new Error('API Key do Gemini não configurada.')
        }
        return _callGemini({ ...config, api_key: apiKey }, mensagem, historico, contexto)
    }

    if (config.provider === 'openrouter') {
        if (!apiKey) {
            throw new Error('Token do OpenRouter não configurado.')
        }
        return _callOpenRouter({ ...config, api_key: apiKey }, mensagem, historico, contexto)
    }

    throw new Error(`Provider "${config.provider}" não suportado. Providers disponíveis: Gemini e OpenRouter.`)
}

// =============================================================================
// GEMINI — Vercel AI SDK (CÓDIGO QUE FUNCIONOU NO TESTE!)
// =============================================================================

async function _callGemini(
    config: IaConfiguracao,
    currentMsg: string,
    historico: IaMensagem[],
    contexto?: IaContexto
): Promise<{ resposta: string; acoes: ToolCall[] }> {
    const google = createGoogleGenerativeAI({ apiKey: config.api_key })
    return _callWithVercelAiSdkTools(
        'gemini',
        config,
        currentMsg,
        historico,
        contexto,
        (modelo) => google(modelo),
    )
}

async function _callOpenRouter(
    config: IaConfiguracao,
    currentMsg: string,
    historico: IaMensagem[],
    contexto?: IaContexto
): Promise<{ resposta: string; acoes: ToolCall[] }> {
    const openrouter = createOpenRouter({ apiKey: config.api_key })
    return _callWithVercelAiSdkTools(
        'openrouter',
        config,
        currentMsg,
        historico,
        contexto,
        (modelo) => openrouter(modelo),
    )
}

// =============================================================================
// TESTE DE CONEXÃO
// =============================================================================

export async function iaTestarConexao(
    provider: string,
    apiKey: string,
    modelo: string
): Promise<{ sucesso: boolean; mensagem: string }> {
    if (!apiKey) throw new Error('API Key não fornecida.')
    try {
        if (provider === 'gemini') {
            const google = createGoogleGenerativeAI({ apiKey })

            const result = await generateText({
                model: google(modelo),
                prompt: 'Responda apenas: OK'
            })

            return {
                sucesso: true,
                mensagem: `✅ Conectado! Modelo "${modelo}" respondeu: "${result.text.substring(0, 50)}"`
            }
        }

        if (provider === 'openrouter') {
            const openrouter = createOpenRouter({ apiKey })
            const result = await generateText({
                model: openrouter(modelo),
                prompt: 'Responda apenas: OK'
            })

            return {
                sucesso: true,
                mensagem: `✅ OpenRouter conectado! Modelo "${modelo}" respondeu: "${result.text.substring(0, 50)}"`
            }
        }

        throw new Error(`Provider "${provider}" ainda não suporta teste por API nesta rota.`)
    } catch (err: any) {
        throw new Error(`Modelo "${modelo}" retornou erro: ${err.message}`)
    }
}
