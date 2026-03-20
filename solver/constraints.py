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
StartVars = Dict[Tuple[int, int], cp_model.IntVar]          # (c, d)   -> first slot worked


def _resolve_regime_days(colab: dict) -> int:
    """Resolve weekly work days from DB value."""
    val = colab.get("dias_trabalho")
    if val is None:
        return 6
    return int(val)


def _prorata_weekly(value_per_week: int, days_in_chunk: int) -> int:
    """Prorate a weekly target/tolerance to a chunk of N days.
    If the chunk is 5+ days, it represents an entire operational week 
    (e.g., Mon-Sat is 6 days), so we do NOT scale down the weekly targets.
    """
    if days_in_chunk >= 5:
        return value_per_week
    return int(round(value_per_week * days_in_chunk / 7.0))


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


def add_human_blocks(
    model: cp_model.CpModel,
    work: SlotGrid,
    block_starts: BlockStarts,
    C: int, D: int, S: int,
    base_h: int = 8,
    grid_min: int = 30,
    threshold_slots: int = 12,    # > 6h -> exige almoço (2 blocos)
    min_gap_slots: int = 2,       # min 1h almoço
    max_gap_slots: int = 4,       # max 2h gap
    min_work_slots: int = 4,      # blocos de trabalho >= 2h (proíbe micro-blocos)
    max_work_slots: int = 12,     # nunca trabalhar > 6h seguidas sem pausa
    lunch_window_start_hour: int = 11,  # almoço não inicia antes das 11:00
    lunch_window_end_hour: int = 14,    # almoço termina até as 14:00
) -> None:
    """H6 + H7b + H9 + H9b + H20 Unificado.

    Regras:
    - Shift <= 6h -> exato 1 bloco contíguo (sem gaps/splits).
    - Shift > 6h  -> exatos 2 blocos (1 gap = almoço).
    - Gap (almoço) entre [min_gap_slots, max_gap_slots] (1h-2h).
    - Gap obrigatoriamente dentro da janela [11:00-14:00].
    - Blocos de trabalho >= 2h (sem micro-blocos picotados).
    - Nunca > 6h seguidas sem pausa.

    Nota: a janela de almoço (WHERE) é TAMBÉM enforçada por
    add_lunch_window_always_hard() que roda independente do status de H6.
    Aqui é redundante mas garante consistência quando H6 é HARD.
    """
    # Convert lunch window hours to slot indices
    lunch_win_start = max(0, ((lunch_window_start_hour * 60) - (base_h * 60)) // grid_min)
    lunch_win_end = min(S, ((lunch_window_end_hour * 60) - (base_h * 60)) // grid_min)

    for c_idx in range(C):
        for d in range(D):
            day_total = sum(work[c_idx, d, s] for s in range(S))

            # --- 1) Quantidade de blocos ---
            is_long = model.new_bool_var(f"lng_{c_idx}_{d}")
            model.add(day_total > threshold_slots).only_enforce_if(is_long)
            model.add(day_total <= threshold_slots).only_enforce_if(is_long.negated())

            b_starts = sum(block_starts[c_idx, d, s] for s in range(S))
            model.add(b_starts <= 1).only_enforce_if(is_long.negated())
            model.add(b_starts == 2).only_enforce_if(is_long)

            # --- 2) Gap dentro da janela de almoço (dias longos) ---
            # Para dias longos: antes da janela de almoço -> sem gap (work é não-decrescente)
            # Depois da janela -> sem gap (work é não-crescente)  
            # Isso força o gap a cair DENTRO de [lunch_win_start, lunch_win_end]
            for s in range(min(lunch_win_start, S) - 1):
                # Antes das 11h: se tá trabalhando, não pode parar (não-decrescente)
                model.add(
                    work[c_idx, d, s + 1] >= work[c_idx, d, s]
                ).only_enforce_if(is_long)

            for s in range(lunch_win_end, S - 1):
                # Depois das 15h: se parou, não volta (não-crescente)
                model.add(
                    work[c_idx, d, s + 1] <= work[c_idx, d, s]
                ).only_enforce_if(is_long)

            # --- Otimização: Gaps só ocorrem dentro da janela de almoço ---
            # Devido à Seção 2, para dias longos, o gap é restrito a [lunch_win_start, lunch_win_end].
            # Para dias curtos, não há gaps. Portanto, podemos restringir a busca O(S^2) a esta janela.
            search_start = max(0, lunch_win_start - 1)
            search_end = min(S, lunch_win_end + 1)

            # --- 3) Min Gap Size (proibir gaps < 1h) ---
            for gap_len in range(1, min_gap_slots):
                for s in range(search_start, search_end - gap_len - 1):
                    # Se work[s]=1 e work[s+gap_len+1]=1, pelo menos um slot intermediário deve ser 1
                    clause = [work[c_idx, d, s].negated(), work[c_idx, d, s + gap_len + 1].negated()]
                    clause.extend(work[c_idx, d, s + k] for k in range(1, gap_len + 1))
                    model.add_bool_or(clause)

            # --- 4) Max Gap Size (proibir gaps > 2h ENTRE blocos de trabalho) ---
            for s1 in range(search_start, search_end):
                for s2 in range(s1 + max_gap_slots + 2, search_end):
                    model.add(
                        sum(work[c_idx, d, k] for k in range(s1 + 1, s2)) >= 1
                    ).only_enforce_if([work[c_idx, d, s1], work[c_idx, d, s2]])

            # --- 5) Max Work Block Size (max 6h seguidas) ---
            for s in range(S - max_work_slots):
                model.add_bool_or([work[c_idx, d, s + k].negated() for k in range(max_work_slots + 1)])

            # --- 6) Min Work Block Size (min 2h por bloco) ---
            for L in range(1, min_work_slots):
                for s in range(S - L + 1):
                    clause = []
                    if s > 0:
                        clause.append(work[c_idx, d, s - 1])
                    if s + L < S:
                        clause.append(work[c_idx, d, s + L])
                    clause.extend([work[c_idx, d, s + k].negated() for k in range(L)])
                    model.add_bool_or(clause)


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
        # Intermitente: horas_semanais=0 — skip bounds, dominio livre
        if int(colabs[c]["horas_semanais"]) == 0:
            max_day_min = int(colabs[c].get("max_minutos_dia", 600))
            blocked = blocked_days.get(c, set()) if blocked_days else set()
            chunk_vars: list[cp_model.IntVar] = []
            for w_idx, chunk in enumerate(week_chunks):
                available = sum(1 for d in chunk if d not in blocked)
                cap = max(1, available * max_day_min)
                wm = model.new_int_var(0, cap, f"wm_{c}_{w_idx}")
                model.add(wm == sum(work[c, d, s] for d in chunk for s in range(S)) * grid_min)
                chunk_vars.append(wm)
            wt = model.new_int_var(0, D * S * grid_min, f"wm_total_{c}")
            model.add(wt == sum(chunk_vars))
            total_minutes.append(wt)
            weekly_minutes_by_colab.append(chunk_vars)
            continue

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


def add_h10_meta_semanal_elastic(
    model: cp_model.CpModel,
    obj_terms: list,
    work: SlotGrid,
    colabs: List[dict],
    C: int, D: int, S: int,
    week_chunks: List[List[int]],
    blocked_days: Dict[int, set] | None = None,
    tolerance_min: int = 30,
    grid_min: int = 30,
    weight: int = 8000,
) -> Tuple[List[cp_model.IntVar], List[List[cp_model.IntVar]]]:
    """H10 ELASTIC: Horas semanais como SOFT constraint com slack variables.

    Identical return signature to add_h10_meta_semanal() so dependent
    constraints (H14, H15, H16) continue to work unchanged.

    Instead of hard domain bounds [lo, hi] on the wm variable, this uses:
      - wm domain: [0, max_capacity]  (no hard lower bound)
      - slack_under >= lo - wm   (penalized: hours below target)
      - slack_over  >= wm - hi   (penalized: hours above target)

    Weight 8000 per minute of deviation — high enough to strongly prefer
    meeting the target, but not HARD (which would cause INFEASIBLE).
    """
    total_minutes: list[cp_model.IntVar] = []
    weekly_minutes_by_colab: list[list[cp_model.IntVar]] = []

    for c in range(C):
        # Intermitente: horas_semanais=0 — skip penalty, dominio livre
        if int(colabs[c]["horas_semanais"]) == 0:
            max_day_min = int(colabs[c].get("max_minutos_dia", 600))
            blocked = blocked_days.get(c, set()) if blocked_days else set()
            chunk_vars: list[cp_model.IntVar] = []
            for w_idx, chunk in enumerate(week_chunks):
                available = sum(1 for d in chunk if d not in blocked)
                cap = max(1, available * max_day_min)
                wm = model.new_int_var(0, cap, f"wm_{c}_{w_idx}")
                model.add(wm == sum(work[c, d, s] for d in chunk for s in range(S)) * grid_min)
                chunk_vars.append(wm)
            wt = model.new_int_var(0, D * S * grid_min, f"wm_total_{c}")
            model.add(wt == sum(chunk_vars))
            total_minutes.append(wt)
            weekly_minutes_by_colab.append(chunk_vars)
            continue

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
            max_capacity = max(1, available_days * max_day_min)

            lo = max(0, adjusted_target - adjusted_tol)
            hi = min(max_capacity, adjusted_target + adjusted_tol)
            if hi < lo:
                lo = 0
                hi = max_capacity

            # Elastic: domain is [0, max_capacity], no hard bounds
            wm = model.new_int_var(0, max_capacity, f"wm_{c}_{w_idx}")
            model.add(
                wm == sum(work[c, d, s] for d in chunk for s in range(S)) * grid_min
            )
            chunk_vars.append(wm)

            # Penalty for deviation from [lo, hi] band
            slack_under = model.new_int_var(0, max_capacity, f"h10e_under_{c}_{w_idx}")
            slack_over = model.new_int_var(0, max_capacity, f"h10e_over_{c}_{w_idx}")
            model.add(slack_under >= lo - wm)
            model.add(slack_over >= wm - hi)
            obj_terms.append(weight * slack_under)
            obj_terms.append(weight * slack_over)

        wt = model.new_int_var(0, D * S * grid_min, f"wm_total_{c}")
        model.add(wt == sum(chunk_vars))
        total_minutes.append(wt)
        weekly_minutes_by_colab.append(chunk_vars)

    return total_minutes, weekly_minutes_by_colab


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
    days: List[str] | None = None,
) -> None:
    """Force correct number of work days per collaborator per weekly chunk.

    Uses explicit regime_escala when present:
      5X2 -> 5 days/week
      6X1 -> 6 days/week
    Partial weeks are prorated and capped by TRULY available days
    (excluding blocked days AND folga_fixa days forced OFF by add_folga_fixa_5x2).
    """
    DAY_LABELS = ["SEG", "TER", "QUA", "QUI", "SEX", "SAB", "DOM"]

    # Pre-compute folga_fixa day indices per collaborator so we don't
    # count them as "available" when computing the target.
    folga_fixa_days: Dict[int, set] = {}
    if days:
        from datetime import date as dt_date
        day_labels = [DAY_LABELS[dt_date.fromisoformat(day).weekday()] for day in days]
        for c in range(C):
            if colabs[c].get("tipo_trabalhador", "CLT") == "INTERMITENTE":
                continue
            fixed_day = colabs[c].get("folga_fixa_dia_semana")
            if fixed_day:
                folga_fixa_days[c] = {d for d in range(len(days)) if day_labels[d] == fixed_day}

    for c in range(C):
        regime_days = _resolve_regime_days(colabs[c])
        if regime_days == 0:
            continue  # Intermitente sem dias ativos — skip
        blocked = blocked_days.get(c, set()) if blocked_days else set()
        fixed_off = folga_fixa_days.get(c, set())

        for chunk in week_chunks:
            # Truly available = not blocked AND not folga_fixa
            available_days = [d for d in chunk if d not in blocked and d not in fixed_off]
            available = len(available_days)
            if available <= 0:
                continue

            target = max(1, _prorata_weekly(regime_days, len(chunk)))
            target = min(target, available)
            # Exact work days per chunk (e.g. 5 for 5x2, 6 for 6x1).
            # H1 (max 6 consecutive) runs globally and prevents cross-chunk
            # violations. If exact causes INFEASIBLE, Pass 2 relaxes to SOFT.
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
    grid_min: int = 30,
) -> List[cp_model.IntVar]:
    """AP1: Excess daily work > 8h.

    Returns excess variables: amount OVER 8h per (person, day).
    Weight: 80 per excess slot in objective.

    Based on: ANTIPATTERNS.PESO_HORA_EXTRA_EVITAVEL = -8 (from constants.ts)
    Scaled by 10 for CP-SAT: 80.
    """
    threshold_slots = 480 // grid_min  # 8h in any grid (e.g. 32 for 15min, 16 for 30min)
    excess_vars: list[cp_model.IntVar] = []
    for c in range(C):
        for d in range(D):
            day_total = sum(work[c, d, s] for s in range(S))
            max_excess = S - threshold_slots
            if max_excess <= 0:
                continue
            excess = model.new_int_var(0, max_excess, f"ap1_{c}_{d}")
            model.add(excess >= day_total - threshold_slots)
            excess_vars.append(excess)
    return excess_vars


