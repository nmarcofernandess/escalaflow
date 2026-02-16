import { useState, useMemo, useCallback, useRef, useEffect, type MouseEvent } from 'react'
import { Plus, Clock, Minus, Trash2, Users, BarChart3, Table2 } from 'lucide-react'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import type { DragEndEvent } from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable'
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
import { cn } from '@/lib/utils'
import { toMinutes, minutesToTime, formatarMinutos } from '@/lib/formatadores'
import { EmptyState } from '@/componentes/EmptyState'
import { DemandaBar } from '@/componentes/DemandaBar'
import { useDemandaResize } from '@/hooks/useDemandaResize'
import type { Setor, Demanda } from '@shared/index'
import type { DiaSemana } from '@shared/constants'
import { DIAS_SEMANA } from '@shared/constants'

type ViewMode = 'timeline' | 'tabela'

const DIAS_LABELS: Record<DiaSemana, string> = {
  SEG: 'Seg',
  TER: 'Ter',
  QUA: 'Qua',
  QUI: 'Qui',
  SEX: 'Sex',
  SAB: 'Sáb',
  DOM: 'Dom',
}

const DIAS_LABELS_FULL: Record<DiaSemana, string> = {
  SEG: 'Segunda',
  TER: 'Terça',
  QUA: 'Quarta',
  QUI: 'Quinta',
  SEX: 'Sexta',
  SAB: 'Sábado',
  DOM: 'Domingo',
}

interface DemandaEditorProps {
  setor: Setor
  demandas: Demanda[]
  onCriar: (data: Omit<Demanda, 'id' | 'setor_id'>) => Promise<void>
  onAtualizar: (id: number, data: Partial<Omit<Demanda, 'id' | 'setor_id'>>) => Promise<void>
  onDeletar: (id: number) => Promise<void>
}

