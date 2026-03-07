import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOpenRouter } from '@openrouter/ai-sdk-provider'
import type { IaConfiguracao } from '../../shared/types'

export const PROVIDER_DEFAULTS: Record<'gemini' | 'openrouter' | 'local', string> = {
    gemini: 'gemini-3-flash-preview',
    openrouter: 'openrouter/free',
    local: 'qwen3.5-9b',
}

/**
 * Resolve o model ID correto para o provider ativo.
 *
 * Ordem de prioridade:
 * 1. provider_configs_json[provider].modelo  — modelo salvo por provider (fonte canônica)
 * 2. config.modelo                            — modelo do provider ativo (pode estar contaminado)
 * 3. PROVIDER_DEFAULTS[provider]             — fallback hard-coded
 *
 * Validação extra para OpenRouter: exige formato 'namespace/model'.
 * Se o modelo não tiver '/', veio de outro provider e é descartado.
 */
export function resolveModel(config: IaConfiguracao, providerLabel: 'gemini' | 'openrouter' | 'local'): string {
    // 1. Tenta ler do provider_configs_json[provider].modelo
    if (config.provider_configs_json) {
        try {
            const configs = typeof config.provider_configs_json === 'string'
                ? JSON.parse(config.provider_configs_json)
                : config.provider_configs_json
            const perProviderModelo = configs?.[providerLabel]?.modelo?.trim()
            if (perProviderModelo && isValidModelForProvider(perProviderModelo, providerLabel)) {
                return perProviderModelo
            }
        } catch { /* fallback */ }
    }

    // 2. Tenta config.modelo (campo global do provider ativo)
    const globalModelo = config.modelo?.trim()
    if (globalModelo && isValidModelForProvider(globalModelo, providerLabel)) {
        return globalModelo
    }

    // 3. Default por provider
    return PROVIDER_DEFAULTS[providerLabel]
}

export function isValidModelForProvider(modelo: string, provider: 'gemini' | 'openrouter' | 'local'): boolean {
    if (!modelo) return false
    if (provider === 'local') return true
    if (provider === 'openrouter') {
        // OpenRouter exige 'namespace/model' (ex: 'anthropic/claude-sonnet-4', 'google/gemini-2.5-flash')
        return modelo.includes('/')
    }
    // Gemini: não deve ter namespace (não pode ser 'google/algo')
    return !modelo.includes('/')
}

/**
 * Cria uma model factory + modelo resolvido a partir da config do DB.
 * Usado por session-processor.ts (compaction, extraction) e tipc.ts (ia.sessao.processar).
 * Retorna null se API key não configurada.
 */
export function buildModelFactory(config: IaConfiguracao): {
    createModel: (modelo: string) => any
    modelo: string
} | null {
    const apiKey = resolveProviderApiKey(config)
    if (!apiKey) return null

    const provider = config.provider
    const modelo = resolveModel(config, provider)

    if (provider === 'local') {
        // Local usa path próprio via local-llm.ts — não precisa de model factory
        return null
    }

    if (provider === 'gemini') {
        const google = createGoogleGenerativeAI({ apiKey })
        return { createModel: (m) => google(m), modelo }
    }

    if (provider === 'openrouter') {
        const openrouter = createOpenRouter({ apiKey })
        return { createModel: (m) => openrouter(m), modelo }
    }

    return null
}

export function resolveProviderApiKey(config: IaConfiguracao): string | undefined {
    if (config.provider === 'local') return 'local-no-key'

    // provider_configs_json tem prioridade — é onde a UI multi-provider salva tokens
    if (config.provider_configs_json) {
        try {
            const configs = typeof config.provider_configs_json === 'string'
                ? JSON.parse(config.provider_configs_json)
                : config.provider_configs_json
            const providerCfg = configs?.[config.provider]
            if (providerCfg?.token?.trim()) return providerCfg.token.trim()
        } catch { /* fallback to api_key */ }
    }
    return config.api_key || undefined
}
