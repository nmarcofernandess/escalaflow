import type {
  ColabMotor,
  CelulaMotor,
  SlotGrid,
  LookbackV3,
  Demanda,
  Feriado,
  Excecao,
  Empresa,
  SlotComparacao,
} from '../validacao-compartilhada'
import {
  gerarSlotComparacao,
  validarTudoV3,
} from '../validacao-compartilhada'

export interface ObjectiveVector {
  hard: number
  override_deficit: number
  deficit_total: number
  excesso_total: number
}

export interface ObjectiveEvaluation {
  vector: ObjectiveVector
  comparacao: SlotComparacao[]
}

export interface EvaluateObjectiveParams {
  colaboradores: ColabMotor[]
  resultado: Map<number, Map<string, CelulaMotor>>
  grid: SlotGrid[]
  dias: string[]
  demandas: Demanda[]
  feriados: Feriado[]
  excecoes: Excecao[]
  lookback: Map<number, LookbackV3>
  empresa: Empresa
  corteSemanal: string
}

export interface DeficitSlot {
  data: string
  hora_inicio: string
  hora_fim: string
  shortage: number
  override: boolean
}

export function evaluateObjective(params: EvaluateObjectiveParams): ObjectiveEvaluation {
  const {
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
  } = params

  const hard = validarTudoV3({
    colaboradores,
    resultado,
    demandas,
    dias,
    feriados,
    excecoes,
    lookback,
    tolerancia_min: empresa.tolerancia_semanal_min ?? 30,
    empresa,
    corte_semanal: corteSemanal,
  }).filter(v => v.severidade === 'HARD').length

  const comparacao = gerarSlotComparacao({
    grid,
    colaboradores,
    resultado,
    dias,
  })

  let overrideDeficit = 0
  let deficitTotal = 0
  let excessoTotal = 0

  for (const slot of comparacao) {
    if (slot.delta < 0) {
      const shortage = Math.abs(slot.delta)
      deficitTotal += shortage
      if (slot.override) overrideDeficit += shortage
    } else if (slot.delta > 0) {
      excessoTotal += slot.delta
    }
  }

  return {
    vector: {
      hard,
      override_deficit: overrideDeficit,
      deficit_total: deficitTotal,
      excesso_total: excessoTotal,
    },
    comparacao,
  }
}

export function compareObjective(a: ObjectiveVector, b: ObjectiveVector): number {
  // Menor é melhor (ordem lexicográfica do RFC).
  const keys: Array<keyof ObjectiveVector> = [
    'hard',
    'override_deficit',
    'deficit_total',
    'excesso_total',
  ]

  for (const key of keys) {
    if (a[key] < b[key]) return -1
    if (a[key] > b[key]) return 1
  }

  return 0
}

export function getDeficitSlots(evaluation: ObjectiveEvaluation, limit = 12): DeficitSlot[] {
  return evaluation.comparacao
    .filter(s => s.delta < 0)
    .map((s) => ({
      data: s.data,
      hora_inicio: s.hora_inicio,
      hora_fim: s.hora_fim,
      shortage: Math.abs(s.delta),
      override: s.override,
    }))
    .sort((a, b) => {
      // 1) override primeiro
      if (a.override !== b.override) return a.override ? -1 : 1
      // 2) maior déficit primeiro
      if (a.shortage !== b.shortage) return b.shortage - a.shortage
      // 3) estabilidade determinística
      return `${a.data}-${a.hora_inicio}`.localeCompare(`${b.data}-${b.hora_inicio}`)
    })
    .slice(0, limit)
}
