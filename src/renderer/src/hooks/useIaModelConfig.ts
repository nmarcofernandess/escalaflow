import { useState, useEffect, useCallback } from 'react'
import type { IaProviderId, IaModelCatalogItem } from '@shared/index'

const ipc = window.electron.ipcRenderer

interface IaModelConfig {
  provider: IaProviderId
  modelo: string
  modeloLabel: string
  modelOptions: IaModelCatalogItem[]
  contextLength: number | null
  supportsMultimodal: boolean
  isLoading: boolean
  setProvider: (p: IaProviderId) => Promise<void>
  setModelo: (m: string) => Promise<void>
}

const MULTIMODAL_PATTERNS = ['claude-3', 'claude-sonnet-4', 'claude-opus-4', 'gpt-4o', 'gpt-4-turbo', 'gemini']

function checkMultimodal(provider: IaProviderId, modelo: string, catalogItem?: IaModelCatalogItem): boolean {
  if (provider === 'gemini') return true
  if (catalogItem?.tags?.some(t => t === 'multimodal' || t === 'vision')) return true
  return MULTIMODAL_PATTERNS.some(p => modelo.includes(p))
}

export function useIaModelConfig(): IaModelConfig {
  const [provider, setProviderState] = useState<IaProviderId>('gemini')
  const [modelo, setModeloState] = useState('')
  const [modeloLabel, setModeloLabel] = useState('')
  const [modelOptions, setModelOptions] = useState<IaModelCatalogItem[]>([])
  const [contextLength, setContextLength] = useState<number | null>(null)
  const [supportsMultimodal, setSupportsMultimodal] = useState(true)
  const [isLoading, setIsLoading] = useState(true)
  const [fullConfig, setFullConfig] = useState<any>(null)

  const loadConfig = useCallback(async () => {
    try {
      const config = await ipc.invoke('ia.configuracao.obter') as any
      if (!config) { setIsLoading(false); return }

      const p = (config.provider || 'gemini') as IaProviderId
      const providerConfigs = config.provider_configs ?? {}
      const modeloPorProvider = providerConfigs[p]?.modelo?.trim()
      const m = modeloPorProvider || config.modelo || ''

      setProviderState(p)
      setModeloState(m)
      setFullConfig(config)

      // Fetch catalog
      const catalog = await ipc.invoke('ia.modelos.catalogo', {
        provider: p,
        provider_config: providerConfigs[p] || {},
      }) as { models: IaModelCatalogItem[] }

      let options = catalog.models || []

      // For OpenRouter: filter favorites if available
      if (p === 'openrouter') {
        const favs = providerConfigs.openrouter?.favoritos as string[] | undefined
        if (favs && favs.length > 0) {
          const favSet = new Set(favs)
          const favModels = options.filter(o => favSet.has(o.id))
          if (favModels.length > 0) options = favModels
        }
      }

      setModelOptions(options)

      const item = options.find(o => o.id === m)
      setModeloLabel(item?.label || m)
      setContextLength(item?.context_length ?? null)
      setSupportsMultimodal(checkMultimodal(p, m, item))
      setIsLoading(false)
    } catch {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => { loadConfig() }, [loadConfig])

  useEffect(() => {
    const handler = () => { loadConfig() }
    window.addEventListener('ia-config-changed', handler)
    return () => window.removeEventListener('ia-config-changed', handler)
  }, [loadConfig])

  const setProvider = useCallback(async (p: IaProviderId) => {
    if (!fullConfig) return
    const providerConfigs = fullConfig.provider_configs ?? {}
    const modeloPorProvider = providerConfigs[p]?.modelo?.trim()
    const defaults: Record<IaProviderId, string> = { gemini: 'gemini-2.5-flash', openrouter: 'anthropic/claude-sonnet-4' }
    const newModelo = modeloPorProvider || defaults[p]

    // Update provider_configs_json with new provider's modelo
    const updatedConfigs = { ...providerConfigs }
    if (!updatedConfigs[p]) updatedConfigs[p] = {}
    updatedConfigs[p].modelo = newModelo

    await ipc.invoke('ia.configuracao.salvar', {
      provider: p,
      api_key: fullConfig.api_key || '',
      modelo: newModelo,
      provider_configs_json: JSON.stringify(updatedConfigs),
    })
    window.dispatchEvent(new Event('ia-config-changed'))
  }, [fullConfig])

  const setModelo = useCallback(async (m: string) => {
    if (!fullConfig) return
    const providerConfigs = fullConfig.provider_configs ?? {}
    const updatedConfigs = { ...providerConfigs }
    if (!updatedConfigs[provider]) updatedConfigs[provider] = {}
    updatedConfigs[provider].modelo = m

    await ipc.invoke('ia.configuracao.salvar', {
      provider,
      api_key: fullConfig.api_key || '',
      modelo: m,
      provider_configs_json: JSON.stringify(updatedConfigs),
    })
    window.dispatchEvent(new Event('ia-config-changed'))
  }, [fullConfig, provider])

  return { provider, modelo, modeloLabel, modelOptions, contextLength, supportsMultimodal, isLoading, setProvider, setModelo }
}
