import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import {
  ChevronDown,
  ChevronRight,
  CalendarDays,
  Loader2,
  ExternalLink,
  AlertTriangle,
  Search,
  Download,
} from 'lucide-react'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { PontuacaoBadge } from '@/componentes/PontuacaoBadge'
import { ViolacoesAgrupadas } from '@/componentes/ViolacoesAgrupadas'
import { EscalaGrid } from '@/componentes/EscalaGrid'
import { TimelineGrid } from '@/componentes/TimelineGrid'
import { cn } from '@/lib/utils'
import { formatarData, formatarMinutos } from '@/lib/formatadores'
import { escalasService } from '@/servicos/escalas'
import { colaboradoresService } from '@/servicos/colaboradores'
import { setoresService } from '@/servicos/setores'
import { tiposContratoService } from '@/servicos/tipos-contrato'
import type {
  Setor,
  Escala,
  EscalaCompleta,
  Colaborador,
  Demanda,
  TipoContrato,
} from '@shared/index'

export interface EscalaResumo {
  id: number
  data_inicio: string
  data_fim: string
  status: string
  pontuacao?: number | null
}

interface SetorEscalaSectionProps {
  setor: Setor
  escalaResumo: EscalaResumo | null
  viewMode: 'grid' | 'timeline'
  searchHighlight?: string
  matchedColabs?: { id: number; nome: string }[]
  onExportFunc?: (colabId: number, setorId: number) => void
}

const TOLERANCIA_DEFAULT = 30

