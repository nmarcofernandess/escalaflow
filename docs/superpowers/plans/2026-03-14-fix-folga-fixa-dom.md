# Fix folga_fixa=DOM — Logic Bomb Defusal (B1 + B2 + B3)

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a collaborator has `folga_fixa_dia_semana = "DOM"`, the solver, bridge, and TS preview must handle this as a special case — no cycle/XOR/dom_max constraints, clean data, correct preview.

**Architecture:** Three-layer fix: (1) Bridge nulls out cycle data and variable folga before sending to Python; (2) Python constraints skip XOR, cycle, and dom_max for these people; (3) TS preview supports `folga_fixa_dom` flag for correct rendering. Defense-in-depth: both bridge AND solver guard independently.

**Tech Stack:** Python (OR-Tools constraints), TypeScript (Electron main process bridge + shared simula-ciclo), Vitest (tests)

**Context Docs:**
- `docs/ANALYST_PAINEL_UNICO_ESCALA.md` Section 35 — full spec of the logic bomb
- `specs/WARLOG_PAINEL_UNICO.md` — tasks B1, B2, B3 (P0 CRITICAL)
- `docs/MOTOR_V3_RFC.md` — motor architecture reference

**WARLOG ref:** B1, B2, B3 (Dominio B — Logica do Ciclo)

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `solver/constraints.py:963,724,999,1097` | Add folga_fixa=DOM guard to 4 functions |
| Modify | `src/main/motor/solver-bridge.ts:496-502` | Zero cycle, null variable for fixa=DOM people |
| Modify | `src/shared/simula-ciclo.ts:8-29,190-282` | Add `folga_fixa_dom` field + handle in generation |
| Create | `tests/shared/simula-ciclo.spec.ts` | Unit tests for gerarCicloFase1 including DOM case |
| Modify | `specs/STATUS.md` | Update progress after completion |

---

## Chunk 1: Bridge Fix (B2) + Python Guards (B1)

### Task 1: Bridge — zero cycle and null variable for folga_fixa=DOM

**Files:**
- Modify: `src/main/motor/solver-bridge.ts:496-502`

The bridge's `buildSolverInput` applies the ciclo domingo to all non-INTERMITENTE collaborators. People with `folga_fixa_dia_semana === 'DOM'` should get `domingo_ciclo_trabalho=0`, `domingo_ciclo_folga=1`, and `folga_variavel_dia_semana=null` instead of the calculated cycle.

- [ ] **Step 1: Modify the cycle assignment loop in solver-bridge.ts**

In `buildSolverInput`, find the loop at ~line 497 that assigns cycle:

```typescript
// CURRENT (buggy):
for (const c of colaboradores) {
  if (c.tipo_trabalhador !== 'INTERMITENTE') {
    c.domingo_ciclo_trabalho = cicloTrabalho
    c.domingo_ciclo_folga = cicloFolga
  }
}
```

Replace with:

```typescript
for (const c of colaboradores) {
  if (c.tipo_trabalhador === 'INTERMITENTE') continue
  if (c.folga_fixa_dia_semana === 'DOM') {
    c.domingo_ciclo_trabalho = 0
    c.domingo_ciclo_folga = 1
    c.folga_variavel_dia_semana = null
    continue
  }
  c.domingo_ciclo_trabalho = cicloTrabalho
  c.domingo_ciclo_folga = cicloFolga
}
```

**Why null the variable?** The `folga_variavel_dia_semana` was conditional on the Sunday XOR. If the person never works Sunday, the variable loses meaning. Nulling it also makes `add_folga_variavel_condicional` in Python skip via `if not var_day: continue` (defense in depth).

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: 0 errors (the fields are already optional on `SolverInputColab`)

- [ ] **Step 3: Commit**

```bash
git add src/main/motor/solver-bridge.ts
git commit -m "fix(bridge): zero cycle and null variable for folga_fixa=DOM collaborators

People with folga_fixa_dia_semana='DOM' never work Sunday, so:
- domingo_ciclo_trabalho=0, domingo_ciclo_folga=1
- folga_variavel_dia_semana=null (XOR irrelevant)

Ref: ANALYST Section 35, WARLOG B2"
```

---

### Task 2: Python — add folga_fixa=DOM guard to add_folga_variavel_condicional

**Files:**
- Modify: `solver/constraints.py:963`

