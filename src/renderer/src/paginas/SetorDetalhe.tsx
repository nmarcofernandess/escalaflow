import { useState, useEffect, useCallback } from 'react'
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
import { PageHeader } from '@/componentes/PageHeader'
import { EmptyState } from '@/componentes/EmptyState'
import { StatusBadge } from '@/componentes/StatusBadge'
import { IconPicker } from '@/componentes/IconPicker'
import { DemandaTimelineSingleLane } from '@/componentes/DemandaTimelineSingleLane'
import { setoresService } from '@/servicos/setores'
import { colaboradoresService } from '@/servicos/colaboradores'
import { escalasService } from '@/servicos/escalas'
import { tiposContratoService } from '@/servicos/tipos-contrato'
import { funcoesService } from '@/servicos/funcoes'
import { useApiData } from '@/hooks/useApiData'
import { formatarData } from '@/lib/formatadores'
import { toast } from 'sonner'
import type { Setor, Demanda, Colaborador, Escala, TipoContrato, Funcao, SetorHorarioSemana, SalvarTimelineDiaInput } from '@shared/index'

function SortableColabRow({
  colab,
  index,
  contratoNome,
}: {
  colab: Colaborador
  index: number
  contratoNome: string
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
      <TableCell className="text-muted-foreground">
        {colab.sexo === 'M' ? 'Masc' : 'Fem'}
      </TableCell>
      <TableCell className="text-muted-foreground">
        {colab.prefere_turno
          ? colab.prefere_turno === 'MANHA' ? 'Manha' : 'Tarde'
          : '—'}
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

const setorSchema = z.object({
  nome: z.string().min(2, 'Nome deve ter ao menos 2 caracteres'),
  icone: z.string().nullable(),
  hora_abertura: z.string().min(1, 'Hora de abertura e obrigatoria'),
  hora_fechamento: z.string().min(1, 'Hora de fechamento e obrigatoria'),
  piso_operacional: z.number().int().min(1, 'Piso minimo é 1'),
})

type SetorFormData = z.infer<typeof setorSchema>

export function SetorDetalhe() {
  const { id } = useParams<{ id: string }>()
  const setorId = parseInt(id!)
  const navigate = useNavigate()

  // Form
  const [salvando, setSalvando] = useState(false)
  const setorForm = useForm<SetorFormData>({
    resolver: zodResolver(setorSchema),
    defaultValues: { nome: '', icone: null, hora_abertura: '', hora_fechamento: '', piso_operacional: 1 },
  })

  // Data loading
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

  const contratoMap = new Map((tiposContrato ?? []).map((tc) => [tc.id, tc.nome]))
  const funcoesList = funcoes ?? []

  // Postos dialog state
  const [showPostoDialog, setShowPostoDialog] = useState(false)
  const [novoPostoApelido, setNovoPostoApelido] = useState('')
  const [novoPostoContratoId, setNovoPostoContratoId] = useState('')
  const [criandoPosto, setCriandoPosto] = useState(false)

  // DnD state - local ordered list for optimistic reorder
  const [orderedColabs, setOrderedColabs] = useState<Colaborador[]>([])

  const sensors = useSensors(
    useSensor(PointerSensor),
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

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return

    const oldIndex = orderedColabs.findIndex((c) => c.id === active.id)
    const newIndex = orderedColabs.findIndex((c) => c.id === over.id)

    if (oldIndex === -1 || newIndex === -1) return

    const newOrder = arrayMove(orderedColabs, oldIndex, newIndex)
    setOrderedColabs(newOrder) // Optimistic update

    try {
      await setoresService.reordenarRank(setorId, newOrder.map((c) => c.id))
      toast.success('Prioridade atualizada')
    } catch (err) {
      // Revert on error
      setOrderedColabs([...(colaboradores ?? [])].sort((a, b) => a.rank - b.rank))
      toast.error(err instanceof Error ? err.message : 'Erro ao reordenar')
    }
  }

  // Most recent escala
  const escalaAtual = (escalas ?? []).length > 0
    ? (escalas ?? []).reduce((a, b) => (a.criada_em > b.criada_em ? a : b))
    : null

  // Sync form state from setor data
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

  const handleSalvarTimelineDia = useCallback(async (data: SalvarTimelineDiaInput) => {
    await setoresService.salvarTimelineDia(data)
    await Promise.all([reloadDemandas(), reloadHorariosSemana()])
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
    if (!novoPostoApelido.trim() || !novoPostoContratoId) return
    setCriandoPosto(true)
    try {
      await funcoesService.criar({
        setor_id: setorId,
        apelido: novoPostoApelido.trim(),
        tipo_contrato_id: parseInt(novoPostoContratoId),
      })
      toast.success('Posto criado')
      setShowPostoDialog(false)
      setNovoPostoApelido('')
      setNovoPostoContratoId('')
      reloadFuncoes()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao criar posto')
    } finally {
      setCriandoPosto(false)
    }
  }

  const handleDeletarPosto = async (funcaoId: number) => {
    try {
      await funcoesService.deletar(funcaoId)
      toast.success('Posto removido')
      reloadFuncoes()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao remover posto')
    }
  }

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
                  name="piso_operacional"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Piso Operacional</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min={1}
                          step={1}
                          value={field.value}
                          onChange={(e) => field.onChange(parseInt(e.target.value || '1', 10))}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </CardContent>
          </Card>
        </Form>

        {/* Demandas — Editor Visual */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold">
              Demanda Planejada (Single-Lane)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <DemandaTimelineSingleLane
              setor={setor}
              demandas={demandas ?? []}
              horariosSemana={horariosSemana ?? []}
              onSalvarDia={handleSalvarTimelineDia}
            />
          </CardContent>
        </Card>

        {/* Postos (Funcoes) */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-base font-semibold">
              Postos
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                (funcoes esperadas neste setor)
              </span>
            </CardTitle>
            <Button variant="outline" size="sm" onClick={() => setShowPostoDialog(true)}>
              <Plus className="mr-1 size-3.5" /> Novo Posto
            </Button>
          </CardHeader>
          <CardContent>
            {funcoesList.length === 0 ? (
              <EmptyState
                icon={Briefcase}
                title="Nenhum posto definido"
                description="Defina os postos de trabalho para organizar a equipe por funcao"
                action={
                  <Button variant="outline" size="sm" onClick={() => setShowPostoDialog(true)}>
                    <Plus className="mr-1 size-3.5" /> Novo Posto
                  </Button>
                }
              />
            ) : (
              <div className="space-y-2">
                {funcoesList.map((funcao) => {
                  const contratoNome = contratoMap.get(funcao.tipo_contrato_id) ?? 'Contrato'
                  return (
                    <div
                      key={funcao.id}
                      className="flex items-center justify-between rounded-lg border p-3"
                    >
                      <div>
                        <p className="text-sm font-medium text-foreground">{funcao.apelido}</p>
                        <p className="text-xs text-muted-foreground">{contratoNome}</p>
                      </div>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive">
                            <Trash2 className="size-3.5" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Remover posto?</AlertDialogTitle>
                            <AlertDialogDescription>
                              O posto &quot;{funcao.apelido}&quot; sera removido. Colaboradores vinculados a ele ficarao sem funcao definida.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancelar</AlertDialogCancel>
                            <AlertDialogAction onClick={() => handleDeletarPosto(funcao.id)}>
                              Remover
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Colaboradores com rank */}
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
                        <TableHead>Sexo</TableHead>
                        <TableHead>Preferencia</TableHead>
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

      {/* Novo Posto Dialog */}
      <Dialog open={showPostoDialog} onOpenChange={setShowPostoDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Novo Posto</DialogTitle>
            <DialogDescription>
              Defina um posto de trabalho para este setor.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Apelido do Posto</Label>
              <Input
                placeholder="Ex: Caixa, Repositor, Seguranca"
                value={novoPostoApelido}
                onChange={(e) => setNovoPostoApelido(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Tipo de Contrato</Label>
              <Select value={novoPostoContratoId} onValueChange={setNovoPostoContratoId}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione o contrato" />
                </SelectTrigger>
                <SelectContent>
                  {(tiposContrato ?? []).map((tc) => (
                    <SelectItem key={tc.id} value={String(tc.id)}>
                      {tc.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPostoDialog(false)}>
              Cancelar
            </Button>
            <Button
              onClick={handleCriarPosto}
              disabled={criandoPosto || !novoPostoApelido.trim() || !novoPostoContratoId}
            >
              {criandoPosto ? 'Criando...' : 'Criar Posto'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
