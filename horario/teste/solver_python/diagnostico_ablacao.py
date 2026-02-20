#!/usr/bin/env python3
"""
diagnostico_ablacao.py — Ablation test: which HARD constraint blocks 100% demand?

Strategy: Force demand as HARD. Disable one constraint at a time.
If disabling X makes it FEASIBLE → X is the blocker.
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path
from typing import Dict, List, Tuple

from ortools.sat.python import cp_model

from constraints import (
    DaySlotDemand,
    SlotGrid,
    WorksDay,
    add_dias_trabalho,
    add_h1_max_dias_consecutivos,
    add_h2_interjornada,
    add_h4_max_jornada_diaria,
    add_h6_almoco_obrigatorio,
    add_h7b_max_gap,
    add_h9_max_blocos,
    add_h9b_bloco_unico_dia_curto,
    add_h10_meta_semanal,
    add_h20_gap_na_janela,
    add_min_diario,
    make_block_starts,
    make_works_day,
)
from solver_ortools import build_days, parse_fixture, time_to_slot, parse_demand


CONSTRAINTS = [
    "H1",    # max 6 consecutive days
    "H2",    # interjornada 11h
    "H4",    # max minutes/day
    "H6",    # mandatory lunch if >6h
    "H7b",   # max gap 2h
    "H9",    # max 2 blocks/day
    "H9b",   # single block for short days
    "H10",   # weekly hours ± tolerance
    "H20",   # lunch gap in 11:00-15:00
    "DIAS",  # forced work days
    "MIN",   # minimum 4h/day
]


def build_model_ablation(
    data: dict,
    skip: set[str],
    demand_hard: bool = True,
) -> Tuple[cp_model.CpModel, int]:
    """Build model with selected constraints disabled. Returns (model, constraint_count)."""
    model = cp_model.CpModel()

    colabs = data["colaboradores"]
    empresa = data["empresa"]
    meta = data["metadata"]
    days = build_days(meta)

    C = len(colabs)
    D = len(days)
    base_h, _ = map(int, meta["hora_abertura"].split(":"))
    end_h, end_m = map(int, meta["hora_fechamento"].split(":"))
    grid_min = int(empresa["grid_minutos"])
    S = ((end_h * 60 + end_m) - base_h * 60) // grid_min
    tolerance = int(empresa["tolerancia_semanal_min"])
    min_lunch_min = int(empresa["min_intervalo_almoco_min"])
    max_lunch_min = int(empresa.get("max_intervalo_almoco_min", 120))
    min_lunch_slots = min_lunch_min // grid_min
    max_gap_slots = max_lunch_min // grid_min
    lunch_win_start = (11 * 60 - base_h * 60) // grid_min
    lunch_win_end = (15 * 60 - base_h * 60) // grid_min
    min_daily_slots = 240 // grid_min

    demand_by_slot = parse_demand(data["demanda"], days=days, base_hour=base_h, grid_min=grid_min)

    # Decision variables
    work: SlotGrid = {}
    for c in range(C):
        for d in range(D):
            for s in range(S):
                work[c, d, s] = model.new_bool_var(f"w_{c}_{d}_{s}")

    works_day = make_works_day(model, work, C, D, S)

    # Block starts only needed if H9 or H9b active
    block_starts = None
    if "H9" not in skip or "H9b" not in skip:
        block_starts = make_block_starts(model, work, C, D, S)

    # Apply constraints selectively
    if "H1" not in skip:
        add_h1_max_dias_consecutivos(model, works_day, C, D)
    if "H2" not in skip:
        add_h2_interjornada(model, work, C, D, S, grid_min=grid_min)
    if "H4" not in skip:
        add_h4_max_jornada_diaria(model, work, colabs, C, D, S, grid_min)
    if "H6" not in skip:
        add_h6_almoco_obrigatorio(model, work, C, D, S,
            min_lunch_slots=min_lunch_slots,
            lunch_window_start=lunch_win_start,
            lunch_window_end=lunch_win_end)
    if "H7b" not in skip:
        add_h7b_max_gap(model, work, C, D, S, max_gap_slots=max_gap_slots)
    if "H9" not in skip and block_starts:
        add_h9_max_blocos(model, block_starts, C, D, S)
    if "H9b" not in skip and block_starts:
        add_h9b_bloco_unico_dia_curto(model, work, block_starts, C, D, S)
    if "H10" not in skip:
        add_h10_meta_semanal(model, work, colabs, C, D, S, tolerance, grid_min)
    if "H20" not in skip:
        add_h20_gap_na_janela(model, work, C, D, S,
            lunch_window_start=lunch_win_start,
            lunch_window_end=lunch_win_end)
    if "DIAS" not in skip:
        add_dias_trabalho(model, works_day, colabs, C, D)
    if "MIN" not in skip:
        add_min_diario(model, work, works_day, C, D, S, min_slots=min_daily_slots)

    # DEMAND AS HARD
    if demand_hard:
        for d in range(D):
            for s in range(S):
                target = demand_by_slot.get((d, s), 0)
                if target > 0:
                    cov = sum(work[c, d, s] for c in range(C))
                    model.add(cov >= target)

    proto = model.proto
    n_vars = len(proto.variables)
    n_constraints = len(proto.constraints)
    return model, n_constraints


def run_ablation(data: dict) -> None:
    print("=" * 75)
    print("  ABLATION TEST: Demand HARD, disable 1 constraint at a time")
    print("=" * 75)

    # Baseline: all constraints + demand hard → should be INFEASIBLE
    print("\n[BASELINE] All HARD + Demand HARD:")
    model, nc = build_model_ablation(data, skip=set(), demand_hard=True)
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = 10
    solver.parameters.num_workers = 8
    t0 = time.time()
    status = solver.solve(model)
    dt = (time.time() - t0) * 1000
    status_name = {
        cp_model.OPTIMAL: "OPTIMAL", cp_model.FEASIBLE: "FEASIBLE",
        cp_model.INFEASIBLE: "INFEASIBLE", cp_model.UNKNOWN: "UNKNOWN",
    }.get(status, "???")
    print(f"  → {status_name} ({dt:.0f}ms, {nc} constraints)")

    # Single ablation: skip one at a time
    results = []
    for cname in CONSTRAINTS:
        print(f"\n[SKIP {cname}] All HARD except {cname} + Demand HARD:")
        model, nc = build_model_ablation(data, skip={cname}, demand_hard=True)
        solver = cp_model.CpSolver()
        solver.parameters.max_time_in_seconds = 30
        solver.parameters.num_workers = 8
        t0 = time.time()
        status = solver.solve(model)
        dt = (time.time() - t0) * 1000
        status_name = {
            cp_model.OPTIMAL: "OPTIMAL", cp_model.FEASIBLE: "FEASIBLE",
            cp_model.INFEASIBLE: "INFEASIBLE", cp_model.UNKNOWN: "UNKNOWN",
        }.get(status, "???")
        is_fix = status in (cp_model.OPTIMAL, cp_model.FEASIBLE)
        marker = " ★ FEASIBLE!" if is_fix else ""
        print(f"  → {status_name} ({dt:.0f}ms, {nc} constraints){marker}")
        results.append((cname, status_name, dt, is_fix))

    # Double ablation for constraints that individually didn't fix it
    infeasible_singles = [r[0] for r in results if not r[3]]
    if len(infeasible_singles) > 1:
        print("\n" + "=" * 75)
        print("  DOUBLE ABLATION: skip 2 constraints at a time")
        print("=" * 75)
        for i, c1 in enumerate(infeasible_singles):
            for c2 in infeasible_singles[i+1:]:
                print(f"\n[SKIP {c1}+{c2}]:")
                model, nc = build_model_ablation(data, skip={c1, c2}, demand_hard=True)
                solver = cp_model.CpSolver()
                solver.parameters.max_time_in_seconds = 30
                solver.parameters.num_workers = 8
                t0 = time.time()
                status = solver.solve(model)
                dt = (time.time() - t0) * 1000
                status_name = {
                    cp_model.OPTIMAL: "OPTIMAL", cp_model.FEASIBLE: "FEASIBLE",
                    cp_model.INFEASIBLE: "INFEASIBLE", cp_model.UNKNOWN: "UNKNOWN",
                }.get(status, "???")
                is_fix = status in (cp_model.OPTIMAL, cp_model.FEASIBLE)
                marker = " ★ FEASIBLE!" if is_fix else ""
                print(f"  → {status_name} ({dt:.0f}ms){marker}")

    # Summary
    print("\n" + "=" * 75)
    print("  SUMMARY")
    print("=" * 75)
    fixers = [r[0] for r in results if r[3]]
    if fixers:
        print(f"\n  ★ Removing ANY of these makes 100% demand FEASIBLE:")
        for f in fixers:
            print(f"    - {f}")
    else:
        print("\n  No single constraint removal fixes INFEASIBILITY.")
        print("  The conflict is a COMBINATION of constraints.")


def main() -> None:
    script_dir = Path(__file__).resolve().parent
    fixture_default = script_dir.parent / "fixture" / "caixa_rita.json"

    input_path = sys.argv[1] if len(sys.argv) > 1 else str(fixture_default)
    data = parse_fixture(input_path)
    print(f"Input: {input_path}")
    print(f"Colabs: {len(data['colaboradores'])}, Period: {data['metadata']['periodo']}")

    run_ablation(data)


if __name__ == "__main__":
    main()
