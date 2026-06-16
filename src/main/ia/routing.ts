import { isGeminiCloudApiEnabled } from '../config/app-config'
import { execute, queryOne } from '../db/query'
import { isValidModelForProvider } from './config'
import type { IaConfiguracao } from '../../shared/types'
import { getActiveIaConfig, getRouteProviderModel, getRouteProviderToken, type ReadyAiRoute } from './route-config'
import {
  AI_ROUTE_TASK_LABELS,
  IA_ROUTING_CONFIG_KEY,
  normalizeIaRoutingConfig,
  type AiRouteProvider,
  type AiRouteReadinessReason,
  type AiRouteResolution,
  type AiRouteTask,
  type AiRoutingConfig,
  type AiTaskRouteConfig,
  AI_ROUTE_TASKS,
} from '../../shared/ia-routing-contract'

type RouteSource = 'global' | 'task' | 'auto'

interface ResolveOptions {
  validateLocal?: boolean
}

function failedResolution(
  task: AiRouteTask,
  route: AiTaskRouteConfig,
  source: RouteSource,
  provider: AiRouteProvider | null,
  model: string | null,
  reason: AiRouteReadinessReason,
  message: string,
  action?: string,
): AiRouteResolution {
  return {
    ok: false,
    task,
    label: AI_ROUTE_TASK_LABELS[task],
    mode: route.mode,
    provider,
    model,
    reason,
    message,
    ...(action ? { action } : {}),
    inherited: source === 'global',
    auto_selected: source === 'auto',
  }
}

function readyResolution(
  task: AiRouteTask,
  route: AiTaskRouteConfig,
  source: RouteSource,
  provider: AiRouteProvider,
  model: string,
  message: string,
): AiRouteResolution {
  return {
    ok: true,
    task,
    label: AI_ROUTE_TASK_LABELS[task],
    mode: route.mode,
    provider,
    model,
    reason: 'ready',
    message,
    inherited: source === 'global',
    auto_selected: source === 'auto',
  }
}

async function checkLocalRoute(
  task: AiRouteTask,
  route: AiTaskRouteConfig,
  source: RouteSource,
  modelo: string,
  options: ResolveOptions,
): Promise<AiRouteResolution> {
  const { LOCAL_MODELS, getLocalStatus, validateLocalModel } = await import('./local-llm')
  const modelId = modelo as keyof typeof LOCAL_MODELS
  const model = LOCAL_MODELS[modelId]

  if (!model) {
    return failedResolution(
      task,
      route,
      source,
      'local',
      modelo,
      'unsupported_model',
      `O modelo local "${modelo}" não está disponível neste app.`,
      'Escolha outro modelo em Configurações > IA e Modelos.',
    )
  }

  const status = getLocalStatus().modelos[modelId]
  if (!status?.baixado) {
    return failedResolution(
      task,
      route,
      source,
      'local',
      modelo,
      'download_local_model',
      `O modelo "${model.label ?? modelo}" ainda não foi baixado.`,
      'Baixe o modelo em Configurações > IA e Modelos.',
    )
  }

  if (options.validateLocal && !status.usable) {
    try {
      await validateLocalModel(modelId)
    } catch {
      // validateLocalModel records the load error in local status; read fresh below.
    }
  }

  const fresh = getLocalStatus().modelos[modelId]
  if (fresh?.load_error) {
    return failedResolution(
      task,
      route,
      source,
      'local',
      modelo,
      'local_model_error',
      `O modelo "${model.label ?? modelo}" não conseguiu iniciar: ${fresh.load_error}`,
      'Baixe novamente ou escolha outra IA em Configurações > IA e Modelos.',
    )
  }

  if (!fresh?.usable) {
    return failedResolution(
      task,
      route,
      source,
      'local',
      modelo,
      'validate_local_model',
      `O modelo "${model.label ?? modelo}" está baixado, mas ainda não foi testado.`,
      'Clique em Testar conexão antes de usar.',
    )
  }

  return readyResolution(task, route, source, 'local', modelo, `IA local pronta: ${model.label ?? modelo}.`)
}

