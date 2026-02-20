import type {
  ColabMotor,
  CelulaMotor,
  SlotGrid,
  LookbackV3,
  Demanda,
  Feriado,
  Excecao,
  Empresa,
  PinnedCell,
} from '../validacao-compartilhada'
import {
  compareObjective,
  evaluateObjective,
  getDeficitSlots,
} from './objective'
import { proposeLunchReposition } from './neighborhoods/lunch-reposition'
import { proposeShiftBoundaryExtension } from './neighborhoods/shift-boundary'
import { proposeActivateDayOffForCriticalSlot } from './neighborhoods/move-dayoff'
import { proposeSwapColaborador } from './neighborhoods/swap-colaborador'
import { proposeSwapDay } from './neighborhoods/swap-day'

interface PolisherParams {
  base: Map<number, Map<string, CelulaMotor>>
  colaboradores: ColabMotor[]
  grid: SlotGrid[]
  dias: string[]
  demandas: Demanda[]
  feriados: Feriado[]
  excecoes: Excecao[]
  lookback: Map<number, LookbackV3>
  empresa: Empresa
  corteSemanal: string
  pinnedMap: Map<string, PinnedCell>
  maxIterations: number
}

export function runCriticalPolisher(params: PolisherParams): Map<number, Map<string, CelulaMotor>> {
  const {
    base,
    colaboradores,
    grid,
    dias,
    demandas,
    feriados,
    excecoes,
    lookback,
    empresa,
    corteSemanal,
    pinnedMap,
    maxIterations,
  } = params

  let best = base
  let evalBest = evaluateObjective({
    colaboradores,
    resultado: best,
    grid,
    dias,
    demandas,
    feriados,
    excecoes,
    lookback,
    empresa,
    corteSemanal,
  })

  for (let i = 0; i < maxIterations; i++) {
    const deficits = getDeficitSlots(evalBest, 4)
    if (deficits.length === 0) break

    const candidates = [
      proposeLunchReposition({ resultado: best, colaboradores, deficits, pinnedMap }),
      proposeShiftBoundaryExtension({ resultado: best, colaboradores, deficits, dias, pinnedMap }),
      proposeActivateDayOffForCriticalSlot({
        resultado: best,
        colaboradores,
        deficits,
        dias,
        grid,
        feriados,
        pinnedMap,
      }),
      proposeSwapColaborador({ resultado: best, colaboradores, deficits, dias, feriados, pinnedMap }),
      proposeSwapDay({ resultado: best, colaboradores, deficits, dias, feriados, pinnedMap }),
    ].filter((c): c is NonNullable<typeof c> => Boolean(c))

    if (candidates.length === 0) break

    let localBest = evalBest
    let localBestMap: Map<number, Map<string, CelulaMotor>> | null = null

    for (const cand of candidates) {
      const evalCand = evaluateObjective({
        colaboradores,
        resultado: cand.next,
        grid,
        dias,
        demandas,
        feriados,
        excecoes,
        lookback,
        empresa,
        corteSemanal,
      })
      if (compareObjective(evalCand.vector, localBest.vector) < 0) {
        localBest = evalCand
        localBestMap = cand.next
      }
    }

    if (!localBestMap) break
    best = localBestMap
    evalBest = localBest
  }

  return best
}
