import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import {
  Save,
  Plus,
  Trash2,
  Palmtree,
  Stethoscope,
  Ban,
  Archive,
} from 'lucide-react'
import { CORES_EXCECAO } from '@/lib/cores'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from '@/components/ui/form'
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { PageHeader } from '@/componentes/PageHeader'
import { EmptyState } from '@/componentes/EmptyState'
import { colaboradoresService } from '@/servicos/colaboradores'
import { setoresService } from '@/servicos/setores'
import { tiposContratoService } from '@/servicos/tipos-contrato'
import { excecoesService } from '@/servicos/excecoes'
import { useApiData } from '@/hooks/useApiData'
import { formatarData } from '@/lib/formatadores'
import { toast } from 'sonner'
import type { Colaborador, Setor, TipoContrato, Excecao, TipoExcecao, DiaSemana } from '@shared/index'

const DIAS_SEMANA_OPTIONS = [
  { value: 'SEG', label: 'Segunda' },
  { value: 'TER', label: 'Terca' },
  { value: 'QUA', label: 'Quarta' },
  { value: 'QUI', label: 'Quinta' },
  { value: 'SEX', label: 'Sexta' },
  { value: 'SAB', label: 'Sabado' },
  { value: 'DOM', label: 'Domingo' },
]

function ExcecaoIcon({ tipo }: { tipo: string }) {
  switch (tipo) {
    case 'FERIAS':
      return <Palmtree className={`size-4 ${CORES_EXCECAO.FERIAS}`} />
    case 'ATESTADO':
      return <Stethoscope className={`size-4 ${CORES_EXCECAO.ATESTADO}`} />
    case 'BLOQUEIO':
      return <Ban className={`size-4 ${CORES_EXCECAO.BLOQUEIO}`} />
    default:
      return null
  }
}

const colabSchema = z.object({
  nome: z.string().min(2, 'Nome deve ter ao menos 2 caracteres'),
  sexo: z.string().min(1, 'Selecione o sexo'),
  setor_id: z.string().min(1, 'Selecione o setor'),
  tipo_contrato_id: z.string().min(1, 'Selecione o tipo de contrato'),
  horas_semanais: z.coerce.number().min(1, 'Minimo 1 hora').max(44, 'Maximo 44 horas'),
  prefere_turno: z.string(),
  evitar_dia_semana: z.string(),
})

type ColabFormData = z.infer<typeof colabSchema>

