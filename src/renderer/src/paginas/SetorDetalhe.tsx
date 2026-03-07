import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
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
  Save,
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
  Square,
  Terminal,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
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
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import { PageHeader } from '@/componentes/PageHeader'
import { DirtyGuardDialog } from '@/componentes/DirtyGuardDialog'
import { useDirtyGuard } from '@/hooks/useDirtyGuard'
import { EmptyState } from '@/componentes/EmptyState'
import { StatusBadge } from '@/componentes/StatusBadge'
import { EscalaCicloResumo } from '@/componentes/EscalaCicloResumo'
import { CoberturaChart } from '@/componentes/CoberturaChart'
import { ExportarEscala } from '@/componentes/ExportarEscala'
import { ExportModal, type EscalaExportContent } from '@/componentes/ExportModal'
import { IconPicker } from '@/componentes/IconPicker'
import { DemandaEditor } from '@/componentes/DemandaEditor'
import { setoresService } from '@/servicos/setores'
import { colaboradoresService } from '@/servicos/colaboradores'
import { escalasService } from '@/servicos/escalas'
import { empresaService } from '@/servicos/empresa'
import { tiposContratoService } from '@/servicos/tipos-contrato'
import { funcoesService } from '@/servicos/funcoes'
import { excecoesService } from '@/servicos/excecoes'
import { useApiData } from '@/hooks/useApiData'
import { useAppVersion } from '@/hooks/useAppVersion'
import { formatarData, formatarDataHora, mapError } from '@/lib/formatadores'
import { buildStandaloneHtml } from '@/lib/export-standalone-html'
import { gerarHTMLFuncionario } from '@/lib/gerarHTMLFuncionario'
import { gerarCSVAlocacoes, gerarCSVComparacaoDemanda, gerarCSVViolacoes } from '@/lib/gerarCSV'
import { getPresetLabel, resolvePresetRange, type EscalaPeriodoPreset } from '@/lib/escala-periodo-preset'
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
  SalvarTimelineDiaInput,
  RegraHorarioColaborador,
  ColaboradorPostoSnapshotItem,
} from '@shared/index'

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

