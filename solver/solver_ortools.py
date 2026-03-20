#!/usr/bin/env python3
"""
solver_ortools.py — OR-Tools CP-SAT solver para EscalaFlow (producao)
=====================================================================

I/O: JSON via stdin → JSON via stdout
Logs/prints → stderr (stdout reservado para resultado)

Input:  SolverInput  (setor, empresa, colaboradores, demanda, feriados, excecoes, pinned_cells, config)
Output: SolverOutput (sucesso, status, alocacoes, indicadores, decisoes, comparacao_demanda)
"""

from __future__ import annotations

import json
import sys
import time
from datetime import date, datetime, timedelta
from typing import Any, Dict, List, Tuple

from ortools.sat.python import cp_model

from math import gcd

from constraints import (
    BlockStarts,
    DaySlotDemand,
    SlotGrid,
    StartVars,
    WorksDay,
    add_ap1_jornada_excessiva,
    add_colaborador_soft_preferences,
    add_colaborador_time_window_hard,
    add_consistencia_horario_soft,
    add_cycle_alignment_hard,
    add_cycle_consistency_soft,
    add_demand_soft,
    add_dias_trabalho,
    add_dias_trabalho_soft_penalty,
    add_dom_max_consecutivo,
    add_domingo_ciclo_hard,
    add_domingo_ciclo_soft,
    add_folga_fixa_5x2,
    add_folga_variavel_condicional,
    add_h1_max_dias_consecutivos,
    add_h1_soft_penalty,
    add_h2_interjornada,
    add_h4_max_jornada_diaria,
    add_h5_excecoes,
    add_human_blocks,
    add_human_blocks_soft_penalty,
    add_lunch_window_always_hard,
    add_band_demand_coverage,
    add_min_headcount_per_day,
    add_h10_meta_semanal,
    add_h10_meta_semanal_elastic,
    add_h15_estagiario_jornada,
    add_h16_estagiario_hora_extra,
    add_h17_h18_feriado_proibido,
    make_start_vars,
    add_min_diario,
    add_min_diario_soft_penalty,
    add_surplus_soft,
    make_block_starts,
    make_works_day,
)


WEIGHTS = {
    "override_deficit": 40000,
    "demand_deficit": 10000,
    "surplus": 5000,
    "domingo_ciclo": 5000,
    "consistencia": 3000,
    "cycle_consistency": 2000,
    "time_window_pref": 2000,
    "spread": 800,
    "ap1_excess": 250,
}

MODE_PROFILES = {
    "rapido":     {"budget": 45,   "gap": 0.05},
    "balanceado": {"budget": 180,  "gap": 0.02},
    "otimizado":  {"budget": 600,  "gap": 0.005},
    "maximo":     {"budget": 1800, "gap": 0.001},
}

# Minimum viable coverage threshold (%). If a FEASIBLE solution has coverage
# below this, the solver keeps running with extended budget until it reaches
# the threshold or hits HARD_TIME_CAP_SECONDS.
MIN_COVERAGE_THRESHOLD = 90.0
HARD_TIME_CAP_SECONDS = 3600  # 1 hour absolute maximum

DAY_LABELS = ["SEG", "TER", "QUA", "QUI", "SEX", "SAB", "DOM"]


def compute_cycle_length_weeks(colabs: List[dict], demand_by_slot: DaySlotDemand, days: List[str]) -> int:
    """Compute cycle length in weeks: N / gcd(N, D).

    N = number of workers eligible for sunday cycle (excludes INTERMITENTE)
    D = max sunday demand (peak headcount target on any sunday slot)
    """
    N = sum(1 for c in colabs
            if c.get("tipo_trabalhador", "CLT") not in ("INTERMITENTE",))
    if N <= 0:
        return 1

    sun_indices = [d for d, day in enumerate(days)
                   if date.fromisoformat(day).weekday() == 6]
    if not sun_indices:
        return 1

    D_demand = 0
    for (d, s), target in demand_by_slot.items():
        if d in sun_indices:
            D_demand = max(D_demand, target)
    if D_demand <= 0:
        return 1

    D_demand = min(D_demand, N)
    return N // gcd(N, D_demand)


def _compute_cycle_weeks_fast(colabs: List[dict], demand_list: List[dict]) -> int:
    """Lightweight cycle computation for diagnostico (no demand_by_slot needed)."""
    N = sum(1 for c in colabs
            if c.get("tipo_trabalhador", "CLT") not in ("INTERMITENTE",))
    if N <= 0:
        return 1
    D = max(
        (int(d.get("min_pessoas", 0)) for d in demand_list if d.get("dia_semana") == "DOM"),
        default=0,
    )
    if D <= 0:
        return 1
    D = min(D, N)
    return N // gcd(N, D)
DaySlotOverride = Dict[Tuple[int, int], bool]


def log(msg: str) -> None:
    """Print to stderr (stdout is reserved for JSON result)."""
    print(msg, file=sys.stderr, flush=True)


def day_label(iso_date: str) -> str:
    d = date.fromisoformat(iso_date)
    return DAY_LABELS[d.weekday()]


def build_days(data_inicio: str, data_fim: str) -> List[str]:
    start = date.fromisoformat(data_inicio)
    end = date.fromisoformat(data_fim)
    out: list[str] = []
    d = start
    while d <= end:
        out.append(d.isoformat())
        d += timedelta(days=1)
    return out


def slot_to_time(slot: int, base_hour: int = 8, grid_min: int = 30) -> str:
    total_min = base_hour * 60 + slot * grid_min
    return f"{total_min // 60:02d}:{total_min % 60:02d}"


def time_to_slot(hhmm: str, base_hour: int = 8, grid_min: int = 30) -> int:
    h, m = map(int, hhmm.split(":"))
    return (h * 60 + m - base_hour * 60) // grid_min


def parse_demand(
    demand_list: List[dict],
    days: List[str],
    base_hour: int = 8,
    grid_min: int = 15,
    demanda_excecao_data: List[dict] | None = None,
) -> Tuple[DaySlotDemand, DaySlotOverride]:
    demand_by_day_slot: DaySlotDemand = {}
    override_by_day_slot: DaySlotOverride = {}

    # Build set of (date, slot) that have excecao overrides
    excecao_slots: set = set()
    if demanda_excecao_data:
        for exc in demanda_excecao_data:
            exc_date = exc.get("data")
            for d_idx, day in enumerate(days):
                if day != exc_date:
                    continue
                start = time_to_slot(exc["hora_inicio"], base_hour, grid_min)
                end = time_to_slot(exc["hora_fim"], base_hour, grid_min)
                target = int(exc["min_pessoas"])
                for s in range(max(0, start), max(0, end)):
                    key = (d_idx, s)
                    excecao_slots.add(key)
                    demand_by_day_slot[key] = max(demand_by_day_slot.get(key, 0), target)
                    if bool(exc.get("override", False)):
                        override_by_day_slot[key] = True

    # Standard weekly demand (skip slots with excecao override)
    for d_idx, day in enumerate(days):
        label = day_label(day)
        for entry in demand_list:
            dia = entry.get("dia_semana")
            if dia is not None and dia != label:
                continue

            start = time_to_slot(entry["hora_inicio"], base_hour, grid_min)
            end = time_to_slot(entry["hora_fim"], base_hour, grid_min)
            target = int(entry["min_pessoas"])
            for s in range(max(0, start), max(0, end)):
                key = (d_idx, s)
                if key in excecao_slots:
                    continue  # excecao por data tem precedencia
                demand_by_day_slot[key] = max(demand_by_day_slot.get(key, 0), target)
                if bool(entry.get("override", False)):
                    override_by_day_slot[key] = True

    return demand_by_day_slot, override_by_day_slot


def build_week_chunks(days: List[str]) -> List[List[int]]:
    """Split period into sequential 7-day chunks for weekly constraints."""
    chunks: List[List[int]] = []
    for start in range(0, len(days), 7):
        chunks.append(list(range(start, min(start + 7, len(days)))))
    return chunks


def apply_warm_start_hints(
    model: cp_model.CpModel,
    work: SlotGrid,
    colabs: List[dict],
    days: List[str],
    hints: List[dict],
    C: int,
    D: int,
    S: int,
    base_h: int,
    grid_min: int,
) -> int:
    """Apply optional warm-start hints from previous schedule."""
    if not hints:
        return 0

    colab_id_to_c = {colabs[c]["id"]: c for c in range(C)}
    day_to_d = {day: d for d, day in enumerate(days)}
    hints_applied = 0

    for hint in hints:
        c = colab_id_to_c.get(hint.get("colaborador_id"))
        d = day_to_d.get(hint.get("data"))
        if c is None or d is None:
            continue

        status = hint.get("status", "TRABALHO")
        start_h = hint.get("hora_inicio")
        end_h = hint.get("hora_fim")

        if status != "TRABALHO" or not start_h or not end_h:
            for s in range(S):
                model.add_hint(work[c, d, s], 0)
            hints_applied += S
            continue

        try:
            s_start = max(0, time_to_slot(start_h, base_h, grid_min))
            s_end = min(S, time_to_slot(end_h, base_h, grid_min))
        except Exception:
            continue

        for s in range(S):
            model.add_hint(work[c, d, s], 1 if s_start <= s < s_end else 0)
            hints_applied += 1

    return hints_applied


def _compute_peak_demand_per_day(
    demand_list: List[dict],
    days: List[str],
    D: int,
    demanda_excecao_data: List[dict] | None = None,
) -> List[int]:
    """For each day d, returns the peak min_pessoas across any demand band.

    Used by Phase 1 to set minimum headcount constraints.
    """
    peak = [0] * D
    # Build excecao lookup for date-specific overrides
    excecao_by_date: dict[str, int] = {}
    if demanda_excecao_data:
        for exc in demanda_excecao_data:
            dt = exc.get("data", "")
            mp = int(exc.get("min_pessoas", 0))
            excecao_by_date[dt] = max(excecao_by_date.get(dt, 0), mp)

    for d_idx, day_str in enumerate(days):
        # Check date-specific excecao first
        if day_str in excecao_by_date:
            peak[d_idx] = max(peak[d_idx], excecao_by_date[day_str])

        label = day_label(day_str)
        for dem in demand_list:
            dia = dem.get("dia_semana")
            if dia is not None and dia != label:
                continue
            mp = int(dem.get("min_pessoas", 0))
            peak[d_idx] = max(peak[d_idx], mp)

    return peak