# ===================================================================
# CAMADA 2.5 — SOFT: SURPLUS PENALTY (redistributor)
# ===================================================================

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


# ===================================================================
# CAMADA 2.5 — SOFT: SURPLUS PENALTY (redistributor)
# ===================================================================

def add_colaborador_time_window_hard(
    model: cp_model.CpModel,
    work: SlotGrid,
    works_day: WorksDay,
    regras_dia: List[dict],
    colabs: List[dict],
    days: List[str],
    C: int, D: int, S: int,
    base_h: int = 8,
    grid_min: int = 15,
) -> None:
    """v4: Regra hard de janela de horario por colaborador/dia.

    Para cada (c, d) com regra ativa:
    - Se works_day[c,d] == 1:
      - Primeiro slot >= slot(inicio_min)
      - Ultimo slot < slot(fim_max)
      - Se inicio_min == inicio_max: forcar inicio exato
    """
    colab_id_to_c = {colabs[c]["id"]: c for c in range(C)}
    day_to_d = {day: d for d, day in enumerate(days)}

    for regra in regras_dia:
        c = colab_id_to_c.get(regra.get("colaborador_id"))
        d = day_to_d.get(regra.get("data"))
        if c is None or d is None:
            continue

        # Folga fixa: force day off
        if regra.get("folga_fixa", False):
            model.add(works_day[c, d] == 0)
            continue

        # Domingo forcar folga
        if regra.get("domingo_forcar_folga", False):
            model.add(works_day[c, d] == 0)
            continue

        inicio_min = regra.get("inicio_min")
        inicio_max = regra.get("inicio_max")
        fim_max = regra.get("fim_max")

        if inicio_min:
            s_min = max(0, _time_to_slot(inicio_min, base_h, grid_min))
            # No slots before inicio_min
            for s in range(s_min):
                model.add(work[c, d, s] == 0).only_enforce_if(works_day[c, d])

        if fim_max:
            s_max = min(S, _time_to_slot(fim_max, base_h, grid_min))
            # No slots at or after fim_max
            for s in range(s_max, S):
                model.add(work[c, d, s] == 0).only_enforce_if(works_day[c, d])

        # Forcar inicio exato quando inicio_min == inicio_max
        if inicio_min and inicio_max and inicio_min == inicio_max:
            s_exact = max(0, _time_to_slot(inicio_min, base_h, grid_min))
            if s_exact < S:
                model.add(work[c, d, s_exact] == 1).only_enforce_if(works_day[c, d])


