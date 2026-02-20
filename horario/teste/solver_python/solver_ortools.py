#!/usr/bin/env python3
"""
solver_ortools.py - OR-Tools CP-SAT solver (input do sistema, comparacao separada)
"""

from __future__ import annotations

import json
import os
import sqlite3
import sys
import time
from datetime import date, timedelta
from pathlib import Path
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
    add_h4_max_jornada_diaria,
    add_h6_almoco_obrigatorio,
    add_h7b_max_gap,
    add_h9_max_blocos,
    add_h9b_bloco_unico_dia_curto,
    add_h10_meta_semanal,
    add_h20_gap_na_janela,
    add_min_diario,
    add_surplus_soft,
    make_block_starts,
    make_works_day,
)


WEIGHTS = {
    "demand_deficit": 10000,
    "surplus": 5000,
    "ap1_excess": 80,
    "spread": 1,
}

DAY_LABELS = ["SEG", "TER", "QUA", "QUI", "SEX", "SAB", "DOM"]


def day_label(iso_date: str) -> str:
    d = date.fromisoformat(iso_date)
    return DAY_LABELS[d.weekday()]


def parse_fixture(path: str) -> dict:
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    data.pop("ground_truth", None)
    return data


def parse_from_db(db_path: str, setor_nome: str = "caixa") -> dict:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row

    emp = conn.execute("select * from empresa limit 1").fetchone()
    setor = conn.execute(
        "select * from setores where lower(nome)=lower(?) limit 1", (setor_nome,)
    ).fetchone()
    if not setor:
        setor = conn.execute("select * from setores where id=1 limit 1").fetchone()
    if not setor:
        raise RuntimeError("Setor Caixa nao encontrado no DB")

    setor_id = int(setor["id"])

    col_rows = conn.execute(
        """
        select c.id,c.nome,c.sexo,c.horas_semanais,c.rank,c.prefere_turno,c.evitar_dia_semana,
               c.tipo_trabalhador,c.funcao_id,tc.dias_trabalho,tc.max_minutos_dia,tc.trabalha_domingo
        from colaboradores c
        join tipos_contrato tc on tc.id=c.tipo_contrato_id
        where c.setor_id=? and c.ativo=1
        order by c.rank
        """,
        (setor_id,),
    ).fetchall()

    colabs = []
    for r in col_rows:
        colabs.append(
            {
                "id": int(r["id"]),
                "nome": r["nome"],
                "horas_semanais": int(r["horas_semanais"]),
                "dias_trabalho": int(r["dias_trabalho"]),
                "max_minutos_dia": int(r["max_minutos_dia"]),
                "trabalha_domingo": bool(r["trabalha_domingo"]),
                "tipo_trabalhador": r["tipo_trabalhador"] or "CLT",
                "sexo": r["sexo"],
                "funcao_id": r["funcao_id"],
                "rank": int(r["rank"]) if r["rank"] is not None else 0,
                "prefere_turno": r["prefere_turno"],
                "evitar_dia_semana": r["evitar_dia_semana"],
            }
        )

    dem_rows = conn.execute(
        """
        select dia_semana,hora_inicio,hora_fim,min_pessoas,override
        from demandas
        where setor_id=?
        order by case dia_semana
         when 'SEG' then 1 when 'TER' then 2 when 'QUA' then 3 when 'QUI' then 4
         when 'SEX' then 5 when 'SAB' then 6 when 'DOM' then 7 else 99 end,
         hora_inicio
        """,
        (setor_id,),
    ).fetchall()

    demanda = [
        {
            "dia_semana": r["dia_semana"],
            "hora_inicio": r["hora_inicio"],
            "hora_fim": r["hora_fim"],
            "min_pessoas": int(r["min_pessoas"]),
            "override": bool(r["override"]),
        }
        for r in dem_rows
    ]

    return {
        "metadata": {
            "setor": (setor["nome"] or "CAIXA").upper(),
            "periodo": {"inicio": "2026-02-09", "fim": "2026-02-14"},
            "grid_intervalo_min": 30,
            "hora_abertura": setor["hora_abertura"],
            "hora_fechamento": setor["hora_fechamento"],
            "fonte": db_path,
        },
        "empresa": {
            "tolerancia_semanal_min": int(emp["tolerancia_semanal_min"]) if emp and emp["tolerancia_semanal_min"] is not None else 30,
            "hora_abertura": setor["hora_abertura"],
            "hora_fechamento": setor["hora_fechamento"],
            "corte_semanal": emp["corte_semanal"] if emp and emp["corte_semanal"] else "SEG_DOM",
            "min_intervalo_almoco_min": 60,
            "max_intervalo_almoco_min": 120,
            "usa_cct_intervalo_reduzido": True,
            "grid_minutos": 30,
        },
        "colaboradores": colabs,
        "demanda": demanda,
        "feriados": [],
        "excecoes": [],
    }


