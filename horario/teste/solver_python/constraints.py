"""
constraints.py — CP-SAT constraint builders aligned with Motor v3 RFC v3.1
==========================================================================

Naming: ALL functions use RFC constraint IDs (H1, H2, H4, H6, etc.)
No "cheats": max_gap=4 (2h CLT), single_block ACTIVE, min_daily=8 (4h).

Architecture:
  HARD  → model.add()  → solver MUST satisfy or INFEASIBLE
  SOFT  → penalty vars → added to objective with weights

References:
  - docs/MOTOR_V3_RFC.md §4 (H1-H20)
  - src/shared/constants.ts (CLT, ANTIPATTERNS)
  - horario/teste/SOLVER_HIERARCHY.md (weight rationale)
"""

from __future__ import annotations

from typing import Dict, List, Tuple

from ortools.sat.python import cp_model


# ---------------------------------------------------------------------------
# Type aliases
# ---------------------------------------------------------------------------

SlotGrid = Dict[Tuple[int, int, int], cp_model.IntVar]     # (c, d, s) -> BoolVar
WorksDay = Dict[Tuple[int, int], cp_model.IntVar]          # (c, d)    -> BoolVar
BlockStarts = Dict[Tuple[int, int, int], cp_model.IntVar]  # (c, d, s) -> BoolVar
DaySlotDemand = Dict[Tuple[int, int], int]                  # (d, s)    -> target


# ===================================================================
# HELPERS
# ===================================================================

def make_works_day(
    model: cp_model.CpModel,
    work: SlotGrid,
    C: int, D: int, S: int,
) -> WorksDay:
    """BoolVar works_day[c,d] = 1 iff collaborator c works at least 1 slot on day d."""
    works_day: WorksDay = {}
    for c in range(C):
        for d in range(D):
            wd = model.new_bool_var(f"wd_{c}_{d}")
            day_slots = [work[c, d, s] for s in range(S)]
            model.add(sum(day_slots) > 0).only_enforce_if(wd)
            model.add(sum(day_slots) == 0).only_enforce_if(wd.negated())
            works_day[c, d] = wd
    return works_day


def make_block_starts(
    model: cp_model.CpModel,
    work: SlotGrid,
    C: int, D: int, S: int,
) -> BlockStarts:
    """BoolVar block_starts[c,d,s] = 1 iff slot s is a 0->1 rising edge.

    Created ONCE and reused by H9 (max blocos) and H9b (single block).
    """
    bs_dict: BlockStarts = {}
    for c in range(C):
        for d in range(D):
            for s in range(S):
                bs = model.new_bool_var(f"bs_{c}_{d}_{s}")
                if s == 0:
                    model.add(work[c, d, 0] == 1).only_enforce_if(bs)
                    model.add(work[c, d, 0] == 0).only_enforce_if(bs.negated())
                else:
                    model.add(work[c, d, s] == 1).only_enforce_if(bs)
                    model.add(work[c, d, s - 1] == 0).only_enforce_if(bs)
                    model.add_bool_or([
                        work[c, d, s].negated(),
                        work[c, d, s - 1],
                    ]).only_enforce_if(bs.negated())
                bs_dict[c, d, s] = bs
    return bs_dict


# ===================================================================
# CAMADA 1 — HARD CONSTRAINTS (CLT Legal)
# ===================================================================

def add_h1_max_dias_consecutivos(
    model: cp_model.CpModel,
    works_day: WorksDay,
    C: int, D: int,
    max_consecutive: int = 6,
) -> None:
    """H1: Max 6 dias consecutivos. Art. 67 CLT + OJ 410 TST."""
    window = max_consecutive + 1
    for c in range(C):
        for start in range(D - window + 1):
            model.add(
                sum(works_day[c, start + i] for i in range(window)) <= max_consecutive
            )


