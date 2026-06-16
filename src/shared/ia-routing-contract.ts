import type { IaProviderId } from './types'

export const IA_ROUTING_CONFIG_KEY = 'ia.routing'

// First-cut routing tasks: only tasks a runtime actually consumes are listed here,
// so the settings table never shows a choice/status for something that does nothing.
// Add a task to this list at the same time its consumer starts calling resolveIaRoute().
// (EscalaFlow não tem Maiá — por isso não há `maia_command` aqui, ao contrário do FlowKit.)
export const AI_ROUTE_TASKS = [
  'chat_ui',
  'cli_chat',
  'rag_metadata',
  'rag_enrichment',
] as const

export type AiRouteTask = (typeof AI_ROUTE_TASKS)[number]
export type AiRouteMode = 'inherit' | 'explicit' | 'auto'
// Single source of truth for provider ids — aliased to IaProviderId to avoid enum drift.
export type AiRouteProvider = IaProviderId

export interface AiRouteGlobalDefault {
  provider: AiRouteProvider
  modelo: string
}

export type AiTaskRouteConfig =
  | { mode: 'inherit' }
  | { mode: 'auto' }
  | { mode: 'explicit'; provider: AiRouteProvider; modelo: string }

export interface AiRoutingConfig {
  version: 1
  global: AiRouteGlobalDefault
  tasks: Record<AiRouteTask, AiTaskRouteConfig>
}

export type AiRouteReadinessReason =
  | 'ready'
  | 'configure_provider'
  | 'configure_cloud_token'
  | 'download_local_model'
  | 'validate_local_model'
  | 'local_model_error'
  | 'unsupported_model'
  | 'gemini_disabled'
  | 'auto_no_ready_route'

export interface AiRouteResolution {
  ok: boolean
  task: AiRouteTask
  label: string
  mode: AiRouteMode
  provider: AiRouteProvider | null
  model: string | null
  reason: AiRouteReadinessReason
  message: string
  action?: string
  inherited: boolean
  auto_selected: boolean
  attempted?: Array<{
    provider: AiRouteProvider
    model: string
    reason: AiRouteReadinessReason
    message: string
  }>
}

export const AI_ROUTE_TASK_LABELS: Record<AiRouteTask, string> = {
  chat_ui: 'Chat do app',
  cli_chat: 'Chat no Terminal',
  rag_metadata: 'Nome e resumo dos arquivos',
  rag_enrichment: 'Leitura profunda do acervo',
}

export const AI_ROUTE_MODE_LABELS: Record<AiRouteMode, string> = {
  inherit: 'Seguir IA ativa',
  explicit: 'Escolher manualmente',
  auto: 'Escolher melhor disponível',
}

export const AI_ROUTE_PROVIDER_LABELS: Record<AiRouteProvider, string> = {
  local: 'IA local (offline)',
  gemini: 'Google Gemini',
  openrouter: 'OpenRouter',
}

export const AI_ROUTE_PROVIDER_MODEL_OPTIONS: Record<AiRouteProvider, Array<{ value: string; label: string }>> = {
  local: [
    { value: 'gemma-4-e2b-it-q4', label: 'Gemma 4 E2B IT' },
  ],
  // DEVE espelhar GEMINI_MODEL_IDS em src/main/ia/config.ts (isValidModelForProvider).
  // Modelos fora dessa allow-list resolvem sempre 'unsupported_model'. Coberto por teste.
  gemini: [
    { value: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash Lite' },
    { value: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash' },
  ],
  openrouter: [
    { value: 'openai/gpt-oss-20b:free', label: 'OpenAI gpt-oss 20B (free)' },
    { value: 'openrouter/free', label: 'Free Models Router' },
  ],
}

export const DEFAULT_AI_ROUTING_CONFIG: AiRoutingConfig = {
  version: 1,
  global: {
    provider: 'local',
    modelo: 'gemma-4-e2b-it-q4',
  },
  tasks: {
    chat_ui: { mode: 'inherit' },
    cli_chat: { mode: 'inherit' },
    rag_metadata: {
      mode: 'explicit',
      provider: 'local',
      modelo: 'gemma-4-e2b-it-q4',
    },
    rag_enrichment: { mode: 'auto' },
  },
}

export const DEFAULT_IA_ROUTING_CONFIG = DEFAULT_AI_ROUTING_CONFIG

const PROVIDERS = new Set<AiRouteProvider>(['local', 'gemini', 'openrouter'])
const MODES = new Set<AiRouteMode>(['inherit', 'explicit', 'auto'])

function cloneGlobal(global: AiRouteGlobalDefault): AiRouteGlobalDefault {
  return {
    provider: global.provider,
    modelo: global.modelo,
  }
}

export function cloneRoute(route: AiTaskRouteConfig): AiTaskRouteConfig {
  if (route.mode === 'explicit') {
    return { mode: 'explicit', provider: route.provider, modelo: route.modelo }
  }
  if (route.mode === 'auto') return { mode: 'auto' }
  return { mode: 'inherit' }
}

export function cloneRoutingConfig(config: AiRoutingConfig): AiRoutingConfig {
  return {
    version: 1,
    global: cloneGlobal(config.global),
    tasks: AI_ROUTE_TASKS.reduce((acc, task) => {
      acc[task] = cloneRoute(config.tasks[task])
      return acc
    }, {} as Record<AiRouteTask, AiTaskRouteConfig>),
  }
}

function cloneDefaultConfig(): AiRoutingConfig {
  return cloneRoutingConfig(DEFAULT_AI_ROUTING_CONFIG)
}

function parseInput(value: unknown): unknown {
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function normalizeGlobal(value: unknown, fallback: AiRouteGlobalDefault): AiRouteGlobalDefault {
  if (!isRecord(value)) return cloneGlobal(fallback)

  const provider = typeof value.provider === 'string' && PROVIDERS.has(value.provider as AiRouteProvider)
    ? value.provider as AiRouteProvider
    : null
  const modelo = typeof value.modelo === 'string' ? value.modelo.trim() : ''

  if (!provider || !modelo) return cloneGlobal(fallback)
  return { provider, modelo }
}

function normalizeRoute(value: unknown, fallback: AiTaskRouteConfig): AiTaskRouteConfig {
  if (!isRecord(value)) return cloneRoute(fallback)

  const mode = typeof value.mode === 'string' && MODES.has(value.mode as AiRouteMode)
    ? value.mode as AiRouteMode
    : null

  if (!mode) return cloneRoute(fallback)
  if (mode === 'inherit' || mode === 'auto') return { mode }

  const provider = typeof value.provider === 'string' && PROVIDERS.has(value.provider as AiRouteProvider)
    ? value.provider as AiRouteProvider
    : null
  const modelo = typeof value.modelo === 'string' ? value.modelo.trim() : ''

  if (!provider || !modelo) return cloneRoute(fallback)
  return { mode: 'explicit', provider, modelo }
}

export function normalizeIaRoutingConfig(value: unknown): AiRoutingConfig {
  const parsed = parseInput(value)
  if (!isRecord(parsed)) return cloneDefaultConfig()

  const defaults = cloneDefaultConfig()
  const rawTasks = isRecord(parsed.tasks) ? parsed.tasks : {}

  return {
    version: 1,
    global: normalizeGlobal(parsed.global, defaults.global),
    tasks: AI_ROUTE_TASKS.reduce((acc, task) => {
      acc[task] = normalizeRoute(rawTasks[task], defaults.tasks[task])
      return acc
    }, {} as Record<AiRouteTask, AiTaskRouteConfig>),
  }
}