The XOR constraint `works_day[c, dom] + works_day[c, var] == 1` is emitted for all colabs with a `folga_variavel_dia_semana`. When fixa=DOM, `works_day[c, dom]` is always 0, forcing `works_day[c, var] == 1` — the variable day NEVER gets a folga. This breaks 5x2 (needs 2 folgas/week).

- [ ] **Step 1: Add guard to add_folga_variavel_condicional**

In `solver/constraints.py`, function `add_folga_variavel_condicional`, inside the `for c in range(C):` loop (line 963), add the guard **before** the existing `var_day` check:

```python
    for c in range(C):
        # Guard: folga_fixa=DOM → person never works Sunday, XOR is meaningless
        if colabs[c].get("folga_fixa_dia_semana") == "DOM":
            continue

        var_day = colabs[c].get("folga_variavel_dia_semana")
        if not var_day:
            continue
        # ... rest unchanged
```

This is defense-in-depth: bridge already nulls `folga_variavel`, but if data arrives unclean (e.g., manual JSON test), the guard catches it.

---

### Task 3: Python — add folga_fixa=DOM guard to add_domingo_ciclo_soft

**Files:**
- Modify: `solver/constraints.py:724`

The soft cycle penalizes excess/deficit of Sunday work. For fixa=DOM people, Sunday work is always 0 — any expected > 0 creates phantom deficit penalties.

- [ ] **Step 1: Add guard to add_domingo_ciclo_soft**

In `solver/constraints.py`, function `add_domingo_ciclo_soft`, inside the `for c in range(C):` loop (line 724), add the guard **after** the existing INTERMITENTE check:

```python
    for c in range(C):
        if colabs[c].get("tipo_trabalhador", "CLT") == "INTERMITENTE":
            continue
        # Guard: folga_fixa=DOM → always off Sunday, cycle is N/A
        if colabs[c].get("folga_fixa_dia_semana") == "DOM":
            continue

        N = int(colabs[c].get("domingo_ciclo_trabalho", 2))
        # ... rest unchanged
```

---

### Task 4: Python — add folga_fixa=DOM guard to add_dom_max_consecutivo

**Files:**
- Modify: `solver/constraints.py:999`

The sliding window for max consecutive Sundays. For fixa=DOM, the person works 0 Sundays — the constraint is trivially satisfied but wastes solver variables.

- [ ] **Step 1: Add guard to add_dom_max_consecutivo**

In `solver/constraints.py`, function `add_dom_max_consecutivo`, inside the `for c in range(C):` loop (line 999), add the guard **after** the existing INTERMITENTE check:

```python
    for c in range(C):
        if colabs[c].get("tipo_trabalhador", "CLT") == "INTERMITENTE":
            continue
        # Guard: folga_fixa=DOM → never works Sunday, max consec is trivially 0
        if colabs[c].get("folga_fixa_dia_semana") == "DOM":
            continue

        sexo = colabs[c].get("sexo", "M")
        # ... rest unchanged
```

---

### Task 5: Python — add folga_fixa=DOM guard to add_domingo_ciclo_hard

**Files:**
- Modify: `solver/constraints.py:1097`

Hard version of the cycle constraint. Same issue: forces exactly N Sundays worked in a window, but fixa=DOM person works 0.

- [ ] **Step 1: Add guard to add_domingo_ciclo_hard**

In `solver/constraints.py`, function `add_domingo_ciclo_hard`, inside the `for c in range(C):` loop (line 1097), add the guard **after** the existing INTERMITENTE check:

```python
    for c in range(C):
        if colabs[c].get("tipo_trabalhador", "CLT") == "INTERMITENTE":
            continue
        # Guard: folga_fixa=DOM → never works Sunday, hard cycle N/A
        if colabs[c].get("folga_fixa_dia_semana") == "DOM":
            continue

        N = int(colabs[c].get("domingo_ciclo_trabalho", 2))
        # ... rest unchanged
```

- [ ] **Step 2: Commit all Python changes**

```bash
git add solver/constraints.py
git commit -m "fix(solver): skip XOR, cycle, dom_max constraints for folga_fixa=DOM

4 guards added:
- add_folga_variavel_condicional: skip XOR (would force var always work)
- add_domingo_ciclo_soft: skip penalty (always 0 Sunday work)
- add_dom_max_consecutivo: skip sliding window (trivially 0)
- add_domingo_ciclo_hard: skip exact-N (impossible when always off)

Defense-in-depth with bridge B2 fix.

Ref: ANALYST Section 35, WARLOG B1"
```

---

### Task 6: Run parity test (validates B1 + B2 together)

