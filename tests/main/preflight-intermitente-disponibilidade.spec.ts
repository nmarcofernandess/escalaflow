import { describe, it, expect } from 'vitest'
import { enrichPreflightWithCapacityChecks } from '../../src/main/preflight-capacity'
import type { SolverInput } from '../../src/shared/types'

function buildInput(withSundayRule: boolean): SolverInput {
  return {
    setor_id: 77,
    data_inicio: '2026-03-08',
    data_fim: '2026-03-08',
    empresa: {
      tolerancia_semanal_min: 60,
      hora_abertura: '08:00',
      hora_fechamento: '14:00',
      min_intervalo_almoco_min: 60,
      max_intervalo_almoco_min: 120,
      grid_minutos: 30,
    },
    colaboradores: [{
      id: 1,
      nome: 'Maria Clara',
      horas_semanais: 6,
      regime_escala: '5X2',
      dias_trabalho: 1,
      max_minutos_dia: 360,
      tipo_trabalhador: 'INTERMITENTE',
      sexo: 'F',
      funcao_id: 1,
      rank: 1,
    }],
    demanda: [{
      dia_semana: 'DOM',
      hora_inicio: '08:00',
      hora_fim: '14:00',
      min_pessoas: 1,
      override: false,
    }],
    feriados: [],
    excecoes: [],
    pinned_cells: [],
    regras_colaborador_dia: withSundayRule ? [{
      colaborador_id: 1,
      data: '2026-03-08',
      inicio_min: null,
      inicio_max: null,
      fim_min: null,
      fim_max: null,
      preferencia_turno_soft: null,
      domingo_forcar_folga: false,
      folga_fixa: false,
    }] : [],
    config: {
      num_workers: 1,
    },
  }
}

describe('preflight capacity for intermitente availability', () => {
  it('accepts intermitente with active day even when the day has no explicit time window', () => {
    const blockers: ReturnType<typeof buildBlockers> = []
    const warnings: ReturnType<typeof buildBlockers> = []

    enrichPreflightWithCapacityChecks(buildInput(true), blockers, warnings)

    expect(blockers).toHaveLength(0)
  })

  it('blocks when an intermitente has no explicit active rule for the demanded day', () => {
    const blockers: ReturnType<typeof buildBlockers> = []
    const warnings: ReturnType<typeof buildBlockers> = []

    enrichPreflightWithCapacityChecks(buildInput(false), blockers, warnings)

    expect(blockers.some((blocker) => blocker.codigo === 'DOMINGO_SEM_COLABORADORES')).toBe(true)
  })
})

function buildBlockers() {
  return [] as Array<{
    codigo: string
    severidade: string
    mensagem: string
    detalhe?: string
  }>
}
