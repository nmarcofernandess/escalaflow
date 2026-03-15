import type {
  Alocacao,
  Colaborador,
  Demanda,
  DiaSemana,
  Funcao,
  RegraHorarioColaborador,
} from '@shared/index'
import type { SimulaCicloOutput, SimulaCicloRow } from '@shared/simula-ciclo'
import type { CicloGridData, CicloGridRow, Simbolo } from './ciclo-grid-types'
import { DIAS_ORDEM, DIAS_GETDAY } from './ciclo-grid-types'

// ============================================================================
// Private helpers
// ============================================================================

type WeekMap = Record<DiaSemana, string | null>

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

// ============================================================================
// Function 1: escalaParaCicloGrid
// ============================================================================

export function escalaParaCicloGrid(
  escala: { data_inicio: string; data_fim: string },
  alocacoes: Alocacao[],
  colaboradores: Colaborador[],
  funcoes: Funcao[],
  regrasPadrao: RegraHorarioColaborador[],
  demandas: Demanda[],
  folgaBloqueadaIds?: number[],
): CicloGridData {
  // --- alocMap ---
  const alocMap = new Map<string, Alocacao>()
  for (const a of alocacoes) {
    alocMap.set(`${a.colaborador_id}-${a.data}`, a)
  }

  // --- regrasMap ---
  const regrasMap = new Map<number, RegraHorarioColaborador>()
  for (const regra of regrasPadrao) regrasMap.set(regra.colaborador_id, regra)

  // --- postosOrdenados ---
  const postosOrdenados = [...funcoes].sort(
    (a, b) => a.ordem - b.ordem || a.apelido.localeCompare(b.apelido),
  )

  // --- titularPorPosto ---
  const titularPorPosto = new Map<number, Colaborador>()
  for (const colab of colaboradores) {
    if (colab.funcao_id != null) titularPorPosto.set(colab.funcao_id, colab)
  }

  // --- rows (posto, titular, regra) ---
  const internalRows = postosOrdenados.map((posto) => {
    const titular = titularPorPosto.get(posto.id) ?? null
    return {
      posto,
      titular,
      regra: titular ? (regrasMap.get(titular.id) ?? null) : null,
    }
  })

  // --- folgaBloqueadaSet ---
  const folgaBloqueadaSet = new Set(folgaBloqueadaIds ?? [])

  // --- Group dates into weeks (SEG-DOM) ---
  const start = new Date(`${escala.data_inicio}T00:00:00`)
  const end = new Date(`${escala.data_fim}T00:00:00`)
  const dates: Date[] = []

  const cursor = new Date(start)
  while (cursor <= end) {
    dates.push(new Date(cursor))
    cursor.setDate(cursor.getDate() + 1)
  }

  const weeks: WeekMap[] = []
  let currentWeek = makeEmptyWeek()
  let countInWeek = 0

  for (const date of dates) {
    const dia = DIAS_GETDAY[date.getDay()]
    currentWeek[dia] = toIsoDate(date)
    countInWeek += 1

    if (countInWeek === 7) {
      weeks.push(currentWeek)
      currentWeek = makeEmptyWeek()
      countInWeek = 0
    }
  }

  if (countInWeek > 0) {
    weeks.push(currentWeek)
  }

  // --- periodoCiclo ---
  let periodoCiclo = 0
  if (weeks.length === 0) {
    periodoCiclo = 0
  } else {
    const totalPostos = internalRows.filter(
      (r) => r.titular != null && (r.titular.tipo_trabalhador ?? 'CLT') !== 'INTERMITENTE',
    ).length

    if (totalPostos <= 0) {
      periodoCiclo = weeks.length
    } else {
      const sundayWorkers = weeks
        .map((week) => {
          const sunday = week.DOM
          if (!sunday) return 0

          let worked = 0
          for (const row of internalRows) {
            if (!row.titular) continue
            const alloc = alocMap.get(`${row.titular.id}-${sunday}`)
            if (alloc?.status === 'TRABALHO') worked += 1
          }
          return worked
        })
        .filter((count) => count > 0)

      const domDemand = mode(sundayWorkers) ?? 1
      const base = Math.floor(totalPostos / gcd(totalPostos, domDemand))
      periodoCiclo = Math.max(1, Math.min(weeks.length, base))
    }
  }

  // --- Infer folgas (fixa/variavel) ---
  const cicloWeeks = weeks.slice(0, Math.max(1, periodoCiclo))
  const inferredFolgas = new Map<number, { fixa: DiaSemana | null; variavel: DiaSemana | null }>()

  for (const row of internalRows) {
    if (!row.titular) continue
    const colabId = row.titular.id
    const regra = regrasMap.get(colabId)

    // Case 1: both defined explicitly
    if (regra?.folga_fixa_dia_semana && regra?.folga_variavel_dia_semana) {
      inferredFolgas.set(colabId, {
        fixa: regra.folga_fixa_dia_semana,
        variavel: regra.folga_variavel_dia_semana,
      })
      continue
    }

    // Case 2: only fixa defined
    if (regra?.folga_fixa_dia_semana) {
      inferredFolgas.set(colabId, {
        fixa: regra.folga_fixa_dia_semana,
        variavel: null,
      })
      continue
    }

    // Case 3: infer from allocation pattern
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
      inferredFolgas.set(colabId, { fixa: null, variavel: null })
      continue
    }

    // Day with most folgas = fixa, second = variavel
    const sorted = [...folgaCount.entries()]
      .filter(([dia]) => dia !== 'DOM')
      .sort((a, b) => b[1] - a[1])
    const fixaDia = sorted[0]?.[0] ?? null
    const variavelDia = sorted.length > 1 ? sorted[1][0] : null

    inferredFolgas.set(colabId, { fixa: fixaDia, variavel: variavelDia })
  }

  // --- resolveSymbol ---
  function resolveSymbol(
    colab: Colaborador | null,
    dia: DiaSemana,
    dateStr: string | null,
  ): Simbolo {
    if (!colab) return '-'
    if (!dateStr) return '-'

    const alloc = alocMap.get(`${colab.id}-${dateStr}`)
    if (!alloc) return '.'

    if (alloc.status === 'TRABALHO') {
      return dia === 'DOM' ? 'DT' : 'T'
    }
    if (alloc.status === 'INDISPONIVEL') return 'I'

    // Folga — domingo: FF se folga_fixa=DOM, senao DF (ciclo)
    if (dia === 'DOM') {
      const inf = inferredFolgas.get(colab.id)
      return inf?.fixa === 'DOM' ? 'FF' : 'DF'
    }
    const inf = inferredFolgas.get(colab.id)
    if (inf?.fixa && inf.fixa === dia) return 'FF'
    if (inf?.variavel && inf.variavel === dia) return 'FV'
    // Unclassified folga — default FF
    return 'FF'
  }

  // --- Build CicloGridRow[] ---
  const rows: CicloGridRow[] = internalRows.map((internal) => {
    const { posto, titular } = internal
    const inf = titular ? (inferredFolgas.get(titular.id) ?? null) : null

    // semanas: one Simbolo[] per week (7 values, SEG..DOM)
    const semanas: Simbolo[][] = weeks.map((week) => {
      return DIAS_ORDEM.map((dia) => resolveSymbol(titular, dia, week[dia]))
    })

    return {
      id: titular?.id ?? posto.id * -1,
      nome: titular?.nome ?? '',
      posto: posto.apelido,
      fixa: inf?.fixa ?? null,
      variavel: inf?.variavel ?? null,
      blocked: titular != null ? folgaBloqueadaSet.has(titular.id) : true,
      semanas,
    }
  })

  // --- cobertura: count TRABALHO / DT per day per week ---
  const cobertura: number[][] = weeks.map((week) => {
    return DIAS_ORDEM.map((dia) => {
      const dateStr = week[dia]
      if (!dateStr) return 0
      let count = 0
      for (const internal of internalRows) {
        if (!internal.titular) continue
        const alloc = alocMap.get(`${internal.titular.id}-${dateStr}`)
        if (alloc?.status === 'TRABALHO') count += 1
      }
      return count
    })
  })

  // --- demanda: max min_pessoas per dia_semana ---
  const demandaMap = new Map<DiaSemana, number>()
  for (const d of demandas) {
    if (!d.dia_semana) continue
    const current = demandaMap.get(d.dia_semana) ?? 0
    if (d.min_pessoas > current) demandaMap.set(d.dia_semana, d.min_pessoas)
  }
  const demanda: number[] = DIAS_ORDEM.map((dia) => demandaMap.get(dia) ?? 0)

  return {
    rows,
    cobertura,
    demanda,
    cicloSemanas: periodoCiclo,
  }
}

