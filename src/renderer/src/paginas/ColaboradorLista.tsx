import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import {
  Users,
  Plus,
  Search,
  Archive,
  ArrowRight,
  RotateCcw,
  Filter,
  Palmtree,
  Stethoscope,
  Ban,
  Clock,
  X,
  Edit,
  Trash2,
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
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
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from '@/components/ui/form'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { PageHeader } from '@/componentes/PageHeader'
import { EmptyState } from '@/componentes/EmptyState'
import { ViewToggle, useViewMode } from '@/componentes/ViewToggle'
import { SetorIcon } from '@/componentes/IconPicker'
import { colaboradoresService } from '@/servicos/colaboradores'
import { tiposContratoService } from '@/servicos/tipos-contrato'
import { excecoesService } from '@/servicos/excecoes'
import { funcoesService } from '@/servicos/funcoes'
import { useApiData } from '@/hooks/useApiData'
import { useAppDataStore } from '@/store/appDataStore'
import { toast } from 'sonner'
import type { Colaborador, Excecao, Funcao, PerfilHorarioContrato } from '@shared/index'

const novoColabSchema = z.object({
  nome: z.string().min(2, 'Nome deve ter ao menos 2 caracteres'),
  sexo: z.string().min(1, 'Selecione o sexo'),
  setor_id: z.string().min(1, 'Selecione o setor'),
  tipo_contrato_id: z.string().min(1, 'Selecione o tipo de contrato'),
  tipo_trabalhador: z.enum(['CLT', 'ESTAGIARIO', 'INTERMITENTE']),
  funcao_id: z.string(),
  perfil_horario_id: z.string(),
})

type NovoColabData = z.infer<typeof novoColabSchema>

type SituacaoFilter = 'todos' | 'disponivel' | 'ferias' | 'atestado' | 'bloqueio'

function SituacaoBadge({ tipo }: { tipo: string }) {
  switch (tipo) {
    case 'FERIAS':
      return (
        <Badge variant="outline" className="gap-1 border-success/20 bg-success/10 text-success">
          <Palmtree className="size-3" /> Ferias
        </Badge>
      )
    case 'ATESTADO':
      return (
        <Badge variant="outline" className="gap-1 border-destructive/20 bg-destructive/10 text-destructive">
          <Stethoscope className="size-3" /> Atestado
        </Badge>
      )
    case 'BLOQUEIO':
      return (
        <Badge variant="outline" className="gap-1 border-warning/20 bg-warning/10 text-warning">
          <Ban className="size-3" /> Bloqueado
        </Badge>
      )
    default:
      return null
  }
}

export function ColaboradorLista() {
  const [search, setSearch] = useState('')
  const [setorFilter, setSetorFilter] = useState<string>('all')
  const [contratoFilter, setContratoFilter] = useState<string>('all')
  const [situacaoFilter, setSituacaoFilter] = useState<SituacaoFilter>('todos')
  const [sexoFilter, setSexoFilter] = useState<string>('all')
  const [showArchived, setShowArchived] = useState(false)
  const [showNewDialog, setShowNewDialog] = useState(false)
  const [criando, setCriando] = useState(false)
  const [funcoesNovo, setFuncoesNovo] = useState<Funcao[]>([])
  const [perfisNovo, setPerfisNovo] = useState<PerfilHorarioContrato[]>([])
  const [viewMode, setViewMode] = useViewMode('colaboradores', 'table')
  const [archivingId, setArchivingId] = useState<number | null>(null)
  const [arquivando, setArquivando] = useState(false)

  const novoColabForm = useForm<NovoColabData>({
    resolver: zodResolver(novoColabSchema),
    defaultValues: { nome: '', sexo: '', setor_id: '', tipo_contrato_id: '', tipo_trabalhador: 'CLT', funcao_id: 'none', perfil_horario_id: 'none' },
  })

  const setoresList = useAppDataStore((s) => s.setores)
  const contratosList = useAppDataStore((s) => s.tiposContrato)

  const { data: todosColabs, loading: loadingColabs, reload: reloadColabs } = useApiData<Colaborador[]>(
    () => colaboradoresService.listar(),
    [],
  )

  const { data: excecoesAtivas } = useApiData<Excecao[]>(
    () => excecoesService.listarAtivas(),
    [],
  )

  const colaboradores = todosColabs ?? []
  const excecoesList = excecoesAtivas ?? []

  const setorMap = new Map(setoresList.map((s) => [s.id, { nome: s.nome, icone: s.icone }]))
  const contratoMap = new Map(contratosList.map((tc) => [tc.id, tc.nome]))
  const setorSelecionado = novoColabForm.watch('setor_id')

  useEffect(() => {
    if (!showNewDialog || !setorSelecionado) {
      setFuncoesNovo([])
      novoColabForm.setValue('funcao_id', 'none')
      return
    }

    let active = true
    funcoesService.listar(parseInt(setorSelecionado, 10))
      .then((list) => {
        if (active) setFuncoesNovo(list)
      })
      .catch(() => {
        if (active) setFuncoesNovo([])
      })

    return () => {
      active = false
    }
  }, [showNewDialog, setorSelecionado, novoColabForm])

  const contratoSelecionado = novoColabForm.watch('tipo_contrato_id')

  useEffect(() => {
    if (!showNewDialog || !contratoSelecionado) {
      setPerfisNovo([])
      novoColabForm.setValue('perfil_horario_id', 'none')
      return
    }

    let active = true
    tiposContratoService.listarPerfisHorario(parseInt(contratoSelecionado, 10))
      .then((list) => {
        if (active) setPerfisNovo(list.filter(p => p.ativo))
      })
      .catch(() => {
        if (active) setPerfisNovo([])
      })

    return () => {
      active = false
    }
  }, [showNewDialog, contratoSelecionado, novoColabForm])

  // Map colaborador_id -> excecao tipo (ativa hoje)
  const excecaoMap = new Map<number, string>()
  for (const exc of excecoesList) {
    excecaoMap.set(exc.colaborador_id, exc.tipo)
  }

  const activeFilterCount = [
    setorFilter !== 'all',
    contratoFilter !== 'all',
    situacaoFilter !== 'todos',
    sexoFilter !== 'all',
  ].filter(Boolean).length

  const clearFilters = () => {
    setSetorFilter('all')
    setContratoFilter('all')
    setSituacaoFilter('todos')
    setSexoFilter('all')
  }

  const ativos = colaboradores.filter((c) => c.ativo)
  const arquivados = colaboradores.filter((c) => !c.ativo)

  const filtered = (showArchived ? arquivados : ativos).filter((c) => {
    const matchesSearch = c.nome.toLowerCase().includes(search.toLowerCase())
    const matchesSetor = setorFilter === 'all' || c.setor_id === parseInt(setorFilter)
    const matchesContrato = contratoFilter === 'all' || c.tipo_contrato_id === parseInt(contratoFilter)
    const matchesSexo = sexoFilter === 'all' || c.sexo === sexoFilter

    // Situacao filter
    const excTipo = excecaoMap.get(c.id)
    let matchesSituacao = true
    if (situacaoFilter === 'disponivel') matchesSituacao = !excTipo
    else if (situacaoFilter === 'ferias') matchesSituacao = excTipo === 'FERIAS'
    else if (situacaoFilter === 'atestado') matchesSituacao = excTipo === 'ATESTADO'
    else if (situacaoFilter === 'bloqueio') matchesSituacao = excTipo === 'BLOQUEIO'

    return matchesSearch && matchesSetor && matchesContrato && matchesSexo && matchesSituacao
  })

  const handleCriar = async (data: NovoColabData) => {
    setCriando(true)
    try {
      const created = await colaboradoresService.criar({
        nome: data.nome.trim(),
        sexo: data.sexo as 'M' | 'F',
        setor_id: parseInt(data.setor_id),
        tipo_contrato_id: parseInt(data.tipo_contrato_id),
        tipo_trabalhador: data.tipo_trabalhador,
        funcao_id: data.funcao_id === 'none' ? null : parseInt(data.funcao_id, 10),
      })

      if (data.perfil_horario_id !== 'none') {
        const perfil = perfisNovo.find(p => p.id === parseInt(data.perfil_horario_id))
        if (perfil) {
          await colaboradoresService.salvarRegraHorario({
            colaborador_id: created.id,
            perfil_horario_id: parseInt(data.perfil_horario_id),
            inicio: perfil.inicio ?? null,
            fim: perfil.fim ?? null,
            preferencia_turno_soft: perfil.preferencia_turno_soft ?? null,
          })
        }
      }

      toast.success('Colaborador cadastrado')
      setShowNewDialog(false)
      novoColabForm.reset()
      reloadColabs()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao cadastrar colaborador')
    } finally {
      setCriando(false)
    }
  }

  const handleArquivar = async () => {
    if (!archivingId) return
    setArquivando(true)
    try {
      await colaboradoresService.atualizar(archivingId, { ativo: false })
      toast.success('Colaborador arquivado')
      setArchivingId(null)
      reloadColabs()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao arquivar')
      setArchivingId(null)
    } finally {
      setArquivando(false)
    }
  }

  const handleRestaurar = async (id: number) => {
    try {
      await colaboradoresService.atualizar(id, { ativo: true })
      toast.success('Colaborador restaurado')
      reloadColabs()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao restaurar colaborador')
    }
  }

  if (loadingColabs) {
    return (
      <div className="flex flex-1 flex-col">
        <PageHeader breadcrumbs={[{ label: 'Dashboard', href: '/' }, { label: 'Colaboradores' }]} />
        <div className="flex flex-1 items-center justify-center">
          <p className="text-sm text-muted-foreground">Carregando...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader
        breadcrumbs={[{ label: 'Dashboard', href: '/' }, { label: 'Colaboradores' }]}
        actions={
          <Button size="sm" onClick={() => setShowNewDialog(true)}>
            <Plus className="mr-1 size-3.5" />
            Novo Colaborador
          </Button>
        }
      />

      <div className="flex flex-1 flex-col gap-4 p-6">
        {/* Toolbar: Search + Filter Popover + Archived + View Toggle */}
        <div className="flex items-center gap-3">
          <div className="relative max-w-sm flex-1">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar por nome..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>

          <Popover>
            <PopoverTrigger asChild>
              <Button variant={activeFilterCount > 0 ? 'secondary' : 'outline'} size="sm">
                <Filter className="mr-1.5 size-3.5" />
                Filtros
                {activeFilterCount > 0 && (
                  <Badge variant="secondary" className="ml-1.5 h-5 min-w-5 px-1.5 text-xs font-semibold">
                    {activeFilterCount}
                  </Badge>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-72" align="start">
              <div className="space-y-3">
                <p className="text-xs font-medium text-muted-foreground">Filtrar por</p>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Setor</label>
                  <Select value={setorFilter} onValueChange={setSetorFilter}>
                    <SelectTrigger>
                      <SelectValue placeholder="Todos os setores" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos os setores</SelectItem>
                      {setoresList.map((s) => (
                        <SelectItem key={s.id} value={String(s.id)}>
                          {s.nome}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Contrato</label>
                  <Select value={contratoFilter} onValueChange={setContratoFilter}>
                    <SelectTrigger>
                      <SelectValue placeholder="Todos contratos" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos contratos</SelectItem>
                      {contratosList.map((tc) => (
                        <SelectItem key={tc.id} value={String(tc.id)}>
                          {tc.nome}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Situacao</label>
                  <Select value={situacaoFilter} onValueChange={(v) => setSituacaoFilter(v as SituacaoFilter)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Todas situacoes" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="todos">Todas situacoes</SelectItem>
                      <SelectItem value="disponivel">Disponivel</SelectItem>
                      <SelectItem value="ferias">Em ferias</SelectItem>
                      <SelectItem value="atestado">Em atestado</SelectItem>
                      <SelectItem value="bloqueio">Bloqueado</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Sexo</label>
                  <Select value={sexoFilter} onValueChange={setSexoFilter}>
                    <SelectTrigger>
                      <SelectValue placeholder="Todos" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos</SelectItem>
                      <SelectItem value="F">Feminino</SelectItem>
                      <SelectItem value="M">Masculino</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {activeFilterCount > 0 && (
                  <>
                    <div className="border-t" />
                    <Button variant="ghost" size="sm" className="w-full" onClick={clearFilters}>
                      <X className="mr-1.5 size-3.5" />
                      Limpar filtros
                    </Button>
                  </>
                )}
              </div>
            </PopoverContent>
          </Popover>

          <Button
            variant={showArchived ? 'secondary' : 'outline'}
            size="sm"
            onClick={() => setShowArchived(!showArchived)}
          >
            <Archive className="mr-1 size-3.5" />
            Arquivados ({arquivados.length})
          </Button>
          <ViewToggle mode={viewMode} onChange={setViewMode} />
        </div>

        {showArchived && (
          <div className="rounded-lg border border-warning/20 bg-warning/5 p-3">
            <p className="text-sm text-warning">
              Exibindo colaboradores arquivados. Clique em &quot;Restaurar&quot; para reativar.
            </p>
          </div>
        )}

        {filtered.length === 0 ? (
          <EmptyState
            icon={Users}
            title={showArchived ? 'Nenhum colaborador arquivado' : 'Nenhum colaborador encontrado'}
            description={showArchived ? '' : 'Cadastre um novo colaborador para comecar'}
            action={
              !showArchived ? (
                <Button size="sm" onClick={() => setShowNewDialog(true)}>
                  <Plus className="mr-1 size-3.5" />
                  Novo Colaborador
                </Button>
              ) : undefined
            }
          />
        ) : viewMode === 'table' ? (
          /* TABLE VIEW */
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Nome</TableHead>
                  <TableHead>Setor</TableHead>
                  <TableHead>Contrato</TableHead>
                  <TableHead>Sexo</TableHead>
                  <TableHead>Preferencia</TableHead>
                  <TableHead>Situacao</TableHead>
                  <TableHead className="w-[100px] text-right pr-4" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((colab) => {
                  const excTipo = excecaoMap.get(colab.id)
                  return (
                    <TableRow key={colab.id} className={!colab.ativo ? 'opacity-60' : ''}>
                      <TableCell className="pl-4 font-medium">{colab.nome}</TableCell>
                      <TableCell className="text-muted-foreground">
                        <span className="flex items-center gap-1.5">
                          <SetorIcon name={setorMap.get(colab.setor_id)?.icone ?? null} className="size-3.5" />
                          {setorMap.get(colab.setor_id)?.nome ?? '—'}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="whitespace-nowrap text-xs">
                          {contratoMap.get(colab.tipo_contrato_id) ?? '—'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {colab.sexo === 'M' ? 'Masc' : 'Fem'}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {colab.prefere_turno
                          ? colab.prefere_turno === 'MANHA' ? 'Manha' : 'Tarde'
                          : '—'}
                      </TableCell>
                      <TableCell>
                        {excTipo ? <SituacaoBadge tipo={excTipo} /> : (
                          <span className="text-xs text-muted-foreground">Disponivel</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right pr-4">
                        {colab.ativo ? (
                          <Button variant="ghost" size="sm" asChild>
                            <Link to={`/colaboradores/${colab.id}`}>
                              <ArrowRight className="size-4" />
                            </Link>
                          </Button>
                        ) : (
                          <Button variant="ghost" size="sm" onClick={() => handleRestaurar(colab.id)}>
                            <RotateCcw className="mr-1 size-3" /> Restaurar
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
            <CardContent className="border-t py-2">
              <p className="text-xs text-muted-foreground">
                {filtered.length} colaborador{filtered.length !== 1 ? 'es' : ''}
              </p>
            </CardContent>
          </Card>
        ) : (
          /* CARD VIEW */
          <>
            <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3">
              {filtered.map((colab) => {
                const excTipo = excecaoMap.get(colab.id)
                const setor = setorMap.get(colab.setor_id)
                return (
                  <Card
                    key={colab.id}
                    className={`transition-shadow hover:shadow-md ${!colab.ativo ? 'opacity-60' : ''}`}
                  >
                    <CardContent className="p-4 space-y-3">
                      {/* Header: Icon + Nome + Setor badge */}
                      <div className="flex items-center gap-2.5">
                        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                          <SetorIcon name={setor?.icone ?? null} className="size-4 text-primary" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <h3 className="truncate text-sm font-semibold text-foreground">{colab.nome}</h3>
                          <p className="text-xs text-muted-foreground">{colab.sexo === 'M' ? 'Masculino' : 'Feminino'} · {colab.prefere_turno ? (colab.prefere_turno === 'MANHA' ? 'Manha' : 'Tarde') : 'Sem pref.'}</p>
                        </div>
                        <Badge className="shrink-0 whitespace-nowrap text-xs">
                          {setor?.nome ?? '—'}
                        </Badge>
                      </div>
                      {/* Meta: Contrato + Situacao */}
                      <div className="flex items-center gap-1.5">
                        <Badge variant="outline" className="whitespace-nowrap text-xs">
                          {contratoMap.get(colab.tipo_contrato_id) ?? '—'}
                        </Badge>
                        {excTipo ? (
                          <SituacaoBadge tipo={excTipo} />
                        ) : (
                          <Badge variant="outline" className="text-xs text-muted-foreground">Disponivel</Badge>
                        )}
                      </div>
                      {/* Footer: Acao */}
                      <div className="flex items-center gap-1.5 border-t pt-3">
                        {colab.ativo ? (
                          <>
                            <Button variant="outline" size="sm" className="flex-1" asChild>
                              <Link to={`/colaboradores/${colab.id}`}>
                                Ver detalhes <ArrowRight className="ml-1 size-3" />
                              </Link>
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-8 shrink-0 text-destructive hover:bg-destructive/10"
                              onClick={() => setArchivingId(colab.id)}
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                          </>
                        ) : (
                          <Button variant="outline" size="sm" className="flex-1" onClick={() => handleRestaurar(colab.id)}>
                            <RotateCcw className="mr-1 size-3" /> Restaurar
                          </Button>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                )
              })}
            </div>
            <p className="text-xs text-muted-foreground">
              {filtered.length} colaborador{filtered.length !== 1 ? 'es' : ''}
            </p>
          </>
        )}
      </div>

      {/* Archive Confirmation */}
      <AlertDialog open={!!archivingId} onOpenChange={() => setArchivingId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Arquivar colaborador?</AlertDialogTitle>
            <AlertDialogDescription>
              O colaborador sera movido para a lista de arquivados. Voce pode restaura-lo depois.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={arquivando}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleArquivar} disabled={arquivando}>
              {arquivando ? 'Arquivando...' : 'Arquivar'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* New Colaborador Dialog */}
      <Dialog open={showNewDialog} onOpenChange={(open) => {
        setShowNewDialog(open)
        if (!open) {
          novoColabForm.reset()
          setPerfisNovo([])
        }
      }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Novo Colaborador</DialogTitle>
            <DialogDescription>
              Cadastre um novo colaborador no sistema.
            </DialogDescription>
          </DialogHeader>
          <Form {...novoColabForm}>
            <form onSubmit={novoColabForm.handleSubmit(handleCriar)} className="space-y-4 py-4">
              <FormField
                control={novoColabForm.control}
                name="nome"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nome completo</FormLabel>
                    <FormControl>
                      <Input placeholder="Ex: Maria da Silva" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={novoColabForm.control}
                  name="sexo"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Sexo</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Selecione" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="F">Feminino</SelectItem>
                          <SelectItem value="M">Masculino</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={novoColabForm.control}
                  name="setor_id"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Setor</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Selecione" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {setoresList.map((s) => (
                            <SelectItem key={s.id} value={String(s.id)}>
                              {s.nome}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <FormField
                control={novoColabForm.control}
                name="tipo_contrato_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Tipo de Contrato</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Selecione" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {contratosList.map((tc) => (
                          <SelectItem key={tc.id} value={String(tc.id)}>
                            {tc.nome}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {perfisNovo.length > 0 && (
                <FormField
                  control={novoColabForm.control}
                  name="perfil_horario_id"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Perfil de Horario</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Selecione o perfil" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="none">Sem perfil</SelectItem>
                          {perfisNovo.map((p) => (
                            <SelectItem key={p.id} value={String(p.id)}>
                              {p.nome}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}
              <FormField
                control={novoColabForm.control}
                name="tipo_trabalhador"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Tipo Trabalhador</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Selecione" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="CLT">CLT</SelectItem>
                        <SelectItem value="ESTAGIARIO">Estagiario</SelectItem>
                        <SelectItem value="INTERMITENTE">Intermitente</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={novoColabForm.control}
                name="funcao_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Funcao (opcional)</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Sem funcao" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="none">Sem funcao</SelectItem>
                        {funcoesNovo.map((f) => (
                          <SelectItem key={f.id} value={String(f.id)}>
                            {f.apelido}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button variant="outline" type="button" onClick={() => setShowNewDialog(false)}>
                  Cancelar
                </Button>
                <Button type="submit" disabled={criando}>
                  {criando ? 'Cadastrando...' : 'Cadastrar'}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
