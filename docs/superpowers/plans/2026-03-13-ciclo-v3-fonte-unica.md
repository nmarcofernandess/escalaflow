# Ciclo V3: Fonte Unica + Fix FF/FV Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove domingo_ciclo from collaborator config, auto-calculate cycle in bridge, fix FF/FV UI bugs, add dom max consecutivo constraint.

**Architecture:** Bridge calculates optimal sunday cycle from sector demand + eligible collaborators (tries 1/2 → 1/1 → 2/1). Python constraints unchanged (read from JSON as before). UI removes manual cycle config and fixes FF/FV display logic.

**Tech Stack:** TypeScript (Electron main + React renderer), Python (OR-Tools CP-SAT), PGlite (Postgres WASM)

**Spec:** `docs/BUILD_CICLO_V3_FONTE_UNICA.md`

---

## Task 1: Migration v22 — Drop domingo_ciclo columns

**Files:**
- Modify: `src/main/db/schema.ts` (add migration v22 after v21 block ~line 761)

- [ ] **Step 1: Add migration v22**

In `schema.ts`, after the v21 migration block, add:
```typescript
// --- v22: Ciclo domingo automatico — remove config manual ---
await addColumnDropSafe('colaborador_regra_horario', 'domingo_ciclo_trabalho')
await addColumnDropSafe('colaborador_regra_horario', 'domingo_ciclo_folga')
```

Since PGlite may not support DROP COLUMN cleanly, alternative approach:
```typescript
// v22: Make domingo_ciclo columns nullable (stop relying on them)
await execDDL(`ALTER TABLE colaborador_regra_horario ALTER COLUMN domingo_ciclo_trabalho DROP NOT NULL`)
await execDDL(`ALTER TABLE colaborador_regra_horario ALTER COLUMN domingo_ciclo_trabalho SET DEFAULT NULL`)
await execDDL(`ALTER TABLE colaborador_regra_horario ALTER COLUMN domingo_ciclo_folga DROP NOT NULL`)
await execDDL(`ALTER TABLE colaborador_regra_horario ALTER COLUMN domingo_ciclo_folga SET DEFAULT NULL`)
// Set all existing values to NULL (bridge will calculate)
await execute(`UPDATE colaborador_regra_horario SET domingo_ciclo_trabalho = NULL, domingo_ciclo_folga = NULL`)
```

- [ ] **Step 2: Run typecheck**
- [ ] **Step 3: Commit**

---

## Task 2: Types — Remove domingo_ciclo from interfaces

**Files:**
- Modify: `src/shared/types.ts:237-238,559-560`

- [ ] **Step 1: Remove from RegraHorarioColaborador**

Remove lines 237-238:
```typescript
// REMOVE:
domingo_ciclo_trabalho: number
domingo_ciclo_folga: number
```

- [ ] **Step 2: Keep in SolverInputColab (bridge still passes calculated values)**

Lines 559-560 STAY — the bridge calculates and populates these fields.

- [ ] **Step 3: Run typecheck — expect errors in tipc, ColaboradorDetalhe, tools.ts, etc**
- [ ] **Step 4: Commit**

---

## Task 3: Bridge — Auto-calculate cycle from demand

**Files:**
- Modify: `src/main/motor/solver-bridge.ts:297-320,440-448`

- [ ] **Step 1: Add calcularCicloDomingo function**

Add before `buildSolverInput`:
```typescript
function calcularCicloDomingo(
  demandaRows: { dia_semana: string | null; min_pessoas: number }[],
  colabRows: { id: number; tipo_trabalhador: string | null }[],
  regraGroupByColab: Map<number, { padrao: { folga_fixa_dia_semana: string | null } | null }>
): { cicloTrabalho: number; cicloFolga: number } {
  // D_dom = peak demand on Sunday
  const domDemandas = demandaRows.filter(d => d.dia_semana === 'DOM')
  const dDom = domDemandas.length > 0 ? Math.max(...domDemandas.map(d => d.min_pessoas)) : 0

  // N_dom = collaborators eligible for Sunday (exclude INTERMITENTE + folga_fixa=DOM)
  const nDom = colabRows.filter(c => {
    if ((c.tipo_trabalhador ?? 'CLT') === 'INTERMITENTE') return false
    const group = regraGroupByColab.get(c.id)
    if (group?.padrao?.folga_fixa_dia_semana === 'DOM') return false
    return true
  }).length

  if (dDom === 0 || nDom === 0) return { cicloTrabalho: 0, cicloFolga: 1 }

  // Try best for employee first
  if (nDom * (1/3) >= dDom) return { cicloTrabalho: 1, cicloFolga: 2 }
  if (nDom * (1/2) >= dDom) return { cicloTrabalho: 1, cicloFolga: 1 }
  if (nDom * (2/3) >= dDom) return { cicloTrabalho: 2, cicloFolga: 1 }
  if (nDom * (3/4) >= dDom) return { cicloTrabalho: 3, cicloFolga: 1 }
  return { cicloTrabalho: nDom, cicloFolga: 0 }
}
```

