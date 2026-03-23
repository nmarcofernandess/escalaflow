import type {
  Escala,
  Alocacao,
  Colaborador,
  Setor,
  TipoContrato,
  Funcao,
  SetorHorarioSemana,
} from '@shared/index'
import { formatarData, formatarMinutos, toMinutes, minutesToTime } from '@/lib/formatadores'
import { cn } from '@/lib/utils'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

interface TimeSlot {
  startMin: number
  endMin: number
  start: string
  end: string
}

const DIAS_SEMANA_CURTO = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB'] as const

type DiaSemanaCurto = (typeof DIAS_SEMANA_CURTO)[number]

interface EscalaTimelineDiariaProps {
  escala: Escala
  alocacoes: Alocacao[]
  colaboradores: Colaborador[]
  setor: Setor
  tiposContrato?: TipoContrato[]
  funcoes?: Funcao[]
  horariosSemana?: SetorHorarioSemana[]
  incluirHoras?: boolean
  className?: string
}

function toDateStr(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function getDiaSemanaKey(date: Date): DiaSemanaCurto {
  return DIAS_SEMANA_CURTO[date.getDay()]
}

function buildSlots(horaAbertura: string, horaFechamento: string): TimeSlot[] {
  const openMin = toMinutes(horaAbertura)
  const closeMin = toMinutes(horaFechamento)
  if (closeMin <= openMin) return []

  const slots: TimeSlot[] = []
  for (let startMin = openMin; startMin < closeMin; startMin += 15) {
    const endMin = Math.min(startMin + 15, closeMin)
    slots.push({ startMin, endMin, start: minutesToTime(startMin), end: minutesToTime(endMin) })
  }
  return slots
}

function isLunchSlot(alloc: Alocacao | undefined, slot: TimeSlot): boolean {
  if (!alloc?.hora_almoco_inicio || !alloc?.hora_almoco_fim) return false
  const lunchStart = toMinutes(alloc.hora_almoco_inicio)
  const lunchEnd = toMinutes(alloc.hora_almoco_fim)
  return lunchStart <= slot.startMin && lunchEnd >= slot.endMin
}

function isWorkSlot(alloc: Alocacao | undefined, slot: TimeSlot): boolean {
  if (!alloc || alloc.status !== 'TRABALHO' || !alloc.hora_inicio || !alloc.hora_fim) return false
  const workStart = toMinutes(alloc.hora_inicio)
  const workEnd = toMinutes(alloc.hora_fim)
  if (!(workStart <= slot.startMin && workEnd >= slot.endMin)) return false
  return !isLunchSlot(alloc, slot)
}

export function EscalaTimelineDiaria({
  escala,
  alocacoes,
  colaboradores,
  setor,
  tiposContrato = [],
  funcoes = [],
  horariosSemana = [],
  incluirHoras = true,
  className,
}: EscalaTimelineDiariaProps) {
  const allDates: Date[] = []
  const start = new Date(escala.data_inicio + 'T00:00:00')
  const end = new Date(escala.data_fim + 'T00:00:00')
  const d = new Date(start)
  while (d <= end) {
    allDates.push(new Date(d))
    d.setDate(d.getDate() + 1)
  }

  const alocMap = new Map<string, Alocacao>()
  for (const a of alocacoes) {
    alocMap.set(`${a.colaborador_id}-${a.data}`, a)
  }

  const funcaoMap = new Map<number, string>()
  for (const f of funcoes) {
    funcaoMap.set(f.id, f.apelido)
  }

  const horarioSemanaMap = new Map<string, SetorHorarioSemana>()
  for (const h of horariosSemana) {
    horarioSemanaMap.set(h.dia_semana, h)
  }

  function getAlloc(colabId: number, dateStr: string): Alocacao | undefined {
    return alocMap.get(`${colabId}-${dateStr}`)
  }

  function resolvePosto(alloc: Alocacao | undefined, colab: Colaborador): string {
    if (alloc?.funcao_id != null) {
      return funcaoMap.get(alloc.funcao_id) ?? 'Sem posto'
    }
    if (colab.funcao_id != null) {
      return funcaoMap.get(colab.funcao_id) ?? 'Sem posto'
    }
    return 'Sem posto'
  }

  function resolveOperationalWindow(date: Date): { ativo: boolean; abertura: string; fechamento: string } {
    const diaKey = getDiaSemanaKey(date)
    const diaCfg = horarioSemanaMap.get(diaKey)

    if (diaCfg) {
      if (!Boolean(diaCfg.ativo)) {
        return { ativo: false, abertura: setor.hora_abertura, fechamento: setor.hora_fechamento }
      }
      const aberturaCfg = diaCfg.hora_abertura || setor.hora_abertura
      const fechamentoCfg = diaCfg.hora_fechamento || setor.hora_fechamento
      if (toMinutes(fechamentoCfg) > toMinutes(aberturaCfg)) {
        return { ativo: true, abertura: aberturaCfg, fechamento: fechamentoCfg }
      }
    }

    return { ativo: true, abertura: setor.hora_abertura, fechamento: setor.hora_fechamento }
  }

  return (
    <div className={cn('flex flex-col gap-4', className)}>
      {allDates.map((date) => {
        const dateStr = toDateStr(date)
        const diaKey = getDiaSemanaKey(date)
        const operational = resolveOperationalWindow(date)

        if (!operational.ativo) {
          return (
            <div key={dateStr} className="break-inside-avoid rounded-md border p-3">
              <div className="mb-1.5 text-sm font-semibold">
                {diaKey} {formatarData(dateStr)}
              </div>
              <div className="rounded border border-dashed bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                Dia inativo: timeline fechada.
              </div>
            </div>
          )
        }

        const slots = buildSlots(operational.abertura, operational.fechamento)
        if (slots.length === 0) {
          return (
            <div key={dateStr} className="break-inside-avoid rounded-md border p-3">
              <div className="mb-1.5 text-sm font-semibold">
                {diaKey} {formatarData(dateStr)}
              </div>
              <div className="rounded border border-dashed bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                Horario operacional invalido para este dia.
              </div>
            </div>
          )
        }

        const fluxoPorSlot = slots.map((slot) => {
          let count = 0
          for (const colab of colaboradores) {
            const alloc = getAlloc(colab.id, dateStr)
            if (isWorkSlot(alloc, slot)) count++
          }
          return count
        })

        return (
          <div key={dateStr} className="break-inside-avoid rounded-md border p-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm font-semibold">
                {diaKey} {formatarData(dateStr)}
              </div>
              <div className="text-xs text-muted-foreground">
                Operacao: {operational.abertura} - {operational.fechamento}
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full border-collapse" style={{ minWidth: `${240 + slots.length * 48}px` }}>
                <thead>
                  <tr className="bg-muted/30">
                    <th className="min-w-[160px] border px-2 py-1.5 text-left text-xs font-semibold">
                      Colaborador
                    </th>
                    {slots.map((slot) => (
                      <th
                        key={`${dateStr}-${slot.start}`}
                        className="min-w-[48px] whitespace-nowrap border px-0.5 py-1.5 text-center text-[10px] font-semibold"
                        title={`${slot.start} - ${slot.end}`}
                      >
                        {slot.start}
                      </th>
                    ))}
                    <th className="min-w-[76px] border px-2 py-1.5 text-center text-xs font-semibold">
                      Total
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {colaboradores.map((colab) => {
                    const alloc = getAlloc(colab.id, dateStr)
                    const posto = resolvePosto(alloc, colab)
                    const totalMin = alloc?.status === 'TRABALHO'
                      ? (alloc.minutos_trabalho ?? alloc.minutos ?? 0)
                      : 0

                    return (
                      <tr key={`${colab.id}-${dateStr}`}>
                        <td className="whitespace-nowrap border px-2 py-1.5 text-xs">
                          <div className="font-semibold">{colab.nome}</div>
                          <div className="text-[10px] text-muted-foreground">
                            {alloc?.status === 'INDISPONIVEL' ? 'Indisponivel' : alloc?.status === 'TRABALHO' ? `Posto ${posto}` : 'Folga'}
                          </div>
                        </td>

                        {slots.map((slot) => {
                          const lunchSlot = isLunchSlot(alloc, slot)
                          const workSlot = isWorkSlot(alloc, slot)

                          return (
                            <td
                              key={`${colab.id}-${slot.start}`}
                              className={cn(
                                'whitespace-nowrap border px-0.5 py-1 text-center text-[10px] font-semibold',
                                lunchSlot
                                  ? 'bg-warning/10 text-warning'
                                  : workSlot
                                    ? 'bg-success/10 text-success'
                                    : 'text-muted-foreground',
                              )}
                              title={
                                lunchSlot
                                  ? `${colab.nome}: ALM (${slot.start}-${slot.end})`
                                  : workSlot
                                    ? `${colab.nome}: ${posto} (${slot.start}-${slot.end})`
                                    : `${colab.nome}: sem alocacao (${slot.start}-${slot.end})`
                              }
                            >
                              {lunchSlot ? 'ALM' : workSlot ? posto : ''}
                            </td>
                          )
                        })}

                        <td className="whitespace-nowrap border px-2 py-1.5 text-center text-xs font-semibold">
                          {formatarMinutos(totalMin)}
                        </td>
                      </tr>
                    )
                  })}

                  <tr className="bg-muted/30">
                    <td className="border px-2 py-1.5 text-xs font-bold">
                      Fluxo (pessoas)
                    </td>
                    {fluxoPorSlot.map((count, idx) => (
                      <td
                        key={`${dateStr}-fluxo-${idx}`}
                        className={cn(
                          'border px-0.5 py-1 text-center text-[10px] font-bold',
                          count > 0 ? 'bg-success/10 text-success' : 'text-muted-foreground',
                        )}
                      >
                        {count}
                      </td>
                    ))}
                    <td className="whitespace-nowrap border px-2 py-1.5 text-center text-xs font-bold">
                      max {Math.max(...fluxoPorSlot, 0)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        )
      })}

      {incluirHoras && colaboradores.length > 0 && (
        <div className="break-inside-avoid">
          <h2 className="mb-2.5 border-b pb-1.5 text-sm font-semibold">
            Horas por Colaborador
          </h2>
          <Table className="border">
            <TableHeader>
              <TableRow className="bg-muted/30">
                {['Colaborador', 'Contrato', 'Real', 'Meta', 'Delta', 'Status'].map((h) => (
                  <TableHead
                    key={h}
                    className={cn(
                      'border px-2 py-1.5 text-xs font-semibold',
                      h === 'Colaborador' || h === 'Contrato' ? 'text-left' : 'text-center',
                    )}
                  >
                    {h}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {(() => {
                const totalDays = Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1
                const semanas = Math.max(1, totalDays / 7)
                const minutosReais = new Map<number, number>()
                for (const a of alocacoes) {
                  if (a.status === 'TRABALHO' && a.minutos != null) {
                    minutosReais.set(a.colaborador_id, (minutosReais.get(a.colaborador_id) ?? 0) + a.minutos)
                  }
                }
                return colaboradores.map((colab) => {
                  const tc = tiposContrato.find((t) => t.id === colab.tipo_contrato_id)
                  const real = minutosReais.get(colab.id) ?? 0
                  const meta = tc ? Math.round(tc.horas_semanais * 60 * semanas) : 0
                  const delta = real - meta
                  const ok = delta >= -30
                  return (
                    <TableRow key={colab.id}>
                      <TableCell className="border px-2 py-1.5 text-xs">{colab.nome}</TableCell>
                      <TableCell className="border px-2 py-1.5 text-xs text-muted-foreground">{tc?.nome ?? '-'}</TableCell>
                      <TableCell className="border px-2 py-1.5 text-center text-xs">{formatarMinutos(real)}</TableCell>
                      <TableCell className="border px-2 py-1.5 text-center text-xs text-muted-foreground">{formatarMinutos(meta)}</TableCell>
                      <TableCell
                        className={cn(
                          'border px-2 py-1.5 text-center text-xs font-semibold',
                          delta >= 0 ? 'text-success' : delta >= -30 ? 'text-warning' : 'text-destructive',
                        )}
                      >
                        {delta >= 0 ? '+' : ''}{formatarMinutos(Math.abs(delta))}{delta < 0 ? ' \u2193' : ''}
                      </TableCell>
                      <TableCell
                        className={cn(
                          'border px-2 py-1.5 text-center text-xs font-semibold',
                          ok ? 'text-success' : 'text-destructive',
                        )}
                      >
                        {ok ? 'OK' : 'ABAIXO'}
                      </TableCell>
                    </TableRow>
                  )
                })
              })()}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
