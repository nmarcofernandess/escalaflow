# solver/test_stabilization.py
"""Tests for CoverageStabilizationCallback and coverage stabilization."""
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).parent))

from solver_ortools import (
    CoverageStabilizationCallback,
    compute_coverage_from_deficit,
    DEFAULT_PATIENCE_S,
)


def test_callback_init():
    """Callback initializes with correct defaults."""
    cb = CoverageStabilizationCallback(
        deficit_vars={},
        total_demand_slots=100,
        patience_s=30.0,
    )
    assert cb.patience_s == 30.0
    assert cb.best_coverage == 0.0
    assert cb.solutions_found == 0
    assert cb.coverage_history == []


def test_coverage_calculation():
    """Coverage formula: (total - deficit) / total * 100."""
    assert compute_coverage_from_deficit(deficit_sum=0, total_demand=100) == 100.0
    assert compute_coverage_from_deficit(deficit_sum=10, total_demand=100) == 90.0
    assert compute_coverage_from_deficit(deficit_sum=50, total_demand=100) == 50.0
    # Edge case: zero demand → 100% by convention
    assert compute_coverage_from_deficit(deficit_sum=0, total_demand=0) == 100.0
    assert compute_coverage_from_deficit(deficit_sum=5, total_demand=0) == 100.0


def test_default_patience():
    """Single patience value, no modes."""
    assert DEFAULT_PATIENCE_S == 30


def test_callback_diagnostics_empty():
    """get_diagnostics works on fresh callback (no solutions)."""
    cb = CoverageStabilizationCallback(
        deficit_vars={},
        total_demand_slots=0,
        patience_s=30.0,
    )
    diag = cb.get_diagnostics()
    assert diag["first_solution_s"] is None
    assert diag["solutions_found"] == 0
    assert diag["final_coverage"] == 0.0


def test_callback_no_deficit_tracking():
    """When deficit_vars is empty (S_DEFICIT=OFF), callback still works."""
    cb = CoverageStabilizationCallback(
        deficit_vars={},
        total_demand_slots=0,
        patience_s=30.0,
    )
    assert cb.patience_s == 30.0


def test_solve_uses_stabilization():
    """Full solve() uses stabilization callback and returns diagnostics."""
    import json
    from solver_ortools import solve

    try:
        with open("tmp/solver-input-setor-3.json") as f:
            data = json.load(f)
    except FileNotFoundError:
        import pytest
        pytest.skip("No solver input dump — run: npm run solver:cli -- 3 --dump")

    data["config"].pop("max_time_seconds", None)

    result = solve(data)

    assert result.get("sucesso") in (True, False)  # doesn't crash
    diag = result.get("diagnostico", {})

    # Stabilization diagnostics exist
    assert "stabilization" in diag
    stab = diag["stabilization"]
    assert isinstance(stab.get("solutions_found"), int)
    assert isinstance(stab.get("final_coverage"), (int, float))
    assert "first_solution_s" in stab
    assert stab["patience_s"] == 30  # always 30, no modes


def test_solve_hard_cap_unchanged():
    """HARD_TIME_CAP_SECONDS is still 3600."""
    from solver_ortools import HARD_TIME_CAP_SECONDS
    assert HARD_TIME_CAP_SECONDS == 3600


# ---------------------------------------------------------------------------
# Watchdog do platô — o CP-SAT só chama o callback em soluções novas; num
# platô o patience do callback nunca é checado. O watchdog para de fora.
# ---------------------------------------------------------------------------

class _FakeSolver:
    def __init__(self):
        self.stopped = False

    def stop_search(self):
        self.stopped = True


def test_watchdog_stops_on_plateau():
    """Patience estourado sem novas soluções → watchdog chama stop_search."""
    import time
    from solver_ortools import start_patience_watchdog

    cb = CoverageStabilizationCallback(deficit_vars={}, total_demand_slots=0, patience_s=0.2)
    cb.mono_last_improvement = time.monotonic() - 10  # platô antigo
    fake = _FakeSolver()

    stop_evt, thread = start_patience_watchdog(fake, cb, patience_s=0.2, poll_s=0.05)
    thread.join(timeout=2.0)
    stop_evt.set()

    assert fake.stopped is True
    assert cb.stopped_by == "watchdog"


def test_watchdog_idle_before_first_solution():
    """Sem primeira solução (mono_last_improvement=None) o watchdog não age."""
    import time
    from solver_ortools import start_patience_watchdog

    cb = CoverageStabilizationCallback(deficit_vars={}, total_demand_slots=0, patience_s=0.1)
    fake = _FakeSolver()

    stop_evt, thread = start_patience_watchdog(fake, cb, patience_s=0.1, poll_s=0.05)
    time.sleep(0.4)  # bem além do patience
    stop_evt.set()
    thread.join(timeout=2.0)

    assert fake.stopped is False
    assert cb.stopped_by is None


def test_watchdog_respects_recent_improvement():
    """Melhora recente de cobertura → watchdog não dispara dentro do patience."""
    import time
    from solver_ortools import start_patience_watchdog

    cb = CoverageStabilizationCallback(deficit_vars={}, total_demand_slots=0, patience_s=5.0)
    cb.mono_last_improvement = time.monotonic()  # acabou de melhorar
    fake = _FakeSolver()

    stop_evt, thread = start_patience_watchdog(fake, cb, patience_s=5.0, poll_s=0.05)
    time.sleep(0.3)
    stop_evt.set()
    thread.join(timeout=2.0)

    assert fake.stopped is False
    assert cb.stopped_by is None
