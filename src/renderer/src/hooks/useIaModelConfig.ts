import { useState, useEffect, useCallback } from 'react'
import type {
  IaProviderId,
  IaModelCatalogItem,
  IaCapabilities,
  IaCapabilityProvider,
  IaCapabilityModel,
} from '@shared/index'

const ipc = window.electron.ipcRenderer

type UiProviderOption = {
  provider: IaProviderId
  label: string
  disabled: boolean
  reason?: string
}

type UiModelOption = {
  id: string
  label: string
  disabled: boolean
  reason?: string
}

interface IaModelConfig {
  provider: IaProviderId
  providerOptions: UiProviderOption[]
  modelo: string
  modeloLabel: string
  modelOptions: UiModelOption[]
  contextLength: number | null
  supportsMultimodal: boolean
  isLoading: boolean
  canSendMessages: boolean
  showUnconfiguredState: boolean
  activeProviderReason?: string
  modelSelectDisabled: boolean
  setProvider: (p: IaProviderId) => Promise<void>
  setModelo: (m: string) => Promise<void>
}

const DEFAULTS: Record<IaProviderId, string> = {
  gemini: 'gemini-3-flash-preview',
  openrouter: 'openrouter/free',
  local: 'qwen3.5-9b',
}

const MULTIMODAL_PATTERNS = ['claude-3', 'claude-sonnet-4', 'claude-opus-4', 'gpt-4o', 'gpt-4-turbo', 'gemini']

function checkMultimodal(provider: IaProviderId, modelo: string, catalogItem?: IaModelCatalogItem): boolean {
  if (provider === 'gemini') return true
  if (catalogItem?.tags?.some(t => t === 'multimodal' || t === 'vision')) return true
  return MULTIMODAL_PATTERNS.some(p => modelo.includes(p))
}

function toProviderOptions(capabilities: IaCapabilities | null): UiProviderOption[] {
  return capabilities?.providers.map((provider) => ({
    provider: provider.provider,
    label: provider.label,
    disabled: false,
    reason: provider.reason,
  })) ?? []
}

function getProviderCapability(capabilities: IaCapabilities | null, provider: IaProviderId): IaCapabilityProvider | null {
  return capabilities?.providers.find((entry) => entry.provider === provider) ?? null
}

function buildCompatApiKey(provider: IaProviderId, providerConfigs: any): string {
  if (provider === 'gemini') return providerConfigs?.gemini?.token || ''
  return providerConfigs?.[provider]?.token || ''
}

function buildLocalModelOptions(providerCapability: IaCapabilityProvider | null): UiModelOption[] {
  if (!providerCapability) return []
  const source = providerCapability.available
    ? providerCapability.models.filter((model) => model.available)
    : providerCapability.models
  return source.map((model) => ({
    id: model.id,
    label: model.label,
    disabled: model.disabled,
    reason: model.reason,
  }))
}

function appendCurrentModelIfMissing(options: UiModelOption[], currentModel: string, providerCapability: IaCapabilityProvider | null): UiModelOption[] {
  if (!currentModel || options.some((option) => option.id === currentModel)) return options
  const capabilityModel = providerCapability?.models.find((model) => model.id === currentModel)
  return [
    ...options,
    {
      id: currentModel,
      label: capabilityModel?.label || currentModel,
      disabled: capabilityModel?.disabled ?? Boolean(providerCapability && !providerCapability.available),
      reason: capabilityModel?.reason ?? providerCapability?.reason,
    },
  ]
}

