import '../../setup/load-env'
import * as readline from 'readline/promises'
import { stdin, stdout } from 'process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { generateText, stepCountIs } from 'ai'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOpenRouter } from '@openrouter/ai-sdk-provider'

type Provider = 'gemini' | 'openrouter'

const COLORS = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  magenta: '\x1b[35m',
  red: '\x1b[31m',
  gray: '\x1b[90m',
}

function c(color: keyof typeof COLORS, text: string) {
  return `${COLORS[color]}${text}${COLORS.reset}`
}

async function loadRuntime() {
  const [{ getVercelAiTools }, { SYSTEM_PROMPT }, { buildContextBriefing }] = await Promise.all([
    import('../../../src/main/ia/tools'),
    import('../../../src/main/ia/system-prompt'),
    import('../../../src/main/ia/discovery'),
  ])
  return { getVercelAiTools, SYSTEM_PROMPT, buildContextBriefing }
}

function parseArgs(): { provider: Provider; setorId?: number; pagina?: string } {
  const args = process.argv.slice(2)
  const providerIdx = args.indexOf('--provider')
  const provider = (providerIdx >= 0 ? args[providerIdx + 1] : 'gemini') as Provider
  if (provider !== 'gemini' && provider !== 'openrouter') {
    console.error(`Provider invalido: ${provider}. Use: gemini | openrouter`)
    process.exit(1)
  }
  const setorIdx = args.indexOf('--setor')
  const setorId = setorIdx >= 0 ? parseInt(args[setorIdx + 1], 10) : undefined
  const paginaIdx = args.indexOf('--pagina')
  const pagina = paginaIdx >= 0 ? args[paginaIdx + 1] : undefined
  return { provider, setorId, pagina }
}

function getApiKey(provider: Provider): string {
  const key = provider === 'openrouter'
    ? process.env.OPENROUTER_API_KEY?.trim()
    : (process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim() || process.env.GEMINI_API_KEY?.trim())

  if (!key) {
    console.error(c('red', `API key ausente para ${provider}. Configure .env.local`))
    process.exit(1)
  }
  return key
}

function createModel(provider: Provider, apiKey: string) {
  const modelName = provider === 'openrouter' ? 'anthropic/claude-sonnet-4' : 'gemini-2.5-flash'
  const model = provider === 'openrouter'
    ? createOpenRouter({ apiKey })(modelName)
    : createGoogleGenerativeAI({ apiKey })(modelName)
  return { model, modelName }
}

function summarizeResult(result: unknown): string {
  if (result === undefined || result === null) return 'null'
  const raw = typeof result === 'string' ? result : JSON.stringify(result)
  return raw.length > 200 ? raw.slice(0, 197) + '...' : raw
}

type HistoryMsg = { role: 'user'; content: string } | { role: 'assistant'; content: string }