// ============================================================================
// Function 2: simulacaoParaCicloGrid
// ============================================================================

function resolveSimbolo(
  status: 'T' | 'F',
  dIdx: number,
  row: { folga_fixa_dia: number; folga_variavel_dia: number | null },
  fixaDom?: boolean,
): Simbolo {
  const isDomingo = dIdx === 6
  if (status === 'T') return isDomingo ? 'DT' : 'T'
  // Domingo: FF se folga_fixa=DOM, senao DF (ciclo)
  if (isDomingo) return fixaDom ? 'FF' : 'DF'
  if (dIdx === row.folga_variavel_dia) return 'FV'
  if (dIdx === row.folga_fixa_dia) return 'FF'
  return 'FF'
}

function getFixaDia(row: SimulaCicloRow): DiaSemana | null {
  return DIAS_ORDEM[row.folga_fixa_dia] ?? null
}

function getVariavelDia(row: SimulaCicloRow): DiaSemana | null {
  return row.folga_variavel_dia != null ? (DIAS_ORDEM[row.folga_variavel_dia] ?? null) : null
}

export function simulacaoParaCicloGrid(
  resultado: SimulaCicloOutput,
  labels?: string[],
  demandaPorDia?: number[],
): CicloGridData {
  if (!resultado.sucesso) {
    return {
      rows: [],
      cobertura: [],
      demanda: demandaPorDia ?? [0, 0, 0, 0, 0, 0, 0],
      cicloSemanas: 0,
    }
  }

  const rows: CicloGridRow[] = resultado.grid.map((row, rowIndex) => {
    // Detectar folga_fixa_dom: variavel null + todos domingos F
    const allDomF = row.semanas.every(s => s.dias[6] === 'F')
    const isFixaDom = row.folga_variavel_dia == null && allDomF && resultado.grid.length > 1
    const semanas: Simbolo[][] = row.semanas.map((semana) => {
      return semana.dias.map((status, dIdx) => resolveSimbolo(status, dIdx, row, isFixaDom))
    })

    return {
      id: rowIndex,
      nome: labels?.[rowIndex] ?? row.posto,
      posto: row.posto,
      fixa: isFixaDom ? 'DOM' as DiaSemana : getFixaDia(row),
      variavel: isFixaDom ? (getFixaDia(row) ?? null) : getVariavelDia(row),
      blocked: false,
      semanas,
    }
  })

  const cobertura: number[][] = resultado.cobertura_dia.map((cobRow) => cobRow.cobertura)

  const demanda: number[] = demandaPorDia ?? [0, 0, 0, 0, 0, 0, 0]

  return {
    rows,
    cobertura,
    demanda,
    cicloSemanas: resultado.ciclo_semanas,
  }
}
