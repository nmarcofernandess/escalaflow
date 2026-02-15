import type { Escala, Alocacao, Colaborador, Setor } from '@shared/index'
import { formatarData } from '@/lib/formatadores'

interface ExportarEscalaProps {
  escala: Escala
  alocacoes: Alocacao[]
  colaboradores: Colaborador[]
  setor: Setor
}

/**
 * Componente de exportação HTML self-contained para impressão.
 * CSS inline — funciona offline. Tabela pessoa x dia com horários.
 */
export function ExportarEscala({
  escala,
  alocacoes,
  colaboradores,
  setor,
}: ExportarEscalaProps) {
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

  function getAlloc(colabId: number, dateStr: string): Alocacao | undefined {
    return alocMap.get(`${colabId}-${dateStr}`)
  }

  function formatTime(time: string | null): string {
    if (!time) return ''
    return time.replace(':00', '').replace(':30', ':30')
  }

  function toDateStr(date: Date): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  }

  const DIAS_SEMANA_CURTO = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB']

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
    <div style={{ fontFamily: 'Arial, sans-serif', padding: '20px', fontSize: '12px' }}>
      {/* Header */}
      <div style={{ marginBottom: '16px', borderBottom: '2px solid #e5e7eb', paddingBottom: '12px' }}>
        <h1 style={{ fontSize: '18px', fontWeight: 'bold', margin: '0 0 8px 0', color: '#111827' }}>
          ESCALA: {setor.nome.toUpperCase()}
        </h1>
        <div style={{ display: 'flex', gap: '16px', fontSize: '11px', color: '#6b7280' }}>
          <span>
            <strong>Período:</strong> {formatarData(escala.data_inicio)} a {formatarData(escala.data_fim)}
          </span>
          <span>
            <strong>Pontuação:</strong> {escala.pontuacao ?? '-'}
          </span>
          <span>
            <strong>Status:</strong> <span style={statusBadgeStyle(escala.status)}>{escala.status}</span>
          </span>
        </div>
      </div>

      {/* Weeks */}
      {weeks.map((weekDates, weekIndex) => (
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
                        minWidth: '60px',
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

                    const cellStyle: React.CSSProperties = {
                      border: '1px solid #d1d5db',
                      padding: '4px',
                      textAlign: 'center',
                      fontSize: '9px',
                      background: cellBg,
                      color: cellColor,
                    }

                    return (
                      <td key={dateStr} style={cellStyle}>
                        {status === 'TRABALHO' ? (
                          <>
                            <div style={{ fontWeight: '600', fontSize: '10px' }}>
                              {formatTime(alloc?.hora_inicio ?? null)}
                            </div>
                            <div style={{ fontSize: '8px', opacity: 0.8 }}>
                              {formatTime(alloc?.hora_fim ?? null)}
                            </div>
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
          <strong>Legenda:</strong> F = Folga | I = Indisponível | Horários = Turno de Trabalho
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
