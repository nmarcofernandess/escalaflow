import { useState, useEffect, useCallback, useMemo } from 'react'
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
  CalendarDays,
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
import { cn } from '@/lib/utils'
import { PageHeader } from '@/componentes/PageHeader'
import { DirtyGuardDialog } from '@/componentes/DirtyGuardDialog'
import { useDirtyGuard } from '@/hooks/useDirtyGuard'
import { EmptyState } from '@/componentes/EmptyState'
import { StatusBadge } from '@/componentes/StatusBadge'
import { EscalaResultBanner } from '@/componentes/EscalaResultBanner'
import { ExportarEscala } from '@/componentes/ExportarEscala'
import { IconPicker } from '@/componentes/IconPicker'
import { DemandaEditor } from '@/componentes/DemandaEditor'
import { setoresService } from '@/servicos/setores'
import { colaboradoresService } from '@/servicos/colaboradores'
import { escalasService } from '@/servicos/escalas'
import { tiposContratoService } from '@/servicos/tipos-contrato'
import { funcoesService } from '@/servicos/funcoes'
import { excecoesService } from '@/servicos/excecoes'
import { useApiData } from '@/hooks/useApiData'
import { formatarData, mapError } from '@/lib/formatadores'
import { buildStandaloneHtml } from '@/lib/export-standalone-html'
import { toast } from 'sonner'
import { Switch } from '@/components/ui/switch'
import { exportarService } from '@/servicos/exportar'
import type {
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

function buildPeriodoGeracaoPadrao() {
  const hoje = new Date()
  const data_inicio = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 1).toISOString().split('T')[0]
  const data_fim = new Date(hoje.getFullYear(), hoje.getMonth() + 4, 0).toISOString().split('T')[0]
  return { data_inicio, data_fim }
}

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

  const { data: escalas } = useApiData<Escala[]>(
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

  const { data: regrasPadrao } = useApiData<RegraHorarioColaborador[]>(
    () => colaboradoresService.listarRegrasPadraoSetor(setorId),
    [setorId],
  )

  const contratoMap = new Map((tiposContrato ?? []).map((tc) => [tc.id, tc.nome]))
  const funcoesList = useMemo(() => funcoes ?? [], [funcoes])

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
  const [gerando, setGerando] = useState(false)
  const [escalaCompleta, setEscalaCompleta] = useState<EscalaCompletaV3 | null>(null)
  const [oficializando, setOficializando] = useState(false)
  const [descartando, setDescartando] = useState(false)
  const [periodoGeracao, setPeriodoGeracao] = useState(() => buildPeriodoGeracaoPadrao())
  const [solveModeGeracao, setSolveModeGeracao] = useState<'rapido' | 'otimizado'>('rapido')
  const [maxTimeGeracao, setMaxTimeGeracao] = useState(90)
  const [incluirAvisosExportCiclo, setIncluirAvisosExportCiclo] = useState(false)

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
  const escalaAtual = (escalas ?? []).length > 0
    ? (escalas ?? []).reduce((a, b) => (a.criada_em > b.criada_em ? a : b))
    : null

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

  // ─── Handlers ────────────────────────────────────────────────────────
  const handleSalvar = async (data: SetorFormData) => {
    setSalvando(true)
    try {
      await setoresService.atualizar(setorId, {
        nome: data.nome.trim(),
        icone: data.icone ?? null,
        hora_abertura: data.hora_abertura,
        hora_fechamento: data.hora_fechamento,
        regime_escala: data.regime_escala,
      })
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

    const maxTimeSeconds = Math.max(30, Math.min(300, Math.round(maxTimeGeracao || 90)))

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

    setGerando(true)
    try {
      const result = await escalasService.gerar(setorId, {
        data_inicio: dataInicio,
        data_fim: dataFim,
        solveMode: solveModeGeracao,
        maxTimeSeconds: solveModeGeracao === 'otimizado' ? maxTimeSeconds : undefined,
      })
      setEscalaCompleta(result)
      toast.success('Escala gerada')
    } catch (err) {
      toast.error(mapError(err) || 'Nao foi possivel gerar a escala.')
    } finally {
      setGerando(false)
    }
  }

  const handleOficializar = async () => {
    if (!escalaCompleta) return
    setOficializando(true)
    try {
      await escalasService.oficializar(escalaCompleta.escala.id)
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

  const handleExportarHTML = () => {
    if (!escalaCompleta || !setor || !colaboradores) return
    import('react-dom/server').then(({ renderToStaticMarkup }) => {
      const html = renderToStaticMarkup(
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
          incluirAvisos={incluirAvisosExportCiclo}
          modoRender="download"
        />,
      )
      const fullHTML = buildStandaloneHtml(html, {
        title: `Escala - ${setor.nome}`,
      })
      exportarService.salvarHTML(fullHTML, `escala-${setor.nome.toLowerCase().replace(/\s+/g, '-')}.html`).then((result) => {
        if (result) toast.success('HTML salvo com sucesso')
      }).catch(() => {
        toast.error('Erro ao exportar HTML')
      })
    })
  }

  // Auto-load rascunho existente
  useEffect(() => {
    if (!escalas?.length) return
    const rascunho = escalas.find((e) => e.status === 'RASCUNHO')
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

        <Tabs defaultValue="pessoas" className="space-y-4">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="pessoas">1. Pessoas</TabsTrigger>
            <TabsTrigger value="demanda">2. Demanda por horario</TabsTrigger>
            <TabsTrigger value="escala">3. Escala</TabsTrigger>
          </TabsList>

          <TabsContent value="pessoas">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-3">
                <CardTitle className="text-base font-semibold">Equipe</CardTitle>
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
                        <span className="ml-2 text-[10px] font-normal normal-case tracking-normal text-muted-foreground/70">(arraste ⠿ para reordenar)</span>
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
                                  <TableCell className="text-xs text-muted-foreground">{contratoNome}</TableCell>
                                  <TableCell className="text-xs text-muted-foreground">
                                    {ocupante ? (ocupante.sexo === 'M' ? 'Masc' : 'Fem') : '-'}
                                  </TableCell>
                                  <TableCell>
                                    {ocupante ? (
                                      <Badge variant="outline" className={cn(
                                        'text-xs',
                                        status === 'Ativo' && 'border-emerald-500/40 text-emerald-600 dark:text-emerald-400',
                                        status === 'Ferias' && 'border-amber-500/40 text-amber-600 dark:text-amber-400',
                                        status === 'Atestado' && 'border-red-500/40 text-red-600 dark:text-red-400',
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
                                                    <p className="truncate text-[11px] text-muted-foreground">
                                                      {getDescricaoBuscaColaborador(candidato)}
                                                    </p>
                                                  </div>
                                                  {candidato.funcao_id != null ? (
                                                    <Badge variant="outline" className="text-[10px]">
                                                      <Briefcase className="mr-1 size-3" />
                                                      {funcaoMap.get(candidato.funcao_id) ?? 'Posto'}
                                                    </Badge>
                                                  ) : (
                                                    <Badge variant="secondary" className="text-[10px]">
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
            </Card>
          </TabsContent>

          <TabsContent value="demanda">
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
          </TabsContent>

          <TabsContent value="escala">
            <Card>
              <CardHeader className="flex flex-row items-start justify-between gap-3 pb-3">
                <div>
                  <CardTitle className="text-base font-semibold">
                    Escala
                  </CardTitle>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Periodo de geracao:{' '}
                    {periodoGeracao.data_inicio && periodoGeracao.data_fim
                      ? `${formatarData(periodoGeracao.data_inicio)} — ${formatarData(periodoGeracao.data_fim)}`
                      : 'nao definido'}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" size="sm" className="gap-1.5">
                        <SlidersHorizontal className="size-3.5" />
                        Configurar
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent align="end" className="w-80 space-y-3">
                      <div className="space-y-1">
                        <p className="text-sm font-medium">Configuracao de geracao</p>
                        <p className="text-xs text-muted-foreground">
                          Defina periodo e estrategia do solver para esta geracao.
                        </p>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1">
                          <Label className="text-xs">Data inicial</Label>
                          <Input
                            type="date"
                            value={periodoGeracao.data_inicio}
                            onChange={(e) => setPeriodoGeracao((prev) => ({ ...prev, data_inicio: e.target.value }))}
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Data final</Label>
                          <Input
                            type="date"
                            value={periodoGeracao.data_fim}
                            onChange={(e) => setPeriodoGeracao((prev) => ({ ...prev, data_fim: e.target.value }))}
                          />
                        </div>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Estrategia</Label>
                        <Select
                          value={solveModeGeracao}
                          onValueChange={(v) => setSolveModeGeracao(v as 'rapido' | 'otimizado')}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="rapido">Rapido</SelectItem>
                            <SelectItem value="otimizado">Otimizado</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      {solveModeGeracao === 'otimizado' && (
                        <div className="space-y-1">
                          <Label className="text-xs">Tempo maximo (segundos)</Label>
                          <Input
                            type="number"
                            min={30}
                            max={300}
                            value={maxTimeGeracao}
                            onChange={(e) => setMaxTimeGeracao(parseInt(e.target.value || '90', 10))}
                          />
                        </div>
                      )}
                      <div className="flex items-center justify-between rounded-md border px-3 py-2">
                        <div className="space-y-0.5">
                          <p className="text-xs font-medium">Incluir avisos no export ciclo</p>
                          <p className="text-[11px] text-muted-foreground">
                            Padrao recomendado: desativado para export operacional.
                          </p>
                        </div>
                        <Switch
                          checked={incluirAvisosExportCiclo}
                          onCheckedChange={setIncluirAvisosExportCiclo}
                        />
                      </div>
                    </PopoverContent>
                  </Popover>
                  <Button size="sm" className="gap-1.5" onClick={handleGerar} disabled={gerando}>
                    {gerando ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : escalaCompleta || (escalaAtual && escalaAtual.status === 'OFICIAL') ? (
                      <RotateCcw className="size-3.5" />
                    ) : (
                      <Play className="size-3.5" />
                    )}
                    {escalaCompleta || (escalaAtual && escalaAtual.status === 'OFICIAL') ? 'Regerar' : 'Gerar Escala'}
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {escalaCompleta ? (
                  <div className="space-y-3">
                    <EscalaResultBanner
                      diagnostico={escalaCompleta.diagnostico}
                      indicadores={escalaCompleta.indicadores}
                      antipatterns={escalaCompleta.antipatterns.length}
                      dataInicio={escalaCompleta.escala.data_inicio}
                      dataFim={escalaCompleta.escala.data_fim}
                      onAbrirDetalhes={() => navigate(`/setores/${setorId}/escala`)}
                      onExportar={handleExportarHTML}
                      onOficializar={handleOficializar}
                      onDescartar={handleDescartar}
                      oficializando={oficializando}
                      descartando={descartando}
                    />
                    {(() => {
                      const colabsComRegra = (regrasPadrao ?? []).filter(
                        (r) => r.folga_fixa_dia_semana != null || r.folga_variavel_dia_semana != null,
                      )
                      if (colabsComRegra.length === 0) return null
                      return (
                        <div className="rounded-lg border bg-muted/30 px-4 py-3">
                          <p className="mb-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Folgas configuradas</p>
                          <div className="space-y-1">
                            {colabsComRegra.map((r) => {
                              const colab = orderedColabs.find((c) => c.id === r.colaborador_id)
                              if (!colab) return null
                              const nome = colab.nome.split(' ').slice(0, 2).join(' ')
                              const ff = r.folga_fixa_dia_semana
                              const fv = r.folga_variavel_dia_semana
                              return (
                                <div key={r.colaborador_id} className="flex items-center gap-2">
                                  <span className="text-xs font-medium text-foreground w-32 truncate">{nome}</span>
                                  {ff != null && (
                                    <Badge variant="outline" className="text-[10px] border-blue-500/40 text-blue-600 dark:text-blue-400">
                                      [F] {ff}
                                    </Badge>
                                  )}
                                  {fv != null && (
                                    <Badge variant="outline" className="text-[10px] border-purple-500/40 text-purple-600 dark:text-purple-400">
                                      (V) {fv}
                                    </Badge>
                                  )}
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      )
                    })()}
                  </div>
                ) : escalaAtual && escalaAtual.status === 'OFICIAL' ? (
                  <div className="flex items-center justify-between rounded-lg border p-4">
                    <div className="flex items-center gap-3">
                      <CalendarDays className="size-5 text-primary" />
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-foreground">
                            {formatarData(escalaAtual.data_inicio)} — {formatarData(escalaAtual.data_fim)}
                          </span>
                          <StatusBadge status="OFICIAL" />
                        </div>
                        {escalaAtual.pontuacao !== null && (
                          <p className="text-xs text-muted-foreground">
                            Pontuacao: {escalaAtual.pontuacao}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button variant="outline" size="sm" asChild>
                        <Link to={`/setores/${setorId}/escala`}>Ver completo</Link>
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed px-4 py-5">
                    <p className="text-sm font-medium text-foreground">Nenhuma escala gerada para este setor</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Ajuste o periodo em <strong>Configurar</strong> e clique em <strong>Gerar Escala</strong>.
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Excecoes de Demanda por Data — oculto (IA configura via tool) */}

        {/* Loading overlay durante geracao */}
        {gerando && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/60 backdrop-blur-sm animate-in fade-in-0 duration-200">
            <Card className="w-full max-w-sm border-2 shadow-lg">
              <CardContent className="flex flex-col items-center justify-center gap-4 py-10">
                <Loader2 className="size-10 animate-spin text-primary" />
                <p className="text-center text-sm font-medium text-foreground">
                  Gerando escala para {setor?.nome ?? 'setor'}...
                </p>
                <p className="text-center text-xs text-muted-foreground">
                  O motor esta calculando. Aguarde.
                </p>
              </CardContent>
            </Card>
          </div>
        )}
      </div>

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
