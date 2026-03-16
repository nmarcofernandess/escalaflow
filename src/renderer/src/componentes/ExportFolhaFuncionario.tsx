import type {
  Alocacao,
  Colaborador,
  Escala,
  Setor,
  Violacao,
  TipoContrato,
  RegraHorarioColaborador,
} from '@shared/index'
import type { Aviso } from '@/componentes/AvisosSection'
import { ExportAvisos } from '@/componentes/ExportAvisos'
import { agruparPorSemanaISO, formatWeekLabel } from '@/lib/date-helpers'
import { formatarData, formatarMinutos, iniciais } from '@/lib/formatadores'
import { tipoFolga } from '@/lib/folga-helpers'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ExportFolhaFuncionarioProps {
  colaborador: Colaborador
  setor: Setor
  escala: Escala
  alocacoes: Alocacao[] // ALREADY FILTERED for this collaborator
  violacoes?: Violacao[] // ALREADY FILTERED
  avisos?: Aviso[] // ALREADY FILTERED
  tipoContrato: TipoContrato
  regra?: RegraHorarioColaborador
  mostrarAvisos?: boolean // default true
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DAY_LABELS = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB'] as const

const DIA_LABEL_CURTO: Record<string, string> = {
  DOM: 'Dom',
  SEG: 'Seg',
  TER: 'Ter',
  QUA: 'Qua',
  QUI: 'Qui',
  SEX: 'Sex',
  SAB: 'Sab',
}

// ---------------------------------------------------------------------------
// Helpers — pure functions, no hooks (R1 compliance)
// ---------------------------------------------------------------------------

/** Formats time string HH:MM:SS or HH:MM to HH:MM */
function fmtTime(t: string | null | undefined): string {
  if (!t) return ''
  return t.slice(0, 5)
}

/** Extracts dd from YYYY-MM-DD */
function dayOfDate(iso: string): string {
  return iso.split('-')[2]
}

// ---------------------------------------------------------------------------
// Sub-components — STATELESS (R1)
// ---------------------------------------------------------------------------

function EmployeeHeader({
  colaborador,
  setor,
  escala,
  tipoContrato,
  regra,
}: {
  colaborador: Colaborador
  setor: Setor
  escala: Escala
  tipoContrato: TipoContrato
  regra?: RegraHorarioColaborador
}) {
  const periodo = `${formatarData(escala.data_inicio)} a ${formatarData(escala.data_fim)}`

  return (
    <div
      style={{
        background: '#f8fafc',
        border: '1px solid #e2e8f0',
        borderRadius: 6,
        padding: '12px 16px',
        marginBottom: 14,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
      }}
    >
      {/* Avatar circle */}
      <div
        style={{
          width: 42,
          height: 42,
          borderRadius: '50%',
          background: '#e2e8f0',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 14,
          fontWeight: 700,
          color: '#64748b',
          flexShrink: 0,
        }}
      >
        {iniciais(colaborador.nome)}
      </div>

      {/* Center info */}
      <div style={{ flex: 1 }}>
        <h3
          style={{
            fontSize: 15,
            fontWeight: 700,
            color: '#111',
            margin: 0,
            marginBottom: 2,
          }}
        >
          {colaborador.nome}
        </h3>
        <p style={{ fontSize: 10, color: '#64748b', margin: 0 }}>
          {setor.nome} &nbsp;|&nbsp; {tipoContrato.nome} &nbsp;|&nbsp; {periodo}
        </p>
      </div>

      {/* Stats boxes */}
      <div style={{ display: 'flex', gap: 14 }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#111' }}>
            {tipoContrato.horas_semanais}h
          </div>
          <div style={{ fontSize: 8, color: '#94a3b8' }}>contrato</div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#111' }}>
            {regra?.folga_fixa_dia_semana
              ? DIA_LABEL_CURTO[regra.folga_fixa_dia_semana] ?? regra.folga_fixa_dia_semana
              : '\u2014'}
          </div>
          <div style={{ fontSize: 8, color: '#94a3b8' }}>folga fixa</div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#111' }}>
            {regra?.folga_variavel_dia_semana
              ? DIA_LABEL_CURTO[regra.folga_variavel_dia_semana] ??
                regra.folga_variavel_dia_semana
              : '\u2014'}
          </div>
          <div style={{ fontSize: 8, color: '#94a3b8' }}>folga var.</div>
        </div>
      </div>
    </div>
  )
}

function WeekTable({
  semanaLabel,
  dates,
  alocacoes,
  regra,
  horasSemanaisContrato,
}: {
  semanaLabel: string
  dates: string[]
  alocacoes: Alocacao[]
  regra?: RegraHorarioColaborador
  horasSemanaisContrato: number
}) {
  // Build alocacao map for fast lookup
  const alocMap = new Map<string, Alocacao>()
  for (const a of alocacoes) {
    alocMap.set(a.data, a)
  }

  // Sum worked minutes for this week
  let weekMinutes = 0
  for (const dt of dates) {
    const a = alocMap.get(dt)
    if (a?.status === 'TRABALHO') {
      weekMinutes += a.minutos_trabalho ?? a.minutos ?? 0
    }
  }

  return (
    <div style={{ breakInside: 'avoid', marginBottom: 4 }}>
      {/* Week title */}
      <div
        style={{
          fontSize: 10,
          fontWeight: 700,
          color: '#334155',
          padding: '6px 0 3px',
          borderBottom: '1px solid #e2e8f0',
          marginBottom: 0,
        }}
      >
        {semanaLabel}
      </div>

      {/* Table */}
      <table
        style={{
          width: '100%',
          borderCollapse: 'collapse',
          fontSize: 10,
          marginBottom: 4,
        }}
      >
        <thead>
          <tr>
            <th style={thStyle({ textAlign: 'left', width: 60 })}>Dia</th>
            <th style={thStyle({ textAlign: 'left' })}>Horario</th>
            <th style={thStyle({ textAlign: 'left' })}>Almoco</th>
            <th style={thStyle({ width: 50 })}>Total</th>
            <th style={thStyle({ textAlign: 'left' })}>Obs</th>
          </tr>
        </thead>
        <tbody>
          {dates.map((dt) => {
            const a = alocMap.get(dt)
            const dow = new Date(dt + 'T00:00:00').getDay()
            const dayLabel = DAY_LABELS[dow]
            const isDom = dow === 0

            if (a?.status === 'TRABALHO') {
              const almoco =
                a.hora_almoco_inicio && a.hora_almoco_fim
                  ? `${fmtTime(a.hora_almoco_inicio)}\u2013${fmtTime(a.hora_almoco_fim)}`
                  : '\u2014'
              const mins = a.minutos_trabalho ?? a.minutos ?? 0
              const obs = isDom ? 'Dom trabalhado' : ''

              return (
                <tr key={dt}>
                  <td
                    style={tdStyle({
                      textAlign: 'left',
                      fontWeight: isDom ? 700 : 600,
                      color: isDom ? '#6366f1' : '#334155',
                    })}
                  >
                    {dayLabel} {dayOfDate(dt)}
                  </td>
                  <td
                    style={tdStyle({
                      background: '#f0fdf4',
                      color: '#16a34a',
                      fontWeight: 600,
                    })}
                  >
                    {`${fmtTime(a.hora_inicio)} \u2013 ${fmtTime(a.hora_fim)}`}
                  </td>
                  <td style={tdStyle({})}>{almoco}</td>
                  <td
                    style={tdStyle({
                      textAlign: 'center',
                      background: '#f0fdf4',
                      color: '#16a34a',
                      fontWeight: 600,
                    })}
                  >
                    {formatarMinutos(mins)}
                  </td>
                  <td style={tdStyle({ fontSize: 8, color: '#94a3b8' })}>
                    {isDom && (
                      <span style={{ color: '#6366f1', fontSize: 8 }}>{obs}</span>
                    )}
                  </td>
                </tr>
              )
            }

            if (a?.status === 'INDISPONIVEL') {
              return (
                <tr key={dt}>
                  <td
                    style={tdStyle({
                      textAlign: 'left',
                      fontWeight: isDom ? 700 : 600,
                      color: isDom ? '#6366f1' : '#334155',
                    })}
                  >
                    {dayLabel} {dayOfDate(dt)}
                  </td>
                  <td
                    colSpan={3}
                    style={tdStyle({
                      color: '#dc2626',
                      fontStyle: 'italic',
                    })}
                  >
                    Indisponivel
                  </td>
                  <td style={tdStyle({ fontSize: 8, color: '#94a3b8' })} />
                </tr>
              )
            }

            // FOLGA (or missing allocation = treat as folga)
            const folga = tipoFolga(dt, regra, alocacoes)
            const folgaLabel =
              folga === 'FF'
                ? 'Folga Fixa'
                : folga === 'FV'
                  ? 'Folga Variavel'
                  : folga === 'DF'
                    ? 'Folga (dom ciclo)'
                    : 'Folga'

            return (
              <tr key={dt}>
                <td
                  style={tdStyle({
                    textAlign: 'left',
                    fontWeight: isDom ? 700 : 600,
                    color: isDom ? '#6366f1' : '#334155',
                  })}
                >
                  {dayLabel} {dayOfDate(dt)}
                </td>
                <td
                  colSpan={3}
                  style={tdStyle({
                    background: '#f8fafc',
                    color: '#94a3b8',
                  })}
                >
                  {folgaLabel}
                </td>
                <td style={tdStyle({ fontSize: 8, color: '#94a3b8' })}>
                  {folga !== 'F' ? folga : ''}
                </td>
              </tr>
            )
          })}

          {/* Footer: total row */}
          <tr>
            <td
              colSpan={3}
              style={{
                ...tdBaseStyle,
                textAlign: 'right',
                fontWeight: 600,
                background: '#f8fafc',
              }}
            >
              Total semana:
            </td>
            <td
              style={{
                ...tdBaseStyle,
                textAlign: 'center',
                fontWeight: 700,
                background: '#f8fafc',
              }}
            >
              {formatarMinutos(weekMinutes)}
            </td>
            <td
              style={{
                ...tdBaseStyle,
                fontSize: 8,
                color: '#94a3b8',
                background: '#f8fafc',
              }}
            >
              / {horasSemanaisContrato}h
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Shared inline styles for table cells (forced light for print)
// ---------------------------------------------------------------------------

const thBaseStyle: React.CSSProperties = {
  background: '#f1f5f9',
  border: '1px solid #e2e8f0',
  padding: '4px 6px',
  fontWeight: 600,
  color: '#334155',
}

const tdBaseStyle: React.CSSProperties = {
  border: '1px solid #e2e8f0',
  padding: '4px 6px',
  color: '#334155',
}

function thStyle(overrides: React.CSSProperties): React.CSSProperties {
  return { ...thBaseStyle, ...overrides }
}

function tdStyle(overrides: React.CSSProperties): React.CSSProperties {
  return { ...tdBaseStyle, ...overrides }
}

// ---------------------------------------------------------------------------
// Main component — STATELESS (renderToStaticMarkup compliant, R1)
// ---------------------------------------------------------------------------

export function ExportFolhaFuncionario({
  colaborador,
  setor,
  escala,
  alocacoes,
  violacoes = [],
  avisos = [],
  tipoContrato,
  regra,
  mostrarAvisos = true,
}: ExportFolhaFuncionarioProps) {
  // Build sorted array of all dates from alocacoes
  const allDates = alocacoes.map((a) => a.data).sort()

  // If no alocacoes provided, derive dates from escala period
  const dates =
    allDates.length > 0
      ? allDates
      : (() => {
          const result: string[] = []
          const d = new Date(escala.data_inicio + 'T00:00:00')
          const end = new Date(escala.data_fim + 'T00:00:00')
          while (d <= end) {
            result.push(
              `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
            )
            d.setDate(d.getDate() + 1)
          }
          return result
        })()

  // Deduplicate dates (alocacoes might have multiple entries per date in edge cases)
  const uniqueDates = [...new Set(dates)].sort()

  // Group by ISO weeks
  const weeks = agruparPorSemanaISO(uniqueDates)

  return (
    <div
      style={{
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        background: '#fafafa',
        color: '#111',
        fontSize: 11,
        lineHeight: 1.4,
      }}
    >
      {/* Print orientation: A4 portrait */}
      <style
        dangerouslySetInnerHTML={{
          __html: `@page { size: A4 portrait; margin: 10mm; } @media print { body { print-color-adjust: exact; -webkit-print-color-adjust: exact; } }`,
        }}
      />

      {/* Employee header card */}
      <EmployeeHeader
        colaborador={colaborador}
        setor={setor}
        escala={escala}
        tipoContrato={tipoContrato}
        regra={regra}
      />

      {/* Per-week tables */}
      {weeks.map((week) => (
        <WeekTable
          key={week.weekNumber}
          semanaLabel={formatWeekLabel(week.startDate, week.endDate)}
          dates={week.dates}
          alocacoes={alocacoes}
          regra={regra}
          horasSemanaisContrato={tipoContrato.horas_semanais}
        />
      ))}

      {/* Avisos section */}
      {mostrarAvisos && (
        <ExportAvisos
          violacoes={violacoes}
          avisos={avisos}
          filtrarColaboradorId={colaborador.id}
        />
      )}

      {/* Footer: legend + version */}
      <div
        style={{
          fontSize: 9,
          color: '#94a3b8',
          borderTop: '1px solid #e2e8f0',
          paddingTop: 8,
          marginTop: 16,
          display: 'flex',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <span>
            <strong>FF</strong> Folga Fixa
          </span>
          <span>
            <strong>FV</strong> Folga Variavel
          </span>
          <span>
            <strong>DF</strong> Dom folga ciclo
          </span>
        </div>
        <div>
          EscalaFlow &mdash; Gerado em{' '}
          {new Date().toLocaleDateString('pt-BR')}
        </div>
      </div>
    </div>
  )
}
