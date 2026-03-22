import '../../setup/load-env'
import { resolve } from 'path'
import { fileURLToPath } from 'url'

// Garante que o PGlite encontra o banco mesmo em ESM (tsx) onde __dirname não existe
if (!process.env.ESCALAFLOW_DB_PATH) {
  const __here = resolve(fileURLToPath(import.meta.url), '..')
  process.env.ESCALAFLOW_DB_PATH = resolve(__here, '../../../data/escalaflow-pg')
}

import { generateText, stepCountIs, wrapLanguageModel } from 'ai'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOpenRouter } from '@openrouter/ai-sdk-provider'
import { ESCALAFLOW_EVAL_DATASET, DEFAULT_EVAL_CONTEXTO, type EscalaFlowEvalCase } from './dataset'
import { evaluateCase, type EvalRunOutput } from './scorers'

type EvalProvider = 'gemini' | 'openrouter'

function parseBooleanEnv(name: string, fallback: boolean) {
  const value = process.env[name]?.trim().toLowerCase()
  if (!value) return fallback
  if (value === '1' || value === 'true' || value === 'yes') return true
  if (value === '0' || value === 'false' || value === 'no') return false
  return fallback
}

function getEvalConfig() {
  const provider = (process.env.ESCALAFLOW_EVAL_PROVIDER?.trim() || 'gemini') as EvalProvider
  const requireLive = parseBooleanEnv('ESCALAFLOW_EVAL_REQUIRE_LIVE', false)
  const strict = parseBooleanEnv('ESCALAFLOW_EVAL_STRICT', true)
  const includeSlow = parseBooleanEnv('ESCALAFLOW_EVAL_INCLUDE_SLOW', false)
  const useDevTools = parseBooleanEnv('ESCALAFLOW_EVAL_DEVTOOLS', false)
  const verbose = parseBooleanEnv('ESCALAFLOW_EVAL_VERBOSE', false)
  const selectedCases = (process.env.ESCALAFLOW_EVAL_CASES ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const limit = Number(process.env.ESCALAFLOW_EVAL_LIMIT ?? '0') || undefined

  const model = process.env.ESCALAFLOW_EVAL_MODEL?.trim()
    || (provider === 'openrouter' ? 'anthropic/claude-sonnet-4' : 'gemini-2.5-flash')

  const apiKey = provider === 'openrouter'
    ? (process.env.OPENROUTER_API_KEY?.trim() || process.env.ESCALAFLOW_OPENROUTER_API_KEY?.trim())
    : (
      process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim()
      || process.env.GEMINI_API_KEY?.trim()
      || process.env.ESCALAFLOW_GEMINI_API_KEY?.trim()
    )

  return {
    provider,
    apiKey,
    model,
    requireLive,
    strict,
    includeSlow,
    useDevTools,
    verbose,
    selectedCases,
    limit,
  }
}

async function maybeWrapWithDevTools(model: any, enabled: boolean) {
  if (!enabled) return model
  try {
    const { devToolsMiddleware } = await import('@ai-sdk/devtools')
    console.log('[ia-eval] DevTools ativo para eval. Rode `npx @ai-sdk/devtools` e abra http://localhost:4983')
    return wrapLanguageModel({
      model,
      middleware: devToolsMiddleware(),
    })
  } catch (err: any) {
    console.warn('[ia-eval] Nao foi possivel ativar DevTools. Seguindo sem viewer.', err?.message ?? err)
    return model
  }
}

function selectCases(allCases: EscalaFlowEvalCase[], options: { includeSlow: boolean; selectedCases: string[]; limit?: number }) {
  let cases = allCases.filter((tc) => options.includeSlow || tc.enabledByDefault !== false)

  if (options.selectedCases.length > 0) {
    const selected = new Set(options.selectedCases)
    cases = cases.filter((tc) => selected.has(tc.id))
  }

  if (options.limit && options.limit > 0) {
    cases = cases.slice(0, options.limit)
  }

  return cases
}

function normalizeToolArgs(rawArgs: unknown): Record<string, unknown> | undefined {
  if (rawArgs === undefined) return undefined
  if (typeof rawArgs === 'object' && rawArgs !== null && !Array.isArray(rawArgs)) {
    return rawArgs as Record<string, unknown>
  }
  return { value: rawArgs }
}

function hasOwn(value: unknown, key: string): boolean {
  return typeof value === 'object' && value !== null && Object.prototype.hasOwnProperty.call(value, key)
}

function extractToolCallsFromSteps(steps: any[] | undefined) {
  const acoes: Array<{ id: string; name: string; args?: Record<string, unknown>; result?: unknown }> = []
  if (!steps) return acoes

  for (const step of steps) {
    if (!Array.isArray(step?.toolCalls) || step.toolCalls.length === 0) continue

    const stepToolResults = Array.isArray(step.toolResults) ? step.toolResults : []
    const toolResultsById = new Map<string, any>()
    for (const tr of stepToolResults) {
      if (tr?.toolCallId) toolResultsById.set(tr.toolCallId, tr)
    }

    for (let i = 0; i < step.toolCalls.length; i++) {
      const tc = step.toolCalls[i] as any
      const tr = toolResultsById.get(tc?.toolCallId) ?? stepToolResults[i]
      const args = normalizeToolArgs(tc?.input ?? tc?.args)
      const hasResultProp = hasOwn(tr, 'output') || hasOwn(tr, 'result') || hasOwn(tr, 'error')
      const result = hasOwn(tr, 'output')
        ? tr.output
        : hasOwn(tr, 'result')
          ? tr.result
          : hasOwn(tr, 'error')
            ? tr.error
            : undefined

      acoes.push({
        id: String(tc?.toolCallId ?? `${tc?.toolName ?? 'tool'}-${i}`),
        name: String(tc?.toolName ?? 'unknown'),
        ...(args !== undefined ? { args } : {}),
        ...(hasResultProp ? { result } : {}),
      })
    }
  }

  return acoes
}

type RuntimeBits = {
  getVercelAiTools: () => Record<string, any>
  SYSTEM_PROMPT: string
  buildContextBriefing: (contexto?: any) => Promise<string>
  initDb: () => Promise<any>
  getDb: () => any
}

async function loadRuntimeBits(): Promise<RuntimeBits> {
  try {
    const [{ getVercelAiTools }, { SYSTEM_PROMPT }, { buildContextBriefing }, { initDb, getDb }] = await Promise.all([
      import('../../../src/main/ia/tools'),
      import('../../../src/main/ia/system-prompt'),
      import('../../../src/main/ia/discovery'),
      import('../../../src/main/db/pglite'),
    ])
    return { getVercelAiTools, SYSTEM_PROMPT, buildContextBriefing, initDb, getDb }
  } catch (err: any) {
    const msg = String(err?.message ?? err)
    throw new Error(`Falha ao carregar runtime do EscalaFlow. Erro: ${msg}`)
  }
}

async function createModel(provider: EvalProvider, apiKey: string, modelName: string, useDevTools: boolean) {
  const baseModel = provider === 'openrouter'
    ? createOpenRouter({ apiKey })(modelName)
    : createGoogleGenerativeAI({ apiKey })(modelName)

  return maybeWrapWithDevTools(baseModel, useDevTools)
}

async function runCase(
  tc: EscalaFlowEvalCase,
  deps: {
    model: any
    tools: Record<string, any>
    systemPrompt: string
    buildContextBriefing: (contexto?: any, mensagemUsuario?: string) => Promise<string>
  },
): Promise<EvalRunOutput> {
  // Injeta contexto real (default=dashboard) — IA recebe discovery do DB como no app
  // Passa tc.input como mensagemUsuario para que Auto-RAG rode na base de conhecimento
  const contexto = tc.contexto ?? DEFAULT_EVAL_CONTEXTO
  const contextBriefing = await deps.buildContextBriefing(contexto, tc.input)
  const system = contextBriefing
    ? `${deps.systemPrompt}\n\n---\n${contextBriefing}`
    : deps.systemPrompt

  const result = await generateText({
    model: deps.model,
    system,
    messages: [{ role: 'user', content: tc.input }],
    tools: deps.tools,
    temperature: 0,
    stopWhen: stepCountIs(10),
  })

  return {
    text: result.text || '',
    stepsCount: Array.isArray(result.steps) ? result.steps.length : 0,
    totalTokens: (result as any)?.usage?.totalTokens,
    toolCalls: extractToolCallsFromSteps(result.steps as any[] | undefined),
  }
}

async function main() {
  const cfg = getEvalConfig()

  if (!cfg.apiKey) {
    const msg = `[ia-eval] Nenhuma API key encontrada para provider=${cfg.provider}. ` +
      `Use ${cfg.provider === 'openrouter' ? 'OPENROUTER_API_KEY' : 'GOOGLE_GENERATIVE_AI_API_KEY/GEMINI_API_KEY'}.`
    if (cfg.requireLive) {
      console.error(msg)
      process.exit(1)
    }
    console.log(`${msg} Pulando eval live (set ESCALAFLOW_EVAL_REQUIRE_LIVE=1 para falhar).`)
    process.exit(0)
  }

  const selected = selectCases(ESCALAFLOW_EVAL_DATASET, {
    includeSlow: cfg.includeSlow,
    selectedCases: cfg.selectedCases,
    limit: cfg.limit,
  })

  if (selected.length === 0) {
    console.log('[ia-eval] Nenhum caso selecionado. Verifique ESCALAFLOW_EVAL_CASES / ESCALAFLOW_EVAL_LIMIT.')
    process.exit(0)
  }

  const runtime = await loadRuntimeBits()
  await runtime.initDb()
  const tools = runtime.getVercelAiTools()
  const db = runtime.getDb()
  const model = await createModel(cfg.provider, cfg.apiKey, cfg.model, cfg.useDevTools)

  console.log(`[ia-eval] Iniciando batch: ${selected.length} caso(s) | provider=${cfg.provider} | model=${cfg.model}`)
  console.log(`[ia-eval] DB: PGlite | contexto: dashboard (real)`)
  if (!cfg.includeSlow) {
    console.log('[ia-eval] Casos slow/solver estão excluídos (ESCALAFLOW_EVAL_INCLUDE_SLOW=1 para incluir).')
  }

  const caseResults: Array<{ id: string; label: string; eval: ReturnType<typeof evaluateCase>; output: EvalRunOutput; error?: string }> = []

  for (const tc of selected) {
    const startedAt = Date.now()
    const useSavepoint = !!tc.mutates

    // SAVEPOINT — protege o DB contra mutações do eval
    if (useSavepoint) {
      await db.exec(`SAVEPOINT eval_${tc.id.replace(/[^a-z0-9_]/g, '_')}`)
    }

    try {
      const output = await runCase(tc, {
        model,
        tools,
        systemPrompt: runtime.SYSTEM_PROMPT,
        buildContextBriefing: runtime.buildContextBriefing,
      })

      // Scorer verifica tudo — inclusive dbVerify (ANTES do rollback)
      const evalResult = evaluateCase(output, tc, useSavepoint ? db : undefined)
      caseResults.push({ id: tc.id, label: tc.label, eval: evalResult, output })

      const status = evalResult.passed ? 'PASS' : 'FAIL'
      const elapsed = Date.now() - startedAt
      const tokens = typeof output.totalTokens === 'number' ? ` | tokens=${output.totalTokens}` : ''
      const mutateFlag = useSavepoint ? ' [mut→rollback]' : ''
      console.log(`[${status}] ${tc.id} (${tc.label}) | steps=${output.stepsCount}${tokens} | ${elapsed}ms${mutateFlag}`)

      if (cfg.verbose || !evalResult.passed) {
        console.log(`  tools: ${output.toolCalls.map((c) => c.name).join(', ') || '(nenhuma)'}`)
        for (const score of evalResult.scores) {
          const icon = score.passed ? '  ✅' : '  ❌'
          console.log(`${icon} ${score.name}: ${score.detail ?? ''}`)
        }
        if (!evalResult.passed) {
          console.log(`  resposta: ${(output.text || '').slice(0, 240).replace(/\s+/g, ' ')}`)
        }
      }
    } catch (err: any) {
      const elapsed = Date.now() - startedAt
      const message = String(err?.message ?? err)
      console.log(`[FAIL] ${tc.id} (${tc.label}) | exception | ${elapsed}ms`)
      console.log(`  erro: ${message}`)
      caseResults.push({
        id: tc.id,
        label: tc.label,
        eval: { passed: false, scores: [{ name: 'runtime_exception', passed: false, detail: message }] },
        output: { text: '', stepsCount: 0, toolCalls: [] },
        error: message,
      })
    } finally {
      // ROLLBACK — desfaz mutações, DB volta ao estado original
      if (useSavepoint) {
        try {
          await db.exec(`ROLLBACK TO eval_${tc.id.replace(/[^a-z0-9_]/g, '_')}`)
          await db.exec(`RELEASE eval_${tc.id.replace(/[^a-z0-9_]/g, '_')}`)
        } catch {
          // Se o savepoint já foi released (ex: por autocommit), ignore
        }
      }
    }
  }

  const passedCount = caseResults.filter((r) => r.eval.passed).length
  const total = caseResults.length
  const failed = caseResults.filter((r) => !r.eval.passed)
  const avgSteps = total > 0
    ? (caseResults.reduce((sum, r) => sum + r.output.stepsCount, 0) / total).toFixed(2)
    : '0.00'

  console.log('\n[ia-eval] Resumo')
  console.log(`- Passou: ${passedCount}/${total}`)
  console.log(`- Falhou: ${failed.length}/${total}`)
  console.log(`- Média de steps: ${avgSteps}`)

  if (failed.length > 0) {
    console.log('- Casos com falha:')
    for (const r of failed) {
      const failedScores = r.eval.scores.filter((s) => !s.passed).map((s) => s.name).join(', ')
      console.log(`  - ${r.id}: ${failedScores || 'unknown'}`)
    }
  }

  if (failed.length > 0 && cfg.strict) {
    process.exit(1)
  }
}

main().catch((err) => {
  console.error('[ia-eval] Fatal:', err)
  process.exit(1)
})
