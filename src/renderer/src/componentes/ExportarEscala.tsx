import type {
  Escala,
  Alocacao,
  Colaborador,
  Setor,
  Violacao,
  TipoContrato,
  Funcao,
  SetorHorarioSemana,
  RegraHorarioColaborador,
} from '@shared/index'
import type { Aviso } from '@/componentes/AvisosSection'
import { formatarData, formatarMinutos } from '@/lib/formatadores'
import { tipoFolga } from '@/lib/folga-helpers'
import { CicloGrid } from '@/componentes/CicloGrid'
import { escalaParaCicloGrid } from '@/lib/ciclo-grid-converters'
import { EscalaTimelineDiaria } from '@/componentes/EscalaTimelineDiaria'
import { ExportTimelineBarras } from '@/componentes/ExportTimelineBarras'
import { ExportFolhaFuncionario } from '@/componentes/ExportFolhaFuncionario'
import { ExportAvisos } from '@/componentes/ExportAvisos'
import { agruparPorSemanaISO, formatWeekLabel } from '@/lib/date-helpers'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ExportarEscalaProps {
  // Data
  escala: Escala
  alocacoes: Alocacao[]
  colaboradores: Colaborador[]
  setor: Setor
  violacoes?: Violacao[]
  avisos?: Aviso[]
  tiposContrato?: TipoContrato[]
  funcoes?: Funcao[]
  horariosSemana?: SetorHorarioSemana[]
  regrasPadrao?: RegraHorarioColaborador[]

  // Section visibility
  mostrarCiclo?: boolean
  mostrarSemanal?: boolean
  mostrarTimeline?: boolean
  timelineMode?: 'barras' | 'grid'
  mostrarAvisos?: boolean

  // Mode
  mode?: 'setor' | 'funcionario'
  colaboradorId?: number
  tipoContrato?: TipoContrato

  // ── Legacy props (backward compat) ──────────────────────────────────────
  /** @deprecated Use mostrarTimeline + mostrarCiclo instead */
  modo?: 'ciclo' | 'detalhado'
  /** @deprecated Use mostrarAvisos instead */
  incluirAvisos?: boolean
  /** @deprecated Use mostrarCiclo instead */
  incluirCiclo?: boolean
  /** @deprecated Use mostrarTimeline instead */
  incluirTimeline?: boolean
  /** @deprecated Ignored — component is always stateless */
  modoRender?: 'view' | 'download'
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DAY_LABELS = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB'] as const

const STATUS_STYLE: Record<string, React.CSSProperties> = {
  RASCUNHO: { border: '1px solid #d97706', background: '#fffbeb', color: '#d97706' },
  OFICIAL: { border: '1px solid #16a34a', background: '#f0fdf4', color: '#16a34a' },
  ARQUIVADA: { border: '1px solid #94a3b8', background: '#f8fafc', color: '#94a3b8' },
}

// ---------------------------------------------------------------------------
// Helpers — pure functions, NO hooks (R1 compliance)
// ---------------------------------------------------------------------------

/** Format time HH:MM:SS or HH:MM to HH:MM */
function fmtTime(t: string | null | undefined): string {
  if (!t) return ''
  return t.slice(0, 5)
}

/** Build regrasMap from array */
function buildRegrasMap(regras: RegraHorarioColaborador[]): Map<number, RegraHorarioColaborador> {
  const map = new Map<number, RegraHorarioColaborador>()
  for (const r of regras) map.set(r.colaborador_id, r)
  return map
}

/** Get all unique sorted dates from alocacoes */
function getAllDates(alocacoes: Alocacao[]): string[] {
  const set = new Set<string>()
  for (const a of alocacoes) set.add(a.data)
  return [...set].sort()
}

// ---------------------------------------------------------------------------
// ExportHeader — inline sub-component (setor mode)
// ---------------------------------------------------------------------------

function ExportHeader({ escala, setor }: { escala: Escala; setor: Setor }) {
  const statusStyle = STATUS_STYLE[escala.status] ?? STATUS_STYLE.RASCUNHO
  return (
    <div style={{ marginBottom: 16, borderBottom: '2px solid #e5e7eb', paddingBottom: 12 }}>
      <h1 style={{ fontSize: 16, fontWeight: 700, color: '#111', marginBottom: 8, margin: 0 }}>
        ESCALA: {setor.nome.toUpperCase()}
      </h1>
      <div style={{ display: 'flex', gap: 16, fontSize: 11, color: '#6b7280' }}>
        <span>
          <strong>Periodo:</strong> {formatarData(escala.data_inicio)} a {formatarData(escala.data_fim)}
        </span>
        {escala.pontuacao != null && (
          <span>
            <strong>Pontuacao:</strong> {escala.pontuacao}
          </span>
        )}
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <strong>Status:</strong>
          <span
            style={{
              ...statusStyle,
              fontSize: 10,
              padding: '0 6px',
              borderRadius: 4,
              fontWeight: 600,
            }}
          >
            {escala.status}
          </span>
        </span>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// ExportFooter — inline sub-component
// ---------------------------------------------------------------------------

function ExportFooter({
  mode,
  timelineMode,
  mostrarTimeline,
  mostrarCiclo,
}: {
  mode: 'setor' | 'funcionario'
  timelineMode: 'barras' | 'grid'
  mostrarTimeline: boolean
  mostrarCiclo: boolean
}) {
  const legendaParts: string[] = []
  if (mode === 'funcionario') {
    legendaParts.push('FF = Folga Fixa', 'FV = Folga Variavel', 'DF = Dom folga ciclo')
  } else if (mostrarTimeline && timelineMode === 'barras') {
    legendaParts.push(
      'F = Folga', 'I = Indisponivel', 'ALM = Almoco',
      'Pausa = intervalo 15min (CLT Art. 71)', 'Posto = posicao no fluxo',
    )
  } else if (mostrarCiclo) {
    legendaParts.push('T = Trabalho', 'F = Folga fixa', 'V = Folga variavel', 'I = Indisponivel')
  }

  return (
    <div
      style={{
        marginTop: 20,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderTop: '1px solid #e5e7eb',
        paddingTop: 12,
        fontSize: 10,
        color: '#9ca3af',
      }}
    >
      <div>
        {legendaParts.length > 0 && (
          <>
            <strong>Legenda:</strong> {legendaParts.join(' | ')}
          </>
        )}
      </div>
      <div>
        Gerada em {new Date().toLocaleDateString('pt-BR')} | <strong>EscalaFlow</strong>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// ExportSemanal — inline weekly table (setor mode)
// ---------------------------------------------------------------------------

const SEMANAL_TH: React.CSSProperties = {
  background: '#f1f5f9',
  border: '1px solid #e2e8f0',
  padding: '3px 4px',
  fontWeight: 600,
  fontSize: 9,
  color: '#334155',
  textAlign: 'center',
}

const SEMANAL_TD: React.CSSProperties = {
  border: '1px solid #e2e8f0',
  padding: '3px 4px',
  fontSize: 9,
  color: '#334155',
  textAlign: 'center',
  verticalAlign: 'top',
}

function ExportSemanal({
  alocacoes,
  colaboradores,
  escala,
  regrasMap,
}: {
  alocacoes: Alocacao[]
  colaboradores: Colaborador[]
  escala: Escala
  regrasMap: Map<number, RegraHorarioColaborador>
}) {
  // Build full date range from escala period
  const allDates: string[] = []
  const d = new Date(escala.data_inicio + 'T00:00:00')
  const end = new Date(escala.data_fim + 'T00:00:00')
  while (d <= end) {
    allDates.push(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
    )
    d.setDate(d.getDate() + 1)
  }

  const weeks = agruparPorSemanaISO(allDates)

  // Index alocacoes by "colabId-data"
  const alocMap = new Map<string, Alocacao>()
  for (const a of alocacoes) {
    const key = `${a.colaborador_id}-${a.data}`
    if (!alocMap.has(key)) alocMap.set(key, a)
  }

  const sorted = [...colaboradores].sort((a, b) => a.rank - b.rank)

  return (
    <div>
      {weeks.map((week) => {
        // Build header with day labels + dd/mm
        const dayHeaders = week.dates.map((dt) => {
          const dow = new Date(dt + 'T00:00:00').getDay()
          const label = DAY_LABELS[dow]
          const [, m, dd] = dt.split('-')
          return { label, date: `${dd}/${m}`, iso: dt, dow }
        })

        // Sum total hours per collaborator for this week
        return (
          <div key={week.weekNumber} style={{ breakInside: 'avoid', pageBreakInside: 'avoid', marginBottom: 12 }}>
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: '#334155',
                padding: '6px 0 4px',
                borderBottom: '1px solid #e2e8f0',
                marginBottom: 0,
              }}
            >
              {formatWeekLabel(week.startDate, week.endDate)}
            </div>
            <table
              style={{
                width: '100%',
                borderCollapse: 'collapse',
                tableLayout: 'fixed',
                marginBottom: 2,
              }}
            >
              <thead>
                <tr>
                  <th style={{ ...SEMANAL_TH, textAlign: 'left', width: 110 }}>Colaborador</th>
                  {dayHeaders.map((dh) => (
                    <th key={dh.iso} style={{ ...SEMANAL_TH, ...(dh.dow === 0 ? { background: '#eef2ff' } : {}) }}>
                      {dh.label}
                      <br />
                      <span style={{ fontWeight: 400, fontSize: 8 }}>{dh.date}</span>
                    </th>
                  ))}
                  <th style={{ ...SEMANAL_TH, width: 40 }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((colab) => {
                  const regra = regrasMap.get(colab.id)
                  let weekMinutes = 0

                  const cells = dayHeaders.map((dh) => {
                    const alloc = alocMap.get(`${colab.id}-${dh.iso}`)

                    if (alloc?.status === 'TRABALHO' && alloc.hora_inicio && alloc.hora_fim) {
                      const mins = alloc.minutos_trabalho ?? alloc.minutos ?? 0
                      weekMinutes += mins
                      return (
                        <td
                          key={dh.iso}
                          style={{
                            ...SEMANAL_TD,
                            background: dh.dow === 0 ? '#eef2ff' : '#f0fdf4',
                          }}
                        >
                          <strong style={{ fontSize: 9 }}>{fmtTime(alloc.hora_inicio)}</strong>
                          <br />
                          <span style={{ fontSize: 8, color: '#6b7280' }}>{fmtTime(alloc.hora_fim)}</span>
                        </td>
                      )
                    }

                    if (alloc?.status === 'INDISPONIVEL') {
                      return (
                        <td
                          key={dh.iso}
                          style={{
                            ...SEMANAL_TD,
                            background: '#fef2f2',
                            color: '#dc2626',
                            fontStyle: 'italic',
                          }}
                        >
                          I
                        </td>
                      )
                    }

                    // FOLGA or missing
                    const folga = tipoFolga(dh.iso, regra, alocacoes, colab.id)
                    const folgaLabel = folga === 'FF' ? 'FF' : folga === 'FV' ? 'FV' : folga === 'DF' ? 'DF' : 'F'
                    return (
                      <td
                        key={dh.iso}
                        style={{
                          ...SEMANAL_TD,
                          background: dh.dow === 0 ? '#eef2ff' : '#f8fafc',
                          color: '#94a3b8',
                        }}
                      >
                        {folgaLabel}
                      </td>
                    )
                  })

                  return (
                    <tr key={colab.id}>
                      <td style={{ ...SEMANAL_TD, textAlign: 'left', fontWeight: 600 }}>
                        {colab.nome}
                      </td>
                      {cells}
                      <td style={{ ...SEMANAL_TD, fontWeight: 600, background: '#f8fafc' }}>
                        {formatarMinutos(weekMinutes)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component — STATELESS (renderToStaticMarkup compliant, R1)
// No useState, useEffect, useRef, useMemo, or any hooks.
// ---------------------------------------------------------------------------

export function ExportarEscala({
  escala,
  alocacoes,
  colaboradores,
  setor,
  violacoes = [],
  avisos = [],
  tiposContrato = [],
  funcoes = [],
  horariosSemana = [],
  regrasPadrao = [],
  // New props
  mostrarCiclo: mostrarCicloProp,
  mostrarSemanal: mostrarSemanalProp,
  mostrarTimeline: mostrarTimelineProp,
  timelineMode = 'barras',
  mostrarAvisos: mostrarAvisosProp,
  mode = 'setor',
  colaboradorId,
  tipoContrato,
  // Legacy props (backward compat)
  modo,
  incluirAvisos,
  incluirCiclo,
  incluirTimeline,
}: ExportarEscalaProps) {
  // ── Resolve props: new props take precedence, legacy as fallback ──────
  const modoDetalhado = modo === 'detalhado'

  const efMostrarCiclo = mostrarCicloProp ?? incluirCiclo ?? true
  const efMostrarSemanal = mostrarSemanalProp ?? true
  const efMostrarTimeline = mostrarTimelineProp ?? incluirTimeline ?? modoDetalhado
  const efMostrarAvisos = mostrarAvisosProp ?? incluirAvisos ?? efMostrarTimeline

  // ── Derived data (pure computation, no hooks) ─────────────────────────
  const cicloGridData = escalaParaCicloGrid(
    escala,
    alocacoes,
    colaboradores,
    funcoes,
    regrasPadrao,
    [],
  )

  const regrasMap = buildRegrasMap(regrasPadrao)
  const allDates = getAllDates(alocacoes)

  // For funcionario mode: resolve colaborador and tipo_contrato
  const colaboradorObj = mode === 'funcionario' && colaboradorId
    ? colaboradores.find((c) => c.id === colaboradorId)
    : undefined

  const tipoContratoObj = tipoContrato
    ?? (colaboradorObj
      ? tiposContrato.find((tc) => tc.id === colaboradorObj.tipo_contrato_id)
      : undefined)

  const colabAlocacoes = mode === 'funcionario' && colaboradorId
    ? alocacoes.filter((a) => a.colaborador_id === colaboradorId)
    : []

  const colabViolacoes = mode === 'funcionario' && colaboradorId
    ? violacoes.filter((v) => v.colaborador_id === colaboradorId)
    : []

  const colabAvisos = mode === 'funcionario' && colaboradorId
    ? avisos.filter((a) => {
        // Avisos are setor-level, include all for the colaborador's context
        return true
      })
    : []

  const colabRegra = mode === 'funcionario' && colaboradorId
    ? regrasMap.get(colaboradorId)
    : undefined

  return (
    <div
      style={{
        background: 'white',
        padding: 20,
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        fontSize: 11,
        color: '#111827',
        lineHeight: 1.4,
      }}
    >
      {/* ── Header (setor mode only) ──────────────────────────────────── */}
      {mode !== 'funcionario' && <ExportHeader escala={escala} setor={setor} />}

      {/* ── Ciclo Rotativo (setor mode only) ──────────────────────────── */}
      {efMostrarCiclo && mode !== 'funcionario' && (
        <section style={{ breakBefore: 'auto' }}>
          <h2
            style={{
              fontSize: 13,
              fontWeight: 700,
              color: '#111',
              marginBottom: 8,
              borderBottom: '1px solid #e5e7eb',
              paddingBottom: 4,
            }}
          >
            Ciclo Rotativo
          </h2>
          <CicloGrid data={cicloGridData} mode="view" variant="export" />
        </section>
      )}

      {/* ── Semanal (setor mode only) ─────────────────────────────────── */}
      {efMostrarSemanal && mode !== 'funcionario' && (
        <section style={{ breakBefore: 'page' }}>
          <h2
            style={{
              fontSize: 13,
              fontWeight: 700,
              color: '#111',
              marginBottom: 8,
              marginTop: 16,
              borderBottom: '1px solid #e5e7eb',
              paddingBottom: 4,
            }}
          >
            Escala Semanal
          </h2>
          <ExportSemanal
            alocacoes={alocacoes}
            colaboradores={colaboradores}
            escala={escala}
            regrasMap={regrasMap}
          />
        </section>
      )}

      {/* ── Timeline (setor mode only) ────────────────────────────────── */}
      {efMostrarTimeline && mode !== 'funcionario' && (
        <section style={{ breakBefore: 'page' }}>
          <h2
            style={{
              fontSize: 13,
              fontWeight: 700,
              color: '#111',
              marginBottom: 8,
              marginTop: 16,
              borderBottom: '1px solid #e5e7eb',
              paddingBottom: 4,
            }}
          >
            Timeline Diaria {timelineMode === 'barras' ? '(Gantt)' : '(Grid 15min)'}
          </h2>
          {timelineMode === 'barras' ? (
            <ExportTimelineBarras
              alocacoes={alocacoes}
              colaboradores={colaboradores}
              setor={setor}
              funcoes={funcoes}
              datas={allDates}
              regrasMap={regrasMap}
            />
          ) : (
            <EscalaTimelineDiaria
              escala={escala}
              alocacoes={alocacoes}
              colaboradores={colaboradores}
              setor={setor}
              tiposContrato={tiposContrato}
              funcoes={funcoes}
              horariosSemana={horariosSemana}
            />
          )}
        </section>
      )}

      {/* ── Funcionario mode — renders the folha ──────────────────────── */}
      {mode === 'funcionario' && colaboradorObj && tipoContratoObj && (
        <ExportFolhaFuncionario
          colaborador={colaboradorObj}
          setor={setor}
          escala={escala}
          alocacoes={colabAlocacoes}
          violacoes={colabViolacoes}
          avisos={colabAvisos}
          tipoContrato={tipoContratoObj}
          regra={colabRegra}
          mostrarAvisos={efMostrarAvisos}
        />
      )}

      {/* ── Avisos (setor mode — funcionario mode handled inside ExportFolhaFuncionario) ── */}
      {efMostrarAvisos && mode !== 'funcionario' && (
        <ExportAvisos
          violacoes={violacoes}
          avisos={avisos}
        />
      )}

      {/* ── Footer ────────────────────────────────────────────────────── */}
      {mode !== 'funcionario' && (
        <ExportFooter
          mode={mode}
          timelineMode={timelineMode}
          mostrarTimeline={efMostrarTimeline}
          mostrarCiclo={efMostrarCiclo}
        />
      )}

      {/* ── Dynamic @page CSS ─────────────────────────────────────────── */}
      <style
        dangerouslySetInnerHTML={{
          __html: `
@media print {
  @page { size: A4 ${mode === 'funcionario' ? 'portrait' : 'landscape'}; margin: 10mm; }
  body { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
}
          `.trim(),
        }}
      />
    </div>
  )
}
