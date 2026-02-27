import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ExternalLink, Loader2 } from 'lucide-react'
import { PageHeader } from '@/componentes/PageHeader'
import { ExportarEscala } from '@/componentes/ExportarEscala'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatarData } from '@/lib/formatadores'
import { colaboradoresService } from '@/servicos/colaboradores'
import { escalasService } from '@/servicos/escalas'
import { funcoesService } from '@/servicos/funcoes'
import { setoresService } from '@/servicos/setores'
import { tiposContratoService } from '@/servicos/tipos-contrato'
import type {
  Colaborador,
  Escala,
  EscalaCompletaV3,
  Funcao,
  Setor,
  SetorHorarioSemana,
  TipoContrato,
} from '@shared/index'

interface EscalaOperacionalItem {
  setor: Setor
  escala: Escala | null
}

export function EscalasHub() {
  const [loadingSetores, setLoadingSetores] = useState(true)
  const [loadingDetalhes, setLoadingDetalhes] = useState<Set<number>>(new Set())
  const [items, setItems] = useState<EscalaOperacionalItem[]>([])
  const [tiposContrato, setTiposContrato] = useState<TipoContrato[]>([])
  const [escalaDetalheBySetor, setEscalaDetalheBySetor] = useState<Map<number, EscalaCompletaV3>>(new Map())
  const [colaboradoresBySetor, setColaboradoresBySetor] = useState<Map<number, Colaborador[]>>(new Map())
  const [funcoesBySetor, setFuncoesBySetor] = useState<Map<number, Funcao[]>>(new Map())
  const [horariosBySetor, setHorariosBySetor] = useState<Map<number, SetorHorarioSemana[]>>(new Map())

  async function loadSetorDetalhes(setorId: number, escalaId: number) {
    if (escalaDetalheBySetor.has(setorId) || loadingDetalhes.has(setorId)) return
    setLoadingDetalhes((prev) => {
      const next = new Set(prev)
      next.add(setorId)
      return next
    })
    try {
      const [detalhe, colaboradores, funcoes, horarios] = await Promise.all([
        escalasService.buscar(escalaId),
        colaboradoresService.listar({ setor_id: setorId, ativo: true }),
        funcoesService.listar(setorId, true).catch(() => []),
        setoresService.listarHorarioSemana(setorId).catch(() => []),
      ])

      setEscalaDetalheBySetor((prev) => {
        const next = new Map(prev)
        next.set(setorId, detalhe)
        return next
      })
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
    } finally {
      setLoadingDetalhes((prev) => {
        const next = new Set(prev)
        next.delete(setorId)
        return next
      })
    }
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
            try {
              let escalas = await escalasService.listarPorSetor(setor.id, { status: 'OFICIAL' })
              if (escalas.length === 0) {
                escalas = await escalasService.listarPorSetor(setor.id, { status: 'RASCUNHO' })
              }
              return { setor, escala: escalas[0] ?? null }
            } catch {
              return { setor, escala: null }
            }
          }),
        )

        loadedItems.sort((a, b) => {
          if (a.escala && !b.escala) return -1
          if (!a.escala && b.escala) return 1
          return a.setor.nome.localeCompare(b.setor.nome)
        })
        setItems(loadedItems)

        // Prefetch dos ciclos para manter a tela pronta sem cliques extras
        loadedItems
          .filter((item) => item.escala)
          .forEach((item) => {
            void loadSetorDetalhes(item.setor.id, item.escala!.id)
          })
      } finally {
        setLoadingSetores(false)
      }
    }
    void load()
  }, [])

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
            Ciclo por setor com atalho direto para visualização completa.
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
            {items.map(({ setor, escala }) => {
              const detalhe = escalaDetalheBySetor.get(setor.id)
              const colaboradores = colaboradoresBySetor.get(setor.id) ?? []
              const funcoes = funcoesBySetor.get(setor.id) ?? []
              const horariosSemana = horariosBySetor.get(setor.id) ?? []
              const carregandoDetalhe = loadingDetalhes.has(setor.id)

              if (!escala) {
                return (
                  <Card key={setor.id}>
                    <CardHeader className="flex flex-row items-center justify-between gap-4">
                      <div>
                        <CardTitle className="text-base">{setor.nome}</CardTitle>
                        <p className="mt-1 text-xs text-muted-foreground">Sem escala gerada</p>
                      </div>
                      <Button variant="outline" size="sm" asChild>
                        <Link to={`/setores/${setor.id}`}>
                          Abrir setor
                          <ExternalLink className="ml-1 size-3.5" />
                        </Link>
                      </Button>
                    </CardHeader>
                  </Card>
                )
              }

              return (
                <Card key={setor.id}>
                  <CardHeader className="flex flex-row items-center justify-between gap-4 pb-3">
                    <div>
                      <CardTitle className="text-base">{setor.nome}</CardTitle>
                      <div className="mt-1 flex items-center gap-2">
                        <p className="text-xs text-muted-foreground">
                          {formatarData(escala.data_inicio)} — {formatarData(escala.data_fim)}
                        </p>
                        <Badge variant="outline" className="text-[10px] py-0">
                          {escala.status}
                        </Badge>
                      </div>
                    </div>
                    <Button variant="outline" size="sm" asChild>
                      <Link to={`/setores/${setor.id}/escala`}>
                        Ver tudo
                        <ExternalLink className="ml-1 size-3.5" />
                      </Link>
                    </Button>
                  </CardHeader>
                  <CardContent>
                    {carregandoDetalhe ? (
                      <div className="flex items-center justify-center rounded-md border py-12">
                        <Loader2 className="size-5 animate-spin text-muted-foreground" />
                      </div>
                    ) : detalhe ? (
                      <div className="max-h-[70vh] overflow-auto rounded-md border bg-white">
                        <ExportarEscala
                          escala={detalhe.escala}
                          alocacoes={detalhe.alocacoes}
                          colaboradores={colaboradores}
                          setor={setor}
                          violacoes={detalhe.violacoes}
                          tiposContrato={tiposContrato}
                          funcoes={funcoes}
                          horariosSemana={horariosSemana}
                          modo="ciclo"
                          modoRender="view"
                        />
                      </div>
                    ) : (
                      <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                        Nao foi possivel carregar o ciclo deste setor.
                        <Button
                          variant="link"
                          size="sm"
                          className="ml-1 h-auto p-0"
                          onClick={() => void loadSetorDetalhes(setor.id, escala.id)}
                        >
                          Tentar novamente
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
