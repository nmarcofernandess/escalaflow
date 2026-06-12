import type { RegimeEscala } from './constants'

export type RegimeEscalaInput = RegimeEscala
export type RegimeEscalaContratoInput = {
  regime_escala?: unknown
  dias_trabalho?: number | null
}

export type RegimeEscalaAgregado = {
  regime: RegimeEscala
  observacao?: string
}

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

/**
 * Resolve o regime de uma visao agregada de setor, onde nao existe um contrato
 * individual autoritativo. Setor explicito vence; sem setor, usa maioria dos
 * contratos do pool e desempata em 6X1 por ser o pior caso de cobertura.
 */
export function resolverRegimeEscalaAgregado(input: {
  override?: unknown
  setor?: unknown
  contrato?: unknown
  dias_trabalho?: number | null
  contratos?: RegimeEscalaContratoInput[]
}): RegimeEscalaAgregado {
  const override = normalizarRegimeEscala(input.override)
  if (override) return { regime: override }

  const setor = normalizarRegimeEscala(input.setor)
  if (setor) return { regime: setor }

  const contagem = { '5X2': 0, '6X1': 0 } satisfies Record<RegimeEscala, number>
  for (const contrato of input.contratos ?? []) {
    const regime = normalizarRegimeEscala(contrato.regime_escala)
      ?? inferirRegimePorDiasTrabalho(contrato.dias_trabalho)
    contagem[regime] += 1
  }

  if (contagem['5X2'] > contagem['6X1']) return { regime: '5X2' }
  if (contagem['6X1'] > contagem['5X2']) return { regime: '6X1' }
  if (contagem['5X2'] > 0) {
    return {
      regime: '6X1',
      observacao: 'Empate no regime agregado entre 5x2 e 6x1; usando 6x1 como cenário conservador de cobertura.',
    }
  }

  return {
    regime: resolverRegimeEscala({
      contrato: input.contrato,
      dias_trabalho: input.dias_trabalho,
    }),
  }
}
