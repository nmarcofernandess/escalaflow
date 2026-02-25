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
  Clock,
  CalendarDays,
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
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { PageHeader } from '@/componentes/PageHeader'
import { EmptyState } from '@/componentes/EmptyState'
import { colaboradoresService } from '@/servicos/colaboradores'
import { setoresService } from '@/servicos/setores'
import { tiposContratoService } from '@/servicos/tipos-contrato'
import { excecoesService } from '@/servicos/excecoes'
import { funcoesService } from '@/servicos/funcoes'
import { useApiData } from '@/hooks/useApiData'
import { formatarData, toMinutes } from '@/lib/formatadores'
import { HorarioBarTimeline } from '@/componentes/HorarioBarTimeline'
import { toast } from 'sonner'
import type {
  Colaborador, Setor, TipoContrato, Excecao, TipoExcecao, DiaSemana, Funcao,
  RegraHorarioColaborador, RegraHorarioColaboradorExcecaoData, PerfilHorarioContrato,
  SetorHorarioSemana,
} from '@shared/index'

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
  sexo: z.enum(['M', 'F'], { message: 'Selecione o sexo' }),
  setor_id: z.string().min(1, 'Selecione o setor'),
  tipo_contrato_id: z.string().min(1, 'Selecione o tipo de contrato'),
  horas_semanais: z.coerce.number().min(1, 'Minimo 1 hora').max(44, 'Maximo 44 horas'),
  prefere_turno: z.enum(['none', 'MANHA', 'TARDE']),
  evitar_dia_semana: z.enum(['none', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB', 'DOM']),
  tipo_trabalhador: z.enum(['CLT', 'ESTAGIARIO', 'APRENDIZ']),
  funcao_id: z.string(),
})

type ColabFormInput = z.input<typeof colabSchema>
type ColabFormData = z.output<typeof colabSchema>

