/**
 * Textos user-friendly para a aba Resumo da escala.
 * Usado pelo main process (tool gerar_escala → resumo_user) e pelo renderer (formatadores).
 * Fonte única para a IA falar com o usuário no mesmo vocabulário da tela.
 */

/**
 * Texto para exibir cobertura no Resumo da escala.
 * Se efetiva === estrita: uma linha. Se efetiva > estrita: linha principal + secundária (tolerância café/almoço).
 */
export function textoResumoCobertura(
  coberturaEstrita: number,
  coberturaEfetiva?: number | null,
): { principal: string; secundaria?: string } {
  const efetiva = coberturaEfetiva ?? coberturaEstrita
  const principal = `Cobertura dos horários: ${Math.round(coberturaEstrita)}%`
  if (efetiva > coberturaEstrita) {
    return {
      principal,
      secundaria: `Considerando tolerância em horários de café e almoço: ${Math.round(efetiva)}%`,
    }
  }
  return { principal }
}

/**
 * Texto para problemas que impedem oficializar (violacoes_hard).
 */
export function textoResumoViolacoesHard(count: number): string {
  if (count === 0) return 'Nenhum problema que impeça oficializar.'
  return count === 1
    ? '1 problema que precisa ser corrigido antes de oficializar.'
    : `${count} problemas que precisam ser corrigidos antes de oficializar.`
}

/**
 * Texto para avisos (violacoes_soft).
 */
export function textoResumoViolacoesSoft(count: number): string {
  if (count === 0) return 'Nenhum aviso.'
  return count === 1
    ? '1 aviso (preferências ou metas).'
    : `${count} avisos (preferências ou metas).`
}

/** Mapa de códigos de regra → nomes legíveis para o RH. Exportado para uso em componentes UI. */
export const NOMES_HUMANOS_REGRAS: Record<string, string> = {
  DIAS_TRABALHO: 'dias de trabalho por semana',
  MIN_DIARIO: 'jornada mínima diária',
  TIME_WINDOW: 'horário de entrada/saída',
  FOLGA_FIXA: 'folga fixa semanal',
  FOLGA_VARIAVEL: 'rodízio de folga/domingo',
  H6: 'intervalo de almoço',
  H10: 'meta de horas semanais',
  H1: 'máximo 6 dias consecutivos',
}

/**
 * Texto para ajustes aplicados pelo sistema (pass > 1).
 * Consome diagnostico.pass_usado e diagnostico.regras_relaxadas.
 * Retorna null APENAS quando pass === 1 (numérico) e sem relaxações.
 * Pass '1b' (string) SEMPRE retorna texto — alguma regra foi afrouxada.
 */
export function textoResumoRelaxacoes(
  pass_usado: number | string,
  regras_relaxadas: string[],
  generation_mode?: string,
): string | null {
  // Só pass 1 (numérico exato) sem relaxações = tudo OK
  if (pass_usado === 1 && regras_relaxadas.length === 0) return null

  const nomes = regras_relaxadas.length > 0
    ? regras_relaxadas.map(r => NOMES_HUMANOS_REGRAS[r] ?? r).join(', ')
    : 'algumas regras de horário'

  if (pass_usado === 3 || generation_mode === 'EXPLORATORY') {
    return `Escala com limitações — o sistema precisou ajustar: ${nomes}. Revise com atenção.`
  }
  return `Escala gerada com ajustes: ${nomes} foram ajustados para que a escala funcionasse.`
}
