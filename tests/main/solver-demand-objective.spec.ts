import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

function pythonCmd(): string {
  const local = path.join(process.cwd(), '.venv/bin/python')
  return existsSync(local) ? local : 'python3'
}

describe('solver demand objective', () => {
  it('prioritizes avoiding a zero-covered low-target slot over shaving a high-target slot', () => {
    const script = String.raw`
from ortools.sat.python import cp_model
from solver.constraints import add_demand_soft

model = cp_model.CpModel()
work = {
    (0, 0, 0): model.NewBoolVar("w_0"),
    (0, 0, 1): model.NewBoolVar("w_1"),
}
model.Add(work[(0, 0, 0)] + work[(0, 0, 1)] == 1)

deficit, deficit_terms, slot_zero = add_demand_soft(
    model,
    work,
    {(0, 0): 4, (0, 1): 1},
    C=1,
    D=1,
    S=2,
)
model.Minimize(sum(deficit_terms) + 50000 * sum(slot_zero))

solver = cp_model.CpSolver()
solver.parameters.num_search_workers = 1
status = solver.Solve(model)
assert status in (cp_model.OPTIMAL, cp_model.FEASIBLE), status
assert solver.Value(work[(0, 0, 1)]) == 1, {
    "covered_high_target": solver.Value(work[(0, 0, 0)]),
    "covered_low_target": solver.Value(work[(0, 0, 1)]),
    "deficit_high": solver.Value(deficit[(0, 0)]),
    "deficit_low": solver.Value(deficit[(0, 1)]),
    "slot_zero": [solver.Value(v) for v in slot_zero],
}
`

    expect(() => execFileSync(pythonCmd(), ['-c', script], {
      cwd: process.cwd(),
      encoding: 'utf8',
      stdio: 'pipe',
    })).not.toThrow()
  })
})
