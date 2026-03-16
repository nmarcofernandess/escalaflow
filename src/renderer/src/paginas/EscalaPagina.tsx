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
  Target,
  Star,
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
import { CicloGrid } from '@/componentes/CicloGrid'
import { escalaParaCicloGrid } from '@/lib/ciclo-grid-converters'
import { CoberturaChart } from '@/componentes/CoberturaChart'
import { ResumoFolgas } from '@/componentes/ResumoFolgas'
import { ExportarEscala } from '@/componentes/ExportarEscala'
import { EscalaTimelineDiaria } from '@/componentes/EscalaTimelineDiaria'
import { EscalaViewToggle, useEscalaViewMode } from '@/componentes/EscalaViewToggle'
import { TimelineGrid } from '@/componentes/TimelineGrid'
import { ExportModal, type EscalaExportData, type ExportToggles } from '@/componentes/ExportModal'
import { StatusBadge } from '@/componentes/StatusBadge'
import { EmptyState } from '@/componentes/EmptyState'
import { formatarData, formatarDataHora } from '@/lib/formatadores'
import { buildStandaloneHtml } from '@/lib/export-standalone-html'
import { gerarCSVAlocacoes, gerarCSVViolacoes, gerarCSVComparacaoDemanda } from '@/lib/gerarCSV'
import { resolveEscalaEquipe } from '@/lib/escala-team'
import { useAppDataStore } from '@/store/appDataStore'
import { escalasService } from '@/servicos/escalas'
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
import { Alert, AlertDescription } from '@/components/ui/alert'
import { formatarMinutos, REGRAS_TEXTO } from '@/lib/formatadores'

