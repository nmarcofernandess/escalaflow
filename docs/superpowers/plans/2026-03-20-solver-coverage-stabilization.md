# Solver Coverage Stabilization — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace fixed time budgets with coverage-based stabilization — the solver stops when coverage stops improving, not when a timer expires.

**Architecture:** Add a `CpSolverSolutionCallback` that computes coverage % at each solution and calls `stop_search()` after N seconds without coverage improvement. Remove `_run_with_continuation` and budget division. `solve_mode` becomes a patience override instead of a budget selector.

**Tech Stack:** Python OR-Tools CP-SAT, `CpSolverSolutionCallback`

---

## Context: What We Proved Empirically

Benchmarks on real data (4 people × 7 days, 4 people × 42 days):

1. **INFEASIBLE detection is instant** (<1s) — passes that fail waste no time
2. **Gap is useless** — stays at 90%+ for real problems, never reaches target
3. **Objective improves 233× in 180s** but coverage improves ~15-20× — most improvements are cosmetic
4. **Stabilization is visible** — 7-day problem: 31s dead zone at end. 42-day: intervals grow from 0.1s to 13s
5. **Patience only runs on the successful pass** — failed passes are binary (instant INFEASIBLE)
6. **Budget division (50/30/20) is wasted** — most time goes to continuation retries that rebuild the model from scratch

```
# Empirical findings (2026-03-20 benchmarks):
# - 4 people × 7 days (1344 vars): 28 solutions in 120s, gap stuck at 15%
# - 4 people × 42 days (8064 vars): 233 solutions in 180s, gap stuck at 90%
# - Coverage improves ~15-20x vs objective improving 233x
# - Patience 30s catches all meaningful improvements
# - INFEASIBLE detection is instant (<1s) — no time wasted on failed passes
```

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `solver/solver_ortools.py` | Modify | Callback class, refactor `_solve_pass` + `solve()` atomically, update `MODE_PROFILES` |
| `solver/test_stabilization.py` | Create | Unit tests + integration tests |
| `scripts/solver-cli.ts` | Modify | Default period → 3 meses, display patience em vez de budget |
| `scripts/test-solver-real.ts` | Modify | Default period → 3 meses |
| `src/main/motor/solver-bridge.ts` | No changes | `solve_mode` continua passando no JSON — Python interpreta diferente |

**NOT touched:** `constraints.py`, `build_model()` internals, `extract_solution()`, JSON interface structure.

**Standard test period:** TODOS os testes usam 3 meses (mínimo real do RH). Período padrão: `2026-03-02` a `2026-05-31`. Nenhum teste com 1 semana ou 4 semanas — isso não reflete uso real.

---

### Task 1: CoverageStabilizationCallback class + helpers

**Files:**
- Create: `solver/test_stabilization.py`
- Modify: `solver/solver_ortools.py` (add class after line ~92, after constants)

The callback computes coverage at each new solution. If coverage hasn't improved in `patience_s` seconds, it stops the search. Timer resets on every coverage improvement.

- [ ] **Step 1: Write the test file with callback unit tests**

```python
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
    """When deficit_vars is empty (S_DEFICIT=OFF), callback still works.
    Coverage reads 100% instantly, patience runs, solver stops normally."""
    cb = CoverageStabilizationCallback(
        deficit_vars={},
        total_demand_slots=0,  # signals 'no deficit tracking'
        patience_s=30.0,
    )
    # With total_demand=0, coverage will be 100% always.
    # This is correct — if there's no demand to track, coverage is vacuously 100%.
    assert cb.patience_s == 30.0
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/marcofernandes/escalaflow && python3 -m pytest solver/test_stabilization.py -v`
Expected: FAIL — `CoverageStabilizationCallback`, `compute_coverage_from_deficit`, `PATIENCE_BY_MODE` don't exist yet.

- [ ] **Step 3: Implement callback, helpers, and update MODE_PROFILES**

