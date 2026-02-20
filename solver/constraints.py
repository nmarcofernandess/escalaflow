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


def _resolve_regime_days(colab: dict) -> int:
    """Resolve weekly work days from explicit regime when present."""
    regime = colab.get("regime_escala")
    if regime == "5X2":
        return 5
    if regime == "6X1":
        return 6

    dias = int(colab.get("dias_trabalho", 6) or 6)
    return 5 if dias <= 5 else 6


def _prorata_weekly(value_per_week: int, days_in_chunk: int) -> int:
    """Prorate a weekly target/tolerance to a chunk of N days."""
    return int(round(value_per_week * days_in_chunk / 7))


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
    week_chunks: List[List[int]],
    blocked_days: Dict[int, set] | None = None,
    tolerance_min: int = 30,
    grid_min: int = 30,
) -> Tuple[List[cp_model.IntVar], List[List[cp_model.IntVar]]]:
    """H10: Horas semanais +- tolerancia. Art. 58 CLT.

    Enforced per 7-day chunk (or prorata on partial chunk), not on full period.
    Returns:
      - total minutes var per collaborator (for spread/equilibrio objective)
      - per-week minutes vars per collaborator (used by H14/H15/H16)
    """
    total_minutes: list[cp_model.IntVar] = []
    weekly_minutes_by_colab: list[list[cp_model.IntVar]] = []

    for c in range(C):
        blocked = blocked_days.get(c, set()) if blocked_days else set()
        regime_days = _resolve_regime_days(colabs[c])
        target_week_min = int(colabs[c]["horas_semanais"]) * 60
        max_day_min = int(colabs[c].get("max_minutos_dia", 600))

        chunk_vars: list[cp_model.IntVar] = []
        for w_idx, chunk in enumerate(week_chunks):
            chunk_days = len(chunk)
            available_days = sum(1 for d in chunk if d not in blocked)

            target = _prorata_weekly(target_week_min, chunk_days)
            tol = _prorata_weekly(tolerance_min, chunk_days)

            nominal_work_days = max(1, _prorata_weekly(regime_days, chunk_days))
            capacity_factor = 1.0
            if available_days < nominal_work_days:
                capacity_factor = available_days / nominal_work_days

            adjusted_target = int(round(target * capacity_factor))
            adjusted_tol = int(round(tol * capacity_factor))
            max_capacity = available_days * max_day_min

            lo = max(0, adjusted_target - adjusted_tol)
            hi = min(max_capacity, adjusted_target + adjusted_tol)
            if hi < lo:
                lo = hi

            wm = model.new_int_var(lo, hi, f"wm_{c}_{w_idx}")
            model.add(
                wm == sum(work[c, d, s] for d in chunk for s in range(S)) * grid_min
            )
            chunk_vars.append(wm)

        wt = model.new_int_var(0, D * S * grid_min, f"wm_total_{c}")
        model.add(wt == sum(chunk_vars))
        total_minutes.append(wt)
        weekly_minutes_by_colab.append(chunk_vars)

    return total_minutes, weekly_minutes_by_colab


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
    week_chunks: List[List[int]],
    blocked_days: Dict[int, set] | None = None,
) -> None:
    """Force correct number of work days per collaborator per weekly chunk.

    Uses explicit regime_escala when present:
      5X2 -> 5 days/week
      6X1 -> 6 days/week
    Partial weeks are prorated and capped by available days.
    """
    for c in range(C):
        blocked = blocked_days.get(c, set()) if blocked_days else set()
        regime_days = _resolve_regime_days(colabs[c])

        for chunk in week_chunks:
            available_days = [d for d in chunk if d not in blocked]
            available = len(available_days)
            if available <= 0:
                continue

            target = max(1, _prorata_weekly(regime_days, len(chunk)))
            target = min(target, available)
            model.add(sum(works_day[c, d] for d in chunk) == target)


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


