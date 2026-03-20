import { useState, useEffect, useCallback } from 'react'
import { ShieldCheck, Lock, AlertTriangle, RotateCcw, Building2, Pencil, X } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
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
import { SaveIndicator } from '@/componentes/SaveIndicator'
import { empresaService } from '@/servicos/empresa'
import { regrasService } from '@/servicos/regras'
import { useApiData } from '@/hooks/useApiData'
import { useAutoSave } from '@/hooks/useAutoSave'
import { toast } from 'sonner'
import type { Empresa } from '@shared/index'
import type { RuleDefinition, RuleStatus } from '@shared/index'

const regrasSchema = z.object({
  corte_semanal: z.string().min(1, 'Selecione o corte semanal'),
  tolerancia_semanal_min: z.coerce.number().min(0, 'Minimo 0').max(120, 'Maximo 120 minutos'),
  usa_cct_intervalo_reduzido: z.boolean(),
})

type RegrasFormInput = z.input<typeof regrasSchema>
type RegrasFormData = z.output<typeof regrasSchema>


interface RegraCategoriaCardProps {
  titulo: string
  descricao: string
  categoria: 'CLT' | 'SOFT' | 'ANTIPATTERN'
  regras: RuleDefinition[]
  salvandoRegra: string | null
  onMudanca: (codigo: string, status: string) => void
  onBulk: (categoria: string, status: string) => void
}