Add to `solver/solver_ortools.py` after `HARD_TIME_CAP_SECONDS` (line ~92):

```python
# ── Patience-based stabilization (replaces fixed budgets) ──────────────

PATIENCE_BY_MODE = {
    "rapido":     15,   # 15s without coverage improvement → stop
    "balanceado": 30,   # 30s — default
    "otimizado":  60,   # 60s — patient
    "maximo":     120,  # 120s — very patient
}


def compute_coverage_from_deficit(deficit_sum: int, total_demand: int) -> float:
    """Coverage %: (total - deficit) / total * 100."""
    if total_demand <= 0:
        return 100.0
    return round((total_demand - deficit_sum) / total_demand * 100, 1)


class CoverageStabilizationCallback(cp_model.CpSolverSolutionCallback):
    """Stops search when coverage % stabilizes (no improvement in patience_s seconds).

    On each new solution:
    1. Compute coverage from deficit variables
    2. If coverage improved → reset patience timer, log progress
    3. If patience exceeded → stop_search()

    Also stops immediately on OPTIMAL (gap=0).
    """

    def __init__(
        self,
        deficit_vars: Dict[Tuple[int, int], cp_model.IntVar],
        total_demand_slots: int,
        patience_s: float = 30.0,
    ):
        super().__init__()
        self.deficit_vars = deficit_vars
        self.total_demand_slots = total_demand_slots
        self.patience_s = patience_s

        # State
        self.best_coverage = 0.0
        self.best_objective = float("inf")
        self.last_coverage_improvement_time = 0.0
        self.first_solution_time: float | None = None
        self.stabilized_time: float | None = None
        self.solutions_found = 0
        self.coverage_history: list[tuple[float, float]] = []  # [(time, coverage)]

    def on_solution_callback(self):
        self.solutions_found += 1
        now = self.wall_time()

        if self.first_solution_time is None:
            self.first_solution_time = now
            self.last_coverage_improvement_time = now

        # Compute coverage from deficit vars
        deficit_sum = sum(
            self.Value(dv) for dv in self.deficit_vars.values()
        )
        coverage = compute_coverage_from_deficit(deficit_sum, self.total_demand_slots)
        self.coverage_history.append((now, coverage))

        obj = self.ObjectiveValue()

        # Coverage improved? → reset timer
        if coverage > self.best_coverage:
            self.best_coverage = coverage
            self.last_coverage_improvement_time = now
            log(f"[COBERTURA] {coverage}% (obj={obj:.0f}) em {now:.1f}s")

        self.best_objective = min(self.best_objective, obj)

        # Check patience: no coverage improvement in patience_s seconds
        since_last = now - self.last_coverage_improvement_time
        if since_last >= self.patience_s:
            self.stabilized_time = now
            log(f"[ESTABILIZOU] Cobertura {self.best_coverage}% estavel ha {since_last:.0f}s — parando busca")
            self.StopSearch()

    def get_diagnostics(self) -> dict:
        """Return timing/coverage diagnostics for the result."""
        return {
            "first_solution_s": round(self.first_solution_time, 1) if self.first_solution_time else None,
            "stabilized_s": round(self.stabilized_time, 1) if self.stabilized_time else None,
            "solutions_found": self.solutions_found,
            "final_coverage": self.best_coverage,
            "patience_s": self.patience_s,
            "coverage_improvements": sum(
                1 for i in range(1, len(self.coverage_history))
                if self.coverage_history[i][1] > self.coverage_history[i - 1][1]
            ),
        }
```

Also update `MODE_PROFILES` (line ~81) — **replace** the existing dict:

```python
MODE_PROFILES = {
    "rapido":     {"patience_s": 15},
    "balanceado": {"patience_s": 30},
    "otimizado":  {"patience_s": 60},
    "maximo":     {"patience_s": 120},
}
```