def _compute_half_demand(
    demand_list: List[dict],
    days: List[str],
    D: int,
    S: int,
    base_h: int,
    grid_min: int,
    demanda_excecao_data: List[dict] | None = None,
) -> Tuple[List[int], List[int]]:
    """For each day d, returns (morning_peak, afternoon_peak).

    morning_peak = max demand in first half of slots (0..S//2)
    afternoon_peak = max demand in second half (S//2..S)
    """
    mid = S // 2
    morning = [0] * D
    afternoon = [0] * D
    demand_by_slot, _ = parse_demand(
        demand_list, days, base_hour=base_h, grid_min=grid_min,
        demanda_excecao_data=demanda_excecao_data,
    )
    for (d, s), target in demand_by_slot.items():
        if s < mid:
            morning[d] = max(morning[d], target)
        else:
            afternoon[d] = max(afternoon[d], target)
    return morning, afternoon


def solve_folga_pattern(data: dict, budget_s: float = 10.0) -> dict | None:
    """Phase 1: Shift-band model deciding OFF/MANHA/TARDE/INTEGRAL per (c,d).

    Guarantees folga constraints AND demand coverage per half-day.
    Pattern values: 0=OFF, 1=MANHA, 2=TARDE, 3=INTEGRAL.

    Returns dict with 'pattern', 'status', 'time_ms', 'cycle_days' on success, or None.
    """
    BAND_OFF = 0
    BAND_MANHA = 1
    BAND_TARDE = 2
    BAND_INTEGRAL = 3

    colabs = data["colaboradores"]
    days = build_days(data["data_inicio"], data["data_fim"])
    C = len(colabs)
    D = len(days)

    if C == 0 or D == 0:
        return None

    config = data.get("config", {})
    rules = config.get("rules", {})
    h3_cycle_status = rules.get("H3_DOM_CICLO_EXATO", "SOFT")
    h3_status_m = rules.get("H3_DOM_MAX_CONSEC_M", rules.get("H3_DOM_MAX_CONSEC", "HARD"))
    h3_status_f = rules.get("H3_DOM_MAX_CONSEC_F", rules.get("H3_DOM_MAX_CONSEC", "HARD"))

    # Compute grid info for half-demand
    empresa = data["empresa"]
    grid_min = int(empresa.get("grid_minutos", 30))
    base_h, _ = map(int, empresa["hora_abertura"].split(":"))
    end_h, end_m = map(int, empresa["hora_fechamento"].split(":"))
    S = ((end_h * 60 + end_m) - base_h * 60) // grid_min

    model = cp_model.CpModel()

    # 3 BoolVars per (c,d): mutually exclusive shift bands
    is_manha: Dict[Tuple[int, int], cp_model.IntVar] = {}
    is_tarde: Dict[Tuple[int, int], cp_model.IntVar] = {}
    is_integral: Dict[Tuple[int, int], cp_model.IntVar] = {}
    works_day: Dict[Tuple[int, int], cp_model.IntVar] = {}

    for c in range(C):
        for d in range(D):
            is_manha[c, d] = model.new_bool_var(f"p1_m_{c}_{d}")
            is_tarde[c, d] = model.new_bool_var(f"p1_t_{c}_{d}")
            is_integral[c, d] = model.new_bool_var(f"p1_i_{c}_{d}")

            # At most one band active (none = OFF/folga)
            model.add(is_manha[c, d] + is_tarde[c, d] + is_integral[c, d] <= 1)

            # Derive works_day for reuse by existing constraints
            works_day[c, d] = model.new_bool_var(f"p1_wd_{c}_{d}")
            model.add(works_day[c, d] == is_manha[c, d] + is_tarde[c, d] + is_integral[c, d])

    # Compute blocked days
    blocked_days, sunday_indices, _, _ = _compute_blocked_days(data, colabs, days, C, D)

    # Pin blocked days to OFF
    for c in range(C):
        for d in blocked_days.get(c, set()):
            model.add(works_day[c, d] == 0)

    # Weekly chunks for dias_trabalho
    week_chunks = build_week_chunks(days)

    # HARD: dias de trabalho por semana
    add_dias_trabalho(model, works_day, colabs, C, D, week_chunks, blocked_days)

    # HARD: max 6 consecutivos
    add_h1_max_dias_consecutivos(model, works_day, C, D)

    # HARD: folga fixa 5x2
    add_folga_fixa_5x2(model, works_day, colabs, days, C, D)

    # HARD: folga variavel condicional
    add_folga_variavel_condicional(model, works_day, colabs, days, C, D)

    # HARD: headcount minimo por dia (from peak demand)
    peak_demand = _compute_peak_demand_per_day(
        data.get("demanda", []), days, D,
        demanda_excecao_data=data.get("demanda_excecao_data"),
    )
    add_min_headcount_per_day(model, works_day, C, D, peak_demand, blocked_days)

    # HARD: domingo ciclo exato
    if h3_cycle_status == "HARD":
        add_domingo_ciclo_hard(model, works_day, colabs, C, sunday_indices, blocked_days)

    # H3: max domingos consecutivos por sexo — policy-driven.
    if h3_status_m == "HARD" or h3_status_f == "HARD":
        add_dom_max_consecutivo(
            model, works_day, colabs, C, sunday_indices, blocked_days,
            hard_m=h3_status_m == "HARD",
            hard_f=h3_status_f == "HARD",
        )

    # HARD: band demand coverage (morning/afternoon halves)
    morning_demand, afternoon_demand = _compute_half_demand(
        data.get("demanda", []), days, D, S, base_h, grid_min,
        demanda_excecao_data=data.get("demanda_excecao_data"),
    )
    add_band_demand_coverage(
        model, is_manha, is_tarde, is_integral, C, D,
        morning_demand, afternoon_demand, blocked_days,
    )

    # Compute cycle info for diagnostics
    demand_by_slot, _ = parse_demand(
        data["demanda"], days=days, base_hour=base_h, grid_min=grid_min,
        demanda_excecao_data=data.get("demanda_excecao_data"),
    )
    cycle_weeks = compute_cycle_length_weeks(colabs, demand_by_slot, days)
    cycle_days = cycle_weeks * 7

    # Objective: minimize spread (primary) + penalize all-integral (secondary)
    work_totals = []
    for c in range(C):
        total = model.new_int_var(0, D, f"p1_total_{c}")
        model.add(total == sum(works_day[c, d] for d in range(D)))
        work_totals.append(total)

    max_total = model.new_int_var(0, D, "p1_max_total")
    min_total = model.new_int_var(0, D, "p1_min_total")
    model.add_max_equality(max_total, work_totals)
    model.add_min_equality(min_total, work_totals)
    spread = model.new_int_var(0, D, "p1_spread")
    model.add(spread == max_total - min_total)

    # SOFT: penalize INTEGRAL assignments — fewer integral = more diversity
    # This makes the solver prefer MANHA/TARDE bands without causing infeasibility.
    # Weight 1000 on spread ensures balance is always the primary objective.
    total_integral = sum(
        is_integral[c, d] for c in range(C) for d in range(D)
        if d not in blocked_days.get(c, set())
    )
    model.minimize(spread * 1000 + total_integral)

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = budget_s
    solver.parameters.num_workers = 8
    solver.parameters.log_search_progress = False
    solver.parameters.log_to_stdout = False

    t0 = time.time()
    status = solver.solve(model)
    solve_ms = (time.time() - t0) * 1000

    if status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        pattern: Dict[Tuple[int, int], int] = {}
        for c in range(C):
            for d in range(D):
                if solver.value(is_manha[c, d]):
                    pattern[(c, d)] = BAND_MANHA
                elif solver.value(is_tarde[c, d]):
                    pattern[(c, d)] = BAND_TARDE
                elif solver.value(is_integral[c, d]):
                    pattern[(c, d)] = BAND_INTEGRAL
                else:
                    pattern[(c, d)] = BAND_OFF
        return {
            "pattern": pattern,
            "status": "OK",
            "time_ms": round(solve_ms, 1),
            "cycle_days": cycle_days,
        }

    log(f"Padrao de folgas inviavel ({solve_ms/1000:.1f}s) — usando distribuicao automatica")
    return None


def _compute_blocked_days(
    data: dict,
    colabs: List[dict],
    days: List[str],
    C: int,
    D: int,
) -> Tuple[Dict[int, set], List[int], List[int], List[int]]:
    """Compute blocked days per collaborator + calendar indices.

    Returns:
        blocked_days: {c: set of day indices where person c cannot work}
        sunday_indices: list of day indices that are Sundays
        holiday_all_indices: list of day indices that are any holiday
        holiday_prohibited_indices: list of day indices that are CCT-prohibited holidays
    """
    sunday_indices = [d for d in range(D) if day_label(days[d]) == "DOM"]

    feriados = data.get("feriados", [])
    holiday_all_indices: list[int] = []
    holiday_prohibited_indices: list[int] = []
    for fer in feriados:
        for d, day in enumerate(days):
            if day == fer["data"]:
                holiday_all_indices.append(d)
                if fer.get("proibido_trabalhar", False):
                    holiday_prohibited_indices.append(d)

    excecoes = data.get("excecoes", [])

    blocked_days: dict[int, set] = {c: set() for c in range(C)}

    # H17/H18: Prohibited holidays block everyone
    for d in holiday_prohibited_indices:
        for c in range(C):
            blocked_days[c].add(d)

    # H5: Exceptions (ferias, atestado)
    colab_id_to_c = {colabs[c]["id"]: c for c in range(C)}
    for exc in excecoes:
        c = colab_id_to_c.get(exc.get("colaborador_id"))
        if c is not None:
            exc_start = exc.get("data_inicio", "")
            exc_end = exc.get("data_fim", "")
            for d, day in enumerate(days):
                if exc_start <= day <= exc_end:
                    blocked_days[c].add(d)

    # Folga fixa from regras_colaborador_dia — only INTERMITENTE
    # CLT folga_fixa is handled by add_folga_fixa_5x2 / add_colaborador_time_window_hard
    # Adding CLT folga_fixa to blocked_days would reduce available in add_dias_trabalho
    # and cause the solver to schedule fewer days than regime_days (validator violation)
    regras_dia = data.get("regras_colaborador_dia", [])
    day_to_d = {day: d for d, day in enumerate(days)}
    for regra in regras_dia:
        if regra.get("folga_fixa", False):
            c = colab_id_to_c.get(regra.get("colaborador_id"))
            d = day_to_d.get(regra.get("data"))
            if c is not None and d is not None:
                if colabs[c].get("tipo_trabalhador", "CLT") == "INTERMITENTE":
                    blocked_days[c].add(d)

    return blocked_days, sunday_indices, holiday_all_indices, holiday_prohibited_indices


