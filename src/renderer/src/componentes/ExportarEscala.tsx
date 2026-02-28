import type {
  Escala,
  Alocacao,
  Colaborador,
  Setor,
  Violacao,
  TipoContrato,
  Funcao,
  SetorHorarioSemana,
} from '@shared/index'
import { formatarData, formatarMinutos, REGRAS_TEXTO, toMinutes, minutesToTime } from '@/lib/formatadores'

interface ExportarEscalaProps {
  escala: Escala
  alocacoes: Alocacao[]
  colaboradores: Colaborador[]
  setor: Setor
  violacoes?: Violacao[]
  tiposContrato?: TipoContrato[]
  funcoes?: Funcao[]
  horariosSemana?: SetorHorarioSemana[]
  modo?: 'ciclo' | 'detalhado'
  incluirAvisos?: boolean
  incluirCiclo?: boolean
  incluirTimeline?: boolean
  modoRender?: 'view' | 'download'
}

interface TimeSlot {
  startMin: number
  endMin: number
  start: string
  end: string
}

const DIAS_SEMANA_CURTO = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB'] as const

type DiaSemanaCurto = (typeof DIAS_SEMANA_CURTO)[number]

/**
 * Componente de exportação HTML self-contained para impressão.
 * CSS inline — funciona offline.
 */
