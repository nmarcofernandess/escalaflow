import { SYSTEM_PROMPT } from './system-prompt'
import { IA_TOOLS, executeTool } from './tools'
import { buildContextBriefing } from './discovery'
import { getDb } from '../db/database'
import type { IaMensagem, ToolCall, IaConfiguracao, IaContexto } from '../../shared/types'

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
// GEMINI — REST API v1beta
// Docs: https://ai.google.dev/gemini-api/docs/function-calling
// =============================================================================

async function _callGemini(
    config: IaConfiguracao,
    currentMsg: string,
    historico: IaMensagem[],
    contexto?: IaContexto
): Promise<{ resposta: string; acoes: ToolCall[] }> {
    const modelo = config.modelo || 'gemini-3-flash-preview'
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent?key=${config.api_key}`

    // Auto-discovery: busca dados relevantes do DB baseado na página atual
    const contextBriefing = buildContextBriefing(contexto)
    const fullSystemPrompt = contextBriefing
        ? `${SYSTEM_PROMPT}\n\n---\n${contextBriefing}`
        : SYSTEM_PROMPT

    // Monta o histórico de conversa no formato Gemini
    // IMPORTANTE: Gemini aceita apenas roles "user" e "model"
    const contents: Array<{ role: string; parts: any[] }> = historico
        .filter(h => h.papel === 'usuario' || h.papel === 'assistente')
        .map(h => ({
            role: h.papel === 'usuario' ? 'user' : 'model',
            parts: [{ text: h.conteudo }],
        }))

    // Adiciona a mensagem atual
    contents.push({ role: 'user', parts: [{ text: currentMsg }] })

    // Monta as declarações de ferramentas
    const tools = [{
        functionDeclarations: IA_TOOLS.map(t => ({
            name: t.name,
            description: t.description,
            parameters: t.parameters,
        })),
    }]

    const acoes: ToolCall[] = []
    const MAX_TURNS = 10

    // Loop multi-turn: Gemini pode chamar tools múltiplas vezes antes de responder em texto
    for (let turn = 0; turn < MAX_TURNS; turn++) {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                systemInstruction: { parts: [{ text: fullSystemPrompt }] },
                contents,
                tools,
            }),
        })

        if (!res.ok) {
            const text = await res.text()
            throw new Error(`Gemini ${modelo} retornou erro ${res.status}: ${text}`)
        }

        const data = await res.json()
        const candidate = data.candidates?.[0]

        if (!candidate?.content?.parts?.length) {
            return { resposta: '(O modelo não retornou conteúdo)', acoes }
        }

        // Adiciona a resposta do modelo ao histórico de contexto
        contents.push({ role: 'model', parts: candidate.content.parts })

        // Verifica se há functionCalls nesta resposta
        const functionCallParts = candidate.content.parts.filter((p: any) => p.functionCall)

        if (functionCallParts.length === 0) {
            // Sem mais tool calls — extrai texto e retorna
            const textoResposta = candidate.content.parts
                .filter((p: any) => p.text)
                .map((p: any) => p.text as string)
                .join('')
            return {
                resposta: textoResposta || '(Resposta vazia do modelo)',
                acoes,
            }
        }

        // Executa todas as tools deste turno e coleta functionResponses
        const functionResponseParts: any[] = []

        for (const part of functionCallParts) {
            const fn = part.functionCall
            const toolRun: ToolCall = {
                id: crypto.randomUUID(),
                name: fn.name,
                args: fn.args,
            }

            try {
                const result = await executeTool(fn.name, fn.args)
                toolRun.result = result
                functionResponseParts.push({
                    functionResponse: {
                        name: fn.name,
                        response: result,
                    },
                })
            } catch (err: any) {
                toolRun.result = { erro: err.message }
                functionResponseParts.push({
                    functionResponse: {
                        name: fn.name,
                        response: { erro: err.message },
                    },
                })
            }

            acoes.push(toolRun)
        }

        // Envia os resultados das tools de volta ao Gemini como turno 'user'
        // Isso permite que o modelo veja os resultados e continue raciocínando
        contents.push({ role: 'user', parts: functionResponseParts })
    }

    // Limite de turnos atingido — retorna o texto do último turno model
    const lastModelTurn = [...contents].reverse().find(c => c.role === 'model')
    const lastText = lastModelTurn?.parts
        .filter((p: any) => p.text)
        .map((p: any) => p.text as string)
        .join('') ?? ''
    return { resposta: lastText || '(Limite de turnos de ferramentas atingido)', acoes }
}

// =============================================================================
// TESTE DE CONEXÃO REAL
// Faz uma chamada generateContent real com o modelo especificado
// =============================================================================

export async function iaTestarConexao(
    provider: string,
    apiKey: string,
    modelo: string
): Promise<{ sucesso: boolean; mensagem: string }> {
    if (!apiKey) throw new Error('API Key não fornecida.')
    if (provider !== 'gemini') throw new Error('Apenas o provider Gemini está disponível.')

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent?key=${apiKey}`

    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: 'Responda apenas: OK' }] }],
        }),
    })

    if (!res.ok) {
        const body = await res.text()
        let msg = `Modelo "${modelo}" retornou erro ${res.status}.`
        try {
            const parsed = JSON.parse(body)
            if (parsed.error?.message) {
                msg = parsed.error.message
            }
        } catch { /* ignore parse error */ }
        throw new Error(msg)
    }

    const data = await res.json()
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text

    if (!text) {
        throw new Error(`Modelo "${modelo}" respondeu mas sem conteúdo de texto. Pode não suportar generateContent.`)
    }

    return {
        sucesso: true,
        mensagem: `✅ Conectado! Modelo "${modelo}" respondeu: "${text.substring(0, 50)}"`,
    }
}
