import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { useRestorePreview } from '@/hooks/useRestorePreview'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import type { DragEndEvent } from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  GripVertical,
  ChevronDown,
  Users,
  ArrowRight,
  Archive,
  Plus,
  Play,
  Loader2,
  RotateCcw,
  SlidersHorizontal,
  Pencil,
  UserMinus,
  Briefcase,
  Trash2,
  Square,
  Terminal,
  CheckCircle2,
  CircleAlert,
  Save,
  Check,
  AlertTriangle,
  Info,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from '@/components/ui/form'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog'
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { PageHeader } from '@/componentes/PageHeader'
import type { DemandaEditorRef, SemanaDraft } from '@/componentes/DemandaEditor'
import { StatusBadge } from '@/componentes/StatusBadge'
import { EscalaCicloResumo } from '@/componentes/EscalaCicloResumo'
import { SimuladorCicloGrid } from '@/componentes/SimuladorCicloGrid'
import { gerarCicloFase1, converterNivel1ParaEscala, sugerirK, type SimulaCicloOutput } from '@shared/simula-ciclo'
import { CicloViewToggle, useCicloViewMode } from '@/componentes/CicloViewToggle'
import { CoberturaChart } from '@/componentes/CoberturaChart'
import { SolverConfigDrawer, type SolverSessionConfig } from '@/componentes/SolverConfigDrawer'
import { ExportarEscala } from '@/componentes/ExportarEscala'
import { ExportModal, type EscalaExportContent } from '@/componentes/ExportModal'
import { IconPicker } from '@/componentes/IconPicker'
import { DemandaEditor } from '@/componentes/DemandaEditor'
import { setoresService } from '@/servicos/setores'
import { colaboradoresService } from '@/servicos/colaboradores'
import { escalasService } from '@/servicos/escalas'
import { funcoesService } from '@/servicos/funcoes'
import { useAppDataStore, type AvisoEscala } from '@/store/appDataStore'
import { useIaStore } from '@/store/iaStore'
import { useAppVersion } from '@/hooks/useAppVersion'
import { formatarData, formatarDataHora, mapError } from '@/lib/formatadores'
import { toastErroGeracaoEscala, toastInfeasible } from '@/lib/toast-escala'
import { buildStandaloneHtml } from '@/lib/export-standalone-html'
import { gerarHTMLFuncionario } from '@/lib/gerarHTMLFuncionario'
import { gerarCSVAlocacoes, gerarCSVComparacaoDemanda, gerarCSVViolacoes } from '@/lib/gerarCSV'
import { getPresetLabel, resolvePresetRange, type EscalaPeriodoPreset } from '@/lib/escala-periodo-preset'
import { resolveEscalaEquipe } from '@/lib/escala-team'
import { toast } from 'sonner'
import { Switch } from '@/components/ui/switch'
import { exportarService } from '@/servicos/exportar'
import {
  DIAS_SEMANA,
  type DiaSemana,
  Empresa,
  Setor,
  Demanda,
  DemandaExcecaoData,
  Colaborador,
  Escala,
  EscalaCompletaV3,
  TipoContrato,
  Funcao,
  Excecao,
  SetorHorarioSemana,
  RegraHorarioColaborador,
  normalizeSetorSimulacaoConfig,
  type SetorSimulacaoConfig,
  type SetorSimulacaoMode,
  type InfeasibleError,
} from '@shared/index'

function PrecondicaoItem({
  ok,
  label,
  linkTo,
  hint,
}: {
  ok: boolean
  label: string
  linkTo?: string
  hint?: string
}) {
  const Icon = ok ? CheckCircle2 : CircleAlert
  const content = (
    <span className="flex items-center gap-2">
      <Icon className={cn('size-4 shrink-0', ok ? 'text-success' : 'text-muted-foreground')} />
      <span className={ok ? 'text-muted-foreground' : 'text-foreground'}>{label}</span>
      {hint && !ok && <span className="text-xs text-muted-foreground">({hint})</span>}
    </span>
  )
  if (linkTo && !ok) {
    return (
      <li>
        <Link to={linkTo} className="hover:underline">
          {content}
        </Link>
      </li>
    )
  }
  return <li>{content}</li>
}

// ─── DnD: Sortable row for posto hierarchy reorder ──────────────────

function SortablePostoRow({
  postoId,
  index,
  children,
}: {
  postoId: number
  index: number
  children: import('react').ReactNode
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `posto-${postoId}`,
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  return (
    <TableRow ref={setNodeRef} style={style} className={cn(isDragging && 'bg-muted/40')}>
      <TableCell className="w-[60px] text-center">
        <div className="flex items-center justify-center gap-1.5">
          <button
            type="button"
            className="inline-flex size-6 cursor-grab touch-none items-center justify-center rounded text-muted-foreground hover:bg-muted active:cursor-grabbing"
            aria-label="Arrastar para reordenar"
            {...attributes}
            {...listeners}
          >
            <GripVertical className="size-3.5" />
          </button>
          <span className="font-mono text-xs text-muted-foreground">
            {String(index + 1).padStart(2, '0')}
          </span>
        </div>
      </TableCell>
      {children}
    </TableRow>
  )
}

function TitularAssignmentPanel({
  titular,
  candidatos,
  funcaoMap,
  searchTerm,
  onSearchTermChange,
  onSelectColaborador,
  onRemoveTitular,
  removeLabel,
  getDescricaoBuscaColaborador,
  loading,
}: {
  titular: Colaborador | null
  candidatos: Colaborador[]
  funcaoMap: Map<number, string>
  searchTerm: string
  onSearchTermChange: (value: string) => void
  onSelectColaborador: (colaboradorId: number) => void
  onRemoveTitular?: () => void
  removeLabel?: string
  getDescricaoBuscaColaborador: (colaborador: Colaborador) => string
  loading: boolean
}) {
  return (
    <div className="space-y-3 p-3">
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-medium">Titular atual</p>
          {titular && onRemoveTitular && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 gap-1 px-2 text-xs"
              onClick={onRemoveTitular}
              disabled={loading}
            >
              <UserMinus className="size-3" />
              {removeLabel ?? 'Remover'}
            </Button>
          )}
        </div>

        {titular ? (
          <div className="rounded-md border px-3 py-2">
            <p className="truncate text-sm font-medium text-foreground">{titular.nome}</p>
            <p className="truncate text-xs text-muted-foreground">
              {getDescricaoBuscaColaborador(titular)}
            </p>
          </div>
        ) : (
          <div className="rounded-md border border-dashed px-3 py-3 text-xs text-muted-foreground">
            Sem titular anexado.
          </div>
        )}
      </div>

      <div className="space-y-2">
        <p className="text-xs font-medium">Buscar colaborador</p>
        <Input
          value={searchTerm}
          onChange={(e) => onSearchTermChange(e.target.value)}
          placeholder="Digite o nome do colaborador"
          autoFocus
        />
      </div>

      <ScrollArea className="h-48 rounded-md border bg-background/60">
        <div className="space-y-1 p-2 pr-3">
          {candidatos.length === 0 ? (
            <p className="rounded-md border border-dashed px-2 py-2 text-xs text-muted-foreground">
              Nenhum colaborador encontrado.
            </p>
          ) : (
            candidatos.map((candidato) => {
              const postoAtualNome = candidato.funcao_id != null ? (funcaoMap.get(candidato.funcao_id) ?? 'Posto') : 'Reserva operacional'

              return (
                <button
                  key={candidato.id}
                  type="button"
                  className="flex w-full items-center justify-between rounded-md border px-2 py-2 text-left hover:bg-muted"
                  onClick={() => onSelectColaborador(candidato.id)}
                  disabled={loading}
                >
                  <div className="min-w-0">
                    <p className="truncate text-xs font-medium text-foreground">{candidato.nome}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {getDescricaoBuscaColaborador(candidato)}
                    </p>
                  </div>
                  <Badge variant={candidato.funcao_id != null ? 'outline' : 'secondary'} className="shrink-0 text-xs">
                    {candidato.funcao_id != null ? (
                      <>
                        <Briefcase className="mr-1 size-3" />
                        {postoAtualNome}
                      </>
                    ) : (
                      <>
                        <Users className="mr-1 size-3" />
                        Reserva
                      </>
                    )}
                  </Badge>
                </button>
              )
            })
          )}
        </div>
      </ScrollArea>
    </div>
  )
}

// ─── Form schema ───────────────────────────────────────────────────────
const setorSchema = z.object({
  nome: z.string().min(2, 'Nome deve ter ao menos 2 caracteres'),
  icone: z.string().nullable(),
  hora_abertura: z.string().min(1, 'Hora de abertura e obrigatoria'),
  hora_fechamento: z.string().min(1, 'Hora de fechamento e obrigatoria'),
  regime_escala: z.enum(['5X2', '6X1']),
})

type SetorFormInput = z.input<typeof setorSchema>
type SetorFormData = z.output<typeof setorSchema>

const PREVIEW_DIAS_UTEIS: Exclude<DiaSemana, 'DOM'>[] = ['SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB']
const DEFAULT_SIMULACAO_LIVRE_N = 5

function diaSemanaParaIdxPreview(dia: DiaSemana | null | undefined): number | null {
  if (!dia || dia === 'DOM') return null
  return PREVIEW_DIAS_UTEIS.indexOf(dia)
}

function idxPreviewParaDiaSemana(idx: number | null | undefined): Exclude<DiaSemana, 'DOM'> | null {
  if (idx == null) return null
  return PREVIEW_DIAS_UTEIS[idx] ?? null
}