def add_piso_operacional(
    model: cp_model.CpModel,
    work: SlotGrid,
    demand_by_slot: DaySlotDemand,
    C: int,
    D: int,
    S: int,
    piso_operacional: int,
) -> None:
    """Hard floor per active slot.

    Applies floor on slots that have planned demand in the period.
    """
    if piso_operacional <= 0:
        return

    for d in range(D):
        for s in range(S):
            if demand_by_slot.get((d, s), 0) <= 0:
                continue
            model.add(sum(work[c, d, s] for c in range(C)) >= piso_operacional)


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

def add_h3_rodizio_domingo(
    model: cp_model.CpModel,
    works_day: WorksDay,
    colabs: List[dict],
    C: int,
    sunday_indices: List[int],
) -> None:
    """H3/H3b: Rodizio domingo.

    Mulher: max 1 domingo consecutivo (CLT Art. 386).
    Homem: max 2 domingos consecutivos (Lei 10.101/2000).

    Only applies when period contains 2+ Sundays.
    For single-week (7-day) periods, trivially satisfied.
    """
    if len(sunday_indices) < 2:
        return

    for c in range(C):
        sexo = colabs[c].get("sexo", "M")
        max_consec = 1 if sexo == "F" else 2
        window = max_consec + 1

        if window > len(sunday_indices):
            continue

        for i in range(len(sunday_indices) - window + 1):
            suns = sunday_indices[i : i + window]
            model.add(sum(works_day[c, d] for d in suns) <= max_consec)


def add_h5_excecoes(
    model: cp_model.CpModel,
    work: SlotGrid,
    colabs: List[dict],
    days: List[str],
    C: int,
    S: int,
    excecoes: List[dict],
) -> None:
    """H5: Excecoes respeitadas (ferias, atestado = indisponivel). CLT."""
    colab_id_to_c = {colabs[c]["id"]: c for c in range(C)}

    for exc in excecoes:
        c = colab_id_to_c.get(exc.get("colaborador_id"))
        if c is None:
            continue
        exc_start = exc.get("data_inicio", "")
        exc_end = exc.get("data_fim", "")
        for d, day in enumerate(days):
            if exc_start <= day <= exc_end:
                for s in range(S):
                    model.add(work[c, d, s] == 0)


def add_h11_aprendiz_domingo(
    model: cp_model.CpModel,
    works_day: WorksDay,
    colabs: List[dict],
    C: int,
    sunday_indices: List[int],
) -> None:
    """H11: Aprendiz nunca domingo. Art. 432 CLT."""
    for c in range(C):
        if colabs[c].get("tipo_trabalhador") == "APRENDIZ":
            for d in sunday_indices:
                model.add(works_day[c, d] == 0)


def add_h12_aprendiz_feriado(
    model: cp_model.CpModel,
    works_day: WorksDay,
    colabs: List[dict],
    C: int,
    holiday_indices: List[int],
) -> None:
    """H12: Aprendiz nunca feriado. Art. 432 CLT."""
    for c in range(C):
        if colabs[c].get("tipo_trabalhador") == "APRENDIZ":
            for d in holiday_indices:
                model.add(works_day[c, d] == 0)


def add_h13_aprendiz_noturno(
    model: cp_model.CpModel,
    work: SlotGrid,
    colabs: List[dict],
    C: int,
    D: int,
    S: int,
    base_h: int,
    grid_min: int,
) -> None:
    """H13: Aprendiz nunca noturno (22h-5h). Art. 404 CLT.

    For typical 08:00-20:00 operating windows, this emits zero constraints.
    Included for safety if operating window ever extends beyond 20:00.
    """
    base_min = base_h * 60
    night_slots = []
    for s in range(S):
        slot_start = base_min + s * grid_min
        if slot_start >= 22 * 60:
            night_slots.append(s)

    if not night_slots:
        return

    for c in range(C):
        if colabs[c].get("tipo_trabalhador") == "APRENDIZ":
            for d in range(D):
                for s in night_slots:
                    model.add(work[c, d, s] == 0)


