import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronDown, ChevronRight, Download, ExternalLink, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/componentes/PageHeader'
import { EscalaCicloResumo } from '@/componentes/EscalaCicloResumo'
import { CoberturaChart } from '@/componentes/CoberturaChart'
import { ExportarEscala } from '@/componentes/ExportarEscala'
import { ExportModal, type EscalaExportContent } from '@/componentes/ExportModal'
import { StatusBadge } from '@/componentes/StatusBadge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatarData } from '@/lib/formatadores'
import { useAppVersion } from '@/hooks/useAppVersion'
import { buildStandaloneHtml } from '@/lib/export-standalone-html'
import { resolveEscalaEquipe } from '@/lib/escala-team'
import { gerarHTMLFuncionario } from '@/lib/gerarHTMLFuncionario'
import { gerarCSVAlocacoes, gerarCSVComparacaoDemanda, gerarCSVViolacoes } from '@/lib/gerarCSV'
import { colaboradoresService } from '@/servicos/colaboradores'
import { escalasService } from '@/servicos/escalas'
import { exportarService } from '@/servicos/exportar'
import { funcoesService } from '@/servicos/funcoes'
import { setoresService } from '@/servicos/setores'
import { tiposContratoService } from '@/servicos/tipos-contrato'
import type {
  Colaborador,
  Escala,
  EscalaCompletaV3,
  Funcao,
  RegraHorarioColaborador,
  Setor,
  SetorHorarioSemana,
  TipoContrato,
} from '@shared/index'

interface EscalaOperacionalItem {
  setor: Setor
  escalas: Escala[]
  selectedEscalaId: number | null
}

interface ExportTarget {
  setorId: number
  escalaId: number
}

function prioridadeStatus(status: string): number {
  if (status === 'OFICIAL') return 0
  if (status === 'RASCUNHO') return 1
  return 2
}

function ordenarEscalas(escalas: Escala[]): Escala[] {
  return [...escalas].sort((a, b) => {
    const p = prioridadeStatus(a.status) - prioridadeStatus(b.status)
    if (p !== 0) return p
    const aTs = Date.parse(`${a.criada_em}`)
    const bTs = Date.parse(`${b.criada_em}`)
    if (Number.isFinite(aTs) && Number.isFinite(bTs) && aTs !== bTs) return bTs - aTs
    return b.id - a.id
  })
}

function escolherEscalaPadrao(escalas: Escala[]): number | null {
  const oficial = escalas.find((e) => e.status === 'OFICIAL')
  if (oficial) return oficial.id
  const rascunho = escalas.find((e) => e.status === 'RASCUNHO')
  if (rascunho) return rascunho.id
  return escalas[0]?.id ?? null
}

function hasConteudoSetorial(conteudo: EscalaExportContent): boolean {
  return conteudo.ciclo || conteudo.timeline || conteudo.avisos
}

