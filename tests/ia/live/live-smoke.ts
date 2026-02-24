import '../../setup/load-env'
import { generateText, stepCountIs } from 'ai'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOpenRouter } from '@openrouter/ai-sdk-provider'

type Provider = 'gemini' | 'openrouter'

function parseBool(name: string, fallback: boolean) {
  const raw = process.env[name]?.trim().toLowerCase()
  if (!raw) return fallback
  if (raw === '1' || raw === 'true' || raw === 'yes') return true
  if (raw === '0' || raw === 'false' || raw === 'no') return false
  return fallback
}

async function loadRuntime() {
  const [{ getVercelAiTools }, { SYSTEM_PROMPT }] = await Promise.all([
    import('../../../src/main/ia/tools'),
    import('../../../src/main/ia/system-prompt'),
  ])
  return { getVercelAiTools, SYSTEM_PROMPT }
}

async function main() {
  const provider = (process.env.ESCALAFLOW_EVAL_PROVIDER?.trim() || 'gemini') as Provider
  const requireLive = parseBool('ESCALAFLOW_EVAL_REQUIRE_LIVE', false)
  const modelName = process.env.ESCALAFLOW_EVAL_MODEL?.trim()
    || (provider === 'openrouter' ? 'anthropic/claude-sonnet-4' : 'gemini-2.5-flash')

  const apiKey = provider === 'openrouter'
    ? (process.env.OPENROUTER_API_KEY?.trim() || process.env.ESCALAFLOW_OPENROUTER_API_KEY?.trim())
    : (
      process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim()
      || process.env.GEMINI_API_KEY?.trim()
      || process.env.ESCALAFLOW_GEMINI_API_KEY?.trim()
    )

  if (!apiKey) {
    const msg = `[ia-live-smoke] API key ausente para provider=${provider}.`
    if (requireLive) {
      console.error(msg)
      process.exit(1)
    }
    console.log(`${msg} Pulando smoke live.`)
    process.exit(0)
  }

  const model = provider === 'openrouter'
    ? createOpenRouter({ apiKey })(modelName)
    : createGoogleGenerativeAI({ apiKey })(modelName)

  console.log(`[ia-live-smoke] Provider=${provider} | model=${modelName}`)

  const textOnly = await generateText({
    model,
    prompt: 'Responda apenas OK',
  })

  if (!textOnly.text || !textOnly.text.toUpperCase().includes('OK')) {
    throw new Error(`Smoke texto falhou. Resposta recebida: ${JSON.stringify(textOnly.text)}`)
  }
  console.log(`[PASS] texto simples -> ${textOnly.text.trim()}`)

  let runtime
  try {
    runtime = await loadRuntime()
  } catch (err: any) {
    const msg = String(err?.message ?? err)
    if (msg.includes('NODE_MODULE_VERSION') || msg.includes('pglite')) {
      throw new Error(`Falha carregando runtime para smoke de tools (PGlite): ${msg}`)
    }
    throw err
  }

  const result = await generateText({
    model,
    system: runtime.SYSTEM_PROMPT,
    messages: [{ role: 'user', content: 'Explique a regra H14 em uma frase.' }],
    tools: runtime.getVercelAiTools(),
    stopWhen: stepCountIs(6),
  })

  const toolNames = (result.steps ?? [])
    .flatMap((s: any) => (s.toolCalls ?? []).map((tc: any) => String(tc.toolName)))

  if (!toolNames.includes('explicar_violacao')) {
    throw new Error(`Smoke tool-calling falhou. Tools chamadas: ${JSON.stringify(toolNames)}`)
  }

  console.log(`[PASS] tool calling -> explicar_violacao (steps=${result.steps?.length ?? 0})`)
  console.log(`[ia-live-smoke] OK`)
}

main().catch((err) => {
  console.error('[ia-live-smoke] FAIL:', err?.message ?? err)
  process.exit(1)
})