export function SetorEscalaSection({ setor, escalaResumo, viewMode, searchHighlight, matchedColabs, onExportFunc }: SetorEscalaSectionProps) {
  const [expanded, setExpanded] = useState(true)
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)

  // Lazy loaded data
  const [escalaCompleta, setEscalaCompleta] = useState<EscalaCompleta | null>(null)
  const [colaboradores, setColaboradores] = useState<Colaborador[]>([])
  const [demandas, setDemandas] = useState<Demanda[]>([])
  const [tiposContrato, setTiposContrato] = useState<TipoContrato[]>([])

  async function loadDetail() {
    if (loaded || !escalaResumo) return
    setLoading(true)
    try {
      const [ec, colabs, dems, tcs] = await Promise.all([
        escalasService.buscar(escalaResumo.id),
        colaboradoresService.listar({ setor_id: setor.id, ativo: true }),
        setoresService.listarDemandas(setor.id),
        tiposContratoService.listar(),
      ])
      setEscalaCompleta(ec)
      setColaboradores(colabs)
      setDemandas(dems)
      setTiposContrato(tcs)
      setLoaded(true)
    } catch {
      // Silently fail — user sees empty state
    } finally {
      setLoading(false)
    }
  }

  function handleToggle() {
    const next = !expanded
    setExpanded(next)
    if (next && !loaded && escalaResumo) {
      loadDetail()
    }
  }

  // Auto-expand quando busca encontra algo neste setor
  useEffect(() => {
    if (searchHighlight && matchedColabs && matchedColabs.length > 0 && escalaResumo) {
      if (!expanded) setExpanded(true)
      if (!loaded) loadDetail()
    }
  }, [searchHighlight, matchedColabs])

  // No escala for this setor
  if (!escalaResumo) {
    return (
      <Card>
        <CardHeader className="flex flex-row items-center gap-3 py-3 px-4">
          <SectionIcon icone={setor.icone} />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-foreground truncate">{setor.nome}</p>
            <p className="text-xs text-muted-foreground">Nenhuma escala gerada</p>
          </div>
          <Button variant="outline" size="sm" asChild>
            <Link to={`/setores/${setor.id}/escala`}>
              Gerar Escala
              <ExternalLink className="ml-1 size-3" />
            </Link>
          </Button>
        </CardHeader>
      </Card>
    )
  }

  const avisosCount = escalaCompleta
    ? escalaCompleta.violacoes.length
    : 0

  return (
    <Card>
      {/* Header */}
      <CardHeader
        className="flex flex-row items-center gap-3 py-3 px-4 cursor-pointer select-none"
        onClick={handleToggle}
      >
        {expanded ? (
          <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
        )}
        <SectionIcon icone={setor.icone} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-foreground truncate">{setor.nome}</p>
          <p className="text-xs text-muted-foreground">
            {formatarData(escalaResumo.data_inicio)} - {formatarData(escalaResumo.data_fim)}
            <Badge variant="outline" className="ml-2 text-[10px] py-0">
              {escalaResumo.status}
            </Badge>
          </p>
        </div>
        <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
          {escalaResumo.pontuacao != null && (
            <PontuacaoBadge pontuacao={escalaResumo.pontuacao} />
          )}
          {loaded && avisosCount > 0 && (
            <Badge variant="outline" className="border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300 text-[10px]">
              <AlertTriangle className="mr-0.5 size-3" />
              {avisosCount}
            </Badge>
          )}
          <Button variant="ghost" size="sm" asChild>
            <Link to={`/setores/${setor.id}/escala`}>
              Editar
              <ExternalLink className="ml-1 size-3" />
            </Link>
          </Button>
        </div>
      </CardHeader>

      {/* Search match banner */}
      {searchHighlight && matchedColabs && matchedColabs.length > 0 && (
        <div className="mx-4 mb-2 flex items-center gap-2 rounded-md border border-yellow-200 dark:border-yellow-800 bg-yellow-50 dark:bg-yellow-950/30 px-3 py-2">
          <Search className="size-3.5 shrink-0 text-yellow-600 dark:text-yellow-400" />
          <span className="flex-1 text-xs text-yellow-800 dark:text-yellow-200">
            Encontrado: {matchedColabs.map((c) => c.nome).join(', ')}
          </span>
          {matchedColabs.length === 1 && onExportFunc && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 gap-1 text-xs text-yellow-700 dark:text-yellow-300 hover:text-yellow-900 dark:hover:text-yellow-100"
              onClick={() => onExportFunc(matchedColabs[0].id, setor.id)}
            >
              <Download className="size-3" />
              Exportar escala de {matchedColabs[0].nome}
            </Button>
          )}
        </div>
      )}

      {/* Collapse content */}
      {expanded && (
        <CardContent className="pt-0 pb-4 px-4">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
            </div>
          ) : escalaCompleta && colaboradores.length > 0 ? (
            <SectionTabs
              escalaCompleta={escalaCompleta}
              colaboradores={colaboradores}
              demandas={demandas}
              tiposContrato={tiposContrato}
              setor={setor}
              viewMode={viewMode}
              avisosCount={avisosCount}
            />
          ) : (
            <div className="flex items-center justify-center py-8">
              <p className="text-xs text-muted-foreground">Nao foi possivel carregar detalhes.</p>
            </div>
          )}
        </CardContent>
      )}
    </Card>
  )
}

// ─── Section Icon ───────────────────────────────────────────────────────────

function SectionIcon({ icone }: { icone: string | null }) {
  if (icone) {
    return <span className="text-lg">{icone}</span>
  }
  return (
    <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
      <CalendarDays className="size-4" />
    </div>
  )
}

// ─── Section Tabs ───────────────────────────────────────────────────────────

interface SectionTabsProps {
  escalaCompleta: EscalaCompleta
  colaboradores: Colaborador[]
  demandas: Demanda[]
  tiposContrato: TipoContrato[]
  setor: Setor
  viewMode: 'grid' | 'timeline'
  avisosCount: number
}

