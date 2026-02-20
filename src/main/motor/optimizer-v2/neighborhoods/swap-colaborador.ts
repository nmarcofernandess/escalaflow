import type {
  ColabMotor,
  CelulaMotor,
  PinnedCell,
  Feriado,
} from '../../validacao-compartilhada'
import {
  CLT,
  timeToMin,
  isAprendiz,
} from '../../validacao-compartilhada'
import type { DeficitSlot } from '../objective'
import {
  checkInterjornada,
  cloneResultadoMap,
  isPinnedCell,
} from '../utils'

export interface NeighborhoodCandidate {
  next: Map<number, Map<string, CelulaMotor>>
  reason: string
}

interface Params {
  resultado: Map<number, Map<string, CelulaMotor>>
  colaboradores: ColabMotor[]
  deficits: DeficitSlot[]
  dias: string[]
  feriados: Feriado[]
  pinnedMap: Map<string, PinnedCell>
}

/**
 * Troca as alocacoes de 2 colaboradores num MESMO dia.
 * Ex: Colab A 08:00-16:00, Colab B 12:00-20:00 → swap horarios.
 * Resolve situacoes onde a distribuicao de horarios esta sub-otima para cobertura.
 */
export function proposeSwapColaborador(params: Params): NeighborhoodCandidate | null {
  const { resultado, colaboradores, deficits, dias, feriados, pinnedMap } = params

  for (const deficit of deficits) {
    const slotStart = timeToMin(deficit.hora_inicio)
    const slotEnd = timeToMin(deficit.hora_fim)

    // Buscar pares: colabA NAO cobre o slot deficitario, colabB COBRE o slot
    // Swap: se colabA herdar o horario de B (que cobre), e B herdar o de A, pode melhorar
    for (let i = 0; i < colaboradores.length; i++) {
      const colabA = colaboradores[i]
      if (isPinnedCell(pinnedMap, colabA.id, deficit.data)) continue

      const celA = resultado.get(colabA.id)?.get(deficit.data)
      if (!celA || celA.status !== 'TRABALHO' || !celA.hora_inicio || !celA.hora_fim) continue

      const aInicio = timeToMin(celA.hora_inicio)
      const aFim = timeToMin(celA.hora_fim)

      // colabA NAO cobre o slot deficitario
      const aCobre = cobreSlot(celA, slotStart, slotEnd)
      if (aCobre) continue

      for (let j = i + 1; j < colaboradores.length; j++) {
        const colabB = colaboradores[j]
        if (isPinnedCell(pinnedMap, colabB.id, deficit.data)) continue

        const celB = resultado.get(colabB.id)?.get(deficit.data)
        if (!celB || celB.status !== 'TRABALHO' || !celB.hora_inicio || !celB.hora_fim) continue

        const bInicio = timeToMin(celB.hora_inicio)
        const bFim = timeToMin(celB.hora_fim)

        // colabB COBRE o slot (pre-swap), mas vamos checar se o swap melhora
        // A ideia: A pega horario de B, B pega horario de A
        // Verificar que ambos aguentam o horario trocado

        // Check max_minutos_dia: A precisa aguentar turno de B e vice-versa
        if (celB.minutos_trabalho > colabA.max_minutos_dia) continue
        if (celA.minutos_trabalho > colabB.max_minutos_dia) continue

        // Aprendiz nao pode herdar horario noturno (22h-5h)
        if (isAprendiz(colabA) && isNoturno(bInicio, bFim)) continue
        if (isAprendiz(colabB) && isNoturno(aInicio, aFim)) continue

        // Check interjornada pra ambos com novos horarios
        if (!checkInterjornada(resultado, colabA.id, dias, deficit.data, bInicio, bFim)) continue
        if (!checkInterjornada(resultado, colabB.id, dias, deficit.data, aInicio, aFim)) continue

        // Verificar que o swap realmente ajuda: A com horario de B deve cobrir o slot
        const aComHorarioB = { ...celB } // A herda tudo de B
        if (!cobreSlot(aComHorarioB, slotStart, slotEnd)) continue

        // Executar swap
        const next = cloneResultadoMap(resultado)
        const nextCelA = next.get(colabA.id)?.get(deficit.data)
        const nextCelB = next.get(colabB.id)?.get(deficit.data)
        if (!nextCelA || !nextCelB) continue

        // Swap: A pega dados de B, B pega dados de A
        const tempInicio = nextCelA.hora_inicio
        const tempFim = nextCelA.hora_fim
        const tempMinutos = nextCelA.minutos_trabalho
        const tempMinutosTotal = nextCelA.minutos
        const tempAlmocoInicio = nextCelA.hora_almoco_inicio
        const tempAlmocoFim = nextCelA.hora_almoco_fim
        const tempMinutosAlmoco = nextCelA.minutos_almoco
        const tempIntervalo = nextCelA.intervalo_15min

        nextCelA.hora_inicio = nextCelB.hora_inicio
        nextCelA.hora_fim = nextCelB.hora_fim
        nextCelA.minutos_trabalho = nextCelB.minutos_trabalho
        nextCelA.minutos = nextCelB.minutos
        nextCelA.hora_almoco_inicio = nextCelB.hora_almoco_inicio
        nextCelA.hora_almoco_fim = nextCelB.hora_almoco_fim
        nextCelA.minutos_almoco = nextCelB.minutos_almoco
        nextCelA.intervalo_15min = nextCelB.intervalo_15min

        nextCelB.hora_inicio = tempInicio
        nextCelB.hora_fim = tempFim
        nextCelB.minutos_trabalho = tempMinutos
        nextCelB.minutos = tempMinutosTotal
        nextCelB.hora_almoco_inicio = tempAlmocoInicio
        nextCelB.hora_almoco_fim = tempAlmocoFim
        nextCelB.minutos_almoco = tempMinutosAlmoco
        nextCelB.intervalo_15min = tempIntervalo

        return {
          next,
          reason: `Swap horários de ${colabA.nome} e ${colabB.nome} em ${deficit.data} para cobrir ${deficit.hora_inicio}-${deficit.hora_fim}`,
        }
      }
    }
  }

  return null
}

function cobreSlot(cel: CelulaMotor, slotStart: number, slotEnd: number): boolean {
  if (!cel.hora_inicio || !cel.hora_fim) return false
  const celInicio = timeToMin(cel.hora_inicio)
  const celFim = timeToMin(cel.hora_fim)
  if (celInicio > slotStart || celFim < slotEnd) return false

  // Checar se slot nao cai dentro do almoco
  if (cel.hora_almoco_inicio && cel.hora_almoco_fim) {
    const almocoInicio = timeToMin(cel.hora_almoco_inicio)
    const almocoFim = timeToMin(cel.hora_almoco_fim)
    if (slotStart >= almocoInicio && slotEnd <= almocoFim) return false
  }
  return true
}

function isNoturno(inicioMin: number, fimMin: number): boolean {
  // Noturno: 22:00 (1320min) a 05:00 (300min)
  const noturnoInicio = timeToMin(CLT.APRENDIZ_HORARIO_NOTURNO_INICIO)
  const noturnoFim = timeToMin(CLT.APRENDIZ_HORARIO_NOTURNO_FIM)
  return fimMin > noturnoInicio || inicioMin < noturnoFim
}