def add_h2_interjornada(
    model: cp_model.CpModel,
    work: SlotGrid,
    C: int, D: int, S: int,
    min_rest_min: int = 660,
    grid_min: int = 30,
) -> None:
    """H2: Min 11h entre jornadas. Art. 66 CLT.

    For 12h operating window (08:00-20:00), rest is always >= 12h,
    so no clauses are emitted. Included for correctness with wider windows.
    """
    rest_base = 1440 - grid_min
    for c in range(C):
        for d in range(D - 1):
            for s_end in range(S):
                for s_start in range(S):
                    rest = rest_base + grid_min * (s_start - s_end)
                    if rest < min_rest_min:
                        model.add_bool_or([
                            work[c, d, s_end].negated(),
                            work[c, d + 1, s_start].negated(),
                        ])


def add_h4_max_jornada_diaria(
    model: cp_model.CpModel,
    work: SlotGrid,
    colabs: List[dict],
    C: int, D: int, S: int,
    grid_min: int = 30,
) -> None:
    """H4: Max minutos por dia per contrato. Art. 58+59 CLT."""
    for c in range(C):
        max_slots = colabs[c]["max_minutos_dia"] // grid_min
        for d in range(D):
            model.add(sum(work[c, d, s] for s in range(S)) <= max_slots)


def add_h6_almoco_obrigatorio(
    model: cp_model.CpModel,
    work: SlotGrid,
    C: int, D: int, S: int,
    min_lunch_slots: int = 2,
    lunch_window_start: int = 6,
    lunch_window_end: int = 14,
    threshold_slots: int = 12,
) -> None:
    """H6: >6h -> almoco obrigatorio na janela. Art. 71 CLT.

    Forces at least min_lunch_slots consecutive non-work slots within
    [lunch_window_start, lunch_window_end) when daily work > threshold_slots.
    """
    for c in range(C):
        for d in range(D):
            day_total = sum(work[c, d, s] for s in range(S))

            needs_lunch = model.new_bool_var(f"nl_{c}_{d}")
            model.add(day_total > threshold_slots).only_enforce_if(needs_lunch)
            model.add(day_total <= threshold_slots).only_enforce_if(needs_lunch.negated())

            lunch_options: list[cp_model.IntVar] = []
            last_start = lunch_window_end - min_lunch_slots + 1
            for ls in range(lunch_window_start, last_start + 1):
                opt = model.new_bool_var(f"lo_{c}_{d}_{ls}")
                for offset in range(min_lunch_slots):
                    if ls + offset < S:
                        model.add(work[c, d, ls + offset] == 0).only_enforce_if(opt)
                lunch_options.append(opt)

            if lunch_options:
                model.add(sum(lunch_options) >= 1).only_enforce_if(needs_lunch)


def add_h7b_max_gap(
    model: cp_model.CpModel,
    work: SlotGrid,
    C: int, D: int, S: int,
    max_gap_slots: int = 4,
) -> None:
    """H7b: Max gap = 2h (4 slots) BETWEEN work blocks. Art. 71 CLT.

    CLT Art. 71: intervalo para repouso ou alimentacao de no MINIMO 1h
    e no MAXIMO 2h. max_gap_slots=4 = 2h.

    FIX: Only constrains gaps BETWEEN two work slots (not end-of-day).
    For any pair (s1, s2) with s2 - s1 > max_gap_slots + 1, if both
    work[s1]=1 and work[s2]=1, at least one slot between them must be worked.
    This allows ending work at any time without chaining.
    """
    for c in range(C):
        for d in range(D):
            for s1 in range(S):
                for s2 in range(s1 + max_gap_slots + 2, S):
                    model.add(
                        sum(work[c, d, k] for k in range(s1 + 1, s2)) >= 1
                    ).only_enforce_if([work[c, d, s1], work[c, d, s2]])


def add_h9_max_blocos(
    model: cp_model.CpModel,
    block_starts: BlockStarts,
    C: int, D: int, S: int,
) -> None:
    """H9: Max 2 blocos de trabalho por dia. Art. 71 CLT (implicito).

    Combined with H6/H7b: long day = exactly 2 blocks with 1h-2h gap.
    """
    for c in range(C):
        for d in range(D):
            model.add(sum(block_starts[c, d, s] for s in range(S)) <= 2)


