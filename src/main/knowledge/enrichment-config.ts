import { queryOne, execute } from '../db/query'
import { buildModelFactory, PROVIDER_DEFAULTS } from '../ia/config'
import { isGeminiCloudApiEnabled } from '../config/app-config'
import {
  createAiSdkEnrichmentModel,
  createLocalEnrichmentModel,
  type EnrichmentModel,
} from './enrichment'
import type {
  IaConfiguracao,
  IaProviderId,
  KnowledgeEnrichmentConfig,
  KnowledgeEnrichmentModelOption,
  KnowledgeEnrichmentProvider,
} from '../../shared/types'

export const KNOWLEDGE_ENRICHMENT_CONFIG_KEY = 'knowledge.enrichment'

export const DEFAULT_KNOWLEDGE_ENRICHMENT_CONFIG: KnowledgeEnrichmentConfig = {
  auto_enrich_after_import: false,
  provider: 'auto',
  modelo: 'auto',
  force_all_default: false,
}

type ProviderConfigs = Partial<Record<IaProviderId, {
  token?: string
  modelo?: string
  favoritos?: string[]
}>>

function parseJsonValue<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback
  if (typeof value !== 'string') return value as T
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

function parseProviderConfigs(value: unknown): ProviderConfigs {
  return parseJsonValue<ProviderConfigs>(value, {})
}

function normalizeConfig(input: Partial<KnowledgeEnrichmentConfig> | null | undefined): KnowledgeEnrichmentConfig {
  const provider = input?.provider && ['auto', 'local', 'gemini', 'openrouter'].includes(input.provider)
    ? input.provider
    : DEFAULT_KNOWLEDGE_ENRICHMENT_CONFIG.provider
  const modelo = provider === 'auto'
    ? 'auto'
    : String(input?.modelo || PROVIDER_DEFAULTS[provider as IaProviderId] || DEFAULT_KNOWLEDGE_ENRICHMENT_CONFIG.modelo)

  return {
    auto_enrich_after_import: Boolean(input?.auto_enrich_after_import ?? DEFAULT_KNOWLEDGE_ENRICHMENT_CONFIG.auto_enrich_after_import),
    provider: provider as KnowledgeEnrichmentProvider,
    modelo,
    force_all_default: Boolean(input?.force_all_default ?? DEFAULT_KNOWLEDGE_ENRICHMENT_CONFIG.force_all_default),
  }
}

async function getIaConfig(): Promise<IaConfiguracao | null> {
  return await queryOne<IaConfiguracao>('SELECT * FROM configuracao_ia LIMIT 1') ?? null
}

function getProviderToken(config: IaConfiguracao | null, provider: IaProviderId): string {
  if (!config) return ''
  if (provider === 'local') return 'local-no-key'
  const parsed = parseProviderConfigs(config.provider_configs_json)
  const providerToken = parsed[provider]?.token?.trim()
  if (providerToken) return providerToken
  if (provider === 'gemini' && config.api_key?.trim()) return config.api_key.trim()
  return ''
}

function getProviderModel(config: IaConfiguracao | null, provider: IaProviderId): string {
  if (!config) return PROVIDER_DEFAULTS[provider]
  const parsed = parseProviderConfigs(config.provider_configs_json)
  return parsed[provider]?.modelo?.trim() || (config.provider === provider ? config.modelo : '') || PROVIDER_DEFAULTS[provider]
}

export async function getKnowledgeEnrichmentConfig(): Promise<KnowledgeEnrichmentConfig> {
  const row = await queryOne<{ value: unknown }>(
    'SELECT value FROM config WHERE key = $1',
    KNOWLEDGE_ENRICHMENT_CONFIG_KEY,
  )
  return normalizeConfig(parseJsonValue<Partial<KnowledgeEnrichmentConfig>>(row?.value, DEFAULT_KNOWLEDGE_ENRICHMENT_CONFIG))
}

export async function saveKnowledgeEnrichmentConfig(input: Partial<KnowledgeEnrichmentConfig>): Promise<KnowledgeEnrichmentConfig> {
  const current = await getKnowledgeEnrichmentConfig()
  const next = normalizeConfig({ ...current, ...input })
  await assertValidConcreteConfig(next)
  await execute(
    `INSERT INTO config (key, value) VALUES ($1, $2::jsonb)
     ON CONFLICT (key) DO UPDATE SET value = $2::jsonb`,
    KNOWLEDGE_ENRICHMENT_CONFIG_KEY,
    JSON.stringify(next),
  )
  return next
}

async function assertValidConcreteConfig(config: KnowledgeEnrichmentConfig): Promise<void> {
  if (config.provider === 'auto') return
  const options = await listKnowledgeEnrichmentModelOptions()
  const match = options.find((option) => option.provider === config.provider && option.modelo === config.modelo)
  if (!match) {
    throw new Error(`Modelo de enrichment inválido: ${config.provider}/${config.modelo}.`)
  }
  if (!match.available) {
    throw new Error(match.reason || `Modelo de enrichment indisponível: ${config.provider}/${config.modelo}.`)
  }
}

