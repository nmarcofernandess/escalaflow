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
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Loader2,
  BrainCircuit,
  Eye,
  EyeOff,
  Save,
} from 'lucide-react'
import { useTheme } from 'next-themes'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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
import { PageHeader } from '@/componentes/PageHeader'
import { useApiData } from '@/hooks/useApiData'
import { useColorTheme } from '@/hooks/useColorTheme'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

type UpdateStatus = 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'up-to-date' | 'error'

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

  const iaForm = useForm({
    resolver: zodResolver(
      z.object({
        provider: z.string(),
        api_key: z.string().optional(),
        modelo: z.string(),
        ativo: z.boolean(),
      })
    ),
    defaultValues: {
      provider: 'gemini',
      api_key: '',
      modelo: 'gemini-3-flash-preview',
      ativo: true, // 🟢 Default ativado quando cadastra API key pela primeira vez
    },
  })

  const { data: iaConfig } = useApiData<any>(
    () => window.electron.ipcRenderer.invoke('ia.configuracao.obter'),
    []
  )

  useEffect(() => {
    if (iaConfig) {
      iaForm.reset({
        provider: iaConfig.provider,
        api_key: iaConfig.api_key,
        modelo: iaConfig.modelo,
        ativo: Boolean(iaConfig.ativo),
      })
    }
  }, [iaConfig, iaForm])

  const [testandoIa, setTestandoIa] = useState(false)
  const [salvandoIa, setSalvandoIa] = useState(false)
  const [showApiKey, setShowApiKey] = useState(false)

  const onTestarIa = async () => {
    const values = iaForm.getValues()
    setTestandoIa(true)
    try {
      const res = await window.electron.ipcRenderer.invoke('ia.configuracao.testar', {
        provider: values.provider,
        api_key: values.api_key,
        modelo: values.modelo,
      })
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
      await window.electron.ipcRenderer.invoke('ia.configuracao.salvar', {
        provider: data.provider,
        api_key: data.api_key || '',
        modelo: data.modelo,
        ativo: data.ativo,
      })
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

      <div className="flex flex-1 flex-col gap-6 overflow-y-auto p-6">
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

        {/* Assistente IA */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <BrainCircuit className="size-4 text-purple-500" />
                Assistente IA
              </CardTitle>
              <CardDescription className="mt-1">
                Configure o provedor para usar o chat inteligente e a pre-analise de escalas.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={onTestarIa} disabled={testandoIa}>
                {testandoIa ? <Loader2 className="mr-1 size-3.5 animate-spin" /> : null}
                Testar
              </Button>
              <Button size="sm" onClick={iaForm.handleSubmit(onSubmitIa)} disabled={salvandoIa}>
                {salvandoIa ? (
                  <Loader2 className="mr-1 size-3.5 animate-spin" />
                ) : (
                  <Save className="mr-1 size-3.5" />
                )}
                Salvar IA
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <Form {...iaForm}>
              <form className="space-y-6" onSubmit={iaForm.handleSubmit(onSubmitIa)}>
                <div className="flex items-center gap-3 rounded-lg border p-4">
                  <FormField
                    control={iaForm.control}
                    name="ativo"
                    render={({ field }) => (
                      <FormItem className="flex items-center gap-3 space-y-0">
                        <FormControl>
                          <Switch checked={field.value} onCheckedChange={field.onChange} />
                        </FormControl>
                        <div>
                          <FormLabel className="text-sm font-medium">Ativar Assistente</FormLabel>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            Habilita o painel de chat e a analise via LLM em todo o aplicativo.
                          </p>
                        </div>
                      </FormItem>
                    )}
                  />
                </div>

                <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                  <FormField
                    control={iaForm.control}
                    name="provider"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Provedor</FormLabel>
                        <Select value={field.value} onValueChange={field.onChange}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Selecione o provedor..." />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="gemini">Google Gemini</SelectItem>
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
                        <FormLabel>Modelo</FormLabel>
                        <Select value={field.value} onValueChange={field.onChange}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Selecione o modelo..." />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="gemini-3-flash-preview">
                              Gemini 3 Flash Preview (Mais Novo) 🚀
                            </SelectItem>
                            <SelectItem value="gemini-2.5-flash">
                              Gemini 2.5 Flash (Estável)
                            </SelectItem>
                            <SelectItem value="gemini-2.0-flash-thinking-exp-1219">
                              Gemini 2.0 Flash Thinking Exp
                            </SelectItem>
                            <SelectItem value="gemini-2.5-pro">Gemini 2.5 Pro</SelectItem>
                            <SelectItem value="gemini-2.5-flash-lite">
                              Gemini 2.5 Flash-Lite
                            </SelectItem>
                          </SelectContent>
                        </Select>
                        <p className="text-[10px] text-muted-foreground mt-1">
                          Flash = rapido e barato · Pro = mais inteligente
                        </p>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={iaForm.control}
                    name="api_key"
                    render={({ field }) => (
                      <FormItem className="sm:col-span-2 lg:col-span-3">
                        <div className="flex items-center justify-between">
                          <FormLabel>API Key</FormLabel>
                          <a
                            href="https://aistudio.google.com/apikey"
                            target="_blank"
                            rel="noreferrer"
                            className="text-xs text-purple-500 hover:text-purple-400 underline underline-offset-2"
                          >
                            Obter chave no Google AI Studio →
                          </a>
                        </div>
                        <div className="flex w-full items-center gap-2">
                          <FormControl>
                            <div className="relative flex-1">
                              <Input
                                type={showApiKey ? 'text' : 'password'}
                                placeholder="sk-..."
                                {...field}
                                className="pr-10"
                              />
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                                onClick={() => setShowApiKey(!showApiKey)}
                              >
                                {showApiKey ? (
                                  <EyeOff className="size-4 text-muted-foreground" />
                                ) : (
                                  <Eye className="size-4 text-muted-foreground" />
                                )}
                              </Button>
                            </div>
                          </FormControl>
                        </div>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </form>
            </Form>
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
      </div>
    </div>
  )
}