def build_model(
    data: dict,
    relaxations: List[str] | None = None,
    pinned_folga: Dict[Tuple[int, int], int] | None = None,
) -> Tuple[
    cp_model.CpModel,
    SlotGrid,
    WorksDay,
    BlockStarts,
    List[dict],
    List[str],
    int,
    int,
    int,
    DaySlotDemand,
    DaySlotOverride,
    Dict[Tuple[int, int], cp_model.IntVar],
    Dict[Tuple[int, int], cp_model.IntVar],
    List[cp_model.IntVar],
    List[cp_model.IntVar],
    int,
    int,
]:
    model = cp_model.CpModel()
    config = data.get("config", {})
    relax = set(relaxations or [])

    colabs = data["colaboradores"]
    empresa = data["empresa"]

    days = build_days(data["data_inicio"], data["data_fim"])
    C = len(colabs)
    D = len(days)
    week_chunks = build_week_chunks(days)

    base_h, _ = map(int, empresa["hora_abertura"].split(":"))
    end_h, end_m = map(int, empresa["hora_fechamento"].split(":"))

    grid_min = int(empresa.get("grid_minutos", 30))
    horario_por_dia = empresa.get("horario_por_dia", {})

    # S = slots que cobrem o RANGE GLOBAL (min_abertura..max_fechamento)
    if horario_por_dia:
        min_base = base_h * 60
        max_fech = end_h * 60 + end_m
        for dia_info in horario_por_dia.values():
            ab_h, ab_m = map(int, dia_info["abertura"].split(":"))
            fe_h, fe_m = map(int, dia_info["fechamento"].split(":"))
            min_base = min(min_base, ab_h * 60 + ab_m)
            max_fech = max(max_fech, fe_h * 60 + fe_m)
        base_h = min_base // 60
        S = (max_fech - base_h * 60) // grid_min
    else:
        S = ((end_h * 60 + end_m) - base_h * 60) // grid_min

    tolerance = int(empresa.get("tolerancia_semanal_min", 0))
    min_lunch_min = int(empresa.get("min_intervalo_almoco_min", 60))
    max_lunch_min = int(empresa.get("max_intervalo_almoco_min", 120))
    min_lunch_slots = min_lunch_min // grid_min
    max_gap_slots = max_lunch_min // grid_min

    lunch_win_start = (11 * 60 - base_h * 60) // grid_min
    lunch_win_end = (14 * 60 - base_h * 60) // grid_min

    demand_by_slot, override_by_slot = parse_demand(
        data["demanda"],
        days=days,
        base_hour=base_h,
        grid_min=grid_min,
        demanda_excecao_data=data.get("demanda_excecao_data"),
    )

    cycle_weeks = compute_cycle_length_weeks(colabs, demand_by_slot, days)
    cycle_days = cycle_weeks * 7
    log(f"Ciclo detectado: {cycle_weeks} semanas ({cycle_days} dias)")

    min_daily_slots = 240 // grid_min

    work: SlotGrid = {}
    for c in range(C):
        for d in range(D):
            for s in range(S):
                work[c, d, s] = model.new_bool_var(f"w_{c}_{d}_{s}")

    # Per-day closing: zero slots beyond each day's closing hour
    day_max_slot: Dict[int, int] = {}
    if horario_por_dia:
        for d_idx, day_str in enumerate(days):
            d_date = date.fromisoformat(day_str)
            # Python weekday: 0=Mon..6=Sun → convert to 0=Sun..6=Sat
            dow_adjusted = (d_date.weekday() + 1) % 7
            dia_info = horario_por_dia.get(str(dow_adjusted))
            if dia_info:
                fe_h, fe_m = map(int, dia_info["fechamento"].split(":"))
                day_slots = ((fe_h * 60 + fe_m) - base_h * 60) // grid_min
                day_max_slot[d_idx] = min(max(day_slots, 0), S)

    if day_max_slot:
        for c in range(C):
            for d_idx, max_s in day_max_slot.items():
                for s in range(max_s, S):
                    model.Add(work[c, d_idx, s] == 0)

    # Apply pinned_cells constraints
    pinned_cells = data.get("pinned_cells", [])
    for pin in pinned_cells:
        colab_id = pin["colaborador_id"]
        pin_date = pin["data"]
        pin_status = pin.get("status", "TRABALHO")

        c_idx = None
        for ci, col in enumerate(colabs):
            if col["id"] == colab_id:
                c_idx = ci
                break
        if c_idx is None:
            continue

        d_idx = None
        for di, day in enumerate(days):
            if day == pin_date:
                d_idx = di
                break
        if d_idx is None:
            continue

        if pin_status == "FOLGA" or pin_status == "INDISPONIVEL":
            for s in range(S):
                model.add(work[c_idx, d_idx, s] == 0)
        elif pin_status == "TRABALHO":
            pin_inicio = pin.get("hora_inicio")
            pin_fim = pin.get("hora_fim")
            if pin_inicio and pin_fim:
                s_start = time_to_slot(pin_inicio, base_h, grid_min)
                s_end = time_to_slot(pin_fim, base_h, grid_min)
                for s in range(S):
                    if s_start <= s < s_end:
                        model.add(work[c_idx, d_idx, s] == 1)

    hints_applied = apply_warm_start_hints(
        model,
        work,
        colabs=colabs,
        days=days,
        hints=data.get("hints", []),
        C=C,
        D=D,
        S=S,
        base_h=base_h,
        grid_min=grid_min,
    )
    if hints_applied > 0:
        log(f"Reutilizando {hints_applied} alocacoes da escala anterior como ponto de partida")

    # ---------------------------------------------------------------
    # Compute indices for Sundays, holidays, and blocked days per person
    # ---------------------------------------------------------------
    blocked_days, sunday_indices, holiday_all_indices, holiday_prohibited_indices = \
        _compute_blocked_days(data, colabs, days, C, D)
    excecoes = data.get("excecoes", [])

    # Apply all blocking constraints (force work slots to 0)
    for c in range(C):
        for d in blocked_days[c]:
            for s in range(S):
                model.add(work[c, d, s] == 0)

    # Belt-and-suspenders: intermitente NEVER works on days with folga_fixa
    # even if folga_fixa constraint is relaxed in a later pass
    regras_dia_raw = data.get("regras_colaborador_dia", [])
    colab_id_to_c_bs = {colabs[c]["id"]: c for c in range(C)}
    day_to_d_bs = {day: d for d, day in enumerate(days)}
    for regra in regras_dia_raw:
        if regra.get("folga_fixa", False):
            c_bs = colab_id_to_c_bs.get(regra.get("colaborador_id"))
            d_bs = day_to_d_bs.get(regra.get("data"))
            if c_bs is not None and d_bs is not None:
                if colabs[c_bs].get("tipo_trabalhador", "CLT") == "INTERMITENTE":
                    for s in range(S):
                        model.add(work[c_bs, d_bs, s] == 0)

    # Phase 1 pinned bands: constrain slots based on shift band assignment
    BAND_OFF = 0
    BAND_MANHA = 1
    BAND_TARDE = 2
    BAND_INTEGRAL = 3

    if pinned_folga:
        # MANHA: can work slots 0..4S/5 (blocked from last 20% of day)
        # For Açougue (S=50): cutoff=40 → 17:00, window 07:00-17:00 (600 min)
        manha_cutoff = S * 4 // 5
        # TARDE: can work slots S/5..S (blocked from first 20% of day)
        # For Açougue (S=50): cutoff=10 → 09:30, window 09:30-19:30 (600 min)
        tarde_cutoff = S // 5

        pinned_off = pinned_manha = pinned_tarde = pinned_integral = 0
        for (c, d), band in pinned_folga.items():
            if d in blocked_days.get(c, set()):
                continue
            if band == BAND_OFF:
                for s in range(S):
                    model.add(work[c, d, s] == 0)
                pinned_off += 1
            elif band == BAND_MANHA:
                for s in range(manha_cutoff, S):
                    model.add(work[c, d, s] == 0)
                pinned_manha += 1
            elif band == BAND_TARDE:
                for s in range(0, tarde_cutoff):
                    model.add(work[c, d, s] == 0)
                pinned_tarde += 1
            elif band == BAND_INTEGRAL:
                pinned_integral += 1  # no slot restriction

        total_pinned = pinned_off + pinned_manha + pinned_tarde + pinned_integral
        if total_pinned > 0:
            log(f"Turnos fixados: {pinned_manha} manha, {pinned_tarde} tarde, {pinned_integral} integral, {pinned_off} folga")

    # ---------------------------------------------------------------
    # Build helper variables
    # ---------------------------------------------------------------
    works_day = make_works_day(model, work, C, D, S)
    block_starts = make_block_starts(model, work, C, D, S)

    # ---------------------------------------------------------------
    # HARD: Minimum headcount per Sunday (from demand peak)
    # Ensures enough people work each Sunday to meet demand.
    # Only applies to non-emergency passes.
    # ---------------------------------------------------------------
    if "ALL_PRODUCT_RULES" not in relax:
        for d in sunday_indices:
            # Find peak demand for this day across all slots
            peak = 0
            for s in range(S):
                target = demand_by_slot.get((d, s), 0)
                if target > peak:
                    peak = target
            if peak > 0:
                # Count available (non-blocked) collaborators for this Sunday
                available_c = [c for c in range(C) if d not in blocked_days.get(c, set())]
                if len(available_c) >= peak:
                    model.add(sum(works_day[c, d] for c in available_c) >= peak)

    nivel_rigor = config.get("nivel_rigor", "ALTO")
    rules = config.get("rules", {})

    generation_mode = config.get("generation_mode", "OFFICIAL")

    # Relaxation sets for multi-pass graceful degradation
    is_emergency = "ALL_PRODUCT_RULES" in relax
    force_h10_elastic = "H10_ELASTIC" in relax or is_emergency
    force_h6_soft = "H6" in relax or (is_emergency and generation_mode == "EXPLORATORY")
    force_dt_soft = "DIAS_TRABALHO" in relax or is_emergency
    force_md_soft = "MIN_DIARIO" in relax or is_emergency
    force_h1_soft = "H1" in relax or (is_emergency and generation_mode == "EXPLORATORY")
    skip_time_window_hard = "TIME_WINDOW" in relax or is_emergency
    skip_folga_fixa = "FOLGA_FIXA" in relax or "FOLGA_VARIAVEL" in relax or is_emergency

    def rule_is(codigo: str, default: str = 'HARD') -> str:
        """Retorna status da regra: HARD, SOFT, OFF, ON.
        Se rules dict presente e nao vazio, usa ele. Caso contrario, inferir de nivel_rigor."""
        if rules:
            return rules.get(codigo, default)
        # backward compat: inferir de nivel_rigor
        if codigo == 'H1':
            return 'HARD' if nivel_rigor in ['ALTO', 'MEDIO'] else 'OFF'
        if codigo == 'H6':
            return 'HARD' if nivel_rigor == 'ALTO' else 'OFF'
        if codigo == 'DIAS_TRABALHO':
            return 'HARD' if nivel_rigor in ['ALTO', 'MEDIO'] else 'OFF'
        if codigo == 'MIN_DIARIO':
            return 'HARD' if nivel_rigor == 'ALTO' else 'OFF'
        if codigo.startswith('S_') or codigo.startswith('AP'):
            return 'ON'
        return default

    # H3: Max domingos consecutivos — policy-driven.
    # SOFT ainda nao tem penalidade dedicada; nesse modo a hard constraint fica desligada.
    h3_cycle_status = rule_is('H3_DOM_CICLO_EXATO', 'SOFT')
    h3_status_m = rule_is('H3_DOM_MAX_CONSEC_M', rule_is('H3_DOM_MAX_CONSEC', 'HARD'))
    h3_status_f = rule_is('H3_DOM_MAX_CONSEC_F', rule_is('H3_DOM_MAX_CONSEC', 'HARD'))
    if h3_cycle_status == 'HARD' and "ALL_PRODUCT_RULES" not in relax:
        add_domingo_ciclo_hard(model, works_day, colabs, C, sunday_indices, blocked_days)
    if (h3_status_m == 'HARD' or h3_status_f == 'HARD') and "ALL_PRODUCT_RULES" not in relax:
        add_dom_max_consecutivo(
            model, works_day, colabs, C, sunday_indices, blocked_days,
            hard_m=h3_status_m == 'HARD',
            hard_f=h3_status_f == 'HARD',
        )

    obj_terms_list: list = []  # penalties das versoes SOFT das HARD rules

    # ---------------------------------------------------------------
    # HARD constraints (CLT Legal — NEVER relaxed)
    # ---------------------------------------------------------------
    regras_dia = data.get("regras_colaborador_dia", [])

    # H1: Max 6 dias consecutivos
    h1_status = rule_is('H1', 'HARD')
    if force_h1_soft:
        h1_status = 'SOFT'
    if h1_status == 'HARD':
        add_h1_max_dias_consecutivos(model, works_day, C, D)
    elif h1_status == 'SOFT':
        add_h1_soft_penalty(model, obj_terms_list, works_day, C, D)

    # H2: ALWAYS HARD (safety — CLT Art. 66)
    add_h2_interjornada(model, work, C, D, S, grid_min=grid_min)
    # H3 ciclo exato + domingos consecutivos sao resolvidos acima.
    # H4: ALWAYS HARD (safety — CLT Art. 59)
    add_h4_max_jornada_diaria(model, work, colabs, C, D, S, grid_min)
    # H5: ALWAYS HARD (exceptions are physical absence)
    add_h5_excecoes(model, work, colabs, days, C, S, excecoes)

    # H6: Human blocks (almoco)
    h6_status = rule_is('H6', 'HARD')
    if force_h6_soft:
        h6_status = 'SOFT'
    if h6_status == 'HARD':
        add_human_blocks(
            model,
            work,
            block_starts,
            C,
            D,
            S,
            base_h=base_h,
            grid_min=grid_min,
            min_gap_slots=min_lunch_slots,
            max_gap_slots=max_gap_slots,
            threshold_slots=360 // grid_min,   # >6h -> almoco (scale for grid)
            min_work_slots=120 // grid_min,    # min 2h per block
            max_work_slots=360 // grid_min,    # max 6h continuous work
        )
    elif h6_status == 'SOFT':
        add_human_blocks_soft_penalty(
            model,
            obj_terms_list,
            work,
            block_starts,
            C,
            D,
            S,
            base_h=base_h,
            grid_min=grid_min,
            min_gap_slots=min_lunch_slots,
            max_gap_slots=max_gap_slots,
            threshold_slots=360 // grid_min,
            min_work_slots=120 // grid_min,
            max_work_slots=360 // grid_min,
        )

    # LUNCH WINDOW: ALWAYS HARD — never relaxed, regardless of H6 status
    # If a day has a lunch gap, it MUST be between 11:00-14:00 with >=2h work before/after.
    # This prevents solver from placing lunch at 06:30 even when H6 is relaxed to SOFT.
    add_lunch_window_always_hard(
        model,
        work,
        block_starts,
        C,
        D,
        S,
        base_h=base_h,
        grid_min=grid_min,
        lunch_window_start_hour=11,
        lunch_window_end_hour=14,
        min_work_before_lunch_slots=120 // grid_min,   # 2h before lunch
        min_work_after_lunch_slots=120 // grid_min,     # 2h after lunch
    )

    # H10: Meta semanal — policy-driven. OFF/SOFT use the elastic builder.
    h10_status = rule_is('H10', 'HARD')
    if force_h10_elastic:
        h10_status = 'SOFT'
    if h10_status == 'HARD':
        weekly_minutes, weekly_minutes_by_colab = add_h10_meta_semanal(
            model,
            work,
            colabs,
            C,
            D,
            S,
            week_chunks=week_chunks,
            blocked_days=blocked_days,
            tolerance_min=tolerance,
            grid_min=grid_min,
        )
    else:
        h10_weight = 8000 if h10_status == 'SOFT' else 0
        weekly_minutes, weekly_minutes_by_colab = add_h10_meta_semanal_elastic(
            model,
            obj_terms_list,
            work,
            colabs,
            C,
            D,
            S,
            week_chunks=week_chunks,
            blocked_days=blocked_days,
            tolerance_min=tolerance,
            grid_min=grid_min,
            weight=h10_weight,
        )

    # CLT constraints that NEVER relax (estagiario, feriados proibidos)
    add_h15_estagiario_jornada(
        model,
        work,
        weekly_minutes_by_colab,
        colabs,
        C,
        D,
        S,
        grid_min,
        week_chunks,
    )
    add_h16_estagiario_hora_extra(model, weekly_minutes_by_colab, colabs, C, week_chunks)
    add_h17_h18_feriado_proibido(model, works_day, C, holiday_prohibited_indices)

    # v4: Regra hard de janela por colaborador (skip in emergency pass)
    if not skip_time_window_hard:
        add_colaborador_time_window_hard(
            model, work, works_day, regras_dia, colabs, days, C, D, S, base_h, grid_min
        )

    # v4: Folga fixa 5x2 (product rule, skip in emergency pass)
    if not skip_folga_fixa:
        add_folga_fixa_5x2(model, works_day, colabs, days, C, D)

    # v4: Folga variavel condicional (skip in emergency pass, like folga_fixa)
    if not skip_folga_fixa:
        add_folga_variavel_condicional(model, works_day, colabs, days, C, D)

    # Product rules (with blocked_days awareness)
    dt_status = rule_is('DIAS_TRABALHO', 'HARD')
    if force_dt_soft:
        dt_status = 'SOFT'
    if dt_status == 'HARD':
        add_dias_trabalho(model, works_day, colabs, C, D, week_chunks, blocked_days)
    elif dt_status == 'SOFT':
        add_dias_trabalho_soft_penalty(model, obj_terms_list, works_day, colabs, C, D, week_chunks, blocked_days)

    md_status = rule_is('MIN_DIARIO', 'HARD')
    if force_md_soft:
        md_status = 'SOFT'
    if md_status == 'HARD':
        add_min_diario(model, work, works_day, C, D, S, min_slots=min_daily_slots)
    elif md_status == 'SOFT':
        add_min_diario_soft_penalty(model, obj_terms_list, work, works_day, C, D, S, min_slots=min_daily_slots)

    deficit = add_demand_soft(model, work, demand_by_slot, C, D, S) if rule_is('S_DEFICIT', 'ON') != 'OFF' else {}
    surplus = add_surplus_soft(model, work, demand_by_slot, C, D, S) if rule_is('S_SURPLUS', 'ON') != 'OFF' else {}
    ap1_excess = add_ap1_jornada_excessiva(model, work, C, D, S, grid_min=grid_min) if rule_is('S_AP1_EXCESS', 'ON') != 'OFF' else []

    # v4: Novos soft constraints
    domingo_ciclo_penalties = add_domingo_ciclo_soft(model, works_day, colabs, C, sunday_indices) if rule_is('S_DOMINGO_CICLO', 'ON') != 'OFF' else []
    turno_pref_penalties = add_colaborador_soft_preferences(
        model, work, works_day, regras_dia, colabs, days, C, D, S, base_h, grid_min
    ) if rule_is('S_TURNO_PREF', 'ON') != 'OFF' else []
    # Shared start_vars — used by consistencia + cycle_consistency
    start_vars = make_start_vars(model, work, works_day, C, D, S)

    consistencia_penalties = add_consistencia_horario_soft(model, start_vars, works_day, C, D, S, grid_min) if rule_is('S_CONSISTENCIA', 'ON') != 'OFF' else []
    cycle_penalties = add_cycle_consistency_soft(
        model, start_vars, works_day, C, D, S, cycle_days
    ) if rule_is('S_CYCLE_CONSISTENCY', 'ON') != 'OFF' and cycle_days < D else []

    max_total_minutes = D * S * grid_min
    max_weekly = model.new_int_var(0, max_total_minutes, "max_weekly")
    min_weekly = model.new_int_var(0, max_total_minutes, "min_weekly")
    model.add_max_equality(max_weekly, weekly_minutes)
    model.add_min_equality(min_weekly, weekly_minutes)
    spread = model.new_int_var(0, 9000, "spread")
    model.add(spread == max_weekly - min_weekly)

    objective_terms = []
    if deficit:
        objective_terms.append(WEIGHTS["demand_deficit"] * sum(deficit.values()))
        override_deficit = [dv for key, dv in deficit.items() if override_by_slot.get(key, False)]
        if override_deficit:
            objective_terms.append(WEIGHTS["override_deficit"] * sum(override_deficit))
    if surplus:
        objective_terms.append(WEIGHTS["surplus"] * sum(surplus.values()))
    if domingo_ciclo_penalties:
        objective_terms.append(WEIGHTS["domingo_ciclo"] * sum(domingo_ciclo_penalties))
    if turno_pref_penalties:
        objective_terms.append(WEIGHTS["time_window_pref"] * sum(turno_pref_penalties))
    if consistencia_penalties:
        objective_terms.append(WEIGHTS["consistencia"] * sum(consistencia_penalties))
    if cycle_penalties:
        objective_terms.append(WEIGHTS["cycle_consistency"] * sum(cycle_penalties))
    if ap1_excess:
        objective_terms.append(WEIGHTS["ap1_excess"] * sum(ap1_excess))
    objective_terms.append(WEIGHTS["spread"] * spread)

    if obj_terms_list:
        objective_terms.extend(obj_terms_list)

    model.minimize(sum(objective_terms))

    return (
        model,
        work,
        works_day,
        block_starts,
        colabs,
        days,
        C,
        D,
        S,
        demand_by_slot,
        override_by_slot,
        deficit,
        surplus,
        weekly_minutes,
        ap1_excess,
        base_h,
        grid_min,
    )


