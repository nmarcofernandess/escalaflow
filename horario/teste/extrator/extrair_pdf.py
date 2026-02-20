#!/usr/bin/env python3
"""
Extrator / Validador: valida o ground truth do fixture contra invariantes CLT e de negocio.

Fase 1 (atual): Valida a consistencia interna do fixture (sem PDF parsing).
Fase 2 (futura): Parseia o PDF original e gera/atualiza o ground truth.

Uso:
    python extrair_pdf.py
    # Valida caixa_rita.json e imprime resultado
"""

import json
import sys
from pathlib import Path


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def time_to_min(t: str) -> int:
    """'08:30' -> 510"""
    h, m = map(int, t.split(":"))
    return h * 60 + m


def min_to_time(m: int) -> str:
    """510 -> '08:30'"""
    return f"{m // 60:02d}:{m % 60:02d}"


def slots_from_alloc(alloc: dict) -> set[int]:
    """Converte alocacao em set de slots de 30min."""
    if not alloc or not alloc.get("inicio"):
        return set()

    start = time_to_min(alloc["inicio"])
    end = time_to_min(alloc["fim"])

    lunch_start = lunch_end = -1
    if alloc.get("almoco"):
        parts = alloc["almoco"].split("-")
        lunch_start = time_to_min(parts[0].strip())
        lunch_end = time_to_min(parts[1].strip())

    slots = set()
    t = start
    while t < end:
        if lunch_start >= 0 and lunch_start <= t < lunch_end:
            t += 30
            continue
        slots.add(t)
        t += 30
    return slots


# ---------------------------------------------------------------------------
# Validation rules
# ---------------------------------------------------------------------------

class ValidationResult:
    """Acumula erros e avisos de validacao."""

    def __init__(self):
        self.errors: list[str] = []
        self.warnings: list[str] = []
        self.info: list[str] = []

    def error(self, msg: str):
        self.errors.append(msg)

    def warn(self, msg: str):
        self.warnings.append(msg)

    def note(self, msg: str):
        self.info.append(msg)

    @property
    def ok(self) -> bool:
        return len(self.errors) == 0

    def summary(self) -> str:
        return f"{len(self.errors)} erros, {len(self.warnings)} avisos, {len(self.info)} notas"


