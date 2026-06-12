import type { TipoTrabalhador } from './constants'

const TIPOS_VALIDOS = new Set<TipoTrabalhador>(['CLT', 'ESTAGIARIO', 'INTERMITENTE'])

function normalizarTipo(value: unknown): TipoTrabalhador | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toUpperCase()
  return TIPOS_VALIDOS.has(normalized as TipoTrabalhador) ? normalized as TipoTrabalhador : null
}

function normalizarTexto(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

export type DerivarTipoTrabalhadorInput = {
  tipo_colaborador?: unknown
  contrato_nome?: unknown
  contrato_tipo_trabalhador?: unknown
}

export function derivarTipoTrabalhador(input: DerivarTipoTrabalhadorInput): TipoTrabalhador {
  const tipoContrato = normalizarTipo(input.contrato_tipo_trabalhador)
  if (tipoContrato) return tipoContrato

  const nomeContrato = normalizarTexto(input.contrato_nome)
  if (nomeContrato.includes('intermit')) return 'INTERMITENTE'
  if (nomeContrato.includes('estagi')) return 'ESTAGIARIO'

  return normalizarTipo(input.tipo_colaborador) ?? 'CLT'
}

export function isIntermitenteDerivado(input: DerivarTipoTrabalhadorInput): boolean {
  return derivarTipoTrabalhador(input) === 'INTERMITENTE'
}
