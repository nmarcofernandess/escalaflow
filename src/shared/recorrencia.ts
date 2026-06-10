/**
 * Recorrência semanal declarativa: colaborador trabalha N semanas e folga M,
 * ancorado no calendário. A semana que contém `ancora` é a PRIMEIRA semana
 * de um bloco de trabalho. Semana = corte da empresa (empresa.corte_semanal).
 *
 * Funções puras (sem DB, sem Date.now) — usadas pela solver-bridge (main),
 * pelo validador (main) e pelo preview (renderer).
 */

export interface RecorrenciaSemanal {
  semanas_trabalho: number // >= 1
  semanas_folga: number // >= 1
  ancora: string // YYYY-MM-DD dentro de uma semana de trabalho
}

const DIA_TO_JSDAY: Record<string, number> = {
  DOM: 0, SEG: 1, TER: 2, QUA: 3, QUI: 4, SEX: 5, SAB: 6,
}

const MS_SEMANA = 7 * 86_400_000

// Formata com acessores locais — toISOString/parsing date-only (UTC) deslocam o dia em fusos como o do Brasil
function fmtDate(dt: Date): string {
  const y = dt.getFullYear()
  const m = String(dt.getMonth() + 1).padStart(2, '0')
  const d = String(dt.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

// Meio-dia local evita bordas de DST
function atNoon(dateISO: string): Date {
  return new Date(`${dateISO}T12:00:00`)
}

/** Primeiro dia da semana que contém dateISO, conforme o corte (ex.: 'SEG_DOM' → SEG). */
export function inicioDaSemana(dateISO: string, corteSemanal: string): string {
  const startDay = DIA_TO_JSDAY[corteSemanal.slice(0, 3)] ?? 1
  const dt = atNoon(dateISO)
  const diff = (dt.getDay() - startDay + 7) % 7
  dt.setDate(dt.getDate() - diff)
  return fmtDate(dt)
}

/** Quantas semanas (do corte) separam dateISO da âncora. Mesma semana = 0; antes da âncora = negativo. */
export function indiceSemanaRecorrencia(dateISO: string, ancoraISO: string, corteSemanal: string): number {
  const ws = atNoon(inicioDaSemana(dateISO, corteSemanal)).getTime()
  const wa = atNoon(inicioDaSemana(ancoraISO, corteSemanal)).getTime()
  return Math.round((ws - wa) / MS_SEMANA)
}

/** true se a semana que contém dateISO é uma semana de FOLGA do ciclo. */
export function semanaEhOff(dateISO: string, rec: RecorrenciaSemanal, corteSemanal: string): boolean {
  const ciclo = rec.semanas_trabalho + rec.semanas_folga
  if (ciclo <= 0) return false // recorrência inválida = sem efeito (callers validam; guard evita NaN silencioso)
  const idx = indiceSemanaRecorrencia(dateISO, rec.ancora, corteSemanal)
  if (Number.isNaN(idx)) return false
  const pos = ((idx % ciclo) + ciclo) % ciclo // módulo sempre positivo (índices negativos)
  return pos >= rec.semanas_trabalho
}

/**
 * Expande a recorrência em ranges contíguos de dias OFF dentro do período.
 * Cada range vira uma exceção sintética (mesmo shape de FERIAS/BLOQUEIO no input do solver).
 */
export function expandirSemanasOff(params: {
  data_inicio: string
  data_fim: string
  corte_semanal: string
  recorrencia: RecorrenciaSemanal
}): Array<{ data_inicio: string; data_fim: string }> {
  const { data_inicio, data_fim, corte_semanal, recorrencia } = params
  const ranges: Array<{ data_inicio: string; data_fim: string }> = []
  let rangeStart: string | null = null
  let prev: string | null = null

  const cursor = atNoon(data_inicio)
  const end = atNoon(data_fim).getTime()
  while (cursor.getTime() <= end) {
    const dia = fmtDate(cursor)
    if (semanaEhOff(dia, recorrencia, corte_semanal)) {
      if (rangeStart === null) rangeStart = dia
      prev = dia
    } else if (rangeStart !== null && prev !== null) {
      ranges.push({ data_inicio: rangeStart, data_fim: prev })
      rangeStart = null
      prev = null
    }
    cursor.setDate(cursor.getDate() + 1)
  }
  if (rangeStart !== null && prev !== null) {
    ranges.push({ data_inicio: rangeStart, data_fim: prev })
  }
  return ranges
}
