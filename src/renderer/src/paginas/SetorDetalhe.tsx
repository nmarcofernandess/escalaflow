import { useState, useEffect, useCallback, useMemo } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import type { DragEndEvent } from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  Save,
  GripVertical,
  CalendarDays,
  Users,
  ArrowRight,
  Archive,
  Plus,
  Trash2,
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
import { cn } from '@/lib/utils'
import { PageHeader } from '@/componentes/PageHeader'
import { EmptyState } from '@/componentes/EmptyState'
import { StatusBadge } from '@/componentes/StatusBadge'
import { IconPicker } from '@/componentes/IconPicker'
import { DemandaEditor } from '@/componentes/DemandaEditor'
import { setoresService } from '@/servicos/setores'
import { colaboradoresService } from '@/servicos/colaboradores'
import { escalasService } from '@/servicos/escalas'
import { tiposContratoService } from '@/servicos/tipos-contrato'
import { funcoesService } from '@/servicos/funcoes'
import { excecoesService } from '@/servicos/excecoes'
import { useApiData } from '@/hooks/useApiData'
import { formatarData } from '@/lib/formatadores'
import { toast } from 'sonner'
import type {
  Setor,
  Demanda,
  Colaborador,
  Escala,
  TipoContrato,
  Funcao,
  Excecao,
  SetorHorarioSemana,
  SalvarTimelineDiaInput,
} from '@shared/index'

// ─── Posto Card (read-only dashboard) ─────────────────────────────────
function PostoCard({
  funcao,
  ocupante,
  isAusente,
  onDeletar,
}: {
  funcao: Funcao
  ocupante: Colaborador | null
  isAusente: boolean
  onDeletar: (funcaoId: number) => void
}) {
  return (
    <div
      className={cn(
        'group relative flex flex-col items-center gap-1.5 rounded-lg border px-4 py-3 min-w-[110px]',
        !ocupante && 'border-dashed border-muted-foreground/25',
        ocupante && !isAusente && 'border-green-500/30 bg-green-500/5 dark:bg-green-500/10',
        ocupante && isAusente && 'border-amber-500/30 bg-amber-500/5 dark:bg-amber-500/10',
      )}
    >
      {!ocupante && (
        <button
          type="button"
          onClick={() => onDeletar(funcao.id)}
          className="absolute -right-1.5 -top-1.5 hidden size-5 items-center justify-center rounded-full border bg-background text-muted-foreground shadow-sm hover:text-destructive group-hover:flex"
        >
          <Trash2 className="size-3" />
        </button>
      )}
      <span className="text-sm font-medium">{funcao.apelido}</span>
      {ocupante ? (
        isAusente ? (
          <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-600 dark:text-amber-400">
            Ausente
          </Badge>
        ) : (
          <Badge variant="outline" className="text-[10px] border-green-500/40 text-green-600 dark:text-green-400">
            Ocupado
          </Badge>
        )
      ) : (
        <Badge variant="outline" className="text-[10px] text-muted-foreground">
          Vago
        </Badge>
      )}
    </div>
  )
}