**IMPORTANT API note:** The callback uses `self.Value(dv)` (capital V), `self.ObjectiveValue()` (method call), and `self.StopSearch()` (capital S). These are the correct OR-Tools CP-SAT Python API method names.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/marcofernandes/escalaflow && python3 -m pytest solver/test_stabilization.py -v`
Expected: all 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add solver/solver_ortools.py solver/test_stabilization.py
git commit -m "feat(solver): add CoverageStabilizationCallback and update MODE_PROFILES

Replace budget-based MODE_PROFILES with patience-based.
Add PATIENCE_BY_MODE, compute_coverage_from_deficit helper,
and CoverageStabilizationCallback that stops search when
coverage stabilizes."
```

---

### Task 2: Refactor `_solve_pass` + `solve()` atomically

**Files:**
- Modify: `solver/solver_ortools.py` — `_solve_pass` (lines 1506-1593) + `solve()` (lines 1606-1995)
- Modify: `solver/test_stabilization.py` — add integration test

**CRITICAL:** `_solve_pass` signature change and `_run_with_continuation` removal MUST happen in the same commit. Otherwise the code is broken between commits.

This task has sub-steps that must all be applied before testing.

- [ ] **Step 1: Write integration test**

Add to `solver/test_stabilization.py`:

```python
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

    data["config"]["solve_mode"] = "rapido"  # patience=15s
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
    assert "patience_s" in stab

    # No more budget-based fields
    assert "pass_time_cap" not in diag


def test_solve_hard_cap_unchanged():
    """HARD_TIME_CAP_SECONDS is still 3600."""
    from solver_ortools import HARD_TIME_CAP_SECONDS
    assert HARD_TIME_CAP_SECONDS == 3600
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/marcofernandes/escalaflow && python3 -m pytest solver/test_stabilization.py::test_solve_uses_stabilization -v`
Expected: FAIL — `stabilization` key not in diagnostico yet.

- [ ] **Step 3a: Modify `_solve_pass` signature and body**

Replace the `_solve_pass` function (lines 1506-1593). Key changes:
- Remove `gap_limit` parameter, add `patience_s` parameter
- Create `CoverageStabilizationCallback` with `deficit` and `total_demand_slots` from `build_model`
- Pass callback to `solver.solve(model, cb)`
- Remove `solver.parameters.relative_gap_limit`
- Inject `cb.get_diagnostics()` into result

```python
def _solve_pass(
    data: dict,
    pass_num: int | str,
    relaxations: List[str],
    max_time: float,
    patience_s: float,
    num_workers: int,
    pinned_folga: Dict[Tuple[int, int], int] | None = None,
) -> dict:
    """Execute a single solve pass with coverage-based stabilization.

    The solver runs until:
    1. OPTIMAL reached → immediate return
    2. Coverage stabilizes (no improvement in patience_s seconds) → stop
    3. max_time exceeded → safety net stop
    """
    config = data.get("config", {})

    log(f"Passo {pass_num}: patience {patience_s:.0f}s, cap {max_time:.0f}s...")

    (
        model, work, works_day, block_starts, colabs_list, days,
        C, D, S, demand_by_slot, override_by_slot,
        deficit, surplus, weekly_minutes, ap1_excess, base_h, grid_min,
    ) = build_model(data, relaxations=relaxations, pinned_folga=pinned_folga)

    total_demand_slots = sum(demand_by_slot.values())

    cb = CoverageStabilizationCallback(
        deficit_vars=deficit,
        total_demand_slots=total_demand_slots,
        patience_s=patience_s,
    )

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = max_time
    solver.parameters.num_workers = num_workers
    solver.parameters.log_search_progress = True
    solver.parameters.log_to_stdout = False
    # No relative_gap_limit — callback controls stopping via coverage

    t0 = time.time()
    status = solver.solve(model, cb)
    solve_time_ms = (time.time() - t0) * 1000

    result = extract_solution(
        solver, work, colabs_list, days, C, D, S,
        demand_by_slot, override_by_slot, deficit, surplus,
        weekly_minutes, ap1_excess, status, solve_time_ms,
        base_h, grid_min,
        rules=config.get("rules", {}),
        generation_mode=config.get("generation_mode", "OFFICIAL"),
        policy_adjustments=config.get("policy_adjustments", []),
    )

    # Attach stabilization diagnostics
    result["_stabilization"] = cb.get_diagnostics()

    status_label = result.get('status', 'UNKNOWN')
    cob = result.get('indicadores', {}).get('cobertura_percent', '?')
    t_s = solve_time_ms / 1000
    stopped_by = "estabilizacao" if cb.stabilized_time else ("optimal" if status_label == "OPTIMAL" else "timeout")
    if status_label == 'INFEASIBLE':
        log(f"Passo {pass_num}: impossivel encontrar solucao em {t_s:.1f}s")
    elif status_label in ('OPTIMAL', 'FEASIBLE'):
        qual = 'otima' if status_label == 'OPTIMAL' else 'viavel'
        log(f"Passo {pass_num}: solucao {qual} em {t_s:.1f}s — cobertura {cob}% ({stopped_by})")
    else:
        log(f"Passo {pass_num}: {status_label} em {t_s:.1f}s — cobertura {cob}%")

    return result
```

