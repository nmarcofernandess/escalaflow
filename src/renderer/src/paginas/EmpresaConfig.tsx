import { useState, useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { Settings, Save, ShieldCheck, Monitor, Sun, Moon, Check } from 'lucide-react'
import { useTheme } from 'next-themes'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
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
  FormMessage,
} from '@/components/ui/form'
import { PageHeader } from '@/componentes/PageHeader'
import { empresaService } from '@/servicos/empresa'
import { useApiData } from '@/hooks/useApiData'
import { useColorTheme } from '@/hooks/useColorTheme'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import type { Empresa } from '@shared/index'

const empresaSchema = z.object({
  nome: z.string().min(1, 'Nome e obrigatorio'),
  cnpj: z.string(),
  telefone: z.string(),
  corte_semanal: z.string().min(1, 'Selecione o corte semanal'),
  tolerancia_semanal_min: z.coerce.number().min(0, 'Minimo 0').max(120, 'Maximo 120 minutos'),
})

type EmpresaFormData = z.infer<typeof empresaSchema>

const REGRAS_CLT = [
  'Maximo de 6 dias seguidos de trabalho',
  'Minimo de 11 horas de descanso entre jornadas',
  'Jornada diaria de no maximo 10 horas',
  'Mulheres: folga obrigatoria a cada 2 domingos trabalhados',
  'Homens: folga obrigatoria a cada 3 domingos trabalhados',
]

