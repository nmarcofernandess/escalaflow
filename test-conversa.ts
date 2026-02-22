/**
 * Teste: Conversa real com a IA (mock do DB)
 */

import { generateText, stepCountIs } from 'ai'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { getVercelAiTools } from './src/main/ia/tools'
import { SYSTEM_PROMPT } from './src/main/ia/system-prompt'

const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY

if (!apiKey) {
    console.error('❌ Precisa de GEMINI_API_KEY')
    process.exit(1)
}

// Mock do DB - inserir dados de açougueiros direto na memória
import Database from 'better-sqlite3'
const db = new Database(':memory:')

// Criar tabelas necessárias
db.exec(`
    CREATE TABLE setores (
        id INTEGER PRIMARY KEY,
        nome TEXT,
        hora_abertura TEXT,
        hora_fechamento TEXT,
        ativo INTEGER
    );

    CREATE TABLE colaboradores (
        id INTEGER PRIMARY KEY,
        nome TEXT,
        setor_id INTEGER,
        tipo_contrato_id INTEGER,
        ativo INTEGER,
        tipo_trabalhador TEXT
    );

    CREATE TABLE tipos_contrato (
        id INTEGER PRIMARY KEY,
        nome TEXT,
        horas_semanais INTEGER,
        regime_escala TEXT,
        dias_trabalho INTEGER,
        trabalha_domingo INTEGER,
        max_minutos_dia INTEGER
    );

    INSERT INTO setores VALUES (2, 'Acougue', '07:00', '19:30', 1);
    INSERT INTO tipos_contrato VALUES (1, 'CLT 44h', 44, '5X2', 5, 1, 585);

    INSERT INTO colaboradores VALUES (9, 'Alex', 2, 1, 1, 'CLT');
    INSERT INTO colaboradores VALUES (10, 'Mateus', 2, 1, 1, 'CLT');
    INSERT INTO colaboradores VALUES (11, 'Jose Luiz', 2, 1, 1, 'CLT');
    INSERT INTO colaboradores VALUES (12, 'Jessica', 2, 1, 1, 'CLT');
    INSERT INTO colaboradores VALUES (13, 'Robert', 2, 1, 1, 'CLT');
`)

// Exportar pra tools.ts conseguir acessar
global.mockDb = db

async function conversar() {
    console.log('💬 Iniciando conversa com a IA...\n')

    const google = createGoogleGenerativeAI({ apiKey })
    const tools = getVercelAiTools()
    const messages: any[] = []

    // ========== PERGUNTA 1 ==========
    console.log('👤 USER: Quantos açougueiros temos?\n')

    messages.push({ role: 'user', content: 'Quantos açougueiros temos?' })

    const resp1 = await generateText({
        model: google('gemini-2.5-flash'),
        system: SYSTEM_PROMPT,
        messages,
        tools,
        stopWhen: stepCountIs(10)
    })

    console.log('🤖 ASSISTENTE:', resp1.text)
    console.log('📊 Steps:', resp1.steps?.length || 0)
    console.log()

    messages.push({ role: 'assistant', content: resp1.text })

    // ========== PERGUNTA 2 ==========
    console.log('---\n')
    console.log('👤 USER: Me dá a info deles\n')

    messages.push({ role: 'user', content: 'Me dá a info deles' })

    const resp2 = await generateText({
        model: google('gemini-2.5-flash'),
        system: SYSTEM_PROMPT,
        messages,
        tools,
        stopWhen: stepCountIs(10)
    })

    console.log('🤖 ASSISTENTE:', resp2.text)
    console.log('📊 Steps:', resp2.steps?.length || 0)

    console.log('\n✅ CONVERSA CONCLUÍDA!')
}

conversar().catch(console.error)