- [ ] **Step 3b: Delete unused top-level helpers**

Delete these two **top-level** functions (lines 1596-1603):
- `_get_coverage` (lines 1596-1598) — no longer used
- `_coverage_is_viable` (lines 1601-1603) — no longer used

**NOTE:** `_run_with_continuation` is a **nested closure inside `solve()`** (lines 1671-1740), NOT a top-level function. It is removed as part of Step 3c below (inside the `solve()` body refactor). Do NOT try to delete it as a standalone function.

- [ ] **Step 3c: Refactor `solve()` pass orchestration**

In the `solve()` function, make these changes:

**Replace budget setup** (lines 1637-1649). Change from:
```python
profile = MODE_PROFILES.get(solve_mode, MODE_PROFILES["rapido"])
total_budget = config.get("max_time_seconds", profile["budget"])
gap_limit = profile["gap"]
pass1_time = max(10, total_budget * 0.5)
pass2_time = max(10, total_budget * 0.3)
pass3_time = max(10, total_budget * 0.2)
```
To:
```python
profile = MODE_PROFILES.get(solve_mode, MODE_PROFILES["rapido"])
patience_s = profile["patience_s"]
hard_cap = config.get("max_time_seconds", HARD_TIME_CAP_SECONDS)
```

**Delete `pass_time_cap`** (line 1669) and the nested `_run_with_continuation` closure (lines 1671-1740). Both live inside `solve()` body:
```python
# DELETE line 1669:
pass_time_cap = total_budget * 2

# DELETE lines 1671-1740: the entire nested def _run_with_continuation(...)
```

**Add remaining_time helper** after `t_global_start` (line 1652):
```python
def remaining_time() -> float:
    return max(5, hard_cap - (time.time() - t_global_start))
```

**Update Phase 1 budget** (line 1774). Change from:
```python
phase1_budget = min(15, total_budget * 0.15)
```
To:
```python
phase1_budget = 15  # Phase 1 is lightweight, fixed cap
```

**Replace ALL `_run_with_continuation` calls with direct `_solve_pass` calls.**

There are 4 call sites. For each one, change from:
```python
result = _run_with_continuation(
    pass_num=N, relaxations=[...], initial_time=passN_time, pass_gap=gap_limit,
    pinned_folga=...,
)
```
To:
```python
result = _solve_pass(
    data, pass_num=N, relaxations=[...],
    max_time=remaining_time(), patience_s=patience_s,
    num_workers=num_workers, pinned_folga=...,
)
```

