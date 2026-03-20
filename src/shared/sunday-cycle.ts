import type { DiaSemana } from './constants'

export interface SundayRuleWindowLike {
  perfil_horario_id?: number | null
  inicio?: string | null
  fim?: string | null
  p_inicio?: string | null
  p_fim?: string | null
}

export interface SundayRotatingDemandInput {
  totalSundayDemand: number
  guaranteedSundayCoverage?: number
  rotatingPoolSize?: number
}

export interface SundayRotatingDemandResult {
  totalSundayDemand: number
  guaranteedSundayCoverage: number
  residualSundayDemand: number
  effectiveSundayDemand: number
}

export function hasGuaranteedSundayWindow(rule?: SundayRuleWindowLike | null): boolean {
  if (!rule) return false
  // Intermitente com regra DOM ativa e sem horario explicito continua disponivel
  // dentro da janela operacional do setor, entao conta como cobertura garantida.
  return true
}

export function resolveSundayRotatingDemand({
  totalSundayDemand,
  guaranteedSundayCoverage = 0,
  rotatingPoolSize,
}: SundayRotatingDemandInput): SundayRotatingDemandResult {
  const total = Math.max(0, totalSundayDemand)
  const guaranteed = Math.max(0, guaranteedSundayCoverage)
  const residual = Math.max(0, total - guaranteed)
  const effective = rotatingPoolSize == null
    ? residual
    : Math.min(residual, Math.max(0, rotatingPoolSize))

  return {
    totalSundayDemand: total,
    guaranteedSundayCoverage: guaranteed,
    residualSundayDemand: residual,
    effectiveSundayDemand: effective,
  }
}

/** Intermitente tipo A: dias fixos, sem rotacao, sem folga_variavel */
export function isIntermitenteTipoA(colab: {
  tipo_trabalhador?: string
  folga_variavel_dia_semana?: DiaSemana | null
}): boolean {
  return (colab.tipo_trabalhador ?? 'CLT') === 'INTERMITENTE'
    && !colab.folga_variavel_dia_semana
}

/** Intermitente tipo B: dias ativos + folga variavel + ciclo domingo */
export function isIntermitenteTipoB(colab: {
  tipo_trabalhador?: string
  folga_variavel_dia_semana?: DiaSemana | null
}): boolean {
  return (colab.tipo_trabalhador ?? 'CLT') === 'INTERMITENTE'
    && !!colab.folga_variavel_dia_semana
}
