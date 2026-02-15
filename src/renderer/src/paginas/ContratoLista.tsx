import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { FileText, Clock, CalendarDays, Sun, Plus, Edit, Trash2, Info } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
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
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormDescription,
  FormMessage,
} from '@/components/ui/form'
import { PageHeader } from '@/componentes/PageHeader'
import { EmptyState } from '@/componentes/EmptyState'
import { MetricItem } from '@/componentes/MetricItem'
import { tiposContratoService } from '@/servicos/tipos-contrato'
import { useApiData } from '@/hooks/useApiData'
import { formatarMinutos, mapError } from '@/lib/formatadores'
import { toast } from 'sonner'
import type { TipoContrato } from '@shared/index'

const contratoSchema = z.object({
  nome: z.string().min(1, 'Nome e obrigatorio'),
  horas_semanais: z.coerce.number().min(1, 'Minimo 1h').max(44, 'Maximo 44h'),
  dias_trabalho: z.coerce.number().min(1, 'Minimo 1 dia').max(6, 'Maximo 6 dias'),
  max_minutos_dia: z.coerce.number().min(60, 'Minimo 60 min').max(600, 'Maximo 600 min'),
  trabalha_domingo: z.boolean(),
})

type ContratoFormData = z.infer<typeof contratoSchema>

const DEFAULTS: ContratoFormData = {
  nome: '',
  horas_semanais: 44,
  dias_trabalho: 6,
  max_minutos_dia: 570,
  trabalha_domingo: true,
}

export function ContratoLista() {
  const { data: tipos, loading, reload } = useApiData<TipoContrato[]>(
    () => tiposContratoService.listar(),
    [],
  )

  const [showDialog, setShowDialog] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [deletingId, setDeletingId] = useState<number | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [deletando, setDeletando] = useState(false)

  const form = useForm<ContratoFormData>({
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
      dias_trabalho: tc.dias_trabalho,
      max_minutos_dia: tc.max_minutos_dia,
      trabalha_domingo: tc.trabalha_domingo,
    })
    setShowDialog(true)
  }

  const onSubmit = async (data: ContratoFormData) => {
    setSalvando(true)
    try {
      if (editingId) {
        await tiposContratoService.atualizar(editingId, data)
        toast.success('Tipo de contrato atualizado')
      } else {
        await tiposContratoService.criar(data)
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

  if (loading || !tipos) {
    return (
      <div className="flex flex-1 flex-col">
        <PageHeader breadcrumbs={[{ label: 'Tipos de Contrato' }]} />
        <div className="flex flex-1 items-center justify-center">
          <p className="text-sm text-muted-foreground">Carregando...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader
        breadcrumbs={[{ label: 'Tipos de Contrato' }]}
        actions={
          <Button size="sm" onClick={abrirDialogCriar}>
            <Plus className="mr-1 size-3.5" />
            Novo Tipo de Contrato
          </Button>
        }
      />

      <div className="flex-1 space-y-4 p-6">
        <p className="text-sm text-muted-foreground">
          Templates de contrato de trabalho. Cada colaborador e vinculado a um tipo, que define
          horas semanais, dias de trabalho e regras.
        </p>

        {tipos.length === 0 ? (
          <EmptyState
            icon={FileText}
            title="Nenhum tipo de contrato cadastrado"
            description="Crie um template de contrato para vincular aos colaboradores"
            action={
              <Button size="sm" onClick={abrirDialogCriar}>
                <Plus className="mr-1 size-3.5" />
                Criar Template
              </Button>
            }
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {tipos.map((tc) => (
              <Card key={tc.id} className="transition-shadow hover:shadow-md">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
                  <div className="flex items-center gap-3">
                    <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10">
                      <FileText className="size-5 text-primary" />
                    </div>
                    <CardTitle className="text-sm">{tc.nome}</CardTitle>
                  </div>
                  <div className="flex items-center gap-1">
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
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 gap-3">
                    <MetricItem icon={Clock} value={`${tc.horas_semanais}h/sem`} label="Horas semanais" />
                    <MetricItem icon={CalendarDays} value={`${tc.dias_trabalho} dias`} label="Dias de trabalho" />
                    <MetricItem icon={Clock} value={`${formatarMinutos(tc.max_minutos_dia)}/dia`} label="Max por dia" />
                    <MetricItem
                      icon={Sun}
                      value={
                        <Badge
                          variant={tc.trabalha_domingo ? 'default' : 'secondary'}
                          className="h-5 px-1.5 text-[10px]"
                        >
                          {tc.trabalha_domingo ? 'Sim' : 'Nao'}
                        </Badge>
                      }
                      label="Domingo"
                    />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
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

          {/* CLT Disclaimer */}
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
                        <Input type="number" min="1" max="44" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="dias_trabalho"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Dias de Trabalho</FormLabel>
                      <FormControl>
                        <Input type="number" min="1" max="6" {...field} />
                      </FormControl>
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
                      <Input type="number" min="60" max="600" {...field} />
                    </FormControl>
                    <FormDescription>Exemplo: 9h30 = 570 minutos</FormDescription>
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
