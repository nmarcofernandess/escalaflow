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
import { runAnytimeSearch, type NeighborhoodStats } from './anytime-search'
import { runOptimizerPreflight, type OptimizerPreflightIssue } from './preflight'
import { overwriteResultadoMap } from './utils'
import { compareObjective } from './objective'

export interface OptimizerV2Params {
  resultado: Map<number, Map<string, CelulaMotor>>
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

export interface OptimizerV2Result {
  enabled: boolean
  applied: boolean
  elapsedMs: number
  iterations: number
  acceptedMoves: number
  before: {
    hard: number
    overrideDeficit: number
    deficitTotal: number
    excessoTotal: number
  }
  after: {
    hard: number
    overrideDeficit: number
    deficitTotal: number
    excessoTotal: number
  }
  neighborhoods: Record<string, NeighborhoodStats>
  temperatureFinal: number
  stagnationEvents: number
  preflight: {
    blockers: OptimizerPreflightIssue[]
    warnings: OptimizerPreflightIssue[]
  }
  reason?: string
}

function runMultiStart(params: OptimizerV2Params): ReturnType<typeof runAnytimeSearch> {
  const budget = params.maxMs
  const runs = 3
  const perRunMs = Math.floor(budget / runs)
  const perRunIter = Math.floor(params.maxIterations / runs)

  // Seed 1: resultado original
  const result1 = runAnytimeSearch({
    ...params,
    initial: params.resultado,
    maxMs: perRunMs,
    maxIterations: perRunIter,
  })

  // Seed 2: shuffle ordem dos colaboradores (muda prioridade de alocacao)
  const shuffledColabs = [...params.colaboradores].sort(() => Math.random() - 0.5)
  const result2 = runAnytimeSearch({
    ...params,
    initial: params.resultado,
    colaboradores: shuffledColabs,
    maxMs: perRunMs,
    maxIterations: perRunIter,
  })

  // Seed 3: usa o melhor da seed1 como ponto de partida
  const result3 = runAnytimeSearch({
    ...params,
    initial: result1.best,
    maxMs: perRunMs,
    maxIterations: perRunIter,
  })

  // Pegar o melhor dos 3
  const candidates = [result1, result2, result3]
  let bestResult = result1
  for (const r of candidates) {
    if (compareObjective(r.after.vector, bestResult.after.vector) < 0) {
      bestResult = r
    }
  }

  // Merge stats
  const mergedNeighborhoods: Record<string, NeighborhoodStats> = {}
  for (const r of candidates) {
    for (const [name, stats] of Object.entries(r.neighborhoods)) {
      if (!mergedNeighborhoods[name]) {
        mergedNeighborhoods[name] = { attempts: 0, accepted: 0 }
      }
      mergedNeighborhoods[name].attempts += stats.attempts
      mergedNeighborhoods[name].accepted += stats.accepted
    }
  }

  return {
    best: bestResult.best,
    before: result1.before,
    after: bestResult.after,
    iterations: candidates.reduce((s, r) => s + r.iterations, 0),
    acceptedMoves: candidates.reduce((s, r) => s + r.acceptedMoves, 0),
    neighborhoods: mergedNeighborhoods,
    temperatureFinal: bestResult.temperatureFinal,
    stagnationEvents: candidates.reduce((s, r) => s + r.stagnationEvents, 0),
  }
}

export function runOptimizerV2(params: OptimizerV2Params): OptimizerV2Result {
  const startedAt = performance.now()
  const preflight = runOptimizerPreflight({
    grid: params.grid,
    colaboradores: params.colaboradores,
    dias: params.dias,
    feriados: params.feriados,
    excecoes: params.excecoes,
    resultado: params.resultado,
  })

  const emptyNeighborhoods: Record<string, NeighborhoodStats> = {}
  const emptyPreflight = { blockers: preflight.blockers, warnings: preflight.warnings }
  const emptyVector = { hard: 0, overrideDeficit: 0, deficitTotal: 0, excessoTotal: 0 }

  if (!preflight.ok) {
    return {
      enabled: false,
      applied: false,
      elapsedMs: performance.now() - startedAt,
      iterations: 0,
      acceptedMoves: 0,
      before: { ...emptyVector },
      after: { ...emptyVector },
      neighborhoods: emptyNeighborhoods,
      temperatureFinal: 0,
      stagnationEvents: 0,
      preflight: emptyPreflight,
      reason: preflight.blockers[0]?.message ?? 'Preflight do optimizer falhou',
    }
  }

  // Fase 7: Multi-start se budget > 30s
  const useMultiStart = params.maxMs > 30000
  const search = useMultiStart
    ? runMultiStart(params)
    : runAnytimeSearch({
        initial: params.resultado,
        colaboradores: params.colaboradores,
        grid: params.grid,
        dias: params.dias,
        demandas: params.demandas,
        feriados: params.feriados,
        excecoes: params.excecoes,
        lookback: params.lookback,
        empresa: params.empresa,
        corteSemanal: params.corteSemanal,
        pinnedMap: params.pinnedMap,
        maxMs: params.maxMs,
        maxIterations: params.maxIterations,
      })

  const applied = search.acceptedMoves > 0
  if (applied) {
    overwriteResultadoMap(params.resultado, search.best)
  }

  return {
    enabled: true,
    applied,
    elapsedMs: performance.now() - startedAt,
    iterations: search.iterations,
    acceptedMoves: search.acceptedMoves,
    before: {
      hard: search.before.vector.hard,
      overrideDeficit: search.before.vector.override_deficit,
      deficitTotal: search.before.vector.deficit_total,
      excessoTotal: search.before.vector.excesso_total,
    },
    after: {
      hard: search.after.vector.hard,
      overrideDeficit: search.after.vector.override_deficit,
      deficitTotal: search.after.vector.deficit_total,
      excessoTotal: search.after.vector.excesso_total,
    },
    neighborhoods: search.neighborhoods,
    temperatureFinal: search.temperatureFinal,
    stagnationEvents: search.stagnationEvents,
    preflight: emptyPreflight,
    reason: preflight.warnings[0]?.message,
  }
}