// ─── Main Component ────────────────────────────────────────────────────
export function SetorDetalhe() {
  const { id } = useParams<{ id: string }>()
  const setorId = parseInt(id!)
  const navigate = useNavigate()

  // Form
  const [salvando, setSalvando] = useState(false)
  const setorForm = useForm<SetorFormInput, unknown, SetorFormData>({
    resolver: zodResolver(setorSchema),
    defaultValues: { nome: '', icone: null, hora_abertura: '', hora_fechamento: '', regime_escala: '5X2' },
  })

  const blocker = useDirtyGuard({ isDirty: setorForm.formState.isDirty })

  // ─── Data loading ────────────────────────────────────────────────────
  const { data: setor, loading: loadingSetor } = useApiData<Setor>(
    () => setoresService.buscar(setorId),
    [setorId],
  )
  const { data: empresa } = useApiData<Empresa>(
    () => empresaService.buscar(),
    [],
  )

  const { data: demandas, reload: reloadDemandas } = useApiData<Demanda[]>(
    () => setoresService.listarDemandas(setorId),
    [setorId],
  )

  const { data: horariosSemana, reload: reloadHorariosSemana } = useApiData<SetorHorarioSemana[]>(
    () => setoresService.listarHorarioSemana(setorId),
    [setorId],
  )

  const { data: colaboradores } = useApiData<Colaborador[]>(
    () => colaboradoresService.listar({ setor_id: setorId, ativo: true }),
    [setorId],
  )

  const { data: escalas, reload: reloadEscalas } = useApiData<Escala[]>(
    () => escalasService.listarPorSetor(setorId),
    [setorId],
  )

  const { data: tiposContrato } = useApiData<TipoContrato[]>(
    () => tiposContratoService.listar(),
    [],
  )

  const { data: funcoes, reload: reloadFuncoes } = useApiData<Funcao[]>(
    () => funcoesService.listar(setorId),
    [setorId],
  )

  const { data: excecoesAtivas } = useApiData<Excecao[]>(
    () => excecoesService.listarAtivas(),
    [],
  )

  const { data: regrasPadrao, reload: reloadRegrasPadrao } = useApiData<RegraHorarioColaborador[]>(
    () => colaboradoresService.listarRegrasPadraoSetor(setorId),
    [setorId],
  )

  const contratoMap = new Map((tiposContrato ?? []).map((tc) => [tc.id, tc.nome]))
  const funcoesList = useMemo(() => funcoes ?? [], [funcoes])
  const inicioSemanaEscala = useMemo<DiaSemana>(() => {
    const raw = (empresa?.corte_semanal ?? 'SEG_DOM').slice(0, 3).toUpperCase()
    if (raw === 'SEG' || raw === 'TER' || raw === 'QUA' || raw === 'QUI' || raw === 'SEX' || raw === 'SAB' || raw === 'DOM') {
      return raw
    }
    return 'SEG'
  }, [empresa?.corte_semanal])

  // ─── State ───────────────────────────────────────────────────────────
  const [showPostoDialog, setShowPostoDialog] = useState(false)
  const [novoPostoApelido, setNovoPostoApelido] = useState('')
  const [criandoPosto, setCriandoPosto] = useState(false)
  const [orderedPostos, setOrderedPostos] = useState<Funcao[]>([])
  const [orderedColabs, setOrderedColabs] = useState<Colaborador[]>([])
  const [editingPostoId, setEditingPostoId] = useState<number | null>(null)
  const [postoSearchTerm, setPostoSearchTerm] = useState('')
  const [postoAssignmentLoading, setPostoAssignmentLoading] = useState(false)
  const [pendingAutocompleteSwap, setPendingAutocompleteSwap] = useState<{
    postoId: number
    colabId: number
    colaboradorNome: string
    postoOrigemNome: string
    postoDestinoNome: string
  } | null>(null)

  // Geracao inline
  const [escalaTab, setEscalaTab] = useState<'simulacao' | 'oficial' | 'historico'>('simulacao')
  const [periodoPreset, setPeriodoPreset] = useState<EscalaPeriodoPreset>('3_MESES')
  const [gerando, setGerando] = useState(false)
  const [solverLogs, setSolverLogs] = useState<string[]>([])
  const [solverElapsed, setSolverElapsed] = useState(0)
  const solverScrollRef = useRef<HTMLDivElement>(null)
  const [escalaCompleta, setEscalaCompleta] = useState<EscalaCompletaV3 | null>(null)
  const [oficialCompleta, setOficialCompleta] = useState<EscalaCompletaV3 | null>(null)
  const [historicoCompleta, setHistoricoCompleta] = useState<EscalaCompletaV3 | null>(null)
  const [historicoSelecionadaId, setHistoricoSelecionadaId] = useState<number | null>(null)
  const [carregandoTabEscala, setCarregandoTabEscala] = useState(false)
  const [oficializando, setOficializando] = useState(false)
  const [descartando, setDescartando] = useState(false)
  const [periodoGeracao, setPeriodoGeracao] = useState(() => resolvePresetRange('3_MESES'))
  const [solveModeGeracao, setSolveModeGeracao] = useState<'rapido' | 'balanceado' | 'otimizado' | 'maximo'>('rapido')
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

  const colabsSemPosto = useMemo(
    () => orderedColabs.filter((c) => c.funcao_id == null),
    [orderedColabs],
  )

  const colaboradoresParaBusca = useMemo(
    () => [...orderedColabs].sort((a, b) => a.nome.localeCompare(b.nome)),
    [orderedColabs],
  )

  const colaboradoresFiltradosBusca = useMemo(() => {
    const query = postoSearchTerm.trim().toLowerCase()
    if (!query) return colaboradoresParaBusca
    return colaboradoresParaBusca.filter((c) => c.nome.toLowerCase().includes(query))
  }, [colaboradoresParaBusca, postoSearchTerm])

  const getStatusColaborador = useCallback((colabId: number) => {
    const exc = excecaoMap.get(colabId)?.tipo ?? null
    if (!exc) return 'Ativo'
    if (exc === 'FERIAS') return 'Ferias'
    if (exc === 'ATESTADO') return 'Atestado'
    return 'Bloqueio'
  }, [excecaoMap])

  const applyPostoSnapshot = useCallback((snapshot: ColaboradorPostoSnapshotItem[]) => {
    if (snapshot.length === 0) return
    const snapshotMap = new Map(snapshot.map((item) => [item.colaborador_id, item.funcao_id ?? null]))
    setOrderedColabs((prev) =>
      prev.map((colab) =>
        snapshotMap.has(colab.id)
          ? { ...colab, funcao_id: snapshotMap.get(colab.id) ?? null }
          : colab,
      ),
    )
  }, [])

  // ─── DnD setup (reorder postos) ─────────────────────────────────────
  const postoSortSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  )

  const handlePostoReorderDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return

    const oldIndex = postosOrdenados.findIndex((p) => `posto-${p.id}` === active.id)
    const newIndex = postosOrdenados.findIndex((p) => `posto-${p.id}` === over.id)
    if (oldIndex === -1 || newIndex === -1) return

    const reordered = arrayMove(postosOrdenados, oldIndex, newIndex)
    setOrderedPostos(reordered)

    try {
      await Promise.all(
        reordered.map((posto, idx) => funcoesService.atualizar(posto.id, { ordem: idx })),
      )
    } catch {
      toast.error('Erro ao salvar nova ordem dos postos')
    }
  }

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

  const applyPostoAssignment = useCallback(async (colabId: number, newFuncaoId: number | null) => {
    const colab = orderedColabs.find((c) => c.id === colabId)
    if (!colab) return

    if (colab.funcao_id === newFuncaoId) return

    setPostoAssignmentLoading(true)
    try {
      const result = await colaboradoresService.atribuirPosto({
        colaborador_id: colabId,
        funcao_id: newFuncaoId,
        estrategia: 'swap',
      })

      applyPostoSnapshot(result.snapshot_depois)

      const swappedOutId = newFuncaoId == null
        ? null
        : result.snapshot_antes.find((item) => item.funcao_id === newFuncaoId && item.colaborador_id !== colabId)?.colaborador_id ?? null
      const swappedOutName = swappedOutId != null
        ? (orderedColabs.find((c) => c.id === swappedOutId)?.nome ?? 'Outro colaborador')
        : null
      const destinoNome = newFuncaoId == null ? 'reserva operacional' : (funcaoMap.get(newFuncaoId) ?? 'posto')

      toast.success(
        newFuncaoId == null
          ? `${colab.nome} movido para reserva operacional`
          : swappedOutName
            ? `${colab.nome} alocado em ${destinoNome}; ${swappedOutName} foi para reserva operacional`
            : `${colab.nome} alocado em ${destinoNome}`,
        {
          action: {
            label: 'Desfazer',
            onClick: async () => {
              try {
                await colaboradoresService.restaurarPostos({ snapshot: result.snapshot_antes })
                applyPostoSnapshot(result.snapshot_antes)
                toast.success('Alocacao desfeita')
              } catch (undoErr) {
                toast.error(mapError(undoErr) || 'Erro ao desfazer alocacao')
              }
            },
          },
        },
      )
    } catch (err) {
      toast.error(mapError(err) || 'Erro ao atribuir posto')
    } finally {
      setPostoAssignmentLoading(false)
    }
  }, [applyPostoSnapshot, funcaoMap, orderedColabs])

  const openPostoEditor = useCallback((postoId: number) => {
    setEditingPostoId(postoId)
    setPostoSearchTerm('')
  }, [])

  const closePostoEditor = useCallback(() => {
    setEditingPostoId(null)
    setPostoSearchTerm('')
  }, [])

  const handleSelecionarNoAutocomplete = useCallback(async (postoId: number, colabId: number) => {
    const candidato = orderedColabs.find((c) => c.id === colabId)
    if (!candidato) return
    if (candidato.funcao_id != null && candidato.funcao_id !== postoId) {
      setPendingAutocompleteSwap({
        postoId,
        colabId,
        colaboradorNome: candidato.nome,
        postoOrigemNome: funcaoMap.get(candidato.funcao_id) ?? 'posto atual',
        postoDestinoNome: funcaoMap.get(postoId) ?? 'posto selecionado',
      })
      return
    }
    await applyPostoAssignment(colabId, postoId)
    closePostoEditor()
  }, [applyPostoAssignment, closePostoEditor, funcaoMap, orderedColabs])

  const handleConfirmarAutocompleteSwap = useCallback(async () => {
    if (!pendingAutocompleteSwap) return
    await applyPostoAssignment(pendingAutocompleteSwap.colabId, pendingAutocompleteSwap.postoId)
    setPendingAutocompleteSwap(null)
    closePostoEditor()
  }, [applyPostoAssignment, closePostoEditor, pendingAutocompleteSwap])

  const handleRemoverTitularPosto = useCallback(async (colabId: number) => {
    await applyPostoAssignment(colabId, null)
  }, [applyPostoAssignment])

  const getDescricaoBuscaColaborador = useCallback((colab: Colaborador) => {
    const postoAtual = colab.funcao_id != null ? (funcaoMap.get(colab.funcao_id) ?? 'Posto') : 'Reserva operacional'
    const contratoNome = contratoMap.get(colab.tipo_contrato_id) ?? 'Contrato'
    const status = getStatusColaborador(colab.id)
    return `${postoAtual} • ${contratoNome} • ${status}`
  }, [contratoMap, funcaoMap, getStatusColaborador])

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
    if (escalasHistorico.length === 0) {
      setHistoricoSelecionadaId(null)
      setHistoricoCompleta(null)
      return
    }
    setHistoricoSelecionadaId((prev) => {
      if (prev && escalasHistorico.some((escala) => escala.id === prev)) return prev
      return escalasHistorico[0].id
    })
  }, [escalasHistorico])

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

    async function run() {
      if (escalaTab === 'oficial') {
        if (!escalaOficialAtual) {
          setOficialCompleta(null)
          setCarregandoTabEscala(false)
          return
        }
        setCarregandoTabEscala(true)
        const detail = await carregarDetalheEscala(escalaOficialAtual.id)
        if (!canceled) setOficialCompleta(detail)
        if (!canceled) setCarregandoTabEscala(false)
        return
      }

      if (escalaTab === 'historico') {
        if (!historicoSelecionadaId) {
          setHistoricoCompleta(null)
          setCarregandoTabEscala(false)
          return
        }
        setCarregandoTabEscala(true)
        const detail = await carregarDetalheEscala(historicoSelecionadaId)
        if (!canceled) setHistoricoCompleta(detail)
        if (!canceled) setCarregandoTabEscala(false)
      }

      if (escalaTab === 'simulacao') {
        setCarregandoTabEscala(false)
      }
    }

    void run()
    return () => {
      canceled = true
    }
  }, [carregarDetalheEscala, escalaOficialAtual, escalaTab, historicoSelecionadaId])

  // ─── Handlers ────────────────────────────────────────────────────────
  const handleSalvar = async (data: SetorFormData) => {
    setSalvando(true)
    try {
      const nextValues: SetorFormInput = {
        nome: data.nome.trim(),
        icone: data.icone ?? null,
        hora_abertura: data.hora_abertura,
        hora_fechamento: data.hora_fechamento,
        regime_escala: data.regime_escala,
      }
      await setoresService.atualizar(setorId, nextValues)
      setorForm.reset(nextValues)
      toast.success('Setor atualizado')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao salvar setor')
    } finally {
      setSalvando(false)
    }
  }

  const handleSalvarTimeline = useCallback(async (dados: SalvarTimelineDiaInput[]): Promise<void> => {
    for (const payload of dados) {
      await setoresService.salvarTimelineDia(payload)
    }
    await Promise.all([reloadDemandas(), reloadHorariosSemana()])
    toast.success('Demanda salva')
  }, [reloadDemandas, reloadHorariosSemana])

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

    // Preflight silencioso
    try {
      const preflight = await escalasService.preflight(setorId, { data_inicio: dataInicio, data_fim: dataFim })
      if (!preflight.ok) {
        toast.error(preflight.blockers.map((b) => b.mensagem).join(' | ') || 'Preflight bloqueou a geracao')
        return
      }
      // Warnings seguem para a camada de detalhes (sem ruido no fluxo principal)
    } catch (err) {
      toast.error(mapError(err) || 'Falha no preflight')
      return
    }

    setSolverLogs([])
    setGerando(true)
    try {
      const result = await escalasService.gerar(setorId, {
        data_inicio: dataInicio,
        data_fim: dataFim,
        solveMode: solveModeGeracao,
      })
      setEscalaCompleta(result)
      toast.success('Escala gerada')
    } catch (err) {
      const msg = mapError(err) || 'Nao foi possivel gerar a escala.'
      if (!msg.includes('cancelado') && !msg.includes('SIGTERM') && !msg.includes('killed')) {
        toast.error(msg)
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
      await Promise.all([reloadEscalas(), reloadRegrasPadrao()])
      toast.success('Escala oficializada')
      setEscalaCompleta(null)
    } catch (err) {
      const msg = mapError(err) || 'Erro ao oficializar'
      if (msg.includes('ESCALA_DESATUALIZADA')) {
        toast.error('Escala desatualizada — gere novamente.')
      } else {
        toast.error(msg)
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

  const resolveExportColaboradores = useCallback(() => {
    if (orderedColabs.length > 0) return orderedColabs
    return colaboradores ?? []
  }, [colaboradores, orderedColabs])

  const hasConteudoSetorial = useCallback((conteudo: EscalaExportContent) => {
    return conteudo.ciclo || conteudo.timeline
  }, [])

  const appVersion = useAppVersion()
  const buildHTMLFuncionario = useCallback((detalhe: EscalaCompletaV3, colabId: number, incluirAvisos: boolean) => {
    if (!setor || !tiposContrato) return null
    const baseColaboradores = resolveExportColaboradores()
    const colab = baseColaboradores.find((c) => c.id === colabId)
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
  }, [appVersion, regrasMap, resolveExportColaboradores, setor, tiposContrato])

  const renderExportSetorial = useCallback((detalhe: EscalaCompletaV3 | null, conteudo: EscalaExportContent) => {
    if (!detalhe || !setor || !colaboradores) return
    if (!hasConteudoSetorial(conteudo)) return null
    const modo: 'ciclo' | 'detalhado' = conteudo.timeline ? 'detalhado' : 'ciclo'
    const baseColaboradores = resolveExportColaboradores()
    return {
      modo,
      jsx: (
        <ExportarEscala
          escala={detalhe.escala}
          alocacoes={detalhe.alocacoes}
          colaboradores={baseColaboradores}
          setor={setor}
          violacoes={detalhe.violacoes}
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
      ),
    }
  }, [colaboradores, funcoes, hasConteudoSetorial, horariosSemana, resolveExportColaboradores, setor, tiposContrato])

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
    const baseColaboradores = resolveExportColaboradores()
    const blocos: string[] = []
    const incluirEscala = conteudo.ciclo || conteudo.timeline || conteudo.funcionarios
    if (incluirEscala) {
      blocos.push(gerarCSVAlocacoes([detalhe], [setor], baseColaboradores))
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
    const baseColaboradores = resolveExportColaboradores()
    const arquivos = baseColaboradores
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
    const baseColaboradores = resolveExportColaboradores()
    const incluirSetorial = hasConteudoSetorial(conteudoExport)
    return (
      <div className="space-y-3">
        {incluirSetorial ? (
          <ExportarEscala
            escala={exportDetalhe.escala}
            alocacoes={exportDetalhe.alocacoes}
            colaboradores={baseColaboradores}
            setor={setor}
            violacoes={exportDetalhe.violacoes}
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
              Ative <strong>Ciclo</strong> e/ou <strong>Timeline</strong> para visualizar aqui.
            </p>
          </div>
        )}

        {conteudoExport.funcionarios && (
          <div className="rounded-md border bg-background p-4">
            <p className="text-sm font-medium">Por funcionario ativo</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Serao gerados arquivos para todos os {baseColaboradores.length} funcionario(s) do setor.
            </p>
          </div>
        )}
      </div>
    )
  }

  // Auto-load rascunho existente
  useEffect(() => {
    if (!escalas?.length) return
    const rascunho = [...escalas]
      .filter((e) => e.status === 'RASCUNHO')
      .sort((a, b) => b.criada_em.localeCompare(a.criada_em))[0]
    if (rascunho && !escalaCompleta) {
      escalasService.buscar(rascunho.id).then(setEscalaCompleta).catch(() => {})
    }
  }, [escalas]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleCriarPosto = async () => {
    if (!novoPostoApelido.trim()) return
    const defaultContratoId = tiposContrato?.[0]?.id
    if (!defaultContratoId) {
      toast.error('Cadastre um tipo de contrato antes de criar postos')
      return
    }
    setCriandoPosto(true)
    try {
      await funcoesService.criar({
        setor_id: setorId,
        apelido: novoPostoApelido.trim(),
        tipo_contrato_id: defaultContratoId,
      })
      toast.success('Posto criado')
      setShowPostoDialog(false)
      setNovoPostoApelido('')
      reloadFuncoes()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao criar posto')
    } finally {
      setCriandoPosto(false)
    }
  }

  // ─── Loading / Not Found ─────────────────────────────────────────────
  if (loadingSetor) {
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
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" size="sm" className="text-destructive hover:bg-destructive/5">
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
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setorForm.reset()}
              disabled={salvando || !setorForm.formState.isDirty}
            >
              Cancelar
            </Button>
            <Button size="sm" onClick={setorForm.handleSubmit(handleSalvar)} disabled={salvando}>
              <Save className="mr-1 size-3.5" />
              {salvando ? 'Salvando...' : 'Salvar'}
            </Button>
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
                        onChange={(v) => setorForm.setValue('icone', v)}
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
                  <Button variant="outline" size="sm" onClick={() => setShowPostoDialog(true)}>
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
                {postosOrdenados.length === 0 && (
                  <div className="rounded-md border border-dashed px-4 py-3 text-sm text-muted-foreground">
                    Nenhum posto definido para este setor.
                  </div>
                )}
                {orderedColabs.length === 0 ? (
                  <EmptyState
                    icon={Users}
                    title="Nenhum colaborador vinculado a este setor"
                    description="Cadastre colaboradores e vincule a este setor"
                    action={
                      <Button variant="outline" size="sm" asChild>
                        <Link to="/colaboradores">
                          <Users className="mr-1 size-3.5" /> Gerenciar Colaboradores
                        </Link>
                      </Button>
                    }
                  />
                ) : (
                  <div className="space-y-4">
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
                        <span className="ml-2 text-xs font-normal normal-case tracking-normal text-muted-foreground/70">(arraste ⠿ para reordenar)</span>
                      </p>
                      <DndContext
                        sensors={postoSortSensors}
                        collisionDetection={closestCenter}
                        onDragEnd={handlePostoReorderDragEnd}
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
                              <TableHead className="w-[100px]">Contrato</TableHead>
                              <TableHead className="w-[60px]">Sexo</TableHead>
                              <TableHead className="w-[100px]">Status</TableHead>
                              <TableHead className="w-[100px] text-right">Ações</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            <SortableContext
                              items={postosOrdenados.map((p) => `posto-${p.id}`)}
                              strategy={verticalListSortingStrategy}
                            >
                            {postosOrdenados.map((posto, index) => {
                              const ocupante = ocupanteMap.get(posto.id)
                              const status = ocupante ? getStatusColaborador(ocupante.id) : '-'
                              const contratoNome = ocupante ? (contratoMap.get(ocupante.tipo_contrato_id) ?? 'Contrato') : '-'
                              const regra = ocupante ? regrasMap.get(ocupante.id) : null
                              const editorAberto = editingPostoId === posto.id

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
                                        value={regra?.folga_variavel_dia_semana ?? '__none__'}
                                        onValueChange={async (val) => {
                                          try {
                                            await colaboradoresService.salvarRegraHorario({
                                              colaborador_id: ocupante.id,
                                              folga_variavel_dia_semana: val === '__none__' ? null : (val as DiaSemana),
                                            })
                                            await reloadRegrasPadrao()
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
                                        value={regra?.folga_fixa_dia_semana ?? '__none__'}
                                        onValueChange={async (val) => {
                                          try {
                                            await colaboradoresService.salvarRegraHorario({
                                              colaborador_id: ocupante.id,
                                              folga_fixa_dia_semana: val === '__none__' ? null : (val as DiaSemana),
                                            })
                                            await reloadRegrasPadrao()
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
                                      <Popover
                                        open={editorAberto}
                                        onOpenChange={(open) => {
                                          if (open) openPostoEditor(posto.id)
                                          else if (editorAberto) closePostoEditor()
                                        }}
                                      >
                                        <PopoverTrigger asChild>
                                          <Button
                                            type="button"
                                            variant="ghost"
                                            size="icon"
                                            className="size-7"
                                            disabled={postoAssignmentLoading}
                                            aria-label={`Editar titular de ${posto.apelido}`}
                                          >
                                            <Pencil className="size-3.5" />
                                          </Button>
                                        </PopoverTrigger>
                                        <PopoverContent align="end" className="w-80 space-y-2">
                                          <div className="space-y-1">
                                            <p className="text-xs font-medium">Selecionar titular para {posto.apelido}</p>
                                            <Input
                                              value={postoSearchTerm}
                                              onChange={(e) => setPostoSearchTerm(e.target.value)}
                                              placeholder="Digite o nome do colaborador"
                                              autoFocus
                                            />
                                          </div>
                                          <div className="max-h-64 space-y-1 overflow-auto">
                                            {colaboradoresFiltradosBusca.length === 0 ? (
                                              <p className="rounded-md border border-dashed px-2 py-2 text-xs text-muted-foreground">
                                                Nenhum colaborador encontrado.
                                              </p>
                                            ) : (
                                              colaboradoresFiltradosBusca.map((candidato) => (
                                                <button
                                                  key={candidato.id}
                                                  type="button"
                                                  className="flex w-full items-center justify-between rounded-md border px-2 py-2 text-left hover:bg-muted"
                                                  onClick={() => {
                                                    void handleSelecionarNoAutocomplete(posto.id, candidato.id)
                                                  }}
                                                  disabled={postoAssignmentLoading}
                                                >
                                                  <div className="min-w-0">
                                                    <p className="truncate text-xs font-medium text-foreground">{candidato.nome}</p>
                                                    <p className="truncate text-xs text-muted-foreground">
                                                      {getDescricaoBuscaColaborador(candidato)}
                                                    </p>
                                                  </div>
                                                  {candidato.funcao_id != null ? (
                                                    <Badge variant="outline" className="text-xs">
                                                      <Briefcase className="mr-1 size-3" />
                                                      {funcaoMap.get(candidato.funcao_id) ?? 'Posto'}
                                                    </Badge>
                                                  ) : (
                                                    <Badge variant="secondary" className="text-xs">
                                                      <Users className="mr-1 size-3" />
                                                      Reserva
                                                    </Badge>
                                                  )}
                                                </button>
                                              ))
                                            )}
                                          </div>
                                        </PopoverContent>
                                      </Popover>
                                      {ocupante && (
                                        <>
                                          <Button
                                            type="button"
                                            variant="ghost"
                                            size="icon"
                                            className="size-7"
                                            onClick={() => {
                                              void handleRemoverTitularPosto(ocupante.id)
                                            }}
                                            disabled={postoAssignmentLoading}
                                            aria-label={`Remover ${ocupante.nome} de ${posto.apelido}`}
                                          >
                                            <UserMinus className="size-3.5" />
                                          </Button>
                                          <Button variant="ghost" size="icon" className="size-7" asChild>
                                            <Link to={`/colaboradores/${ocupante.id}`} aria-label={`Ver perfil de ${ocupante.nome}`}>
                                              <ArrowRight className="size-3.5" />
                                            </Link>
                                          </Button>
                                        </>
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
                    </div>
                  </div>
                )}
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
                  setor={setor}
                  demandas={demandas ?? []}
                  horariosSemana={horariosSemana ?? []}
                  totalColaboradores={colaboradores?.length ?? 0}
                  onSalvar={handleSalvarTimeline}
                />
              </CardContent>
            </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold">Escala</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Tabs value={escalaTab} onValueChange={(value) => setEscalaTab(value as 'simulacao' | 'oficial' | 'historico')} className="space-y-4">
                <TabsList className="grid w-full grid-cols-3">
                  <TabsTrigger value="simulacao">Simulacao</TabsTrigger>
                  <TabsTrigger value="oficial">Oficial</TabsTrigger>
                  <TabsTrigger value="historico">Historico</TabsTrigger>
                </TabsList>

                <TabsContent value="simulacao" className="space-y-4">
                  <div className="space-y-2 rounded-md border p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Select value={periodoPreset} onValueChange={(value) => setPeriodoPreset(value as EscalaPeriodoPreset)}>
                        <SelectTrigger className="h-8 w-[150px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="3_MESES">{getPresetLabel('3_MESES')}</SelectItem>
                          <SelectItem value="6_MESES">{getPresetLabel('6_MESES')}</SelectItem>
                          <SelectItem value="1_ANO">{getPresetLabel('1_ANO')}</SelectItem>
                        </SelectContent>
                      </Select>

                      <Popover>
                        <PopoverTrigger asChild>
                          <Button variant="outline" size="sm" className="gap-1.5">
                            <SlidersHorizontal className="size-3.5" />
                            Configurar
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent align="start" className="w-80 space-y-3">
                          <div className="space-y-1">
                            <p className="text-sm font-medium">Configuracao de geracao</p>
                            <p className="text-xs text-muted-foreground">
                              Defina a estrategia do solver para a geracao desta simulacao.
                            </p>
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">Estrategia</Label>
                            <Select
                              value={solveModeGeracao}
                              onValueChange={(v) => setSolveModeGeracao(v as 'rapido' | 'balanceado' | 'otimizado' | 'maximo')}
                            >
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="rapido">Rapido</SelectItem>
                                <SelectItem value="balanceado">Balanceado</SelectItem>
                                <SelectItem value="otimizado">Otimizado</SelectItem>
                                <SelectItem value="maximo">Maximo</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        </PopoverContent>
                      </Popover>

                      <Button size="sm" className="gap-1.5" onClick={handleGerar} disabled={gerando}>
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
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span>
                        Janela calculada: {formatarData(periodoGeracao.data_inicio)} — {formatarData(periodoGeracao.data_fim)}
                      </span>
                      {escalaCompleta?.escala?.criada_em && (
                        <Badge variant="secondary" className="font-normal text-muted-foreground">
                          Gerado em {formatarDataHora(escalaCompleta.escala.criada_em)}
                        </Badge>
                      )}
                    </div>
                  </div>

                  {escalaCompleta ? (
                    <div className="space-y-3 rounded-md border p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-semibold">Ciclo Rotativo</p>
                          <StatusBadge status="RASCUNHO" />
                          <Badge variant="outline" className={cn(
                            escalaCompleta.violacoes.length > 0 ? 'border-warning/20 text-warning' : 'border-success/20 text-success',
                          )}>
                            {escalaCompleta.violacoes.length > 0 ? `${escalaCompleta.violacoes.length} aviso(s)` : 'Sem avisos relevantes'}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => abrirModalExportacao(escalaCompleta)}
                          >
                            Exportar
                          </Button>
                          <Button variant="outline" size="sm" asChild>
                            <Link to={`/setores/${setorId}/escala?escalaId=${escalaCompleta.escala.id}`}>Ver completo</Link>
                          </Button>
                        </div>
                      </div>
                      <EscalaCicloResumo
                        escala={escalaCompleta.escala}
                        alocacoes={escalaCompleta.alocacoes}
                        colaboradores={orderedColabs}
                        funcoes={postosOrdenados}
                        regrasPadrao={regrasPadrao ?? []}
                      />
                      {escalaCompleta.comparacao_demanda.length > 0 && (
                        <CoberturaChart
                          comparacao={escalaCompleta.comparacao_demanda}
                          indicadores={escalaCompleta.indicadores}
                          className="rounded-md border p-3"
                        />
                      )}
                    </div>
                  ) : (
                    <div className="rounded-lg border border-dashed px-4 py-5">
                      <p className="text-sm font-medium text-foreground">Nenhuma simulacao gerada</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Selecione o periodo e clique em <strong>Gerar Escala</strong>.
                      </p>
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="oficial" className="space-y-4">
                  {!escalaOficialAtual ? (
                    <div className="rounded-lg border border-dashed px-4 py-5">
                      <p className="text-sm font-medium text-foreground">Nenhuma escala oficial encontrada</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Gere uma simulacao e oficialize para aparecer aqui.
                      </p>
                      <Button variant="outline" size="sm" className="mt-3" onClick={() => setEscalaTab('simulacao')}>
                        Ir para Simulacao
                      </Button>
                    </div>
                  ) : carregandoTabEscala ? (
                    <div className="flex items-center justify-center py-10">
                      <Loader2 className="size-5 animate-spin text-muted-foreground" />
                    </div>
                  ) : oficialCompleta ? (
                    <div className="space-y-3 rounded-md border p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-semibold">Ciclo Rotativo</p>
                          <StatusBadge status="OFICIAL" />
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => abrirModalExportacao(oficialCompleta)}
                          >
                            Exportar
                          </Button>
                          <Button variant="outline" size="sm" asChild>
                            <Link to={`/setores/${setorId}/escala?escalaId=${oficialCompleta.escala.id}`}>Ver completo</Link>
                          </Button>
                        </div>
                      </div>
                      <EscalaCicloResumo
                        escala={oficialCompleta.escala}
                        alocacoes={oficialCompleta.alocacoes}
                        colaboradores={orderedColabs}
                        funcoes={postosOrdenados}
                        regrasPadrao={regrasPadrao ?? []}
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
                </TabsContent>

                <TabsContent value="historico" className="space-y-4">
                  {escalasHistorico.length === 0 ? (
                    <div className="rounded-lg border border-dashed px-4 py-5">
                      <p className="text-sm font-medium text-foreground">Historico vazio</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Ainda nao existem escalas arquivadas para este setor.
                      </p>
                      <Button variant="outline" size="sm" className="mt-3" onClick={() => setEscalaTab('simulacao')}>
                        Gerar primeira simulacao
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="flex flex-wrap gap-2">
                        {escalasHistorico.map((escala) => (
                          <Button
                            key={escala.id}
                            type="button"
                            size="sm"
                            variant={historicoSelecionadaId === escala.id ? 'secondary' : 'outline'}
                            onClick={() => setHistoricoSelecionadaId(escala.id)}
                            className="h-auto items-start px-3 py-2"
                          >
                            <div className="text-left">
                              <p className="text-xs font-medium">{formatarData(escala.data_inicio)} — {formatarData(escala.data_fim)}</p>
                              <p className="text-xs uppercase text-muted-foreground">{escala.status}</p>
                            </div>
                          </Button>
                        ))}
                      </div>

                      {carregandoTabEscala ? (
                        <div className="flex items-center justify-center py-10">
                          <Loader2 className="size-5 animate-spin text-muted-foreground" />
                        </div>
                      ) : historicoCompleta ? (
                        <div className="space-y-3 rounded-md border p-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <p className="text-sm font-semibold">Ciclo Rotativo</p>
                              <Badge variant="outline" className="text-xs">
                                {historicoCompleta.escala.status}
                              </Badge>
                            </div>
                            <div className="flex items-center gap-2">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => abrirModalExportacao(historicoCompleta)}
                              >
                                Exportar
                              </Button>
                              <Button variant="outline" size="sm" asChild>
                                <Link to={`/setores/${setorId}/escala?escalaId=${historicoCompleta.escala.id}`}>Ver completo</Link>
                              </Button>
                            </div>
                          </div>
                          <EscalaCicloResumo
                            escala={historicoCompleta.escala}
                            alocacoes={historicoCompleta.alocacoes}
                            colaboradores={orderedColabs}
                            funcoes={postosOrdenados}
                            regrasPadrao={regrasPadrao ?? []}
                          />
                        </div>
                      ) : null}
                    </div>
                  )}
                </TabsContent>
              </Tabs>
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
            <Button onClick={handleSalvarExcDemanda} disabled={excDemandaSalvando}>
              {excDemandaSalvando ? 'Salvando...' : 'Salvar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Novo Posto Dialog ─── */}
      <Dialog open={showPostoDialog} onOpenChange={setShowPostoDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Novo Posto</DialogTitle>
            <DialogDescription>
              Defina um posto de trabalho para este setor.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Nome do Posto</Label>
              <Input
                placeholder="Ex: Caixa, Repositor, Seguranca"
                value={novoPostoApelido}
                onChange={(e) => setNovoPostoApelido(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCriarPosto()
                }}
                autoFocus
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPostoDialog(false)}>
              Cancelar
            </Button>
            <Button
              onClick={handleCriarPosto}
              disabled={criandoPosto || !novoPostoApelido.trim()}
            >
              {criandoPosto ? 'Criando...' : 'Criar Posto'}
            </Button>
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

      <DirtyGuardDialog blocker={blocker} />
    </div>
  )
}
