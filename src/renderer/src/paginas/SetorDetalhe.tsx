import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { useRestorePreview } from '@/hooks/useRestorePreview'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import type { DragEndEvent } from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  GripVertical,
  ChevronDown,
  Users,
  ArrowRight,
  Archive,
  Plus,
  Play,
  Loader2,
  RotateCcw,
  SlidersHorizontal,
  Pencil,
  UserMinus,
  Briefcase,
  Trash2,
  Square,
  Terminal,
  Save,
  Check,
  AlertTriangle,
  ShieldCheck,
  Zap,
  Lightbulb,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { PageHeader } from '@/componentes/PageHeader'
import type { DemandaEditorRef, SemanaDraft } from '@/componentes/DemandaEditor'
import { DirtyGuardDialog } from '@/componentes/DirtyGuardDialog'
import { StatusBadge } from '@/componentes/StatusBadge'
import { CicloGrid } from '@/componentes/CicloGrid'
import { PreflightChecklist } from '@/componentes/PreflightChecklist'
import { AvisosSection, type Aviso } from '@/componentes/AvisosSection'
import { SugestaoSheet } from '@/componentes/SugestaoSheet'
import { converterPreviewParaPinned, sugerirK, sugerirTSHierarquico, type SimulaCicloOutput } from '@shared/simula-ciclo'
import { runPreviewMultiPass, type MultiPassResult } from '@shared/preview-multi-pass'
import type { EscalaAdvisoryOutput, AdvisoryDiffItem } from '@shared/index'
import { CoberturaChart } from '@/componentes/CoberturaChart'
import { escalaParaCicloGrid, simulacaoParaCicloGrid } from '@/lib/ciclo-grid-converters'
import { DIAS_ORDEM, type CicloGridRow, type Simbolo } from '@/lib/ciclo-grid-types'
import { SolverConfigDrawer, type SolverSessionConfig } from '@/componentes/SolverConfigDrawer'
import { ExportarEscala } from '@/componentes/ExportarEscala'
import { ExportModal, type EscalaExportData, type ExportToggles } from '@/componentes/ExportModal'
import { IconPicker } from '@/componentes/IconPicker'
import { ColaboradorCard } from '@/componentes/ColaboradorCard'
import { DemandaEditor } from '@/componentes/DemandaEditor'
import { useDirtyGuard } from '@/hooks/useDirtyGuard'
import { setoresService } from '@/servicos/setores'
import { colaboradoresService } from '@/servicos/colaboradores'
import { escalasService } from '@/servicos/escalas'
import { funcoesService } from '@/servicos/funcoes'
import { useAppDataStore, type AvisoEscala } from '@/store/appDataStore'
import { useAppVersion } from '@/hooks/useAppVersion'
import { useIaStore } from '@/store/iaStore'
import { formatarData, formatarDataHora, mapError } from '@/lib/formatadores'
import { toastErroGeracaoEscala, toastInfeasible } from '@/lib/toast-escala'
import { buildStandaloneHtml } from '@/lib/export-standalone-html'
import { gerarCSVAlocacoes, gerarCSVComparacaoDemanda, gerarCSVViolacoes } from '@/lib/gerarCSV'
import { getPresetLabel, resolvePresetRange, type EscalaPeriodoPreset } from '@/lib/escala-periodo-preset'
import { resolveEscalaEquipe } from '@/lib/escala-team'
import { buildPreviewAvisos } from '@/lib/build-avisos'
import { toast } from 'sonner'
import { Switch } from '@/components/ui/switch'
import { exportarService } from '@/servicos/exportar'
import {
  DIAS_SEMANA,
  type DiaSemana,
  Empresa,
  Setor,
  Demanda,
  DemandaExcecaoData,
  Colaborador,
  Escala,
  EscalaCompletaV3,
  TipoContrato,
  Funcao,
  Excecao,
  SetorHorarioSemana,
  RegraHorarioColaborador,
  RuleConfig,
  hasGuaranteedSundayWindow,
  listEscalaParticipantes,
  normalizeSetorSimulacaoConfig,
  type PreviewDiagnostic,
  type PreviewGate,
  type SetorSimulacaoConfig,
  type SetorSimulacaoMode,
  type SetorSimulacaoOverrideLocal,
  type InfeasibleError,
  resolvePreviewGate,
  resolveSundayRotatingDemand,
} from '@shared/index'

// ─── DnD: Sortable row for posto hierarchy reorder ──────────────────

function SortablePostoRow({
  postoId,
  index,
  children,
}: {
  postoId: number
  index: number
  children: import('react').ReactNode
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `posto-${postoId}`,
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  return (
    <TableRow ref={setNodeRef} style={style} className={cn(isDragging && 'bg-muted/40')}>
      <TableCell className="w-[60px] text-center">
        <div className="flex items-center justify-center gap-1.5">
          <button
            type="button"
            className="inline-flex size-6 cursor-grab touch-none items-center justify-center rounded text-muted-foreground hover:bg-muted active:cursor-grabbing"
            aria-label="Arrastar para reordenar"
            {...attributes}
            {...listeners}
          >
            <GripVertical className="size-3.5" />
          </button>
          <span className="font-mono text-xs text-muted-foreground">
            {String(index + 1).padStart(2, '0')}
          </span>
        </div>
      </TableCell>
      {children}
    </TableRow>
  )
}

function timeToMinutes(hhmm: string): number {
  const [hora, minuto] = hhmm.split(':').map(Number)
  return (hora * 60) + minuto
}

function intermitenteRuleCoversSegment(
  rule: RegraHorarioColaborador | undefined,
  horaInicio: string,
  horaFim: string,
  fallbackInicio: string,
  fallbackFim: string,
): boolean {
  if (!rule) return false

  const inicio = rule.inicio ?? fallbackInicio
  const fim = rule.fim ?? fallbackFim

  return timeToMinutes(inicio) < timeToMinutes(horaFim)
    && timeToMinutes(fim) > timeToMinutes(horaInicio)
}

function TitularAssignmentPanel({
  titular,
  candidatos,
  funcaoMap,
  contratoMap,
  searchTerm,
  onSearchTermChange,
  onSelectColaborador,
  onRemoveTitular,
  removeLabel,
  getDescricaoBuscaColaborador,
  loading,
}: {
  titular: Colaborador | null
  candidatos: Colaborador[]
  funcaoMap: Map<number, string>
  contratoMap: Map<number, string>
  searchTerm: string
  onSearchTermChange: (value: string) => void
  onSelectColaborador: (colaboradorId: number) => void
  onRemoveTitular?: () => void
  removeLabel?: string
  getDescricaoBuscaColaborador: (colaborador: Colaborador) => string
  loading: boolean
}) {
  return (
    <div className="space-y-3 p-3">
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-medium">Titular atual</p>
          {titular && onRemoveTitular && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 gap-1 px-2 text-xs"
              onClick={onRemoveTitular}
              disabled={loading}
            >
              <UserMinus className="size-3" />
              {removeLabel ?? 'Remover'}
            </Button>
          )}
        </div>

        {titular ? (
          <ColaboradorCard
            nome={titular.nome}
            posto={titular.funcao_id != null ? (funcaoMap.get(titular.funcao_id) ?? 'Posto') : null}
            contrato={contratoMap.get(titular.tipo_contrato_id)}
            status={getDescricaoBuscaColaborador(titular).split(' • ').pop() as 'Ativo' | 'Ferias' | 'Atestado' | 'Bloqueio'}
          />
        ) : (
          <div className="rounded-md border border-dashed px-3 py-3 text-xs text-muted-foreground">
            Sem titular anexado.
          </div>
        )}
      </div>

      <div className="space-y-2">
        <p className="text-xs font-medium">Buscar colaborador</p>
        <Input
          value={searchTerm}
          onChange={(e) => onSearchTermChange(e.target.value)}
          placeholder="Digite o nome do colaborador"
          autoFocus
        />
      </div>

      <ScrollArea className="h-48 rounded-md border bg-background/60">
        <div className="space-y-1 p-2 pr-3">
          {candidatos.length === 0 ? (
            <p className="rounded-md border border-dashed px-2 py-2 text-xs text-muted-foreground">
              Nenhum colaborador encontrado.
            </p>
          ) : (
            candidatos.map((candidato) => {
              const postoAtualNome = candidato.funcao_id != null ? (funcaoMap.get(candidato.funcao_id) ?? 'Posto') : 'Reserva operacional'

              return (
                <ColaboradorCard
                  key={candidato.id}
                  nome={candidato.nome}
                  posto={candidato.funcao_id != null ? (funcaoMap.get(candidato.funcao_id) ?? 'Posto') : null}
                  contrato={contratoMap.get(candidato.tipo_contrato_id)}
                  status={getDescricaoBuscaColaborador(candidato).split(' • ').pop() as 'Ativo' | 'Ferias' | 'Atestado' | 'Bloqueio'}
                  onClick={() => onSelectColaborador(candidato.id)}
                  disabled={loading}
                />
              )
            })
          )}
        </div>
      </ScrollArea>
    </div>
  )
}

// ─── Form schema ───────────────────────────────────────────────────────
const setorSchema = z.object({
  nome: z.string().min(2, 'Nome deve ter ao menos 2 caracteres'),
  icone: z.string().nullable(),
  hora_abertura: z.string().min(1, 'Hora de abertura e obrigatoria'),
  hora_fechamento: z.string().min(1, 'Hora de fechamento e obrigatoria'),
  regime_escala: z.enum(['5X2', '6X1']),
})

type SetorFormInput = z.input<typeof setorSchema>
type SetorFormData = z.output<typeof setorSchema>

const PREVIEW_DIAS_UTEIS: Exclude<DiaSemana, 'DOM'>[] = ['SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB']
const DEFAULT_SIMULACAO_LIVRE_N = 5
const PREVIEW_OWNED_STORE_WARNING_IDS = new Set(['k_limitado', 'subdimensionamento', 'deficit_cobertura'])

function diaSemanaParaIdxPreview(dia: DiaSemana | null | undefined): number | null {
  if (!dia || dia === 'DOM') return null
  return PREVIEW_DIAS_UTEIS.indexOf(dia)
}

function idxPreviewParaDiaSemana(idx: number | null | undefined): Exclude<DiaSemana, 'DOM'> | null {
  if (idx == null) return null
  return PREVIEW_DIAS_UTEIS[idx] ?? null
}

function buildDemandaPorDiaFromDraft(draft: SemanaDraft): number[] {
  return DIAS_SEMANA.map((dia) => {
    const diaCfg = draft.dias[dia]
    const segmentos = diaCfg.usa_padrao ? draft.padrao.segmentos : diaCfg.segmentos
    return segmentos.reduce((max, segmento) => Math.max(max, segmento.min_pessoas), 0)
  })
}

function hasOwnOverrideField(
  overrideLocal: SetorSimulacaoOverrideLocal | undefined,
  field: 'fixa' | 'variavel',
): boolean {
  return overrideLocal != null && Object.prototype.hasOwnProperty.call(overrideLocal, field)
}

function resolveOverrideField(
  overrideLocal: SetorSimulacaoOverrideLocal | undefined,
  field: 'fixa' | 'variavel',
  fallback: DiaSemana | null,
): DiaSemana | null {
  return hasOwnOverrideField(overrideLocal, field)
    ? overrideLocal?.[field] ?? null
    : fallback
}