The 4 call sites are:
1. **Pass 1** (~line 1856): `pass_num=1, relaxations=[], pinned_folga=pinned_folga`
2. **Pass 1b** (~line 1896): `pass_num="1b", relaxations=pass1b_relaxations, pinned_folga=folga_only_pins`
3. **Pass 2** (~line 1925): `pass_num=2, relaxations=pass2_relaxations, pinned_folga=None`
4. **Pass 3** (~line 1951): `pass_num=3, relaxations=pass3_relaxations, pinned_folga=None`

**For each pass's diagnostic assembly**, add stabilization propagation. Place this line **immediately before** `result["diagnostico"] = diag` at each of the 4 pass sites:
```python
if "_stabilization" in result:
    diag["stabilization"] = result.pop("_stabilization")
result["diagnostico"] = diag  # existing line — stabilization goes BEFORE this
```

**Update the log message** at line 1655. Change from:
```python
log(f"Montando modelo: {len(colabs)} colaboradores, {n_dias} dias, modo {solve_mode}")
```
To:
```python
log(f"Montando modelo: {len(colabs)} colaboradores, {n_dias} dias, patience {patience_s}s ({solve_mode})")
```

- [ ] **Step 4: Run ALL tests**

Run: `cd /Users/marcofernandes/escalaflow && python3 -m pytest solver/test_stabilization.py -v`
Expected: all tests PASS.

Then smoke test with solver CLI (3-month default):
Run: `cd /Users/marcofernandes/escalaflow && npm run solver:cli -- 3 --mode rapido --summary 2>&1 | tail -30`
Expected: solver produces valid result with 3-month period. Check that `diagnostico` contains `stabilization` field.

- [ ] **Step 5: Commit**

```bash
git add solver/solver_ortools.py solver/test_stabilization.py
git commit -m "feat(solver): replace fixed budgets with coverage stabilization

BREAKING: _solve_pass signature changes (gap_limit → patience_s).
Remove _run_with_continuation, budget division (50/30/20), and gap_limit.
Each pass runs until coverage stabilizes or hard cap.
solve_mode now controls patience (15s-120s) instead of budget (120s-1800s).
Stabilization diagnostics added to result."
```

---

### Task 3: CLI + test scripts — período padrão 3 meses + display patience

**Files:**
- Modify: `scripts/solver-cli.ts` (lines 62-73, 75-82, 126, 191)
- Modify: `scripts/test-solver-real.ts` (lines 20-22)

O RH gera escalas de 3 meses no mínimo. Todos os defaults e testes devem refletir isso.

- [ ] **Step 1: Update `scripts/solver-cli.ts` — default period 3 months**

Change the default period calculation (lines 62-73). From:
```typescript
const dataInicio = positional[1] ?? (() => {
  // Próxima segunda
  const d = new Date()
  d.setDate(d.getDate() + ((1 + 7 - d.getDay()) % 7 || 7))
  return d.toISOString().slice(0, 10)
})()
const dataFim = positional[2] ?? (() => {
  // 1 semana depois do inicio (domingo)
  const d = new Date(dataInicio)
  d.setDate(d.getDate() + 6)
  return d.toISOString().slice(0, 10)
})()
```
To:
```typescript
const dataInicio = positional[1] ?? (() => {
  // Próxima segunda
  const d = new Date()
  d.setDate(d.getDate() + ((1 + 7 - d.getDay()) % 7 || 7))
  return d.toISOString().slice(0, 10)
})()
const dataFim = positional[2] ?? (() => {
  // 3 meses depois do inicio (período real do RH)
  const d = new Date(dataInicio)
  d.setMonth(d.getMonth() + 3)
  d.setDate(d.getDate() - 1) // último dia do período
  return d.toISOString().slice(0, 10)
})()
```

- [ ] **Step 2: Update CLI display — show patience instead of mode budget**

Change the display line (line 191). From:
```typescript
console.log(`  ${C.bold}Modo:${C.reset}    ${solveMode}`)
```
To:
```typescript
const PATIENCE_LABEL: Record<string, string> = {
  rapido: '15s', balanceado: '30s', otimizado: '60s', maximo: '120s'
}
console.log(`  ${C.bold}Modo:${C.reset}    ${solveMode} (patience ${PATIENCE_LABEL[solveMode] ?? '30s'})`)
```

