import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { Settings, Save, ShieldCheck, Monitor, Sun, Moon, Check, CalendarDays, Plus, Trash2, Lock, RefreshCw, Download, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react'
import { useTheme } from 'next-themes'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { PageHeader } from '@/componentes/PageHeader'
import { empresaService } from '@/servicos/empresa'
import { feriadosService } from '@/servicos/feriados'
import { useApiData } from '@/hooks/useApiData'
import { useColorTheme } from '@/hooks/useColorTheme'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import type { Empresa, Feriado } from '@shared/index'

const empresaSchema = z.object({
  nome: z.string().min(1, 'Nome e obrigatorio'),
  cnpj: z.string(),
  telefone: z.string(),
  corte_semanal: z.string().min(1, 'Selecione o corte semanal'),
  tolerancia_semanal_min: z.coerce.number().min(0, 'Minimo 0').max(120, 'Maximo 120 minutos'),
  usa_cct_intervalo_reduzido: z.boolean(),
})

type EmpresaFormInput = z.input<typeof empresaSchema>
type EmpresaFormData = z.output<typeof empresaSchema>

const ANO_ATUAL = new Date().getFullYear()

const TIPO_FERIADO_LABEL: Record<string, string> = {
  NACIONAL: 'Nacional',
  ESTADUAL: 'Estadual',
  MUNICIPAL: 'Municipal',
}

function formatarDataFeriado(data: string): string {
  const [, mes, dia] = data.split('-')
  return `${dia}/${mes}`
}

const REGRAS_CLT = [
  'Maximo de 6 dias seguidos de trabalho',
  'Minimo de 11 horas de descanso entre jornadas',
  'Jornada diaria de no maximo 10 horas',
  'Mulheres: folga obrigatoria a cada 2 domingos trabalhados',
  'Homens: folga obrigatoria a cada 3 domingos trabalhados',
]

export function EmpresaConfig() {
  const { data: empresa, loading } = useApiData<Empresa>(
    () => empresaService.buscar(),
    [],
  )

  const anoAtual = ANO_ATUAL
  const { data: feriados, reload: reloadFeriados } = useApiData<Feriado[]>(
    () => feriadosService.listar(anoAtual),
    [anoAtual],
  )

  const [salvando, setSalvando] = useState(false)
  const { theme: currentMode, setTheme } = useTheme()
  const { colorTheme, setColorTheme } = useColorTheme()

  // Update state
  type UpdateStatus = 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'up-to-date' | 'error'
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>('idle')
  const [updateVersion, setUpdateVersion] = useState<string | null>(null)
  const [downloadProgress, setDownloadProgress] = useState(0)
  const [updateError, setUpdateError] = useState<string | null>(null)
  const [appVersion, setAppVersion] = useState<string>('...')

  useEffect(() => {
    window.electron.ipcRenderer.invoke('app:version').then((v: string) => setAppVersion(v)).catch(() => {})

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
    window.electron.ipcRenderer.invoke('update:check').catch(() => {})
  }

  const handleInstallUpdate = () => {
    window.electron.ipcRenderer.invoke('update:install').catch(() => {})
  }

  // Feriado dialog state
  const [showFeriadoDialog, setShowFeriadoDialog] = useState(false)
  const [novoFeriadoData, setNovoFeriadoData] = useState('')
  const [novoFeriadoNome, setNovoFeriadoNome] = useState('')
  const [novoFeriadoTipo, setNovoFeriadoTipo] = useState('NACIONAL')
  const [novoFeriadoProibido, setNovoFeriadoProibido] = useState(false)
  const [criandoFeriado, setCriandoFeriado] = useState(false)

  const form = useForm<EmpresaFormInput, unknown, EmpresaFormData>({
    resolver: zodResolver(empresaSchema),
    defaultValues: {
      nome: '',
      cnpj: '',
      telefone: '',
      corte_semanal: 'SEG_DOM',
      tolerancia_semanal_min: 30,
      usa_cct_intervalo_reduzido: true,
    },
  })

  useEffect(() => {
    if (empresa) {
      form.reset({
        nome: empresa.nome,
        cnpj: empresa.cnpj ?? '',
        telefone: empresa.telefone ?? '',
        corte_semanal: empresa.corte_semanal,
        tolerancia_semanal_min: empresa.tolerancia_semanal_min,
        usa_cct_intervalo_reduzido: empresa.usa_cct_intervalo_reduzido,
      })
    }
  }, [empresa, form])

  const onSubmit = async (data: EmpresaFormData) => {
    setSalvando(true)
    try {
      await empresaService.atualizar({
        nome: data.nome.trim(),
        cnpj: data.cnpj.trim(),
        telefone: data.telefone.trim(),
        corte_semanal: data.corte_semanal,
        tolerancia_semanal_min: data.tolerancia_semanal_min,
        min_intervalo_almoco_min: data.usa_cct_intervalo_reduzido ? 30 : 60,
        usa_cct_intervalo_reduzido: data.usa_cct_intervalo_reduzido,
      })
      toast.success('Configuracoes salvas')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao salvar')
    } finally {
      setSalvando(false)
    }
  }

  const handleCriarFeriado = async () => {
    if (!novoFeriadoData || !novoFeriadoNome) return
    setCriandoFeriado(true)
    try {
      await feriadosService.criar({
        data: novoFeriadoData,
        nome: novoFeriadoNome.trim(),
        tipo: novoFeriadoTipo as 'NACIONAL' | 'ESTADUAL' | 'MUNICIPAL',
        proibido_trabalhar: novoFeriadoProibido,
        cct_autoriza: true,
      })
      toast.success('Feriado adicionado')
      setShowFeriadoDialog(false)
      setNovoFeriadoData('')
      setNovoFeriadoNome('')
      setNovoFeriadoTipo('NACIONAL')
      setNovoFeriadoProibido(false)
      reloadFeriados()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao criar feriado')
    } finally {
      setCriandoFeriado(false)
    }
  }

  const handleDeletarFeriado = async (id: number) => {
    try {
      await feriadosService.deletar(id)
      toast.success('Feriado removido')
      reloadFeriados()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao remover feriado')
    }
  }

  if (loading) {
    return (
      <div className="flex flex-1 flex-col">
        <PageHeader breadcrumbs={[{ label: 'Dashboard', href: '/' }, { label: 'Configuracoes' }]} />
        <div className="flex flex-1 items-center justify-center">
          <p className="text-sm text-muted-foreground">Carregando...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader
        breadcrumbs={[{ label: 'Dashboard', href: '/' }, { label: 'Configuracoes' }]}
        actions={
          <Button size="sm" onClick={form.handleSubmit(onSubmit)} disabled={salvando}>
            <Save className="mr-1 size-3.5" />
            {salvando ? 'Salvando...' : 'Salvar'}
          </Button>
        }
      />

      <div className="flex flex-1 flex-col gap-6 overflow-y-auto p-6">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)}>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Settings className="size-4" />
                  Dados da Empresa
                </CardTitle>
                <CardDescription>
                  Informacoes exibidas nos relatorios e exportacoes de escala.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <FormField
                  control={form.control}
                  name="nome"
                  render={({ field }) => (
                    <FormItem className="max-w-md">
                      <FormLabel>Nome</FormLabel>
                      <FormControl>
                        <Input placeholder="Ex: Supermercado Fernandes" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="flex flex-col gap-6 sm:flex-row sm:items-start">
                  <FormField
                    control={form.control}
                    name="cnpj"
                    render={({ field }) => (
                      <FormItem className="sm:w-56">
                        <FormLabel>CNPJ</FormLabel>
                        <FormControl>
                          <Input placeholder="00.000.000/0000-00" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="telefone"
                    render={({ field }) => (
                      <FormItem className="sm:w-56">
                        <FormLabel>Telefone / Contato</FormLabel>
                        <FormControl>
                          <Input placeholder="(00) 00000-0000" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <Separator />

                <div>
                  <h4 className="mb-1 text-sm font-medium">Periodo semanal</h4>
                  <p className="mb-4 text-sm text-muted-foreground">
                    Como o sistema conta as horas da semana para cada colaborador.
                  </p>
                  <div className="flex flex-col gap-6 sm:flex-row sm:items-start">
                    <FormField
                      control={form.control}
                      name="corte_semanal"
                      render={({ field }) => (
                        <FormItem className="sm:w-64">
                          <FormLabel>Semana comeca em</FormLabel>
                          <Select value={field.value} onValueChange={field.onChange}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="SEG_DOM">Segunda</SelectItem>
                              <SelectItem value="TER_SEG">Terca</SelectItem>
                              <SelectItem value="QUA_TER">Quarta</SelectItem>
                              <SelectItem value="QUI_QUA">Quinta</SelectItem>
                              <SelectItem value="SEX_QUI">Sexta</SelectItem>
                              <SelectItem value="SAB_SEX">Sabado</SelectItem>
                              <SelectItem value="DOM_SAB">Domingo</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="tolerancia_semanal_min"
                      render={({ field }) => (
                        <FormItem className="sm:w-48">
                          <FormLabel>Tolerancia (minutos)</FormLabel>
                          <FormControl>
                            <Input
                              type="number"
                              min={0}
                              max={120}
                              placeholder="30"
                              value={typeof field.value === 'number' ? field.value : ''}
                              onChange={(e) => field.onChange(e.target.value === '' ? '' : Number(e.target.value))}
                              onBlur={field.onBlur}
                              name={field.name}
                              ref={field.ref}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </div>

                <Separator />

                {/* CCT toggle */}
                <div>
                  <h4 className="mb-1 text-sm font-medium">Intervalo de almoco</h4>
                  <p className="mb-4 text-sm text-muted-foreground">
                    A CCT do comercio autoriza reducao do almoco para 30 minutos com acordo escrito.
                  </p>
                  <FormField
                    control={form.control}
                    name="usa_cct_intervalo_reduzido"
                    render={({ field }) => (
                      <FormItem>
                        <div className="flex items-center gap-3 rounded-lg border p-4">
                          <FormControl>
                            <Switch
                              checked={field.value}
                              onCheckedChange={field.onChange}
                            />
                          </FormControl>
                          <div>
                            <FormLabel className="text-sm font-medium">
                              Usar regra da Convencao Coletiva (CCT)
                            </FormLabel>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {field.value
                                ? 'Almoco minimo: 30 minutos (CCT FecomercioSP)'
                                : 'Almoco minimo: 1 hora (CLT Art. 71)'}
                            </p>
                          </div>
                        </div>
                      </FormItem>
                    )}
                  />
                </div>
              </CardContent>
            </Card>
          </form>
        </Form>

        {/* Feriados */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <CalendarDays className="size-4" />
                Feriados {anoAtual}
              </CardTitle>
              <CardDescription className="mt-1">
                O motor nao escala trabalho em feriados proibidos. Adicione municipais se necessario.
              </CardDescription>
              <CardDescription className="mt-1">
                Horario operacional e configurado por setor/dia em Setores.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" asChild>
                <Link to="/setores">Ir para Setores</Link>
              </Button>
              <Button variant="outline" size="sm" onClick={() => setShowFeriadoDialog(true)}>
                <Plus className="mr-1 size-3.5" />
                Novo
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {(feriados ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                Nenhum feriado cadastrado. Clique em &quot;Novo&quot; para adicionar.
              </p>
            ) : (
              <div className="space-y-1">
                {(feriados ?? []).sort((a, b) => a.data.localeCompare(b.data)).map((f) => {
                  const isLocked = f.proibido_trabalhar
                  return (
                    <div
                      key={f.id}
                      className="flex items-center justify-between rounded-md border px-3 py-2"
                    >
                      <div className="flex items-center gap-3">
                        <span className="font-mono text-sm text-muted-foreground w-12 shrink-0">
                          {formatarDataFeriado(f.data)}
                        </span>
                        <span className="text-sm font-medium">{f.nome}</span>
                        <Badge variant="outline" className="text-[10px]">
                          {TIPO_FERIADO_LABEL[f.tipo] ?? f.tipo}
                        </Badge>
                        {isLocked && (
                          <div className="flex items-center gap-1 text-destructive">
                            <Lock className="size-3" />
                            <span className="text-[10px]">CCT proibe</span>
                          </div>
                        )}
                      </div>
                      {!isLocked && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7 text-muted-foreground hover:text-destructive"
                          onClick={() => handleDeletarFeriado(f.id)}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Dialog novo feriado */}
        <Dialog open={showFeriadoDialog} onOpenChange={setShowFeriadoDialog}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Adicionar Feriado</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label>Data</Label>
                <Input
                  type="date"
                  value={novoFeriadoData}
                  onChange={(e) => setNovoFeriadoData(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Nome</Label>
                <Input
                  placeholder="Ex: Aniversario da cidade"
                  value={novoFeriadoNome}
                  onChange={(e) => setNovoFeriadoNome(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Tipo</Label>
                <Select value={novoFeriadoTipo} onValueChange={setNovoFeriadoTipo}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NACIONAL">Nacional</SelectItem>
                    <SelectItem value="ESTADUAL">Estadual</SelectItem>
                    <SelectItem value="MUNICIPAL">Municipal</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-3 rounded-lg border p-3">
                <Switch
                  checked={novoFeriadoProibido}
                  onCheckedChange={setNovoFeriadoProibido}
                />
                <div>
                  <p className="text-sm font-medium">Proibido trabalhar</p>
                  <p className="text-xs text-muted-foreground">
                    CCT proibe escala neste dia (ex: Natal, Ano Novo)
                  </p>
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowFeriadoDialog(false)}>
                Cancelar
              </Button>
              <Button
                onClick={handleCriarFeriado}
                disabled={criandoFeriado || !novoFeriadoData || !novoFeriadoNome}
              >
                {criandoFeriado ? 'Adicionando...' : 'Adicionar'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Settings className="size-4" />
              Aparencia
            </CardTitle>
            <CardDescription>
              Personalize o visual do sistema
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Section 1: Mode selector */}
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

            {/* Section 2: Color palette selector */}
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
              Versao atual: <span className="font-mono font-medium text-foreground">v{appVersion}</span>
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                {updateStatus === 'idle' && (
                  <span className="text-sm text-muted-foreground">Clique para verificar se ha uma nova versao disponivel.</span>
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
                    <RefreshCw className={cn('mr-1.5 size-3.5', updateStatus === 'checking' && 'animate-spin')} />
                    Verificar atualizacoes
                  </Button>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="size-4" />
              Regras trabalhistas
            </CardTitle>
            <CardDescription>
              Aplicadas automaticamente pelo sistema ao gerar escalas. Nao podem ser alteradas.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-3">
              {REGRAS_CLT.map((regra, i) => (
                <li
                  key={i}
                  className="flex items-center gap-3 rounded-lg border bg-muted/30 px-4 py-3"
                >
                  <ShieldCheck className="size-4 shrink-0 text-muted-foreground" />
                  <span className="text-sm">{regra}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
