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
