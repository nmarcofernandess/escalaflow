import { useState, useRef } from 'react'
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
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
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
import { cn } from '@/lib/utils'
import { CORES_VIOLACAO } from '@/lib/cores'
import { formatarData, formatarMes, mapError, REGRAS_TEXTO, iniciais } from '@/lib/formatadores'
import { useApiData } from '@/hooks/useApiData'
import { setoresService } from '@/servicos/setores'
import { colaboradoresService } from '@/servicos/colaboradores'
import { escalasService } from '@/servicos/escalas'
import { tiposContratoService } from '@/servicos/tipos-contrato'
import type {
  EscalaCompleta,
  Escala,
  Alocacao,
  Violacao,
  Colaborador,
  Setor,
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
  const [escalaCompleta, setEscalaCompleta] = useState<EscalaCompleta | null>(null)
  const [ajustando, setAjustando] = useState<{ colaboradorId: number; data: string } | null>(null)
  const [changedCells, setChangedCells] = useState<Set<string>>(new Set())
  const [expandViolacoes, setExpandViolacoes] = useState(false)
  const [oficializando, setOficializando] = useState(false)
  const [descartando, setDescartando] = useState(false)
  const [escalaViewMode, setEscalaViewMode] = useEscalaViewMode()

  // Oficial tab state
  const [oficialEscala, setOficialEscala] = useState<EscalaCompleta | null>(null)
  const [loadingOficial, setLoadingOficial] = useState(false)
  const [oficialLoaded, setOficialLoaded] = useState(false)

  const prevAlocacoesRef = useRef<Alocacao[]>([])

  // Historico tab state
  const [escalasArquivadas, setEscalasArquivadas] = useState<Escala[]>([])
  const [loadingHistorico, setLoadingHistorico] = useState(false)
  const [historicoLoaded, setHistoricoLoaded] = useState(false)
  const [expandedHistorico, setExpandedHistorico] = useState<number | null>(null)
  const [historicoDetail, setHistoricoDetail] = useState<EscalaCompleta | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)

  // Generate escala
  async function handleGerar() {
    setGerando(true)
    try {
      const result = await escalasService.gerar(setorId, {
        data_inicio: dataInicio,
        data_fim: dataFim,
      })
      setEscalaCompleta(result)
      toast.success('Escala gerada')
      // Reset oficial/historico caches so they reload if user switches tabs
      setOficialLoaded(false)
      setHistoricoLoaded(false)
    } catch (err) {
      const friendly = mapError(err) || 'Nao foi possivel gerar a escala. Verifique se o setor tem colaboradores e faixas de demanda cadastradas.'
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
    } catch (err) {
      toast.error(mapError(err) || 'Erro ao oficializar')
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
  function handleImprimir(ec: EscalaCompleta) {
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
  function getIndicators(ec: EscalaCompleta) {
    return {
      pontuacao: ec.indicadores.pontuacao,
      coberturaPercent: ec.indicadores.cobertura_percent,
      violacoesHard: ec.indicadores.violacoes_hard,
      violacoesSoft: ec.indicadores.violacoes_soft,
      equilibrio: ec.indicadores.equilibrio,
    }
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
            {gerando && (
              <div className="absolute inset-0 z-20 flex items-center justify-center rounded-lg bg-background/80 backdrop-blur-sm animate-in fade-in-0 duration-200">
                <Card className="w-full max-w-md border-2 shadow-lg">
                  <CardContent className="flex flex-col items-center justify-center gap-4 py-12">
                    <Loader2 className="size-12 animate-spin text-primary" />
                    <p className="text-center text-sm font-medium text-foreground">
                      Gerando escala para {setor.nome}...
                    </p>
                    <p className="text-center text-xs text-muted-foreground">
                      O motor esta calculando horarios e distribuicoes. Aguarde.
                    </p>
                  </CardContent>
                </Card>
              </div>
            )}

            {/* Alerta pre-geracao: sem demandas */}
            {demandas && demandas.length === 0 && (
              <Alert className="border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20 [&>svg]:text-amber-600 dark:[&>svg]:text-amber-400">
                <Info className="size-4" />
                <AlertDescription className="text-xs text-amber-900 dark:text-amber-200">
                  Defina ao menos uma faixa de demanda antes de gerar a escala.{' '}
                  <Link to={`/setores/${setorId}`} className="font-medium underline underline-offset-2">
                    Configurar demandas
                  </Link>
                </AlertDescription>
              </Alert>
            )}

            {/* Generate controls */}
            <Card className={gerando ? 'pointer-events-none opacity-60' : ''}>
              <CardContent className="flex flex-wrap items-end gap-4 p-4">
                <div className="space-y-1">
                  <Label className="text-xs">Data Inicio</Label>
                  <Input
                    type="date"
                    value={dataInicio}
                    onChange={(e) => setDataInicio(e.target.value)}
                    className="w-[160px]"
                    disabled={gerando}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Data Fim</Label>
                  <Input
                    type="date"
                    value={dataFim}
                    onChange={(e) => setDataFim(e.target.value)}
                    className="w-[160px]"
                    disabled={gerando}
                  />
                </div>
                <Button onClick={handleGerar} disabled={gerando || (demandas !== null && demandas.length === 0)}>
                  {gerando ? (
                    <Loader2 className="mr-1 size-4 animate-spin" />
                  ) : (
                    <CalendarDays className="mr-1 size-4" />
                  )}
                  {gerando ? 'Gerando...' : 'Gerar Escala'}
                </Button>
              </CardContent>
            </Card>

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
                getIndicators={getIndicators}
                oficializando={oficializando}
                descartando={descartando}
                onCelulaClick={handleCelulaClick}
                ajustando={ajustando}
                changedCells={changedCells}
                escalaViewMode={escalaViewMode}
                setEscalaViewMode={setEscalaViewMode}
                setor={setor}
              />
            ) : (
              <Card>
                <CardContent className="flex flex-col items-center justify-center py-16">
                  <CalendarDays className="mb-4 size-12 text-muted-foreground/30" />
                  <p className="text-sm font-medium text-muted-foreground">
                    Nenhuma escala gerada para {setor.nome}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground/70">
                    Selecione o periodo acima e clique em &quot;Gerar Escala&quot;
                  </p>
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
    </div>
  )
}

// ─── Violacoes Agrupadas Component ──────────────────────────────────────────

interface ViolacoesAgrupadasProps {
  violacoes: Violacao[]
}

function ViolacoesAgrupadas({ violacoes }: ViolacoesAgrupadasProps) {
  // Agrupar por colaborador
  const porColaborador = violacoes.reduce((acc, v) => {
    if (!acc[v.colaborador_id]) {
      acc[v.colaborador_id] = {
        colaborador_id: v.colaborador_id,
        colaborador_nome: v.colaborador_nome,
        hard: [],
        soft: [],
      }
    }
    if (v.severidade === 'HARD') {
      acc[v.colaborador_id].hard.push(v)
    } else {
      acc[v.colaborador_id].soft.push(v)
    }
    return acc
  }, {} as Record<number, { colaborador_id: number; colaborador_nome: string; hard: Violacao[]; soft: Violacao[] }>)

  const grupos = Object.values(porColaborador)
  const comHard = grupos.filter((g) => g.hard.length > 0)
  const comSoft = grupos.filter((g) => g.soft.length > 0 && g.hard.length === 0)

  return (
    <div className="space-y-4">
      {/* HARD Violations */}
      {comHard.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-destructive flex items-center gap-2">
            <XCircle className="size-4" />
            Violacoes Criticas (HARD)
          </h3>
          {comHard.map((grupo) => (
            <Card
              key={grupo.colaborador_id}
              className={cn('border-2', CORES_VIOLACAO.HARD.border, CORES_VIOLACAO.HARD.bg)}
            >
              <CardContent className="p-4 space-y-3">
                {/* Avatar + Nome */}
                <div className="flex items-center gap-3">
                  <Avatar className="size-10">
                    <AvatarFallback className="bg-destructive/10 text-sm font-bold text-destructive">
                      {iniciais(grupo.colaborador_nome)}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <p className="text-sm font-semibold text-foreground">{grupo.colaborador_nome}</p>
                    <p className="text-xs text-muted-foreground">
                      {grupo.hard.length} problema{grupo.hard.length > 1 ? 's' : ''} critico{grupo.hard.length > 1 ? 's' : ''}
                    </p>
                  </div>
                </div>

                {/* Problemas por dia */}
                <div className="space-y-2">
                  {grupo.hard.map((v, i) => (
                    <div key={i} className="flex items-start gap-2 text-xs">
                      <XCircle className="mt-0.5 size-3.5 shrink-0 text-destructive" />
                      <div>
                        <p className="font-medium text-destructive">
                          {REGRAS_TEXTO[v.regra] || v.regra}
                        </p>
                        {v.data && (
                          <p className="text-muted-foreground">Dia: {formatarData(v.data)}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Dica de acao */}
                <p className="text-xs text-muted-foreground italic border-t pt-2">
                  Clique em um dia de trabalho desse colaborador para trocar por folga
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* SOFT Violations */}
      {comSoft.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-amber-700 dark:text-amber-300 flex items-center gap-2">
            <AlertTriangle className="size-4" />
            Alertas (SOFT)
          </h3>
          {comSoft.map((grupo) => (
            <Card
              key={grupo.colaborador_id}
              className={cn('border', CORES_VIOLACAO.SOFT.border, CORES_VIOLACAO.SOFT.bg)}
            >
              <CardContent className="p-3 space-y-2">
                {/* Avatar + Nome */}
                <div className="flex items-center gap-2">
                  <Avatar className="size-8">
                    <AvatarFallback className="bg-amber-100 dark:bg-amber-950/30 text-xs font-bold text-amber-700 dark:text-amber-300">
                      {iniciais(grupo.colaborador_nome)}
                    </AvatarFallback>
                  </Avatar>
                  <p className="text-sm font-medium text-foreground">{grupo.colaborador_nome}</p>
                </div>

                {/* Problemas */}
                <div className="space-y-1">
                  {grupo.soft.map((v, i) => (
                    <div key={i} className="flex items-start gap-2 text-xs">
                      <AlertTriangle className="mt-0.5 size-3 shrink-0 text-amber-600 dark:text-amber-400" />
                      <p className="text-muted-foreground">
                        {REGRAS_TEXTO[v.regra] || v.regra}
                        {v.data && ` (${formatarData(v.data)})`}
                      </p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Simulacao Result Sub-component ──────────────────────────────────────────

interface SimulacaoResultProps {
  escalaCompleta: EscalaCompleta
  colaboradores: Colaborador[]
  demandas: import('@shared/index').Demanda[]
  tiposContrato: import('@shared/index').TipoContrato[]
  setorNome: string
  expandViolacoes: boolean
  setExpandViolacoes: (v: boolean) => void
  onOficializar: () => void
  onDescartar: () => void
  onImprimir: (ec: EscalaCompleta) => void
  getIndicators: (ec: EscalaCompleta) => {
    pontuacao: number
    coberturaPercent: number
    violacoesHard: number
    violacoesSoft: number
    equilibrio: number
  }
  oficializando: boolean
  descartando: boolean
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
  getIndicators,
  oficializando,
  descartando,
  onCelulaClick,
  ajustando,
  changedCells = new Set(),
  escalaViewMode,
  setEscalaViewMode,
  setor,
}: SimulacaoResultProps) {
  const indicators = getIndicators(escalaCompleta)
  const violacoes = escalaCompleta.violacoes

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

      {/* Actions */}
      <div className="flex items-center gap-3">
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button disabled={oficializando || !!ajustando || indicators.violacoesHard > 0}>
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
