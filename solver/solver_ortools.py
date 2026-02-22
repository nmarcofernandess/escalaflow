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
from datetime import date, timedelta
from typing import Any, Dict, List, Tuple

from ortools.sat.python import cp_model

from constraints import (
    BlockStarts,
    DaySlotDemand,
    SlotGrid,
    WorksDay,
    add_ap1_jornada_excessiva,
    add_colaborador_soft_preferences,
    add_colaborador_time_window_hard,
    add_consistencia_horario_soft,
    add_demand_soft,
    add_dias_trabalho,
    add_dias_trabalho_soft_penalty,
    add_domingo_ciclo_soft,
    add_folga_fixa_5x2,
    add_h1_max_dias_consecutivos,
    add_h1_soft_penalty,
    add_h2_interjornada,
    add_h4_max_jornada_diaria,
    add_h5_excecoes,
    add_human_blocks,
    add_human_blocks_soft_penalty,
    add_h10_meta_semanal,
    add_h11_aprendiz_domingo,
    add_h12_aprendiz_feriado,
    add_h13_aprendiz_noturno,
    add_h14_aprendiz_hora_extra,
    add_h15_estagiario_jornada,
    add_h16_estagiario_hora_extra,
    add_h17_h18_feriado_proibido,
    add_h19_folga_comp_domingo,
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
    "domingo_ciclo": 3000,
    "time_window_pref": 2000,
    "compensacao": 1500,
    "consistencia": 1000,
    "spread": 800,
    "ap1_excess": 250,
}

DAY_LABELS = ["SEG", "TER", "QUA", "QUI", "SEX", "SAB", "DOM"]
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


