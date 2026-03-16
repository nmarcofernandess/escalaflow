import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useRestorePreview } from '@/hooks/useRestorePreview'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import {
  Plus,
  Trash2,
  Palmtree,
  Stethoscope,
  Ban,
  Archive,
  Clock,
  CalendarDays,
  Save,
  Check,
  Loader2,
  Download,
} from 'lucide-react'
import { CORES_EXCECAO } from '@/lib/cores'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Separator } from '@/components/ui/separator'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
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
// SaveIndicator removido — save via botao principal
// useAutoSave removido — save via botao principal
import { EmptyState } from '@/componentes/EmptyState'
import { useExportFuncionario } from '@/hooks/useExportFuncionario'
import { ExportModal } from '@/componentes/ExportModal'
import { ExportarEscala } from '@/componentes/ExportarEscala'
import { buildStandaloneHtml } from '@/lib/export-standalone-html'
import { exportarService } from '@/servicos/exportar'
import { colaboradoresService } from '@/servicos/colaboradores'
import { setoresService } from '@/servicos/setores'
import { tiposContratoService } from '@/servicos/tipos-contrato'
import { excecoesService } from '@/servicos/excecoes'
import { funcoesService } from '@/servicos/funcoes'
import { useApiData } from '@/hooks/useApiData'
import { formatarData } from '@/lib/formatadores'
import { toast } from 'sonner'
import type {
  Colaborador, Setor, TipoContrato, Excecao, TipoExcecao, DiaSemana, Funcao,
  RegraHorarioColaborador, RegraHorarioColaboradorExcecaoData, PerfilHorarioContrato,
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

type TipoRestricao = 'nenhum' | 'entrada' | 'saida'

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

// Helper: converte tipo_restricao + horario -> { inicio, fim }
function restricaoParaInicioFim(tipo_restricao: TipoRestricao, horario: string): { inicio: string | null; fim: string | null } {
  if (tipo_restricao === 'entrada') return { inicio: horario || null, fim: null }
  if (tipo_restricao === 'saida') return { inicio: null, fim: horario || null }
  return { inicio: null, fim: null }
}

// Helper: converte inicio/fim -> tipo_restricao + horario
function inicioFimParaRestricao(inicio: string | null, fim: string | null): { tipo_restricao: TipoRestricao; horario: string } {
  if (inicio) return { tipo_restricao: 'entrada', horario: inicio }
  if (fim) return { tipo_restricao: 'saida', horario: fim }
  return { tipo_restricao: 'nenhum', horario: '' }
}

function derivarTipoTrabalhadorPorContrato(nomeContrato?: string): 'CLT' | 'ESTAGIARIO' | 'INTERMITENTE' {
  if (!nomeContrato) return 'CLT'
  const normalizado = nomeContrato
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()

  if (normalizado.includes('estagi')) return 'ESTAGIARIO'
  if (normalizado.includes('intermit')) return 'INTERMITENTE'
  return 'CLT'
}

// Componente inline de Radio para tipo de restricao
function RestricaoRadio({
  value,
  onChange,
  horario,
  onHorarioChange,
  onHorarioBlur,
  showNenhum = true,
}: {
  value: TipoRestricao
  onChange: (v: TipoRestricao) => void
  horario: string
  onHorarioChange: (v: string) => void
  onHorarioBlur?: () => void
  showNenhum?: boolean
}) {
  const opcoes = [
    ...(showNenhum ? [{ v: 'nenhum' as TipoRestricao, label: 'Sem restricao' }] : []),
    { v: 'entrada' as TipoRestricao, label: 'Entrada fixa' },
    { v: 'saida' as TipoRestricao, label: 'Saida maxima' },
  ]
  return (
    <div className="space-y-3">
      <RadioGroup value={value} onValueChange={(v) => onChange(v as TipoRestricao)} className="flex gap-4">
        {opcoes.map(opt => (
          <div key={opt.v} className="flex items-center gap-1.5">
            <RadioGroupItem value={opt.v} id={`restricao-${opt.v}`} />
            <Label htmlFor={`restricao-${opt.v}`} className="text-sm cursor-pointer">{opt.label}</Label>
          </div>
        ))}
      </RadioGroup>
      {value !== 'nenhum' && (
        <Input
          type="time"
          value={horario}
          onChange={e => onHorarioChange(e.target.value)}
          onBlur={onHorarioBlur}
          className="w-36"
        />
      )}
    </div>
  )
}

const colabSchema = z.object({
  nome: z.string().min(2, 'Nome deve ter ao menos 2 caracteres'),
  sexo: z.enum(['M', 'F'], { message: 'Selecione o sexo' }),
  setor_id: z.string().min(1, 'Selecione o setor'),
  tipo_contrato_id: z.string().min(1, 'Selecione o tipo de contrato'),
  horas_semanais: z.coerce.number().min(1, 'Minimo 1 hora').max(44, 'Maximo 44 horas'),
  prefere_turno: z.enum(['none', 'MANHA', 'TARDE']),
  evitar_dia_semana: z.enum(['none', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB', 'DOM']),
  tipo_trabalhador: z.enum(['CLT', 'ESTAGIARIO', 'INTERMITENTE']),
  funcao_id: z.string(),
})

type ColabFormInput = z.input<typeof colabSchema>
type ColabFormData = z.output<typeof colabSchema>

type RegraDiaForm = {
  enabled: boolean
  id: number | null
  tipo_restricao: TipoRestricao
  horario: string
  horario_fim: string // saída (usado por intermitente — entrada + saída obrigatórias)
}

function getDefaultRegraForm() {
  return {
    perfil_horario_id: 'none',
    tipo_restricao: 'nenhum' as TipoRestricao,
    horario: '',
    preferencia_turno_soft: 'none',
    folga_fixa_dia_semana: 'none',
    folga_variavel_dia_semana: 'none',
  }
}

function getDefaultRegrasDiaForm(): Record<string, RegraDiaForm> {
  return {
    SEG: { enabled: false, id: null, tipo_restricao: 'nenhum', horario: '', horario_fim: '' },
    TER: { enabled: false, id: null, tipo_restricao: 'nenhum', horario: '', horario_fim: '' },
    QUA: { enabled: false, id: null, tipo_restricao: 'nenhum', horario: '', horario_fim: '' },
    QUI: { enabled: false, id: null, tipo_restricao: 'nenhum', horario: '', horario_fim: '' },
    SEX: { enabled: false, id: null, tipo_restricao: 'nenhum', horario: '', horario_fim: '' },
    SAB: { enabled: false, id: null, tipo_restricao: 'nenhum', horario: '', horario_fim: '' },
    DOM: { enabled: false, id: null, tipo_restricao: 'nenhum', horario: '', horario_fim: '' },
  }
}

function buildRegraFormFromRegras(regras: RegraHorarioColaborador[]) {
  const padrao = regras.find(r => r.dia_semana_regra === null)
  if (!padrao) return getDefaultRegraForm()

  const { tipo_restricao, horario } = inicioFimParaRestricao(padrao.inicio, padrao.fim)
  return {
    perfil_horario_id: padrao.perfil_horario_id != null ? String(padrao.perfil_horario_id) : 'none',
    tipo_restricao,
    horario,
    preferencia_turno_soft: padrao.preferencia_turno_soft ?? 'none',
    folga_fixa_dia_semana: padrao.folga_fixa_dia_semana ?? 'none',
    folga_variavel_dia_semana: padrao.folga_variavel_dia_semana ?? 'none',
  }
}

function buildRegrasDiaFormFromRegras(regras: RegraHorarioColaborador[]): Record<string, RegraDiaForm> {
  const diaDefaults = getDefaultRegrasDiaForm()

  for (const r of regras.filter(r => r.dia_semana_regra !== null)) {
    const { tipo_restricao, horario } = inicioFimParaRestricao(r.inicio, r.fim)
    diaDefaults[r.dia_semana_regra!] = {
      enabled: true,
      id: r.id,
      // Se inicio e fim ambos null, RestricaoRadio com showNenhum=false nao mostra nenhum radio selecionado
      tipo_restricao: tipo_restricao === 'nenhum' ? 'entrada' : tipo_restricao,
      horario,
      horario_fim: r.fim ?? '',
    }
  }

  return diaDefaults
}

export function ColaboradorDetalhe() {
  const { id } = useParams<{ id: string }>()
  const colabId = parseInt(id!)
  const navigate = useNavigate()
  const { isPreviewMode } = useRestorePreview()

  // Form
  const colabForm = useForm<ColabFormInput, unknown, ColabFormData>({
    resolver: zodResolver(colabSchema),
    defaultValues: {
      nome: '', sexo: '' as 'M' | 'F', setor_id: '', tipo_contrato_id: '',
      horas_semanais: 44, prefere_turno: 'none', evitar_dia_semana: 'none',
      tipo_trabalhador: 'CLT', funcao_id: 'none',
    },
  })

  // Setor change guard
  const [pendingSetorId, setPendingSetorId] = useState<string | null>(null)

  // Excecao dialog state
  const [showExcecaoDialog, setShowExcecaoDialog] = useState(false)
  const [novaExcecaoTipo, setNovaExcecaoTipo] = useState<string>('FERIAS')
  const [novaExcecaoInicio, setNovaExcecaoInicio] = useState('')
  const [novaExcecaoFim, setNovaExcecaoFim] = useState('')
  const [novaExcecaoObs, setNovaExcecaoObs] = useState('')
  const [criandoExcecao, setCriandoExcecao] = useState(false)

  // Seccao A: Regra padrao state
  const [regrasHorario, setRegrasHorario] = useState<RegraHorarioColaborador[]>([])
  const [perfisHorario, setPerfisHorario] = useState<PerfilHorarioContrato[]>([])
  const [regraSalvando, setRegraSalvando] = useState(false)
  const [regraForm, setRegraForm] = useState(getDefaultRegraForm)

  // Seccao B: Regras por dia da semana
  const [regrasDiaForm, setRegrasDiaForm] = useState<Record<string, RegraDiaForm>>(getDefaultRegrasDiaForm)

  // Refs para closures estáveis (evita stale state em callbacks async)
  const regraFormRef = useRef(regraForm)
  regraFormRef.current = regraForm
  const regrasDiaFormRef = useRef(regrasDiaForm)
  regrasDiaFormRef.current = regrasDiaForm

  // Derivados: regra padrao
  const regraPadrao = regrasHorario.find(r => r.dia_semana_regra === null) ?? null

  // Seccao C: Excecoes por data
  const [excecoesPorData, setExcecoesPorData] = useState<RegraHorarioColaboradorExcecaoData[]>([])
  const [showExcDataDialog, setShowExcDataDialog] = useState(false)
  const [excDataSalvando, setExcDataSalvando] = useState(false)
  const [excDataForm, setExcDataForm] = useState({
    data: '',
    tipo_restricao: 'nenhum' as TipoRestricao,
    horario: '',
    preferencia_turno_soft: 'none' as string,
    domingo_forcar_folga: false,
  })

  // Export state
  const [exportOpen, setExportOpen] = useState(false)
  const { loading: exportLoading, data: exportData, hasOficial, verificar: verificarExport, carregar: carregarExport } = useExportFuncionario()

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

  const setoresList = setores ?? []
  const contratosList = tiposContrato ?? []
  const excecoesList = excecoes ?? []
  const funcoesList = funcoes ?? []

  // Find selected contrato for template info
  const watchedContratoId = colabForm.watch('tipo_contrato_id')
  const selectedContrato = contratosList.find((tc) => tc.id === parseInt(watchedContratoId))
  const isIntermitente = derivarTipoTrabalhadorPorContrato(selectedContrato?.nome) === 'INTERMITENTE'

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

  // Check if setor has OFICIAL escala (for export button visibility)
  useEffect(() => {
    if (colab) verificarExport(colab.setor_id)
  }, [colab, verificarExport])

  // Carregar regras de horario + excecoes por data
  useEffect(() => {
    if (!colabId) return
    colaboradoresService.buscarRegraHorario(colabId).then((regras) => {
      setRegrasHorario(regras)
      setRegraForm(buildRegraFormFromRegras(regras))
      setRegrasDiaForm(buildRegrasDiaFormFromRegras(regras))
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

  // ─── Salvar tudo — declarado abaixo de saveRegraPadrao / saveDiaRegra ──────
  const [salvandoTudo, setSalvandoTudo] = useState(false)
  const isDirty = colabForm.formState.isDirty

  const saveColabField = useCallback(async (fields: Record<string, unknown>) => {
    await colaboradoresService.atualizar(colabId, fields)
  }, [colabId])

  const handleConfirmSetorChange = useCallback(async () => {
    if (!pendingSetorId) return
    try {
      await saveColabField({ setor_id: parseInt(pendingSetorId) })
      colabForm.setValue('setor_id', pendingSetorId)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao mover colaborador')
      colabForm.setValue('setor_id', String(colab?.setor_id ?? ''))
    }
    setPendingSetorId(null)
  }, [pendingSetorId, saveColabField, colabForm, colab?.setor_id])

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

  // Regra de horario: auto-save
  // reloadRegras: atualiza regrasHorario e merge IDs nos dia forms — NUNCA sobrescreve form state
  const reloadRegras = useCallback(async () => {
    const regras = await colaboradoresService.buscarRegraHorario(colabId)
    setRegrasHorario(regras)
    // Merge apenas IDs — não sobrescreve valores que o usuário editou
    setRegrasDiaForm(prev => {
      const updated = { ...prev }
      for (const r of regras.filter(r => r.dia_semana_regra !== null)) {
        const dia = r.dia_semana_regra!
        if (updated[dia]) {
          updated[dia] = { ...updated[dia], id: r.id }
        }
      }
      for (const dia of Object.keys(updated)) {
        if (!regras.find(r => r.dia_semana_regra === dia)) {
          updated[dia] = { ...updated[dia], id: null }
        }
      }
      return updated
    })
  }, [colabId])

  const saveRegraPadrao = useCallback(async (overrides?: Partial<typeof regraForm>) => {
    const current = { ...regraFormRef.current, ...overrides }
    const { inicio, fim } = restricaoParaInicioFim(current.tipo_restricao, current.horario)
    await colaboradoresService.salvarRegraHorario({
      colaborador_id: colabId,
      dia_semana_regra: null as string | null,
      ativo: true,
      perfil_horario_id: current.perfil_horario_id === 'none' ? null : parseInt(current.perfil_horario_id),
      inicio,
      fim,
      preferencia_turno_soft: current.preferencia_turno_soft === 'none' ? null : current.preferencia_turno_soft,
      folga_fixa_dia_semana: current.folga_fixa_dia_semana === 'none' ? null : current.folga_fixa_dia_semana,
      folga_variavel_dia_semana: current.folga_variavel_dia_semana === 'none' ? null : current.folga_variavel_dia_semana,
    } as any)
    // Sem reloadRegras — state local é a verdade, reload causava flicker
  }, [colabId])

  // autoSaveRegra removido — tudo salva pelo botao principal

  const saveDiaRegra = useCallback(async (dia: string, overrideDiaForm?: RegraDiaForm, intermitente = false) => {
    const diaForm = overrideDiaForm ?? regrasDiaFormRef.current[dia]
    let needsIdRefresh = false
    if (diaForm.enabled) {
      // Intermitente: usa horario (entrada) + horario_fim (saída) diretamente
      // CLT: deriva inicio/fim do radio (entrada fixa OU saída máxima)
      const inicio = intermitente ? (diaForm.horario || null) : restricaoParaInicioFim(diaForm.tipo_restricao, diaForm.horario).inicio
      const fim = intermitente ? (diaForm.horario_fim || null) : restricaoParaInicioFim(diaForm.tipo_restricao, diaForm.horario).fim
      if (!inicio && !fim) {
        if (diaForm.id) {
          await colaboradoresService.deletarRegraHorario(diaForm.id)
          needsIdRefresh = true
        }
      } else {
        await colaboradoresService.salvarRegraHorario({
          colaborador_id: colabId,
          dia_semana_regra: dia as any,
          ativo: true,
          inicio,
          fim,
        })
        needsIdRefresh = true
      }
    } else if (diaForm.id) {
      await colaboradoresService.deletarRegraHorario(diaForm.id)
      needsIdRefresh = true
    }
    // Reload só pra pegar IDs novos — reloadRegras não sobrescreve form state
    if (needsIdRefresh) await reloadRegras()
  }, [colabId, reloadRegras])

  // ─── Salvar tudo (form + regra padrao + regras por dia) ──────────
  const handleSalvarTudo = useCallback(async () => {
    const formData = colabForm.getValues()
    const nome = formData.nome.trim()
    if (nome.length < 2) {
      toast.error('Nome deve ter ao menos 2 caracteres')
      return
    }
    setSalvandoTudo(true)
    try {
      // 1. Salva campos do form
      const contratoId = parseInt(formData.tipo_contrato_id)
      const contratoSel = contratosList.find((tc) => tc.id === contratoId)
      const horasSemanais = contratoSel?.horas_semanais ?? formData.horas_semanais
      const tipoTrabalhador = derivarTipoTrabalhadorPorContrato(contratoSel?.nome)
      await colaboradoresService.atualizar(colabId, {
        nome,
        sexo: formData.sexo,
        tipo_contrato_id: contratoId,
        horas_semanais: horasSemanais as number,
        tipo_trabalhador: tipoTrabalhador,
        funcao_id: formData.funcao_id === 'none' ? null : parseInt(formData.funcao_id),
        prefere_turno: formData.prefere_turno === 'none' ? null : formData.prefere_turno,
        evitar_dia_semana: formData.evitar_dia_semana === 'none' ? null : formData.evitar_dia_semana,
      })
      colabForm.setValue('horas_semanais', horasSemanais)
      colabForm.setValue('tipo_trabalhador', tipoTrabalhador)
      // 2. Salva regra padrao
      await saveRegraPadrao()
      // 3. Salva regras por dia
      const diaForms = regrasDiaFormRef.current
      for (const dia of DIAS_SEMANA_OPTIONS) {
        await saveDiaRegra(dia.value, diaForms[dia.value], isIntermitente)
      }
      // Marca form como clean
      colabForm.reset(colabForm.getValues())
      toast.success('Colaborador salvo')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao salvar')
    } finally {
      setSalvandoTudo(false)
    }
  }, [colabId, colabForm, contratosList, saveRegraPadrao, saveDiaRegra, isIntermitente])

  // ─── Protecao: aviso ao fechar app com alteracoes ──────────────────
  useEffect(() => {
    if (!isDirty) return
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [isDirty])

  const handlePreencherDoPerfil = async (perfilId: string) => {
    if (perfilId !== 'none') {
      const perfil = perfisHorario.find(p => p.id === parseInt(perfilId))
      if (perfil) {
        const { tipo_restricao, horario } = inicioFimParaRestricao(perfil.inicio, perfil.fim)
        const newForm = {
          ...regraForm,
          perfil_horario_id: perfilId,
          tipo_restricao,
          horario,
          preferencia_turno_soft: perfil.preferencia_turno_soft ?? 'none',
        }
        setRegraForm(newForm)
        setRegraSalvando(true)
        try { await saveRegraPadrao(newForm) } catch (err) { toast.error(err instanceof Error ? err.message : 'Erro ao salvar regra') }
        setRegraSalvando(false)
        return
      }
    }
    setRegraForm(f => ({ ...f, perfil_horario_id: perfilId }))
    setRegraSalvando(true)
    try { await saveRegraPadrao({ perfil_horario_id: perfilId }) } catch (err) { toast.error(err instanceof Error ? err.message : 'Erro ao salvar regra') }
    setRegraSalvando(false)
  }

  const handleSalvarExcData = async () => {
    if (!excDataForm.data) return
    setExcDataSalvando(true)
    try {
      const { inicio, fim } = restricaoParaInicioFim(excDataForm.tipo_restricao, excDataForm.horario)
      await colaboradoresService.upsertRegraExcecaoData({
        colaborador_id: colabId,
        data: excDataForm.data,
        ativo: true,
        inicio,
        fim,
        preferencia_turno_soft: excDataForm.preferencia_turno_soft === 'none' ? null : excDataForm.preferencia_turno_soft,
        domingo_forcar_folga: excDataForm.domingo_forcar_folga,
      } as any)
      toast.success('Excecao por data salva')
      setShowExcDataDialog(false)
      setExcDataForm({ data: '', tipo_restricao: 'nenhum', horario: '', preferencia_turno_soft: 'none', domingo_forcar_folga: false })
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

  // ─── Export handlers ─────────────────────────────────────────────
  const handleOpenExport = useCallback(async () => {
    if (!colab) return
    const result = await carregarExport(colab.id, colab.setor_id)
    if (result) setExportOpen(true)
  }, [colab, carregarExport])

  const handleExportHTML = useCallback(async () => {
    if (!exportData) return
    const { renderToStaticMarkup } = await import('react-dom/server')
    const markup = renderToStaticMarkup(
      <ExportarEscala
        escala={exportData.escala}
        alocacoes={exportData.alocacoes}
        colaboradores={[exportData.colaborador]}
        setor={exportData.setor}
        violacoes={exportData.violacoes}
        tipoContrato={exportData.tipoContrato}
        regrasPadrao={exportData.regra ? [exportData.regra] : []}
        mode="funcionario"
        colaboradorId={exportData.colaborador.id}
        mostrarAvisos
      />,
    )
    const fullHTML = buildStandaloneHtml(markup, {
      title: `Escala - ${exportData.colaborador.nome}`,
      pageOrientation: 'portrait',
      forceLight: true,
    })
    const slug = exportData.colaborador.nome.toLowerCase().replace(/\s+/g, '-')
    try {
      const result = await exportarService.salvarHTML(fullHTML, `escala-funcionario-${slug}.html`)
      if (result) toast.success('HTML salvo com sucesso')
    } catch {
      toast.error('Erro ao exportar HTML')
    }
  }, [exportData])

  const handlePrint = useCallback(async () => {
    if (!exportData) return
    const { renderToStaticMarkup } = await import('react-dom/server')
    const markup = renderToStaticMarkup(
      <ExportarEscala
        escala={exportData.escala}
        alocacoes={exportData.alocacoes}
        colaboradores={[exportData.colaborador]}
        setor={exportData.setor}
        violacoes={exportData.violacoes}
        tipoContrato={exportData.tipoContrato}
        regrasPadrao={exportData.regra ? [exportData.regra] : []}
        mode="funcionario"
        colaboradorId={exportData.colaborador.id}
        mostrarAvisos
      />,
    )
    const fullHTML = buildStandaloneHtml(markup, {
      title: `Escala - ${exportData.colaborador.nome}`,
      pageOrientation: 'portrait',
      forceLight: true,
    })
    const iframe = document.createElement('iframe')
    iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;'
    document.body.appendChild(iframe)
    const iframeDoc = iframe.contentDocument ?? iframe.contentWindow?.document
    if (!iframeDoc) {
      toast.error('Erro ao preparar impressao.')
      document.body.removeChild(iframe)
      return
    }
    iframeDoc.open()
    iframeDoc.write(fullHTML)
    iframeDoc.close()
    setTimeout(() => {
      iframe.contentWindow?.print()
      setTimeout(() => document.body.removeChild(iframe), 1000)
    }, 250)
  }, [exportData])

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
            <Button
              variant={isDirty ? 'default' : 'outline'}
              size="sm"
              onClick={handleSalvarTudo}
              disabled={salvandoTudo || isPreviewMode}
              title={isPreviewMode ? 'Saia da visualizacao para editar' : undefined}
            >
              {salvandoTudo ? (
                <Loader2 className="mr-1 size-3.5 animate-spin" />
              ) : isDirty ? (
                <Save className="mr-1 size-3.5" />
              ) : (
                <Check className="mr-1 size-3.5" />
              )}
              {salvandoTudo ? 'Salvando...' : isDirty ? 'Salvar' : 'Salvo'}
            </Button>
            {hasOficial && (
              <Button variant="outline" size="sm" onClick={handleOpenExport} disabled={exportLoading}>
                {exportLoading ? (
                  <Loader2 className="mr-1 size-3.5 animate-spin" />
                ) : (
                  <Download className="mr-1 size-3.5" />
                )}
                Exportar Escala
              </Button>
            )}
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" size="sm" className="text-destructive hover:bg-destructive/5" disabled={isPreviewMode}>
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
          </div>
        }
      />

      <div className="flex flex-1 flex-col gap-6 p-6">
        <Form {...colabForm}>
          <Tabs defaultValue="geral">
            <TabsList>
              <TabsTrigger value="geral">Geral</TabsTrigger>
              <TabsTrigger value="horarios">Horarios</TabsTrigger>
              <TabsTrigger value="ausencias" className="gap-1.5">
                Ausencias
                {excecoesList.length > 0 && (
                  <Badge variant="secondary" className="ml-1 min-w-5 justify-center px-1.5 text-[0.65rem]">
                    {excecoesList.length}
                  </Badge>
                )}
              </TabsTrigger>
            </TabsList>

            {/* ===== Tab Geral: Dados do Colaborador (Cards A+B+C unificados) ===== */}
            <TabsContent value="geral" className="space-y-6">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base font-semibold">
                    Dados do Colaborador
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={colabForm.control}
                      name="nome"
                      render={({ field }) => (
                        <FormItem className="col-span-2">
                          <FormLabel>Nome completo</FormLabel>
                          <FormControl>
                            <Input {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={colabForm.control}
                      name="sexo"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Sexo</FormLabel>
                          <Select value={field.value} onValueChange={field.onChange}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Selecione" />
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
                          <Select value={field.value} onValueChange={(val) => {
                            if (val !== field.value) {
                              setPendingSetorId(val)
                            }
                          }}>
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
                    <FormField
                      control={colabForm.control}
                      name="funcao_id"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Funcao / Posto</FormLabel>
                          <Select value={field.value} onValueChange={(val) => {
                            field.onChange(val)
                          }}>
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
                    <FormField
                      control={colabForm.control}
                      name="tipo_contrato_id"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Tipo de Contrato</FormLabel>
                          <Select value={field.value} onValueChange={(val) => {
                            field.onChange(val)
                          }}>
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
                  </div>
                  {selectedContrato && (
                    <div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
                      Template:{' '}
                      <strong>{selectedContrato.nome}</strong> | {selectedContrato.horas_semanais}h/semana |
                      {' '}{selectedContrato.regime_escala} | Max {selectedContrato.max_minutos_dia}min/dia
                    </div>
                  )}

                  <Separator />

                  {/* Preferencias */}
                  <div className="space-y-3">
                    <p className="text-sm font-medium">
                      Preferencias{' '}
                      <span className="text-xs font-normal text-muted-foreground">
                        (soft constraints - motor tenta respeitar)
                      </span>
                    </p>
                    <div className="grid grid-cols-2 gap-4">
                      <FormField
                        control={colabForm.control}
                        name="prefere_turno"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Prefere turno</FormLabel>
                            <Select value={field.value} onValueChange={(val) => {
                              field.onChange(val)
                            }}>
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
                            <Select value={field.value} onValueChange={(val) => {
                              field.onChange(val)
                            }}>
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
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* ===== Tab Horarios: Cards E + F ===== */}
            <TabsContent value="horarios" className="space-y-6">
              {/* Regras de Horario / Dias Disponíveis */}
              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-3">
                  <div className="flex items-center gap-2">
                    <Clock className="size-4 text-muted-foreground" />
                    <CardTitle className="text-base font-semibold">
                      {isIntermitente ? 'Dias Disponiveis' : 'Regras de Horario'}
                    </CardTitle>
                    {!isIntermitente && regraPadrao && (
                      <Badge variant="outline" className="text-xs">Configurado</Badge>
                    )}
                    {isIntermitente && (
                      <Badge variant="secondary" className="text-xs">Intermitente</Badge>
                    )}
                  </div>
                  {/* Save integrado ao botao principal */}
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* === Seções CLT (escondidas para intermitente) === */}
                  {!isIntermitente && (
                    <>
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
                                  {p.nome} ({p.inicio}-{p.fim})
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <p className="text-[0.75rem] text-muted-foreground">
                            Selecionar um perfil preenche o horario automaticamente. Voce pode sobrescrever depois.
                          </p>
                        </div>
                      )}

                      {/* Seccao A: Restricao de horario padrao */}
                      <div>
                        <Label className="mb-2 block">Restricao de horario (hard constraint)</Label>
                        <RestricaoRadio
                          value={regraForm.tipo_restricao}
                          onChange={v => {
                            setRegraForm(f => ({ ...f, tipo_restricao: v }))
                          }}
                          horario={regraForm.horario}
                          onHorarioChange={v => setRegraForm(f => ({ ...f, horario: v }))}
                        />
                        <p className="mt-2 text-[0.75rem] text-muted-foreground">
                          Sem restricao = motor decide livremente. Entrada fixa = entrada no horario exato. Saida maxima = nao aloca alem deste horario.
                        </p>
                      </div>

                      {/* Folga fixa + Folga variavel + Turno */}
                      <div className="grid grid-cols-3 gap-4">
                        <div className="space-y-2">
                          <Label className="text-xs">Folga fixa (5x2)</Label>
                          <Select
                            value={regraForm.folga_fixa_dia_semana}
                            onValueChange={v => {
                              setRegraForm(f => ({ ...f, folga_fixa_dia_semana: v }))
                            }}
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
                          <Label className="text-xs">Folga variavel (cond.)</Label>
                          <Select
                            value={regraForm.folga_variavel_dia_semana}
                            onValueChange={v => {
                              setRegraForm(f => ({ ...f, folga_variavel_dia_semana: v }))
                            }}
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">Sem folga var.</SelectItem>
                              {DIAS_SEMANA_OPTIONS.filter(d => d.value !== 'DOM').map(d => (
                                <SelectItem key={d.value} value={d.value}>
                                  {d.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <p className="text-[0.7rem] text-muted-foreground">
                            Se trabalhou DOM, folga neste dia
                          </p>
                        </div>
                        <div className="space-y-2">
                          <Label className="text-xs">Pref. turno (regra)</Label>
                          <Select
                            value={regraForm.preferencia_turno_soft}
                            onValueChange={v => {
                              setRegraForm(f => ({ ...f, preferencia_turno_soft: v }))
                            }}
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
                    </>
                  )}

                  {/* Seccao B - Dias da Semana (CLT: horários por dia / Intermitente: dias disponíveis) */}
                  <div className={!isIntermitente ? 'border-t pt-4' : ''}>
                    <div className="mb-3">
                      <Label className="text-sm font-medium">
                        {isIntermitente ? 'Dias de trabalho' : 'Horarios por dia da semana'}
                      </Label>
                      <p className="text-[0.75rem] text-muted-foreground">
                        {isIntermitente
                          ? 'Ative os dias em que este colaborador trabalha e defina o horario.'
                          : 'Ative um dia para definir restricao de horario especifica naquele dia.'}
                      </p>
                    </div>
                    <div className="space-y-3">
                      {DIAS_SEMANA_OPTIONS.map(dia => {
                        const diaForm = regrasDiaForm[dia.value]
                        return (
                          <div key={dia.value} className="flex items-start gap-3">
                            <Switch
                              checked={diaForm.enabled}
                              onCheckedChange={(checked) => {
                                const newDia: RegraDiaForm = {
                                  ...diaForm,
                                  enabled: checked,
                                  ...(checked
                                    ? isIntermitente
                                      ? { tipo_restricao: 'entrada' as TipoRestricao, horario: '08:00', horario_fim: '14:00' }
                                      : { tipo_restricao: 'entrada' as TipoRestricao }
                                    : { tipo_restricao: 'nenhum' as TipoRestricao, horario: '', horario_fim: '' }),
                                }
                                setRegrasDiaForm(prev => ({ ...prev, [dia.value]: newDia }))
                              }}
                            />
                            <span className="mt-0.5 w-10 shrink-0 text-sm font-medium">{dia.value}</span>
                            {diaForm.enabled ? (
                              isIntermitente ? (
                                /* Intermitente: entrada + saída (dois campos, sem radio) */
                                <div className="flex items-center gap-2">
                                  <div className="space-y-1">
                                    <span className="text-xs text-muted-foreground">Entrada</span>
                                    <Input
                                      type="time"
                                      value={diaForm.horario}
                                      onChange={e => setRegrasDiaForm(prev => ({
                                        ...prev,
                                        [dia.value]: { ...prev[dia.value], horario: e.target.value },
                                      }))}
                                      className="w-32"
                                    />
                                  </div>
                                  <span className="mt-5 text-xs text-muted-foreground">ate</span>
                                  <div className="space-y-1">
                                    <span className="text-xs text-muted-foreground">Saida</span>
                                    <Input
                                      type="time"
                                      value={diaForm.horario_fim}
                                      onChange={e => setRegrasDiaForm(prev => ({
                                        ...prev,
                                        [dia.value]: { ...prev[dia.value], horario_fim: e.target.value },
                                      }))}
                                      className="w-32"
                                    />
                                  </div>
                                </div>
                              ) : (
                                /* CLT: radio entrada/saída (como hoje) */
                                <RestricaoRadio
                                  value={diaForm.tipo_restricao}
                                  onChange={v => {
                                    const newDia: RegraDiaForm = { ...diaForm, tipo_restricao: v }
                                    setRegrasDiaForm(prev => ({ ...prev, [dia.value]: newDia }))
                                  }}
                                  horario={diaForm.horario}
                                  onHorarioChange={v => setRegrasDiaForm(prev => ({
                                    ...prev,
                                    [dia.value]: { ...prev[dia.value], horario: v },
                                  }))}
                                          showNenhum={false}
                                />
                              )
                            ) : (
                              <span className="mt-0.5 text-xs text-muted-foreground">
                                {isIntermitente ? 'Nao trabalha' : 'Usando padrao'}
                              </span>
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
                    setExcDataForm({ data: '', tipo_restricao: 'nenhum', horario: '', preferencia_turno_soft: 'none', domingo_forcar_folga: false })
                    setShowExcDataDialog(true)
                  }} disabled={isPreviewMode}>
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
                              {exc.inicio && <span>Entrada: {exc.inicio}</span>}
                              {exc.fim && <span>Saida max: {exc.fim}</span>}
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
            </TabsContent>

            {/* ===== Tab Ausencias: Card D ===== */}
            <TabsContent value="ausencias" className="space-y-6">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-3">
                  <CardTitle className="text-base font-semibold">
                    Excecoes
                  </CardTitle>
                  <Button variant="outline" size="sm" onClick={() => setShowExcecaoDialog(true)} disabled={isPreviewMode}>
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
            </TabsContent>
          </Tabs>
        </Form>
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
                <div className="space-y-2">
                  <Label className="text-xs">Restricao de horario</Label>
                  <RestricaoRadio
                    value={excDataForm.tipo_restricao}
                    onChange={v => setExcDataForm(f => ({ ...f, tipo_restricao: v }))}
                    horario={excDataForm.horario}
                    onHorarioChange={v => setExcDataForm(f => ({ ...f, horario: v }))}
                  />
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
            <Button onClick={handleSalvarExcData} disabled={excDataSalvando || !excDataForm.data || isPreviewMode}>
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

      {/* Setor change confirmation dialog */}
      <AlertDialog open={!!pendingSetorId} onOpenChange={(open) => { if (!open) setPendingSetorId(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Mover colaborador?</AlertDialogTitle>
            <AlertDialogDescription>
              Mover {colab?.nome} para {setoresList.find(s => String(s.id) === pendingSetorId)?.nome ?? 'outro setor'}?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmSetorChange}>Mover</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Export Modal */}
      {exportData && (
        <ExportModal
          open={exportOpen}
          onOpenChange={setExportOpen}
          mode="funcionario"
          funcionarioData={exportData}
          onExportHTML={handleExportHTML}
          onPrint={handlePrint}
        />
      )}
    </div>
  )
}