function checkCloudRoute(
  task: AiRouteTask,
  route: AiTaskRouteConfig,
  source: RouteSource,
  config: IaConfiguracao | null,
  provider: Exclude<AiRouteProvider, 'local'>,
  modelo: string,
): AiRouteResolution {
  if (!isValidModelForProvider(modelo, provider)) {
    return failedResolution(
      task,
      route,
      source,
      provider,
      modelo,
      'unsupported_model',
      `O modelo "${modelo}" não tem o formato esperado para a IA escolhida.`,
      'Escolha um modelo compatível em Configurações > IA e Modelos.',
    )
  }

  if (provider === 'gemini' && !isGeminiCloudApiEnabled()) {
    return failedResolution(
      task,
      route,
      source,
      provider,
      modelo,
      'gemini_disabled',
      'Google Gemini direto está desligado nesta versão do app.',
      'Use OpenRouter ou IA local em Configurações > IA e Modelos.',
    )
  }

  if (!getRouteProviderToken(config, provider)) {
    const label = provider === 'gemini' ? 'Gemini' : 'OpenRouter'
    return failedResolution(
      task,
      route,
      source,
      provider,
      modelo,
      'configure_cloud_token',
      `${label} precisa de uma chave de acesso antes de responder.`,
      'Cole a chave em Configurações > Assistente IA.',
    )
  }

  const label = provider === 'gemini' ? 'Gemini' : 'OpenRouter'
  return readyResolution(task, route, source, provider, modelo, `${label} pronto: ${modelo}.`)
}

async function checkRoute(
  task: AiRouteTask,
  route: AiTaskRouteConfig,
  source: RouteSource,
  config: IaConfiguracao | null,
  options: ResolveOptions,
  effective?: { provider: AiRouteProvider; modelo: string },
): Promise<AiRouteResolution> {
  const provider = effective?.provider ?? (route.mode === 'explicit' ? route.provider : null)
  const modelo = effective?.modelo ?? (route.mode === 'explicit' ? route.modelo : null)

  if (!provider || !modelo) {
    return failedResolution(
      task,
      route,
      source,
      null,
      null,
      'configure_provider',
      'Esta parte ainda não sabe qual IA usar.',
      'Escolha uma IA manualmente ou use a melhor disponível.',
    )
  }

  if (provider === 'local') {
    return await checkLocalRoute(task, route, source, modelo, options)
  }

  return checkCloudRoute(task, route, source, config, provider, modelo)
}

