import { useState, useMemo } from 'react'
import type { Alocacao, Colaborador, Demanda, TipoContrato, Funcao, RegraHorarioColaborador } from '@shared/index'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { Button } from '@/components/ui/button'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { CORES_ALOCACAO, CORES_GENERO } from '@/lib/cores'
import { formatarMinutos, iniciais } from '@/lib/formatadores'

const DIAS_SEMANA_CURTO = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB']

function getStatusClasses(status: string, dayOfWeek: number): string {
  if (status === 'TRABALHO' && dayOfWeek === 0) {
    return CORES_ALOCACAO.TRABALHO_DOMINGO + ' hover:bg-sky-200 dark:hover:bg-sky-900/40'
  }
  if (status === 'TRABALHO') {
    return CORES_ALOCACAO.TRABALHO + ' hover:bg-emerald-100 dark:hover:bg-emerald-900/40'
  }
  if (status === 'FOLGA') {
    return CORES_ALOCACAO.FOLGA + ' hover:bg-muted'
  }
  if (status === 'INDISPONIVEL') {
    return CORES_ALOCACAO.INDISPONIVEL + ' cursor-not-allowed'
  }
  return 'bg-muted text-muted-foreground'
}

function formatTime(time: string | null): string {
  if (!time) return ''
  return time.replace(':00', '').replace(':30', ':30')
}