export function DemandaEditor({
  setor,
  demandas,
  onCriar,
  onAtualizar,
  onDeletar,
}: DemandaEditorProps) {
  const [activeTab, setActiveTab] = useState('padrao')
  const [viewMode, setViewMode] = useState<ViewMode>('timeline')
  const [localDemandas, setLocalDemandas] = useState<Demanda[]>(demandas)
  const debounceTimers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map())
  const prevDemandasKey = useRef('')

  // Sync external demandas into local state (only when content actually changes)
  useEffect(() => {
    const key = JSON.stringify(demandas.map((d) => ({ id: d.id, mp: d.min_pessoas, hi: d.hora_inicio, hf: d.hora_fim, ds: d.dia_semana })))
    if (key !== prevDemandasKey.current) {
      prevDemandasKey.current = key
      setLocalDemandas(demandas)
    }
  }, [demandas])

  const openMin = toMinutes(setor.hora_abertura)
  const closeMin = toMinutes(setor.hora_fechamento)
  const totalMinutes = closeMin - openMin

  // Time labels for the axis
  const timeLabels = useMemo(() => {
    const labels: string[] = []
    let current = openMin
    while (current <= closeMin) {
      labels.push(minutesToTime(current))
      current += 60
    }
    return labels
  }, [openMin, closeMin])

  // Demandas padrão (dia_semana === null)
  const demandasPadrao = useMemo(
    () => localDemandas.filter((d) => d.dia_semana === null),
    [localDemandas],
  )

  // Demandas específicas por dia
  const demandasEspecificasPorDia = useMemo(() => {
    const map: Record<DiaSemana, Demanda[]> = {
      SEG: [], TER: [], QUA: [], QUI: [], SEX: [], SAB: [], DOM: [],
    }
    for (const d of localDemandas) {
      if (d.dia_semana !== null) {
        map[d.dia_semana].push(d)
      }
    }
    return map
  }, [localDemandas])

  // Check which days have overrides (for badge dots)
  const hasOverride = useMemo(() => {
    const map: Record<DiaSemana, boolean> = {
      SEG: false, TER: false, QUA: false, QUI: false, SEX: false, SAB: false, DOM: false,
    }
    for (const d of localDemandas) {
      if (d.dia_semana !== null) {
        map[d.dia_semana] = true
      }
    }
    return map
  }, [localDemandas])

  // Get visible demandas for current tab (ghosts + specifics for day tabs)
  const visibleDemandas = useMemo(() => {
    if (activeTab === 'padrao') {
      return demandasPadrao
    }
    const dia = activeTab as DiaSemana
    return [...demandasPadrao, ...demandasEspecificasPorDia[dia]]
  }, [activeTab, demandasPadrao, demandasEspecificasPorDia])

  // Editable demandas (for DnD)
  const editableDemandas = useMemo(() => {
    if (activeTab === 'padrao') {
      return demandasPadrao
    }
    const dia = activeTab as DiaSemana
    return demandasEspecificasPorDia[dia]
  }, [activeTab, demandasPadrao, demandasEspecificasPorDia])

  // Coverage calculation per 30-min slot (uses ALL visible demandas)
  const coverageData = useMemo(() => {
    const slots: number[] = []
    const numSlots = Math.ceil(totalMinutes / 30)
    for (let i = 0; i < numSlots; i++) {
      const slotStart = openMin + i * 30
      let count = 0
      for (const d of visibleDemandas) {
        const dStart = toMinutes(d.hora_inicio)
        const dEnd = toMinutes(d.hora_fim)
        if (dStart <= slotStart && dEnd > slotStart) {
          count += d.min_pessoas
        }
      }
      slots.push(count)
    }
    return slots
  }, [visibleDemandas, openMin, totalMinutes])

  const maxCoverage = Math.max(...coverageData, 1)

  // Debounced auto-save
  const debouncedUpdate = useCallback(
    (id: number, data: Partial<Omit<Demanda, 'id' | 'setor_id'>>) => {
      const existing = debounceTimers.current.get(id)
      if (existing) clearTimeout(existing)

      const timer = setTimeout(async () => {
        debounceTimers.current.delete(id)
        try {
          await onAtualizar(id, data)
        } catch {
          setLocalDemandas(demandas)
        }
      }, 500)
      debounceTimers.current.set(id, timer)
    },
    [onAtualizar, demandas],
  )

  // Resize handler
  const { resizingId, preview, startResize } = useDemandaResize({
    openMin,
    closeMin,
    onResizeEnd: (demandaId, result) => {
      setLocalDemandas((prev) =>
        prev.map((d) =>
          d.id === demandaId
            ? { ...d, hora_inicio: result.hora_inicio, hora_fim: result.hora_fim }
            : d,
        ),
      )
      debouncedUpdate(demandaId, {
        hora_inicio: result.hora_inicio,
        hora_fim: result.hora_fim,
      })
    },
  })

  // DnD sensors
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  )

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return

    setLocalDemandas((prev) => {
      const oldIndex = prev.findIndex((d) => d.id === active.id)
      const newIndex = prev.findIndex((d) => d.id === over.id)
      if (oldIndex === -1 || newIndex === -1) return prev
      return arrayMove(prev, oldIndex, newIndex)
    })
  }

  // Add new demand
  const handleNovaFaixa = async () => {
    const midPoint = openMin + Math.floor(totalMinutes / 2 / 30) * 30
    const endPoint = Math.min(midPoint + 240, closeMin)
    await onCriar({
      dia_semana: activeTab === 'padrao' ? null : (activeTab as DiaSemana),
      hora_inicio: minutesToTime(midPoint),
      hora_fim: minutesToTime(endPoint),
      min_pessoas: 2,
    })
  }

  // Update min_pessoas (functional update to avoid stale closure)
  const handleUpdatePessoas = useCallback((id: number, delta: number) => {
    let computedVal: number | undefined
    setLocalDemandas((prev) => {
      const dem = prev.find((d) => d.id === id)
      if (!dem) return prev
      const newVal = Math.max(1, dem.min_pessoas + delta)
      if (newVal === dem.min_pessoas) return prev
      computedVal = newVal
      return prev.map((d) => (d.id === id ? { ...d, min_pessoas: newVal } : d))
    })
    // setState updater runs synchronously — computedVal is set by now
    if (computedVal !== undefined) {
      debouncedUpdate(id, { min_pessoas: computedVal })
    }
  }, [debouncedUpdate])

  // Direct time update
  const handleUpdateTimes = (id: number, hora_inicio: string, hora_fim: string) => {
    setLocalDemandas((prev) =>
      prev.map((d) => (d.id === id ? { ...d, hora_inicio, hora_fim } : d)),
    )
    debouncedUpdate(id, { hora_inicio, hora_fim })
  }

  // Delete — cancel any pending debounced update first
  const handleDelete = async (id: number) => {
    const pending = debounceTimers.current.get(id)
    if (pending) {
      clearTimeout(pending)
      debounceTimers.current.delete(id)
    }
    setLocalDemandas((prev) => prev.filter((d) => d.id !== id))
    try {
      await onDeletar(id)
    } catch {
      setLocalDemandas(demandas)
    }
  }

  // Table time change handler
  const handleTableTimeChange = (id: number, field: 'inicio' | 'fim', value: string) => {
    if (!value.match(/^\d{2}:\d{2}$/)) return
    const dem = localDemandas.find((d) => d.id === id)
    if (!dem) return
    const newMin = toMinutes(value)
    const startMin = toMinutes(dem.hora_inicio)
    const endMin = toMinutes(dem.hora_fim)

    if (field === 'inicio') {
      if (newMin >= openMin && endMin - newMin >= 60) {
        handleUpdateTimes(id, value, dem.hora_fim)
      }
    } else {
      if (newMin <= closeMin && newMin - startMin >= 60) {
        handleUpdateTimes(id, dem.hora_inicio, value)
      }
    }
  }

  // Ghost bar renderer (timeline view)
  const renderGhostBar = (dem: Demanda, index: number) => {
    const startMin = toMinutes(dem.hora_inicio)
    const endMin = toMinutes(dem.hora_fim)
    const leftPercent = ((startMin - openMin) / totalMinutes) * 100
    const widthPercent = ((endMin - startMin) / totalMinutes) * 100

    const CORES_FAIXA = [
      'bg-emerald-500/30 border-emerald-600/30',
      'bg-blue-500/30 border-blue-600/30',
      'bg-purple-500/30 border-purple-600/30',
      'bg-amber-500/30 border-amber-600/30',
      'bg-pink-500/30 border-pink-600/30',
    ]
    const colors = CORES_FAIXA[index % CORES_FAIXA.length]

    return (
      <div key={`ghost-${dem.id}`} className="relative h-10 pointer-events-none opacity-40">
        <div className="absolute inset-0 rounded-md bg-muted/30 dark:bg-muted/20" />
        <div
          className={cn(
            'absolute top-0 h-full rounded-md border flex items-center',
            colors,
          )}
          style={{
            left: `${leftPercent}%`,
            width: `${widthPercent}%`,
            minWidth: '60px',
          }}
        >
          <div className="flex flex-1 items-center justify-center gap-1.5 overflow-hidden px-3 text-xs font-medium text-muted-foreground min-w-0">
            <span className="truncate">
              {dem.hora_inicio} - {dem.hora_fim}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-2 mr-3">
            <div className="flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[10px] font-bold bg-muted/60 text-muted-foreground">
              <Clock className="size-2.5" />
              {dem.min_pessoas}
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ─── Table view row ───
  const renderTableRow = (dem: Demanda, isGhost: boolean) => {
    const duration = toMinutes(dem.hora_fim) - toMinutes(dem.hora_inicio)
    return (
      <TableRow
        key={isGhost ? `ghost-${dem.id}` : dem.id}
        className={cn(isGhost && 'opacity-40')}
      >
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
                  className="h-7 w-[90px] text-xs"
                  onBlur={(e) => handleTableTimeChange(dem.id, 'inicio', e.target.value)}
                />
                <span className="text-xs text-muted-foreground">-</span>
                <Input
                  type="time"
                  defaultValue={dem.hora_fim}
                  className="h-7 w-[90px] text-xs"
                  onBlur={(e) => handleTableTimeChange(dem.id, 'fim', e.target.value)}
                />
              </div>
            )}
          </div>
        </TableCell>
        <TableCell className="text-muted-foreground text-xs">
          {formatarMinutos(duration)}
        </TableCell>
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
                onClick={(e: MouseEvent) => { e.stopPropagation(); handleUpdatePessoas(dem.id, -1) }}
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
                onClick={(e: MouseEvent) => { e.stopPropagation(); handleUpdatePessoas(dem.id, 1) }}
              >
                <Plus className="size-3" />
              </Button>
            </div>
          )}
        </TableCell>
        <TableCell>
          {dem.dia_semana ? (
            <Badge variant="outline" className="text-[10px]">
              {DIAS_LABELS_FULL[dem.dia_semana]}
            </Badge>
          ) : (
            <span className="text-xs text-muted-foreground">Padrão</span>
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
                    A faixa {dem.hora_inicio} - {dem.hora_fim} ({dem.min_pessoas} pessoas)
                    será removida permanentemente.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                  <AlertDialogAction onClick={() => handleDelete(dem.id)}>
                    Remover
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </TableCell>
      </TableRow>
    )
  }

  // ─── Table view content for a tab ───
  const renderTableView = (editableList: Demanda[], ghostList: Demanda[]) => {
    if (editableList.length === 0 && ghostList.length === 0) {
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
              <TableHead>Horário</TableHead>
              <TableHead className="w-[80px]">Duração</TableHead>
              <TableHead className="w-[130px]">Min. pessoas</TableHead>
              <TableHead className="w-[100px]">Dia</TableHead>
              <TableHead className="w-[50px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {ghostList.map((dem) => renderTableRow(dem, true))}
            {editableList.length === 0 && ghostList.length > 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-4">
                  <div className="flex flex-col items-center gap-2 text-xs text-muted-foreground">
                    <span>Usando horários padrão</span>
                    <Button variant="ghost" size="sm" onClick={handleNovaFaixa}>
                      <Plus className="mr-1 size-3.5" /> Adicionar faixa específica
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              editableList.map((dem) => renderTableRow(dem, false))
            )}
          </TableBody>
        </Table>
      </div>
    )
  }

  // ─── Timeline content for a tab (bars + coverage) ───
  const renderTimelineView = (editableList: Demanda[], ghostList: Demanda[], coverageLabel: string, countLabel: string) => (
    <div className="overflow-x-auto rounded-lg border bg-background">
      <div className="min-w-[600px]" data-demanda-grid>
        {/* Time axis */}
        <div className="relative flex border-b bg-muted/30 dark:bg-muted/20">
          {timeLabels.map((label, i) => (
            <div
              key={label}
              className="text-center text-[10px] font-medium text-muted-foreground py-1.5"
              style={{
                width: `${(60 / totalMinutes) * 100}%`,
                marginLeft: i === 0 ? `${((toMinutes(label) - openMin) / totalMinutes) * 100}%` : undefined,
                position: i === 0 ? 'relative' : undefined,
              }}
            >
              {label}
            </div>
          ))}
        </div>

        {/* Tick marks */}
        <div className="relative h-1 bg-muted/20">
          {timeLabels.map((label) => {
            const pos = ((toMinutes(label) - openMin) / totalMinutes) * 100
            return (
              <div
                key={`tick-${label}`}
                className="absolute top-0 h-full w-px bg-border/50"
                style={{ left: `${pos}%` }}
              />
            )
          })}
        </div>

        {/* Bars area */}
        <div className="relative space-y-1.5 px-2 py-2">
          {/* Ghost bars */}
          {ghostList.map((dem, i) => renderGhostBar(dem, i))}

          {/* Editable bars or empty state */}
          {editableList.length === 0 && ghostList.length > 0 ? (
            <div className="flex flex-col items-center justify-center py-4 text-xs text-muted-foreground gap-2">
              <span>Usando horários padrão</span>
              <Button variant="ghost" size="sm" onClick={handleNovaFaixa}>
                <Plus className="mr-1 size-3.5" /> Adicionar faixa específica
              </Button>
            </div>
          ) : editableList.length === 0 && ghostList.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-xs text-muted-foreground gap-2">
              <span>Nenhuma faixa definida</span>
              <Button variant="ghost" size="sm" onClick={handleNovaFaixa}>
                <Plus className="mr-1 size-3.5" /> Adicionar faixa
              </Button>
            </div>
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={editableList.map((d) => d.id)}
                strategy={verticalListSortingStrategy}
              >
                {editableList.map((dem, i) => (
                  <DemandaBar
                    key={dem.id}
                    demanda={dem}
                    index={i}
                    openMin={openMin}
                    closeMin={closeMin}
                    previewHoraInicio={
                      preview?.id === dem.id ? preview.hora_inicio : undefined
                    }
                    previewHoraFim={
                      preview?.id === dem.id ? preview.hora_fim : undefined
                    }
                    isResizing={resizingId === dem.id}
                    onStartResize={startResize}
                    onDelete={handleDelete}
                    onUpdatePessoas={handleUpdatePessoas}
                    onUpdateTimes={handleUpdateTimes}
                  />
                ))}
              </SortableContext>
            </DndContext>
          )}
        </div>

        {/* Coverage bar */}
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
                    <span className="absolute bottom-0.5 text-[8px] font-semibold text-primary/70">
                      {count}
                    </span>
                  )}
                </div>
              )
            })}
          </div>
          <div className="flex items-center justify-between px-3 py-1 text-[10px] text-muted-foreground">
            <span>{coverageLabel}</span>
            <Badge variant="outline" className="text-[9px] h-4">
              {countLabel}
            </Badge>
          </div>
        </div>
      </div>
    </div>
  )

  // Empty state for zero demandas
  if (localDemandas.length === 0 && activeTab === 'padrao') {
    return (
      <EmptyState
        icon={Clock}
        title="Nenhuma faixa de demanda definida"
        description="Defina ao menos uma faixa padrão para gerar escalas"
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
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        {/* Toolbar: Tabs + View toggle + Nova Faixa */}
        <div className="flex items-center justify-between gap-2">
          <TabsList className="h-8 p-0.5">
            <TabsTrigger value="padrao" className="h-7 text-xs px-3">
              Padrão
            </TabsTrigger>
            {DIAS_SEMANA.map((dia) => (
              <TabsTrigger key={dia} value={dia} className="h-7 text-xs px-2 relative">
                {DIAS_LABELS[dia]}
                {hasOverride[dia] && (
                  <span className="absolute top-1 right-1 size-1.5 rounded-full bg-primary" />
                )}
              </TabsTrigger>
            ))}
          </TabsList>
          <div className="flex items-center gap-1.5">
            {/* View toggle */}
            <div className="flex items-center rounded-md border p-0.5">
              <Button
                variant={viewMode === 'timeline' ? 'secondary' : 'ghost'}
                size="icon"
                className="size-7"
                onClick={() => setViewMode('timeline')}
                title="Timeline"
              >
                <BarChart3 className="size-3.5" />
              </Button>
              <Button
                variant={viewMode === 'tabela' ? 'secondary' : 'ghost'}
                size="icon"
                className="size-7"
                onClick={() => setViewMode('tabela')}
                title="Tabela"
              >
                <Table2 className="size-3.5" />
              </Button>
            </div>
            <Button variant="outline" size="sm" onClick={handleNovaFaixa}>
              <Plus className="mr-1 size-3.5" /> Nova Faixa
            </Button>
          </div>
        </div>

        {/* "Padrao" tab content */}
        <TabsContent value="padrao" className="mt-3">
          {viewMode === 'timeline'
            ? renderTimelineView(
                demandasPadrao,
                [], // no ghosts in padrao tab
                'Cobertura acumulada por faixa',
                `${demandasPadrao.length} faixa${demandasPadrao.length !== 1 ? 's' : ''}`,
              )
            : renderTableView(demandasPadrao, [])
          }
        </TabsContent>

        {/* Day tabs content */}
        {DIAS_SEMANA.map((dia) => {
          const especificas = demandasEspecificasPorDia[dia]
          const totalCount = demandasPadrao.length + especificas.length
          return (
            <TabsContent key={dia} value={dia} className="mt-3">
              {viewMode === 'timeline'
                ? renderTimelineView(
                    especificas,
                    demandasPadrao, // ghosts from padrao
                    'Cobertura acumulada (padrão + específicas)',
                    `${totalCount} faixa${totalCount !== 1 ? 's' : ''}`,
                  )
                : renderTableView(especificas, demandasPadrao)
              }
            </TabsContent>
          )
        })}
      </Tabs>
    </div>
  )
}
