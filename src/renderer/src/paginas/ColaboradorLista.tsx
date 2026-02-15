import { useState } from 'react'
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
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
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
import { PageHeader } from '@/componentes/PageHeader'
import { EmptyState } from '@/componentes/EmptyState'
import { colaboradoresService } from '@/servicos/colaboradores'
import { setoresService } from '@/servicos/setores'
import { tiposContratoService } from '@/servicos/tipos-contrato'
import { useApiData } from '@/hooks/useApiData'
import { iniciais } from '@/lib/formatadores'
import { CORES_GENERO, CORES_VIOLACAO } from '@/lib/cores'
import { toast } from 'sonner'
import type { Colaborador, Setor, TipoContrato } from '@shared/index'

const novoColabSchema = z.object({
  nome: z.string().min(2, 'Nome deve ter ao menos 2 caracteres'),
  sexo: z.string().min(1, 'Selecione o sexo'),
  setor_id: z.string().min(1, 'Selecione o setor'),
  tipo_contrato_id: z.string().min(1, 'Selecione o tipo de contrato'),
})

type NovoColabData = z.infer<typeof novoColabSchema>

export function ColaboradorLista() {
  const [search, setSearch] = useState('')
  const [setorFilter, setSetorFilter] = useState<string>('all')
  const [showArchived, setShowArchived] = useState(false)
  const [showNewDialog, setShowNewDialog] = useState(false)
  const [criando, setCriando] = useState(false)

  const novoColabForm = useForm<NovoColabData>({
    resolver: zodResolver(novoColabSchema),
    defaultValues: { nome: '', sexo: '', setor_id: '', tipo_contrato_id: '' },
  })

  const { data: todosColabs, loading: loadingColabs, reload: reloadColabs } = useApiData<Colaborador[]>(
    () => colaboradoresService.listar(),
    [],
  )

  const { data: setores } = useApiData<Setor[]>(
    () => setoresService.listar(true),
    [],
  )

  const { data: tiposContrato } = useApiData<TipoContrato[]>(
    () => tiposContratoService.listar(),
    [],
  )

  const colaboradores = todosColabs ?? []
  const setoresList = setores ?? []
  const contratosList = tiposContrato ?? []

  // Lookup maps
  const setorMap = new Map(setoresList.map((s) => [s.id, s.nome]))
  const contratoMap = new Map(contratosList.map((tc) => [tc.id, tc.nome]))

  const ativos = colaboradores.filter((c) => c.ativo)
  const arquivados = colaboradores.filter((c) => !c.ativo)

  const filtered = (showArchived ? arquivados : ativos).filter((c) => {
    const matchesSearch = c.nome.toLowerCase().includes(search.toLowerCase())
    const matchesSetor = setorFilter === 'all' || c.setor_id === parseInt(setorFilter)
    return matchesSearch && matchesSetor
  })

  const handleCriar = async (data: NovoColabData) => {
    setCriando(true)
    try {
      await colaboradoresService.criar({
        nome: data.nome.trim(),
        sexo: data.sexo as 'M' | 'F',
        setor_id: parseInt(data.setor_id),
        tipo_contrato_id: parseInt(data.tipo_contrato_id),
      })
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
        <PageHeader breadcrumbs={[{ label: 'Colaboradores' }]} />
        <div className="flex flex-1 items-center justify-center">
          <p className="text-sm text-muted-foreground">Carregando...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader
        breadcrumbs={[{ label: 'Colaboradores' }]}
        actions={
          <Button size="sm" onClick={() => setShowNewDialog(true)}>
            <Plus className="mr-1 size-3.5" />
            Novo Colaborador
          </Button>
        }
      />

      <div className="flex-1 space-y-4 p-6">
        {/* Toolbar */}
        <div className="flex items-center gap-3">
          <div className="relative max-w-sm flex-1">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Pesquisar colaboradores..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={setorFilter} onValueChange={setSetorFilter}>
            <SelectTrigger className="w-[180px]">
              <Filter className="mr-1 size-3.5" />
              <SelectValue placeholder="Filtrar por setor" />
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
          <Button
            variant={showArchived ? 'secondary' : 'outline'}
            size="sm"
            onClick={() => setShowArchived(!showArchived)}
          >
            <Archive className="mr-1 size-3.5" />
            Arquivados ({arquivados.length})
          </Button>
        </div>

        {showArchived && (
          <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/30 p-3">
            <p className="text-sm text-amber-800 dark:text-amber-300">
              Exibindo colaboradores arquivados. Clique em &quot;Restaurar&quot; para reativar.
            </p>
          </div>
        )}

        {/* Grid */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((colab) => (
            <Card
              key={colab.id}
              className={`transition-shadow hover:shadow-md ${!colab.ativo ? 'opacity-70' : ''}`}
            >
              <CardContent className="p-5">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div
                      className={`flex size-10 items-center justify-center rounded-full text-sm font-semibold ${CORES_GENERO[colab.sexo]}`}
                    >
                      {iniciais(colab.nome)}
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold text-foreground">
                        {colab.nome}
                      </h3>
                      <p className="text-xs text-muted-foreground">
                        {setorMap.get(colab.setor_id) ?? 'Setor desconhecido'}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap gap-1.5">
                  <Badge variant="outline" className="text-[10px]">
                    {contratoMap.get(colab.tipo_contrato_id) ?? 'Contrato'}
                  </Badge>
                  <Badge variant="outline" className="text-[10px]">
                    {colab.horas_semanais}h/sem
                  </Badge>
                  <Badge variant="outline" className="text-[10px]">
                    {colab.sexo === 'M' ? 'Masc' : 'Fem'}
                  </Badge>
                  {colab.prefere_turno && (
                    <Badge
                      variant="outline"
                      className={`text-[10px] ${CORES_VIOLACAO.SOFT.border} ${CORES_VIOLACAO.SOFT.bg} ${CORES_VIOLACAO.SOFT.text}`}
                    >
                      {colab.prefere_turno === 'MANHA' ? 'Manha' : 'Tarde'}
                    </Badge>
                  )}
                </div>

                <div className="mt-4">
                  {colab.ativo ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full"
                      asChild
                    >
                      <Link to={`/colaboradores/${colab.id}`}>
                        Ver Perfil <ArrowRight className="ml-1 size-3" />
                      </Link>
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full"
                      onClick={() => handleRestaurar(colab.id)}
                    >
                      <RotateCcw className="mr-1 size-3" /> Restaurar
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {filtered.length === 0 && (
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
        )}
      </div>

      {/* New Colaborador Dialog */}
      <Dialog open={showNewDialog} onOpenChange={(open) => {
        setShowNewDialog(open)
        if (!open) novoColabForm.reset()
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