def build_days(meta: dict) -> List[str]:
    start = date.fromisoformat(meta["periodo"]["inicio"])
    end = date.fromisoformat(meta["periodo"]["fim"])
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
) -> DaySlotDemand:
    """Expand demand segments to per-(day,slot) targets.

    Supports either per-day (`dia_semana`) or legacy (`dia_semana=None`) entries.
    """
    demand_by_day_slot: DaySlotDemand = {}

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
                # overlap-safe: keep the highest requirement
                demand_by_day_slot[key] = max(demand_by_day_slot.get(key, 0), target)

    return demand_by_day_slot


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

    demand_by_slot = parse_demand(
        data["demanda"], days=days, base_hour=base_h, grid_min=grid_min
    )

    min_daily_slots = 240 // grid_min

    work: SlotGrid = {}
    for c in range(C):
        for d in range(D):
            for s in range(S):
                work[c, d, s] = model.new_bool_var(f"w_{c}_{d}_{s}")

    works_day = make_works_day(model, work, C, D, S)
    block_starts = make_block_starts(model, work, C, D, S)

    add_h1_max_dias_consecutivos(model, works_day, C, D)
    add_h2_interjornada(model, work, C, D, S, grid_min=grid_min)
    add_h4_max_jornada_diaria(model, work, colabs, C, D, S, grid_min)
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
    weekly_minutes = add_h10_meta_semanal(model, work, colabs, C, D, S, tolerance, grid_min)
    add_h20_gap_na_janela(
        model,
        work,
        C,
        D,
        S,
        lunch_window_start=lunch_win_start,
        lunch_window_end=lunch_win_end,
    )

    add_dias_trabalho(model, works_day, colabs, C, D)
    add_min_diario(model, work, works_day, C, D, S, min_slots=min_daily_slots)

    deficit = add_demand_soft(model, work, demand_by_slot, C, D, S)
    surplus = add_surplus_soft(model, work, demand_by_slot, C, D, S)
    ap1_excess = add_ap1_jornada_excessiva(model, work, C, D, S)

    max_weekly = model.new_int_var(0, 9000, "max_weekly")
    min_weekly = model.new_int_var(0, 9000, "min_weekly")
    model.add_max_equality(max_weekly, weekly_minutes)
    model.add_min_equality(min_weekly, weekly_minutes)
    spread = model.new_int_var(0, 9000, "spread")
    model.add(spread == max_weekly - min_weekly)

    objective_terms = []
    if deficit:
        objective_terms.append(WEIGHTS["demand_deficit"] * sum(deficit.values()))
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

    result: Dict[str, Any] = {
        "solver": "ortools_cpsat",
        "versao": "2.3_day_aware",
        "status": status_name,
        "solve_time_ms": round(solve_time_ms, 1),
        "hierarquia": {
            "hard": ["H1", "H2", "H4", "H6", "H7b", "H8", "H9", "H9b", "H10", "H20"],
            "soft_demand_weight": WEIGHTS["demand_deficit"],
            "surplus_weight": WEIGHTS["surplus"],
            "ap_weights": {"AP1": WEIGHTS["ap1_excess"]},
            "spread_weight": WEIGHTS["spread"],
        },
        "alocacoes": {},
        "horas_semanais": {},
        "indicadores": {},
    }

    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return result

    for c in range(C):
        nome = colabs[c]["nome"]
        result["alocacoes"][nome] = {}
        total_week = 0

        for d in range(D):
            slots_worked = sorted(s for s in range(S) if solver.value(work[c, d, s]) == 1)

            if not slots_worked:
                result["alocacoes"][nome][days[d]] = {
                    "inicio": None,
                    "fim": None,
                    "almoco": None,
                    "minutos": 0,
                    "status": "FOLGA",
                }
                continue

            first_s = slots_worked[0]
            last_s = slots_worked[-1]
            minutos = len(slots_worked) * grid_min
            total_week += minutos

            inicio = slot_to_time(first_s, base_h, grid_min)
            fim = slot_to_time(last_s + 1, base_h, grid_min)

            almoco = None
            gap_slots = [s for s in range(first_s, last_s + 1) if s not in slots_worked]
            if gap_slots:
                gap_start = gap_slots[0]
                gap_end = gap_slots[-1]
                almoco = f"{slot_to_time(gap_start, base_h, grid_min)}-{slot_to_time(gap_end + 1, base_h, grid_min)}"

            result["alocacoes"][nome][days[d]] = {
                "inicio": inicio,
                "fim": fim,
                "almoco": almoco,
                "minutos": minutos,
                "status": "TRABALHO",
            }

        result["horas_semanais"][nome] = total_week

    total_def = sum(solver.value(dv) for dv in deficit.values()) if deficit else 0
    total_sur = sum(solver.value(sv) for sv in surplus.values()) if surplus else 0
    total_demand_slots = sum(demand_by_slot.values())
    covered = total_demand_slots - total_def
    cobertura = round(covered / total_demand_slots * 100, 1) if total_demand_slots > 0 else 100.0

    wm_vals = [solver.value(wm) for wm in weekly_minutes]
    spread_val = max(wm_vals) - min(wm_vals) if wm_vals else 0
    ap1_total = sum(solver.value(ex) for ex in ap1_excess) if ap1_excess else 0

    result["indicadores"] = {
        "deficit_total": total_def,
        "surplus_total": total_sur,
        "cobertura_percent": cobertura,
        "spread_semanal_min": spread_val,
        "violacoes_hard": 0,
        "ap1_excess_total_slots": ap1_total,
        "objective_value": int(solver.objective_value),
        "total_demand_slots": total_demand_slots,
    }

    return result


