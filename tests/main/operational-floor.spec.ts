import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { enrichPreflightWithCapacityChecks } from '../../src/main/preflight-capacity'
import type { SolverInput } from '../../src/shared/types'

function pythonCmd(): string {
  const local = path.join(process.cwd(), '.venv/bin/python')
  return existsSync(local) ? local : 'python3'
}

function buildPreflightInput(): SolverInput {
  return {
    setor_id: 99,
    data_inicio: '2026-03-02',
    data_fim: '2026-03-02',
    piso_operacional: 2,
    empresa: {
      tolerancia_semanal_min: 0,
      hora_abertura: '08:00',
      hora_fechamento: '12:00',
      min_intervalo_almoco_min: 60,
      max_intervalo_almoco_min: 120,
      grid_minutos: 30,
    },
    colaboradores: [{
      id: 1,
      nome: 'CLT Unica',
      horas_semanais: 44,
      regime_escala: '5X2',
      dias_trabalho: 5,
      max_minutos_dia: 585,
      tipo_trabalhador: 'CLT',
      sexo: 'F',
      funcao_id: 1,
      rank: 1,
    }],
    demanda: [{
      dia_semana: 'SEG',
      hora_inicio: '08:00',
      hora_fim: '12:00',
      min_pessoas: 2,
      override: false,
    }],
    feriados: [],
    excecoes: [],
    pinned_cells: [],
    config: { num_workers: 1 },
  }
}

describe('operational floor', () => {
  it('enforces an attainable floor as a hard CP-SAT constraint', () => {
    const script = String.raw`
from ortools.sat.python import cp_model
from solver.constraints import add_operational_floor_hard

model = cp_model.CpModel()
work = {(0, 0, 0): model.NewBoolVar("w")}
add_operational_floor_hard(
    model,
    work,
    {(0, 0): 1},
    blocked_days={0: set()},
    C=1,
    D=1,
    S=1,
    piso_operacional=1,
)
solver = cp_model.CpSolver()
solver.parameters.num_search_workers = 1
status = solver.Solve(model)
assert status in (cp_model.OPTIMAL, cp_model.FEASIBLE), status
assert solver.Value(work[(0, 0, 0)]) == 1
`

    expect(() => execFileSync(pythonCmd(), ['-c', script], {
      cwd: process.cwd(),
      encoding: 'utf8',
      stdio: 'pipe',
    })).not.toThrow()
  })

  it('warns when the floor is structurally impossible in preflight', () => {
    const blockers: Array<{ codigo: string }> = []
    const warnings: Array<{ codigo: string; mensagem: string }> = []

    enrichPreflightWithCapacityChecks(buildPreflightInput(), blockers as any, warnings as any)

    expect(warnings.some((warning) => warning.codigo === 'PISO_OPERACIONAL_IMPOSSIVEL')).toBe(true)
    expect(warnings.find((warning) => warning.codigo === 'PISO_OPERACIONAL_IMPOSSIVEL')?.mensagem)
      .toContain('piso 2, disponiveis 1')
  })
})
