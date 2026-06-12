import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

function pythonCmd(): string {
  const local = path.join(process.cwd(), '.venv/bin/python')
  return existsSync(local) ? local : 'python3'
}

function runPython(script: string): void {
  execFileSync(pythonCmd(), ['-c', script], {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: 'pipe',
    env: {
      ...process.env,
      PYTHONPATH: path.join(process.cwd(), 'solver'),
    },
  })
}

describe('solver pass 1 regressions', () => {
  it('permite intervalo relativo em turno longo de tarde', () => {
    const script = String.raw`
import solver_ortools as so

data = {
    "setor_id": 1,
    "data_inicio": "2026-06-15",
    "data_fim": "2026-06-15",
    "piso_operacional": 0,
    "empresa": {
        "tolerancia_semanal_min": 0,
        "hora_abertura": "14:00",
        "hora_fechamento": "22:00",
        "min_intervalo_almoco_min": 60,
        "max_intervalo_almoco_min": 120,
        "grid_minutos": 15,
    },
    "colaboradores": [{
        "id": 1,
        "nome": "Tarde CLT",
        "sexo": "F",
        "tipo_trabalhador": "CLT",
        "horas_semanais": 49,
        "dias_trabalho": 1,
        "max_minutos_dia": 585,
        "rank": 1,
    }],
    "demanda": [{
        "dia_semana": "SEG",
        "hora_inicio": "14:00",
        "hora_fim": "22:00",
        "min_pessoas": 1,
        "override": False,
    }],
    "feriados": [],
    "excecoes": [],
    "pinned_cells": [],
    "config": {"num_workers": 2, "patience_s": 1, "max_time_seconds": 8},
}

res = so._solve_pass(data, pass_num=1, relaxations=[], max_time=8, patience_s=1, num_workers=2, pinned_folga=None)
assert res["sucesso"], res
aloc = res["alocacoes"][0]
assert aloc["hora_almoco_inicio"] is not None, aloc
assert aloc["minutos_trabalho"] == 420, aloc
`

    expect(() => runPython(script)).not.toThrow()
  })

  it('nao deixa headcount dominical hard derrubar Pass 1 quando demanda ja e soft', () => {
    const script = String.raw`
import solver_ortools as so

rules = {
    "H1": "HARD", "H2": "HARD", "H4": "HARD", "H5": "HARD", "H6": "HARD",
    "H10": "OFF", "H15": "HARD", "H3_DOM_CICLO_EXATO": "SOFT",
    "H3_DOM_MAX_CONSEC_M": "HARD", "H3_DOM_MAX_CONSEC_F": "HARD",
    "H16": "HARD", "H17": "HARD", "H18": "HARD",
    "DIAS_TRABALHO": "HARD", "MIN_DIARIO": "HARD",
    "S_DEFICIT": "ON", "S_SURPLUS": "ON", "S_DOMINGO_CICLO": "ON",
    "S_TURNO_PREF": "ON", "S_CONSISTENCIA": "ON", "S_SPREAD": "ON",
}

data = {
    "setor_id": 1,
    "data_inicio": "2026-06-15",
    "data_fim": "2026-06-28",
    "piso_operacional": 0,
    "empresa": {
        "tolerancia_semanal_min": 0,
        "hora_abertura": "07:00",
        "hora_fechamento": "15:00",
        "min_intervalo_almoco_min": 60,
        "max_intervalo_almoco_min": 120,
        "grid_minutos": 30,
    },
    "colaboradores": [
        {"id": 1, "nome": "A", "sexo": "F", "tipo_trabalhador": "CLT", "horas_semanais": 0, "dias_trabalho": 6, "max_minutos_dia": 585, "rank": 1},
        {"id": 2, "nome": "B", "sexo": "F", "tipo_trabalhador": "CLT", "horas_semanais": 0, "dias_trabalho": 6, "max_minutos_dia": 585, "rank": 1},
    ],
    "demanda": [
        {"dia_semana": "SEG", "hora_inicio": "07:00", "hora_fim": "11:00", "min_pessoas": 1, "override": False},
        {"dia_semana": "TER", "hora_inicio": "07:00", "hora_fim": "11:00", "min_pessoas": 1, "override": False},
        {"dia_semana": "QUA", "hora_inicio": "07:00", "hora_fim": "11:00", "min_pessoas": 1, "override": False},
        {"dia_semana": "QUI", "hora_inicio": "07:00", "hora_fim": "11:00", "min_pessoas": 1, "override": False},
        {"dia_semana": "SEX", "hora_inicio": "07:00", "hora_fim": "11:00", "min_pessoas": 1, "override": False},
        {"dia_semana": "SAB", "hora_inicio": "07:00", "hora_fim": "11:00", "min_pessoas": 1, "override": False},
        {"dia_semana": "DOM", "hora_inicio": "07:00", "hora_fim": "11:00", "min_pessoas": 2, "override": False},
    ],
    "feriados": [],
    "excecoes": [],
    "pinned_cells": [],
    "config": {
        "num_workers": 2,
        "patience_s": 1,
        "max_time_seconds": 8,
        "generation_mode": "OFFICIAL",
        "rules": rules,
    },
}

res = so.solve(data)
assert res["sucesso"], res
assert res["diagnostico"]["pass_usado"] == 1, res["diagnostico"]
`

    expect(() => runPython(script)).not.toThrow()
  })
})