/** Format a Date to YYYY-MM-DD string */
function toDateStr(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

interface EscalaGridProps {
  colaboradores: Colaborador[]
  alocacoes: Alocacao[]
  dataInicio: string
  dataFim: string
  demandas?: Demanda[]
  tiposContrato?: TipoContrato[]
  funcoes?: Funcao[]
  readOnly?: boolean
  onCelulaClick?: (colaboradorId: number, data: string, statusAtual: string) => void
  loadingCell?: { colaboradorId: number; data: string } | null
  changedCells?: Set<string>
  violatedCells?: Set<string>
  regrasMap?: Map<number, RegraHorarioColaborador>
}

export function EscalaGrid({
  colaboradores,
  alocacoes,
  dataInicio,
  dataFim,
  demandas,
  tiposContrato,
  funcoes,
  readOnly = false,
  onCelulaClick,
  loadingCell,
  changedCells = new Set(),
  violatedCells = new Set(),
  regrasMap,
}: EscalaGridProps) {
  const [weekOffset, setWeekOffset] = useState(0)

  // Build Map<string, Alocacao> for O(1) lookup: key = "colaboradorId-data"
  const alocacaoMap = useMemo(() => {
    const map = new Map<string, Alocacao>()
    for (const a of alocacoes) {
      map.set(`${a.colaborador_id}-${a.data}`, a)
    }
    return map
  }, [alocacoes])

  // Build contrato lookup map
  const contratoMap = useMemo(() => {
    if (!tiposContrato) return new Map<number, string>()
    const map = new Map<number, string>()
    for (const tc of tiposContrato) {
      map.set(tc.id, tc.nome)
    }
    return map
  }, [tiposContrato])

  // Build funcao lookup map
  const funcaoMap = useMemo(() => {
    if (!funcoes) return new Map<number, Funcao>()
    const map = new Map<number, Funcao>()
    for (const f of funcoes) map.set(f.id, f)
    return map
  }, [funcoes])

  // Generate all dates in range
  const allDates = useMemo(() => {
    const start = new Date(dataInicio + 'T00:00:00')
    const end = new Date(dataFim + 'T00:00:00')
    const dates: Date[] = []
    const d = new Date(start)
    while (d <= end) {
      dates.push(new Date(d))
      d.setDate(d.getDate() + 1)
    }
    return dates
  }, [dataInicio, dataFim])

  // Group into weeks (Monday start)
  const weeks = useMemo(() => {
    const result: Date[][] = []
    let currentWeek: Date[] = []
    for (const date of allDates) {
      if (date.getDay() === 1 && currentWeek.length > 0) {
        result.push(currentWeek)
        currentWeek = []
      }
      currentWeek.push(date)
    }
    if (currentWeek.length > 0) result.push(currentWeek)
    return result
  }, [allDates])

  const activeWeek = weeks[weekOffset] || weeks[0]
  if (!activeWeek) return null

  const weekDates = activeWeek

  // O(1) allocation lookup
  function getAlloc(colabId: number, date: Date): Alocacao | undefined {
    return alocacaoMap.get(`${colabId}-${toDateStr(date)}`)
  }

  // Calculate weekly hours for colaborador
  function getWeeklyMinutes(colabId: number): number {
    let total = 0
    for (const date of weekDates) {
      const alloc = getAlloc(colabId, date)
      const minutos = alloc?.minutos_trabalho ?? alloc?.minutos
      if (minutos) total += minutos
    }
    return total
  }

  // Calculate coverage for a date using real demandas
  function getCoverage(date: Date): { atual: number; necessario: number } {
    const dateStr = toDateStr(date)
    const dow = date.getDay()
    // Map JS day (0=DOM) to our DIAS_SEMANA index
    const diasMap: Record<number, string> = { 1: 'SEG', 2: 'TER', 3: 'QUA', 4: 'QUI', 5: 'SEX', 6: 'SAB', 0: 'DOM' }
    const diaSemana = diasMap[dow]

    // Count workers on this date
    let working = 0
    for (const colab of colaboradores) {
      const alloc = getAlloc(colab.id, date)
      if (alloc?.status === 'TRABALHO') working++
    }

    // Calculate needed from demandas
    let needed = 0
    if (demandas) {
      for (const d of demandas) {
        // Demanda applies if dia_semana is null (all days) or matches this day
        if (d.dia_semana === null || d.dia_semana === diaSemana) {
          needed = Math.max(needed, d.min_pessoas)
        }
      }
    }

    return { atual: working, necessario: needed }
  }

  return (
    <div className="space-y-3">
      {/* Week navigation */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setWeekOffset(Math.max(0, weekOffset - 1))}
            disabled={weekOffset === 0}
          >
            Semana Anterior
          </Button>
          <span className="text-xs font-medium text-muted-foreground">
            Semana {weekOffset + 1} de {weeks.length}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setWeekOffset(Math.min(weeks.length - 1, weekOffset + 1))}
            disabled={weekOffset >= weeks.length - 1}
          >
            Proxima Semana
          </Button>
        </div>
      </div>

      {/* Grid */}
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b bg-muted/40">
              <th className="sticky left-0 z-10 min-w-[160px] bg-muted/40 px-3 py-2 text-left text-xs font-semibold text-foreground">
                Colaborador
              </th>
              {weekDates.map((date) => {
                const dow = date.getDay()
                const isWeekend = dow === 0 || dow === 6
                return (
                  <th
                    key={date.toISOString()}
                    className={cn(
                      'min-w-[80px] px-2 py-2 text-center text-xs font-semibold',
                      isWeekend ? 'text-primary' : 'text-foreground',
                    )}
                  >
                    <div>{DIAS_SEMANA_CURTO[dow]}</div>
                    <div className="text-[10px] font-normal text-muted-foreground">
                      {String(date.getDate()).padStart(2, '0')}/
                      {String(date.getMonth() + 1).padStart(2, '0')}
                    </div>
                  </th>
                )
              })}
              <th className="min-w-[80px] px-2 py-2 text-center text-xs font-semibold text-foreground">
                Horas/sem
              </th>
            </tr>
          </thead>
          <tbody>
            {colaboradores.map((colab) => {
              const weeklyMin = getWeeklyMinutes(colab.id)
              const weeklyHours = Math.round(weeklyMin / 60)
              const meta = colab.horas_semanais
              const hoursOk = Math.abs(weeklyHours - meta) <= 5

              return (
                <tr
                  key={colab.id}
                  className="border-b transition-colors hover:bg-muted/20"
                >
                  <td className="sticky left-0 z-10 bg-background px-3 py-2">
                    <div className="flex items-center gap-2">
                      <div
                        className={cn(
                          'flex size-7 items-center justify-center rounded-full text-[10px] font-semibold',
                          colab.sexo === 'F'
                            ? CORES_GENERO.F
                            : CORES_GENERO.M,
                        )}
                      >
                        {iniciais(colab.nome)}
                      </div>
                      <div>
                        <div className="flex items-center gap-1 text-xs font-medium leading-tight text-foreground">
                          {colab.funcao_id != null && funcaoMap.get(colab.funcao_id)?.cor_hex && (
                            <span
                              className="inline-block size-2 shrink-0 rounded-full"
                              style={{ backgroundColor: funcaoMap.get(colab.funcao_id!)!.cor_hex! }}
                            />
                          )}
                          {colab.nome.split(' ').slice(0, 2).join(' ')}
                        </div>
                        <div className="text-[10px] text-muted-foreground">
                          {colab.funcao_id != null && funcaoMap.get(colab.funcao_id)
                            ? funcaoMap.get(colab.funcao_id!)!.apelido
                            : contratoMap.get(colab.tipo_contrato_id) ?? `Contrato #${colab.tipo_contrato_id}`}
                        </div>
                      </div>
                    </div>
                  </td>
                  {weekDates.map((date) => {
                    const alloc = getAlloc(colab.id, date)
                    const status = alloc?.status ?? 'FOLGA'
                    const dow = date.getDay()
                    const dateStr = toDateStr(date)
                    const isLoading = loadingCell?.colaboradorId === colab.id && loadingCell?.data === dateStr
                    const isChanged = changedCells.has(`${colab.id}-${dateStr}`)
                    const isViolated = violatedCells.has(`${colab.id}-${dateStr}`)

                    return (
                      <td key={date.toISOString()} className="px-1 py-1">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              className={cn(
                                'flex w-full flex-col items-center justify-center rounded-md border px-1 py-1.5 text-[10px] transition-all',
                                getStatusClasses(status, dow),
                                !readOnly && status !== 'INDISPONIVEL' && 'cursor-pointer',
                                (readOnly || status === 'INDISPONIVEL') && 'cursor-default',
                                isLoading && 'opacity-60',
                                isChanged && 'ring-2 ring-primary ring-offset-1',
                                isViolated && 'ring-2 ring-destructive',
                              )}
                              disabled={readOnly || status === 'INDISPONIVEL'}
                              onClick={() => {
                                if (!readOnly && status !== 'INDISPONIVEL' && onCelulaClick) {
                                  onCelulaClick(colab.id, dateStr, status)
                                }
                              }}
                            >
                              {isLoading ? (
                                <Loader2 className="size-4 animate-spin" />
                              ) : status === 'TRABALHO' ? (
                                <>
                                  <span className="font-semibold">
                                    {formatTime(alloc?.hora_inicio ?? null)}
                                  </span>
                                  <span className="text-[9px] opacity-70">
                                    {formatTime(alloc?.hora_fim ?? null)}
                                  </span>
                                </>
                              ) : status === 'FOLGA' ? (
                                <span className={cn('text-[10px] font-medium', (() => {
                                  const regra = regrasMap?.get(colab.id)
                                  return regra?.folga_variavel_dia_semana === DIAS_SEMANA_CURTO[dow] ? 'opacity-60' : ''
                                })())}>
                                  {(() => {
                                    const regra = regrasMap?.get(colab.id)
                                    const sigla = DIAS_SEMANA_CURTO[dow]
                                    if (regra?.folga_fixa_dia_semana === sigla) return 'F'
                                    if (regra?.folga_variavel_dia_semana === sigla) return '(V)'
                                    return 'FOLGA'
                                  })()}
                                </span>
                              ) : (
                                <span className="text-[10px] font-medium">
                                  AUS.
                                </span>
                              )}
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="top" className="text-xs">
                            {colab.nome.split(' ').slice(0, 2).join(' ')}
                            {colab.funcao_id != null && funcaoMap.get(colab.funcao_id) && (
                              <> ({funcaoMap.get(colab.funcao_id!)!.apelido})</>
                            )}
                            {' - '}
                            {DIAS_SEMANA_CURTO[dow]}{' '}
                            {String(date.getDate()).padStart(2, '0')}/
                            {String(date.getMonth() + 1).padStart(2, '0')}
                            <br />
                            {status === 'TRABALHO'
                              ? `${alloc?.hora_inicio} - ${alloc?.hora_fim} (${formatarMinutos(alloc?.minutos_trabalho ?? alloc?.minutos ?? 0)})`
                              : status === 'INDISPONIVEL'
                                ? 'INDISPONIVEL'
                                : status}
                            {status === 'TRABALHO' && alloc?.hora_almoco_inicio && alloc?.hora_almoco_fim && (
                              <>
                                <br />
                                {`Almoço: ${alloc.hora_almoco_inicio} - ${alloc.hora_almoco_fim}`}
                              </>
                            )}
                          </TooltipContent>
                        </Tooltip>
                      </td>
                    )
                  })}
                  <td className="px-2 py-2 text-center">
                    <span
                      className={cn(
                        'text-xs font-semibold',
                        hoursOk
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-amber-600 dark:text-amber-400',
                      )}
                    >
                      {weeklyHours}h
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      /{meta}h
                    </span>
                  </td>
                </tr>
              )
            })}

            {/* Coverage row */}
            {demandas && demandas.length > 0 && (
              <tr className="border-t-2 bg-muted/30">
                <td className="sticky left-0 z-10 bg-muted/30 px-3 py-2 text-xs font-semibold text-foreground">
                  COBERTURA
                </td>
                {weekDates.map((date) => {
                  const cov = getCoverage(date)
                  const ok = cov.atual >= cov.necessario
                  return (
                    <td
                      key={date.toISOString()}
                      className="px-1 py-2 text-center"
                    >
                      <span
                        className={cn(
                          'text-xs font-semibold',
                          ok
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-amber-600 dark:text-amber-400',
                        )}
                      >
                        {cov.atual}/{cov.necessario}
                      </span>
                    </td>
                  )
                })}
                <td />
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-4 text-[10px] text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <div className="size-3 rounded border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30" />
          TRABALHO
        </div>
        <div className="flex items-center gap-1.5">
          <div className="size-3 rounded border border-border bg-muted/60" />
          FOLGA
        </div>
        <div className="flex items-center gap-1.5">
          <div className="size-3 rounded border border-sky-200 dark:border-sky-800 bg-sky-100 dark:bg-sky-950/30" />
          DOMINGO (trab.)
        </div>
        <div className="flex items-center gap-1.5">
          <div className="size-3 rounded border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30" />
          INDISPONIVEL
        </div>
      </div>

      {/* Legenda de funcoes/postos */}
      {funcoes && funcoes.filter(f => f.ativo && f.cor_hex).length > 0 && (
        <div className="flex flex-wrap items-center gap-3 text-[10px] text-muted-foreground">
          <span className="font-medium text-foreground/70">Postos:</span>
          {funcoes.filter(f => f.ativo && f.cor_hex).map(f => (
            <div key={f.id} className="flex items-center gap-1">
              <span
                className="inline-block size-2.5 rounded-full"
                style={{ backgroundColor: f.cor_hex! }}
              />
              {f.apelido}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
