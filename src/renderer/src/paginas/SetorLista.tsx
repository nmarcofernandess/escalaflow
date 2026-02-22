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
  Trash2,
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
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
} from '@/components/ui/alert-dialog'
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
import { ViewToggle, useViewMode } from '@/componentes/ViewToggle'
import { IconPicker, SetorIcon } from '@/componentes/IconPicker'
import { Calendar, CalendarOff } from 'lucide-react'
import { setoresService } from '@/servicos/setores'
import { colaboradoresService } from '@/servicos/colaboradores'
import { escalasService } from '@/servicos/escalas'
import { useApiData } from '@/hooks/useApiData'
import { toast } from 'sonner'
import type { Setor, Colaborador } from '@shared/index'

const novoSetorSchema = z.object({
  nome: z.string().min(2, 'Nome deve ter ao menos 2 caracteres'),
  icone: z.string().nullable(),
  hora_abertura: z.string().min(1, 'Hora de abertura e obrigatoria'),
  hora_fechamento: z.string().min(1, 'Hora de fechamento e obrigatoria'),
})

type NovoSetorFormInput = z.input<typeof novoSetorSchema>
type NovoSetorData = z.output<typeof novoSetorSchema>

export function SetorLista() {
  const [search, setSearch] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const [showNewDialog, setShowNewDialog] = useState(false)
  const [criando, setCriando] = useState(false)
  const [archivingId, setArchivingId] = useState<number | null>(null)
  const [arquivando, setArquivando] = useState(false)
  const [viewMode, setViewMode] = useViewMode('setores', 'card')

  const novoSetorForm = useForm<NovoSetorFormInput, unknown, NovoSetorData>({
    resolver: zodResolver(novoSetorSchema),
    defaultValues: { nome: '', icone: null, hora_abertura: '08:00', hora_fechamento: '22:00' },
  })

  const { data: todosSetores, loading: loadingSetores, reload: reloadSetores } = useApiData<Setor[]>(
    () => setoresService.listar(),
    [],
  )

  const { data: colaboradores } = useApiData<Colaborador[]>(
    () => colaboradoresService.listar({ ativo: true }),
    [],
  )

  const { data: escalasResumo } = useApiData<{ setor_id: number; data_inicio: string; data_fim: string; status: string }[]>(
    () => escalasService.resumoPorSetor(),
    [],
  )

  const setores = todosSetores ?? []
  const colabs = colaboradores ?? []
  const escalaMap = new Map((escalasResumo ?? []).map((e) => [e.setor_id, e]))

  const ativos = setores.filter((s) => s.ativo)
  const arquivados = setores.filter((s) => !s.ativo)

  const filtered = (showArchived ? arquivados : ativos).filter((s) =>
    s.nome.toLowerCase().includes(search.toLowerCase()),
  )

  const getColabCount = (setorId: number) =>
    colabs.filter((c) => c.setor_id === setorId).length

  const formatDate = (d: string) => {
    const [y, m, day] = d.split('-')
    return `${day}/${m}`
  }

  const handleCriar = async (data: NovoSetorData) => {
    setCriando(true)
    try {
      await setoresService.criar({
        nome: data.nome.trim(),
        icone: data.icone ?? null,
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

  const handleArquivar = async () => {
    if (!archivingId) return
    setArquivando(true)
    try {
      await setoresService.atualizar(archivingId, { ativo: false })
      toast.success('Setor arquivado')
      reloadSetores()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao arquivar setor')
    } finally {
      setArquivando(false)
      setArchivingId(null)
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
        <PageHeader breadcrumbs={[{ label: 'Dashboard', href: '/' }, { label: 'Setores' }]} />
        <div className="flex flex-1 items-center justify-center">
          <p className="text-sm text-muted-foreground">Carregando...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader
        breadcrumbs={[{ label: 'Dashboard', href: '/' }, { label: 'Setores' }]}
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
          <ViewToggle mode={viewMode} onChange={setViewMode} />
        </div>

        {showArchived && (
          <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/30 p-3">
            <p className="text-sm text-amber-800 dark:text-amber-300">
              Exibindo setores arquivados. Clique em &quot;Restaurar&quot; para reativar.
            </p>
          </div>
        )}

        {filtered.length === 0 ? (
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
        ) : viewMode === 'card' ? (
          /* CARD VIEW */
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {filtered.map((setor) => {
              const colabCount = getColabCount(setor.id)
              const escala = escalaMap.get(setor.id)
              return (
                <Card
                  key={setor.id}
                  className={`transition-shadow hover:shadow-md ${!setor.ativo ? 'opacity-60' : ''}`}
                >
                  <CardContent className="p-4 space-y-3">
                    {/* Header: Icon + Nome */}
                    <div className="flex items-center gap-2.5">
                      <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                        <SetorIcon name={setor.icone} className="size-4 text-primary" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <h3 className="truncate text-sm font-semibold text-foreground">{setor.nome}</h3>
                        <p className="text-xs text-muted-foreground">
                          <Clock className="mr-1 inline size-3 align-[-2px]" />
                          {setor.hora_abertura} - {setor.hora_fechamento}
                        </p>
                      </div>
                    </div>
                    {/* Meta: Colaboradores + Escala */}
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <Badge variant="outline" className="text-[10px]">
                        <Users className="mr-1 size-3" />
                        {colabCount} colaborador{colabCount !== 1 ? 'es' : ''}
                      </Badge>
                      {escala ? (
                        <Badge variant="outline" className="text-[10px] border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-400">
                          <Calendar className="mr-1 size-3" />
                          {formatDate(escala.data_inicio)} - {formatDate(escala.data_fim)}
                          {escala.status === 'RASCUNHO' && ' (rascunho)'}
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px] text-muted-foreground">
                          <CalendarOff className="mr-1 size-3" />
                          Sem escala
                        </Badge>
                      )}
                    </div>
                    {/* Footer: Acao */}
                    <div className="flex items-center gap-1.5 border-t pt-3">
                      {setor.ativo ? (
                        <>
                          <Button variant="outline" size="sm" className="flex-1" asChild>
                            <Link to={`/setores/${setor.id}`}>
                              Abrir <ArrowRight className="ml-1 size-3" />
                            </Link>
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8 shrink-0 text-destructive hover:bg-destructive/10"
                            onClick={() => setArchivingId(setor.id)}
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        </>
                      ) : (
                        <Button variant="outline" size="sm" className="flex-1" onClick={() => handleRestaurar(setor.id)}>
                          <RotateCcw className="mr-1 size-3" /> Restaurar
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        ) : (
          /* TABLE VIEW */
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Nome</TableHead>
                  <TableHead>Horario</TableHead>
                  <TableHead>Colaboradores</TableHead>
                  <TableHead>Escala</TableHead>
                  <TableHead className="w-[100px] text-right pr-4" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((setor) => {
                  const escala = escalaMap.get(setor.id)
                  return (
                  <TableRow key={setor.id} className={!setor.ativo ? 'opacity-60' : ''}>
                    <TableCell className="pl-4 font-medium">
                      <span className="flex items-center gap-1.5">
                        <SetorIcon name={setor.icone} className="size-4 text-muted-foreground" />
                        {setor.nome}
                      </span>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {setor.hora_abertura} - {setor.hora_fechamento}
                    </TableCell>
                    <TableCell>
                      <span className="flex items-center gap-1 text-muted-foreground">
                        <Users className="size-3" />
                        {getColabCount(setor.id)}
                      </span>
                    </TableCell>
                    <TableCell>
                      {escala ? (
                        <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-400 text-[10px]">
                          <Calendar className="mr-1 size-3" />
                          {formatDate(escala.data_inicio)} - {formatDate(escala.data_fim)}
                          {escala.status === 'RASCUNHO' && ' (rascunho)'}
                        </Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">Sem escala</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right pr-4">
                      {setor.ativo ? (
                        <Button variant="ghost" size="sm" asChild>
                          <Link to={`/setores/${setor.id}`}>
                            <ArrowRight className="size-4" />
                          </Link>
                        </Button>
                      ) : (
                        <Button variant="ghost" size="sm" onClick={() => handleRestaurar(setor.id)}>
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
                {filtered.length} setor{filtered.length !== 1 ? 'es' : ''}
              </p>
            </CardContent>
          </Card>
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
                    <div className="flex gap-2">
                      <IconPicker
                        value={novoSetorForm.watch('icone') ?? null}
                        onChange={(v) => novoSetorForm.setValue('icone', v)}
                      />
                      <FormControl>
                        <Input placeholder="Ex: Frios, Limpeza..." {...field} />
                      </FormControl>
                    </div>
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

      {/* Archive Confirmation */}
      <AlertDialog open={!!archivingId} onOpenChange={() => setArchivingId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Arquivar setor?</AlertDialogTitle>
            <AlertDialogDescription>
              O setor sera movido para a lista de arquivados. Voce pode restaura-lo depois.
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
    </div>
  )
}
