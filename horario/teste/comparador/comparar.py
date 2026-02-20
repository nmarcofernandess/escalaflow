#!/usr/bin/env python3
"""Comparador cego: Motor TS vs OR-Tools usando input do sistema + referencia Rita."""

import json
import sqlite3
import sys
from datetime import date, datetime
from pathlib import Path
from typing import Optional


DAY_LABELS = ["SEG", "TER", "QUA", "QUI", "SEX", "SAB", "DOM"]


def norm_name(name: str) -> str:
    return " ".join(str(name).strip().upper().split())


def time_to_min(t: str) -> int:
    h, m = map(int, t.split(":"))
    return h * 60 + m


def min_to_time(m: int) -> str:
    return f"{m // 60:02d}:{m % 60:02d}"


def day_label(iso_date: str) -> str:
    return DAY_LABELS[date.fromisoformat(iso_date).weekday()]


def load_json(path: Path) -> Optional[dict]:
    if not path.exists():
        return None
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def fmt(val, suffix: str = "", decimals: int = 1) -> str:
    if val is None:
        return "N/A"
    if isinstance(val, float):
        return f"{val:.{decimals}f}{suffix}"
    return f"{val}{suffix}"


def slots_from_alloc(alloc: dict) -> set[int]:
    if not alloc:
        return set()
    inicio = alloc.get("inicio")
    fim = alloc.get("fim")
    if not inicio or not fim or alloc.get("status") == "FOLGA":
        return set()

    start = time_to_min(inicio)
    end = time_to_min(fim)

    lunch_start = -1
    lunch_end = -1
    almoco = alloc.get("almoco")
    if almoco:
        a, b = almoco.split("-")
        lunch_start = time_to_min(a.strip())
        lunch_end = time_to_min(b.strip())

    slots = set()
    t = start
    while t < end:
        if lunch_start >= 0 and lunch_start <= t < lunch_end:
            t += 30
            continue
        slots.add(t)
        t += 30
    return slots


def jaccard(a: set[int], b: set[int]) -> float:
    if not a and not b:
        return 100.0
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b) * 100


def parse_solver_allocations(solver_data: Optional[dict]) -> dict[str, dict[str, dict]]:
    if not solver_data:
        return {}

    if "alocacoes_por_dia" in solver_data:
        raw = solver_data["alocacoes_por_dia"]
    else:
        raw = solver_data.get("alocacoes", {})

    out: dict[str, dict[str, dict]] = {}

    if isinstance(raw, dict):
        if not raw:
            return out
        first_key = next(iter(raw.keys()))
        first_val = next(iter(raw.values()))
        is_day_outer = isinstance(first_key, str) and len(first_key) == 10 and first_key[4] == "-"

        if is_day_outer and isinstance(first_val, dict):
            for day, day_alloc in raw.items():
                out.setdefault(day, {})
                for name, alloc in day_alloc.items():
                    out[day][norm_name(name)] = alloc
            return out

        # name -> day -> alloc
        for name, by_day in raw.items():
            if not isinstance(by_day, dict):
                continue
            n = norm_name(name)
            for day, alloc in by_day.items():
                out.setdefault(day, {})[n] = alloc
        return out

    if isinstance(raw, list):
        for a in raw:
            day = a.get("data") or a.get("dia")
            name = a.get("colaborador") or a.get("nome")
            if not day or not name:
                continue
            almoco = None
            if a.get("almoco_inicio") and a.get("almoco_fim"):
                almoco = f"{a['almoco_inicio']}-{a['almoco_fim']}"
            elif a.get("almoco"):
                almoco = a["almoco"]
            out.setdefault(day, {})[norm_name(name)] = {
                "inicio": a.get("inicio"),
                "fim": a.get("fim"),
                "almoco": almoco,
                "minutos": a.get("minutos_trabalhados", a.get("minutos", 0)),
            }
    return out


def parse_gt_allocations(rita_data: dict) -> dict[str, dict[str, dict]]:
    raw = rita_data["ground_truth"]["alocacoes_por_dia"]
    out: dict[str, dict[str, dict]] = {}
    for day, by_name in raw.items():
        out.setdefault(day, {})
        for name, alloc in by_name.items():
            out[day][norm_name(name)] = alloc
    return out


def compute_weekly_hours(allocs: dict[str, dict[str, dict]], names_norm: list[str]) -> dict[str, int]:
    totals = {n: 0 for n in names_norm}
    for day_alloc in allocs.values():
        for n, alloc in day_alloc.items():
            if n in totals:
                totals[n] += int(alloc.get("minutos", 0) or 0)
    return totals


