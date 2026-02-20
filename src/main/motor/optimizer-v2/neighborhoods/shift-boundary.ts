import type {
  ColabMotor,
  CelulaMotor,
  PinnedCell,
} from '../../validacao-compartilhada'
import {
  CLT,
  timeToMin,
  minToTime,
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
  pinnedMap: Map<string, PinnedCell>
}

export function proposeShiftBoundaryExtension(params: Params): NeighborhoodCandidate | null {
  const { resultado, colaboradores, deficits, dias, pinnedMap } = params

  for (const deficit of deficits) {
    const slotStart = timeToMin(deficit.hora_inicio)
    const slotEnd = timeToMin(deficit.hora_fim)

    for (const colab of colaboradores) {
      if (isPinnedCell(pinnedMap, colab.id, deficit.data)) continue

      const cel = resultado.get(colab.id)?.get(deficit.data)
      if (!cel || cel.status !== 'TRABALHO' || !cel.hora_inicio || !cel.hora_fim) continue

      const inicioAtual = timeToMin(cel.hora_inicio)
      const fimAtual = timeToMin(cel.hora_fim)
      const hasAlmoco = Boolean(cel.hora_almoco_inicio && cel.hora_almoco_fim && cel.minutos_almoco > 0)

      const candidates: Array<{ novoInicio: number; novoFim: number; novoMinutos: number; label: string }> = []

      // Estender para frente (cobrir slot que começa imediatamente após fim atual).
      if (fimAtual === slotStart) {
        const novoInicio = inicioAtual
        const novoFim = fimAtual + CLT.GRID_MINUTOS
        const novoMinutos = cel.minutos_trabalho + CLT.GRID_MINUTOS
        candidates.push({ novoInicio, novoFim, novoMinutos, label: 'extend-end' })
      }

      // Estender para trás (cobrir slot que termina imediatamente antes do início atual).
      if (inicioAtual === slotEnd) {
        const novoInicio = inicioAtual - CLT.GRID_MINUTOS
        const novoFim = fimAtual
        const novoMinutos = cel.minutos_trabalho + CLT.GRID_MINUTOS
        candidates.push({ novoInicio, novoFim, novoMinutos, label: 'extend-start' })
      }

      for (const cand of candidates) {
        if (cand.novoInicio < 0 || cand.novoFim > 24 * 60) continue
        if (cand.novoMinutos > colab.max_minutos_dia) continue
        // Se ultrapassar 6h sem almoço, não arriscar aqui.
        if (!hasAlmoco && cand.novoMinutos > CLT.LIMIAR_ALMOCO_MIN) continue

        // H20 (2h antes/depois do almoço) deve continuar válido.
        if (hasAlmoco && cel.hora_almoco_inicio && cel.hora_almoco_fim) {
          const almocoInicio = timeToMin(cel.hora_almoco_inicio)
          const almocoFim = timeToMin(cel.hora_almoco_fim)
          if (almocoInicio - cand.novoInicio < 120) continue
          if (cand.novoFim - almocoFim < 120) continue
        }

        if (!checkInterjornada(resultado, colab.id, dias, deficit.data, cand.novoInicio, cand.novoFim)) continue

        const next = cloneResultadoMap(resultado)
        const nextCel = next.get(colab.id)?.get(deficit.data)
        if (!nextCel) continue

        nextCel.hora_inicio = minToTime(cand.novoInicio)
        nextCel.hora_fim = minToTime(cand.novoFim)
        nextCel.minutos_trabalho = cand.novoMinutos
        nextCel.minutos = cand.novoMinutos
        nextCel.intervalo_15min =
          nextCel.minutos_almoco === 0
          && nextCel.minutos_trabalho > CLT.LIMIAR_INTERVALO_CURTO_MIN
          && nextCel.minutos_trabalho <= CLT.LIMIAR_ALMOCO_MIN

        return {
          next,
          reason: `Estendeu borda de turno (${cand.label}) de ${colab.nome} em ${deficit.data} para cobrir ${deficit.hora_inicio}-${deficit.hora_fim}`,
        }
      }
    }
  }

  return null
}
