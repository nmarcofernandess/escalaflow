import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { FileText, Plus, Edit, Trash2, Info, Search, Clock, Calendar, Timer } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Alert, AlertDescription } from '@/components/ui/alert'
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
import { tiposContratoService } from '@/servicos/tipos-contrato'
import { useApiData } from '@/hooks/useApiData'
import { formatarMinutos, mapError } from '@/lib/formatadores'
import { toast } from 'sonner'
import type { TipoContrato } from '@shared/index'

const contratoSchema = z.object({
  nome: z.string().min(1, 'Nome e obrigatorio'),
  horas_semanais: z.coerce.number().min(1, 'Minimo 1h').max(44, 'Maximo 44h'),
  regime_escala: z.enum(['5X2', '6X1']),
  max_minutos_dia: z.coerce.number().min(60, 'Minimo 60 min').max(600, 'Maximo 600 min'),
  trabalha_domingo: z.boolean(),
})

type ContratoFormInput = z.input<typeof contratoSchema>
type ContratoFormData = z.output<typeof contratoSchema>

const DEFAULTS: ContratoFormInput = {
  nome: '',
  horas_semanais: 44,
  regime_escala: '6X1',
  max_minutos_dia: 570,
  trabalha_domingo: true,
}

export function ContratoLista() {
  const { data: tipos, loading, reload } = useApiData<TipoContrato[]>(
    () => tiposContratoService.listar(),
    [],
  )

  const [search, setSearch] = useState('')
  const [showDialog, setShowDialog] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [deletingId, setDeletingId] = useState<number | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [deletando, setDeletando] = useState(false)
  const [viewMode, setViewMode] = useViewMode('contratos', 'table')

  const form = useForm<ContratoFormInput, unknown, ContratoFormData>({
    resolver: zodResolver(contratoSchema),
    defaultValues: DEFAULTS,
  })

  const abrirDialogCriar = () => {
    setEditingId(null)
    form.reset(DEFAULTS)
    setShowDialog(true)
  }

  const abrirDialogEditar = (tc: TipoContrato) => {
    setEditingId(tc.id)
    form.reset({
      nome: tc.nome,
      horas_semanais: tc.horas_semanais,
      regime_escala: tc.regime_escala ?? (tc.dias_trabalho <= 5 ? '5X2' : '6X1'),
      max_minutos_dia: tc.max_minutos_dia,
      trabalha_domingo: tc.trabalha_domingo,
    })
    setShowDialog(true)
  }

  const onSubmit = async (data: ContratoFormData) => {
    setSalvando(true)
    const diasTrabalho = data.regime_escala === '5X2' ? 5 : 6
    const payload = { ...data, dias_trabalho: diasTrabalho }
    try {
      if (editingId) {
        await tiposContratoService.atualizar(editingId, payload)
        toast.success('Tipo de contrato atualizado')
      } else {
        await tiposContratoService.criar(payload)
        toast.success('Tipo de contrato cadastrado')
      }
      setShowDialog(false)
      reload()
    } catch (err) {
      toast.error(mapError(err))
    } finally {
      setSalvando(false)
    }
  }

  const handleConfirmarDelete = async () => {
    if (!deletingId) return
    setDeletando(true)
    try {
      await tiposContratoService.deletar(deletingId)
      toast.success('Tipo de contrato excluido')
      setDeletingId(null)
      reload()
    } catch (err) {
      const msg = err instanceof Error ? err.message.toLowerCase() : ''
      if (msg.includes('vinculados') || msg.includes('colaboradores')) {
        const match = msg.match(/(\d+)/)
        const n = match ? match[1] : ''
        toast.error(
          n
            ? `Este tipo de contrato tem ${n} colaborador(es) vinculado(s). Remova os vinculos antes de excluir.`
            : 'Este tipo de contrato tem colaboradores vinculados. Remova os vinculos antes de excluir.',
        )
      } else {
        toast.error(mapError(err))
      }
      setDeletingId(null)
    } finally {
      setDeletando(false)
    }
  }

  const allTipos = tipos ?? []
  const filtered = allTipos.filter((tc) =>
    tc.nome.toLowerCase().includes(search.toLowerCase()),
  )

  if (loading || !tipos) {
    return (
      <div className="flex flex-1 flex-col">
        <PageHeader breadcrumbs={[{ label: 'Dashboard', href: '/' }, { label: 'Tipos de Contrato' }]} />
        <div className="flex flex-1 items-center justify-center">
          <p className="text-sm text-muted-foreground">Carregando...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader
        breadcrumbs={[{ label: 'Dashboard', href: '/' }, { label: 'Tipos de Contrato' }]}
        actions={
          <Button size="sm" onClick={abrirDialogCriar}>
            <Plus className="mr-1 size-3.5" />
            Novo Tipo
          </Button>
        }
      />

      <div className="flex flex-1 flex-col gap-4 p-6">
        {/* Toolbar */}
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
          <ViewToggle mode={viewMode} onChange={setViewMode} />
        </div>

        {filtered.length === 0 ? (
          <EmptyState
            icon={FileText}
            title={search ? 'Nenhum tipo encontrado' : 'Nenhum tipo de contrato cadastrado'}
            description={search ? '' : 'Crie um template de contrato para vincular aos colaboradores'}
            action={
              !search ? (
                <Button size="sm" onClick={abrirDialogCriar}>
                  <Plus className="mr-1 size-3.5" />
                  Criar Template
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
                  <TableHead>Horas/semana</TableHead>
                  <TableHead>Regime</TableHead>
                  <TableHead>Dias</TableHead>
                  <TableHead>Max/dia</TableHead>
                  <TableHead>Domingo</TableHead>
                  <TableHead className="w-[100px] text-right pr-4" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((tc) => (
                  <TableRow key={tc.id}>
                    <TableCell className="pl-4 font-medium">{tc.nome}</TableCell>
                    <TableCell>{tc.horas_semanais}h</TableCell>
                    <TableCell>{tc.regime_escala ?? (tc.dias_trabalho <= 5 ? '5X2' : '6X1')}</TableCell>
                    <TableCell>{tc.dias_trabalho} dias</TableCell>
                    <TableCell>{formatarMinutos(tc.max_minutos_dia)}</TableCell>
                    <TableCell>
                      <Badge
                        variant={tc.trabalha_domingo ? 'default' : 'secondary'}
                        className="text-[10px]"
                      >
                        {tc.trabalha_domingo ? 'Sim' : 'Nao'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right pr-4">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          onClick={() => abrirDialogEditar(tc)}
                        >
                          <Edit className="size-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8 text-destructive hover:bg-destructive/5"
                          onClick={() => setDeletingId(tc.id)}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <CardContent className="border-t py-2">
              <p className="text-xs text-muted-foreground">
                {filtered.length} tipo{filtered.length !== 1 ? 's' : ''} de contrato
              </p>
            </CardContent>
          </Card>
        ) : (
          /* CARD VIEW */
          <>
            <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3">
              {filtered.map((tc) => (
                <Card key={tc.id} className="transition-shadow hover:shadow-md">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-3">
                        <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10">
                          <FileText className="size-5 text-primary" />
                        </div>
                        <h3 className="text-sm font-semibold text-foreground">{tc.nome}</h3>
                      </div>
                      <Badge
                        variant={tc.trabalha_domingo ? 'default' : 'secondary'}
                        className="shrink-0 text-[10px]"
                      >
                        Dom: {tc.trabalha_domingo ? 'Sim' : 'Nao'}
                      </Badge>
                    </div>
                    <div className="mt-3 flex items-center gap-4 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Clock className="size-3" />
                        {tc.horas_semanais}h/semana
                      </span>
                      <span className="rounded bg-muted px-1.5 py-0.5 font-medium text-foreground">
                        {tc.regime_escala ?? (tc.dias_trabalho <= 5 ? '5X2' : '6X1')}
                      </span>
                      <span className="flex items-center gap-1">
                        <Calendar className="size-3" />
                        {tc.dias_trabalho} dias
                      </span>
                      <span className="flex items-center gap-1">
                        <Timer className="size-3" />
                        {formatarMinutos(tc.max_minutos_dia)}/dia
                      </span>
                    </div>
                    <div className="mt-3 flex items-center gap-1">
                      <Button variant="outline" size="sm" className="flex-1" onClick={() => abrirDialogEditar(tc)}>
                        <Edit className="mr-1 size-3" /> Editar
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-destructive hover:bg-destructive/5"
                        onClick={() => setDeletingId(tc.id)}
                      >
                        <Trash2 className="size-3" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              {filtered.length} tipo{filtered.length !== 1 ? 's' : ''} de contrato
            </p>
          </>
        )}
      </div>

      {/* Create/Edit Dialog */}
      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editingId ? 'Editar Tipo de Contrato' : 'Novo Tipo de Contrato'}
            </DialogTitle>
            <DialogDescription>
              Configure os limites do contrato de trabalho.
            </DialogDescription>
          </DialogHeader>

          <Alert className="border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/20 [&>svg]:text-blue-600 dark:[&>svg]:text-blue-400">
            <Info className="size-4" />
            <AlertDescription className="text-xs text-blue-900 dark:text-blue-200">
              Regras como max 6 dias consecutivos e 11h de descanso entre jornadas sao leis
              trabalhistas (CLT) e nao podem ser alteradas. Os campos abaixo configuram limites do
              CONTRATO, que podem ser mais restritivos que a lei.
            </AlertDescription>
          </Alert>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 py-2">
              <FormField
                control={form.control}
                name="nome"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nome do Tipo de Contrato</FormLabel>
                    <FormControl>
                      <Input placeholder="Ex: CLT 44h" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="horas_semanais"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Horas Semanais</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min="1"
                          max="44"
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
                <FormField
                  control={form.control}
                  name="regime_escala"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Regime</FormLabel>
                      <FormControl>
                        <Select value={field.value} onValueChange={field.onChange}>
                          <SelectTrigger>
                            <SelectValue placeholder="Selecione o regime" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="6X1">6x1 (6 dias + 1 folga)</SelectItem>
                            <SelectItem value="5X2">5x2 (5 dias + 2 folgas)</SelectItem>
                          </SelectContent>
                        </Select>
                      </FormControl>
                      <p className="text-xs text-muted-foreground">
                        Dias/semana: {form.watch('regime_escala') === '5X2' ? 5 : 6}
                      </p>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="max_minutos_dia"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Max Minutos por Dia</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min="60"
                        max="600"
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

              <FormField
                control={form.control}
                name="trabalha_domingo"
                render={({ field }) => (
                  <FormItem className="flex items-center space-x-2 space-y-0">
                    <FormControl>
                      <Checkbox
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                    </FormControl>
                    <FormLabel className="cursor-pointer font-normal">
                      Trabalha aos domingos
                    </FormLabel>
                  </FormItem>
                )}
              />

              <DialogFooter>
                <Button variant="outline" type="button" onClick={() => setShowDialog(false)}>
                  Cancelar
                </Button>
                <Button type="submit" disabled={salvando}>
                  {salvando ? 'Salvando...' : editingId ? 'Salvar Alteracoes' : 'Criar Tipo'}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deletingId} onOpenChange={() => setDeletingId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir tipo de contrato?</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja excluir este tipo de contrato? Esta acao nao pode ser
              desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletando}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmarDelete} disabled={deletando}>
              {deletando ? 'Excluindo...' : 'Excluir'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
