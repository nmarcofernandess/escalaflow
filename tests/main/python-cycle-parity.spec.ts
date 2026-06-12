import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { gcd } from '../../src/shared/simula-ciclo'

const VENV_PY = path.join(
  __dirname,
  '../../.venv',
  process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python',
)

function runPythonCycleProbe(): Array<{ n: number; k: number; fast: number; phase1: number }> {
  const cmd = existsSync(VENV_PY) ? VENV_PY : 'python3'
  const code = String.raw`
import json
import sys

sys.path.insert(0, 'solver')
from solver_ortools import compute_cycle_length_weeks, _compute_cycle_weeks_fast

days = ['2026-03-02','2026-03-03','2026-03-04','2026-03-05','2026-03-06','2026-03-07','2026-03-08']
rows = []
for n in range(1, 11):
    for k in range(0, n + 1):
        colabs = [{'tipo_trabalhador': 'CLT'} for _ in range(n)]
        demand_by_slot = {(6, 0): k}
        demand_list = [{'dia_semana': 'DOM', 'min_pessoas': k}]
        rows.append({
            'n': n,
            'k': k,
            'phase1': compute_cycle_length_weeks(colabs, demand_by_slot, days),
            'fast': _compute_cycle_weeks_fast(colabs, demand_list),
        })
print(json.dumps(rows))
`
  const stdout = execFileSync(cmd, ['-c', code], {
    cwd: path.join(__dirname, '../..'),
    encoding: 'utf-8',
    timeout: 30_000,
  })
  return JSON.parse(stdout)
}

function runPythonPoolProbe(): { phase1: number; fast: number } {
  const cmd = existsSync(VENV_PY) ? VENV_PY : 'python3'
  const code = String.raw`
import json
import sys

sys.path.insert(0, 'solver')
from solver_ortools import compute_cycle_length_weeks, _compute_cycle_weeks_fast

days = ['2026-03-02','2026-03-03','2026-03-04','2026-03-05','2026-03-06','2026-03-07','2026-03-08']
colabs = [
    {'tipo_trabalhador': 'CLT'},
    {'tipo_trabalhador': 'CLT'},
    {'tipo_trabalhador': 'INTERMITENTE'},
    {'tipo_trabalhador': 'INTERMITENTE', 'folga_variavel_dia_semana': 'SEG'},
]
demand_by_slot = {(6, 0): 2}
demand_list = [{'dia_semana': 'DOM', 'min_pessoas': 2}]
print(json.dumps({
    'phase1': compute_cycle_length_weeks(colabs, demand_by_slot, days),
    'fast': _compute_cycle_weeks_fast(colabs, demand_list),
}))
`
  const stdout = execFileSync(cmd, ['-c', code], {
    cwd: path.join(__dirname, '../..'),
    encoding: 'utf-8',
    timeout: 30_000,
  })
  return JSON.parse(stdout)
}

describe('python domingo cycle diagnostics parity', () => {
  it('phase1 and fast diagnostics use N/gcd(N,K) for N=1..10 K=0..N', () => {
    for (const row of runPythonCycleProbe()) {
      const expected = row.k > 0 ? row.n / gcd(row.n, row.k) : 1
      expect(row.phase1, `phase1 N=${row.n} K=${row.k}`).toBe(expected)
      expect(row.fast, `fast N=${row.n} K=${row.k}`).toBe(expected)
    }
  })

  it('excludes intermitente Tipo A and includes Tipo B in the sunday pool', () => {
    const row = runPythonPoolProbe()
    // Pool efetivo: 2 CLTs + 1 intermitente Tipo B = 3; demanda DOM = 2; 3/gcd(3,2)=3.
    expect(row.phase1).toBe(3)
    expect(row.fast).toBe(3)
  })
})