def extract_solution(
    solver: cp_model.CpSolver,
    work: SlotGrid,
    colabs: List[dict],
    days: List[str],
    C: int,
    D: int,
    S: int,
    demand_by_slot: DaySlotDemand,
    override_by_slot: DaySlotOverride,
    deficit: Dict[Tuple[int, int], cp_model.IntVar],
    surplus: Dict[Tuple[int, int], cp_model.IntVar],
    weekly_minutes: List[cp_model.IntVar],
    ap1_excess: List[cp_model.IntVar],
    status: int,
    solve_time_ms: float,
    base_h: int,
    grid_min: int,
    rules: dict = {},
    generation_mode: str = "OFFICIAL",
    policy_adjustments: list | None = None,
) -> dict:
    status_name = {
        cp_model.OPTIMAL: "OPTIMAL",
        cp_model.FEASIBLE: "FEASIBLE",
        cp_model.INFEASIBLE: "INFEASIBLE",
        cp_model.MODEL_INVALID: "MODEL_INVALID",
        cp_model.UNKNOWN: "UNKNOWN",
    }.get(status, "UNKNOWN")

    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        sugestoes = []
        if status == cp_model.INFEASIBLE:
            sugestoes = [
                "Verifique se ha colaboradores suficientes para cobrir a demanda",
                "Verifique se as horas semanais dos contratos sao compativeis com o periodo",
                "Tente um periodo menor ou menos restricoes de demanda",
            ]
        # Diagnostico — ajuda a IA a entender o que aconteceu
        regras_ativas = [k for k, v in rules.items() if v in ("HARD", "SOFT", "ON")]
        regras_off = [k for k, v in rules.items() if v == "OFF"]
        return {
            "sucesso": False,
            "status": status_name,
            "solve_time_ms": round(solve_time_ms, 1),
            "erro": {
                "tipo": "CONSTRAINT",
                "regra": "SOLVER",
                "mensagem": f"Solver retornou {status_name}: impossivel satisfazer todas as restricoes simultaneamente",
                "sugestoes": sugestoes,
            },
            "diagnostico": {
                "status_cp_sat": status_name,
                "solve_time_ms": round(solve_time_ms, 1),
                "generation_mode": generation_mode,
                "policy_adjustments": policy_adjustments or [],
                "regras_ativas": regras_ativas,
                "regras_off": regras_off,
                "motivo_infeasible": f"Solver retornou {status_name}: impossivel satisfazer todas as restricoes simultaneamente",
                "num_colaboradores": len(colabs),
                "num_dias": len(days),
            },
        }

    # --- Build alocacoes ---
    alocacoes: List[dict] = []
    decisoes: List[dict] = []
    weekly_totals: Dict[int, int] = {}

    for c in range(C):
        colab_id = colabs[c]["id"]
        colab_nome = colabs[c]["nome"]
        total_week = 0

        for d in range(D):
            slots_worked = sorted(
                s for s in range(S) if solver.value(work[c, d, s]) == 1
            )

            if not slots_worked:
                alocacoes.append({
                    "colaborador_id": colab_id,
                    "colaborador": colab_nome,
                    "data": days[d],
                    "status": "FOLGA",
                    "hora_inicio": None,
                    "hora_fim": None,
                    "minutos_trabalho": 0,
                    "hora_almoco_inicio": None,
                    "hora_almoco_fim": None,
                    "minutos_almoco": 0,
                    "intervalo_15min": False,
                    "funcao_id": colabs[c].get("funcao_id"),
                    "hora_intervalo_inicio": None,
                    "hora_intervalo_fim": None,
                    "hora_real_inicio": None,
                    "hora_real_fim": None,
                })
                decisoes.append({
                    "colaborador_id": colab_id,
                    "colaborador_nome": colab_nome,
                    "data": days[d],
                    "acao": "FOLGA",
                    "razao": "Dia de folga atribuido pelo solver para cumprir meta semanal",
                    "alternativas_tentadas": 0,
                })
                continue

            first_s = slots_worked[0]
            last_s = slots_worked[-1]
            minutos = len(slots_worked) * grid_min
            total_week += minutos

            inicio = slot_to_time(first_s, base_h, grid_min)
            fim = slot_to_time(last_s + 1, base_h, grid_min)

            # Detect lunch gap
            almoco_inicio = None
            almoco_fim = None
            minutos_almoco = 0
            gap_slots = [
                s for s in range(first_s, last_s + 1) if s not in slots_worked
            ]
            if gap_slots:
                gap_start = gap_slots[0]
                gap_end = gap_slots[-1]
                almoco_inicio = slot_to_time(gap_start, base_h, grid_min)
                almoco_fim = slot_to_time(gap_end + 1, base_h, grid_min)
                minutos_almoco = len(gap_slots) * grid_min

            # Intervalo 15min: jornada >4h e <=6h (Art. 71 §1 CLT)
            intervalo_15min = 240 < minutos <= 360

            # H7 post-processing: posicionar break 15min e calcular hora real
            hora_intervalo_inicio = None
            hora_intervalo_fim = None
            hora_real_inicio = None
            hora_real_fim = None

            if intervalo_15min and inicio and fim:
                hi_min = int(inicio[:2]) * 60 + int(inicio[3:5])
                hf_min = int(fim[:2]) * 60 + int(fim[3:5])

                # Posicao do break: janela 2h apos inicio ate 1h antes do fim
                janela_ini = hi_min + 120
                janela_fim_brk = hf_min - 60
                if janela_ini >= janela_fim_brk:
                    break_min = (hi_min + hf_min) // 2  # fallback: meio da jornada
                else:
                    break_min = (janela_ini + janela_fim_brk) // 2

                hora_intervalo_inicio = f"{break_min // 60:02d}:{break_min % 60:02d}"
                hora_intervalo_fim = f"{(break_min + 15) // 60:02d}:{(break_min + 15) % 60:02d}"

                # Extrapolacao: 15min sao "purgaveis" (CLT > horario setor/colab)
                # So NAO ultrapassam contrato/perfil (max_minutos_dia)
                max_dia = colabs[c].get("max_minutos_dia")
                if max_dia and (minutos + 15) > max_dia:
                    # Contrato prevalece — break absorvido, sem esticar
                    hora_real_inicio = inicio
                    hora_real_fim = fim
                else:
                    # Default: estender no fim (sair 15min depois)
                    hora_real_inicio = inicio
                    real_fim_min = hf_min + 15
                    hora_real_fim = f"{real_fim_min // 60:02d}:{real_fim_min % 60:02d}"

            alocacoes.append({
                "colaborador_id": colab_id,
                "colaborador": colab_nome,
                "data": days[d],
                "status": "TRABALHO",
                "hora_inicio": inicio,
                "hora_fim": fim,
                "minutos_trabalho": minutos,
                "hora_almoco_inicio": almoco_inicio,
                "hora_almoco_fim": almoco_fim,
                "minutos_almoco": minutos_almoco,
                "intervalo_15min": intervalo_15min,
                "funcao_id": colabs[c].get("funcao_id"),
                "hora_intervalo_inicio": hora_intervalo_inicio,
                "hora_intervalo_fim": hora_intervalo_fim,
                "hora_real_inicio": hora_real_inicio,
                "hora_real_fim": hora_real_fim,
            })
            decisoes.append({
                "colaborador_id": colab_id,
                "colaborador_nome": colab_nome,
                "data": days[d],
                "acao": "ALOCADO",
                "razao": f"Otimizacao global CP-SAT: {inicio}-{fim} ({minutos}min trabalho"
                         + (f", almoco {almoco_inicio}-{almoco_fim}" if almoco_inicio else "")
                         + ")",
                "alternativas_tentadas": 0,
            })

        weekly_totals[colab_id] = total_week

    # --- Indicadores ---
    total_def = sum(solver.value(dv) for dv in deficit.values()) if deficit else 0
    total_sur = sum(solver.value(sv) for sv in surplus.values()) if surplus else 0
    total_demand_slots = sum(demand_by_slot.values())
    covered = total_demand_slots - total_def
    cobertura = (
        round(covered / total_demand_slots * 100, 1)
        if total_demand_slots > 0
        else 100.0
    )

    wm_vals = [solver.value(wm) for wm in weekly_minutes]
    spread_val = max(wm_vals) - min(wm_vals) if wm_vals else 0
    ap1_total = sum(solver.value(ex) for ex in ap1_excess) if ap1_excess else 0

    # Equilibrio: 0-100, inverse of spread relative to average
    avg_weekly = sum(wm_vals) / len(wm_vals) if wm_vals else 0
    equilibrio = round(
        max(0, 100 - (spread_val / max(avg_weekly, 1)) * 100), 0
    ) if wm_vals else 100

    # Pontuacao: 0-100 (calibrada para refletir melhor qualidade percebida)
    # - deficit penalty: cada slot deficit = -3 pts (cobertura prioritaria)
    # - spread penalty: cada 60min de spread = -0.5 pt
    # - ap1 penalty: cada slot acima de 8h = -1 pt
    # - surplus penalty: cada slot surplus = -0.2 pt
    deficit_penalty = min(60, total_def * 3)
    spread_penalty = min(20, spread_val / 120)
    ap1_penalty = min(15, ap1_total * 1.0)
    surplus_penalty = min(10, total_sur * 0.2)
    pontuacao = round(max(0, 100 - deficit_penalty - spread_penalty - ap1_penalty - surplus_penalty), 0)

    # --- Cobertura efetiva (ignora gaps de 1 pessoa em transições) ---
    TRANSICAO_FAIXAS = [
        (7, 0, 7, 30),    # café abertura  07:00-07:30
        (11, 0, 12, 0),   # stagger almoço 11:00-12:00
        (19, 0, 19, 30),  # café fechamento 19:00-19:30
    ]
    deficit_efetivo = 0
    for (d_idx, s_idx), target in demand_by_slot.items():
        if target <= 0:
            continue
        slot_def = solver.value(deficit[(d_idx, s_idx)]) if (d_idx, s_idx) in deficit else 0
        if slot_def <= 0:
            continue
        # Check if slot is in a transition window AND deficit == 1
        slot_min = base_h * 60 + s_idx * grid_min
        slot_h, slot_m = slot_min // 60, slot_min % 60
        in_transicao = False
        for (fh, fm, th, tm) in TRANSICAO_FAIXAS:
            if fh * 60 + fm <= slot_h * 60 + slot_m < th * 60 + tm:
                in_transicao = True
                break
        if in_transicao and slot_def == 1:
            continue  # tolerar gap de 1 em transição
        deficit_efetivo += slot_def

    cobertura_efetiva = (
        round((total_demand_slots - deficit_efetivo) / total_demand_slots * 100, 1)
        if total_demand_slots > 0
        else 100.0
    )

    indicadores = {
        "cobertura_percent": cobertura,
        "cobertura_efetiva_percent": cobertura_efetiva,
        "deficit_total": total_def,
        "surplus_total": total_sur,
        "equilibrio": equilibrio,
        "pontuacao": pontuacao,
        "violacoes_hard": 0,
        "violacoes_soft": 0,
    }

    # --- Comparacao demanda ---
    comparacao_demanda: List[dict] = []
    for d in range(D):
        for s in range(S):
            target = demand_by_slot.get((d, s), 0)
            if target <= 0:
                continue

            cov = 0
            for c in range(C):
                if solver.value(work[c, d, s]) == 1:
                    cov += 1

            comparacao_demanda.append({
                "data": days[d],
                "hora_inicio": slot_to_time(s, base_h, grid_min),
                "hora_fim": slot_to_time(s + 1, base_h, grid_min),
                "planejado": target,
                "executado": cov,
                "delta": cov - target,
                "override": bool(override_by_slot.get((d, s), False)),
            })

    # Gap% — how far from optimal bound
    gap_percent = 0.0
    if status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        obj = solver.objective_value
        bound = solver.best_objective_bound
        if obj != 0:
            gap_percent = abs(obj - bound) / abs(obj) * 100

    # Diagnostico para o path feliz
    regras_ativas = [k for k, v in rules.items() if v in ("HARD", "SOFT", "ON")]
    regras_off = [k for k, v in rules.items() if v == "OFF"]
    diagnostico = {
        "status_cp_sat": status_name,
        "solve_time_ms": round(solve_time_ms, 1),
        "generation_mode": generation_mode,
        "policy_adjustments": policy_adjustments or [],
        "regras_ativas": regras_ativas,
        "regras_off": regras_off,
        "num_colaboradores": len(colabs),
        "num_dias": len(days),
        "gap_percent": round(gap_percent, 2),
        "objective_value": round(solver.objective_value, 0) if status in (cp_model.OPTIMAL, cp_model.FEASIBLE) else None,
    }

    return {
        "sucesso": True,
        "status": status_name,
        "solve_time_ms": round(solve_time_ms, 1),
        "alocacoes": alocacoes,
        "indicadores": indicadores,
        "decisoes": decisoes,
        "comparacao_demanda": comparacao_demanda,
        "diagnostico": diagnostico,
    }


