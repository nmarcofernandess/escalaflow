import { useEffect, useMemo, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'
import type {
  Alocacao,
  Colaborador,
  DiaSemana,
  Escala,
  Funcao,
  RegraHorarioColaborador,
} from '@shared/index'

const DIAS_ORDEM: DiaSemana[] = ['SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB', 'DOM']
const DIAS_GETDAY: DiaSemana[] = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB']
const DIAS_CURTOS: Record<DiaSemana, string> = {
  SEG: 'Seg',
  TER: 'Ter',
  QUA: 'Qua',
  QUI: 'Qui',
  SEX: 'Sex',
  SAB: 'Sab',
  DOM: 'Dom',
}

type WeekMap = Record<DiaSemana, string | null>

interface EscalaCicloResumoProps {
  escala: Escala
  alocacoes: Alocacao[]
  colaboradores: Colaborador[]
  funcoes: Funcao[]
  regrasPadrao?: RegraHorarioColaborador[]
  onFolgaChange?: (colaboradorId: number, field: 'folga_fixa_dia_semana' | 'folga_variavel_dia_semana', value: DiaSemana | null) => void
  mostrarTodasSemanas?: boolean
  className?: string
}

type SimboloEscala = 'T' | 'F' | 'V' | 'I' | '.' | '-'
type SimboloLegenda = Exclude<SimboloEscala, '-'>

const ESTADO_CLASSES: Record<SimboloEscala, {
  cell: string
  label: string
  swatch: string
  descricao: string
}> = {
  T: {
    cell: 'bg-success/10 text-success font-medium',
    label: 'T',
    swatch: 'bg-success/30',
    descricao: 'Trabalho',
  },
  F: {
    cell: 'bg-slate-200 text-slate-700 font-semibold dark:bg-slate-700 dark:text-slate-200',
    label: 'F',
    swatch: 'bg-slate-300 dark:bg-slate-600',
    descricao: 'Folga fixa',
  },
  V: {
    cell: 'bg-warning/10 text-warning font-semibold',
    label: 'V',
    swatch: 'bg-warning/30',
    descricao: 'Folga variavel',
  },
  I: {
    cell: 'bg-rose-100 text-rose-700 font-semibold dark:bg-rose-900 dark:text-rose-200',
    label: 'I',
    swatch: 'bg-rose-200 dark:bg-rose-700',
    descricao: 'Indisponivel',
  },
  '.': {
    cell: 'text-muted-foreground',
    label: '\u00B7',
    swatch: 'bg-muted',
    descricao: 'Sem alocacao',
  },
  '-': {
    cell: 'text-muted-foreground',
    label: '\u2013',
    swatch: '',
    descricao: 'Sem titular',
  },
}

const LEGENDA_ORDEM: SimboloLegenda[] = ['T', 'F', 'V', 'I', '.']

function FolgaSelect({
  colabId,
  field,
  inferredFolgas,
  onFolgaChange,
}: {
  colabId: number | null
  field: 'folga_fixa_dia_semana' | 'folga_variavel_dia_semana'
  inferredFolgas: Map<number, { fixa: DiaSemana | null; variavel: DiaSemana | null }>
  onFolgaChange?: (colaboradorId: number, field: 'folga_fixa_dia_semana' | 'folga_variavel_dia_semana', value: DiaSemana | null) => void
}) {
  if (!colabId) return <span className="text-xs text-muted-foreground">-</span>

  const inf = inferredFolgas.get(colabId)
  const current = field === 'folga_fixa_dia_semana' ? inf?.fixa : inf?.variavel

  if (!onFolgaChange) {
    return (
      <span className={cn('text-xs', current ? 'text-foreground' : 'text-muted-foreground')}>
        {current ? DIAS_CURTOS[current] : '-'}
      </span>
    )
  }

  return (
    <Select
      value={current ?? '__none__'}
      onValueChange={(val) => {
        onFolgaChange(colabId, field, val === '__none__' ? null : (val as DiaSemana))
      }}
    >
      <SelectTrigger className="h-7 w-[70px] px-2 text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__none__" className="text-xs">-</SelectItem>
        {DIAS_ORDEM.map((dia) => (
          <SelectItem key={dia} value={dia} className="text-xs">{DIAS_CURTOS[dia]}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function toIsoDate(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function makeEmptyWeek(): WeekMap {
  return {
    SEG: null,
    TER: null,
    QUA: null,
    QUI: null,
    SEX: null,
    SAB: null,
    DOM: null,
  }
}

function gcd(a: number, b: number): number {
  let x = Math.abs(a)
  let y = Math.abs(b)
  while (y !== 0) {
    const t = y
    y = x % y
    x = t
  }
  return Math.max(1, x)
}

function mode(numbers: number[]): number | null {
  if (numbers.length === 0) return null
  const count = new Map<number, number>()
  for (const n of numbers) count.set(n, (count.get(n) ?? 0) + 1)
  let best: number | null = null
  let bestCount = -1
  for (const [n, c] of count.entries()) {
    if (c > bestCount) {
      best = n
      bestCount = c
    }
  }
  return best
}

export function EscalaCicloResumo({
  escala,
  alocacoes,
  colaboradores,
  funcoes,
  regrasPadrao = [],
  onFolgaChange,
  mostrarTodasSemanas = false,
  className,
}: EscalaCicloResumoProps) {
  const alocMap = useMemo(() => {
    const map = new Map<string, Alocacao>()
    for (const a of alocacoes) {
      map.set(`${a.colaborador_id}-${a.data}`, a)
    }
    return map
  }, [alocacoes])

  const regrasMap = useMemo(() => {
    const map = new Map<number, RegraHorarioColaborador>()
    for (const regra of regrasPadrao) map.set(regra.colaborador_id, regra)
    return map
  }, [regrasPadrao])

  const postosOrdenados = useMemo(
    () => [...funcoes].sort((a, b) => a.ordem - b.ordem || a.apelido.localeCompare(b.apelido)),
    [funcoes],
  )

  const titularPorPosto = useMemo(() => {
    const map = new Map<number, Colaborador>()
    for (const colab of colaboradores) {
      if (colab.funcao_id != null) map.set(colab.funcao_id, colab)
    }
    return map
  }, [colaboradores])

  const rows = useMemo(() => {
    return postosOrdenados.map((posto) => {
      const titular = titularPorPosto.get(posto.id) ?? null
      return {
        posto,
        titular,
        regra: titular ? (regrasMap.get(titular.id) ?? null) : null,
      }
    })
  }, [postosOrdenados, regrasMap, titularPorPosto])

  const weeks = useMemo(() => {
    const start = new Date(`${escala.data_inicio}T00:00:00`)
    const end = new Date(`${escala.data_fim}T00:00:00`)
    const dates: Date[] = []

    const cursor = new Date(start)
    while (cursor <= end) {
      dates.push(new Date(cursor))
      cursor.setDate(cursor.getDate() + 1)
    }

    const grouped: WeekMap[] = []
    let currentWeek = makeEmptyWeek()
    let countInWeek = 0

    for (const date of dates) {
      const dia = DIAS_GETDAY[date.getDay()]
      currentWeek[dia] = toIsoDate(date)
      countInWeek += 1

      if (countInWeek === 7) {
        grouped.push(currentWeek)
        currentWeek = makeEmptyWeek()
        countInWeek = 0
      }
    }

    if (countInWeek > 0) {
      grouped.push(currentWeek)
    }

    return grouped
  }, [escala.data_inicio, escala.data_fim])

  const periodoCiclo = useMemo(() => {
    if (weeks.length === 0) return 0
    const totalPostos = rows.length
    if (totalPostos <= 0) return weeks.length

    const sundayWorkers = weeks
      .map((week) => {
        const sunday = week.DOM
        if (!sunday) return 0

        let worked = 0
        for (const row of rows) {
          if (!row.titular) continue
          const alloc = alocMap.get(`${row.titular.id}-${sunday}`)
          if (alloc?.status === 'TRABALHO') worked += 1
        }
        return worked
      })
      .filter((count) => count > 0)

    const domDemand = mode(sundayWorkers) ?? 1
    const base = Math.floor(totalPostos / gcd(totalPostos, domDemand))
    return Math.max(1, Math.min(weeks.length, base))
  }, [weeks, rows, alocMap])

  const [selectedWeek, setSelectedWeek] = useState(0)

  useEffect(() => {
    if (periodoCiclo <= 0) {
      setSelectedWeek(0)
      return
    }
    setSelectedWeek((prev) => Math.max(0, Math.min(prev, periodoCiclo - 1)))
  }, [periodoCiclo])

  const week = weeks[selectedWeek] ?? makeEmptyWeek()

  // Inferir folga fixa vs variável pelo padrão do ciclo
  // Para cada colaborador, contar folgas por dia da semana ao longo das semanas do ciclo
  const inferredFolgas = useMemo(() => {
    const cicloWeeks = weeks.slice(0, Math.max(1, periodoCiclo))
    const map = new Map<number, { fixa: DiaSemana | null; variavel: DiaSemana | null }>()

    for (const row of rows) {
      if (!row.titular) continue
      const colabId = row.titular.id

      // Se já tem regra configurada, usa ela
      const regra = regrasMap.get(colabId)
      if (regra?.folga_fixa_dia_semana && regra?.folga_variavel_dia_semana) {
        map.set(colabId, {
          fixa: regra.folga_fixa_dia_semana,
          variavel: regra.folga_variavel_dia_semana,
        })
        continue
      }

      // Contar folgas por dia da semana no ciclo
      const folgaCount = new Map<DiaSemana, number>()
      for (const w of cicloWeeks) {
        for (const dia of DIAS_ORDEM) {
          const dateStr = w[dia]
          if (!dateStr) continue
          const alloc = alocMap.get(`${colabId}-${dateStr}`)
          if (alloc && alloc.status !== 'TRABALHO' && alloc.status !== 'INDISPONIVEL') {
            folgaCount.set(dia, (folgaCount.get(dia) ?? 0) + 1)
          }
        }
      }

      if (folgaCount.size === 0) {
        map.set(colabId, { fixa: null, variavel: null })
        continue
      }

      // Ordenar dias por frequência de folga (desc)
      const sorted = [...folgaCount.entries()].sort((a, b) => b[1] - a[1])

      // Dia com mais folgas = Fixa (aparece em mais semanas = padrão constante)
      const fixaDia = sorted[0][0]
      // Segundo dia mais frequente = Variável (muda entre semanas)
      const variavelDia = sorted.length > 1 ? sorted[1][0] : null

      map.set(colabId, {
        fixa: regra?.folga_fixa_dia_semana ?? fixaDia,
        variavel: regra?.folga_variavel_dia_semana ?? variavelDia,
      })
    }

    return map
  }, [rows, weeks, periodoCiclo, alocMap, regrasMap])

  const pendentesFolgaConfig = useMemo(
    () => rows.filter((row) => {
      if (!row.titular) return false
      const inf = inferredFolgas.get(row.titular.id)
      return !inf?.fixa || !inf?.variavel
    }).length,
    [rows, inferredFolgas],
  )

  function resolveSymbol(colab: Colaborador | null, dia: DiaSemana, dateStr: string | null): SimboloEscala {
    if (!colab) return '-'
    if (!dateStr) return '-'

    const alloc = alocMap.get(`${colab.id}-${dateStr}`)
    if (!alloc) return '.'

    if (alloc.status === 'TRABALHO') return 'T'
    if (alloc.status === 'INDISPONIVEL') return 'I'

    // Usar inferência do ciclo para classificar folga
    const inf = inferredFolgas.get(colab.id)
    if (inf?.variavel === dia) return 'V'
    return 'F'
  }

  if (rows.length === 0) {
    return (
      <div className={cn('rounded-md border border-dashed px-4 py-6 text-sm text-muted-foreground', className)}>
        Nenhum posto definido para gerar o ciclo.
      </div>
    )
  }

  const weeksToRender = mostrarTodasSemanas
    ? weeks.slice(0, Math.max(1, periodoCiclo))
    : [week]

  function renderWeekTable(weekData: WeekMap, weekLabel?: string) {
    return (
      <div key={weekLabel} className="space-y-1">
        {weekLabel && (
          <h3 className="text-xs font-semibold text-muted-foreground">{weekLabel}</h3>
        )}
        <div className="rounded-md border print-colors">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30">
                <TableHead className="w-[120px]">Posto</TableHead>
                <TableHead className="w-[180px]">Titular</TableHead>
                <TableHead className="w-[86px] text-center">Variavel</TableHead>
                <TableHead className="w-[70px] text-center">Fixo</TableHead>
                {DIAS_ORDEM.map((dia) => (
                  <TableHead key={dia} className="w-[54px] text-center">{dia}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ posto, titular }) => (
                <TableRow key={posto.id} className="hover:bg-muted/20">
                  <TableCell className="font-medium">{posto.apelido}</TableCell>
                  <TableCell className={cn('text-sm', !titular && 'italic text-muted-foreground')}>
                    {titular?.nome ?? '(sem titular)'}
                  </TableCell>
                  <TableCell className="p-1 text-center">
                    <FolgaSelect
                      colabId={titular?.id ?? null}
                      field="folga_variavel_dia_semana"
                      inferredFolgas={inferredFolgas}
                      onFolgaChange={mostrarTodasSemanas ? undefined : onFolgaChange}
                    />
                  </TableCell>
                  <TableCell className="p-1 text-center">
                    <FolgaSelect
                      colabId={titular?.id ?? null}
                      field="folga_fixa_dia_semana"
                      inferredFolgas={inferredFolgas}
                      onFolgaChange={mostrarTodasSemanas ? undefined : onFolgaChange}
                    />
                  </TableCell>
                  {DIAS_ORDEM.map((dia) => {
                    const simbolo = resolveSymbol(titular, dia, weekData[dia])
                    const estado = ESTADO_CLASSES[simbolo]
                    return (
                      <TableCell
                        key={`${posto.id}-${dia}`}
                        className={cn(
                          'text-center text-sm select-none',
                          estado.cell,
                        )}
                        title={estado.descricao}
                        aria-label={estado.descricao}
                      >
                        {estado.label}
                      </TableCell>
                    )
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    )
  }

  return (
    <div className={cn('space-y-3', className)}>
      {!mostrarTodasSemanas && periodoCiclo > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/20 p-2">
          <div className="flex flex-wrap items-center gap-1.5">
            {Array.from({ length: periodoCiclo }, (_, idx) => idx).map((idx) => (
              <Button
                key={idx}
                type="button"
                size="sm"
                variant={idx === selectedWeek ? 'secondary' : 'outline'}
                className="h-8 min-w-10 px-2 text-xs"
                onClick={() => setSelectedWeek(idx)}
              >
                S{idx + 1}
              </Button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {pendentesFolgaConfig > 0 && (
              <Badge variant="outline" className="border-warning/20 text-xs text-warning">
                {pendentesFolgaConfig} pendente(s) F/V
              </Badge>
            )}
          </div>
        </div>
      )}

      {mostrarTodasSemanas
        ? weeksToRender.map((w, idx) => renderWeekTable(w, `Semana ${idx + 1}`))
        : renderWeekTable(week)
      }

      <div className="flex items-center gap-4 pt-1 text-xs text-muted-foreground">
        {LEGENDA_ORDEM.map((simbolo) => {
          const estado = ESTADO_CLASSES[simbolo]
          return (
            <span key={simbolo} className="inline-flex items-center gap-1.5">
              <span className={cn('size-3 rounded-sm', estado.swatch)} />
              <span>{estado.descricao}</span>
            </span>
          )
        })}
      </div>
    </div>
  )
}
