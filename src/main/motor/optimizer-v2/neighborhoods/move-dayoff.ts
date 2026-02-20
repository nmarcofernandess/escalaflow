import type {
  ColabMotor,
  CelulaMotor,
  PinnedCell,
  Feriado,
  SlotGrid,
} from '../../validacao-compartilhada'
import {
  CLT,
  minToTime,
  timeToMin,
  calcMetaDiariaMin,
  isFeriadoProibido,
  isFeriadoSemCCT,
} from '../../validacao-compartilhada'
import type { DeficitSlot } from '../objective'
import {
  canWorkBasic,
  checkInterjornada,
  cloneResultadoMap,
  getDayBounds,
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
  grid: SlotGrid[]
  feriados: Feriado[]
  pinnedMap: Map<string, PinnedCell>
}

export function proposeActivateDayOffForCriticalSlot(params: Params): NeighborhoodCandidate | null {
  const {
    resultado,
    colaboradores,
    deficits,
    dias,
    grid,
    feriados,
    pinnedMap,
  } = params

  for (const deficit of deficits) {
    const slotFimMin = timeToMin(deficit.hora_fim)
    const dayBounds = getDayBounds(grid, deficit.data)
    if (!dayBounds) continue
    if (isFeriadoProibido(deficit.data, feriados)) continue
    if (isFeriadoSemCCT(deficit.data, feriados)) continue

    for (const colab of colaboradores) {
      if (!canWorkBasic(colab, deficit.data, feriados, resultado, dias)) continue
      if (isPinnedCell(pinnedMap, colab.id, deficit.data)) continue

      const cel = resultado.get(colab.id)?.get(deficit.data)
      if (!cel || cel.status !== 'FOLGA') continue

      // Tentar 3 tamanhos de turno: meta diaria (ideal), 6h (sem almoco), 4h (minimo)
      const metaDiaria = calcMetaDiariaMin(colab.horas_semanais, colab.dias_trabalho)
      const turnoSizes = [
        Math.min(metaDiaria, colab.max_minutos_dia),
        CLT.LIMIAR_ALMOCO_MIN,  // 360 = 6h (sem almoco)
        CLT.MIN_JORNADA_DIA_MIN, // 240 = 4h
      ]
      // Deduplica e filtra validos
      const uniqueSizes = [...new Set(turnoSizes)].filter(s => s >= CLT.MIN_JORNADA_DIA_MIN && s <= colab.max_minutos_dia)

      for (const turnoMin of uniqueSizes) {
        let novoInicio = Math.max(dayBounds.inicio, slotFimMin - turnoMin)
        let novoFim = novoInicio + turnoMin

        if (novoFim > dayBounds.fim) {
          novoFim = dayBounds.fim
          novoInicio = novoFim - turnoMin
        }

        if (novoInicio < dayBounds.inicio || novoFim > dayBounds.fim) continue
        if (novoFim <= novoInicio) continue
        if (!checkInterjornada(resultado, colab.id, dias, deficit.data, novoInicio, novoFim)) continue

        // Se turno > 6h, precisa almoco — posicionar no meio
        const precisaAlmoco = turnoMin > CLT.LIMIAR_ALMOCO_MIN
        let almocoInicio: number | null = null
        let almocoFim: number | null = null
        let minutosAlmoco = 0
        let minutosTrabalho = turnoMin

        if (precisaAlmoco) {
          minutosAlmoco = CLT.ALMOCO_MIN_CCT_MIN // 30min (CCT autoriza reducao)
          almocoInicio = novoInicio + Math.floor((turnoMin - minutosAlmoco) / 2)
          // Alinhar ao grid de 30min
          almocoInicio = Math.round(almocoInicio / CLT.GRID_MINUTOS) * CLT.GRID_MINUTOS
          almocoFim = almocoInicio + minutosAlmoco
          minutosTrabalho = turnoMin - minutosAlmoco

          // Validar H20: min 2h antes e depois do almoco
          if (almocoInicio - novoInicio < 120 || novoFim - almocoFim < 120) continue
        }

        // Intervalo 15min: jornada >4h e <=6h
        const intervalo15 = !precisaAlmoco && minutosTrabalho > CLT.LIMIAR_INTERVALO_CURTO_MIN && minutosTrabalho <= CLT.LIMIAR_ALMOCO_MIN

        const next = cloneResultadoMap(resultado)
        const nextCel = next.get(colab.id)?.get(deficit.data)
        if (!nextCel) continue

        nextCel.status = 'TRABALHO'
        nextCel.hora_inicio = minToTime(novoInicio)
        nextCel.hora_fim = minToTime(novoFim)
        nextCel.minutos_trabalho = minutosTrabalho
        nextCel.minutos = minutosTrabalho
        nextCel.hora_almoco_inicio = almocoInicio !== null ? minToTime(almocoInicio) : null
        nextCel.hora_almoco_fim = almocoFim !== null ? minToTime(almocoFim) : null
        nextCel.minutos_almoco = minutosAlmoco
        nextCel.intervalo_15min = intervalo15

        return {
          next,
          reason: `Ativou folga de ${colab.nome} em ${deficit.data} (turno ${turnoMin}min) para cobrir ${deficit.hora_inicio}-${deficit.hora_fim}`,
        }
      }
    }
  }

  return null
}