def post_solve_validate(
    result: dict,
    colabs: List[dict],
    days: List[str],
    S: int,
    base_h: int,
    grid_min: int,
) -> List[dict]:
    violations: list[dict] = []
    allocs = result.get("alocacoes", {})
    base_min = base_h * 60

    for c_data in colabs:
        nome = c_data["nome"]
        daily_mins = []

        for day in days:
            a = allocs.get(nome, {}).get(day, {})
            mins = a.get("minutos", 0)
            if mins > 0:
                daily_mins.append(mins)

            almoco_str = a.get("almoco")
            if almoco_str:
                parts = almoco_str.split("-")
                lh1, lm1 = map(int, parts[0].split(":"))
                lh2, lm2 = map(int, parts[1].split(":"))
                lunch_min = (lh2 * 60 + lm2) - (lh1 * 60 + lm1)
                if lunch_min > 120:
                    violations.append({"tipo": "AP5", "pessoa": nome, "dia": day, "detalhe": f"Almoco {lunch_min}min (max 120min)"})

            if almoco_str and a.get("inicio"):
                parts = almoco_str.split("-")
                ih, im = map(int, a["inicio"].split(":"))
                fh, fm = map(int, a["fim"].split(":"))
                lh1, lm1 = map(int, parts[0].split(":"))
                lh2, lm2 = map(int, parts[1].split(":"))
                work_before = (lh1 * 60 + lm1) - (ih * 60 + im)
                work_after = (fh * 60 + fm) - (lh2 * 60 + lm2)
                if work_before < 120:
                    violations.append({"tipo": "AP10/H20", "pessoa": nome, "dia": day, "detalhe": f"Apenas {work_before}min antes do almoco (min 120)"})
                if work_after < 120:
                    violations.append({"tipo": "AP10/H20", "pessoa": nome, "dia": day, "detalhe": f"Apenas {work_after}min apos almoco (min 120)"})

            if 240 < mins <= 360:
                violations.append({"tipo": "H7_INFO", "pessoa": nome, "dia": day, "detalhe": f"Jornada {mins}min (>4h <=6h) - direito a 15min"})

        if daily_mins:
            variance = max(daily_mins) - min(daily_mins)
            if variance > 120:
                violations.append({"tipo": "AP2", "pessoa": nome, "detalhe": f"Spread diario {variance}min (max ideal 120)"})

    for day in days:
        for s in range(S):
            lunching = 0
            working = 0
            for c_data in colabs:
                nome = c_data["nome"]
                a = allocs.get(nome, {}).get(day, {})
                if a.get("status") != "TRABALHO":
                    continue
                working += 1
                almoco_str = a.get("almoco")
                if not almoco_str:
                    continue
                parts = almoco_str.split("-")
                lh1, lm1 = map(int, parts[0].split(":"))
                lh2, lm2 = map(int, parts[1].split(":"))
                ls = (lh1 * 60 + lm1 - base_min) // grid_min
                le = (lh2 * 60 + lm2 - base_min) // grid_min
                if ls <= s < le:
                    lunching += 1
            if working > 0 and lunching > working * 0.5:
                violations.append({"tipo": "AP9", "dia": day, "slot": slot_to_time(s, base_h, grid_min), "detalhe": f"{lunching}/{working} em almoco"})

    return violations


