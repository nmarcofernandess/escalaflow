import { useState, useEffect, useMemo } from 'react'
import { useParams, Link, useNavigate, useLocation } from 'react-router-dom'
import {
  CalendarDays,
  Loader2,
  Download,
  XCircle,
  AlertTriangle,
  ChevronRight,
  ChevronDown,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Switch } from '@/components/ui/switch'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { toast } from 'sonner'
import { PageHeader } from '@/componentes/PageHeader'
import { EscalaCicloResumo } from '@/componentes/EscalaCicloResumo'
import { ResumoFolgas } from '@/componentes/ResumoFolgas'
import { ExportarEscala } from '@/componentes/ExportarEscala'
import { EscalaTimelineDiaria } from '@/componentes/EscalaTimelineDiaria'
import { EscalaViewToggle, useEscalaViewMode } from '@/componentes/EscalaViewToggle'
import { TimelineGrid } from '@/componentes/TimelineGrid'
import { ExportModal, type EscalaExportContent } from '@/componentes/ExportModal'
import { StatusBadge } from '@/componentes/StatusBadge'
import { EmptyState } from '@/componentes/EmptyState'
import { formatarData } from '@/lib/formatadores'
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
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set())

  function toggleExpand(id: number) {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

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
      const hard = colabViolacoes.filter((v) => v.severidade === 'HARD')
      const soft = colabViolacoes.filter((v) => v.severidade !== 'HARD')
      return { colab, real, meta: metaTotal, delta, ok, contratoNome: tc?.nome ?? '-', hard, soft }
    })
  }, [colaboradores, alocacoes, violacoes, tiposContrato, dataInicio, dataFim])

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-6 text-xs" />
            <TableHead className="text-xs">Colaborador</TableHead>
            <TableHead className="text-xs text-right">Real</TableHead>
            <TableHead className="text-xs text-right">Meta</TableHead>
            <TableHead className="text-xs text-right">Delta</TableHead>
            <TableHead className="text-xs">Avisos</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map(({ colab, real, meta, delta, ok, contratoNome, hard, soft }) => {
            const hasAvisos = hard.length > 0 || soft.length > 0 || !ok
            const isExpanded = expandedIds.has(colab.id)
            return (
              <>
                <TableRow
                  key={colab.id}
                  className={cn(hasAvisos && 'cursor-pointer hover:bg-muted/50')}
                  onClick={hasAvisos ? () => toggleExpand(colab.id) : undefined}
                >
                  <TableCell className="w-6 py-2 px-2">
                    {hasAvisos && (
                      isExpanded
                        ? <ChevronDown className="size-3.5 text-muted-foreground" />
                        : <ChevronRight className="size-3.5 text-muted-foreground" />
                    )}
                  </TableCell>
                  <TableCell className="py-2">
                    <div>
                      <p className="text-xs font-medium">{colab.nome}</p>
                      <p className="text-xs text-muted-foreground">{contratoNome}</p>
                    </div>
                  </TableCell>
                  <TableCell className="text-xs text-right py-2">{formatarMinutos(real)}</TableCell>
                  <TableCell className="text-xs text-right py-2">{formatarMinutos(meta)}</TableCell>
                  <TableCell className={cn(
                    'text-xs text-right py-2 font-medium',
                    delta >= 0 ? 'text-success' : delta >= -TOLERANCIA_DEFAULT ? 'text-warning' : 'text-destructive',
                  )}>
                    {delta >= 0 ? '+' : ''}{formatarMinutos(Math.abs(delta))}
                    {delta < 0 && ' \u2193'}
                  </TableCell>
                  <TableCell className="py-2">
                    {!hasAvisos ? (
                      <span className="text-xs text-muted-foreground">{'\u2014'}</span>
                    ) : (
                      <div className="flex items-center gap-2">
                        {hard.length > 0 && (
                          <span className="flex items-center gap-0.5 text-xs font-medium text-destructive">
                            <XCircle className="size-3" />
                            {hard.length}
                          </span>
                        )}
                        {(soft.length > 0 || !ok) && (
                          <span className="flex items-center gap-0.5 text-xs font-medium text-warning">
                            <AlertTriangle className="size-3" />
                            {soft.length + (!ok ? 1 : 0)}
                          </span>
                        )}
                      </div>
                    )}
                  </TableCell>
                </TableRow>
                {isExpanded && (
                  <TableRow key={`${colab.id}-detail`} className="bg-muted/30 hover:bg-muted/30">
                    <TableCell colSpan={6} className="py-3 px-4">
                      <div className="space-y-2">
                        {hard.map((v, i) => (
                          <div key={`h-${i}`} className="flex items-start gap-2 text-xs">
                            <XCircle className="mt-0.5 size-3.5 shrink-0 text-destructive" />
                            <div>
                              <p className="font-medium text-destructive">
                                {v.mensagem || REGRAS_TEXTO[v.regra] || v.regra}
                              </p>
                              {v.data && (
                                <p className="text-muted-foreground">Dia: {formatarData(v.data)}</p>
                              )}
                            </div>
                          </div>
                        ))}
                        {soft.map((v, i) => (
                          <div key={`s-${i}`} className="flex items-start gap-2 text-xs">
                            <AlertTriangle className="mt-0.5 size-3 shrink-0 text-warning" />
                            <p className="text-muted-foreground">
                              {v.mensagem || REGRAS_TEXTO[v.regra] || v.regra}
                              {v.data && ` (${formatarData(v.data)})`}
                            </p>
                          </div>
                        ))}
                        {!ok && (
                          <div className="flex items-start gap-2 text-xs">
                            <AlertTriangle className="mt-0.5 size-3 shrink-0 text-warning" />
                            <p className="text-muted-foreground">Abaixo da meta semanal</p>
                          </div>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </>
            )
          })}
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
  const location = useLocation()

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

  const [timelineViewMode, setTimelineViewMode] = useEscalaViewMode()
  const [escalaCompleta, setEscalaCompleta] = useState<EscalaCompletaV3 | null>(null)
  const [loading, setLoading] = useState(true)
  const [exportOpen, setExportOpen] = useState(false)
  const [conteudoExport, setConteudoExport] = useState<EscalaExportContent>({
    ciclo: true,
    timeline: false,
    funcionarios: false,
    avisos: false,
  })
  const [conteudoView, setConteudoView] = useState<EscalaExportContent>({
    ciclo: true,
    timeline: true,
    funcionarios: false,
    avisos: false,
  })

  const escalaIdParam = useMemo(() => {
    const raw = new URLSearchParams(location.search).get('escalaId')
    if (!raw) return null
    const parsed = Number(raw)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null
  }, [location.search])

  // Load most recent escala (RASCUNHO primeiro, depois OFICIAL)
  useEffect(() => {
    void loadEscala()
  }, [setorId, escalaIdParam]) // eslint-disable-line react-hooks/exhaustive-deps

  async function loadEscala() {
    setLoading(true)
    try {
      if (escalaIdParam) {
        try {
          const detail = await escalasService.buscar(escalaIdParam)
          setEscalaCompleta(detail)
          return
        } catch {
          // Fallback para comportamento padrao quando query param estiver invalido
        }
      }
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
  const nenhumBlocoVisivel = !conteudoView.ciclo && !conteudoView.timeline && !conteudoView.funcionarios && !conteudoView.avisos
  const setoresComEscala = useMemo(() => new Set((resumoPorSetor ?? []).map((s) => s.setor_id)), [resumoPorSetor])
  const outrosSetores = useMemo(
    () => (setores ?? []).filter((s) => s.id !== setorId && setoresComEscala.has(s.id)),
    [setores, setorId, setoresComEscala],
  )
  const contratoMap = useMemo(
    () => new Map((tiposContrato ?? []).map((tc) => [tc.id, tc.nome])),
    [tiposContrato],
  )
  const domingosTrabalhadosPorColab = useMemo(() => {
    const map = new Map<number, number>()
    if (!escalaCompleta) return map
    for (const a of escalaCompleta.alocacoes) {
      if (a.status !== 'TRABALHO') continue
      if (new Date(`${a.data}T00:00:00`).getDay() !== 0) continue
      map.set(a.colaborador_id, (map.get(a.colaborador_id) ?? 0) + 1)
    }
    return map
  }, [escalaCompleta])

  function toggleConteudoView(key: keyof EscalaExportContent, checked: boolean) {
    setConteudoView((prev) => ({ ...prev, [key]: checked }))
  }

  // Export handlers
  function hasConteudoSetorial(conteudo: EscalaExportContent) {
    return conteudo.ciclo || conteudo.timeline || conteudo.avisos
  }

  function renderExportHTML(conteudo: EscalaExportContent) {
    if (!escalaCompleta || !setor || !colaboradores) return null
    if (!hasConteudoSetorial(conteudo)) return null
    const modo: 'ciclo' | 'detalhado' = conteudo.timeline ? 'detalhado' : 'ciclo'
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
        regrasPadrao={regrasPadrao ?? []}
        modo={modo}
        incluirAvisos={conteudo.avisos}
        incluirCiclo={conteudo.ciclo}
        incluirTimeline={conteudo.timeline}
        modoRender="download"
      />
    )
    return { html, setorNome: setor.nome }
  }

  async function handlePrintEscala(conteudo: EscalaExportContent) {
    if (!escalaCompleta || !setor || !colaboradores) return
    const payload = renderExportHTML(conteudo)
    if (!payload) {
      toast.error('Selecione Ciclo, Timeline ou Avisos para imprimir.')
      return
    }
    const printWindow = window.open('', '_blank')
    if (!printWindow) {
      toast.error('Bloqueio de popup detectado. Permita popups para imprimir.')
      return
    }
    const { renderToStaticMarkup } = await import('react-dom/server')
    const html = renderToStaticMarkup(payload.html)
    const fullHTML = buildStandaloneHtml(html, {
      title: `Escala - ${setor.nome}`,
    })
    printWindow.document.write(fullHTML)
    printWindow.document.close()
    printWindow.focus()
    setTimeout(() => printWindow.print(), 250)
  }

  async function handleExportHTMLEscala(conteudo: EscalaExportContent) {
    if (!escalaCompleta || !setor || !colaboradores) return
    const payload = renderExportHTML(conteudo)
    if (!payload) {
      toast.error('Selecione Ciclo, Timeline ou Avisos para exportar HTML.')
      return
    }
    const modo: 'ciclo' | 'detalhado' = conteudo.timeline ? 'detalhado' : 'ciclo'
    const { renderToStaticMarkup } = await import('react-dom/server')
    const html = renderToStaticMarkup(payload.html)
    const fullHTML = buildStandaloneHtml(html, {
      title: `Escala - ${setor.nome}`,
    })
    const slug = setor.nome.toLowerCase().replace(/\s+/g, '-')
    const prefix = modo === 'detalhado' ? 'escala-detalhada' : 'escala-ciclo'
    const okMsg = modo === 'detalhado' ? 'HTML detalhado salvo com sucesso' : 'HTML salvo com sucesso'
    try {
      const result = await exportarService.salvarHTML(fullHTML, `${prefix}-${slug}.html`)
      if (result) toast.success(okMsg)
    } catch {
      toast.error(modo === 'detalhado' ? 'Erro ao exportar HTML detalhado' : 'Erro ao exportar HTML')
    }
  }

  async function handleExportCSV(conteudo: EscalaExportContent) {
    if (!escalaCompleta || !setor || !colaboradores) return
    const blocos: string[] = []
    const incluirEscala = conteudo.ciclo || conteudo.timeline || conteudo.funcionarios
    if (incluirEscala) {
      blocos.push(gerarCSVAlocacoes([escalaCompleta], [setor], colaboradores))
      blocos.push(gerarCSVComparacaoDemanda([escalaCompleta], [setor]))
    }
    if (conteudo.avisos) {
      blocos.push(gerarCSVViolacoes([escalaCompleta], [setor]))
    }
    if (blocos.length === 0) {
      toast.error('Selecione ao menos um conteúdo para exportar CSV.')
      return
    }
    const combined = blocos.join('\n\n')
    const slug = setor.nome.toLowerCase().replace(/\s+/g, '-')
    try {
      const result = await exportarService.salvarCSV(combined, `escala-${slug}.csv`)
      if (result) toast.success('CSV salvo com sucesso')
    } catch {
      toast.error('Erro ao exportar CSV')
    }
  }

  function gerarHTMLFuncionarioById(colabId: number, incluirAvisos: boolean) {
    if (!escalaCompleta || !setor || !colaboradores || !tiposContrato) return null
    const colab = colaboradores.find((c) => c.id === colabId)
    if (!colab) return null
    const tc = tiposContrato.find((t) => t.id === colab.tipo_contrato_id)
    const r = regrasMap.get(colabId)
    const html = gerarHTMLFuncionario({
      nome: colab.nome,
      contrato: tc?.nome ?? '',
      horasSemanais: tc?.horas_semanais ?? colab.horas_semanais,
      setor: setor.nome,
      periodo: { inicio: escalaCompleta.escala.data_inicio, fim: escalaCompleta.escala.data_fim },
      alocacoes: escalaCompleta.alocacoes.filter((a) => a.colaborador_id === colabId),
      violacoes: incluirAvisos ? escalaCompleta.violacoes.filter((v) => v.colaborador_id === colabId) : [],
      regra: r ? { folga_fixa_dia_semana: r.folga_fixa_dia_semana ?? null, folga_variavel_dia_semana: r.folga_variavel_dia_semana ?? null } : undefined,
    })
    return { nome: colab.nome, html }
  }

  async function handleExportFuncionariosBatch(incluirAvisos: boolean) {
    if (!colaboradores || colaboradores.length === 0) return
    const arquivos = colaboradores
      .map((c) => {
        const payload = gerarHTMLFuncionarioById(c.id, incluirAvisos)
        if (!payload) return null
        return { nome: payload.nome.replace(/\s+/g, '_'), html: payload.html }
      })
      .filter((item): item is { nome: string; html: string } => item != null)

    if (arquivos.length === 0) {
      toast.error('Nao foi possivel montar exportacao por funcionario.')
      return
    }
    try {
      const result = await exportarService.batchHTML(arquivos)
      if (result) {
        toast.success(`${result.count} arquivo(s) de funcionario salvos em ${result.pasta}`)
      }
    } catch {
      toast.error('Erro ao exportar funcionarios em lote')
    }
  }

  async function handleExportFromModal() {
    const incluirSetorial = hasConteudoSetorial(conteudoExport)
    const incluirFuncionarios = conteudoExport.funcionarios

    if (!incluirSetorial && !incluirFuncionarios) {
      toast.error('Ative Ciclo, Timeline, Avisos ou Por funcionario para exportar HTML.')
      return
    }

    if (incluirSetorial) {
      await handleExportHTMLEscala(conteudoExport)
    }
    if (incluirFuncionarios) {
      await handleExportFuncionariosBatch(conteudoExport.avisos)
    }
    setExportOpen(false)
  }

  async function handlePrintFromModal() {
    if (hasConteudoSetorial(conteudoExport)) {
      await handlePrintEscala(conteudoExport)
      setExportOpen(false)
      return
    }
    if (conteudoExport.funcionarios) {
      toast.error('Impressao por funcionario em lote nao esta disponivel. Use Baixar HTML.')
      return
    }
    toast.error('Ative Ciclo, Timeline ou Avisos para imprimir.')
  }

  async function handleExportCSVFromModal() {
    await handleExportCSV(conteudoExport)
    setExportOpen(false)
  }

  function renderExportPreview() {
    if (!escalaCompleta || !setor || !colaboradores) return null
    const incluirSetorial = hasConteudoSetorial(conteudoExport)
    return (
      <div className="space-y-3">
        {incluirSetorial ? (
          <ExportarEscala
            escala={escalaCompleta.escala}
            alocacoes={escalaCompleta.alocacoes}
            colaboradores={colaboradores}
            setor={setor}
            violacoes={escalaCompleta.violacoes}
            tiposContrato={tiposContrato ?? []}
            funcoes={funcoes ?? []}
            horariosSemana={horariosSemana ?? []}
            regrasPadrao={regrasPadrao ?? []}
            modo={conteudoExport.timeline ? 'detalhado' : 'ciclo'}
            incluirAvisos={conteudoExport.avisos}
            incluirCiclo={conteudoExport.ciclo}
            incluirTimeline={conteudoExport.timeline}
          />
        ) : (
          <div className="rounded-md border bg-background p-4">
            <p className="text-sm font-medium">Preview setorial desativada</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Ative <strong>Ciclo</strong>, <strong>Timeline</strong> ou <strong>Avisos</strong> para visualizar aqui.
            </p>
          </div>
        )}

        {conteudoExport.funcionarios && (
          <div className="rounded-md border bg-background p-4">
            <p className="text-sm font-medium">Por funcionario ativo</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Serao gerados arquivos para todos os {colaboradores.length} funcionario(s) do setor.
            </p>
          </div>
        )}
      </div>
    )
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
                <Button
                  variant="outline"
                  className="gap-1.5"
                  onClick={() => {
                    setConteudoExport(conteudoView)
                    setExportOpen(true)
                  }}
                >
                  <Download className="size-3.5" />
                  Exportar
                </Button>

                {outrosSetores.length > 0 && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline">Outro setor</Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-56">
                      {outrosSetores.map((s) => (
                        <DropdownMenuItem key={s.id} onClick={() => handleAbrirOutroSetor(s.id)}>
                          {s.nome}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            </div>

            <Tabs defaultValue="escala" className="space-y-4">
              <TabsList>
                <TabsTrigger value="escala">Escala</TabsTrigger>
                <TabsTrigger value="apontamentos" className="gap-1.5">
                  Apontamentos
                  {violacoesCount > 0 && (
                    <Badge variant="secondary" className="ml-1 size-5 justify-center rounded-full p-0 text-xs">
                      {violacoesCount}
                    </Badge>
                  )}
                </TabsTrigger>
              </TabsList>

              <TabsContent value="apontamentos" className="space-y-4">
                {(() => {
                  const ind = escalaCompleta.indicadores
                  const coberturaEfetiva = ind.cobertura_efetiva_percent ?? ind.cobertura_percent
                  const temTolerancia = coberturaEfetiva > ind.cobertura_percent

                  const coberturaColor = ind.cobertura_percent >= 95
                    ? 'text-success'
                    : ind.cobertura_percent >= 80
                      ? 'text-warning'
                      : 'text-destructive'

                  const qualidadeColor = ind.pontuacao >= 85
                    ? 'text-success'
                    : ind.pontuacao >= 70
                      ? 'text-warning'
                      : 'text-destructive'

                  return (
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                      <Card className="p-4">
                        <p className={cn('text-2xl font-bold tabular-nums', coberturaColor)}>
                          {Math.round(ind.cobertura_percent)}%
                        </p>
                        <p className="mt-1 text-xs font-medium text-muted-foreground">Cobertura</p>
                        {temTolerancia && (
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {Math.round(coberturaEfetiva)}% c/ tolerancia
                          </p>
                        )}
                      </Card>
                      <Card className="p-4">
                        <p className={cn('text-2xl font-bold tabular-nums', qualidadeColor)}>
                          {ind.pontuacao}
                        </p>
                        <p className="mt-1 text-xs font-medium text-muted-foreground">Qualidade</p>
                      </Card>
                      <Card className="p-4">
                        <p className={cn(
                          'text-2xl font-bold tabular-nums',
                          ind.violacoes_hard === 0 ? 'text-success' : 'text-destructive',
                        )}>
                          {ind.violacoes_hard}
                        </p>
                        <p className="mt-1 text-xs font-medium text-muted-foreground">
                          {ind.violacoes_hard === 1 ? 'Problema' : 'Problemas'}
                        </p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {ind.violacoes_hard === 0 ? 'Pode oficializar' : 'Impede oficializar'}
                        </p>
                      </Card>
                      <Card className="p-4">
                        <p className={cn(
                          'text-2xl font-bold tabular-nums',
                          ind.violacoes_soft === 0 ? 'text-success' : 'text-warning',
                        )}>
                          {ind.violacoes_soft}
                        </p>
                        <p className="mt-1 text-xs font-medium text-muted-foreground">Avisos</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          Preferencias e metas
                        </p>
                      </Card>
                    </div>
                  )
                })()}
                <div>
                  <h3 className="text-sm font-semibold text-foreground mb-2">Por colaborador</h3>
                  <ResumoTable
                    colaboradores={colaboradores}
                    alocacoes={escalaCompleta.alocacoes}
                    violacoes={escalaCompleta.violacoes}
                    tiposContrato={tiposContrato ?? []}
                    dataInicio={escalaCompleta.escala.data_inicio}
                    dataFim={escalaCompleta.escala.data_fim}
                  />
                </div>
              </TabsContent>

              <TabsContent value="escala" className="space-y-4">
                <Card>
                  <CardHeader className="pb-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <CardTitle className="text-sm font-semibold">Visualizacao</CardTitle>
                      <p className="text-xs text-muted-foreground">Escolha o que aparece em tela (igual ao export).</p>
                    </div>
                  </CardHeader>
                  <CardContent className="grid gap-3 sm:grid-cols-3">
                    <div className="flex items-start justify-between rounded-md border p-3">
                      <div>
                        <p className="text-sm font-medium">Ciclo</p>
                        <p className="text-xs text-muted-foreground">Matriz por posto e semana.</p>
                      </div>
                      <Switch checked={conteudoView.ciclo} onCheckedChange={(checked) => toggleConteudoView('ciclo', checked)} />
                    </div>
                    <div className="flex items-start justify-between rounded-md border p-3">
                      <div>
                        <p className="text-sm font-medium">Timeline</p>
                        <p className="text-xs text-muted-foreground">Escala por datas e faixa horaria.</p>
                      </div>
                      <Switch checked={conteudoView.timeline} onCheckedChange={(checked) => toggleConteudoView('timeline', checked)} />
                    </div>
                    <div className="flex items-start justify-between rounded-md border p-3">
                      <div>
                        <p className="text-sm font-medium">Por funcionario</p>
                        <p className="text-xs text-muted-foreground">Resumo por pessoa do setor.</p>
                      </div>
                      <Switch checked={conteudoView.funcionarios} onCheckedChange={(checked) => toggleConteudoView('funcionarios', checked)} />
                    </div>
                  </CardContent>
                </Card>

                {nenhumBlocoVisivel && (
                  <div className="rounded-md border border-dashed p-6 text-center">
                    <p className="text-sm font-medium">Nenhum bloco visivel</p>
                    <p className="mt-1 text-xs text-muted-foreground">Ative ao menos um toggle para montar a visualizacao completa.</p>
                  </div>
                )}

                {conteudoView.ciclo && (
                  <Card>
                    <CardHeader className="pb-2">
                      <div className="flex items-center justify-between gap-2">
                        <CardTitle className="text-base font-semibold">Ciclo Rotativo</CardTitle>
                        <Badge variant="outline" className={violacoesCount > 0 ? 'border-warning/20 text-warning' : 'border-success/20 text-success'}>
                          {violacoesCount > 0 ? `${violacoesCount} aviso(s)` : 'Sem avisos relevantes'}
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <EscalaCicloResumo
                        escala={escalaCompleta.escala}
                        alocacoes={escalaCompleta.alocacoes}
                        colaboradores={colaboradores}
                        funcoes={funcoes ?? []}
                        regrasPadrao={regrasPadrao ?? []}
                      />
                    </CardContent>
                  </Card>
                )}

                {conteudoView.timeline && (
                  <Card>
                    <CardHeader className="pb-2">
                      <div className="flex items-center justify-between gap-2">
                        <CardTitle className="text-base font-semibold">Timeline Diaria</CardTitle>
                        <EscalaViewToggle mode={timelineViewMode} onChange={setTimelineViewMode} />
                      </div>
                    </CardHeader>
                    <CardContent>
                      {timelineViewMode === 'grid' ? (
                        <EscalaTimelineDiaria
                          escala={escalaCompleta.escala}
                          alocacoes={escalaCompleta.alocacoes}
                          colaboradores={colaboradores}
                          setor={setor}
                          tiposContrato={tiposContrato ?? []}
                          funcoes={funcoes ?? []}
                          horariosSemana={horariosSemana ?? []}
                        />
                      ) : (
                        <TimelineGrid
                          colaboradores={colaboradores}
                          alocacoes={escalaCompleta.alocacoes}
                          setor={setor}
                          dataSelecionada={escalaCompleta.escala.data_inicio}
                          dataInicio={escalaCompleta.escala.data_inicio}
                          dataFim={escalaCompleta.escala.data_fim}
                          demandas={demandas ?? []}
                          tiposContrato={tiposContrato ?? []}
                          horariosSemana={horariosSemana ?? []}
                          regrasMap={regrasMap}
                          readOnly
                        />
                      )}
                    </CardContent>
                  </Card>
                )}

                {conteudoView.funcionarios && (
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base font-semibold">Por Funcionario</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <ResumoFolgas
                        colaboradores={colaboradores}
                        alocacoes={escalaCompleta.alocacoes}
                        regrasMap={regrasMap}
                      />
                      <div className="rounded-md border">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Colaborador</TableHead>
                              <TableHead>Contrato</TableHead>
                              <TableHead className="text-center">Fixo</TableHead>
                              <TableHead className="text-center">Variavel</TableHead>
                              <TableHead className="text-center">Domingos (trab.)</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {colaboradores.map((colab) => {
                              const regra = regrasMap.get(colab.id)
                              return (
                                <TableRow key={colab.id}>
                                  <TableCell className="font-medium">{colab.nome}</TableCell>
                                  <TableCell className="text-muted-foreground">{contratoMap.get(colab.tipo_contrato_id) ?? '-'}</TableCell>
                                  <TableCell className="text-center">{regra?.folga_fixa_dia_semana ?? '-'}</TableCell>
                                  <TableCell className="text-center">{regra?.folga_variavel_dia_semana ?? '-'}</TableCell>
                                  <TableCell className="text-center">{domingosTrabalhadosPorColab.get(colab.id) ?? 0}</TableCell>
                                </TableRow>
                              )
                            })}
                          </TableBody>
                        </Table>
                      </div>
                    </CardContent>
                  </Card>
                )}

              </TabsContent>

            </Tabs>
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

      {escalaCompleta && (
        <ExportModal
          open={exportOpen}
          onOpenChange={setExportOpen}
          context="escala"
          titulo={`Exportar Escala — ${setor.nome}`}
          formato="conteudo"
          onFormatoChange={() => {}}
          conteudoEscala={conteudoExport}
          onConteudoEscalaChange={setConteudoExport}
          onExportHTML={handleExportFromModal}
          onPrint={handlePrintFromModal}
          onCSV={handleExportCSVFromModal}
        >
          {renderExportPreview()}
        </ExportModal>
      )}
    </div>
  )
}
