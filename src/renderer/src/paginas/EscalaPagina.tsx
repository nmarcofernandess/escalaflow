import { useState, useEffect, useMemo } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import {
  CalendarDays,
  Loader2,
  Download,
  Printer,
  FileText,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { toast } from 'sonner'
import { PageHeader } from '@/componentes/PageHeader'
import { EscalaGrid } from '@/componentes/EscalaGrid'
import { EscalaViewToggle, useEscalaViewMode } from '@/componentes/EscalaViewToggle'
import { TimelineGrid } from '@/componentes/TimelineGrid'
import { ExportarEscala } from '@/componentes/ExportarEscala'
import { ViolacoesAgrupadas } from '@/componentes/ViolacoesAgrupadas'
import { StatusBadge } from '@/componentes/StatusBadge'
import { EmptyState } from '@/componentes/EmptyState'
import { formatarData, mapError } from '@/lib/formatadores'
import { buildStandaloneHtml } from '@/lib/export-standalone-html'
import { gerarHTMLFuncionario } from '@/lib/gerarHTMLFuncionario'
import { gerarCSVAlocacoes, gerarCSVViolacoes, gerarCSVComparacaoDemanda } from '@/lib/gerarCSV'
import { useApiData } from '@/hooks/useApiData'
import { setoresService } from '@/servicos/setores'
import { funcoesService } from '@/servicos/funcoes'
import { colaboradoresService } from '@/servicos/colaboradores'
import { escalasService } from '@/servicos/escalas'
import { tiposContratoService } from '@/servicos/tipos-contrato'
import { exportarService } from '@/servicos/exportar'
import type {
  EscalaCompletaV3,
  Colaborador,
  Setor,
  Funcao,
  RegraHorarioColaborador,
} from '@shared/index'

// ─── Resumo Table (reused from SetorEscalaSection pattern) ────────────
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { formatarMinutos, REGRAS_TEXTO } from '@/lib/formatadores'

const TOLERANCIA_DEFAULT = 30

function ResumoTable({
  colaboradores,
  alocacoes,
  violacoes,
  tiposContrato,
  dataInicio,
  dataFim,
}: {
  colaboradores: Colaborador[]
  alocacoes: EscalaCompletaV3['alocacoes']
  violacoes: EscalaCompletaV3['violacoes']
  tiposContrato: { id: number; nome: string; horas_semanais: number }[]
  dataInicio: string
  dataFim: string
}) {
  const rows = useMemo(() => {
    const start = new Date(dataInicio + 'T00:00:00')
    const end = new Date(dataFim + 'T00:00:00')
    const totalDays = Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1
    const semanas = Math.max(1, totalDays / 7)

    const minutosReais = new Map<number, number>()
    for (const a of alocacoes) {
      const minutos = a.minutos_trabalho ?? a.minutos
      if (a.status === 'TRABALHO' && minutos != null) {
        minutosReais.set(a.colaborador_id, (minutosReais.get(a.colaborador_id) ?? 0) + minutos)
      }
    }

    const violacoesPorColab = new Map<number, typeof violacoes>()
    for (const v of violacoes) {
      if (v.colaborador_id != null) {
        const arr = violacoesPorColab.get(v.colaborador_id) ?? []
        arr.push(v)
        violacoesPorColab.set(v.colaborador_id, arr)
      }
    }

    return colaboradores.map((colab) => {
      const tc = tiposContrato.find((t) => t.id === colab.tipo_contrato_id)
      const real = minutosReais.get(colab.id) ?? 0
      const metaTotal = tc ? Math.round(tc.horas_semanais * 60 * semanas) : 0
      const delta = real - metaTotal
      const ok = delta >= -TOLERANCIA_DEFAULT
      const colabViolacoes = violacoesPorColab.get(colab.id) ?? []
      return { colab, real, meta: metaTotal, delta, ok, contratoNome: tc?.nome ?? '-', violacoes: colabViolacoes }
    })
  }, [colaboradores, alocacoes, violacoes, tiposContrato, dataInicio, dataFim])

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="text-xs">Colaborador</TableHead>
            <TableHead className="text-xs text-right">Real</TableHead>
            <TableHead className="text-xs text-right">Meta</TableHead>
            <TableHead className="text-xs text-right">Delta</TableHead>
            <TableHead className="text-xs">Avisos</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map(({ colab, real, meta, delta, ok, contratoNome, violacoes: colabV }) => (
            <TableRow key={colab.id}>
              <TableCell className="py-2">
                <div>
                  <p className="text-xs font-medium">{colab.nome}</p>
                  <p className="text-[10px] text-muted-foreground">{contratoNome}</p>
                </div>
              </TableCell>
              <TableCell className="text-xs text-right py-2">{formatarMinutos(real)}</TableCell>
              <TableCell className="text-xs text-right py-2">{formatarMinutos(meta)}</TableCell>
              <TableCell className={cn(
                'text-xs text-right py-2 font-medium',
                delta >= 0 ? 'text-emerald-600 dark:text-emerald-400' : delta >= -TOLERANCIA_DEFAULT ? 'text-amber-600 dark:text-amber-400' : 'text-destructive',
              )}>
                {delta >= 0 ? '+' : ''}{formatarMinutos(Math.abs(delta))}
                {delta < 0 && ' ↓'}
              </TableCell>
              <TableCell className="py-2">
                {colabV.length > 0 ? (
                  <div className="space-y-0.5">
                    {colabV.map((v, i) => (
                      <p key={i} className={cn(
                        'text-[11px] leading-tight',
                        v.severidade === 'HARD' ? 'text-destructive font-medium' : 'text-amber-600 dark:text-amber-400',
                      )}>
                        {v.mensagem || REGRAS_TEXTO[v.regra] || v.regra}
                      </p>
                    ))}
                    {!ok && (
                      <p className="text-[11px] leading-tight text-amber-600 dark:text-amber-400">
                        Abaixo da meta
                      </p>
                    )}
                  </div>
                ) : !ok ? (
                  <p className="text-[11px] text-amber-600 dark:text-amber-400">Abaixo da meta</p>
                ) : (
                  <span className="text-[11px] text-muted-foreground">—</span>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

// ─── Main Component ─────────────────────────────────────────────────────

export function EscalaPagina() {
  const { id } = useParams<{ id: string }>()
  const setorId = parseInt(id ?? '0', 10)
  const navigate = useNavigate()

  // Data loading
  const { data: setor } = useApiData(() => setoresService.buscar(setorId), [setorId])
  const { data: setores } = useApiData(() => setoresService.listar(), [])
  const { data: resumoPorSetor } = useApiData(() => escalasService.resumoPorSetor(), [])
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
  const { data: funcoes } = useApiData(
    () => funcoesService.listar(setorId, true),
    [setorId],
  )
  const { data: horariosSemana } = useApiData(
    () => setoresService.listarHorarioSemana(setorId),
    [setorId],
  )
  const { data: regrasPadrao } = useApiData(
    () => colaboradoresService.listarRegrasPadraoSetor(setorId),
    [setorId],
  )

  const regrasMap = useMemo(() => {
    const map = new Map<number, RegraHorarioColaborador>()
    if (regrasPadrao) {
      for (const r of regrasPadrao) map.set(r.colaborador_id, r)
    }
    return map
  }, [regrasPadrao])

  const [escalaCompleta, setEscalaCompleta] = useState<EscalaCompletaV3 | null>(null)
  const [loading, setLoading] = useState(true)
  const [escalaViewMode, setEscalaViewMode] = useEscalaViewMode()
  const [incluirAvisosCicloExport, setIncluirAvisosCicloExport] = useState(false)
  const [incluirAvisosDetalhadoExport, setIncluirAvisosDetalhadoExport] = useState(true)

  // Load most recent escala (RASCUNHO primeiro, depois OFICIAL)
  useEffect(() => {
    loadEscala()
  }, [setorId]) // eslint-disable-line react-hooks/exhaustive-deps

  async function loadEscala() {
    setLoading(true)
    try {
      // Tentar rascunho primeiro
      const rascunhos = await escalasService.listarPorSetor(setorId, { status: 'RASCUNHO' })
      if (rascunhos.length > 0) {
        const detail = await escalasService.buscar(rascunhos[0].id)
        setEscalaCompleta(detail)
        return
      }
      // Senão, oficial
      const oficiais = await escalasService.listarPorSetor(setorId, { status: 'OFICIAL' })
      if (oficiais.length > 0) {
        const detail = await escalasService.buscar(oficiais[0].id)
        setEscalaCompleta(detail)
        return
      }
      setEscalaCompleta(null)
    } catch {
      setEscalaCompleta(null)
    } finally {
      setLoading(false)
    }
  }

  // Count violations for tab badge
  const violacoesCount = escalaCompleta?.violacoes.length ?? 0
  const setoresComEscala = useMemo(() => new Set((resumoPorSetor ?? []).map((s) => s.setor_id)), [resumoPorSetor])
  const outrosSetores = useMemo(
    () => (setores ?? []).filter((s) => s.id !== setorId && setoresComEscala.has(s.id)),
    [setores, setorId, setoresComEscala],
  )

  // Export handlers
  function renderExportHTML(modo: 'ciclo' | 'detalhado', incluirAvisos: boolean) {
    if (!escalaCompleta || !setor || !colaboradores) return null
    const html = (
      <ExportarEscala
        escala={escalaCompleta.escala}
        alocacoes={escalaCompleta.alocacoes}
        colaboradores={colaboradores}
        setor={setor}
        violacoes={escalaCompleta.violacoes}
        tiposContrato={tiposContrato ?? []}
        funcoes={funcoes ?? []}
        horariosSemana={horariosSemana ?? []}
        modo={modo}
        incluirAvisos={incluirAvisos}
        modoRender="download"
      />
    )
    return { html, setorNome: setor.nome }
  }

  function handlePrintCiclo() {
    if (!escalaCompleta || !setor || !colaboradores) return
    const printWindow = window.open('', '_blank')
    if (!printWindow) {
      toast.error('Bloqueio de popup detectado. Permita popups para imprimir.')
      return
    }
    import('react-dom/server').then(({ renderToStaticMarkup }) => {
      const payload = renderExportHTML('ciclo', incluirAvisosCicloExport)
      if (!payload) return
      const html = renderToStaticMarkup(payload.html)
      const fullHTML = buildStandaloneHtml(html, {
        title: `Escala - ${setor.nome}`,
      })
      printWindow.document.write(fullHTML)
      printWindow.document.close()
      printWindow.focus()
      setTimeout(() => printWindow.print(), 250)
    })
  }

  function handleExportHTMLCiclo() {
    if (!escalaCompleta || !setor || !colaboradores) return
    import('react-dom/server').then(({ renderToStaticMarkup }) => {
      const payload = renderExportHTML('ciclo', incluirAvisosCicloExport)
      if (!payload) return
      const html = renderToStaticMarkup(payload.html)
      const fullHTML = buildStandaloneHtml(html, {
        title: `Escala - ${setor.nome}`,
      })
      const slug = setor.nome.toLowerCase().replace(/\s+/g, '-')
      exportarService.salvarHTML(fullHTML, `escala-ciclo-${slug}.html`).then((result) => {
        if (result) toast.success('HTML salvo com sucesso')
      }).catch(() => toast.error('Erro ao exportar HTML'))
    })
  }

  function handleExportHTMLDetalhado() {
    if (!escalaCompleta || !setor || !colaboradores) return
    import('react-dom/server').then(({ renderToStaticMarkup }) => {
      const payload = renderExportHTML('detalhado', incluirAvisosDetalhadoExport)
      if (!payload) return
      const html = renderToStaticMarkup(payload.html)
      const fullHTML = buildStandaloneHtml(html, {
        title: `Escala - ${setor.nome}`,
      })
      const slug = setor.nome.toLowerCase().replace(/\s+/g, '-')
      exportarService.salvarHTML(fullHTML, `escala-detalhada-${slug}.html`).then((result) => {
        if (result) toast.success('HTML detalhado salvo com sucesso')
      }).catch(() => toast.error('Erro ao exportar HTML detalhado'))
    })
  }

  function handleExportCSV() {
    if (!escalaCompleta || !setor || !colaboradores) return
    const csvAloc = gerarCSVAlocacoes([escalaCompleta], [setor], colaboradores)
    const csvViol = gerarCSVViolacoes([escalaCompleta], [setor])
    const csvDelta = gerarCSVComparacaoDemanda([escalaCompleta], [setor])
    const combined = `${csvAloc}\n\n${csvViol}\n\n${csvDelta}`
    const slug = setor.nome.toLowerCase().replace(/\s+/g, '-')
    exportarService.salvarCSV(combined, `escala-${slug}.csv`).then((result) => {
      if (result) toast.success('CSV salvo com sucesso')
    }).catch(() => toast.error('Erro ao exportar CSV'))
  }

  function handleExportFuncionario(colabId: number) {
    if (!escalaCompleta || !setor || !colaboradores || !tiposContrato) return
    const colab = colaboradores.find((c) => c.id === colabId)
    if (!colab) return
    const tc = tiposContrato.find((t) => t.id === colab.tipo_contrato_id)
    const r = regrasMap.get(colabId)
    const html = gerarHTMLFuncionario({
      nome: colab.nome,
      contrato: tc?.nome ?? '',
      horasSemanais: tc?.horas_semanais ?? colab.horas_semanais,
      setor: setor.nome,
      periodo: { inicio: escalaCompleta.escala.data_inicio, fim: escalaCompleta.escala.data_fim },
      alocacoes: escalaCompleta.alocacoes.filter((a) => a.colaborador_id === colabId),
      violacoes: escalaCompleta.violacoes.filter((v) => v.colaborador_id === colabId),
      regra: r ? { folga_fixa_dia_semana: r.folga_fixa_dia_semana ?? null, folga_variavel_dia_semana: r.folga_variavel_dia_semana ?? null } : undefined,
    })
    const fname = colab.nome.replace(/\s+/g, '_')
    exportarService.salvarHTML(html, `escala-${fname}.html`).then((result) => {
      if (result) toast.success(`Escala de ${colab.nome} salva`)
    }).catch(() => toast.error('Erro ao exportar'))
  }

  function handleAbrirOutroSetor(setorDestinoId: number) {
    navigate(`/setores/${setorDestinoId}/escala`)
  }

  // Loading / no data states
  if (!setor || !colaboradores) {
    return (
      <div className="flex flex-1 flex-col">
        <PageHeader breadcrumbs={[{ label: 'Dashboard', href: '/' }, { label: 'Escala' }, { label: 'Carregando...' }]} />
        <div className="flex items-center justify-center p-16">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
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
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        ) : escalaCompleta ? (
          <>
            {/* Header com info + controles */}
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-foreground">
                  {setor.nome} — Detalhes da Escala
                </h2>
                <div className="mt-1 flex items-center gap-2">
                  <p className="text-sm text-muted-foreground">
                    {formatarData(escalaCompleta.escala.data_inicio)} — {formatarData(escalaCompleta.escala.data_fim)}
                  </p>
                  <StatusBadge status={escalaCompleta.escala.status as 'OFICIAL' | 'RASCUNHO'} />
                </div>
              </div>
              <div className="flex items-center gap-2">
                {/* Export dropdown */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" className="gap-1.5">
                      <Download className="size-3.5" />
                      Exportar
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56">
                    <DropdownMenuItem onClick={handleExportHTMLCiclo}>
                      <FileText className="mr-2 size-3.5" />
                      Ciclo (HTML)
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={handleExportHTMLDetalhado}>
                      <FileText className="mr-2 size-3.5" />
                      Detalhado (HTML)
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={handlePrintCiclo}>
                      <Printer className="mr-2 size-3.5" />
                      Imprimir Ciclo
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={handleExportCSV}>
                      <FileText className="mr-2 size-3.5" />
                      CSV
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel className="text-xs">Avisos no export</DropdownMenuLabel>
                    <DropdownMenuCheckboxItem
                      checked={incluirAvisosCicloExport}
                      onCheckedChange={(checked) => setIncluirAvisosCicloExport(Boolean(checked))}
                    >
                      Incluir no ciclo
                    </DropdownMenuCheckboxItem>
                    <DropdownMenuCheckboxItem
                      checked={incluirAvisosDetalhadoExport}
                      onCheckedChange={(checked) => setIncluirAvisosDetalhadoExport(Boolean(checked))}
                    >
                      Incluir no detalhado
                    </DropdownMenuCheckboxItem>
                    {colaboradores.length > 0 && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuLabel className="text-xs">Por Funcionario</DropdownMenuLabel>
                        {colaboradores.map((c) => (
                          <DropdownMenuItem key={c.id} onClick={() => handleExportFuncionario(c.id)}>
                            {c.nome}
                          </DropdownMenuItem>
                        ))}
                      </>
                    )}
                    {outrosSetores.length > 0 && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuSub>
                          <DropdownMenuSubTrigger>Outro setor</DropdownMenuSubTrigger>
                          <DropdownMenuSubContent className="max-h-72 w-56 overflow-y-auto">
                            {outrosSetores.map((s) => (
                              <DropdownMenuItem key={s.id} onClick={() => handleAbrirOutroSetor(s.id)}>
                                {s.nome}
                              </DropdownMenuItem>
                            ))}
                          </DropdownMenuSubContent>
                        </DropdownMenuSub>
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-semibold">Resultado</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  Escala pronta para exportacao de ciclo para os colaboradores.
                </p>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className={violacoesCount > 0 ? 'border-amber-200 text-amber-700' : 'border-emerald-200 text-emerald-700'}>
                    {violacoesCount > 0
                      ? `${violacoesCount} aviso${violacoesCount > 1 ? 's' : ''}`
                      : 'Sem avisos relevantes'}
                  </Badge>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-semibold">Ciclo (previa de exportacao)</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="max-h-[70vh] overflow-auto rounded-md border bg-white">
                  <ExportarEscala
                    escala={escalaCompleta.escala}
                    alocacoes={escalaCompleta.alocacoes}
                    colaboradores={colaboradores}
                    setor={setor}
                    violacoes={escalaCompleta.violacoes}
                    tiposContrato={tiposContrato ?? []}
                    funcoes={funcoes ?? []}
                    horariosSemana={horariosSemana ?? []}
                    modo="ciclo"
                    modoRender="view"
                  />
                </div>
              </CardContent>
            </Card>

            <div className="space-y-4 pt-2">
              <div className="flex items-center justify-end">
                <EscalaViewToggle mode={escalaViewMode} onChange={setEscalaViewMode} />
              </div>

              <Tabs defaultValue="escala" className="space-y-4">
                <TabsList>
                  <TabsTrigger value="escala">Escala</TabsTrigger>
                  <TabsTrigger value="avisos" className="gap-1.5">
                    Avisos
                    {violacoesCount > 0 && (
                      <Badge variant="secondary" className="ml-1 size-5 justify-center rounded-full p-0 text-[10px]">
                        {violacoesCount}
                      </Badge>
                    )}
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="escala">
                  {escalaViewMode === 'grid' ? (
                    <EscalaGrid
                      colaboradores={colaboradores}
                      alocacoes={escalaCompleta.alocacoes}
                      dataInicio={escalaCompleta.escala.data_inicio}
                      dataFim={escalaCompleta.escala.data_fim}
                      demandas={demandas ?? undefined}
                      tiposContrato={tiposContrato ?? undefined}
                      funcoes={funcoes ?? undefined}
                      readOnly
                      regrasMap={regrasMap}
                    />
                  ) : (
                    <TimelineGrid
                      colaboradores={colaboradores}
                      alocacoes={escalaCompleta.alocacoes}
                      setor={setor}
                      dataSelecionada={escalaCompleta.escala.data_inicio}
                      dataInicio={escalaCompleta.escala.data_inicio}
                      dataFim={escalaCompleta.escala.data_fim}
                      demandas={demandas ?? undefined}
                      tiposContrato={tiposContrato ?? undefined}
                      horariosSemana={horariosSemana ?? undefined}
                      regrasMap={regrasMap}
                      readOnly
                    />
                  )}
                </TabsContent>

                <TabsContent value="avisos" className="space-y-4">
                  <ResumoTable
                    colaboradores={colaboradores}
                    alocacoes={escalaCompleta.alocacoes}
                    violacoes={escalaCompleta.violacoes}
                    tiposContrato={tiposContrato ?? []}
                    dataInicio={escalaCompleta.escala.data_inicio}
                    dataFim={escalaCompleta.escala.data_fim}
                  />
                  {escalaCompleta.violacoes.length > 0 ? (
                    <ViolacoesAgrupadas violacoes={escalaCompleta.violacoes} />
                  ) : (
                    <Card>
                      <CardContent className="pt-6">
                        <p className="text-sm text-muted-foreground">Sem avisos para esta escala.</p>
                      </CardContent>
                    </Card>
                  )}
                </TabsContent>
              </Tabs>
            </div>
          </>
        ) : (
          <EmptyState
            icon={CalendarDays}
            title="Nenhuma escala encontrada"
            description="Gere uma escala a partir do painel do setor"
            action={
              <Button variant="outline" asChild>
                <Link to={`/setores/${setorId}`}>Voltar ao Setor</Link>
              </Button>
            }
          />
        )}
      </div>
    </div>
  )
}
