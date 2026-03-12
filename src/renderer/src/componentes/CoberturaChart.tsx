import { useMemo, useState } from 'react'
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
} from '@/components/ui/chart'
import { Button } from '@/components/ui/button'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import type { Indicadores, SlotComparacao } from '@shared/index'

interface CoberturaChartProps {
  comparacao: SlotComparacao[]
  indicadores: Indicadores
  className?: string
}

type ViewMode = 'semana' | 'mes' | 'tudo'

const chartConfig = {
  necessario: { label: 'Necessario', color: 'hsl(220 70% 50%)' },
  coberto: { label: 'Coberto', color: 'hsl(160 60% 45%)' },
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

export function CoberturaChart({ comparacao, indicadores, className }: CoberturaChartProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('tudo')
  const [pageIndex, setPageIndex] = useState(0)

  // Agrupar por dia: somar planejado e executado de todos os slots do dia
  const porDia = useMemo(() => {
    const acc = new Map<string, { necessario: number; coberto: number }>()
    for (const s of comparacao) {
      if (!acc.has(s.data)) acc.set(s.data, { necessario: 0, coberto: 0 })
      const entry = acc.get(s.data)!
      entry.necessario += s.planejado
      entry.coberto += s.executado
    }
    return [...acc.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([data, vals]) => ({
        data,
        label: `${getWeekLabel(data)} ${formatDate(data)}`,
        ...vals,
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

  // Reset page when switching modes
  const handleViewChange = (val: string) => {
    if (val) {
      setViewMode(val as ViewMode)
      setPageIndex(0)
    }
  }

  // KPIs
  const totalDeficit = comparacao.filter(s => s.delta < 0).reduce((sum, s) => sum + Math.abs(s.delta), 0)
  const totalSurplus = comparacao.filter(s => s.delta > 0).reduce((sum, s) => sum + s.delta, 0)

  // Cobertura da página atual
  const pageCoverage = useMemo(() => {
    if (pageData.length === 0) return 0
    const totalNec = pageData.reduce((s, d) => s + d.necessario, 0)
    const totalCob = pageData.reduce((s, d) => s + d.coberto, 0)
    return totalNec > 0 ? (totalCob / totalNec) * 100 : 100
  }, [pageData])

  if (comparacao.length === 0) return null

  const safePageIndex = Math.min(pageIndex, Math.max(0, totalPages - 1))

  return (
    <div className={className}>
      {/* Header: KPIs + controles */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1">
          <div>
            <span className="text-2xl font-bold tabular-nums">
              {pageCoverage.toFixed(1)}%
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
            <span className="text-muted-foreground">
              Equilibrio <span className="font-medium">{indicadores.equilibrio}%</span>
            </span>
          </div>
        </div>

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
      </div>

      {pageLabel && (
        <p className="mb-2 text-xs text-muted-foreground">{pageLabel}</p>
      )}

      {/* Area chart */}
      <ChartContainer config={chartConfig} className="h-[200px] w-full">
        <AreaChart accessibilityLayer data={pageData}>
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
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={35}
            fontSize={11}
          />
          <ChartTooltip
            content={<ChartTooltipContent />}
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
    </div>
  )
}
