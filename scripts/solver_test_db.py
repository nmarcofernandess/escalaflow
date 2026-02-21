#!/usr/bin/env python3
"""
Smoke test do motor real (Python) usando o banco real do app.

Uso:
  python3 scripts/solver_test_db.py --setor-id 1 --data-inicio 2026-03-01 --data-fim 2026-03-31
"""

from __future__ import annotations

import argparse
import json
import sqlite3
import subprocess
import sys
from datetime import date, timedelta
from pathlib import Path
from typing import Any


def next_month_period(today: date) -> tuple[str, str]:
    if today.month == 12:
        first_next = date(today.year + 1, 1, 1)
    else:
        first_next = date(today.year, today.month + 1, 1)

    if first_next.month == 12:
        first_after = date(first_next.year + 1, 1, 1)
    else:
        first_after = date(first_next.year, first_next.month + 1, 1)

    last_next = first_after - timedelta(days=1)
    return first_next.isoformat(), last_next.isoformat()


def build_payload(
    db_path: Path,
    setor_id: int,
    data_inicio: str,
    data_fim: str,
    solve_mode: str,
    nivel_rigor: str,
    num_workers: int,
) -> dict[str, Any]:
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row

    try:
        emp = conn.execute("SELECT * FROM empresa LIMIT 1").fetchone()
        setor = conn.execute("SELECT * FROM setores WHERE id = ?", (setor_id,)).fetchone()
        if not setor:
            raise RuntimeError(f"Setor {setor_id} nao encontrado no DB {db_path}")

        col_rows = conn.execute(
            """
            SELECT c.id, c.nome, c.sexo, c.horas_semanais, c.rank, c.tipo_trabalhador, c.funcao_id,
                   tc.regime_escala, tc.dias_trabalho, tc.max_minutos_dia, tc.trabalha_domingo
            FROM colaboradores c
            JOIN tipos_contrato tc ON tc.id = c.tipo_contrato_id
            WHERE c.setor_id = ? AND c.ativo = 1
            ORDER BY c.rank DESC
            """,
            (setor_id,),
        ).fetchall()

        colaboradores: list[dict[str, Any]] = []
        for r in col_rows:
            regime = r["regime_escala"] or ("5X2" if int(r["dias_trabalho"]) <= 5 else "6X1")
            dias_trabalho = 5 if regime == "5X2" else 6
            colaboradores.append(
                {
                    "id": int(r["id"]),
                    "nome": r["nome"],
                    "horas_semanais": int(r["horas_semanais"]),
                    "regime_escala": regime,
                    "dias_trabalho": dias_trabalho,
                    "max_minutos_dia": int(r["max_minutos_dia"]),
                    "trabalha_domingo": bool(r["trabalha_domingo"]),
                    "tipo_trabalhador": r["tipo_trabalhador"] or "CLT",
                    "sexo": r["sexo"],
                    "funcao_id": r["funcao_id"],
                    "rank": int(r["rank"] or 0),
                }
            )

        dem_rows = conn.execute(
            """
            SELECT dia_semana, hora_inicio, hora_fim, min_pessoas, override
            FROM demandas
            WHERE setor_id = ?
            ORDER BY dia_semana, hora_inicio
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

        fer_rows = conn.execute(
            """
            SELECT data, nome, proibido_trabalhar, cct_autoriza
            FROM feriados
            WHERE data BETWEEN ? AND ?
            """,
            (data_inicio, data_fim),
        ).fetchall()
        feriados = [
            {
                "data": r["data"],
                "nome": r["nome"],
                "proibido_trabalhar": bool(r["proibido_trabalhar"]) or (not bool(r["cct_autoriza"])),
            }
            for r in fer_rows
        ]

        exc_rows = conn.execute(
            """
            SELECT colaborador_id, data_inicio, data_fim, tipo
            FROM excecoes
            WHERE data_inicio <= ? AND data_fim >= ?
            """,
            (data_fim, data_inicio),
        ).fetchall()
        excecoes = [
            {
                "colaborador_id": int(r["colaborador_id"]),
                "data_inicio": r["data_inicio"],
                "data_fim": r["data_fim"],
                "tipo": r["tipo"],
            }
            for r in exc_rows
        ]
    finally:
        conn.close()

    tolerancia = int(emp["tolerancia_semanal_min"]) if emp else 30
    min_almoco = int(emp["min_intervalo_almoco_min"]) if emp and emp["min_intervalo_almoco_min"] is not None else 60
    grid_min = int(emp["grid_minutos"]) if emp and emp["grid_minutos"] is not None else 30

    return {
        "setor_id": setor_id,
        "data_inicio": data_inicio,
        "data_fim": data_fim,
        "piso_operacional": max(1, int(setor["piso_operacional"] or 1)),
        "empresa": {
            "tolerancia_semanal_min": tolerancia,
            "hora_abertura": setor["hora_abertura"],
            "hora_fechamento": setor["hora_fechamento"],
            "min_intervalo_almoco_min": min_almoco,
            "max_intervalo_almoco_min": 120,
            "grid_minutos": grid_min,
        },
        "colaboradores": colaboradores,
        "demanda": demanda,
        "feriados": feriados,
        "excecoes": excecoes,
        "pinned_cells": [],
        "hints": [],
        "config": {
            "solve_mode": solve_mode,
            "nivel_rigor": nivel_rigor,
            "num_workers": num_workers,
        },
    }


def run_solver(project_root: Path, payload: dict[str, Any]) -> tuple[dict[str, Any], str, int]:
    solver_path = project_root / "solver" / "solver_ortools.py"
    if not solver_path.exists():
        raise RuntimeError(f"Solver nao encontrado: {solver_path}")

    proc = subprocess.run(
        [sys.executable, str(solver_path)],
        input=json.dumps(payload),
        text=True,
        capture_output=True,
        cwd=str(project_root),
    )

    stdout_lines = [line.strip() for line in proc.stdout.splitlines() if line.strip()]
    if not stdout_lines:
        raise RuntimeError(f"Solver nao retornou JSON em stdout. stderr={proc.stderr[:400]}")

    try:
        output = json.loads(stdout_lines[-1])
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"Resposta invalida do solver: {stdout_lines[-1][:300]}") from exc

    return output, proc.stderr, proc.returncode


def main() -> int:
    project_root = Path(__file__).resolve().parents[1]
    default_db = project_root / "data" / "escalaflow.db"
    default_inicio, default_fim = next_month_period(date.today())

    parser = argparse.ArgumentParser(description="Testa solver Python real contra DB do app")
    parser.add_argument("--db", default=str(default_db), help="Caminho do SQLite")
    parser.add_argument("--setor-id", type=int, default=1, help="ID do setor para smoke test")
    parser.add_argument("--data-inicio", default=default_inicio, help="Data inicio (YYYY-MM-DD)")
    parser.add_argument("--data-fim", default=default_fim, help="Data fim (YYYY-MM-DD)")
    parser.add_argument("--solve-mode", choices=["rapido", "otimizado"], default="rapido")
    parser.add_argument("--nivel-rigor", choices=["ALTO", "MEDIO", "BAIXO"], default="ALTO")
    parser.add_argument("--num-workers", type=int, default=8)
    parser.add_argument("--print-json", action="store_true")
    args = parser.parse_args()

    db_path = Path(args.db)
    if not db_path.exists():
        print(f"[solver:test] DB nao encontrado: {db_path}", file=sys.stderr)
        return 2

    payload = build_payload(
        db_path=db_path,
        setor_id=args.setor_id,
        data_inicio=args.data_inicio,
        data_fim=args.data_fim,
        solve_mode=args.solve_mode,
        nivel_rigor=args.nivel_rigor,
        num_workers=args.num_workers,
    )

    result, stderr_text, returncode = run_solver(project_root, payload)
    status = result.get("status")
    sucesso = bool(result.get("sucesso"))
    indicadores = result.get("indicadores") or {}
    cobertura = indicadores.get("cobertura_percent")
    solve_time_ms = result.get("solve_time_ms")

    print(
        f"[solver:test] setor={args.setor_id} periodo={args.data_inicio}..{args.data_fim} "
        f"modo={args.solve_mode} rigor={args.nivel_rigor}"
    )
    print(
        f"[solver:test] status={status} sucesso={sucesso} "
        f"cobertura={cobertura} solve_time_ms={solve_time_ms} exit_code={returncode}"
    )

    if stderr_text.strip():
        print("[solver:test] logs:")
        print(stderr_text.rstrip())

    if args.print_json:
        print(json.dumps(result, ensure_ascii=False, indent=2))

    if not sucesso:
        erro = result.get("erro") or {}
        msg = erro.get("mensagem") or "Solver retornou erro sem mensagem."
        print(f"[solver:test] FAIL: {msg}", file=sys.stderr)
        return 1

    print("[solver:test] OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