export function ColaboradorDetalhe() {
  const { id } = useParams<{ id: string }>()
  const colabId = parseInt(id!)
  const navigate = useNavigate()

  // Form
  const [salvando, setSalvando] = useState(false)
  const colabForm = useForm<ColabFormInput, unknown, ColabFormData>({
    resolver: zodResolver(colabSchema),
    defaultValues: {
      nome: '', sexo: 'M', setor_id: '', tipo_contrato_id: '',
      horas_semanais: 44, prefere_turno: 'none', evitar_dia_semana: 'none',
      tipo_trabalhador: 'CLT', funcao_id: 'none',
    },
  })

  // Excecao dialog state
  const [showExcecaoDialog, setShowExcecaoDialog] = useState(false)
  const [novaExcecaoTipo, setNovaExcecaoTipo] = useState<string>('FERIAS')
  const [novaExcecaoInicio, setNovaExcecaoInicio] = useState('')
  const [novaExcecaoFim, setNovaExcecaoFim] = useState('')
  const [novaExcecaoObs, setNovaExcecaoObs] = useState('')
  const [criandoExcecao, setCriandoExcecao] = useState(false)

  // Regra de horario state (v9: múltiplas regras por dia da semana)
  const [regrasHorario, setRegrasHorario] = useState<RegraHorarioColaborador[]>([])
  const [perfisHorario, setPerfisHorario] = useState<PerfilHorarioContrato[]>([])
  const [regraSalvando, setRegraSalvando] = useState(false)
  const [regraForm, setRegraForm] = useState({
    perfil_horario_id: 'none' as string,
    inicio_min: '',
    inicio_max: '',
    fim_min: '',
    fim_max: '',
    preferencia_turno_soft: 'none' as string,
    domingo_ciclo_trabalho: 2,
    domingo_ciclo_folga: 1,
    folga_fixa_dia_semana: 'none' as string,
  })

  // Regras por dia da semana (Seção B)
  type RegraDiaForm = {
    enabled: boolean
    id: number | null
    inicio_min: string
    inicio_max: string
    fim_min: string
    fim_max: string
  }
  const REGRA_DIA_DEFAULT: RegraDiaForm = { enabled: false, id: null, inicio_min: '', inicio_max: '', fim_min: '', fim_max: '' }
  const [regrasDiaForm, setRegrasDiaForm] = useState<Record<string, RegraDiaForm>>({
    SEG: { ...REGRA_DIA_DEFAULT }, TER: { ...REGRA_DIA_DEFAULT }, QUA: { ...REGRA_DIA_DEFAULT },
    QUI: { ...REGRA_DIA_DEFAULT }, SEX: { ...REGRA_DIA_DEFAULT }, SAB: { ...REGRA_DIA_DEFAULT },
    DOM: { ...REGRA_DIA_DEFAULT },
  })

  // Derivados: regra padrão
  const regraPadrao = regrasHorario.find(r => r.dia_semana_regra === null) ?? null

  // Excecoes por data
  const [excecoesPorData, setExcecoesPorData] = useState<RegraHorarioColaboradorExcecaoData[]>([])
  const [showExcDataDialog, setShowExcDataDialog] = useState(false)
  const [excDataSalvando, setExcDataSalvando] = useState(false)
  const [excDataForm, setExcDataForm] = useState({
    data: '',
    inicio_min: '',
    inicio_max: '',
    fim_min: '',
    fim_max: '',
    preferencia_turno_soft: 'none' as string,
    domingo_forcar_folga: false,
  })

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

  // Funcoes do setor (recarrega quando setor muda)
  const watchedSetorId = colabForm.watch('setor_id')
  const setorIdNum = parseInt(watchedSetorId || '0')
  const { data: funcoes } = useApiData<Funcao[]>(
    () => setorIdNum > 0 ? funcoesService.listar(setorIdNum, true) : Promise.resolve([]),
    [setorIdNum],
  )

  // Horarios por dia do setor (para eixo da timeline)
  const { data: setorHorarioSemana } = useApiData<SetorHorarioSemana[]>(
    () => setorIdNum > 0 ? setoresService.listarHorarioSemana(setorIdNum) : Promise.resolve([]),
    [setorIdNum],
  )

  const setoresList = setores ?? []
  const contratosList = tiposContrato ?? []
  const excecoesList = excecoes ?? []
  const funcoesList = funcoes ?? []

  // Derive axis from setor for timeline bars — per day, falling back to setor defaults
  const selectedSetor = setoresList.find(s => s.id === setorIdNum) ?? null
  const setorDefaultOpen = selectedSetor?.hora_abertura ?? '06:00'
  const setorDefaultClose = selectedSetor?.hora_fechamento ?? '23:00'
  const setorHorarioMap = new Map<string, SetorHorarioSemana>()
  for (const h of (setorHorarioSemana ?? [])) {
    if (h.ativo && !h.usa_padrao) setorHorarioMap.set(h.dia_semana, h)
  }
  function getAxisForDay(dia: string): { openMin: number; closeMin: number; defaultStart: string; defaultEnd: string } {
    const override = setorHorarioMap.get(dia)
    const open = override?.hora_abertura ?? setorDefaultOpen
    const close = override?.hora_fechamento ?? setorDefaultClose
    return {
      openMin: toMinutes(open),
      closeMin: toMinutes(close),
      defaultStart: open,
      defaultEnd: close,
    }
  }

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
        tipo_trabalhador: colab.tipo_trabalhador ?? 'CLT',
        funcao_id: colab.funcao_id != null ? String(colab.funcao_id) : 'none',
      })
    }
  }, [colab, colabForm])

  // Carregar regras de horario + excecoes por data
  useEffect(() => {
    if (!colabId) return
    colaboradoresService.buscarRegraHorario(colabId).then((regras) => {
      setRegrasHorario(regras)
      // Popular form da regra padrão
      const padrao = regras.find(r => r.dia_semana_regra === null)
      if (padrao) {
        setRegraForm({
          perfil_horario_id: padrao.perfil_horario_id != null ? String(padrao.perfil_horario_id) : 'none',
          inicio_min: padrao.inicio_min ?? '',
          inicio_max: padrao.inicio_max ?? '',
          fim_min: padrao.fim_min ?? '',
          fim_max: padrao.fim_max ?? '',
          preferencia_turno_soft: padrao.preferencia_turno_soft ?? 'none',
          domingo_ciclo_trabalho: padrao.domingo_ciclo_trabalho,
          domingo_ciclo_folga: padrao.domingo_ciclo_folga,
          folga_fixa_dia_semana: padrao.folga_fixa_dia_semana ?? 'none',
        })
      }
      // Popular form das regras por dia
      const diaDefaults: Record<string, RegraDiaForm> = {
        SEG: { ...REGRA_DIA_DEFAULT }, TER: { ...REGRA_DIA_DEFAULT }, QUA: { ...REGRA_DIA_DEFAULT },
        QUI: { ...REGRA_DIA_DEFAULT }, SEX: { ...REGRA_DIA_DEFAULT }, SAB: { ...REGRA_DIA_DEFAULT },
        DOM: { ...REGRA_DIA_DEFAULT },
      }
      for (const r of regras.filter(r => r.dia_semana_regra !== null)) {
        diaDefaults[r.dia_semana_regra!] = {
          enabled: true,
          id: r.id,
          inicio_min: r.inicio_min ?? '',
          inicio_max: r.inicio_max ?? '',
          fim_min: r.fim_min ?? '',
          fim_max: r.fim_max ?? '',
        }
      }
      setRegrasDiaForm(diaDefaults)
    }).catch(() => {})
    colaboradoresService.listarRegrasExcecaoData(colabId).then(setExcecoesPorData).catch(() => {})
  }, [colabId])

  // Carregar perfis do contrato selecionado
  useEffect(() => {
    const contratoId = parseInt(watchedContratoId)
    if (contratoId > 0) {
      tiposContratoService.listarPerfisHorario(contratoId).then(setPerfisHorario).catch(() => {})
    } else {
      setPerfisHorario([])
    }
  }, [watchedContratoId])

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
        tipo_trabalhador: data.tipo_trabalhador,
        funcao_id: data.funcao_id === 'none' ? null : parseInt(data.funcao_id),
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

  // --- Regra de horario handlers ---
  const handleSalvarRegra = async () => {
    setRegraSalvando(true)
    try {
      // 1. Salvar regra padrão (dia_semana_regra = null)
      const payload = {
        colaborador_id: colabId,
        dia_semana_regra: null as string | null,
        ativo: true,
        perfil_horario_id: regraForm.perfil_horario_id === 'none' ? null : parseInt(regraForm.perfil_horario_id),
        inicio_min: regraForm.inicio_min || null,
        inicio_max: regraForm.inicio_max || null,
        fim_min: regraForm.fim_min || null,
        fim_max: regraForm.fim_max || null,
        preferencia_turno_soft: regraForm.preferencia_turno_soft === 'none' ? null : regraForm.preferencia_turno_soft,
        domingo_ciclo_trabalho: regraForm.domingo_ciclo_trabalho,
        domingo_ciclo_folga: regraForm.domingo_ciclo_folga,
        folga_fixa_dia_semana: regraForm.folga_fixa_dia_semana === 'none' ? null : regraForm.folga_fixa_dia_semana,
      }
      await colaboradoresService.salvarRegraHorario(payload as any)

      // 2. Salvar/deletar regras por dia da semana
      for (const dia of DIAS_SEMANA_OPTIONS) {
        const diaForm = regrasDiaForm[dia.value]
        if (diaForm.enabled) {
          await colaboradoresService.salvarRegraHorario({
            colaborador_id: colabId,
            dia_semana_regra: dia.value as any,
            ativo: true,
            inicio_min: diaForm.inicio_min || null,
            inicio_max: diaForm.inicio_max || null,
            fim_min: diaForm.fim_min || null,
            fim_max: diaForm.fim_max || null,
          })
        } else if (diaForm.id) {
          // Toggle OFF com row no DB → deletar
          await colaboradoresService.deletarRegraHorario(diaForm.id)
        }
      }

      // 3. Reload
      const regras = await colaboradoresService.buscarRegraHorario(colabId)
      setRegrasHorario(regras)
      const diaDefaults: Record<string, RegraDiaForm> = {
        SEG: { ...REGRA_DIA_DEFAULT }, TER: { ...REGRA_DIA_DEFAULT }, QUA: { ...REGRA_DIA_DEFAULT },
        QUI: { ...REGRA_DIA_DEFAULT }, SEX: { ...REGRA_DIA_DEFAULT }, SAB: { ...REGRA_DIA_DEFAULT },
        DOM: { ...REGRA_DIA_DEFAULT },
      }
      for (const r of regras.filter(r => r.dia_semana_regra !== null)) {
        diaDefaults[r.dia_semana_regra!] = {
          enabled: true,
          id: r.id,
          inicio_min: r.inicio_min ?? '',
          inicio_max: r.inicio_max ?? '',
          fim_min: r.fim_min ?? '',
          fim_max: r.fim_max ?? '',
        }
      }
      setRegrasDiaForm(diaDefaults)

      toast.success('Regra de horario salva')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao salvar regra')
    } finally {
      setRegraSalvando(false)
    }
  }

  const handlePreencherDoPerfil = (perfilId: string) => {
    setRegraForm(f => ({ ...f, perfil_horario_id: perfilId }))
    if (perfilId !== 'none') {
      const perfil = perfisHorario.find(p => p.id === parseInt(perfilId))
      if (perfil) {
        setRegraForm(f => ({
          ...f,
          perfil_horario_id: perfilId,
          inicio_min: perfil.inicio_min,
          inicio_max: perfil.inicio_max,
          fim_min: perfil.fim_min,
          fim_max: perfil.fim_max,
          preferencia_turno_soft: perfil.preferencia_turno_soft ?? 'none',
        }))
      }
    }
  }

  const handleSalvarExcData = async () => {
    if (!excDataForm.data) return
    setExcDataSalvando(true)
    try {
      await colaboradoresService.upsertRegraExcecaoData({
        colaborador_id: colabId,
        data: excDataForm.data,
        ativo: true,
        inicio_min: excDataForm.inicio_min || null,
        inicio_max: excDataForm.inicio_max || null,
        fim_min: excDataForm.fim_min || null,
        fim_max: excDataForm.fim_max || null,
        preferencia_turno_soft: excDataForm.preferencia_turno_soft === 'none' ? null : excDataForm.preferencia_turno_soft,
        domingo_forcar_folga: excDataForm.domingo_forcar_folga,
      } as any)
      toast.success('Excecao por data salva')
      setShowExcDataDialog(false)
      setExcDataForm({ data: '', inicio_min: '', inicio_max: '', fim_min: '', fim_max: '', preferencia_turno_soft: 'none', domingo_forcar_folga: false })
      colaboradoresService.listarRegrasExcecaoData(colabId).then(setExcecoesPorData).catch(() => {})
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao salvar excecao')
    } finally {
      setExcDataSalvando(false)
    }
  }

  const handleDeletarExcData = async (excId: number) => {
    try {
      await colaboradoresService.deletarRegraExcecaoData(excId)
      toast.success('Excecao removida')
      colaboradoresService.listarRegrasExcecaoData(colabId).then(setExcecoesPorData).catch(() => {})
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao remover excecao')
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
                      <Input
                        type="number"
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
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={colabForm.control}
                  name="tipo_trabalhador"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Tipo de Trabalhador</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="CLT">CLT</SelectItem>
                          <SelectItem value="APRENDIZ">Menor Aprendiz</SelectItem>
                          <SelectItem value="ESTAGIARIO">Estagiario</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={colabForm.control}
                  name="funcao_id"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Funcao / Posto</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Sem funcao" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="none">Sem funcao definida</SelectItem>
                          {funcoesList.map((f) => (
                            <SelectItem key={f.id} value={String(f.id)}>
                              {f.apelido}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
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

        {/* Regras de Horario */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <div className="flex items-center gap-2">
              <Clock className="size-4 text-muted-foreground" />
              <CardTitle className="text-base font-semibold">
                Regras de Horario
              </CardTitle>
              {regraPadrao && (
                <Badge variant="outline" className="text-xs">Configurado</Badge>
              )}
            </div>
            <Button size="sm" onClick={handleSalvarRegra} disabled={regraSalvando}>
              <Save className="mr-1 size-3.5" />
              {regraSalvando ? 'Salvando...' : 'Salvar Regra'}
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Perfil de horario */}
            {perfisHorario.length > 0 && (
              <div className="space-y-2">
                <Label>Perfil de horario (do contrato)</Label>
                <Select
                  value={regraForm.perfil_horario_id}
                  onValueChange={handlePreencherDoPerfil}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Sem perfil" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Sem perfil (manual)</SelectItem>
                    {perfisHorario.filter(p => p.ativo).map(p => (
                      <SelectItem key={p.id} value={String(p.id)}>
                        {p.nome} ({p.inicio_min}-{p.fim_max})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[0.75rem] text-muted-foreground">
                  Selecionar um perfil preenche a janela automaticamente. Voce pode sobrescrever depois.
                </p>
              </div>
            )}

            {/* Janela de horario */}
            <div>
              <Label className="mb-2 block">Janela de horario (hard constraint)</Label>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">Inicio mais cedo</Label>
                  <Input
                    type="time"
                    value={regraForm.inicio_min}
                    onChange={e => setRegraForm(f => ({ ...f, inicio_min: e.target.value }))}
                    placeholder="07:00"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">Inicio mais tarde</Label>
                  <Input
                    type="time"
                    value={regraForm.inicio_max}
                    onChange={e => setRegraForm(f => ({ ...f, inicio_max: e.target.value }))}
                    placeholder="09:00"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">Saida mais cedo</Label>
                  <Input
                    type="time"
                    value={regraForm.fim_min}
                    onChange={e => setRegraForm(f => ({ ...f, fim_min: e.target.value }))}
                    placeholder="16:00"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">Saida mais tarde</Label>
                  <Input
                    type="time"
                    value={regraForm.fim_max}
                    onChange={e => setRegraForm(f => ({ ...f, fim_max: e.target.value }))}
                    placeholder="18:00"
                  />
                </div>
              </div>
              <p className="mt-1 text-[0.75rem] text-muted-foreground">
                Se inicio_min = inicio_max, o motor forca horario fixo. Deixe vazio para sem restricao.
              </p>
            </div>

            {/* Ciclo domingo + Folga fixa + Turno */}
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label className="text-xs">Ciclo domingo (trabalho/folga)</Label>
                <div className="flex items-center gap-1">
                  <Input
                    type="number"
                    min={1}
                    max={6}
                    className="w-16"
                    value={regraForm.domingo_ciclo_trabalho}
                    onChange={e => setRegraForm(f => ({ ...f, domingo_ciclo_trabalho: parseInt(e.target.value) || 2 }))}
                  />
                  <span className="text-xs text-muted-foreground">/</span>
                  <Input
                    type="number"
                    min={1}
                    max={4}
                    className="w-16"
                    value={regraForm.domingo_ciclo_folga}
                    onChange={e => setRegraForm(f => ({ ...f, domingo_ciclo_folga: parseInt(e.target.value) || 1 }))}
                  />
                </div>
                <p className="text-[0.7rem] text-muted-foreground">
                  Ex: 2/1 = trabalha 2 dom, folga 1
                </p>
              </div>
              <div className="space-y-2">
                <Label className="text-xs">Folga fixa (5x2)</Label>
                <Select
                  value={regraForm.folga_fixa_dia_semana}
                  onValueChange={v => setRegraForm(f => ({ ...f, folga_fixa_dia_semana: v }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Sem folga fixa</SelectItem>
                    {DIAS_SEMANA_OPTIONS.map(d => (
                      <SelectItem key={d.value} value={d.value}>
                        {d.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="text-xs">Pref. turno (regra)</Label>
                <Select
                  value={regraForm.preferencia_turno_soft}
                  onValueChange={v => setRegraForm(f => ({ ...f, preferencia_turno_soft: v }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Sem preferencia</SelectItem>
                    <SelectItem value="MANHA">Manha</SelectItem>
                    <SelectItem value="TARDE">Tarde</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Seção B — Horários por Dia da Semana (Timeline Bars) */}
            <div className="border-t pt-4">
              <div className="mb-3">
                <Label className="text-sm font-medium">Horarios por dia da semana</Label>
                <p className="text-[0.75rem] text-muted-foreground">
                  Ative um dia e arraste a barra para definir horario especifico.
                </p>
              </div>
              <div className="space-y-2">
                {DIAS_SEMANA_OPTIONS.map(dia => {
                  const diaForm = regrasDiaForm[dia.value]
                  const axis = getAxisForDay(dia.value)
                  return (
                    <div key={dia.value} className="flex items-center gap-3">
                      <Switch
                        checked={diaForm.enabled}
                        onCheckedChange={(checked) => {
                          const dayAxis = getAxisForDay(dia.value)
                          setRegrasDiaForm(prev => ({
                            ...prev,
                            [dia.value]: {
                              ...prev[dia.value],
                              enabled: checked,
                              ...(checked
                                ? {
                                    inicio_min: prev[dia.value].inicio_min || dayAxis.defaultStart,
                                    inicio_max: prev[dia.value].inicio_max || dayAxis.defaultStart,
                                    fim_min: prev[dia.value].fim_min || dayAxis.defaultEnd,
                                    fim_max: prev[dia.value].fim_max || dayAxis.defaultEnd,
                                  }
                                : { inicio_min: '', inicio_max: '', fim_min: '', fim_max: '' }),
                            },
                          }))
                        }}
                      />
                      <span className="w-10 shrink-0 text-sm font-medium">{dia.value}</span>
                      {diaForm.enabled ? (
                        <div className="flex-1 pt-4">
                          <HorarioBarTimeline
                            startTime={diaForm.inicio_min || axis.defaultStart}
                            endTime={diaForm.fim_max || axis.defaultEnd}
                            axisOpenMin={axis.openMin}
                            axisCloseMin={axis.closeMin}
                            onChange={(start, end) => {
                              setRegrasDiaForm(prev => ({
                                ...prev,
                                [dia.value]: {
                                  ...prev[dia.value],
                                  inicio_min: start,
                                  inicio_max: start,
                                  fim_min: end,
                                  fim_max: end,
                                },
                              }))
                            }}
                          />
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">Usando padrao</span>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Excecoes por Data */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <div className="flex items-center gap-2">
              <CalendarDays className="size-4 text-muted-foreground" />
              <CardTitle className="text-base font-semibold">
                Excecoes por Data
              </CardTitle>
            </div>
            <Button variant="outline" size="sm" onClick={() => {
              setExcDataForm({ data: '', inicio_min: '', inicio_max: '', fim_min: '', fim_max: '', preferencia_turno_soft: 'none', domingo_forcar_folga: false })
              setShowExcDataDialog(true)
            }}>
              <Plus className="mr-1 size-3.5" /> Nova Excecao
            </Button>
          </CardHeader>
          <CardContent>
            {excecoesPorData.length === 0 ? (
              <EmptyState
                icon={CalendarDays}
                title="Nenhuma excecao por data"
                description="Sobrescreva horario ou force folga em datas especificas"
              />
            ) : (
              <div className="space-y-2">
                {excecoesPorData.map(exc => (
                  <div key={exc.id} className="flex items-center justify-between rounded-lg border p-3">
                    <div>
                      <span className="text-sm font-medium">{formatarData(exc.data)}</span>
                      <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                        {exc.domingo_forcar_folga && (
                          <Badge variant="destructive" className="text-[0.65rem]">Folga forcada</Badge>
                        )}
                        {exc.inicio_min && <span>Inicio: {exc.inicio_min}-{exc.inicio_max}</span>}
                        {exc.fim_min && <span>Saida: {exc.fim_min}-{exc.fim_max}</span>}
                        {exc.preferencia_turno_soft && <span>Turno: {exc.preferencia_turno_soft}</span>}
                      </div>
                    </div>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive">
                          <Trash2 className="size-3.5" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Remover excecao?</AlertDialogTitle>
                          <AlertDialogDescription>
                            A excecao de {formatarData(exc.data)} sera removida.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancelar</AlertDialogCancel>
                          <AlertDialogAction onClick={() => handleDeletarExcData(exc.id)}>Remover</AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

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

      {/* Excecao por Data Dialog */}
      <Dialog open={showExcDataDialog} onOpenChange={setShowExcDataDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Excecao por Data</DialogTitle>
            <DialogDescription>
              Sobrescreva horario ou force folga em uma data especifica.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Data</Label>
              <Input
                type="date"
                value={excDataForm.data}
                onChange={e => setExcDataForm(f => ({ ...f, data: e.target.value }))}
              />
            </div>
            <div className="flex items-center gap-3">
              <Switch
                checked={excDataForm.domingo_forcar_folga}
                onCheckedChange={v => setExcDataForm(f => ({ ...f, domingo_forcar_folga: v }))}
              />
              <Label>Forcar folga neste dia</Label>
            </div>
            {!excDataForm.domingo_forcar_folga && (
              <>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">Inicio mais cedo</Label>
                    <Input
                      type="time"
                      value={excDataForm.inicio_min}
                      onChange={e => setExcDataForm(f => ({ ...f, inicio_min: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">Inicio mais tarde</Label>
                    <Input
                      type="time"
                      value={excDataForm.inicio_max}
                      onChange={e => setExcDataForm(f => ({ ...f, inicio_max: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">Saida mais cedo</Label>
                    <Input
                      type="time"
                      value={excDataForm.fim_min}
                      onChange={e => setExcDataForm(f => ({ ...f, fim_min: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">Saida mais tarde</Label>
                    <Input
                      type="time"
                      value={excDataForm.fim_max}
                      onChange={e => setExcDataForm(f => ({ ...f, fim_max: e.target.value }))}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label className="text-xs">Turno preferido</Label>
                  <Select
                    value={excDataForm.preferencia_turno_soft}
                    onValueChange={v => setExcDataForm(f => ({ ...f, preferencia_turno_soft: v }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Sem preferencia</SelectItem>
                      <SelectItem value="MANHA">Manha</SelectItem>
                      <SelectItem value="TARDE">Tarde</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowExcDataDialog(false)}>Cancelar</Button>
            <Button onClick={handleSalvarExcData} disabled={excDataSalvando || !excDataForm.data}>
              {excDataSalvando ? 'Salvando...' : 'Salvar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