def add_h9b_bloco_unico_dia_curto(
    model: cp_model.CpModel,
    work: SlotGrid,
    block_starts: BlockStarts,
    C: int, D: int, S: int,
    threshold_slots: int = 12,
) -> None:
    """H9b: Dia <=6h = bloco unico (sem gap). Art. 71 CLT.

    Short days don't need lunch break, so work MUST be 1 contiguous block.
    This prevents split shifts for 30h workers (which was the main "cheat").
    """
    for c in range(C):
        for d in range(D):
            day_total = sum(work[c, d, s] for s in range(S))

            is_short = model.new_bool_var(f"srt_{c}_{d}")
            model.add(day_total <= threshold_slots).only_enforce_if(is_short)
            model.add(day_total > threshold_slots).only_enforce_if(is_short.negated())

            model.add(
                sum(block_starts[c, d, s] for s in range(S)) <= 1
            ).only_enforce_if(is_short)


def add_h10_meta_semanal(
    model: cp_model.CpModel,
    work: SlotGrid,
    colabs: List[dict],
    C: int, D: int, S: int,
    tolerance_min: int = 30,
    grid_min: int = 30,
) -> List[cp_model.IntVar]:
    """H10: Horas semanais +- tolerancia. Art. 58 CLT.

    Returns list of IntVars for weekly minutes (used in objective for spread).
    """
    weekly_minutes: list[cp_model.IntVar] = []
    for c in range(C):
        target = colabs[c]["horas_semanais"] * 60
        lo = target - tolerance_min
        hi = target + tolerance_min
        wm = model.new_int_var(lo, hi, f"wm_{c}")
        model.add(
            wm == sum(work[c, d, s] for d in range(D) for s in range(S)) * grid_min
        )
        weekly_minutes.append(wm)
    return weekly_minutes


def add_h20_gap_na_janela(
    model: cp_model.CpModel,
    work: SlotGrid,
    C: int, D: int, S: int,
    lunch_window_start: int = 6,
    lunch_window_end: int = 14,
    threshold_slots: int = 12,
) -> None:
    """H20: Gap de almoco deve estar dentro da janela 11:00-15:00.

    For long days: work is non-decreasing before lunch window
    (no stopping before lunch), non-increasing after (no restarting after).
    Forces the single gap to fall within the lunch window.
    """
    for c in range(C):
        for d in range(D):
            day_total = sum(work[c, d, s] for s in range(S))

            is_long = model.new_bool_var(f"lng_{c}_{d}")
            model.add(day_total > threshold_slots).only_enforce_if(is_long)
            model.add(day_total <= threshold_slots).only_enforce_if(is_long.negated())

            # Before lunch window: non-decreasing (no gap before 11:00)
            for s in range(min(lunch_window_start, S) - 1):
                model.add(
                    work[c, d, s + 1] >= work[c, d, s]
                ).only_enforce_if(is_long)

            # After lunch window: non-increasing (no gap after 15:00)
            for s in range(lunch_window_end, S - 1):
                model.add(
                    work[c, d, s + 1] <= work[c, d, s]
                ).only_enforce_if(is_long)


# ===================================================================
# CAMADA 1 — PRODUCT RULES (Hard but adjustable by product owner)
# ===================================================================

def add_dias_trabalho(
    model: cp_model.CpModel,
    works_day: WorksDay,
    colabs: List[dict],
    C: int, D: int,
) -> None:
    """Force correct number of work days per collaborator.

    If dias_trabalho >= D: work ALL days (44h/36h workers in 6-day period).
    Otherwise: exactly dias_trabalho days (respects folga).
    """
    for c in range(C):
        dias = colabs[c]["dias_trabalho"]
        if dias >= D:
            for d in range(D):
                model.add(works_day[c, d] == 1)
        else:
            model.add(
                sum(works_day[c, d] for d in range(D)) == dias
            )


def add_min_diario(
    model: cp_model.CpModel,
    work: SlotGrid,
    works_day: WorksDay,
    C: int, D: int, S: int,
    min_slots: int = 8,
) -> None:
    """Min 4h (8 slots) per work day. Product rule (CLT.MIN_JORNADA_DIA_MIN=240)."""
    for c in range(C):
        for d in range(D):
            day_total = sum(work[c, d, s] for s in range(S))
            model.add(day_total >= min_slots).only_enforce_if(works_day[c, d])