**Files:**
- Read: `tests/main/solver-cli-parity.spec.ts`

The parity test runs the full solver on Açougue and Rotisseria scenarios, persists results, re-validates with `validarEscalaV3()`, and checks for HARD violation drift. This is the canonical integration test for solver changes.

- [ ] **Step 1: Run the parity test**

Run: `npm run solver:test:parity`
Expected: PASS for both Açougue and Rotisseria scenarios.

**If it fails:** Check stderr for which constraint causes INFEASIBLE or which validation rule detects drift. The most likely failure mode is a regression in the folga pattern — inspect the `diagnostico.regras_relaxadas` in the output.

- [ ] **Step 2: Run rule-policy tests**

Run: `npx vitest run tests/main/rule-policy.spec.ts`
Expected: 3 tests PASS (H10 HARD, harden OK, relax→EXPLORATORY)

- [ ] **Step 3: Run folga-inference tests**

Run: `npx vitest run tests/shared/folga-inference.spec.ts`
Expected: 2 tests PASS (XOR with Sunday, frequency fallback)

---

## Chunk 2: TS Preview Fix (B3) + Tests

### Task 7: Add `folga_fixa_dom` to SimulaCicloFase1Input

**Files:**
- Modify: `src/shared/simula-ciclo.ts:25-29`

The `folgas_forcadas` array uses indices 0-5 (SEG-SAB). When `folga_fixa_dia_semana === 'DOM'`, there's no valid weekday index — DOM is day 6 in the 7-day grid. We need an explicit boolean flag.

- [ ] **Step 1: Extend the folgas_forcadas type**

In `src/shared/simula-ciclo.ts`, find the `folgas_forcadas` field in `SimulaCicloFase1Input` (line ~25):

```typescript
// CURRENT:
folgas_forcadas?: Array<{
  folga_fixa_dia: number | null    // 0-5 (SEG-SAB) ou null
  folga_variavel_dia: number | null
}>
```

Replace with:

```typescript
folgas_forcadas?: Array<{
  folga_fixa_dia: number | null    // 0-5 (SEG-SAB) ou null
  folga_variavel_dia: number | null
  /** Se true, pessoa tem folga fixa no domingo — todos domingos F, fora da rotacao */
  folga_fixa_dom?: boolean
}>
```

---

### Task 8: Write failing test for folga_fixa_dom behavior

**Files:**
- Create: `tests/shared/simula-ciclo.spec.ts`

There are NO existing tests for `gerarCicloFase1`. We create a focused test file that validates the DOM special case and establishes baseline coverage.

- [ ] **Step 1: Write the test file**