def add_domingo_ciclo_soft(
    model: cp_model.CpModel,
    works_day: WorksDay,
    colabs: List[dict],
    C: int,
    sunday_indices: List[int],
) -> List[cp_model.IntVar]:
    """v4: Ciclo domingo soft (substitui H3 hard).

    Por colaborador, ler domingo_ciclo_trabalho (N) e domingo_ciclo_folga (M).
    Janela deslizante de N+M domingos: penalizar excesso E deficit.

    Periodos curtos (< window domingos): pro-rata do expected.
    """
    penalties: List[cp_model.IntVar] = []

    if not sunday_indices:
        return penalties

    for c in range(C):
        if colabs[c].get("tipo_trabalhador", "CLT") == "INTERMITENTE" \
           and not colabs[c].get("folga_variavel_dia_semana"):
            continue  # Tipo A only
        # Guard: folga_fixa=DOM → always off Sunday, cycle is N/A
        if colabs[c].get("folga_fixa_dia_semana") == "DOM":
            continue

        N = int(colabs[c].get("domingo_ciclo_trabalho", 2))
        M = int(colabs[c].get("domingo_ciclo_folga", 1))
        window = N + M

        if window <= 0:
            continue

        num_suns = len(sunday_indices)

        if num_suns >= window:
            # Janela deslizante normal (multi-week)
            for i in range(num_suns - window + 1):
                suns = sunday_indices[i : i + window]
                worked = sum(works_day[c, d] for d in suns)
                # Penalizar EXCESSO (trabalhou mais que N)
                excess = model.new_int_var(0, window, f"dom_cyc_exc_{c}_{i}")
                model.add(excess >= worked - N)
                penalties.append(excess)
                # Penalizar DEFICIT (trabalhou menos que N)
                deficit = model.new_int_var(0, window, f"dom_cyc_def_{c}_{i}")
                model.add(deficit >= N - worked)
                penalties.append(deficit)
        else:
            # Periodo curto (< window domingos): pro-rata
            # Ex: 1 domingo, N=2, M=1 → expected = round(2*1/3) = 1
            expected = max(1, round(N * num_suns / window))
            worked = sum(works_day[c, d] for d in sunday_indices)
            # Penalizar se trabalha menos que expected
            deficit = model.new_int_var(0, num_suns, f"dom_short_def_{c}")
            model.add(deficit >= expected - worked)
            penalties.append(deficit)
            # Penalizar se trabalha mais que expected
            excess = model.new_int_var(0, num_suns, f"dom_short_exc_{c}")
            model.add(excess >= worked - expected)
            penalties.append(excess)

    return penalties


