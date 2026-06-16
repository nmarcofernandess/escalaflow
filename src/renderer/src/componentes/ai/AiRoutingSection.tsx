import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, Save } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { servicoConhecimento } from '@/servicos/conhecimento'
import {
  AI_ROUTE_MODE_LABELS,
  AI_ROUTE_PROVIDER_LABELS,
  AI_ROUTE_PROVIDER_MODEL_OPTIONS,
  AI_ROUTE_TASKS,
  cloneRoutingConfig,
  type AiRouteMode,
  type AiRouteProvider,
  type AiRouteResolution,
  type AiRouteTask,
  type AiRoutingConfig,
} from '@shared/index'

function modelOptions(provider: AiRouteProvider) {
  return AI_ROUTE_PROVIDER_MODEL_OPTIONS[provider]
}

function normalizeModelForProvider(provider: AiRouteProvider, model?: string | null): string {
  const options = modelOptions(provider)
  if (model && options.some((option) => option.value === model)) return model
  return options[0]?.value ?? ''
}

function reasonLabel(reason?: AiRouteResolution['reason']): string {
  switch (reason) {
    case 'ready':
      return 'OK'
    case 'configure_provider':
      return 'Escolha uma IA'
    case 'configure_cloud_token':
      return 'Falta chave'
    case 'download_local_model':
      return 'Falta baixar'
    case 'validate_local_model':
      return 'Falta testar'
    case 'local_model_error':
      return 'Erro ao iniciar'
    case 'unsupported_model':
      return 'Modelo incompatível'
    case 'gemini_disabled':
      return 'Gemini desligado'
    case 'auto_no_ready_route':
      return 'Nada pronto'
    case undefined:
      return 'Pendente'
    default: {
      // Compile-time guard: a new readiness reason must get a label here.
      const _exhaustive: never = reason
      return _exhaustive
    }
  }
}

function isDirty(config: AiRoutingConfig | null, draft: AiRoutingConfig | null): boolean {
  if (!config || !draft) return false
  return JSON.stringify(config) !== JSON.stringify(draft)
}

