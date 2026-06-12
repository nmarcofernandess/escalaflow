import { useMemo, useState } from 'react'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts'
import { ArrowLeft, ChevronLeft, ChevronRight } from 'lucide-react'
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartLegend,
  ChartLegendContent,
} from '@/components/ui/chart'
import { Button } from '@/components/ui/button'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { calcularCoberturaDemanda, type Indicadores, type SlotComparacao } from '@shared/index'

interface CoberturaChartProps {
  comparacao: SlotComparacao[]
  indicadores: Indicadores
  className?: string
}

type ViewMode = 'semana' | 'mes' | 'tudo'

type CoveragePoint = {
  data?: string
  hora?: string
  label: string
  necessario: number
  coberto: number
  necessarioHoras: number
  cobertoHoras: number
  deficitHoras: number
  picoNecessario: number
  picoCoberto: number
  slotZero: boolean
}

const chartConfig = {
  necessario: { label: 'Necessario', color: 'hsl(var(--primary))' },
  coberto: { label: 'Coberto', color: 'hsl(var(--success))' },
} satisfies ChartConfig

function formatDate(dateStr: string): string {
  const [, m, d] = dateStr.split('-')
  return `${d}/${m}`
}

function getWeekLabel(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00`)
  const dias = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab']
  return dias[d.getDay()]
}

function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number)
  return h * 60 + m
}

function slotHours(slot: SlotComparacao): number {
  return Math.max(0, timeToMinutes(slot.hora_fim) - timeToMinutes(slot.hora_inicio)) / 60
}

function formatHoras(value: number): string {
  const totalMin = Math.round(value * 60)
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, '0')}`
}

function summarizeSlots(slots: SlotComparacao[]) {
  return slots.reduce(
    (acc, slot) => {
      const hours = slotHours(slot)
      const deficit = Math.max(0, slot.planejado - slot.executado)
      acc.necessario += slot.planejado
      acc.coberto += slot.executado
      acc.necessarioHoras += slot.planejado * hours
      acc.cobertoHoras += slot.executado * hours
      acc.deficitHoras += deficit * hours
      acc.picoNecessario = Math.max(acc.picoNecessario, slot.planejado)
      acc.picoCoberto = Math.max(acc.picoCoberto, slot.executado)
      acc.slotZero ||= slot.planejado > 0 && slot.executado === 0
      return acc
    },
    {
      necessario: 0,
      coberto: 0,
      necessarioHoras: 0,
      cobertoHoras: 0,
      deficitHoras: 0,
      picoNecessario: 0,
      picoCoberto: 0,
      slotZero: false,
    },
  )
}

function CoberturaTooltip({ active, payload }: {
  active?: boolean
  payload?: Array<{ payload?: CoveragePoint }>
}) {
  if (!active) return null
  const point = payload?.[0]?.payload
  if (!point) return null

  return (
    <div className="min-w-[220px] rounded-md border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="font-medium">{point.label}</p>
        {point.slotZero && (
          <span className="rounded-sm bg-destructive px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-normal text-destructive-foreground">
            slot a ZERO
          </span>
        )}
      </div>

      <div className="space-y-1.5">
        <div className="grid grid-cols-[1fr_auto_auto] items-center gap-3">
          <span className="text-muted-foreground">Necessario</span>
          <span className="font-medium tabular-nums">{formatHoras(point.necessarioHoras)}</span>
          <span className="text-muted-foreground tabular-nums">{point.picoNecessario} pessoas</span>
        </div>
        <div className="grid grid-cols-[1fr_auto_auto] items-center gap-3">
          <span className="text-muted-foreground">Coberto</span>
          <span className="font-medium tabular-nums">{formatHoras(point.cobertoHoras)}</span>
          <span className="text-muted-foreground tabular-nums">{point.picoCoberto} pessoas</span>
        </div>
        {point.deficitHoras > 0 && (
          <div className="border-t pt-1.5 text-muted-foreground">
            Deficit {formatHoras(point.deficitHoras)} · {(point.deficitHoras / 44).toFixed(2)} pessoa-eq
          </div>
        )}
      </div>
    </div>
  )
}