# ===================================================================
# CAMADA 2 — SOFT: DEMAND DEFICIT (peso 10000)
# ===================================================================

def add_demand_soft(
    model: cp_model.CpModel,
    work: SlotGrid,
    demand_by_slot: DaySlotDemand,
    C: int, D: int, S: int,
) -> Dict[Tuple[int, int], cp_model.IntVar]:
    """Demand as SOFT constraint (not HARD).

    Returns deficit vars: deficit[d,s] = max(0, target - coverage).
    These are added to the objective with weight 10000.

    WHY SOFT: With 6 people and CLT constraints, 100% coverage is
    mathematically impossible (margin: 0.5%). Forcing HARD demand = INFEASIBLE.
    Rita (30+ years experience) achieves ~85%. Honest solver does the same.
    """
    deficit: Dict[Tuple[int, int], cp_model.IntVar] = {}
    for d in range(D):
        for s in range(S):
            target = demand_by_slot.get((d, s), 0)
            if target <= 0:
                continue
            cov = sum(work[c, d, s] for c in range(C))
            dv = model.new_int_var(0, target, f"def_{d}_{s}")
            model.add(dv >= target - cov)
            deficit[d, s] = dv
    return deficit


# ===================================================================
# CAMADA 3 — SOFT: ANTIPATTERN PENALTIES
# ===================================================================

def add_ap1_jornada_excessiva(
    model: cp_model.CpModel,
    work: SlotGrid,
    C: int, D: int, S: int,
    threshold_slots: int = 16,
) -> List[cp_model.IntVar]:
    """AP1: Excess daily work > 8h (16 slots).

    Returns excess variables: amount OVER 8h per (person, day).
    Weight: 80 per excess slot in objective.

    Based on: ANTIPATTERNS.PESO_HORA_EXTRA_EVITAVEL = -8 (from constants.ts)
    Scaled by 10 for CP-SAT: 80.
    """
    excess_vars: list[cp_model.IntVar] = []
    for c in range(C):
        for d in range(D):
            day_total = sum(work[c, d, s] for s in range(S))
            max_excess = S - threshold_slots
            excess = model.new_int_var(0, max_excess, f"ap1_{c}_{d}")
            model.add(excess >= day_total - threshold_slots)
            excess_vars.append(excess)
    return excess_vars


# ===================================================================
# CAMADA 2.5 — SOFT: SURPLUS PENALTY (redistributor)
# ===================================================================

def add_surplus_soft(
    model: cp_model.CpModel,
    work: SlotGrid,
    demand_by_slot: DaySlotDemand,
    C: int, D: int, S: int,
) -> Dict[Tuple[int, int], cp_model.IntVar]:
    """Surplus: penalize over-coverage above demand target.

    Returns surplus vars: surplus[d,s] = max(0, coverage - target).

    WHY: Without this, the solver stacks people on already-covered afternoon
    slots (surplus=3) while leaving morning slots with demand=4 at coverage=2
    (deficit=2). The deficit objective alone can't distinguish WHERE capacity
    goes — all it sees is total deficit. The surplus penalty makes over-staffing
    EXPENSIVE, forcing the solver to redistribute to under-served slots.

    Weight MUST be LESS than demand_deficit so the solver never sacrifices
    coverage to avoid surplus. Recommended: 3000 (vs deficit 10000).

    Math: moving 1 person from surplus to deficit saves (deficit_w + surplus_w)
    = 13000. The solver strongly prefers redistribution.
    """
    surplus: Dict[Tuple[int, int], cp_model.IntVar] = {}
    for d in range(D):
        for s in range(S):
            target = demand_by_slot.get((d, s), 0)
            if target <= 0:
                continue
            cov = sum(work[c, d, s] for c in range(C))
            max_surplus = C - target
            if max_surplus <= 0:
                continue
            sv = model.new_int_var(0, max_surplus, f"sur_{d}_{s}")
            model.add(sv >= cov - target)
            surplus[d, s] = sv
    return surplus
