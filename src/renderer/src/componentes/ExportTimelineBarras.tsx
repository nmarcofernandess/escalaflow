import type {
  Alocacao,
  Colaborador,
  Setor,
  Funcao,
  RegraHorarioColaborador,
} from '@shared/index'
import { toMinutes, formatarMinutos, formatarData } from '@/lib/formatadores'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ExportTimelineBarrasProps {
  alocacoes: Alocacao[]
  colaboradores: Colaborador[]
  setor: Setor
  funcoes?: Funcao[]
  datas: string[]
  regrasMap?: Map<number, RegraHorarioColaborador>
}

// ---------------------------------------------------------------------------
// Helpers (pure functions — no hooks)
// ---------------------------------------------------------------------------

const DIAS_SEMANA_NOME = ['Domingo', 'Segunda', 'Terca', 'Quarta', 'Quinta', 'Sexta', 'Sabado']
const DIAS_LABEL = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB'] as const

/** Convert HH:MM time to a 0-100% position between open and close */
function timeToPercent(time: string, open: string, close: string): number {
  const toMin = (t: string): number => {
    const [h, m] = t.split(':').map(Number)
    return h * 60 + m
  }
  const total = toMin(close) - toMin(open)
  if (total <= 0) return 0
  const pos = toMin(time) - toMin(open)
  return Math.max(0, Math.min(100, (pos / total) * 100))
}

