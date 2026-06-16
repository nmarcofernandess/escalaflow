import { PROVIDER_DEFAULTS, isValidModelForProvider } from './config'
import { queryOne } from '../db/query'
import type { IaConfiguracao } from '../../shared/types'
import type { AiRouteProvider, AiRouteResolution } from '../../shared/ia-routing-contract'

/** Single accessor for the active IA credentials row, shared by routing/metadata/enrichment. */
export async function getActiveIaConfig(): Promise<IaConfiguracao | null> {
  return await queryOne<IaConfiguracao>('SELECT * FROM configuracao_ia LIMIT 1') ?? null
}

export type ProviderConfigs = Partial<Record<AiRouteProvider, {
  token?: string
  modelo?: string
  favoritos?: string[]
}>>

export type ReadyAiRoute = AiRouteResolution & {
  ok: true
  provider: AiRouteProvider
  model: string
}

export interface RouteModelSelection {
  provider: AiRouteProvider
  model: string
}

export function parseProviderConfigs(value: unknown): ProviderConfigs {
  if (!value) return {}
  if (typeof value !== 'string') return value && typeof value === 'object' ? { ...(value as ProviderConfigs) } : {}
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? { ...(parsed as ProviderConfigs) }
      : {}
  } catch {
    return {}
  }
}

/**
 * Token precedence:
 * 1) provider_configs_json[provider].token (canonical per-provider token),
 * 2) config.api_key — only when `provider` is the active provider,
 * 3) '' (no token). Local always returns the 'local-no-key' sentinel.
 */
export function getRouteProviderToken(config: IaConfiguracao | null, provider: AiRouteProvider): string {
  if (provider === 'local') return 'local-no-key'
  if (!config) return ''

  const providerConfigs = parseProviderConfigs(config.provider_configs_json)
  const providerToken = providerConfigs[provider]?.token?.trim()
  if (providerToken) return providerToken

  if (config.provider === provider && config.api_key?.trim()) {
    return config.api_key.trim()
  }

  return ''
}

/**
 * Model precedence:
 * 1) provider_configs_json[provider].modelo, 2) config.modelo — only when `provider`
 * is the active provider, 3) PROVIDER_DEFAULTS[provider].
 *
 * Cada candidato é validado por isValidModelForProvider (mesma regra de resolveModel),
 * caindo no default quando inválido. Assim a rota `inherit` resolve o MESMO modelo
 * efetivo que a config ativa (readiness), em vez de propagar um modelo salvo inválido
 * que viraria `unsupported_model`.
 */
export function getRouteProviderModel(config: IaConfiguracao | null, provider: AiRouteProvider): string {
  const providerConfigs = parseProviderConfigs(config?.provider_configs_json)
  const configuredModel = providerConfigs[provider]?.modelo?.trim()
  if (configuredModel && isValidModelForProvider(configuredModel, provider)) return configuredModel

  const activeModel = config?.provider === provider ? config.modelo?.trim() : undefined
  if (activeModel && isValidModelForProvider(activeModel, provider)) return activeModel

  return PROVIDER_DEFAULTS[provider]
}

export function assertReadyRoute(route: AiRouteResolution): ReadyAiRoute {
  if (!route.ok || !route.provider || !route.model) {
    const suffix = route.action ? ` ${route.action}` : ''
    throw new Error(`${route.message}${suffix}`)
  }
  return route as ReadyAiRoute
}

export function buildRouteBackedIaConfig(base: IaConfiguracao, route: RouteModelSelection): IaConfiguracao {
  const providerConfigs = parseProviderConfigs(base.provider_configs_json)
  const providerEntry = providerConfigs[route.provider] && typeof providerConfigs[route.provider] === 'object'
    ? { ...providerConfigs[route.provider] }
    : {}
  const token = getRouteProviderToken(base, route.provider)

  providerConfigs[route.provider] = {
    ...providerEntry,
    modelo: route.model,
    ...(route.provider !== 'local' && token ? { token } : {}),
  }

  return {
    ...base,
    provider: route.provider,
    modelo: route.model,
    api_key: route.provider === 'local' ? '' : token,
    provider_configs_json: JSON.stringify(providerConfigs),
  }
}

export function buildProviderBackedIaConfig(
  base: IaConfiguracao,
  provider: AiRouteProvider,
  model: string,
): IaConfiguracao {
  return buildRouteBackedIaConfig(base, { provider, model })
}
