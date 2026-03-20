# solver/test_stabilization.py
"""Tests for CoverageStabilizationCallback and coverage stabilization."""
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).parent))

from solver_ortools import (
    CoverageStabilizationCallback,
    compute_coverage_from_deficit,
    PATIENCE_BY_MODE,
    MODE_PROFILES,
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


def test_patience_by_mode():
    """solve_mode maps to patience values."""
    assert PATIENCE_BY_MODE["rapido"] == 15
    assert PATIENCE_BY_MODE["balanceado"] == 30
    assert PATIENCE_BY_MODE["otimizado"] == 60
    assert PATIENCE_BY_MODE["maximo"] == 120


def test_mode_profiles_use_patience():
    """MODE_PROFILES no longer contain budget/gap, only patience_s."""
    for mode, profile in MODE_PROFILES.items():
        assert "budget" not in profile, f"{mode} still has 'budget'"
        assert "gap" not in profile, f"{mode} still has 'gap'"
        assert "patience_s" in profile, f"{mode} missing 'patience_s'"


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