def validate_fixture(data: dict) -> ValidationResult:
    """Roda todas as validacoes no fixture."""
    result = ValidationResult()

    gt = data.get("ground_truth")
    if not gt:
        result.error("Fixture nao tem 'ground_truth'")
        return result

    colabs = data.get("colaboradores", [])
    empresa = data.get("empresa", {})
    demanda = data.get("demanda", [])
    meta = data.get("metadata", {})

    colab_map = {c["nome"]: c for c in colabs}
    tolerancia = empresa.get("tolerancia_semanal_min", 30)

    # ------------------------------------------------------------------
    # V1: Todos os colaboradores estao no ground truth
    # ------------------------------------------------------------------
    gt_names = set()
    for day_allocs in gt.get("alocacoes_por_dia", {}).values():
        gt_names.update(day_allocs.keys())

    for c in colabs:
        if c["nome"] not in gt_names:
            result.error(f"V1: Colaborador '{c['nome']}' definido no fixture mas ausente no ground truth")

    for name in gt_names:
        if name not in colab_map:
            result.error(f"V1: '{name}' no ground truth mas nao na lista de colaboradores")

    # ------------------------------------------------------------------
    # V2: Horas semanais batem com contrato (+/- tolerancia)
    # ------------------------------------------------------------------
    horas_verificacao = gt.get("horas_semanais_verificacao", {})
    horas_por_dia = gt.get("horas_por_dia", {})

    for c in colabs:
        nome = c["nome"]
        expected = c["horas_semanais"] * 60

        # Soma via horas_por_dia
        if nome in horas_por_dia:
            total_hpd = sum(horas_por_dia[nome].values())
        else:
            total_hpd = None

        # Soma via horas_semanais_verificacao
        total_verif = horas_verificacao.get(nome)

        # Soma via alocacoes_por_dia
        total_alloc = 0
        for day_allocs in gt.get("alocacoes_por_dia", {}).values():
            if nome in day_allocs:
                total_alloc += day_allocs[nome].get("minutos", 0)

        # Cross-check: horas_por_dia == horas_semanais_verificacao
        if total_hpd is not None and total_verif is not None:
            if total_hpd != total_verif:
                result.error(
                    f"V2: {nome}: horas_por_dia soma={total_hpd}min != "
                    f"horas_semanais_verificacao={total_verif}min"
                )

        # Cross-check: horas_por_dia == soma alocacoes
        if total_hpd is not None and total_alloc > 0:
            if total_hpd != total_alloc:
                result.error(
                    f"V2: {nome}: horas_por_dia soma={total_hpd}min != "
                    f"soma alocacoes={total_alloc}min"
                )

        # Check vs contrato
        actual = total_hpd if total_hpd is not None else total_alloc
        diff = abs(actual - expected)
        if diff > tolerancia:
            result.error(
                f"V2: {nome}: total semanal {actual}min, contrato {expected}min, "
                f"diferenca {diff}min excede tolerancia {tolerancia}min"
            )
        elif diff > 0:
            result.note(
                f"V2: {nome}: total semanal {actual}min, contrato {expected}min, "
                f"diferenca {diff}min (dentro da tolerancia)"
            )
        else:
            result.note(f"V2: {nome}: total semanal {actual}min = contrato {expected}min (exato)")

    # ------------------------------------------------------------------
    # V3: Maximo diario nao excedido
    # ------------------------------------------------------------------
    for day, day_allocs in gt.get("alocacoes_por_dia", {}).items():
        for nome, alloc in day_allocs.items():
            if nome not in colab_map:
                continue
            max_daily = colab_map[nome]["max_minutos_dia"]
            minutos = alloc.get("minutos", 0)
            if minutos > max_daily:
                result.error(
                    f"V3: {nome} {day}: {minutos}min > max diario {max_daily}min"
                )

    # ------------------------------------------------------------------
    # V4: Almoco obrigatorio para jornadas > 6h (360min)
    # ------------------------------------------------------------------
    for day, day_allocs in gt.get("alocacoes_por_dia", {}).items():
        for nome, alloc in day_allocs.items():
            minutos = alloc.get("minutos", 0)
            inicio = alloc.get("inicio")
            fim = alloc.get("fim")
            almoco = alloc.get("almoco")

            if not inicio or not fim:
                continue

            # Jornada bruta (inicio a fim, sem descontar almoco)
            jornada_bruta = time_to_min(fim) - time_to_min(inicio)

            if jornada_bruta > 360 and not almoco:
                result.warn(
                    f"V4: {nome} {day}: jornada bruta {jornada_bruta}min (>6h) sem almoco registrado"
                )

            # Almoco minimo
            if almoco:
                parts = almoco.split("-")
                almoco_dur = time_to_min(parts[1].strip()) - time_to_min(parts[0].strip())
                min_almoco = empresa.get("min_intervalo_almoco_min", 60)
                usa_reduzido = empresa.get("usa_cct_intervalo_reduzido", False)
                min_legal = 30 if usa_reduzido else min_almoco

                if almoco_dur < min_legal:
                    result.error(
                        f"V4: {nome} {day}: almoco {almoco_dur}min < minimo {min_legal}min"
                    )

                if almoco_dur > 120:
                    result.warn(
                        f"V4: {nome} {day}: almoco {almoco_dur}min > 2h (CLT Art. 71)"
                    )

    # ------------------------------------------------------------------
    # V5: Inicio < Fim
    # ------------------------------------------------------------------
    for day, day_allocs in gt.get("alocacoes_por_dia", {}).items():
        for nome, alloc in day_allocs.items():
            inicio = alloc.get("inicio")
            fim = alloc.get("fim")
            if inicio and fim:
                if time_to_min(inicio) >= time_to_min(fim):
                    result.error(
                        f"V5: {nome} {day}: inicio {inicio} >= fim {fim}"
                    )

    # ------------------------------------------------------------------
    # V6: Minutos declarados == minutos calculados
    # ------------------------------------------------------------------
    for day, day_allocs in gt.get("alocacoes_por_dia", {}).items():
        for nome, alloc in day_allocs.items():
            declared = alloc.get("minutos", 0)
            if not alloc.get("inicio") or not alloc.get("fim"):
                continue

            calculated = len(slots_from_alloc(alloc)) * 30

            if declared != calculated:
                result.error(
                    f"V6: {nome} {day}: minutos declarados={declared} != "
                    f"calculados={calculated} (via slots)"
                )

    # ------------------------------------------------------------------
    # V7: Horarios dentro do funcionamento do setor
    # ------------------------------------------------------------------
    hora_abertura = time_to_min(empresa.get("hora_abertura", meta.get("hora_abertura", "00:00")))
    hora_fechamento = time_to_min(empresa.get("hora_fechamento", meta.get("hora_fechamento", "23:59")))

    for day, day_allocs in gt.get("alocacoes_por_dia", {}).items():
        for nome, alloc in day_allocs.items():
            inicio = alloc.get("inicio")
            fim = alloc.get("fim")
            if not inicio or not fim:
                continue

            if time_to_min(inicio) < hora_abertura:
                result.warn(
                    f"V7: {nome} {day}: inicio {inicio} antes da abertura "
                    f"{min_to_time(hora_abertura)}"
                )
            if time_to_min(fim) > hora_fechamento:
                result.warn(
                    f"V7: {nome} {day}: fim {fim} apos fechamento "
                    f"{min_to_time(hora_fechamento)}"
                )

    # ------------------------------------------------------------------
    # V8: Cobertura de demanda (informativo, nao erro)
    # ------------------------------------------------------------------
    if demanda:
        days = sorted(gt.get("alocacoes_por_dia", {}).keys())
        deficit_count = 0
        total_slots = 0

        for demand_entry in demanda:
            slot_start = time_to_min(demand_entry["hora_inicio"])
            target = demand_entry["min_pessoas"]

            for day in days:
                day_allocs = gt.get("alocacoes_por_dia", {}).get(day, {})
                count = 0
                for nome, alloc in day_allocs.items():
                    if slot_start in slots_from_alloc(alloc):
                        count += 1

                total_slots += 1
                if count < target:
                    deficit_count += 1
                    result.note(
                        f"V8: Demanda {demand_entry['hora_inicio']}-{demand_entry['hora_fim']} "
                        f"{day}: {count}/{target} pessoas"
                    )

        if deficit_count > 0:
            result.warn(
                f"V8: GT nao atinge demanda em {deficit_count}/{total_slots} slot-dias "
                f"({deficit_count / total_slots * 100:.1f}%)"
            )
        else:
            result.note(f"V8: GT atinge 100% da demanda ({total_slots} slot-dias)")

    # ------------------------------------------------------------------
    # V9: Dias no periodo correto
    # ------------------------------------------------------------------
    periodo = meta.get("periodo", {})
    if periodo:
        expected_start = periodo.get("inicio")
        expected_end = periodo.get("fim")
        alloc_days = sorted(gt.get("alocacoes_por_dia", {}).keys())

        if alloc_days:
            if alloc_days[0] != expected_start:
                result.warn(
                    f"V9: Primeiro dia no GT ({alloc_days[0]}) != periodo.inicio ({expected_start})"
                )
            if alloc_days[-1] != expected_end:
                result.warn(
                    f"V9: Ultimo dia no GT ({alloc_days[-1]}) != periodo.fim ({expected_end})"
                )

    # ------------------------------------------------------------------
    # V10: Horas_por_dia consistente com alocacoes_por_dia
    # ------------------------------------------------------------------
    day_labels_map = {
        "2026-02-09": "SEG",
        "2026-02-10": "TER",
        "2026-02-11": "QUA",
        "2026-02-12": "QUI",
        "2026-02-13": "SEX",
        "2026-02-14": "SAB",
    }

    for nome in horas_por_dia:
        for day, day_allocs in gt.get("alocacoes_por_dia", {}).items():
            label = day_labels_map.get(day, day)
            if nome in day_allocs:
                alloc_mins = day_allocs[nome].get("minutos", 0)
                hpd_mins = horas_por_dia.get(nome, {}).get(label, 0)
                if alloc_mins != hpd_mins:
                    result.error(
                        f"V10: {nome} {day} ({label}): alocacao={alloc_mins}min != "
                        f"horas_por_dia={hpd_mins}min"
                    )

    return result


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    base = Path(__file__).parent.parent
    fixture_path = base / "fixture" / "caixa_rita.json"

    if not fixture_path.exists():
        print(f"ERRO: Fixture nao encontrado em {fixture_path}")
        sys.exit(1)

    with open(fixture_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    print(f"Validando fixture: {fixture_path}")
    print(f"  Setor: {data['metadata']['setor']}")
    print(f"  Periodo: {data['metadata']['periodo']['inicio']} a {data['metadata']['periodo']['fim']}")
    print(f"  Colaboradores: {len(data['colaboradores'])}")
    print()

    result = validate_fixture(data)

    # Print results
    print(f"{'=' * 60}")
    print(f"RESULTADO: {result.summary()}")
    print(f"{'=' * 60}")
    print()

    if result.errors:
        print("ERROS:")
        for e in result.errors:
            print(f"  [X] {e}")
        print()

    if result.warnings:
        print("AVISOS:")
        for w in result.warnings:
            print(f"  [!] {w}")
        print()

    if result.info:
        print("NOTAS:")
        for n in result.info:
            print(f"  [i] {n}")
        print()

    if result.ok:
        print("FIXTURE VALIDO")
    else:
        print("FIXTURE COM ERROS — corrigir antes de usar como ground truth")

    return 0 if result.ok else 1


if __name__ == "__main__":
    sys.exit(main())
