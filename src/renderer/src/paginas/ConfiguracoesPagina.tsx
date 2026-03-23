import { useState, useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import {
  Settings,
  Monitor,
  Sun,
  Moon,
  Check,
  Download,
  Upload,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Loader2,
  BrainCircuit,
  Eye,
  EyeOff,
  Save,
  ExternalLink,
  HardDrive,
  Trash2,
  Wifi,
  WifiOff,
  ChevronDown,
  Terminal,
  Copy,
  ClipboardCheck,
  History,
} from 'lucide-react'
import { useTheme } from 'next-themes'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Form } from '@/components/ui/form'
import { PageHeader } from '@/componentes/PageHeader'
import { DirtyGuardDialog } from '@/componentes/DirtyGuardDialog'
import { useDirtyGuard } from '@/hooks/useDirtyGuard'
import { useRestorePreview } from '@/hooks/useRestorePreview'
import { useApiData } from '@/hooks/useApiData'
import { useColorTheme } from '@/hooks/useColorTheme'
import { useAppVersion } from '@/hooks/useAppVersion'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { servicoIaLocal } from '@/servicos/iaLocal'
import { Progress } from '@/components/ui/progress'
import { IaModelPill } from '@/componentes/IaModelPill'

type UpdateStatus = 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'up-to-date' | 'error'

import type {
  IaProviderId,
  IaModelCatalogItem,
  IaModelCatalogResult,
  IaOpenRouterFreeModelsTestResult,
} from '@shared/types'
import { IaModelCatalogPicker } from '@/componentes/IaModelCatalogPicker'
import { TimeMachineModal } from '@/componentes/TimeMachineModal'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

type IaProviderConfigForm = {
  token?: string
  modelo?: string
  favoritos?: string[]
}

const IA_PROVIDER_LABELS: Record<IaProviderId, string> = {
  gemini: 'Google Gemini',
  openrouter: 'OpenRouter (Gateway)',
  local: 'IA Local (Offline)',
}

const IA_PROVIDER_MODELS: Record<IaProviderId, Array<{ value: string; label: string }>> = {
  gemini: [
    { value: 'gemini-3-flash-preview', label: 'Gemini 3 Flash (Preview)' },
    { value: 'gemini-3.1-flash-lite-preview', label: 'Gemini 3.1 Flash Lite (Preview)' },
  ],
  openrouter: [
    { value: 'openrouter/free', label: 'Free Models Router' },
  ],
  local: [
    { value: 'qwen3.5-9b', label: 'Qwen 3.5 9B' },
    { value: 'qwen3.5-4b', label: 'Qwen 3.5 4B' },
  ],
}

const IA_PROVIDER_DOCS: Partial<Record<IaProviderId, string>> = {
  gemini: 'https://aistudio.google.com/apikey',
  openrouter: 'https://openrouter.ai/keys',
}

function getDefaultProviderConfigs() {
  return {
    gemini: {
      token: '',
      modelo: IA_PROVIDER_MODELS.gemini[0].value,
      favoritos: [] as string[],
    },
    openrouter: {
      token: '',
      modelo: IA_PROVIDER_MODELS.openrouter[0].value,
      favoritos: [] as string[],
    },
    local: {
      token: '',
      modelo: IA_PROVIDER_MODELS.local[0].value,
      favoritos: [] as string[],
    },
  }
}

function normalizeProviderConfigs(input: any, iaConfig?: any) {
  const defaults = getDefaultProviderConfigs()
  const incoming = input && typeof input === 'object' ? input : {}
  const geminiLegacyToken = typeof iaConfig?.api_key === 'string' ? iaConfig.api_key : ''
  const geminiLegacyModel = typeof iaConfig?.modelo === 'string' ? iaConfig.modelo : defaults.gemini.modelo

  return {
    gemini: {
      ...defaults.gemini,
      ...(incoming.gemini || {}),
      token: (incoming.gemini?.token ?? geminiLegacyToken ?? '').toString(),
      modelo: (incoming.gemini?.modelo ?? geminiLegacyModel ?? defaults.gemini.modelo).toString(),
    },
    openrouter: {
      ...defaults.openrouter,
      ...(incoming.openrouter || {}),
    },
    local: {
      ...defaults.local,
      ...(incoming.local || {}),
    },
  }
}

function buildIaFormValues(iaConfig?: any) {
  let parsedProviderConfigs: any = iaConfig?.provider_configs
  if (!parsedProviderConfigs && iaConfig?.provider_configs_json) {
    try {
      parsedProviderConfigs = JSON.parse(iaConfig.provider_configs_json)
    } catch {
      parsedProviderConfigs = {}
    }
  }

  const normalized = normalizeProviderConfigs(parsedProviderConfigs, iaConfig)
  const provider = (iaConfig?.provider || 'gemini') as IaProviderId
  const activeModel = normalized[provider]?.modelo || iaConfig?.modelo || IA_PROVIDER_MODELS[provider][0].value
  const activeToken = provider === 'gemini'
    ? (normalized.gemini.token || iaConfig?.api_key || '')
    : ''

  return {
    provider,
    api_key: activeToken,
    modelo: activeModel,
    provider_configs: normalized,
  }
}