async function main() {
  const { provider, setorId, pagina } = parseArgs()

  // ── DB init (deve vir antes de qualquer import que use queryOne/queryAll) ──
  const __dirname = path.dirname(fileURLToPath(import.meta.url))
  const rootDir = path.resolve(__dirname, '../../..')
  process.env.ESCALAFLOW_DB_PATH =
    process.env.ESCALAFLOW_DB_PATH || path.join(rootDir, 'out', 'data', 'escalaflow-pg')

  const { initDb } = await import('../../../src/main/db/pglite')
  const { createTables } = await import('../../../src/main/db/schema')
  await initDb()
  await createTables()
  console.log(c('green', '[OK] Banco inicializado'))

  const apiKey = getApiKey(provider)
  const { model, modelName } = createModel(provider, apiKey)

  // ── Header ────────────────────────────────────────────────────────────────
  console.log('')
  console.log(c('cyan', '╔══════════════════════════════════════════════╗'))
  console.log(c('cyan', '║') + c('bold', '  EscalaFlow IA — CLI Chat                   ') + c('cyan', '║'))
  console.log(c('cyan', '╠══════════════════════════════════════════════╣'))
  console.log(c('cyan', '║') + `  Provider: ${c('green', provider.padEnd(32))}` + c('cyan', '║'))
  console.log(c('cyan', '║') + `  Model:    ${c('green', modelName.padEnd(32))}` + c('cyan', '║'))
  if (setorId !== undefined) {
    console.log(c('cyan', '║') + `  Setor:    ${c('green', String(setorId).padEnd(32))}` + c('cyan', '║'))
  }
  if (pagina) {
    console.log(c('cyan', '║') + `  Pagina:   ${c('green', pagina.padEnd(32))}` + c('cyan', '║'))
  }
  console.log(c('cyan', '╠══════════════════════════════════════════════╣'))
  console.log(c('cyan', '║') + c('dim', '  /clear  limpa historico                     ') + c('cyan', '║'))
  console.log(c('cyan', '║') + c('dim', '  /tools  lista tools disponiveis             ') + c('cyan', '║'))
  console.log(c('cyan', '║') + c('dim', '  sair    encerra                             ') + c('cyan', '║'))
  console.log(c('cyan', '╚══════════════════════════════════════════════╝'))
  console.log('')

  // ── Runtime ───────────────────────────────────────────────────────────────
  let runtime: Awaited<ReturnType<typeof loadRuntime>>
  try {
    runtime = await loadRuntime()
    console.log(c('green', `[OK] Runtime carregado — ${Object.keys(runtime.getVercelAiTools()).length} tools`))
  } catch (err: any) {
    console.error(c('red', `[ERRO] Falha ao carregar runtime: ${err.message}`))
    process.exit(1)
  }

  // ── Context briefing (opcional) ───────────────────────────────────────────
  const contexto = setorId !== undefined
    ? {
        pagina: pagina || 'setor_detalhe',
        rota: `/setores/${setorId}`,
        setor_id: setorId,
      }
    : undefined

  if (contexto !== undefined) {
    const initialBriefing = await runtime.buildContextBriefing(contexto as any)
    console.log(c('green', `[OK] Contexto injetado — setor ${setorId} (${initialBriefing.length} chars)`))
  }

  const tools = runtime.getVercelAiTools()
  const systemPrompt = runtime.SYSTEM_PROMPT

  let history: HistoryMsg[] = []

  const rl = readline.createInterface({ input: stdin, output: stdout })

  console.log(c('dim', 'Pronto! Digite sua mensagem.\n'))

  while (true) {
    let input: string
    try {
      input = await rl.question(c('yellow', 'Voce > '))
    } catch {
      break
    }

    const trimmed = input.trim()
    if (!trimmed) continue
    if (trimmed.toLowerCase() === 'sair' || trimmed.toLowerCase() === 'exit') {
      console.log(c('dim', '\nAte mais!\n'))
      break
    }

    if (trimmed === '/clear') {
      history = []
      console.log(c('dim', 'Historico limpo.\n'))
      continue
    }

    if (trimmed === '/tools') {
      const names = Object.keys(tools)
      console.log(c('cyan', `\n${names.length} tools:`))
      for (const n of names) console.log(c('dim', `  - ${n}`))
      console.log('')
      continue
    }

    // Rebuild context per-message passing trimmed so Auto-RAG runs on user input
    const contextBriefing = contexto !== undefined
      ? await runtime.buildContextBriefing(contexto as any, trimmed)
      : ''
    const fullSystemPrompt = contextBriefing
      ? `${systemPrompt}\n\n${contextBriefing}`
      : systemPrompt

    history.push({ role: 'user', content: trimmed })

    try {
      const result = await generateText({
        model,
        system: fullSystemPrompt,
        messages: history as any,
        tools,
        stopWhen: stepCountIs(10),
        onStepFinish({ toolCalls, finishReason }) {
          if (toolCalls && toolCalls.length > 0) {
            for (const tc of toolCalls) {
              const argsSummary = tc.input ? JSON.stringify(tc.input).slice(0, 100) : ''
              console.log(c('magenta', `  [TOOL] ${(tc as any).toolName}`) + c('dim', argsSummary ? ` ${argsSummary}` : ''))
            }
          }
        },
      })

      let finalText = result.text || ''

      // Multi-turn: se executou tools mas sem texto, faz follow-up
      if (!finalText.trim() && result.steps && result.steps.length > 0) {
        const followUpMessages: any[] = [
          ...result.response.messages,
          { role: 'user', content: 'Com base nos resultados das ferramentas, responda ao usuario.' },
        ]

        const followUp = await generateText({
          model,
          system: fullSystemPrompt,
          messages: followUpMessages,
        })

        finalText = followUp.text || 'Feito!'
      }

      // Log tool results summary
      const allToolCalls = (result.steps ?? []).flatMap(
        (s: any) => (s.toolCalls ?? []).map((tc: any) => ({
          name: tc.toolName,
          result: (s.toolResults ?? []).find((tr: any) => tr.toolCallId === tc.toolCallId),
        }))
      )

      if (allToolCalls.length > 0) {
        for (const tc of allToolCalls) {
          const resultText = tc.result ? summarizeResult(tc.result.output ?? tc.result.result) : ''
          if (resultText) {
            console.log(c('gray', `  [RESULT] ${tc.name}: ${resultText}`))
          }
        }
      }

      console.log('')
      console.log(c('cyan', 'IA > ') + finalText)
      console.log('')

      history.push({ role: 'assistant', content: finalText })
    } catch (err: any) {
      console.error(c('red', `[ERRO] ${err.message}`))
      console.log('')
      // Remove last user msg so history stays consistent
      history.pop()
    }
  }

  rl.close()
}

main().catch((err) => {
  console.error('[ia-chat-cli] Fatal:', err?.message ?? err)
  process.exit(1)
})
