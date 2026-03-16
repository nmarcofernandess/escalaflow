import type { DiaSemana } from './constants'
import type { SimulacaoAdvisorySnapshot } from './advisory-types'
import { sugerirK } from './simula-ciclo'

export type SetorSimulacaoMode = 'SETOR' | 'LIVRE'

export interface SetorSimulacaoFolgaForcada {
  fixa: DiaSemana | null
  variavel: DiaSemana | null
}

export interface SetorSimulacaoOverrideLocal {
  fixa?: DiaSemana | null
  variavel?: DiaSemana | null
}

export interface SetorSimulacaoConfig {
  mode: SetorSimulacaoMode
  setor: {
    overrides_locais: Record<string, SetorSimulacaoOverrideLocal>
  }
  livre: {
    n: number
    k: number
    folgas_forcadas: SetorSimulacaoFolgaForcada[]
  }
  advisory?: SimulacaoAdvisorySnapshot | null
}

const DEFAULT_LIVRE_N = 5
const DIAS_SEMANA = new Set<DiaSemana>(['SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB', 'DOM'])

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return fallback
  return Math.max(min, Math.min(max, Math.round(value)))
}

function normalizeDiaSemana(value: unknown, allowDomingo: boolean): DiaSemana | null {
  if (typeof value !== 'string') return null
  const dia = value.toUpperCase() as DiaSemana
  if (!DIAS_SEMANA.has(dia)) return null
  if (!allowDomingo && dia === 'DOM') return null
  return dia
}

function normalizeFolgasForcadas(value: unknown): SetorSimulacaoFolgaForcada[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => {
    const row = typeof item === 'object' && item != null ? item as Record<string, unknown> : {}
    return {
      fixa: normalizeDiaSemana(row.fixa, true),
      variavel: normalizeDiaSemana(row.variavel, false),
    }
  })
}

function normalizeOverridesLocais(value: unknown): Record<string, SetorSimulacaoOverrideLocal> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const normalized: Record<string, SetorSimulacaoOverrideLocal> = {}
  for (const [key, rawItem] of Object.entries(value)) {
    if (!/^\d+$/.test(key)) continue
    const row = typeof rawItem === 'object' && rawItem != null ? rawItem as Record<string, unknown> : {}
    const next: SetorSimulacaoOverrideLocal = {}
    if (Object.prototype.hasOwnProperty.call(row, 'fixa')) {
      next.fixa = normalizeDiaSemana(row.fixa, true)
    }
    if (Object.prototype.hasOwnProperty.call(row, 'variavel')) {
      next.variavel = normalizeDiaSemana(row.variavel, false)
    }
    if (Object.keys(next).length > 0) {
      normalized[key] = next
    }
  }
  return normalized
}

export function normalizeSetorSimulacaoConfig(
  raw: string | SetorSimulacaoConfig | null | undefined,
  options?: { hasActivePostos?: boolean },
): SetorSimulacaoConfig {
  let parsed: Record<string, unknown> | null = null

  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>
    } catch {
      parsed = null
    }
  } else if (raw && typeof raw === 'object') {
    parsed = raw as unknown as Record<string, unknown>
  }

  const livreRaw = parsed && typeof parsed.livre === 'object' && parsed.livre != null
    ? parsed.livre as Record<string, unknown>
    : {}
  const setorRaw = parsed && typeof parsed.setor === 'object' && parsed.setor != null
    ? parsed.setor as Record<string, unknown>
    : {}

  const livreN = clampInt(livreRaw.n, 1, 99, DEFAULT_LIVRE_N)
  const livreK = clampInt(livreRaw.k, 0, livreN, sugerirK(livreN, 7))
  const defaultMode: SetorSimulacaoMode = options?.hasActivePostos ? 'SETOR' : 'LIVRE'
  const mode = parsed?.mode === 'SETOR' || parsed?.mode === 'LIVRE'
    ? parsed.mode
    : defaultMode

  return {
    mode,
    setor: {
      overrides_locais: normalizeOverridesLocais(
        setorRaw.overrides_locais ?? parsed?.folgas_setor ?? {},
      ),
    },
    livre: {
      n: livreN,
      k: livreK,
      folgas_forcadas: normalizeFolgasForcadas(livreRaw.folgas_forcadas),
    },
    advisory: (parsed?.advisory && typeof parsed.advisory === 'object' && 'input_hash' in (parsed.advisory as object)
      ? parsed.advisory as SimulacaoAdvisorySnapshot
      : null),
  }
}

export function stringifySetorSimulacaoConfig(config: SetorSimulacaoConfig): string {
  return JSON.stringify(normalizeSetorSimulacaoConfig(config))
}
