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
  type ObjectiveEvaluation,
  type ObjectiveVector,
} from './objective'
import { proposeLunchReposition } from './neighborhoods/lunch-reposition'
import { proposeShiftBoundaryExtension } from './neighborhoods/shift-boundary'
import { proposeActivateDayOffForCriticalSlot } from './neighborhoods/move-dayoff'
import { proposeSwapColaborador } from './neighborhoods/swap-colaborador'
import { proposeSwapDay } from './neighborhoods/swap-day'
import { runCriticalPolisher } from './critical-polisher'

export interface AnytimeSearchParams {
  initial: Map<number, Map<string, CelulaMotor>>
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
  maxMs: number
  maxIterations: number
}

export interface NeighborhoodStats {
  attempts: number
  accepted: number
}

export interface AnytimeSearchResult {
  best: Map<number, Map<string, CelulaMotor>>
  before: ObjectiveEvaluation
  after: ObjectiveEvaluation
  iterations: number
  acceptedMoves: number
  neighborhoods: Record<string, NeighborhoodStats>
  temperatureFinal: number
  stagnationEvents: number
}

type NeighborhoodName = 'lunch_reposition' | 'shift_boundary' | 'move_dayoff' | 'swap_colaborador' | 'swap_day'

interface NeighborhoodTracker {
  name: NeighborhoodName
  attempts: number
  successes: number
  score(): number
}

function createTracker(name: NeighborhoodName): NeighborhoodTracker {
  return {
    name,
    attempts: 0,
    successes: 0,
    score() {
      // Laplace smoothing — evita divisao por zero e cold start
      return (this.successes + 1) / (this.attempts + 2)
    },
  }
}

/** Seleciona vizinhanca por roulette wheel proporcional ao score */
function selectNeighborhood(trackers: NeighborhoodTracker[]): NeighborhoodTracker {
  const totalScore = trackers.reduce((acc, t) => acc + t.score(), 0)
  let r = Math.random() * totalScore
  for (const t of trackers) {
    r -= t.score()
    if (r <= 0) return t
  }
  return trackers[trackers.length - 1]
}

/** Calcula delta escalar entre dois vetores objetivo (para acceptance probability) */
function objectiveDelta(candidate: ObjectiveVector, best: ObjectiveVector): number {
  // Peso lexico: hard tem peso enorme, deficit/excesso baixo
  const dHard = (candidate.hard - best.hard) * 1000
  const dOverride = (candidate.override_deficit - best.override_deficit) * 10
  const dDeficit = (candidate.deficit_total - best.deficit_total) * 5
  const dExcesso = (candidate.excesso_total - best.excesso_total) * 1
  return dHard + dOverride + dDeficit + dExcesso
}

