import type {
  ColabMotor,
  CelulaMotor,
  SlotGrid,
  Feriado,
  Excecao,
} from '../validacao-compartilhada'
import {
  timeToMin,
  isFeriadoProibido,
  isFeriadoSemCCT,
  isAprendiz,
  isEstagiario,
  isDomingo,
  calcMetaDiariaMin,
} from '../validacao-compartilhada'
import { canWorkBasic } from './utils'

export interface OptimizerPreflightIssue {
  code: string
  message: string
}

export interface OptimizerPreflightResult {
  ok: boolean
  blockers: OptimizerPreflightIssue[]
  warnings: OptimizerPreflightIssue[]
}

export interface PreflightParams {
  grid: SlotGrid[]
  colaboradores: ColabMotor[]
  dias: string[]
  feriados: Feriado[]
  excecoes: Excecao[]
  resultado: Map<number, Map<string, CelulaMotor>>
}

export function runOptimizerPreflight(params: PreflightParams): OptimizerPreflightResult {
  const { grid, colaboradores, dias, feriados, excecoes, resultado } = params
  const blockers: OptimizerPreflightIssue[] = []
  const warnings: OptimizerPreflightIssue[] = []

  // --- Check 1: Grid vazio ---
  if (grid.length === 0) {
    blockers.push({
      code: 'EMPTY_GRID',
      message: 'Grid de slots vazio para o período informado.',
    })
    return { ok: false, blockers, warnings }
  }

  // --- Check 2: Demanda zero ---
  const totalPlanejado = grid.reduce((acc, s) => acc + (s.dia_fechado ? 0 : s.target_planejado), 0)
  if (totalPlanejado <= 0) {
    warnings.push({
      code: 'ZERO_TARGET',
      message: 'Demanda planejada total do período é zero; otimização terá baixo efeito.',
    })
  }

  // --- Check 3: Capacidade vs Demanda ---
  // Somar horas disponiveis de todos os colabs no periodo vs horas demandadas
  const slotDurMin = grid.length > 0 ? timeToMin(grid[0].hora_fim) - timeToMin(grid[0].hora_inicio) : 30
  const horasDemandadas = grid
    .filter(s => !s.dia_fechado && !s.feriado_proibido)
    .reduce((acc, s) => acc + s.target_planejado * slotDurMin, 0)

  let horasDisponiveis = 0
  const numWeeks = Math.max(1, dias.length / 7)
  for (const colab of colaboradores) {
    const metaDiaria = calcMetaDiariaMin(colab.horas_semanais, colab.dias_trabalho)
    let diasTrabalhaveis = 0
    for (const d of dias) {
      if (canWorkBasic(colab, d, feriados, resultado, dias)) {
        // Checar excecoes
        const temExcecao = excecoes.some(e =>
          e.colaborador_id === colab.id && d >= e.data_inicio && d <= e.data_fim
        )
        if (!temExcecao) diasTrabalhaveis++
      }
    }
    // dias_trabalho e POR SEMANA — multiplicar pelo numero de semanas no periodo
    const maxDiasPeriodo = Math.ceil(colab.dias_trabalho * numWeeks)
    horasDisponiveis += Math.min(diasTrabalhaveis, maxDiasPeriodo) * metaDiaria
  }

  if (horasDemandadas > 0) {
    const ratio = horasDisponiveis / horasDemandadas
    if (ratio < 0.5) {
      blockers.push({
        code: 'CAPACITY_CRITICAL',
        message: `Capacidade total (${Math.round(horasDisponiveis / 60)}h) < 50% da demanda (${Math.round(horasDemandadas / 60)}h). Escala inviável.`,
      })
    } else if (ratio < 0.8) {
      warnings.push({
        code: 'CAPACITY_LOW',
        message: `Capacidade total (${Math.round(horasDisponiveis / 60)}h) cobre apenas ${Math.round(ratio * 100)}% da demanda (${Math.round(horasDemandadas / 60)}h).`,
      })
    }
  }

  // --- Check 4: Pico impossivel ---
  // Para cada slot, contar quantos colabs PODERIAM cobrir
  const activeSlots = grid.filter(s => !s.dia_fechado && !s.feriado_proibido)
  let picoImpossivel = 0
  for (const slot of activeSlots) {
    if (slot.target_planejado <= 0) continue
    let possiveis = 0
    for (const colab of colaboradores) {
      if (!canWorkBasic(colab, slot.data, feriados)) continue
      const temExcecao = excecoes.some(e =>
        e.colaborador_id === colab.id && slot.data >= e.data_inicio && slot.data <= e.data_fim
      )
      if (temExcecao) continue
      possiveis++
    }
    if (possiveis < slot.target_planejado) {
      picoImpossivel++
      if (picoImpossivel <= 3) {
        warnings.push({
          code: 'PEAK_IMPOSSIBLE',
          message: `Slot ${slot.data} ${slot.hora_inicio}-${slot.hora_fim}: apenas ${possiveis} colabs disponíveis para target ${slot.target_planejado}.`,
        })
      }
    }
  }
  if (picoImpossivel > 3) {
    warnings.push({
      code: 'PEAK_IMPOSSIBLE_MANY',
      message: `${picoImpossivel} slots com target impossível de atingir (mostrados 3 primeiros).`,
    })
  }

  return {
    ok: blockers.length === 0,
    blockers,
    warnings,
  }
}