export async function listKnowledgeEnrichmentModelOptions(): Promise<KnowledgeEnrichmentModelOption[]> {
  const [iaConfig, local] = await Promise.all([
    getIaConfig(),
    import('../ia/local-llm'),
  ])
  const localStatus = local.getLocalStatus()

  const localOptions = Object.entries(local.LOCAL_MODELS).map(([modelo, model]) => {
    const status = localStatus.modelos[modelo]
    const available = Boolean(status?.usable)
    const reason = status?.load_error
      ? `Modelo local falhou ao carregar: ${status.load_error}`
      : status?.baixado
        ? 'Modelo local baixado, mas precisa passar em Testar conexao antes do enrichment.'
        : 'Modelo local nao baixado.'
    return {
      provider: 'local' as const,
      modelo,
      label: model.label,
      available,
      reason: available ? undefined : reason,
    }
  })

  const geminiToken = getProviderToken(iaConfig, 'gemini')
  const geminiEnabled = isGeminiCloudApiEnabled()
  const geminiAvailable = geminiEnabled && geminiToken.length > 0
  const geminiReason = !geminiEnabled
    ? 'Gemini API direta desativada nesta build.'
    : geminiAvailable ? undefined : 'API key Gemini nao configurada.'

  const openrouterToken = getProviderToken(iaConfig, 'openrouter')
  const openrouterAvailable = openrouterToken.length > 0

  return [
    ...localOptions,
    {
      provider: 'gemini',
      modelo: getProviderModel(iaConfig, 'gemini'),
      label: getProviderModel(iaConfig, 'gemini'),
      available: geminiAvailable,
      reason: geminiReason,
    },
    {
      provider: 'openrouter',
      modelo: getProviderModel(iaConfig, 'openrouter'),
      label: getProviderModel(iaConfig, 'openrouter'),
      available: openrouterAvailable,
      reason: openrouterAvailable ? undefined : 'API key OpenRouter nao configurada.',
    },
  ]
}

// Modo `auto` do enrichment delega para a rota `rag_enrichment` (default `auto` →
// local-first, equivalente à resolução anterior; mas agora o AiRoutingSection pode
// fixar provider/modelo dessa tarefa). assertIaRouteReady já valida prontidão.
// Mantém o contrato antigo: rota não-pronta → null (o caller decide pular o enrichment).
async function resolveAutoModelViaRoute(config: KnowledgeEnrichmentConfig): Promise<KnowledgeEnrichmentConfig | null> {
  try {
    const { assertIaRouteReady } = await import('../ia/routing')
    const route = await assertIaRouteReady('rag_enrichment', { validateLocal: true })
    if (!route.provider || !route.model) return null
    return { ...config, provider: route.provider, modelo: route.model }
  } catch (err) {
    // Rota não-pronta (token ausente, local não validado, etc.): preserva o contrato
    // antigo (auto sem modelo → null → caller pula o enrichment com aviso). Logável.
    if (process.env.DEBUG_ENRICH_ROUTE) console.error('[resolveAutoModelViaRoute]', err)
    return null
  }
}

function buildCloudConfig(base: IaConfiguracao, provider: 'gemini' | 'openrouter', modelo: string): IaConfiguracao {
  const providerConfigs = parseProviderConfigs(base.provider_configs_json)
  providerConfigs[provider] = {
    ...(providerConfigs[provider] ?? {}),
    modelo,
  }

  return {
    ...base,
    provider,
    modelo,
    api_key: getProviderToken(base, provider),
    provider_configs_json: JSON.stringify(providerConfigs),
  }
}

export async function buildKnowledgeEnrichmentModel(
  configOverride?: KnowledgeEnrichmentConfig,
): Promise<EnrichmentModel | null> {
  const baseConfig = configOverride ?? await getKnowledgeEnrichmentConfig()

  let resolvedConfig: KnowledgeEnrichmentConfig | null
  if (baseConfig.provider === 'auto') {
    // Auto: a rota já validou prontidão; não revalida contra a lista de opções
    // (que só lista o modelo ativo por provider e rejeitaria overrides legítimos).
    resolvedConfig = await resolveAutoModelViaRoute(baseConfig)
  } else {
    // Provider explícito escolhido no enrichment: valida contra as opções disponíveis.
    await assertValidConcreteConfig(baseConfig)
    resolvedConfig = baseConfig
  }

  if (!resolvedConfig) return null

  if (resolvedConfig.provider === 'local') {
    const options = await listKnowledgeEnrichmentModelOptions()
    const option = options.find((entry) => entry.provider === 'local' && entry.modelo === resolvedConfig.modelo)
    if (!option?.available) {
      throw new Error(option?.reason || `Modelo local "${resolvedConfig.modelo}" indisponivel.`)
    }
    return createLocalEnrichmentModel(resolvedConfig.modelo)
  }

  if (resolvedConfig.provider === 'gemini' || resolvedConfig.provider === 'openrouter') {
    const iaConfig = await getIaConfig()
    if (!iaConfig) return null

    const cloudConfig = buildCloudConfig(iaConfig, resolvedConfig.provider, resolvedConfig.modelo)
    const factory = buildModelFactory(cloudConfig)
    if (!factory) {
      throw new Error(`Modelo ${resolvedConfig.provider}/${resolvedConfig.modelo} indisponivel para enrichment.`)
    }
    return createAiSdkEnrichmentModel(factory.createModel, factory.modelo, resolvedConfig.provider)
  }

  return null
}