- [ ] **Step 3: Update CLI help text and doc header**

Update the header comment (lines 6-11) and help examples (lines 126, 132-136) to reflect 3-month default and patience semantics:

```typescript
// Line 6:
// *   npm run solver:cli -- <setor_id> [data_inicio] [data_fim] [--mode rapido|otimizado] [--json] [--summary] [--dump]
// Line 9:
// *   npm run solver:cli -- 2                          # Açougue, 3 meses (padrão)
// Line 11:
// *   npm run solver:cli -- 1 2026-03-02 2026-05-31 --mode otimizado  # Caixa, 3 meses
// Help text line 126:
//   --mode rapido|balanceado|otimizado|maximo   Patience do solver (default: rapido=15s)
// Help example line 133:
//   npm run solver:cli -- 2                          # Açougue, 3 meses
```

- [ ] **Step 4: Update `scripts/test-solver-real.ts` — default period 3 months**

Change lines 20-21. From:
```typescript
const dataInicio = args[1] ?? '2026-03-02'
const dataFim = args[2] ?? '2026-04-26'
```
To:
```typescript
const dataInicio = args[1] ?? '2026-03-02'
const dataFim = args[2] ?? '2026-05-31'
```

- [ ] **Step 5: Update integration test period in `solver/test_stabilization.py`**

In the `test_solve_uses_stabilization` test (Task 2 Step 1), the test loads `tmp/solver-input-setor-3.json`. After this change, the dump will be 3 months by default. No code change needed — just regenerate the dump:

```bash
npm run solver:cli -- 3 --dump 2>&1 | tail -3
```

This creates a fresh 3-month dump that all tests will use.

- [ ] **Step 6: Commit**

```bash
git add scripts/solver-cli.ts scripts/test-solver-real.ts
git commit -m "chore: default period 3 months in CLI and tests

RH generates 3-month schedules minimum. All dev tooling
reflects real usage. CLI shows patience instead of budget."
```

---

### Task 4: Benchmark validation (3 meses)

**Files:**
- No code changes — validation only

Run the solver on real data with 3-month periods and verify behavior.

- [ ] **Step 1: Run Rotisseria 3 months, rapido (patience 15s)**

```bash
npm run solver:cli -- 3 --mode rapido --summary
```

Expected: default period is now 3 months. Solver finds solution, coverage stabilizes, stops. Check `diagnostico.stabilization` exists.

- [ ] **Step 2: Run Rotisseria 3 months, balanceado (patience 30s)**

```bash
npm run solver:cli -- 3 --mode balanceado --summary
```

Expected: runs longer than rapido. `stabilization.stabilized_s` shows when coverage plateau was hit.

- [ ] **Step 3: Run Caixa 3 months, rapido**

```bash
npm run solver:cli -- 1 --mode rapido --summary
```

Expected: different setor, same period. Verifies callback works across different team sizes and demand patterns.

- [ ] **Step 4: Verify solver:test:real passes with 3-month period**

```bash
npm run solver:test:real 2>&1 | tail -20
```

**Note:** Requires PGlite database (`out/data/escalaflow-pg`). The test now runs 3 months by default.

- [ ] **Step 5: Commit tuning if needed**

If patience values need adjustment based on 3-month benchmarks:

```bash
git add solver/solver_ortools.py
git commit -m "chore(solver): tune patience values for 3-month periods"
```

---

### Task 5: Update CLAUDE.md — solver docs reflect new behavior

**Files:**
- Modify: `/Users/marcofernandes/escalaflow/.claude/CLAUDE.md`

- [ ] **Step 1: Update Motor Python section — CLI examples**

In the "CLI do Motor (dev)" section, update the examples to reflect 3-month default period and patience semantics:

