/**
 * Formata ISO date string para "dd/mm/yyyy"
 * Ex: "2026-03-01" -> "01/03/2026"
 */
export function formatarData(iso: string): string {
  const [ano, mes, dia] = iso.split('-')
  return `${dia}/${mes}/${ano}`
}

/**
 * Formata minutos totais para "Xh00" ou "XhMM"
 * Ex: 450 -> "7h30", 480 -> "8h00"
 */
export function formatarMinutos(min: number): string {
  const horas = Math.floor(min / 60)
  const minutos = min % 60
  return `${horas}h${minutos.toString().padStart(2, '0')}`
}

/**
 * Formata ISO date string para "Mmm/yyyy"
 * Ex: "2026-03-01" -> "Mar/2026"
 */
export function formatarMes(iso: string): string {
  const meses = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
  const [ano, mes] = iso.split('-')
  return `${meses[parseInt(mes, 10) - 1]}/${ano}`
}

/**
 * Mapa de regras tecnicas -> texto humano em portugues (RF4.1)
 * Usado para exibir violacoes de forma amigavel aos usuarios nao-tecnicos
 */
export const REGRAS_TEXTO: Record<string, string> = {
  // HARD rules (6) - Violam legislacao trabalhista (CLT)
  MAX_DIAS_CONSECUTIVOS: 'Trabalhou mais de 6 dias seguidos sem folga',
  DESCANSO_ENTRE_JORNADAS: 'Intervalo entre jornadas menor que 11 horas',
  RODIZIO_DOMINGO: 'Rodizio de domingo nao respeitado',
  ESTAGIARIO_DOMINGO: 'Estagiario nao pode trabalhar no domingo',
  CONTRATO_MAX_DIA: 'Jornada diaria excede o limite do contrato',
  MAX_JORNADA_DIARIA: 'Jornada diaria excede o limite de 10 horas (CLT)',
  // SOFT rules (4) - Preferencias e otimizacoes
  META_SEMANAL: 'Horas semanais fora da meta do contrato',
  PREFERENCIA_DIA: 'Escalado no dia que pediu pra evitar',
  PREFERENCIA_TURNO: 'Escalado em turno diferente do preferido',
  COBERTURA: 'Faixa horaria com menos pessoas que o necessario'
}

/**
 * Mapeia erros tecnicos para mensagens amigaveis em portugues (RF12, RF6.1)
 */
export function mapError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  if (!msg || typeof msg !== 'string') {
    return 'Erro inesperado. Tente novamente ou reinicie o aplicativo.'
  }
  const m = msg.toLowerCase()
  if (m.includes('cobertura abaixo do piso operacional') || m.includes('piso operacional')) {
    return 'Nao foi possivel gerar uma escala valida para o periodo: cobertura ficou abaixo do piso operacional em alguns horarios. Ajuste demanda, periodo ou equipe.'
  }
  if (m.includes('setor') && (m.includes('nao encontrado') || m.includes('inativo'))) {
    return 'O setor selecionado esta inativo ou nao foi encontrado.'
  }
  if (m.includes('empresa nao encontrada') || m.includes('empresa não encontrada')) {
    return 'Configure os dados da empresa antes de gerar escalas.'
  }
  if (m.includes('colaboradores ativos') || m.includes('nao tem colaboradores')) {
    return 'Cadastre ao menos 1 colaborador ativo neste setor antes de gerar a escala.'
  }
  if (m.includes('faixas de demanda') || m.includes('nao tem faixas')) {
    return 'Defina as faixas de demanda (horarios e quantidade minima de pessoas) antes de gerar.'
  }
  if (m.includes('violacoes') && m.includes('criticas')) {
    const match = msg.match(/(\d+)/)
    const n = match ? match[1] : ''
    return n
      ? `A escala tem ${n} problema(s) que viola(m) a legislacao trabalhista. Corrija-os antes de oficializar.`
      : 'A escala tem problemas que violam a legislacao trabalhista. Corrija-os antes de oficializar.'
  }
  if (m.includes('rascunho') || m.includes('ajustar')) {
    return 'So e possivel ajustar escalas em rascunho.'
  }
  if (m.includes('network') || m.includes('fetch') || m.includes('ipc') || m.includes('econnrefused')) {
    return 'Erro de comunicacao com o sistema. Tente novamente.'
  }
  if (m.includes('timeout') || m.includes('demorou')) {
    return 'A geracao demorou mais que o esperado. Tente novamente com menos colaboradores ou um periodo menor.'
  }
  if (m.includes('infeasible')) {
    const detalhe = msg.replace(/^.*infeasible:\s*/i, '').trim()
    if (detalhe && detalhe.length <= 220 && !detalhe.toLowerCase().includes('impossivel satisfazer todas as restricoes simultaneamente')) {
      return `Nao foi possivel gerar uma escala viavel para este periodo. ${detalhe}`
    }
    return 'Nao foi possivel gerar uma escala viavel para este periodo com as regras atuais. Revise demanda, periodo, excecoes e quantidade de colaboradores.'
  }
  // Se ja for uma mensagem curta e "humana", reaproveita em vez de mascarar.
  if (!m.includes('typeerror') && !m.includes('referenceerror') && msg.length <= 220) {
    return msg
  }
  // Fallback generico (RF6.1 - nao vazar stack trace ou mensagens tecnicas)
  return 'Erro inesperado. Tente novamente ou reinicie o aplicativo.'
}

/**
 * Retorna iniciais do nome (primeiras letras das 2 primeiras palavras)
 * Ex: "Ana Julia" -> "AJ", "Carlos" -> "CA", "Maria Fernanda Silva" -> "MF"
 */
export function iniciais(nome: string): string {
  const palavras = nome.trim().split(/\s+/)
  if (palavras.length >= 2) {
    return (palavras[0][0] + palavras[1][0]).toUpperCase()
  }
  return nome.slice(0, 2).toUpperCase()
}

/**
 * Converte string de tempo 'HH:MM' para minutos totais
 * Ex: "08:00" -> 480, "14:30" -> 870, "22:00" -> 1320
 * Retorna 0 se time for null, undefined ou vazio
 */
export function toMinutes(time: string | null): number {
  if (!time || time === '') {
    return 0
  }
  const [horas, minutos] = time.split(':')
  return parseInt(horas, 10) * 60 + parseInt(minutos, 10)
}

export function minutesToTime(min: number): string {
  const h = Math.floor(min / 60)
  const m = min % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}
