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
    add_demand_soft,
    add_dias_trabalho,
    add_h1_max_dias_consecutivos,
    add_h2_interjornada,
    add_h3_rodizio_domingo,
    add_h4_max_jornada_diaria,
    add_h5_excecoes,
    add_h6_almoco_obrigatorio,
    add_h7b_max_gap,
    add_h9_max_blocos,
    add_h9b_bloco_unico_dia_curto,
    add_h10_meta_semanal,
    add_h11_aprendiz_domingo,
    add_h12_aprendiz_feriado,
    add_h13_aprendiz_noturno,
    add_h14_aprendiz_hora_extra,
    add_h15_estagiario_jornada,
    add_h16_estagiario_hora_extra,
    add_h17_h18_feriado_proibido,
    add_h19_folga_comp_domingo,
    add_h20_gap_na_janela,
    add_min_diario,
    add_piso_operacional,
    add_surplus_soft,
    make_block_starts,
    make_works_day,
)


WEIGHTS = {
    "demand_deficit": 10000,
    "override_deficit": 40000,
    "surplus": 5000,
    "ap1_excess": 250,
    "spread": 800,
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
    grid_min: int = 30,
) -> Tuple[DaySlotDemand, DaySlotOverride]:
    demand_by_day_slot: DaySlotDemand = {}
    override_by_day_slot: DaySlotOverride = {}

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
        data["demanda"], days=days, base_hour=base_h, grid_min=grid_min
    )
    piso_operacional = int(data.get("piso_operacional", 1))

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

    # ---------------------------------------------------------------
    # HARD constraints (CLT Legal)
    # ---------------------------------------------------------------
    add_h1_max_dias_consecutivos(model, works_day, C, D)
    add_h2_interjornada(model, work, C, D, S, grid_min=grid_min)
    add_h3_rodizio_domingo(model, works_day, colabs, C, sunday_indices)
    add_h4_max_jornada_diaria(model, work, colabs, C, D, S, grid_min)
    add_h5_excecoes(model, work, colabs, days, C, S, excecoes)
    add_h6_almoco_obrigatorio(
        model,
        work,
        C,
        D,
        S,
        min_lunch_slots=min_lunch_slots,
        lunch_window_start=lunch_win_start,
        lunch_window_end=lunch_win_end,
    )
    add_h7b_max_gap(model, work, C, D, S, max_gap_slots=max_gap_slots)
    add_h9_max_blocos(model, block_starts, C, D, S)
    add_h9b_bloco_unico_dia_curto(model, work, block_starts, C, D, S)
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
    add_h20_gap_na_janela(
        model,
        work,
        C,
        D,
        S,
        lunch_window_start=lunch_win_start,
        lunch_window_end=lunch_win_end,
    )

    # Product rules (with blocked_days awareness)
    add_dias_trabalho(model, works_day, colabs, C, D, week_chunks, blocked_days)
    add_min_diario(model, work, works_day, C, D, S, min_slots=min_daily_slots)
    add_piso_operacional(model, work, demand_by_slot, C, D, S, piso_operacional)

    deficit = add_demand_soft(model, work, demand_by_slot, C, D, S)
    surplus = add_surplus_soft(model, work, demand_by_slot, C, D, S)
    ap1_excess = add_ap1_jornada_excessiva(model, work, C, D, S)

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
    if ap1_excess:
        objective_terms.append(WEIGHTS["ap1_excess"] * sum(ap1_excess))
    objective_terms.append(WEIGHTS["spread"] * spread)

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

    return {
        "sucesso": True,
        "status": status_name,
        "solve_time_ms": round(solve_time_ms, 1),
        "alocacoes": alocacoes,
        "indicadores": indicadores,
        "decisoes": decisoes,
        "comparacao_demanda": comparacao_demanda,
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
    max_time = config.get("max_time_seconds", 120)
    num_workers = config.get("num_workers", 8)

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

    log(f"Solving (max {max_time}s, {num_workers} workers)...")
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
    )

    log(
        f"Done: {result.get('status', 'UNKNOWN')} in {solve_time_ms:.0f}ms | "
        f"cobertura={result.get('indicadores', {}).get('cobertura_percent', '?')}%"
    )

    return result


def main() -> None:
    """Entry point: read JSON from stdin, write JSON to stdout."""
    try:
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