- [ ] **Step 2: Replace domingo_ciclo enrichment**

Replace lines 444-445:
```typescript
// BEFORE:
c.domingo_ciclo_trabalho = padrao.domingo_ciclo_trabalho
c.domingo_ciclo_folga = padrao.domingo_ciclo_folga

// AFTER (outside the padrao block — calculate once for all):
```

Move to after the enrichment loop. Calculate once and apply to all non-INTERMITENTE:
```typescript
const { cicloTrabalho, cicloFolga } = calcularCicloDomingo(demandaRows, colabRows, regraGroupByColab)
for (const c of colaboradores) {
  if (c.tipo_trabalhador !== 'INTERMITENTE') {
    c.domingo_ciclo_trabalho = cicloTrabalho
    c.domingo_ciclo_folga = cicloFolga
  }
}
```

- [ ] **Step 3: Remove domingo_ciclo from RegraHorarioRow type and SELECT**

Remove `r.domingo_ciclo_trabalho, r.domingo_ciclo_folga` from the SQL query (lines 312) and from the RegraHorarioRow type (lines 302-303).

- [ ] **Step 4: Run typecheck**
- [ ] **Step 5: Commit**

---

## Task 4: tipc.ts — Remove domingo_ciclo from CRUD handlers

**Files:**
- Modify: `src/main/tipc.ts:1893-2009` (savarRegra handler)

- [ ] **Step 1: Remove from SELECT, UPDATE, INSERT queries**

Remove `domingo_ciclo_trabalho` and `domingo_ciclo_folga` from:
- Type definition (~line 1914-1915)
- UPDATE SET clause (~line 1977-1978)
- INSERT column list and VALUES (~line 1995-2009)
- Reset handler default values (~line 273)

- [ ] **Step 2: Run typecheck**
- [ ] **Step 3: Commit**

---

## Task 5: ColaboradorDetalhe.tsx — Remove cycle UI

**Files:**
- Modify: `src/renderer/src/paginas/ColaboradorDetalhe.tsx:208-209,237-238,493-494,1006-1030`

- [ ] **Step 1: Remove from form state**

Remove `domingo_ciclo_trabalho` and `domingo_ciclo_folga` from:
- Default values (lines 208-209)
- Load existing (lines 237-238)
- Form submission (lines 493-494)

- [ ] **Step 2: Remove UI inputs**

Remove the "Ciclo domingo (trabalho/folga)" block (lines ~1006-1030):
- The label, both number inputs, the "/" divider, and the helper text.
- Change grid from `grid-cols-2 sm:grid-cols-4` to `grid-cols-3` (3 remaining fields: folga fixa, folga variavel, pref turno).

- [ ] **Step 3: Run typecheck**
- [ ] **Step 4: Commit**

---

## Task 6: tools.ts — Remove from IA schemas

**Files:**
- Modify: `src/main/ia/tools.ts:183-184,670-674`

- [ ] **Step 1: Remove from Zod schema**

Remove lines 183-184 (domingo_ciclo_trabalho and domingo_ciclo_folga z.number definitions).

- [ ] **Step 2: Remove from CAMPOS_VALIDOS**

Remove from the `colaborador_regra_horario` Set (lines 672-673).

- [ ] **Step 3: Remove from tool handler**

In the salvar_regra_horario_colaborador handler (~lines 2801-2935), remove references to domingo_ciclo fields.

- [ ] **Step 4: Run typecheck**
- [ ] **Step 5: Commit**

---

## Task 7: EscalaCicloResumo.tsx — Fix FF/FV display bug

**Files:**
- Modify: `src/renderer/src/componentes/EscalaCicloResumo.tsx:334-407`

