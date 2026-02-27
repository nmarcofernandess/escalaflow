import { useState, useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import {
  Settings,
  Monitor,
  Sun,
  Moon,
  CalendarDays,
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
  Database,
  BookOpen,
  MessageSquare,
  ChevronsUpDown,
  FileText,
  ShieldCheck,
  Brain,
  ChevronRight,
} from 'lucide-react'
import { useTheme } from 'next-themes'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from '@/components/ui/form'
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible'
import { Link } from 'react-router-dom'
import { PageHeader } from '@/componentes/PageHeader'
import { DirtyGuardDialog } from '@/componentes/DirtyGuardDialog'
import { useDirtyGuard } from '@/hooks/useDirtyGuard'
import { useApiData } from '@/hooks/useApiData'
import { useColorTheme } from '@/hooks/useColorTheme'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

type UpdateStatus = 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'up-to-date' | 'error'

import type { IaProviderId, IaModelCatalogItem, IaModelCatalogResult } from '@shared/types'
import { IaModelCatalogPicker } from '@/componentes/IaModelCatalogPicker'

type IaProviderConfigForm = {
  token?: string
  modelo?: string
  favoritos?: string[]
}

const IA_PROVIDER_LABELS: Record<IaProviderId, string> = {
  gemini: 'Google Gemini',
  openrouter: 'OpenRouter (Gateway)',
}

const IA_PROVIDER_MODELS: Record<IaProviderId, Array<{ value: string; label: string }>> = {
  gemini: [
    { value: 'gemini-3-flash-preview', label: 'Gemini 3 Flash Preview (Mais Novo)' },
    { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash (Estável)' },
    { value: 'gemini-2.0-flash-thinking-exp-1219', label: 'Gemini 2.0 Flash Thinking Exp' },
    { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
    { value: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash-Lite' },
  ],
  openrouter: [
    { value: 'anthropic/claude-sonnet-4', label: 'Anthropic Claude Sonnet 4 (OpenRouter)' },
    { value: 'openai/gpt-4o-mini', label: 'OpenAI GPT-4o Mini (OpenRouter)' },
    { value: 'google/gemini-2.0-flash-exp:free', label: 'Gemini 2.0 Flash (Free, OpenRouter)' },
  ],
}

const IA_PROVIDER_DOCS: Record<IaProviderId, string> = {
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
  }
}

export function ConfiguracoesPagina() {
  const { theme: currentMode, setTheme } = useTheme()
  const { colorTheme, setColorTheme } = useColorTheme()

  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>('idle')
  const [updateVersion, setUpdateVersion] = useState<string | null>(null)
  const [downloadProgress, setDownloadProgress] = useState(0)
  const [updateError, setUpdateError] = useState<string | null>(null)
  const [appVersion, setAppVersion] = useState<string>('...')

  useEffect(() => {
    window.electron.ipcRenderer.invoke('app:version').then((v: string) => setAppVersion(v)).catch(() => { })
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

  const [backupLoading, setBackupLoading] = useState(false)
  const [restoreLoading, setRestoreLoading] = useState(false)
  const [backupCadastros, setBackupCadastros] = useState(true)
  const [backupConhecimento, setBackupConhecimento] = useState(true)
  const [backupChat, setBackupChat] = useState(false)

  const handleExportar = async () => {
    if (!backupCadastros && !backupConhecimento && !backupChat) {
      toast.error('Selecione pelo menos uma categoria para exportar.')
      return
    }
    setBackupLoading(true)
    try {
      const res = await window.electron.ipcRenderer.invoke('dados.exportar', {
        incluir_cadastros: backupCadastros,
        incluir_conhecimento: backupConhecimento,
        incluir_historico_chat: backupChat,
      }) as { filepath: string; tamanho_mb: number } | null
      if (res) {
        toast.success('Backup exportado com sucesso!', {
          description: `${res.tamanho_mb} MB — ${res.filepath}`,
        })
      }
    } catch (err: any) {
      toast.error('Erro ao exportar backup', { description: err?.message ?? 'Erro desconhecido' })
    } finally {
      setBackupLoading(false)
    }
  }

  const handleImportar = async () => {
    setRestoreLoading(true)
    try {
      const res = await window.electron.ipcRenderer.invoke('dados.importar') as {
        tabelas: number; registros: number; categorias: string[]
      } | null
      if (res) {
        const catLabel = res.categorias.join(', ')
        toast.success('Dados restaurados com sucesso!', {
          description: `${res.tabelas} tabelas, ${res.registros} registros (${catLabel}). Reinicie o app para garantir consistencia.`,
        })
      }
    } catch (err: any) {
      toast.error('Erro ao importar backup', { description: err?.message ?? 'Erro desconhecido' })
    } finally {
      setRestoreLoading(false)
    }
  }

  const iaForm = useForm({
    resolver: zodResolver(
      z.object({
        provider: z.enum(['gemini', 'openrouter']),
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

  const { data: iaConfig } = useApiData<any>(
    () => window.electron.ipcRenderer.invoke('ia.configuracao.obter'),
    []
  )

  useEffect(() => {
    if (iaConfig) {
      let parsedProviderConfigs: any = iaConfig.provider_configs
      if (!parsedProviderConfigs && iaConfig.provider_configs_json) {
        try {
          parsedProviderConfigs = JSON.parse(iaConfig.provider_configs_json)
        } catch {
          parsedProviderConfigs = {}
        }
      }
      const normalized = normalizeProviderConfigs(parsedProviderConfigs, iaConfig)
      const provider = (iaConfig.provider || 'gemini') as IaProviderId
      const activeModel = normalized[provider]?.modelo || iaConfig.modelo || IA_PROVIDER_MODELS[provider][0].value
      const activeToken = provider === 'gemini'
        ? (normalized.gemini.token || iaConfig.api_key || '')
        : ''
      iaForm.reset({
        provider,
        api_key: activeToken,
        modelo: activeModel,
        provider_configs: normalized,
      })
    }
  }, [iaConfig, iaForm])

  const [testandoIa, setTestandoIa] = useState(false)
  const [salvandoIa, setSalvandoIa] = useState(false)
  const [showApiKey, setShowApiKey] = useState(false)
  const [modelCatalogByProvider, setModelCatalogByProvider] = useState<Partial<Record<IaProviderId, IaModelCatalogResult>>>({})
  const [modelCatalogBusyProvider, setModelCatalogBusyProvider] = useState<IaProviderId | null>(null)

  const iaProvider = (iaForm.watch('provider') || 'gemini') as IaProviderId
  const providerConfigs = iaForm.watch('provider_configs') as ReturnType<typeof getDefaultProviderConfigs>
  const selectedProviderConfig = (providerConfigs?.[iaProvider] || {}) as IaProviderConfigForm
  const remoteCatalog = modelCatalogByProvider[iaProvider]
  const openrouterFavoritos = providerConfigs?.openrouter?.favoritos ?? []
  const currentModelOptions = (() => {
    if (!remoteCatalog?.models?.length) return IA_PROVIDER_MODELS[iaProvider]
    // OpenRouter com favoritos → dropdown mostra apenas favoritos
    if (iaProvider === 'openrouter' && openrouterFavoritos.length > 0) {
      const favSet = new Set(openrouterFavoritos)
      const favModels = remoteCatalog.models
        .filter((m) => favSet.has(m.id))
        .map((m) => ({ value: m.id, label: m.label }))
      return favModels.length > 0 ? favModels : IA_PROVIDER_MODELS[iaProvider]
    }
    return remoteCatalog.models.map((m) => ({ value: m.id, label: m.label }))
  })()
  const currentModelValue = iaForm.watch('modelo')
  const tokenFieldLabel = iaProvider === 'gemini'
    ? 'API Key (Google AI Studio)'
    : 'OpenRouter API Key'
  const tokenFieldPlaceholder = iaProvider === 'gemini'
    ? 'AIza...'
    : 'sk-or-...'
  useEffect(() => {
    if (!currentModelOptions.some((m) => m.value === currentModelValue)) {
      const fallback = selectedProviderConfig?.modelo && currentModelOptions.some((m) => m.value === selectedProviderConfig.modelo)
        ? selectedProviderConfig.modelo
        : currentModelOptions[0].value
      iaForm.setValue('modelo', fallback, { shouldDirty: true })
    }
  }, [currentModelOptions, currentModelValue, iaForm, selectedProviderConfig?.modelo])

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
    // Auto-carrega OpenRouter porque é público e dá metadados ricos (free/tools) úteis para escolha.
    if (iaProvider === 'openrouter' && !modelCatalogByProvider.openrouter && modelCatalogBusyProvider !== 'openrouter') {
      onCarregarCatalogoModelos('openrouter', false, true)
    }
  }, [iaProvider, modelCatalogByProvider.openrouter, modelCatalogBusyProvider])

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

      const currentValue = iaForm.getValues('modelo')
      const providerCfg = getCurrentProviderConfig(provider)
      const preferred = providerCfg?.modelo
      const nextModel =
        (preferred && res.models.some((m) => m.id === preferred) && preferred) ||
        (currentValue && res.models.some((m) => m.id === currentValue) && currentValue) ||
        res.models[0]?.id

      if (iaForm.getValues('provider') === provider && nextModel) {
        iaForm.setValue('modelo', nextModel, { shouldDirty: true })
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
          <CardContent className="space-y-6">
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
                  { value: 'green', label: 'Verde', preview: 'hsl(142.1 76.2% 36.3%)' },
                  { value: 'violet', label: 'Violeta', preview: 'hsl(262.1 83.3% 57.8%)' },
                ].map(({ value, label, preview }) => {
                  const isSelected = colorTheme === value
                  return (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setColorTheme(value as 'zinc' | 'blue' | 'green' | 'violet')}
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
              <span className="font-mono font-medium text-foreground">v{appVersion}</span>
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
                  <span className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
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
                    <Loader2 className="size-4 animate-spin text-blue-500" />
                    <div className="space-y-1">
                      <p className="text-sm">Baixando atualizacao... {downloadProgress}%</p>
                      <div className="h-1.5 w-48 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-blue-500 transition-all duration-300"
                          style={{ width: `${downloadProgress}%` }}
                        />
                      </div>
                    </div>
                  </div>
                )}
                {updateStatus === 'ready' && (
                  <span className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
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
                    <RefreshCw className="mr-1.5 size-3.5" />
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
                      className={cn('mr-1.5 size-3.5', updateStatus === 'checking' && 'animate-spin')}
                    />
                    Verificar atualizacoes
                  </Button>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Backup / Restauracao */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <HardDrive className="size-4" />
              Backup e Restauracao
            </CardTitle>
            <CardDescription>
              Exporte os dados do sistema para um arquivo .zip compactado ou restaure a partir de um backup anterior.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1">
              <p className="text-sm font-medium">Exportar dados</p>
              <p className="text-xs text-muted-foreground">
                Escolha o que incluir no backup:
              </p>
            </div>

            <div className="space-y-3 rounded-lg border p-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <Database className="size-4 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">Cadastros e escalas</p>
                    <p className="text-xs text-muted-foreground">
                      Empresa, setores, colaboradores, escalas, regras, feriados
                    </p>
                  </div>
                </div>
                <Switch
                  checked={backupCadastros}
                  onCheckedChange={setBackupCadastros}
                />
              </div>

              <Separator />

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <BookOpen className="size-4 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">Conhecimento e memorias</p>
                    <p className="text-xs text-muted-foreground">
                      Documentos importados, memorias da IA, grafo de relacoes
                    </p>
                  </div>
                </div>
                <Switch
                  checked={backupConhecimento}
                  onCheckedChange={setBackupConhecimento}
                />
              </div>

              <Separator />

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <MessageSquare className="size-4 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">Historico de conversas</p>
                    <p className="text-xs text-muted-foreground">
                      Todas as conversas com a assistente IA
                    </p>
                  </div>
                </div>
                <Switch
                  checked={backupChat}
                  onCheckedChange={setBackupChat}
                />
              </div>
            </div>

            <div className="flex justify-end">
              <Button
                size="sm"
                variant="outline"
                onClick={handleExportar}
                disabled={backupLoading || (!backupCadastros && !backupConhecimento && !backupChat)}
              >
                {backupLoading ? (
                  <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                ) : (
                  <Download className="mr-1.5 size-3.5" />
                )}
                Exportar backup
              </Button>
            </div>

            <Separator />

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-1">
                <p className="text-sm font-medium">Restaurar dados</p>
                <p className="text-xs text-muted-foreground">
                  Aceita .zip (novo) ou .json (legado). Substitui apenas as categorias presentes no backup.
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={handleImportar}
                disabled={restoreLoading}
                className="text-destructive hover:text-destructive"
              >
                {restoreLoading ? (
                  <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                ) : (
                  <Upload className="mr-1.5 size-3.5" />
                )}
                Importar backup
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Configuracoes Avancadas */}
        <Collapsible>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" className="flex w-full items-center justify-between px-1 py-2 text-sm font-medium text-muted-foreground hover:text-foreground">
              Configuracoes Avancadas
              <ChevronsUpDown className="size-4" />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-6 pt-2">
            {/* Assistente IA */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <BrainCircuit className="size-4" />
                  Assistente IA
                </CardTitle>
                <CardDescription>Configure o provedor e modelo de IA para o chat do RH</CardDescription>
              </CardHeader>
              <CardContent>
                <Form {...iaForm}>
                  <form className="space-y-6" onSubmit={iaForm.handleSubmit(onSubmitIa)}>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <FormField
                        control={iaForm.control}
                        name="provider"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Provedor</FormLabel>
                            <Select
                              value={field.value}
                              onValueChange={(next) => {
                                field.onChange(next)
                                const nextProvider = next as IaProviderId
                                const nextCfg = iaForm.getValues(`provider_configs.${nextProvider}` as any) as IaProviderConfigForm | undefined
                                const nextOptions = IA_PROVIDER_MODELS[nextProvider]
                                const nextModel =
                                  nextCfg?.modelo && nextOptions.some((m) => m.value === nextCfg.modelo)
                                    ? nextCfg.modelo
                                    : nextOptions[0].value
                                iaForm.setValue('modelo', nextModel, { shouldDirty: true })
                                if (nextProvider === 'gemini') {
                                  iaForm.setValue('api_key', nextCfg?.token || '', { shouldDirty: false })
                                }
                              }}
                            >
                              <FormControl>
                                <SelectTrigger>
                                  <SelectValue placeholder="Selecione o provedor..." />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                <SelectItem value="gemini">Google Gemini</SelectItem>
                                <SelectItem value="openrouter">OpenRouter</SelectItem>
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={iaForm.control}
                        name="modelo"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Modelo{iaProvider === 'openrouter' && openrouterFavoritos.length > 0 ? ` (${openrouterFavoritos.length} favoritos)` : ''}</FormLabel>
                            <Select
                              value={field.value}
                              onValueChange={(next) => {
                                field.onChange(next)
                                iaForm.setValue(`provider_configs.${iaProvider}.modelo` as any, next, {
                                  shouldDirty: true,
                                })
                              }}
                            >
                              <FormControl>
                                <SelectTrigger>
                                  <SelectValue placeholder="Selecione o modelo..." />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                {!currentModelOptions.some((m) => m.value === field.value) && field.value ? (
                                  <SelectItem value={field.value}>{field.value} (custom)</SelectItem>
                                ) : null}
                                {currentModelOptions.map((model) => (
                                  <SelectItem key={`${iaProvider}-${model.value}`} value={model.value}>
                                    {model.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    {/* API Key */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label>{tokenFieldLabel}</Label>
                        <a
                          href={IA_PROVIDER_DOCS[iaProvider]}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                        >
                          Obter chave
                          <ExternalLink className="size-3" />
                        </a>
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

                    {/* Picker de modelos OpenRouter */}
                    {iaProvider === 'openrouter' && remoteCatalog?.models?.length ? (
                      <div className="space-y-2">
                        <Label>Modelo</Label>
                        <IaModelCatalogPicker
                          models={remoteCatalog.models}
                          value={currentModelValue}
                          favorites={openrouterFavoritos}
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
                        />
                      </div>
                    ) : null}

                    {/* Footer com acoes */}
                    <div className="flex items-center justify-end gap-2 pt-2">
                      <Button type="button" variant="outline" size="sm" onClick={onTestarIa} disabled={testandoIa}>
                        {testandoIa ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : null}
                        Testar conexao
                      </Button>
                      <Button type="submit" size="sm" disabled={salvandoIa}>
                        {salvandoIa ? (
                          <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                        ) : (
                          <Save className="mr-1.5 size-3.5" />
                        )}
                        Salvar
                      </Button>
                    </div>
                  </form>
                </Form>
              </CardContent>
            </Card>

            {/* Links Rapidos */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  Links Rapidos
                </CardTitle>
                <CardDescription>Acesso rapido a paginas avancadas</CardDescription>
              </CardHeader>
              <CardContent className="space-y-1">
                <Link
                  to="/escalas"
                  className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors hover:bg-accent"
                >
                  <CalendarDays className="size-4 text-muted-foreground" />
                  <span className="flex-1">Escalas</span>
                  <ChevronRight className="size-4 text-muted-foreground" />
                </Link>
                <Link
                  to="/tipos-contrato"
                  className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors hover:bg-accent"
                >
                  <FileText className="size-4 text-muted-foreground" />
                  <span className="flex-1">Tipos de Contrato</span>
                  <ChevronRight className="size-4 text-muted-foreground" />
                </Link>
                <Link
                  to="/regras"
                  className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors hover:bg-accent"
                >
                  <ShieldCheck className="size-4 text-muted-foreground" />
                  <span className="flex-1">Regras do Motor</span>
                  <ChevronRight className="size-4 text-muted-foreground" />
                </Link>
                <Link
                  to="/memoria"
                  className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors hover:bg-accent"
                >
                  <Brain className="size-4 text-muted-foreground" />
                  <span className="flex-1">Base de Conhecimento</span>
                  <ChevronRight className="size-4 text-muted-foreground" />
                </Link>
              </CardContent>
            </Card>
          </CollapsibleContent>
        </Collapsible>
      </div>

      <DirtyGuardDialog blocker={blocker} />
    </div>
  )
}
