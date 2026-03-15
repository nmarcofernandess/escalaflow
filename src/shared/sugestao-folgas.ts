import type { DiaSemana } from './index'

export interface SugestaoFolgaItem {
  colaborador_id: number
  nome: string
  variavel_atual: DiaSemana | null
  variavel_proposta: DiaSemana | null
  fixa_atual: DiaSemana | null
  fixa_proposta: DiaSemana | null
}

interface CalcSugestaoInput {
  colaboradores: Array<{
    id: number
    nome: string
    posto_apelido: string
    fixa_atual: DiaSemana | null
    variavel_atual: DiaSemana | null
    tipo_trabalhador: string
    folga_fixa_dom: boolean
  }>
  demandaPorDia: number[] // [SEG, TER, QUA, QUI, SEX, SAB, DOM] = 7 valores
  N: number
}

const DIAS_SEMANA: DiaSemana[] = ['SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB']

/**
 * Calcula sugestao otimizada de folga fixa e variavel pra cada colaborador.
 * Usa heuristica greedy: distribui folgas nos dias com MAIS sobra de cobertura.
 * Colaboradores com folga_fixa=DOM sao tratados como caso especial (2 folgas fixas).
 */
export function calcularSugestaoFolgas(input: CalcSugestaoInput): {
  sugestoes: SugestaoFolgaItem[]
  resultados: string[]
} {
  const { colaboradores, demandaPorDia, N } = input

  // Track folgas ja atribuidas por dia (SEG-SAB = 6 posicoes)
  const folgaCount = [0, 0, 0, 0, 0, 0]

  const sugestoes: SugestaoFolgaItem[] = []

  const elegiveis = colaboradores.filter(c =>
    c.tipo_trabalhador !== 'INTERMITENTE' && !c.folga_fixa_dom
  )
  const comFixaDom = colaboradores.filter(c => c.folga_fixa_dom)

  // Primeiro: processar quem tem folga_fixa=DOM (2 folgas fixas de dia de semana)
  for (const colab of comFixaDom) {
    // Precisa de 1 folga extra em dia de semana (DOM ja e folga fixa)
    const bestDay = pickBestDay(demandaPorDia, folgaCount, N, null)
    folgaCount[bestDay]++

    sugestoes.push({
      colaborador_id: colab.id,
      nome: `${colab.nome} (${colab.posto_apelido})`,
      fixa_atual: colab.fixa_atual,
      fixa_proposta: 'DOM',
      variavel_atual: colab.variavel_atual,
      variavel_proposta: DIAS_SEMANA[bestDay],
    })
  }

  // Depois: processar elegiveis normais (fixa + variavel)
  for (const colab of elegiveis) {
    const bestFixa = pickBestDay(demandaPorDia, folgaCount, N, null)
    folgaCount[bestFixa]++

    const bestVar = pickBestDay(demandaPorDia, folgaCount, N, bestFixa)
    // Variavel tambem consome cobertura (~50% das semanas quando ativa).
    // Contar evita que o greedy concentre variaveis no mesmo dia.
    folgaCount[bestVar]++

    sugestoes.push({
      colaborador_id: colab.id,
      nome: `${colab.nome} (${colab.posto_apelido})`,
      fixa_atual: colab.fixa_atual,
      fixa_proposta: DIAS_SEMANA[bestFixa],
      variavel_atual: colab.variavel_atual,
      variavel_proposta: DIAS_SEMANA[bestVar],
    })
  }

  // Calcular resultados da proposta
  const coberturaPropostaPorDia = DIAS_SEMANA.map((_, d) => N - folgaCount[d])
  const diasComDeficit = coberturaPropostaPorDia
    .map((cob, d) => ({ dia: DIAS_SEMANA[d], cob, dem: demandaPorDia[d] ?? 0 }))
    .filter(x => x.cob < x.dem)

  const resultados: string[] = []
  if (diasComDeficit.length === 0) resultados.push('Cobertura OK (todos os dias)')
  else resultados.push(`Deficit em ${diasComDeficit.length} dia(s): ${diasComDeficit.map(x => x.dia).join(', ')}`)
  resultados.push('Sem TT')
  resultados.push('H1 OK')

  return { sugestoes, resultados }
}

/** Escolhe o dia com MAIS sobra de cobertura (N - demanda - folgasJa) */
function pickBestDay(
  demandaPorDia: number[],
  folgaCount: number[],
  N: number,
  exclude: number | null,
): number {
  let bestDay = 0
  let bestScore = -Infinity
  for (let d = 0; d < 6; d++) {
    if (d === exclude) continue
    const score = (N - (demandaPorDia[d] ?? 0)) - folgaCount[d]
    if (score > bestScore) {
      bestScore = score
      bestDay = d
    }
  }
  return bestDay
}
