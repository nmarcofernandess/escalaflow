import { generateText, stepCountIs } from 'ai'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
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

export async function iaEnviarMensagem(
    mensagem: string,
    historico: IaMensagem[],
    contexto?: IaContexto
): Promise<{ resposta: string; acoes: ToolCall[] }> {
    const db = getDb()
    const config = db.prepare('SELECT * FROM configuracao_ia LIMIT 1').get() as IaConfiguracao | undefined

    if (!config || !config.ativo) {
        throw new Error('Assistente IA não está ativo ou configurado.')
    }
    if (!config.api_key) {
        throw new Error('API Key da Inteligência Artificial não configurada.')
    }

    if (config.provider === 'gemini') {
        return _callGemini(config, mensagem, historico, contexto)
    }

    throw new Error(`Provider "${config.provider}" não suportado. Apenas Gemini está implementado.`)
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
    const modelo = config.modelo || 'gemini-2.5-flash'

    const google = createGoogleGenerativeAI({ apiKey: config.api_key })

    const contextBriefing = buildContextBriefing(contexto)
    const fullSystemPrompt = contextBriefing
        ? `${SYSTEM_PROMPT}\n\n---\n${contextBriefing}`
        : SYSTEM_PROMPT

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

    const tools = getVercelAiTools()

    console.log('[AI SDK] Chamando generateText com stopWhen...')

    const result = await generateText({
        model: google(modelo),
        system: fullSystemPrompt,
        messages,
        tools,
        stopWhen: stepCountIs(10)  // CRÍTICO: sem isso, para no primeiro tool call!
    })

    console.log('[AI SDK] Resultado:', {
        text: result.text?.substring(0, 50) || '(vazio)',
        stepsCount: result.steps?.length || 0,
        finishReason: result.finishReason
    })

    const acoes: ToolCall[] = []

    if (result.steps) {
        for (const step of result.steps) {
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
    }

    // 🔥 FIX: Se executou tools mas não gerou texto, força resposta
    let finalText = result.text

    if ((!finalText || finalText.trim().length === 0) && acoes.length > 0) {
        console.log('[AI SDK] ⚠️ IA executou tools mas não respondeu. Forçando turno final...')

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
            model: google(modelo),
            system: fullSystemPrompt,
            messages
            // SEM tools → força texto puro, sem tool calls
        })

        finalText = finalResult.text || 'Feito! ✅'
        console.log('[AI SDK] Resposta forçada:', finalText.substring(0, 50))
    }

    return {
        resposta: finalText || '(Resposta vazia)',
        acoes
    }
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
    if (provider !== 'gemini') throw new Error('Apenas o provider Gemini está disponível.')

    try {
        const google = createGoogleGenerativeAI({ apiKey })

        const result = await generateText({
            model: google(modelo),
            prompt: 'Responda apenas: OK'
        })

        return {
            sucesso: true,
            mensagem: `✅ Conectado! Modelo "${modelo}" respondeu: "${result.text.substring(0, 50)}"`
        }
    } catch (err: any) {
        throw new Error(`Modelo "${modelo}" retornou erro: ${err.message}`)
    }
}