def _analyze_capacity(data: dict) -> dict:
    """Pre-solve capacity analysis: estimate if demand is satisfiable.

    Pure arithmetic — no CP-SAT. Compares theoretical max person-hours
    against total demand. This is an ESTIMATE, not a tight bound.
    """
    colabs = data.get("colaboradores", [])
    days = build_days(data["data_inicio"], data["data_fim"])
    empresa = data["empresa"]
    grid_min = int(empresa.get("grid_minutos", 30))
    base_h, _ = map(int, empresa["hora_abertura"].split(":"))
    end_h, end_m = map(int, empresa["hora_fechamento"].split(":"))
    S = ((end_h * 60 + end_m) - base_h * 60) // grid_min
    D = len(days)

    # Build blocked days (same logic as build_model preprocessing)
    feriados = data.get("feriados", [])
    excecoes = data.get("excecoes", [])

    holiday_prohibited_indices: list[int] = []
    for fer in feriados:
        for d, day in enumerate(days):
            if day == fer["data"] and fer.get("proibido_trabalhar", False):
                holiday_prohibited_indices.append(d)

    blocked_days: dict[int, set] = {c: set() for c in range(len(colabs))}
    for d in holiday_prohibited_indices:
        for c in range(len(colabs)):
            blocked_days[c].add(d)

    colab_id_to_c = {colabs[c]["id"]: c for c in range(len(colabs))}
    for exc in excecoes:
        c = colab_id_to_c.get(exc.get("colaborador_id"))
        if c is not None:
            exc_start = exc.get("data_inicio", "")
            exc_end = exc.get("data_fim", "")
            for d, day in enumerate(days):
                if exc_start <= day <= exc_end:
                    blocked_days[c].add(d)

    # Theoretical capacity (person-slots available)
    max_slots_disponiveis = 0
    for c in range(len(colabs)):
        available_days = sum(1 for d in range(D) if d not in blocked_days[c])
        max_daily_slots = int(colabs[c].get("max_minutos_dia", 600)) // grid_min
        max_slots_disponiveis += available_days * max_daily_slots

    # Total demand (slots needed)
    demand_by_slot, _ = parse_demand(
        data["demanda"],
        days=days,
        base_hour=base_h,
        grid_min=grid_min,
        demanda_excecao_data=data.get("demanda_excecao_data"),
    )
    total_slots_demanda = sum(demand_by_slot.values())

    ratio = (max_slots_disponiveis / total_slots_demanda) if total_slots_demanda > 0 else 999.0

    return {
        "total_slots_demanda": total_slots_demanda,
        "max_slots_disponiveis": max_slots_disponiveis,
        "ratio_cobertura_max": round(ratio, 2),
        "cobertura_matematicamente_possivel": ratio >= 1.0,
    }