- [ ] **Step 1: Fix inferredFolgas (lines 334-379)**

Replace the useMemo with logic that handles 3 scenarios:
1. Both fixa AND variavel defined in regra → use directly
2. Only fixa defined → fixa from regra, variavel = null
3. Neither → infer from allocation data (existing counting logic)

Key fix: when only fixa is defined, don't fall into counting. Set variavel=null.

```typescript
const regra = regrasMap.get(colabId)

// Case 1: both explicitly defined
if (regra?.folga_fixa_dia_semana && regra?.folga_variavel_dia_semana) {
  map.set(colabId, { fixa: regra.folga_fixa_dia_semana, variavel: regra.folga_variavel_dia_semana })
  continue
}

// Case 2: only fixa defined
if (regra?.folga_fixa_dia_semana) {
  map.set(colabId, { fixa: regra.folga_fixa_dia_semana, variavel: null })
  continue
}

// Case 3: neither — infer from allocations (existing counting code)
// ... keep existing counting logic ...
```

- [ ] **Step 2: Fix resolveSymbol (lines 390-407)**

Replace the logic:
```typescript
// BEFORE:
if (dia === 'DOM') return 'DF'
const inf = inferredFolgas.get(colab.id)
if (inf?.variavel === dia) return 'FV'
return 'FF'

// AFTER:
if (dia === 'DOM') return 'DF'
const inf = inferredFolgas.get(colab.id)
if (inf?.fixa === dia) return 'FF'
if (inf?.variavel && inf.variavel === dia) return 'FV'
return 'FF'  // fallback for unclassified rest days
```

- [ ] **Step 3: Run typecheck**
- [ ] **Step 4: Commit**

---

## Task 8: constraints.py — Add dom max consecutivo

**Files:**
- Modify: `solver/constraints.py` (add after add_folga_variavel_condicional ~line 1051)
- Modify: `solver/solver_ortools.py` (call new constraint)

- [ ] **Step 1: Add constraint function**

```python
def add_dom_max_consecutivo(
    model: cp_model.CpModel,
    works_day: WorksDay,
    colabs: List[dict],
    C: int,
    sunday_indices: List[int],
    blocked_days: Dict[int, set],
) -> None:
    """HARD: max domingos consecutivos trabalhados.
    Mulher (sexo='F'): max 1 (Art. 386 CLT).
    Homem (sexo='M'): max 2 (convencao/jurisprudencia).
    """
    for c in range(C):
        if colabs[c].get("tipo_trabalhador", "CLT") == "INTERMITENTE":
            continue
        sexo = colabs[c].get("sexo", "M")
        max_consec = 1 if sexo == "F" else 2
        available_suns = [d for d in sunday_indices if d not in blocked_days.get(c, set())]
        window = max_consec + 1
        for i in range(len(available_suns) - window + 1):
            suns = available_suns[i : i + window]
            model.add(sum(works_day[c, d] for d in suns) <= max_consec)
```

- [ ] **Step 2: Import and call in solver_ortools.py**

In imports, add `add_dom_max_consecutivo`.
In Phase 1 (solve_folga_pattern, after add_domingo_ciclo_hard ~line 426):
```python
add_dom_max_consecutivo(model, works_day, colabs, C, sunday_indices, blocked_days)
```
In Phase 2 (_solve_pass, in the hard constraints section after domingo headcount ~line 807):
```python
if "ALL_PRODUCT_RULES" not in relax:
    add_dom_max_consecutivo(model, works_day, colabs, C, sunday_indices, blocked_days)
```

- [ ] **Step 3: Commit**

---

## Task 9: Tests — Verify everything works

- [ ] **Step 1: Run typecheck**
```bash
npm run typecheck
```

- [ ] **Step 2: Run solver parity test**
```bash
npm run solver:test:parity
```

- [ ] **Step 3: Run rule-policy test**
```bash
npx vitest run tests/main/rule-policy.spec.ts
```

- [ ] **Step 4: Run solver smoke test**
```bash
npm run solver:test
```

- [ ] **Step 5: Fix any failures**
- [ ] **Step 6: Final commit**

---

## Future Work (Not in this plan)

- **Nivel 2 pre-flight engine** (`preflight-ciclo.ts`) — separate spec
- **Salvar padrao** (persist discovered F/V) — separate spec
- **system-prompt.ts** update — minor, do when touching IA