function RegraCategoriaCard({
  titulo,
  descricao,
  categoria,
  regras,
  salvandoRegra,
  onMudanca,
  onBulk,
}: RegraCategoriaCardProps) {
  const categRegras = regras.filter((r) => r.categoria === categoria)
  const isCLT = categoria === 'CLT'
  const statusOptions = isCLT
    ? [
        { value: 'HARD', label: 'HARD' },
        { value: 'SOFT', label: 'SOFT' },
        { value: 'OFF', label: 'Desativado' },
      ]
    : [
        { value: 'ON', label: 'Ativo' },
        { value: 'OFF', label: 'Desativado' },
      ]
  const bulkOptions = isCLT ? ['HARD', 'SOFT', 'OFF'] : ['ON', 'OFF']

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base">{titulo}</CardTitle>
            <CardDescription className="mt-1">{descricao}</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Aplicar todos:</span>
            <Select onValueChange={(val) => onBulk(categoria, val)}>
              <SelectTrigger className="w-[130px] h-8">
                <SelectValue placeholder="Selecionar..." />
              </SelectTrigger>
              <SelectContent>
                {bulkOptions.map((opt) => (
                  <SelectItem key={opt} value={opt}>
                    {opt === 'OFF' ? 'Desativado' : opt}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="divide-y">
          {categRegras.map((r) => {
            const mudou = r.status_efetivo !== r.status_sistema
            return (
              <div key={r.codigo} className="flex items-center justify-between px-6 py-3">
                <div className="flex-1 min-w-0 mr-4">
                  <div className="flex items-center gap-2 flex-wrap">
                    {!r.editavel && <Lock className="size-3 text-muted-foreground shrink-0" />}
                    <span className="text-sm font-medium">{r.nome}</span>
                    <Badge variant="outline" className="text-xs font-mono">
                      {r.codigo}
                    </Badge>
                    {mudou && (
                      <Badge variant="secondary" className="text-xs">
                        Customizado
                      </Badge>
                    )}
                  </div>
                  {r.descricao && (
                    <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                      {r.descricao}
                    </p>
                  )}
                  {r.aviso_dependencia && mudou && (
                    <p className="text-xs text-warning mt-1 flex items-center gap-1">
                      <AlertTriangle className="size-3 shrink-0" />
                      {r.aviso_dependencia}
                    </p>
                  )}
                </div>
                <Select
                  value={r.status_efetivo}
                  onValueChange={(val) => onMudanca(r.codigo, val)}
                  disabled={!r.editavel || salvandoRegra === r.codigo}
                >
                  <SelectTrigger className="w-[130px] h-8 shrink-0">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {statusOptions.map((opt) => {
                      if (r.codigo === 'H10' && opt.value === 'OFF') return null
                      return (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      )
                    })}
                  </SelectContent>
                </Select>
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}

export function RegrasPagina() {
  const [salvandoRegra, setSalvandoRegra] = useState<string | null>(null)
  const [resetando, setResetando] = useState(false)
  const [deletandoRegra, setDeletandoRegra] = useState<string | null>(null)
  const { data: empresa, reload: reloadEmpresa } = useApiData<Empresa>(() => empresaService.buscar(), [])
  const { data: regrasData, reload: reloadRegras } = useApiData<RuleDefinition[]>(
    () => regrasService.listar(),
    [],
  )

  const form = useForm<RegrasFormInput, unknown, RegrasFormData>({
    resolver: zodResolver(regrasSchema),
    defaultValues: {
      corte_semanal: 'SEG_DOM',
      tolerancia_semanal_min: 0,
      usa_cct_intervalo_reduzido: true,
    },
  })

  useEffect(() => {
    if (empresa) {
      form.reset({
        corte_semanal: empresa.corte_semanal,
        tolerancia_semanal_min: empresa.tolerancia_semanal_min,
        usa_cct_intervalo_reduzido: empresa.usa_cct_intervalo_reduzido,
      })
    }
  }, [empresa, form])

  // Auto-save: corte_semanal
  const corteAutoSave = useAutoSave({
    saveFn: useCallback(async () => {
      const val = form.getValues('corte_semanal')
      await empresaService.atualizar({ corte_semanal: val })
      await reloadEmpresa()
    }, [form, reloadEmpresa]),
  })

  // Auto-save: tolerancia_semanal_min
  const toleranciaAutoSave = useAutoSave({
    saveFn: useCallback(async () => {
      const val = Number(form.getValues('tolerancia_semanal_min'))
      await empresaService.atualizar({ tolerancia_semanal_min: val })
      await reloadEmpresa()
    }, [form, reloadEmpresa]),
    validate: useCallback(() => {
      const num = Number(form.getValues('tolerancia_semanal_min'))
      return !isNaN(num) && num >= 0 && num <= 120
    }, [form]),
  })

  // Auto-save: usa_cct_intervalo_reduzido
  const cctAutoSave = useAutoSave({
    saveFn: useCallback(async () => {
      const val = form.getValues('usa_cct_intervalo_reduzido')
      await empresaService.atualizar({
        usa_cct_intervalo_reduzido: val,
        min_intervalo_almoco_min: val ? 30 : 60,
      })
      await reloadEmpresa()
    }, [form, reloadEmpresa]),
  })

  const handleRegraChange = async (codigo: string, status: string) => {
    setSalvandoRegra(codigo)
    try {
      await regrasService.atualizar(codigo, status as RuleStatus)
      await reloadRegras()
    } catch {
      toast.error('Erro ao salvar regra')
    } finally {
      setSalvandoRegra(null)
    }
  }

  const handleBulkChange = async (categoria: string, status: string) => {
    const editaveis = (regrasData ?? []).filter(
      (r) => r.categoria === categoria && r.editavel,
    )
    for (const r of editaveis) {
      if (r.codigo === 'H10' && status === 'OFF') continue
      await regrasService.atualizar(r.codigo, status as RuleStatus)
    }
    await reloadRegras()
  }

  const handleResetarSistema = async () => {
    setResetando(true)
    try {
      await regrasService.resetarEmpresa()
      await reloadRegras()
      toast.success('Padrões do sistema restaurados')
    } catch {
      toast.error('Erro ao restaurar padrões')
    } finally {
      setResetando(false)
    }
  }

  const handleDeletarCustomizacao = async (codigo: string) => {
    setDeletandoRegra(codigo)
    try {
      await regrasService.resetarRegra(codigo)
      await reloadRegras()
      toast.success('Customização removida')
    } catch {
      toast.error('Erro ao remover customização')
    } finally {
      setDeletandoRegra(null)
    }
  }

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader
        breadcrumbs={[{ label: 'Dashboard', href: '/' }, { label: 'Regras' }]}
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={handleResetarSistema}
            disabled={resetando}
          >
            <RotateCcw className="mr-1 size-3.5" />
            {resetando ? 'Restaurando...' : 'Restaurar Padrões'}
          </Button>
        }
      />

      <div className="flex flex-col gap-6 p-6">
        <Form {...form}>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Periodo semanal</CardTitle>
              <CardDescription>
                Como o sistema conta as horas da semana para cada colaborador.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex flex-col gap-6 sm:flex-row sm:items-start">
                <FormField
                  control={form.control}
                  name="corte_semanal"
                  render={({ field }) => (
                    <FormItem className="sm:w-64">
                      <FormLabel className="flex items-center gap-1.5">
                        Semana comeca em
                        <SaveIndicator status={corteAutoSave.status} error={corteAutoSave.error} />
                      </FormLabel>
                      <Select
                        value={field.value}
                        onValueChange={(val) => {
                          field.onChange(val)
                          corteAutoSave.trigger()
                        }}
                      >
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
                      <FormLabel className="flex items-center gap-1.5">
                        Tolerancia (minutos)
                        <SaveIndicator status={toleranciaAutoSave.status} error={toleranciaAutoSave.error} />
                      </FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min={0}
                          max={120}
                          placeholder="30"
                          value={typeof field.value === 'number' ? field.value : ''}
                          onChange={(e) =>
                            field.onChange(
                              e.target.value === '' ? '' : Number(e.target.value),
                            )
                          }
                          onBlur={() => toleranciaAutoSave.trigger()}
                          name={field.name}
                          ref={field.ref}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <Separator />

              <div>
                <h4 className="mb-1 text-sm font-medium">Intervalo de almoco</h4>
                <p className="mb-4 text-sm text-muted-foreground">
                  A CCT do comercio autoriza reducao do almoco para 30 minutos com acordo escrito.
                </p>
                <FormField
                  control={form.control}
                  name="usa_cct_intervalo_reduzido"
                  render={({ field }) => (
                    <FormItem>
                      <div className="flex items-center gap-3 rounded-lg border p-4">
                        <FormControl>
                          <Switch
                            checked={field.value}
                            onCheckedChange={(val) => {
                              field.onChange(val)
                              cctAutoSave.trigger()
                            }}
                          />
                        </FormControl>
                        <div>
                          <FormLabel className="flex items-center gap-1.5 text-sm font-medium">
                            Usar regra da Convencao Coletiva (CCT)
                            <SaveIndicator status={cctAutoSave.status} error={cctAutoSave.error} />
                          </FormLabel>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {field.value
                              ? 'Almoco minimo: 30 minutos (CCT FecomercioSP)'
                              : 'Almoco minimo: 1 hora (CLT Art. 71)'}
                          </p>
                        </div>
                      </div>
                    </FormItem>
                  )}
                />
              </div>
            </CardContent>
          </Card>
        </Form>

        {regrasData && regrasData.length > 0 && (
          <>
            <RegraCategoriaCard
              titulo="Regras CLT"
              descricao="Regras legais trabalhistas. Algumas sao fixas por lei (cadeado), outras podem ser relaxadas para SOFT (gera aviso em vez de bloquear)."
              categoria="CLT"
              regras={regrasData}
              salvandoRegra={salvandoRegra}
              onMudanca={handleRegraChange}
              onBulk={handleBulkChange}
            />
            <RegraCategoriaCard
              titulo="Preferencias de Otimizacao"
              descricao="Objetivos de qualidade que o sistema tenta alcançar ao gerar a escala. Desativar ignora esse critério."
              categoria="SOFT"
              regras={regrasData}
              salvandoRegra={salvandoRegra}
              onMudanca={handleRegraChange}
              onBulk={handleBulkChange}
            />
            <RegraCategoriaCard
              titulo="Antipadroes"
              descricao="Padrões indesejados na escala que o sistema evita ao gerar. Desativar ignora esse critério."
              categoria="ANTIPATTERN"
              regras={regrasData}
              salvandoRegra={salvandoRegra}
              onMudanca={handleRegraChange}
              onBulk={handleBulkChange}
            />

            {/* Card: Customizações da Empresa */}
            {(() => {
              const customizadas = regrasData.filter((r) => r.status_efetivo !== r.status_sistema)
              return (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Building2 className="size-4" />
                      Customizacoes da Empresa
                    </CardTitle>
                    <CardDescription className="mt-1">
                      Regras que sua empresa ajustou em relacao ao padrao do sistema. Clique
                      no X para remover uma customizacao e voltar ao padrao.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {customizadas.length === 0 ? (
                      <div className="flex items-center gap-3 rounded-lg border border-dashed px-4 py-5 text-muted-foreground">
                        <ShieldCheck className="size-4 shrink-0" />
                        <span className="text-sm">
                          Nenhuma customizacao ativa — sua empresa esta usando os padroes do
                          sistema.
                        </span>
                      </div>
                    ) : (
                      <ul className="space-y-2">
                        {customizadas.map((r) => (
                          <li
                            key={r.codigo}
                            className="flex items-center justify-between gap-3 rounded-lg border px-4 py-3"
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <Pencil className="size-3.5 text-muted-foreground shrink-0" />
                              <span className="text-sm font-medium truncate">{r.nome}</span>
                              <Badge variant="outline" className="text-xs font-mono shrink-0">
                                {r.codigo}
                              </Badge>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <span className="text-xs text-muted-foreground line-through">
                                {r.status_sistema}
                              </span>
                              <span className="text-xs text-muted-foreground">→</span>
                              <Badge variant="secondary" className="text-xs">
                                {r.status_efetivo}
                              </Badge>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="size-6 text-muted-foreground hover:text-destructive"
                                disabled={deletandoRegra === r.codigo}
                                onClick={() => handleDeletarCustomizacao(r.codigo)}
                              >
                                <X className="size-3.5" />
                              </Button>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </CardContent>
                </Card>
              )
            })()}
          </>
        )}
      </div>
    </div>
  )
}