export function ExportarEscala({
  escala,
  alocacoes,
  colaboradores,
  setor,
  violacoes = [],
  tiposContrato = [],
  funcoes = [],
  horariosSemana = [],
  modo = 'ciclo',
  incluirAvisos,
  incluirCiclo,
  incluirTimeline,
  modoRender = 'view',
}: ExportarEscalaProps) {
  const modoDetalhado = modo === 'detalhado'
  const mostrarCiclo = incluirCiclo ?? true
  const mostrarTimeline = incluirTimeline ?? modoDetalhado
  const detalhadoAtivo = mostrarTimeline
  const deveIncluirAvisos = incluirAvisos ?? detalhadoAtivo
  const isDownload = modoRender === 'download'
  // Generate all dates in range
  const allDates: Date[] = []
  const start = new Date(escala.data_inicio + 'T00:00:00')
  const end = new Date(escala.data_fim + 'T00:00:00')
  const d = new Date(start)
  while (d <= end) {
    allDates.push(new Date(d))
    d.setDate(d.getDate() + 1)
  }

  // Build allocation map
  const alocMap = new Map<string, Alocacao>()
  for (const a of alocacoes) {
    alocMap.set(`${a.colaborador_id}-${a.data}`, a)
  }

  // Build posto map
  const funcaoMap = new Map<number, string>()
  for (const f of funcoes) {
    funcaoMap.set(f.id, f.apelido)
  }

  // Build horario map
  const horarioSemanaMap = new Map<string, SetorHorarioSemana>()
  for (const h of horariosSemana) {
    horarioSemanaMap.set(h.dia_semana, h)
  }

  function getAlloc(colabId: number, dateStr: string): Alocacao | undefined {
    return alocMap.get(`${colabId}-${dateStr}`)
  }

  function toDateStr(date: Date): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  }

  function formatTime(time: string | null): string {
    return time ?? ''
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

  function getDiaSemanaKey(date: Date): DiaSemanaCurto {
    return DIAS_SEMANA_CURTO[date.getDay()]
  }

  function resolveOperationalWindow(date: Date): { ativo: boolean; abertura: string; fechamento: string } {
    const diaKey = getDiaSemanaKey(date)
    const diaCfg = horarioSemanaMap.get(diaKey)

    if (diaCfg) {
      if (!Boolean(diaCfg.ativo)) {
        return {
          ativo: false,
          abertura: setor.hora_abertura,
          fechamento: setor.hora_fechamento,
        }
      }

      const aberturaCfg = diaCfg.hora_abertura || setor.hora_abertura
      const fechamentoCfg = diaCfg.hora_fechamento || setor.hora_fechamento
      if (toMinutes(fechamentoCfg) > toMinutes(aberturaCfg)) {
        return { ativo: true, abertura: aberturaCfg, fechamento: fechamentoCfg }
      }
    }

    return {
      ativo: true,
      abertura: setor.hora_abertura,
      fechamento: setor.hora_fechamento,
    }
  }

  function buildSlots(horaAbertura: string, horaFechamento: string): TimeSlot[] {
    const openMin = toMinutes(horaAbertura)
    const closeMin = toMinutes(horaFechamento)
    if (closeMin <= openMin) return []

    const slots: TimeSlot[] = []
    for (let startMin = openMin; startMin < closeMin; startMin += 15) {
      const endMin = Math.min(startMin + 15, closeMin)
      slots.push({
        startMin,
        endMin,
        start: minutesToTime(startMin),
        end: minutesToTime(endMin),
      })
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

  // Group into weeks (7 days each)
  const weeks: Date[][] = []
  let currentWeek: Date[] = []
  for (const date of allDates) {
    currentWeek.push(date)
    if (currentWeek.length === 7) {
      weeks.push(currentWeek)
      currentWeek = []
    }
  }
  if (currentWeek.length > 0) weeks.push(currentWeek)
  const violacoesHard = violacoes.filter((v) => v.severidade === 'HARD')
  const violacoesSoft = violacoes.filter((v) => v.severidade === 'SOFT')
  const violacoesResumo = violacoes.slice(0, 8)

  const statusBadgeStyle = (status: string): React.CSSProperties => {
    const base = {
      padding: '2px 6px',
      borderRadius: '3px',
      fontSize: '10px',
      fontWeight: '600' as const,
    }
    switch (status) {
      case 'RASCUNHO':
        return { ...base, color: '#92400e', background: '#fef3c7', border: '1px solid #fde68a' }
      case 'OFICIAL':
        return { ...base, color: '#065f46', background: '#d1fae5', border: '1px solid #a7f3d0' }
      case 'ARQUIVADA':
        return { ...base, color: '#6b7280', background: '#f3f4f6', border: '1px solid #d1d5db' }
      default:
        return { ...base, color: '#374151', background: '#f9fafb', border: '1px solid #e5e7eb' }
    }
  }

  return (
    <div
      style={{
        fontFamily: 'Arial, sans-serif',
        padding: '20px',
        fontSize: '12px',
        background: isDownload ? '#fff' : undefined,
      }}
    >
      {/* Header */}
      <div style={{ marginBottom: '16px', borderBottom: '2px solid #e5e7eb', paddingBottom: '12px' }}>
        <h1 style={{ fontSize: '18px', fontWeight: 'bold', margin: '0 0 8px 0', color: '#111827' }}>
          ESCALA: {setor.nome.toUpperCase()}
        </h1>
        <div style={{ display: 'flex', gap: '16px', fontSize: '11px', color: '#6b7280' }}>
          <span>
            <strong>Período:</strong> {formatarData(escala.data_inicio)} a {formatarData(escala.data_fim)}
          </span>
          {detalhadoAtivo && (
            <span>
              <strong>Pontuação:</strong> {escala.pontuacao ?? '-'}
            </span>
          )}
          <span>
            <strong>Status:</strong> <span style={statusBadgeStyle(escala.status)}>{escala.status}</span>
          </span>
        </div>
      </div>

      {/* Weeks (resumo macro / ciclo) */}
      {mostrarCiclo && weeks.map((weekDates, weekIndex) => (
        <div key={weekIndex} style={{ marginBottom: '24px', pageBreakInside: 'avoid' }}>
          <h2 style={{ fontSize: '12px', fontWeight: '600', color: '#374151', marginBottom: '8px' }}>
            Semana {weekIndex + 1} — {formatarData(toDateStr(weekDates[0]))} a{' '}
            {formatarData(toDateStr(weekDates[weekDates.length - 1]))}
          </h2>
          <table style={{ width: '100%', borderCollapse: 'collapse', border: '1px solid #d1d5db' }}>
            <thead>
              <tr style={{ backgroundColor: '#f9fafb' }}>
                <th
                  style={{
                    border: '1px solid #d1d5db',
                    padding: '6px 8px',
                    textAlign: 'left',
                    fontSize: '11px',
                    fontWeight: '600',
                    color: '#111827',
                    minWidth: '120px',
                  }}
                >
                  Colaborador
                </th>
                {weekDates.map((date) => {
                  const dow = date.getDay()
                  const isWeekend = dow === 0 || dow === 6
                  return (
                    <th
                      key={toDateStr(date)}
                      style={{
                        border: '1px solid #d1d5db',
                        padding: '6px',
                        textAlign: 'center',
                        fontSize: '10px',
                        fontWeight: '600',
                        color: isWeekend ? '#2563eb' : '#111827',
                        minWidth: '95px',
                      }}
                    >
                      <div>{DIAS_SEMANA_CURTO[dow]}</div>
                      <div style={{ fontSize: '9px', color: '#6b7280', fontWeight: 'normal' }}>
                        {String(date.getDate()).padStart(2, '0')}/
                        {String(date.getMonth() + 1).padStart(2, '0')}
                      </div>
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {colaboradores.map((colab) => (
                <tr key={colab.id}>
                  <td
                    style={{
                      border: '1px solid #d1d5db',
                      padding: '6px 8px',
                      fontSize: '10px',
                      fontWeight: '500',
                      color: '#111827',
                    }}
                  >
                    {colab.nome}
                  </td>
                  {weekDates.map((date) => {
                    const dateStr = toDateStr(date)
                    const alloc = getAlloc(colab.id, dateStr)
                    const status = alloc?.status ?? 'FOLGA'
                    const dow = date.getDay()
                    const isSunday = dow === 0
                    const posto = resolvePosto(alloc, colab)

                    let cellBg = '#ffffff'
                    let cellColor = '#6b7280'

                    if (status === 'TRABALHO') {
                      cellBg = isSunday ? '#e0f2fe' : '#d1fae5'
                      cellColor = isSunday ? '#0369a1' : '#065f46'
                    } else if (status === 'INDISPONIVEL') {
                      cellBg = '#fef3c7'
                      cellColor = '#92400e'
                    } else {
                      cellBg = '#f9fafb'
                      cellColor = '#9ca3af'
                    }

                    return (
                      <td
                        key={dateStr}
                        style={{
                          border: '1px solid #d1d5db',
                          padding: '4px',
                          textAlign: 'center',
                          fontSize: '9px',
                          background: cellBg,
                          color: cellColor,
                        }}
                      >
                        {status === 'TRABALHO' ? (
                          <>
                            <div style={{ fontWeight: '600', fontSize: '10px' }}>
                              {formatTime(alloc?.hora_real_inicio ?? alloc?.hora_inicio ?? null)} - {formatTime(alloc?.hora_real_fim ?? alloc?.hora_fim ?? null)}
                            </div>
                            {detalhadoAtivo && alloc?.hora_almoco_inicio && alloc?.hora_almoco_fim && (
                              <div style={{ fontSize: '8px', opacity: 0.9 }}>
                                Almoço {alloc.hora_almoco_inicio} - {alloc.hora_almoco_fim}
                              </div>
                            )}
                            {detalhadoAtivo && alloc?.intervalo_15min && alloc?.hora_intervalo_inicio && alloc?.hora_intervalo_fim && (
                              <div style={{ fontSize: '8px', opacity: 0.9, color: '#7c3aed' }}>
                                Pausa {alloc.hora_intervalo_inicio}-{alloc.hora_intervalo_fim}
                              </div>
                            )}
                            {detalhadoAtivo && (
                              <div style={{ fontSize: '8px', opacity: 0.85, marginTop: '1px' }}>
                                Posto {posto}
                              </div>
                            )}
                          </>
                        ) : status === 'FOLGA' ? (
                          <span style={{ fontSize: '9px', fontWeight: '500' }}>F</span>
                        ) : (
                          <span style={{ fontSize: '9px', fontWeight: '500' }}>I</span>
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      {/* Timeline detalhada por dia */}
      {mostrarTimeline && (
      <div style={{ marginTop: '24px' }}>
        <h2
          style={{
            fontSize: '14px',
            fontWeight: '600',
            color: '#111827',
            marginBottom: '10px',
            borderBottom: '1px solid #e5e7eb',
            paddingBottom: '6px',
          }}
        >
          Timeline Diária de Postos
        </h2>

        {allDates.map((date) => {
          const dateStr = toDateStr(date)
          const diaKey = getDiaSemanaKey(date)
          const operational = resolveOperationalWindow(date)

          const dayBlockStyle: React.CSSProperties = {
            marginBottom: '18px',
            pageBreakInside: 'avoid',
            border: '1px solid #e5e7eb',
            borderRadius: '6px',
            padding: '8px',
          }

          if (!operational.ativo) {
            return (
              <div key={dateStr} style={dayBlockStyle}>
                <div style={{ marginBottom: '6px', fontSize: '11px', fontWeight: 600, color: '#1f2937' }}>
                  {diaKey} {formatarData(dateStr)}
                </div>
                <div
                  style={{
                    fontSize: '10px',
                    color: '#6b7280',
                    background: '#f9fafb',
                    border: '1px dashed #d1d5db',
                    borderRadius: '4px',
                    padding: '6px 8px',
                  }}
                >
                  Dia inativo: timeline fechada.
                </div>
              </div>
            )
          }

          const slots = buildSlots(operational.abertura, operational.fechamento)
          if (slots.length === 0) {
            return (
              <div key={dateStr} style={dayBlockStyle}>
                <div style={{ marginBottom: '6px', fontSize: '11px', fontWeight: 600, color: '#1f2937' }}>
                  {diaKey} {formatarData(dateStr)}
                </div>
                <div
                  style={{
                    fontSize: '10px',
                    color: '#6b7280',
                    background: '#f9fafb',
                    border: '1px dashed #d1d5db',
                    borderRadius: '4px',
                    padding: '6px 8px',
                  }}
                >
                  Horário operacional inválido para este dia.
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
            <div key={dateStr} style={dayBlockStyle}>
              <div
                style={{
                  marginBottom: '6px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: '12px',
                  flexWrap: 'wrap',
                }}
              >
                <div style={{ fontSize: '11px', fontWeight: 600, color: '#1f2937' }}>
                  {diaKey} {formatarData(dateStr)}
                </div>
                <div style={{ fontSize: '10px', color: '#6b7280' }}>
                  Operação: {operational.abertura} - {operational.fechamento}
                </div>
              </div>

              <div style={{ overflowX: 'auto' }}>
                <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: `${220 + slots.length * 46}px` }}>
                  <thead>
                    <tr style={{ background: '#f9fafb' }}>
                      <th
                        style={{
                          border: '1px solid #d1d5db',
                          padding: '4px 6px',
                          textAlign: 'left',
                          fontSize: '10px',
                          minWidth: '150px',
                        }}
                      >
                        Colaborador
                      </th>
                      {slots.map((slot) => (
                        <th
                          key={`${dateStr}-${slot.start}`}
                          style={{
                            border: '1px solid #d1d5db',
                            padding: '4px 2px',
                            textAlign: 'center',
                            fontSize: '9px',
                            minWidth: '46px',
                            whiteSpace: 'nowrap',
                          }}
                          title={`${slot.start} - ${slot.end}`}
                        >
                          {slot.start}
                        </th>
                      ))}
                      <th
                        style={{
                          border: '1px solid #d1d5db',
                          padding: '4px 6px',
                          textAlign: 'center',
                          fontSize: '10px',
                          minWidth: '72px',
                        }}
                      >
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
                          <td
                            style={{
                              border: '1px solid #d1d5db',
                              padding: '4px 6px',
                              fontSize: '9px',
                              color: '#111827',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            <div style={{ fontWeight: 600 }}>{colab.nome}</div>
                            <div style={{ fontSize: '8px', color: '#6b7280' }}>
                              {alloc?.status === 'INDISPONIVEL' ? 'Indisponível' : alloc?.status === 'TRABALHO' ? `Posto ${posto}` : 'Folga'}
                            </div>
                          </td>

                          {slots.map((slot) => {
                            const lunchSlot = isLunchSlot(alloc, slot)
                            const workSlot = isWorkSlot(alloc, slot)

                            let background = '#ffffff'
                            let color = '#6b7280'
                            let text = ''
                            if (lunchSlot) {
                              background = '#fef3c7'
                              color = '#92400e'
                              text = 'ALM'
                            } else if (workSlot) {
                              background = '#d1fae5'
                              color = '#065f46'
                              text = posto
                            }

                            return (
                              <td
                                key={`${colab.id}-${slot.start}`}
                                style={{
                                  border: '1px solid #d1d5db',
                                  padding: '3px 2px',
                                  textAlign: 'center',
                                  fontSize: '8px',
                                  fontWeight: 600,
                                  background,
                                  color,
                                  whiteSpace: 'nowrap',
                                }}
                                title={text ? `${colab.nome}: ${text} (${slot.start}-${slot.end})` : `${colab.nome}: sem alocação (${slot.start}-${slot.end})`}
                              >
                                {text}
                              </td>
                            )
                          })}

                          <td
                            style={{
                              border: '1px solid #d1d5db',
                              padding: '4px 6px',
                              textAlign: 'center',
                              fontSize: '9px',
                              fontWeight: 600,
                              color: '#374151',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {formatarMinutos(totalMin)}
                          </td>
                        </tr>
                      )
                    })}

                    {/* Fluxo por slot */}
                    <tr style={{ background: '#f9fafb' }}>
                      <td
                        style={{
                          border: '1px solid #d1d5db',
                          padding: '4px 6px',
                          fontSize: '9px',
                          fontWeight: 700,
                          color: '#1f2937',
                        }}
                      >
                        Fluxo (pessoas)
                      </td>
                      {fluxoPorSlot.map((count, idx) => {
                        const active = count > 0
                        return (
                          <td
                            key={`${dateStr}-fluxo-${idx}`}
                            style={{
                              border: '1px solid #d1d5db',
                              padding: '3px 2px',
                              textAlign: 'center',
                              fontSize: '9px',
                              fontWeight: 700,
                              color: active ? '#065f46' : '#9ca3af',
                              background: active ? '#ecfdf5' : '#f9fafb',
                            }}
                          >
                            {count}
                          </td>
                        )
                      })}
                      <td
                        style={{
                          border: '1px solid #d1d5db',
                          padding: '4px 6px',
                          textAlign: 'center',
                          fontSize: '9px',
                          fontWeight: 700,
                          color: '#1f2937',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        max {Math.max(...fluxoPorSlot, 0)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )
        })}
      </div>
      )}

      {/* Horas por Colaborador */}
      {mostrarTimeline && colaboradores.length > 0 && (
        <div style={{ marginTop: '24px', pageBreakInside: 'avoid' }}>
          <h2 style={{ fontSize: '14px', fontWeight: '600', color: '#111827', marginBottom: '10px', borderBottom: '1px solid #e5e7eb', paddingBottom: '6px' }}>
            Horas por Colaborador
          </h2>
          <table style={{ width: '100%', borderCollapse: 'collapse', border: '1px solid #d1d5db' }}>
            <thead>
              <tr style={{ backgroundColor: '#f9fafb' }}>
                {['Colaborador', 'Contrato', 'Real', 'Meta', 'Δ', 'Status'].map((h) => (
                  <th key={h} style={{ border: '1px solid #d1d5db', padding: '6px 8px', textAlign: h === 'Colaborador' || h === 'Contrato' ? 'left' : 'center', fontSize: '10px', fontWeight: '600', color: '#111827' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
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
                    <tr key={colab.id}>
                      <td style={{ border: '1px solid #d1d5db', padding: '5px 8px', fontSize: '10px', color: '#111827' }}>{colab.nome}</td>
                      <td style={{ border: '1px solid #d1d5db', padding: '5px 8px', fontSize: '10px', color: '#6b7280' }}>{tc?.nome ?? '-'}</td>
                      <td style={{ border: '1px solid #d1d5db', padding: '5px 8px', fontSize: '10px', textAlign: 'center', color: '#111827' }}>{formatarMinutos(real)}</td>
                      <td style={{ border: '1px solid #d1d5db', padding: '5px 8px', fontSize: '10px', textAlign: 'center', color: '#6b7280' }}>{formatarMinutos(meta)}</td>
                      <td style={{ border: '1px solid #d1d5db', padding: '5px 8px', fontSize: '10px', textAlign: 'center', fontWeight: '600', color: delta >= 0 ? '#065f46' : delta >= -30 ? '#92400e' : '#dc2626' }}>
                        {delta >= 0 ? '+' : ''}{formatarMinutos(Math.abs(delta))}{delta < 0 ? ' ↓' : ''}
                      </td>
                      <td style={{ border: '1px solid #d1d5db', padding: '5px 8px', fontSize: '10px', textAlign: 'center', fontWeight: '600', color: ok ? '#065f46' : '#dc2626' }}>
                        {ok ? 'OK' : 'ABAIXO'}
                      </td>
                    </tr>
                  )
                })
              })()}
            </tbody>
          </table>
        </div>
      )}

      {/* Avisos resumidos no modo ciclo */}
      {!mostrarTimeline && deveIncluirAvisos && violacoes.length > 0 && (
        <div style={{ marginTop: '24px', pageBreakInside: 'avoid' }}>
          <h2 style={{ fontSize: '14px', fontWeight: '600', color: '#111827', marginBottom: '10px', borderBottom: '1px solid #e5e7eb', paddingBottom: '6px' }}>
            Avisos ({violacoes.length})
          </h2>
          <p style={{ marginBottom: '8px', fontSize: '10px', color: '#4b5563' }}>
            Críticas: {violacoesHard.length} | Alertas: {violacoesSoft.length}
          </p>
          {violacoesResumo.map((v, i) => (
            <div
              key={i}
              style={{
                padding: '6px 10px',
                marginBottom: '4px',
                background: v.severidade === 'HARD' ? '#fef2f2' : '#fffbeb',
                border: v.severidade === 'HARD' ? '1px solid #fecaca' : '1px solid #fde68a',
                borderRadius: '4px',
                fontSize: '10px',
                color: v.severidade === 'HARD' ? '#991b1b' : '#78350f',
              }}
            >
              <strong>{v.colaborador_nome}</strong> — {v.mensagem || REGRAS_TEXTO[v.regra] || v.regra}
              {v.data && <span style={{ marginLeft: '8px' }}>({formatarData(v.data)})</span>}
            </div>
          ))}
          {violacoes.length > violacoesResumo.length && (
            <p style={{ marginTop: '4px', fontSize: '10px', color: '#6b7280' }}>
              ... e mais {violacoes.length - violacoesResumo.length} aviso(s).
            </p>
          )}
        </div>
      )}

      {/* Violacoes / Avisos detalhados */}
      {mostrarTimeline && deveIncluirAvisos && violacoes.length > 0 && (
        <div style={{ marginTop: '24px', pageBreakInside: 'avoid' }}>
          <h2 style={{ fontSize: '14px', fontWeight: '600', color: '#111827', marginBottom: '10px', borderBottom: '1px solid #e5e7eb', paddingBottom: '6px' }}>
            Violações ({violacoes.length})
          </h2>
          {/* HARD */}
          {violacoesHard.length > 0 && (
            <div style={{ marginBottom: '12px' }}>
              <h3 style={{ fontSize: '11px', fontWeight: '600', color: '#dc2626', marginBottom: '6px' }}>
                Críticas (HARD)
              </h3>
              {violacoesHard.map((v, i) => (
                  <div
                    key={i}
                    style={{
                      padding: '6px 10px',
                      marginBottom: '4px',
                      background: '#fef2f2',
                      border: '1px solid #fecaca',
                      borderRadius: '4px',
                      fontSize: '10px',
                      color: '#991b1b',
                    }}
                  >
                    <strong>{v.colaborador_nome}</strong> — {v.mensagem || REGRAS_TEXTO[v.regra] || v.regra}
                    {v.data && <span style={{ color: '#b91c1c', marginLeft: '8px' }}>({formatarData(v.data)})</span>}
                  </div>
                ))}
            </div>
          )}
          {/* SOFT */}
          {violacoesSoft.length > 0 && (
            <div>
              <h3 style={{ fontSize: '11px', fontWeight: '600', color: '#92400e', marginBottom: '6px' }}>
                Alertas (SOFT)
              </h3>
              {violacoesSoft.map((v, i) => (
                  <div
                    key={i}
                    style={{
                      padding: '6px 10px',
                      marginBottom: '4px',
                      background: '#fffbeb',
                      border: '1px solid #fde68a',
                      borderRadius: '4px',
                      fontSize: '10px',
                      color: '#78350f',
                    }}
                  >
                    <strong>{v.colaborador_nome}</strong> — {v.mensagem || REGRAS_TEXTO[v.regra] || v.regra}
                    {v.data && <span style={{ color: '#92400e', marginLeft: '8px' }}>({formatarData(v.data)})</span>}
                  </div>
                ))}
            </div>
          )}
        </div>
      )}

      {/* Footer */}
      <div
        style={{
          marginTop: '20px',
          paddingTop: '12px',
          borderTop: '1px solid #e5e7eb',
          fontSize: '10px',
          color: '#9ca3af',
          display: 'flex',
          justifyContent: 'space-between',
        }}
      >
        <div>
          <strong>Legenda:</strong>{' '}
          {mostrarTimeline
            ? 'F = Folga | I = Indisponível | ALM = almoço | Pausa = intervalo 15min (CLT Art. 71) | Posto = posição no fluxo'
            : 'F = Folga | I = Indisponível | Horário = jornada do dia'}
        </div>
        <div>
          Gerada em {new Date().toLocaleDateString('pt-BR')} | <strong>EscalaFlow v2</strong>
        </div>
      </div>

      {/* Print-specific styles */}
      <style>{`
        @media print {
          @page {
            size: A4 landscape;
            margin: 10mm;
          }
          body {
            print-color-adjust: exact;
            -webkit-print-color-adjust: exact;
          }
        }
      `}</style>
    </div>
  )
}