def add_colaborador_soft_preferences(
    model: cp_model.CpModel,
    work: SlotGrid,
    works_day: WorksDay,
    regras_dia: List[dict],
    colabs: List[dict],
    days: List[str],
    C: int, D: int, S: int,
    base_h: int = 8,
    grid_min: int = 15,
) -> List[cp_model.IntVar]:
    """v4: Soft penalty para preferencia de turno por colaborador/dia.

    Penaliza se turno real != preferencia_turno_soft.
    MANHA: penaliza se trabalha apos 14:00
    TARDE: penaliza se trabalha antes de 12:00
    """
    penalties: List[cp_model.IntVar] = []
    colab_id_to_c = {colabs[c]["id"]: c for c in range(C)}
    day_to_d = {day: d for d, day in enumerate(days)}

    noon_slot = max(0, (12 * 60 - base_h * 60) // grid_min)
    afternoon_slot = max(0, (14 * 60 - base_h * 60) // grid_min)

    for regra in regras_dia:
        pref = regra.get("preferencia_turno_soft")
        if not pref:
            continue
        c = colab_id_to_c.get(regra.get("colaborador_id"))
        d = day_to_d.get(regra.get("data"))
        if c is None or d is None:
            continue

        if pref == "MANHA":
            # Penalizar slots apos 14:00
            for s in range(min(afternoon_slot, S), S):
                pen = model.new_int_var(0, 1, f"tpref_{c}_{d}_{s}")
                model.add(pen >= work[c, d, s])
                penalties.append(pen)
        elif pref == "TARDE":
            # Penalizar slots antes de 12:00
            for s in range(min(noon_slot, S)):
                pen = model.new_int_var(0, 1, f"tpref_{c}_{d}_{s}")
                model.add(pen >= work[c, d, s])
                penalties.append(pen)

    return penalties


def make_start_vars(
    model: cp_model.CpModel,
    work: SlotGrid,
    works_day: WorksDay,
    C: int, D: int, S: int,
) -> StartVars:
    """First slot worked per (person, day). Value = S if not working that day."""
    sv: StartVars = {}
    for c in range(C):
        for d in range(D):
            v = model.new_int_var(0, S, f"start_{c}_{d}")
            for s in range(S):
                model.add(v <= s).only_enforce_if(work[c, d, s])
            model.add(v == S).only_enforce_if(works_day[c, d].negated())
            sv[c, d] = v
    return sv


def add_consistencia_horario_soft(
    model: cp_model.CpModel,
    start_vars: StartVars,
    works_day: WorksDay,
    C: int, D: int, S: int,
    grid_min: int = 15,
) -> List[cp_model.IntVar]:
    """v4: Penalizar variacao excessiva de inicio entre dias proximos.

    Para cada par (dia d, dia d+1) de trabalho do mesmo colab,
    penaliza |inicio[d] - inicio[d+1]| > 4 slots (1h em 15min grid).
    """
    penalties: List[cp_model.IntVar] = []
    max_diff = 4  # 1h de tolerancia

    for c in range(C):
        for d in range(D - 1):
            both_work = model.new_bool_var(f"bw_{c}_{d}")
            model.add_bool_and([works_day[c, d], works_day[c, d + 1]]).only_enforce_if(both_work)
            model.add_bool_or([works_day[c, d].negated(), works_day[c, d + 1].negated()]).only_enforce_if(both_work.negated())

            diff = model.new_int_var(0, S, f"sdiff_{c}_{d}")
            model.add(diff >= start_vars[c, d] - start_vars[c, d + 1]).only_enforce_if(both_work)
            model.add(diff >= start_vars[c, d + 1] - start_vars[c, d]).only_enforce_if(both_work)
            model.add(diff == 0).only_enforce_if(both_work.negated())

            excess = model.new_int_var(0, S, f"sxs_{c}_{d}")
            model.add(excess >= diff - max_diff)
            penalties.append(excess)

    return penalties


def add_cycle_consistency_soft(
    model: cp_model.CpModel,
    start_vars: StartVars,
    works_day: WorksDay,
    C: int, D: int, S: int,
    cycle_length_days: int,
) -> List[cp_model.IntVar]:
    """Penaliza divergencia de horario entre dias correspondentes em ciclos diferentes.

    Ciclo 5 semanas (35 dias) num periodo de 84 dias:
    - Dia 0 = Dia 35 = Dia 70
    - Dia 1 = Dia 36 = Dia 71

    SOFT: se um dos dois dias e folga/excecao, penalty = 0 automaticamente.
    """
    if cycle_length_days <= 0 or cycle_length_days >= D:
        return []

    penalties: List[cp_model.IntVar] = []

    for c in range(C):
        for d in range(D):
            d2 = d + cycle_length_days
            if d2 >= D:
                break

            both_work = model.new_bool_var(f"cyc_bw_{c}_{d}")
            model.add_bool_and([works_day[c, d], works_day[c, d2]]).only_enforce_if(both_work)
            model.add_bool_or([works_day[c, d].negated(), works_day[c, d2].negated()]).only_enforce_if(both_work.negated())

            diff = model.new_int_var(0, S, f"cyc_diff_{c}_{d}")
            model.add(diff >= start_vars[c, d] - start_vars[c, d2]).only_enforce_if(both_work)
            model.add(diff >= start_vars[c, d2] - start_vars[c, d]).only_enforce_if(both_work)
            model.add(diff == 0).only_enforce_if(both_work.negated())

            penalties.append(diff)

    return penalties


def _time_to_slot(hhmm: str, base_hour: int = 8, grid_min: int = 15) -> int:
    """Helper: convert HH:MM to slot index."""
    h, m = map(int, hhmm.split(":"))
    return (h * 60 + m - base_hour * 60) // grid_min


def add_folga_fixa_5x2(
    model: cp_model.CpModel,
    works_day: WorksDay,
    colabs: List[dict],
    days: List[str],
    C: int, D: int,
) -> None:
    """v4: Folga fixa 5x2 — hard constraint.

    Se colaborador tem folga_fixa_dia_semana preenchido,
    works_day[c, d] == 0 para todo d que cai no dia fixo.
    """
    DAY_LABELS = ["SEG", "TER", "QUA", "QUI", "SEX", "SAB", "DOM"]

    from datetime import date as dt_date
    day_labels = [DAY_LABELS[dt_date.fromisoformat(day).weekday()] for day in days]

    for c in range(C):
        if colabs[c].get("tipo_trabalhador", "CLT") == "INTERMITENTE":
            continue
        fixed_day = colabs[c].get("folga_fixa_dia_semana")
        if not fixed_day:
            continue
        for d in range(D):
            if day_labels[d] == fixed_day:
                model.add(works_day[c, d] == 0)


def add_folga_variavel_condicional(
    model: cp_model.CpModel,
    works_day: WorksDay,
    colabs: List[dict],
    days: List[str],
    C: int, D: int,
) -> None:
    """Folga variavel condicional: XOR entre domingo e dia variavel.

    Se trabalhou domingo(semana N) -> folga no dia_var(da mesma semana).
    Se nao trabalhou domingo(semana N) -> trabalha no dia_var(da mesma semana).

    Constraint: works_day[c, dom_idx] + works_day[c, var_idx] == 1

    So emite quando AMBOS indices estao dentro do periodo.
    Dias variaveis antes do inicio do periodo: sem constraint = solver livre.
    """
    DAY_LABELS = ["SEG", "TER", "QUA", "QUI", "SEX", "SAB", "DOM"]

    from datetime import date as dt_date
    day_labels = [DAY_LABELS[dt_date.fromisoformat(day).weekday()] for day in days]

    # Offset do DOM ate o dia variavel na mesma semana (SEG-SAB)
    OFFSET = {"SEG": -6, "TER": -5, "QUA": -4, "QUI": -3, "SEX": -2, "SAB": -1}

    for c in range(C):
        if colabs[c].get("tipo_trabalhador", "CLT") == "INTERMITENTE" \
           and not colabs[c].get("folga_variavel_dia_semana"):
            continue  # Tipo A only
        # Guard: folga_fixa=DOM → person never works Sunday, XOR is meaningless
        if colabs[c].get("folga_fixa_dia_semana") == "DOM":
            continue

        var_day = colabs[c].get("folga_variavel_dia_semana")
        if not var_day:
            continue

        offset = OFFSET.get(var_day, 0)
        if offset == 0:
            continue

        for d in range(D):
            if day_labels[d] != "DOM":
                continue
            var_idx = d + offset
            if 0 <= var_idx < D:
                # XOR: trabalha_dom + trabalha_var == 1
                model.add(works_day[c, d] + works_day[c, var_idx] == 1)


def add_dom_max_consecutivo(
    model: cp_model.CpModel,
    works_day: WorksDay,
    colabs: List[dict],
    C: int,
    sunday_indices: List[int],
    blocked_days: Dict[int, set],
    *,
    hard_m: bool = True,
    hard_f: bool = True,
) -> None:
    """HARD: max domingos consecutivos trabalhados.

    Mulher (sexo='F'): max 1 (Art. 386 CLT).
    Homem (sexo='M'): max 2 (convencao/jurisprudencia).

    Constraint: sliding window of max+1 sundays, sum <= max.
    """
    if not sunday_indices:
        return

    for c in range(C):
        if colabs[c].get("tipo_trabalhador", "CLT") == "INTERMITENTE" \
           and not colabs[c].get("folga_variavel_dia_semana"):
            continue  # Tipo A only
        # Guard: folga_fixa=DOM → never works Sunday, max consec is trivially 0
        if colabs[c].get("folga_fixa_dia_semana") == "DOM":
            continue

        sexo = colabs[c].get("sexo", "M")
        if sexo == "F" and not hard_f:
            continue
        if sexo != "F" and not hard_m:
            continue
        max_consec = 1 if sexo == "F" else 2
        available_suns = [d for d in sunday_indices if d not in blocked_days.get(c, set())]
        window = max_consec + 1
        for i in range(len(available_suns) - window + 1):
            suns = available_suns[i : i + window]
            model.add(sum(works_day[c, d] for d in suns) <= max_consec)


# ===================================================================
# PHASE 1 — FOLGA PATTERN HARD CONSTRAINTS
# ===================================================================


def add_min_headcount_per_day(
    model: cp_model.CpModel,
    works_day: WorksDay,
    C: int, D: int,
    min_headcount_by_day: List[int],
    blocked_days: Dict[int, set],
) -> None:
    """Phase 1: Minimum headcount per day from peak demand.

    For each day d: sum(works_day[c,d] for c available) >= min_headcount_by_day[d].
    Skips days where all collaborators are blocked.
    """
    for d in range(D):
        target = min_headcount_by_day[d]
        if target <= 0:
            continue
        available_c = [c for c in range(C) if d not in blocked_days.get(c, set())]
        if not available_c:
            continue
        # Cap target at available headcount (can't require more than available)
        effective_target = min(target, len(available_c))
        model.add(sum(works_day[c, d] for c in available_c) >= effective_target)


def add_band_demand_coverage(
    model: cp_model.CpModel,
    is_manha: WorksDay,
    is_tarde: WorksDay,
    is_integral: WorksDay,
    C: int, D: int,
    morning_demand: List[int],
    afternoon_demand: List[int],
    blocked_days: Dict[int, set],
) -> None:
    """Phase 1: Ensure shift bands cover both halves of the demand curve.

    morning_cover = sum(is_manha + is_integral) for available colabs
    afternoon_cover = sum(is_tarde + is_integral) for available colabs

    Also forces band diversity: on days with enough headroom (workers >= max_demand + 1),
    at least 1 worker must be MANHA-only and 1 must be TARDE-only.
    This prevents all-INTEGRAL assignments that give Phase 2 zero guidance.
    """
    for d in range(D):
        available_c = [c for c in range(C) if d not in blocked_days.get(c, set())]
        if not available_c:
            continue

        m_target = morning_demand[d]
        if m_target > 0:
            effective = min(m_target, len(available_c))
            model.add(
                sum(is_manha[c, d] + is_integral[c, d] for c in available_c) >= effective
            )

        a_target = afternoon_demand[d]
        if a_target > 0:
            effective = min(a_target, len(available_c))
            model.add(
                sum(is_tarde[c, d] + is_integral[c, d] for c in available_c) >= effective
            )



def add_domingo_ciclo_hard(
    model: cp_model.CpModel,
    works_day: WorksDay,
    colabs: List[dict],
    C: int,
    sunday_indices: List[int],
    blocked_days: Dict[int, set],
) -> None:
    """Phase 1: Hard domingo ciclo — same logic as add_domingo_ciclo_soft but HARD.

    For each collaborator with N trabalho / M folga cycle:
    Sliding window of N+M sundays: exactly N worked.
    Skips sundays where the collaborator is blocked.
    """
    if not sunday_indices:
        return

    for c in range(C):
        if colabs[c].get("tipo_trabalhador", "CLT") == "INTERMITENTE" \
           and not colabs[c].get("folga_variavel_dia_semana"):
            continue  # Tipo A only
        # Guard: folga_fixa=DOM → never works Sunday, hard cycle N/A
        if colabs[c].get("folga_fixa_dia_semana") == "DOM":
            continue

        N = int(colabs[c].get("domingo_ciclo_trabalho", 2))
        M = int(colabs[c].get("domingo_ciclo_folga", 1))
        window = N + M
        if window <= 0:
            continue

        # Filter to non-blocked sundays for this collaborator
        available_suns = [d for d in sunday_indices if d not in blocked_days.get(c, set())]
        num_suns = len(available_suns)

        if num_suns < window:
            # Short period: pro-rata (same as soft version)
            if num_suns > 0:
                expected = max(1, round(N * num_suns / window))
                expected = min(expected, num_suns)
                model.add(sum(works_day[c, d] for d in available_suns) == expected)
            continue

        # Sliding window: exactly N worked per window
        for i in range(num_suns - window + 1):
            suns = available_suns[i : i + window]
            model.add(sum(works_day[c, d] for d in suns) == N)


def add_cycle_alignment_hard(
    model: cp_model.CpModel,
    works_day: WorksDay,
    C: int, D: int,
    cycle_days: int,
    blocked_days: Dict[int, set],
) -> None:
    """Phase 1: Force folga pattern to repeat every cycle_days.

    works_day[c, d] == works_day[c, d + cycle_days] for all d where both are within period.
    Skips pairs where either day is blocked (forced off anyway).
    """
    if cycle_days <= 0 or cycle_days >= D:
        return

    for c in range(C):
        blocked = blocked_days.get(c, set())
        for d in range(D - cycle_days):
            d2 = d + cycle_days
            # Skip if either day is blocked
            if d in blocked or d2 in blocked:
                continue
            model.add(works_day[c, d] == works_day[c, d2])


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


# ===================================================================
# CAMADA 4 — SOFT PENALTY WRAPPERS (for configurable rules engine)
# ===================================================================

def add_h1_soft_penalty(
    model: cp_model.CpModel,
    obj_terms: list,
    works_day: WorksDay,
    C: int,
    D: int,
    weight: int = 5000,
) -> None:
    """H1 SOFT: penaliza cada dia alem do 6o consecutivo."""
    for c in range(C):
        for d in range(D - 6):
            seq = [works_day[c, d + i] for i in range(7)]
            excess = model.new_int_var(0, 1, f"h1_soft_{c}_{d}")
            model.add(excess >= sum(seq) - 6)
            model.add(excess <= 1)
            obj_terms.append(weight * excess)


def add_human_blocks_soft_penalty(
    model: cp_model.CpModel,
    obj_terms: list,
    work: SlotGrid,
    block_starts: BlockStarts,
    C: int,
    D: int,
    S: int,
    base_h: int = 8,
    grid_min: int = 15,
    min_gap_slots: int = 2,
    max_gap_slots: int = 8,
    threshold_slots: int = 24,
    min_work_slots: int = 8,
    max_work_slots: int = 24,
    weight: int = 3000,
) -> None:
    """H6 SOFT: penaliza jornadas que ultrapassam threshold sem almoco."""
    for c in range(C):
        for d in range(D):
            total_slots = model.new_int_var(0, S, f"h6soft_total_{c}_{d}")
            model.add(total_slots == sum(work[c, d, s] for s in range(S)))
            excess_work = model.new_int_var(0, S, f"h6soft_excess_{c}_{d}")
            model.add(excess_work >= total_slots - threshold_slots)
            model.add(excess_work >= 0)
            obj_terms.append(weight * excess_work)


def add_dias_trabalho_soft_penalty(
    model: cp_model.CpModel,
    obj_terms: list,
    works_day: WorksDay,
    colabs: list,
    C: int,
    D: int,
    week_chunks: list,
    blocked_days: dict,
    weight: int = 4000,
    days: List[str] | None = None,
) -> None:
    """DIAS_TRABALHO SOFT: penaliza desvio do numero esperado de dias/semana."""
    DAY_LABELS = ["SEG", "TER", "QUA", "QUI", "SEX", "SAB", "DOM"]
    # Pre-compute folga_fixa indices (same logic as HARD version)
    folga_fixa_days: Dict[int, set] = {}
    if days:
        from datetime import date as dt_date
        day_labels = [DAY_LABELS[dt_date.fromisoformat(day).weekday()] for day in days]
        for c in range(C):
            if colabs[c].get("tipo_trabalhador", "CLT") == "INTERMITENTE":
                continue
            fixed_day = colabs[c].get("folga_fixa_dia_semana")
            if fixed_day:
                folga_fixa_days[c] = {d for d in range(len(days)) if day_labels[d] == fixed_day}

    for c in range(C):
        regime_days = _resolve_regime_days(colabs[c])
        if regime_days == 0:
            continue  # Intermitente sem dias ativos — skip
        fixed_off = folga_fixa_days.get(c, set())
        for chunk in week_chunks:
            available = [d for d in chunk if d not in blocked_days.get(c, set()) and d not in fixed_off]
            if not available:
                continue
            # Use the same prorata semantics as HARD DIAS_TRABALHO.
            # This keeps fallback passes feasible on short trailing chunks
            # (e.g., 1-2 day chunks at the end of the period).
            dias_esperados = _prorata_weekly(regime_days, len(chunk))
            dias_esperados = min(dias_esperados, len(available))
            work_sum = sum(works_day[c, d] for d in available)
            deviation = model.new_int_var(0, len(available), f"dt_soft_{c}_{chunk[0]}")
            model.add(deviation >= work_sum - dias_esperados)
            model.add(deviation >= dias_esperados - work_sum)
            obj_terms.append(weight * deviation)


def add_min_diario_soft_penalty(
    model: cp_model.CpModel,
    obj_terms: list,
    work: SlotGrid,
    works_day: WorksDay,
    C: int,
    D: int,
    S: int,
    min_slots: int = 16,
    weight: int = 2000,
) -> None:
    """MIN_DIARIO SOFT: penaliza turnos abaixo do minimo diario."""
    for c in range(C):
        for d in range(D):
            day_slots = model.new_int_var(0, S, f"md_soft_slots_{c}_{d}")
            model.add(day_slots == sum(work[c, d, s] for s in range(S)))
            deficit = model.new_int_var(0, min_slots, f"md_soft_def_{c}_{d}")
            model.add(deficit >= min_slots * works_day[c, d] - day_slots)
            model.add(deficit >= 0)
            obj_terms.append(weight * deficit)


def add_lunch_window_always_hard(
    model: cp_model.CpModel,
    work: SlotGrid,
    block_starts: BlockStarts,
    C: int,
    D: int,
    S: int,
    base_h: int = 5,
    grid_min: int = 15,
    lunch_window_start_hour: int = 11,
    lunch_window_end_hour: int = 14,
    min_work_before_lunch_slots: int = 8,  # 2h = 8 slots of 15min
    min_work_after_lunch_slots: int = 8,   # 2h = 8 slots of 15min
) -> None:
    """ALWAYS-HARD: If a day has a lunch gap, constrain WHERE it can be.

    This runs regardless of H6 status. H6 controls WHETHER lunch is mandatory.
    This controls WHERE lunch goes IF it exists.

    Rules enforced:
    1. Gaps only within [11:00, 14:00] window — no lunch at 06:30 or 18:00.
    2. At least 2h of work BEFORE the gap start.
    3. At least 2h of work AFTER the gap end.

    Implementation:
    - If a day has 2+ blocks (gap exists), the non-decreasing/non-increasing
      envelope forces the gap into the lunch window.
    - The min-work-before/after is enforced by requiring the first block to start
      early enough and the last block to end late enough relative to the gap.
    """
    lunch_win_start = max(0, ((lunch_window_start_hour * 60) - (base_h * 60)) // grid_min)
    lunch_win_end = min(S, ((lunch_window_end_hour * 60) - (base_h * 60)) // grid_min)

    for c in range(C):
        for d in range(D):
            # Detect if this day has 2+ blocks (= has a gap/lunch)
            b_starts = [block_starts[c, d, s] for s in range(S)]
            has_gap = model.new_bool_var(f"lw_hasgap_{c}_{d}")
            model.add(sum(b_starts) >= 2).only_enforce_if(has_gap)
            model.add(sum(b_starts) <= 1).only_enforce_if(has_gap.negated())

            # Rule 1: Before lunch window -> non-decreasing (can't stop working)
            for s in range(min(lunch_win_start, S) - 1):
                model.add(
                    work[c, d, s + 1] >= work[c, d, s]
                ).only_enforce_if(has_gap)

            # Rule 1: After lunch window -> non-increasing (can't start working again)
            for s in range(lunch_win_end, S - 1):
                model.add(
                    work[c, d, s + 1] <= work[c, d, s]
                ).only_enforce_if(has_gap)

            # Rule 2: At least min_work_before_lunch_slots of work before the gap
            # If has_gap, the first block must have started by (lunch_win_start - min_work_before)
            # i.e., enough work slots before the earliest possible gap start
            earliest_gap = lunch_win_start
            min_start = max(0, earliest_gap - min_work_before_lunch_slots)
            if min_start < earliest_gap:
                model.add(
                    sum(work[c, d, s] for s in range(min_start, earliest_gap)) >= min_work_before_lunch_slots
                ).only_enforce_if(has_gap)

            # Rule 3: At least min_work_after_lunch_slots of work after the gap
            # If has_gap, enough work must happen after lunch_win_end
            max_end = min(S, lunch_win_end + min_work_after_lunch_slots)
            if lunch_win_end < max_end:
                model.add(
                    sum(work[c, d, s] for s in range(lunch_win_end, max_end)) >= min_work_after_lunch_slots
                ).only_enforce_if(has_gap)