export function ColaboradorDetalhe() {
  const { id } = useParams<{ id: string }>()
  const colabId = parseInt(id!)
  const navigate = useNavigate()

  // Form
  const [salvando, setSalvando] = useState(false)
  const colabForm = useForm<ColabFormData>({
    resolver: zodResolver(colabSchema),
    defaultValues: {
      nome: '', sexo: '', setor_id: '', tipo_contrato_id: '',
      horas_semanais: 44, prefere_turno: 'none', evitar_dia_semana: 'none',
    },
  })

  // Excecao dialog state
  const [showExcecaoDialog, setShowExcecaoDialog] = useState(false)
  const [novaExcecaoTipo, setNovaExcecaoTipo] = useState<string>('FERIAS')
  const [novaExcecaoInicio, setNovaExcecaoInicio] = useState('')
  const [novaExcecaoFim, setNovaExcecaoFim] = useState('')
  const [novaExcecaoObs, setNovaExcecaoObs] = useState('')
  const [criandoExcecao, setCriandoExcecao] = useState(false)

  // Data loading
  const { data: colab, loading: loadingColab } = useApiData<Colaborador>(
    () => colaboradoresService.buscar(colabId),
    [colabId],
  )

  const { data: setores } = useApiData<Setor[]>(
    () => setoresService.listar(true),
    [],
  )

  const { data: tiposContrato } = useApiData<TipoContrato[]>(
    () => tiposContratoService.listar(),
    [],
  )

  const { data: excecoes, reload: reloadExcecoes } = useApiData<Excecao[]>(
    () => excecoesService.listar(colabId),
    [colabId],
  )

  const setoresList = setores ?? []
  const contratosList = tiposContrato ?? []
  const excecoesList = excecoes ?? []

  // Find selected contrato for template info
  const watchedContratoId = colabForm.watch('tipo_contrato_id')
  const selectedContrato = contratosList.find((tc) => tc.id === parseInt(watchedContratoId))

  // Sync form state from colaborador data
  useEffect(() => {
    if (colab) {
      colabForm.reset({
        nome: colab.nome,
        sexo: colab.sexo,
        setor_id: String(colab.setor_id),
        tipo_contrato_id: String(colab.tipo_contrato_id),
        horas_semanais: colab.horas_semanais,
        prefere_turno: colab.prefere_turno ?? 'none',
        evitar_dia_semana: colab.evitar_dia_semana ?? 'none',
      })
    }
  }, [colab, colabForm])

  const handleSalvar = async (data: ColabFormData) => {
    setSalvando(true)
    try {
      await colaboradoresService.atualizar(colabId, {
        nome: data.nome.trim(),
        sexo: data.sexo as 'M' | 'F',
        setor_id: parseInt(data.setor_id),
        tipo_contrato_id: parseInt(data.tipo_contrato_id),
        horas_semanais: data.horas_semanais,
        prefere_turno: data.prefere_turno === 'none' ? null : data.prefere_turno as 'MANHA' | 'TARDE',
        evitar_dia_semana: data.evitar_dia_semana === 'none' ? null : data.evitar_dia_semana as DiaSemana,
      })
      toast.success('Colaborador salvo')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao salvar colaborador')
    } finally {
      setSalvando(false)
    }
  }

  const handleCriarExcecao = async () => {
    if (!novaExcecaoInicio || !novaExcecaoFim) return
    setCriandoExcecao(true)
    try {
      await excecoesService.criar(colabId, {
        tipo: novaExcecaoTipo as TipoExcecao,
        data_inicio: novaExcecaoInicio,
        data_fim: novaExcecaoFim,
        observacao: novaExcecaoObs.trim() || null,
      })
      toast.success('Excecao criada')
      setShowExcecaoDialog(false)
      setNovaExcecaoTipo('FERIAS')
      setNovaExcecaoInicio('')
      setNovaExcecaoFim('')
      setNovaExcecaoObs('')
      reloadExcecoes()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao criar excecao')
    } finally {
      setCriandoExcecao(false)
    }
  }

  const handleDeletarExcecao = async (excecaoId: number) => {
    try {
      await excecoesService.deletar(excecaoId)
      toast.success('Excecao removida')
      reloadExcecoes()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao remover excecao')
    }
  }

  const handleArquivar = async () => {
    try {
      await colaboradoresService.atualizar(colabId, { ativo: false })
      toast.success('Colaborador arquivado')
      navigate('/colaboradores')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao arquivar colaborador')
    }
  }

  if (loadingColab) {
    return (
      <div className="flex flex-1 flex-col">
        <PageHeader breadcrumbs={[{ label: 'Dashboard', href: '/' }, { label: 'Colaboradores', href: '/colaboradores' }, { label: '...' }]} />
        <div className="flex flex-1 items-center justify-center">
          <p className="text-sm text-muted-foreground">Carregando...</p>
        </div>
      </div>
    )
  }

  if (!colab) {
    return (
      <div className="flex flex-1 flex-col">
        <PageHeader breadcrumbs={[{ label: 'Dashboard', href: '/' }, { label: 'Colaboradores', href: '/colaboradores' }, { label: 'Nao encontrado' }]} />
        <div className="flex flex-1 items-center justify-center">
          <p className="text-sm text-muted-foreground">Colaborador nao encontrado</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader
        breadcrumbs={[
          { label: 'Dashboard', href: '/' },
          { label: 'Colaboradores', href: '/colaboradores' },
          { label: colab.nome },
        ]}
        actions={
          <div className="flex items-center gap-2">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" size="sm" className="text-destructive hover:bg-destructive/5">
                  <Archive className="mr-1 size-3.5" />
                  Arquivar
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Arquivar colaborador?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Ao arquivar {colab.nome}, ele nao sera incluido em novas escalas.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                  <AlertDialogAction onClick={handleArquivar}>Arquivar</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            <Button size="sm" onClick={colabForm.handleSubmit(handleSalvar)} disabled={salvando}>
              <Save className="mr-1 size-3.5" />
              {salvando ? 'Salvando...' : 'Salvar'}
            </Button>
          </div>
        }
      />

      <div className="flex-1 space-y-6 p-6">
        <Form {...colabForm}>
          {/* Info basica */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold">
                Informacoes Pessoais
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormField
                control={colabForm.control}
                name="nome"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nome completo</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={colabForm.control}
                  name="sexo"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Sexo</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue />
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
                  control={colabForm.control}
                  name="setor_id"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Setor</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue />
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
            </CardContent>
          </Card>

          {/* Contrato */}
          <Card className="mt-6">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold">Contrato</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormField
                control={colabForm.control}
                name="tipo_contrato_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Tipo de Contrato</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
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
              <FormField
                control={colabForm.control}
                name="horas_semanais"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      Horas Semanais{' '}
                      <span className="text-xs font-normal text-muted-foreground">
                        (auto do template, editavel por pessoa)
                      </span>
                    </FormLabel>
                    <FormControl>
                      <Input type="number" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {selectedContrato && (
                <div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
                  Template:{' '}
                  <strong>{selectedContrato.nome}</strong> | {selectedContrato.dias_trabalho} dias/semana |
                  Max {selectedContrato.max_minutos_dia}min/dia |
                  Domingo: {selectedContrato.trabalha_domingo ? 'Sim' : 'Nao'}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Preferencias */}
          <Card className="mt-6">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold">
                Preferencias{' '}
                <span className="text-xs font-normal text-muted-foreground">
                  (soft constraints - motor tenta respeitar)
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={colabForm.control}
                  name="prefere_turno"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Prefere turno</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="none">Sem preferencia</SelectItem>
                          <SelectItem value="MANHA">Manha</SelectItem>
                          <SelectItem value="TARDE">Tarde</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={colabForm.control}
                  name="evitar_dia_semana"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Evitar dia da semana</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="none">Sem preferencia</SelectItem>
                          {DIAS_SEMANA_OPTIONS.map((d) => (
                            <SelectItem key={d.value} value={d.value}>
                              {d.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <p className="text-[0.8rem] text-muted-foreground">
                O motor de escala tenta respeitar essas preferencias, mas nao
                garante. Se nao conseguir, aparece como alerta amarelo na escala.
              </p>
            </CardContent>
          </Card>
        </Form>

        {/* Excecoes */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-base font-semibold">
              Excecoes
            </CardTitle>
            <Button variant="outline" size="sm" onClick={() => setShowExcecaoDialog(true)}>
              <Plus className="mr-1 size-3.5" /> Nova Excecao
            </Button>
          </CardHeader>
          <CardContent>
            {excecoesList.length === 0 ? (
              <EmptyState
                icon={Archive}
                title="Nenhuma excecao ativa"
                description="Ferias, atestados e bloqueios aparecem aqui"
              />
            ) : (
              <div className="space-y-2">
                {excecoesList.map((exc) => (
                  <div
                    key={exc.id}
                    className="flex items-center justify-between rounded-lg border p-3"
                  >
                    <div className="flex items-center gap-3">
                      <ExcecaoIcon tipo={exc.tipo} />
                      <div>
                        <span className="text-sm font-medium text-foreground">
                          {exc.tipo}
                        </span>
                        <p className="text-xs text-muted-foreground">
                          {formatarData(exc.data_inicio)} a {formatarData(exc.data_fim)}
                          {exc.observacao && ` - ${exc.observacao}`}
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-1">
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-destructive"
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Remover excecao?</AlertDialogTitle>
                            <AlertDialogDescription>
                              A excecao de {exc.tipo.toLowerCase()} ({formatarData(exc.data_inicio)} a {formatarData(exc.data_fim)}) sera removida.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancelar</AlertDialogCancel>
                            <AlertDialogAction onClick={() => handleDeletarExcecao(exc.id)}>
                              Remover
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

      </div>

      {/* Nova Excecao Dialog */}
      <Dialog open={showExcecaoDialog} onOpenChange={setShowExcecaoDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Nova Excecao</DialogTitle>
            <DialogDescription>
              Registre uma excecao (ferias, atestado ou bloqueio).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Tipo</Label>
              <Select value={novaExcecaoTipo} onValueChange={setNovaExcecaoTipo}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="FERIAS">Ferias</SelectItem>
                  <SelectItem value="ATESTADO">Atestado</SelectItem>
                  <SelectItem value="BLOQUEIO">Bloqueio</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Data inicio</Label>
                <Input
                  type="date"
                  value={novaExcecaoInicio}
                  onChange={(e) => setNovaExcecaoInicio(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Data fim</Label>
                <Input
                  type="date"
                  value={novaExcecaoFim}
                  onChange={(e) => setNovaExcecaoFim(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Observacao (opcional)</Label>
              <Input
                placeholder="Ex: ferias coletivas"
                value={novaExcecaoObs}
                onChange={(e) => setNovaExcecaoObs(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowExcecaoDialog(false)}>
              Cancelar
            </Button>
            <Button
              onClick={handleCriarExcecao}
              disabled={criandoExcecao || !novaExcecaoInicio || !novaExcecaoFim}
            >
              {criandoExcecao ? 'Criando...' : 'Criar Excecao'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