def print_summary(
    result: dict,
    colabs: List[dict],
    days: List[str],
    demand_by_slot: DaySlotDemand,
    S: int,
    violations: List[dict],
    base_h: int,
    grid_min: int,
) -> None:
    print()
    print("=" * 75)
    print(f"  OR-Tools CP-SAT | Status: {result['status']} | Time: {result['solve_time_ms']:.0f} ms")
    print("=" * 75)

    if result["status"] not in ("OPTIMAL", "FEASIBLE"):
        print("  INFEASIBLE - HARD constraints conflitam.")
        return

    ind = result["indicadores"]
    print(
        f"  Deficit: {ind['deficit_total']} | Surplus: {ind['surplus_total']} | Cobertura: {ind['cobertura_percent']}%"
    )
    print(
        f"  Spread: {ind['spread_semanal_min']} min | AP1 excess: {ind['ap1_excess_total_slots']} | Objective: {ind['objective_value']}"
    )
    print("-" * 75)

    print("  Cobertura vs Demanda (1o dia):")
    print(f"    {'Hora':>5s}  {'Dem':>3s}  {'Cob':>3s}  {'OK':>3s}")
    first_day_idx = 0
    base_min = base_h * 60

    for s in range(S):
        target = demand_by_slot.get((first_day_idx, s), 0)
        if target <= 0:
            continue

        cov = 0
        for c_data in colabs:
            nome = c_data["nome"]
            a = result["alocacoes"][nome].get(days[first_day_idx], {})
            if a.get("inicio") is None:
                continue
            ih, im = map(int, a["inicio"].split(":"))
            fh, fm = map(int, a["fim"].split(":"))
            s_start = (ih * 60 + im - base_min) // grid_min
            s_end = (fh * 60 + fm - base_min) // grid_min
            ls, le = -1, -1
            almoco_str = a.get("almoco")
            if almoco_str:
                parts = almoco_str.split("-")
                lh1, lm1 = map(int, parts[0].split(":"))
                lh2, lm2 = map(int, parts[1].split(":"))
                ls = (lh1 * 60 + lm1 - base_min) // grid_min
                le = (lh2 * 60 + lm2 - base_min) // grid_min
            if s_start <= s < s_end and not (ls <= s < le):
                cov += 1

        ok = "OK" if cov >= target else f"-{target - cov}"
        print(f"    {slot_to_time(s, base_h, grid_min):>5s}  {target:>3d}  {cov:>3d}  {ok:>3s}")

    if violations:
        print("-" * 75)
        print(f"  Validacao pos-solve: {len(violations)} apontamentos")


def solve(input_path: str, output_path: str) -> dict:
    if input_path.endswith(".db"):
        data = parse_from_db(input_path)
    else:
        data = parse_fixture(input_path)

    print(
        f"\nBuilding model: setor={data['metadata']['setor']}, {len(data['colaboradores'])} colabs, "
        f"{data['metadata']['periodo']['inicio']} - {data['metadata']['periodo']['fim']}"
    )

    (
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
        deficit,
        surplus,
        weekly_minutes,
        ap1_excess,
        base_h,
        grid_min,
    ) = build_model(data)

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = 120
    solver.parameters.num_workers = 8
    solver.parameters.log_search_progress = False

    print("Solving (max 120s, 8 workers)...")
    t0 = time.time()
    status = solver.solve(model)
    solve_time_ms = (time.time() - t0) * 1000

    result = extract_solution(
        solver,
        work,
        colabs,
        days,
        C,
        D,
        S,
        demand_by_slot,
        deficit,
        surplus,
        weekly_minutes,
        ap1_excess,
        status,
        solve_time_ms,
        base_h,
        grid_min,
    )

    violations: list[dict] = []
    if status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        violations = post_solve_validate(result, colabs, days, S, base_h, grid_min)
        result["validacao_pos_solve"] = violations

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2, ensure_ascii=False)

    print_summary(result, colabs, days, demand_by_slot, S, violations, base_h, grid_min)
    print(f"\nResultado salvo em: {output_path}")

    return result


def main() -> None:
    script_dir = Path(__file__).resolve().parent
    project_root = script_dir.parent.parent.parent

    if len(sys.argv) > 1:
        input_path = sys.argv[1]
    else:
        input_path = str(project_root / "data" / "escalaflow.db")

    output_path = str(script_dir / "resultado_python.json")
    solve(input_path, output_path)


if __name__ == "__main__":
    main()
