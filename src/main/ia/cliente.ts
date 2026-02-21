import { SYSTEM_PROMPT } from './system-prompt'
import { IA_TOOLS, executeTool } from './tools'
import { getDb } from '../db/database'
import type { IaMensagem, ToolCall, IaConfiguracao } from '../../shared/types'

export async function iaEnviarMensagem(
    mensagem: string,
    historico: IaMensagem[]
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
        return _callGemini(config, mensagem, historico)
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
    historico: IaMensagem[]
): Promise<{ resposta: string; acoes: ToolCall[] }> {
    const modelo = config.modelo || 'gemini-2.5-flash'
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent?key=${config.api_key}`

    // Monta o histórico de conversa no formato Gemini
    // IMPORTANTE: Gemini aceita apenas roles "user" e "model"
    // tool_result NÃO deve ser enviado como role separado aqui — filtramos
    const contents = historico
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

    // Chamada à API
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
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
        return { resposta: '(O modelo não retornou conteúdo)', acoes: [] }
    }

    // Processa a resposta — pode ter text e/ou functionCall
    const acoes: ToolCall[] = []
    let textoResposta = ''

    for (const part of candidate.content.parts) {
        if (part.text) {
            textoResposta += part.text
        }

        if (part.functionCall) {
            const fn = part.functionCall
            const toolRun: ToolCall = {
                id: crypto.randomUUID(),
                name: fn.name,
                args: fn.args,
            }

            try {
                const result = await executeTool(fn.name, fn.args)
                toolRun.result = result
                const resultStr = typeof result === 'object' ? JSON.stringify(result) : String(result)

                // Se não teve texto, gera um resumo básico
                if (!textoResposta) {
                    textoResposta = `Consultei "${fn.name}" e encontrei: ${resultStr.substring(0, 500)}`
                }
            } catch (err: any) {
                toolRun.result = { erro: err.message }
                textoResposta = `Tentei executar "${fn.name}" mas houve um erro: ${err.message}`
            }

            acoes.push(toolRun)
        }
    }

    return {
        resposta: textoResposta || '(Resposta vazia do modelo)',
        acoes,
    }
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
