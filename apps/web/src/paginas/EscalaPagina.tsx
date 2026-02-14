import { useState } from 'react'
import { useParams } from 'react-router-dom'
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
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
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
import { EscalaGrid } from '@/componentes/EscalaGrid'
import { ExportarEscala } from '@/componentes/ExportarEscala'
import { cn } from '@/lib/utils'
import { CORES_VIOLACAO } from '@/lib/cores'
import { formatarData, formatarMes } from '@/lib/formatadores'
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
} from '@escalaflow/shared'

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

  // Simulacao state
  const [dataInicio, setDataInicio] = useState('2026-03-01')
  const [dataFim, setDataFim] = useState('2026-03-31')
  const [gerando, setGerando] = useState(false)
  const [escalaCompleta, setEscalaCompleta] = useState<EscalaCompleta | null>(null)
  const [expandViolacoes, setExpandViolacoes] = useState(false)

  // Oficial tab state
  const [oficialEscala, setOficialEscala] = useState<EscalaCompleta | null>(null)
  const [loadingOficial, setLoadingOficial] = useState(false)
  const [oficialLoaded, setOficialLoaded] = useState(false)

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
      toast.error(err instanceof Error ? err.message : 'Erro ao gerar escala')
    } finally {
      setGerando(false)
    }
  }

  // Officialize
  async function handleOficializar() {
    if (!escalaCompleta) return
    try {
      await escalasService.oficializar(escalaCompleta.escala.id)
      toast.success('Escala oficializada')
      setEscalaCompleta(null)
      setOficialLoaded(false)
      setHistoricoLoaded(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao oficializar')
    }
  }

  // Discard
  async function handleDescartar() {
    if (!escalaCompleta) return
    try {
      await escalasService.deletar(escalaCompleta.escala.id)
      toast.success('Escala descartada')
      setEscalaCompleta(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao descartar')
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
      toast.error(err instanceof Error ? err.message : 'Erro ao carregar escala oficial')
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
      toast.error(err instanceof Error ? err.message : 'Erro ao carregar historico')
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
      toast.error(err instanceof Error ? err.message : 'Erro ao carregar detalhes')
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
        <PageHeader breadcrumbs={[{ label: 'Escala' }, { label: 'Carregando...' }]} />
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
          <TabsContent value="simulacao" className="space-y-4">
            {/* Generate controls */}
            <Card>
              <CardContent className="flex flex-wrap items-end gap-4 p-4">
                <div className="space-y-1">
                  <Label className="text-xs">Data Inicio</Label>
                  <Input
                    type="date"
                    value={dataInicio}
                    onChange={(e) => setDataInicio(e.target.value)}
                    className="w-[160px]"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Data Fim</Label>
                  <Input
                    type="date"
                    value={dataFim}
                    onChange={(e) => setDataFim(e.target.value)}
                    className="w-[160px]"
                  />
                </div>
                <Button onClick={handleGerar} disabled={gerando}>
                  <CalendarDays className="mr-1 size-4" />
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
                <p className="text-sm text-muted-foreground">Carregando escala oficial...</p>
              </div>
            ) : oficialEscala ? (
              <>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-base font-semibold">
                      Escala Oficial: {setor.nome} - {formatarMes(oficialEscala.escala.data_inicio)}
                      <Badge
                        variant="outline"
                        className="border-emerald-200 bg-emerald-50 text-emerald-700"
                      >
                        <CheckCircle2 className="mr-1 size-3" /> Oficial
                      </Badge>
                    </CardTitle>
                    <p className="text-xs text-muted-foreground">
                      Oficializada em {formatarData(oficialEscala.escala.criada_em.split('T')[0])} |
                      Pontuacao: {oficialEscala.escala.pontuacao ?? '-'}
                    </p>
                  </CardHeader>
                  <CardContent>
                    <EscalaGrid
                      colaboradores={colaboradores}
                      alocacoes={oficialEscala.alocacoes}
                      dataInicio={oficialEscala.escala.data_inicio}
                      dataFim={oficialEscala.escala.data_fim}
                      demandas={demandas ?? undefined}
                      tiposContrato={tiposContrato ?? undefined}
                      readOnly
                    />
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
                            <p className="text-center text-sm text-muted-foreground">
                              Carregando detalhes...
                            </p>
                          ) : historicoDetail ? (
                            <EscalaGrid
                              colaboradores={colaboradores}
                              alocacoes={historicoDetail.alocacoes}
                              dataInicio={historicoDetail.escala.data_inicio}
                              dataFim={historicoDetail.escala.data_fim}
                              demandas={demandas ?? undefined}
                              tiposContrato={tiposContrato ?? undefined}
                              readOnly
                            />
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

// ─── Simulacao Result Sub-component ──────────────────────────────────────────

interface SimulacaoResultProps {
  escalaCompleta: EscalaCompleta
  colaboradores: Colaborador[]
  demandas: import('@escalaflow/shared').Demanda[]
  tiposContrato: import('@escalaflow/shared').TipoContrato[]
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
}: SimulacaoResultProps) {
  const indicators = getIndicators(escalaCompleta)
  const violacoes = escalaCompleta.violacoes

  return (
    <>
      {/* Indicadores */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Card>
          <CardContent className="flex items-center gap-3 p-3">
            <TrendingUp className="size-4 text-primary" />
            <div>
              <p className="text-lg font-bold text-foreground">
                <PontuacaoBadge pontuacao={indicators.pontuacao} />
              </p>
              <p className="text-[10px] text-muted-foreground">Pontuacao</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-3">
            <div className="flex size-8 items-center justify-center rounded-full bg-emerald-100">
              <CheckCircle2 className="size-4 text-emerald-600" />
            </div>
            <div>
              <p className="text-lg font-bold text-foreground">{indicators.coberturaPercent}%</p>
              <p className="text-[10px] text-muted-foreground">Cobertura</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-3">
            <div className="flex size-8 items-center justify-center rounded-full bg-red-100">
              <XCircle className="size-4 text-red-600" />
            </div>
            <div>
              <p className="text-lg font-bold text-foreground">{indicators.violacoesHard}</p>
              <p className="text-[10px] text-muted-foreground">Violacoes Hard</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-3">
            <div className="flex size-8 items-center justify-center rounded-full bg-amber-100">
              <AlertTriangle className="size-4 text-amber-600" />
            </div>
            <div>
              <p className="text-lg font-bold text-foreground">{indicators.violacoesSoft}</p>
              <p className="text-[10px] text-muted-foreground">Violacoes Soft</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-3">
            <div className="flex size-8 items-center justify-center rounded-full bg-primary/10">
              <Shield className="size-4 text-primary" />
            </div>
            <div>
              <p className="text-lg font-bold text-foreground">{indicators.equilibrio}%</p>
              <p className="text-[10px] text-muted-foreground">Equilibrio</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Grid */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-base font-semibold">
            Escala: {setorNome} - {formatarMes(escalaCompleta.escala.data_inicio)}
            <Badge
              variant="outline"
              className="ml-2 border-amber-200 bg-amber-50 text-xs text-amber-700"
            >
              <Clock className="mr-1 size-3" /> Rascunho
            </Badge>
          </CardTitle>
          <PontuacaoBadge pontuacao={indicators.pontuacao} />
        </CardHeader>
        <CardContent>
          <EscalaGrid
            colaboradores={colaboradores}
            alocacoes={escalaCompleta.alocacoes}
            dataInicio={escalaCompleta.escala.data_inicio}
            dataFim={escalaCompleta.escala.data_fim}
            demandas={demandas}
            tiposContrato={tiposContrato}
          />
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
              <AlertTriangle className="size-4 text-amber-500" />
              Violacoes ({violacoes.length})
              <span className="text-xs font-normal text-muted-foreground">
                {expandViolacoes ? '(clique para fechar)' : '(clique para expandir)'}
              </span>
            </CardTitle>
          </CardHeader>
          {expandViolacoes && (
            <CardContent className="space-y-2 pt-0">
              {violacoes.map((v: Violacao, i: number) => {
                const cores = CORES_VIOLACAO[v.severidade]
                return (
                  <div
                    key={i}
                    className={cn(
                      'flex items-start gap-3 rounded-lg border p-3',
                      cores.border,
                      cores.bg,
                    )}
                  >
                    {v.severidade === 'HARD' ? (
                      <XCircle className="mt-0.5 size-4 shrink-0 text-red-600" />
                    ) : (
                      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
                    )}
                    <div>
                      <p className={cn('text-xs font-medium', cores.text)}>
                        {v.regra}
                        {v.colaborador_nome && ` - ${v.colaborador_nome}`}
                      </p>
                      <p className={cn('text-xs', cores.textLight)}>{v.mensagem}</p>
                    </div>
                  </div>
                )
              })}
            </CardContent>
          )}
        </Card>
      )}

      {/* Actions */}
      <div className="flex items-center gap-3">
        <Button onClick={onOficializar}>
          <CheckCircle2 className="mr-1 size-4" />
          Oficializar
        </Button>
        <Button variant="outline" onClick={() => onImprimir(escalaCompleta)}>
          <Printer className="mr-1 size-4" />
          Imprimir
        </Button>
        <div className="flex-1" />
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline" className="text-destructive hover:bg-destructive/5">
              <Trash2 className="mr-1 size-4" />
              Descartar
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
