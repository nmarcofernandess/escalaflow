import { useEffect, useMemo, useState } from 'react'
import { useAppVersion } from '@/hooks/useAppVersion'
import { Link } from 'react-router-dom'
import { ChevronDown, ChevronRight, Download, ExternalLink, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/componentes/PageHeader'
import { CicloGrid } from '@/componentes/CicloGrid'
import { escalaParaCicloGrid } from '@/lib/ciclo-grid-converters'
import { CoberturaChart } from '@/componentes/CoberturaChart'
import { ExportarEscala } from '@/componentes/ExportarEscala'
import { ExportModal } from '@/componentes/ExportModal'
import { StatusBadge } from '@/componentes/StatusBadge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatarData } from '@/lib/formatadores'
import { buildStandaloneHtml } from '@/lib/export-standalone-html'
import { resolveEscalaEquipe } from '@/lib/escala-team'
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

  const appVersion = useAppVersion()

  // Mass export state
  const [massaOpen, setMassaOpen] = useState(false)
  const [massaLoading, setMassaLoading] = useState(false)
  const [massaProgress, setMassaProgress] = useState(0)

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

  // Build massaSetores from items for the ExportModal mode='massa'
  const massaSetores = useMemo(() => {
    return items.map((item) => {
      const escalaAtual = getSelectedEscala(item)
      return {
        id: item.setor.id,
        nome: item.setor.nome,
        status: escalaAtual?.status ?? null,
      }
    })
  }, [items])

  async function handleExportMassa(setorIds: number[], incluirAvisos: boolean) {
    setMassaLoading(true)
    setMassaProgress(0)

    const arquivos: { nome: string; html: string }[] = []
    const { renderToStaticMarkup } = await import('react-dom/server')
    let completed = 0

    try {
      for (const setorId of setorIds) {
        const item = items.find((it) => it.setor.id === setorId)
        if (!item) continue

        // Find the OFICIAL escala for this setor
        const oficialEscala = item.escalas.find((e) => e.status === 'OFICIAL')
        if (!oficialEscala) continue

        // Load full escala data
        const detalhe = await escalasService.buscar(oficialEscala.id)

        // Load setor meta (colaboradores, funcoes, horarios, regras) if not cached
        const [colaboradores, funcoes, horariosSemana, regrasPadrao] = await Promise.all([
          colaboradoresBySetor.has(setorId)
            ? Promise.resolve(colaboradoresBySetor.get(setorId)!)
            : colaboradoresService.listar({ setor_id: setorId, ativo: true }),
          funcoesBySetor.has(setorId)
            ? Promise.resolve(funcoesBySetor.get(setorId)!)
            : funcoesService.listar(setorId).catch(() => [] as Funcao[]),
          horariosBySetor.has(setorId)
            ? Promise.resolve(horariosBySetor.get(setorId)!)
            : setoresService.listarHorarioSemana(setorId).catch(() => [] as SetorHorarioSemana[]),
          regrasBySetor.has(setorId)
            ? Promise.resolve(regrasBySetor.get(setorId)!)
            : colaboradoresService.listarRegrasPadraoSetor(setorId).catch(() => [] as RegraHorarioColaborador[]),
        ])

        const equipeEscala = resolveEscalaEquipe(detalhe, colaboradores, funcoes)

        // Render to HTML
        const jsx = (
          <ExportarEscala
            escala={detalhe.escala}
            alocacoes={detalhe.alocacoes}
            colaboradores={equipeEscala.colaboradores}
            setor={item.setor}
            violacoes={detalhe.violacoes}
            tiposContrato={tiposContrato}
            funcoes={equipeEscala.funcoes}
            horariosSemana={horariosSemana}
            regrasPadrao={regrasPadrao}
            mostrarCiclo
            mostrarSemanal
            mostrarAvisos={incluirAvisos}
            appVersion={appVersion ?? undefined}
          />
        )

        const html = renderToStaticMarkup(jsx)
        const fullHTML = buildStandaloneHtml(html, { title: `Escala - ${item.setor.nome}`, forceLight: true })
        const slug = item.setor.nome.toLowerCase().replace(/\s+/g, '-')

        arquivos.push({
          nome: `escala-${slug}`,
          html: fullHTML,
        })

        completed++
        setMassaProgress((completed / setorIds.length) * 100)
      }

      if (arquivos.length === 0) {
        toast.error('Nenhuma escala oficial encontrada para exportar.')
        return
      }

      const result = await exportarService.batchHTML(arquivos)
      if (result) {
        toast.success(`${result.count} escala(s) exportada(s) em ${result.pasta}`)
        setMassaOpen(false)
      }
    } catch (err) {
      toast.error(`Erro ao exportar em massa: ${err instanceof Error ? err.message : 'erro desconhecido'}`)
    } finally {
      setMassaLoading(false)
      setMassaProgress(0)
    }
  }

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader
        breadcrumbs={[
          { label: 'Dashboard', href: '/' },
          { label: 'Escalas' },
        ]}
        actions={
          <Button variant="outline" size="sm" onClick={() => setMassaOpen(true)}>
            <Download className="mr-1 size-3.5" />
            Exportar em Massa
          </Button>
        }
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
              const { setor, selectedEscalaId } = item
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
                          <Button variant="outline" size="sm" asChild>
                            <Link to={`/setores/${setor.id}/escala?escalaId=${selectedEscala.id}`}>
                              Ver tudo
                              <ExternalLink className="ml-1 size-3.5" />
                            </Link>
                          </Button>
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
                          <CicloGrid
                            data={escalaParaCicloGrid(
                              detalhe.escala,
                              detalhe.alocacoes,
                              equipeEscala.colaboradores,
                              equipeEscala.funcoes,
                              regrasPadrao,
                              [],
                            )}
                            mode="view"
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
        open={massaOpen}
        onOpenChange={setMassaOpen}
        mode="massa"
        massaData={{ setores: massaSetores }}
        onExportMassa={handleExportMassa}
        loading={massaLoading}
        progress={massaProgress}
      />
    </div>
  )
}