/** Margem por arredondamento de grid (15min/slot × semanas) */
const TOLERANCIA_POR_SEMANA = 15

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

    const toleranciaTotal = Math.ceil(semanas) * TOLERANCIA_POR_SEMANA

    return colaboradores.map((colab) => {
      const tc = tiposContrato.find((t) => t.id === colab.tipo_contrato_id)
      const real = minutosReais.get(colab.id) ?? 0
      const metaTotal = tc ? Math.round(tc.horas_semanais * 60 * semanas) : 0
      const delta = real - metaTotal
      const ok = delta >= -toleranciaTotal
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
                    delta >= 0 ? 'text-success' : ok ? 'text-warning' : 'text-destructive',
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

  // Data from store (reactive)
  const setSetorAtivo = useAppDataStore((s) => s.setSetorAtivo)
  const carregandoSetor = useAppDataStore((s) => s.carregandoSetor)
  const setor = useAppDataStore((s) => s.setor)
  const setores = useAppDataStore((s) => s.setores)
  const colaboradores = useAppDataStore((s) => s.colaboradores)
  const demandas = useAppDataStore((s) => s.demandas)
  const tiposContrato = useAppDataStore((s) => s.tiposContrato)
  const funcoes = useAppDataStore((s) => s.postos)
  const horariosSemana = useAppDataStore((s) => s.horarioSemana)
  const regrasPadrao = useAppDataStore((s) => s.regrasPadrao)
  const escalas = useAppDataStore((s) => s.escalas)

  // Notify store which sector is active (loads data if changed)
  useEffect(() => {
    setSetorAtivo(setorId)
  }, [setorId, setSetorAtivo])

  // resumoPorSetor is not in the store — load locally for "Outro setor" dropdown
  const [resumoPorSetor, setResumoPorSetor] = useState<{ setor_id: number; data_inicio: string; data_fim: string; status: string }[] | null>(null)
  useEffect(() => {
    escalasService.resumoPorSetor().then(setResumoPorSetor).catch(() => {})
  }, [])

  const regrasMap = useMemo(() => {
    const map = new Map<number, RegraHorarioColaborador>()
    for (const r of regrasPadrao) map.set(r.colaborador_id, r)
    return map
  }, [regrasPadrao])

  const [timelineViewMode, setTimelineViewMode] = useEscalaViewMode()
  const [escalaCompleta, setEscalaCompleta] = useState<EscalaCompletaV3 | null>(null)
  const [loading, setLoading] = useState(true)
  const [exportOpen, setExportOpen] = useState(false)

  // View toggles — control which cards are visible on the page (independent of export modal)
  const [conteudoView, setConteudoView] = useState({ ciclo: true, timeline: true, funcionarios: false })

  const escalaIdParam = useMemo(() => {
    const raw = new URLSearchParams(location.search).get('escalaId')
    if (!raw) return null
    const parsed = Number(raw)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null
  }, [location.search])

  const origemParam = useMemo((): 'simulacao' | 'oficial' | 'historico' | undefined => {
    const raw = new URLSearchParams(location.search).get('origem')
    if (raw === 'simulacao' || raw === 'oficial' || raw === 'historico') return raw
    return undefined
  }, [location.search])

  // Load most recent escala (a mais recente por criada_em, independente de status)
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
      // Buscar todas e pegar a mais recente por criada_em
      const todas = await escalasService.listarPorSetor(setorId)
      if (todas.length > 0) {
        const maisRecente = [...todas].sort((a, b) => b.criada_em.localeCompare(a.criada_em))[0]
        const detail = await escalasService.buscar(maisRecente.id)
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
  const nenhumBlocoVisivel = !conteudoView.ciclo && !conteudoView.timeline && !conteudoView.funcionarios

  function toggleConteudoView(key: keyof typeof conteudoView, checked: boolean) {
    setConteudoView((prev) => ({ ...prev, [key]: checked }))
  }
  const escalasOrdenadas = useMemo(
    () => [...escalas].sort((a, b) => b.criada_em.localeCompare(a.criada_em)),
    [escalas],
  )
  const escalaOficialAtual = escalasOrdenadas.find((e) => e.status === 'OFICIAL') ?? null
  const escalaRascunho = escalasOrdenadas.find((e) => e.status === 'RASCUNHO') ?? null
  const escalasHistorico = useMemo(() => {
    const oficialId = escalaOficialAtual?.id ?? null
    return escalasOrdenadas.filter((e) => e.status !== 'RASCUNHO' && e.id !== oficialId)
  }, [escalaOficialAtual?.id, escalasOrdenadas])

  const escalaSelecionadaValor = useMemo(() => {
    if (!escalaCompleta) return null
    const id = escalaCompleta.escala.id
    const status = escalaCompleta.escala.status
    if (status === 'RASCUNHO') return 'simulacao'
    if (status === 'OFICIAL') return 'oficial'
    return `historico:${id}`
  }, [escalaCompleta])

  type EscalaTab = 'simulacao' | 'oficial' | 'historico'
  const escalaTab: EscalaTab =
    escalaSelecionadaValor?.startsWith('historico:') ? 'historico' :
    (escalaSelecionadaValor as EscalaTab) ?? 'simulacao'

  const setoresComEscala = useMemo(() => new Set((resumoPorSetor ?? []).map((s) => s.setor_id)), [resumoPorSetor])
  const outrosSetores = useMemo(
    () => setores.filter((s) => s.id !== setorId && setoresComEscala.has(s.id)),
    [setores, setorId, setoresComEscala],
  )
  const contratoMap = useMemo(
    () => new Map(tiposContrato.map((tc) => [tc.id, tc.nome])),
    [tiposContrato],
  )
  const equipeEscala = useMemo(
    () => resolveEscalaEquipe(escalaCompleta, colaboradores, funcoes),
    [colaboradores, escalaCompleta, funcoes],
  )

  const cicloGridData = useMemo(() => {
    if (!escalaCompleta) return null
    return escalaParaCicloGrid(
      escalaCompleta.escala,
      escalaCompleta.alocacoes,
      equipeEscala.colaboradores,
      equipeEscala.funcoes,
      regrasPadrao,
      demandas,
    )
  }, [escalaCompleta, equipeEscala, regrasPadrao, demandas])

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

  // ── Export data for the new ExportModal mode='setor' ──────────────────
  const escalaExportData = useMemo((): EscalaExportData | undefined => {
    if (!escalaCompleta || !setor) return undefined
    return {
      escala: escalaCompleta.escala,
      alocacoes: escalaCompleta.alocacoes,
      colaboradores: equipeEscala.colaboradores,
      setor,
      violacoes: escalaCompleta.violacoes,
      avisos: [],
      tiposContrato,
      funcoes: equipeEscala.funcoes,
      horariosSemana,
      regrasPadrao,
    }
  }, [escalaCompleta, setor, equipeEscala, tiposContrato, horariosSemana, regrasPadrao])

  // ── Export handlers (called by ExportModal with current toggle state) ──
  function renderExportJSX(toggles: ExportToggles, tlMode: 'barras' | 'grid') {
    if (!escalaCompleta || !setor) return null
    const hasContent = toggles.ciclo || toggles.semanal || toggles.timeline || toggles.avisos
    if (!hasContent) return null
    return (
      <ExportarEscala
        escala={escalaCompleta.escala}
        alocacoes={escalaCompleta.alocacoes}
        colaboradores={equipeEscala.colaboradores}
        setor={setor}
        violacoes={escalaCompleta.violacoes}
        tiposContrato={tiposContrato}
        funcoes={equipeEscala.funcoes}
        horariosSemana={horariosSemana}
        regrasPadrao={regrasPadrao}
        mode="setor"
        mostrarCiclo={toggles.ciclo}
        mostrarSemanal={toggles.semanal}
        mostrarTimeline={toggles.timeline}
        timelineMode={tlMode}
        mostrarAvisos={toggles.avisos}
      />
    )
  }

  async function handleExportHTML(toggles?: ExportToggles, tlMode?: 'barras' | 'grid') {
    if (!toggles || !escalaCompleta || !setor) return
    const jsx = renderExportJSX(toggles, tlMode ?? 'barras')
    if (!jsx) {
      toast.error('Selecione ao menos um conteudo para exportar HTML.')
      return
    }
    const { renderToStaticMarkup } = await import('react-dom/server')
    const html = renderToStaticMarkup(jsx)
    const fullHTML = buildStandaloneHtml(html, { title: `Escala - ${setor.nome}`, forceLight: true })
    const slug = setor.nome.toLowerCase().replace(/\s+/g, '-')
    const prefix = toggles.timeline ? 'escala-detalhada' : 'escala-ciclo'
    try {
      const result = await exportarService.salvarHTML(fullHTML, `${prefix}-${slug}.html`)
      if (result) toast.success('HTML salvo com sucesso')
    } catch {
      toast.error('Erro ao exportar HTML')
    }
    setExportOpen(false)
  }

  async function handlePrint(toggles?: ExportToggles, tlMode?: 'barras' | 'grid') {
    if (!toggles || !escalaCompleta || !setor) return
    const jsx = renderExportJSX(toggles, tlMode ?? 'barras')
    if (!jsx) {
      toast.error('Selecione ao menos um conteudo para imprimir.')
      return
    }
    const { renderToStaticMarkup } = await import('react-dom/server')
    const html = renderToStaticMarkup(jsx)
    const fullHTML = buildStandaloneHtml(html, { title: `Escala - ${setor.nome}`, forceLight: true })
    const iframe = document.createElement('iframe')
    iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;'
    document.body.appendChild(iframe)
    const iframeDoc = iframe.contentDocument ?? iframe.contentWindow?.document
    if (!iframeDoc) {
      toast.error('Erro ao preparar impressao.')
      document.body.removeChild(iframe)
      return
    }
    iframeDoc.open()
    iframeDoc.write(fullHTML)
    iframeDoc.close()
    setTimeout(() => {
      iframe.contentWindow?.print()
      setTimeout(() => document.body.removeChild(iframe), 1000)
    }, 250)
    setExportOpen(false)
  }

  async function handleCSV(toggles?: ExportToggles) {
    if (!toggles || !escalaCompleta || !setor) return
    const blocos: string[] = []
    if (toggles.ciclo || toggles.semanal || toggles.timeline) {
      blocos.push(gerarCSVAlocacoes([escalaCompleta], [setor], equipeEscala.colaboradores))
      blocos.push(gerarCSVComparacaoDemanda([escalaCompleta], [setor]))
    }
    if (toggles.avisos) {
      blocos.push(gerarCSVViolacoes([escalaCompleta], [setor]))
    }
    if (blocos.length === 0) {
      toast.error('Selecione ao menos um conteudo para exportar CSV.')
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
    setExportOpen(false)
  }

  function handleAbrirOutroSetor(setorDestinoId: number) {
    navigate(`/setores/${setorDestinoId}/escala`)
  }

  function handleTrocarEscala(valor: string) {
    if (valor === 'simulacao' && escalaRascunho) {
      navigate(`/setores/${setorId}/escala?escalaId=${escalaRascunho.id}&origem=simulacao`)
      return
    }
    if (valor === 'oficial' && escalaOficialAtual) {
      navigate(`/setores/${setorId}/escala?escalaId=${escalaOficialAtual.id}&origem=oficial`)
      return
    }
    const match = valor.match(/^historico:(\d+)$/)
    if (match) {
      navigate(`/setores/${setorId}/escala?escalaId=${match[1]}&origem=historico`)
    }
  }

  // Loading / no data states
  if (carregandoSetor || !setor) {
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
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex flex-wrap items-center gap-3">
                <div className="inline-flex rounded-lg border bg-muted p-0.5">
                  <button
                    type="button"
                    className={cn(
                      'rounded-md px-3 py-1 text-xs font-medium transition-colors',
                      escalaTab === 'simulacao'
                        ? 'bg-background text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground',
                      !escalaRascunho && 'pointer-events-none opacity-40',
                    )}
                    onClick={() => handleTrocarEscala('simulacao')}
                    disabled={!escalaRascunho}
                  >
                    Simulacao
                  </button>
                  <button
                    type="button"
                    className={cn(
                      'rounded-md px-3 py-1 text-xs font-medium transition-colors',
                      escalaTab === 'oficial'
                        ? 'bg-background text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground',
                      !escalaOficialAtual && 'pointer-events-none opacity-40',
                    )}
                    onClick={() => handleTrocarEscala('oficial')}
                    disabled={!escalaOficialAtual}
                  >
                    Oficial
                  </button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        className={cn(
                          'inline-flex items-center gap-1 rounded-md px-3 py-1 text-xs font-medium transition-colors',
                          escalaTab === 'historico'
                            ? 'bg-background text-foreground shadow-sm'
                            : 'text-muted-foreground hover:text-foreground',
                          escalasHistorico.length === 0 && 'pointer-events-none opacity-40',
                        )}
                        disabled={escalasHistorico.length === 0}
                      >
                        Historico
                        <ChevronDown className="size-3" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                      {escalasHistorico.map((escala) => (
                        <DropdownMenuItem
                          key={escala.id}
                          onClick={() => handleTrocarEscala(`historico:${escala.id}`)}
                        >
                          {formatarData(escala.data_inicio)} — {formatarData(escala.data_fim)}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge status={escalaCompleta.escala.status as 'OFICIAL' | 'RASCUNHO'} />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  className="gap-1.5"
                  onClick={() => setExportOpen(true)}
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

            {escalaCompleta.escala.criada_em && (
              <p className="text-sm text-muted-foreground">Gerado em {formatarDataHora(escalaCompleta.escala.criada_em)}</p>
            )}

            {origemParam === 'historico' && (
              <Alert className="border-muted-foreground/30 bg-muted/30">
                <AlertDescription>
                  Voce esta vendo uma escala historica (snapshot). Alterar cadastros de pessoas ou postos nao muda este historico nem afeta escalas atuais.
                </AlertDescription>
              </Alert>
            )}

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

                  const hardColor = ind.violacoes_hard === 0 ? 'text-success' : 'text-destructive'
                  const hardBg = ind.violacoes_hard === 0 ? 'bg-success/10' : 'bg-destructive/10'
                  const softColor = ind.violacoes_soft === 0 ? 'text-success' : 'text-warning'
                  const softBg = ind.violacoes_soft === 0 ? 'bg-success/10' : 'bg-warning/10'
                  const cobBg = ind.cobertura_percent >= 95 ? 'bg-success/10' : ind.cobertura_percent >= 80 ? 'bg-warning/10' : 'bg-destructive/10'
                  const qualBg = ind.pontuacao >= 85 ? 'bg-success/10' : ind.pontuacao >= 70 ? 'bg-warning/10' : 'bg-destructive/10'

                  return (
                    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                      <Card>
                        <CardContent className="flex items-center gap-4 p-4">
                          <div className={cn('flex size-10 items-center justify-center rounded-lg', cobBg)}>
                            <Target className={cn('size-5', coberturaColor)} />
                          </div>
                          <div>
                            <p className={cn('text-2xl font-bold tabular-nums', coberturaColor)}>
                              {Math.round(ind.cobertura_percent)}%
                            </p>
                            <p className="text-xs text-muted-foreground">Cobertura</p>
                            {temTolerancia && (
                              <p className="text-xs text-muted-foreground">
                                {Math.round(coberturaEfetiva)}% c/ tolerancia
                              </p>
                            )}
                          </div>
                        </CardContent>
                      </Card>
                      <Card>
                        <CardContent className="flex items-center gap-4 p-4">
                          <div className={cn('flex size-10 items-center justify-center rounded-lg', qualBg)}>
                            <Star className={cn('size-5', qualidadeColor)} />
                          </div>
                          <div>
                            <p className={cn('text-2xl font-bold tabular-nums', qualidadeColor)}>
                              {ind.pontuacao}
                            </p>
                            <p className="text-xs text-muted-foreground">Qualidade</p>
                          </div>
                        </CardContent>
                      </Card>
                      <Card>
                        <CardContent className="flex items-center gap-4 p-4">
                          <div className={cn('flex size-10 items-center justify-center rounded-lg', hardBg)}>
                            <XCircle className={cn('size-5', hardColor)} />
                          </div>
                          <div>
                            <p className={cn('text-2xl font-bold tabular-nums', hardColor)}>
                              {ind.violacoes_hard}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {ind.violacoes_hard === 1 ? 'Problema' : 'Problemas'}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {ind.violacoes_hard === 0 ? 'Pode oficializar' : 'Impede oficializar'}
                            </p>
                          </div>
                        </CardContent>
                      </Card>
                      <Card>
                        <CardContent className="flex items-center gap-4 p-4">
                          <div className={cn('flex size-10 items-center justify-center rounded-lg', softBg)}>
                            <AlertTriangle className={cn('size-5', softColor)} />
                          </div>
                          <div>
                            <p className={cn('text-2xl font-bold tabular-nums', softColor)}>
                              {ind.violacoes_soft}
                            </p>
                            <p className="text-xs text-muted-foreground">Avisos</p>
                            <p className="text-xs text-muted-foreground">Preferencias e metas</p>
                          </div>
                        </CardContent>
                      </Card>
                    </div>
                  )
                })()}
                <div>
                  <h3 className="text-sm font-semibold text-foreground mb-2">Por colaborador</h3>
                  <ResumoTable
                    colaboradores={equipeEscala.colaboradores}
                    alocacoes={escalaCompleta.alocacoes}
                    violacoes={escalaCompleta.violacoes}
                    tiposContrato={tiposContrato}
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
                        <div className="flex items-center gap-2">
                          <CardTitle className="text-base font-semibold">Ciclo Rotativo</CardTitle>
                          <Badge variant="outline" className={violacoesCount > 0 ? 'border-warning/20 text-warning' : 'border-success/20 text-success'}>
                            {violacoesCount > 0 ? `${violacoesCount} aviso(s)` : 'Sem avisos relevantes'}
                          </Badge>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent>
                      {cicloGridData && <CicloGrid data={cicloGridData} mode="view" />}
                    </CardContent>
                  </Card>
                )}

                {escalaCompleta.comparacao_demanda.length > 0 && (
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base font-semibold">Cobertura de Demanda</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <CoberturaChart
                        comparacao={escalaCompleta.comparacao_demanda}
                        indicadores={escalaCompleta.indicadores}
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
                          colaboradores={equipeEscala.colaboradores}
                          setor={setor}
                          tiposContrato={tiposContrato}
                          funcoes={equipeEscala.funcoes}
                          horariosSemana={horariosSemana}
                        />
                      ) : (
                        <TimelineGrid
                          colaboradores={equipeEscala.colaboradores}
                          alocacoes={escalaCompleta.alocacoes}
                          setor={setor}
                          dataSelecionada={escalaCompleta.escala.data_inicio}
                          dataInicio={escalaCompleta.escala.data_inicio}
                          dataFim={escalaCompleta.escala.data_fim}
                          demandas={demandas}
                          tiposContrato={tiposContrato}
                          horariosSemana={horariosSemana}
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
                        colaboradores={equipeEscala.colaboradores}
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
                            {equipeEscala.colaboradores.map((colab) => {
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

      {escalaCompleta && escalaExportData && (
        <ExportModal
          open={exportOpen}
          onOpenChange={setExportOpen}
          mode="setor"
          escalaData={escalaExportData}
          onExportHTML={handleExportHTML}
          onPrint={handlePrint}
          onCSV={handleCSV}
        />
      )}
    </div>
  )
}