export function AiRoutingSection() {
  const [routes, setRoutes] = useState<AiRouteResolution[]>([])
  const [config, setConfig] = useState<AiRoutingConfig | null>(null)
  const [draft, setDraft] = useState<AiRoutingConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const dirty = isDirty(config, draft)
  const routeByTask = new Map(routes.map((route) => [route.task, route]))

  const loadRoutes = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [nextConfig, nextRoutes] = await Promise.all([
        servicoConhecimento.obterIaRouting(),
        servicoConhecimento.listarIaRouteStatus(),
      ])
      setConfig(nextConfig)
      setDraft(cloneRoutingConfig(nextConfig))
      setRoutes(nextRoutes)
    } catch (err: any) {
      setError(err?.message || 'Não foi possível carregar as escolhas de IA.')
      setConfig(null)
      setDraft(null)
      setRoutes([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadRoutes()
  }, [loadRoutes])

  useEffect(() => {
    const handler = () => { void loadRoutes() }
    window.addEventListener('ia-config-changed', handler)
    return () => window.removeEventListener('ia-config-changed', handler)
  }, [loadRoutes])

  const updateDraft = (updater: (current: AiRoutingConfig) => AiRoutingConfig) => {
    setDraft((current) => {
      if (!current) return current
      return updater(cloneRoutingConfig(current))
    })
  }

  // inherit/auto não guardam provider/modelo: a IA ativa (configuracao_ia) ou a melhor
  // disponível decidem em runtime. Só `explicit` fixa provider/modelo por tarefa.
  const updateTaskMode = (task: AiRouteTask, mode: AiRouteMode, fallbackProvider: AiRouteProvider) => {
    updateDraft((current) => {
      const previous = current.tasks[task]
      if (mode === 'inherit' || mode === 'auto') {
        current.tasks[task] = { mode }
        return current
      }

      // Ao escolher manualmente, parte do provider já resolvido (IA ativa) como padrão.
      const provider = previous.mode === 'explicit' ? previous.provider : fallbackProvider
      const modelo = normalizeModelForProvider(provider, previous.mode === 'explicit' ? previous.modelo : null)
      current.tasks[task] = { mode: 'explicit', provider, modelo }
      return current
    })
  }

  const updateTaskProvider = (task: AiRouteTask, provider: AiRouteProvider) => {
    updateDraft((current) => {
      const previous = current.tasks[task]
      const modelo = normalizeModelForProvider(provider, previous.mode === 'explicit' ? previous.modelo : null)
      current.tasks[task] = { mode: 'explicit', provider, modelo }
      return current
    })
  }

  const updateTaskModel = (task: AiRouteTask, modelo: string) => {
    updateDraft((current) => {
      const previous = current.tasks[task]
      const provider = previous.mode === 'explicit' ? previous.provider : 'local'
      current.tasks[task] = { mode: 'explicit', provider, modelo }
      return current
    })
  }

  const saveRoutes = async () => {
    if (!draft) return
    setSaving(true)
    setError(null)
    try {
      const saved = await servicoConhecimento.salvarIaRouting(draft)
      setConfig(saved)
      setDraft(cloneRoutingConfig(saved))
      setRoutes(await servicoConhecimento.listarIaRouteStatus())
      window.dispatchEvent(new Event('ia-config-changed'))
    } catch (err: any) {
      setError(err?.message || 'Não foi possível salvar as escolhas de IA.')
    } finally {
      setSaving(false)
    }
  }

  const resetDraft = () => {
    if (config) setDraft(cloneRoutingConfig(config))
  }

  return (
    <section className="flex flex-col gap-3" aria-label="IA e Modelos">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h4 className="text-sm font-medium">IA e Modelos</h4>
          <p className="text-xs text-muted-foreground">
            Cada parte segue a IA ativa por padrão; fixe uma IA diferente quando precisar.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {dirty ? (
            <Badge variant="outline" className="border-amber-500/50 text-amber-700 dark:text-amber-300">
              Alterações não salvas
            </Badge>
          ) : null}
          <Button type="button" variant="outline" size="sm" onClick={() => loadRoutes()} disabled={loading || saving}>
            {loading ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <RefreshCw data-icon="inline-start" />}
            Atualizar
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={resetDraft} disabled={!dirty || saving}>
            Desfazer
          </Button>
          <Button type="button" size="sm" onClick={saveRoutes} disabled={!dirty || saving || !draft}>
            {saving ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <Save data-icon="inline-start" />}
            Salvar escolhas
          </Button>
        </div>
      </div>

      {error ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      {draft ? (
        <div
          data-testid="ia-routing-active-note"
          className="rounded-md border bg-muted/20 px-3 py-2 text-xs text-muted-foreground"
        >
          As partes em <span className="font-medium text-foreground">“{AI_ROUTE_MODE_LABELS.inherit}”</span>{' '}
          usam a IA escolhida em{' '}
          <span className="font-medium text-foreground">Configurações &gt; Assistente IA</span>. Aqui você fixa
          uma IA diferente por tarefa (manual ou melhor disponível).
        </div>
      ) : null}

      <div className="rounded-md border">
        <Table className="min-w-[980px]">
          <TableHeader className="bg-muted/60">
            <TableRow>
              <TableHead className="px-3 py-2 text-xs">Parte do sistema</TableHead>
              <TableHead className="px-3 py-2 text-xs">Como escolher</TableHead>
              <TableHead className="px-3 py-2 text-xs">IA</TableHead>
              <TableHead className="px-3 py-2 text-xs">Modelo</TableHead>
              <TableHead className="px-3 py-2 text-xs">Pode usar agora?</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && !draft ? (
              <TableRow>
                <TableCell className="px-3 py-3 text-muted-foreground" colSpan={5}>
                  <span className="inline-flex items-center gap-2">
                    <Loader2 className="size-4 animate-spin" />
                    Carregando escolhas de IA...
                  </span>
                </TableCell>
              </TableRow>
            ) : draft ? AI_ROUTE_TASKS.map((task) => {
              const taskRoute = draft.tasks[task]
              const resolution = routeByTask.get(task)
              const explicit = taskRoute.mode === 'explicit'
              const statusPending = dirty
              // Para inherit/auto, o backend decide provider/modelo (IA ativa ou melhor disponível).
              // Mostra o que foi REALMENTE resolvido (read-only) para a linha nunca alegar uma IA
              // que não é a usada. Só `explicit` é editável.
              const resolvedProvider = resolution?.ok ? resolution.provider : null
              const resolvedModel = resolution?.ok ? resolution.model : null
              const provider: AiRouteProvider | null = explicit ? taskRoute.provider : resolvedProvider
              const model = explicit ? taskRoute.modelo : resolvedModel
              const fallbackProvider: AiRouteProvider = resolvedProvider ?? 'local'
              const showStatusDetails = statusPending || !resolution?.ok || Boolean(resolution?.action)

              return (
                <TableRow key={task} className="align-top">
                  <TableCell className="px-3 py-2.5">
                    <div className="flex flex-col gap-0.5">
                      <span className="font-medium">{resolution?.label ?? task}</span>
                      {taskRoute.mode === 'inherit' ? (
                        <span className="text-xs text-muted-foreground">
                          Segue a IA ativa
                        </span>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell className="px-3 py-2.5">
                    <Select
                      value={taskRoute.mode}
                      onValueChange={(value) => updateTaskMode(task, value as AiRouteMode, fallbackProvider)}
                      disabled={loading || saving}
                    >
                      <SelectTrigger className="h-8 min-w-[180px]" data-testid={`ia-routing-mode-${task}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(Object.keys(AI_ROUTE_MODE_LABELS) as AiRouteMode[]).map((mode) => (
                          <SelectItem key={mode} value={mode}>
                            {AI_ROUTE_MODE_LABELS[mode]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell className="px-3 py-2.5">
                    {explicit ? (
                      <Select
                        value={provider ?? ''}
                        onValueChange={(value) => updateTaskProvider(task, value as AiRouteProvider)}
                        disabled={loading || saving}
                      >
                        <SelectTrigger className="h-8 min-w-[170px]" data-testid={`ia-routing-provider-${task}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {(Object.keys(AI_ROUTE_PROVIDER_LABELS) as AiRouteProvider[]).map((providerOption) => (
                            <SelectItem key={providerOption} value={providerOption}>
                              {AI_ROUTE_PROVIDER_LABELS[providerOption]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <span className="text-xs text-muted-foreground" data-testid={`ia-routing-provider-${task}`}>
                        {provider ? AI_ROUTE_PROVIDER_LABELS[provider] : statusPending ? 'Salve para ver' : '—'}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="px-3 py-2.5">
                    {explicit ? (
                      <Select
                        value={model ?? ''}
                        onValueChange={(value) => updateTaskModel(task, value)}
                        disabled={loading || saving}
                      >
                        <SelectTrigger className="h-8 min-w-[210px]" data-testid={`ia-routing-model-${task}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {modelOptions(provider ?? 'local').map((modelOption) => (
                            <SelectItem key={modelOption.value} value={modelOption.value}>
                              {modelOption.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <span className="text-xs text-muted-foreground" data-testid={`ia-routing-model-${task}`}>
                        {model ?? (statusPending ? 'Salve para ver' : '—')}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="px-3 py-2.5">
                    <div
                      className="flex min-w-[190px] flex-col gap-1.5"
                      title={statusPending ? 'Salve as escolhas para atualizar este status.' : resolution?.message}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge
                          variant="outline"
                          className={cn(
                            'w-fit',
                            statusPending
                              ? 'border-amber-500/50 text-amber-700 dark:text-amber-300'
                              : resolution?.ok
                              ? 'border-green-500/40 text-green-600 dark:text-green-400'
                              : 'border-amber-500/50 text-amber-700 dark:text-amber-300',
                          )}
                        >
                          {!statusPending && resolution?.ok ? (
                            <CheckCircle2 className="mr-1 size-3" />
                          ) : (
                            <AlertTriangle className="mr-1 size-3" />
                          )}
                          {statusPending ? 'A atualizar' : resolution?.ok ? 'Pronta' : 'Indisponível'}
                        </Badge>
                        {showStatusDetails ? (
                          <span className="text-xs text-muted-foreground">
                            {statusPending ? 'Salve primeiro' : reasonLabel(resolution?.reason)}
                          </span>
                        ) : null}
                      </div>
                      {showStatusDetails ? (
                        <p className="text-xs text-muted-foreground">
                          {statusPending ? 'Salve as escolhas para atualizar este status.' : resolution?.message ?? 'Salve para atualizar este status.'}
                        </p>
                      ) : null}
                      {!statusPending && resolution?.action ? (
                        <p className="text-xs text-foreground">{resolution.action}</p>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              )
            }) : (
              <TableRow>
                <TableCell className="px-3 py-3 text-muted-foreground" colSpan={5}>
                  Não consegui carregar as escolhas de IA.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </section>
  )
}