function uniqueCandidates(candidates: Array<{ provider: AiRouteProvider; modelo: string }>) {
  const seen = new Set<string>()
  return candidates.filter((candidate) => {
    const key = `${candidate.provider}:${candidate.modelo}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

async function resolveAutoRoute(
  task: AiRouteTask,
  route: AiTaskRouteConfig,
  config: IaConfiguracao | null,
  options: ResolveOptions,
): Promise<AiRouteResolution> {
  // Auto preference order: local (offline-first) -> active cloud provider -> gemini -> openrouter.
  // First ready candidate wins; uniqueCandidates dedupes the active provider against gemini/openrouter.
  const candidates = uniqueCandidates([
    { provider: 'local', modelo: getRouteProviderModel(config, 'local') },
    ...(config?.provider && config.provider !== 'local'
      ? [{ provider: config.provider as AiRouteProvider, modelo: getRouteProviderModel(config, config.provider as AiRouteProvider) }]
      : []),
    { provider: 'gemini', modelo: getRouteProviderModel(config, 'gemini') },
    { provider: 'openrouter', modelo: getRouteProviderModel(config, 'openrouter') },
  ])

  const attempted: NonNullable<AiRouteResolution['attempted']> = []

  for (const candidate of candidates) {
    const explicitRoute: AiTaskRouteConfig = {
      mode: 'explicit',
      provider: candidate.provider,
      modelo: candidate.modelo,
    }
    const resolution = await checkRoute(task, explicitRoute, 'auto', config, options)
    if (resolution.ok) {
      return {
        ...resolution,
        mode: 'auto',
        attempted,
      }
    }
    attempted.push({
      provider: candidate.provider,
      model: candidate.modelo,
      reason: resolution.reason,
      message: resolution.message,
    })
  }

  return {
    ok: false,
    task,
    label: AI_ROUTE_TASK_LABELS[task],
    mode: 'auto',
    provider: null,
    model: null,
    reason: 'auto_no_ready_route',
    message: 'Nenhuma IA disponível está pronta para uso.',
    action: 'Teste a IA local ou configure a chave do Gemini/OpenRouter.',
    inherited: false,
    auto_selected: false,
    attempted,
  }
}

export async function getIaRoutingConfig(): Promise<AiRoutingConfig> {
  const row = await queryOne<{ value: unknown }>(
    'SELECT value FROM config WHERE key = $1',
    IA_ROUTING_CONFIG_KEY,
  )
  return normalizeIaRoutingConfig(row?.value)
}

export async function saveIaRoutingConfig(input: unknown): Promise<AiRoutingConfig> {
  const next = normalizeIaRoutingConfig(input)
  await execute(
    `INSERT INTO config (key, value) VALUES ($1, $2::jsonb)
     ON CONFLICT (key) DO UPDATE SET value = $2::jsonb`,
    IA_ROUTING_CONFIG_KEY,
    JSON.stringify(next),
  )
  return next
}

export async function resolveIaRoute(
  task: AiRouteTask,
  options: ResolveOptions = {},
): Promise<AiRouteResolution> {
  const routing = await getIaRoutingConfig()
  const config = await getActiveIaConfig()
  const taskRoute = routing.tasks[task]

  if (!taskRoute) {
    return failedResolution(
      task,
      { mode: 'inherit' },
      'task',
      null,
      null,
      'configure_provider',
      `Tarefa de IA "${task}" não existe no contrato de roteamento.`,
    )
  }

  if (taskRoute.mode === 'inherit') {
    // EscalaFlow: "herdar a chave mestra" = usar o provider ATIVO (configuracao_ia),
    // não um global separado de routing. O usuário escolhe o provider global em
    // Configurações > Assistente IA; o routing só adiciona overrides POR TAREFA
    // (explicit/auto). Evita dois "providers globais" concorrentes. (routing.global
    // permanece no contrato por compat, mas não governa inherit aqui.)
    const provider = (config?.provider ?? null) as AiRouteProvider | null
    const modelo = provider ? getRouteProviderModel(config, provider) : null
    if (!provider || !modelo) {
      return failedResolution(
        task,
        { mode: 'inherit' },
        'global',
        null,
        null,
        'configure_provider',
        'Nenhum provider de IA ativo está configurado.',
        'Escolha um provider em Configurações > Assistente IA.',
      )
    }
    return await checkRoute(task, { mode: 'inherit' }, 'global', config, options, { provider, modelo })
  }

  if (taskRoute.mode === 'auto') {
    return await resolveAutoRoute(task, taskRoute, config, options)
  }

  return await checkRoute(task, taskRoute, 'task', config, options)
}

export async function resolveAllIaRoutes(options: ResolveOptions = {}): Promise<AiRouteResolution[]> {
  return await Promise.all(AI_ROUTE_TASKS.map((task) => resolveIaRoute(task, options)))
}

export async function assertIaRouteReady(
  task: AiRouteTask,
  options: ResolveOptions = { validateLocal: true },
): Promise<ReadyAiRoute> {
  const resolution = await resolveIaRoute(task, options)
  if (!resolution.ok) {
    const suffix = resolution.action ? ` ${resolution.action}` : ''
    throw new Error(`${resolution.message}${suffix}`)
  }
  // resolveIaRoute guarantees provider+model are set whenever ok is true.
  return resolution as ReadyAiRoute
}