export function CoberturaChart({ comparacao, indicadores, className }: CoberturaChartProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('tudo')
  const [pageIndex, setPageIndex] = useState(0)
  const [selectedDate, setSelectedDate] = useState<string | null>(null)

  // Agrupar por dia: somar planejado e executado de todos os slots do dia
  const porDia = useMemo(() => {
    const acc = new Map<string, SlotComparacao[]>()
    for (const s of comparacao) {
      if (!acc.has(s.data)) acc.set(s.data, [])
      acc.get(s.data)!.push(s)
    }
    return [...acc.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([data, slots]) => ({
        data,
        label: `${getWeekLabel(data)} ${formatDate(data)}`,
        ...summarizeSlots(slots),
      }))
  }, [comparacao])

  // Dividir em páginas de acordo com viewMode
  const { pageData, totalPages, pageLabel } = useMemo(() => {
    if (viewMode === 'tudo' || porDia.length === 0) {
      return { pageData: porDia, totalPages: 1, pageLabel: '' }
    }

    const pageSize = viewMode === 'semana' ? 7 : 30
    const pages: typeof porDia[] = []

    for (let i = 0; i < porDia.length; i += pageSize) {
      pages.push(porDia.slice(i, i + pageSize))
    }

    const safeIndex = Math.min(pageIndex, pages.length - 1)
    const page = pages[safeIndex] ?? []
    const first = page[0]?.data ?? ''
    const last = page[page.length - 1]?.data ?? ''
    const label = viewMode === 'semana'
      ? `Semana ${safeIndex + 1} — ${formatDate(first)} a ${formatDate(last)}`
      : `${formatDate(first)} a ${formatDate(last)}`

    return { pageData: page, totalPages: pages.length, pageLabel: label }
  }, [porDia, viewMode, pageIndex])

  // Dias com deficit (para indicar visualmente no overview)
  const diasComDeficit = useMemo(() => {
    const s = new Set<string>()
    for (const slot of comparacao) {
      if (slot.delta < 0) s.add(slot.data)
    }
    return s
  }, [comparacao])

  // Agregação horária para drill-down intra-dia
  const porHora = useMemo(() => {
    if (!selectedDate) return []
    const slotsDay = comparacao.filter(s => s.data === selectedDate)
    const acc = new Map<string, SlotComparacao[]>()
    for (const s of slotsDay) {
      const hora = s.hora_inicio.slice(0, 2)
      if (!acc.has(hora)) acc.set(hora, [])
      acc.get(hora)!.push(s)
    }
    return [...acc.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([hora, slots]) => ({
        hora,
        label: `${hora}h`,
        ...summarizeSlots(slots),
      }))
  }, [comparacao, selectedDate])

  // Reset page + drill when switching modes
  const handleViewChange = (val: string) => {
    if (val) {
      setViewMode(val as ViewMode)
      setPageIndex(0)
      setSelectedDate(null)
    }
  }

  // KPIs: contextuais por pagina/dia. Na visao "Tudo", cobertura de escala persistida
  // vem do validador autoritativo; recortes usam a mesma formula compartilhada.
  const { totalDeficit, totalSurplus, pageCoverage, showEquilibrio } = useMemo(() => {
    const pageDates = new Set(pageData.map(d => d.data))
    const source = selectedDate
      ? comparacao.filter(s => s.data === selectedDate)
      : comparacao.filter(s => pageDates.has(s.data))

    const deficit = source.filter(s => s.delta < 0).reduce((sum, s) => sum + Math.abs(s.delta), 0)
    const surplus = source.filter(s => s.delta > 0).reduce((sum, s) => sum + s.delta, 0)

    const coverage = !selectedDate && viewMode === 'tudo'
      ? indicadores.cobertura_percent
      : calcularCoberturaDemanda(source.map(s => ({
        data: s.data,
        hora_inicio: s.hora_inicio,
        hora_fim: s.hora_fim,
        planejado: s.planejado,
        executado: s.executado,
        ignorar_cobertura: s.feriado_proibido,
      }))).cobertura_percent

    return { totalDeficit: deficit, totalSurplus: surplus, pageCoverage: coverage, showEquilibrio: !selectedDate }
  }, [comparacao, selectedDate, pageData, viewMode, indicadores.cobertura_percent])

  if (comparacao.length === 0) return null

  const safePageIndex = Math.min(pageIndex, Math.max(0, totalPages - 1))

  // Drill-down date label
  const drillLabel = useMemo(() => {
    if (!selectedDate) return ''
    return `${getWeekLabel(selectedDate)} ${formatDate(selectedDate)} — Cobertura por Hora`
  }, [selectedDate])

  return (
    <div className={className}>
      {/* Header: KPIs + controles */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1">
          {selectedDate && (
            <Button
              variant="ghost"
              size="sm"
              className="mr-1 h-auto gap-1 px-1.5 py-0.5 text-xs text-muted-foreground"
              onClick={() => setSelectedDate(null)}
            >
              <ArrowLeft className="size-3.5" />
              Voltar
            </Button>
          )}
          <div>
            <span className="text-2xl font-bold tabular-nums">
              {Math.round(pageCoverage)}%
            </span>
            <span className="ml-1.5 text-xs text-muted-foreground">cobertura</span>
          </div>
          <div className="flex gap-3 text-xs tabular-nums">
            <span className="text-muted-foreground">
              Deficit <span className="font-medium text-destructive">{totalDeficit}</span>
            </span>
            <span className="text-muted-foreground">
              Excesso <span className="font-medium text-success">{totalSurplus}</span>
            </span>
            {showEquilibrio && (
              <span className="text-muted-foreground">
                Equilibrio <span className="font-medium">{indicadores.equilibrio}%</span>
              </span>
            )}
          </div>
        </div>

        {!selectedDate && (
          <div className="flex items-center gap-2">
            {totalPages > 1 && (
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  disabled={safePageIndex <= 0}
                  onClick={() => setPageIndex(safePageIndex - 1)}
                >
                  <ChevronLeft className="size-4" />
                </Button>
                <span className="min-w-[20px] text-center text-xs tabular-nums text-muted-foreground">
                  {safePageIndex + 1}/{totalPages}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  disabled={safePageIndex >= totalPages - 1}
                  onClick={() => setPageIndex(safePageIndex + 1)}
                >
                  <ChevronRight className="size-4" />
                </Button>
              </div>
            )}
            <ToggleGroup type="single" value={viewMode} onValueChange={handleViewChange} size="sm">
              <ToggleGroupItem value="semana" className="h-7 px-2 text-xs">Semana</ToggleGroupItem>
              <ToggleGroupItem value="mes" className="h-7 px-2 text-xs">Mes</ToggleGroupItem>
              <ToggleGroupItem value="tudo" className="h-7 px-2 text-xs">Tudo</ToggleGroupItem>
            </ToggleGroup>
          </div>
        )}
      </div>

      {selectedDate ? (
        <p className="mb-2 text-xs font-medium text-muted-foreground">{drillLabel}</p>
      ) : pageLabel ? (
        <p className="mb-2 text-xs text-muted-foreground">{pageLabel}</p>
      ) : null}

      {/* Chart: Area (overview) ou Bar (drill-down horário) */}
      {selectedDate ? (
        <ChartContainer config={chartConfig} className="h-[200px] w-full">
          <BarChart accessibilityLayer data={porHora}>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="label"
              tickLine={false}
              tickMargin={8}
              axisLine={false}
              fontSize={11}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              width={35}
              fontSize={11}
            />
            <ChartTooltip
              content={<CoberturaTooltip />}
            />
            <Bar dataKey="necessario" fill="var(--color-necessario)" radius={[3, 3, 0, 0]} />
            <Bar dataKey="coberto" fill="var(--color-coberto)" radius={[3, 3, 0, 0]} />
            <ChartLegend content={<ChartLegendContent />} />
          </BarChart>
        </ChartContainer>
      ) : (
        <ChartContainer config={chartConfig} className="h-[200px] w-full">
          <AreaChart
            accessibilityLayer
            data={pageData}
            onClick={(state) => {
              if (state?.activePayload?.[0]?.payload?.data) {
                setSelectedDate(state.activePayload[0].payload.data)
              }
            }}
            style={{ cursor: 'pointer' }}
          >
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="label"
              tickLine={false}
              tickMargin={8}
              axisLine={false}
              interval={viewMode === 'tudo' ? Math.max(0, Math.floor(pageData.length / 10) - 1) : 0}
              fontSize={11}
              angle={viewMode === 'semana' ? 0 : -40}
              textAnchor={viewMode === 'semana' ? 'middle' : 'end'}
              height={viewMode === 'semana' ? 35 : 55}
              tick={(props: Record<string, unknown>) => {
                const { x, y, payload } = props as { x: number; y: number; payload: { value: string; index: number } }
                const dayData = pageData[payload.index]
                const hasDeficit = dayData ? diasComDeficit.has(dayData.data) : false
                return (
                  <text
                    x={x}
                    y={y}
                    textAnchor={viewMode === 'semana' ? 'middle' : 'end'}
                    fontSize={11}
                    fill={hasDeficit ? 'hsl(var(--destructive))' : 'currentColor'}
                    className={hasDeficit ? '' : 'fill-muted-foreground'}
                    transform={viewMode === 'semana' ? undefined : `rotate(-40, ${x}, ${y})`}
                  >
                    {payload.value}
                  </text>
                )
              }}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              width={35}
              fontSize={11}
            />
            <ChartTooltip
              content={<CoberturaTooltip />}
            />
            <defs>
              <linearGradient id="gradNecessario" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--color-necessario)" stopOpacity={0.3} />
                <stop offset="95%" stopColor="var(--color-necessario)" stopOpacity={0.05} />
              </linearGradient>
              <linearGradient id="gradCoberto" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--color-coberto)" stopOpacity={0.4} />
                <stop offset="95%" stopColor="var(--color-coberto)" stopOpacity={0.05} />
              </linearGradient>
            </defs>
            <Area
              dataKey="necessario"
              type="monotone"
              fill="url(#gradNecessario)"
              stroke="var(--color-necessario)"
              strokeWidth={1.5}
            />
            <Area
              dataKey="coberto"
              type="monotone"
              fill="url(#gradCoberto)"
              stroke="var(--color-coberto)"
              strokeWidth={1.5}
            />
            <ChartLegend content={<ChartLegendContent />} />
          </AreaChart>
        </ChartContainer>
      )}
    </div>
  )
}