export function runAnytimeSearch(params: AnytimeSearchParams): AnytimeSearchResult {
  const {
    initial,
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
    maxMs,
    maxIterations,
  } = params

  const startedAt = performance.now()
  const deadline = startedAt + Math.max(150, maxMs)

  const evaluate = (resultado: Map<number, Map<string, CelulaMotor>>) => evaluateObjective({
    colaboradores,
    resultado,
    grid,
    dias,
    demandas,
    feriados,
    excecoes,
    lookback,
    empresa,
    corteSemanal,
  })

  const evalInitial = evaluate(initial)
  let best = initial
  let evalBest = evalInitial
  let current = initial
  let evalCurrent = evalInitial
  let acceptedMoves = 0
  let stagnation = 0
  let stagnationEvents = 0
  let iterations = 0

  // --- Simulated Annealing config ---
  const budgetMs = Math.max(150, maxMs)
  const tempInicial = 1.0
  const tempFinal = 0.01
  // cooling_rate calculado pelo budget: mais tempo = resfriamento mais lento
  const totalExpectedIterations = Math.min(maxIterations, Math.floor(budgetMs / 5))
  const coolingRate = totalExpectedIterations > 0
    ? Math.pow(tempFinal / tempInicial, 1 / Math.max(1, totalExpectedIterations))
    : 0.95
  let temperatura = tempInicial

  // --- Adaptive neighborhood trackers ---
  const trackers: NeighborhoodTracker[] = [
    createTracker('lunch_reposition'),
    createTracker('shift_boundary'),
    createTracker('move_dayoff'),
    createTracker('swap_colaborador'),
    createTracker('swap_day'),
  ]
  const RESET_INTERVAL = 40

  while (performance.now() < deadline && iterations < maxIterations) {
    const deficits = getDeficitSlots(evalCurrent, 10)
    if (deficits.length === 0) break

    // Selecao adaptativa de vizinhanca
    const tracker = selectNeighborhood(trackers)
    tracker.attempts++

    let candidate: { next: Map<number, Map<string, CelulaMotor>>; reason: string } | null = null

    switch (tracker.name) {
      case 'lunch_reposition':
        candidate = proposeLunchReposition({ resultado: current, colaboradores, deficits, pinnedMap })
        break
      case 'shift_boundary':
        candidate = proposeShiftBoundaryExtension({ resultado: current, colaboradores, deficits, dias, pinnedMap })
        break
      case 'move_dayoff':
        candidate = proposeActivateDayOffForCriticalSlot({
          resultado: current, colaboradores, deficits, dias, grid, feriados, pinnedMap,
        })
        break
      case 'swap_colaborador':
        candidate = proposeSwapColaborador({
          resultado: current, colaboradores, deficits, dias, feriados, pinnedMap,
        })
        break
      case 'swap_day':
        candidate = proposeSwapDay({
          resultado: current, colaboradores, deficits, dias, feriados, pinnedMap,
        })
        break
    }

    iterations++

    if (!candidate) {
      stagnation++
      // Reset adaptive scores periodicamente
      if (iterations % RESET_INTERVAL === 0) {
        for (const t of trackers) {
          t.attempts = Math.floor(t.attempts / 2)
          t.successes = Math.floor(t.successes / 2)
        }
      }
      // Critical polisher em stagnation
      if (stagnation >= 18 && performance.now() < deadline) {
        stagnationEvents++
        const polished = runCriticalPolisher({
          base: current,
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
          maxIterations: 6,
        })
        const evalPolished = evaluate(polished)
        if (compareObjective(evalPolished.vector, evalBest.vector) < 0) {
          best = polished
          evalBest = evalPolished
          current = polished
          evalCurrent = evalPolished
          acceptedMoves++
        }
        stagnation = 0
      }
      temperatura *= coolingRate
      continue
    }

    const evalCand = evaluate(candidate.next)
    const cmp = compareObjective(evalCand.vector, evalCurrent.vector)

    if (cmp < 0) {
      // Estritamente melhor → aceita sempre
      current = candidate.next
      evalCurrent = evalCand
      tracker.successes++
      stagnation = 0

      // Atualizar global best se melhor
      if (compareObjective(evalCand.vector, evalBest.vector) < 0) {
        best = candidate.next
        evalBest = evalCand
      }
      acceptedMoves++
    } else {
      // Igual ou pior → SA acceptance (NUNCA aceitar se HARD > 0)
      const delta = objectiveDelta(evalCand.vector, evalCurrent.vector)
      const safeToAccept = evalCand.vector.hard === 0

      if (safeToAccept && delta > 0 && temperatura > tempFinal) {
        const acceptProb = Math.exp(-delta / (temperatura * 10))
        if (Math.random() < acceptProb) {
          current = candidate.next
          evalCurrent = evalCand
          tracker.successes++
          stagnation = 0
          // NAO atualizar global best — este move e pior
        } else {
          stagnation++
        }
      } else {
        stagnation++
      }
    }

    temperatura *= coolingRate

    // Reset adaptive scores periodicamente
    if (iterations % RESET_INTERVAL === 0) {
      for (const t of trackers) {
        t.attempts = Math.floor(t.attempts / 2)
        t.successes = Math.floor(t.successes / 2)
      }
    }
  }

  // Montar stats por vizinhanca
  const neighborhoods: Record<string, NeighborhoodStats> = {}
  for (const t of trackers) {
    neighborhoods[t.name] = { attempts: t.attempts, accepted: t.successes }
  }

  return {
    best,
    before: evalInitial,
    after: evalBest,
    iterations,
    acceptedMoves,
    neighborhoods,
    temperatureFinal: temperatura,
    stagnationEvents,
  }
}