def build_day_slot_targets(demanda: list[dict], days: list[str]) -> dict[str, dict[int, int]]:
    targets: dict[str, dict[int, int]] = {d: {} for d in days}
    for d in days:
        lbl = day_label(d)
        for seg in demanda:
            dia = seg.get("dia_semana")
            if dia is not None and dia != lbl:
                continue
            s0 = time_to_min(seg["hora_inicio"])
            s1 = time_to_min(seg["hora_fim"])
            target = int(seg["min_pessoas"])
            for s in range(s0, s1, 30):
                targets[d][s] = max(targets[d].get(s, 0), target)
    return targets


def compute_demand_coverage(
    allocs: dict[str, dict[str, dict]],
    demanda: list[dict],
    days: list[str],
) -> dict:
    worker_slots: dict[str, dict[str, set[int]]] = {}
    for day, by_name in allocs.items():
        worker_slots[day] = {n: slots_from_alloc(a) for n, a in by_name.items()}

    targets = build_day_slot_targets(demanda, days)

    slot_stats: dict[str, dict[str, list[int] | float | int]] = {}
    total_slot_days = 0
    met_count = 0
    coverage_ratios: list[float] = []

    for day in days:
        day_targets = targets.get(day, {})
        for slot_min, target in sorted(day_targets.items()):
            total_slot_days += 1
            cov = sum(1 for ws in worker_slots.get(day, {}).values() if slot_min in ws)
            if cov >= target:
                met_count += 1
            if target > 0:
                coverage_ratios.append(min(cov / target, 1.0))

            label = f"{min_to_time(slot_min)}-{min_to_time(slot_min + 30)}"
            if label not in slot_stats:
                slot_stats[label] = {
                    "targets": [],
                    "coverages": [],
                }
            slot_stats[label]["targets"].append(target)
            slot_stats[label]["coverages"].append(cov)

    per_slot = {}
    for label, s in slot_stats.items():
        tvals = s["targets"]
        cvals = s["coverages"]
        deficits = sum(1 for t, c in zip(tvals, cvals) if c < t)
        per_slot[label] = {
            "target_avg": sum(tvals) / len(tvals),
            "avg": sum(cvals) / len(cvals),
            "deficit_days": deficits,
            "target_per_day": tvals,
            "coverage_per_day": cvals,
        }

    met_percent = (met_count / total_slot_days * 100) if total_slot_days else 0
    avg_cov_pct = (sum(coverage_ratios) / len(coverage_ratios) * 100) if coverage_ratios else 0

    return {
        "por_slot": per_slot,
        "total_slot_days": total_slot_days,
        "met_count": met_count,
        "met_percent": met_percent,
        "avg_coverage_percent": avg_cov_pct,
    }


def compute_similarity(
    solver_allocs: dict[str, dict[str, dict]],
    gt_allocs: dict[str, dict[str, dict]],
    names_norm: list[str],
    days: list[str],
) -> dict:
    per_person_day: dict[str, dict[str, float]] = {}
    day_sims: dict[str, list[float]] = {day_label(d): [] for d in days}
    person_sims: dict[str, list[float]] = {n: [] for n in names_norm}
    all_sims: list[float] = []

    for day in days:
        dl = day_label(day)
        sday = solver_allocs.get(day, {})
        gday = gt_allocs.get(day, {})
        for n in names_norm:
            s_slots = slots_from_alloc(sday.get(n, {}))
            g_slots = slots_from_alloc(gday.get(n, {}))
            sim = jaccard(s_slots, g_slots)
            per_person_day.setdefault(n, {})[dl] = sim
            day_sims[dl].append(sim)
            person_sims[n].append(sim)
            all_sims.append(sim)

    return {
        "por_pessoa_dia": per_person_day,
        "por_dia": {k: (sum(v) / len(v) if v else 0) for k, v in day_sims.items()},
        "por_pessoa": {k: (sum(v) / len(v) if v else 0) for k, v in person_sims.items()},
        "media_global": (sum(all_sims) / len(all_sims) if all_sims else 0),
    }


def get_violations(solver_data: Optional[dict]) -> Optional[int]:
    if not solver_data:
        return None
    if "violacoes_hard" in solver_data:
        return solver_data["violacoes_hard"]
    if "indicadores" in solver_data:
        return solver_data["indicadores"].get("violacoes_hard", 0)
    return None