Create `tests/shared/simula-ciclo.spec.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { gerarCicloFase1 } from '../../src/shared/simula-ciclo'

describe('gerarCicloFase1', () => {
  it('gera ciclo basico 5 pessoas, K=2', () => {
    const result = gerarCicloFase1({
      num_postos: 5,
      trabalham_domingo: 2,
    })
    expect(result.sucesso).toBe(true)
    expect(result.grid).toHaveLength(5)
    // Every person should have some weeks with data
    for (const row of result.grid) {
      expect(row.semanas.length).toBeGreaterThan(0)
    }
    // No H1 violations (max 6 consecutive)
    expect(result.stats.h1_violacoes).toBe(0)
    // Coverage should be reasonable
    expect(result.stats.cobertura_min).toBeGreaterThan(0)
  })

  it('trata folga_fixa_dom: todos domingos F, nao participa da rotacao', () => {
    // 5 people, K=2, but person 0 has folga_fixa_dom
    const result = gerarCicloFase1({
      num_postos: 5,
      trabalham_domingo: 2,
      folgas_forcadas: [
        { folga_fixa_dia: null, folga_variavel_dia: null, folga_fixa_dom: true },
        { folga_fixa_dia: null, folga_variavel_dia: null },
        { folga_fixa_dia: null, folga_variavel_dia: null },
        { folga_fixa_dia: null, folga_variavel_dia: null },
        { folga_fixa_dia: null, folga_variavel_dia: null },
      ],
    })

    expect(result.sucesso).toBe(true)

    // Person 0 (folga_fixa_dom) must have ALL Sundays as F
    const person0 = result.grid[0]
    for (const semana of person0.semanas) {
      expect(semana.dias[6]).toBe('F') // DOM is index 6
    }

    // Person 0 should still have ~2 folgas per week (DOM + 1 weekday)
    for (const semana of person0.semanas) {
      const folgas = semana.dias.filter(d => d === 'F').length
      expect(folgas).toBeGreaterThanOrEqual(2)
    }

    // Other people should still participate in Sunday rotation normally
    // At least some of persons 1-4 should work some Sundays
    let anyoneWorksSunday = false
    for (let p = 1; p < 5; p++) {
      for (const semana of result.grid[p].semanas) {
        if (semana.dias[6] === 'T') anyoneWorksSunday = true
      }
    }
    expect(anyoneWorksSunday).toBe(true)
  })

  it('H1 nao viola com folga_fixa_dom', () => {
    // Ensure H1 (max 6 consecutive) is not broken by the DOM fix
    const result = gerarCicloFase1({
      num_postos: 4,
      trabalham_domingo: 1,
      folgas_forcadas: [
        { folga_fixa_dia: 2, folga_variavel_dia: null, folga_fixa_dom: true },
        { folga_fixa_dia: null, folga_variavel_dia: null },
        { folga_fixa_dia: null, folga_variavel_dia: null },
        { folga_fixa_dia: null, folga_variavel_dia: null },
      ],
    })

    expect(result.sucesso).toBe(true)
    expect(result.stats.h1_violacoes).toBe(0)

    // Person 0: all Sundays F + weekday 2 (QUA) always F
    const person0 = result.grid[0]
    for (const semana of person0.semanas) {
      expect(semana.dias[6]).toBe('F')
      expect(semana.dias[2]).toBe('F')
    }
  })

  it('K=0 com folga_fixa_dom nao explode', () => {
    // Edge case: nobody works Sunday + someone has fixa_dom
    const result = gerarCicloFase1({
      num_postos: 3,
      trabalham_domingo: 0,
      folgas_forcadas: [
        { folga_fixa_dia: null, folga_variavel_dia: null, folga_fixa_dom: true },
        { folga_fixa_dia: null, folga_variavel_dia: null },
        { folga_fixa_dia: null, folga_variavel_dia: null },
      ],
    })

    expect(result.sucesso).toBe(true)
    // When K=0, everyone is already off Sunday — fixa_dom is redundant but harmless
    for (const row of result.grid) {
      for (const semana of row.semanas) {
        expect(semana.dias[6]).toBe('F')
      }
    }
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/shared/simula-ciclo.spec.ts`
Expected: Test 1 (basic) PASSES, tests 2-4 (folga_fixa_dom) FAIL because the logic isn't implemented yet.

---

### Task 9: Implement folga_fixa_dom logic in gerarCicloFase1

**Files:**
- Modify: `src/shared/simula-ciclo.ts:190-282`

The generation function needs 2 changes:
1. Step 1 (Sundays): force ALL Sundays to F for folga_fixa_dom people
2. Step 2 (weekday folgas): folga_fixa_dom people always have `sundayOff = true` (they always get 1 weekday folga since DOM is already F)

- [ ] **Step 1: Handle folga_fixa_dom in Step 1 (Sundays)**

In `gerarCicloFase1`, after the existing Sunday assignment block (~line 236-264), add a post-processing override:

```typescript
  // --- Step 1 postprocess: folga_fixa_dom overrides — all Sundays F ---
  for (let p = 0; p < N; p++) {
    if (input.folgas_forcadas?.[p]?.folga_fixa_dom) {
      for (let w = 0; w < weeks; w++) {
        grid[p][w * 7 + 6] = 'F'
      }
    }
  }
```

- [ ] **Step 2: Handle folga_fixa_dom in Step 2 (weekday folgas)**

In Step 2 (weekday folgas, ~line 267-282), modify the `sundayOff` check to account for folga_fixa_dom:

Current code:
```typescript
  for (let p = 0; p < N; p++) {
    const forcada = input.folgas_forcadas?.[p]
    const base1 = forcada?.folga_fixa_dia ?? (p % 6)
    const base2 = forcada?.folga_variavel_dia ?? ((p + 3) % 6)
    for (let w = 0; w < weeks; w++) {
      const sundayOff = grid[p][w * 7 + 6] === 'F'
```

Replace with:
```typescript
  for (let p = 0; p < N; p++) {
    const forcada = input.folgas_forcadas?.[p]
    const isFixaDom = forcada?.folga_fixa_dom === true
    const base1 = forcada?.folga_fixa_dia ?? (p % 6)
    // folga_fixa_dom: variable loses meaning, use a second fixed weekday
    const base2 = isFixaDom ? null : (forcada?.folga_variavel_dia ?? ((p + 3) % 6))
    for (let w = 0; w < weeks; w++) {
      const sundayOff = grid[p][w * 7 + 6] === 'F'
```

