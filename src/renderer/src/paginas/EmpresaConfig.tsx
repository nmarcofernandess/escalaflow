import { useState, useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { Settings, Save, Clock } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from '@/components/ui/form'
import { PageHeader } from '@/componentes/PageHeader'
import { DirtyGuardDialog } from '@/componentes/DirtyGuardDialog'
import { useDirtyGuard } from '@/hooks/useDirtyGuard'
import { empresaService } from '@/servicos/empresa'
import { useApiData } from '@/hooks/useApiData'
import { toast } from 'sonner'
import type { Empresa, EmpresaHorarioSemana } from '@shared/index'

const empresaSchema = z.object({
  nome: z.string().min(1, 'Nome e obrigatorio'),
  cnpj: z.string(),
  telefone: z.string(),
})

type EmpresaFormInput = z.input<typeof empresaSchema>
type EmpresaFormData = z.output<typeof empresaSchema>

const DIAS_SEMANA = [
  { key: 'SEG', label: 'Segunda-feira' },
  { key: 'TER', label: 'Terca-feira' },
  { key: 'QUA', label: 'Quarta-feira' },
  { key: 'QUI', label: 'Quinta-feira' },
  { key: 'SEX', label: 'Sexta-feira' },
  { key: 'SAB', label: 'Sabado' },
  { key: 'DOM', label: 'Domingo' },
]

export function EmpresaConfig() {
  const { data: empresa, loading } = useApiData<Empresa>(() => empresaService.buscar(), [])
  const { data: horariosApi, reload: reloadHorarios } = useApiData<EmpresaHorarioSemana[]>(
    () => empresaService.listarHorarios(),
    []
  )

  const [salvando, setSalvando] = useState(false)
  const [horarios, setHorarios] = useState<EmpresaHorarioSemana[]>([])

  useEffect(() => {
    if (horariosApi && horariosApi.length > 0) {
      setHorarios(horariosApi)
    } else if (horariosApi && horariosApi.length === 0) {
      setHorarios(
        DIAS_SEMANA.map(({ key }) => ({
          id: 0,
          dia_semana: key as EmpresaHorarioSemana['dia_semana'],
          ativo: key !== 'DOM',
          hora_abertura: '08:00',
          hora_fechamento: '18:00',
        }))
      )
    }
  }, [horariosApi])

  const form = useForm<EmpresaFormInput, unknown, EmpresaFormData>({
    resolver: zodResolver(empresaSchema),
    defaultValues: { nome: '', cnpj: '', telefone: '' },
  })

  const horariosDirty = horariosApi
    ? horarios.length !== horariosApi.length ||
      horarios.some((h) => {
        const api = horariosApi.find((x) => x.dia_semana === h.dia_semana)
        if (!api) return true
        return (
          h.ativo !== api.ativo ||
          h.hora_abertura !== api.hora_abertura ||
          h.hora_fechamento !== api.hora_fechamento
        )
      })
    : false
  const blocker = useDirtyGuard({ isDirty: form.formState.isDirty || !!horariosDirty })

  useEffect(() => {
    if (empresa) {
      form.reset({
        nome: empresa.nome,
        cnpj: empresa.cnpj ?? '',
        telefone: empresa.telefone ?? '',
      })
    }
  }, [empresa, form])

  const onSubmit = async (data: EmpresaFormData) => {
    setSalvando(true)
    try {
      const nextValues: EmpresaFormInput = {
        nome: data.nome.trim(),
        cnpj: data.cnpj.trim(),
        telefone: data.telefone.trim(),
      }
      const updated = await empresaService.atualizar({
        ...nextValues,
        corte_semanal: empresa?.corte_semanal ?? 'SEG_DOM',
        tolerancia_semanal_min: empresa?.tolerancia_semanal_min ?? 0,
      })
      if (updated?.nome) {
        window.dispatchEvent(
          new CustomEvent('empresa:atualizada', {
            detail: { nome: updated.nome },
          }),
        )
      }
      form.reset(nextValues)
      for (const h of horarios) {
        await empresaService.atualizarHorario({
          dia_semana: h.dia_semana,
          ativo: h.ativo,
          hora_abertura: h.hora_abertura,
          hora_fechamento: h.hora_fechamento,
        })
      }
      await reloadHorarios()
      toast.success('Dados da empresa salvos')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao salvar')
    } finally {
      setSalvando(false)
    }
  }

  const handleHorarioAtivo = (dia_semana: string, ativo: boolean) => {
    setHorarios((prev) => prev.map((h) => (h.dia_semana === dia_semana ? { ...h, ativo } : h)))
  }

  const handleHorarioInput = (dia_semana: string, field: 'hora_abertura' | 'hora_fechamento', value: string) => {
    setHorarios((prev) =>
      prev.map((h) => (h.dia_semana === dia_semana ? { ...h, [field]: value } : h))
    )
  }

  if (loading) {
    return (
      <div className="flex flex-1 flex-col">
        <PageHeader breadcrumbs={[{ label: 'Dashboard', href: '/' }, { label: 'Empresa' }]} />
        <div className="flex flex-1 items-center justify-center">
          <p className="text-sm text-muted-foreground">Carregando...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader
        breadcrumbs={[{ label: 'Dashboard', href: '/' }, { label: 'Empresa' }]}
        actions={
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                form.reset(
                  empresa ? { nome: empresa.nome, cnpj: empresa.cnpj ?? '', telefone: empresa.telefone ?? '' } : { nome: '', cnpj: '', telefone: '' }
                )
                if (horariosApi && horariosApi.length > 0) setHorarios(horariosApi)
                else if (horariosApi && horariosApi.length === 0)
                  setHorarios(
                    DIAS_SEMANA.map(({ key }) => ({
                      id: 0,
                      dia_semana: key as EmpresaHorarioSemana['dia_semana'],
                      ativo: key !== 'DOM',
                      hora_abertura: '08:00',
                      hora_fechamento: '18:00',
                    }))
                  )
              }}
              disabled={salvando || (!form.formState.isDirty && !horariosDirty)}
            >
              Cancelar
            </Button>
            <Button size="sm" onClick={form.handleSubmit(onSubmit)} disabled={salvando}>
              <Save className="mr-1 size-3.5" />
              {salvando ? 'Salvando...' : 'Salvar'}
            </Button>
          </div>
        }
      />

      <div className="flex flex-col gap-6 p-6">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)}>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Settings className="size-4" />
                  Dados da Empresa
                </CardTitle>
                <CardDescription>
                  Informacoes exibidas nos relatorios e exportacoes de escala.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <FormField
                  control={form.control}
                  name="nome"
                  render={({ field }) => (
                    <FormItem className="max-w-md">
                      <FormLabel>Nome</FormLabel>
                      <FormControl>
                        <Input placeholder="Ex: Supermercado Fernandes" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="flex flex-col gap-6 sm:flex-row sm:items-start">
                  <FormField
                    control={form.control}
                    name="cnpj"
                    render={({ field }) => (
                      <FormItem className="sm:w-56">
                        <FormLabel>CNPJ</FormLabel>
                        <FormControl>
                          <Input placeholder="00.000.000/0000-00" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="telefone"
                    render={({ field }) => (
                      <FormItem className="sm:w-56">
                        <FormLabel>Telefone / Contato</FormLabel>
                        <FormControl>
                          <Input placeholder="(00) 00000-0000" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </CardContent>
            </Card>
          </form>
        </Form>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Clock className="size-4" />
              Horarios de Funcionamento
            </CardTitle>
            <CardDescription>
              Horario padrao de abertura e fechamento por dia da semana. Cada setor pode ter horarios
              especificos configurados na pagina do setor.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {horarios.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">Carregando horarios...</p>
            ) : (
              <div className="space-y-2">
                {DIAS_SEMANA.map(({ key, label }) => {
                  const h = horarios.find((x) => x.dia_semana === key)
                  if (!h) return null
                  return (
                    <div
                      key={key}
                      className="flex items-center gap-4 rounded-lg border px-4 py-3"
                    >
                      <Switch
                        checked={h.ativo}
                        onCheckedChange={(val) => handleHorarioAtivo(key, val)}
                      />
                      <span className="w-32 shrink-0 text-sm font-medium">{label}</span>
                      <div className="flex items-center gap-2">
                        <Input
                          type="time"
                          value={h.hora_abertura}
                          disabled={!h.ativo}
                          onChange={(e) => handleHorarioInput(key, 'hora_abertura', e.target.value)}
                          className="w-32"
                        />
                        <span className="text-sm text-muted-foreground">ate</span>
                        <Input
                          type="time"
                          value={h.hora_fechamento}
                          disabled={!h.ativo}
                          onChange={(e) => handleHorarioInput(key, 'hora_fechamento', e.target.value)}
                          className="w-32"
                        />
                      </div>
                      {!h.ativo && (
                        <span className="ml-auto text-xs text-muted-foreground">Fechado</span>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <DirtyGuardDialog
        blocker={blocker}
        onSaveAndExit={async () => {
          return new Promise<void>((resolve, reject) => {
            form.handleSubmit(
              (data) => onSubmit(data).then(resolve, reject),
              () => reject()
            )()
          })
        }}
      />
    </div>
  )
}
