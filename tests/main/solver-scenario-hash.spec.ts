import { describe, expect, it } from 'vitest'
import { computeSolverScenarioHash } from '../../src/main/motor/solver-bridge'
import type { SolverInput } from '../../src/shared/types'

function buildInput(pisoOperacional: number): SolverInput {
  return {
    setor_id: 1,
    data_inicio: '2026-03-02',
    data_fim: '2026-03-08',
    piso_operacional: pisoOperacional,
    empresa: {
      tolerancia_semanal_min: 30,
      hora_abertura: '08:00',
      hora_fechamento: '20:00',
      min_intervalo_almoco_min: 60,
      max_intervalo_almoco_min: 120,
      grid_minutos: 30,
      horario_por_dia: {},
    },
    colaboradores: [
      {
        id: 1,
        nome: 'Ana',
        horas_semanais: 44,
        regime_escala: '5X2',
        dias_trabalho: 5,
        max_minutos_dia: 585,
        tipo_trabalhador: 'CLT',
        sexo: 'F',
        rank: 1,
      },
    ],
    demanda: [
      {
        dia_semana: 'SEG',
        hora_inicio: '08:00',
        hora_fim: '12:00',
        min_pessoas: 1,
        override: false,
      },
    ],
    feriados: [],
    excecoes: [],
    pinned_cells: [],
    config: {
      solve_mode: 'rapido',
      num_workers: 1,
      generation_mode: 'OFFICIAL',
      rules: {},
    },
  }
}

describe('solver scenario hash', () => {
  it('changes when the operational floor changes', () => {
    expect(computeSolverScenarioHash(buildInput(1))).not.toBe(computeSolverScenarioHash(buildInput(2)))
  })
})