export function useIaModelConfig(): IaModelConfig {
  const [provider, setProviderState] = useState<IaProviderId>('gemini')
  const [providerOptions, setProviderOptions] = useState<UiProviderOption[]>([])
  const [modelo, setModeloState] = useState('')
  const [modeloLabel, setModeloLabel] = useState('')
  const [modelOptions, setModelOptions] = useState<UiModelOption[]>([])
  const [contextLength, setContextLength] = useState<number | null>(null)
  const [supportsMultimodal, setSupportsMultimodal] = useState(true)
  const [isLoading, setIsLoading] = useState(true)
  const [fullConfig, setFullConfig] = useState<any>(null)
  const [capabilities, setCapabilities] = useState<IaCapabilities | null>(null)
  const [canSendMessages, setCanSendMessages] = useState(false)
  const [showUnconfiguredState, setShowUnconfiguredState] = useState(false)
  const [activeProviderReason, setActiveProviderReason] = useState<string | undefined>(undefined)
  const [modelSelectDisabled, setModelSelectDisabled] = useState(false)

  const loadConfig = useCallback(async () => {
    setIsLoading(true)
    try {
      const [config, nextCapabilities] = await Promise.all([
        ipc.invoke('ia.configuracao.obter') as Promise<any>,
        ipc.invoke('ia.capabilities.obter') as Promise<IaCapabilities>,
      ])

      setCapabilities(nextCapabilities)
      setProviderOptions(toProviderOptions(nextCapabilities))
      setShowUnconfiguredState(Boolean(nextCapabilities.show_unconfigured_state))

      if (!config) {
        setFullConfig(null)
        setCanSendMessages(false)
        setActiveProviderReason(nextCapabilities.message)
        setModelOptions([])
        setModeloState('')
        setModeloLabel('')
        setContextLength(null)
        setSupportsMultimodal(false)
        setIsLoading(false)
        return
      }

      const p = (config.provider || nextCapabilities.active_provider || 'gemini') as IaProviderId
      const providerConfigs = config.provider_configs ?? {}
      const providerCapability = getProviderCapability(nextCapabilities, p)
      const modeloSalvo = providerConfigs[p]?.modelo?.trim() || config.modelo || DEFAULTS[p]

      setProviderState(p)
      setFullConfig(config)
      setCanSendMessages(Boolean(nextCapabilities.active_provider_available))
      setActiveProviderReason(providerCapability?.reason)

      let nextModel = modeloSalvo
      let nextOptions: UiModelOption[] = []
      let nextContextLength: number | null = null
      let nextSupportsMultimodal = p === 'gemini'

      if (p === 'local') {
        nextOptions = buildLocalModelOptions(providerCapability)
        if (providerCapability?.available) {
          if (!nextOptions.some((option) => option.id === nextModel)) {
            nextModel = nextOptions[0]?.id || nextModel
          }
        } else {
          nextOptions = appendCurrentModelIfMissing(nextOptions, nextModel, providerCapability)
        }
      } else {
        const catalog = await ipc.invoke('ia.modelos.catalogo', {
          provider: p,
          provider_config: providerConfigs[p] || {},
        }) as { models: IaModelCatalogItem[] }

        let catalogOptions = catalog.models || []

        if (p === 'openrouter') {
          const defModel = catalogOptions.find((option) => option.id === DEFAULTS.openrouter)
          const favs = providerConfigs.openrouter?.favoritos as string[] | undefined
          if (favs && favs.length > 0) {
            const favSet = new Set(favs)
            const favModels = catalogOptions.filter((option) => favSet.has(option.id) && option.id !== DEFAULTS.openrouter)
            catalogOptions = defModel ? [defModel, ...favModels] : favModels
          } else {
            catalogOptions = defModel ? [defModel] : []
          }
        }

        nextOptions = catalogOptions.map((option) => ({
          id: option.id,
          label: option.label,
          disabled: Boolean(providerCapability && !providerCapability.available),
          reason: providerCapability?.reason,
        }))

        if (providerCapability?.available) {
          if (!nextOptions.some((option) => option.id === nextModel) && nextOptions.length > 0) {
            nextModel = nextOptions[0].id
          }
        } else {
          nextOptions = appendCurrentModelIfMissing(nextOptions, nextModel, providerCapability)
        }

        const item = catalogOptions.find((option) => option.id === nextModel)
        nextContextLength = item?.context_length ?? null
        nextSupportsMultimodal = checkMultimodal(p, nextModel, item)
      }

      const resolvedModel = nextOptions.find((option) => option.id === nextModel)
      setModeloState(nextModel)
      setModelOptions(nextOptions)
      setModeloLabel(resolvedModel?.label || nextModel)
      setContextLength(nextContextLength)
      setSupportsMultimodal(nextSupportsMultimodal)
      setModelSelectDisabled(Boolean(providerCapability && !providerCapability.available))
      setIsLoading(false)
    } catch {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => { void loadConfig() }, [loadConfig])

  useEffect(() => {
    const handler = () => { void loadConfig() }
    window.addEventListener('ia-config-changed', handler)
    return () => window.removeEventListener('ia-config-changed', handler)
  }, [loadConfig])

  const setProvider = useCallback(async (p: IaProviderId) => {
    if (!fullConfig) return

    const providerConfigs = fullConfig.provider_configs ?? {}
    const modeloPorProvider = providerConfigs[p]?.modelo?.trim()
    const newModelo = modeloPorProvider || DEFAULTS[p]

    const updatedConfigs = { ...providerConfigs }
    if (!updatedConfigs[p]) updatedConfigs[p] = {}
    updatedConfigs[p].modelo = newModelo

    await ipc.invoke('ia.configuracao.salvar', {
      provider: p,
      api_key: buildCompatApiKey(p, updatedConfigs),
      modelo: newModelo,
      provider_configs_json: JSON.stringify(updatedConfigs),
    })
    window.dispatchEvent(new Event('ia-config-changed'))
  }, [capabilities, fullConfig])

  const setModelo = useCallback(async (m: string) => {
    if (!fullConfig) return
    const currentOption = modelOptions.find((option) => option.id === m)
    if (currentOption?.disabled) return

    const providerConfigs = fullConfig.provider_configs ?? {}
    const updatedConfigs = { ...providerConfigs }
    if (!updatedConfigs[provider]) updatedConfigs[provider] = {}
    updatedConfigs[provider].modelo = m

    await ipc.invoke('ia.configuracao.salvar', {
      provider,
      api_key: buildCompatApiKey(provider, updatedConfigs),
      modelo: m,
      provider_configs_json: JSON.stringify(updatedConfigs),
    })
    window.dispatchEvent(new Event('ia-config-changed'))
  }, [fullConfig, modelOptions, provider])

  return {
    provider,
    providerOptions,
    modelo,
    modeloLabel,
    modelOptions,
    contextLength,
    supportsMultimodal,
    isLoading,
    canSendMessages,
    showUnconfiguredState,
    activeProviderReason,
    modelSelectDisabled,
    setProvider,
    setModelo,
  }
}