def _solve_pass(
    data: dict,
    pass_num: int | str,
    relaxations: List[str],
    max_time: float,
    gap_limit: float,
    num_workers: int,
    pinned_folga: Dict[Tuple[int, int], int] | None = None,
) -> dict:
    """Execute a single solve pass with optional constraint relaxations."""
    config = data.get("config", {})

    if pass_num == 1:
        log(f"Passo 1: resolvendo com todas as regras CLT (max {max_time:.0f}s)...")
    elif pass_num == "1b":
        log(f"Passo 1b: padrao de folgas fixado + meta de horas flexivel (max {max_time:.0f}s)...")
    elif pass_num == 2:
        log(f"Passo 2: relaxando meta de horas e dias de trabalho (max {max_time:.0f}s)...")
    else:
        log(f"Passo 3: modo emergencia — apenas regras CLT obrigatorias (max {max_time:.0f}s)...")

    (
        model,
        work,
        works_day,
        block_starts,
        colabs_list,
        days,
        C,
        D,
        S,
        demand_by_slot,
        override_by_slot,
        deficit,
        surplus,
        weekly_minutes,
        ap1_excess,
        base_h,
        grid_min,
    ) = build_model(data, relaxations=relaxations, pinned_folga=pinned_folga)

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = max_time
    solver.parameters.num_workers = num_workers
    solver.parameters.log_search_progress = True
    solver.parameters.log_to_stdout = False
    if gap_limit > 0:
        solver.parameters.relative_gap_limit = gap_limit

    t0 = time.time()
    status = solver.solve(model)
    solve_time_ms = (time.time() - t0) * 1000

    result = extract_solution(
        solver,
        work,
        colabs_list,
        days,
        C,
        D,
        S,
        demand_by_slot,
        override_by_slot,
        deficit,
        surplus,
        weekly_minutes,
        ap1_excess,
        status,
        solve_time_ms,
        base_h,
        grid_min,
        rules=config.get("rules", {}),
        generation_mode=config.get("generation_mode", "OFFICIAL"),
        policy_adjustments=config.get("policy_adjustments", []),
    )

    status_label = result.get('status', 'UNKNOWN')
    cob = result.get('indicadores', {}).get('cobertura_percent', '?')
    t_s = solve_time_ms / 1000
    if status_label == 'INFEASIBLE':
        log(f"Passo {pass_num}: impossivel encontrar solucao em {t_s:.1f}s")
    elif status_label in ('OPTIMAL', 'FEASIBLE'):
        qual = 'otima' if status_label == 'OPTIMAL' else 'viavel'
        log(f"Passo {pass_num}: solucao {qual} em {t_s:.1f}s — cobertura {cob}%")
    else:
        log(f"Passo {pass_num}: {status_label} em {t_s:.1f}s — cobertura {cob}%")

    return result


def _get_coverage(result: dict) -> float:
    """Extract cobertura_percent from a solver result, defaulting to 0."""
    return result.get("indicadores", {}).get("cobertura_percent", 0.0)


def _coverage_is_viable(result: dict) -> bool:
    """Check if the result's coverage meets the minimum viable threshold."""
    return _get_coverage(result) >= MIN_COVERAGE_THRESHOLD