```markdown
npm run solver:cli -- list                           # lista setores disponíveis
npm run solver:cli -- 2                              # Açougue (3 meses, patience 15s)
npm run solver:cli -- 2 2026-03-02 2026-05-31        # Açougue, período específico
npm run solver:cli -- 2 --mode otimizado             # patience 60s (mais paciente)
npm run solver:cli -- 2 --mode maximo                # patience 120s (máximo polimento)
npm run solver:cli -- 2 --dump                       # salva input JSON em tmp/ (debug)
npm run solver:cli -- 2 --summary                    # JSON compacto (~1KB)
npm run solver:cli -- 2 --json                       # JSON sem comparacao_demanda (~250KB)
npm run solver:cli -- 2 --json-full                  # JSON completo (~800KB)
```

- [ ] **Step 2: Update Seeds section — suggested period**

In the Seeds section, change:
```
Período sugerido: 2026-03-02 a 2026-04-26
```
To:
```
Período sugerido: 2026-03-02 a 2026-05-31
```

- [ ] **Step 3: Add note about coverage stabilization in Motor section**

After the "Compilar o binário Python" subsection, add a note:

```markdown
### Coverage Stabilization

O solver usa **estabilização de cobertura** em vez de budget fixo por modo. Cada pass roda até a cobertura parar de melhorar (patience timer) ou OPTIMAL. Os modos controlam o patience:

| Modo | Patience | Semântica |
|------|----------|-----------|
| `rapido` | 15s | Para rápido após cobertura estabilizar |
| `balanceado` | 30s | Equilíbrio — padrão |
| `otimizado` | 60s | Espera mais por melhorias |
| `maximo` | 120s | Espreme até o último % |

**INFEASIBLE é instantâneo (<1s).** O patience só roda no pass que encontra solução. Passes que falham não desperdiçam tempo.
```

- [ ] **Step 4: Commit**

```bash
git add .claude/CLAUDE.md
git commit -m "docs: update CLAUDE.md with coverage stabilization and 3-month defaults"
```

---

## Summary of Changes

| Before | After |
|--------|-------|
| `MODE_PROFILES` = `{"budget": N, "gap": G}` | `MODE_PROFILES` = `{"patience_s": N}` |
| `_run_with_continuation` retries 3× with budget doubling | Callback stops when coverage stabilizes |
| Budget divided 50/30/20 between passes | Each pass gets full remaining time (`hard_cap - elapsed`) |
| Gap limit 0.05-0.001 (never reached in practice) | No gap limit — callback controls via coverage |
| FEASIBLE with low coverage → rebuild model and retry | FEASIBLE → keep running same solve, callback monitors |
| `solve_mode` = "how much time to give" | `solve_mode` = "how patient to wait for improvements" |

## What's NOT changed

- `build_model()` — untouched
- `extract_solution()` — untouched
- `constraints.py` — untouched
- Multi-pass structure (1 → 1b → 2 → 3) — same degradation logic
- `solve_folga_pattern()` (Phase 1) — untouched, keeps 15s fixed cap
- JSON interface (in/out) — backward compatible (new `stabilization` field is additive)
- `HARD_TIME_CAP_SECONDS = 3600` — untouched
- Bridge `solver-bridge.ts` — no changes required
- `max_time_seconds` override — still works as hard cap for the entire solve
- `advisory_only` mode — untouched

## Edge Cases

| Case | Behavior |
|------|----------|
| `S_DEFICIT='OFF'` (deficit vars empty) | `total_demand_slots=0` → coverage always 100% → patience timer runs normally, solver stops after patience_s. Functionally equivalent to old behavior. |
| `max_time_seconds` override in input | Used as `hard_cap` for the entire solve. Each pass gets `remaining_time()`. Patience still controls within that cap. |
| OPTIMAL reached before patience | Solver stops immediately (OR-Tools native behavior). `stabilization.stabilized_s` is None. |
| All passes INFEASIBLE | Same as before — instant (<1s each), returns error dict. Callback never fires. |