function SectionTabs({
  escalaCompleta,
  colaboradores,
  demandas,
  tiposContrato,
  setor,
  viewMode,
  avisosCount,
}: SectionTabsProps) {
  return (
    <Tabs defaultValue="escala" className="space-y-3">
      <TabsList className="h-8">
        <TabsTrigger value="escala" className="text-xs">Escala</TabsTrigger>
        <TabsTrigger value="horas" className="text-xs">Horas</TabsTrigger>
        <TabsTrigger value="avisos" className="text-xs gap-1">
          Avisos
          {avisosCount > 0 && (
            <Badge variant="secondary" className="ml-1 size-4 p-0 text-[9px] justify-center">
              {avisosCount}
            </Badge>
          )}
        </TabsTrigger>
      </TabsList>

      {/* Tab Escala */}
      <TabsContent value="escala">
        {viewMode === 'grid' ? (
          <EscalaGrid
            colaboradores={colaboradores}
            alocacoes={escalaCompleta.alocacoes}
            dataInicio={escalaCompleta.escala.data_inicio}
            dataFim={escalaCompleta.escala.data_fim}
            demandas={demandas}
            tiposContrato={tiposContrato}
            readOnly
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
            readOnly
          />
        )}
      </TabsContent>

      {/* Tab Horas */}
      <TabsContent value="horas">
        <HorasTable
          colaboradores={colaboradores}
          alocacoes={escalaCompleta.alocacoes}
          tiposContrato={tiposContrato}
          dataInicio={escalaCompleta.escala.data_inicio}
          dataFim={escalaCompleta.escala.data_fim}
        />
      </TabsContent>

      {/* Tab Avisos */}
      <TabsContent value="avisos">
        {avisosCount > 0 ? (
          <ViolacoesAgrupadas violacoes={escalaCompleta.violacoes} />
        ) : (
          <div className="flex items-center justify-center py-8">
            <p className="text-xs text-muted-foreground">Nenhuma violacao encontrada.</p>
          </div>
        )}
      </TabsContent>
    </Tabs>
  )
}

// ─── Horas Table (E3) ───────────────────────────────────────────────────────

interface HorasTableProps {
  colaboradores: Colaborador[]
  alocacoes: EscalaCompleta['alocacoes']
  tiposContrato: TipoContrato[]
  dataInicio: string
  dataFim: string
}

function HorasTable({ colaboradores, alocacoes, tiposContrato, dataInicio, dataFim }: HorasTableProps) {
  const rows = useMemo(() => {
    // Count weeks in the period for meta calculation
    const start = new Date(dataInicio + 'T00:00:00')
    const end = new Date(dataFim + 'T00:00:00')
    const totalDays = Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1
    const semanas = Math.max(1, totalDays / 7)

    // Sum real minutes per collaborator
    const minutosReais = new Map<number, number>()
    for (const a of alocacoes) {
      if (a.status === 'TRABALHO' && a.minutos != null) {
        minutosReais.set(a.colaborador_id, (minutosReais.get(a.colaborador_id) ?? 0) + a.minutos)
      }
    }

    return colaboradores.map((colab) => {
      const tc = tiposContrato.find((t) => t.id === colab.tipo_contrato_id)
      const real = minutosReais.get(colab.id) ?? 0
      const metaTotal = tc ? Math.round(tc.horas_semanais * 60 * semanas) : 0
      const delta = real - metaTotal
      const ok = delta >= -TOLERANCIA_DEFAULT
      return { colab, real, meta: metaTotal, delta, ok, contratoNome: tc?.nome ?? '-' }
    })
  }, [colaboradores, alocacoes, tiposContrato, dataInicio, dataFim])

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="text-xs">Colaborador</TableHead>
            <TableHead className="text-xs text-right">Real</TableHead>
            <TableHead className="text-xs text-right">Meta</TableHead>
            <TableHead className="text-xs text-right">Delta</TableHead>
            <TableHead className="text-xs text-center">Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map(({ colab, real, meta, delta, ok, contratoNome }) => (
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
              <TableCell className="text-center py-2">
                {ok ? (
                  <span className="text-emerald-600 dark:text-emerald-400 text-xs">OK</span>
                ) : (
                  <Badge variant="outline" className="border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300 text-[10px]">
                    <AlertTriangle className="mr-0.5 size-3" />
                    Abaixo
                  </Badge>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
