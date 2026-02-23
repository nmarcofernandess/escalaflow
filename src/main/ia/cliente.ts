import { generateText, stepCountIs } from 'ai'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOpenRouter } from '@openrouter/ai-sdk-provider'
import { SYSTEM_PROMPT } from './system-prompt'
import { getVercelAiTools } from './tools'
import { buildContextBriefing } from './discovery'
import { getDb } from '../db/database'
import type { IaMensagem, ToolCall, IaConfiguracao, IaContexto } from '../../shared/types'

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

function buildChatMessages(historico: IaMensagem[], currentMsg: string) {
    const messages = historico
        .filter(h => h.papel === 'usuario' || h.papel === 'assistente')
        .map(h => ({
            role: h.papel === 'usuario' ? ('user' as const) : ('assistant' as const),
            content: h.conteudo
        }))

    messages.push({
        role: 'user' as const,
        content: currentMsg
    })

    return messages
}

function buildFullSystemPrompt(contexto?: IaContexto) {
    const contextBriefing = buildContextBriefing(contexto)
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

async function _callWithVercelAiSdkTools(
    providerLabel: 'gemini' | 'openrouter',
    config: IaConfiguracao,
    currentMsg: string,
    historico: IaMensagem[],
    contexto: IaContexto | undefined,
    createModel: (modelo: string) => any,
): Promise<{ resposta: string; acoes: ToolCall[] }> {
    const modelo = config.modelo || (providerLabel === 'openrouter' ? 'anthropic/claude-sonnet-4' : 'gemini-2.5-flash')

    const fullSystemPrompt = buildFullSystemPrompt(contexto)
    const messages = buildChatMessages(historico, currentMsg)
    const tools = getVercelAiTools()

    console.log(`[AI SDK:${providerLabel}] Chamando generateText com stopWhen...`)

    const result = await generateText({
        model: createModel(modelo),
        system: fullSystemPrompt,
        messages,
        tools,
        stopWhen: stepCountIs(10)  // CRÍTICO: sem isso, para no primeiro tool call!
    })

    console.log(`[AI SDK:${providerLabel}] Resultado:`, {
        text: result.text?.substring(0, 50) || '(vazio)',
        stepsCount: result.steps?.length || 0,
        finishReason: result.finishReason
    })

    const acoes = extractToolCallsFromSteps(result.steps as any[] | undefined)

    // 🔥 FIX: Se executou tools mas não gerou texto, força resposta
    let finalText = result.text

    if ((!finalText || finalText.trim().length === 0) && acoes.length > 0) {
        console.log(`[AI SDK:${providerLabel}] ⚠️ IA executou tools mas não respondeu. Forçando turno final...`)

        // Adiciona mensagem pedindo pra responder
        messages.push({
            role: 'assistant' as const,
            content: '(executou ferramentas)'
        })
        messages.push({
            role: 'user' as const,
            content: 'Responda agora em linguagem natural o que você fez e o resultado.'
        })

        const finalResult = await generateText({
            model: createModel(modelo),
            system: fullSystemPrompt,
            messages
            // SEM tools → força texto puro, sem tool calls
        })

        finalText = finalResult.text || 'Feito! ✅'
        console.log(`[AI SDK:${providerLabel}] Resposta forçada:`, finalText.substring(0, 50))
    }

    return {
        resposta: finalText || '(Resposta vazia)',
        acoes
    }
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
    const db = getDb()
    const config = db.prepare('SELECT * FROM configuracao_ia LIMIT 1').get() as IaConfiguracao | undefined

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
