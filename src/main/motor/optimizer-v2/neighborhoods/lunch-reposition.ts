import type {
  ColabMotor,
  CelulaMotor,
  PinnedCell,
} from '../../validacao-compartilhada'
import {
  timeToMin,
  minToTime,
} from '../../validacao-compartilhada'
import type { DeficitSlot } from '../objective'
import { cloneResultadoMap, isPinnedCell } from '../utils'

export interface NeighborhoodCandidate {
  next: Map<number, Map<string, CelulaMotor>>
  reason: string
}

interface Params {
  resultado: Map<number, Map<string, CelulaMotor>>
  colaboradores: ColabMotor[]
  deficits: DeficitSlot[]
  pinnedMap: Map<string, PinnedCell>
}

export function proposeLunchReposition(params: Params): NeighborhoodCandidate | null {
  const { resultado, colaboradores, deficits, pinnedMap } = params

  for (const deficit of deficits) {
    const slotStart = timeToMin(deficit.hora_inicio)
    const slotEnd = timeToMin(deficit.hora_fim)

    for (const colab of colaboradores) {
      if (isPinnedCell(pinnedMap, colab.id, deficit.data)) continue

      const cel = resultado.get(colab.id)?.get(deficit.data)
      if (!cel || cel.status !== 'TRABALHO') continue
      if (!cel.hora_inicio || !cel.hora_fim) continue
      if (!cel.hora_almoco_inicio || !cel.hora_almoco_fim || cel.minutos_almoco <= 0) continue

      const turnoInicio = timeToMin(cel.hora_inicio)
      const turnoFim = timeToMin(cel.hora_fim)
      const almocoInicio = timeToMin(cel.hora_almoco_inicio)
      const almocoFim = timeToMin(cel.hora_almoco_fim)

      const slotDentroDoAlmoco = slotStart >= almocoInicio && slotEnd <= almocoFim
      if (!slotDentroDoAlmoco) continue

      for (const offset of [30, 60, -30, -60]) {
        const novoAlmocoInicio = almocoInicio + offset
        const novoAlmocoFim = novoAlmocoInicio + cel.minutos_almoco

        if (novoAlmocoInicio < turnoInicio || novoAlmocoFim > turnoFim) continue
        if (novoAlmocoInicio - turnoInicio < 120) continue
        if (turnoFim - novoAlmocoFim < 120) continue

        const novoColide = slotStart >= novoAlmocoInicio && slotEnd <= novoAlmocoFim
        if (novoColide) continue

        const next = cloneResultadoMap(resultado)
        const nextCel = next.get(colab.id)?.get(deficit.data)
        if (!nextCel) continue

        nextCel.hora_almoco_inicio = minToTime(novoAlmocoInicio)
        nextCel.hora_almoco_fim = minToTime(novoAlmocoFim)

        return {
          next,
          reason: `Reposicionou almoço de ${colab.nome} em ${deficit.data} para cobrir ${deficit.hora_inicio}-${deficit.hora_fim}`,
        }
      }
    }
  }

  return null
}
