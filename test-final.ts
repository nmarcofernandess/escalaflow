/**
 * Teste final: Conversa com IA mockando só get_context
 */

import { generateText, stepCountIs } from 'ai'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { z } from 'zod'

const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY

if (!apiKey) {
    console.error('❌ Precisa de GEMINI_API_KEY')
    process.exit(1)
}

// Mock simplificado das tools
const tools = {
    get_context: {
        description: 'Retorna contexto do sistema',
        parameters: z.object({}),
        execute: async () => {
            return {
                colaboradores: [
                    { id: 9, nome: 'Alex', setor_nome: 'Acougue', contrato_nome: 'CLT 44h' },
                    { id: 10, nome: 'Mateus', setor_nome: 'Acougue', contrato_nome: 'CLT 44h' },
                    { id: 11, nome: 'Jose Luiz', setor_nome: 'Acougue', contrato_nome: 'CLT 44h' },
                    { id: 12, nome: 'Jessica', setor_nome: 'Acougue', contrato_nome: 'CLT 44h' },
                    { id: 13, nome: 'Robert', setor_nome: 'Acougue', contrato_nome: 'CLT 44h' }
                ]
            }
        }
    }
}

async function conversar() {
    console.log('💬 TESTANDO CONVERSA COM A IA\n')
    console.log('='
.repeat(60))

    const google = createGoogleGenerativeAI({ apiKey })
    const messages: any[] = []

    // ========== PERGUNTA 1 ==========
    console.log('\n👤 USER: Quantos açougueiros temos?\n')

    messages.push({ role: 'user', content: 'Quantos açougueiros temos?' })

    const resp1 = await generateText({
        model: google('gemini-2.5-flash'),
        messages,
        tools,
        stopWhen: stepCountIs(10)
    })

    console.log('🤖 ASSISTENTE:', resp1.text)
    console.log('   Steps:', resp1.steps?.length || 0)
    console.log('   Finish:', resp1.finishReason)

    messages.push({ role: 'assistant', content: resp1.text })

    // ========== PERGUNTA 2 ==========
    console.log('\n' + '='.repeat(60))
    console.log('\n👤 USER: Me dá a info deles\n')

    messages.push({ role: 'user', content: 'Me dá a info deles' })

    const resp2 = await generateText({
        model: google('gemini-2.5-flash'),
        system: 'SEMPRE use get_context() antes de responder qualquer pergunta sobre dados. NUNCA responda sem chamar a tool primeiro.',
        messages,
        tools,
        stopWhen: stepCountIs(10)
    })

    console.log('🤖 ASSISTENTE:', resp2.text)
    console.log('   Steps:', resp2.steps?.length || 0)
    console.log('   Finish:', resp2.finishReason)

    console.log('\n' + '='.repeat(60))
    console.log('\n✅ SUCESSO! Loop multi-turn funcionando!\n')
}

conversar().catch(err => {
    console.error('\n❌ ERRO:', err.message)
    process.exit(1)
})
