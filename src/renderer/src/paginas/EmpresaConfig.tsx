import { useState, useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { Settings, Save, Shield } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
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
import { empresaService } from '@/servicos/empresa'
import { useApiData } from '@/hooks/useApiData'
import { toast } from 'sonner'
import type { Empresa } from '@shared/index'

const empresaSchema = z.object({
  nome: z.string().min(1, 'Nome e obrigatorio'),
  corte_semanal: z.string().min(1, 'Selecione o corte semanal'),
  tolerancia_semanal_min: z.coerce.number().min(0, 'Minimo 0').max(120, 'Maximo 120 minutos'),
})

type EmpresaFormData = z.infer<typeof empresaSchema>

const CLT_RULES = [
  { rule: 'Max 6 dias consecutivos de trabalho', code: 'CLT_MAX_DIAS_CONSECUTIVOS = 6' },
  { rule: 'Min 11h (660min) entre jornadas', code: 'CLT_MIN_DESCANSO_ENTRE_JORNADAS_MIN = 660' },
  { rule: 'Max 10h (600min) de jornada diaria', code: 'CLT_MAX_JORNADA_DIARIA_MIN = 600' },
  { rule: 'Mulher: max 1 domingo consecutivo', code: 'CLT_MAX_DOMINGOS_CONSECUTIVOS["F"] = 1' },
  { rule: 'Homem: max 2 domingos consecutivos', code: 'CLT_MAX_DOMINGOS_CONSECUTIVOS["M"] = 2' },
]

export function EmpresaConfig() {
  const { data: empresa, loading } = useApiData<Empresa>(
    () => empresaService.buscar(),
    [],
  )

  const [salvando, setSalvando] = useState(false)

  const form = useForm<EmpresaFormData>({
    resolver: zodResolver(empresaSchema),
    defaultValues: {
      nome: '',
      corte_semanal: 'SEG_DOM',
      tolerancia_semanal_min: 30,
    },
  })

  useEffect(() => {
    if (empresa) {
      form.reset({
        nome: empresa.nome,
        corte_semanal: empresa.corte_semanal,
        tolerancia_semanal_min: empresa.tolerancia_semanal_min,
      })
    }
  }, [empresa, form])

  const onSubmit = async (data: EmpresaFormData) => {
    setSalvando(true)
    try {
      await empresaService.atualizar({
        nome: data.nome.trim(),
        corte_semanal: data.corte_semanal,
        tolerancia_semanal_min: data.tolerancia_semanal_min,
      })
      toast.success('Empresa atualizada')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao salvar empresa')
    } finally {
      setSalvando(false)
    }
  }

  if (loading) {
    return (
      <div className="flex flex-1 flex-col">
        <PageHeader breadcrumbs={[{ label: 'Empresa' }]} />
        <div className="flex flex-1 items-center justify-center">
          <p className="text-sm text-muted-foreground">Carregando...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader
        breadcrumbs={[{ label: 'Empresa' }]}
        actions={
          <Button size="sm" onClick={form.handleSubmit(onSubmit)} disabled={salvando}>
            <Save className="mr-1 size-3.5" />
            {salvando ? 'Salvando...' : 'Salvar'}
          </Button>
        }
      />

      <div className="max-w-2xl flex-1 space-y-6 p-6">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)}>
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base font-semibold">
                  <Settings className="size-4" />
                  Configuracao da Empresa
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <FormField
                  control={form.control}
                  name="nome"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Nome da empresa</FormLabel>
                      <FormControl>
                        <Input placeholder="Nome do supermercado" {...field} />
                      </FormControl>
                      <FormDescription>
                        Exibido nos relatorios e exportacoes.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="corte_semanal"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Corte Semanal</FormLabel>
                        <Select value={field.value} onValueChange={field.onChange}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Selecione o corte" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="SEG_DOM">Segunda a Domingo</SelectItem>
                            <SelectItem value="TER_SEG">Terca a Segunda</SelectItem>
                            <SelectItem value="QUA_TER">Quarta a Terca</SelectItem>
                            <SelectItem value="QUI_QUA">Quinta a Quarta</SelectItem>
                            <SelectItem value="SEX_QUI">Sexta a Quinta</SelectItem>
                            <SelectItem value="SAB_SEX">Sabado a Sexta</SelectItem>
                            <SelectItem value="DOM_SAB">Domingo a Sabado</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormDescription>
                          Define quando a semana de trabalho inicia e termina para
                          calculo de horas semanais.
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="tolerancia_semanal_min"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Tolerancia Semanal (minutos)</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            min={0}
                            max={120}
                            placeholder="Ex: 30"
                            {...field}
                          />
                        </FormControl>
                        <FormDescription>
                          Margem aceitavel para desvio de horas semanais (0-120 min).
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </CardContent>
            </Card>
          </form>
        </Form>

        {/* Regras CLT (read-only) */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base font-semibold">
              <Shield className="size-4" />
              Regras CLT (Imutaveis)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-4 text-xs text-muted-foreground">
              Estas regras sao da legislacao trabalhista brasileira e nao podem
              ser alteradas. O motor de escala as aplica automaticamente.
            </p>
            <div className="space-y-2">
              {CLT_RULES.map((r, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between rounded-lg border bg-muted/30 p-3"
                >
                  <span className="text-sm text-foreground">{r.rule}</span>
                  <code className="rounded bg-muted px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
                    {r.code}
                  </code>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
