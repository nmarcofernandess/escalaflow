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

const TIPO_STYLES = {
  h: 'border border-red-200 bg-red-50 text-red-800',
  s: 'border border-amber-200 bg-amber-50 text-amber-800',
  i: 'border border-blue-200 bg-blue-50 text-blue-800',
} as const

const TIPO_LABELS: Record<UnifiedAviso['tipo'], string> = {
  h: 'Criticas (HARD)',
  s: 'Alertas (SOFT)',
  i: 'Informativos',
}

const LABEL_STYLES = {
  h: 'text-red-600',
  s: 'text-amber-800',
  i: 'text-blue-700',
} as const

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
    <div style={{ breakInside: 'avoid' }} className="mt-6">
      <h2 className="mb-2.5 border-b border-gray-200 pb-1.5 text-sm font-semibold text-gray-900">
        Avisos ({unified.length})
      </h2>
      {groups.map((group) => (
        <div key={group.tipo} className="mb-3">
          <h3 className={`mb-1.5 text-xs font-semibold ${LABEL_STYLES[group.tipo]}`}>
            {TIPO_LABELS[group.tipo]}
          </h3>
          {group.items.map((a, i) => (
            <div
              key={i}
              className={`mb-1 rounded px-2.5 py-1.5 text-[10px] ${TIPO_STYLES[a.tipo]}`}
            >
              {a.texto}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