// ─── Main Component ────────────────────────────────────────────────────
export function SetorDetalhe() {
  const { id } = useParams<{ id: string }>()
  const setorId = parseInt(id!)
  const navigate = useNavigate()
  const { isPreviewMode } = useRestorePreview()

  // Form
  const setorForm = useForm<SetorFormInput, unknown, SetorFormData>({
    resolver: zodResolver(setorSchema),
    defaultValues: { nome: '', icone: null, hora_abertura: '', hora_fechamento: '', regime_escala: '5X2' },
  })

  // ─── Data from store (reactive) ──────────────────────────────────────
  const setSetorAtivo = useAppDataStore((s) => s.setSetorAtivo)
  const carregandoSetor = useAppDataStore((s) => s.carregandoSetor)
  const setor = useAppDataStore((s) => s.setor)
  const empresa = useAppDataStore((s) => s.empresa)
  const demandas = useAppDataStore((s) => s.demandas)
  const horariosSemana = useAppDataStore((s) => s.horarioSemana)
  const colaboradores = useAppDataStore((s) => s.colaboradores)
  const escalas = useAppDataStore((s) => s.escalas)
  const derivados = useAppDataStore((s) => s.derivados)
  const tiposContrato = useAppDataStore((s) => s.tiposContrato)
  const funcoes = useAppDataStore((s) => s.postos)
  const excecoesAtivas = useAppDataStore((s) => s.excecoes)
  const regras = useAppDataStore((s) => s.regras)
  const regrasPadrao = useAppDataStore((s) => s.regrasPadrao)
  const regrasHorario = useAppDataStore((s) => s.regrasHorario)
  const appVersion = useAppVersion()

  // Notify store which sector is active (loads data if changed)
  useEffect(() => {
    setSetorAtivo(setorId)
  }, [setorId, setSetorAtivo])

  const contratoMap = new Map((tiposContrato ?? []).map((tc) => [tc.id, tc.nome]))
  const funcoesList = useMemo(() => funcoes ?? [], [funcoes])
  const inicioSemanaEscala = useMemo<DiaSemana>(() => {
    const raw = (empresa?.corte_semanal ?? 'SEG_DOM').slice(0, 3).toUpperCase()
    if (raw === 'SEG' || raw === 'TER' || raw === 'QUA' || raw === 'QUI' || raw === 'SEX' || raw === 'SAB' || raw === 'DOM') {
      return raw
    }
    return 'SEG'
  }, [empresa?.corte_semanal])

  // ─── Save & Dirty ────────────────────────────────────────────────────
  const demandaEditorRef = useRef<DemandaEditorRef>(null)
  const [demandaDirty, setDemandaDirty] = useState(false)
  const [demandaDraftPreview, setDemandaDraftPreview] = useState<SemanaDraft | null>(null)
  const [salvandoTudo, setSalvandoTudo] = useState(false)
  const isDirty = setorForm.formState.isDirty || demandaDirty
  const blocker = useDirtyGuard({ isDirty: isDirty && !salvandoTudo })
  const regimeEfetivo = setorForm.watch('regime_escala') ?? setor?.regime_escala ?? '5X2'

  // ─── State ───────────────────────────────────────────────────────────
  const [showPostoDialog, setShowPostoDialog] = useState(false)
  const [postoDialogMode, setPostoDialogMode] = useState<'create' | 'edit'>('create')
  const [postoDialogPostoId, setPostoDialogPostoId] = useState<number | null>(null)
  const [postoDialogApelido, setPostoDialogApelido] = useState('')
  const [postoDialogTitularId, setPostoDialogTitularId] = useState<number | null>(null)
  const [postoDialogSearchTerm, setPostoDialogSearchTerm] = useState('')
  const [postoDialogTitularPickerOpen, setPostoDialogTitularPickerOpen] = useState(false)
  const [salvandoPosto, setSalvandoPosto] = useState(false)
  const [deletandoPosto, setDeletandoPosto] = useState(false)
  const [orderedPostos, setOrderedPostos] = useState<Funcao[]>([])
  const [orderedColabs, setOrderedColabs] = useState<Colaborador[]>([])
  const [titularPickerPostoId, setTitularPickerPostoId] = useState<number | null>(null)
  const [titularPickerSearchTerm, setTitularPickerSearchTerm] = useState('')
  const [postoAssignmentLoading, setPostoAssignmentLoading] = useState(false)
  const [pendingAutocompleteSwap, setPendingAutocompleteSwap] = useState<{
    source: 'picker' | 'dialog'
    postoId: number
    colabId: number
    colaboradorNome: string
    postoOrigemNome: string
    postoDestinoNome: string
  } | null>(null)

  // Geracao inline — seletor unificado: simulacao | oficial | historico:${id}
  const [escalaSelecionada, setEscalaSelecionada] = useState<string>('simulacao')
  const [periodoPreset, setPeriodoPreset] = useState<EscalaPeriodoPreset>('3_MESES')
  const [previewSelectedWeek, setPreviewSelectedWeek] = useState(0)
  const [gerando, setGerando] = useState(false)
  const [solverLogs, setSolverLogs] = useState<string[]>([])
  const [solverElapsed, setSolverElapsed] = useState(0)

  // B8: Avisos de operacao (preflight blockers, solver errors) — persistem na pagina
  // CONECTOR PARA CLAUDE C: renderizar estes avisos na area de avisos do setor
  // e tambem na EscalaPagina (ver todos). Separados dos avisos por pessoa.
  const [avisosOperacao, setAvisosOperacao] = useState<AvisoEscala[]>([])
  const solverScrollRef = useRef<HTMLDivElement>(null)
  const [oficialCompleta, setOficialCompleta] = useState<EscalaCompletaV3 | null>(null)
  const [historicoCompleta, setHistoricoCompleta] = useState<EscalaCompletaV3 | null>(null)
  const [historicoSelecionadaId, setHistoricoSelecionadaId] = useState<number | null>(null)
  const [carregandoTabEscala, setCarregandoTabEscala] = useState(false)
  const [oficializando, setOficializando] = useState(false)
  const [descartando, setDescartando] = useState(false)
  const [sugestaoOpen, setSugestaoOpen] = useState(false)
  const [sugestaoMode, setSugestaoMode] = useState<'sugestao' | 'validacao'>('sugestao')
  const [advisoryResult, setAdvisoryResult] = useState<EscalaAdvisoryOutput | null>(null)
  const [advisoryLoading, setAdvisoryLoading] = useState(false)
  const [periodoGeracao, setPeriodoGeracao] = useState(() => resolvePresetRange('3_MESES'))
  const [solverConfigOpen, setSolverConfigOpen] = useState(false)
  const [solverSessionConfig, setSolverSessionConfig] = useState<SolverSessionConfig>({
    solveMode: 'rapido',
    rulesOverride: {},
  })
  const [simulacaoConfigDraft, setSimulacaoConfigDraft] = useState<SetorSimulacaoConfig | null>(null)
  const [rawLivreN, setRawLivreN] = useState(String(DEFAULT_SIMULACAO_LIVRE_N))
  const [rawLivreK, setRawLivreK] = useState(String(sugerirK(DEFAULT_SIMULACAO_LIVRE_N, 7)))
  const [simulacaoConfigSaving, setSimulacaoConfigSaving] = useState(false)

  const [exportOpen, setExportOpen] = useState(false)
  const [exportDetalhe, setExportDetalhe] = useState<EscalaCompletaV3 | null>(null)

  // Demanda excecao por data
  const [demandasExcecao, setDemandasExcecao] = useState<DemandaExcecaoData[]>([])
  const [showExcDemandaDialog, setShowExcDemandaDialog] = useState(false)
  const [excDemandaSalvando, setExcDemandaSalvando] = useState(false)
  const [excDemandaForm, setExcDemandaForm] = useState({
    data: '',
    hora_inicio: '',
    hora_fim: '',
    min_pessoas: 1,
    override: false,
  })

  // ─── Solver logs listener ───────────────────────────────────────────
  useEffect(() => {
    if (!gerando) return
    const dispose = escalasService.onSolverLog((line: string) => {
      setSolverLogs((prev) => [...prev, line])
    })
    return () => { dispose() }
  }, [gerando])

  // Auto-scroll solver logs
  useEffect(() => {
    if (solverLogs.length === 0) return
    const viewport = solverScrollRef.current?.querySelector('[data-radix-scroll-area-viewport]')
    if (viewport) {
      viewport.scrollTo({ top: viewport.scrollHeight, behavior: 'smooth' })
    }
  }, [solverLogs])

  // Timer while solver is running
  useEffect(() => {
    if (!gerando) return
    setSolverElapsed(0)
    const interval = setInterval(() => setSolverElapsed((s) => s + 1), 1000)
    return () => clearInterval(interval)
  }, [gerando])

  // ─── Computed maps ───────────────────────────────────────────────────
  const funcaoMap = useMemo(() => {
    const map = new Map<number, string>()
    for (const f of funcoesList) map.set(f.id, f.apelido)
    return map
  }, [funcoesList])

  const excecaoMap = useMemo(() => {
    const hoje = new Date().toISOString().split('T')[0]
    const colabIds = new Set((colaboradores ?? []).map((c) => c.id))
    const map = new Map<number, Excecao>()
    for (const exc of excecoesAtivas ?? []) {
      // Filtrar só exceções ativas HOJE (query agora retorna não-expiradas, inclui futuras)
      if (!colabIds.has(exc.colaborador_id)) continue
      if (exc.data_inicio > hoje) continue
      map.set(exc.colaborador_id, exc)
    }
    return map
  }, [colaboradores, excecoesAtivas])

  const regrasMap = useMemo(() => {
    const map = new Map<number, RegraHorarioColaborador>()
    for (const regra of regrasPadrao ?? []) {
      map.set(regra.colaborador_id, regra)
    }
    return map
  }, [regrasPadrao])

  const regrasHorarioByColab = useMemo(() => {
    const map = new Map<number, RegraHorarioColaborador[]>()
    for (const regra of regrasHorario ?? []) {
      const bucket = map.get(regra.colaborador_id)
      if (bucket) bucket.push(regra)
      else map.set(regra.colaborador_id, [regra])
    }
    return map
  }, [regrasHorario])

  const folgasEquipeMap = useMemo(() => {
    const map = new Map<number, { fixa: DiaSemana | null; variavel: DiaSemana | null }>()

    for (const colab of orderedColabs) {
      const regra = regrasMap.get(colab.id)
      map.set(colab.id, {
        fixa: regra?.folga_fixa_dia_semana ?? null,
        variavel: regra?.folga_variavel_dia_semana ?? null,
      })
    }

    return map
  }, [orderedColabs, regrasMap])

  const ocupanteMap = useMemo(() => {
    const map = new Map<number, Colaborador>()
    for (const c of orderedColabs) {
      if (c.funcao_id != null) {
        map.set(c.funcao_id, c)
      }
    }
    return map
  }, [orderedColabs])

  const ausenteMap = useMemo(() => {
    const map = new Map<number, (typeof derivados)['ausentes'][number]>()
    for (const info of derivados?.ausentes ?? []) {
      map.set(info.colaborador.id, info)
    }
    return map
  }, [derivados?.ausentes])

  const proximoAusenteMap = useMemo(() => {
    const map = new Map<number, (typeof derivados)['proximosAusentes'][number]>()
    for (const info of derivados?.proximosAusentes ?? []) {
      map.set(info.colaborador.id, info)
    }
    return map
  }, [derivados?.proximosAusentes])

  const postosOrdenados = orderedPostos
  const postosAtivos = useMemo(
    () => postosOrdenados.filter((posto) => posto.ativo),
    [postosOrdenados],
  )
  const postosBancoEspera = useMemo(
    () => postosOrdenados.filter((posto) => !posto.ativo),
    [postosOrdenados],
  )

  const colabsSemPosto = useMemo(
    () => orderedColabs.filter((c) => c.funcao_id == null),
    [orderedColabs],
  )

  const colaboradoresParaBusca = useMemo(
    () => [...orderedColabs].sort((a, b) => a.nome.localeCompare(b.nome)),
    [orderedColabs],
  )

  const filtrarColaboradoresPorBusca = useCallback((searchTerm: string) => {
    const query = searchTerm.trim().toLowerCase()
    if (!query) return colaboradoresParaBusca
    return colaboradoresParaBusca.filter((c) => c.nome.toLowerCase().includes(query))
  }, [colaboradoresParaBusca])

  const colaboradoresFiltradosPicker = useMemo(
    () => filtrarColaboradoresPorBusca(titularPickerSearchTerm),
    [filtrarColaboradoresPorBusca, titularPickerSearchTerm],
  )

  const colaboradoresFiltradosDialogo = useMemo(
    () => filtrarColaboradoresPorBusca(postoDialogSearchTerm),
    [filtrarColaboradoresPorBusca, postoDialogSearchTerm],
  )

  const getStatusColaborador = useCallback((colabId: number) => {
    const exc = excecaoMap.get(colabId)?.tipo ?? null
    if (!exc) return 'Ativo'
    if (exc === 'FERIAS') return 'Ferias'
    if (exc === 'ATESTADO') return 'Atestado'
    return 'Bloqueio'
  }, [excecaoMap])

  // ─── DnD setup (reorder postos) ─────────────────────────────────────
  const postoSortSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  )

  const persistPostosBuckets = useCallback(async (nextPostosAtivos: Funcao[], nextPostosEspera: Funcao[]) => {
    const normalizedAtivos = nextPostosAtivos.map((posto, index) => ({
      ...posto,
      ativo: true,
      ordem: index,
    }))
    const normalizedEspera = nextPostosEspera.map((posto, index) => ({
      ...posto,
      ativo: false,
      ordem: normalizedAtivos.length + index,
    }))
    const normalized = [...normalizedAtivos, ...normalizedEspera]
    setOrderedPostos(normalized)

    try {
      await Promise.all(
        normalized.map((posto) => funcoesService.atualizar(posto.id, {
          ordem: posto.ordem,
          ativo: posto.ativo,
        })),
      )
    } catch {
      toast.error('Erro ao salvar organizacao dos postos')
    }
  }, [])

  const handlePostoReorderDragEnd = useCallback(async (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return

    const oldIndex = postosAtivos.findIndex((p) => `posto-${p.id}` === active.id)
    const newIndex = postosAtivos.findIndex((p) => `posto-${p.id}` === over.id)
    if (oldIndex === -1 || newIndex === -1) return

    const reorderedAtivos = arrayMove(postosAtivos, oldIndex, newIndex)
    await persistPostosBuckets(reorderedAtivos, postosBancoEspera)
  }, [persistPostosBuckets, postosAtivos, postosBancoEspera])

  // Sync ordered list when API data changes
  useEffect(() => {
    if (colaboradores) {
      setOrderedColabs([...colaboradores].sort((a, b) => a.rank - b.rank))
    }
  }, [colaboradores])

  useEffect(() => {
    const next = [...funcoesList].sort((a, b) => a.ordem - b.ordem || a.apelido.localeCompare(b.apelido))
    setOrderedPostos((prev) => {
      if (prev.length === next.length && prev.every((p, idx) => p.id === next[idx]?.id && p.ordem === next[idx]?.ordem)) {
        return prev
      }
      return next
    })
  }, [funcoesList])

  // Carregar demandas excecao por data
  useEffect(() => {
    if (!setorId) return
    setoresService.listarDemandasExcecaoData(setorId).then(setDemandasExcecao).catch(() => {})
  }, [setorId])

  const resetPostoDialogState = useCallback(() => {
    setPostoDialogMode('create')
    setPostoDialogPostoId(null)
    setPostoDialogApelido('')
    setPostoDialogTitularId(null)
    setPostoDialogSearchTerm('')
    setPostoDialogTitularPickerOpen(false)
  }, [])

  const openTitularPicker = useCallback((postoId: number) => {
    setTitularPickerPostoId(postoId)
    setTitularPickerSearchTerm('')
  }, [])

  const closeTitularPicker = useCallback(() => {
    setTitularPickerPostoId(null)
    setTitularPickerSearchTerm('')
  }, [])

  const openCreatePostoDialog = useCallback(() => {
    resetPostoDialogState()
    setShowPostoDialog(true)
  }, [resetPostoDialogState])

  const openEditPostoDialog = useCallback((posto: Funcao) => {
    setPostoDialogMode('edit')
    setPostoDialogPostoId(posto.id)
    setPostoDialogApelido(posto.apelido)
    setPostoDialogTitularId(ocupanteMap.get(posto.id)?.id ?? null)
    setPostoDialogSearchTerm('')
    setPostoDialogTitularPickerOpen(false)
    setShowPostoDialog(true)
  }, [ocupanteMap])

  const closePostoDialog = useCallback((open: boolean) => {
    setShowPostoDialog(open)
    if (!open) resetPostoDialogState()
  }, [resetPostoDialogState])

  const moverPostoParaBancoEspera = useCallback(async (
    posto: Funcao,
    options?: {
      desanexarTitular?: boolean
      basePostosAtivos?: Funcao[]
      basePostosEspera?: Funcao[]
    },
  ) => {
    const shouldDesanexarTitular = options?.desanexarTitular ?? true
    const ocupanteAtual = shouldDesanexarTitular ? (ocupanteMap.get(posto.id) ?? null) : null
    const postosAtivosBase = options?.basePostosAtivos ?? postosAtivos
    const postosEsperaBase = options?.basePostosEspera ?? postosBancoEspera

    if (ocupanteAtual) {
      await colaboradoresService.atribuirPosto({
        colaborador_id: ocupanteAtual.id,
        funcao_id: null,
        estrategia: 'swap',
      })
    }

    const nextPostosAtivos = postosAtivosBase.filter((item) => item.id !== posto.id)
    const nextPostosEspera = [
      ...postosEsperaBase.filter((item) => item.id !== posto.id),
      { ...posto, ativo: false },
    ]

    await persistPostosBuckets(nextPostosAtivos, nextPostosEspera)
  }, [ocupanteMap, persistPostosBuckets, postosAtivos, postosBancoEspera])

  const ativarPostoBancoEspera = useCallback(async (posto: Funcao) => {
    const nextPostosAtivos = [...postosAtivos, { ...posto, ativo: true }]
    const nextPostosEspera = postosBancoEspera.filter((item) => item.id !== posto.id)
    await persistPostosBuckets(nextPostosAtivos, nextPostosEspera)
  }, [persistPostosBuckets, postosAtivos, postosBancoEspera])

  const resolveTipoContratoInternoPosto = useCallback((titularId: number | null, postoAtual: Funcao | null) => {
    const titularSelecionado = titularId != null
      ? (orderedColabs.find((colab) => colab.id === titularId) ?? null)
      : null

    return titularSelecionado?.tipo_contrato_id
      ?? postoAtual?.tipo_contrato_id
      ?? tiposContrato?.[0]?.id
      ?? null
  }, [orderedColabs, tiposContrato])

  const salvarTitularNoPosto = useCallback(async (posto: Funcao, titularId: number | null) => {
    const titularAtual = ocupanteMap.get(posto.id)
    const proximoTitular = titularId != null ? orderedColabs.find((colab) => colab.id === titularId) ?? null : null
    const postoOrigemProximoTitular = proximoTitular?.funcao_id != null && proximoTitular.funcao_id !== posto.id
      ? (postosOrdenados.find((item) => item.id === proximoTitular.funcao_id) ?? null)
      : null

    if (titularId == null && !titularAtual) {
      closeTitularPicker()
      return
    }

    setPostoAssignmentLoading(true)
    try {
      if (titularId == null) {
        await moverPostoParaBancoEspera(posto)
      } else {
        await colaboradoresService.atribuirPosto({
          colaborador_id: titularId,
          funcao_id: posto.id,
          estrategia: 'swap',
        })

        if (proximoTitular && proximoTitular.tipo_contrato_id !== posto.tipo_contrato_id) {
          await funcoesService.atualizar(posto.id, { tipo_contrato_id: proximoTitular.tipo_contrato_id })
        }

        if (postoOrigemProximoTitular) {
          await moverPostoParaBancoEspera(postoOrigemProximoTitular, { desanexarTitular: false })
        }
      }

      closeTitularPicker()

      if (titularId == null) {
        toast.success(`${posto.apelido} foi movido para o banco de espera`)
      } else if (proximoTitular) {
        toast.success(
          titularAtual?.id === proximoTitular.id
            ? `${proximoTitular.nome} permanece em ${posto.apelido}`
            : `${proximoTitular.nome} vinculado a ${posto.apelido}`,
        )
      } else {
        toast.success(`Titular salvo em ${posto.apelido}`)
      }
    } catch (err) {
      toast.error(mapError(err) || 'Erro ao salvar titular do posto')
    } finally {
      setPostoAssignmentLoading(false)
    }
  }, [closeTitularPicker, moverPostoParaBancoEspera, ocupanteMap, orderedColabs, postosOrdenados])

  const handleSelecionarNoAutocomplete = useCallback((source: 'picker' | 'dialog', postoId: number, colabId: number) => {
    const candidato = orderedColabs.find((c) => c.id === colabId)
    if (!candidato) return
    const postoDestinoNome = source === 'dialog' && postoId === 0
      ? (postoDialogApelido.trim() || 'novo posto')
      : (funcaoMap.get(postoId) ?? 'posto selecionado')
    if (candidato.funcao_id != null && candidato.funcao_id !== postoId) {
      setPendingAutocompleteSwap({
        source,
        postoId,
        colabId,
        colaboradorNome: candidato.nome,
        postoOrigemNome: funcaoMap.get(candidato.funcao_id) ?? 'posto atual',
        postoDestinoNome,
      })
      return
    }

    if (source === 'dialog') {
      setPostoDialogTitularId(colabId)
      return
    }

    const posto = postosOrdenados.find((item) => item.id === postoId)
    if (!posto) return
    void salvarTitularNoPosto(posto, colabId)
  }, [funcaoMap, orderedColabs, postoDialogApelido, postosOrdenados, salvarTitularNoPosto])

  const handleConfirmarAutocompleteSwap = useCallback(async () => {
    if (!pendingAutocompleteSwap) return

    if (pendingAutocompleteSwap.source === 'dialog') {
      setPostoDialogTitularId(pendingAutocompleteSwap.colabId)
      setPendingAutocompleteSwap(null)
      return
    }

    const posto = postosOrdenados.find((item) => item.id === pendingAutocompleteSwap.postoId)
    setPendingAutocompleteSwap(null)
    if (!posto) return
    await salvarTitularNoPosto(posto, pendingAutocompleteSwap.colabId)
  }, [pendingAutocompleteSwap, postosOrdenados, salvarTitularNoPosto])

  const getDescricaoBuscaColaborador = useCallback((colab: Colaborador) => {
    const postoAtual = colab.funcao_id != null ? (funcaoMap.get(colab.funcao_id) ?? 'Posto') : 'Sem posto'
    const status = getStatusColaborador(colab.id)
    return `${postoAtual} • ${status}`
  }, [funcaoMap, getStatusColaborador])

  const postoDialogTitularAtual = useMemo(
    () => postoDialogTitularId != null ? (orderedColabs.find((colab) => colab.id === postoDialogTitularId) ?? null) : null,
    [orderedColabs, postoDialogTitularId],
  )

  // ─── Escala ──────────────────────────────────────────────────────────
  const escalasOrdenadas = useMemo(
    () => [...(escalas ?? [])].sort((a, b) => b.criada_em.localeCompare(a.criada_em)),
    [escalas],
  )
  const escalaOficialAtual = escalasOrdenadas.find((escala) => escala.status === 'OFICIAL') ?? null
  const escalasHistorico = useMemo(() => {
    const oficialAtualId = escalaOficialAtual?.id ?? null
    return escalasOrdenadas.filter((escala) => escala.status !== 'OFICIAL' && escala.id !== oficialAtualId)
  }, [escalaOficialAtual?.id, escalasOrdenadas])

  type EscalaTab = 'simulacao' | 'oficial' | 'historico'

  const escalaTab: EscalaTab = escalaSelecionada.startsWith('historico:')
    ? 'historico'
    : (escalaSelecionada as EscalaTab)

  const activeEscalaCompleta: EscalaCompletaV3 | null =
    escalaTab === 'simulacao' ? null :
    escalaTab === 'oficial' ? oficialCompleta :
    historicoCompleta

  const exportColaboradoresBase = useMemo(() => {
    if (orderedColabs.length > 0) return orderedColabs
    return colaboradores ?? []
  }, [colaboradores, orderedColabs])

  const equipeEscalaOficial = useMemo(
    () => resolveEscalaEquipe(oficialCompleta, orderedColabs, postosOrdenados),
    [oficialCompleta, orderedColabs, postosOrdenados],
  )

  const equipeEscalaHistorico = useMemo(
    () => resolveEscalaEquipe(historicoCompleta, orderedColabs, postosOrdenados),
    [historicoCompleta, orderedColabs, postosOrdenados],
  )

  const oficialGridData = useMemo(() => {
    if (!oficialCompleta) return null
    return escalaParaCicloGrid(
      oficialCompleta.escala,
      oficialCompleta.alocacoes,
      equipeEscalaOficial.colaboradores,
      equipeEscalaOficial.funcoes,
      regrasPadrao ?? [],
      demandas ?? [],
    )
  }, [oficialCompleta, equipeEscalaOficial, regrasPadrao, demandas])

  const historicoGridData = useMemo(() => {
    if (!historicoCompleta) return null
    return escalaParaCicloGrid(
      historicoCompleta.escala,
      historicoCompleta.alocacoes,
      equipeEscalaHistorico.colaboradores,
      equipeEscalaHistorico.funcoes,
      regrasPadrao ?? [],
      demandas ?? [],
    )
  }, [historicoCompleta, equipeEscalaHistorico, regrasPadrao, demandas])

  const simulacaoPreviewMeses = useMemo(() => {
    if (periodoPreset === '6_MESES') return 6
    if (periodoPreset === '1_ANO') return 12
    return 3
  }, [periodoPreset])

  const simulacaoConfigBase = useMemo(
    () => normalizeSetorSimulacaoConfig(setor?.simulacao_config_json, { hasActivePostos: postosAtivos.length > 0 }),
    [postosAtivos.length, setor?.simulacao_config_json],
  )

  useEffect(() => {
    setSimulacaoConfigDraft(simulacaoConfigBase)
    setRawLivreN(String(simulacaoConfigBase.livre.n))
    setRawLivreK(String(simulacaoConfigBase.livre.k))
  }, [simulacaoConfigBase])

  const simulacaoConfig = simulacaoConfigDraft ?? simulacaoConfigBase

  const persistirSimulacaoConfig = useCallback(async (next: SetorSimulacaoConfig) => {
    setSimulacaoConfigSaving(true)
    try {
      await setoresService.salvarSimulacaoConfig(setorId, next)
    } catch (err) {
      toast.error(mapError(err) || 'Erro ao salvar configuracao da simulacao')
    } finally {
      setSimulacaoConfigSaving(false)
    }
  }, [setorId])

  const atualizarSimulacaoConfig = useCallback((updater: (prev: SetorSimulacaoConfig) => SetorSimulacaoConfig) => {
    setSimulacaoConfigDraft((prev) => {
      const base = prev ?? simulacaoConfigBase
      const next = normalizeSetorSimulacaoConfig(updater(base), { hasActivePostos: postosAtivos.length > 0 })
      void persistirSimulacaoConfig(next)
      return next
    })
  }, [persistirSimulacaoConfig, postosAtivos.length, simulacaoConfigBase])

  const overridesLocaisSetor = useMemo(
    () => new Map(
      Object.entries(simulacaoConfig.setor.overrides_locais).flatMap(([key, value]) => (
        /^\d+$/.test(key) ? [[Number(key), value] as const] : []
      )),
    ),
    [simulacaoConfig.setor.overrides_locais],
  )

  const mergeOverrideLocalWithBase = useCallback((
    colaboradorId: number,
    nextResolved: { fixa: DiaSemana | null; variavel: DiaSemana | null },
  ): SetorSimulacaoOverrideLocal | null => {
    const baseFixa = regrasMap.get(colaboradorId)?.folga_fixa_dia_semana ?? null
    const baseVariavel = regrasMap.get(colaboradorId)?.folga_variavel_dia_semana ?? null
    const nextOverride: SetorSimulacaoOverrideLocal = {}

    if (nextResolved.fixa !== baseFixa) nextOverride.fixa = nextResolved.fixa
    if (nextResolved.variavel !== baseVariavel) nextOverride.variavel = nextResolved.variavel

    return Object.keys(nextOverride).length > 0 ? nextOverride : null
  }, [regrasMap])

  useEffect(() => {
    setDemandaDraftPreview(null)
  }, [setorId])

  const demandaPorDiaDraft = useMemo(
    () => demandaDraftPreview ? buildDemandaPorDiaFromDraft(demandaDraftPreview) : null,
    [demandaDraftPreview],
  )

  const demandaDomingoSetor = useMemo(
    () => demandaPorDiaDraft?.[6] ?? Math.max(
      0,
      ...((demandas ?? [])
        .filter((demanda) => demanda.dia_semana === 'DOM' || demanda.dia_semana === null)
        .map((demanda) => demanda.min_pessoas)),
    ),
    [demandaPorDiaDraft, demandas],
  )

  const demandaPorDiaPreview = useMemo(() => {
    if (demandaPorDiaDraft) return demandaPorDiaDraft
    if (derivados?.demandaPorDia?.length === 7) return derivados.demandaPorDia
    const demanda = [0, 0, 0, 0, 0, 0, 0]
    for (const item of demandas ?? []) {
      if (item.dia_semana == null) {
        for (let idx = 0; idx < 7; idx += 1) {
          demanda[idx] = Math.max(demanda[idx] ?? 0, item.min_pessoas)
        }
        continue
      }
      const index = DIAS_SEMANA.indexOf(item.dia_semana)
      if (index >= 0) demanda[index] = Math.max(demanda[index] ?? 0, item.min_pessoas)
    }
    return demanda
  }, [demandaPorDiaDraft, demandas, derivados?.demandaPorDia])

  const participantesEscalaAtivos = useMemo(
    () => listEscalaParticipantes(orderedColabs, postosAtivos),
    [orderedColabs, postosAtivos],
  )

  const storePreviewAvisos = useMemo(
    () => (derivados?.avisos ?? []).filter((aviso) => !PREVIEW_OWNED_STORE_WARNING_IDS.has(aviso.id)),
    [derivados?.avisos],
  )

  const horaAberturaPreview = setor?.hora_abertura ?? '08:00'
  const horaFechamentoPreview = setor?.hora_fechamento ?? '20:00'

  const previewSetorIntermitentesRegras = useMemo(
    () => participantesEscalaAtivos
      .filter(({ colaborador }) => (colaborador.tipo_trabalhador ?? 'CLT') === 'INTERMITENTE')
      .map(({ colaborador, funcao }) => {
        const regrasDoColab = regrasHorarioByColab.get(colaborador.id) ?? []
        const regrasPorDia = new Map<DiaSemana, RegraHorarioColaborador>()
        let folgaVariavel: DiaSemana | null = null
        for (const regra of regrasDoColab) {
          if (regra.dia_semana_regra != null) regrasPorDia.set(regra.dia_semana_regra, regra)
          if (regra.dia_semana_regra === null && regra.folga_variavel_dia_semana) {
            folgaVariavel = regra.folga_variavel_dia_semana
          }
        }
        return { colaborador, funcao, regrasPorDia, folgaVariavel, ehTipoB: folgaVariavel != null }
      }),
    [participantesEscalaAtivos, regrasHorarioByColab],
  )

  const previewSetorIntermitentesCoberturaPorDia = useMemo(() => {
    const cobertura = Object.fromEntries(
      DIAS_SEMANA.map((dia) => [dia, 0]),
    ) as Record<DiaSemana, number>

    // Apenas tipo A (fixo) desconta demanda — tipo B participa do ciclo, nao e cobertura garantida
    for (const { regrasPorDia, ehTipoB } of previewSetorIntermitentesRegras) {
      if (ehTipoB) continue
      for (const dia of DIAS_SEMANA) {
        if (regrasPorDia.has(dia)) cobertura[dia] += 1
      }
    }

    return cobertura
  }, [previewSetorIntermitentesRegras])

  const previewSetorIntermitentesDomingoGarantidos = useMemo(
    () => previewSetorIntermitentesRegras
      .filter(({ ehTipoB }) => !ehTipoB)  // Apenas tipo A (fixo) = cobertura garantida
      .filter(({ regrasPorDia }) => regrasPorDia.has('DOM'))
      .length,
    [previewSetorIntermitentesRegras],
  )

  const demandaDomingoCicloPreview = useMemo(
    () => resolveSundayRotatingDemand({
      totalSundayDemand: demandaDomingoSetor,
      guaranteedSundayCoverage: previewSetorIntermitentesDomingoGarantidos,
    }),
    [demandaDomingoSetor, previewSetorIntermitentesDomingoGarantidos],
  )

  const demandaPorDiaPreviewCiclo = useMemo(
    () => demandaPorDiaPreview.map((demandaDia, index) => {
      const dia = DIAS_SEMANA[index]
      return Math.max(0, demandaDia - (dia ? (previewSetorIntermitentesCoberturaPorDia[dia] ?? 0) : 0))
    }),
    [demandaPorDiaPreview, previewSetorIntermitentesCoberturaPorDia],
  )

  const demandaSegmentosPreviewCiclo = useMemo(
    () => (demandas ?? []).flatMap((demanda) => {
      const diasAlvo = demanda.dia_semana != null ? [demanda.dia_semana] : DIAS_SEMANA

      return diasAlvo.map((dia) => {
        // Apenas tipo A (fixo) desconta segmentos — tipo B participa do ciclo
        const coberturaGarantida = previewSetorIntermitentesRegras.reduce((total, { regrasPorDia, ehTipoB }) => {
          if (ehTipoB) return total
          return total + (intermitenteRuleCoversSegment(
            regrasPorDia.get(dia),
            demanda.hora_inicio,
            demanda.hora_fim,
            horaAberturaPreview,
            horaFechamentoPreview,
          ) ? 1 : 0)
        }, 0)

        return {
          dia_semana: dia,
          hora_inicio: demanda.hora_inicio,
          hora_fim: demanda.hora_fim,
          min_pessoas: Math.max(0, demanda.min_pessoas - coberturaGarantida),
        }
      })
    }),
    [demandas, horaAberturaPreview, horaFechamentoPreview, previewSetorIntermitentesRegras],
  )

  const tipoBIds = useMemo(
    () => new Set(previewSetorIntermitentesRegras.filter(({ ehTipoB }) => ehTipoB).map(({ colaborador }) => colaborador.id)),
    [previewSetorIntermitentesRegras],
  )

  const setorSimulacaoInfo = useMemo(() => {
    // Tipo B entra no pool rotativo (conta no N). Tipo A fica fora.
    const participantesPreview = participantesEscalaAtivos
      .filter(({ colaborador }) => {
        const tipo = colaborador.tipo_trabalhador ?? 'CLT'
        if (tipo !== 'INTERMITENTE') return true
        return tipoBIds.has(colaborador.id)
      })
    const N = participantesPreview.length
    if (N < 1) {
      return {
        n: 0,
        k: 0,
        origemN: 'N = 0 participantes ativos com posto.',
        origemK: 'Sem participantes ativos no setor: anexe titulares aos postos ou use o modo Livre.',
      }
    }

    if (demandaDomingoCicloPreview.residualSundayDemand > 0) {
      const kEfetivo = Math.min(demandaDomingoCicloPreview.residualSundayDemand, N)
      const limitado = kEfetivo < demandaDomingoCicloPreview.residualSundayDemand
      const prefixoIntermitente = demandaDomingoCicloPreview.guaranteedSundayCoverage > 0
        ? `DOM bruto=${demandaDomingoCicloPreview.totalSundayDemand}, -${demandaDomingoCicloPreview.guaranteedSundayCoverage} intermitente(s) ativo(s) no DOM => liquido=${demandaDomingoCicloPreview.residualSundayDemand}. `
        : ''
      return {
        n: N,
        k: kEfetivo,
        origemN: `N pelo setor: ${N} participante(s) ativo(s) com posto.`,
        origemK: limitado
          ? `K: ${prefixoIntermitente}Limitado a ${kEfetivo} porque o pool rotativo CLT tem ${N} participante(s) ativos.`
          : demandaDomingoCicloPreview.guaranteedSundayCoverage > 0
            ? `K pelo setor: ${prefixoIntermitente}O ciclo CLT precisa cobrir ${kEfetivo}.`
            : `K pelo setor: pico de demanda em DOM/padrao = ${demandaDomingoCicloPreview.totalSundayDemand}.`,
      }
    }

    const sugerido = sugerirK(N, 7)
    return {
      n: N,
      k: sugerido,
      origemN: `N pelo setor: ${N} participante(s) ativo(s) com posto.`,
      origemK: `Sem demanda DOM/padrao cadastrada: usando K sugerido ${sugerido}.`,
    }
  }, [demandaDomingoCicloPreview, participantesEscalaAtivos, tipoBIds])

  const modoSimulacaoEfetivo: SetorSimulacaoMode = simulacaoConfig.mode

  const previewLivreFolgas = useMemo(
    () => Array.from({ length: simulacaoConfig.livre.n }, (_, idx) => simulacaoConfig.livre.folgas_forcadas[idx] ?? { fixa: null, variavel: null }),
    [simulacaoConfig.livre.folgas_forcadas, simulacaoConfig.livre.n],
  )

  const previewSetorRows = useMemo(() => {
    return participantesEscalaAtivos
      .filter(({ colaborador }) => {
        const tipo = colaborador.tipo_trabalhador ?? 'CLT'
        if (tipo !== 'INTERMITENTE') return true
        return tipoBIds.has(colaborador.id) // Tipo B entra no simula-ciclo
      })
      .map(({ funcao, colaborador }) => {
        const isTipoB = tipoBIds.has(colaborador.id)
        const regra = regrasMap.get(colaborador.id) ?? null
        const overrideLocal = overridesLocaisSetor.get(colaborador.id)

        // Tipo B: folga_fixa sempre null, folga_variavel da regra padrao
        const baseFixa = isTipoB ? null : (regra?.folga_fixa_dia_semana ?? null)
        const baseVariavel = isTipoB
          ? (previewSetorIntermitentesRegras.find((r) => r.colaborador.id === colaborador.id)?.folgaVariavel ?? null)
          : (regra?.folga_variavel_dia_semana ?? null)
        const fixaAtual = isTipoB ? null : resolveOverrideField(overrideLocal, 'fixa', baseFixa)
        const variavelAtual = isTipoB ? baseVariavel : resolveOverrideField(overrideLocal, 'variavel', baseVariavel)
        return {
          funcao,
          titular: colaborador,
          fixaAtual,
          variavelAtual,
          overrideFixaLocal: !isTipoB && fixaAtual !== baseFixa,
          overrideVariavelLocal: !isTipoB && variavelAtual !== baseVariavel,
          baseFixaColaborador: !isTipoB && fixaAtual === baseFixa && baseFixa != null,
          baseVariavelColaborador: variavelAtual === baseVariavel && baseVariavel != null,
          folgaFixaDom: fixaAtual === 'DOM',
          folgaForcada: {
            folga_fixa_dia: diaSemanaParaIdxPreview(fixaAtual),
            folga_variavel_dia: diaSemanaParaIdxPreview(variavelAtual),
            folga_fixa_dom: fixaAtual === 'DOM',
          },
          isTipoB,
        }
      })
  }, [overridesLocaisSetor, participantesEscalaAtivos, previewSetorIntermitentesRegras, regrasMap, tipoBIds])

  const previewSetorSemTitular = useMemo(
    () => Math.max(0, postosAtivos.length - participantesEscalaAtivos.length),
    [participantesEscalaAtivos.length, postosAtivos.length],
  )

  const previewRuleConfig = useMemo<RuleConfig>(() => {
    const next: RuleConfig = {}
    for (const regra of regras ?? []) {
      next[regra.codigo] = regra.status_efetivo
    }
    for (const [codigo, status] of Object.entries(solverSessionConfig.rulesOverride)) {
      next[codigo] = status
      if (codigo === 'H3_DOM_MAX_CONSEC') {
        next.H3_DOM_MAX_CONSEC_M = status
        next.H3_DOM_MAX_CONSEC_F = status
      }
    }
    next.H3_DOM_CICLO_EXATO ??= 'SOFT'
    next.H3_DOM_MAX_CONSEC_M ??= next.H3_DOM_MAX_CONSEC ?? 'HARD'
    next.H3_DOM_MAX_CONSEC_F ??= next.H3_DOM_MAX_CONSEC ?? 'HARD'
    return next
  }, [regras, solverSessionConfig.rulesOverride])

  const simulacaoPreview = useMemo(() => {
    const resultadoErro = (erro: string, sugestao?: string): SimulaCicloOutput => ({
      sucesso: false,
      erro,
      sugestao,
      grid: [],
      cobertura_dia: [],
      ciclo_semanas: 0,
      stats: {
        folgas_por_pessoa_semana: 0,
        cobertura_min: 0,
        cobertura_max: 0,
        h1_violacoes: 0,
        domingos_consecutivos_max: 0,
        sem_TT: false,
        sem_H1_violation: false,
      },
    })

    const effectiveN = modoSimulacaoEfetivo === 'SETOR' ? setorSimulacaoInfo.n : simulacaoConfig.livre.n
    const effectiveK = modoSimulacaoEfetivo === 'SETOR' ? setorSimulacaoInfo.k : simulacaoConfig.livre.k
    const rowLabels = modoSimulacaoEfetivo === 'SETOR'
      ? previewSetorRows.map((row) => row.titular.nome)
      : Array.from({ length: simulacaoConfig.livre.n }, (_, idx) => `Pessoa ${idx + 1}`)

    const folgasForcadas = modoSimulacaoEfetivo === 'SETOR'
      ? previewSetorRows.map((row) => row.folgaForcada)
      : previewLivreFolgas.map((folga) => ({
          folga_fixa_dia: diaSemanaParaIdxPreview(folga.fixa),
          folga_variavel_dia: diaSemanaParaIdxPreview(folga.variavel),
          folga_fixa_dom: false,
        }))

    const multiPassResult: MultiPassResult | null =
      regimeEfetivo !== '5X2'
        ? null
        : runPreviewMultiPass({
            fase1Input: {
              num_postos: effectiveN,
              trabalham_domingo: effectiveK,
              num_meses: simulacaoPreviewMeses,
              folgas_forcadas: folgasForcadas.some((folga) => folga.folga_fixa_dia != null || folga.folga_variavel_dia != null || folga.folga_fixa_dom)
                ? folgasForcadas
                : undefined,
              demanda_por_dia: demandaPorDiaPreviewCiclo,
            },
            participants: previewSetorRows.map((row) => ({
              id: row.titular.id,
              nome: row.titular.nome,
              sexo: row.titular.sexo as 'M' | 'F',
              folga_fixa_dom: row.folgaFixaDom,
            })),
            demandaPorDia: demandaPorDiaPreviewCiclo,
            trabalhamDomingo: effectiveK,
            rules: previewRuleConfig,
            demandaSegmentos: demandaSegmentosPreviewCiclo,
            horaAbertura: horaAberturaPreview,
            horaFechamento: horaFechamentoPreview,
          })

    const resultado: SimulaCicloOutput = multiPassResult?.output
      ?? resultadoErro(
          'Preview Nível 1 disponível apenas para setores 5x2.',
          'Mude para o modo Livre para explorar o ciclo ou gere a escala real pelo solver.',
        )

    const savePadrao = modoSimulacaoEfetivo === 'SETOR' && resultado.sucesso
      ? previewSetorRows.flatMap((row, idx) => {
          const previewRow = resultado.grid[idx]
          if (!previewRow) return []
          return [{
            colaborador_id: row.titular.id,
            folga_fixa_dia_semana: row.folgaFixaDom ? 'DOM' as DiaSemana : idxPreviewParaDiaSemana(previewRow.folga_fixa_dia),
            folga_variavel_dia_semana: idxPreviewParaDiaSemana(previewRow.folga_variavel_dia),
          }]
        })
      : []

    const pinnedRows = modoSimulacaoEfetivo === 'SETOR' && resultado.sucesso
      ? previewSetorRows.map((row, idx) => ({ rowIndex: idx, colaboradorId: row.titular.id }))
      : []

    return {
      mode: modoSimulacaoEfetivo,
      effectiveN,
      effectiveK,
      rowLabels,
      resultado,
      origemN: modoSimulacaoEfetivo === 'SETOR'
        ? setorSimulacaoInfo.origemN
        : `N livre salvo neste setor: ${simulacaoConfig.livre.n}.`,
      origemK: modoSimulacaoEfetivo === 'SETOR'
        ? setorSimulacaoInfo.origemK
        : `K livre salvo neste setor: ${simulacaoConfig.livre.k}.`,
      savePadrao,
      pinnedRows,
      previewRows: previewSetorRows,
      foraDoPreview: 0, // intermitentes agora aparecem no grid com NT
      semTitular: previewSetorSemTitular,
      multiPassResult,
    }
  }, [
    demandaPorDiaPreviewCiclo,
    demandaSegmentosPreviewCiclo,
    modoSimulacaoEfetivo,
    previewLivreFolgas,
    previewRuleConfig,
    previewSetorRows,
    previewSetorSemTitular,
    regimeEfetivo,
    horaAberturaPreview,
    horaFechamentoPreview,
    setorSimulacaoInfo,
    simulacaoConfig.livre.k,
    simulacaoConfig.livre.n,
    simulacaoPreviewMeses,
  ])

  const previewDiagnostics = useMemo<PreviewDiagnostic[]>(() => {
    if (modoSimulacaoEfetivo !== 'SETOR') return []
    return simulacaoPreview.multiPassResult?.diagnostics ?? []
  }, [modoSimulacaoEfetivo, simulacaoPreview])

  const previewGate = useMemo<PreviewGate>(
    () => resolvePreviewGate(previewDiagnostics),
    [previewDiagnostics],
  )

  const abrirAnaliseIa = useCallback(() => {
    const allDiags = advisoryResult?.diagnostics ?? previewDiagnostics
    const failedTitles = allDiags
      .filter((d) => d.severity === 'error')
      .map((d) => d.title)

    if (failedTitles.length > 0) {
      const prompt = `Analise os problemas da escala do setor ${setor?.nome ?? ''}: ${failedTitles.join('; ')}`
      useIaStore.getState().setPendingAutoMessage(prompt)
    }
    useIaStore.getState().setAberto(true)
  }, [advisoryResult, previewDiagnostics, setor?.nome])

  const previewAutoOverrides = useMemo<RuleConfig>(() => {
    const next: RuleConfig = {}
    for (const diagnostic of previewDiagnostics) {
      if (diagnostic.gate !== 'CONFIRM_OVERRIDE' || !diagnostic.overridableBy) continue
      Object.assign(next, diagnostic.overridableBy)
    }
    return next
  }, [previewDiagnostics])

  const simulacaoGridData = useMemo(() => {
    if (!simulacaoPreview.resultado.sucesso) return null

    // Grid base (só CLTs — rotação)
    const grid = simulacaoParaCicloGrid(
      simulacaoPreview.resultado,
      simulacaoPreview.rowLabels,
      demandaPorDiaPreview, // demanda BRUTA — grid mostra cobertura real
    )

    // Enriquecer rows com info do SETOR mode (inclui tipo B que agora participa do simula-ciclo)
    let enrichedRows = grid.rows
    if (simulacaoPreview.mode === 'SETOR') {
      // Mapa de regras por dia pra tipo B (pra converter T→NT em dias sem regra)
      const tipoBRegrasMap = new Map(
        previewSetorIntermitentesRegras
          .filter(({ ehTipoB }) => ehTipoB)
          .map(({ colaborador, regrasPorDia, folgaVariavel }) => [colaborador.id, { regrasPorDia, folgaVariavel }]),
      )

      enrichedRows = grid.rows.map((row, index) => {
        const previewRow = simulacaoPreview.previewRows[index]
        if (!previewRow) return row

        const tipoBInfo = tipoBRegrasMap.get(previewRow.titular.id)
        const isTipoB = !!tipoBInfo

        // Tipo B: pos-processar — dias sem regra viram NT
        let semanas = row.semanas
        if (isTipoB) {
          semanas = row.semanas.map((semana) =>
            semana.map((simbolo, diaIdx) => {
              const dia = DIAS_ORDEM[diaIdx]
              if (!dia || !tipoBInfo.regrasPorDia.has(dia)) return 'NT' as Simbolo
              return simbolo
            }),
          )
        }

        return {
          ...row,
          semanas,
          id: previewRow.titular.id,
          posto: previewRow.funcao.apelido,
          fixa: isTipoB ? null : (previewRow.folgaFixaDom ? 'DOM' : row.fixa),
          blocked: isTipoB ? false : false,
          blockedFixa: isTipoB ? true : undefined,
          overrideFixaLocal: isTipoB ? false : previewRow.overrideFixaLocal,
          overrideVariavelLocal: isTipoB ? false : previewRow.overrideVariavelLocal,
          baseFixaColaborador: isTipoB ? false : previewRow.baseFixaColaborador,
          baseVariavelColaborador: previewRow.baseVariavelColaborador,
        }
      })
    }

    // Rows de tipo A (fixo) — nao participam do simula-ciclo
    const numSemanas = grid.rows[0]?.semanas.length ?? 0
    const tipoARows: CicloGridRow[] = previewSetorIntermitentesRegras
      .filter(({ ehTipoB }) => !ehTipoB)
      .map(({ colaborador, funcao, regrasPorDia }) => {
        const semanaBase: Simbolo[] = DIAS_ORDEM.map((dia) => {
          if (regrasPorDia.has(dia)) return dia === 'DOM' ? 'DT' as Simbolo : 'T' as Simbolo
          return 'NT' as Simbolo
        })
        return {
          id: colaborador.id,
          nome: colaborador.nome,
          posto: funcao.apelido,
          fixa: null,
          variavel: null,
          blocked: true,
          semanas: Array.from({ length: numSemanas }, () => [...semanaBase]),
        }
      })

    const allRows = [...enrichedRows, ...tipoARows]

    // Recalcular cobertura das rows finais (com NT aplicado)
    const coberturaFinal = grid.cobertura.map((_, semIdx) => {
      return Array.from({ length: 7 }, (__, diaIdx) => {
        return allRows.filter((row) => {
          const simbolo = row.semanas[semIdx]?.[diaIdx]
          return simbolo === 'T' || simbolo === 'DT'
        }).length
      })
    })

    return {
      ...grid,
      rows: allRows,
      cobertura: coberturaFinal,
    }
  }, [demandaPorDiaPreview, previewSetorIntermitentesRegras, simulacaoPreview])

  // ─── Form sync ───────────────────────────────────────────────────────
  useEffect(() => {
    if (setor) {
      setorForm.reset({
        nome: setor.nome,
        icone: setor.icone,
        hora_abertura: setor.hora_abertura,
        hora_fechamento: setor.hora_fechamento,
        regime_escala: setor.regime_escala,
      })
    }
  }, [setor, setorForm])

  useEffect(() => {
    setPeriodoGeracao(resolvePresetRange(periodoPreset, new Date(), inicioSemanaEscala))
  }, [periodoPreset, inicioSemanaEscala])

  useEffect(() => {
    setPreviewSelectedWeek(0)
  }, [modoSimulacaoEfetivo, simulacaoPreview.effectiveK, simulacaoPreview.effectiveN])

  // Fallback: se oficial sumir, volta para simulacao
  useEffect(() => {
    if (!escalaOficialAtual && escalaSelecionada === 'oficial') {
      setEscalaSelecionada('simulacao')
    }
  }, [escalaOficialAtual, escalaSelecionada])

  // Sincroniza historicoSelecionadaId com escalaSelecionada
  useEffect(() => {
    if (escalasHistorico.length === 0) {
      setHistoricoSelecionadaId(null)
      setHistoricoCompleta(null)
      if (escalaSelecionada.startsWith('historico:')) setEscalaSelecionada('simulacao')
      return
    }
    const match = escalaSelecionada.match(/^historico:(\d+)$/)
    if (match) {
      const id = parseInt(match[1], 10)
      if (escalasHistorico.some((e) => e.id === id)) {
        setHistoricoSelecionadaId(id)
        return
      }
      setHistoricoSelecionadaId(escalasHistorico[0].id)
      setEscalaSelecionada(`historico:${escalasHistorico[0].id}`)
      return
    }
    if (!historicoSelecionadaId || !escalasHistorico.some((e) => e.id === historicoSelecionadaId)) {
      setHistoricoSelecionadaId(escalasHistorico[0].id)
    }
  }, [escalasHistorico, escalaSelecionada, historicoSelecionadaId])

  const carregarDetalheEscala = useCallback(async (escalaId: number) => {
    try {
      return await escalasService.buscar(escalaId)
    } catch (err) {
      toast.error(mapError(err) || 'Erro ao carregar escala')
      return null
    }
  }, [])

  useEffect(() => {
    let canceled = false

    async function hydrateOfficialDetail() {
      if (!escalaOficialAtual) {
        setOficialCompleta(null)
        return
      }
      if (oficialCompleta?.escala.id === escalaOficialAtual.id) return

      const detail = await carregarDetalheEscala(escalaOficialAtual.id)
      if (!canceled) setOficialCompleta(detail)
    }

    void hydrateOfficialDetail()
    return () => {
      canceled = true
    }
  }, [carregarDetalheEscala, escalaOficialAtual, oficialCompleta?.escala.id])

  useEffect(() => {
    let canceled = false

    async function run() {
      if (escalaSelecionada === 'oficial') {
        if (!escalaOficialAtual) {
          setOficialCompleta(null)
          setCarregandoTabEscala(false)
          return
        }
        if (oficialCompleta?.escala.id === escalaOficialAtual.id) {
          setCarregandoTabEscala(false)
          return
        }
        setCarregandoTabEscala(true)
        const detail = await carregarDetalheEscala(escalaOficialAtual.id)
        if (!canceled) setOficialCompleta(detail)
        if (!canceled) setCarregandoTabEscala(false)
        return
      }

      if (escalaSelecionada.startsWith('historico:')) {
        if (!historicoSelecionadaId) {
          setHistoricoCompleta(null)
          setCarregandoTabEscala(false)
          return
        }
        setCarregandoTabEscala(true)
        const detail = await carregarDetalheEscala(historicoSelecionadaId)
        if (!canceled) setHistoricoCompleta(detail)
        if (!canceled) setCarregandoTabEscala(false)
        return
      }

      setCarregandoTabEscala(false)
    }

    void run()
    return () => {
      canceled = true
    }
  }, [carregarDetalheEscala, escalaOficialAtual, escalaSelecionada, historicoSelecionadaId, oficialCompleta?.escala.id])

  // ─── Handlers ────────────────────────────────────────────────────────
  const handleSalvarTudo = useCallback(async (): Promise<boolean> => {
    const formData = setorForm.getValues()
    const nome = formData.nome.trim()
    if (!nome) {
      toast.error('Nome do setor e obrigatorio')
      return false
    }
    const draft = demandaEditorRef.current?.getDraft()
    setSalvandoTudo(true)
    try {
      // Onda 3: save unificado — setor + timeline em uma transacao
      const mapSeg = (s: { hora_inicio: string; hora_fim: string; min_pessoas: number; override: boolean }) => ({
        hora_inicio: s.hora_inicio, hora_fim: s.hora_fim, min_pessoas: s.min_pessoas, override: s.override,
      })
      await setoresService.salvarCompleto({
        setor_id: setorId,
        setor: {
          nome,
          icone: formData.icone ?? null,
          hora_abertura: formData.hora_abertura,
          hora_fechamento: formData.hora_fechamento,
          regime_escala: formData.regime_escala,
        },
        timeline: draft ? {
          setor_id: setorId,
          padrao: {
            hora_abertura: draft.padrao.hora_abertura,
            hora_fechamento: draft.padrao.hora_fechamento,
            segmentos: draft.padrao.segmentos.map(mapSeg),
          },
          dias: DIAS_SEMANA.map((dia) => {
            const dd = draft.dias[dia]
            const usaPadrao = dd.usa_padrao
            return {
              dia_semana: dia,
              ativo: dd.ativo,
              usa_padrao: usaPadrao,
              hora_abertura: usaPadrao ? draft.padrao.hora_abertura : dd.hora_abertura,
              hora_fechamento: usaPadrao ? draft.padrao.hora_fechamento : dd.hora_fechamento,
              segmentos: (usaPadrao ? draft.padrao.segmentos : dd.segmentos).map(mapSeg),
            }
          }),
        } : {
          setor_id: setorId,
          padrao: { hora_abertura: formData.hora_abertura, hora_fechamento: formData.hora_fechamento, segmentos: [] },
          dias: [],
        },
      })
      if (draft) demandaEditorRef.current?.markClean()
      setorForm.reset(formData)
      toast.success('Setor salvo')
      return true
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao salvar')
      return false
    } finally {
      setSalvandoTudo(false)
    }
  }, [setorId, setorForm])

  const handleSalvarExcDemanda = async () => {
    if (!excDemandaForm.data || !excDemandaForm.hora_inicio || !excDemandaForm.hora_fim) {
      toast.error('Preencha data, hora inicio e hora fim')
      return
    }
    setExcDemandaSalvando(true)
    try {
      const created = await setoresService.salvarDemandaExcecaoData({
        setor_id: setorId,
        data: excDemandaForm.data,
        hora_inicio: excDemandaForm.hora_inicio,
        hora_fim: excDemandaForm.hora_fim,
        min_pessoas: excDemandaForm.min_pessoas,
        override: excDemandaForm.override,
      })
      setDemandasExcecao((prev) => [...prev, created])
      setShowExcDemandaDialog(false)
      setExcDemandaForm({ data: '', hora_inicio: '', hora_fim: '', min_pessoas: 1, override: false })
      toast.success('Excecao de demanda salva')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao salvar excecao de demanda')
    } finally {
      setExcDemandaSalvando(false)
    }
  }

  const handleDeletarExcDemanda = async (excId: number) => {
    try {
      await setoresService.deletarDemandaExcecaoData(excId)
      setDemandasExcecao((prev) => prev.filter((e) => e.id !== excId))
      toast.success('Excecao removida')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao remover excecao')
    }
  }

  const handleArquivar = async () => {
    try {
      await setoresService.atualizar(setorId, { ativo: false })
      toast.success('Setor arquivado')
      navigate('/setores')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao arquivar setor')
    }
  }

  const handleMudarModoSimulacao = useCallback((mode: SetorSimulacaoMode) => {
    if (mode === simulacaoConfig.mode) return
    setPreviewSelectedWeek(0)
    if (mode === 'LIVRE') {
      setRawLivreN(String(simulacaoConfig.livre.n))
      setRawLivreK(String(simulacaoConfig.livre.k))
    }
    atualizarSimulacaoConfig((prev) => ({ ...prev, mode }))
  }, [atualizarSimulacaoConfig, simulacaoConfig.livre.k, simulacaoConfig.livre.n, simulacaoConfig.mode])

  const handleLivreNChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value
    setRawLivreN(raw)
    if (raw === '') return
    const val = parseInt(raw, 10)
    if (Number.isNaN(val) || val < 1) return
    const nextN = Math.max(1, Math.min(val, 99))
    const nextK = sugerirK(nextN, 7)
    setRawLivreN(String(nextN))
    setRawLivreK(String(nextK))
    atualizarSimulacaoConfig((prev) => ({
      ...prev,
      livre: {
        n: nextN,
        k: nextK,
        folgas_forcadas: prev.livre.folgas_forcadas.slice(0, nextN),
      },
    }))
  }, [atualizarSimulacaoConfig])

  const handleLivreKChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value
    setRawLivreK(raw)
    if (raw === '') return
    const val = parseInt(raw, 10)
    if (Number.isNaN(val) || val < 0) return
    const nextK = Math.max(0, Math.min(val, simulacaoConfig.livre.n))
    setRawLivreK(String(nextK))
    atualizarSimulacaoConfig((prev) => ({
      ...prev,
      livre: {
        ...prev.livre,
        k: nextK,
      },
    }))
  }, [atualizarSimulacaoConfig, simulacaoConfig.livre.n])

  const handleResetarSimulacao = useCallback((_mode: 'automatico' | 'colaboradores' = 'automatico') => {
    setPreviewSelectedWeek(0)
    if (simulacaoPreview.mode === 'LIVRE') {
      const nextK = sugerirK(DEFAULT_SIMULACAO_LIVRE_N, 7)
      setRawLivreN(String(DEFAULT_SIMULACAO_LIVRE_N))
      setRawLivreK(String(nextK))
      atualizarSimulacaoConfig((prev) => ({
        ...prev,
        livre: {
          n: DEFAULT_SIMULACAO_LIVRE_N,
          k: nextK,
          folgas_forcadas: [],
        },
      }))
      toast.success('Simulacao livre resetada')
      return
    }

    atualizarSimulacaoConfig((prev) => ({
      ...prev,
      setor: { ...prev.setor, overrides_locais: {} },
    }))
    toast.success('Folgas restauradas dos colaboradores')
  }, [atualizarSimulacaoConfig, simulacaoPreview.mode])

  const handlePreviewFolgaChange = useCallback((colaboradorId: number, field: 'fixa' | 'variavel', value: DiaSemana | null) => {
    if (simulacaoPreview.mode === 'LIVRE') {
      const rowIndex = colaboradorId
      const nextFolgas = Array.from(
        { length: simulacaoConfig.livre.n },
        (_, idx) => simulacaoConfig.livre.folgas_forcadas[idx] ?? { fixa: null, variavel: null },
      )
      const current = nextFolgas[rowIndex] ?? { fixa: null, variavel: null }
      nextFolgas[rowIndex] = {
        ...current,
        [field]: value,
      }
      atualizarSimulacaoConfig((prev) => ({
        ...prev,
        livre: {
          ...prev.livre,
          folgas_forcadas: nextFolgas,
        },
      }))
      return
    }

    atualizarSimulacaoConfig((prev) => {
      const baseFixa = regrasMap.get(colaboradorId)?.folga_fixa_dia_semana ?? null
      const baseVariavel = regrasMap.get(colaboradorId)?.folga_variavel_dia_semana ?? null
      const current = prev.setor.overrides_locais[String(colaboradorId)]
      const nextResolved = {
        fixa: field === 'fixa' ? value : resolveOverrideField(current, 'fixa', baseFixa),
        variavel: field === 'variavel' ? value : resolveOverrideField(current, 'variavel', baseVariavel),
      }
      const nextOverride = mergeOverrideLocalWithBase(colaboradorId, nextResolved)
      const nextOverrides = { ...prev.setor.overrides_locais }
      if (nextOverride) {
        nextOverrides[String(colaboradorId)] = nextOverride
      } else {
        delete nextOverrides[String(colaboradorId)]
      }
      return {
        ...prev,
        setor: {
          ...prev.setor,
          overrides_locais: nextOverrides,
        },
      }
    })
  }, [atualizarSimulacaoConfig, mergeOverrideLocalWithBase, regrasMap, simulacaoConfig.livre.folgas_forcadas, simulacaoConfig.livre.n, simulacaoPreview.mode])

  // ─── Geracao inline ──────────────────────────────────────────────────
  const handleGerar = async () => {
    const dataInicio = periodoGeracao.data_inicio
    const dataFim = periodoGeracao.data_fim
    if (!dataInicio || !dataFim) {
      toast.error('Defina data inicial e final antes de gerar')
      return
    }
    if (dataInicio > dataFim) {
      toast.error('A data final precisa ser maior ou igual a data inicial')
      return
    }

    if (modoSimulacaoEfetivo === 'SETOR' && previewDiagnostics.length > 0) {
      const previewAvisosOperacao: AvisoEscala[] = previewDiagnostics.map((diagnostic) => ({
        id: `preview_${diagnostic.code}`,
        nivel: diagnostic.severity === 'error' ? 'erro' : diagnostic.severity === 'warning' ? 'aviso' : 'info',
        titulo: diagnostic.title,
        detalhe: diagnostic.detail,
        origem: 'operacao',
      }))
      setAvisosOperacao(previewAvisosOperacao)

      if (previewGate === 'BLOCK') {
        toastInfeasible(previewDiagnostics[0]?.title ?? 'Preview bloqueou a geracao.', () => useIaStore.getState().setAberto(true))
        return
      }

      if (previewGate === 'CONFIRM_OVERRIDE') {
        const confirmed = window.confirm(
          `${previewDiagnostics[0]?.title ?? 'O preview detectou um bloqueio relaxavel.'}\n\n${previewDiagnostics.map((item) => `- ${item.detail}`).join('\n')}\n\nDeseja gerar assim mesmo em modo exploratorio?`,
        )
        if (!confirmed) {
          return
        }
      }
    }

    // Salva tudo antes de gerar (garante que demandas estao no banco)
    if (isDirty) {
      const saved = await handleSalvarTudo()
      if (!saved) {
        return
      }
    }

    // Preflight
    setAvisosOperacao([]) // limpa avisos anteriores
    try {
      const preflight = await escalasService.preflight(setorId, { data_inicio: dataInicio, data_fim: dataFim })
      if (!preflight.ok) {
        const blockerAvisos: AvisoEscala[] = preflight.blockers.map((b, i) => ({
          id: `preflight_${i}`,
          nivel: 'erro' as const,
          titulo: b.mensagem,
          detalhe: b.detalhe ?? undefined,
          origem: 'operacao' as const,
        }))
        setAvisosOperacao(blockerAvisos)
        const msg = preflight.blockers.map((b) => b.mensagem).join(' | ') || 'Preflight bloqueou a geracao'
        toastInfeasible(msg, () => useIaStore.getState().setAberto(true))
        return
      }
    } catch (err) {
      toastErroGeracaoEscala(err)
      return
    }

    setSolverLogs([])
    setGerando(true)
    try {
      const mergedRulesOverride = {
        ...previewAutoOverrides,
        ...solverSessionConfig.rulesOverride,
      }
      const rulesOverride = Object.keys(mergedRulesOverride).length > 0
        ? mergedRulesOverride
        : undefined

      // Convert preview T/F to pinned format so solver skips Phase 1
      const pinnedFolgaExterno = simulacaoPreview.mode === 'SETOR' && simulacaoPreview.resultado.sucesso
        ? converterPreviewParaPinned(
            simulacaoPreview.resultado,
            simulacaoPreview.previewRows.map((row) => ({ funcao: row.funcao, titular: row.titular })),
          )
        : undefined

      const result = await escalasService.gerar(setorId, {
        data_inicio: dataInicio,
        data_fim: dataFim,
        solveMode: solverSessionConfig.solveMode,
        maxTimeSeconds: solverSessionConfig.maxTimeSeconds,
        rulesOverride,
        pinnedFolgaExterno,
      })
      setHistoricoCompleta(result)
      setHistoricoSelecionadaId(result.escala.id)
      setEscalaSelecionada(`historico:${result.escala.id}`)
      toast.success('Rascunho gerado e enviado para o historico')
    } catch (err) {
      const rawMsg = err instanceof Error ? err.message : String(err)

      // Try to parse structured INFEASIBLE error before mapError destroys the JSON
      let parsed: InfeasibleError | null = null
      try {
        const obj = JSON.parse(rawMsg)
        if (obj?.tipo === 'INFEASIBLE') parsed = obj as InfeasibleError
      } catch { /* not structured JSON, fall through */ }

      if (parsed) {
        const solverAvisos: AvisoEscala[] = [{
          id: 'solver_infeasible',
          nivel: 'erro' as const,
          titulo: parsed.mensagem,
          detalhe: parsed.diagnostico_resumido ?? undefined,
          origem: 'operacao' as const,
        }]
        if (parsed.sugestoes?.length) {
          parsed.sugestoes.forEach((s, i) => solverAvisos.push({
            id: `solver_sugestao_${i}`,
            nivel: 'aviso' as const,
            titulo: s,
            origem: 'operacao' as const,
          }))
        }
        setAvisosOperacao(solverAvisos)
        toastInfeasible(parsed.mensagem, () => useIaStore.getState().setAberto(true))
      } else if (!rawMsg.includes('cancelado') && !rawMsg.includes('SIGTERM') && !rawMsg.includes('killed')) {
        toastErroGeracaoEscala(err)
      }
    } finally {
      setGerando(false)
    }
  }

  const rascunhoSelecionado = useMemo(
    () => historicoCompleta?.escala.status === 'RASCUNHO' ? historicoCompleta : null,
    [historicoCompleta],
  )

  const handleOficializar = async () => {
    if (!rascunhoSelecionado) return
    setOficializando(true)
    try {
      await escalasService.oficializar(rascunhoSelecionado.escala.id)
      const detalheOficial = await escalasService.buscar(rascunhoSelecionado.escala.id)
      setOficialCompleta(detalheOficial)
      setEscalaSelecionada('oficial')
      toast.success('Escala oficializada')
      setHistoricoCompleta(null)
    } catch (err) {
      const msg = mapError(err) || 'Erro ao oficializar'
      if (msg.includes('ESCALA_DESATUALIZADA')) {
        toastErroGeracaoEscala(new Error('Escala desatualizada — gere novamente.'))
      } else {
        toastErroGeracaoEscala(err)
      }
    } finally {
      setOficializando(false)
    }
  }

  const handleDescartar = async () => {
    if (!rascunhoSelecionado) return
    setDescartando(true)
    try {
      await escalasService.deletar(rascunhoSelecionado.escala.id)
      toast.success('Escala descartada')
      setHistoricoCompleta(null)
      setEscalaSelecionada('simulacao')
    } catch (err) {
      toast.error(mapError(err) || 'Erro ao descartar')
    } finally {
      setDescartando(false)
    }
  }

  const previewCardTone = useMemo(() => {
    if (previewGate === 'BLOCK' || previewGate === 'CONFIRM_OVERRIDE') {
      return {
        frame: 'border-destructive/40',
      }
    }

    const hasWarnings =
      previewDiagnostics.some((item) => item.severity === 'warning')
      || storePreviewAvisos.some((item) => item.nivel === 'aviso')
      || avisosOperacao.some((item) => item.nivel === 'aviso')

    if (hasWarnings) {
      return {
        frame: 'border-warning/40',
      }
    }

    return {
      frame: 'border-success/40',
    }
  }, [avisosOperacao, previewDiagnostics, previewGate, storePreviewAvisos])

  const previewAvisos = useMemo<Aviso[]>(() => {
    return buildPreviewAvisos({
      previewDiagnostics,
      storePreviewAvisos,
      avisosOperacao,
      semTitular: simulacaoPreview.semTitular,
      foraDoPreview: simulacaoPreview.foraDoPreview,
      setorNome: setor?.nome,
      advisoryDiagnostics: advisoryResult?.diagnostics,
    })
  }, [advisoryResult?.diagnostics, avisosOperacao, previewDiagnostics, setor?.nome, simulacaoPreview.foraDoPreview, simulacaoPreview.semTitular, storePreviewAvisos])

  // ── Sugerir Solver: pins do preview atual → Fases A→B→C ──
  const handleSugerirSolver = useCallback(async () => {
    if (advisoryLoading || !setorId) return
    setSugestaoOpen(true)
    setAdvisoryLoading(true)
    setAdvisoryResult(null)

    try {
      // Pins do preview ATUAL (se disponível — se TS falhou, sem pins = solver livre)
      const pinnedFolgaExterno = simulacaoPreview.resultado.sucesso
        ? converterPreviewParaPinned(
            simulacaoPreview.resultado,
            previewSetorRows.map((row) => ({ funcao: row.funcao, titular: row.titular })),
          )
        : []

      // Folgas do preview grid (pra diff) — se TS falhou, usa folgas do banco/override
      const previewGrid = simulacaoPreview.resultado.grid
      const currentFolgas = previewSetorRows.map((row, idx) => {
        const gridRow = previewGrid[idx]
        const fixaDoGrid = gridRow ? (row.folgaFixaDom ? 'DOM' as DiaSemana : idxPreviewParaDiaSemana(gridRow.folga_fixa_dia)) : null
        const variavelDoGrid = gridRow ? idxPreviewParaDiaSemana(gridRow.folga_variavel_dia) : null
        return {
          colaborador_id: row.titular.id,
          fixa: fixaDoGrid ?? row.fixaAtual,
          variavel: variavelDoGrid ?? row.variavelAtual,
          origem_fixa: (row.overrideFixaLocal ? 'OVERRIDE_LOCAL' : 'COLABORADOR') as 'COLABORADOR' | 'OVERRIDE_LOCAL',
          origem_variavel: (row.overrideVariavelLocal ? 'OVERRIDE_LOCAL' : 'COLABORADOR') as 'COLABORADOR' | 'OVERRIDE_LOCAL',
        }
      })

      // Chama solver SEM preview_diagnostics (esses ficam na AvisosSection)
      const result = await escalasService.advisory({
        setor_id: setorId,
        data_inicio: periodoGeracao.data_inicio,
        data_fim: periodoGeracao.data_fim,
        pinned_folga_externo: pinnedFolgaExterno,
        current_folgas: currentFolgas,
      })

      setAdvisoryResult(result)

      if (result.fallback?.should_open_ia) {
        setSugestaoOpen(false)
        toast.info('Abrindo analise com IA...')
        const prompt = `O setor ${setor?.nome ?? ''} precisa de ajuda com a escala (${periodoGeracao.data_inicio} a ${periodoGeracao.data_fim}). ${result.fallback.reason}`
        useIaStore.getState().setPendingAutoMessage(prompt)
        useIaStore.getState().setAberto(true)
      }
    } catch (err) {
      toast.error('Erro ao analisar com o motor')
      console.error(err)
    } finally {
      setAdvisoryLoading(false)
    }
  }, [advisoryLoading, setorId, simulacaoPreview, previewSetorRows, periodoGeracao, setor])

  // ── Sugerir TS: step-by-step hierarquico (libera rank baixo primeiro) ──
  const handleSugerirTS = useCallback(() => {
    if (!simulacaoPreview.resultado.sucesso) return

    const previewGrid = simulacaoPreview.resultado.grid
    const currentFolgas = previewSetorRows.map((row, idx) => {
      const gridRow = previewGrid[idx]
      return {
        colaborador_id: row.titular.id,
        fixa: (row.folgaFixaDom ? 'DOM' : idxPreviewParaDiaSemana(gridRow?.folga_fixa_dia)) as DiaSemana | null,
        variavel: idxPreviewParaDiaSemana(gridRow?.folga_variavel_dia),
      }
    })

    const { resultado, liberados } = sugerirTSHierarquico({
      folgas: previewSetorRows.map((row) => row.folgaForcada),
      num_postos: simulacaoPreview.effectiveN,
      trabalham_domingo: simulacaoPreview.effectiveK,
      num_meses: simulacaoPreviewMeses,
      demanda_por_dia: demandaPorDiaPreviewCiclo,
    })

    // TS falhou completamente
    if (!resultado.sucesso || resultado.grid.length === 0) {
      setAdvisoryResult({
        status: 'NO_PROPOSAL',
        diagnostics: [{
          code: 'TS_FALHOU',
          severity: 'warning',
          gate: 'ALLOW',
          title: 'O sistema nao conseguiu montar um ciclo viavel.',
          detail: resultado.erro ?? 'Tente usar o Sugerir com motor para uma analise mais profunda.',
          source: 'advisory_proposal',
        }],
      })
      setSugestaoOpen(true)
      return
    }

    // Build diff
    const diff: AdvisoryDiffItem[] = previewSetorRows.map((row, idx) => {
      const gridRow = resultado.grid[idx]
      return {
        colaborador_id: row.titular.id,
        nome: row.titular.nome,
        posto_apelido: row.funcao.apelido,
        fixa_atual: currentFolgas[idx]?.fixa ?? null,
        fixa_proposta: row.folgaFixaDom ? 'DOM' as DiaSemana : idxPreviewParaDiaSemana(gridRow?.folga_fixa_dia),
        variavel_atual: currentFolgas[idx]?.variavel ?? null,
        variavel_proposta: idxPreviewParaDiaSemana(gridRow?.folga_variavel_dia),
      }
    })

    const hasChanges = diff.some(
      (d) => d.fixa_atual !== d.fixa_proposta || d.variavel_atual !== d.variavel_proposta,
    )

    const diagnostics: PreviewDiagnostic[] = []

    if (liberados > 0 && hasChanges) {
      diagnostics.push({
        code: 'TS_REDISTRIBUIU',
        severity: 'info',
        gate: 'ALLOW',
        title: `${liberados} colaborador(es) de menor hierarquia tiveram folgas redistribuidas.`,
        detail: 'O sistema priorizou manter as folgas dos colaboradores de maior hierarquia.',
        source: 'advisory_proposal',
      })
    }

    // Verificar se ainda tem deficit mesmo apos sugestao
    const stillHasDeficit = resultado.cobertura_dia.some((sem) =>
      sem.cobertura.some((cob, i) => cob < (demandaPorDiaPreviewCiclo[i] ?? 0)),
    )
    if (stillHasDeficit) {
      diagnostics.push({
        code: 'TS_NAO_RESOLVEU',
        severity: 'warning',
        gate: 'ALLOW',
        title: 'O sistema nao conseguiu eliminar todos os deficits.',
        detail: 'A equipe pode ser insuficiente para a demanda. Use o Sugerir com motor ou ajuste a demanda.',
        source: 'advisory_proposal',
      })
    }

    setAdvisoryResult({
      status: hasChanges ? 'PROPOSAL_VALID' : 'CURRENT_VALID',
      diagnostics,
      ...(hasChanges ? { proposal: { diff } } : {}),
    })
    setSugestaoOpen(true)
  }, [simulacaoPreview, previewSetorRows, simulacaoPreviewMeses, demandaPorDiaPreviewCiclo])

  // ── Validar: roda solver COM pins, validate_only — sem proposta ──
  const handleValidar = useCallback(async () => {
    if (advisoryLoading || !setorId || !simulacaoPreview.resultado.sucesso) return
    setSugestaoMode('validacao')
    setSugestaoOpen(true)
    setAdvisoryLoading(true)
    setAdvisoryResult(null)

    try {
      const pinnedFolgaExterno = converterPreviewParaPinned(
        simulacaoPreview.resultado,
        previewSetorRows.map((row) => ({ funcao: row.funcao, titular: row.titular })),
      )

      const previewGrid = simulacaoPreview.resultado.grid
      const currentFolgas = previewSetorRows.map((row, idx) => {
        const gridRow = previewGrid[idx]
        const fixaDoGrid = row.folgaFixaDom ? 'DOM' as DiaSemana : idxPreviewParaDiaSemana(gridRow?.folga_fixa_dia)
        const variavelDoGrid = idxPreviewParaDiaSemana(gridRow?.folga_variavel_dia)
        return {
          colaborador_id: row.titular.id,
          fixa: fixaDoGrid ?? row.fixaAtual,
          variavel: variavelDoGrid ?? row.variavelAtual,
          origem_fixa: (row.overrideFixaLocal ? 'OVERRIDE_LOCAL' : 'COLABORADOR') as 'COLABORADOR' | 'OVERRIDE_LOCAL',
          origem_variavel: (row.overrideVariavelLocal ? 'OVERRIDE_LOCAL' : 'COLABORADOR') as 'COLABORADOR' | 'OVERRIDE_LOCAL',
        }
      })

      const result = await escalasService.advisory({
        setor_id: setorId,
        data_inicio: periodoGeracao.data_inicio,
        data_fim: periodoGeracao.data_fim,
        pinned_folga_externo: pinnedFolgaExterno,
        current_folgas: currentFolgas,
        preview_diagnostics: previewDiagnostics,
        validate_only: true,
      })

      setAdvisoryResult(result)

      if (result.fallback?.should_open_ia) {
        setSugestaoOpen(false)
        toast.info('Abrindo IA com o diagnostico do solver...')
        const prompt = `Valide a escala do setor ${setor?.nome ?? ''} (${periodoGeracao.data_inicio} a ${periodoGeracao.data_fim}). O solver nao conseguiu viabilizar: ${result.fallback.reason}`
        useIaStore.getState().setPendingAutoMessage(prompt)
        useIaStore.getState().setAberto(true)
      }
    } catch (err) {
      toast.error('Erro ao validar arranjo')
      console.error(err)
    } finally {
      setAdvisoryLoading(false)
    }
  }, [advisoryLoading, setorId, simulacaoPreview, previewSetorRows, periodoGeracao, previewDiagnostics, setor])

  // Invalidate advisory when ANY input changes (folgas, N, K, demanda)
  useEffect(() => {
    setAdvisoryResult(null)
    setSugestaoOpen(false)
  }, [previewSetorRows, simulacaoPreview.resultado])

  // ── Export data for the new ExportModal mode='setor' ──────────────────
  const escalaExportData = useMemo((): EscalaExportData | undefined => {
    if (!exportDetalhe || !setor) return undefined
    const equipe = resolveEscalaEquipe(exportDetalhe, exportColaboradoresBase, postosOrdenados)
    return {
      escala: exportDetalhe.escala,
      alocacoes: exportDetalhe.alocacoes,
      colaboradores: equipe.colaboradores,
      setor,
      violacoes: exportDetalhe.violacoes,
      avisos: [],
      tiposContrato: tiposContrato ?? [],
      funcoes: equipe.funcoes,
      horariosSemana: horariosSemana ?? [],
      regrasPadrao: regrasPadrao ?? [],
    }
  }, [exportDetalhe, setor, exportColaboradoresBase, postosOrdenados, tiposContrato, horariosSemana, regrasPadrao])

  // ── Export handlers (called by ExportModal with current toggle state) ──
  const renderExportJSX = useCallback((detalhe: EscalaCompletaV3, toggles: ExportToggles, tlMode: 'barras' | 'grid') => {
    if (!setor) return null
    const hasContent = toggles.ciclo || toggles.semanal || toggles.timeline || toggles.avisos
    if (!hasContent) return null
    const equipe = resolveEscalaEquipe(detalhe, exportColaboradoresBase, postosOrdenados)
    return (
      <ExportarEscala
        escala={detalhe.escala}
        alocacoes={detalhe.alocacoes}
        colaboradores={equipe.colaboradores}
        setor={setor}
        violacoes={detalhe.violacoes}
        tiposContrato={tiposContrato ?? []}
        funcoes={equipe.funcoes}
        horariosSemana={horariosSemana ?? []}
        regrasPadrao={regrasPadrao ?? []}
        mode="setor"
        mostrarCiclo={toggles.ciclo}
        mostrarSemanal={toggles.semanal}
        mostrarTimeline={toggles.timeline}
        timelineMode={tlMode}
        mostrarAvisos={toggles.avisos}
        appVersion={appVersion ?? undefined}
      />
    )
  }, [appVersion, exportColaboradoresBase, horariosSemana, postosOrdenados, regrasPadrao, setor, tiposContrato])

  const handleExportHTML = useCallback(async (toggles?: ExportToggles, tlMode?: 'barras' | 'grid') => {
    if (!toggles || !exportDetalhe || !setor) return
    const jsx = renderExportJSX(exportDetalhe, toggles, tlMode ?? 'barras')
    if (!jsx) {
      toast.error('Selecione ao menos um conteudo para exportar HTML.')
      return
    }
    const { renderToStaticMarkup } = await import('react-dom/server')
    const html = renderToStaticMarkup(jsx)
    const fullHTML = buildStandaloneHtml(html, { title: `Escala - ${setor.nome}`, forceLight: true })
    const slug = setor.nome.toLowerCase().replace(/\s+/g, '-')
    const prefix = toggles.timeline ? 'escala-detalhada' : 'escala-ciclo'
    try {
      const result = await exportarService.salvarHTML(fullHTML, `${prefix}-${slug}.html`)
      if (result) toast.success('HTML salvo com sucesso')
    } catch {
      toast.error('Erro ao exportar HTML')
    }
    setExportOpen(false)
  }, [exportDetalhe, renderExportJSX, setor])

  const handlePrint = useCallback(async (toggles?: ExportToggles, tlMode?: 'barras' | 'grid') => {
    if (!toggles || !exportDetalhe || !setor) return
    const jsx = renderExportJSX(exportDetalhe, toggles, tlMode ?? 'barras')
    if (!jsx) {
      toast.error('Selecione ao menos um conteudo para imprimir.')
      return
    }
    const printWindow = window.open('', '_blank')
    if (!printWindow) {
      toast.error('Bloqueio de popup detectado. Permita popups para imprimir.')
      return
    }
    const { renderToStaticMarkup } = await import('react-dom/server')
    const html = renderToStaticMarkup(jsx)
    const fullHTML = buildStandaloneHtml(html, { title: `Escala - ${setor.nome}`, forceLight: true })
    printWindow.document.write(fullHTML)
    printWindow.document.close()
    printWindow.focus()
    setTimeout(() => printWindow.print(), 250)
    setExportOpen(false)
  }, [exportDetalhe, renderExportJSX, setor])

  const handleCSV = useCallback(async (toggles?: ExportToggles) => {
    if (!toggles || !exportDetalhe || !setor || !colaboradores) return
    const equipe = resolveEscalaEquipe(exportDetalhe, exportColaboradoresBase, postosOrdenados)
    const blocos: string[] = []
    if (toggles.ciclo || toggles.semanal || toggles.timeline) {
      blocos.push(gerarCSVAlocacoes([exportDetalhe], [setor], equipe.colaboradores))
      blocos.push(gerarCSVComparacaoDemanda([exportDetalhe], [setor]))
    }
    if (toggles.avisos) {
      blocos.push(gerarCSVViolacoes([exportDetalhe], [setor]))
    }
    if (blocos.length === 0) {
      toast.error('Selecione ao menos um conteudo para exportar CSV.')
      return
    }
    const combined = blocos.join('\n\n')
    const slug = setor.nome.toLowerCase().replace(/\s+/g, '-')
    try {
      const result = await exportarService.salvarCSV(combined, `escala-${slug}.csv`)
      if (result) toast.success('CSV salvo com sucesso')
    } catch {
      toast.error('Erro ao exportar CSV')
    }
    setExportOpen(false)
  }, [colaboradores, exportColaboradoresBase, exportDetalhe, postosOrdenados, setor])

  const abrirModalExportacao = (detalhe: EscalaCompletaV3 | null) => {
    if (!detalhe) return
    setExportDetalhe(detalhe)
    setExportOpen(true)
  }

  // Auto-load escala mais recente (por criada_em, independente de status)
  useEffect(() => {
    if (!escalas?.length) return
    const maisRecente = [...escalas].sort((a, b) => b.criada_em.localeCompare(a.criada_em))[0]
    if (!maisRecente) return
    const valor = maisRecente.status === 'RASCUNHO'
      ? `historico:${maisRecente.id}`
      : maisRecente.status === 'OFICIAL'
        ? 'oficial'
        : `historico:${maisRecente.id}`
    setEscalaSelecionada(valor)
  }, [escalas]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleSalvarPostoDialog = async () => {
    if (!postoDialogApelido.trim()) {
      toast.error('Informe o nome do posto')
      return
    }

    setSalvandoPosto(true)
    try {
      const postoAtual = postoDialogMode === 'edit' && postoDialogPostoId != null
        ? (postosOrdenados.find((posto) => posto.id === postoDialogPostoId) ?? null)
        : null
      const titularAtualId = postoAtual ? (ocupanteMap.get(postoAtual.id)?.id ?? null) : null
      const proximoTitular = postoDialogTitularId != null
        ? (orderedColabs.find((colab) => colab.id === postoDialogTitularId) ?? null)
        : null
      const postoOrigemProximoTitular = proximoTitular?.funcao_id != null
        ? (postosOrdenados.find((posto) => posto.id === proximoTitular.funcao_id) ?? null)
        : null
      const tipoContratoInterno = resolveTipoContratoInternoPosto(postoDialogTitularId, postoAtual)
      const deveIrParaEsperaNoCreate = postoDialogMode === 'create' && postoDialogTitularId == null
      const deveMoverParaEspera = postoDialogMode === 'edit' && titularAtualId != null && postoDialogTitularId == null
      const deveFicarAtivo = postoDialogMode === 'create'
        ? !deveIrParaEsperaNoCreate
        : (postoAtual?.ativo ?? true)
      const ordemDestino = postoDialogMode === 'create'
        ? (deveFicarAtivo ? postosAtivos.length : postosOrdenados.length)
        : (postoAtual?.ordem ?? postosOrdenados.length)

      if (!tipoContratoInterno) {
        toast.error('Cadastre ao menos um tipo de contrato antes de criar postos')
        return
      }

      let postoSalvo = postoDialogMode === 'create'
        ? await funcoesService.criar({
          setor_id: setorId,
          apelido: postoDialogApelido.trim(),
          tipo_contrato_id: tipoContratoInterno,
          ordem: ordemDestino,
        })
        : await funcoesService.atualizar(postoDialogPostoId!, {
          apelido: postoDialogApelido.trim(),
          ativo: deveFicarAtivo,
          ordem: ordemDestino,
          ...(tipoContratoInterno !== postoAtual?.tipo_contrato_id
            ? { tipo_contrato_id: tipoContratoInterno }
            : {}),
        })

      if (postoDialogMode === 'create') {
        if (deveIrParaEsperaNoCreate) {
          await persistPostosBuckets(postosAtivos, [...postosBancoEspera, { ...postoSalvo, ativo: false }])
          postoSalvo = { ...postoSalvo, ativo: false, ordem: postosAtivos.length + postosBancoEspera.length }
        } else {
          await persistPostosBuckets([...postosAtivos, { ...postoSalvo, ativo: true }], postosBancoEspera)
          postoSalvo = { ...postoSalvo, ativo: true, ordem: postosAtivos.length }
        }
      }

      if (postoDialogTitularId !== titularAtualId) {
        if (deveMoverParaEspera) {
          await moverPostoParaBancoEspera(postoSalvo)
        } else if (postoDialogTitularId != null) {
          await colaboradoresService.atribuirPosto({
            colaborador_id: postoDialogTitularId,
            funcao_id: postoSalvo.id,
            estrategia: 'swap',
          })

          if (postoOrigemProximoTitular && postoOrigemProximoTitular.id !== postoSalvo.id) {
            const basePostosAtivos = postoDialogMode === 'create'
              ? [...postosAtivos, { ...postoSalvo, ativo: true }]
              : postosAtivos.map((posto) => posto.id === postoSalvo.id ? { ...posto, ...postoSalvo, ativo: true } : posto)
            await moverPostoParaBancoEspera(postoOrigemProximoTitular, {
              desanexarTitular: false,
              basePostosAtivos,
              basePostosEspera: postosBancoEspera,
            })
          }
        }
      }

      closePostoDialog(false)
      toast.success(
        postoDialogMode === 'create'
          ? (deveIrParaEsperaNoCreate ? 'Posto criado no banco de espera' : 'Posto criado')
          : (deveMoverParaEspera ? 'Posto movido para o banco de espera' : 'Posto atualizado'),
      )
    } catch (err) {
      toast.error(mapError(err) || 'Erro ao salvar posto')
    } finally {
      setSalvandoPosto(false)
    }
  }

  const handleMoverPostoDialogParaEspera = async () => {
    if (postoDialogPostoId == null) return
    const posto = postosOrdenados.find((item) => item.id === postoDialogPostoId)
    if (!posto) return

    setSalvandoPosto(true)
    try {
      await moverPostoParaBancoEspera(posto)
      closePostoDialog(false)
      toast.success(`${posto.apelido} foi movido para o banco de espera`)
    } catch (err) {
      toast.error(mapError(err) || 'Erro ao mover posto para o banco de espera')
    } finally {
      setSalvandoPosto(false)
    }
  }

  const handleAtivarPostoEspera = async (posto: Funcao) => {
    setPostoAssignmentLoading(true)
    try {
      await ativarPostoBancoEspera(posto)
      toast.success(`${posto.apelido} voltou para a hierarquia ativa`)
    } catch (err) {
      toast.error(mapError(err) || 'Erro ao ativar posto')
    } finally {
      setPostoAssignmentLoading(false)
    }
  }

  const handleDeletarPostoEspera = async (posto: Funcao) => {
    setDeletandoPosto(true)
    try {
      await funcoesService.deletar(posto.id)
      toast.success('Posto removido')
    } catch (err) {
      toast.error(mapError(err) || 'Erro ao remover posto')
    } finally {
      setDeletandoPosto(false)
    }
  }

  // ─── Loading / Not Found ─────────────────────────────────────────────
  if (carregandoSetor) {
    return (
      <div className="flex flex-1 flex-col">
        <PageHeader breadcrumbs={[{ label: 'Dashboard', href: '/' }, { label: 'Setores', href: '/setores' }, { label: '...' }]} />
        <div className="flex flex-1 items-center justify-center">
          <p className="text-sm text-muted-foreground">Carregando...</p>
        </div>
      </div>
    )
  }

  if (!setor) {
    return (
      <div className="flex flex-1 flex-col">
        <PageHeader breadcrumbs={[{ label: 'Dashboard', href: '/' }, { label: 'Setores', href: '/setores' }, { label: 'Nao encontrado' }]} />
        <div className="flex flex-1 items-center justify-center">
          <p className="text-sm text-muted-foreground">Setor nao encontrado</p>
        </div>
      </div>
    )
  }

  // ─── Render ──────────────────────────────────────────────────────────
  return (
    <div className="flex flex-1 flex-col">
      <PageHeader
        breadcrumbs={[
          { label: 'Dashboard', href: '/' },
          { label: 'Setores', href: '/setores' },
          { label: setor.nome },
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
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" size="sm" className="text-destructive hover:bg-destructive/5" disabled={isPreviewMode}>
                  <Archive className="mr-1 size-3.5" />
                  Arquivar
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Arquivar setor?</AlertDialogTitle>
                  <AlertDialogDescription>
                    O setor {setor.nome} tem {orderedColabs.length} colaboradores.
                    Eles nao entrarao em novas escalas enquanto o setor estiver arquivado.
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
        {/* Info basica */}
        <Form {...setorForm}>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold">
                Informacoes do Setor
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormField
                control={setorForm.control}
                name="nome"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nome</FormLabel>
                    <div className="flex gap-2">
                      <IconPicker
                        value={setorForm.watch('icone') ?? null}
                        onChange={(v) => {
                          setorForm.setValue('icone', v, { shouldDirty: true })
                        }}
                      />
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <FormField
                  control={setorForm.control}
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
                  control={setorForm.control}
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
                <FormField
                  control={setorForm.control}
                  name="regime_escala"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Regime Padrao</FormLabel>
                      <Select value={field.value} onValueChange={(val) => {
                        const regime = val as '5X2' | '6X1'
                        field.onChange(regime)
                        // Auto-save: regime muda o preview inteiro, salvar imediatamente
                        void setoresService.atualizar(setorId, { regime_escala: regime }).then(() => {
                          setorForm.reset({ ...setorForm.getValues(), regime_escala: regime })
                        })
                      }}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="5X2">5x2 (5 dias + 2 folgas)</SelectItem>
                          <SelectItem value="6X1">6x1 (6 dias + 1 folga)</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </CardContent>
          </Card>
        </Form>

        <div className="space-y-4">
          <Collapsible defaultOpen className="group/equipe">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-3">
                <CollapsibleTrigger className="flex items-center gap-2 text-base font-semibold hover:underline">
                  <ChevronDown className="size-4 transition-transform group-data-[state=closed]/equipe:-rotate-90" />
                  Equipe
                </CollapsibleTrigger>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={openCreatePostoDialog}>
                    <Plus className="mr-1 size-3.5" /> Novo Posto
                  </Button>
                  <Button variant="outline" size="sm" asChild>
                    <Link to="/colaboradores">
                      <Users className="mr-1 size-3.5" /> Gerenciar
                    </Link>
                  </Button>
                </div>
              </CardHeader>
              <CollapsibleContent>
                <CardContent className="space-y-4">
                  {orderedColabs.length === 0 && (
                    <div className="rounded-md border border-dashed bg-muted/20 px-4 py-3 text-sm text-muted-foreground">
                      Nenhum colaborador vinculado a este setor.
                    </div>
                  )}

                  {(() => {
                    // IDs de ausentes pra evitar duplicação (pessoa sem posto E de férias)
                    const ausenteIds = new Set((derivados?.ausentes ?? []).map(a => a.colaborador.id))
                    // Reserve: sem posto E que NÃO estão na lista de ausentes
                    const reservaPura = colabsSemPosto.filter(c => !ausenteIds.has(c.id))
                    // Ausentes que também estão sem posto (aparecem como ausente, não reserva)
                    const totalForaEscala = reservaPura.length + (derivados?.ausentes?.length ?? 0)

                    if (totalForaEscala === 0) return null

                    return (
                      <>
                        <div className="space-y-3">
                          <div className="flex items-center gap-2">
                            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                              Reserva e ausentes
                            </p>
                            <span className="text-xs text-muted-foreground">{totalForaEscala}</span>
                          </div>
                          <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-2">
                            {/* Ausentes — cards com badge de tipo */}
                            {(derivados?.ausentes ?? []).map((info) => (
                              <ColaboradorCard
                                key={`aus-${info.colaborador.id}`}
                                nome={info.colaborador.nome}
                                posto={info.posto?.apelido}
                                contrato={contratoMap.get(info.colaborador.tipo_contrato_id)}
                                excecaoTipo={info.excecao.tipo as 'FERIAS' | 'ATESTADO' | 'BLOQUEIO'}
                                extra={(() => {
                                  const hoje = new Date().toISOString().split('T')[0]
                                  const d = Math.ceil((Date.parse(info.excecao.data_fim) - Date.parse(hoje)) / 86400000)
                                  return d > 0 ? `volta em ${d}d` : ''
                                })()}
                                href={`/colaboradores/${info.colaborador.id}`}
                              />
                            ))}
                            {/* Reserva pura — chips simples */}
                            {reservaPura.map((colab) => (
                              <ColaboradorCard
                                key={`res-${colab.id}`}
                                nome={colab.nome}
                                contrato={contratoMap.get(colab.tipo_contrato_id)}
                                status={getStatusColaborador(colab.id) as 'Ativo' | 'Ferias' | 'Atestado' | 'Bloqueio'}
                                href={`/colaboradores/${colab.id}`}
                              />
                            ))}
                          </div>
                        </div>
                        <div className="h-px bg-border" />
                      </>
                    )
                  })()}

                  <div className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Postos
                      <span className="ml-2 inline-flex items-center gap-1 text-xs font-normal normal-case tracking-normal text-muted-foreground/70">
                        <GripVertical className="size-3.5" />
                        hierarquia de decisao - arraste para reordenar
                      </span>
                    </p>

                    {postosAtivos.length === 0 ? (
                      <div className="rounded-md border border-dashed px-4 py-3 text-sm text-muted-foreground">
                        Nenhum posto na hierarquia no momento.
                      </div>
                    ) : (
                      <DndContext
                        sensors={postoSortSensors}
                        collisionDetection={closestCenter}
                        onDragEnd={(event) => { void handlePostoReorderDragEnd(event) }}
                      >
                        <div className="rounded-md border">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead className="w-[60px] text-center">#</TableHead>
                                <TableHead className="w-[120px]">Posto</TableHead>
                                <TableHead>Titular</TableHead>
                                <TableHead className="w-[84px] text-center">Variavel</TableHead>
                                <TableHead className="w-[70px] text-center">Fixo</TableHead>
                                <TableHead className="w-[110px]">Contrato</TableHead>
                                <TableHead className="w-[60px]">Sexo</TableHead>
                                <TableHead className="w-[100px]">Status</TableHead>
                                <TableHead className="w-[120px] text-right">Acoes</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              <SortableContext
                                items={postosAtivos.map((posto) => `posto-${posto.id}`)}
                                strategy={verticalListSortingStrategy}
                              >
                                {postosAtivos.map((posto, index) => {
                                  const ocupante = ocupanteMap.get(posto.id)
                                  const contratoNome = ocupante
                                    ? (contratoMap.get(ocupante.tipo_contrato_id) ?? 'Contrato')
                                    : '-'
                                  const status = ocupante ? getStatusColaborador(ocupante.id) : '-'
                                  const folgas = ocupante ? folgasEquipeMap.get(ocupante.id) : null
                                  const ocupanteIntermitente = (ocupante?.tipo_trabalhador ?? 'CLT') === 'INTERMITENTE'
                                  const pickerAberto = titularPickerPostoId === posto.id

                                  return (
                                    <SortablePostoRow key={posto.id} postoId={posto.id} index={index}>
                                      <TableCell className="font-medium">{posto.apelido}</TableCell>
                                      <TableCell>
                                        {ocupante ? (
                                          <span className="flex items-center gap-1.5">
                                            <span className={cn('truncate text-sm', ausenteMap.has(ocupante.id) && 'text-warning')}>{ocupante.nome}</span>
                                            {(() => {
                                              const prox = proximoAusenteMap.get(ocupante.id)
                                              if (!prox) return null
                                              const ini = prox.excecao.data_inicio.split('-').reverse().join('/')
                                              const fim = prox.excecao.data_fim.split('-').reverse().join('/')
                                              const tipo = prox.excecao.tipo === 'FERIAS' ? 'Ferias' : prox.excecao.tipo === 'ATESTADO' ? 'Atestado' : 'Bloqueio'
                                              return (
                                                <Tooltip>
                                                  <TooltipTrigger asChild>
                                                    <AlertTriangle size={14} className="shrink-0 text-warning" />
                                                  </TooltipTrigger>
                                                  <TooltipContent>{tipo} em {prox.diasAte} dia{prox.diasAte > 1 ? 's' : ''} ({ini} - {fim})</TooltipContent>
                                                </Tooltip>
                                              )
                                            })()}
                                          </span>
                                        ) : (
                                          <span className="text-sm italic text-muted-foreground">Vazio</span>
                                        )}
                                      </TableCell>
                                      <TableCell className="text-center">
                                        {ocupante ? (
                                          ocupanteIntermitente ? (
                                            <span className="text-xs text-muted-foreground">-</span>
                                          ) : (
                                            <Select
                                              value={folgas?.variavel ?? '__none__'}
                                              onValueChange={async (val) => {
                                                try {
                                                  await colaboradoresService.salvarRegraHorario({
                                                    colaborador_id: ocupante.id,
                                                    folga_variavel_dia_semana: val === '__none__' ? null : (val as DiaSemana),
                                                  })

                                                } catch (err) {
                                                  toast.error(mapError(err) || 'Erro ao salvar folga')
                                                }
                                              }}
                                            >
                                              <SelectTrigger className="h-7 w-[70px] px-2 text-xs">
                                                <SelectValue />
                                              </SelectTrigger>
                                              <SelectContent>
                                                <SelectItem value="__none__" className="text-xs">-</SelectItem>
                                                {DIAS_SEMANA.filter((d) => d !== 'DOM').map((dia) => (
                                                  <SelectItem key={dia} value={dia} className="text-xs">{dia}</SelectItem>
                                                ))}
                                              </SelectContent>
                                            </Select>
                                          )
                                        ) : (
                                          <span className="text-xs text-muted-foreground">-</span>
                                        )}
                                      </TableCell>
                                      <TableCell className="text-center">
                                        {ocupante ? (
                                          ocupanteIntermitente ? (
                                            <span className="text-xs text-muted-foreground">-</span>
                                          ) : (
                                            <Select
                                              value={folgas?.fixa ?? '__none__'}
                                              onValueChange={async (val) => {
                                                try {
                                                  await colaboradoresService.salvarRegraHorario({
                                                    colaborador_id: ocupante.id,
                                                    folga_fixa_dia_semana: val === '__none__' ? null : (val as DiaSemana),
                                                  })

                                                } catch (err) {
                                                  toast.error(mapError(err) || 'Erro ao salvar folga')
                                                }
                                              }}
                                            >
                                              <SelectTrigger className="h-7 w-[70px] px-2 text-xs">
                                                <SelectValue />
                                              </SelectTrigger>
                                              <SelectContent>
                                                <SelectItem value="__none__" className="text-xs">-</SelectItem>
                                                {DIAS_SEMANA.map((dia) => (
                                                  <SelectItem key={dia} value={dia} className="text-xs">{dia}</SelectItem>
                                                ))}
                                              </SelectContent>
                                            </Select>
                                          )
                                        ) : (
                                          <span className="text-xs text-muted-foreground">-</span>
                                        )}
                                      </TableCell>
                                      <TableCell className="text-xs text-muted-foreground">{contratoNome}</TableCell>
                                      <TableCell className="text-xs text-muted-foreground">
                                        {ocupante ? (ocupante.sexo === 'M' ? 'Masc' : 'Fem') : '-'}
                                      </TableCell>
                                      <TableCell>
                                        {ocupante ? (
                                          <Badge variant="outline" className={cn(
                                            'text-xs',
                                            status === 'Ativo' && 'border-success/40 text-success',
                                            status === 'Ferias' && 'border-warning/40 text-warning',
                                            status === 'Atestado' && 'border-destructive/40 text-destructive',
                                            status === 'Bloqueio' && 'border-muted-foreground/40 text-muted-foreground',
                                          )}>
                                            {status}
                                          </Badge>
                                        ) : (
                                          <span className="text-xs text-muted-foreground">-</span>
                                        )}
                                      </TableCell>
                                      <TableCell className="text-right">
                                        <div className="flex items-center justify-end gap-1">
                                          <Tooltip>
                                            <TooltipTrigger asChild>
                                              <Button
                                                type="button"
                                                variant="ghost"
                                                size="icon"
                                                className="size-7"
                                                onClick={() => openEditPostoDialog(posto)}
                                                disabled={postoAssignmentLoading}
                                                aria-label={`Editar posto ${posto.apelido}`}
                                              >
                                                <Pencil className="size-3.5" />
                                              </Button>
                                            </TooltipTrigger>
                                            <TooltipContent>Editar posto</TooltipContent>
                                          </Tooltip>

                                          <Popover
                                            open={pickerAberto}
                                            onOpenChange={(open) => {
                                              if (open) openTitularPicker(posto.id)
                                              else if (pickerAberto) closeTitularPicker()
                                            }}
                                          >
                                            <Tooltip>
                                              <TooltipTrigger asChild>
                                                <PopoverTrigger asChild>
                                                  <Button
                                                    type="button"
                                                    variant="ghost"
                                                    size="icon"
                                                    className="size-7"
                                                    disabled={postoAssignmentLoading}
                                                    aria-label={`Gerenciar titular de ${posto.apelido}`}
                                                  >
                                                    <Users className="size-3.5" />
                                                  </Button>
                                                </PopoverTrigger>
                                              </TooltipTrigger>
                                              <TooltipContent>Gerenciar titular</TooltipContent>
                                            </Tooltip>
                                            <PopoverContent
                                              className="w-[22rem] p-0"
                                              side="bottom"
                                              align="end"
                                              sideOffset={8}
                                              collisionPadding={16}
                                              style={{ maxHeight: 'min(var(--radix-popover-content-available-height), 24rem)' }}
                                            >
                                              <TitularAssignmentPanel
                                                titular={ocupante ?? null}
                                                candidatos={colaboradoresFiltradosPicker}
                                                funcaoMap={funcaoMap}
                                                contratoMap={contratoMap}
                                                searchTerm={titularPickerSearchTerm}
                                                onSearchTermChange={setTitularPickerSearchTerm}
                                                onSelectColaborador={(colaboradorId) => {
                                                  void handleSelecionarNoAutocomplete('picker', posto.id, colaboradorId)
                                                }}
                                                onRemoveTitular={ocupante ? () => { void salvarTitularNoPosto(posto, null) } : undefined}
                                                removeLabel="Mover para espera"
                                                getDescricaoBuscaColaborador={getDescricaoBuscaColaborador}
                                                loading={postoAssignmentLoading}
                                              />
                                            </PopoverContent>
                                          </Popover>

                                          {ocupante && (
                                            <Tooltip>
                                              <TooltipTrigger asChild>
                                                <Button variant="ghost" size="icon" className="size-7" asChild>
                                                  <Link to={`/colaboradores/${ocupante.id}`} aria-label={`Ver perfil de ${ocupante.nome}`}>
                                                    <ArrowRight className="size-3.5" />
                                                  </Link>
                                                </Button>
                                              </TooltipTrigger>
                                              <TooltipContent>Abrir colaborador</TooltipContent>
                                            </Tooltip>
                                          )}
                                        </div>
                                      </TableCell>
                                    </SortablePostoRow>
                                  )
                                })}
                              </SortableContext>
                            </TableBody>
                          </Table>
                        </div>
                      </DndContext>
                    )}
                  </div>

                  <div className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Banco de espera
                      <span className="ml-2 text-xs font-normal normal-case tracking-normal text-muted-foreground/70">
                        fora da hierarquia de decisao
                      </span>
                    </p>

                    {postosBancoEspera.length === 0 ? (
                      <div className="rounded-md border border-dashed px-4 py-3 text-sm text-muted-foreground">
                        Nenhum posto no banco de espera.
                      </div>
                    ) : (
                      <div className="rounded-md border">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Posto</TableHead>
                              <TableHead>Titular</TableHead>
                              <TableHead>Status</TableHead>
                              <TableHead className="w-[150px] text-right">Acoes</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {postosBancoEspera.map((posto) => {
                              const ocupante = ocupanteMap.get(posto.id)

                              return (
                                <TableRow key={posto.id}>
                                  <TableCell className="font-medium">{posto.apelido}</TableCell>
                                  <TableCell>
                                    {ocupante ? (
                                      <span className="text-sm">{ocupante.nome}</span>
                                    ) : (
                                      <span className="text-sm italic text-muted-foreground">Sem titular</span>
                                    )}
                                  </TableCell>
                                  <TableCell>
                                    <Badge variant="outline" className="text-xs text-muted-foreground">
                                      Em espera
                                    </Badge>
                                  </TableCell>
                                  <TableCell className="text-right">
                                    <div className="flex items-center justify-end gap-1">
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <Button
                                            type="button"
                                            variant="ghost"
                                            size="icon"
                                            className="size-7"
                                            disabled={postoAssignmentLoading || deletandoPosto}
                                            onClick={() => { void handleAtivarPostoEspera(posto) }}
                                            aria-label={`Ativar posto ${posto.apelido}`}
                                          >
                                            <RotateCcw className="size-3.5" />
                                          </Button>
                                        </TooltipTrigger>
                                        <TooltipContent>Ativar posto</TooltipContent>
                                      </Tooltip>

                                      <AlertDialog>
                                        <Tooltip>
                                          <TooltipTrigger asChild>
                                            <AlertDialogTrigger asChild>
                                              <Button
                                                type="button"
                                                variant="ghost"
                                                size="icon"
                                                className="size-7 text-destructive hover:text-destructive"
                                                disabled={postoAssignmentLoading || deletandoPosto}
                                                aria-label={`Deletar posto ${posto.apelido}`}
                                              >
                                                <Trash2 className="size-3.5" />
                                              </Button>
                                            </AlertDialogTrigger>
                                          </TooltipTrigger>
                                          <TooltipContent>Deletar posto</TooltipContent>
                                        </Tooltip>
                                        <AlertDialogContent>
                                          <AlertDialogHeader>
                                            <AlertDialogTitle>Deletar posto?</AlertDialogTitle>
                                            <AlertDialogDescription>
                                              {`O posto ${posto.apelido} sera removido do cadastro atual. O historico das escalas continua preservado por snapshot.`}
                                            </AlertDialogDescription>
                                          </AlertDialogHeader>
                                          <AlertDialogFooter>
                                            <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                            <AlertDialogAction onClick={() => { void handleDeletarPostoEspera(posto) }}>
                                              {deletandoPosto ? 'Deletando...' : 'Deletar'}
                                            </AlertDialogAction>
                                          </AlertDialogFooter>
                                        </AlertDialogContent>
                                      </AlertDialog>
                                    </div>
                                  </TableCell>
                                </TableRow>
                              )
                            })}
                          </TableBody>
                        </Table>
                      </div>
                    )}
                  </div>
                </CardContent>
              </CollapsibleContent>
            </Card>
          </Collapsible>

          <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-semibold">
                  Demanda por Faixa Horaria
                </CardTitle>
              </CardHeader>
              <CardContent>
                <DemandaEditor
                  ref={demandaEditorRef}
                  setor={setor}
                  demandas={demandas ?? []}
                  horariosSemana={horariosSemana ?? []}
                  totalColaboradores={colaboradores?.length ?? 0}
                  saving={salvandoTudo}
                  onDirtyChange={setDemandaDirty}
                  onDraftChange={setDemandaDraftPreview}
                />
              </CardContent>
            </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold">Escala</CardTitle>
              <div className="flex flex-wrap items-center justify-between gap-2">
                {/* Tab toggle pills */}
                <div className="inline-flex rounded-lg border bg-muted p-0.5">
                  <button
                    type="button"
                    className={cn(
                      'rounded-md px-3 py-1 text-xs font-medium transition-colors',
                      escalaTab === 'simulacao'
                        ? 'bg-background text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                    onClick={() => setEscalaSelecionada('simulacao')}
                  >
                    Simulacao
                  </button>
                  <button
                    type="button"
                    className={cn(
                      'rounded-md px-3 py-1 text-xs font-medium transition-colors',
                      escalaTab === 'oficial'
                        ? 'bg-background text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground',
                      !escalaOficialAtual && 'pointer-events-none opacity-40',
                    )}
                    onClick={() => setEscalaSelecionada('oficial')}
                    disabled={!escalaOficialAtual}
                  >
                    Oficial
                  </button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        className={cn(
                          'inline-flex items-center gap-1 rounded-md px-3 py-1 text-xs font-medium transition-colors',
                          escalaTab === 'historico'
                            ? 'bg-background text-foreground shadow-sm'
                            : 'text-muted-foreground hover:text-foreground',
                          escalasHistorico.length === 0 && 'pointer-events-none opacity-40',
                        )}
                        disabled={escalasHistorico.length === 0}
                      >
                        Historico
                        <ChevronDown className="size-3" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                      {escalasHistorico.map((escala) => (
                        <DropdownMenuItem
                          key={escala.id}
                          onClick={() => setEscalaSelecionada(`historico:${escala.id}`)}
                        >
                          {formatarData(escala.data_inicio)} — {formatarData(escala.data_fim)}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                <div className="flex items-center gap-2">
                  {escalaTab === 'simulacao' && (
                    <>
                      {simulacaoPreview.resultado.sucesso && modoSimulacaoEfetivo === 'SETOR' && (
                        <>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="outline"
                                size="icon"
                                onClick={handleSugerirTS}
                                disabled={advisoryLoading || gerando}
                                aria-label="Sugerir com TS"
                              >
                                <Lightbulb className="size-4" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Sugerir com TS</TooltipContent>
                          </Tooltip>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="outline"
                                size="icon"
                                onClick={handleValidar}
                                disabled={advisoryLoading || gerando}
                                aria-label="Validar arranjo"
                              >
                                {advisoryLoading ? (
                                  <Loader2 className="size-4 animate-spin" />
                                ) : (
                                  <ShieldCheck className="size-4" />
                                )}
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Validar arranjo</TooltipContent>
                          </Tooltip>
                        </>
                      )}
                      {modoSimulacaoEfetivo === 'SETOR' && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="outline"
                              size="icon"
                              onClick={handleSugerirSolver}
                              disabled={advisoryLoading || gerando}
                              aria-label="Sugerir com o motor"
                            >
                              {advisoryLoading ? (
                                <Loader2 className="size-4 animate-spin" />
                              ) : (
                                <Zap className="size-4" />
                              )}
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Sugerir com o motor</TooltipContent>
                        </Tooltip>
                      )}
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="outline"
                            size="icon"
                            onClick={() => setSolverConfigOpen(true)}
                            aria-label="Configurar simulacao"
                          >
                            <SlidersHorizontal className="size-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Configurar simulacao</TooltipContent>
                      </Tooltip>
                      <Button
                        size="sm"
                        className="gap-1.5"
                        onClick={handleGerar}
                        disabled={
                          gerando ||
                          advisoryLoading ||
                          !empresa ||
                          (tiposContrato?.length ?? 0) === 0 ||
                          (orderedColabs?.length ?? 0) === 0
                        }
                        title={
                          !empresa || (tiposContrato?.length ?? 0) === 0 || (orderedColabs?.length ?? 0) === 0
                            ? 'Complete os itens em "Antes de gerar" abaixo'
                            : undefined
                        }
                      >
                        {gerando ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <Play className="size-3.5" />
                        )}
                        Gerar Escala
                      </Button>
                    </>
                  )}

                  {escalaTab === 'historico' && historicoCompleta?.escala.status === 'RASCUNHO' && (
                    <>
                      <Button variant="outline" size="sm" onClick={handleOficializar} disabled={oficializando}>
                        {oficializando ? 'Oficializando...' : 'Oficializar'}
                      </Button>
                      <Button variant="outline" size="sm" onClick={handleDescartar} disabled={descartando}>
                        {descartando ? 'Descartando...' : 'Descartar'}
                      </Button>
                    </>
                  )}

                  {activeEscalaCompleta && (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => abrirModalExportacao(activeEscalaCompleta)}
                      >
                        Exportar
                      </Button>
                      <Button variant="outline" size="sm" asChild>
                        <Link to={`/setores/${setorId}/escala?escalaId=${activeEscalaCompleta.escala.id}&origem=${escalaTab}`}>
                          Ver completo
                        </Link>
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {escalaTab === 'simulacao' && (
                <div className="space-y-4">
                  <PreflightChecklist items={[
                    { ok: !!empresa, label: 'Empresa configurada', linkTo: '/empresa' },
                    { ok: (tiposContrato?.length ?? 0) > 0, label: 'Tipo de contrato cadastrado', linkTo: '/tipos-contrato' },
                    { ok: (orderedColabs?.length ?? 0) > 0, label: 'Colaborador(es) ativo(s) no setor', linkTo: '/colaboradores', hint: 'Cadastre na secao Colaboradores acima' },
                    { ok: (demandas?.length ?? 0) > 0, label: 'Demanda cadastrada (faixas horarias)' },
                  ]} />

                  {simulacaoPreview.resultado.sucesso && simulacaoGridData ? (
                    <div className="space-y-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold">Ciclo Rotativo</p>
                        <Badge variant="outline" className="text-xs">Preview</Badge>
                      </div>
                      <CicloGrid
                        data={simulacaoGridData}
                        mode="edit"
                        onFolgaChange={handlePreviewFolgaChange}
                        frameBorderClassName={previewCardTone.frame}
                        coverageActions={{
                          showSuggest: modoSimulacaoEfetivo === 'SETOR',
                          suggestDisabled: advisoryLoading,
                          onSuggest: modoSimulacaoEfetivo === 'SETOR' ? handleSugerirTS : undefined,
                          onResetAutomatico: () => handleResetarSimulacao('automatico'),
                          onRestaurarColaboradores: modoSimulacaoEfetivo === 'SETOR'
                            ? () => handleResetarSimulacao('colaboradores')
                            : undefined,
                        }}
                      />
                      <AvisosSection
                        avisos={previewAvisos}
                        onAnalisarIa={abrirAnaliseIa}
                      />
                    </div>
                  ) : (
                    <div className="rounded-lg border border-dashed px-4 py-5">
                      <p className="text-sm font-medium text-foreground">
                        {simulacaoPreview.resultado.erro ?? (
                          regimeEfetivo === '6X1'
                            ? 'Preview de ciclo disponivel apenas para regime 5x2. Use Gerar Escala para montar a escala deste setor.'
                            : 'Configure postos e demandas para ver o preview do ciclo.'
                        )}
                      </p>
                      {previewAvisos.length > 0 && (
                        <AvisosSection
                          avisos={previewAvisos}
                          onAnalisarIa={abrirAnaliseIa}
                        />
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Sheet de sugestao — advisory pipeline */}
              <SugestaoSheet
                open={sugestaoOpen}
                onOpenChange={setSugestaoOpen}
                loading={advisoryLoading}
                advisory={advisoryResult}
                mode={sugestaoMode}
                previewDiagnostics={previewDiagnostics}
                onAceitar={async () => {
                  if (!advisoryResult?.proposal) return
                  try {
                    atualizarSimulacaoConfig((prev) => ({
                      ...prev,
                      setor: {
                        ...prev.setor,
                        overrides_locais: advisoryResult.proposal!.diff.reduce((acc, d) => {
                          const nextOverride = mergeOverrideLocalWithBase(d.colaborador_id, {
                            fixa: d.fixa_proposta,
                            variavel: d.variavel_proposta,
                          })
                          if (nextOverride) {
                            acc[String(d.colaborador_id)] = nextOverride
                          } else {
                            delete acc[String(d.colaborador_id)]
                          }
                          return acc
                        }, { ...prev.setor.overrides_locais }),
                      },
                    }))
                    toast.success('Sugestao aplicada na simulacao')
                    setSugestaoOpen(false)
                    setAdvisoryResult(null)
                  } catch {
                    toast.error('Erro ao aplicar sugestao')
                  }
                }}
                onDescartar={() => {
                  setSugestaoOpen(false)
                  setAdvisoryResult(null)
                }}
                onAnalisarIa={abrirAnaliseIa}
              />

              {escalaTab === 'oficial' && (
                <div className="space-y-4">
                  {!escalaOficialAtual ? (
                    <div className="rounded-lg border border-dashed px-4 py-5">
                      <p className="text-sm font-medium text-foreground">Nenhuma escala oficial encontrada</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Gere uma simulacao e oficialize para aparecer aqui.
                      </p>
                      <Button variant="outline" size="sm" className="mt-3" onClick={() => setEscalaSelecionada('simulacao')}>
                        Ir para Simulacao
                      </Button>
                    </div>
                  ) : carregandoTabEscala ? (
                    <div className="flex items-center justify-center py-10">
                      <Loader2 className="size-5 animate-spin text-muted-foreground" />
                    </div>
                  ) : oficialCompleta ? (
                    <div className="space-y-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold">Ciclo Rotativo</p>
                        <StatusBadge status="OFICIAL" />
                        {oficialCompleta.escala.criada_em && (
                          <span className="text-xs text-muted-foreground">Gerado em {formatarDataHora(oficialCompleta.escala.criada_em)}</span>
                        )}
                      </div>
                      {oficialGridData && (
                        <CicloGrid data={oficialGridData} mode="view" />
                      )}
                      {oficialCompleta.comparacao_demanda.length > 0 && (
                        <CoberturaChart
                          comparacao={oficialCompleta.comparacao_demanda}
                          indicadores={oficialCompleta.indicadores}
                          className="rounded-md border p-3"
                        />
                      )}
                    </div>
                  ) : null}
                </div>
              )}

              {escalaTab === 'historico' && (
                <div className="space-y-4">
                  {escalasHistorico.length === 0 ? (
                    <div className="rounded-lg border border-dashed px-4 py-5">
                      <p className="text-sm font-medium text-foreground">Historico vazio</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Ainda nao existem escalas arquivadas para este setor.
                      </p>
                      <Button variant="outline" size="sm" className="mt-3" onClick={() => setEscalaSelecionada('simulacao')}>
                        Gerar primeira simulacao
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {carregandoTabEscala ? (
                        <div className="flex items-center justify-center py-10">
                          <Loader2 className="size-5 animate-spin text-muted-foreground" />
                        </div>
                      ) : historicoCompleta ? (
                        <div className="space-y-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-semibold">Ciclo Rotativo</p>
                            <Badge variant="outline" className="text-xs">
                              {historicoCompleta.escala.status}
                            </Badge>
                            {historicoCompleta.escala.criada_em && (
                              <span className="text-xs text-muted-foreground">Gerado em {formatarDataHora(historicoCompleta.escala.criada_em)}</span>
                            )}
                          </div>
                          {historicoGridData && (
                            <CicloGrid data={historicoGridData} mode="view" />
                          )}
                          {historicoCompleta.comparacao_demanda.length > 0 && (
                            <CoberturaChart
                              comparacao={historicoCompleta.comparacao_demanda}
                              indicadores={historicoCompleta.indicadores}
                              className="rounded-md border p-3"
                            />
                          )}
                        </div>
                      ) : null}
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Excecoes de Demanda por Data — oculto (IA configura via tool) */}

        {/* Solver progress overlay */}
        {gerando && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/60 backdrop-blur-sm animate-in fade-in-0 duration-200">
            <Card className="w-full max-w-sm border shadow-lg">
              <CardContent className="flex flex-col gap-4 pt-6">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">Gerando escala — {setor?.nome ?? 'setor'}</p>
                  <span className="font-mono text-xs tabular-nums text-muted-foreground">
                    {Math.floor(solverElapsed / 60).toString().padStart(2, '0')}:{(solverElapsed % 60).toString().padStart(2, '0')}
                  </span>
                </div>

                <ScrollArea ref={solverScrollRef} className="h-36 rounded-md border bg-muted/50 px-3 py-2">
                  <div className="flex flex-col gap-1">
                    {solverLogs.length === 0 ? (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Loader2 className="size-3 animate-spin" />
                        Iniciando motor...
                      </div>
                    ) : (
                      solverLogs.map((line, i) => (
                        <p key={i} className={`text-xs leading-relaxed ${i === solverLogs.length - 1 ? 'text-foreground font-medium' : 'text-muted-foreground'}`}>
                          {line}
                        </p>
                      ))
                    )}
                  </div>
                </ScrollArea>

                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="size-3 animate-spin text-primary" />
                    Calculando...
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 gap-1.5 text-xs"
                    onClick={async () => {
                      await escalasService.cancelar()
                      toast('Geracao cancelada')
                      setGerando(false)
                    }}
                  >
                    <Square className="size-2.5" />
                    Cancelar
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>

      <ExportModal
        open={exportOpen}
        onOpenChange={setExportOpen}
        mode="setor"
        escalaData={escalaExportData}
        onExportHTML={handleExportHTML}
        onPrint={handlePrint}
        onCSV={handleCSV}
      />

      <DirtyGuardDialog
        blocker={blocker}
        onSaveAndExit={async () => {
          const saved = await handleSalvarTudo()
          if (!saved) throw new Error('SAVE_FAILED')
        }}
      />

      {/* ─── Excecao Demanda por Data Dialog ─── */}
      <Dialog open={showExcDemandaDialog} onOpenChange={setShowExcDemandaDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Excecao de Demanda por Data</DialogTitle>
            <DialogDescription>
              Defina uma demanda diferente para uma data especifica (feriado, evento, etc.).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Data</Label>
              <Input
                type="date"
                value={excDemandaForm.data}
                onChange={(e) => setExcDemandaForm((p) => ({ ...p, data: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Hora Inicio</Label>
                <Input
                  type="time"
                  step="900"
                  value={excDemandaForm.hora_inicio}
                  onChange={(e) => setExcDemandaForm((p) => ({ ...p, hora_inicio: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label>Hora Fim</Label>
                <Input
                  type="time"
                  step="900"
                  value={excDemandaForm.hora_fim}
                  onChange={(e) => setExcDemandaForm((p) => ({ ...p, hora_fim: e.target.value }))}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Minimo de Pessoas</Label>
              <Input
                type="number"
                min="0"
                value={excDemandaForm.min_pessoas}
                onChange={(e) => setExcDemandaForm((p) => ({ ...p, min_pessoas: parseInt(e.target.value) || 0 }))}
              />
            </div>
            <div className="flex items-center gap-3">
              <Switch
                checked={excDemandaForm.override}
                onCheckedChange={(checked) => setExcDemandaForm((p) => ({ ...p, override: checked }))}
              />
              <div>
                <Label>Sobrescrever demanda padrao</Label>
                <p className="text-xs text-muted-foreground">
                  Quando ativo, substitui completamente a demanda semanal nesta faixa
                </p>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowExcDemandaDialog(false)}>
              Cancelar
            </Button>
            <Button onClick={handleSalvarExcDemanda} disabled={excDemandaSalvando || isPreviewMode}>
              {excDemandaSalvando ? 'Salvando...' : 'Salvar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showPostoDialog} onOpenChange={closePostoDialog}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{postoDialogMode === 'create' ? 'Novo Posto' : 'Editar Posto'}</DialogTitle>
            <DialogDescription>
              {postoDialogMode === 'create'
                ? 'Defina o nome do posto. Se ele ainda nao entrar na hierarquia, crie direto no banco de espera.'
                : 'Atualize o nome do posto e o titular anexado. Quando ele sair da hierarquia, mova para espera.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-5 py-4">
            <div className="space-y-2">
              <Label>Nome do Posto</Label>
              <Input
                placeholder="Ex: Caixa, Repositor, Seguranca"
                value={postoDialogApelido}
                onChange={(e) => setPostoDialogApelido(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    void handleSalvarPostoDialog()
                  }
                }}
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label>Titular</Label>
              <div className="flex items-start justify-between gap-3 rounded-md border px-3 py-3">
                <div className="min-w-0">
                  {postoDialogTitularAtual ? (
                    <>
                      <p className="truncate text-sm font-medium text-foreground">{postoDialogTitularAtual.nome}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {getDescricaoBuscaColaborador(postoDialogTitularAtual)}
                      </p>
                    </>
                  ) : (
                    <p className="text-sm italic text-muted-foreground">Vazio</p>
                  )}
                </div>

                <Popover
                  open={postoDialogTitularPickerOpen}
                  onOpenChange={(open) => {
                    setPostoDialogTitularPickerOpen(open)
                    if (!open) setPostoDialogSearchTerm('')
                  }}
                >
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <PopoverTrigger asChild>
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="size-8 shrink-0"
                          disabled={salvandoPosto || deletandoPosto}
                          aria-label="Gerenciar titular"
                        >
                          <Users className="size-4" />
                        </Button>
                      </PopoverTrigger>
                    </TooltipTrigger>
                    <TooltipContent>Gerenciar titular</TooltipContent>
                  </Tooltip>
                  <PopoverContent
                    className="w-[22rem] p-0"
                    side="bottom"
                    align="end"
                    sideOffset={8}
                    collisionPadding={16}
                    style={{ maxHeight: 'min(var(--radix-popover-content-available-height), 24rem)' }}
                  >
                    <TitularAssignmentPanel
                      titular={postoDialogTitularAtual}
                      candidatos={colaboradoresFiltradosDialogo}
                      funcaoMap={funcaoMap}
                      contratoMap={contratoMap}
                      searchTerm={postoDialogSearchTerm}
                      onSearchTermChange={setPostoDialogSearchTerm}
                      onSelectColaborador={(colaboradorId) => {
                        void handleSelecionarNoAutocomplete('dialog', postoDialogPostoId ?? 0, colaboradorId)
                        setPostoDialogTitularPickerOpen(false)
                        setPostoDialogSearchTerm('')
                      }}
                      onRemoveTitular={postoDialogTitularAtual ? () => {
                        setPostoDialogTitularId(null)
                        setPostoDialogTitularPickerOpen(false)
                        setPostoDialogSearchTerm('')
                      } : undefined}
                      removeLabel="Mover para espera"
                      getDescricaoBuscaColaborador={getDescricaoBuscaColaborador}
                      loading={salvandoPosto || deletandoPosto}
                    />
                  </PopoverContent>
                </Popover>
              </div>
            </div>
          </div>
          <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              {postoDialogMode === 'edit' && (
                <Button
                  type="button"
                  variant="outline"
                  className="gap-2"
                  disabled={salvandoPosto || deletandoPosto}
                  onClick={() => { void handleMoverPostoDialogParaEspera() }}
                >
                  <Archive className="size-4" />
                  Mover para espera
                </Button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={() => closePostoDialog(false)} disabled={salvandoPosto || deletandoPosto}>
                Cancelar
              </Button>
              <Button
                onClick={() => { void handleSalvarPostoDialog() }}
                disabled={salvandoPosto || !postoDialogApelido.trim() || isPreviewMode}
              >
                {salvandoPosto
                  ? (postoDialogMode === 'create' ? 'Criando...' : 'Salvando...')
                  : (postoDialogMode === 'create' ? 'Criar' : 'Salvar')}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!pendingAutocompleteSwap} onOpenChange={(open) => { if (!open) setPendingAutocompleteSwap(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Trocar colaborador de posto?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingAutocompleteSwap ? (
                <>
                  <strong>{pendingAutocompleteSwap.colaboradorNome}</strong> ja esta no posto{' '}
                  <strong>{pendingAutocompleteSwap.postoOrigemNome}</strong>. Deseja remover de lá e trazer para{' '}
                  <strong>{pendingAutocompleteSwap.postoDestinoNome}</strong>?
                </>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => { void handleConfirmarAutocompleteSwap() }}>
              Trocar posto
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <SolverConfigDrawer
        open={solverConfigOpen}
        onOpenChange={setSolverConfigOpen}
        config={solverSessionConfig}
        onConfigChange={setSolverSessionConfig}
        periodoPreset={periodoPreset}
        onPeriodoPresetChange={setPeriodoPreset}
      />

    </div>
  )
}