/** Find the Sunday date (YYYY-MM-DD) of the same ISO week that contains `dateStr` */
function encontrarDomingoDaSemana(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  const diff = d.getDay() // 0=DOM
  d.setDate(d.getDate() - diff)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Derive folga type from regra + context */
function tipoFolga(
  data: string,
  regra: RegraHorarioColaborador | undefined,
  allAlocacoes: Alocacao[],
): 'FF' | 'FV' | 'DF' | 'F' {
  const dow = new Date(data + 'T00:00:00').getDay()
  const dayLabel = DIAS_LABEL[dow]
  if (regra?.folga_fixa_dia_semana === dayLabel) return 'FF'
  if (regra?.folga_variavel_dia_semana === dayLabel) {
    // FV only active if the collaborator worked on Sunday of the same week
    const domDate = encontrarDomingoDaSemana(data)
    const domAloc = allAlocacoes.find(
      (a) => a.data === domDate && a.colaborador_id === (regra?.colaborador_id),
    )
    if (domAloc?.status === 'TRABALHO') return 'FV'
  }
  if (dow === 0) return 'DF'
  return 'F'
}

const FOLGA_LABELS: Record<string, string> = {
  FF: 'Folga Fixa',
  FV: 'Folga Variavel',
  DF: 'Folga (dom ciclo)',
  F: 'Folga',
}

/** Build a funcaoId -> apelido map */
function buildFuncaoMap(funcoes: Funcao[]): Map<number, string> {
  const m = new Map<number, string>()
  for (const f of funcoes) m.set(f.id, f.apelido)
  return m
}

// ---------------------------------------------------------------------------
// Design tokens (forced-light for print/export context)
// ---------------------------------------------------------------------------

const COLORS = {
  primary: '#6366f1',
  primaryBg: '#eef2ff',
  warning: '#d97706',
  warningBg: '#fffbeb',
  danger: '#dc2626',
  dangerBg: '#fef2f2',
  muted: '#94a3b8',
  headerBg: '#f1f5f9',
  border: '#e2e8f0',
  fg: '#111',
  fgSecondary: '#334155',
  bg: '#fafafa',
} as const

// ---------------------------------------------------------------------------
// Sub-components (all pure render functions)
// ---------------------------------------------------------------------------

function HourAxis({ setor }: { setor: Setor }) {
  // Generate proportional hour markers from opening to closing
  const openMin = toMinutes(setor.hora_abertura)
  const closeMin = toMinutes(setor.hora_fechamento)
  const markers: string[] = []

  // Start from the first full hour at or after opening
  let currentMin = Math.ceil(openMin / 60) * 60
  while (currentMin <= closeMin) {
    const h = Math.floor(currentMin / 60)
    const m = currentMin % 60
    markers.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`)
    currentMin += 120 // every 2 hours
  }
  // Always include the closing time marker if not already there
  const closeStr = setor.hora_fechamento
  if (!markers.includes(closeStr)) {
    markers.push(closeStr)
  }

  return (
    <div
      style={{
        display: 'flex',
        marginLeft: 120,
        marginRight: 40,
        marginBottom: 2,
        position: 'relative',
        height: 10,
      }}
    >
      {markers.map((h) => (
        <span
          key={h}
          style={{
            position: 'absolute',
            left: `${timeToPercent(h, setor.hora_abertura, setor.hora_fechamento)}%`,
            fontSize: 7,
            color: COLORS.muted,
            transform: 'translateX(-50%)',
            whiteSpace: 'nowrap',
          }}
        >
          {h}
        </span>
      ))}
    </div>
  )
}

function WorkRow({
  colab,
  alloc,
  setor,
  posto,
}: {
  colab: Colaborador
  alloc: Alocacao
  setor: Setor
  posto: string | null
}) {
  const workStart = alloc.hora_inicio!
  const workEnd = alloc.hora_fim!
  const hasLunch =
    alloc.hora_almoco_inicio && alloc.hora_almoco_fim && alloc.hora_almoco_inicio !== alloc.hora_almoco_fim
  const totalMin = alloc.minutos_trabalho ?? alloc.minutos ?? 0

  const s1 = timeToPercent(workStart, setor.hora_abertura, setor.hora_fechamento)

  if (hasLunch) {
    const s2 = timeToPercent(alloc.hora_almoco_inicio!, setor.hora_abertura, setor.hora_fechamento)
    const s3 = timeToPercent(alloc.hora_almoco_fim!, setor.hora_abertura, setor.hora_fechamento)
    const s4 = timeToPercent(workEnd, setor.hora_abertura, setor.hora_fechamento)

    return (
      <div style={{ display: 'flex', alignItems: 'center', height: 26, marginBottom: 2 }}>
        <div style={{ width: 120, fontSize: 10, color: COLORS.fgSecondary, lineHeight: '1.1' }}>
          <strong style={{ display: 'block' }}>{colab.nome}</strong>
          {posto && <small style={{ color: COLORS.muted, fontSize: 8 }}>{posto}</small>}
        </div>
        <div
          style={{
            flex: 1,
            position: 'relative',
            height: 18,
            background: COLORS.headerBg,
            borderRadius: 3,
            marginRight: 40,
          }}
        >
          {/* Pre-lunch segment */}
          <div
            style={{
              position: 'absolute',
              left: `${s1}%`,
              width: `${s2 - s1}%`,
              height: '100%',
              background: COLORS.primary,
              borderRadius: '3px 0 0 3px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <span style={{ fontSize: 8, color: 'white', fontWeight: 600 }}>
              {workStart}–{alloc.hora_almoco_inicio}
            </span>
          </div>
          {/* Lunch gap (hatched) */}
          <div
            style={{
              position: 'absolute',
              left: `${s2}%`,
              width: `${s3 - s2}%`,
              height: '100%',
              background: `repeating-linear-gradient(45deg, transparent, transparent 2px, rgba(217,119,6,0.2) 2px, rgba(217,119,6,0.2) 4px)`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <span style={{ fontSize: 7, color: COLORS.warning }}>ALM</span>
          </div>
          {/* Post-lunch segment */}
          <div
            style={{
              position: 'absolute',
              left: `${s3}%`,
              width: `${s4 - s3}%`,
              height: '100%',
              background: COLORS.primary,
              borderRadius: '0 3px 3px 0',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <span style={{ fontSize: 8, color: 'white', fontWeight: 600 }}>
              {alloc.hora_almoco_fim}–{workEnd}
            </span>
          </div>
        </div>
        <div style={{ width: 40, textAlign: 'right', fontSize: 9, color: '#64748b', fontWeight: 600 }}>
          {formatarMinutos(totalMin)}
        </div>
      </div>
    )
  }

  // No lunch — single bar
  const s4 = timeToPercent(workEnd, setor.hora_abertura, setor.hora_fechamento)

  return (
    <div style={{ display: 'flex', alignItems: 'center', height: 26, marginBottom: 2 }}>
      <div style={{ width: 120, fontSize: 10, color: COLORS.fgSecondary, lineHeight: '1.1' }}>
        <strong style={{ display: 'block' }}>{colab.nome}</strong>
        {posto && <small style={{ color: COLORS.muted, fontSize: 8 }}>{posto}</small>}
      </div>
      <div
        style={{
          flex: 1,
          position: 'relative',
          height: 18,
          background: COLORS.headerBg,
          borderRadius: 3,
          marginRight: 40,
        }}
      >
        <div
          style={{
            position: 'absolute',
            left: `${s1}%`,
            width: `${s4 - s1}%`,
            height: '100%',
            background: COLORS.primary,
            borderRadius: 3,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <span style={{ fontSize: 8, color: 'white', fontWeight: 600 }}>
            {workStart}–{workEnd}
          </span>
        </div>
      </div>
      <div style={{ width: 40, textAlign: 'right', fontSize: 9, color: '#64748b', fontWeight: 600 }}>
        {formatarMinutos(totalMin)}
      </div>
    </div>
  )
}

function FolgaRow({
  colab,
  folgaType,
  posto,
}: {
  colab: Colaborador
  folgaType: string
  posto: string | null
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', height: 26, marginBottom: 2 }}>
      <div style={{ width: 120, fontSize: 10, color: COLORS.muted, lineHeight: '1.1' }}>
        {colab.nome}
        {posto && (
          <>
            <br />
            <small style={{ fontSize: 8 }}>{posto}</small>
          </>
        )}
      </div>
      <div
        style={{
          flex: 1,
          position: 'relative',
          height: 18,
          background: COLORS.headerBg,
          borderRadius: 3,
          marginRight: 40,
        }}
      >
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 9,
            color: COLORS.muted,
            fontStyle: 'italic',
          }}
        >
          {FOLGA_LABELS[folgaType] ?? 'Folga'}
        </div>
      </div>
      <div style={{ width: 40, textAlign: 'right', fontSize: 9, color: '#ccc' }}>—</div>
    </div>
  )
}

function IndisponivelRow({
  colab,
  posto,
}: {
  colab: Colaborador
  posto: string | null
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', height: 26, marginBottom: 2 }}>
      <div style={{ width: 120, fontSize: 10, color: COLORS.muted, lineHeight: '1.1' }}>
        {colab.nome}
        {posto && (
          <>
            <br />
            <small style={{ fontSize: 8 }}>{posto}</small>
          </>
        )}
      </div>
      <div
        style={{
          flex: 1,
          position: 'relative',
          height: 18,
          background: `repeating-linear-gradient(45deg, ${COLORS.dangerBg}, ${COLORS.dangerBg} 3px, ${COLORS.bg} 3px, ${COLORS.bg} 6px)`,
          border: `1px dashed #fca5a5`,
          borderRadius: 3,
          marginRight: 40,
        }}
      >
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 9,
            color: COLORS.danger,
          }}
        >
          Indisponivel
        </div>
      </div>
      <div style={{ width: 40, textAlign: 'right', fontSize: 9, color: '#ccc' }}>—</div>
    </div>
  )
}

