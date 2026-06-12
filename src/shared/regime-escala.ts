import type { RegimeEscala } from './constants'

export type RegimeEscalaInput = RegimeEscala

export function normalizarRegimeEscala(value: unknown): RegimeEscala | null {
  return value === '5X2' || value === '6X1' ? value : null
}

export function diasTrabalhoPorRegime(regime: RegimeEscala): number {
  return regime === '5X2' ? 5 : 6
}

export function inferirRegimePorDiasTrabalho(diasTrabalho: number | null | undefined): RegimeEscala {
  return (diasTrabalho ?? 6) <= 5 ? '5X2' : '6X1'
}

export function resolverRegimeEscala(input: {
  override?: unknown
  setor?: unknown
  contrato?: unknown
  dias_trabalho?: number | null
}): RegimeEscala {
  return normalizarRegimeEscala(input.override)
    ?? normalizarRegimeEscala(input.setor)
    ?? normalizarRegimeEscala(input.contrato)
    ?? inferirRegimePorDiasTrabalho(input.dias_trabalho)
}