// ─── Sortable Collaborator Row ─────────────────────────────────────────
function SortableColabRow({
  colab,
  index,
  contratoNome,
  excecaoTipo,
  funcoesList,
  onPostoChange,
}: {
  colab: Colaborador
  index: number
  contratoNome: string
  excecaoTipo: string | null
  funcoesList: Funcao[]
  onPostoChange: (colabId: number, funcaoId: number | null) => void
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: colab.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  const currentValue =
    colab.funcao_id != null && funcoesList.some((f) => f.id === colab.funcao_id)
      ? String(colab.funcao_id)
      : '__none__'

  return (
    <TableRow ref={setNodeRef} style={style}>
      <TableCell className="w-[40px] pl-4">
        <GripVertical
          className="size-4 cursor-grab text-muted-foreground/50"
          {...attributes}
          {...listeners}
        />
      </TableCell>
      <TableCell className="w-[40px] text-center text-muted-foreground">{index + 1}</TableCell>
      <TableCell className="font-medium">{colab.nome}</TableCell>
      <TableCell>
        <Badge variant="outline" className="text-[10px]">{contratoNome}</Badge>
      </TableCell>
      <TableCell>
        <Select
          value={currentValue}
          onValueChange={(v) => onPostoChange(colab.id, v === '__none__' ? null : parseInt(v))}
        >
          <SelectTrigger className="h-7 w-[130px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">
              <span className="text-muted-foreground">Sem posto</span>
            </SelectItem>
            {funcoesList.map((f) => (
              <SelectItem key={f.id} value={String(f.id)}>
                {f.apelido}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </TableCell>
      <TableCell className="text-muted-foreground">
        {colab.sexo === 'M' ? 'Masc' : 'Fem'}
      </TableCell>
      <TableCell>
        {excecaoTipo ? (
          <Badge variant="outline" className={cn(
            'text-[10px]',
            excecaoTipo === 'FERIAS' && 'border-amber-500/40 text-amber-600 dark:text-amber-400',
            excecaoTipo === 'ATESTADO' && 'border-red-500/40 text-red-600 dark:text-red-400',
            excecaoTipo === 'BLOQUEIO' && 'border-muted-foreground/40 text-muted-foreground',
          )}>
            {excecaoTipo === 'FERIAS' ? 'Ferias' : excecaoTipo === 'ATESTADO' ? 'Atestado' : 'Bloqueio'}
          </Badge>
        ) : (
          <span className="text-xs text-green-600 dark:text-green-400">Ativo</span>
        )}
      </TableCell>
      <TableCell className="text-right pr-4">
        <Button variant="ghost" size="sm" asChild>
          <Link to={`/colaboradores/${colab.id}`}>
            <ArrowRight className="size-4" />
          </Link>
        </Button>
      </TableCell>
    </TableRow>
  )
}

// ─── Form schema ───────────────────────────────────────────────────────
const setorSchema = z.object({
  nome: z.string().min(2, 'Nome deve ter ao menos 2 caracteres'),
  icone: z.string().nullable(),
  hora_abertura: z.string().min(1, 'Hora de abertura e obrigatoria'),
  hora_fechamento: z.string().min(1, 'Hora de fechamento e obrigatoria'),
  piso_operacional: z.coerce.number().int().min(1, 'Minimo 1 pessoa'),
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
    defaultValues: { nome: '', icone: null, hora_abertura: '', hora_fechamento: '', piso_operacional: 1 },
  })

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

  const contratoMap = new Map((tiposContrato ?? []).map((tc) => [tc.id, tc.nome]))
  const funcoesList = funcoes ?? []

  // ─── State ───────────────────────────────────────────────────────────
  const [showPostoDialog, setShowPostoDialog] = useState(false)
  const [novoPostoApelido, setNovoPostoApelido] = useState('')
  const [criandoPosto, setCriandoPosto] = useState(false)
  const [orderedColabs, setOrderedColabs] = useState<Colaborador[]>([])
  const [pendingAssignment, setPendingAssignment] = useState<{
    colabId: number
    funcaoId: number
    occupantName: string
    funcaoNome: string
  } | null>(null)

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

  // ─── DnD setup (rank reorder only) ─────────────────────────────────
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  )

  // Sync ordered list when API data changes
  useEffect(() => {
    if (colaboradores) {
      setOrderedColabs([...colaboradores].sort((a, b) => a.rank - b.rank))
    }
  }, [colaboradores])

  // ─── DnD handler (rank reorder only) ───────────────────────────────
  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return

    const oldIndex = orderedColabs.findIndex((c) => c.id === active.id)
    const newIndex = orderedColabs.findIndex((c) => c.id === over.id)
    if (oldIndex === -1 || newIndex === -1) return

    const newOrder = arrayMove(orderedColabs, oldIndex, newIndex)
    setOrderedColabs(newOrder)

    try {
      await setoresService.reordenarRank(setorId, newOrder.map((c) => c.id))
      toast.success('Prioridade atualizada')
    } catch (err) {
      setOrderedColabs([...(colaboradores ?? [])].sort((a, b) => a.rank - b.rank))
      toast.error(err instanceof Error ? err.message : 'Erro ao reordenar')
    }
  }

  // ─── Posto assignment via dropdown ─────────────────────────────────
  const handlePostoChange = async (colabId: number, newFuncaoId: number | null) => {
    const colab = orderedColabs.find((c) => c.id === colabId)
    if (!colab) return

    // Same value — noop
    if (colab.funcao_id === newFuncaoId) return

    // Removing from posto
    if (newFuncaoId === null) {
      try {
        await colaboradoresService.atualizar(colabId, { funcao_id: null })
        setOrderedColabs((prev) =>
          prev.map((c) => (c.id === colabId ? { ...c, funcao_id: null } : c)),
        )
        toast.success(`${colab.nome} removido do posto`)
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Erro ao remover do posto')
      }
      return
    }

    // Check if new posto is occupied by someone else
    const currentOccupant = ocupanteMap.get(newFuncaoId)
    if (currentOccupant && currentOccupant.id !== colabId) {
      setPendingAssignment({
        colabId,
        funcaoId: newFuncaoId,
        occupantName: currentOccupant.nome,
        funcaoNome: funcaoMap.get(newFuncaoId) ?? '',
      })
      return
    }

    // Assign to vacant posto
    await handleAtribuirPosto(colabId, newFuncaoId)
  }

  const handleAtribuirPosto = async (colabId: number, funcaoId: number) => {
    const currentOccupant = ocupanteMap.get(funcaoId)

    try {
      if (currentOccupant && currentOccupant.id !== colabId) {
        await colaboradoresService.atualizar(currentOccupant.id, { funcao_id: null })
      }
      await colaboradoresService.atualizar(colabId, { funcao_id: funcaoId })

      setOrderedColabs((prev) =>
        prev.map((c) => {
          if (c.id === colabId) return { ...c, funcao_id: funcaoId }
          if (currentOccupant && c.id === currentOccupant.id) return { ...c, funcao_id: null }
          return c
        }),
      )

      const nome = orderedColabs.find((c) => c.id === colabId)?.nome ?? ''
      toast.success(`${nome} atribuido a ${funcaoMap.get(funcaoId) ?? 'posto'}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao atribuir posto')
    }
  }

  const handleConfirmarSubstituicao = async () => {
    if (!pendingAssignment) return
    await handleAtribuirPosto(pendingAssignment.colabId, pendingAssignment.funcaoId)
    setPendingAssignment(null)
  }

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
        piso_operacional: setor.piso_operacional ?? 1,
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
        piso_operacional: data.piso_operacional,
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

  const handleArquivar = async () => {
    try {
      await setoresService.atualizar(setorId, { ativo: false })
      toast.success('Setor arquivado')
      navigate('/setores')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao arquivar setor')
    }
  }

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

  const handleDeletarPosto = async (funcaoId: number) => {
    const ocupante = ocupanteMap.get(funcaoId)
    if (ocupante) {
      toast.error(`Remova ${ocupante.nome} do posto antes de deletar`)
      return
    }
    try {
      await funcoesService.deletar(funcaoId)
      toast.success('Posto removido')
      reloadFuncoes()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao remover posto')
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

      <div className="flex-1 space-y-6 p-6">
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
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
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
              </div>
              <FormField
                control={setorForm.control}
                name="piso_operacional"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Piso Operacional (pessoas)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min="1"
                        value={typeof field.value === 'number' ? field.value : ''}
                        onChange={(e) => field.onChange(e.target.value === '' ? '' : Number(e.target.value))}
                        onBlur={field.onBlur}
                        name={field.name}
                        ref={field.ref}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>
        </Form>

        {/* Demandas — Editor Visual */}
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
              onSalvar={handleSalvarTimeline}
            />
          </CardContent>
        </Card>

        {/* Postos — read-only dashboard */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-base font-semibold">
              Postos
            </CardTitle>
            <div className="flex items-center gap-2">
              {funcoesList.length > 0 && (
                <span className="text-xs text-muted-foreground">
                  {funcoesList.filter((f) => ocupanteMap.has(f.id)).length}/{funcoesList.length} preenchidos
                </span>
              )}
              <Button variant="outline" size="sm" onClick={() => setShowPostoDialog(true)}>
                <Plus className="mr-1 size-3.5" /> Novo Posto
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {funcoesList.length === 0 ? (
              <EmptyState
                icon={Briefcase}
                title="Nenhum posto definido"
                description="Defina os postos de trabalho para organizar a equipe"
                action={
                  <Button variant="outline" size="sm" onClick={() => setShowPostoDialog(true)}>
                    <Plus className="mr-1 size-3.5" /> Novo Posto
                  </Button>
                }
              />
            ) : (
              <div className="flex flex-wrap gap-3">
                {funcoesList.map((funcao) => {
                  const ocupante = ocupanteMap.get(funcao.id) ?? null
                  const isAusente = ocupante ? excecaoMap.has(ocupante.id) : false
                  return (
                    <PostoCard
                      key={funcao.id}
                      funcao={funcao}
                      ocupante={ocupante}
                      isAusente={isAusente}
                      onDeletar={handleDeletarPosto}
                    />
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Colaboradores com rank — DnD only for reorder */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-base font-semibold">
              Colaboradores
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                (arraste para reordenar prioridade)
              </span>
            </CardTitle>
            <Button variant="outline" size="sm" asChild>
              <Link to="/colaboradores">
                <Users className="mr-1 size-3.5" /> Gerenciar
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
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
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={orderedColabs.map((c) => c.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[40px] pl-4" />
                        <TableHead className="w-[40px] text-center">#</TableHead>
                        <TableHead>Nome</TableHead>
                        <TableHead>Contrato</TableHead>
                        <TableHead>Posto</TableHead>
                        <TableHead>Sexo</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="w-[60px] text-right pr-4" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {orderedColabs.map((colab, i) => (
                        <SortableColabRow
                          key={colab.id}
                          colab={colab}
                          index={i}
                          contratoNome={contratoMap.get(colab.tipo_contrato_id) ?? 'Contrato'}
                          excecaoTipo={excecaoMap.get(colab.id)?.tipo ?? null}
                          funcoesList={funcoesList}
                          onPostoChange={handlePostoChange}
                        />
                      ))}
                    </TableBody>
                  </Table>
                </SortableContext>
              </DndContext>
            )}
          </CardContent>
        </Card>

        {/* Escala Atual */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold">
              Escala Atual
            </CardTitle>
          </CardHeader>
          <CardContent>
            {escalaAtual ? (
              <div className="flex items-center justify-between rounded-lg border p-4">
                <div className="flex items-center gap-3">
                  <CalendarDays className="size-5 text-primary" />
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-foreground">
                        {formatarData(escalaAtual.data_inicio)} - {formatarData(escalaAtual.data_fim)}
                      </span>
                      <StatusBadge status={escalaAtual.status === 'ARQUIVADA' ? 'SEM_ESCALA' : escalaAtual.status as 'OFICIAL' | 'RASCUNHO'} />
                    </div>
                    {escalaAtual.pontuacao !== null && (
                      <p className="text-xs text-muted-foreground">
                        Pontuacao: {escalaAtual.pontuacao}
                      </p>
                    )}
                  </div>
                </div>
                <Button size="sm" asChild>
                  <Link to={`/setores/${setorId}/escala`}>Abrir Escala</Link>
                </Button>
              </div>
            ) : (
              <EmptyState
                icon={CalendarDays}
                title="Nenhuma escala gerada para este setor"
                description="Gere uma escala para distribuir os horarios dos colaboradores"
                action={
                  <Button size="sm" asChild>
                    <Link to={`/setores/${setorId}/escala`}>
                      <CalendarDays className="mr-1 size-3.5" /> Gerar Escala
                    </Link>
                  </Button>
                }
              />
            )}
          </CardContent>
        </Card>
      </div>

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

      {/* ─── Substituicao Confirmation Dialog ─── */}
      <AlertDialog open={!!pendingAssignment} onOpenChange={(open) => { if (!open) setPendingAssignment(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Substituir posto?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingAssignment && (
                <>
                  <strong>{orderedColabs.find((c) => c.id === pendingAssignment.colabId)?.nome}</strong>
                  {' '}vai assumir o posto{' '}
                  <strong>{pendingAssignment.funcaoNome}</strong>.
                  {' '}<strong>{pendingAssignment.occupantName}</strong> ficara sem posto.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmarSubstituicao}>
              Substituir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
