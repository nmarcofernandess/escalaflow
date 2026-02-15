import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import {
  Building2,
  Plus,
  Search,
  Clock,
  Archive,
  ArrowRight,
  RotateCcw,
  Users,
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
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
import { setoresService } from '@/servicos/setores'
import { colaboradoresService } from '@/servicos/colaboradores'
import { useApiData } from '@/hooks/useApiData'
import { toast } from 'sonner'
import type { Setor, Colaborador } from '@shared/index'

const novoSetorSchema = z.object({
  nome: z.string().min(2, 'Nome deve ter ao menos 2 caracteres'),
  hora_abertura: z.string().min(1, 'Hora de abertura e obrigatoria'),
  hora_fechamento: z.string().min(1, 'Hora de fechamento e obrigatoria'),
})

type NovoSetorData = z.infer<typeof novoSetorSchema>

export function SetorLista() {
  const [search, setSearch] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const [showNewDialog, setShowNewDialog] = useState(false)
  const [criando, setCriando] = useState(false)

  const novoSetorForm = useForm<NovoSetorData>({
    resolver: zodResolver(novoSetorSchema),
    defaultValues: { nome: '', hora_abertura: '08:00', hora_fechamento: '22:00' },
  })

  const { data: todosSetores, loading: loadingSetores, reload: reloadSetores } = useApiData<Setor[]>(
    () => setoresService.listar(),
    [],
  )

  const { data: colaboradores } = useApiData<Colaborador[]>(
    () => colaboradoresService.listar({ ativo: true }),
    [],
  )

  const setores = todosSetores ?? []
  const colabs = colaboradores ?? []

  const ativos = setores.filter((s) => s.ativo)
  const arquivados = setores.filter((s) => !s.ativo)

  const filtered = (showArchived ? arquivados : ativos).filter((s) =>
    s.nome.toLowerCase().includes(search.toLowerCase()),
  )

  const getColabCount = (setorId: number) =>
    colabs.filter((c) => c.setor_id === setorId).length

  const handleCriar = async (data: NovoSetorData) => {
    setCriando(true)
    try {
      await setoresService.criar({
        nome: data.nome.trim(),
        hora_abertura: data.hora_abertura,
        hora_fechamento: data.hora_fechamento,
      })
      toast.success('Setor criado')
      setShowNewDialog(false)
      novoSetorForm.reset()
      reloadSetores()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao criar setor')
    } finally {
      setCriando(false)
    }
  }

  const handleRestaurar = async (id: number) => {
    try {
      await setoresService.atualizar(id, { ativo: true })
      toast.success('Setor restaurado')
      reloadSetores()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao restaurar setor')
    }
  }

  if (loadingSetores) {
    return (
      <div className="flex flex-1 flex-col">
        <PageHeader breadcrumbs={[{ label: 'Setores' }]} />
        <div className="flex flex-1 items-center justify-center">
          <p className="text-sm text-muted-foreground">Carregando...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader
        breadcrumbs={[{ label: 'Setores' }]}
        actions={
          <Button size="sm" onClick={() => setShowNewDialog(true)}>
            <Plus className="mr-1 size-3.5" />
            Novo Setor
          </Button>
        }
      />

      <div className="flex-1 space-y-4 p-6">
        {/* Toolbar */}
        <div className="flex items-center gap-3">
          <div className="relative max-w-sm flex-1">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Pesquisar setores..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
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
              Exibindo setores arquivados. Clique em &quot;Restaurar&quot; para reativar.
            </p>
          </div>
        )}

        {/* Grid */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((setor) => (
            <Card
              key={setor.id}
              className={`transition-shadow hover:shadow-md ${!setor.ativo ? 'opacity-70' : ''}`}
            >
              <CardContent className="p-5">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10">
                      <Building2 className="size-5 text-primary" />
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold text-foreground">{setor.nome}</h3>
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Clock className="size-3" />
                        {setor.hora_abertura} - {setor.hora_fechamento}
                      </div>
                    </div>
                  </div>
                  {!setor.ativo && (
                    <Badge variant="outline" className="text-muted-foreground">
                      Arquivado
                    </Badge>
                  )}
                </div>

                <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
                  <Users className="size-3" />
                  {getColabCount(setor.id)} colaboradores
                </div>

                <div className="mt-4 flex items-center gap-2">
                  {setor.ativo ? (
                    <Button variant="outline" size="sm" className="flex-1" asChild>
                      <Link to={`/setores/${setor.id}`}>
                        Abrir <ArrowRight className="ml-1 size-3" />
                      </Link>
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1"
                      onClick={() => handleRestaurar(setor.id)}
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
            icon={Building2}
            title={showArchived ? 'Nenhum setor arquivado' : 'Nenhum setor encontrado'}
            description={showArchived ? '' : 'Crie um novo setor para comecar'}
            action={
              !showArchived ? (
                <Button size="sm" onClick={() => setShowNewDialog(true)}>
                  <Plus className="mr-1 size-3.5" />
                  Novo Setor
                </Button>
              ) : undefined
            }
          />
        )}
      </div>

      {/* New Setor Dialog */}
      <Dialog open={showNewDialog} onOpenChange={(open) => {
        setShowNewDialog(open)
        if (!open) novoSetorForm.reset()
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Novo Setor</DialogTitle>
            <DialogDescription>Adicione um novo setor ao supermercado.</DialogDescription>
          </DialogHeader>
          <Form {...novoSetorForm}>
            <form onSubmit={novoSetorForm.handleSubmit(handleCriar)} className="space-y-4 py-4">
              <FormField
                control={novoSetorForm.control}
                name="nome"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nome</FormLabel>
                    <FormControl>
                      <Input placeholder="Ex: Frios, Limpeza..." {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={novoSetorForm.control}
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
                  control={novoSetorForm.control}
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
              <DialogFooter>
                <Button variant="outline" type="button" onClick={() => setShowNewDialog(false)}>
                  Cancelar
                </Button>
                <Button type="submit" disabled={criando}>
                  {criando ? 'Criando...' : 'Criar Setor'}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