def load_input_from_db(db_path: Path, setor_nome: str = "caixa") -> dict:
    conn = sqlite3.connect(str(db_path))
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
        select c.id,c.nome,c.horas_semanais,tc.dias_trabalho,tc.max_minutos_dia
        from colaboradores c
        join tipos_contrato tc on tc.id=c.tipo_contrato_id
        where c.setor_id=? and c.ativo=1
        order by c.rank
        """,
        (setor_id,),
    ).fetchall()

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

    return {
        "metadata": {
            "setor": (setor["nome"] or "CAIXA").upper(),
            "periodo": {"inicio": "2026-02-09", "fim": "2026-02-14"},
        },
        "empresa": {"tolerancia_semanal_min": int(emp["tolerancia_semanal_min"]) if emp else 30},
        "colaboradores": [dict(r) for r in col_rows],
        "demanda": [
            {
                "dia_semana": r["dia_semana"],
                "hora_inicio": r["hora_inicio"],
                "hora_fim": r["hora_fim"],
                "min_pessoas": int(r["min_pessoas"]),
                "override": bool(r["override"]),
            }
            for r in dem_rows
        ],
    }


def get_solve_time(solver_data: Optional[dict]) -> Optional[str]:
    if not solver_data:
        return None
    for key in ("tempo_ms", "solve_time_ms", "elapsed_ms", "tempo"):
        if key in solver_data:
            val = solver_data[key]
            if isinstance(val, (int, float)):
                return f"{val:.0f}ms"
            return str(val)
    if "indicadores" in solver_data:
        for key in ("tempo_ms", "solve_time_ms"):
            if key in solver_data["indicadores"]:
                return f"{solver_data['indicadores'][key]:.0f}ms"
    return None


def generate_report(input_data: dict, rita_data: dict, ts_result: Optional[dict], py_result: Optional[dict]) -> str:
    gt_allocs = parse_gt_allocations(rita_data)
    days = sorted(gt_allocs.keys())

    colabs = input_data["colaboradores"]
    display_by_norm = {norm_name(c["nome"]): c["nome"] for c in colabs}

    names_norm = [n for n in sorted(display_by_norm.keys()) if any(n in gt_allocs.get(d, {}) for d in days)]

    demanda = input_data["demanda"]
    tolerance = int(input_data["empresa"].get("tolerancia_semanal_min", 30))

    ts_allocs = parse_solver_allocations(ts_result)
    py_allocs = parse_solver_allocations(py_result)

    ts_has_data = bool(ts_allocs)
    py_has_data = bool(py_allocs)

    gt_weekly = compute_weekly_hours(gt_allocs, names_norm)
    ts_weekly = compute_weekly_hours(ts_allocs, names_norm) if ts_has_data else None
    py_weekly = compute_weekly_hours(py_allocs, names_norm) if py_has_data else None

    gt_cov = compute_demand_coverage(gt_allocs, demanda, days)
    ts_cov = compute_demand_coverage(ts_allocs, demanda, days) if ts_has_data else None
    py_cov = compute_demand_coverage(py_allocs, demanda, days) if py_has_data else None

    ts_sim = compute_similarity(ts_allocs, gt_allocs, names_norm, days) if ts_has_data else None
    py_sim = compute_similarity(py_allocs, gt_allocs, names_norm, days) if py_has_data else None

    ts_viol = get_violations(ts_result)
    py_viol = get_violations(py_result)
    ts_time = get_solve_time(ts_result)
    py_time = get_solve_time(py_result)

    contract_mins = {norm_name(c["nome"]): int(c["horas_semanais"]) * 60 for c in colabs}

    def avg_dev(weekly: Optional[dict]) -> Optional[float]:
        if not weekly:
            return None
        devs = [abs(weekly[n] - contract_mins.get(n, weekly[n])) for n in names_norm]
        return sum(devs) / len(devs) if devs else None

    lines: list[str] = []

    def ln(s: str = ""):
        lines.append(s)

    ln("# Resultado do Teste Cego -- Motor v3 vs OR-Tools")
    ln()
    ln(f"**Data:** {datetime.now().strftime('%Y-%m-%d %H:%M')}")
    ln(f"**Periodo:** {input_data['metadata']['periodo']['inicio']} a {input_data['metadata']['periodo']['fim']}")
    ln(f"**Setor:** {input_data['metadata']['setor']}")
    ln(f"**Input do solver:** `data/escalaflow.db`")
    ln(f"**Referencia Rita:** `data/comparacao/caixa_rita_referencia.json` ({rita_data.get('source', 'N/A')})")
    ln()

    ln("## Resumo Executivo")
    ln()
    ln("| Metrica | Motor TS | OR-Tools | Rita (GT) |")
    ln("|---------|----------|----------|-----------|")
    ln(f"| Cobertura demanda % | {fmt(ts_cov['met_percent'] if ts_cov else None, '%')} | {fmt(py_cov['met_percent'] if py_cov else None, '%')} | {fmt(gt_cov['met_percent'], '%')} |")
    ln(f"| Cobertura media % | {fmt(ts_cov['avg_coverage_percent'] if ts_cov else None, '%')} | {fmt(py_cov['avg_coverage_percent'] if py_cov else None, '%')} | {fmt(gt_cov['avg_coverage_percent'], '%')} |")
    ln(f"| Violacoes hard | {fmt(ts_viol)} | {fmt(py_viol)} | 0 |")
    ln(f"| Desvio semanal medio | {fmt(avg_dev(ts_weekly), 'min') if avg_dev(ts_weekly) is not None else 'N/A'} | {fmt(avg_dev(py_weekly), 'min') if avg_dev(py_weekly) is not None else 'N/A'} | {fmt(avg_dev(gt_weekly), 'min')} |")
    ln(f"| Similaridade com GT % | {fmt(ts_sim['media_global'] if ts_sim else None, '%')} | {fmt(py_sim['media_global'] if py_sim else None, '%')} | 100.0% |")
    ln(f"| Tempo de resolucao | {ts_time or 'N/A'} | {py_time or 'N/A'} | manual |")
    ln()

    ln("## Horas Semanais por Colaborador")
    ln()
    ln("| Colaborador | Contrato | Motor TS | OR-Tools | Rita (GT) |")
    ln("|-------------|----------|----------|----------|-----------|")
    for n in names_norm:
        disp = display_by_norm.get(n, n)
        contrato = contract_mins.get(n)
        ln(
            f"| {disp} | {fmt(contrato, 'min')} | "
            f"{fmt(ts_weekly[n], 'min') if ts_weekly else 'N/A'} | "
            f"{fmt(py_weekly[n], 'min') if py_weekly else 'N/A'} | "
            f"{fmt(gt_weekly[n], 'min')} |"
        )
    ln()

    if ts_sim or py_sim:
        ln("## Similaridade por Dia (Jaccard %)")
        ln()
        header = "| Dia |"
        sep = "|-----|"
        if ts_sim:
            header += " Motor TS |"
            sep += "----------|"
        if py_sim:
            header += " OR-Tools |"
            sep += "----------|"
        ln(header)
        ln(sep)
        for d in days:
            dl = day_label(d)
            row = f"| {dl} |"
            if ts_sim:
                row += f" {ts_sim['por_dia'][dl]:.1f}% |"
            if py_sim:
                row += f" {py_sim['por_dia'][dl]:.1f}% |"
            ln(row)
        ln()

    ln("---")
    ln(f"*Gerado automaticamente por `comparar.py` em {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}*")

    return "\n".join(lines)


def main():
    base = Path(__file__).parent.parent
    project_root = base.parent.parent

    db_path = project_root / "data" / "escalaflow.db"
    rita_path = project_root / "data" / "comparacao" / "caixa_rita_referencia.json"

    # Fallback legada: fixture unico
    legacy_fixture = base / "fixture" / "caixa_rita.json"

    if db_path.exists() and rita_path.exists():
        input_data = load_input_from_db(db_path)
        rita_data = load_json(rita_path)
        print(f"Input sistema carregado do DB: {db_path}")
        print(f"Referencia Rita carregada: {rita_path}")
    elif legacy_fixture.exists():
        legacy = load_json(legacy_fixture)
        input_data = {
            "metadata": legacy["metadata"],
            "empresa": legacy["empresa"],
            "colaboradores": legacy["colaboradores"],
            "demanda": legacy["demanda"],
        }
        rita_data = {
            "source": legacy["ground_truth"]["source"],
            "ground_truth": {
                "alocacoes_por_dia": legacy["ground_truth"]["alocacoes_por_dia"],
                "horas_por_dia": legacy["ground_truth"].get("horas_por_dia", {}),
                "horas_semanais_verificacao": legacy["ground_truth"].get("horas_semanais_verificacao", {}),
            },
        }
        print(f"Modo legado: fixture unico carregado em {legacy_fixture}")
    else:
        print("ERRO: arquivos de comparacao nao encontrados.")
        print(f"Esperado: {db_path} e {rita_path}")
        sys.exit(1)

    ts_path = base / "adapter_ts" / "resultado_ts.json"
    py_path = base / "solver_python" / "resultado_python.json"

    ts_result = load_json(ts_path)
    py_result = load_json(py_path)

    print(f"Motor TS: {'OK' if ts_result else 'N/A'} ({ts_path})")
    print(f"OR-Tools: {'OK' if py_result else 'N/A'} ({py_path})")

    report = generate_report(input_data, rita_data, ts_result, py_result)

    report_path = Path(__file__).parent / "relatorio.md"
    with open(report_path, "w", encoding="utf-8") as f:
        f.write(report)

    print(f"\nRelatorio gerado: {report_path}")


if __name__ == "__main__":
    main()