def build_model(data: dict) -> Tuple[
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

    colabs = data["colaboradores"]
    empresa = data["empresa"]

    days = build_days(data["data_inicio"], data["data_fim"])
    C = len(colabs)
    D = len(days)
    week_chunks = build_week_chunks(days)

    base_h, _ = map(int, empresa["hora_abertura"].split(":"))
    end_h, end_m = map(int, empresa["hora_fechamento"].split(":"))

    grid_min = int(empresa.get("grid_minutos", 30))
    S = ((end_h * 60 + end_m) - base_h * 60) // grid_min

    tolerance = int(empresa.get("tolerancia_semanal_min", 30))
    min_lunch_min = int(empresa.get("min_intervalo_almoco_min", 60))
    max_lunch_min = int(empresa.get("max_intervalo_almoco_min", 120))
    min_lunch_slots = min_lunch_min // grid_min
    max_gap_slots = max_lunch_min // grid_min

    lunch_win_start = (11 * 60 - base_h * 60) // grid_min
    lunch_win_end = (15 * 60 - base_h * 60) // grid_min

    demand_by_slot, override_by_slot = parse_demand(
        data["demanda"],
        days=days,
        base_hour=base_h,
        grid_min=grid_min,
        demanda_excecao_data=data.get("demanda_excecao_data"),
    )
    min_daily_slots = 240 // grid_min

    work: SlotGrid = {}
    for c in range(C):
        for d in range(D):
            for s in range(S):
                work[c, d, s] = model.new_bool_var(f"w_{c}_{d}_{s}")

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
        log(f"Applied warm-start hints: {hints_applied}")

    # ---------------------------------------------------------------
    # Compute indices for Sundays, holidays, and blocked days per person
    # ---------------------------------------------------------------
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

    # blocked_days[c] = set of day indices where person c cannot work
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

    # H11: Apprentice never Sunday
    for c in range(C):
        if colabs[c].get("tipo_trabalhador") == "APRENDIZ":
            for d in sunday_indices:
                blocked_days[c].add(d)

    # H12: Apprentice never holiday (any holiday, not just prohibited)
    for c in range(C):
        if colabs[c].get("tipo_trabalhador") == "APRENDIZ":
            for d in holiday_all_indices:
                blocked_days[c].add(d)

    # trabalha_domingo = false
    for c in range(C):
        if not colabs[c].get("trabalha_domingo", True):
            for d in sunday_indices:
                blocked_days[c].add(d)

    # Apply all blocking constraints (force work slots to 0)
    for c in range(C):
        for d in blocked_days[c]:
            for s in range(S):
                model.add(work[c, d, s] == 0)

    # ---------------------------------------------------------------
    # Build helper variables
    # ---------------------------------------------------------------
    works_day = make_works_day(model, work, C, D, S)
    block_starts = make_block_starts(model, work, C, D, S)

    nivel_rigor = config.get("nivel_rigor", "ALTO")
    rules = config.get("rules", {})

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

    obj_terms_list: list = []  # penalties das versoes SOFT das HARD rules

    # ---------------------------------------------------------------
    # HARD constraints (CLT Legal)
    # ---------------------------------------------------------------
    regras_dia = data.get("regras_colaborador_dia", [])

    h1_status = rule_is('H1', 'HARD')
    if h1_status == 'HARD':
        add_h1_max_dias_consecutivos(model, works_day, C, D)
    elif h1_status == 'SOFT':
        add_h1_soft_penalty(model, obj_terms_list, works_day, C, D)

    add_h2_interjornada(model, work, C, D, S, grid_min=grid_min)
    # v4: H3 removido como hard — substitudo por domingo_ciclo_soft abaixo
    add_h4_max_jornada_diaria(model, work, colabs, C, D, S, grid_min)
    add_h5_excecoes(model, work, colabs, days, C, S, excecoes)

    h6_status = rule_is('H6', 'HARD')
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
    add_h11_aprendiz_domingo(model, works_day, colabs, C, sunday_indices)
    add_h12_aprendiz_feriado(model, works_day, colabs, C, holiday_all_indices)
    add_h13_aprendiz_noturno(model, work, colabs, C, D, S, base_h, grid_min)
    add_h14_aprendiz_hora_extra(model, weekly_minutes_by_colab, colabs, C, week_chunks)
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
    add_h19_folga_comp_domingo(model, works_day, C, D, sunday_indices)

    # v4: Regra hard de janela por colaborador
    add_colaborador_time_window_hard(
        model, work, works_day, regras_dia, colabs, days, C, D, S, base_h, grid_min
    )

    # v4: Folga fixa 5x2
    add_folga_fixa_5x2(model, works_day, colabs, days, C, D)

    # Product rules (with blocked_days awareness)
    dt_status = rule_is('DIAS_TRABALHO', 'HARD')
    if dt_status == 'HARD':
        add_dias_trabalho(model, works_day, colabs, C, D, week_chunks, blocked_days)
    elif dt_status == 'SOFT':
        add_dias_trabalho_soft_penalty(model, obj_terms_list, works_day, colabs, C, D, week_chunks, blocked_days)

    md_status = rule_is('MIN_DIARIO', 'HARD')
    if md_status == 'HARD':
        add_min_diario(model, work, works_day, C, D, S, min_slots=min_daily_slots)
    elif md_status == 'SOFT':
        add_min_diario_soft_penalty(model, obj_terms_list, work, works_day, C, D, S, min_slots=min_daily_slots)

    deficit = add_demand_soft(model, work, demand_by_slot, C, D, S) if rule_is('S_DEFICIT', 'ON') != 'OFF' else {}
    surplus = add_surplus_soft(model, work, demand_by_slot, C, D, S) if rule_is('S_SURPLUS', 'ON') != 'OFF' else {}
    ap1_excess = add_ap1_jornada_excessiva(model, work, C, D, S) if rule_is('S_AP1_EXCESS', 'ON') != 'OFF' else []

    # v4: Novos soft constraints
    domingo_ciclo_penalties = add_domingo_ciclo_soft(model, works_day, colabs, C, sunday_indices) if rule_is('S_DOMINGO_CICLO', 'ON') != 'OFF' else []
    turno_pref_penalties = add_colaborador_soft_preferences(
        model, work, works_day, regras_dia, colabs, days, C, D, S, base_h, grid_min
    ) if rule_is('S_TURNO_PREF', 'ON') != 'OFF' else []
    consistencia_penalties = add_consistencia_horario_soft(model, work, works_day, C, D, S, grid_min) if rule_is('S_CONSISTENCIA', 'ON') != 'OFF' else []

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

            # Intervalo 15min: jornada >4h e <=6h
            intervalo_15min = 240 < minutos <= 360

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

    indicadores = {
        "cobertura_percent": cobertura,
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

    # Diagnostico para o path feliz
    regras_ativas = [k for k, v in rules.items() if v in ("HARD", "SOFT", "ON")]
    regras_off = [k for k, v in rules.items() if v == "OFF"]
    diagnostico = {
        "status_cp_sat": status_name,
        "solve_time_ms": round(solve_time_ms, 1),
        "regras_ativas": regras_ativas,
        "regras_off": regras_off,
        "num_colaboradores": len(colabs),
        "num_dias": len(days),
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


def solve(data: dict) -> dict:
    """Main solve function. Takes parsed JSON input, returns result dict."""
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
    solve_mode = config.get("solve_mode", "rapido")  # "rapido" | "otimizado"
    num_workers = config.get("num_workers", 8)

    # Profiles:
    # rapido:    30s timeout, stop when gap < 5% (good-enough fast)
    # otimizado: 120s timeout, run until OPTIMAL or timeout (best possible)
    if solve_mode == "otimizado":
        max_time = config.get("max_time_seconds", 120)
        gap_limit = 0.0  # prove full optimality
    else:
        max_time = config.get("max_time_seconds", 30)
        gap_limit = 0.05  # stop at 5% of optimal

    log(
        f"Building model: {len(colabs)} colabs, "
        f"{data['data_inicio']} - {data['data_fim']}"
    )

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
    ) = build_model(data)

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = max_time
    solver.parameters.num_workers = num_workers
    solver.parameters.log_search_progress = True
    solver.parameters.log_to_stdout = False
    if gap_limit > 0:
        solver.parameters.relative_gap_limit = gap_limit

    log(f"Solving [{solve_mode}] (max {max_time}s, {num_workers} workers, gap {gap_limit*100:.0f}%)...")
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
    )

    log(
        f"Done: {result.get('status', 'UNKNOWN')} in {solve_time_ms:.0f}ms | "
        f"cobertura={result.get('indicadores', {}).get('cobertura_percent', '?')}%"
    )

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
            "trabalha_domingo": True,
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