// ─── Main Component ────────────────────────────────────────────────────
export function SetorDetalhe() {
  const { id } = useParams<{ id: string }>()
  const setorId = parseInt(id!)
  const navigate = useNavigate()
  const { isPreviewMode } = useRestorePreview()

  // Form
  const setorForm = useForm<SetorFormInput, unknown, SetorFormData>({
    resolver: zodResolver(setorSchema),
    defaultValues: { nome: '', icone: null, hora_abertura: '', hora_fechamento: '', regime_escala: '5X2' },
  })

  // ─── Data from store (reactive) ──────────────────────────────────────
  const setSetorAtivo = useAppDataStore((s) => s.setSetorAtivo)
  const carregandoSetor = useAppDataStore((s) => s.carregandoSetor)
  const setor = useAppDataStore((s) => s.setor)
  const empresa = useAppDataStore((s) => s.empresa)
  const demandas = useAppDataStore((s) => s.demandas)
  const horariosSemana = useAppDataStore((s) => s.horarioSemana)
  const colaboradores = useAppDataStore((s) => s.colaboradores)
  const escalas = useAppDataStore((s) => s.escalas)
  const tiposContrato = useAppDataStore((s) => s.tiposContrato)
  const funcoes = useAppDataStore((s) => s.postos)
  const excecoesAtivas = useAppDataStore((s) => s.excecoes)
  const regrasPadrao = useAppDataStore((s) => s.regrasPadrao)

  // Notify store which sector is active (loads data if changed)
  useEffect(() => {
    setSetorAtivo(setorId)
  }, [setorId, setSetorAtivo])

  const contratoMap = new Map((tiposContrato ?? []).map((tc) => [tc.id, tc.nome]))
  const funcoesList = useMemo(() => funcoes ?? [], [funcoes])
  const inicioSemanaEscala = useMemo<DiaSemana>(() => {
    const raw = (empresa?.corte_semanal ?? 'SEG_DOM').slice(0, 3).toUpperCase()
    if (raw === 'SEG' || raw === 'TER' || raw === 'QUA' || raw === 'QUI' || raw === 'SEX' || raw === 'SAB' || raw === 'DOM') {
      return raw
    }
    return 'SEG'
  }, [empresa?.corte_semanal])

  // ─── Save & Dirty ────────────────────────────────────────────────────
  const demandaEditorRef = useRef<DemandaEditorRef>(null)
  const [demandaDirty, setDemandaDirty] = useState(false)
  const [salvandoTudo, setSalvandoTudo] = useState(false)
  const isDirty = setorForm.formState.isDirty || demandaDirty

  // ─── State ───────────────────────────────────────────────────────────
  const [showPostoDialog, setShowPostoDialog] = useState(false)
  const [postoDialogMode, setPostoDialogMode] = useState<'create' | 'edit'>('create')
  const [postoDialogPostoId, setPostoDialogPostoId] = useState<number | null>(null)
  const [postoDialogApelido, setPostoDialogApelido] = useState('')
  const [postoDialogTitularId, setPostoDialogTitularId] = useState<number | null>(null)
  const [postoDialogSearchTerm, setPostoDialogSearchTerm] = useState('')
  const [postoDialogTitularPickerOpen, setPostoDialogTitularPickerOpen] = useState(false)
  const [salvandoPosto, setSalvandoPosto] = useState(false)
  const [deletandoPosto, setDeletandoPosto] = useState(false)
  const [orderedPostos, setOrderedPostos] = useState<Funcao[]>([])
  const [orderedColabs, setOrderedColabs] = useState<Colaborador[]>([])
  const [titularPickerPostoId, setTitularPickerPostoId] = useState<number | null>(null)
  const [titularPickerSearchTerm, setTitularPickerSearchTerm] = useState('')
  const [postoAssignmentLoading, setPostoAssignmentLoading] = useState(false)
  const [pendingAutocompleteSwap, setPendingAutocompleteSwap] = useState<{
    source: 'picker' | 'dialog'
    postoId: number
    colabId: number
    colaboradorNome: string
    postoOrigemNome: string
    postoDestinoNome: string
  } | null>(null)

  // Geracao inline — seletor unificado: simulacao | oficial | historico:${id}
  const [escalaSelecionada, setEscalaSelecionada] = useState<string>('simulacao')
  const [periodoPreset, setPeriodoPreset] = useState<EscalaPeriodoPreset>('3_MESES')
  const [cicloMode, setCicloMode] = useCicloViewMode()
  const [previewSelectedWeek, setPreviewSelectedWeek] = useState(0)
  const [gerando, setGerando] = useState(false)
  const [solverLogs, setSolverLogs] = useState<string[]>([])
  const [solverElapsed, setSolverElapsed] = useState(0)

  // B8: Avisos de operacao (preflight blockers, solver errors) — persistem na pagina
  // CONECTOR PARA CLAUDE C: renderizar estes avisos na area de avisos do setor
  // e tambem na EscalaPagina (ver todos). Separados dos avisos por pessoa.
  const [avisosOperacao, setAvisosOperacao] = useState<AvisoEscala[]>([])
  const solverScrollRef = useRef<HTMLDivElement>(null)
  const [escalaCompleta, setEscalaCompleta] = useState<EscalaCompletaV3 | null>(null)
  const [oficialCompleta, setOficialCompleta] = useState<EscalaCompletaV3 | null>(null)
  const [historicoCompleta, setHistoricoCompleta] = useState<EscalaCompletaV3 | null>(null)
  const [historicoSelecionadaId, setHistoricoSelecionadaId] = useState<number | null>(null)
  const [carregandoTabEscala, setCarregandoTabEscala] = useState(false)
  const [oficializando, setOficializando] = useState(false)
  const [descartando, setDescartando] = useState(false)
  const [periodoGeracao, setPeriodoGeracao] = useState(() => resolvePresetRange('3_MESES'))
  const [solverConfigOpen, setSolverConfigOpen] = useState(false)
  const [solverSessionConfig, setSolverSessionConfig] = useState<SolverSessionConfig>({
    solveMode: 'rapido',
    rulesOverride: {},
  })
  const [simulacaoConfigDraft, setSimulacaoConfigDraft] = useState<SetorSimulacaoConfig | null>(null)
  const [rawLivreN, setRawLivreN] = useState(String(DEFAULT_SIMULACAO_LIVRE_N))
  const [rawLivreK, setRawLivreK] = useState(String(sugerirK(DEFAULT_SIMULACAO_LIVRE_N, 7)))
  const [simulacaoConfigSaving, setSimulacaoConfigSaving] = useState(false)
  const [folgasSetorEditadas, setFolgasSetorEditadas] = useState<Map<number, { fixa: DiaSemana | null; variavel: DiaSemana | null }>>(new Map())

  const [exportOpen, setExportOpen] = useState(false)
  const [conteudoExport, setConteudoExport] = useState<EscalaExportContent>({
    ciclo: true,
    timeline: false,
    funcionarios: false,
    avisos: false,
  })
  const [exportDetalhe, setExportDetalhe] = useState<EscalaCompletaV3 | null>(null)

  // Demanda excecao por data
  const [demandasExcecao, setDemandasExcecao] = useState<DemandaExcecaoData[]>([])
  const [showExcDemandaDialog, setShowExcDemandaDialog] = useState(false)
  const [excDemandaSalvando, setExcDemandaSalvando] = useState(false)
  const [excDemandaForm, setExcDemandaForm] = useState({
    data: '',
    hora_inicio: '',
    hora_fim: '',
    min_pessoas: 1,
    override: false,
  })

  // ─── Solver logs listener ───────────────────────────────────────────
  useEffect(() => {
    if (!gerando) return
    const dispose = escalasService.onSolverLog((line: string) => {
      setSolverLogs((prev) => [...prev, line])
    })
    return () => { dispose() }
  }, [gerando])

  // Auto-scroll solver logs
  useEffect(() => {
    if (solverLogs.length === 0) return
    const viewport = solverScrollRef.current?.querySelector('[data-radix-scroll-area-viewport]')
    if (viewport) {
      viewport.scrollTo({ top: viewport.scrollHeight, behavior: 'smooth' })
    }
  }, [solverLogs])

  // Timer while solver is running
  useEffect(() => {
    if (!gerando) return
    setSolverElapsed(0)
    const interval = setInterval(() => setSolverElapsed((s) => s + 1), 1000)
    return () => clearInterval(interval)
  }, [gerando])

  // ─── Computed maps ───────────────────────────────────────────────────
  const funcaoMap = useMemo(() => {
    const map = new Map<number, string>()
    for (const f of funcoesList) map.set(f.id, f.apelido)
    return map
  }, [funcoesList])

  const excecaoMap = useMemo(() => {
    const colabIds = new Set((colaboradores ?? []).map((c) => c.id))
    const map = new Map<number, Excecao>()
    for (const exc of excecoesAtivas ?? []) {
      if (colabIds.has(exc.colaborador_id)) {
        map.set(exc.colaborador_id, exc)
      }
    }
    return map
  }, [colaboradores, excecoesAtivas])

  const regrasMap = useMemo(() => {
    const map = new Map<number, RegraHorarioColaborador>()
    for (const regra of regrasPadrao ?? []) {
      map.set(regra.colaborador_id, regra)
    }
    return map
  }, [regrasPadrao])

  const folgasEquipeMap = useMemo(() => {
    const map = new Map<number, { fixa: DiaSemana | null; variavel: DiaSemana | null }>()

    for (const colab of orderedColabs) {
      const regra = regrasMap.get(colab.id)
      map.set(colab.id, {
        fixa: regra?.folga_fixa_dia_semana ?? null,
        variavel: regra?.folga_variavel_dia_semana ?? null,
      })
    }

    return map
  }, [orderedColabs, regrasMap])

  const ocupanteMap = useMemo(() => {
    const map = new Map<number, Colaborador>()
    for (const c of orderedColabs) {
      if (c.funcao_id != null) {
        map.set(c.funcao_id, c)
      }
    }
    return map
  }, [orderedColabs])

  const postosOrdenados = orderedPostos
  const postosAtivos = useMemo(
    () => postosOrdenados.filter((posto) => posto.ativo),
    [postosOrdenados],
  )
  const postosBancoEspera = useMemo(
    () => postosOrdenados.filter((posto) => !posto.ativo),
    [postosOrdenados],
  )

  const colabsSemPosto = useMemo(
    () => orderedColabs.filter((c) => c.funcao_id == null),
    [orderedColabs],
  )

  const colaboradoresParaBusca = useMemo(
    () => [...orderedColabs].sort((a, b) => a.nome.localeCompare(b.nome)),
    [orderedColabs],
  )

  const filtrarColaboradoresPorBusca = useCallback((searchTerm: string) => {
    const query = searchTerm.trim().toLowerCase()
    if (!query) return colaboradoresParaBusca
    return colaboradoresParaBusca.filter((c) => c.nome.toLowerCase().includes(query))
  }, [colaboradoresParaBusca])

  const colaboradoresFiltradosPicker = useMemo(
    () => filtrarColaboradoresPorBusca(titularPickerSearchTerm),
    [filtrarColaboradoresPorBusca, titularPickerSearchTerm],
  )

  const colaboradoresFiltradosDialogo = useMemo(
    () => filtrarColaboradoresPorBusca(postoDialogSearchTerm),
    [filtrarColaboradoresPorBusca, postoDialogSearchTerm],
  )

  const getStatusColaborador = useCallback((colabId: number) => {
    const exc = excecaoMap.get(colabId)?.tipo ?? null
    if (!exc) return 'Ativo'
    if (exc === 'FERIAS') return 'Ferias'
    if (exc === 'ATESTADO') return 'Atestado'
    return 'Bloqueio'
  }, [excecaoMap])

  // ─── DnD setup (reorder postos) ─────────────────────────────────────
  const postoSortSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  )

  const persistPostosBuckets = useCallback(async (nextPostosAtivos: Funcao[], nextPostosEspera: Funcao[]) => {
    const normalizedAtivos = nextPostosAtivos.map((posto, index) => ({
      ...posto,
      ativo: true,
      ordem: index,
    }))
    const normalizedEspera = nextPostosEspera.map((posto, index) => ({
      ...posto,
      ativo: false,
      ordem: normalizedAtivos.length + index,
    }))
    const normalized = [...normalizedAtivos, ...normalizedEspera]
    setOrderedPostos(normalized)

    try {
      await Promise.all(
        normalized.map((posto) => funcoesService.atualizar(posto.id, {
          ordem: posto.ordem,
          ativo: posto.ativo,
        })),
      )
    } catch {
      toast.error('Erro ao salvar organizacao dos postos')
    }
  }, [])

  const handlePostoReorderDragEnd = useCallback(async (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return

    const oldIndex = postosAtivos.findIndex((p) => `posto-${p.id}` === active.id)
    const newIndex = postosAtivos.findIndex((p) => `posto-${p.id}` === over.id)
    if (oldIndex === -1 || newIndex === -1) return

    const reorderedAtivos = arrayMove(postosAtivos, oldIndex, newIndex)
    await persistPostosBuckets(reorderedAtivos, postosBancoEspera)
  }, [persistPostosBuckets, postosAtivos, postosBancoEspera])

  // Sync ordered list when API data changes
  useEffect(() => {
    if (colaboradores) {
      setOrderedColabs([...colaboradores].sort((a, b) => a.rank - b.rank))
    }
  }, [colaboradores])

  useEffect(() => {
    const next = [...funcoesList].sort((a, b) => a.ordem - b.ordem || a.apelido.localeCompare(b.apelido))
    setOrderedPostos((prev) => {
      if (prev.length === next.length && prev.every((p, idx) => p.id === next[idx]?.id && p.ordem === next[idx]?.ordem)) {
        return prev
      }
      return next
    })
  }, [funcoesList])

  // Carregar demandas excecao por data
  useEffect(() => {
    if (!setorId) return
    setoresService.listarDemandasExcecaoData(setorId).then(setDemandasExcecao).catch(() => {})
  }, [setorId])

  const resetPostoDialogState = useCallback(() => {
    setPostoDialogMode('create')
    setPostoDialogPostoId(null)
    setPostoDialogApelido('')
    setPostoDialogTitularId(null)
    setPostoDialogSearchTerm('')
    setPostoDialogTitularPickerOpen(false)
  }, [])

  const openTitularPicker = useCallback((postoId: number) => {
    setTitularPickerPostoId(postoId)
    setTitularPickerSearchTerm('')
  }, [])

  const closeTitularPicker = useCallback(() => {
    setTitularPickerPostoId(null)
    setTitularPickerSearchTerm('')
  }, [])

  const openCreatePostoDialog = useCallback(() => {
    resetPostoDialogState()
    setShowPostoDialog(true)
  }, [resetPostoDialogState])

  const openEditPostoDialog = useCallback((posto: Funcao) => {
    setPostoDialogMode('edit')
    setPostoDialogPostoId(posto.id)
    setPostoDialogApelido(posto.apelido)
    setPostoDialogTitularId(ocupanteMap.get(posto.id)?.id ?? null)
    setPostoDialogSearchTerm('')
    setPostoDialogTitularPickerOpen(false)
    setShowPostoDialog(true)
  }, [ocupanteMap])

  const closePostoDialog = useCallback((open: boolean) => {
    setShowPostoDialog(open)
    if (!open) resetPostoDialogState()
  }, [resetPostoDialogState])

  const moverPostoParaBancoEspera = useCallback(async (
    posto: Funcao,
    options?: {
      desanexarTitular?: boolean
      basePostosAtivos?: Funcao[]
      basePostosEspera?: Funcao[]
    },
  ) => {
    const shouldDesanexarTitular = options?.desanexarTitular ?? true
    const ocupanteAtual = shouldDesanexarTitular ? (ocupanteMap.get(posto.id) ?? null) : null
    const postosAtivosBase = options?.basePostosAtivos ?? postosAtivos
    const postosEsperaBase = options?.basePostosEspera ?? postosBancoEspera

    if (ocupanteAtual) {
      await colaboradoresService.atribuirPosto({
        colaborador_id: ocupanteAtual.id,
        funcao_id: null,
        estrategia: 'swap',
      })
    }

    const nextPostosAtivos = postosAtivosBase.filter((item) => item.id !== posto.id)
    const nextPostosEspera = [
      ...postosEsperaBase.filter((item) => item.id !== posto.id),
      { ...posto, ativo: false },
    ]

    await persistPostosBuckets(nextPostosAtivos, nextPostosEspera)
  }, [ocupanteMap, persistPostosBuckets, postosAtivos, postosBancoEspera])

  const ativarPostoBancoEspera = useCallback(async (posto: Funcao) => {
    const nextPostosAtivos = [...postosAtivos, { ...posto, ativo: true }]
    const nextPostosEspera = postosBancoEspera.filter((item) => item.id !== posto.id)
    await persistPostosBuckets(nextPostosAtivos, nextPostosEspera)
  }, [persistPostosBuckets, postosAtivos, postosBancoEspera])

  const resolveTipoContratoInternoPosto = useCallback((titularId: number | null, postoAtual: Funcao | null) => {
    const titularSelecionado = titularId != null
      ? (orderedColabs.find((colab) => colab.id === titularId) ?? null)
      : null

    return titularSelecionado?.tipo_contrato_id
      ?? postoAtual?.tipo_contrato_id
      ?? tiposContrato?.[0]?.id
      ?? null
  }, [orderedColabs, tiposContrato])

  const salvarTitularNoPosto = useCallback(async (posto: Funcao, titularId: number | null) => {
    const titularAtual = ocupanteMap.get(posto.id)
    const proximoTitular = titularId != null ? orderedColabs.find((colab) => colab.id === titularId) ?? null : null
    const postoOrigemProximoTitular = proximoTitular?.funcao_id != null && proximoTitular.funcao_id !== posto.id
      ? (postosOrdenados.find((item) => item.id === proximoTitular.funcao_id) ?? null)
      : null

    if (titularId == null && !titularAtual) {
      closeTitularPicker()
      return
    }

    setPostoAssignmentLoading(true)
    try {
      if (titularId == null) {
        await moverPostoParaBancoEspera(posto)
      } else {
        await colaboradoresService.atribuirPosto({
          colaborador_id: titularId,
          funcao_id: posto.id,
          estrategia: 'swap',
        })

        if (proximoTitular && proximoTitular.tipo_contrato_id !== posto.tipo_contrato_id) {
          await funcoesService.atualizar(posto.id, { tipo_contrato_id: proximoTitular.tipo_contrato_id })
        }

        if (postoOrigemProximoTitular) {
          await moverPostoParaBancoEspera(postoOrigemProximoTitular, { desanexarTitular: false })
        }
      }

      closeTitularPicker()

      if (titularId == null) {
        toast.success(`${posto.apelido} foi movido para o banco de espera`)
      } else if (proximoTitular) {
        toast.success(
          titularAtual?.id === proximoTitular.id
            ? `${proximoTitular.nome} permanece em ${posto.apelido}`
            : `${proximoTitular.nome} vinculado a ${posto.apelido}`,
        )
      } else {
        toast.success(`Titular salvo em ${posto.apelido}`)
      }
    } catch (err) {
      toast.error(mapError(err) || 'Erro ao salvar titular do posto')
    } finally {
      setPostoAssignmentLoading(false)
    }
  }, [closeTitularPicker, moverPostoParaBancoEspera, ocupanteMap, orderedColabs, postosOrdenados])

  const handleSelecionarNoAutocomplete = useCallback((source: 'picker' | 'dialog', postoId: number, colabId: number) => {
    const candidato = orderedColabs.find((c) => c.id === colabId)
    if (!candidato) return
    const postoDestinoNome = source === 'dialog' && postoId === 0
      ? (postoDialogApelido.trim() || 'novo posto')
      : (funcaoMap.get(postoId) ?? 'posto selecionado')
    if (candidato.funcao_id != null && candidato.funcao_id !== postoId) {
      setPendingAutocompleteSwap({
        source,
        postoId,
        colabId,
        colaboradorNome: candidato.nome,
        postoOrigemNome: funcaoMap.get(candidato.funcao_id) ?? 'posto atual',
        postoDestinoNome,
      })
      return
    }

    if (source === 'dialog') {
      setPostoDialogTitularId(colabId)
      return
    }

    const posto = postosOrdenados.find((item) => item.id === postoId)
    if (!posto) return
    void salvarTitularNoPosto(posto, colabId)
  }, [funcaoMap, orderedColabs, postoDialogApelido, postosOrdenados, salvarTitularNoPosto])

  const handleConfirmarAutocompleteSwap = useCallback(async () => {
    if (!pendingAutocompleteSwap) return

    if (pendingAutocompleteSwap.source === 'dialog') {
      setPostoDialogTitularId(pendingAutocompleteSwap.colabId)
      setPendingAutocompleteSwap(null)
      return
    }

    const posto = postosOrdenados.find((item) => item.id === pendingAutocompleteSwap.postoId)
    setPendingAutocompleteSwap(null)
    if (!posto) return
    await salvarTitularNoPosto(posto, pendingAutocompleteSwap.colabId)
  }, [pendingAutocompleteSwap, postosOrdenados, salvarTitularNoPosto])

  const getDescricaoBuscaColaborador = useCallback((colab: Colaborador) => {
    const postoAtual = colab.funcao_id != null ? (funcaoMap.get(colab.funcao_id) ?? 'Posto') : 'Reserva operacional'
    const contratoNome = contratoMap.get(colab.tipo_contrato_id) ?? 'Contrato'
    const status = getStatusColaborador(colab.id)
    return `${postoAtual} • ${contratoNome} • ${status}`
  }, [contratoMap, funcaoMap, getStatusColaborador])

  const postoDialogTitularAtual = useMemo(
    () => postoDialogTitularId != null ? (orderedColabs.find((colab) => colab.id === postoDialogTitularId) ?? null) : null,
    [orderedColabs, postoDialogTitularId],
  )

  // ─── Escala ──────────────────────────────────────────────────────────
  const escalasOrdenadas = useMemo(
    () => [...(escalas ?? [])].sort((a, b) => b.criada_em.localeCompare(a.criada_em)),
    [escalas],
  )
  const escalaOficialAtual = escalasOrdenadas.find((escala) => escala.status === 'OFICIAL') ?? null
  const escalasHistorico = useMemo(() => {
    const oficialAtualId = escalaOficialAtual?.id ?? null
    return escalasOrdenadas.filter((escala) => escala.status !== 'RASCUNHO' && escala.id !== oficialAtualId)
  }, [escalaOficialAtual?.id, escalasOrdenadas])

  type EscalaTab = 'simulacao' | 'oficial' | 'historico'

  const escalaTab: EscalaTab = escalaSelecionada.startsWith('historico:')
    ? 'historico'
    : (escalaSelecionada as EscalaTab)

  const activeEscalaCompleta: EscalaCompletaV3 | null =
    escalaTab === 'simulacao' ? escalaCompleta :
    escalaTab === 'oficial' ? oficialCompleta :
    historicoCompleta

  const exportColaboradoresBase = useMemo(() => {
    if (orderedColabs.length > 0) return orderedColabs
    return colaboradores ?? []
  }, [colaboradores, orderedColabs])

  const equipeEscalaSimulacao = useMemo(
    () => resolveEscalaEquipe(escalaCompleta, orderedColabs, postosOrdenados),
    [escalaCompleta, orderedColabs, postosOrdenados],
  )

  const equipeEscalaOficial = useMemo(
    () => resolveEscalaEquipe(oficialCompleta, orderedColabs, postosOrdenados),
    [oficialCompleta, orderedColabs, postosOrdenados],
  )

  const equipeEscalaHistorico = useMemo(
    () => resolveEscalaEquipe(historicoCompleta, orderedColabs, postosOrdenados),
    [historicoCompleta, orderedColabs, postosOrdenados],
  )

  const equipeEscalaExport = useMemo(
    () => resolveEscalaEquipe(exportDetalhe, exportColaboradoresBase, postosOrdenados),
    [exportColaboradoresBase, exportDetalhe, postosOrdenados],
  )

  const simulacaoPreviewMeses = useMemo(() => {
    if (periodoPreset === '6_MESES') return 6
    if (periodoPreset === '1_ANO') return 12
    return 3
  }, [periodoPreset])

  // Preview Nivel 1: grid T/F simples antes de rodar solver
  const previewNivel1 = useMemo(() => {
    if (escalaCompleta || carregandoTabEscala) return null
    if (setor?.regime_escala !== '5X2') return null
    if (!funcoesList.length || !orderedColabs.length) return null

    const DIAS_IDX: DiaSemana[] = ['SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB']
    const postosElegiveis = funcoesList
      .filter(f => f.ativo)
      .sort((a, b) => a.ordem - b.ordem)
      .map(f => {
        const titular = orderedColabs.find(c => c.funcao_id === f.id)
        return titular && (titular.tipo_trabalhador ?? 'CLT') !== 'INTERMITENTE'
          ? { funcao: f, titular }
          : null
      })
      .filter(Boolean) as Array<{ funcao: typeof funcoesList[0]; titular: typeof orderedColabs[0] }>

    if (postosElegiveis.length < 2) return null

    const N = postosElegiveis.length
    const kMaxSemTT = Math.floor(N / 2)
    const kDom = Math.max(0, ...(demandas ?? [])
      .filter(d => d.dia_semana === 'DOM' || d.dia_semana === null)
      .map(d => d.min_pessoas))
    const kReal = kDom > 0 ? kDom : sugerirK(N)
    const K = Math.min(kReal, kMaxSemTT)
    const kFoiLimitado = kReal > kMaxSemTT

    const folgasForcadas = postosElegiveis.map(p => {
      const regra = regrasPadrao?.find(r => r.colaborador_id === p.titular.id)
      const fixa = regra?.folga_fixa_dia_semana ?? null
      const variavel = regra?.folga_variavel_dia_semana ?? null
      return {
        folga_fixa_dia: fixa ? DIAS_IDX.indexOf(fixa) : null,
        folga_variavel_dia: variavel ? DIAS_IDX.indexOf(variavel as DiaSemana) : null,
      }
    })

    const output = gerarCicloFase1({
      num_postos: N,
      trabalham_domingo: K,
      num_meses: simulacaoPreviewMeses,
      preflight: true,
      folgas_forcadas: folgasForcadas.some(f => f.folga_fixa_dia != null || f.folga_variavel_dia != null)
        ? folgasForcadas : undefined,
    })

    if (!output.sucesso) return null
    return {
      ...converterNivel1ParaEscala(output, postosElegiveis, setorId, periodoGeracao),
      avisos: [
        ...(kFoiLimitado ? [`Demanda domingo = ${kReal}, mas maximo sem 2 domingos seguidos = ${kMaxSemTT} (com ${N} postos). Cobertura de domingo pode ficar abaixo da demanda.`] : []),
      ],
    }
  }, [escalaCompleta, carregandoTabEscala, setor, funcoesList, orderedColabs,
      demandas, regrasPadrao, periodoGeracao, setorId, simulacaoPreviewMeses])

  const simulacaoConfigBase = useMemo(
    () => normalizeSetorSimulacaoConfig(setor?.simulacao_config_json, { hasActivePostos: postosAtivos.length > 0 }),
    [postosAtivos.length, setor?.simulacao_config_json],
  )

  useEffect(() => {
    setSimulacaoConfigDraft(simulacaoConfigBase)
    setRawLivreN(String(simulacaoConfigBase.livre.n))
    setRawLivreK(String(simulacaoConfigBase.livre.k))
  }, [simulacaoConfigBase])

  const simulacaoConfig = simulacaoConfigDraft ?? simulacaoConfigBase

  const persistirSimulacaoConfig = useCallback(async (next: SetorSimulacaoConfig) => {
    setSimulacaoConfigSaving(true)
    try {
      await setoresService.salvarSimulacaoConfig(setorId, next)
    } catch (err) {
      toast.error(mapError(err) || 'Erro ao salvar configuracao da simulacao')
    } finally {
      setSimulacaoConfigSaving(false)
    }
  }, [setorId])

  const atualizarSimulacaoConfig = useCallback((updater: (prev: SetorSimulacaoConfig) => SetorSimulacaoConfig) => {
    setSimulacaoConfigDraft((prev) => {
      const base = prev ?? simulacaoConfigBase
      const next = normalizeSetorSimulacaoConfig(updater(base), { hasActivePostos: postosAtivos.length > 0 })
      void persistirSimulacaoConfig(next)
      return next
    })
  }, [persistirSimulacaoConfig, postosAtivos.length, simulacaoConfigBase])

  const demandaDomingoSetor = useMemo(
    () => Math.max(
      0,
      ...((demandas ?? [])
        .filter((demanda) => demanda.dia_semana === 'DOM' || demanda.dia_semana === null)
        .map((demanda) => demanda.min_pessoas)),
    ),
    [demandas],
  )

  const setorSimulacaoInfo = useMemo(() => {
    const N = postosAtivos.length
    if (N < 1) {
      return {
        n: 0,
        k: 0,
        origemN: 'N = 0 postos ativos.',
        origemK: 'Sem postos ativos: cadastre postos ou use o modo Livre.',
      }
    }

    // kMaxSemTT: maximo de pessoas no domingo sem 2 domingos seguidos (TT)
    const kMaxSemTT = Math.floor(N / 2)

    if (demandaDomingoSetor > 0) {
      const kEfetivo = Math.min(demandaDomingoSetor, kMaxSemTT)
      const limitado = kEfetivo < demandaDomingoSetor
      return {
        n: N,
        k: kEfetivo,
        origemN: `N pelo setor: ${N} posto(s) ativo(s).`,
        origemK: limitado
          ? `K: demanda DOM=${demandaDomingoSetor}, limitado a ${kEfetivo} (sem TT com ${N} postos).`
          : `K pelo setor: pico de demanda em DOM/padrao = ${demandaDomingoSetor}.`,
      }
    }

    const sugerido = sugerirK(N, 7)
    return {
      n: N,
      k: sugerido,
      origemN: `N pelo setor: ${N} posto(s) ativo(s).`,
      origemK: `Sem demanda DOM/padrao cadastrada: usando K sugerido ${sugerido}.`,
    }
  }, [demandaDomingoSetor, postosAtivos.length])

  const modoSimulacaoEfetivo: SetorSimulacaoMode = simulacaoConfig.mode

  const previewLivreFolgas = useMemo(
    () => Array.from({ length: simulacaoConfig.livre.n }, (_, idx) => simulacaoConfig.livre.folgas_forcadas[idx] ?? { fixa: null, variavel: null }),
    [simulacaoConfig.livre.folgas_forcadas, simulacaoConfig.livre.n],
  )

  const previewSetorRows = useMemo(() => {
    return postosAtivos.map((funcao) => {
      const titular = ocupanteMap.get(funcao.id) ?? null
      const regra = titular ? regrasMap.get(titular.id) ?? null : null
      const editada = folgasSetorEditadas.get(funcao.id)
      const fixaAtual = editada?.fixa ?? regra?.folga_fixa_dia_semana ?? null
      const variavelAtual = editada?.variavel ?? regra?.folga_variavel_dia_semana ?? null
      const bloqueio =
        titular && (titular.tipo_trabalhador ?? 'CLT') === 'INTERMITENTE'
          ? 'Intermitente'
          : fixaAtual === 'DOM'
            ? 'Folga fixa em DOM'
            : null

      return {
        funcao,
        titular,
        bloqueio,
        folgaForcada: {
          folga_fixa_dia: bloqueio ? null : diaSemanaParaIdxPreview(fixaAtual),
          folga_variavel_dia: bloqueio ? null : diaSemanaParaIdxPreview(variavelAtual),
        },
      }
    })
  }, [folgasSetorEditadas, ocupanteMap, postosAtivos, regrasMap])

  const rascunhoAtual = useMemo(
    () => escalasOrdenadas.find((escala) => escala.status === 'RASCUNHO') ?? null,
    [escalasOrdenadas],
  )

  const carregandoPreviewSimulacao = (
    carregandoSetor ||
    Boolean(
      escalaTab === 'simulacao' &&
      rascunhoAtual &&
      (
        carregandoTabEscala ||
        !escalaCompleta ||
        escalaCompleta.escala.id !== rascunhoAtual.id
      )
    )
  )

  const simulacaoPreview = useMemo(() => {
    const resultadoErro = (erro: string, sugestao?: string): SimulaCicloOutput => ({
      sucesso: false,
      erro,
      sugestao,
      grid: [],
      cobertura_dia: [],
      ciclo_semanas: 0,
      stats: {
        folgas_por_pessoa_semana: 0,
        cobertura_min: 0,
        cobertura_max: 0,
        h1_violacoes: 0,
        domingos_consecutivos_max: 0,
        sem_TT: false,
        sem_H1_violation: false,
      },
    })

    const effectiveN = modoSimulacaoEfetivo === 'SETOR' ? setorSimulacaoInfo.n : simulacaoConfig.livre.n
    const effectiveK = modoSimulacaoEfetivo === 'SETOR' ? setorSimulacaoInfo.k : simulacaoConfig.livre.k
    const rowLabels = modoSimulacaoEfetivo === 'SETOR'
      ? previewSetorRows.map((row) => row.titular?.nome ?? row.funcao.apelido)
      : Array.from({ length: simulacaoConfig.livre.n }, (_, idx) => `Pessoa ${idx + 1}`)
    const blockedRows = modoSimulacaoEfetivo === 'SETOR'
      ? previewSetorRows.flatMap((row, idx) => row.bloqueio ? [idx] : [])
      : []

    const folgasForcadas = modoSimulacaoEfetivo === 'SETOR'
      ? previewSetorRows.map((row) => row.folgaForcada)
      : previewLivreFolgas.map((folga) => ({
          folga_fixa_dia: diaSemanaParaIdxPreview(folga.fixa),
          folga_variavel_dia: diaSemanaParaIdxPreview(folga.variavel),
        }))

    const resultado = modoSimulacaoEfetivo === 'SETOR' && setor?.regime_escala !== '5X2'
      ? resultadoErro(
          'Preview Nível 1 disponível apenas para setores 5x2.',
          'Mude para o modo Livre para explorar o ciclo ou gere a escala real pelo solver.',
        )
      : gerarCicloFase1({
          num_postos: effectiveN,
          trabalham_domingo: effectiveK,
          num_meses: simulacaoPreviewMeses,
          preflight: true,
          folgas_forcadas: folgasForcadas.some((folga) => folga.folga_fixa_dia != null || folga.folga_variavel_dia != null)
            ? folgasForcadas
            : undefined,
        })

    const savePadrao = modoSimulacaoEfetivo === 'SETOR' && resultado.sucesso
      ? previewSetorRows.flatMap((row, idx) => {
          if (!row.titular || row.bloqueio) return []
          const previewRow = resultado.grid[idx]
          if (!previewRow) return []
          return [{
            colaborador_id: row.titular.id,
            folga_fixa_dia_semana: idxPreviewParaDiaSemana(previewRow.folga_fixa_dia),
            folga_variavel_dia_semana: idxPreviewParaDiaSemana(previewRow.folga_variavel_dia),
          }]
        })
      : []

    const pinnedRows = modoSimulacaoEfetivo === 'SETOR' && resultado.sucesso
      ? previewSetorRows.flatMap((row, idx) => row.titular && !row.bloqueio ? [{ rowIndex: idx, colaboradorId: row.titular.id }] : [])
      : []

    return {
      mode: modoSimulacaoEfetivo,
      effectiveN,
      effectiveK,
      rowLabels,
      blockedRows,
      resultado,
      origemN: modoSimulacaoEfetivo === 'SETOR'
        ? setorSimulacaoInfo.origemN
        : `N livre salvo neste setor: ${simulacaoConfig.livre.n}.`,
      origemK: modoSimulacaoEfetivo === 'SETOR'
        ? setorSimulacaoInfo.origemK
        : `K livre salvo neste setor: ${simulacaoConfig.livre.k}.`,
      savePadrao,
      pinnedRows,
      foraDoPreview: previewSetorRows.filter((row) => row.bloqueio).length,
      semTitular: previewSetorRows.filter((row) => !row.titular).length,
    }
  }, [modoSimulacaoEfetivo, previewLivreFolgas, previewSetorRows, setor?.regime_escala, setorSimulacaoInfo, simulacaoConfig.livre.k, simulacaoConfig.livre.n, simulacaoPreviewMeses])

  // ─── Form sync ───────────────────────────────────────────────────────
  useEffect(() => {
    if (setor) {
      setorForm.reset({
        nome: setor.nome,
        icone: setor.icone,
        hora_abertura: setor.hora_abertura,
        hora_fechamento: setor.hora_fechamento,
        regime_escala: setor.regime_escala,
      })
    }
  }, [setor, setorForm])

  useEffect(() => {
    setPeriodoGeracao(resolvePresetRange(periodoPreset, new Date(), inicioSemanaEscala))
  }, [periodoPreset, inicioSemanaEscala])

  useEffect(() => {
    setPreviewSelectedWeek(0)
  }, [cicloMode, modoSimulacaoEfetivo, simulacaoPreview.effectiveK, simulacaoPreview.effectiveN])

  // Fallback: se oficial sumir, volta para simulacao
  useEffect(() => {
    if (!escalaOficialAtual && escalaSelecionada === 'oficial') {
      setEscalaSelecionada('simulacao')
    }
  }, [escalaOficialAtual, escalaSelecionada])

  // Sincroniza historicoSelecionadaId com escalaSelecionada
  useEffect(() => {
    if (escalasHistorico.length === 0) {
      setHistoricoSelecionadaId(null)
      setHistoricoCompleta(null)
      if (escalaSelecionada.startsWith('historico:')) setEscalaSelecionada('simulacao')
      return
    }
    const match = escalaSelecionada.match(/^historico:(\d+)$/)
    if (match) {
      const id = parseInt(match[1], 10)
      if (escalasHistorico.some((e) => e.id === id)) {
        setHistoricoSelecionadaId(id)
        return
      }
    }
    setHistoricoSelecionadaId(escalasHistorico[0].id)
    setEscalaSelecionada(`historico:${escalasHistorico[0].id}`)
  }, [escalasHistorico, escalaSelecionada])

  const carregarDetalheEscala = useCallback(async (escalaId: number) => {
    try {
      return await escalasService.buscar(escalaId)
    } catch (err) {
      toast.error(mapError(err) || 'Erro ao carregar escala')
      return null
    }
  }, [])

  useEffect(() => {
    let canceled = false

    async function hydrateOfficialDetail() {
      if (!escalaOficialAtual) {
        setOficialCompleta(null)
        return
      }
      if (oficialCompleta?.escala.id === escalaOficialAtual.id) return

      const detail = await carregarDetalheEscala(escalaOficialAtual.id)
      if (!canceled) setOficialCompleta(detail)
    }

    void hydrateOfficialDetail()
    return () => {
      canceled = true
    }
  }, [carregarDetalheEscala, escalaOficialAtual, oficialCompleta?.escala.id])

  useEffect(() => {
    let canceled = false

    async function run() {
      if (escalaSelecionada === 'oficial') {
        if (!escalaOficialAtual) {
          setOficialCompleta(null)
          setCarregandoTabEscala(false)
          return
        }
        if (oficialCompleta?.escala.id === escalaOficialAtual.id) {
          setCarregandoTabEscala(false)
          return
        }
        setCarregandoTabEscala(true)
        const detail = await carregarDetalheEscala(escalaOficialAtual.id)
        if (!canceled) setOficialCompleta(detail)
        if (!canceled) setCarregandoTabEscala(false)
        return
      }

      if (escalaSelecionada.startsWith('historico:')) {
        if (!historicoSelecionadaId) {
          setHistoricoCompleta(null)
          setCarregandoTabEscala(false)
          return
        }
        setCarregandoTabEscala(true)
        const detail = await carregarDetalheEscala(historicoSelecionadaId)
        if (!canceled) setHistoricoCompleta(detail)
        if (!canceled) setCarregandoTabEscala(false)
        return
      }

      setCarregandoTabEscala(false)
    }

    void run()
    return () => {
      canceled = true
    }
  }, [carregarDetalheEscala, escalaOficialAtual, escalaSelecionada, historicoSelecionadaId, oficialCompleta?.escala.id])

  // ─── Handlers ────────────────────────────────────────────────────────
  // ─── Salvar tudo (form + demandas) ──────────────────────────────────
  const salvarDemandas = useCallback(async (draft: SemanaDraft) => {
    // Limpa entradas dia_semana=null (padrao legado) para evitar double-counting no solver
    await setoresService.limparPadraoDemandas(setorId)
    for (const dia of DIAS_SEMANA) {
      const dd = draft.dias[dia]
      const usaPadrao = dd.usa_padrao
      await setoresService.salvarTimelineDia({
        setor_id: setorId,
        dia_semana: dia,
        ativo: dd.ativo,
        usa_padrao: usaPadrao,
        hora_abertura: usaPadrao ? draft.padrao.hora_abertura : dd.hora_abertura,
        hora_fechamento: usaPadrao ? draft.padrao.hora_fechamento : dd.hora_fechamento,
        segmentos: (usaPadrao ? draft.padrao.segmentos : dd.segmentos).map((s) => ({
          hora_inicio: s.hora_inicio,
          hora_fim: s.hora_fim,
          min_pessoas: s.min_pessoas,
          override: s.override,
        })),
      })
    }
  }, [setorId])

  const handleSalvarTudo = useCallback(async () => {
    const formData = setorForm.getValues()
    const nome = formData.nome.trim()
    if (!nome) {
      toast.error('Nome do setor e obrigatorio')
      return
    }
    setSalvandoTudo(true)
    try {
      // 1. Salva form do setor
      await setoresService.atualizar(setorId, {
        nome,
        icone: formData.icone ?? null,
        hora_abertura: formData.hora_abertura,
        hora_fechamento: formData.hora_fechamento,
        regime_escala: formData.regime_escala,
      })
      // 2. Salva demandas (7 dias)
      const draft = demandaEditorRef.current?.getDraft()
      if (draft) {
        await salvarDemandas(draft)
        demandaEditorRef.current?.markClean()
      }
      // Marca form como clean
      setorForm.reset(formData)
      toast.success('Setor salvo')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao salvar')
    } finally {
      setSalvandoTudo(false)
    }
  }, [setorId, setorForm, salvarDemandas])

  // ─── Protecao: aviso ao fechar app com alteracoes ──────────────────
  useEffect(() => {
    if (!isDirty) return
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [isDirty])

  const handleSalvarExcDemanda = async () => {
    if (!excDemandaForm.data || !excDemandaForm.hora_inicio || !excDemandaForm.hora_fim) {
      toast.error('Preencha data, hora inicio e hora fim')
      return
    }
    setExcDemandaSalvando(true)
    try {
      const created = await setoresService.salvarDemandaExcecaoData({
        setor_id: setorId,
        data: excDemandaForm.data,
        hora_inicio: excDemandaForm.hora_inicio,
        hora_fim: excDemandaForm.hora_fim,
        min_pessoas: excDemandaForm.min_pessoas,
        override: excDemandaForm.override,
      })
      setDemandasExcecao((prev) => [...prev, created])
      setShowExcDemandaDialog(false)
      setExcDemandaForm({ data: '', hora_inicio: '', hora_fim: '', min_pessoas: 1, override: false })
      toast.success('Excecao de demanda salva')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao salvar excecao de demanda')
    } finally {
      setExcDemandaSalvando(false)
    }
  }

  const handleDeletarExcDemanda = async (excId: number) => {
    try {
      await setoresService.deletarDemandaExcecaoData(excId)
      setDemandasExcecao((prev) => prev.filter((e) => e.id !== excId))
      toast.success('Excecao removida')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao remover excecao')
    }
  }

  const handleArquivar = async () => {
    try {
      await setoresService.atualizar(setorId, { ativo: false })
      toast.success('Setor arquivado')
      navigate('/setores')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao arquivar setor')
    }
  }

  const handleMudarModoSimulacao = useCallback((mode: SetorSimulacaoMode) => {
    if (mode === simulacaoConfig.mode) return
    setPreviewSelectedWeek(0)
    if (mode === 'LIVRE') {
      setRawLivreN(String(simulacaoConfig.livre.n))
      setRawLivreK(String(simulacaoConfig.livre.k))
    }
    atualizarSimulacaoConfig((prev) => ({ ...prev, mode }))
  }, [atualizarSimulacaoConfig, simulacaoConfig.livre.k, simulacaoConfig.livre.n, simulacaoConfig.mode])

  const handleLivreNChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value
    setRawLivreN(raw)
    if (raw === '') return
    const val = parseInt(raw, 10)
    if (Number.isNaN(val) || val < 1) return
    const nextN = Math.max(1, Math.min(val, 99))
    const nextK = sugerirK(nextN, 7)
    setRawLivreN(String(nextN))
    setRawLivreK(String(nextK))
    atualizarSimulacaoConfig((prev) => ({
      ...prev,
      livre: {
        n: nextN,
        k: nextK,
        folgas_forcadas: prev.livre.folgas_forcadas.slice(0, nextN),
      },
    }))
  }, [atualizarSimulacaoConfig])

  const handleLivreKChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value
    setRawLivreK(raw)
    if (raw === '') return
    const val = parseInt(raw, 10)
    if (Number.isNaN(val) || val < 0) return
    const nextK = Math.max(0, Math.min(val, simulacaoConfig.livre.n))
    setRawLivreK(String(nextK))
    atualizarSimulacaoConfig((prev) => ({
      ...prev,
      livre: {
        ...prev.livre,
        k: nextK,
      },
    }))
  }, [atualizarSimulacaoConfig, simulacaoConfig.livre.n])

  const handleResetarSimulacao = useCallback(() => {
    setPreviewSelectedWeek(0)
    if (simulacaoPreview.mode === 'LIVRE') {
      const nextK = sugerirK(DEFAULT_SIMULACAO_LIVRE_N, 7)
      setRawLivreN(String(DEFAULT_SIMULACAO_LIVRE_N))
      setRawLivreK(String(nextK))
      atualizarSimulacaoConfig((prev) => ({
        ...prev,
        livre: {
          n: DEFAULT_SIMULACAO_LIVRE_N,
          k: nextK,
          folgas_forcadas: [],
        },
      }))
      return
    }

    setFolgasSetorEditadas(new Map())
    // Forçar re-render da config persistida (limpar folgas_setor no banco)
    atualizarSimulacaoConfig((prev) => ({
      ...prev,
      folgas_setor: {},
    }))
  }, [atualizarSimulacaoConfig, simulacaoPreview.mode])

  const handlePreviewFolgaChange = useCallback((rowIndex: number, field: 'fixa' | 'variavel', value: DiaSemana | null) => {
    if (simulacaoPreview.mode === 'LIVRE') {
      const nextFolgas = Array.from(
        { length: simulacaoConfig.livre.n },
        (_, idx) => simulacaoConfig.livre.folgas_forcadas[idx] ?? { fixa: null, variavel: null },
      )
      const current = nextFolgas[rowIndex] ?? { fixa: null, variavel: null }
      nextFolgas[rowIndex] = {
        ...current,
        [field]: value,
      }
      atualizarSimulacaoConfig((prev) => ({
        ...prev,
        livre: {
          ...prev.livre,
          folgas_forcadas: nextFolgas,
        },
      }))
      return
    }

    const row = previewSetorRows[rowIndex]
    if (!row) return
    setFolgasSetorEditadas((prev) => {
      const next = new Map(prev)
      const current = next.get(row.funcao.id) ?? { fixa: null, variavel: null }
      next.set(row.funcao.id, {
        ...current,
        [field]: value,
      })
      return next
    })
  }, [atualizarSimulacaoConfig, previewSetorRows, simulacaoConfig.livre.folgas_forcadas, simulacaoConfig.livre.n, simulacaoPreview.mode])

  // ─── Geracao inline ──────────────────────────────────────────────────
  const handleGerar = async () => {
    const dataInicio = periodoGeracao.data_inicio
    const dataFim = periodoGeracao.data_fim
    if (!dataInicio || !dataFim) {
      toast.error('Defina data inicial e final antes de gerar')
      return
    }
    if (dataInicio > dataFim) {
      toast.error('A data final precisa ser maior ou igual a data inicial')
      return
    }

    // Salva tudo antes de gerar (garante que demandas estao no banco)
    if (isDirty) {
      try {
        await handleSalvarTudo()
      } catch {
        toast.error('Erro ao salvar antes de gerar. Tente salvar manualmente.')
        return
      }
    }

    // Preflight
    setAvisosOperacao([]) // limpa avisos anteriores
    try {
      const preflight = await escalasService.preflight(setorId, { data_inicio: dataInicio, data_fim: dataFim })
      if (!preflight.ok) {
        const blockerAvisos: AvisoEscala[] = preflight.blockers.map((b, i) => ({
          id: `preflight_${i}`,
          nivel: 'erro' as const,
          titulo: b.mensagem,
          detalhe: b.detalhe ?? undefined,
          origem: 'operacao' as const,
        }))
        setAvisosOperacao(blockerAvisos)
        const msg = preflight.blockers.map((b) => b.mensagem).join(' | ') || 'Preflight bloqueou a geracao'
        toastInfeasible(msg, () => useIaStore.getState().setAberto(true))
        return
      }
    } catch (err) {
      toastErroGeracaoEscala(err)
      return
    }

    setSolverLogs([])
    setGerando(true)
    try {
      const rulesOverride = Object.keys(solverSessionConfig.rulesOverride).length > 0
        ? solverSessionConfig.rulesOverride
        : undefined
      const result = await escalasService.gerar(setorId, {
        data_inicio: dataInicio,
        data_fim: dataFim,
        solveMode: solverSessionConfig.solveMode,
        maxTimeSeconds: solverSessionConfig.maxTimeSeconds,
        rulesOverride,
      })
      setEscalaCompleta(result)
      toast.success('Escala gerada')
    } catch (err) {
      const rawMsg = err instanceof Error ? err.message : String(err)

      // Try to parse structured INFEASIBLE error before mapError destroys the JSON
      let parsed: InfeasibleError | null = null
      try {
        const obj = JSON.parse(rawMsg)
        if (obj?.tipo === 'INFEASIBLE') parsed = obj as InfeasibleError
      } catch { /* not structured JSON, fall through */ }

      if (parsed) {
        const solverAvisos: AvisoEscala[] = [{
          id: 'solver_infeasible',
          nivel: 'erro' as const,
          titulo: parsed.mensagem,
          detalhe: parsed.diagnostico_resumido ?? undefined,
          origem: 'operacao' as const,
        }]
        if (parsed.sugestoes?.length) {
          parsed.sugestoes.forEach((s, i) => solverAvisos.push({
            id: `solver_sugestao_${i}`,
            nivel: 'aviso' as const,
            titulo: s,
            origem: 'operacao' as const,
          }))
        }
        setAvisosOperacao(solverAvisos)
        toastInfeasible(parsed.mensagem, () => useIaStore.getState().setAberto(true))
      } else if (!rawMsg.includes('cancelado') && !rawMsg.includes('SIGTERM') && !rawMsg.includes('killed')) {
        toastErroGeracaoEscala(err)
      }
    } finally {
      setGerando(false)
    }
  }

  const handleOficializar = async () => {
    if (!escalaCompleta) return
    setOficializando(true)
    try {
      await escalasService.oficializar(escalaCompleta.escala.id)
      const detalheOficial = await escalasService.buscar(escalaCompleta.escala.id)
      setOficialCompleta(detalheOficial)
      setEscalaSelecionada('oficial')
      toast.success('Escala oficializada')
      setEscalaCompleta(null)
    } catch (err) {
      const msg = mapError(err) || 'Erro ao oficializar'
      if (msg.includes('ESCALA_DESATUALIZADA')) {
        toastErroGeracaoEscala(new Error('Escala desatualizada — gere novamente.'))
      } else {
        toastErroGeracaoEscala(err)
      }
    } finally {
      setOficializando(false)
    }
  }

  const handleDescartar = async () => {
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

  const hasConteudoSetorial = useCallback((conteudo: EscalaExportContent) => {
    return conteudo.ciclo || conteudo.timeline || conteudo.avisos
  }, [])

  const appVersion = useAppVersion()
  const buildHTMLFuncionario = useCallback((detalhe: EscalaCompletaV3, colabId: number, incluirAvisos: boolean) => {
    if (!setor || !tiposContrato) return null
    const equipeEscala = resolveEscalaEquipe(detalhe, exportColaboradoresBase, postosOrdenados)
    const colab = equipeEscala.colaboradores.find((c) => c.id === colabId)
    if (!colab) return null
    const tc = tiposContrato.find((t) => t.id === colab.tipo_contrato_id)
    const regra = regrasMap.get(colabId)
    const html = gerarHTMLFuncionario({
      nome: colab.nome,
      contrato: tc?.nome ?? '',
      horasSemanais: tc?.horas_semanais ?? colab.horas_semanais,
      setor: setor.nome,
      periodo: { inicio: detalhe.escala.data_inicio, fim: detalhe.escala.data_fim },
      alocacoes: detalhe.alocacoes.filter((a) => a.colaborador_id === colabId),
      violacoes: incluirAvisos ? detalhe.violacoes.filter((v) => v.colaborador_id === colabId) : [],
      regra: regra ? { folga_fixa_dia_semana: regra.folga_fixa_dia_semana ?? null, folga_variavel_dia_semana: regra.folga_variavel_dia_semana ?? null } : undefined,
      version: appVersion ?? undefined,
    })
    return { html, colaboradorNome: colab.nome }
  }, [appVersion, exportColaboradoresBase, postosOrdenados, regrasMap, setor, tiposContrato])

  const renderExportSetorial = useCallback((detalhe: EscalaCompletaV3 | null, conteudo: EscalaExportContent) => {
    if (!detalhe || !setor || !colaboradores) return
    if (!hasConteudoSetorial(conteudo)) return null
    const modo: 'ciclo' | 'detalhado' = conteudo.timeline ? 'detalhado' : 'ciclo'
    const equipeEscala = resolveEscalaEquipe(detalhe, exportColaboradoresBase, postosOrdenados)
    return {
      modo,
      jsx: (
        <ExportarEscala
          escala={detalhe.escala}
          alocacoes={detalhe.alocacoes}
          colaboradores={equipeEscala.colaboradores}
          setor={setor}
          violacoes={detalhe.violacoes}
          tiposContrato={tiposContrato ?? []}
          funcoes={equipeEscala.funcoes}
          horariosSemana={horariosSemana ?? []}
          regrasPadrao={regrasPadrao ?? []}
          modo={modo}
          incluirAvisos={conteudo.avisos}
          incluirCiclo={conteudo.ciclo}
          incluirTimeline={conteudo.timeline}
          modoRender="download"
        />
      ),
    }
  }, [colaboradores, exportColaboradoresBase, hasConteudoSetorial, horariosSemana, postosOrdenados, regrasPadrao, setor, tiposContrato])

  const handleExportarHTML = async (detalhe: EscalaCompletaV3 | null, conteudo: EscalaExportContent) => {
    const payload = renderExportSetorial(detalhe, conteudo)
    if (!payload || !setor) {
      toast.error('Selecione Ciclo e/ou Timeline para exportar HTML setorial.')
      return
    }
    const { renderToStaticMarkup } = await import('react-dom/server')
    const html = renderToStaticMarkup(payload.jsx)
    const fullHTML = buildStandaloneHtml(html, {
      title: `Escala - ${setor.nome}`,
    })
    const slug = setor.nome.toLowerCase().replace(/\s+/g, '-')
    const prefix = payload.modo === 'ciclo' ? 'escala-ciclo' : 'escala-detalhada'
    try {
      const result = await exportarService.salvarHTML(fullHTML, `${prefix}-${slug}.html`)
      if (result) toast.success(payload.modo === 'detalhado' ? 'HTML detalhado salvo com sucesso' : 'HTML salvo com sucesso')
    } catch {
      toast.error(payload.modo === 'detalhado' ? 'Erro ao exportar HTML detalhado' : 'Erro ao exportar HTML')
    }
  }

  const handleImprimirHTML = async (detalhe: EscalaCompletaV3 | null, conteudo: EscalaExportContent) => {
    const payload = renderExportSetorial(detalhe, conteudo)
    if (!payload || !setor) {
      toast.error('Selecione Ciclo e/ou Timeline para imprimir.')
      return
    }
    if (!detalhe || !setor || !colaboradores) return
    const printWindow = window.open('', '_blank')
    if (!printWindow) {
      toast.error('Bloqueio de popup detectado. Permita popups para imprimir.')
      return
    }
    const { renderToStaticMarkup } = await import('react-dom/server')
    const html = renderToStaticMarkup(payload.jsx)
    const fullHTML = buildStandaloneHtml(html, {
      title: `Escala - ${setor.nome}`,
    })
    printWindow.document.write(fullHTML)
    printWindow.document.close()
    printWindow.focus()
    setTimeout(() => printWindow.print(), 250)
  }

  const handleExportarCSV = async (detalhe: EscalaCompletaV3 | null, conteudo: EscalaExportContent) => {
    if (!detalhe || !setor || !colaboradores) return
    const equipeEscala = resolveEscalaEquipe(detalhe, exportColaboradoresBase, postosOrdenados)
    const blocos: string[] = []
    const incluirEscala = conteudo.ciclo || conteudo.timeline || conteudo.funcionarios
    if (incluirEscala) {
      blocos.push(gerarCSVAlocacoes([detalhe], [setor], equipeEscala.colaboradores))
      blocos.push(gerarCSVComparacaoDemanda([detalhe], [setor]))
    }
    if (conteudo.avisos) {
      blocos.push(gerarCSVViolacoes([detalhe], [setor]))
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

  const handleExportarFuncionariosBatch = async (detalhe: EscalaCompletaV3 | null, incluirAvisos: boolean) => {
    if (!detalhe) return
    const equipeEscala = resolveEscalaEquipe(detalhe, exportColaboradoresBase, postosOrdenados)
    const arquivos = equipeEscala.colaboradores
      .map((colab) => {
        const payload = buildHTMLFuncionario(detalhe, colab.id, incluirAvisos)
        if (!payload) return null
        return { nome: payload.colaboradorNome.replace(/\s+/g, '_'), html: payload.html }
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

  const abrirModalExportacao = (detalhe: EscalaCompletaV3 | null) => {
    if (!detalhe) return
    setExportDetalhe(detalhe)
    setExportOpen(true)
  }

  const handleExportFromModal = async () => {
    if (!exportDetalhe) return
    const incluirSetorial = hasConteudoSetorial(conteudoExport)
    const incluirFuncionarios = conteudoExport.funcionarios
    if (!incluirSetorial && !incluirFuncionarios) {
      toast.error('Ative Ciclo, Timeline ou Por funcionario para exportar HTML.')
      return
    }
    if (incluirSetorial) {
      await handleExportarHTML(exportDetalhe, conteudoExport)
    }
    if (incluirFuncionarios) {
      await handleExportarFuncionariosBatch(exportDetalhe, conteudoExport.avisos)
    }
    setExportOpen(false)
  }

  const handlePrintFromModal = async () => {
    if (!exportDetalhe) return
    if (hasConteudoSetorial(conteudoExport)) {
      await handleImprimirHTML(exportDetalhe, conteudoExport)
      setExportOpen(false)
      return
    }
    if (conteudoExport.funcionarios) {
      toast.error('Impressao por funcionario em lote nao esta disponivel. Use Baixar HTML.')
      return
    }
    toast.error('Ative Ciclo e/ou Timeline para imprimir.')
  }

  const handleCSVFromModal = async () => {
    await handleExportarCSV(exportDetalhe, conteudoExport)
    setExportOpen(false)
  }

  const renderExportPreview = () => {
    if (!exportDetalhe || !setor || !colaboradores) return null
    const incluirSetorial = hasConteudoSetorial(conteudoExport)
    return (
      <div className="space-y-3">
        {incluirSetorial ? (
          <ExportarEscala
            escala={exportDetalhe.escala}
            alocacoes={exportDetalhe.alocacoes}
            colaboradores={equipeEscalaExport.colaboradores}
            setor={setor}
            violacoes={exportDetalhe.violacoes}
            tiposContrato={tiposContrato ?? []}
            funcoes={equipeEscalaExport.funcoes}
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
              Serao gerados arquivos para todos os {equipeEscalaExport.colaboradores.length} funcionario(s) do setor.
            </p>
          </div>
        )}
      </div>
    )
  }

  // Auto-load escala mais recente (por criada_em, independente de status)
  useEffect(() => {
    if (!escalas?.length || escalaCompleta) return
    const maisRecente = [...escalas].sort((a, b) => b.criada_em.localeCompare(a.criada_em))[0]
    if (!maisRecente) return
    const valor = maisRecente.status === 'RASCUNHO'
      ? 'simulacao'
      : maisRecente.status === 'OFICIAL'
        ? 'oficial'
        : `historico:${maisRecente.id}`
    setEscalaSelecionada(valor)
    if (maisRecente.status === 'RASCUNHO') {
      setCarregandoTabEscala(true)
      escalasService.buscar(maisRecente.id)
        .then(setEscalaCompleta)
        .catch(() => {})
        .finally(() => setCarregandoTabEscala(false))
    }
  }, [escalas]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleSalvarPostoDialog = async () => {
    if (!postoDialogApelido.trim()) {
      toast.error('Informe o nome do posto')
      return
    }

    setSalvandoPosto(true)
    try {
      const postoAtual = postoDialogMode === 'edit' && postoDialogPostoId != null
        ? (postosOrdenados.find((posto) => posto.id === postoDialogPostoId) ?? null)
        : null
      const titularAtualId = postoAtual ? (ocupanteMap.get(postoAtual.id)?.id ?? null) : null
      const proximoTitular = postoDialogTitularId != null
        ? (orderedColabs.find((colab) => colab.id === postoDialogTitularId) ?? null)
        : null
      const postoOrigemProximoTitular = proximoTitular?.funcao_id != null
        ? (postosOrdenados.find((posto) => posto.id === proximoTitular.funcao_id) ?? null)
        : null
      const tipoContratoInterno = resolveTipoContratoInternoPosto(postoDialogTitularId, postoAtual)
      const deveIrParaEsperaNoCreate = postoDialogMode === 'create' && postoDialogTitularId == null
      const deveMoverParaEspera = postoDialogMode === 'edit' && titularAtualId != null && postoDialogTitularId == null
      const deveFicarAtivo = postoDialogMode === 'create'
        ? !deveIrParaEsperaNoCreate
        : (postoAtual?.ativo ?? true)
      const ordemDestino = postoDialogMode === 'create'
        ? (deveFicarAtivo ? postosAtivos.length : postosOrdenados.length)
        : (postoAtual?.ordem ?? postosOrdenados.length)

      if (!tipoContratoInterno) {
        toast.error('Cadastre ao menos um tipo de contrato antes de criar postos')
        return
      }

      let postoSalvo = postoDialogMode === 'create'
        ? await funcoesService.criar({
          setor_id: setorId,
          apelido: postoDialogApelido.trim(),
          tipo_contrato_id: tipoContratoInterno,
          ordem: ordemDestino,
        })
        : await funcoesService.atualizar(postoDialogPostoId!, {
          apelido: postoDialogApelido.trim(),
          ativo: deveFicarAtivo,
          ordem: ordemDestino,
          ...(tipoContratoInterno !== postoAtual?.tipo_contrato_id
            ? { tipo_contrato_id: tipoContratoInterno }
            : {}),
        })

      if (postoDialogMode === 'create') {
        if (deveIrParaEsperaNoCreate) {
          await persistPostosBuckets(postosAtivos, [...postosBancoEspera, { ...postoSalvo, ativo: false }])
          postoSalvo = { ...postoSalvo, ativo: false, ordem: postosAtivos.length + postosBancoEspera.length }
        } else {
          await persistPostosBuckets([...postosAtivos, { ...postoSalvo, ativo: true }], postosBancoEspera)
          postoSalvo = { ...postoSalvo, ativo: true, ordem: postosAtivos.length }
        }
      }

      if (postoDialogTitularId !== titularAtualId) {
        if (deveMoverParaEspera) {
          await moverPostoParaBancoEspera(postoSalvo)
        } else if (postoDialogTitularId != null) {
          await colaboradoresService.atribuirPosto({
            colaborador_id: postoDialogTitularId,
            funcao_id: postoSalvo.id,
            estrategia: 'swap',
          })

          if (postoOrigemProximoTitular && postoOrigemProximoTitular.id !== postoSalvo.id) {
            const basePostosAtivos = postoDialogMode === 'create'
              ? [...postosAtivos, { ...postoSalvo, ativo: true }]
              : postosAtivos.map((posto) => posto.id === postoSalvo.id ? { ...posto, ...postoSalvo, ativo: true } : posto)
            await moverPostoParaBancoEspera(postoOrigemProximoTitular, {
              desanexarTitular: false,
              basePostosAtivos,
              basePostosEspera: postosBancoEspera,
            })
          }
        }
      }

      closePostoDialog(false)
      toast.success(
        postoDialogMode === 'create'
          ? (deveIrParaEsperaNoCreate ? 'Posto criado no banco de espera' : 'Posto criado')
          : (deveMoverParaEspera ? 'Posto movido para o banco de espera' : 'Posto atualizado'),
      )
    } catch (err) {
      toast.error(mapError(err) || 'Erro ao salvar posto')
    } finally {
      setSalvandoPosto(false)
    }
  }

  const handleMoverPostoDialogParaEspera = async () => {
    if (postoDialogPostoId == null) return
    const posto = postosOrdenados.find((item) => item.id === postoDialogPostoId)
    if (!posto) return

    setSalvandoPosto(true)
    try {
      await moverPostoParaBancoEspera(posto)
      closePostoDialog(false)
      toast.success(`${posto.apelido} foi movido para o banco de espera`)
    } catch (err) {
      toast.error(mapError(err) || 'Erro ao mover posto para o banco de espera')
    } finally {
      setSalvandoPosto(false)
    }
  }

  const handleAtivarPostoEspera = async (posto: Funcao) => {
    setPostoAssignmentLoading(true)
    try {
      await ativarPostoBancoEspera(posto)
      toast.success(`${posto.apelido} voltou para a hierarquia ativa`)
    } catch (err) {
      toast.error(mapError(err) || 'Erro ao ativar posto')
    } finally {
      setPostoAssignmentLoading(false)
    }
  }

  const handleDeletarPostoEspera = async (posto: Funcao) => {
    setDeletandoPosto(true)
    try {
      await funcoesService.deletar(posto.id)
      toast.success('Posto removido')
    } catch (err) {
      toast.error(mapError(err) || 'Erro ao remover posto')
    } finally {
      setDeletandoPosto(false)
    }
  }

  // ─── Loading / Not Found ─────────────────────────────────────────────
  if (carregandoSetor) {
    return (
      <div className="flex flex-1 flex-col">
        <PageHeader breadcrumbs={[{ label: 'Dashboard', href: '/' }, { label: 'Setores', href: '/setores' }, { label: '...' }]} />
        <div className="flex flex-1 items-center justify-center">
          <p className="text-sm text-muted-foreground">Carregando...</p>
        </div>
      </div>
    )
  }

  if (!setor) {
    return (
      <div className="flex flex-1 flex-col">
        <PageHeader breadcrumbs={[{ label: 'Dashboard', href: '/' }, { label: 'Setores', href: '/setores' }, { label: 'Nao encontrado' }]} />
        <div className="flex flex-1 items-center justify-center">
          <p className="text-sm text-muted-foreground">Setor nao encontrado</p>
        </div>
      </div>
    )
  }

  // ─── Render ──────────────────────────────────────────────────────────
  return (
    <div className="flex flex-1 flex-col">
      <PageHeader
        breadcrumbs={[
          { label: 'Dashboard', href: '/' },
          { label: 'Setores', href: '/setores' },
          { label: setor.nome },
        ]}
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant={isDirty ? 'default' : 'outline'}
              size="sm"
              onClick={handleSalvarTudo}
              disabled={salvandoTudo || isPreviewMode}
              title={isPreviewMode ? 'Saia da visualizacao para editar' : undefined}
            >
              {salvandoTudo ? (
                <Loader2 className="mr-1 size-3.5 animate-spin" />
              ) : isDirty ? (
                <Save className="mr-1 size-3.5" />
              ) : (
                <Check className="mr-1 size-3.5" />
              )}
              {salvandoTudo ? 'Salvando...' : isDirty ? 'Salvar' : 'Salvo'}
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" size="sm" className="text-destructive hover:bg-destructive/5" disabled={isPreviewMode}>
                  <Archive className="mr-1 size-3.5" />
                  Arquivar
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Arquivar setor?</AlertDialogTitle>
                  <AlertDialogDescription>
                    O setor {setor.nome} tem {orderedColabs.length} colaboradores.
                    Eles nao entrarao em novas escalas enquanto o setor estiver arquivado.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                  <AlertDialogAction onClick={handleArquivar}>Arquivar</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        }
      />

      <div className="flex flex-1 flex-col gap-6 p-6">
        {/* Info basica */}
        <Form {...setorForm}>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold">
                Informacoes do Setor
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormField
                control={setorForm.control}
                name="nome"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nome</FormLabel>
                    <div className="flex gap-2">
                      <IconPicker
                        value={setorForm.watch('icone') ?? null}
                        onChange={(v) => {
                          setorForm.setValue('icone', v, { shouldDirty: true })
                        }}
                      />
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <FormField
                  control={setorForm.control}
                  name="hora_abertura"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Hora de Abertura</FormLabel>
                      <FormControl>
                        <Input type="time" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={setorForm.control}
                  name="hora_fechamento"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Hora de Fechamento</FormLabel>
                      <FormControl>
                        <Input type="time" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={setorForm.control}
                  name="regime_escala"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Regime Padrao</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="5X2">5x2 (5 dias + 2 folgas)</SelectItem>
                          <SelectItem value="6X1">6x1 (6 dias + 1 folga)</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </CardContent>
          </Card>
        </Form>

        <div className="space-y-4">
          <Collapsible defaultOpen className="group/equipe">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-3">
                <CollapsibleTrigger className="flex items-center gap-2 text-base font-semibold hover:underline">
                  <ChevronDown className="size-4 transition-transform group-data-[state=closed]/equipe:-rotate-90" />
                  Equipe
                </CollapsibleTrigger>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={openCreatePostoDialog}>
                    <Plus className="mr-1 size-3.5" /> Novo Posto
                  </Button>
                  <Button variant="outline" size="sm" asChild>
                    <Link to="/colaboradores">
                      <Users className="mr-1 size-3.5" /> Gerenciar
                    </Link>
                  </Button>
                </div>
              </CardHeader>
              <CollapsibleContent>
                <CardContent className="space-y-4">
                  {orderedColabs.length === 0 && (
                    <div className="rounded-md border border-dashed bg-muted/20 px-4 py-3 text-sm text-muted-foreground">
                      Nenhum colaborador vinculado a este setor.
                    </div>
                  )}

                  {colabsSemPosto.length > 0 && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Reserva operacional</p>
                        <span className="text-xs text-muted-foreground">{colabsSemPosto.length}</span>
                      </div>
                      <div className="flex flex-wrap gap-1.5 rounded-md border border-dashed bg-muted/20 p-2">
                        {colabsSemPosto.map((colab) => (
                          <Link key={colab.id} to={`/colaboradores/${colab.id}`}>
                            <Badge variant="secondary" className="cursor-pointer gap-1 text-xs hover:bg-secondary/80">
                              {colab.nome}
                              <ArrowRight className="size-3" />
                            </Badge>
                          </Link>
                        ))}
                      </div>
                    </div>
                  )}

                  {colabsSemPosto.length > 0 && <div className="h-px bg-border" />}

                  <div className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Postos
                      <span className="ml-2 inline-flex items-center gap-1 text-xs font-normal normal-case tracking-normal text-muted-foreground/70">
                        <GripVertical className="size-3.5" />
                        hierarquia de decisao - arraste para reordenar
                      </span>
                    </p>

                    {postosAtivos.length === 0 ? (
                      <div className="rounded-md border border-dashed px-4 py-3 text-sm text-muted-foreground">
                        Nenhum posto na hierarquia no momento.
                      </div>
                    ) : (
                      <DndContext
                        sensors={postoSortSensors}
                        collisionDetection={closestCenter}
                        onDragEnd={(event) => { void handlePostoReorderDragEnd(event) }}
                      >
                        <div className="rounded-md border">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead className="w-[60px] text-center">#</TableHead>
                                <TableHead className="w-[120px]">Posto</TableHead>
                                <TableHead>Titular</TableHead>
                                <TableHead className="w-[84px] text-center">Variavel</TableHead>
                                <TableHead className="w-[70px] text-center">Fixo</TableHead>
                                <TableHead className="w-[110px]">Contrato</TableHead>
                                <TableHead className="w-[60px]">Sexo</TableHead>
                                <TableHead className="w-[100px]">Status</TableHead>
                                <TableHead className="w-[120px] text-right">Acoes</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              <SortableContext
                                items={postosAtivos.map((posto) => `posto-${posto.id}`)}
                                strategy={verticalListSortingStrategy}
                              >
                                {postosAtivos.map((posto, index) => {
                                  const ocupante = ocupanteMap.get(posto.id)
                                  const contratoNome = ocupante
                                    ? (contratoMap.get(ocupante.tipo_contrato_id) ?? 'Contrato')
                                    : '-'
                                  const status = ocupante ? getStatusColaborador(ocupante.id) : '-'
                                  const folgas = ocupante ? folgasEquipeMap.get(ocupante.id) : null
                                  const pickerAberto = titularPickerPostoId === posto.id

                                  return (
                                    <SortablePostoRow key={posto.id} postoId={posto.id} index={index}>
                                      <TableCell className="font-medium">{posto.apelido}</TableCell>
                                      <TableCell>
                                        {ocupante ? (
                                          <span className="truncate text-sm">{ocupante.nome}</span>
                                        ) : (
                                          <span className="text-sm italic text-muted-foreground">Vazio</span>
                                        )}
                                      </TableCell>
                                      <TableCell className="text-center">
                                        {ocupante ? (
                                          <Select
                                            value={folgas?.variavel ?? '__none__'}
                                            onValueChange={async (val) => {
                                              try {
                                                await colaboradoresService.salvarRegraHorario({
                                                  colaborador_id: ocupante.id,
                                                  folga_variavel_dia_semana: val === '__none__' ? null : (val as DiaSemana),
                                                })

                                              } catch (err) {
                                                toast.error(mapError(err) || 'Erro ao salvar folga')
                                              }
                                            }}
                                          >
                                            <SelectTrigger className="h-7 w-[70px] px-2 text-xs">
                                              <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                              <SelectItem value="__none__" className="text-xs">-</SelectItem>
                                              {DIAS_SEMANA.filter((d) => d !== 'DOM').map((dia) => (
                                                <SelectItem key={dia} value={dia} className="text-xs">{dia}</SelectItem>
                                              ))}
                                            </SelectContent>
                                          </Select>
                                        ) : (
                                          <span className="text-xs text-muted-foreground">-</span>
                                        )}
                                      </TableCell>
                                      <TableCell className="text-center">
                                        {ocupante ? (
                                          <Select
                                            value={folgas?.fixa ?? '__none__'}
                                            onValueChange={async (val) => {
                                              try {
                                                await colaboradoresService.salvarRegraHorario({
                                                  colaborador_id: ocupante.id,
                                                  folga_fixa_dia_semana: val === '__none__' ? null : (val as DiaSemana),
                                                })

                                              } catch (err) {
                                                toast.error(mapError(err) || 'Erro ao salvar folga')
                                              }
                                            }}
                                          >
                                            <SelectTrigger className="h-7 w-[70px] px-2 text-xs">
                                              <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                              <SelectItem value="__none__" className="text-xs">-</SelectItem>
                                              {DIAS_SEMANA.map((dia) => (
                                                <SelectItem key={dia} value={dia} className="text-xs">{dia}</SelectItem>
                                              ))}
                                            </SelectContent>
                                          </Select>
                                        ) : (
                                          <span className="text-xs text-muted-foreground">-</span>
                                        )}
                                      </TableCell>
                                      <TableCell className="text-xs text-muted-foreground">{contratoNome}</TableCell>
                                      <TableCell className="text-xs text-muted-foreground">
                                        {ocupante ? (ocupante.sexo === 'M' ? 'Masc' : 'Fem') : '-'}
                                      </TableCell>
                                      <TableCell>
                                        {ocupante ? (
                                          <Badge variant="outline" className={cn(
                                            'text-xs',
                                            status === 'Ativo' && 'border-success/40 text-success',
                                            status === 'Ferias' && 'border-warning/40 text-warning',
                                            status === 'Atestado' && 'border-destructive/40 text-destructive',
                                            status === 'Bloqueio' && 'border-muted-foreground/40 text-muted-foreground',
                                          )}>
                                            {status}
                                          </Badge>
                                        ) : (
                                          <span className="text-xs text-muted-foreground">-</span>
                                        )}
                                      </TableCell>
                                      <TableCell className="text-right">
                                        <div className="flex items-center justify-end gap-1">
                                          <Tooltip>
                                            <TooltipTrigger asChild>
                                              <Button
                                                type="button"
                                                variant="ghost"
                                                size="icon"
                                                className="size-7"
                                                onClick={() => openEditPostoDialog(posto)}
                                                disabled={postoAssignmentLoading}
                                                aria-label={`Editar posto ${posto.apelido}`}
                                              >
                                                <Pencil className="size-3.5" />
                                              </Button>
                                            </TooltipTrigger>
                                            <TooltipContent>Editar posto</TooltipContent>
                                          </Tooltip>

                                          <Popover
                                            open={pickerAberto}
                                            onOpenChange={(open) => {
                                              if (open) openTitularPicker(posto.id)
                                              else if (pickerAberto) closeTitularPicker()
                                            }}
                                          >
                                            <Tooltip>
                                              <TooltipTrigger asChild>
                                                <PopoverTrigger asChild>
                                                  <Button
                                                    type="button"
                                                    variant="ghost"
                                                    size="icon"
                                                    className="size-7"
                                                    disabled={postoAssignmentLoading}
                                                    aria-label={`Gerenciar titular de ${posto.apelido}`}
                                                  >
                                                    <Users className="size-3.5" />
                                                  </Button>
                                                </PopoverTrigger>
                                              </TooltipTrigger>
                                              <TooltipContent>Gerenciar titular</TooltipContent>
                                            </Tooltip>
                                            <PopoverContent
                                              side="bottom"
                                              align="end"
                                              sideOffset={8}
                                              collisionPadding={16}
                                              style={{ maxHeight: 'min(var(--radix-popover-content-available-height), 24rem)' }}
                                              className="w-[20rem] max-w-[calc(100vw-2rem)] overflow-hidden p-0"
                                            >
                                              <TitularAssignmentPanel
                                                titular={ocupante ?? null}
                                                candidatos={colaboradoresFiltradosPicker}
                                                funcaoMap={funcaoMap}
                                                searchTerm={titularPickerSearchTerm}
                                                onSearchTermChange={setTitularPickerSearchTerm}
                                                onSelectColaborador={(colaboradorId) => {
                                                  void handleSelecionarNoAutocomplete('picker', posto.id, colaboradorId)
                                                }}
                                                onRemoveTitular={ocupante ? () => { void salvarTitularNoPosto(posto, null) } : undefined}
                                                removeLabel="Mover para espera"
                                                getDescricaoBuscaColaborador={getDescricaoBuscaColaborador}
                                                loading={postoAssignmentLoading}
                                              />
                                            </PopoverContent>
                                          </Popover>

                                          {ocupante && (
                                            <Tooltip>
                                              <TooltipTrigger asChild>
                                                <Button variant="ghost" size="icon" className="size-7" asChild>
                                                  <Link to={`/colaboradores/${ocupante.id}`} aria-label={`Ver perfil de ${ocupante.nome}`}>
                                                    <ArrowRight className="size-3.5" />
                                                  </Link>
                                                </Button>
                                              </TooltipTrigger>
                                              <TooltipContent>Abrir colaborador</TooltipContent>
                                            </Tooltip>
                                          )}
                                        </div>
                                      </TableCell>
                                    </SortablePostoRow>
                                  )
                                })}
                              </SortableContext>
                            </TableBody>
                          </Table>
                        </div>
                      </DndContext>
                    )}
                  </div>

                  <div className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Banco de espera
                      <span className="ml-2 text-xs font-normal normal-case tracking-normal text-muted-foreground/70">
                        fora da hierarquia de decisao
                      </span>
                    </p>

                    {postosBancoEspera.length === 0 ? (
                      <div className="rounded-md border border-dashed px-4 py-3 text-sm text-muted-foreground">
                        Nenhum posto no banco de espera.
                      </div>
                    ) : (
                      <div className="rounded-md border">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Posto</TableHead>
                              <TableHead>Titular</TableHead>
                              <TableHead>Status</TableHead>
                              <TableHead className="w-[150px] text-right">Acoes</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {postosBancoEspera.map((posto) => {
                              const ocupante = ocupanteMap.get(posto.id)

                              return (
                                <TableRow key={posto.id}>
                                  <TableCell className="font-medium">{posto.apelido}</TableCell>
                                  <TableCell>
                                    {ocupante ? (
                                      <span className="text-sm">{ocupante.nome}</span>
                                    ) : (
                                      <span className="text-sm italic text-muted-foreground">Sem titular</span>
                                    )}
                                  </TableCell>
                                  <TableCell>
                                    <Badge variant="outline" className="text-xs text-muted-foreground">
                                      Em espera
                                    </Badge>
                                  </TableCell>
                                  <TableCell className="text-right">
                                    <div className="flex items-center justify-end gap-1">
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <Button
                                            type="button"
                                            variant="ghost"
                                            size="icon"
                                            className="size-7"
                                            disabled={postoAssignmentLoading || deletandoPosto}
                                            onClick={() => { void handleAtivarPostoEspera(posto) }}
                                            aria-label={`Ativar posto ${posto.apelido}`}
                                          >
                                            <RotateCcw className="size-3.5" />
                                          </Button>
                                        </TooltipTrigger>
                                        <TooltipContent>Ativar posto</TooltipContent>
                                      </Tooltip>

                                      <AlertDialog>
                                        <Tooltip>
                                          <TooltipTrigger asChild>
                                            <AlertDialogTrigger asChild>
                                              <Button
                                                type="button"
                                                variant="ghost"
                                                size="icon"
                                                className="size-7 text-destructive hover:text-destructive"
                                                disabled={postoAssignmentLoading || deletandoPosto}
                                                aria-label={`Deletar posto ${posto.apelido}`}
                                              >
                                                <Trash2 className="size-3.5" />
                                              </Button>
                                            </AlertDialogTrigger>
                                          </TooltipTrigger>
                                          <TooltipContent>Deletar posto</TooltipContent>
                                        </Tooltip>
                                        <AlertDialogContent>
                                          <AlertDialogHeader>
                                            <AlertDialogTitle>Deletar posto?</AlertDialogTitle>
                                            <AlertDialogDescription>
                                              {`O posto ${posto.apelido} sera removido do cadastro atual. O historico das escalas continua preservado por snapshot.`}
                                            </AlertDialogDescription>
                                          </AlertDialogHeader>
                                          <AlertDialogFooter>
                                            <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                            <AlertDialogAction onClick={() => { void handleDeletarPostoEspera(posto) }}>
                                              {deletandoPosto ? 'Deletando...' : 'Deletar'}
                                            </AlertDialogAction>
                                          </AlertDialogFooter>
                                        </AlertDialogContent>
                                      </AlertDialog>
                                    </div>
                                  </TableCell>
                                </TableRow>
                              )
                            })}
                          </TableBody>
                        </Table>
                      </div>
                    )}
                  </div>
                </CardContent>
              </CollapsibleContent>
            </Card>
          </Collapsible>

          <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-semibold">
                  Demanda por Faixa Horaria
                </CardTitle>
              </CardHeader>
              <CardContent>
                <DemandaEditor
                  ref={demandaEditorRef}
                  setor={setor}
                  demandas={demandas ?? []}
                  horariosSemana={horariosSemana ?? []}
                  totalColaboradores={colaboradores?.length ?? 0}
                  onDirtyChange={setDemandaDirty}
                />
              </CardContent>
            </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold">Escala</CardTitle>
              <div className="flex flex-wrap items-center justify-between gap-2">
                {/* Tab toggle pills */}
                <div className="inline-flex rounded-lg border bg-muted p-0.5">
                  <button
                    type="button"
                    className={cn(
                      'rounded-md px-3 py-1 text-xs font-medium transition-colors',
                      escalaTab === 'simulacao'
                        ? 'bg-background text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                    onClick={() => setEscalaSelecionada('simulacao')}
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
                    onClick={() => setEscalaSelecionada('oficial')}
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
                          onClick={() => setEscalaSelecionada(`historico:${escala.id}`)}
                        >
                          {formatarData(escala.data_inicio)} — {formatarData(escala.data_fim)}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                {/* Action buttons (consolidated) */}
                {activeEscalaCompleta && (
                  <div className="flex items-center gap-2">
                    <CicloViewToggle mode={cicloMode} onChange={setCicloMode} />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => abrirModalExportacao(activeEscalaCompleta)}
                    >
                      Exportar
                    </Button>
                    <Button variant="outline" size="sm" asChild>
                      <Link to={`/setores/${setorId}/escala?escalaId=${activeEscalaCompleta.escala.id}&origem=${escalaTab}`}>
                        Ver completo
                      </Link>
                    </Button>
                  </div>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {escalaTab === 'simulacao' && (
                <div className="space-y-4">
                  {/* Barra de controle */}
                  <div className="flex flex-wrap items-center gap-2">
                    <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={() => setSolverConfigOpen(true)}>
                      <SlidersHorizontal className="size-3" />
                      Configurar
                    </Button>
                    <div className="flex-1" />
                    <Button
                      size="sm"
                      className="gap-1.5"
                      onClick={handleGerar}
                      disabled={
                        gerando ||
                        !empresa ||
                        (tiposContrato?.length ?? 0) === 0 ||
                        (orderedColabs?.length ?? 0) === 0
                      }
                      title={
                        !empresa || (tiposContrato?.length ?? 0) === 0 || (orderedColabs?.length ?? 0) === 0
                          ? 'Complete os itens em "Antes de gerar" abaixo'
                          : undefined
                      }
                    >
                      {gerando ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : escalaCompleta ? (
                        <RotateCcw className="size-3.5" />
                      ) : (
                        <Play className="size-3.5" />
                      )}
                      {escalaCompleta ? 'Regerar' : 'Gerar Escala'}
                    </Button>
                    {escalaCompleta && (
                      <>
                        <Button variant="outline" size="sm" onClick={handleOficializar} disabled={oficializando}>
                          {oficializando ? 'Oficializando...' : 'Oficializar'}
                        </Button>
                        <Button variant="outline" size="sm" onClick={handleDescartar} disabled={descartando}>
                          {descartando ? 'Descartando...' : 'Descartar'}
                        </Button>
                      </>
                    )}
                  </div>

                  {escalaCompleta ? (
                    <div className="space-y-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold">Ciclo Rotativo</p>
                        <StatusBadge status="RASCUNHO" />
                        <Badge variant="outline" className={cn(
                          escalaCompleta.violacoes.length > 0 ? 'border-warning/20 text-warning' : 'border-success/20 text-success',
                        )}>
                          {escalaCompleta.violacoes.length > 0 ? `${escalaCompleta.violacoes.length} aviso(s)` : 'Sem avisos relevantes'}
                        </Badge>
                        {escalaCompleta.escala.criada_em && (
                          <span className="text-xs text-muted-foreground">Gerado em {formatarDataHora(escalaCompleta.escala.criada_em)}</span>
                        )}
                        <div className="flex-1" />
                        <CicloViewToggle mode={cicloMode} onChange={setCicloMode} />
                      </div>
                      <EscalaCicloResumo
                        escala={escalaCompleta.escala}
                        alocacoes={escalaCompleta.alocacoes}
                        colaboradores={equipeEscalaSimulacao.colaboradores}
                        funcoes={equipeEscalaSimulacao.funcoes}
                        regrasPadrao={regrasPadrao ?? []}
                        viewMode={cicloMode}
                      />
                      {escalaCompleta.comparacao_demanda.length > 0 && (
                        <CoberturaChart
                          comparacao={escalaCompleta.comparacao_demanda}
                          indicadores={escalaCompleta.indicadores}
                          className="rounded-md border p-3"
                        />
                      )}
                    </div>
                  ) : previewNivel1 ? (
                    <div className="space-y-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold">Preview do Ciclo</p>
                        <Badge variant="outline" className="text-xs">Nivel 1 — sem horarios</Badge>
                        <div className="flex-1" />
                        <CicloViewToggle mode={cicloMode} onChange={setCicloMode} />
                      </div>
                      {previewNivel1.avisos?.length > 0 && (
                        <div className="space-y-1.5">
                          {previewNivel1.avisos.map((aviso, idx) => (
                            <div key={idx} className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-warning">
                              <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
                              <span>{aviso}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      <EscalaCicloResumo
                        escala={previewNivel1.escala}
                        alocacoes={previewNivel1.alocacoes}
                        colaboradores={orderedColabs}
                        funcoes={funcoesList.filter(f => f.ativo)}
                        regrasPadrao={previewNivel1.regras}
                        viewMode={cicloMode}
                      />
                    </div>
                  ) : (
                    <div className="space-y-4 rounded-lg border border-dashed px-4 py-5">
                      <div>
                        <p className="text-sm font-medium text-foreground">
                          {setor?.regime_escala === '6X1'
                            ? 'Preview disponivel apenas para setores 5x2. Use Gerar Escala.'
                            : 'Configure postos e demandas para ver o preview do ciclo.'}
                        </p>
                      </div>
                      {(!empresa || (tiposContrato?.length ?? 0) === 0 || (orderedColabs?.length ?? 0) === 0 || (demandas?.length ?? 0) === 0) && (
                        <div className="rounded-md border bg-muted/30 px-3 py-3">
                          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                            Antes de gerar
                          </p>
                          <ul className="space-y-1.5 text-sm">
                            <PrecondicaoItem ok={!!empresa} label="Empresa configurada" linkTo="/empresa" />
                            <PrecondicaoItem ok={(tiposContrato?.length ?? 0) > 0} label="Tipo de contrato cadastrado" linkTo="/tipos-contrato" />
                            <PrecondicaoItem ok={(orderedColabs?.length ?? 0) > 0} label="Colaborador(es) ativo(s) no setor" linkTo="/colaboradores" hint="Cadastre na secao Colaboradores acima" />
                            <PrecondicaoItem ok={(demandas?.length ?? 0) > 0} label="Demanda cadastrada (faixas horarias)" linkTo={undefined} hint="Configure na secao Demanda acima" />
                          </ul>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {escalaTab === 'oficial' && (
                <div className="space-y-4">
                  {!escalaOficialAtual ? (
                    <div className="rounded-lg border border-dashed px-4 py-5">
                      <p className="text-sm font-medium text-foreground">Nenhuma escala oficial encontrada</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Gere uma simulacao e oficialize para aparecer aqui.
                      </p>
                      <Button variant="outline" size="sm" className="mt-3" onClick={() => setEscalaSelecionada('simulacao')}>
                        Ir para Simulacao
                      </Button>
                    </div>
                  ) : carregandoTabEscala ? (
                    <div className="flex items-center justify-center py-10">
                      <Loader2 className="size-5 animate-spin text-muted-foreground" />
                    </div>
                  ) : oficialCompleta ? (
                    <div className="space-y-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold">Ciclo Rotativo</p>
                        <StatusBadge status="OFICIAL" />
                        {oficialCompleta.escala.criada_em && (
                          <span className="text-xs text-muted-foreground">Gerado em {formatarDataHora(oficialCompleta.escala.criada_em)}</span>
                        )}
                      </div>
                      <EscalaCicloResumo
                        escala={oficialCompleta.escala}
                        alocacoes={oficialCompleta.alocacoes}
                        colaboradores={equipeEscalaOficial.colaboradores}
                        funcoes={equipeEscalaOficial.funcoes}
                        regrasPadrao={regrasPadrao ?? []}
                        viewMode={cicloMode}
                      />
                      {oficialCompleta.comparacao_demanda.length > 0 && (
                        <CoberturaChart
                          comparacao={oficialCompleta.comparacao_demanda}
                          indicadores={oficialCompleta.indicadores}
                          className="rounded-md border p-3"
                        />
                      )}
                    </div>
                  ) : null}
                </div>
              )}

              {escalaTab === 'historico' && (
                <div className="space-y-4">
                  {escalasHistorico.length === 0 ? (
                    <div className="rounded-lg border border-dashed px-4 py-5">
                      <p className="text-sm font-medium text-foreground">Historico vazio</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Ainda nao existem escalas arquivadas para este setor.
                      </p>
                      <Button variant="outline" size="sm" className="mt-3" onClick={() => setEscalaSelecionada('simulacao')}>
                        Gerar primeira simulacao
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {carregandoTabEscala ? (
                        <div className="flex items-center justify-center py-10">
                          <Loader2 className="size-5 animate-spin text-muted-foreground" />
                        </div>
                      ) : historicoCompleta ? (
                        <div className="space-y-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-semibold">Ciclo Rotativo</p>
                            <Badge variant="outline" className="text-xs">
                              {historicoCompleta.escala.status}
                            </Badge>
                            {historicoCompleta.escala.criada_em && (
                              <span className="text-xs text-muted-foreground">Gerado em {formatarDataHora(historicoCompleta.escala.criada_em)}</span>
                            )}
                          </div>
                          <EscalaCicloResumo
                            escala={historicoCompleta.escala}
                            alocacoes={historicoCompleta.alocacoes}
                            colaboradores={equipeEscalaHistorico.colaboradores}
                            funcoes={equipeEscalaHistorico.funcoes}
                            regrasPadrao={regrasPadrao ?? []}
                            viewMode={cicloMode}
                          />
                        </div>
                      ) : null}
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Excecoes de Demanda por Data — oculto (IA configura via tool) */}

        {/* Solver progress overlay */}
        {gerando && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/60 backdrop-blur-sm animate-in fade-in-0 duration-200">
            <Card className="w-full max-w-sm border shadow-lg">
              <CardContent className="flex flex-col gap-4 pt-6">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">Gerando escala — {setor?.nome ?? 'setor'}</p>
                  <span className="font-mono text-xs tabular-nums text-muted-foreground">
                    {Math.floor(solverElapsed / 60).toString().padStart(2, '0')}:{(solverElapsed % 60).toString().padStart(2, '0')}
                  </span>
                </div>

                <ScrollArea ref={solverScrollRef} className="h-36 rounded-md border bg-muted/50 px-3 py-2">
                  <div className="flex flex-col gap-1">
                    {solverLogs.length === 0 ? (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Loader2 className="size-3 animate-spin" />
                        Iniciando motor...
                      </div>
                    ) : (
                      solverLogs.map((line, i) => (
                        <p key={i} className={`text-xs leading-relaxed ${i === solverLogs.length - 1 ? 'text-foreground font-medium' : 'text-muted-foreground'}`}>
                          {line}
                        </p>
                      ))
                    )}
                  </div>
                </ScrollArea>

                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="size-3 animate-spin text-primary" />
                    Calculando...
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 gap-1.5 text-xs"
                    onClick={async () => {
                      await escalasService.cancelar()
                      toast('Geracao cancelada')
                      setGerando(false)
                    }}
                  >
                    <Square className="size-2.5" />
                    Cancelar
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>

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
        onCSV={handleCSVFromModal}
      >
        {renderExportPreview()}
      </ExportModal>

      {/* ─── Excecao Demanda por Data Dialog ─── */}
      <Dialog open={showExcDemandaDialog} onOpenChange={setShowExcDemandaDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Excecao de Demanda por Data</DialogTitle>
            <DialogDescription>
              Defina uma demanda diferente para uma data especifica (feriado, evento, etc.).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Data</Label>
              <Input
                type="date"
                value={excDemandaForm.data}
                onChange={(e) => setExcDemandaForm((p) => ({ ...p, data: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Hora Inicio</Label>
                <Input
                  type="time"
                  step="900"
                  value={excDemandaForm.hora_inicio}
                  onChange={(e) => setExcDemandaForm((p) => ({ ...p, hora_inicio: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label>Hora Fim</Label>
                <Input
                  type="time"
                  step="900"
                  value={excDemandaForm.hora_fim}
                  onChange={(e) => setExcDemandaForm((p) => ({ ...p, hora_fim: e.target.value }))}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Minimo de Pessoas</Label>
              <Input
                type="number"
                min="0"
                value={excDemandaForm.min_pessoas}
                onChange={(e) => setExcDemandaForm((p) => ({ ...p, min_pessoas: parseInt(e.target.value) || 0 }))}
              />
            </div>
            <div className="flex items-center gap-3">
              <Switch
                checked={excDemandaForm.override}
                onCheckedChange={(checked) => setExcDemandaForm((p) => ({ ...p, override: checked }))}
              />
              <div>
                <Label>Sobrescrever demanda padrao</Label>
                <p className="text-xs text-muted-foreground">
                  Quando ativo, substitui completamente a demanda semanal nesta faixa
                </p>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowExcDemandaDialog(false)}>
              Cancelar
            </Button>
            <Button onClick={handleSalvarExcDemanda} disabled={excDemandaSalvando || isPreviewMode}>
              {excDemandaSalvando ? 'Salvando...' : 'Salvar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showPostoDialog} onOpenChange={closePostoDialog}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{postoDialogMode === 'create' ? 'Novo Posto' : 'Editar Posto'}</DialogTitle>
            <DialogDescription>
              {postoDialogMode === 'create'
                ? 'Defina o nome do posto. Se ele ainda nao entrar na hierarquia, crie direto no banco de espera.'
                : 'Atualize o nome do posto e o titular anexado. Quando ele sair da hierarquia, mova para espera.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-5 py-4">
            <div className="space-y-2">
              <Label>Nome do Posto</Label>
              <Input
                placeholder="Ex: Caixa, Repositor, Seguranca"
                value={postoDialogApelido}
                onChange={(e) => setPostoDialogApelido(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    void handleSalvarPostoDialog()
                  }
                }}
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label>Titular</Label>
              <div className="flex items-start justify-between gap-3 rounded-md border px-3 py-3">
                <div className="min-w-0">
                  {postoDialogTitularAtual ? (
                    <>
                      <p className="truncate text-sm font-medium text-foreground">{postoDialogTitularAtual.nome}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {getDescricaoBuscaColaborador(postoDialogTitularAtual)}
                      </p>
                    </>
                  ) : (
                    <p className="text-sm italic text-muted-foreground">Vazio</p>
                  )}
                </div>

                <Popover
                  open={postoDialogTitularPickerOpen}
                  onOpenChange={(open) => {
                    setPostoDialogTitularPickerOpen(open)
                    if (!open) setPostoDialogSearchTerm('')
                  }}
                >
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <PopoverTrigger asChild>
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="size-8 shrink-0"
                          disabled={salvandoPosto || deletandoPosto}
                          aria-label="Gerenciar titular"
                        >
                          <Users className="size-4" />
                        </Button>
                      </PopoverTrigger>
                    </TooltipTrigger>
                    <TooltipContent>Gerenciar titular</TooltipContent>
                  </Tooltip>
                  <PopoverContent
                    side="bottom"
                    align="end"
                    sideOffset={8}
                    collisionPadding={16}
                    style={{ maxHeight: 'min(var(--radix-popover-content-available-height), 24rem)' }}
                    className="w-[20rem] max-w-[calc(100vw-2rem)] overflow-hidden p-0"
                  >
                    <TitularAssignmentPanel
                      titular={postoDialogTitularAtual}
                      candidatos={colaboradoresFiltradosDialogo}
                      funcaoMap={funcaoMap}
                      searchTerm={postoDialogSearchTerm}
                      onSearchTermChange={setPostoDialogSearchTerm}
                      onSelectColaborador={(colaboradorId) => {
                        void handleSelecionarNoAutocomplete('dialog', postoDialogPostoId ?? 0, colaboradorId)
                        setPostoDialogTitularPickerOpen(false)
                        setPostoDialogSearchTerm('')
                      }}
                      onRemoveTitular={postoDialogTitularAtual ? () => {
                        setPostoDialogTitularId(null)
                        setPostoDialogTitularPickerOpen(false)
                        setPostoDialogSearchTerm('')
                      } : undefined}
                      removeLabel="Mover para espera"
                      getDescricaoBuscaColaborador={getDescricaoBuscaColaborador}
                      loading={salvandoPosto || deletandoPosto}
                    />
                  </PopoverContent>
                </Popover>
              </div>
            </div>
          </div>
          <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              {postoDialogMode === 'edit' && (
                <Button
                  type="button"
                  variant="outline"
                  className="gap-2"
                  disabled={salvandoPosto || deletandoPosto}
                  onClick={() => { void handleMoverPostoDialogParaEspera() }}
                >
                  <Archive className="size-4" />
                  Mover para espera
                </Button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={() => closePostoDialog(false)} disabled={salvandoPosto || deletandoPosto}>
                Cancelar
              </Button>
              <Button
                onClick={() => { void handleSalvarPostoDialog() }}
                disabled={salvandoPosto || !postoDialogApelido.trim() || isPreviewMode}
              >
                {salvandoPosto
                  ? (postoDialogMode === 'create' ? 'Criando...' : 'Salvando...')
                  : (postoDialogMode === 'create' ? 'Criar' : 'Salvar')}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!pendingAutocompleteSwap} onOpenChange={(open) => { if (!open) setPendingAutocompleteSwap(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Trocar colaborador de posto?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingAutocompleteSwap ? (
                <>
                  <strong>{pendingAutocompleteSwap.colaboradorNome}</strong> ja esta no posto{' '}
                  <strong>{pendingAutocompleteSwap.postoOrigemNome}</strong>. Deseja remover de lá e trazer para{' '}
                  <strong>{pendingAutocompleteSwap.postoDestinoNome}</strong>?
                </>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => { void handleConfirmarAutocompleteSwap() }}>
              Trocar posto
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <SolverConfigDrawer
        open={solverConfigOpen}
        onOpenChange={setSolverConfigOpen}
        config={solverSessionConfig}
        onConfigChange={setSolverSessionConfig}
        periodoPreset={periodoPreset}
        onPeriodoPresetChange={setPeriodoPreset}
      />

    </div>
  )
}