def add_h14_aprendiz_hora_extra(
    model: cp_model.CpModel,
    weekly_minutes_by_colab: List[List[cp_model.IntVar]],
    colabs: List[dict],
    C: int,
    week_chunks: List[List[int]],
) -> None:
    """H14: Aprendiz nunca hora extra. Art. 432 CLT.

    Each weekly chunk must not exceed prorated target (zero upper tolerance).
    """
    for c in range(C):
        if colabs[c].get("tipo_trabalhador") == "APRENDIZ":
            target_week_min = int(colabs[c]["horas_semanais"]) * 60
            for w_idx, wm in enumerate(weekly_minutes_by_colab[c]):
                prorated_target = _prorata_weekly(target_week_min, len(week_chunks[w_idx]))
                model.add(wm <= prorated_target)


def add_h15_estagiario_jornada(
    model: cp_model.CpModel,
    work: SlotGrid,
    weekly_minutes_by_colab: List[List[cp_model.IntVar]],
    colabs: List[dict],
    C: int,
    D: int,
    S: int,
    grid_min: int,
    week_chunks: List[List[int]],
) -> None:
    """H15: Estagiario max 6h/dia 30h/sem. Lei 11.788 Art. 10."""
    max_daily_slots = 360 // grid_min
    max_weekly_min = 30 * 60

    for c in range(C):
        if colabs[c].get("tipo_trabalhador") == "ESTAGIARIO":
            for d in range(D):
                model.add(sum(work[c, d, s] for s in range(S)) <= max_daily_slots)
            for w_idx, wm in enumerate(weekly_minutes_by_colab[c]):
                prorated_max = _prorata_weekly(max_weekly_min, len(week_chunks[w_idx]))
                model.add(wm <= prorated_max)


def add_h16_estagiario_hora_extra(
    model: cp_model.CpModel,
    weekly_minutes_by_colab: List[List[cp_model.IntVar]],
    colabs: List[dict],
    C: int,
    week_chunks: List[List[int]],
) -> None:
    """H16: Estagiario nunca hora extra. Lei 11.788.

    Each weekly chunk must not exceed prorated target (zero upper tolerance).
    """
    for c in range(C):
        if colabs[c].get("tipo_trabalhador") == "ESTAGIARIO":
            target_week_min = int(colabs[c]["horas_semanais"]) * 60
            for w_idx, wm in enumerate(weekly_minutes_by_colab[c]):
                prorated_target = _prorata_weekly(target_week_min, len(week_chunks[w_idx]))
                model.add(wm <= prorated_target)


def add_h17_h18_feriado_proibido(
    model: cp_model.CpModel,
    works_day: WorksDay,
    C: int,
    holiday_prohibited_indices: List[int],
) -> None:
    """H17/H18: Feriados proibidos — ninguem trabalha.

    H17: 25/12 e 01/01 proibidos (CCT FecomercioSP).
    H18: Feriado sem CCT proibido (Portaria MTE 3.665).
    Both handled by proibido_trabalhar flag from bridge.
    """
    for c in range(C):
        for d in holiday_prohibited_indices:
            model.add(works_day[c, d] == 0)


def add_h19_folga_comp_domingo(
    model: cp_model.CpModel,
    works_day: WorksDay,
    C: int,
    D: int,
    sunday_indices: List[int],
) -> None:
    """H19: Folga compensatoria domingo dentro de 7 dias. Lei 605/1949.

    If person works a Sunday, at least 1 day off in the next 7 calendar days
    (within period bounds). For single-week SEG-DOM periods, this is
    implicitly satisfied by H1+dias_trabalho.
    """
    for c in range(C):
        for sun_d in sunday_indices:
            folga_window = [d for d in range(sun_d + 1, min(sun_d + 8, D))]
            if not folga_window:
                continue
            model.add(
                sum(works_day[c, d] for d in folga_window) <= len(folga_window) - 1
            ).only_enforce_if(works_day[c, sun_d])


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
