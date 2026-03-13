import { useState, useMemo, useCallback, useRef, useEffect, type MouseEvent } from 'react'
import { Plus, Clock, Minus, Trash2, BarChart3, Table2, MoreHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
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
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { toMinutes, minutesToTime, formatarMinutos } from '@/lib/formatadores'
import {
  buildTimelineBarGeometry,
  normalizeTimelineInterval,
  DEMANDA_MIN_DURATION_MINUTES,
  DEMANDA_SNAP_MINUTES,
} from '@/lib/timeline-demanda'
import { EmptyState } from '@/componentes/EmptyState'
import { DemandaBar } from '@/componentes/DemandaBar'
import { useDemandaResize } from '@/hooks/useDemandaResize'
import type {
  Setor,
  Demanda,
  SetorHorarioSemana,
} from '@shared/index'
import type { DiaSemana } from '@shared/constants'
import { DIAS_SEMANA } from '@shared/constants'

type ViewMode = 'timeline' | 'tabela'

const OPERACIONAL_BAR_ID = -999 as const
const OPERACIONAL_MIN_DURATION_MINUTES = 60

const DIAS_LABELS: Record<DiaSemana, string> = {
  SEG: 'Seg',
  TER: 'Ter',
  QUA: 'Qua',
  QUI: 'Qui',
  SEX: 'Sex',
  SAB: 'Sab',
  DOM: 'Dom',
}

const DIAS_LABELS_FULL: Record<DiaSemana, string> = {
  SEG: 'Segunda',
  TER: 'Terca',
  QUA: 'Quarta',
  QUI: 'Quinta',
  SEX: 'Sexta',
  SAB: 'Sabado',
  DOM: 'Domingo',
}

// ─── Shared timeline primitives ───────────────────────────────────────────────

interface TimelineAxisProps {
  timeLabels: string[]
  totalMinutes: number
  displayOpenMin: number
}

function TimelineAxis({ timeLabels, totalMinutes, displayOpenMin }: TimelineAxisProps) {
  return (
    <>
      <div className="relative flex border-b bg-muted/30 dark:bg-muted/20">
        {timeLabels.map((label, i) => (
          <div
            key={label}
            className="text-center text-xs font-medium text-muted-foreground py-1.5"
            style={{
              width: `${(60 / totalMinutes) * 100}%`,
              marginLeft: i === 0 ? `${((toMinutes(label) - displayOpenMin) / totalMinutes) * 100}%` : undefined,
              position: i === 0 ? 'relative' : undefined,
            }}
          >
            {label}
          </div>
        ))}
      </div>
      <div className="relative h-1 bg-muted/20">
        {timeLabels.map((label) => {
          const pos = ((toMinutes(label) - displayOpenMin) / totalMinutes) * 100
          return (
            <div
              key={`tick-${label}`}
              className="absolute top-0 h-full w-px bg-border/50"
              style={{ left: `${pos}%` }}
            />
          )
        })}
      </div>
    </>
  )
}

interface TimelineShellProps {
  timeLabels: string[]
  totalMinutes: number
  displayOpenMin: number
  innerRef?: React.RefObject<HTMLDivElement | null>
  isMainGrid?: boolean
  children: React.ReactNode
}

function TimelineShell({
  timeLabels,
  totalMinutes,
  displayOpenMin,
  innerRef,
  isMainGrid,
  children,
}: TimelineShellProps) {
  return (
    <div className="overflow-x-auto rounded-lg border bg-background">
      <div
        className="min-w-[600px]"
        ref={innerRef}
        data-demanda-grid={isMainGrid ? '' : undefined}
      >
        <TimelineAxis
          timeLabels={timeLabels}
          totalMinutes={totalMinutes}
          displayOpenMin={displayOpenMin}
        />
        {children}
      </div>
    </div>
  )
}

// ─── Draft types ──────────────────────────────────────────────────────────────

interface SegmentoDraft {
  id: number
  hora_inicio: string
  hora_fim: string
  min_pessoas: number
  override: boolean
}

interface PadraoDraft {
  hora_abertura: string
  hora_fechamento: string
  segmentos: SegmentoDraft[]
}

interface DiaDraft {
  ativo: boolean
  usa_padrao: boolean
  hora_abertura: string
  hora_fechamento: string
  segmentos: SegmentoDraft[]
}

interface SemanaDraft {
  padrao: PadraoDraft
  dias: Record<DiaSemana, DiaDraft>
}

interface DemandaEditorProps {
  setor: Setor
  demandas: Demanda[]
  horariosSemana: SetorHorarioSemana[]
  totalColaboradores: number
}

function sortByInicio(a: { hora_inicio: string }, b: { hora_inicio: string }): number {
  return toMinutes(a.hora_inicio) - toMinutes(b.hora_inicio)
}

function cloneSegmentos(segmentos: SegmentoDraft[], nextIdRef: { current: number }): SegmentoDraft[] {
  return [...segmentos]
    .sort(sortByInicio)
    .map((s) => ({
      id: nextIdRef.current--,
      hora_inicio: s.hora_inicio,
      hora_fim: s.hora_fim,
      min_pessoas: s.min_pessoas,
      override: s.override,
    }))
}

function toDemanda(seg: SegmentoDraft, setorId: number, dia: DiaSemana | null): Demanda {
  return {
    id: seg.id,
    setor_id: setorId,
    dia_semana: dia,
    hora_inicio: seg.hora_inicio,
    hora_fim: seg.hora_fim,
    min_pessoas: seg.min_pessoas,
    override: seg.override,
  }
}

export function DemandaEditor({
  setor,
  demandas,
  horariosSemana,
  totalColaboradores,
}: DemandaEditorProps) {
  const [activeTab, setActiveTab] = useState<'padrao' | DiaSemana>('padrao')
  const [viewMode, setViewMode] = useState<ViewMode>('timeline')
  const [operacionalPopoverOpen, setOperacionalPopoverOpen] = useState(false)

  const nextTempId = useRef(-1)

  const snapshotKey = useMemo(() => {
    const d = demandas
      .map((x) => `${x.id}-${x.dia_semana ?? 'PADRAO'}-${x.hora_inicio}-${x.hora_fim}-${x.min_pessoas}-${x.override ? 1 : 0}`)
      .sort()
      .join('|')
    const h = horariosSemana
      .map((x) => `${x.dia_semana}-${x.ativo ? 1 : 0}-${x.usa_padrao ? 1 : 0}-${x.hora_abertura}-${x.hora_fechamento}`)
      .sort()
      .join('|')
    return `${setor.id}::${setor.hora_abertura}-${setor.hora_fechamento}::${d}::${h}`
  }, [setor.id, setor.hora_abertura, setor.hora_fechamento, demandas, horariosSemana])

  const buildInitialDraft = useCallback((): SemanaDraft => {
    const maxPositiveId = demandas.reduce((max, d) => Math.max(max, d.id), 0)
    nextTempId.current = -(maxPositiveId + 1)
    const setorOpenMin = toMinutes(setor.hora_abertura)
    const setorCloseMin = toMinutes(setor.hora_fechamento)

    const byDia: Record<DiaSemana, SegmentoDraft[]> = {
      SEG: [], TER: [], QUA: [], QUI: [], SEX: [], SAB: [], DOM: [],
    }

    const padraoLegado: SegmentoDraft[] = []
    for (const d of demandas) {
      const seg: SegmentoDraft = {
        id: d.id,
        hora_inicio: d.hora_inicio,
        hora_fim: d.hora_fim,
        min_pessoas: d.min_pessoas,
        override: Boolean(d.override),
      }
      if (d.dia_semana === null) {
        padraoLegado.push(seg)
      } else {
        byDia[d.dia_semana].push(seg)
      }
    }

    for (const dia of DIAS_SEMANA) {
      byDia[dia] = byDia[dia].sort(sortByInicio)
    }

    const horarioMap = new Map<DiaSemana, SetorHorarioSemana>()
    for (const h of horariosSemana) {
      horarioMap.set(h.dia_semana, h)
    }

    const padraoSegmentosBaseRaw =
      padraoLegado.length > 0
        ? [...padraoLegado].sort(sortByInicio)
        : byDia.SEG.length > 0
          ? cloneSegmentos(byDia.SEG, nextTempId)
          : (() => {
              const firstComSegmento = DIAS_SEMANA.find((dia) => byDia[dia].length > 0)
              if (firstComSegmento) return cloneSegmentos(byDia[firstComSegmento], nextTempId)
              return [
                {
                  id: nextTempId.current--,
                  hora_inicio: setor.hora_abertura,
                  hora_fim: setor.hora_fechamento,
                  min_pessoas: 1,
                  override: false,
                },
              ]
            })()

    const padraoSegmentosBase = padraoSegmentosBaseRaw
      .map((seg) => {
        const start = Math.max(setorOpenMin, toMinutes(seg.hora_inicio))
        const end = Math.min(setorCloseMin, toMinutes(seg.hora_fim))
        if (end - start < 30) return null
        return {
          ...seg,
          hora_inicio: minutesToTime(start),
          hora_fim: minutesToTime(end),
        }
      })
      .filter((seg): seg is SegmentoDraft => seg !== null)

    const padrao: PadraoDraft = {
      hora_abertura: setor.hora_abertura,
      hora_fechamento: setor.hora_fechamento,
      segmentos: padraoSegmentosBase,
    }

    const diasDraft = {} as Record<DiaSemana, DiaDraft>
    for (const dia of DIAS_SEMANA) {
      const horario = horarioMap.get(dia)
      const usaPadrao = horario?.usa_padrao ?? true
      const aberturaRaw = horario?.hora_abertura ?? setor.hora_abertura
      const fechamentoRaw = horario?.hora_fechamento ?? setor.hora_fechamento
      const aberturaMin = Math.max(setorOpenMin, Math.min(toMinutes(aberturaRaw), setorCloseMin - 60))
      const fechamentoMin = Math.min(setorCloseMin, Math.max(toMinutes(fechamentoRaw), aberturaMin + 60))

      const segmentosDia = cloneSegmentos(byDia[dia], nextTempId)
        .map((seg) => {
          const start = Math.max(aberturaMin, toMinutes(seg.hora_inicio))
          const end = Math.min(fechamentoMin, toMinutes(seg.hora_fim))
          if (end - start < 30) return null
          return {
            ...seg,
            hora_inicio: minutesToTime(start),
            hora_fim: minutesToTime(end),
          }
        })
        .filter((seg): seg is SegmentoDraft => seg !== null)

      diasDraft[dia] = {
        ativo: true,
        usa_padrao: usaPadrao,
        hora_abertura: minutesToTime(aberturaMin),
        hora_fechamento: minutesToTime(fechamentoMin),
        segmentos: segmentosDia,
      }
    }

    return { padrao, dias: diasDraft }
  }, [demandas, horariosSemana, setor.hora_abertura, setor.hora_fechamento])

  const [draft, setDraft] = useState<SemanaDraft>(() => buildInitialDraft())

  useEffect(() => {
    setDraft(buildInitialDraft())
  }, [snapshotKey, buildInitialDraft])

  const currentConfig = useMemo(() => {
    if (activeTab === 'padrao') {
      return {
        usa_padrao: false,
        hora_abertura: draft.padrao.hora_abertura,
        hora_fechamento: draft.padrao.hora_fechamento,
        segmentosEditaveis: draft.padrao.segmentos,
        segmentosGhost: [] as SegmentoDraft[],
        segmentosCobertura: draft.padrao.segmentos,
      }
    }

    const diaCfg = draft.dias[activeTab]
    const usaPadrao = diaCfg.usa_padrao
    const hora_abertura = usaPadrao ? draft.padrao.hora_abertura : diaCfg.hora_abertura
    const hora_fechamento = usaPadrao ? draft.padrao.hora_fechamento : diaCfg.hora_fechamento
    const segmentosEditaveis = usaPadrao ? draft.padrao.segmentos : diaCfg.segmentos
    const segmentosGhost = [] as SegmentoDraft[]
    const segmentosCobertura = segmentosEditaveis

    return {
      usa_padrao: diaCfg.usa_padrao,
      hora_abertura,
      hora_fechamento,
      segmentosEditaveis,
      segmentosGhost,
      segmentosCobertura,
    }
  }, [activeTab, draft])

  const displayOpenMin = toMinutes(setor.hora_abertura)
  const displayCloseMin = toMinutes(setor.hora_fechamento)
  const totalMinutes = Math.max(30, displayCloseMin - displayOpenMin)
  const operationalOpenMin = toMinutes(currentConfig.hora_abertura)
  const operationalCloseMin = toMinutes(currentConfig.hora_fechamento)

  const timeLabels = useMemo(() => {
    const labels: string[] = []
    let current = displayOpenMin
    while (current <= displayCloseMin) {
      labels.push(minutesToTime(current))
      current += 30
    }
    return labels
  }, [displayOpenMin, displayCloseMin])

  const coverageData = useMemo(() => {
    const slots: number[] = []
    const numSlots = Math.ceil(totalMinutes / 30)
    for (let i = 0; i < numSlots; i++) {
      const slotStart = displayOpenMin + i * 30
      let count = 0
      for (const s of currentConfig.segmentosCobertura) {
        const dStart = toMinutes(s.hora_inicio)
        const dEnd = toMinutes(s.hora_fim)
        if (dStart <= slotStart && dEnd > slotStart) {
          count += s.min_pessoas
        }
      }
      slots.push(count)
    }
    return slots
  }, [currentConfig, displayOpenMin, totalMinutes])

  const maxCoverage = Math.max(...coverageData, 1)

  // Total horas-pessoa demandadas na SEMANA e média por colaborador
  const { totalHorasSemana, mediaSemanalPorColab } = useMemo(() => {
    let total = 0
    for (const dia of DIAS_SEMANA) {
      const diaCfg = draft.dias[dia]
      const segs = diaCfg.usa_padrao ? draft.padrao.segmentos : diaCfg.segmentos
      for (const s of segs) {
        const durMin = toMinutes(s.hora_fim) - toMinutes(s.hora_inicio)
        if (durMin > 0) total += (durMin / 60) * s.min_pessoas
      }
    }
    return {
      totalHorasSemana: total,
      mediaSemanalPorColab: totalColaboradores > 0 ? total / totalColaboradores : 0,
    }
  }, [draft, totalColaboradores])

  const clampSegmentosToWindow = useCallback((
    segmentos: SegmentoDraft[],
    horaAbertura: string,
    horaFechamento: string,
  ): SegmentoDraft[] => {
    const open = toMinutes(horaAbertura)
    const close = toMinutes(horaFechamento)
    if (close - open < DEMANDA_MIN_DURATION_MINUTES) return []

    return [...segmentos]
      .map((seg) => {
        const normalized = normalizeTimelineInterval({
          startMin: toMinutes(seg.hora_inicio),
          endMin: toMinutes(seg.hora_fim),
          axisOpenMin: open,
          axisCloseMin: close,
          boundsOpenMin: open,
          boundsCloseMin: close,
          minDurationMin: DEMANDA_MIN_DURATION_MINUTES,
          snapIntervalMin: DEMANDA_SNAP_MINUTES,
        })
        if (!normalized) return null
        return {
          ...seg,
          hora_inicio: minutesToTime(normalized.startMin),
          hora_fim: minutesToTime(normalized.endMin),
        }
      })
      .filter((seg): seg is SegmentoDraft => seg !== null)
      .sort(sortByInicio)
  }, [])

  const setDiaUsePadrao = useCallback((dia: DiaSemana, usarPadrao: boolean) => {
    setDraft((prev) => {
      const atual = prev.dias[dia]
      if (usarPadrao) {
        if (atual.usa_padrao) return prev
        return {
          ...prev,
          dias: {
            ...prev.dias,
            [dia]: {
              ...atual,
              usa_padrao: true,
              hora_abertura: prev.padrao.hora_abertura,
              hora_fechamento: prev.padrao.hora_fechamento,
              segmentos: [],
            },
          },
        }
      }

      if (!atual.usa_padrao) return prev

      return {
        ...prev,
        dias: {
          ...prev.dias,
          [dia]: {
            ...atual,
            usa_padrao: false,
            hora_abertura: prev.padrao.hora_abertura,
            hora_fechamento: prev.padrao.hora_fechamento,
            segmentos: cloneSegmentos(prev.padrao.segmentos, nextTempId),
          },
        },
      }
    })
  }, [])

  const updateHorarioOperacional = useCallback((horaAbertura: string, horaFechamento: string) => {
    const normalizedWindow = normalizeTimelineInterval({
      startMin: toMinutes(horaAbertura),
      endMin: toMinutes(horaFechamento),
      axisOpenMin: displayOpenMin,
      axisCloseMin: displayCloseMin,
      boundsOpenMin: displayOpenMin,
      boundsCloseMin: displayCloseMin,
      minDurationMin: OPERACIONAL_MIN_DURATION_MINUTES,
      snapIntervalMin: DEMANDA_SNAP_MINUTES,
    })
    if (!normalizedWindow) return

    const nextAbertura = minutesToTime(normalizedWindow.startMin)
    const nextFechamento = minutesToTime(normalizedWindow.endMin)

    setDraft((prev) => {
      if (activeTab === 'padrao') {
        return {
          ...prev,
          padrao: {
            ...prev.padrao,
            hora_abertura: nextAbertura,
            hora_fechamento: nextFechamento,
            segmentos: clampSegmentosToWindow(prev.padrao.segmentos, nextAbertura, nextFechamento),
          },
        }
      }

      const atual = prev.dias[activeTab]
      if (atual.usa_padrao) return prev

      return {
        ...prev,
        dias: {
          ...prev.dias,
          [activeTab]: {
            ...atual,
            hora_abertura: nextAbertura,
            hora_fechamento: nextFechamento,
            segmentos: clampSegmentosToWindow(atual.segmentos, nextAbertura, nextFechamento),
          },
        },
      }
    })
  }, [activeTab, clampSegmentosToWindow, displayOpenMin, displayCloseMin])

  const updateEditableSegmentos = useCallback((updater: (list: SegmentoDraft[]) => SegmentoDraft[]) => {
    setDraft((prev) => {
      if (activeTab === 'padrao') {
        return {
          ...prev,
          padrao: {
            ...prev.padrao,
            segmentos: updater(prev.padrao.segmentos),
          },
        }
      }

      const diaCfg = prev.dias[activeTab]
      if (diaCfg.usa_padrao) return prev

      return {
        ...prev,
        dias: {
          ...prev.dias,
          [activeTab]: {
            ...diaCfg,
            segmentos: updater(diaCfg.segmentos),
          },
        },
      }
    })
  }, [activeTab])

  const handleNovaFaixa = () => {
    const availableMinutes = operationalCloseMin - operationalOpenMin
    if (availableMinutes < DEMANDA_MIN_DURATION_MINUTES) return
    const defaultDuration = Math.min(240, availableMinutes)
    const snappedDuration = Math.max(DEMANDA_MIN_DURATION_MINUTES, Math.floor(defaultDuration / DEMANDA_SNAP_MINUTES) * DEMANDA_SNAP_MINUTES)

    // Novo segmento: depois da última faixa, ou alinhado à direita se não couber
    const existingSegs = currentConfig.segmentosEditaveis
    const lastEnd = existingSegs.length > 0
      ? Math.max(...existingSegs.map((s) => toMinutes(s.hora_fim)))
      : operationalOpenMin
    const midPoint = lastEnd <= operationalCloseMin - DEMANDA_MIN_DURATION_MINUTES
      ? Math.floor(lastEnd / DEMANDA_SNAP_MINUTES) * DEMANDA_SNAP_MINUTES
      : Math.max(operationalOpenMin, Math.floor((operationalCloseMin - snappedDuration) / DEMANDA_SNAP_MINUTES) * DEMANDA_SNAP_MINUTES)
    const endPoint = Math.min(midPoint + snappedDuration, operationalCloseMin)

    setDraft((prev) => {
      const novoSegmento: SegmentoDraft = {
        id: nextTempId.current--,
        hora_inicio: minutesToTime(midPoint),
        hora_fim: minutesToTime(endPoint),
        min_pessoas: 1,
        override: false,
      }

      if (activeTab === 'padrao') {
        return {
          ...prev,
          padrao: {
            ...prev.padrao,
            segmentos: [...prev.padrao.segmentos, novoSegmento],
          },
        }
      }

      const diaAtual = prev.dias[activeTab]
      if (diaAtual.usa_padrao) return prev

      return {
        ...prev,
        dias: {
          ...prev.dias,
          [activeTab]: {
            ...diaAtual,
            segmentos: [...diaAtual.segmentos, novoSegmento],
          },
        },
      }
    })
  }

  const maxPessoas = Math.max(1, totalColaboradores)

  const handleUpdatePessoas = useCallback((id: number, delta: number) => {
    updateEditableSegmentos((prev) =>
      prev.map((d) => {
        if (d.id !== id) return d
        return { ...d, min_pessoas: Math.min(maxPessoas, Math.max(1, d.min_pessoas + delta)) }
      }),
    )
  }, [updateEditableSegmentos, maxPessoas])

  const handleUpdateTimes = (id: number, hora_inicio: string, hora_fim: string) => {
    const normalized = normalizeTimelineInterval({
      startMin: toMinutes(hora_inicio),
      endMin: toMinutes(hora_fim),
      axisOpenMin: displayOpenMin,
      axisCloseMin: displayCloseMin,
      boundsOpenMin: operationalOpenMin,
      boundsCloseMin: operationalCloseMin,
      minDurationMin: DEMANDA_MIN_DURATION_MINUTES,
      snapIntervalMin: DEMANDA_SNAP_MINUTES,
    })
    if (!normalized) return

    const nextInicio = minutesToTime(normalized.startMin)
    const nextFim = minutesToTime(normalized.endMin)

    updateEditableSegmentos((prev) =>
      prev.map((d) => (d.id === id ? { ...d, hora_inicio: nextInicio, hora_fim: nextFim } : d)),
    )
  }

  const handleDelete = async (id: number) => {
    updateEditableSegmentos((prev) => prev.filter((d) => d.id !== id))
  }

  const handleTableTimeChange = (id: number, field: 'inicio' | 'fim', value: string) => {
    if (!value.match(/^\d{2}:\d{2}$/)) return
    const dem = currentConfig.segmentosEditaveis.find((d) => d.id === id)
    if (!dem) return

    if (field === 'inicio') {
      handleUpdateTimes(id, value, dem.hora_fim)
    } else {
      handleUpdateTimes(id, dem.hora_inicio, value)
    }
  }

  const handleOperationalTimeChange = (field: 'inicio' | 'fim', value: string) => {
    if (!value.match(/^\d{2}:\d{2}$/)) return

    if (field === 'inicio') {
      updateHorarioOperacional(value, currentConfig.hora_fechamento)
      return
    }

    updateHorarioOperacional(currentConfig.hora_abertura, value)
  }

  const toDemandaList = useCallback((segments: SegmentoDraft[], dia: DiaSemana | null): Demanda[] => {
    return segments.map((s) => toDemanda(s, setor.id, dia))
  }, [setor.id])

  const editableDemandas = useMemo(() => {
    return toDemandaList(currentConfig.segmentosEditaveis, activeTab === 'padrao' ? null : activeTab)
  }, [activeTab, currentConfig.segmentosEditaveis, toDemandaList])

  const ghostDemandas = useMemo(() => {
    return toDemandaList(currentConfig.segmentosGhost, activeTab === 'padrao' ? null : activeTab)
  }, [activeTab, currentConfig.segmentosGhost, toDemandaList])

  const diaComDivergencia = useMemo(() => {
    const map: Record<DiaSemana, boolean> = {
      SEG: false, TER: false, QUA: false, QUI: false, SEX: false, SAB: false, DOM: false,
    }
    for (const dia of DIAS_SEMANA) {
      const cfg = draft.dias[dia]
      map[dia] = !cfg.usa_padrao
    }
    return map
  }, [draft])

  // ─── Resize hooks ────────────────────────────────────────────────────────────

  const { resizingId, preview, startResize } = useDemandaResize({
    axisOpenMin: displayOpenMin,
    axisCloseMin: displayCloseMin,
    boundsOpenMin: operationalOpenMin,
    boundsCloseMin: operationalCloseMin,
    minDuration: DEMANDA_MIN_DURATION_MINUTES,
    snapInterval: DEMANDA_SNAP_MINUTES,
    onResizeEnd: (demandaId, result) => {
      handleUpdateTimes(demandaId, result.hora_inicio, result.hora_fim)
    },
  })

  const operacionalGridRef = useRef<HTMLDivElement | null>(null)

  const {
    resizingId: resizingOperacionalId,
    preview: previewOperacional,
    startResize: startResizeOperacional,
  } = useDemandaResize({
    axisOpenMin: displayOpenMin,
    axisCloseMin: displayCloseMin,
    boundsOpenMin: displayOpenMin,
    boundsCloseMin: displayCloseMin,
    minDuration: OPERACIONAL_MIN_DURATION_MINUTES,
    snapInterval: DEMANDA_SNAP_MINUTES,
    onResizeEnd: (_id, result) => {
      updateHorarioOperacional(result.hora_inicio, result.hora_fim)
    },
  })

  // ─── Renderers ───────────────────────────────────────────────────────────────

  const renderGhostBar = (dem: Demanda, index: number) => {
    const barGeometry = buildTimelineBarGeometry({
      startMin: toMinutes(dem.hora_inicio),
      endMin: toMinutes(dem.hora_fim),
      axisOpenMin: displayOpenMin,
      axisCloseMin: displayCloseMin,
      boundsOpenMin: operationalOpenMin,
      boundsCloseMin: operationalCloseMin,
    })

    const colors = [
      'bg-emerald-500/30 border-emerald-600/30',
      'bg-blue-500/30 border-blue-600/30',
      'bg-purple-500/30 border-purple-600/30',
      'bg-amber-500/30 border-amber-600/30',
      'bg-pink-500/30 border-pink-600/30',
    ][index % 5]

    return (
      <div key={`ghost-${dem.id}`} className="relative h-10 pointer-events-none opacity-40">
        <div className="absolute inset-0 rounded-md bg-muted/30 dark:bg-muted/20" />
        <div
          className={cn('absolute top-0 h-full rounded-md border flex items-center', colors)}
          style={{
            left: `${barGeometry.leftPercent}%`,
            width: barGeometry.widthStyle,
          }}
        >
          <div className="flex flex-1 items-center justify-center gap-1.5 overflow-hidden px-3 text-xs font-medium text-muted-foreground min-w-0">
            <span className="truncate">
              {dem.hora_inicio} - {dem.hora_fim}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-2 mr-3">
            <div className="flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-xs font-bold bg-muted/60 text-muted-foreground">
              <Clock className="size-2.5" />
              {dem.min_pessoas}
            </div>
          </div>
        </div>
      </div>
    )
  }

  const renderTableRow = (dem: Demanda, isGhost: boolean) => {
    const duration = toMinutes(dem.hora_fim) - toMinutes(dem.hora_inicio)
    return (
      <TableRow key={isGhost ? `ghost-${dem.id}` : dem.id} className={cn(isGhost && 'opacity-40')}>
        <TableCell>
          <div className="flex items-center gap-2">
            <Clock className="size-3.5 text-muted-foreground" />
            {isGhost ? (
              <span className="text-sm">{dem.hora_inicio} - {dem.hora_fim}</span>
            ) : (
              <div className="flex items-center gap-1">
                <Input
                  type="time"
                  defaultValue={dem.hora_inicio}
                  step={DEMANDA_SNAP_MINUTES * 60}
                  className="h-7 w-[90px] text-xs"
                  onBlur={(e) => handleTableTimeChange(dem.id, 'inicio', e.target.value)}
                />
                <span className="text-xs text-muted-foreground">-</span>
                <Input
                  type="time"
                  defaultValue={dem.hora_fim}
                  step={DEMANDA_SNAP_MINUTES * 60}
                  className="h-7 w-[90px] text-xs"
                  onBlur={(e) => handleTableTimeChange(dem.id, 'fim', e.target.value)}
                />
              </div>
            )}
          </div>
        </TableCell>
        <TableCell className="text-muted-foreground text-xs">{formatarMinutos(duration)}</TableCell>
        <TableCell>
          {isGhost ? (
            <span className="text-sm">{dem.min_pessoas}</span>
          ) : (
            <div className="flex items-center gap-1.5">
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="size-6"
                onClick={(e: MouseEvent) => {
                  e.stopPropagation()
                  handleUpdatePessoas(dem.id, -1)
                }}
                disabled={dem.min_pessoas <= 1}
              >
                <Minus className="size-3" />
              </Button>
              <span className="w-6 text-center text-sm font-medium tabular-nums">{dem.min_pessoas}</span>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="size-6"
                onClick={(e: MouseEvent) => {
                  e.stopPropagation()
                  handleUpdatePessoas(dem.id, 1)
                }}
                disabled={dem.min_pessoas >= maxPessoas}
              >
                <Plus className="size-3" />
              </Button>
            </div>
          )}
        </TableCell>
        <TableCell>
          {dem.dia_semana ? (
            <Badge variant="outline" className="text-xs">{DIAS_LABELS_FULL[dem.dia_semana]}</Badge>
          ) : (
            <span className="text-xs text-muted-foreground">Padrao</span>
          )}
        </TableCell>
        <TableCell className="text-right">
          {!isGhost && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="ghost" size="icon" className="size-7 text-destructive hover:text-destructive">
                  <Trash2 className="size-3.5" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Remover faixa?</AlertDialogTitle>
                  <AlertDialogDescription>
                    A faixa {dem.hora_inicio} - {dem.hora_fim} ({dem.min_pessoas} pessoas) sera removida.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                  <AlertDialogAction onClick={() => handleDelete(dem.id)}>Remover</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </TableCell>
      </TableRow>
    )
  }

  const renderTableView = () => {
    if (editableDemandas.length === 0 && ghostDemandas.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center py-8 text-xs text-muted-foreground gap-2">
          <span>Nenhuma faixa definida</span>
          <Button variant="ghost" size="sm" onClick={handleNovaFaixa}>
            <Plus className="mr-1 size-3.5" /> Adicionar faixa
          </Button>
        </div>
      )
    }

    return (
      <div className="rounded-lg border bg-background">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Horario</TableHead>
              <TableHead className="w-[80px]">Duracao</TableHead>
              <TableHead className="w-[130px]">Pessoas</TableHead>
              <TableHead className="w-[100px]">Dia</TableHead>
              <TableHead className="w-[50px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {ghostDemandas.map((dem) => renderTableRow(dem, true))}
            {editableDemandas.length === 0 && ghostDemandas.length > 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-4">
                  <div className="text-xs text-muted-foreground">
                    Dia herdando o padrao semanal.
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              editableDemandas.map((dem) => renderTableRow(dem, false))
            )}
          </TableBody>
        </Table>
      </div>
    )
  }

  // ─── Operational bar popover content (shared between timeline and table views) ─
  const renderOperacionalPopover = () => (
    <Popover open={operacionalPopoverOpen} onOpenChange={setOperacionalPopoverOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex size-6 items-center justify-center rounded opacity-80 transition-opacity hover:bg-black/10 hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-35"
          disabled={!canEditCurrent}
        >
          <MoreHorizontal className="size-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent side="bottom" align="end" className="w-64 p-4 space-y-4">
        <div className="space-y-2">
          <label className="text-xs font-medium text-muted-foreground">Horario do dia</label>
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
            <Input
              type="time"
              defaultValue={currentConfig.hora_abertura}
              step={DEMANDA_SNAP_MINUTES * 60}
              min={minutesToTime(displayOpenMin)}
              max={minutesToTime(displayCloseMin - OPERACIONAL_MIN_DURATION_MINUTES)}
              className="h-8 text-xs"
              onBlur={(e) => handleOperationalTimeChange('inicio', e.target.value)}
            />
            <span className="text-xs text-muted-foreground">ate</span>
            <Input
              type="time"
              defaultValue={currentConfig.hora_fechamento}
              step={DEMANDA_SNAP_MINUTES * 60}
              min={minutesToTime(displayOpenMin + OPERACIONAL_MIN_DURATION_MINUTES)}
              max={minutesToTime(displayCloseMin)}
              className="h-8 text-xs"
              onBlur={(e) => handleOperationalTimeChange('fim', e.target.value)}
            />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )

  // ─── Combined timeline: ONE axis, operational bar + divider + demand bars ────
  const renderTimelineView = () => {
    const opHoraAbertura = previewOperacional?.id === OPERACIONAL_BAR_ID
      ? previewOperacional.hora_inicio
      : currentConfig.hora_abertura
    const opHoraFechamento = previewOperacional?.id === OPERACIONAL_BAR_ID
      ? previewOperacional.hora_fim
      : currentConfig.hora_fechamento

    const opGeometry = buildTimelineBarGeometry({
      startMin: toMinutes(opHoraAbertura),
      endMin: toMinutes(opHoraFechamento),
      axisOpenMin: displayOpenMin,
      axisCloseMin: displayCloseMin,
      boundsOpenMin: displayOpenMin,
      boundsCloseMin: displayCloseMin,
    })
    const opStartMin = opGeometry.startMin
    const opEndMin = opGeometry.endMin
    const isResizingOp = resizingOperacionalId === OPERACIONAL_BAR_ID

    // Live disabled overlays — update during drag of the operational bar
    const liveDisabledBefore = Math.max(0, opGeometry.leftPercent)
    const liveDisabledAfter = Math.max(0, 100 - (opGeometry.leftPercent + opGeometry.widthPercent))

    const handleOpResizeLeft = (e: React.PointerEvent) => {
      if (!operacionalGridRef.current) return
      startResizeOperacional(e, OPERACIONAL_BAR_ID, 'left', opStartMin, opEndMin, operacionalGridRef.current)
    }
    const handleOpResizeRight = (e: React.PointerEvent) => {
      if (!operacionalGridRef.current) return
      startResizeOperacional(e, OPERACIONAL_BAR_ID, 'right', opStartMin, opEndMin, operacionalGridRef.current)
    }

    return (
      <TimelineShell
        timeLabels={timeLabels}
        totalMinutes={totalMinutes}
        displayOpenMin={displayOpenMin}
        innerRef={operacionalGridRef}
        isMainGrid
      >
        {/* ── Operational bar row ── */}
        <div className="relative px-2 pt-2 pb-1.5">
          <div className="group relative h-9">
            <div className="absolute inset-0 rounded-md bg-muted/30 dark:bg-muted/20" />

            {/* Disabled overlays — live during drag */}
            {liveDisabledBefore > 0 && (
              <div
                className="pointer-events-none absolute inset-y-0 left-0 rounded-l-md bg-muted/70 dark:bg-muted/60"
                style={{ width: `${liveDisabledBefore}%` }}
              />
            )}
            {liveDisabledAfter > 0 && (
              <div
                className="pointer-events-none absolute inset-y-0 right-0 rounded-r-md bg-muted/70 dark:bg-muted/60"
                style={{ width: `${liveDisabledAfter}%` }}
              />
            )}

            <div
              className={cn(
                'absolute top-0 h-full rounded-md border border-sky-600 bg-sky-500/80 text-white shadow-sm flex items-center select-none',
                isResizingOp && 'ring-2 ring-primary shadow-lg cursor-col-resize',
                operacionalPopoverOpen && 'ring-2 ring-primary/60 shadow-lg',
              )}
              style={{ left: `${opGeometry.leftPercent}%`, width: opGeometry.widthStyle }}
            >
              {/* Left resize handle — pipes always visible at low opacity */}
              <div
                className="absolute left-0 top-0 h-full w-4 cursor-col-resize rounded-l-md z-10 flex items-center justify-center opacity-25 group-hover:opacity-80 hover:!opacity-100 transition-opacity"
                onPointerDown={handleOpResizeLeft}
              >
                <div className="flex gap-[3px]">
                  <div className="w-px h-3.5 rounded-full bg-white" />
                  <div className="w-px h-3.5 rounded-full bg-white" />
                </div>
              </div>

              <div className="flex flex-1 items-center gap-2 overflow-hidden px-5 text-xs font-medium min-w-0">
                <span className="shrink-0 opacity-70 font-normal">Horário de trabalho</span>
                <span className="text-white/40 shrink-0">·</span>
                <span className="truncate font-semibold tracking-wide">
                  {opHoraAbertura} – {opHoraFechamento}
                </span>
                {isResizingOp && (
                  <span className="shrink-0 text-xs opacity-70">({formatarMinutos(opEndMin - opStartMin)})</span>
                )}
              </div>
              <div className="flex shrink-0 items-center mr-3">
                {renderOperacionalPopover()}
              </div>

              {/* Right resize handle — pipes always visible at low opacity */}
              <div
                className="absolute right-0 top-0 h-full w-4 cursor-col-resize rounded-r-md z-10 flex items-center justify-center opacity-25 group-hover:opacity-80 hover:!opacity-100 transition-opacity"
                onPointerDown={handleOpResizeRight}
              >
                <div className="flex gap-[3px]">
                  <div className="w-px h-3.5 rounded-full bg-white" />
                  <div className="w-px h-3.5 rounded-full bg-white" />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ── Double divider (all-day separator pattern) ── */}
        <div className="mx-4 space-y-px">
          <div className="border-t border-border/60" />
          <div className="border-t border-border/60" />
        </div>

        {/* ── Demand bars ── */}
        <div className="relative space-y-1.5 px-2 pt-4 pb-2">
          {liveDisabledBefore > 0 && (
            <div
              className="pointer-events-none absolute inset-y-3 left-0 z-0 rounded-l-md bg-muted/60 dark:bg-muted/50"
              style={{ width: `${liveDisabledBefore}%` }}
            />
          )}
          {liveDisabledAfter > 0 && (
            <div
              className="pointer-events-none absolute inset-y-3 right-0 z-0 rounded-r-md bg-muted/60 dark:bg-muted/50"
              style={{ width: `${liveDisabledAfter}%` }}
            />
          )}

          {ghostDemandas.map((dem, i) => renderGhostBar(dem, i))}

          {editableDemandas.length === 0 && ghostDemandas.length > 0 ? (
            <div className="flex flex-col items-center justify-center py-4 text-xs text-muted-foreground gap-2">
              <span>Dia herdando o padrao semanal.</span>
            </div>
          ) : editableDemandas.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-xs text-muted-foreground gap-2">
              <span>Nenhuma faixa definida</span>
              <Button variant="ghost" size="sm" onClick={handleNovaFaixa}>
                <Plus className="mr-1 size-3.5" /> Adicionar faixa
              </Button>
            </div>
          ) : (
            editableDemandas.map((dem, i) => (
              <DemandaBar
                key={dem.id}
                demanda={dem}
                index={i}
                openMin={displayOpenMin}
                closeMin={displayCloseMin}
                boundsOpenMin={operationalOpenMin}
                boundsCloseMin={operationalCloseMin}
                previewHoraInicio={preview?.id === dem.id ? preview.hora_inicio : undefined}
                previewHoraFim={preview?.id === dem.id ? preview.hora_fim : undefined}
                isResizing={resizingId === dem.id}
                onStartResize={startResize}
                onDelete={handleDelete}
                onUpdatePessoas={handleUpdatePessoas}
                onUpdateTimes={handleUpdateTimes}
                maxPessoas={maxPessoas}
              />
            ))
          )}
        </div>

        {/* ── Coverage chart ── */}
        <div className="border-t bg-muted/20 dark:bg-muted/10">
          <div className="flex items-end px-0" style={{ height: '36px' }}>
            {coverageData.map((count, i) => {
              const h = maxCoverage > 0 ? (count / maxCoverage) * 100 : 0
              return (
                <div
                  key={i}
                  className="relative flex flex-col items-center justify-end"
                  style={{ width: `${(30 / totalMinutes) * 100}%`, height: '100%' }}
                >
                  <div
                    className={cn(
                      'w-full transition-all',
                      count > 0
                        ? 'bg-primary/20 dark:bg-primary/15 border-t border-primary/30'
                        : 'bg-transparent',
                    )}
                    style={{ height: `${h}%`, minHeight: count > 0 ? '4px' : 0 }}
                  />
                  {count > 0 && (
                    <span className="absolute bottom-0.5 text-[10px] font-semibold text-primary/70">{count}</span>
                  )}
                </div>
              )
            })}
          </div>
          <div className="flex items-center justify-between px-3 py-1.5 text-sm text-muted-foreground">
            <span>Cobertura acumulada por faixa</span>
            <div className="flex items-center gap-2">
              {totalColaboradores > 0 && (
                <span className="text-xs tabular-nums">
                  {totalHorasSemana.toFixed(0)}h/sem ÷ {totalColaboradores} = <span className="font-semibold text-foreground">{mediaSemanalPorColab.toFixed(1)}h/pessoa</span>
                </span>
              )}
              <Badge variant="outline" className="text-xs">
                {currentConfig.segmentosCobertura.length} faixa{currentConfig.segmentosCobertura.length !== 1 ? 's' : ''}
              </Badge>
            </div>
          </div>
        </div>
      </TimelineShell>
    )
  }

  // ─── Compact operational header for table view (no axis duplication) ─────────
  const renderOperacionalCompact = () => {
    const isPadraoTab = activeTab === 'padrao'
    return (
      <div className="flex items-center gap-3 rounded-lg border bg-muted/20 px-3 py-2">
        <span className="text-xs text-muted-foreground shrink-0">Horário de trabalho</span>
        <span className="text-muted-foreground/40">·</span>
        <div className="flex items-center gap-1.5 text-sm font-semibold tabular-nums">
          <Clock className="size-3.5 text-muted-foreground" />
          {currentConfig.hora_abertura} – {currentConfig.hora_fechamento}
        </div>
        {!isPadraoTab && currentConfig.usa_padrao && (
          <span className="text-xs text-muted-foreground">· herdando padrao</span>
        )}
        <div className="ml-auto">
          {renderOperacionalPopover()}
        </div>
      </div>
    )
  }

  const isDiaHerdandoPadrao = activeTab !== 'padrao' && currentConfig.usa_padrao
  const canEditCurrent = !isDiaHerdandoPadrao

  if (activeTab === 'padrao' && draft.padrao.segmentos.length === 0) {
    return (
      <EmptyState
        icon={Clock}
        title="Nenhuma faixa de demanda definida"
        description="Defina ao menos uma faixa para iniciar o planejamento"
        action={
          <Button variant="outline" size="sm" onClick={handleNovaFaixa}>
            <Plus className="mr-1 size-3.5" /> Nova Faixa
          </Button>
        }
      />
    )
  }

  return (
    <div className="space-y-3">
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'padrao' | DiaSemana)}>
        <div className="flex items-center justify-between gap-2">
          <TabsList>
            <TabsTrigger value="padrao">
              Padrao
            </TabsTrigger>
            {DIAS_SEMANA.map((dia) => (
              <TabsTrigger key={dia} value={dia} className="relative">
                {DIAS_LABELS[dia]}
                {diaComDivergencia[dia] && (
                  <span className="absolute top-1 right-1 size-1.5 rounded-full bg-primary" />
                )}
              </TabsTrigger>
            ))}
          </TabsList>

          <div className="flex items-center gap-1.5">
            {activeTab !== 'padrao' && (
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">Usar padrao</span>
                <Switch
                  checked={draft.dias[activeTab as DiaSemana].usa_padrao}
                  onCheckedChange={(checked) => setDiaUsePadrao(activeTab as DiaSemana, checked)}
                />
              </div>
            )}

            <div className="flex items-center rounded-md border p-0.5">
              <Button
                variant={viewMode === 'timeline' ? 'secondary' : 'ghost'}
                size="sm"
                className="w-8 p-0"
                onClick={() => setViewMode('timeline')}
                title="Timeline"
              >
                <BarChart3 className="size-3.5" />
              </Button>
              <Button
                variant={viewMode === 'tabela' ? 'secondary' : 'ghost'}
                size="sm"
                className="w-8 p-0"
                onClick={() => setViewMode('tabela')}
                title="Tabela"
              >
                <Table2 className="size-3.5" />
              </Button>
            </div>

            <Button variant="outline" size="sm" onClick={handleNovaFaixa} disabled={!canEditCurrent}>
              <Plus className="mr-1 size-3.5" /> Nova Faixa
            </Button>
          </div>
        </div>

        <TabsContent value={activeTab} className="mt-3">
          <div className="space-y-3">
            <div className={cn(isDiaHerdandoPadrao && 'pointer-events-none select-none opacity-60')}>
              {viewMode === 'timeline' ? renderTimelineView() : (
                <>
                  {renderOperacionalCompact()}
                  {renderTableView()}
                </>
              )}
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