export function EmpresaConfig() {
  const { data: empresa, loading } = useApiData<Empresa>(
    () => empresaService.buscar(),
    [],
  )

  const [salvando, setSalvando] = useState(false)
  const { theme: currentMode, setTheme } = useTheme()
  const { colorTheme, setColorTheme } = useColorTheme()

  const form = useForm<EmpresaFormData>({
    resolver: zodResolver(empresaSchema),
    defaultValues: {
      nome: '',
      cnpj: '',
      telefone: '',
      corte_semanal: 'SEG_DOM',
      tolerancia_semanal_min: 30,
    },
  })

  useEffect(() => {
    if (empresa) {
      form.reset({
        nome: empresa.nome,
        cnpj: empresa.cnpj ?? '',
        telefone: empresa.telefone ?? '',
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
        cnpj: data.cnpj.trim(),
        telefone: data.telefone.trim(),
        corte_semanal: data.corte_semanal,
        tolerancia_semanal_min: data.tolerancia_semanal_min,
      })
      toast.success('Configuracoes salvas')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao salvar')
    } finally {
      setSalvando(false)
    }
  }

  if (loading) {
    return (
      <div className="flex flex-1 flex-col">
        <PageHeader breadcrumbs={[{ label: 'Dashboard', href: '/' }, { label: 'Configuracoes' }]} />
        <div className="flex flex-1 items-center justify-center">
          <p className="text-sm text-muted-foreground">Carregando...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader
        breadcrumbs={[{ label: 'Dashboard', href: '/' }, { label: 'Configuracoes' }]}
        actions={
          <Button size="sm" onClick={form.handleSubmit(onSubmit)} disabled={salvando}>
            <Save className="mr-1 size-3.5" />
            {salvando ? 'Salvando...' : 'Salvar'}
          </Button>
        }
      />

      <div className="flex flex-1 flex-col gap-6 overflow-y-auto p-6">
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

                <Separator />

                <div>
                  <h4 className="mb-1 text-sm font-medium">Periodo semanal</h4>
                  <p className="mb-4 text-sm text-muted-foreground">
                    Como o sistema conta as horas da semana para cada colaborador.
                  </p>
                  <div className="flex flex-col gap-6 sm:flex-row sm:items-start">
                    <FormField
                      control={form.control}
                      name="corte_semanal"
                      render={({ field }) => (
                        <FormItem className="sm:w-64">
                          <FormLabel>Semana comeca em</FormLabel>
                          <Select value={field.value} onValueChange={field.onChange}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="SEG_DOM">Segunda</SelectItem>
                              <SelectItem value="TER_SEG">Terca</SelectItem>
                              <SelectItem value="QUA_TER">Quarta</SelectItem>
                              <SelectItem value="QUI_QUA">Quinta</SelectItem>
                              <SelectItem value="SEX_QUI">Sexta</SelectItem>
                              <SelectItem value="SAB_SEX">Sabado</SelectItem>
                              <SelectItem value="DOM_SAB">Domingo</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="tolerancia_semanal_min"
                      render={({ field }) => (
                        <FormItem className="sm:w-48">
                          <FormLabel>Tolerancia (minutos)</FormLabel>
                          <FormControl>
                            <Input
                              type="number"
                              min={0}
                              max={120}
                              placeholder="30"
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          </form>
        </Form>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Settings className="size-4" />
              Aparencia
            </CardTitle>
            <CardDescription>
              Personalize o visual do sistema
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Section 1: Mode selector */}
            <div>
              <h4 className="mb-1 text-sm font-medium">Modo</h4>
              <p className="mb-4 text-sm text-muted-foreground">
                Escolha entre claro, escuro ou automatico
              </p>
              <div className="grid grid-cols-3 gap-3">
                {[
                  { value: 'system', label: 'Automatico', icon: Monitor },
                  { value: 'light', label: 'Claro', icon: Sun },
                  { value: 'dark', label: 'Escuro', icon: Moon },
                ].map(({ value, label, icon: Icon }) => {
                  const isSelected = currentMode === value
                  return (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setTheme(value)}
                      className={cn(
                        'flex flex-col items-center gap-2 rounded-lg border p-4 transition-colors hover:bg-accent',
                        isSelected && 'border-primary bg-accent'
                      )}
                    >
                      <Icon className="size-5" />
                      <span className="text-sm">{label}</span>
                    </button>
                  )
                })}
              </div>
            </div>

            <Separator />

            {/* Section 2: Color palette selector */}
            <div>
              <h4 className="mb-1 text-sm font-medium">Cor do tema</h4>
              <p className="mb-4 text-sm text-muted-foreground">
                Escolha a paleta de cores da interface
              </p>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  { value: 'zinc', label: 'Zinc', preview: 'hsl(222.2 47.4% 11.2%)' },
                  { value: 'blue', label: 'Azul', preview: 'hsl(221.2 83.2% 53.3%)' },
                  { value: 'green', label: 'Verde', preview: 'hsl(142.1 76.2% 36.3%)' },
                  { value: 'violet', label: 'Violeta', preview: 'hsl(262.1 83.3% 57.8%)' },
                ].map(({ value, label, preview }) => {
                  const isSelected = colorTheme === value
                  return (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setColorTheme(value as 'zinc' | 'blue' | 'green' | 'violet')}
                      className={cn(
                        'relative flex flex-col items-center gap-3 rounded-lg border p-4 transition-colors hover:bg-accent',
                        isSelected && 'ring-2 ring-ring ring-offset-2 ring-offset-background'
                      )}
                    >
                      {isSelected && (
                        <Check className="absolute right-2 top-2 size-4 text-primary" />
                      )}
                      <div className="flex gap-1">
                        <div
                          className="size-6 rounded-full border"
                          style={{ backgroundColor: 'hsl(var(--background))' }}
                        />
                        <div
                          className="size-6 rounded-full border"
                          style={{ backgroundColor: preview }}
                        />
                      </div>
                      <span className="text-sm">{label}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="size-4" />
              Regras trabalhistas
            </CardTitle>
            <CardDescription>
              Aplicadas automaticamente pelo sistema ao gerar escalas. Nao podem ser alteradas.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-3">
              {REGRAS_CLT.map((regra, i) => (
                <li
                  key={i}
                  className="flex items-center gap-3 rounded-lg border bg-muted/30 px-4 py-3"
                >
                  <ShieldCheck className="size-4 shrink-0 text-muted-foreground" />
                  <span className="text-sm">{regra}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