And in the body of the loop, where it decides how many weekday folgas to assign:

Current code:
```typescript
      if (sundayOff) {
        // Não trabalhou DOM → folga no dia fixo (DOM já é folga = 2 folgas)
        grid[p][w * 7 + base1] = 'F'
      } else {
        // Trabalhou DOM → folga no dia fixo + variável (mesma semana)
        grid[p][w * 7 + base1] = 'F'
        grid[p][w * 7 + base2] = 'F'
      }
```

Replace with:
```typescript
      if (sundayOff) {
        // Não trabalhou DOM → folga no dia fixo (DOM já é folga = 2 folgas)
        grid[p][w * 7 + base1] = 'F'
      } else {
        // Trabalhou DOM → folga no dia fixo + variável (mesma semana)
        grid[p][w * 7 + base1] = 'F'
        if (base2 != null) grid[p][w * 7 + base2] = 'F'
      }
```

**Why this works for folga_fixa_dom:** The person always has `sundayOff = true` (Step 1 postprocess forced all Sundays to F). So they always enter the `sundayOff` branch, getting DOM + 1 weekday folga = 2 folgas/week. The `base2` (variable) is null and never applied. Correct 5x2 behavior.

- [ ] **Step 3: Run tests to verify they pass**

Run: `npx vitest run tests/shared/simula-ciclo.spec.ts`
Expected: All 4 tests PASS

- [ ] **Step 4: Run typecheck**

Run: `npm run typecheck`
Expected: 0 errors

- [ ] **Step 5: Commit**

```bash
git add src/shared/simula-ciclo.ts tests/shared/simula-ciclo.spec.ts
git commit -m "fix(simula-ciclo): handle folga_fixa_dom in preview generation

- Add folga_fixa_dom?: boolean to folgas_forcadas
- Step 1: force all Sundays to F for folga_fixa_dom people
- Step 2: variable folga null (not conditional), 1 weekday folga only
- Add 4 unit tests for gerarCicloFase1 including DOM special case

Ref: ANALYST Section 35, WARLOG B3"
```

---

### Task 10: Final integration validation + STATUS update

- [ ] **Step 1: Run full parity test (integration)**

Run: `npm run solver:test:parity`
Expected: PASS (Açougue + Rotisseria)

- [ ] **Step 2: Run all related tests**

Run: `npx vitest run tests/shared/simula-ciclo.spec.ts tests/shared/folga-inference.spec.ts tests/main/rule-policy.spec.ts`
Expected: All PASS

- [ ] **Step 3: Run full typecheck**

Run: `npm run typecheck`
Expected: 0 errors

- [ ] **Step 4: Update specs/STATUS.md**

Change the "Em andamento" and "Concluido" sections:

```markdown
## Em andamento
(nada)

## Concluido
- [CLAUDE B] B1: Fix folga_fixa=DOM no solver — 4 guards (XOR, ciclo hard, ciclo soft, dom_max)
- [CLAUDE B] B2: Fix folga_fixa=DOM na bridge — zero ciclo, null variavel
- [CLAUDE B] B3: Fix folga_fixa=DOM no TS — folga_fixa_dom flag + unit tests
```

- [ ] **Step 5: Commit status update**

```bash
git add specs/STATUS.md
git commit -m "docs: mark B1-B3 (folga_fixa=DOM fix) as complete in STATUS"
```

---

## Verification Checklist

After all tasks complete, verify:

- [ ] `npm run typecheck` — 0 errors
- [ ] `npm run solver:test:parity` — PASS
- [ ] `npx vitest run tests/shared/simula-ciclo.spec.ts` — 4 tests PASS
- [ ] `npx vitest run tests/shared/folga-inference.spec.ts` — 2 tests PASS
- [ ] `npx vitest run tests/main/rule-policy.spec.ts` — 3 tests PASS
- [ ] `solver/constraints.py` has 4 guards for `folga_fixa_dia_semana == "DOM"`
- [ ] `solver-bridge.ts` zeros cycle and nulls variable for fixa=DOM
- [ ] `simula-ciclo.ts` has `folga_fixa_dom` field and handles it in Steps 1+2
- [ ] `specs/STATUS.md` updated with B1-B3 as complete
