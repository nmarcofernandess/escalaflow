import type { Violacao } from '@shared/index'
import type { Aviso } from '@/componentes/AvisosSection'
import { formatarData } from '@/lib/formatadores'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface UnifiedAviso {
  /** h = HARD/error, s = SOFT/warning, i = info */
  tipo: 'h' | 's' | 'i'
  texto: string
  colaborador_id: number | null
}

interface ExportAvisosProps {
  violacoes?: Violacao[]
  avisos?: Aviso[]
  /** Mode B (Funcionario): quando definido, so mostra avisos deste colaborador (ou avisos gerais do setor) */
  filtrarColaboradorId?: number
}

// ---------------------------------------------------------------------------
// Merge + deduplication logic
// ---------------------------------------------------------------------------

function mergeAvisos(violacoes: Violacao[], avisos: Aviso[]): UnifiedAviso[] {
  const merged: UnifiedAviso[] = []

  // 1. Violacoes do solver -> mapear severidade
  for (const v of violacoes) {
    merged.push({
      tipo: v.severidade === 'HARD' ? 'h' : 's',
      texto: `${v.colaborador_nome} — ${v.mensagem || v.regra}${v.data ? ` (${formatarData(v.data)})` : ''}`,
      colaborador_id: v.colaborador_id,
    })
  }

  // 2. Avisos operacionais -> mapear nivel
  for (const a of avisos) {
    merged.push({
      tipo: a.nivel === 'error' ? 'h' : a.nivel === 'warning' ? 's' : 'i',
      texto: a.titulo + (a.descricao ? ': ' + a.descricao : ''),
      colaborador_id: null, // avisos operacionais sao do setor, nao de colaborador especifico
    })
  }

  // 3. Deduplicar por texto (pode haver overlap solver <-> operacional)
  const seen = new Set<string>()
  const deduped = merged.filter((a) => {
    if (seen.has(a.texto)) return false
    seen.add(a.texto)
    return true
  })

  // 4. Ordenar: error -> warning -> info
  const order = { h: 0, s: 1, i: 2 }
  deduped.sort((a, b) => order[a.tipo] - order[b.tipo])

  return deduped
}

// ---------------------------------------------------------------------------
// Styles — hardcoded light-mode for print / renderToStaticMarkup
// ---------------------------------------------------------------------------

const TIPO_STYLES: Record<'h' | 's' | 'i', React.CSSProperties> = {
  h: { border: '1px solid #fecaca', background: '#fef2f2', color: '#991b1b' },
  s: { border: '1px solid #fde68a', background: '#fffbeb', color: '#78350f' },
  i: { border: '1px solid #bfdbfe', background: '#eff6ff', color: '#1e40af' },
}

const TIPO_LABELS: Record<UnifiedAviso['tipo'], string> = {
  h: 'Problemas Críticos',
  s: 'Alertas',
  i: 'Informativos',
}

const LABEL_STYLES: Record<'h' | 's' | 'i', React.CSSProperties> = {
  h: { color: '#dc2626' },
  s: { color: '#92400e' },
  i: { color: '#1d4ed8' },
}

// ---------------------------------------------------------------------------
// Component — STATELESS (renderToStaticMarkup compliant, R1)
// ---------------------------------------------------------------------------

export function ExportAvisos({
  violacoes = [],
  avisos = [],
  filtrarColaboradorId,
}: ExportAvisosProps) {
  let unified = mergeAvisos(violacoes, avisos)

  // Mode B: filtrar so avisos deste colaborador (ou avisos gerais do setor com colaborador_id=null)
  if (filtrarColaboradorId != null) {
    unified = unified.filter(
      (a) => a.colaborador_id === filtrarColaboradorId || a.colaborador_id == null,
    )
  }

  if (unified.length === 0) return null

  // Agrupar por tipo para renderizar com headers
  const groups = (['h', 's', 'i'] as const)
    .map((tipo) => ({
      tipo,
      items: unified.filter((a) => a.tipo === tipo),
    }))
    .filter((g) => g.items.length > 0)

  return (
    <div style={{ breakInside: 'avoid', marginTop: 24 }}>
      <h2
        style={{
          marginBottom: 10,
          borderBottom: '1px solid #e5e7eb',
          paddingBottom: 6,
          fontSize: 14,
          fontWeight: 600,
          color: '#111827',
        }}
      >
        Avisos ({unified.length})
      </h2>
      {groups.map((group) => (
        <div key={group.tipo} style={{ marginBottom: 12 }}>
          <h3
            style={{
              marginBottom: 6,
              fontSize: 12,
              fontWeight: 600,
              ...LABEL_STYLES[group.tipo],
            }}
          >
            {TIPO_LABELS[group.tipo]}
          </h3>
          {group.items.map((a, i) => (
            <div
              key={i}
              style={{
                marginBottom: 4,
                borderRadius: 4,
                padding: '6px 10px',
                fontSize: 10,
                ...TIPO_STYLES[a.tipo],
              }}
            >
              {a.texto}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
