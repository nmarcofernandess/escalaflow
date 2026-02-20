import type {
  ColabMotor,
  CelulaMotor,
  PinnedCell,
  Feriado,
} from '../../validacao-compartilhada'
import {
  CLT,
  isDomingo,
  timeToMin,
  isAprendiz,
  isFeriadoProibido,
  isFeriadoSemCCT,
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
 * Troca a alocacao de 1 colaborador entre 2 dias diferentes.
 * Ex: Colab A: TRABALHO seg, FOLGA ter → swap → FOLGA seg, TRABALHO ter
 * Resolve quando folga caiu num dia critico e dia com excesso era trabalhado.
 */
export function proposeSwapDay(params: Params): NeighborhoodCandidate | null {
  const { resultado, colaboradores, deficits, dias, feriados, pinnedMap } = params

  for (const deficit of deficits) {
    for (const colab of colaboradores) {
      // O colab tem FOLGA no dia deficitario?
      if (isPinnedCell(pinnedMap, colab.id, deficit.data)) continue
      const celDeficit = resultado.get(colab.id)?.get(deficit.data)
      if (!celDeficit || celDeficit.status !== 'FOLGA') continue

      // Buscar um dia TRABALHO desse colab que podemos trocar para FOLGA
      const mapa = resultado.get(colab.id)
      if (!mapa) continue

      for (const outroDia of dias) {
        if (outroDia === deficit.data) continue
        if (isPinnedCell(pinnedMap, colab.id, outroDia)) continue

        const celOutro = mapa.get(outroDia)
        if (!celOutro || celOutro.status !== 'TRABALHO' || !celOutro.hora_inicio || !celOutro.hora_fim) continue

        const outroInicio = timeToMin(celOutro.hora_inicio)
        const outroFim = timeToMin(celOutro.hora_fim)

        // Guardrails tipo_trabalhador para o dia deficitario (que vai virar TRABALHO)
        if (isAprendiz(colab)) {
          if (isDomingo(deficit.data)) continue
          if (feriados.some(f => f.data === deficit.data)) continue
          // Checar se horario herdado e noturno
          if (outroFim > timeToMin(CLT.APRENDIZ_HORARIO_NOTURNO_INICIO) || outroInicio < timeToMin(CLT.APRENDIZ_HORARIO_NOTURNO_FIM)) continue
        }

        // Feriados proibidos — ninguem trabalha
        if (isFeriadoProibido(deficit.data, feriados)) continue
        if (isFeriadoSemCCT(deficit.data, feriados)) continue

        // Checar interjornada no dia deficitario com o horario herdado
        if (!checkInterjornada(resultado, colab.id, dias, deficit.data, outroInicio, outroFim)) continue

        // Checar H1 (consecutivos) — simular o swap e contar
        if (!checkConsecutivosAfterSwap(mapa, dias, deficit.data, outroDia)) continue

        // Executar swap
        const next = cloneResultadoMap(resultado)
        const nextMapa = next.get(colab.id)
        if (!nextMapa) continue

        const nextCelDeficit = nextMapa.get(deficit.data)
        const nextCelOutro = nextMapa.get(outroDia)
        if (!nextCelDeficit || !nextCelOutro) continue

        // deficit.data: FOLGA → TRABALHO (herda horarios do outroDia)
        nextCelDeficit.status = 'TRABALHO'
        nextCelDeficit.hora_inicio = celOutro.hora_inicio
        nextCelDeficit.hora_fim = celOutro.hora_fim
        nextCelDeficit.minutos_trabalho = celOutro.minutos_trabalho
        nextCelDeficit.minutos = celOutro.minutos
        nextCelDeficit.hora_almoco_inicio = celOutro.hora_almoco_inicio
        nextCelDeficit.hora_almoco_fim = celOutro.hora_almoco_fim
        nextCelDeficit.minutos_almoco = celOutro.minutos_almoco
        nextCelDeficit.intervalo_15min = celOutro.intervalo_15min

        // outroDia: TRABALHO → FOLGA
        nextCelOutro.status = 'FOLGA'
        nextCelOutro.hora_inicio = null
        nextCelOutro.hora_fim = null
        nextCelOutro.minutos_trabalho = 0
        nextCelOutro.minutos = 0
        nextCelOutro.hora_almoco_inicio = null
        nextCelOutro.hora_almoco_fim = null
        nextCelOutro.minutos_almoco = 0
        nextCelOutro.intervalo_15min = false

        return {
          next,
          reason: `Swap dias de ${colab.nome}: folga ${deficit.data}↔trabalho ${outroDia} para cobrir ${deficit.hora_inicio}-${deficit.hora_fim}`,
        }
      }
    }
  }

  return null
}

/** Simula swap e checa que nenhum trecho excede 6 dias consecutivos */
function checkConsecutivosAfterSwap(
  mapa: Map<string, CelulaMotor>,
  dias: string[],
  diaA: string, // vai virar TRABALHO
  diaB: string, // vai virar FOLGA
): boolean {
  let consec = 0
  for (const d of dias) {
    const cel = mapa.get(d)
    let isTrabalho: boolean
    if (d === diaA) isTrabalho = true       // FOLGA → TRABALHO
    else if (d === diaB) isTrabalho = false  // TRABALHO → FOLGA
    else isTrabalho = cel?.status === 'TRABALHO'

    if (isTrabalho) {
      consec++
      if (consec > CLT.MAX_DIAS_CONSECUTIVOS) return false
    } else {
      consec = 0
    }
  }
  return true
}