function CoverageBar({
  alocacoes,
  colaboradores,
  setor,
  data,
}: {
  alocacoes: Alocacao[]
  colaboradores: Colaborador[]
  setor: Setor
  data: string
}) {
  const openMin = toMinutes(setor.hora_abertura)
  const closeMin = toMinutes(setor.hora_fechamento)
  const totalRange = closeMin - openMin
  if (totalRange <= 0) return null

  // Build per-collaborator work intervals for this date
  type Interval = { startMin: number; endMin: number; lunchStartMin: number; lunchEndMin: number }
  const intervals: Interval[] = []

  for (const colab of colaboradores) {
    const alloc = alocacoes.find(
      (a) => a.colaborador_id === colab.id && a.data === data && a.status === 'TRABALHO' && a.hora_inicio && a.hora_fim,
    )
    if (!alloc) continue
    const s = toMinutes(alloc.hora_inicio!)
    const e = toMinutes(alloc.hora_fim!)
    const ls = alloc.hora_almoco_inicio ? toMinutes(alloc.hora_almoco_inicio) : 0
    const le = alloc.hora_almoco_fim ? toMinutes(alloc.hora_almoco_fim) : 0
    intervals.push({ startMin: s, endMin: e, lunchStartMin: ls, lunchEndMin: le })
  }

  if (intervals.length === 0) return null

  // Sample at every 30min to build segments of equal coverage
  const SAMPLE_STEP = 30
  const samples: { min: number; count: number }[] = []
  for (let t = openMin; t < closeMin; t += SAMPLE_STEP) {
    let count = 0
    for (const iv of intervals) {
      if (t >= iv.startMin && t < iv.endMin) {
        // Check not in lunch
        if (iv.lunchStartMin > 0 && iv.lunchEndMin > 0 && t >= iv.lunchStartMin && t < iv.lunchEndMin) {
          continue
        }
        count++
      }
    }
    samples.push({ min: t, count })
  }

  // Merge consecutive samples with same count into segments
  type Segment = { startPct: number; widthPct: number; count: number }
  const segments: Segment[] = []
  let segStart = 0
  let segCount = samples[0]?.count ?? 0

  for (let i = 1; i <= samples.length; i++) {
    const curr = i < samples.length ? samples[i].count : -1
    if (curr !== segCount) {
      // Emit segment
      if (segCount > 0) {
        const startPct = ((samples[segStart].min - openMin) / totalRange) * 100
        const endMin = i < samples.length ? samples[i].min : closeMin
        const widthPct = ((endMin - samples[segStart].min) / totalRange) * 100
        segments.push({ startPct, widthPct, count: segCount })
      }
      segStart = i
      segCount = curr
    }
  }

  const maxCount = Math.max(...segments.map((s) => s.count), 0)

  return (
    <>
      {/* Separator */}
      <div
        style={{
          borderTop: `1px solid ${COLORS.border}`,
          margin: '4px 0',
          marginLeft: 120,
          marginRight: 40,
        }}
      />
      {/* Coverage row */}
      <div style={{ display: 'flex', alignItems: 'center', height: 14 }}>
        <div style={{ width: 120, fontSize: 8, color: '#64748b', fontWeight: 600 }}>Cobertura</div>
        <div
          style={{
            flex: 1,
            height: 12,
            background: COLORS.headerBg,
            borderRadius: 2,
            position: 'relative',
            overflow: 'hidden',
            marginRight: 40,
          }}
        >
          {segments.map((seg, i) => {
            const opacity = seg.count === 1 ? 0.25 : seg.count === 2 ? 0.5 : 0.7
            return (
              <div
                key={i}
                style={{
                  position: 'absolute',
                  left: `${seg.startPct}%`,
                  width: `${seg.widthPct}%`,
                  height: '100%',
                  background: `rgba(99,102,241,${opacity})`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 7,
                  color: 'white',
                  fontWeight: 600,
                }}
              >
                {seg.count}
              </div>
            )
          })}
        </div>
        <div style={{ width: 40, textAlign: 'right', fontSize: 8, color: COLORS.muted }}>
          max {maxCount}
        </div>
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// Main component (STATELESS — no hooks, no state, no refs)
// ---------------------------------------------------------------------------

export function ExportTimelineBarras({
  alocacoes,
  colaboradores,
  setor,
  funcoes = [],
  datas,
  regrasMap,
}: ExportTimelineBarrasProps) {
  const funcaoMap = buildFuncaoMap(funcoes)

  // Sort collaborators by rank
  const sorted = [...colaboradores].sort((a, b) => a.rank - b.rank)

  // Pre-index alocacoes by "colabId-data" for fast lookup
  const alocMap = new Map<string, Alocacao>()
  for (const a of alocacoes) {
    // Keep only first (highest priority) allocation per collaborator per day
    const key = `${a.colaborador_id}-${a.data}`
    if (!alocMap.has(key)) alocMap.set(key, a)
  }

  return (
    <div>
      {datas.map((data) => {
        const dateObj = new Date(data + 'T00:00:00')
        const dow = dateObj.getDay()
        const dayName = DIAS_SEMANA_NOME[dow]
        const dayAlocs = alocacoes.filter((a) => a.data === data)

        return (
          <div
            key={data}
            style={{
              breakInside: 'avoid',
              pageBreakInside: 'avoid',
              marginBottom: 12,
            }}
          >
            {/* Section title */}
            <div
              style={{
                fontSize: 12,
                fontWeight: 700,
                color: COLORS.fg,
                margin: '18px 0 6px',
                borderBottom: `1px solid ${COLORS.border}`,
                paddingBottom: 4,
              }}
            >
              {dayName} {formatarData(data)}
            </div>

            {/* Hour axis */}
            <HourAxis setor={setor} />

            {/* Collaborator rows */}
            {sorted.map((colab) => {
              const alloc = alocMap.get(`${colab.id}-${data}`)
              const funcaoId = alloc?.funcao_id ?? colab.funcao_id
              const posto = funcaoId != null ? (funcaoMap.get(funcaoId) ?? null) : null

              if (!alloc || alloc.status === 'FOLGA') {
                const regra = regrasMap?.get(colab.id)
                const ft = tipoFolga(data, regra, dayAlocs)
                return <FolgaRow key={colab.id} colab={colab} folgaType={ft} posto={posto} />
              }

              if (alloc.status === 'INDISPONIVEL') {
                return <IndisponivelRow key={colab.id} colab={colab} posto={posto} />
              }

              if (alloc.status === 'TRABALHO' && alloc.hora_inicio && alloc.hora_fim) {
                return (
                  <WorkRow
                    key={colab.id}
                    colab={colab}
                    alloc={alloc}
                    setor={setor}
                    posto={posto}
                  />
                )
              }

              // Fallback (no data or unexpected status)
              return <FolgaRow key={colab.id} colab={colab} folgaType="F" posto={posto} />
            })}

            {/* Coverage bar */}
            <CoverageBar
              alocacoes={dayAlocs}
              colaboradores={sorted}
              setor={setor}
              data={data}
            />
          </div>
        )
      })}
    </div>
  )
}