def solve(data: dict) -> dict:
    """Main solve function with multi-pass graceful degradation.

    Pass 1: Normal solve with all configured rules.
    Pass 2: Relax only product/contract rules that do not invalidate legality.
    Pass 3:
      - OFFICIAL: legal-first fallback, still preserving legal blockers.
      - EXPLORATORY: emergency mode, including relaxations that can invalidate officialization.

    Minimum-coverage continuation: if a pass returns FEASIBLE but coverage
    is below MIN_COVERAGE_THRESHOLD, the solver retries with progressively
    more time (doubling each attempt) until coverage is reached or the
    HARD_TIME_CAP_SECONDS (1 hour) is hit. This applies to ALL modes,
    including 'rapido'.

    Returns the result from the first pass that succeeds with viable coverage.
    """
    colabs = data.get("colaboradores", [])
    if not colabs:
        return {
            "sucesso": False,
            "status": "INFEASIBLE",
            "solve_time_ms": 0,
            "erro": {
                "tipo": "PREFLIGHT",
                "regra": "SEM_COLABORADORES",
                "mensagem": "Nenhum colaborador ativo para gerar escala",
                "sugestoes": ["Cadastre ao menos 1 colaborador no setor"],
            },
        }

    config = data.get("config", {})
    generation_mode = config.get("generation_mode", "OFFICIAL")
    solve_mode = config.get("solve_mode", "rapido")
    num_workers = config.get("num_workers", 8)

    profile = MODE_PROFILES.get(solve_mode, MODE_PROFILES["rapido"])
    total_budget = config.get("max_time_seconds", profile["budget"])
    gap_limit = profile["gap"]

    # Divide time budget across passes (Pass 1 gets more, Pass 2/3 are fallback)
    pass1_time = max(10, total_budget * 0.5)
    pass2_time = max(10, total_budget * 0.3)
    pass3_time = max(10, total_budget * 0.2)

    # Track total elapsed time for the hard cap
    t_global_start = time.time()

    n_dias = (datetime.strptime(data['data_fim'], "%Y-%m-%d") - datetime.strptime(data['data_inicio'], "%Y-%m-%d")).days + 1
    log(f"Montando modelo: {len(colabs)} colaboradores, {n_dias} dias, modo {solve_mode}")

    # Pre-analysis: capacity vs demand
    capacidade_diag = _analyze_capacity(data)
    ratio_pct = round(capacidade_diag['ratio_cobertura_max'] * 100)
    log(f"Capacidade estimada: {ratio_pct}% da demanda pode ser coberta")

    # If demand is mathematically impossible to cover, skip continuation logic
    math_possible = capacidade_diag.get("cobertura_matematicamente_possivel", True)

    cycle_weeks = _compute_cycle_weeks_fast(colabs, data.get("demanda", []))

    # --- Helper: run a pass with minimum-coverage continuation ---
    # Per-pass cap: don't let continuation blow past the mode budget
    pass_time_cap = total_budget * 2  # generous but bounded

    def _run_with_continuation(
        pass_num: int | str,
        relaxations: list,
        initial_time: float,
        pass_gap: float,
        pinned_folga: Dict[Tuple[int, int], int] | None = None,
    ) -> dict:
        """Run a solver pass. If FEASIBLE but below MIN_COVERAGE_THRESHOLD,
        retry with doubled time budget until coverage is met or time cap is hit."""
        current_time = initial_time
        best_result = None
        attempt = 0
        MAX_CONTINUATION_ATTEMPTS = 3

        while True:
            attempt += 1
            elapsed_total = time.time() - t_global_start
            remaining = min(HARD_TIME_CAP_SECONDS, pass_time_cap) - elapsed_total

            if remaining <= 5 or attempt > MAX_CONTINUATION_ATTEMPTS:
                if attempt > MAX_CONTINUATION_ATTEMPTS:
                    log(f"Passo {pass_num}: max tentativas ({MAX_CONTINUATION_ATTEMPTS}) — usando melhor resultado")
                else:
                    log(f"Tempo limite atingido ({elapsed_total:.0f}s) — usando melhor resultado ate agora")
                break

            # Clamp to remaining time
            run_time = min(current_time, remaining)

            if attempt > 1:
                log(f"Passo {pass_num}: cobertura {_get_coverage(best_result):.0f}%, tentando melhorar...")

            result = _solve_pass(
                data,
                pass_num=pass_num,
                relaxations=relaxations,
                max_time=run_time,
                gap_limit=pass_gap,
                num_workers=num_workers,
                pinned_folga=pinned_folga,
            )

            if not result.get("sucesso"):
                # INFEASIBLE — no point retrying this pass
                return best_result if best_result else result

            # Keep the best feasible result (highest coverage)
            if best_result is None or _get_coverage(result) > _get_coverage(best_result):
                best_result = result

            # Check if coverage is good enough
            if _coverage_is_viable(best_result):
                log(f"Passo {pass_num}: cobertura {_get_coverage(best_result):.0f}% atingida")
                return best_result

            # OPTIMAL = provably best — retrying won't improve
            if result.get("status") == "OPTIMAL":
                log(f"Passo {pass_num}: cobertura {_get_coverage(best_result):.0f}% (OPTIMAL — melhor resultado possivel)")
                return best_result

            # Coverage below threshold and demand IS mathematically possible
            if not math_possible:
                log(f"Passo {pass_num}: cobertura {_get_coverage(best_result):.0f}% (demanda excede capacidade maxima — aceitando melhor resultado)")
                return best_result

            # Double the budget for next attempt, relax gap progressively
            current_time = current_time * 2
            pass_gap = max(pass_gap * 0.5, 0.001)  # tighten gap each retry

        return best_result if best_result else {"sucesso": False, "status": "TIMEOUT"}

    # ---- Advisory-only mode: run Phase 1 and return immediately ----
    advisory_only = config.get("advisory_only", False)

    # ---- Phase 1: Folga Pattern (lightweight model) ----
    # Check for external pinned_folga (from Nível 1 simulation)
    external_pinned = config.get("pinned_folga_externo")
    if external_pinned and isinstance(external_pinned, list):
        pinned_folga = {(item["c"], item["d"]): item["band"] for item in external_pinned}
        band_counts = {0: 0, 1: 0, 2: 0, 3: 0}
        for v in pinned_folga.values():
            band_counts[v] = band_counts.get(v, 0) + 1
        phase1_diag = {
            "phase1_status": "EXTERNAL",
            "phase1_bands_pinned": {
                "off": band_counts[0], "manha": band_counts[1],
                "tarde": band_counts[2], "integral": band_counts[3],
            },
        }
        log(f"Padrao de folgas EXTERNO recebido: {sum(1 for v in pinned_folga.values() if v == 0)} dias OFF")
    else:
        phase1_budget = min(15, total_budget * 0.15)  # max 15s, 15% of budget
        log("Calculando padrao de folgas...")

        phase1_result = solve_folga_pattern(data, budget_s=phase1_budget)

        pinned_folga = None
        phase1_diag = {}
        if phase1_result and phase1_result["status"] == "OK":
            pinned_folga = phase1_result["pattern"]
            band_counts = {0: 0, 1: 0, 2: 0, 3: 0}
            for v in pinned_folga.values():
                band_counts[v] = band_counts.get(v, 0) + 1
            phase1_diag = {
                "phase1_status": "OK",
                "phase1_solve_time_ms": phase1_result["time_ms"],
                "phase1_cycle_days": phase1_result.get("cycle_days", 0),
                "phase1_bands_pinned": {
                    "off": band_counts[0], "manha": band_counts[1],
                    "tarde": band_counts[2], "integral": band_counts[3],
                },
            }
            cycle_d = phase1_result.get('cycle_days', 0)
            cycle_w = cycle_d // 7 if cycle_d else '?'
            log(f"Padrao de folgas definido em {phase1_result['time_ms']/1000:.1f}s — ciclo de {cycle_w} semanas")
        else:
            phase1_diag = {"phase1_status": "INFEASIBLE" if phase1_result is None else "SKIPPED"}
            log("Padrao de folgas nao encontrado — usando distribuicao automatica")

    if advisory_only:
        log("Modo advisory: retornando resultado da Phase 1")
        advisory_diag = {
            "generation_mode": "ADVISORY",
            "capacidade_vs_demanda": capacidade_diag,
            "cycle_length_weeks": cycle_weeks,
            "tempo_total_s": round(time.time() - t_global_start, 1),
        }
        advisory_diag.update(phase1_diag)

        if pinned_folga is not None:
            # Serialize pattern as list of {c, d, band} for JSON
            pattern_list = [
                {"c": c, "d": d, "band": band}
                for (c, d), band in sorted(pinned_folga.items())
            ]
            return {
                "sucesso": True,
                "status": "ADVISORY_OK",
                "advisory_pattern": pattern_list,
                "diagnostico": advisory_diag,
                "alocacoes": [],
                "decisoes": [],
                "comparacao_demanda": [],
                "indicadores": {
                    "pontuacao": 0, "cobertura_percent": 0,
                    "violacoes_hard": 0, "violacoes_soft": 0,
                    "equilibrio": 0,
                },
            }
        else:
            return {
                "sucesso": False,
                "status": "ADVISORY_INFEASIBLE",
                "advisory_pattern": [],
                "diagnostico": advisory_diag,
                "alocacoes": [],
                "decisoes": [],
                "comparacao_demanda": [],
                "indicadores": {
                    "pontuacao": 0, "cobertura_percent": 0,
                    "violacoes_hard": 0, "violacoes_soft": 0,
                    "equilibrio": 0,
                },
            }

    # ---- Pass 1: Normal (with Phase 1 folga pinned) ----
    result = _run_with_continuation(
        pass_num=1, relaxations=[], initial_time=pass1_time, pass_gap=gap_limit,
        pinned_folga=pinned_folga,
    )

    if result and result.get("sucesso"):
        diag = result.get("diagnostico", {})
        diag["pass_usado"] = 1
        diag["generation_mode"] = generation_mode
        diag["regras_relaxadas"] = []
        diag["capacidade_vs_demanda"] = capacidade_diag
        diag["cycle_length_weeks"] = cycle_weeks
        diag.update(phase1_diag)
        diag["tempo_total_s"] = round(time.time() - t_global_start, 1)
        result["diagnostico"] = diag
        return result

    exploratory_mode = generation_mode == "EXPLORATORY"

    # ---- Pass 1b: Keep Phase 1 folga pattern + relax hours ----
    # When Pass 1 fails because short days (e.g. Sunday 05:30-11:00) make the
    # weekly hour target unreachable with tolerance=0, this pass preserves the
    # OFF pattern (which days are folga) while freeing band assignments.
    # This keeps 5X2 + domingo_ciclo intact but lets the solver schedule hours freely.
    if pinned_folga is not None:
        elapsed = time.time() - t_global_start
        if elapsed < HARD_TIME_CAP_SECONDS - 5:
            log("Passo 1b: mantendo padrao de folgas, flexibilizando horarios...")

            # Convert to folga-only pins: OFF stays OFF, everything else → INTEGRAL (no restriction)
            BAND_OFF = 0
            BAND_INTEGRAL = 3
            folga_only_pins = {
                k: (BAND_OFF if v == BAND_OFF else BAND_INTEGRAL)
                for k, v in pinned_folga.items()
            }

            pass1b_relaxations = ["DIAS_TRABALHO", "MIN_DIARIO"]
            if exploratory_mode:
                pass1b_relaxations.append("H6")
            result = _run_with_continuation(
                pass_num="1b", relaxations=pass1b_relaxations,
                initial_time=pass1_time, pass_gap=gap_limit,
                pinned_folga=folga_only_pins,
            )

            if result and result.get("sucesso"):
                diag = result.get("diagnostico", {})
                diag["pass_usado"] = "1b"
                diag["generation_mode"] = generation_mode
                diag["regras_relaxadas"] = ["DIAS_TRABALHO", "MIN_DIARIO"] + (["H6"] if exploratory_mode else [])
                diag["capacidade_vs_demanda"] = capacidade_diag
                diag["cycle_length_weeks"] = cycle_weeks
                diag.update(phase1_diag)
                diag["tempo_total_s"] = round(time.time() - t_global_start, 1)
                result["diagnostico"] = diag
                return result

    # ---- Pass 2: Relax product rules to SOFT (no Phase 1 pin — let it emerge) ----
    elapsed = time.time() - t_global_start
    if elapsed < HARD_TIME_CAP_SECONDS - 5:
        if pinned_folga is not None:
            log("Passo 1b impossivel — relaxando todas as regras e removendo padrão de folgas...")
        else:
            log("Passo 1 impossivel — relaxando regras de produto...")

        pass2_relaxations = ["DIAS_TRABALHO", "MIN_DIARIO"]
        if exploratory_mode:
            pass2_relaxations.append("H6")
        result = _run_with_continuation(
            pass_num=2, relaxations=pass2_relaxations, initial_time=pass2_time, pass_gap=gap_limit,
            pinned_folga=None,  # drop Phase 1 pin in degradation
        )

        if result and result.get("sucesso"):
            diag = result.get("diagnostico", {})
            diag["pass_usado"] = 2
            diag["generation_mode"] = generation_mode
            diag["regras_relaxadas"] = ["DIAS_TRABALHO", "MIN_DIARIO"] + (["H6"] if exploratory_mode else [])
            diag["capacidade_vs_demanda"] = capacidade_diag
            diag["cycle_length_weeks"] = cycle_weeks
            diag.update(phase1_diag)
            diag["tempo_total_s"] = round(time.time() - t_global_start, 1)
            result["diagnostico"] = diag
            return result

    # ---- Pass 3: Last resort fallback ----
    elapsed = time.time() - t_global_start
    if elapsed < HARD_TIME_CAP_SECONDS - 5:
        if exploratory_mode:
            log("Passo 2 impossivel — modo exploratorio de emergencia")
            pass3_relaxations = ["ALL_PRODUCT_RULES"]
        else:
            log("Passo 2 impossivel — fallback legal-first (sem relaxar regras de oficializacao)")
            pass3_relaxations = ["DIAS_TRABALHO", "MIN_DIARIO", "FOLGA_FIXA", "FOLGA_VARIAVEL", "TIME_WINDOW"]
        result = _run_with_continuation(
            pass_num=3, relaxations=pass3_relaxations, initial_time=pass3_time, pass_gap=gap_limit,
            pinned_folga=None,
        )
    else:
        result = result if result else {"sucesso": False, "status": "TIMEOUT"}

    diag = result.get("diagnostico", {}) if result else {}
    diag["pass_usado"] = 3
    diag["generation_mode"] = generation_mode
    diag["regras_relaxadas"] = (
        ["H1", "H6", "H10", "DIAS_TRABALHO", "MIN_DIARIO", "FOLGA_FIXA", "FOLGA_VARIAVEL", "TIME_WINDOW"]
        if exploratory_mode
        else ["DIAS_TRABALHO", "MIN_DIARIO", "FOLGA_FIXA", "FOLGA_VARIAVEL", "TIME_WINDOW"]
    )
    diag["capacidade_vs_demanda"] = capacidade_diag
    diag["cycle_length_weeks"] = cycle_weeks
    diag.update(phase1_diag)
    diag["modo_emergencia"] = exploratory_mode
    diag["tempo_total_s"] = round(time.time() - t_global_start, 1)
    if result:
        result["diagnostico"] = diag

    if not result or not result.get("sucesso"):
        # All 3 passes failed — truly impossible (e.g., 0 available colabs)
        log("Impossivel gerar escala mesmo com regras relaxadas")
        if result and "erro" not in result:
            result["erro"] = {
                "tipo": "CONSTRAINT",
                "regra": "SOLVER",
                "mensagem": "Impossivel gerar escala mesmo com relaxamento maximo de regras",
                "sugestoes": [
                    "Verifique se ha colaboradores suficientes e disponiveis no periodo",
                    "Verifique excecoes (ferias/atestados) que podem estar bloqueando todos",
                    "Tente um periodo menor",
                ],
            }
        elif not result:
            result = {
                "sucesso": False,
                "status": "TIMEOUT",
                "solve_time_ms": round((time.time() - t_global_start) * 1000, 1),
                "diagnostico": diag,
                "erro": {
                    "tipo": "TIMEOUT",
                    "regra": "HARD_CAP",
                    "mensagem": f"Solver atingiu o limite de {HARD_TIME_CAP_SECONDS}s sem alcancar cobertura minima",
                    "sugestoes": [
                        "A demanda pode estar acima da capacidade disponivel",
                        "Verifique se ha colaboradores suficientes no setor",
                    ],
                },
            }

    return result