function McpCard() {
  const [connecting, setConnecting] = useState(false)
  const [status, setStatus] = useState<string | null>(null)

  async function handleConnect() {
    setConnecting(true)
    setStatus(null)
    try {
      const result = await window.electron.ipcRenderer.invoke('mcp.connectClaudeCode') as { success: boolean; message: string }
      setStatus(result.message)
    } catch (err) {
      setStatus(`Erro: ${err}`)
    } finally {
      setConnecting(false)
    }
  }

  async function handleCopyConfig() {
    try {
      const result = await window.electron.ipcRenderer.invoke('mcp.configJson') as { json: string | null; error?: string }
      if (result.json) {
        await navigator.clipboard.writeText(result.json)
        setStatus('Config copiado! Cole no config da sua IA.')
      } else {
        setStatus(result.error ?? 'Erro ao gerar config')
      }
    } catch (err) {
      setStatus(`Erro: ${err}`)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Terminal className="h-5 w-5" />
          Controle via Terminal
        </CardTitle>
        <CardDescription>
          Use qualquer IA com MCP pra operar o EscalaFlow direto do terminal. O app precisa estar aberto.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex gap-2">
          <Button onClick={handleConnect} disabled={connecting} variant="default" size="sm">
            {connecting ? 'Conectando...' : 'Conectar Claude Code'}
          </Button>
          <Button onClick={handleCopyConfig} variant="outline" size="sm">
            Copiar Config MCP
          </Button>
        </div>
        {status && (
          <p className="text-sm text-muted-foreground">{status}</p>
        )}
      </CardContent>
    </Card>
  )
}

export function ConfiguracoesPagina() {
  const { theme: currentMode, setTheme } = useTheme()
  const { colorTheme, setColorTheme } = useColorTheme()

  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>('idle')
  const [updateVersion, setUpdateVersion] = useState<string | null>(null)
  const [downloadProgress, setDownloadProgress] = useState(0)
  const [updateError, setUpdateError] = useState<string | null>(null)
  const appVersion = useAppVersion()

  useEffect(() => {
    window.electron.ipcRenderer.on('update:checking', () => setUpdateStatus('checking'))
    window.electron.ipcRenderer.on('update:available', (info: { version: string }) => {
      setUpdateStatus('available')
      setUpdateVersion(info?.version ?? null)
    })
    window.electron.ipcRenderer.on('update:not-available', () => setUpdateStatus('up-to-date'))
    window.electron.ipcRenderer.on('update:progress', (p: { percent: number }) => {
      setUpdateStatus('downloading')
      setDownloadProgress(Math.round(p?.percent ?? 0))
    })
    window.electron.ipcRenderer.on('update:downloaded', () => setUpdateStatus('ready'))
    window.electron.ipcRenderer.on('update:error', (msg: string) => {
      setUpdateStatus('error')
      setUpdateError(msg)
    })
  }, [])

  const handleCheckUpdate = () => {
    setUpdateError(null)
    setUpdateStatus('checking')
    window.electron.ipcRenderer.invoke('update:check').catch(() => { })
  }

  const handleInstallUpdate = () => {
    window.electron.ipcRenderer.invoke('update:install').catch(() => { })
  }

  // Backup
  const [backupConfig, setBackupConfig] = useState<{
    pasta: string | null; pasta_padrao: string; ativo: boolean; ultimo_backup: string | null
  } | null>(null)
  const [backupNowLoading, setBackupNowLoading] = useState(false)
  const [timeMachineOpen, setTimeMachineOpen] = useState(false)
  const [exportLoading, setExportLoading] = useState(false)
  const [importLoading, setImportLoading] = useState(false)
  const { isPreviewMode } = useRestorePreview()

  useEffect(() => {
    window.electron.ipcRenderer.invoke('backup.config.obter').then((config: any) => {
      setBackupConfig(config)
    }).catch(console.error)
  }, [])

  async function handleToggleBackup(ativo: boolean) {
    try {
      const updated = await window.electron.ipcRenderer.invoke('backup.config.salvar', { ativo }) as typeof backupConfig
      setBackupConfig(updated)
    } catch (err) {
      toast.error('Erro ao salvar configuracao', { description: (err as Error).message })
    }
  }

  async function handleBackupNow() {
    setBackupNowLoading(true)
    try {
      const result = await window.electron.ipcRenderer.invoke('backup.snapshots.criar', { trigger: 'manual', scope: 'operational' }) as any
      if (result) {
        toast.success('Backup criado!', { description: `${result.meta.registros} registros salvos` })
        const config = await window.electron.ipcRenderer.invoke('backup.config.obter') as typeof backupConfig
        setBackupConfig(config)
      } else {
        toast.info('Backup ja em andamento')
      }
    } catch (err) {
      toast.error('Erro ao criar backup', { description: (err as Error).message })
    } finally {
      setBackupNowLoading(false)
    }
  }

  async function handleExportarCompleto() {
    setExportLoading(true)
    try {
      const result = await window.electron.ipcRenderer.invoke('dados.exportar') as { filepath: string; tamanho_mb: number } | null
      if (result) {
        toast.success('Backup completo exportado!', { description: `${result.tamanho_mb} MB` })
      }
    } catch (err) {
      toast.error('Erro ao exportar', { description: (err as Error).message })
    } finally {
      setExportLoading(false)
    }
  }

  async function handleChooseBackupFolder() {
    try {
      const folder = await window.electron.ipcRenderer.invoke('backup.pasta.escolher') as string | null
      if (folder) {
        const updated = await window.electron.ipcRenderer.invoke('backup.config.salvar', { pasta: folder }) as typeof backupConfig
        setBackupConfig(updated)
      }
    } catch (err) {
      toast.error('Erro ao alterar pasta', { description: (err as Error).message })
    }
  }

  async function handleResetBackupFolder() {
    try {
      const updated = await window.electron.ipcRenderer.invoke('backup.config.salvar', { pasta: null }) as typeof backupConfig
      setBackupConfig(updated)
      toast.success('Pasta restaurada para padrao')
    } catch (err) {
      toast.error('Erro ao resetar pasta', { description: (err as Error).message })
    }
  }

  async function handleImportar() {
    setImportLoading(true)
    try {
      const res = await window.electron.ipcRenderer.invoke('dados.importar') as {
        tabelas: number; registros: number; categorias: string[]
      } | null
      if (res) {
        toast.success('Dados importados!', {
          description: `${res.tabelas} tabelas, ${res.registros} registros. Reinicie o app.`,
        })
      }
    } catch (err: any) {
      toast.error('Erro ao importar', { description: err?.message ?? 'Erro desconhecido' })
    } finally {
      setImportLoading(false)
    }
  }

  // IA Local — download state
  type LocalModelInfo = { id: string; label: string; filename: string; size_bytes: number; ram_minima_gb: number; descricao: string; baixado: boolean }
  const [localModels, setLocalModels] = useState<LocalModelInfo[]>([])
  const [localDownloading, setLocalDownloading] = useState<string | null>(null)
  const [localProgress, setLocalProgress] = useState<{ downloaded: number; total: number } | null>(null)
  const [localGpu, setLocalGpu] = useState<string>('...')

  const refreshLocalModels = async () => {
    try {
      const models = await servicoIaLocal.models()
      setLocalModels(models)
      const status = await servicoIaLocal.status()
      setLocalGpu(status.gpu_detectada || 'cpu')
    } catch { /* não fatal */ }
  }

  useEffect(() => {
    refreshLocalModels()
    const handler = (_e: any, data: { model_id: string; downloaded: number; total: number }) => {
      setLocalDownloading(data.model_id)
      setLocalProgress({ downloaded: data.downloaded, total: data.total })
    }
    window.electron.ipcRenderer.on('ia:local:download-progress', handler)
    return () => { window.electron.ipcRenderer.removeAllListeners('ia:local:download-progress') }
  }, [])

  const handleLocalDownload = async (modelId: string) => {
    setLocalDownloading(modelId)
    setLocalProgress({ downloaded: 0, total: 1 })
    try {
      await servicoIaLocal.download(modelId)
      toast.success('Modelo baixado com sucesso!')
      await refreshLocalModels()
      reloadIaConfig()
    } catch (err: any) {
      if (!err.message?.includes('cancelado')) {
        toast.error(err.message || 'Erro ao baixar modelo')
      }
    } finally {
      setLocalDownloading(null)
      setLocalProgress(null)
    }
  }

  const handleLocalCancel = async () => {
    try {
      await servicoIaLocal.cancelDownload()
      toast.info('Download cancelado')
    } catch { /* ok */ }
    setLocalDownloading(null)
    setLocalProgress(null)
  }

  const handleLocalDelete = async (modelId: string) => {
    try {
      await servicoIaLocal.deleteModel(modelId)
      toast.success('Modelo removido')
      await refreshLocalModels()
      reloadIaConfig()
    } catch (err: any) {
      toast.error(err.message || 'Erro ao remover modelo')
    }
  }

  const iaForm = useForm({
    resolver: zodResolver(
      z.object({
        provider: z.enum(['gemini', 'openrouter', 'local']),
        api_key: z.string().optional(),
        modelo: z.string(),
        provider_configs: z.object({
          gemini: z.object({
            token: z.string().optional(),
            modelo: z.string().optional(),
            favoritos: z.array(z.string()).optional(),
          }),
          openrouter: z.object({
            token: z.string().optional(),
            modelo: z.string().optional(),
            favoritos: z.array(z.string()).optional(),
          }),
          local: z.object({
            token: z.string().optional(),
            modelo: z.string().optional(),
            favoritos: z.array(z.string()).optional(),
          }),
        }),
      })
    ),
    defaultValues: {
      provider: 'gemini' as IaProviderId,
      api_key: '',
      modelo: IA_PROVIDER_MODELS.gemini[0].value,
      provider_configs: getDefaultProviderConfigs(),
    },
  })

  const blocker = useDirtyGuard({ isDirty: iaForm.formState.isDirty })

  const { data: iaConfig, reload: reloadIaConfig } = useApiData<any>(
    () => window.electron.ipcRenderer.invoke('ia.configuracao.obter'),
    []
  )

  useEffect(() => {
    if (iaConfig) {
      iaForm.reset(buildIaFormValues(iaConfig))
    }
  }, [iaConfig, iaForm])

  const [testandoIa, setTestandoIa] = useState(false)
  const [salvandoIa, setSalvandoIa] = useState(false)
  const [showApiKey, setShowApiKey] = useState(false)
  const [modelCatalogByProvider, setModelCatalogByProvider] = useState<Partial<Record<IaProviderId, IaModelCatalogResult>>>({})
  const [modelCatalogBusyProvider, setModelCatalogBusyProvider] = useState<IaProviderId | null>(null)
  const [openrouterTestedModelIds, setOpenrouterTestedModelIds] = useState<string[]>([])
  const [testandoOpenrouterGratuitos, setTestandoOpenrouterGratuitos] = useState(false)

  const iaProvider = (iaForm.watch('provider') || 'gemini') as IaProviderId
  const providerConfigs = iaForm.watch('provider_configs') as ReturnType<typeof getDefaultProviderConfigs>
  const selectedProviderConfig = (providerConfigs?.[iaProvider] || {}) as IaProviderConfigForm
  const remoteCatalog = modelCatalogByProvider[iaProvider]
  const openrouterFavoritos = providerConfigs?.openrouter?.favoritos ?? []
  const installedLocalSet = new Set(localModels.filter(m => m.baixado).map(m => m.id))
  const providerAvailability: Record<IaProviderId, { available: boolean; reason?: string }> = {
    gemini: {
      available: Boolean((providerConfigs?.gemini?.token || '').trim()),
      reason: (providerConfigs?.gemini?.token || '').trim() ? undefined : 'API key não configurada.',
    },
    openrouter: {
      available: Boolean((providerConfigs?.openrouter?.token || '').trim()),
      reason: (providerConfigs?.openrouter?.token || '').trim() ? undefined : 'API key não configurada.',
    },
    local: {
      available: installedLocalSet.size > 0,
      reason: installedLocalSet.size > 0 ? undefined : 'Nenhum modelo local instalado.',
    },
  }
  const hasAnyProviderAvailable = Object.values(providerAvailability).some((provider) => provider.available)
  const selectedProviderAvailability = providerAvailability[iaProvider]
  const iaStatusBadge = hasAnyProviderAvailable
    ? selectedProviderAvailability.available
      ? {
        label: 'Ativa',
        className: 'border-green-500/50 dark:border-green-500/30 text-green-600 dark:text-green-400',
      }
      : {
        label: 'Inativa',
        className: 'border-amber-500/50 dark:border-amber-500/30 text-amber-600 dark:text-amber-400',
      }
    : {
      label: 'Sem IA disponível',
      className: 'border-destructive/50 text-destructive',
    }
  const providerSelectorOptions = [
    {
      provider: 'gemini' as const,
      label: 'Google Gemini',
      disabled: false,
    },
    {
      provider: 'openrouter' as const,
      label: 'OpenRouter',
      disabled: false,
    },
    {
      provider: 'local' as const,
      label: 'IA Local (Offline)',
      disabled: false,
    },
  ]
  const currentModelOptions = (() => {
    // Local: mostra todos, mas marca quais estão instalados (disabled handled no render)
    if (iaProvider === 'local') {
      return IA_PROVIDER_MODELS.local
    }
    if (!remoteCatalog?.models?.length) return IA_PROVIDER_MODELS[iaProvider]
    // OpenRouter: default (openrouter/free) sempre presente + favoritos
    if (iaProvider === 'openrouter') {
      const defaultEntry = { value: 'openrouter/free', label: 'Free Models Router' }
      if (openrouterFavoritos.length > 0) {
        const favSet = new Set(openrouterFavoritos)
        const favModels = remoteCatalog.models
          .filter((m) => favSet.has(m.id) && m.id !== 'openrouter/free')
          .map((m) => ({ value: m.id, label: m.label }))
        return [defaultEntry, ...favModels]
      }
      return [defaultEntry]
    }
    return remoteCatalog.models.map((m) => ({ value: m.id, label: m.label }))
  })()
  const currentModelValue = iaForm.watch('modelo')
  const providerStoredModel = (selectedProviderConfig?.modelo || '').trim()
  const providerDefaultModel = currentModelOptions[0]?.value || IA_PROVIDER_MODELS[iaProvider][0].value
  const selectorModelOptions = (() => {
    if (iaProvider === 'local') {
      if (selectedProviderAvailability.available) {
        return IA_PROVIDER_MODELS.local
          .filter((model) => installedLocalSet.has(model.value))
          .map((model) => ({ id: model.value, label: model.label, disabled: false }))
      }
      return IA_PROVIDER_MODELS.local.map((model) => ({ id: model.value, label: model.label, disabled: true }))
    }

    const base = currentModelOptions.map((model) => ({
      id: model.value,
      label: model.label,
      disabled: !selectedProviderAvailability.available,
    }))

    if (currentModelValue && !base.some((model) => model.id === currentModelValue)) {
      return [
        ...base,
        {
          id: currentModelValue,
          label: currentModelValue,
          disabled: !selectedProviderAvailability.available,
        },
      ]
    }

    return base
  })()
  const resolvedCurrentModelValue = (() => {
    if (currentModelValue && selectorModelOptions.some((model) => model.id === currentModelValue)) {
      return currentModelValue
    }
    if (providerStoredModel && selectorModelOptions.some((model) => model.id === providerStoredModel)) {
      return providerStoredModel
    }
    if (selectedProviderAvailability.available) {
      return selectorModelOptions.find((model) => !model.disabled)?.id || providerDefaultModel
    }
    return currentModelValue || providerStoredModel || providerDefaultModel
  })()
  const selectorModelLabel = selectorModelOptions.find((model) => model.id === resolvedCurrentModelValue)?.label
    || currentModelOptions.find((model) => model.value === resolvedCurrentModelValue)?.label
    || resolvedCurrentModelValue
  const tokenFieldLabel = iaProvider === 'gemini'
    ? 'API Key (Google AI Studio)'
    : 'OpenRouter API Key'
  const tokenFieldPlaceholder = iaProvider === 'gemini'
    ? 'AIza...'
    : 'sk-or-...'
  useEffect(() => {
    if (iaProvider === 'gemini') {
      const geminiToken = (providerConfigs?.gemini?.token || '').trim()
      const legacyValue = (iaForm.getValues('api_key') || '').trim()
      if (geminiToken !== legacyValue) {
        iaForm.setValue('api_key', geminiToken, { shouldDirty: false })
      }
    }
  }, [iaProvider, providerConfigs?.gemini?.token, iaForm])

  useEffect(() => {
    if (!resolvedCurrentModelValue) return

    const currentValue = (iaForm.getValues('modelo') || '').trim()
    if (currentValue !== resolvedCurrentModelValue) {
      iaForm.setValue('modelo', resolvedCurrentModelValue, { shouldDirty: false })
    }

    const providerModelPath = `provider_configs.${iaProvider}.modelo` as const
    const currentProviderModel = (iaForm.getValues(providerModelPath as any) || '').trim()
    if (currentProviderModel !== resolvedCurrentModelValue) {
      iaForm.setValue(providerModelPath as any, resolvedCurrentModelValue, { shouldDirty: false })
    }
  }, [iaForm, iaProvider, resolvedCurrentModelValue])

  useEffect(() => {
    // Auto-carrega catálogo dinâmico para OpenRouter e Gemini
    if (iaProvider === 'openrouter' && !modelCatalogByProvider.openrouter && modelCatalogBusyProvider !== 'openrouter') {
      onCarregarCatalogoModelos('openrouter', false, true)
    }
    if (iaProvider === 'gemini' && !modelCatalogByProvider.gemini && modelCatalogBusyProvider !== 'gemini') {
      onCarregarCatalogoModelos('gemini', false, true)
    }
  }, [iaProvider, modelCatalogByProvider.openrouter, modelCatalogByProvider.gemini, modelCatalogBusyProvider])

  const buildIaConfigPayload = (rawValues?: any) => {
    const values = rawValues || iaForm.getValues()
    const provider = (values.provider || 'gemini') as IaProviderId
    const normalizedProviderConfigs = normalizeProviderConfigs(values.provider_configs, values)
    normalizedProviderConfigs[provider] = {
      ...normalizedProviderConfigs[provider],
      modelo: values.modelo || normalizedProviderConfigs[provider].modelo,
      ...(provider === 'gemini'
        ? { token: normalizedProviderConfigs.gemini.token || values.api_key || '' }
        : {}),
    }

    const activeCfg = normalizedProviderConfigs[provider]
    const apiKeyForCompat = provider === 'gemini'
      ? (normalizedProviderConfigs.gemini.token || values.api_key || '')
      : (activeCfg?.token || '')

    return {
      provider,
      api_key: apiKeyForCompat,
      modelo: values.modelo,
      provider_configs: normalizedProviderConfigs,
      provider_configs_json: JSON.stringify(normalizedProviderConfigs),
    }
  }

  const getCurrentProviderConfig = (provider: IaProviderId) => {
    const payload = buildIaConfigPayload()
    return (payload.provider_configs?.[provider] || {}) as IaProviderConfigForm
  }

  const onCarregarCatalogoModelos = async (provider: IaProviderId, forceRefresh = true, silent = false) => {
    setModelCatalogBusyProvider(provider)
    try {
      const res = await window.electron.ipcRenderer.invoke('ia.modelos.catalogo', {
        provider,
        provider_config: getCurrentProviderConfig(provider),
        force_refresh: forceRefresh,
      }) as IaModelCatalogResult

      setModelCatalogByProvider((prev) => ({ ...prev, [provider]: res }))
      if (provider === 'openrouter') {
        setOpenrouterTestedModelIds([])
      }

      if (!silent) {
        toast.success(`${IA_PROVIDER_LABELS[provider]}: ${res.models.length} modelos carregados (${res.source})`)
        if (res.message) {
          toast.message(res.message)
        }
      }
    } catch (err: any) {
      if (!silent) {
        toast.error(err.message || `Erro ao carregar catálogo de modelos (${IA_PROVIDER_LABELS[provider]})`)
      }
    } finally {
      setModelCatalogBusyProvider(null)
    }
  }

  const onTestarModelosGratisOpenRouter = async () => {
    const providerCfg = getCurrentProviderConfig('openrouter')
    const token = (providerCfg?.token || '').trim()
    if (!token) {
      toast.error('Configure a OpenRouter API Key antes de testar os modelos gratuitos.')
      return
    }

    const freeModelIds = (remoteCatalog?.models || [])
      .filter((model) => model.is_free && model.id !== 'openrouter/free')
      .map((model) => model.id)

    if (freeModelIds.length === 0) {
      toast.message('Nenhum modelo gratuito elegível para testar na lista atual.')
      return
    }

    setTestandoOpenrouterGratuitos(true)
    try {
      const result = await window.electron.ipcRenderer.invoke('ia.openrouter.testarGratuitos', {
        provider_config: providerCfg,
        model_ids: freeModelIds,
      }) as IaOpenRouterFreeModelsTestResult

      setOpenrouterTestedModelIds(result.successful_model_ids)

      const currentFavorites = iaForm.getValues('provider_configs.openrouter.favoritos' as any) as string[] ?? []
      const mergedFavorites = Array.from(new Set([
        ...currentFavorites,
        ...result.successful_model_ids.filter((id) => id !== 'openrouter/free'),
      ]))

      iaForm.setValue('provider_configs.openrouter.favoritos' as any, mergedFavorites, {
        shouldDirty: true,
      })

      if (result.success_count > 0) {
        toast.success(`${result.success_count} modelos gratuitos aprovados`, {
          description: `${result.tested_models} testados. Os aprovados foram disponibilizados no seletor.`,
        })
      } else {
        toast.warning('Nenhum modelo gratuito passou no teste.', {
          description: `${result.tested_models} modelos foram verificados.`,
        })
      }
    } catch (err: any) {
      toast.error(err.message || 'Erro ao testar modelos gratuitos do OpenRouter.')
    } finally {
      setTestandoOpenrouterGratuitos(false)
    }
  }

  const onTestarIa = async () => {
    const payload = buildIaConfigPayload()
    setTestandoIa(true)
    try {
      const res = await window.electron.ipcRenderer.invoke('ia.configuracao.testar', payload)
      if (res.sucesso) {
        toast.success(res.mensagem || 'Conectado com sucesso!')
      }
    } catch (err: any) {
      toast.error(err.message || 'Erro ao testar conexao.')
    } finally {
      setTestandoIa(false)
    }
  }

  const onSubmitIa = async (data: any) => {
    setSalvandoIa(true)
    try {
      const payload = buildIaConfigPayload(data)
      await window.electron.ipcRenderer.invoke('ia.configuracao.salvar', payload)
      reloadIaConfig()
      iaForm.reset(buildIaFormValues(payload))
      window.dispatchEvent(new CustomEvent('ia-config-changed'))
      toast.success('Configuracoes de IA salvas.')
    } catch (err: any) {
      toast.error(err.message || 'Erro ao salvar configuracoes.')
    } finally {
      setSalvandoIa(false)
    }
  }

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader
        breadcrumbs={[{ label: 'Dashboard', href: '/' }, { label: 'Configuracoes' }]}
      />

      <div className="flex flex-col gap-6 p-6">
        {/* Aparência */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Settings className="size-4" />
              Aparencia
            </CardTitle>
            <CardDescription>Personalize o visual do sistema</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-6">
            <div>
              <h4 className="mb-1 text-sm font-medium">Modo</h4>
              <p className="mb-4 text-sm text-muted-foreground">
                Escolha entre claro, escuro ou automatico
              </p>
              <div className="grid grid-cols-3 gap-3">
                {[
                  { value: 'system', label: 'Automatico', icon: Monitor },
                  { value: 'light', label: 'Claro', icon: Sun },
                  { value: 'dark', label: 'Escuro', icon: Moon },
                ].map(({ value, label, icon: Icon }) => {
                  const isSelected = currentMode === value
                  return (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setTheme(value)}
                      className={cn(
                        'flex flex-col items-center gap-2 rounded-lg border p-4 transition-colors hover:bg-accent',
                        isSelected && 'border-primary bg-accent'
                      )}
                    >
                      <Icon className="size-5" />
                      <span className="text-sm">{label}</span>
                    </button>
                  )
                })}
              </div>
            </div>

            <Separator />

            <div>
              <h4 className="mb-1 text-sm font-medium">Cor do tema</h4>
              <p className="mb-4 text-sm text-muted-foreground">
                Escolha a paleta de cores da interface
              </p>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  { value: 'zinc', label: 'Zinc', preview: 'hsl(222.2 47.4% 11.2%)' },
                  { value: 'blue', label: 'Azul', preview: 'hsl(221.2 83.2% 53.3%)' },
                  { value: 'violet', label: 'Violeta', preview: 'hsl(262.1 83.3% 57.8%)' },
                ].map(({ value, label, preview }) => {
                  const isSelected = colorTheme === value
                  return (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setColorTheme(value as 'zinc' | 'blue' | 'violet')}
                      className={cn(
                        'relative flex flex-col items-center gap-3 rounded-lg border p-4 transition-colors hover:bg-accent',
                        isSelected && 'ring-2 ring-ring ring-offset-2 ring-offset-background'
                      )}
                    >
                      {isSelected && (
                        <Check className="absolute right-2 top-2 size-4 text-primary" />
                      )}
                      <div className="flex gap-1">
                        <div
                          className="size-6 rounded-full border"
                          style={{ backgroundColor: 'hsl(var(--background))' }}
                        />
                        <div
                          className="size-6 rounded-full border"
                          style={{ backgroundColor: preview }}
                        />
                      </div>
                      <span className="text-sm">{label}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Atualizações */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Download className="size-4" />
              Atualizacoes do sistema
            </CardTitle>
            <CardDescription>
              Versao atual:{' '}
              <span className="font-mono font-medium text-foreground">
                {appVersion != null ? `v${appVersion}` : 'Carregando...'}
              </span>
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                {updateStatus === 'idle' && (
                  <span className="text-sm text-muted-foreground">
                    Clique para verificar se ha uma nova versao disponivel.
                  </span>
                )}
                {updateStatus === 'checking' && (
                  <span className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" />
                    Verificando...
                  </span>
                )}
                {updateStatus === 'up-to-date' && (
                  <span className="flex items-center gap-2 text-sm text-success">
                    <CheckCircle2 className="size-4" />
                    Voce esta na versao mais recente.
                  </span>
                )}
                {updateStatus === 'available' && (
                  <span className="flex items-center gap-2 text-sm text-blue-600 dark:text-blue-400">
                    <Download className="size-4" />
                    Nova versao disponivel{updateVersion ? `: v${updateVersion}` : ''}. Baixando...
                  </span>
                )}
                {updateStatus === 'downloading' && (
                  <div className="flex items-center gap-3">
                    <Loader2 className="size-4 animate-spin text-blue-600 dark:text-blue-400" />
                    <div className="flex flex-col gap-1">
                      <p className="text-sm">Baixando atualizacao... {downloadProgress}%</p>
                      <div className="h-1.5 w-48 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-blue-600 dark:bg-blue-500 transition-all duration-300"
                          style={{ width: `${downloadProgress}%` }}
                        />
                      </div>
                    </div>
                  </div>
                )}
                {updateStatus === 'ready' && (
                  <span className="flex items-center gap-2 text-sm text-success">
                    <CheckCircle2 className="size-4" />
                    Atualizacao pronta! Reinicie para instalar.
                  </span>
                )}
                {updateStatus === 'error' && (
                  <span className="flex items-center gap-2 text-sm text-destructive">
                    <AlertCircle className="size-4" />
                    {updateError ?? 'Erro ao verificar atualizacao.'}
                  </span>
                )}
              </div>
              <div className="flex shrink-0 gap-2">
                {updateStatus === 'ready' ? (
                  <Button size="sm" onClick={handleInstallUpdate}>
                    <RefreshCw />
                    Reiniciar e instalar
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleCheckUpdate}
                    disabled={updateStatus === 'checking' || updateStatus === 'downloading'}
                  >
                    <RefreshCw
                      className={cn(updateStatus === 'checking' && 'animate-spin')}
                    />
                    Verificar atualizacoes
                  </Button>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Backup */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <HardDrive className="size-4" />
              Backup
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {backupConfig && (
              <>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium">Backup automatico</div>
                    <div className="text-xs text-muted-foreground">Salva ao fechar e a cada 24h</div>
                  </div>
                  <Switch
                    checked={backupConfig.ativo}
                    onCheckedChange={handleToggleBackup}
                  />
                </div>

                {backupConfig.ativo && (
                  <div className="flex items-center justify-between gap-2 rounded-md bg-muted/50 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs text-muted-foreground" title={backupConfig.pasta ?? backupConfig.pasta_padrao}>
                        {backupConfig.pasta ?? backupConfig.pasta_padrao}
                      </div>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={handleChooseBackupFolder}>
                        Alterar
                      </Button>
                      {backupConfig.pasta && (
                        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={handleResetBackupFolder}>
                          Resetar
                        </Button>
                      )}
                    </div>
                  </div>
                )}

                {backupConfig.ultimo_backup && (
                  <div className="text-xs text-muted-foreground">
                    Ultimo backup: {new Date(backupConfig.ultimo_backup).toLocaleString('pt-BR')}
                  </div>
                )}
              </>
            )}

            <div className="flex flex-wrap gap-2 border-t pt-3">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={backupNowLoading || exportLoading || isPreviewMode}
                    title={isPreviewMode ? 'Saia da visualizacao para editar' : undefined}
                  >
                    {(backupNowLoading || exportLoading) ? (
                      <Loader2 className="animate-spin" />
                    ) : (
                      <Save />
                    )}
                    {backupNowLoading ? 'Salvando...' : exportLoading ? 'Exportando...' : 'Backup'}
                    <ChevronDown />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuItem onClick={handleBackupNow}>
                    <Save />
                    Backup Agora
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleExportarCompleto}>
                    <Download />
                    Backup Completo...
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Button
                size="sm"
                variant="outline"
                onClick={handleImportar}
                disabled={importLoading || isPreviewMode}
                title={isPreviewMode ? 'Saia da visualizacao para editar' : undefined}
              >
                {importLoading ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <Upload />
                )}
                Importar
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setTimeMachineOpen(true)}
              >
                <History />
                Maquina do Tempo
              </Button>
            </div>
            <TimeMachineModal open={timeMachineOpen} onOpenChange={setTimeMachineOpen} />
          </CardContent>
        </Card>

        {/* Claude Code MCP */}
        <McpCard />

        {/* Assistente IA e IA Local — sempre visíveis */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <BrainCircuit className="size-4" />
                Assistente IA
              </CardTitle>
              <Badge variant="outline" className={iaStatusBadge.className}>
                {iaStatusBadge.label}
              </Badge>
              {iaProvider === 'local' && (
                <Badge variant="outline" className="border-primary/40 text-primary">
                  Beta
                </Badge>
              )}
            </div>
            <CardDescription>Configure o provedor e modelo de IA para o chat do RH</CardDescription>
          </CardHeader>
          <CardContent>
            <Form {...iaForm}>
              <form className="flex flex-col gap-6" onSubmit={iaForm.handleSubmit(onSubmitIa)}>
                <IaModelPill
                  variant="inline"
                  provider={iaProvider}
                  providerOptions={providerSelectorOptions}
                  modelo={resolvedCurrentModelValue}
                  modeloLabel={selectorModelLabel}
                  modelOptions={selectorModelOptions}
                  modelSelectDisabled={!selectedProviderAvailability.available}
                  onProviderChange={async (next) => {
                    const nextProvider = next as IaProviderId
                    const nextCfg = iaForm.getValues(`provider_configs.${nextProvider}` as any) as IaProviderConfigForm | undefined
                    const nextOptions = IA_PROVIDER_MODELS[nextProvider]
                    const nextModel =
                      nextCfg?.modelo && nextOptions.some((m) => m.value === nextCfg.modelo)
                        ? nextCfg.modelo
                        : nextOptions[0].value
                    iaForm.setValue('provider', nextProvider, { shouldDirty: true })
                    iaForm.setValue('modelo', nextModel, { shouldDirty: true })
                    if (nextProvider === 'gemini') {
                      iaForm.setValue('api_key', nextCfg?.token || '', { shouldDirty: false })
                    }
                  }}
                  onModeloChange={async (next) => {
                    if (iaProvider === 'local' && !installedLocalSet.has(next)) return
                    iaForm.setValue('modelo', next, { shouldDirty: true })
                    iaForm.setValue(`provider_configs.${iaProvider}.modelo` as any, next, {
                      shouldDirty: true,
                    })
                  }}
                />

                {/* API Key (cloud) ou Model cards (local) */}
                {iaProvider === 'local' ? (
                  <div className="flex flex-col gap-3">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <WifiOff className="size-4 shrink-0" />
                      <span>Roda no seu computador, sem internet.</span>
                      {localGpu && localGpu !== '...' && (
                        <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-xs font-medium">
                          GPU: {localGpu}
                        </span>
                      )}
                    </div>
                    {localModels.map((model) => {
                      const isDownloading = localDownloading === model.id
                      const progressPct = isDownloading && localProgress
                        ? Math.round((localProgress.downloaded / localProgress.total) * 100)
                        : 0
                      const sizeLabel = (model.size_bytes / 1e9).toFixed(1) + ' GB'
                      const isRecommended = model.id === 'qwen3.5-9b'

                      return (
                        <div key={model.id} className={cn('rounded-lg border p-3', model.baixado && 'border-green-200 bg-green-50/50 dark:border-green-900/50 dark:bg-green-950/20')}>
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <p className="text-sm font-medium">{model.label}</p>
                                {isRecommended && !model.baixado && (
                                  <span className="inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
                                    Recomendado
                                  </span>
                                )}
                                {model.baixado && (
                                  <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400">
                                    <CheckCircle2 className="size-3" />
                                    Instalado
                                  </span>
                                )}
                              </div>
                              <p className="mt-0.5 text-xs text-muted-foreground">
                                {sizeLabel} · {model.ram_minima_gb}GB+ RAM
                                {isRecommended ? ' · Melhor qualidade' : ' · Mais leve e rapido'}
                              </p>
                            </div>
                            <div className="flex shrink-0 gap-1.5">
                              {model.baixado ? (
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="ghost"
                                  className="h-8 text-destructive hover:text-destructive"
                                  onClick={() => handleLocalDelete(model.id)}
                                >
                                  <Trash2 />
                                  Remover
                                </Button>
                              ) : isDownloading ? (
                                <Button type="button" size="sm" variant="outline" className="h-8" onClick={handleLocalCancel}>
                                  Cancelar
                                </Button>
                              ) : (
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  className="h-8"
                                  onClick={() => handleLocalDownload(model.id)}
                                  disabled={!!localDownloading}
                                >
                                  <Download />
                                  Baixar ({sizeLabel})
                                </Button>
                              )}
                            </div>
                          </div>
                          {isDownloading && localProgress && (
                            <div className="mt-2 flex flex-col gap-1">
                              <Progress value={progressPct} className="h-1.5" />
                              <p className="text-xs text-muted-foreground">
                                {progressPct}% — {(localProgress.downloaded / 1e9).toFixed(1)} / {(localProgress.total / 1e9).toFixed(1)} GB
                              </p>
                            </div>
                          )}
                        </div>
                      )
                    })}
                    <p className="text-xs text-muted-foreground">
                      Recomendado: Apple Silicon ou GPU dedicada para melhor performance.
                    </p>
                  </div>
                ) : (
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <Label>{tokenFieldLabel}</Label>
                    {IA_PROVIDER_DOCS[iaProvider] && (
                    <a
                      href={IA_PROVIDER_DOCS[iaProvider]}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                    >
                      Obter chave
                      <ExternalLink className="size-3" />
                    </a>
                    )}
                  </div>
                  <div className="relative">
                    <Input
                      type={showApiKey ? 'text' : 'password'}
                      placeholder={tokenFieldPlaceholder}
                      value={(selectedProviderConfig.token ?? '') as string}
                      onChange={(e) => {
                        iaForm.setValue(`provider_configs.${iaProvider}.token` as any, e.target.value, {
                          shouldDirty: true,
                        })
                        if (iaProvider === 'gemini') {
                          iaForm.setValue('api_key', e.target.value, { shouldDirty: true })
                        }
                      }}
                      className="pr-10"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="absolute right-0 top-0 h-full w-10 hover:bg-transparent"
                      onClick={() => setShowApiKey(!showApiKey)}
                    >
                      {showApiKey ? (
                        <EyeOff className="size-4 text-muted-foreground" />
                      ) : (
                        <Eye className="size-4 text-muted-foreground" />
                      )}
                    </Button>
                  </div>
                </div>
                )}

                {/* Picker de modelos OpenRouter */}
                {iaProvider === 'openrouter' && remoteCatalog?.models?.length ? (
                  <div className="flex flex-col gap-2">
                    <Label>Modelo</Label>
                    <IaModelCatalogPicker
                      models={remoteCatalog.models}
                      value={currentModelValue}
                      favorites={openrouterFavoritos}
                      defaultModelId="openrouter/free"
                      testedModelIds={openrouterTestedModelIds}
                      testingFreeModels={testandoOpenrouterGratuitos}
                      onChange={(modelId) => {
                        iaForm.setValue('modelo', modelId, { shouldDirty: true })
                        iaForm.setValue('provider_configs.openrouter.modelo' as any, modelId, { shouldDirty: true })
                      }}
                      onToggleFavorite={(modelId) => {
                        const current = iaForm.getValues('provider_configs.openrouter.favoritos' as any) as string[] ?? []
                        const next = current.includes(modelId)
                          ? current.filter((id: string) => id !== modelId)
                          : [...current, modelId]
                        iaForm.setValue('provider_configs.openrouter.favoritos' as any, next, { shouldDirty: true })
                      }}
                      onBulkToggleFavorites={(ids, add) => {
                        const current = iaForm.getValues('provider_configs.openrouter.favoritos' as any) as string[] ?? []
                        const currentSet = new Set(current)
                        if (add) {
                          ids.forEach(id => currentSet.add(id))
                        } else {
                          ids.forEach(id => currentSet.delete(id))
                        }
                        iaForm.setValue('provider_configs.openrouter.favoritos' as any, [...currentSet], { shouldDirty: true })
                      }}
                      onTestFreeModels={onTestarModelosGratisOpenRouter}
                    />
                  </div>
                ) : null}

                {/* Footer com acoes */}
                <div className="flex items-center justify-end gap-2 pt-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => iaForm.reset()}
                    disabled={salvandoIa || !iaForm.formState.isDirty}
                  >
                    Cancelar
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={onTestarIa} disabled={testandoIa || !selectedProviderAvailability.available}>
                    {testandoIa ? <Loader2 className="animate-spin" /> : null}
                    Testar conexao
                  </Button>
                  <Button type="submit" size="sm" disabled={salvandoIa}>
                    {salvandoIa ? (
                      <Loader2 className="animate-spin" />
                    ) : (
                      <Save />
                    )}
                    Salvar
                  </Button>
                </div>
              </form>
            </Form>
          </CardContent>
        </Card>

      </div>

      <DirtyGuardDialog
        blocker={blocker}
        onSaveAndExit={async () => {
          return new Promise<void>((resolve, reject) => {
            iaForm.handleSubmit((data) => onSubmitIa(data).then(resolve, reject), () => reject())()
          })
        }}
      />
    </div>
  )
}
