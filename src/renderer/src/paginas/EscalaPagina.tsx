import { useState, useRef, useEffect, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import {
  CalendarDays,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Printer,
  Trash2,
  Shield,
  TrendingUp,
  Clock,
  Eye,
  Loader2,
  Info,
  Download,
  Terminal,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Progress } from '@/components/ui/progress'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { toast } from 'sonner'
import { PageHeader } from '@/componentes/PageHeader'
import { PontuacaoBadge } from '@/componentes/PontuacaoBadge'
import { IndicatorCard } from '@/componentes/IndicatorCard'
import { EscalaGrid } from '@/componentes/EscalaGrid'
import { EscalaViewToggle, useEscalaViewMode } from '@/componentes/EscalaViewToggle'
import { TimelineGrid } from '@/componentes/TimelineGrid'
import { ExportarEscala } from '@/componentes/ExportarEscala'
import { ViolacoesAgrupadas } from '@/componentes/ViolacoesAgrupadas'
import { ExportModal } from '@/componentes/ExportModal'
import { useExportController } from '@/hooks/useExportController'
import { gerarHTMLFuncionario } from '@/lib/gerarHTMLFuncionario'
import { exportarService } from '@/servicos/exportar'
import { cn } from '@/lib/utils'
import { formatarData, formatarMes, mapError, iniciais } from '@/lib/formatadores'
import { useApiData } from '@/hooks/useApiData'
import { setoresService } from '@/servicos/setores'
import { colaboradoresService } from '@/servicos/colaboradores'
import { escalasService } from '@/servicos/escalas'
import { tiposContratoService } from '@/servicos/tipos-contrato'
import type {
  EscalaCompleta,
  EscalaCompletaV3,
  Escala,
  Alocacao,
  Colaborador,
  Setor,
  RegimeEscala,
} from '@shared/index'

export function EscalaPagina() {
  const { id } = useParams<{ id: string }>()
  const setorId = parseInt(id ?? '0', 10)

  // Data loading
  const { data: setor } = useApiData(() => setoresService.buscar(setorId), [setorId])
  const { data: colaboradores } = useApiData(
    () => colaboradoresService.listar({ setor_id: setorId, ativo: true }),
    [setorId],
  )
  const { data: demandas } = useApiData(
    () => setoresService.listarDemandas(setorId),
    [setorId],
  )
  const { data: tiposContrato } = useApiData(
    () => tiposContratoService.listar(),
    [],
  )

  // Simulacao state — auto-preenche com proximo mes
  const [dataInicio, setDataInicio] = useState(() => {
    const hoje = new Date()
    const prox = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 1)
    return prox.toISOString().split('T')[0]
  })
  const [dataFim, setDataFim] = useState(() => {
    const hoje = new Date()
    const ultimoDia = new Date(hoje.getFullYear(), hoje.getMonth() + 2, 0)
    return ultimoDia.toISOString().split('T')[0]
  })
  const [gerando, setGerando] = useState(false)
  const [preflightLoading, setPreflightLoading] = useState(false)
  const [escalaCompleta, setEscalaCompleta] = useState<EscalaCompletaV3 | null>(null)
  const [ajustando, setAjustando] = useState<{ colaboradorId: number; data: string } | null>(null)
  const [changedCells, setChangedCells] = useState<Set<string>>(new Set())
  const [expandViolacoes, setExpandViolacoes] = useState(false)
  const [oficializando, setOficializando] = useState(false)
  const [descartando, setDescartando] = useState(false)
  const [escalaViewMode, setEscalaViewMode] = useEscalaViewMode()
  const [exportOpen, setExportOpen] = useState(false)
  const [exportEscala, setExportEscala] = useState<EscalaCompletaV3 | null>(null)
  const exportCtrl = useExportController({ context: 'escala' })
  const [regimeOverrides, setRegimeOverrides] = useState<Record<number, RegimeEscala>>({})
  const [regerarModalOpen, setRegerarModalOpen] = useState(false)
  const [regerarWarning, setRegerarWarning] = useState<string | null>(null)

  // Oficial tab state
  const [oficialEscala, setOficialEscala] = useState<EscalaCompletaV3 | null>(null)
  const [loadingOficial, setLoadingOficial] = useState(false)
  const [oficialLoaded, setOficialLoaded] = useState(false)

  const prevAlocacoesRef = useRef<Alocacao[]>([])
  const [solverLogs, setSolverLogs] = useState<string[]>([])
  const solverLogsEndRef = useRef<HTMLDivElement>(null)
  const solverStartRef = useRef<number>(0)

  const getContratoRegime = useCallback((colab: Colaborador): RegimeEscala => {
    const tc = tiposContrato?.find((t) => t.id === colab.tipo_contrato_id)
    if (tc?.regime_escala) return tc.regime_escala
    return (tc?.dias_trabalho ?? 6) <= 5 ? '5X2' : '6X1'
  }, [tiposContrato])

  const regimesOverridePayload = useCallback(() => {
    return (colaboradores ?? [])
      .filter((c) => regimeOverrides[c.id] && regimeOverrides[c.id] !== getContratoRegime(c))
      .map((c) => ({
        colaborador_id: c.id,
        regime_escala: regimeOverrides[c.id]!,
      }))
  }, [colaboradores, regimeOverrides, getContratoRegime])

  // Auto-scroll solver logs and listen for solver-log IPC events
  useEffect(() => {
    if (solverLogsEndRef.current) {
      solverLogsEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [solverLogs])

  useEffect(() => {
    if (!gerando) return
    setSolverLogs([])
    solverStartRef.current = Date.now()

    const handler = (...args: any[]) => {
      const line = String(args[0] ?? '')
      if (line) {
        const elapsed = ((Date.now() - solverStartRef.current) / 1000).toFixed(1)
        setSolverLogs(prev => [...prev, `[${elapsed}s] ${line}`])
      }
    }

    window.electron.ipcRenderer.on('solver-log', handler)
    return () => {
      window.electron.ipcRenderer.removeAllListeners('solver-log')
    }
  }, [gerando])

  // Historico tab state
  const [escalasArquivadas, setEscalasArquivadas] = useState<Escala[]>([])
  const [loadingHistorico, setLoadingHistorico] = useState(false)
  const [historicoLoaded, setHistoricoLoaded] = useState(false)
  const [expandedHistorico, setExpandedHistorico] = useState<number | null>(null)
  const [historicoDetail, setHistoricoDetail] = useState<EscalaCompletaV3 | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)

  // Generate escala
  async function handleGerar() {
    setRegerarWarning(null)
    setRegerarModalOpen(false)
    const regimesOverride = regimesOverridePayload()

    setPreflightLoading(true)
    try {
      const preflight = await escalasService.preflight(setorId, {
        data_inicio: dataInicio,
        data_fim: dataFim,
        regimes_override: regimesOverride,
      })

      if (!preflight.ok) {
        toast.error(preflight.blockers.map((b) => b.mensagem).join(' | ') || 'Preflight bloqueou a geracao')
        return
      }

      if (preflight.warnings.length > 0) {
        const warnings = preflight.warnings
          .map((w) => `- ${w.mensagem}${w.detalhe ? ` (${w.detalhe})` : ''}`)
          .join('\n')
        const confirmed = window.confirm(
          `Preflight com avisos:\n${warnings}\n\nDeseja continuar com a geracao?`,
        )
        if (!confirmed) return
      }
    } catch (err) {
      toast.error(mapError(err) || 'Falha no preflight da escala')
      return
    } finally {
      setPreflightLoading(false)
    }

    setGerando(true)
    try {
      const result = await escalasService.gerar(setorId, {
        data_inicio: dataInicio,
        data_fim: dataFim,
        regimes_override: regimesOverride,
      })
      setEscalaCompleta(result)
      toast.success('Escala gerada')
      // Reset oficial/historico caches so they reload if user switches tabs
      setOficialLoaded(false)
      setHistoricoLoaded(false)
    } catch (err) {
      const friendly = mapError(err) || 'Nao foi possivel gerar a escala.'
      toast.error(friendly)
    } finally {
      setGerando(false)
    }
  }

  // Officialize
  async function handleOficializar() {
    if (!escalaCompleta) return
    setOficializando(true)
    try {
      await escalasService.oficializar(escalaCompleta.escala.id)
      toast.success('Escala oficializada')
      setEscalaCompleta(null)
      setOficialLoaded(false)
      setHistoricoLoaded(false)
      setRegerarWarning(null)
    } catch (err) {
      const msg = mapError(err) || 'Erro ao oficializar'
      if (msg.includes('ESCALA_DESATUALIZADA')) {
        const friendly = msg.replace('ESCALA_DESATUALIZADA:', '').trim()
        setRegerarWarning(friendly || 'A simulacao ficou desatualizada e precisa ser gerada novamente.')
        setRegerarModalOpen(true)
        return
      }
      toast.error(msg)
    } finally {
      setOficializando(false)
    }
  }

  // Cell click toggle (Smart Recalc)
  async function handleCelulaClick(colaboradorId: number, data: string, statusAtual: string) {
    if (statusAtual === 'INDISPONIVEL') return
    if (!escalaCompleta) return
    if (ajustando) return

    const novoStatus = statusAtual === 'TRABALHO' ? 'FOLGA' : 'TRABALHO'
    setAjustando({ colaboradorId, data })
    prevAlocacoesRef.current = escalaCompleta.alocacoes

    try {
      const result = await escalasService.ajustar(escalaCompleta.escala.id, {
        alocacoes: [{ colaborador_id: colaboradorId, data, status: novoStatus }],
      })
      setEscalaCompleta(result)

      // Diff para flash nas celulas alteradas
      const prev = new Map(prevAlocacoesRef.current.map((a) => [`${a.colaborador_id}-${a.data}`, a]))
      const changed = new Set<string>()
      for (const a of result.alocacoes) {
        const key = `${a.colaborador_id}-${a.data}`
        const p = prev.get(key)
        if (!p || p.status !== a.status || p.hora_inicio !== a.hora_inicio || p.hora_fim !== a.hora_fim) {
          changed.add(key)
        }
      }
      setChangedCells(changed)
      setTimeout(() => setChangedCells(new Set()), 1500)
    } catch (err) {
      toast.error(mapError(err) || 'Erro ao ajustar escala')
    } finally {
      setAjustando(null)
    }
  }

  // Discard
  async function handleDescartar() {
    if (!escalaCompleta) return
    setDescartando(true)
    try {
      await escalasService.deletar(escalaCompleta.escala.id)
      toast.success('Escala descartada')
      setEscalaCompleta(null)
    } catch (err) {
      toast.error(mapError(err) || 'Erro ao descartar')
    } finally {
      setDescartando(false)
    }
  }

  // Load oficial tab
  async function loadOficial() {
    if (oficialLoaded) return
    setLoadingOficial(true)
    try {
      const escalas = await escalasService.listarPorSetor(setorId, { status: 'OFICIAL' })
      if (escalas.length > 0) {
        const detail = await escalasService.buscar(escalas[0].id)
        setOficialEscala(detail)
      } else {
        setOficialEscala(null)
      }
      setOficialLoaded(true)
    } catch (err) {
      toast.error(mapError(err) || 'Erro ao carregar escala oficial')
    } finally {
      setLoadingOficial(false)
    }
  }

  // Load historico tab
  async function loadHistorico() {
    if (historicoLoaded) return
    setLoadingHistorico(true)
    try {
      const escalas = await escalasService.listarPorSetor(setorId, { status: 'ARQUIVADA' })
      setEscalasArquivadas(escalas)
      setHistoricoLoaded(true)
    } catch (err) {
      toast.error(mapError(err) || 'Erro ao carregar historico')
    } finally {
      setLoadingHistorico(false)
    }
  }

  // Load historico detail
  async function loadHistoricoDetail(escalaId: number) {
    if (expandedHistorico === escalaId) {
      setExpandedHistorico(null)
      setHistoricoDetail(null)
      return
    }
    setLoadingDetail(true)
    setExpandedHistorico(escalaId)
    try {
      const detail = await escalasService.buscar(escalaId)
      setHistoricoDetail(detail)
    } catch (err) {
      toast.error(mapError(err) || 'Erro ao carregar detalhes')
    } finally {
      setLoadingDetail(false)
    }
  }

  // Tab change handler
  function handleTabChange(value: string) {
    if (value === 'oficial') loadOficial()
    if (value === 'historico') loadHistorico()
  }

  // Print handler
  function handleImprimir(ec: EscalaCompletaV3) {
    if (!setor || !colaboradores) return
    const printWindow = window.open('', '_blank')
    if (!printWindow) {
      toast.error('Bloqueio de popup detectado. Permita popups para imprimir.')
      return
    }

    // Render ExportarEscala to HTML string
    import('react-dom/server').then(({ renderToStaticMarkup }) => {
      const html = renderToStaticMarkup(
        <ExportarEscala
          escala={ec.escala}
          alocacoes={ec.alocacoes}
          colaboradores={colaboradores}
          setor={setor}
        />
      )

      printWindow.document.write(`
        <!DOCTYPE html>
        <html lang="pt-BR">
          <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Escala - ${setor.nome}</title>
          </head>
          <body style="margin: 0; padding: 0;">
            ${html}
          </body>
        </html>
      `)
      printWindow.document.close()
      printWindow.focus()

      // Wait for styles to load, then print
      setTimeout(() => {
        printWindow.print()
      }, 250)
    })
  }

  // Extract indicators from backend response
  function getIndicators(ec: EscalaCompletaV3) {
    return {
      pontuacao: ec.indicadores.pontuacao,
      coberturaPercent: ec.indicadores.cobertura_percent,
      violacoesHard: ec.indicadores.violacoes_hard,
      violacoesSoft: ec.indicadores.violacoes_soft,
      equilibrio: ec.indicadores.equilibrio,
    }
  }

  // Open export modal for a given escala
  function handleExportar(ec: EscalaCompletaV3) {
    setExportEscala(ec)
    setExportOpen(true)
  }

  // Generate per-funcionario HTML
  function renderFuncHTML(colabId: number): string {
    if (!exportEscala || !setor || !colaboradores || !tiposContrato) return ''
    const colab = colaboradores.find((c) => c.id === colabId)
    if (!colab) return ''
    const tc = tiposContrato.find((t) => t.id === colab.tipo_contrato_id)
    return gerarHTMLFuncionario({
      nome: colab.nome,
      contrato: tc?.nome ?? '',
      horasSemanais: tc?.horas_semanais ?? colab.horas_semanais,
      setor: setor.nome,
      periodo: { inicio: exportEscala.escala.data_inicio, fim: exportEscala.escala.data_fim },
      alocacoes: exportEscala.alocacoes.filter((a) => a.colaborador_id === colabId),
      violacoes: exportEscala.violacoes.filter((v) => v.colaborador_id === colabId),
    })
  }

  if (!setor || !colaboradores) {
    return (
      <div className="flex flex-1 flex-col">
        <PageHeader breadcrumbs={[{ label: 'Dashboard', href: '/' }, { label: 'Escala' }, { label: 'Carregando...' }]} />
        <div className="flex items-center justify-center p-16">
          <p className="text-sm text-muted-foreground">Carregando...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader
        breadcrumbs={[
          { label: 'Dashboard', href: '/' },
          { label: 'Setores', href: '/setores' },
          { label: setor.nome, href: `/setores/${setorId}` },
          { label: 'Escala' },
        ]}
      />

      <div className="flex-1 space-y-4 p-6">
        <Tabs defaultValue="simulacao" onValueChange={handleTabChange} className="space-y-4">
          <TabsList>
            <TabsTrigger value="simulacao">Simulacao</TabsTrigger>
            <TabsTrigger value="oficial">Oficial</TabsTrigger>
            <TabsTrigger value="historico">Historico</TabsTrigger>
          </TabsList>

          {/* TAB: Simulacao */}
          <TabsContent value="simulacao" className="relative space-y-4">
            {/* Loading overlay durante geracao */}
            {(gerando || preflightLoading) && (
              <div className="absolute inset-0 z-20 flex items-center justify-center rounded-lg bg-background/80 backdrop-blur-sm animate-in fade-in-0 duration-200">
                <Card className="w-full max-w-md border-2 shadow-lg">
                  <CardContent className="flex flex-col items-center justify-center gap-4 py-12">
                    <Loader2 className="size-12 animate-spin text-primary" />
                    <p className="text-center text-sm font-medium text-foreground">
                      {preflightLoading ? 'Validando preflight...' : `Gerando escala para ${setor.nome}...`}
                    </p>
                    <p className="text-center text-xs text-muted-foreground">
                      {preflightLoading
                        ? 'Checando bloqueios e avisos antes da geracao.'
                        : 'O motor esta calculando horarios e distribuicoes. Aguarde.'}
                    </p>
                  </CardContent>
                </Card>
              </div>
            )}

            {/* Generate controls */}
            <Card className={gerando || preflightLoading ? 'pointer-events-none opacity-60' : ''}>
              <CardContent className="flex flex-wrap items-end gap-4 p-4">
                <div className="space-y-1">
                  <Label className="text-xs">Data Inicio</Label>
                  <Input
                    type="date"
                    value={dataInicio}
                    onChange={(e) => setDataInicio(e.target.value)}
                    className="w-[160px]"
                    disabled={gerando || preflightLoading}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Data Fim</Label>
                  <Input
                    type="date"
                    value={dataFim}
                    onChange={(e) => setDataFim(e.target.value)}
                    className="w-[160px]"
                    disabled={gerando || preflightLoading}
                  />
                </div>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="outline" disabled={gerando || preflightLoading}>
                      Cenário 5x2/6x1
                      {regimesOverridePayload().length > 0 && (
                        <Badge variant="secondary" className="ml-2">
                          {regimesOverridePayload().length}
                        </Badge>
                      )}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent className="max-w-2xl">
                    <AlertDialogHeader>
                      <AlertDialogTitle>Cenário de Regimes (simulação)</AlertDialogTitle>
                      <AlertDialogDescription>
                        Ajuste 5x2/6x1 por colaborador apenas para esta simulação. Não altera cadastro.
                      </AlertDialogDescription>
                    </AlertDialogHeader>

                    <div className="max-h-[50vh] space-y-3 overflow-y-auto pr-1">
                      {colaboradores.map((colab) => {
                        const regimePadrao = getContratoRegime(colab)
                        const regimeAtual = regimeOverrides[colab.id] ?? 'AUTO'
                        return (
                          <div key={colab.id} className="grid grid-cols-1 gap-2 rounded border p-3 md:grid-cols-[1fr_220px] md:items-center">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium">{colab.nome}</p>
                              <p className="text-xs text-muted-foreground">
                                Padrão do contrato: {regimePadrao}
                              </p>
                            </div>
                            <Select
                              value={regimeAtual}
                              onValueChange={(value) => {
                                setRegimeOverrides((prev) => {
                                  const next = { ...prev }
                                  if (value === 'AUTO') {
                                    delete next[colab.id]
                                  } else {
                                    next[colab.id] = value as RegimeEscala
                                  }
                                  return next
                                })
                              }}
                            >
                              <SelectTrigger>
                                <SelectValue placeholder="Usar padrão" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="AUTO">Usar padrão ({regimePadrao})</SelectItem>
                                <SelectItem value="5X2">5x2</SelectItem>
                                <SelectItem value="6X1">6x1</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        )
                      })}
                    </div>

                    <AlertDialogFooter>
                      <Button
                        variant="outline"
                        onClick={() => setRegimeOverrides({})}
                        disabled={Object.keys(regimeOverrides).length === 0}
                      >
                        Limpar overrides
                      </Button>
                      <AlertDialogAction>Aplicar cenário</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
                <Button onClick={handleGerar} disabled={gerando || preflightLoading}>
                  {gerando ? (
                    <Loader2 className="mr-1 size-4 animate-spin" />
                  ) : (
                    <CalendarDays className="mr-1 size-4" />
                  )}
                  {preflightLoading ? 'Validando...' : gerando ? 'Gerando...' : 'Gerar Escala'}
                </Button>
              </CardContent>
            </Card>

            {gerando && (
              <Card className="border-blue-500/30 bg-blue-950/20">
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <Terminal className="size-4 text-blue-400" />
                    <span>Solver OR-Tools</span>
                    <Loader2 className="ml-auto size-4 animate-spin text-blue-400" />
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="h-[200px] overflow-y-auto rounded-md border border-border/50 bg-black/40 p-3 font-mono text-xs text-green-400">
                    {solverLogs.length === 0 ? (
                      <div className="text-muted-foreground">Iniciando solver...</div>
                    ) : (
                      solverLogs.map((line, i) => (
                        <div key={i} className="leading-5">
                          {line}
                        </div>
                      ))
                    )}
                    <div ref={solverLogsEndRef} />
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    O solver esta buscando a melhor escala possivel. Isso pode levar alguns minutos.
                  </p>
                </CardContent>
              </Card>
            )}

            {escalaCompleta ? (
              <SimulacaoResult
                escalaCompleta={escalaCompleta}
                colaboradores={colaboradores}
                demandas={demandas ?? []}
                tiposContrato={tiposContrato ?? []}
                setorNome={setor.nome}
                expandViolacoes={expandViolacoes}
                setExpandViolacoes={setExpandViolacoes}
                onOficializar={handleOficializar}
                onDescartar={handleDescartar}
                onImprimir={handleImprimir}
                onExportar={handleExportar}
                getIndicators={getIndicators}
                oficializando={oficializando}
                descartando={descartando}
                precisaRegerar={Boolean(regerarWarning)}
                mensagemRegerar={regerarWarning}
                onRegerar={handleGerar}
                onCelulaClick={handleCelulaClick}
                ajustando={ajustando}
                changedCells={changedCells}
                escalaViewMode={escalaViewMode}
                setEscalaViewMode={setEscalaViewMode}
                setor={setor}
              />
            ) : (
              <Card>
                <CardContent className="py-8">
                  <div className="flex flex-col items-center justify-center mb-6">
                    <CalendarDays className="mb-3 size-10 text-muted-foreground/30" />
                    <p className="text-sm font-medium text-muted-foreground">
                      Nenhuma escala gerada para {setor.nome}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground/70">
                      Selecione o periodo acima e clique em &quot;Gerar Escala&quot;
                    </p>
                  </div>

                  {/* Equipe do setor */}
                  {colaboradores.length > 0 && (
                    <div className="border-t pt-5">
                      <p className="text-xs font-semibold text-foreground mb-3">
                        Equipe do setor ({colaboradores.length} colaborador{colaboradores.length > 1 ? 'es' : ''})
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {colaboradores.map((colab) => {
                          const contratoNome = tiposContrato?.find(tc => tc.id === colab.tipo_contrato_id)?.nome
                          return (
                            <div
                              key={colab.id}
                              className="flex items-center gap-2 rounded-lg border bg-muted/20 px-3 py-2"
                            >
                              <div
                                className={cn(
                                  'flex size-7 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold',
                                  colab.sexo === 'F'
                                    ? 'bg-pink-100 dark:bg-pink-950/30 text-pink-700 dark:text-pink-300'
                                    : 'bg-sky-100 dark:bg-sky-950/30 text-sky-700 dark:text-sky-300',
                                )}
                              >
                                {iniciais(colab.nome)}
                              </div>
                              <div className="min-w-0">
                                <p className="text-xs font-medium text-foreground leading-tight truncate">
                                  {colab.nome.split(' ').slice(0, 2).join(' ')}
                                </p>
                                {contratoNome && (
                                  <p className="text-[10px] text-muted-foreground truncate">{contratoNome}</p>
                                )}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* TAB: Oficial */}
          <TabsContent value="oficial" className="space-y-4">
            {loadingOficial ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="mb-2 size-6 animate-spin text-muted-foreground" />
                <p className="text-sm text-muted-foreground">Carregando escala oficial...</p>
              </div>
            ) : oficialEscala ? (
              <>
                <Card>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <div>
                        <CardTitle className="flex items-center gap-2 text-base font-semibold">
                          Escala Oficial: {setor.nome} - {formatarMes(oficialEscala.escala.data_inicio)}
                          <Badge
                            variant="outline"
                            className="border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300"
                          >
                            <CheckCircle2 className="mr-1 size-3" /> Oficial
                          </Badge>
                        </CardTitle>
                        <p className="text-xs text-muted-foreground mt-1">
                          Oficializada em {formatarData(oficialEscala.escala.criada_em.split('T')[0])} |
                          Pontuacao: {oficialEscala.escala.pontuacao ?? '-'}
                        </p>
                      </div>
                      <EscalaViewToggle mode={escalaViewMode} onChange={setEscalaViewMode} />
                    </div>
                  </CardHeader>
                  <CardContent>
                    {escalaViewMode === 'grid' ? (
                      <EscalaGrid
                        colaboradores={colaboradores}
                        alocacoes={oficialEscala.alocacoes}
                        dataInicio={oficialEscala.escala.data_inicio}
                        dataFim={oficialEscala.escala.data_fim}
                        demandas={demandas ?? undefined}
                        tiposContrato={tiposContrato ?? undefined}
                        readOnly
                      />
                    ) : (
                      <TimelineGrid
                        colaboradores={colaboradores}
                        alocacoes={oficialEscala.alocacoes}
                        setor={setor}
                        dataSelecionada={oficialEscala.escala.data_inicio}
                        dataInicio={oficialEscala.escala.data_inicio}
                        dataFim={oficialEscala.escala.data_fim}
                        demandas={demandas ?? undefined}
                        tiposContrato={tiposContrato ?? undefined}
                        readOnly
                      />
                    )}
                  </CardContent>
                </Card>
                <div className="flex items-center gap-3">
                  <Button variant="outline" onClick={() => handleExportar(oficialEscala)}>
                    <Download className="mr-1 size-4" />
                    Exportar
                  </Button>
                  <Button variant="outline" onClick={() => handleImprimir(oficialEscala)}>
                    <Printer className="mr-1 size-4" />
                    Imprimir
                  </Button>
                </div>
              </>
            ) : (
              <Card>
                <CardContent className="flex flex-col items-center justify-center py-16">
                  <CalendarDays className="mb-4 size-12 text-muted-foreground/30" />
                  <p className="text-sm font-medium text-muted-foreground">
                    Nenhuma escala oficial para {setor.nome}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground/70">
                    Gere na aba Simulacao e oficialize.
                  </p>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* TAB: Historico */}
          <TabsContent value="historico" className="space-y-4">
            {loadingHistorico ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="mb-2 size-6 animate-spin text-muted-foreground" />
                <p className="text-sm text-muted-foreground">Carregando historico...</p>
              </div>
            ) : escalasArquivadas.length > 0 ? (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base font-semibold">
                    Escalas Anteriores (Arquivadas)
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {escalasArquivadas.map((esc) => (
                    <div key={esc.id}>
                      <div className="flex items-center justify-between rounded-lg border p-4">
                        <div className="flex items-center gap-3">
                          <CalendarDays className="size-5 text-muted-foreground" />
                          <div>
                            <p className="text-sm font-medium capitalize text-foreground">
                              {formatarMes(esc.data_inicio)}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {formatarData(esc.data_inicio)} a {formatarData(esc.data_fim)}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <PontuacaoBadge pontuacao={esc.pontuacao ?? 0} />
                          <Badge variant="outline" className="text-muted-foreground">
                            Arquivada
                          </Badge>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => loadHistoricoDetail(esc.id)}
                          >
                            <Eye className="mr-1 size-3.5" />
                            {expandedHistorico === esc.id ? 'Fechar' : 'Ver'}
                          </Button>
                        </div>
                      </div>
                      {expandedHistorico === esc.id && (
                        <div className="mt-2 rounded-lg border p-4">
                          {loadingDetail ? (
                            <div className="flex flex-col items-center justify-center py-8">
                              <Loader2 className="mb-2 size-6 animate-spin text-muted-foreground" />
                              <p className="text-center text-sm text-muted-foreground">
                                Carregando detalhes...
                              </p>
                            </div>
                          ) : historicoDetail ? (
                            <>
                              <div className="flex justify-end mb-3">
                                <EscalaViewToggle mode={escalaViewMode} onChange={setEscalaViewMode} />
                              </div>
                              {escalaViewMode === 'grid' ? (
                                <EscalaGrid
                                  colaboradores={colaboradores}
                                  alocacoes={historicoDetail.alocacoes}
                                  dataInicio={historicoDetail.escala.data_inicio}
                                  dataFim={historicoDetail.escala.data_fim}
                                  demandas={demandas ?? undefined}
                                  tiposContrato={tiposContrato ?? undefined}
                                  readOnly
                                />
                              ) : (
                                <TimelineGrid
                                  colaboradores={colaboradores}
                                  alocacoes={historicoDetail.alocacoes}
                                  setor={setor}
                                  dataSelecionada={historicoDetail.escala.data_inicio}
                                  dataInicio={historicoDetail.escala.data_inicio}
                                  dataFim={historicoDetail.escala.data_fim}
                                  demandas={demandas ?? undefined}
                                  tiposContrato={tiposContrato ?? undefined}
                                  readOnly
                                />
                              )}
                            </>
                          ) : null}
                        </div>
                      )}
                    </div>
                  ))}
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardContent className="flex flex-col items-center justify-center py-16">
                  <CalendarDays className="mb-4 size-12 text-muted-foreground/30" />
                  <p className="text-sm font-medium text-muted-foreground">
                    Nenhuma escala arquivada
                  </p>
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>
      </div>

      <AlertDialog open={regerarModalOpen} onOpenChange={setRegerarModalOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Simulação desatualizada</AlertDialogTitle>
            <AlertDialogDescription>
              {regerarWarning ?? 'Houve mudanças no cenário e a escala precisa ser gerada novamente antes de oficializar.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Fechar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setRegerarModalOpen(false)
                handleGerar()
              }}
            >
              Regerar simulação
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Export Modal */}
      {setor && colaboradores && exportEscala && (
        <ExportModal
          open={exportOpen}
          onOpenChange={setExportOpen}
          context="escala"
          titulo={`Exportar Escala — ${setor.nome}`}
          formato={exportCtrl.formato}
          onFormatoChange={exportCtrl.setFormato}
          opcoes={exportCtrl.opcoes}
          onOpcoesChange={exportCtrl.setOpcoes}
          colaboradores={colaboradores.map((c) => ({ id: c.id, nome: c.nome }))}
          funcionarioId={exportCtrl.funcionarioId}
          onFuncionarioChange={exportCtrl.setFuncionarioId}
          onExportHTML={() => {
            const slug = setor.nome.toLowerCase().replace(/\s+/g, '-')
            if (exportCtrl.formato === 'funcionario' && exportCtrl.funcionarioId) {
              const html = renderFuncHTML(exportCtrl.funcionarioId)
              const colab = colaboradores.find((c) => c.id === exportCtrl.funcionarioId)
              const fname = colab ? colab.nome.replace(/\s+/g, '_') : 'funcionario'
              exportarService.salvarHTML(html, `escala-${fname}.html`).then(() => toast.success('HTML salvo'))
            } else if (exportCtrl.formato === 'batch') {
              exportCtrl.handleBatch(
                colaboradores.map((c) => ({ id: c.id, nome: c.nome })),
                renderFuncHTML,
              )
            } else {
              exportCtrl.handleExportHTML(`escala-${slug}.html`)
            }
          }}
          onPrint={() => {
            const slug = setor.nome.toLowerCase().replace(/\s+/g, '-')
            if (exportCtrl.formato === 'funcionario' && exportCtrl.funcionarioId) {
              const html = renderFuncHTML(exportCtrl.funcionarioId)
              const colab = colaboradores.find((c) => c.id === exportCtrl.funcionarioId)
              const fname = colab ? colab.nome.replace(/\s+/g, '_') : 'funcionario'
              exportarService.imprimirPDF(html, `escala-${fname}.pdf`).then(() => toast.success('PDF salvo'))
            } else {
              exportCtrl.handlePrint(`escala-${slug}.pdf`)
            }
          }}
          loading={exportCtrl.loading}
          progress={exportCtrl.progress}
        >
          <ExportarEscala
            escala={exportEscala.escala}
            alocacoes={exportEscala.alocacoes}
            colaboradores={colaboradores}
            setor={setor}
            violacoes={exportEscala.violacoes}
            tiposContrato={tiposContrato ?? []}
            opcoes={exportCtrl.opcoes}
          />
        </ExportModal>
      )}
    </div>
  )
}

// ─── Simulacao Result Sub-component ──────────────────────────────────────────

interface SimulacaoResultProps {
  escalaCompleta: EscalaCompletaV3
  colaboradores: Colaborador[]
  demandas: import('@shared/index').Demanda[]
  tiposContrato: import('@shared/index').TipoContrato[]
  setorNome: string
  expandViolacoes: boolean
  setExpandViolacoes: (v: boolean) => void
  onOficializar: () => void
  onDescartar: () => void
  onImprimir: (ec: EscalaCompletaV3) => void
  onExportar: (ec: EscalaCompletaV3) => void
  getIndicators: (ec: EscalaCompletaV3) => {
    pontuacao: number
    coberturaPercent: number
    violacoesHard: number
    violacoesSoft: number
    equilibrio: number
  }
  oficializando: boolean
  descartando: boolean
  precisaRegerar: boolean
  mensagemRegerar: string | null
  onRegerar: () => void
  onCelulaClick?: (colaboradorId: number, data: string, statusAtual: string) => void
  ajustando?: { colaboradorId: number; data: string } | null
  changedCells?: Set<string>
  escalaViewMode: 'grid' | 'timeline'
  setEscalaViewMode: (mode: 'grid' | 'timeline') => void
  setor: Setor
}

function SimulacaoResult({
  escalaCompleta,
  colaboradores,
  demandas,
  tiposContrato,
  setorNome,
  expandViolacoes,
  setExpandViolacoes,
  onOficializar,
  onDescartar,
  onImprimir,
  onExportar,
  getIndicators,
  oficializando,
  descartando,
  precisaRegerar,
  mensagemRegerar,
  onRegerar,
  onCelulaClick,
  ajustando,
  changedCells = new Set(),
  escalaViewMode,
  setEscalaViewMode,
  setor,
}: SimulacaoResultProps) {
  const indicators = getIndicators(escalaCompleta)
  const violacoes = escalaCompleta.violacoes
  const decisoes = escalaCompleta.decisoes ?? []
  const comparacao = escalaCompleta.comparacao_demanda ?? []
  const antipatterns = escalaCompleta.antipatterns ?? []

  // Build Set of violated cells (HARD only) for grid highlighting
  const violatedCells = new Set(
    violacoes
      .filter((v) => v.severidade === 'HARD' && v.data)
      .map((v) => `${v.colaborador_id}-${v.data}`)
  )

  return (
    <>
      {/* Indicadores */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <IndicatorCard
          icon={TrendingUp}
          value={<PontuacaoBadge pontuacao={indicators.pontuacao} />}
          label="Pontuacao"
        />
        <IndicatorCard
          icon={CheckCircle2}
          value={`${indicators.coberturaPercent}%`}
          label="Cobertura"
          colorClass="bg-emerald-100 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400"
        />
        <IndicatorCard
          icon={XCircle}
          value={indicators.violacoesHard}
          label="Violacoes Hard"
          colorClass="bg-red-100 dark:bg-red-950/30 text-red-600 dark:text-red-400"
        />
        <IndicatorCard
          icon={AlertTriangle}
          value={indicators.violacoesSoft}
          label="Violacoes Soft"
          colorClass="bg-amber-100 dark:bg-amber-950/30 text-amber-600 dark:text-amber-400"
        />
        <IndicatorCard
          icon={Shield}
          value={`${indicators.equilibrio}%`}
          label="Equilibrio"
          colorClass="bg-primary/10 text-primary"
        />
      </div>

      {/* Grid */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-base font-semibold">
            Escala: {setorNome} - {formatarMes(escalaCompleta.escala.data_inicio)}
            <Badge
              variant="outline"
              className="ml-2 border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 text-xs text-amber-700 dark:text-amber-300"
            >
              <Clock className="mr-1 size-3" /> Rascunho
            </Badge>
          </CardTitle>
          <div className="flex items-center gap-2">
            <EscalaViewToggle mode={escalaViewMode} onChange={setEscalaViewMode} />
            <PontuacaoBadge pontuacao={indicators.pontuacao} />
          </div>
        </CardHeader>
        <CardContent>
          {escalaViewMode === 'grid' ? (
            <EscalaGrid
              colaboradores={colaboradores}
              alocacoes={escalaCompleta.alocacoes}
              dataInicio={escalaCompleta.escala.data_inicio}
              dataFim={escalaCompleta.escala.data_fim}
              demandas={demandas}
              tiposContrato={tiposContrato}
              readOnly={false}
              onCelulaClick={onCelulaClick}
              loadingCell={ajustando ?? undefined}
              changedCells={changedCells}
              violatedCells={violatedCells}
            />
          ) : (
            <TimelineGrid
              colaboradores={colaboradores}
              alocacoes={escalaCompleta.alocacoes}
              setor={setor}
              dataSelecionada={escalaCompleta.escala.data_inicio}
              dataInicio={escalaCompleta.escala.data_inicio}
              dataFim={escalaCompleta.escala.data_fim}
              demandas={demandas}
              tiposContrato={tiposContrato}
              readOnly={false}
              onCelulaClick={onCelulaClick}
              loadingCell={ajustando ?? undefined}
              changedCells={changedCells}
              violatedCells={violatedCells}
            />
          )}
        </CardContent>
      </Card>

      {/* Violacoes */}
      {violacoes.length > 0 && (
        <Card>
          <CardHeader
            className="cursor-pointer pb-2"
            onClick={() => setExpandViolacoes(!expandViolacoes)}
          >
            <CardTitle className="flex items-center gap-2 text-base font-semibold">
              <AlertTriangle className="size-4 text-amber-500 dark:text-amber-400" />
              Violacoes ({violacoes.length})
              <span className="text-xs font-normal text-muted-foreground">
                {expandViolacoes ? '(clique para fechar)' : '(clique para expandir)'}
              </span>
            </CardTitle>
          </CardHeader>
          {expandViolacoes && (
            <CardContent className="space-y-4 pt-0">
              <ViolacoesAgrupadas violacoes={violacoes} />
            </CardContent>
          )}
        </Card>
      )}

      {/* Delta de Cobertura (v3) */}
      {comparacao.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base font-semibold">
              <TrendingUp className="size-4 text-primary" />
              Planejado x Executado
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1.5">
              {(() => {
                // Group by data, show summary per day
                const porDia = new Map<string, { planejado: number; executado: number; delta: number }>()
                for (const slot of comparacao) {
                  const prev = porDia.get(slot.data) ?? { planejado: 0, executado: 0, delta: 0 }
                  porDia.set(slot.data, {
                    planejado: prev.planejado + slot.planejado,
                    executado: prev.executado + slot.executado,
                    delta: prev.delta + slot.delta,
                  })
                }
                const dias = Array.from(porDia.entries()).slice(0, 7)
                return dias.map(([data, vals]) => {
                  const pct = vals.planejado > 0 ? Math.round((vals.executado / vals.planejado) * 100) : 100
                  const isNegative = vals.delta < 0
                  const isPositive = vals.delta > 0
                  return (
                    <div key={data} className="flex items-center gap-3 text-xs">
                      <span className="w-20 text-muted-foreground shrink-0">
                        {new Date(data + 'T00:00:00').toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' })}
                      </span>
                      <Progress
                        value={Math.min(100, pct)}
                        className={cn(
                          'flex-1 h-3',
                          isNegative
                            ? '[&>div]:bg-destructive/50'
                            : isPositive
                            ? '[&>div]:bg-amber-400/70'
                            : '[&>div]:bg-emerald-500/60',
                        )}
                      />
                      <Badge
                        variant="outline"
                        className={cn(
                          'shrink-0 text-[10px] font-semibold tabular-nums',
                          isNegative
                            ? 'border-destructive/40 bg-destructive/10 text-destructive'
                            : isPositive
                            ? 'border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300'
                            : 'border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300',
                        )}
                      >
                        {isPositive ? '+' : ''}{vals.delta}
                      </Badge>
                    </div>
                  )
                })
              })()}
            </div>
            {comparacao.length > 7 && (
              <p className="mt-2 text-[10px] text-muted-foreground">
                Mostrando primeiros 7 dias. Total: {comparacao.length} slots.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Por que? — Decisoes do Motor (v3) */}
      {(decisoes.length > 0 || antipatterns.length > 0) && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base font-semibold">
              <Info className="size-4 text-muted-foreground" />
              Por que?
              <span className="text-xs font-normal text-muted-foreground">
                {decisoes.length > 0 ? `${decisoes.length} decisoes do motor` : ''}
                {antipatterns.length > 0 ? `${decisoes.length > 0 ? ' · ' : ''}${antipatterns.length} antipatterns` : ''}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {antipatterns.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Antipatterns detectados
                </p>
                {antipatterns.map((ap, i) => {
                  const isGrave = ap.tier === 1
                  return (
                    <Alert
                      key={i}
                      variant={isGrave ? 'destructive' : 'default'}
                      className={cn('py-2.5 text-xs', !isGrave && 'border-amber-400/50 dark:border-amber-700/50 bg-amber-50/40 dark:bg-amber-950/20')}
                    >
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="shrink-0 text-[9px] h-4">
                          {ap.tier}
                        </Badge>
                        <span className="font-medium">{ap.mensagem_rh}</span>
                      </div>
                      {ap.sugestao && (
                        <AlertDescription className="mt-1 ml-0">{ap.sugestao}</AlertDescription>
                      )}
                    </Alert>
                  )
                })}
              </div>
            )}
            {decisoes.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Decisoes do motor
                </p>
                <div className="max-h-64 overflow-y-auto space-y-1">
                  {decisoes.slice(0, 50).map((d, i) => (
                    <div key={i} className="flex items-start gap-2 rounded border bg-muted/20 px-2.5 py-2 text-xs">
                      <span className="shrink-0 font-medium text-foreground">
                        {d.colaborador_nome.split(' ')[0]}
                      </span>
                      <span className="text-muted-foreground">
                        {new Date(d.data + 'T00:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}
                      </span>
                      <Badge variant="outline" className="shrink-0 text-[9px] h-4">{d.acao}</Badge>
                      <span className="text-muted-foreground flex-1">{d.razao}</span>
                    </div>
                  ))}
                  {decisoes.length > 50 && (
                    <p className="text-[10px] text-muted-foreground text-center py-1">
                      +{decisoes.length - 50} decisoes nao exibidas
                    </p>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Actions */}
      <div className="flex items-center gap-3">
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button disabled={oficializando || !!ajustando || indicators.violacoesHard > 0 || precisaRegerar}>
              <CheckCircle2 className="mr-1 size-4" />
              {oficializando ? 'Oficializando...' : 'Oficializar'}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Oficializar escala?</AlertDialogTitle>
              <AlertDialogDescription>
                A escala oficial anterior (se houver) sera arquivada automaticamente.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction onClick={onOficializar}>Oficializar</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        {indicators.violacoesHard > 0 && (
          <span className="text-xs text-destructive">
            Corrija {indicators.violacoesHard} violacao(oes) critica(s) antes de oficializar
          </span>
        )}
        {precisaRegerar && (
          <span className="text-xs text-amber-700 dark:text-amber-300">
            {mensagemRegerar ?? 'Simulacao desatualizada. Gere novamente antes de oficializar.'}
          </span>
        )}
        {precisaRegerar && (
          <Button variant="outline" onClick={onRegerar} disabled={oficializando || !!ajustando}>
            Regerar agora
          </Button>
        )}
        <Button variant="outline" onClick={() => onExportar(escalaCompleta)} disabled={!!ajustando}>
          <Download className="mr-1 size-4" />
          Exportar
        </Button>
        <Button variant="outline" onClick={() => onImprimir(escalaCompleta)} disabled={!!ajustando}>
          <Printer className="mr-1 size-4" />
          Imprimir
        </Button>
        <div className="flex-1" />
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline" className="text-destructive hover:bg-destructive/5" disabled={descartando || !!ajustando}>
              <Trash2 className="mr-1 size-4" />
              {descartando ? 'Descartando...' : 'Descartar'}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Descartar escala?</AlertDialogTitle>
              <AlertDialogDescription>
                Descartar esta simulacao? A escala sera removida permanentemente.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction onClick={onDescartar}>Descartar</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </>
  )
}