def parse_from_db(db_path: str) -> dict:
    """Parse solver input directly from SQLite DB (for testing/CLI use)."""
    import sqlite3
    from datetime import date as dt_date, timedelta as dt_timedelta

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row

    emp = conn.execute("select * from empresa limit 1").fetchone()
    setor = conn.execute("select * from setores where id=1 limit 1").fetchone()
    setor_id = int(setor["id"]) if setor else 1

    col_rows = conn.execute(
        """
        select c.id, c.nome, c.horas_semanais, c.rank,
               tc.dias_trabalho, tc.max_minutos_dia, tc.regime_escala
        from colaboradores c
        join tipos_contrato tc on tc.id = c.tipo_contrato_id
        where c.setor_id = ? and c.ativo = 1
        order by c.rank
        """,
        (setor_id,),
    ).fetchall()

    dem_rows = conn.execute(
        "select * from demandas where setor_id = ? order by hora_inicio",
        (setor_id,),
    ).fetchall()

    exc_rows = conn.execute("select * from excecoes").fetchall()

    # Use fixed reference period matching ground truth for comparison
    # In production, these come from the UI via solver-bridge.ts
    days = ["2026-02-09", "2026-02-10", "2026-02-11", "2026-02-12", "2026-02-13", "2026-02-14"]

    colaboradores = []
    for r in col_rows:
        # Match solver-bridge.ts logic:
        # regime_escala from DB, then derive dias_trabalho from it (6X1→6, 5X2→5)
        regime = r["regime_escala"] or ("5X2" if int(r["dias_trabalho"]) <= 5 else "6X1")
        dias_efetivo = 5 if regime == "5X2" else 6
        colaboradores.append({
            "id": r["id"],
            "nome": r["nome"],
            "horas_semanais": int(r["horas_semanais"]),
            "dias_trabalho": dias_efetivo,
            "regime_escala": regime,
            "max_minutos_dia": int(r["max_minutos_dia"]),
            "rank": r["rank"],
            "tipo_trabalhador": "CLT",
        })

    demanda = []
    for r in dem_rows:
        demanda.append({
            "dia_semana": r["dia_semana"],
            "hora_inicio": r["hora_inicio"],
            "hora_fim": r["hora_fim"],
            "min_pessoas": int(r["min_pessoas"]),
            "override": bool(r["override"]),
        })

    excecoes = []
    for r in exc_rows:
        excecoes.append(dict(r))

    conn.close()

    return {
        "data_inicio": days[0],
        "data_fim": days[-1],
        "empresa": {
            "hora_abertura": "08:00",
            "hora_fechamento": "20:00",
            "tolerancia_semanal_min": int(emp["tolerancia_semanal_min"]) if emp else 30,
            "grid_minutos": int(emp["grid_minutos"]) if emp else 30,
            "min_intervalo_almoco_min": int(emp["min_intervalo_almoco_min"]) if emp and "min_intervalo_almoco_min" in emp.keys() else 60,
        },
        "colaboradores": colaboradores,
        "demanda": demanda,
        "excecoes": excecoes,
        "feriados": [],
        "pinned_cells": [],
    }


def main() -> None:
    """Entry point: accepts DB path as argument OR JSON via stdin."""
    try:
        # If a .db file is passed as argument, use parse_from_db
        if len(sys.argv) > 1 and sys.argv[1].endswith(".db"):
            db_path = sys.argv[1]
            log(f"Reading from DB: {db_path}")
            data = parse_from_db(db_path)
            result = solve(data)
            # Write result to file next to the solver
            import os
            out_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "resultado_python.json")
            with open(out_path, "w", encoding="utf-8") as f:
                json.dump(result, f, ensure_ascii=False, indent=2)
            log(f"Result written to {out_path}")
            json.dump(result, sys.stdout, ensure_ascii=False)
            return

        raw = sys.stdin.read()
        if not raw.strip():
            result = {
                "sucesso": False,
                "status": "ERROR",
                "solve_time_ms": 0,
                "erro": {
                    "tipo": "PREFLIGHT",
                    "regra": "EMPTY_INPUT",
                    "mensagem": "Nenhum input recebido via stdin",
                    "sugestoes": ["Envie JSON valido via stdin"],
                },
            }
            json.dump(result, sys.stdout, ensure_ascii=False)
            sys.exit(1)

        data = json.loads(raw)
        result = solve(data)
        json.dump(result, sys.stdout, ensure_ascii=False)

    except json.JSONDecodeError as e:
        result = {
            "sucesso": False,
            "status": "ERROR",
            "solve_time_ms": 0,
            "erro": {
                "tipo": "PREFLIGHT",
                "regra": "INVALID_JSON",
                "mensagem": f"JSON invalido: {e}",
                "sugestoes": ["Verifique o formato do JSON de entrada"],
            },
        }
        json.dump(result, sys.stdout, ensure_ascii=False)
        sys.exit(1)

    except Exception as e:
        log(f"FATAL ERROR: {e}")
        result = {
            "sucesso": False,
            "status": "ERROR",
            "solve_time_ms": 0,
            "erro": {
                "tipo": "CONSTRAINT",
                "regra": "INTERNAL",
                "mensagem": f"Erro interno do solver: {e}",
                "sugestoes": ["Reporte este erro ao suporte"],
            },
        }
        json.dump(result, sys.stdout, ensure_ascii=False)
        sys.exit(1)


if __name__ == "__main__":
    main()