export function EscalasHub() {
  const [loadingSetores, setLoadingSetores] = useState(true)
  const [loadingMetaSetores, setLoadingMetaSetores] = useState<Set<number>>(new Set())
  const [loadingEscalas, setLoadingEscalas] = useState<Set<number>>(new Set())
  const [expandedSetores, setExpandedSetores] = useState<Set<number>>(new Set())

  const [items, setItems] = useState<EscalaOperacionalItem[]>([])
  const [tiposContrato, setTiposContrato] = useState<TipoContrato[]>([])

  const [escalaDetalheByEscalaId, setEscalaDetalheByEscalaId] = useState<Map<number, EscalaCompletaV3>>(new Map())
  const [colaboradoresBySetor, setColaboradoresBySetor] = useState<Map<number, Colaborador[]>>(new Map())
  const [funcoesBySetor, setFuncoesBySetor] = useState<Map<number, Funcao[]>>(new Map())
  const [horariosBySetor, setHorariosBySetor] = useState<Map<number, SetorHorarioSemana[]>>(new Map())
  const [regrasBySetor, setRegrasBySetor] = useState<Map<number, RegraHorarioColaborador[]>>(new Map())

  const [exportOpen, setExportOpen] = useState(false)
  const [exportTarget, setExportTarget] = useState<ExportTarget | null>(null)
  const [conteudoExport, setConteudoExport] = useState<EscalaExportContent>({
    ciclo: true,
    timeline: false,
    funcionarios: false,
    avisos: false,
  })

  const appVersion = useAppVersion()

  async function ensureSetorMetaLoaded(setorId: number) {
    const hasAllMeta =
      colaboradoresBySetor.has(setorId)
      && funcoesBySetor.has(setorId)
      && horariosBySetor.has(setorId)
      && regrasBySetor.has(setorId)

    if (hasAllMeta || loadingMetaSetores.has(setorId)) return

    setLoadingMetaSetores((prev) => {
      const next = new Set(prev)
      next.add(setorId)
      return next
    })
    try {
      const [colaboradores, funcoes, horarios, regras] = await Promise.all([
        colaboradoresService.listar({ setor_id: setorId, ativo: true }),
        funcoesService.listar(setorId).catch(() => [] as Funcao[]),
        setoresService.listarHorarioSemana(setorId).catch(() => [] as SetorHorarioSemana[]),
        colaboradoresService.listarRegrasPadraoSetor(setorId).catch(() => [] as RegraHorarioColaborador[]),
      ])

      setColaboradoresBySetor((prev) => {
        const next = new Map(prev)
        next.set(setorId, colaboradores)
        return next
      })
      setFuncoesBySetor((prev) => {
        const next = new Map(prev)
        next.set(setorId, funcoes)
        return next
      })
      setHorariosBySetor((prev) => {
        const next = new Map(prev)
        next.set(setorId, horarios)
        return next
      })
      setRegrasBySetor((prev) => {
        const next = new Map(prev)
        next.set(setorId, regras)
        return next
      })
    } finally {
      setLoadingMetaSetores((prev) => {
        const next = new Set(prev)
        next.delete(setorId)
        return next
      })
    }
  }

  async function ensureEscalaDetalheLoaded(setorId: number, escalaId: number) {
    await ensureSetorMetaLoaded(setorId)
    if (escalaDetalheByEscalaId.has(escalaId) || loadingEscalas.has(escalaId)) return

    setLoadingEscalas((prev) => {
      const next = new Set(prev)
      next.add(escalaId)
      return next
    })
    try {
      const detalhe = await escalasService.buscar(escalaId)
      setEscalaDetalheByEscalaId((prev) => {
        const next = new Map(prev)
        next.set(escalaId, detalhe)
        return next
      })
    } finally {
      setLoadingEscalas((prev) => {
        const next = new Set(prev)
        next.delete(escalaId)
        return next
      })
    }
  }

  function getSelectedEscala(item: EscalaOperacionalItem): Escala | null {
    if (item.selectedEscalaId == null) return null
    return item.escalas.find((escala) => escala.id === item.selectedEscalaId) ?? null
  }

  function handleToggleSetorCard(item: EscalaOperacionalItem) {
    const isExpanded = expandedSetores.has(item.setor.id)
    const next = new Set(expandedSetores)
    if (isExpanded) {
      next.delete(item.setor.id)
    } else {
      next.add(item.setor.id)
      const escala = getSelectedEscala(item)
      if (escala) {
        void ensureEscalaDetalheLoaded(item.setor.id, escala.id)
      }
    }
    setExpandedSetores(next)
  }

  function handleAbrirExport(setorId: number, escalaId: number) {
    setExportTarget({ setorId, escalaId })
    setConteudoExport({
      ciclo: true,
      timeline: false,
      funcionarios: false,
      avisos: false,
    })
    void ensureEscalaDetalheLoaded(setorId, escalaId)
    setExportOpen(true)
  }

  useEffect(() => {
    async function load() {
      setLoadingSetores(true)
      try {
        const [setores, tcs] = await Promise.all([
          setoresService.listar(true),
          tiposContratoService.listar(),
        ])
        setTiposContrato(tcs)

        const loadedItems = await Promise.all(
          setores.map(async (setor): Promise<EscalaOperacionalItem> => {
            const escalas = await escalasService.listarPorSetor(setor.id).catch(() => [] as Escala[])
            const escalasOrdenadas = ordenarEscalas(escalas)
            return {
              setor,
              escalas: escalasOrdenadas,
              selectedEscalaId: escolherEscalaPadrao(escalasOrdenadas),
            }
          }),
        )

        loadedItems.sort((a, b) => {
          const aHasEscala = a.selectedEscalaId != null
          const bHasEscala = b.selectedEscalaId != null
          if (aHasEscala && !bHasEscala) return -1
          if (!aHasEscala && bHasEscala) return 1
          return a.setor.nome.localeCompare(b.setor.nome)
        })

        setItems(loadedItems)

        const primeiroComEscala = loadedItems.find((item) => item.selectedEscalaId != null)
        if (primeiroComEscala?.selectedEscalaId != null) {
          setExpandedSetores(new Set([primeiroComEscala.setor.id]))
          void ensureEscalaDetalheLoaded(primeiroComEscala.setor.id, primeiroComEscala.selectedEscalaId)
        } else {
          setExpandedSetores(new Set())
        }
      } finally {
        setLoadingSetores(false)
      }
    }
    void load()
  }, [])

  const exportContext = useMemo(() => {
    if (!exportTarget) return null
    const item = items.find((it) => it.setor.id === exportTarget.setorId)
    if (!item) return null

    const setor = item.setor
    const detalhe = escalaDetalheByEscalaId.get(exportTarget.escalaId) ?? null
    const equipeEscala = resolveEscalaEquipe(
      detalhe,
      colaboradoresBySetor.get(exportTarget.setorId) ?? [],
      funcoesBySetor.get(exportTarget.setorId) ?? [],
    )
    const horariosSemana = horariosBySetor.get(exportTarget.setorId) ?? []
    const regrasPadrao = regrasBySetor.get(exportTarget.setorId) ?? []
    const regrasMap = new Map<number, RegraHorarioColaborador>()
    for (const regra of regrasPadrao) regrasMap.set(regra.colaborador_id, regra)

    return {
      setor,
      detalhe,
      colaboradores: equipeEscala.colaboradores,
      funcoes: equipeEscala.funcoes,
      horariosSemana,
      regrasPadrao,
      regrasMap,
    }
  }, [colaboradoresBySetor, escalaDetalheByEscalaId, exportTarget, funcoesBySetor, horariosBySetor, items, regrasBySetor])

  const exportLoading = Boolean(
    exportOpen
      && exportTarget
      && (
        loadingMetaSetores.has(exportTarget.setorId)
        || loadingEscalas.has(exportTarget.escalaId)
        || !exportContext?.detalhe
      ),
  )

  function renderExportSetorial(conteudo: EscalaExportContent) {
    if (!exportContext?.detalhe) return null
    if (!hasConteudoSetorial(conteudo)) return null

    const modo: 'ciclo' | 'detalhado' = conteudo.timeline ? 'detalhado' : 'ciclo'
    return {
      modo,
      jsx: (
        <ExportarEscala
          escala={exportContext.detalhe.escala}
          alocacoes={exportContext.detalhe.alocacoes}
          colaboradores={exportContext.colaboradores}
          setor={exportContext.setor}
          violacoes={exportContext.detalhe.violacoes}
          tiposContrato={tiposContrato}
          funcoes={exportContext.funcoes}
          horariosSemana={exportContext.horariosSemana}
          regrasPadrao={exportContext.regrasPadrao}
          modo={modo}
          incluirAvisos={conteudo.avisos}
          incluirCiclo={conteudo.ciclo}
          incluirTimeline={conteudo.timeline}
          modoRender="download"
        />
      ),
    }
  }

  function buildHTMLFuncionario(colabId: number, incluirAvisos: boolean) {
    if (!exportContext?.detalhe) return null
    const colab = exportContext.colaboradores.find((c) => c.id === colabId)
    if (!colab) return null
    const tc = tiposContrato.find((tipo) => tipo.id === colab.tipo_contrato_id)
    const regra = exportContext.regrasMap.get(colabId)
    const html = gerarHTMLFuncionario({
      nome: colab.nome,
      contrato: tc?.nome ?? '',
      horasSemanais: tc?.horas_semanais ?? colab.horas_semanais,
      setor: exportContext.setor.nome,
      periodo: {
        inicio: exportContext.detalhe.escala.data_inicio,
        fim: exportContext.detalhe.escala.data_fim,
      },
      alocacoes: exportContext.detalhe.alocacoes.filter((a) => a.colaborador_id === colabId),
      violacoes: incluirAvisos
        ? exportContext.detalhe.violacoes.filter((v) => v.colaborador_id === colabId)
        : [],
      regra: regra
        ? {
          folga_fixa_dia_semana: regra.folga_fixa_dia_semana ?? null,
          folga_variavel_dia_semana: regra.folga_variavel_dia_semana ?? null,
        }
        : undefined,
      version: appVersion ?? undefined,
    })
    return { html, colaboradorNome: colab.nome }
  }

  async function handleExportHTMLFromModal() {
    if (!exportContext?.detalhe) return

    const incluirSetorial = hasConteudoSetorial(conteudoExport)
    const incluirFuncionarios = conteudoExport.funcionarios

    if (!incluirSetorial && !incluirFuncionarios) {
      toast.error('Ative Ciclo, Timeline ou Por funcionario para exportar HTML.')
      return
    }

    if (incluirSetorial) {
      const payload = renderExportSetorial(conteudoExport)
      if (!payload) {
        toast.error('Selecione Ciclo e/ou Timeline para exportar HTML setorial.')
        return
      }

      const { renderToStaticMarkup } = await import('react-dom/server')
      const html = renderToStaticMarkup(payload.jsx)
      const fullHTML = buildStandaloneHtml(html, { title: `Escala - ${exportContext.setor.nome}` })
      const slug = exportContext.setor.nome.toLowerCase().replace(/\s+/g, '-')
      const prefix = payload.modo === 'ciclo' ? 'escala-ciclo' : 'escala-detalhada'
      try {
        const result = await exportarService.salvarHTML(fullHTML, `${prefix}-${slug}.html`)
        if (result) toast.success(payload.modo === 'detalhado' ? 'HTML detalhado salvo com sucesso' : 'HTML salvo com sucesso')
      } catch {
        toast.error(payload.modo === 'detalhado' ? 'Erro ao exportar HTML detalhado' : 'Erro ao exportar HTML')
      }
    }

    if (incluirFuncionarios) {
      const arquivos = exportContext.colaboradores
        .map((colab) => {
          const payload = buildHTMLFuncionario(colab.id, conteudoExport.avisos)
          if (!payload) return null
          return {
            nome: payload.colaboradorNome.replace(/\s+/g, '_'),
            html: payload.html,
          }
        })
        .filter((item): item is { nome: string; html: string } => item != null)

      if (arquivos.length === 0) {
        toast.error('Nao foi possivel montar exportacao por funcionario.')
      } else {
        try {
          const result = await exportarService.batchHTML(arquivos)
          if (result) toast.success(`${result.count} arquivo(s) de funcionario salvos em ${result.pasta}`)
        } catch {
          toast.error('Erro ao exportar funcionarios em lote')
        }
      }
    }

    setExportOpen(false)
  }

  async function handlePrintFromModal() {
    if (!exportContext?.detalhe) return

    const payload = renderExportSetorial(conteudoExport)
    if (payload) {
      const printWindow = window.open('', '_blank')
      if (!printWindow) {
        toast.error('Bloqueio de popup detectado. Permita popups para imprimir.')
        return
      }

      const { renderToStaticMarkup } = await import('react-dom/server')
      const html = renderToStaticMarkup(payload.jsx)
      const fullHTML = buildStandaloneHtml(html, { title: `Escala - ${exportContext.setor.nome}` })
      printWindow.document.write(fullHTML)
      printWindow.document.close()
      printWindow.focus()
      setTimeout(() => printWindow.print(), 250)
      setExportOpen(false)
      return
    }

    if (conteudoExport.funcionarios) {
      toast.error('Impressao por funcionario em lote nao esta disponivel. Use Baixar HTML.')
      return
    }

    toast.error('Ative Ciclo e/ou Timeline para imprimir.')
  }

  async function handleCSVFromModal() {
    if (!exportContext?.detalhe) return

    const blocos: string[] = []
    const incluirEscala = conteudoExport.ciclo || conteudoExport.timeline || conteudoExport.funcionarios
    if (incluirEscala) {
      blocos.push(gerarCSVAlocacoes([exportContext.detalhe], [exportContext.setor], exportContext.colaboradores))
      blocos.push(gerarCSVComparacaoDemanda([exportContext.detalhe], [exportContext.setor]))
    }
    if (conteudoExport.avisos) {
      blocos.push(gerarCSVViolacoes([exportContext.detalhe], [exportContext.setor]))
    }

    if (blocos.length === 0) {
      toast.error('Selecione ao menos um conteúdo para exportar CSV.')
      return
    }

    const csv = blocos.join('\n\n')
    const slug = exportContext.setor.nome.toLowerCase().replace(/\s+/g, '-')
    try {
      const result = await exportarService.salvarCSV(csv, `escala-${slug}.csv`)
      if (result) toast.success('CSV salvo com sucesso')
      setExportOpen(false)
    } catch {
      toast.error('Erro ao exportar CSV')
    }
  }

  function renderExportPreview() {
    if (!exportContext?.detalhe) {
      return (
        <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
          Carregando preview da escala...
        </div>
      )
    }

    const incluirSetorial = hasConteudoSetorial(conteudoExport)

    return (
      <div className="space-y-3">
        {incluirSetorial ? (
          <ExportarEscala
            escala={exportContext.detalhe.escala}
            alocacoes={exportContext.detalhe.alocacoes}
            colaboradores={exportContext.colaboradores}
            setor={exportContext.setor}
            violacoes={exportContext.detalhe.violacoes}
            tiposContrato={tiposContrato}
            funcoes={exportContext.funcoes}
            horariosSemana={exportContext.horariosSemana}
            regrasPadrao={exportContext.regrasPadrao}
            modo={conteudoExport.timeline ? 'detalhado' : 'ciclo'}
            incluirAvisos={conteudoExport.avisos}
            incluirCiclo={conteudoExport.ciclo}
            incluirTimeline={conteudoExport.timeline}
          />
        ) : (
          <div className="rounded-md border bg-background p-4">
            <p className="text-sm font-medium">Preview setorial desativada</p>
            <p className="mt-1 text-xs text-muted-foreground">Ative Ciclo, Timeline ou Avisos para visualizar aqui.</p>
          </div>
        )}

        {conteudoExport.funcionarios && (
          <div className="rounded-md border bg-background p-4">
            <p className="text-sm font-medium">Por funcionario ativo</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Serao gerados arquivos para todos os {exportContext.colaboradores.length} funcionario(s) do setor.
            </p>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader
        breadcrumbs={[
          { label: 'Dashboard', href: '/' },
          { label: 'Escalas' },
        ]}
      />

      <div className="flex-1 space-y-4 p-6">
        <div>
          <h1 className="text-lg font-semibold text-foreground">Escalas</h1>
          <p className="text-sm text-muted-foreground">
            Resumo por setor com selecao de escala, exportacao e atalho para visualizacao completa.
          </p>
        </div>

        {loadingSetores ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        ) : items.length === 0 ? (
          <div className="flex items-center justify-center py-16">
            <p className="text-sm text-muted-foreground">Nenhum setor encontrado.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {items.map((item) => {
              const { setor, escalas, selectedEscalaId } = item
              const selectedEscala = getSelectedEscala(item)
              const isExpanded = expandedSetores.has(setor.id)
              const detalhe = selectedEscalaId != null ? escalaDetalheByEscalaId.get(selectedEscalaId) : null
              const equipeEscala = resolveEscalaEquipe(
                detalhe,
                colaboradoresBySetor.get(setor.id) ?? [],
                funcoesBySetor.get(setor.id) ?? [],
              )
              const regrasPadrao = regrasBySetor.get(setor.id) ?? []
              const loadingCard = Boolean(
                isExpanded
                && selectedEscalaId != null
                && (
                  loadingMetaSetores.has(setor.id)
                  || loadingEscalas.has(selectedEscalaId)
                ),
              )

              return (
                <Card key={setor.id}>
                  <CardHeader className="pb-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-2">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-7"
                          onClick={() => handleToggleSetorCard(item)}
                          aria-label={isExpanded ? 'Recolher card' : 'Expandir card'}
                        >
                          {isExpanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                        </Button>
                        <div className="min-w-0">
                          <CardTitle className="truncate text-base">{setor.nome}</CardTitle>
                          {selectedEscala ? (
                            <div className="mt-1 flex flex-wrap items-center gap-2">
                              <p className="text-xs text-muted-foreground">
                                {formatarData(selectedEscala.data_inicio)} — {formatarData(selectedEscala.data_fim)}
                              </p>
                              <StatusBadge status={selectedEscala.status as 'OFICIAL' | 'RASCUNHO'} />
                              {detalhe && detalhe.violacoes.length > 0 && (
                                <Badge variant="outline" className="border-warning/20 text-xs py-0 text-warning">
                                  {detalhe.violacoes.length} aviso(s)
                                </Badge>
                              )}
                            </div>
                          ) : (
                            <p className="mt-1 text-xs text-muted-foreground">Sem escala gerada</p>
                          )}
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        {selectedEscala ? (
                          <>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleAbrirExport(setor.id, selectedEscala.id)}
                              className="gap-1.5"
                            >
                              <Download className="size-3.5" />
                              Exportar
                            </Button>
                            <Button variant="outline" size="sm" asChild>
                              <Link to={`/setores/${setor.id}/escala?escalaId=${selectedEscala.id}`}>
                                Ver tudo
                                <ExternalLink className="ml-1 size-3.5" />
                              </Link>
                            </Button>
                          </>
                        ) : (
                          <Button variant="outline" size="sm" asChild>
                            <Link to={`/setores/${setor.id}`}>
                              Abrir setor
                              <ExternalLink className="ml-1 size-3.5" />
                            </Link>
                          </Button>
                        )}
                      </div>
                    </div>
                  </CardHeader>

                  {isExpanded && (
                    <CardContent>
                      {selectedEscala == null ? (
                        <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                          Nenhuma escala disponivel para este setor.
                        </div>
                      ) : loadingCard ? (
                        <div className="flex items-center justify-center rounded-md border py-12">
                          <Loader2 className="size-5 animate-spin text-muted-foreground" />
                        </div>
                      ) : detalhe ? (
                        <>
                          <EscalaCicloResumo
                            escala={detalhe.escala}
                            alocacoes={detalhe.alocacoes}
                            colaboradores={equipeEscala.colaboradores}
                            funcoes={equipeEscala.funcoes}
                            regrasPadrao={regrasPadrao}
                          />
                          {detalhe.comparacao_demanda.length > 0 && (
                            <CoberturaChart
                              comparacao={detalhe.comparacao_demanda}
                              indicadores={detalhe.indicadores}
                              className="mt-3 rounded-md border p-3"
                            />
                          )}
                        </>
                      ) : (
                        <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                          Nao foi possivel carregar o ciclo desta escala.
                        </div>
                      )}
                    </CardContent>
                  )}
                </Card>
              )
            })}
          </div>
        )}
      </div>

      <ExportModal
        open={exportOpen}
        onOpenChange={(open) => {
          setExportOpen(open)
          if (!open) setExportTarget(null)
        }}
        context="escala"
        titulo={exportContext ? `Exportar Escala — ${exportContext.setor.nome}` : 'Exportar Escala'}
        formato="conteudo"
        onFormatoChange={() => {}}
        conteudoEscala={conteudoExport}
        onConteudoEscalaChange={setConteudoExport}
        onExportHTML={handleExportHTMLFromModal}
        onPrint={handlePrintFromModal}
        onCSV={handleCSVFromModal}
        loading={exportLoading}
      >
        {renderExportPreview()}
      </ExportModal>
    </div>
  )
}
