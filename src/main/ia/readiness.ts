import { queryOne } from '../db/query'
import { isGeminiCloudApiEnabled } from '../config/app-config'
import { resolveModel, resolveProviderApiKey } from './config'
import type { IaConfiguracao } from '../../shared/types'

export type IaChatReadinessReason =
  | 'configure_provider'
  | 'configure_cloud_token'
  | 'download_local_model'
  | 'validate_local_model'
  | 'local_model_error'
  | 'invalid_local_model_config'
  | 'ready'

export interface IaChatReadiness {
  ok: boolean
  provider: IaConfiguracao['provider'] | null
  model: string | null
  reason: IaChatReadinessReason
  message: string
  action?: string
}

function fail(
  provider: IaConfiguracao['provider'] | null,
  model: string | null,
  reason: IaChatReadinessReason,
  message: string,
  action?: string,
): IaChatReadiness {
  return {
    ok: false,
    provider,
    model,
    reason,
    message,
    ...(action ? { action } : {}),
  }
}

function configuredLocalModelCandidates(config: IaConfiguracao): string[] {
  const candidates = new Set<string>()
  if (config.provider === 'local' && config.modelo?.trim()) candidates.add(config.modelo.trim())
  if (config.provider_configs_json) {
    try {
      const parsed = typeof config.provider_configs_json === 'string'
        ? JSON.parse(config.provider_configs_json)
        : config.provider_configs_json
      const localModel = parsed?.local?.modelo
      if (typeof localModel === 'string' && localModel.trim()) candidates.add(localModel.trim())
    } catch {
      // resolveModel will still apply the safe default below.
    }
  }
  return [...candidates]
}

export async function getIaChatReadiness(options: { validateLocal?: boolean } = {}): Promise<IaChatReadiness> {
  const config = await queryOne<IaConfiguracao>('SELECT * FROM configuracao_ia LIMIT 1')

  if (!config) {
    return fail(
      null,
      null,
      'configure_provider',
      'Assistente IA não configurado.',
      'Abra Configurações > Assistente IA e escolha um provider.',
    )
  }

  if (config.provider === 'local') {
    const { getLocalStatus, validateLocalModel, LOCAL_MODELS } = await import('./local-llm')
    const staleLocalModel = configuredLocalModelCandidates(config)
      .find((candidate) => !(candidate in LOCAL_MODELS))
    if (staleLocalModel) {
      return fail(
        'local',
        staleLocalModel,
        'invalid_local_model_config',
        `Modelo local configurado "${staleLocalModel}" não existe no catálogo atual.`,
        `Escolha ${Object.values(LOCAL_MODELS).map((m) => m.label).join(', ')} em Configurações > Assistente IA e salve novamente.`,
      )
    }
    const model = resolveModel(config, 'local')
    if (!(model in LOCAL_MODELS)) {
      return fail(
        'local',
        model,
        'invalid_local_model_config',
        `Modelo local configurado "${model}" não existe no catálogo atual.`,
        `Escolha ${Object.values(LOCAL_MODELS).map((m) => m.label).join(', ')} em Configurações > Assistente IA e salve novamente.`,
      )
    }
    const modelId = model as keyof typeof LOCAL_MODELS
    const status = getLocalStatus().modelos[modelId]

    if (!status?.baixado) {
      return fail(
        'local',
        model,
        'download_local_model',
        `Modelo local "${LOCAL_MODELS[modelId]?.label ?? model}" não está baixado.`,
        'Baixe o modelo em Configurações > Assistente IA.',
      )
    }

    if (options.validateLocal && !status.usable) {
      try {
        await validateLocalModel(modelId)
      } catch {
        // O status abaixo já carrega o erro gravado por validateLocalModel/ensureModelLoaded.
      }
    }

    const fresh = getLocalStatus().modelos[modelId]
    if (fresh?.load_error) {
      return fail(
        'local',
        model,
        'local_model_error',
        `Modelo local "${LOCAL_MODELS[modelId]?.label ?? model}" falhou ao carregar: ${fresh.load_error}`,
        'Remova/baixe novamente ou escolha outro provider em Configurações.',
      )
    }

    if (!fresh?.usable) {
      return fail(
        'local',
        model,
        'validate_local_model',
        `Modelo local "${LOCAL_MODELS[modelId]?.label ?? model}" está baixado, mas ainda não foi validado.`,
        'Clique em Testar conexão antes de usar chat ou CLI.',
      )
    }

    return {
      ok: true,
      provider: 'local',
      model,
      reason: 'ready',
      message: `IA local pronta: ${LOCAL_MODELS[modelId]?.label ?? model}.`,
    }
  }

  if (config.provider === 'gemini') {
    const model = resolveModel(config, 'gemini')
    if (!isGeminiCloudApiEnabled()) {
      return fail(
        'gemini',
        model,
        'configure_provider',
        'Gemini API direta está desativada nesta build.',
        'Troque para OpenRouter ou IA Local em Configurações.',
      )
    }
    if (!resolveProviderApiKey(config)) {
      return fail(
        'gemini',
        model,
        'configure_cloud_token',
        'API Key do Gemini não configurada.',
        'Informe a chave em Configurações > Assistente IA.',
      )
    }
    return { ok: true, provider: 'gemini', model, reason: 'ready', message: `Gemini pronto: ${model}.` }
  }

  if (config.provider === 'openrouter') {
    const model = resolveModel(config, 'openrouter')
    if (!resolveProviderApiKey(config)) {
      return fail(
        'openrouter',
        model,
        'configure_cloud_token',
        'Token do OpenRouter não configurado.',
        'Informe o token em Configurações > Assistente IA.',
      )
    }
    return { ok: true, provider: 'openrouter', model, reason: 'ready', message: `OpenRouter pronto: ${model}.` }
  }

  return fail(
    config.provider,
    config.modelo,
    'configure_provider',
    `Provider "${config.provider}" não suportado.`,
    'Escolha Gemini, OpenRouter ou IA Local em Configurações.',
  )
}

export async function assertIaCanChat(): Promise<IaChatReadiness> {
  const readiness = await getIaChatReadiness({ validateLocal: true })
  if (!readiness.ok) {
    const suffix = readiness.action ? ` ${readiness.action}` : ''
    throw new Error(`${readiness.message}${suffix}`)
  }
  return readiness
}
