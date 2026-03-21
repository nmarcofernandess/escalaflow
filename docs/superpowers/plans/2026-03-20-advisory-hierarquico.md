# Advisory Hierárquico + Pipeline Limpo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transformar o advisory de 3 fases binárias (PASS/FAIL) em um single-solve com soft constraints hierárquicas. Cada pin tem custo proporcional à sua origem (auto < aceito < manual < salvo < CLT). O resultado é SEMPRE viável, o diff é EXATO, e o Pass 1b do multi-pass morre.

**Architecture:** (1) Type contract `PinWithOrigin` propagado do TS até o Python; (2) `solve_folga_pattern` refatorado com `only_enforce_if` + penalidades ponderadas; (3) `advisory-controller.ts` simplificado de 3 spawns para 1; (4) `SugestaoSheet.tsx` mostrando diff hierárquico com custos; (5) Multi-pass simplificado (morte do Pass 1b, warm-start).

**Tech Stack:** Python OR-Tools CP-SAT, TypeScript, React, shadcn/ui

**Spec de referência:** `specs/ANALYST_PIPELINE_SOLVER_COMPLETO.md` → seções "Advisory como Otimizador Hierárquico" e "Morte do Pass 1b"

**Pré-requisito:** Plan A (Transparência de Relaxações) implementado. Estado atual após Plan A:

| Artefato | Status | Detalhes |
|----------|--------|----------|
| `textoResumoRelaxacoes()` | Implementado | `src/shared/resumo-user.ts` — traduz `pass_usado` + `regras_relaxadas` → texto humano. Exporta `NOMES_HUMANOS_REGRAS`. |
| `NOMES_HUMANOS_REGRAS` | Implementado | Mapa `Record<string, string>` — reuse em componentes UI. |
| `resumo_user.relaxacoes` | Implementado | Em `gerar_escala` e `diagnosticar_escala` (tools.ts). IA Chat informa relaxações. |
| `diagnostico_json` | Persistido | Migration v30 — coluna TEXT na tabela `escalas`. `persistirSolverResult` salva. `escalasBuscar` e `diagnosticar_escala` leem. |
| Toast informativo | Implementado | `SetorDetalhe.tsx` — verde (pass 1) / amarelo (pass 2+) com `textoResumoRelaxacoes`. |
| Banner inline | Implementado | `EscalaPagina.tsx` — banner amber/red no topo quando `diagnostico.pass_usado !== 1`. Lê `diagnostico_json` do banco (funciona ao abrir escala existente). |
| Card "Ajustes do Motor" | Implementado | `EscalaPagina.tsx` aba Apontamentos — 5º card no grid. |
| `EscalaResultBanner.tsx` | **DELETADO** | Era código morto (zero imports). A funcionalidade está no banner inline de EscalaPagina.tsx. Se Plan B precisar de um componente reutilizável, criar um novo — não ressuscitar este. |
| Testes | 9 testes | `tests/shared/resumo-user.spec.ts` — cobertura de pass 1, '1b', 2, 3, EXPLORATORY, fallback. |

**O que Plan B precisa saber:**
- `escalaCompleta.diagnostico` agora está disponível tanto na geração fresca quanto ao carregar do banco (via `diagnostico_json`).
- O banner inline de EscalaPagina usa `textoResumoRelaxacoes` — Plan B pode expandir o banner pra mostrar TAMBÉM o advisory aceito (duas linhas: "Você aceitou: ..." + "O motor ajustou: ...").
- O card "Ajustes do Motor" na aba Apontamentos segue o mesmo pattern — pode ser expandido pra incluir info do advisory.
- `diagnosticar_escala` já lê `diagnostico_json` da tabela `escalas`. Plan B precisa persistir `advisory_aceito_json` separadamente (já planejado na Task 10).
- **NÃO existe componente `EscalaResultBanner`.** O banner é inline em `EscalaPagina.tsx` (~20 linhas). Se precisar criar componente, criar novo com props simples.

**Mudanças do Coverage Stabilization (commit 1067b54) que afetam Tasks 11+:**
- **`_solve_pass` mudou de assinatura:** `gap_limit` → `patience_s`. Chamadas usam `patience_s=patience_s` (vem de `DEFAULT_PATIENCE_S = 30`).
- **`_run_with_continuation` REMOVIDO.** Cada pass é chamado com `_solve_pass(data, pass_num=N, ..., max_time=remaining_time(), patience_s=patience_s, ...)` direto.
- **`MODE_PROFILES` REMOVIDO.** Substituído por `DEFAULT_PATIENCE_S = 30`. O campo `solve_mode` no JSON é IGNORADO pelo Python.
- **Pass 3 OFFICIAL agora inclui `H10_ELASTIC`** nas relaxações (fix para 3 meses).
- **Sunday headcount minimum** relaxa junto com FOLGA_FIXA/FOLGA_VARIAVEL (guard `_skip_sunday_headcount`).
- **`add_dias_trabalho`** (constraints.py) agora aceita `days` param e desconta folga_fixa de available — fix para semanas parciais.
- **SolverConfigDrawer:** seção "Estratégia" (radio buttons de modo) foi removida. `SolverSessionConfig.solveMode` é literal `'rapido'`.
- **Resultado inclui `diagnostico.stabilization`** com métricas: `first_solution_s`, `stabilized_s`, `solutions_found`, `final_coverage`, `patience_s`, `coverage_improvements`.

---

## File Structure

| Ação | Arquivo | Responsabilidade |
|------|---------|------------------|
| Modify | `src/shared/types.ts` | Definir `PinWithOrigin` interface |
| Modify | `src/shared/advisory-types.ts` | Atualizar `EscalaAdvisoryInput.pinned_folga_externo` + `EscalaAdvisoryOutput` para hierarquia |
| Modify | `src/shared/simula-ciclo.ts` | `converterPreviewParaPinnedWithOrigin` → gerar `origin` **por dia** baseado nos overrides |
| Modify | `src/main/motor/solver-bridge.ts` | Propagar `origin`/`weight` no JSON do solver (JSON.stringify preserva campos extras) |
| Modify | `solver/solver_ortools.py` | `solve_folga_pattern` com soft constraints + `pin_violated` booleans |
| Modify | `solver/constraints.py` | Reutilizar `add_dias_trabalho_soft_penalty` (já existe, linha 1268, weight=4000) |
| Modify | `src/main/motor/advisory-controller.ts` | Single solve, diff dos booleans, eliminar Fases B/C |
| Modify | `src/renderer/src/componentes/SugestaoSheet.tsx` | Drawer hierárquico com custos |
| Modify | `src/renderer/src/paginas/SetorDetalhe.tsx` | Integrar gate no Gerar + on-demand Sugerir |
| Modify | `solver/solver_ortools.py` | Multi-pass: remover Pass 1b, Pass 2 mantém pins |
| Create | `tests/shared/pin-with-origin.spec.ts` | Testes do type contract |
| Create | `tests/main/advisory-hierarquico.spec.ts` | Testes do advisory single solve (mocking runSolver) |
| Create | `tests/main/solver-soft-pins.spec.ts` | Testes do soft constraints via bridge (spawn Python real) |

**Nota sobre testes Python:** O projeto NÃO tem `tests/solver/` nem pytest configurado. Testes do solver são feitos via bridge TS (`npm run solver:test`, `tests/main/solver-*.spec.ts`). Os testes de soft pins seguem o mesmo padrão — vitest + spawn Python real.

**Nota sobre `accepted` origin:** Definido no type mas NÃO implementado neste plano. O tracking de "sugestão aceita" requer state no store (`previouslyAcceptedPins`). Escopo futuro — por ora, pins aceitos via drawer viram `manual` (RH confirmou a escolha).

---

## Fase 1: Type Contract (PinWithOrigin)

### Task 1: Definir `PinWithOrigin` e helpers

**Files:**
- Create: `tests/shared/pin-with-origin.spec.ts`
- Modify: `src/shared/types.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/shared/pin-with-origin.spec.ts
import { describe, it, expect } from 'vitest'
import type { PinWithOrigin } from '../../src/shared/types'
import { PIN_WEIGHTS, pinWeight } from '../../src/shared/types'

describe('PinWithOrigin', () => {
  it('PIN_WEIGHTS has correct hierarchy', () => {
    expect(PIN_WEIGHTS.auto).toBeLessThan(PIN_WEIGHTS.accepted)
    expect(PIN_WEIGHTS.accepted).toBeLessThan(PIN_WEIGHTS.manual)
    expect(PIN_WEIGHTS.manual).toBeLessThan(PIN_WEIGHTS.saved)
  })

  it('pinWeight returns correct weight for origin', () => {
    expect(pinWeight('auto')).toBe(PIN_WEIGHTS.auto)
    expect(pinWeight('saved')).toBe(PIN_WEIGHTS.saved)
  })

  it('PinWithOrigin has all required fields', () => {
    const pin: PinWithOrigin = {
      c: 0,
      d: 1,
      band: 3,
      origin: 'manual',
      weight: PIN_WEIGHTS.manual,
    }
    expect(pin.origin).toBe('manual')
    expect(pin.weight).toBe(PIN_WEIGHTS.manual)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/shared/pin-with-origin.spec.ts`
Expected: FAIL — `PinWithOrigin` not exported

- [ ] **Step 3: Add types to `src/shared/types.ts`**

Localizar onde `SolverInput` é definido (perto da linha 693). Adicionar ANTES:

```typescript
// --- Pin Hierarchy for Advisory Hierárquico ---

export type PinOrigin = 'auto' | 'accepted' | 'manual' | 'saved'

/**
 * Pesos ilustrativos — DEVEM ser calibrados com dados reais antes de produção.
 * Regra: peso_SAVED > max_ganho_spread_possível (spread * 1000 no Phase 1).
 * Ver specs/ANALYST_PIPELINE_SOLVER_COMPLETO.md → "Calibração de Pesos".
 */
export const PIN_WEIGHTS: Record<PinOrigin, number> = {
  auto: 100,
  accepted: 500,
  manual: 5000,
  saved: 10000,
} as const

export function pinWeight(origin: PinOrigin): number {
  return PIN_WEIGHTS[origin]
}

export interface PinWithOrigin {
  c: number           // índice do colaborador (0-based)
  d: number           // índice do dia (0-based)
  band: number        // 0=OFF, 1=MANHA, 2=TARDE, 3=INTEGRAL
  origin: PinOrigin   // quem definiu este pin
  weight: number      // peso derivado da origem
}
```

Atualizar `SolverInput.config.pinned_folga_externo` para aceitar AMBOS os formatos (retrocompatível):

```typescript
// Em SolverInput.config, substituir:
pinned_folga_externo?: Array<{ c: number; d: number; band: number }>
// Por:
pinned_folga_externo?: Array<{ c: number; d: number; band: number; origin?: PinOrigin; weight?: number }>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/shared/pin-with-origin.spec.ts`
Expected: ALL PASS

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: 0 errors (tipo é retrocompatível — origin/weight são opcionais)

- [ ] **Step 6: Commit**

```bash
git add tests/shared/pin-with-origin.spec.ts src/shared/types.ts
git commit -m "feat: add PinWithOrigin type contract for advisory hierarchy

Defines pin origin levels (auto < accepted < manual < saved) with
calibratable weights. Retrocompatible with existing pinned_folga_externo.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `converterPreviewParaPinned` com origin tracking

**Files:**
- Modify: `src/shared/simula-ciclo.ts:622-649`
- Create: `tests/shared/converter-preview-pinned-origin.spec.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/shared/converter-preview-pinned-origin.spec.ts
import { describe, it, expect } from 'vitest'
import { converterPreviewParaPinnedWithOrigin } from '../../src/shared/simula-ciclo'
import type { PinOrigin } from '../../src/shared/types'

describe('converterPreviewParaPinnedWithOrigin', () => {
  const mockOutput = {
    sucesso: true,
    grid: [
      // Pessoa 0: semana com T T T T T F F
      {
        semanas: [{ dias: ['T', 'T', 'T', 'T', 'T', 'F', 'F'] }],
        folgaFixa: 'SEX',
        folgaVariavel: 'SAB',
      },
    ],
    warnings: [],
    stats: {} as any,
    ciclo_semanas: 2,
    diagnosticos: [],
  }

  it('marks auto origin for preview-decided pins', () => {
    const result = converterPreviewParaPinnedWithOrigin(
      mockOutput as any,
      [{ funcao: { id: 1 }, titular: { id: 10 } }],
      [],  // no overrides
    )
    // All pins should be 'auto' since no overrides
    expect(result.every(p => p.origin === 'auto')).toBe(true)
  })

  it('marks manual origin for RH override pins', () => {
    const overrides = [{ colaborador_id: 10, fixa: 'SEX' as any, variavel: 'SAB' as any }]
    const result = converterPreviewParaPinnedWithOrigin(
      mockOutput as any,
      [{ funcao: { id: 1 }, titular: { id: 10 } }],
      overrides,
    )
    // OFF pins on SEX and SAB should be 'manual'
    const offPins = result.filter(p => p.band === 0)
    expect(offPins.some(p => p.origin === 'manual')).toBe(true)
  })

  it('marks saved origin for BD-backed pins', () => {
    const savedFolgas = [{ colaborador_id: 10, fixa: 'SEX' as any, variavel: null }]
    const result = converterPreviewParaPinnedWithOrigin(
      mockOutput as any,
      [{ funcao: { id: 1 }, titular: { id: 10 } }],
      [],  // no local overrides
      savedFolgas,
    )
    const offPins = result.filter(p => p.band === 0)
    expect(offPins.some(p => p.origin === 'saved')).toBe(true)
  })

  it('includes weight field matching origin', () => {
    const result = converterPreviewParaPinnedWithOrigin(
      mockOutput as any,
      [{ funcao: { id: 1 }, titular: { id: 10 } }],
      [],
    )
    result.forEach(pin => {
      expect(pin.weight).toBeDefined()
      expect(typeof pin.weight).toBe('number')
    })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/shared/converter-preview-pinned-origin.spec.ts`
Expected: FAIL — function not exported

- [ ] **Step 3: Implement `converterPreviewParaPinnedWithOrigin`**

Em `src/shared/simula-ciclo.ts`, adicionar nova função (mantendo a antiga para retrocompatibilidade):

```typescript
import { type PinOrigin, type PinWithOrigin, pinWeight } from './types'

/**
 * Converte resultado do preview TS para pins com origin tracking.
 * Determina a origem de cada pin baseado em:
 * - overridesLocais: RH escolheu manualmente no preview → 'manual'
 * - savedFolgas: folga salva no BD (regra do colaborador) → 'saved'
 * - Nenhum dos dois: preview decidiu via pickBestFolgaDay → 'auto'
 */
export function converterPreviewParaPinnedWithOrigin(
  output: SimulaCicloOutput,
  postosElegiveis: Array<{ funcao: { id: number }; titular: { id: number } }>,
  overridesLocais: Array<{ colaborador_id: number; fixa?: DiaSemana | null; variavel?: DiaSemana | null }>,
  savedFolgas?: Array<{ colaborador_id: number; fixa?: DiaSemana | null; variavel?: DiaSemana | null }>,
): PinWithOrigin[] {
  const pins: PinWithOrigin[] = []
  const grid = output.grid

  for (let rowIdx = 0; rowIdx < grid.length; rowIdx++) {
    const row = grid[rowIdx]
    const titular = postosElegiveis[rowIdx]?.titular
    const colabId = titular?.id

    // Determinar origin das folgas (OFF pins)
    const override = overridesLocais.find(o => o.colaborador_id === colabId)
    const saved = savedFolgas?.find(s => s.colaborador_id === colabId)

    let folgaOrigin: PinOrigin = 'auto'
    if (override && (override.fixa || override.variavel)) {
      folgaOrigin = 'manual'
    } else if (saved && (saved.fixa || saved.variavel)) {
      folgaOrigin = 'saved'
    }

    let d = 0
    for (const sem of row.semanas) {
      for (const simbolo of sem.dias) {
        const isOff = simbolo === 'F' || simbolo === 'DF' || simbolo === 'FV' || simbolo === 'FF'
        const band = isOff ? 0 : 3  // TS não sabe de bandas, usa 3=INTEGRAL para T
        const origin: PinOrigin = isOff ? folgaOrigin : 'auto'
        pins.push({
          c: rowIdx,
          d,
          band,
          origin,
          weight: pinWeight(origin),
        })
        d++
      }
    }
  }

  return pins
}
```

**NOTA PARA O IMPLEMENTADOR — ORIGIN POR DIA, NÃO POR PESSOA:**

A lógica acima é simplificada (tag por pessoa). Na implementação real, a origin deve ser POR DIA:

- Se o dia é folga e `overrideFixaLocal[colabId] === diaSemana` → `'manual'`
- Se o dia é folga e `overrideVariavelLocal[colabId] === diaSemana` → `'manual'`
- Se o dia é folga e `baseFixaColaborador` ou `baseVariavelColaborador` tem essa folga → `'saved'`
- Se o dia é folga e nenhum dos acima → `'auto'` (pickBestFolgaDay decidiu)
- Se o dia é trabalho → `'auto'` (trabalho nunca é "manualmente pinado")

Os dados necessários já existem no `CicloGridRow`:
- `row.overrideFixaLocal` — DiaSemana | null
- `row.overrideVariavelLocal` — DiaSemana | null
- `row.baseFixaColaborador` — DiaSemana | null
- `row.baseVariavelColaborador` — DiaSemana | null

A função recebe esses dados e determina origin por (c, d), não por pessoa.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/shared/converter-preview-pinned-origin.spec.ts`
Expected: ALL PASS

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: 0 errors

- [ ] **Step 6: Commit**

```bash
git add tests/shared/converter-preview-pinned-origin.spec.ts src/shared/simula-ciclo.ts
git commit -m "feat: converterPreviewParaPinnedWithOrigin with origin tracking

Tags each pin with its origin (auto/manual/saved) and weight.
Preserves original converterPreviewParaPinned for retrocompatibility.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Propagar origin/weight no solver-bridge

**Files:**
- Modify: `src/main/motor/solver-bridge.ts`

- [ ] **Step 1: Update `buildSolverInput` to propagate origin/weight**

Em `solver-bridge.ts`, localizar onde `pinnedFolgaExterno` é adicionado ao config do SolverInput. O campo já aceita `origin?` e `weight?` (retrocompatível via Task 1). Garantir que o JSON serializado inclui esses campos quando presentes.

Verificar: se `options.pinnedFolgaExterno` já vem com origin/weight (do novo `converterPreviewParaPinnedWithOrigin`), basta passá-lo direto. Nenhuma transformação necessária — o JSON.stringify preserva os campos.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add src/main/motor/solver-bridge.ts
git commit -m "feat: propagate pin origin/weight through solver bridge

PinWithOrigin fields flow from TS preview to Python solver JSON.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Fase 2: Python Soft Constraints

### Task 4: `solve_folga_pattern` com soft constraints hierárquicas

**Files:**
- Modify: `solver/solver_ortools.py:346-514` (solve_folga_pattern)
- Modify: `solver/solver_ortools.py:1819-1838` (advisory_only return — incluir pin_violations/pin_cost)
- Reuse: `solver/constraints.py:1268` (`add_dias_trabalho_soft_penalty` — JÁ EXISTE, weight=4000)
- Create: `tests/main/solver-soft-pins.spec.ts` (vitest + spawn Python, mesmo padrão de `solver-test.spec.ts`)

Esta é a task mais complexa. O `solve_folga_pattern` muda de "todas constraints HARD" para "pins como SOFT com pesos".

- [ ] **Step 1: Write TS test (vitest + spawn Python, same pattern as existing solver tests)**

```typescript
// tests/main/solver-soft-pins.spec.ts
import { describe, it, expect } from 'vitest'
import { execFileSync } from 'child_process'
import path from 'path'

const SOLVER_BIN = path.join(__dirname, '../../solver-bin/escalaflow-solver')
const SOLVER_PY = path.join(__dirname, '../../solver/solver_ortools.py')

function runSolver(data: Record<string, unknown>) {
  // Try compiled binary first, fall back to Python script
  let cmd: string, args: string[]
  try {
    require('fs').accessSync(SOLVER_BIN)
    cmd = SOLVER_BIN
    args = []
  } catch {
    cmd = 'python3'
    args = [SOLVER_PY]
  }
  const stdout = execFileSync(cmd, args, {
    input: JSON.stringify(data),
    encoding: 'utf-8',
    timeout: 60_000,
  })
  return JSON.parse(stdout)
}

function makeMinimalInput(pins?: Array<{ c: number; d: number; band: number; origin?: string; weight?: number }>) {
  const colabs = Array.from({ length: 3 }, (_, i) => ({
    id: i + 1, nome: `Colab_${i}`, sexo: 'M', tipo_trabalhador: 'CLT',
    horas_semanais: 44, dias_trabalho: 5, max_minutos_dia: 585,
    folga_fixa_dia_semana: null, folga_variavel_dia_semana: null,
    rank: 0, prefere_turno: null,
  }))
  return {
    data_inicio: '2026-03-02', data_fim: '2026-03-08',
    empresa: {
      hora_abertura: '07:00', hora_fechamento: '22:00',
      grid_minutos: 15, tolerancia_semanal_min: 15, min_intervalo_almoco_min: 30,
    },
    colaboradores: colabs,
    demanda: ['SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB', 'DOM'].map(d => ({
      dia_semana: d, hora_inicio: '07:00', hora_fim: '22:00', min_pessoas: 2,
    })),
    feriados: [], excecoes: [],
    config: {
      rules: {}, advisory_only: true,
      ...(pins ? { pinned_folga_externo: pins } : {}),
    },
  }
}

describe('solve_folga_pattern soft pins', () => {
  it('respects all pins when feasible (cost = 0)', () => {
    const pins = [
      { c: 0, d: 5, band: 0, origin: 'manual', weight: 5000 },
      { c: 0, d: 6, band: 0, origin: 'saved', weight: 10000 },
      { c: 1, d: 4, band: 0, origin: 'auto', weight: 100 },
      { c: 1, d: 6, band: 0, origin: 'auto', weight: 100 },
    ]
    const result = runSolver(makeMinimalInput(pins))
    expect(result.status).not.toBe('ADVISORY_INFEASIBLE')
    const pinCost = result.diagnostico?.pin_cost ?? 0
    expect(pinCost).toBe(0)
  })

  it('prefers violating cheap pins over expensive ones', () => {
    const pins = [
      { c: 0, d: 5, band: 0, origin: 'manual', weight: 5000 },
      { c: 1, d: 5, band: 0, origin: 'auto', weight: 100 },
      { c: 2, d: 5, band: 0, origin: 'auto', weight: 100 },
    ]
    const result = runSolver(makeMinimalInput(pins))
    expect(result.status).not.toBe('ADVISORY_INFEASIBLE')
    const violations = result.diagnostico?.pin_violations ?? []
    for (const v of violations) {
      expect(v.origin).not.toBe('manual')
    }
  })

  it('never returns INFEASIBLE when pins have weights', () => {
    const pins = Array.from({ length: 3 }, (_, i) => ({
      c: i, d: 0, band: 0, origin: 'auto', weight: 100,
    }))
    const data = makeMinimalInput(pins)
    data.demanda[0].min_pessoas = 3 // Need all 3 on SEG — conflicts with all 3 wanting OFF
    const result = runSolver(data)
    expect(result.sucesso).toBe(true) // Should NOT be INFEASIBLE
  })

  it('returns pin_violations and pin_cost in output', () => {
    const pins = Array.from({ length: 3 }, (_, i) => ({
      c: i, d: 0, band: 0, origin: 'auto', weight: 100,
    }))
    const data = makeMinimalInput(pins)
    data.demanda[0].min_pessoas = 3
    const result = runSolver(data)
    expect(result.diagnostico).toHaveProperty('pin_violations')
    expect(result.diagnostico).toHaveProperty('pin_cost')
  })

  it('legacy pins without origin/weight still work as HARD', () => {
    const pins = [
      { c: 0, d: 5, band: 0 }, // No origin, no weight → HARD
      { c: 0, d: 6, band: 0 },
    ]
    const result = runSolver(makeMinimalInput(pins))
    expect(result.status).not.toBe('ADVISORY_INFEASIBLE')
    // Should NOT have pin_violations (HARD pins don't generate violations)
    expect(result.diagnostico?.pin_violations).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/main/solver-soft-pins.spec.ts`
Expected: FAIL — solver doesn't support origin/weight yet

- [ ] **Step 3: Modify `solve_folga_pattern` in Python**

**Mapa cirúrgico de modificação** — onde inserir cada mudança na função existente de 170 linhas:

**A) Ler pins externos (APÓS linha 367, onde config é lido):**

```python
    # Linha ~368: Após config = data.get("config", {})
    external_pins = config.get("pinned_folga_externo", [])
    has_weighted_pins = any(p.get("weight") for p in external_pins)
    penalty_terms = []
    pin_violated_vars = {}
```

**B) Adicionar soft pin constraints (APÓS blocked days pinning, linha ~407, ANTES de add_dias_trabalho):**

```python
    # Linha ~408: ENTRE blocked days e add_dias_trabalho

    if has_weighted_pins:
        # Hierarchical soft pin constraints
        for pin in external_pins:
            c_idx, d_idx = pin["c"], pin["d"]
            band = pin["band"]
            weight = pin.get("weight", 100)
            origin = pin.get("origin", "auto")

            if d_idx >= D or c_idx >= C:
                continue  # Guard: pin fora do range

            violated = model.new_bool_var(f"pin_viol_{c_idx}_{d_idx}")
            pin_violated_vars[(c_idx, d_idx)] = {
                "var": violated, "origin": origin, "weight": weight, "band": band,
            }

            if band == BAND_OFF:
                model.add(works_day[c_idx, d_idx] == 0).only_enforce_if(violated.Not())
            elif band == BAND_MANHA:
                model.add(is_manha[c_idx, d_idx] == 1).only_enforce_if(violated.Not())
            elif band == BAND_TARDE:
                model.add(is_tarde[c_idx, d_idx] == 1).only_enforce_if(violated.Not())
            elif band == BAND_INTEGRAL:
                model.add(is_integral[c_idx, d_idx] == 1).only_enforce_if(violated.Not())

            penalty_terms.append(violated * weight)

        # DIAS_TRABALHO como SOFT — reutiliza add_dias_trabalho_soft_penalty de constraints.py
        # (já existe na linha 1268, weight=4000, mesma lógica de prorata)
        add_dias_trabalho_soft_penalty(model, penalty_terms, works_day, colabs, C, D, week_chunks, blocked_days)

    else:
        # LEGACY: HARD pins (retrocompatible — sem origin/weight)
        # Manter chamada original:
        add_dias_trabalho(model, works_day, colabs, C, D, week_chunks, blocked_days)
```

**C) Linha 413 — condicionar `add_dias_trabalho` ao modo legado:**

A chamada existente `add_dias_trabalho(...)` na linha 413 MOVE para dentro do `else` do bloco acima. NÃO duplicar.

**D) Modificar objetivo (linha ~482):**

```python
    # Substituir:
    # model.minimize(spread * 1000 + total_integral)
    # Por:
    model.minimize(spread * 1000 + total_integral + sum(penalty_terms))
    # penalty_terms é [] quando has_weighted_pins=False → sem efeito no legado
```

**E) Extrair pin violations e retornar (após pattern extraction, linha ~505):**

```python
        # Após extrair pattern (linhas 495-505), ANTES do return:
        pin_violations_list = []
        pin_cost_total = 0
        for (c_idx, d_idx), info in pin_violated_vars.items():
            if solver.value(info["var"]):
                pin_violations_list.append({
                    "c": c_idx,
                    "d": d_idx,
                    "origin": info["origin"],
                    "weight": info["weight"],
                    "band_expected": info["band"],
                    "band_actual": pattern.get((c_idx, d_idx), -1),
                })
                pin_cost_total += info["weight"]

        return {
            "pattern": pattern,
            "status": "OK",
            "time_ms": round(solve_ms, 1),
            "cycle_days": cycle_days,
            **({"pin_violations": pin_violations_list, "pin_cost": pin_cost_total}
               if has_weighted_pins else {}),
        }
```

**F) Propagar no retorno advisory_only (linha ~1819-1838):**

O bloco `if advisory_only:` serializa o pattern como `pattern_list`. Incluir `pin_violations` e `pin_cost` do resultado de `solve_folga_pattern`:

```python
    # Linha 1819+: advisory_only return
    if advisory_only:
        # ... existing diagnostico build ...
        if pinned_folga is not None:
            pattern_list = [
                {"c": c, "d": d, "band": band}
                for (c, d), band in sorted(pinned_folga.items())
            ]
            # NOVO: incluir pin_violations do Phase 1 se existirem
            advisory_diag["pin_violations"] = phase1_result.get("pin_violations", [])
            advisory_diag["pin_cost"] = phase1_result.get("pin_cost", 0)
            return { ... }  # existing return with advisory_diag atualizado
```

**Nota:** `phase1_result` é o retorno de `solve_folga_pattern()`. Verificar o nome da variável no código (pode ser `folga_result` ou similar). O campo `pin_violations` só existe quando `has_weighted_pins=True`.

**Constraints que NÃO mudam** (permanecem HARD em ambos os modos):
- `add_h1_max_dias_consecutivos` (linha 416)
- `add_folga_fixa_5x2` (linha 419)
- `add_folga_variavel_condicional` (linha 422)
- `add_min_headcount_per_day` (linha 429)
- `add_domingo_ciclo_hard` (linha 433)
- `add_dom_max_consecutivo` (linha 437)
- `add_band_demand_coverage` (linha 448) — vira SOFT no futuro, HARD na V1

- [ ] **Step 4: Run Python test**

Run: `python -m pytest tests/solver/test_soft_pins.py -v`
Expected: ALL PASS

- [ ] **Step 5: Run existing solver tests**

Run: `npm run solver:test`
Expected: ALL PASS (retrocompatible — pins sem origin/weight continuam HARD)

- [ ] **Step 6: Commit**

```bash
git add solver/solver_ortools.py tests/solver/test_soft_pins.py
git commit -m "feat: hierarchical soft pin constraints in solve_folga_pattern

Pins with origin/weight become SOFT constraints with penalties.
Pins without origin/weight remain HARD (retrocompatible).
DIAS_TRABALHO becomes SOFT (weight 3000) when weighted pins present.
Returns pin_violations and pin_cost in output.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Fase 3: Advisory Controller Refactor

### Task 5: Single solve advisory com diff dos booleans

**Files:**
- Modify: `src/main/motor/advisory-controller.ts`
- Modify: `src/shared/advisory-types.ts`
- Create: `tests/main/advisory-hierarquico.spec.ts`

- [ ] **Step 1: Update `advisory-types.ts` — Input AND Output**

Atualizar os tipos para o novo input e output hierárquico:

```typescript
// Em advisory-types.ts, ATUALIZAR o tipo do input:
import type { PinOrigin, PinWithOrigin } from './types'

export interface EscalaAdvisoryInput {
  // ... campos existentes ...
  pinned_folga_externo: PinWithOrigin[]  // ERA: Array<{c,d,band}> → AGORA: com origin/weight
  // ... rest ...
}

// ADICIONAR novos tipos de output:
export interface AdvisoryPinViolation {
  colaborador_id: number
  nome: string
  dia: string           // 'SEG', 'TER', etc.
  origin: PinOrigin
  weight: number
  band_expected: number  // 0=OFF, 1=MANHA, 2=TARDE, 3=INTEGRAL
  band_actual: number
  descricao: string      // "Folga variável SEG→TER" (texto humano)
}

export interface EscalaAdvisoryOutputV2 extends EscalaAdvisoryOutput {
  pin_violations?: AdvisoryPinViolation[]
  pin_cost?: number
  hierarchy_summary?: {
    auto_changes: number
    accepted_changes: number
    manual_changes: number
    saved_changes: number
    dias_trab_relaxed: number
  }
}
```

**IMPORTANTE:** O tipo de `pinned_folga_externo` MUDA de `Array<{c,d,band}>` para `PinWithOrigin[]`. Isso é uma breaking change intencional — todos os chamadores de `runAdvisory` devem passar pins com origin/weight (via `converterPreviewParaPinnedWithOrigin` da Task 2).

- [ ] **Step 2: Refactor `runAdvisory` to single solve**

O advisory muda de 3 spawns sequenciais para 1 spawn com pins ponderados.

Pseudocódigo da refatoração:

```typescript
export async function runAdvisory(input: EscalaAdvisoryInput): Promise<EscalaAdvisoryOutputV2> {
  // 1. Build solver input COM pins ponderados (origin + weight)
  const solverInput = await buildSolverInput(input.setor_id, input.data_inicio, input.data_fim, undefined, {
    pinnedFolgaExterno: input.pinned_folga_externo,  // já com origin/weight
  })
  solverInput.config.advisory_only = true

  // 2. Single solve
  const result = await runSolver(solverInput, ADVISORY_TIMEOUT_MS)

  if (!result.sucesso) {
    return { status: 'NO_PROPOSAL', diagnostics: [...] }
  }

  // 3. Extract pin violations DIRETAMENTE dos booleans do solver
  const violations = result.advisory_pattern?.pin_violations ?? []
  const pinCost = result.advisory_pattern?.pin_cost ?? 0

  // 4. Build diff from violations (NOT from extractFolgaFromPattern)
  const pinViolations = violations.map(v => ({
    colaborador_id: solverInput.colaboradores[v.c].id,
    nome: solverInput.colaboradores[v.c].nome,
    dia: indexToDiaSemana(v.d, solverInput.data_inicio),
    origin: v.origin,
    weight: v.weight,
    band_expected: v.band_expected,
    band_actual: v.band_actual,
    descricao: buildViolationDescription(v),
  }))

  // 5. Determine status
  const status: AdvisoryStatus = pinCost === 0 ? 'CURRENT_VALID' : 'PROPOSAL_VALID'

  // 6. Build legacy diff for retrocompatibility with SugestaoSheet
  const legacyDiff = buildLegacyDiffFromViolations(pinViolations, input.current_folgas)

  return {
    status,
    diagnostics: [...input.preview_diagnostics ?? []],
    proposal: pinCost > 0 ? { diff: legacyDiff } : undefined,
    pin_violations: pinViolations,
    pin_cost: pinCost,
    hierarchy_summary: summarizeByOrigin(pinViolations),
  }
}
```

**NOTA PARA O IMPLEMENTADOR:**
- `extractFolgaFromPattern` pode ser mantido como fallback para pins sem origin/weight (modo legado). Mas para pins com origin/weight, o diff vem dos `pin_violated` booleans.
- `buildLegacyDiffFromViolations` converte o novo formato para o `AdvisoryDiffItem[]` existente, para que o `SugestaoSheet` atual continue funcionando enquanto não é atualizado (Task 6).
- Funções helper (`indexToDiaSemana`, `buildViolationDescription`, `summarizeByOrigin`) precisam ser implementadas.

- [ ] **Step 3: Write tests**

```typescript
// tests/main/advisory-hierarquico.spec.ts
import { describe, it, expect, vi } from 'vitest'
import type { EscalaAdvisoryInput, EscalaAdvisoryOutputV2 } from '../../src/shared/advisory-types'

// Mock runSolver to avoid spawning Python in unit tests
// Integration tests are in solver-soft-pins.spec.ts
vi.mock('../../src/main/motor/solver-bridge', () => ({
  buildSolverInput: vi.fn().mockResolvedValue({
    colaboradores: [{ id: 1, nome: 'Test' }],
    config: {},
    data_inicio: '2026-03-02',
    data_fim: '2026-03-08',
  }),
  runSolver: vi.fn(),
}))

describe('runAdvisory (hierarchical)', () => {
  it('returns CURRENT_VALID when no pins violated', async () => {
    const { runSolver } = await import('../../src/main/motor/solver-bridge')
    vi.mocked(runSolver).mockResolvedValue({
      sucesso: true,
      advisory_pattern: [{ c: 0, d: 0, band: 3 }],
      diagnostico: { pin_violations: [], pin_cost: 0 },
    } as any)

    const { runAdvisory } = await import('../../src/main/motor/advisory-controller')
    const result = await runAdvisory({
      setor_id: 1,
      data_inicio: '2026-03-02',
      data_fim: '2026-03-08',
      pinned_folga_externo: [{ c: 0, d: 5, band: 0, origin: 'auto', weight: 100 }],
      current_folgas: [],
    } as any)

    expect(result.status).toBe('CURRENT_VALID')
    expect(result.pin_cost).toBe(0)
  })

  it('returns PROPOSAL_VALID with pin_violations when pins violated', async () => {
    const { runSolver } = await import('../../src/main/motor/solver-bridge')
    vi.mocked(runSolver).mockResolvedValue({
      sucesso: true,
      advisory_pattern: [{ c: 0, d: 0, band: 3 }],
      diagnostico: {
        pin_violations: [{ c: 0, d: 5, origin: 'auto', weight: 100, band_expected: 0, band_actual: 3 }],
        pin_cost: 100,
      },
    } as any)

    const { runAdvisory } = await import('../../src/main/motor/advisory-controller')
    const result = await runAdvisory({
      setor_id: 1,
      data_inicio: '2026-03-02',
      data_fim: '2026-03-08',
      pinned_folga_externo: [{ c: 0, d: 5, band: 0, origin: 'auto', weight: 100 }],
      current_folgas: [],
    } as any)

    expect(result.status).toBe('PROPOSAL_VALID')
    expect(result.pin_cost).toBe(100)
    expect(result.pin_violations).toHaveLength(1)
    expect(result.pin_violations![0].origin).toBe('auto')
  })

  it('falls back to legacy when solver fails', async () => {
    const { runSolver } = await import('../../src/main/motor/solver-bridge')
    vi.mocked(runSolver).mockResolvedValue({
      sucesso: false,
      diagnostico: {},
    } as any)

    const { runAdvisory } = await import('../../src/main/motor/advisory-controller')
    const result = await runAdvisory({
      setor_id: 1,
      data_inicio: '2026-03-02',
      data_fim: '2026-03-08',
      pinned_folga_externo: [],
      current_folgas: [],
    } as any)

    expect(result.status).toBe('NO_PROPOSAL')
  })
})
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/main/advisory-hierarquico.spec.ts`
Expected: ALL PASS

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`

- [ ] **Step 6: Commit**

```bash
git add src/main/motor/advisory-controller.ts src/shared/advisory-types.ts tests/main/advisory-hierarquico.spec.ts
git commit -m "feat: advisory single solve with hierarchical soft constraints

Replaces 3-phase binary advisory (A/B/C) with single solve.
Diff comes from pin_violated booleans, not frequency inference.
Legacy extractFolgaFromPattern kept as fallback for pins without origin.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Fase 4: Sugerir TS → Automático + CP-SAT + UI

### Task 6: Merge sugerirTSHierarquico no automático do preview

**Files:**
- Modify: `src/shared/simula-ciclo.ts` (gerarCicloFase1 + sugerirTSHierarquico)
- Modify: `src/renderer/src/paginas/SetorDetalhe.tsx` (remover botão Sugerir TS)

**Decisão do analyst (linha 335):** "O Sugerir TS deve MORRER como botão separado." A redistribuição hierárquica do sugerir deve rodar AUTOMATICAMENTE dentro do `gerarCicloFase1`, a cada mudança no preview.

**Comportamento do automático inteligente:**
1. `pickBestFolgaDay` distribui folgas (já faz)
2. **NOVO:** Após distribuir, checar se algum dia auto-atribuído causa déficit
3. **NOVO:** Se causa, redistribuir APENAS os auto-atribuídos (weight=100), nunca os manuais/salvos
4. **NOVO:** Se redistribuição resolve, aplicar automaticamente COM FEEDBACK VISUAL (ver abaixo)
5. Se redistribuição NÃO resolve (déficit causado por pin manual/salvo), gerar WARNING hierárquico
6. Drawer SÓ abre via CP-SAT advisory (botão "Sugerir" ou gate no "Gerar")

**⚠️ UX CRÍTICA — Redistribuição NUNCA é silenciosa:**

O sistema NÃO pode mover folgas sem que o RH SAIBA. Folgas "dançando sozinhas" = "tá bugado". Feedback obrigatório:

1. **No grid:** Folgas auto-redistribuídas devem ter indicador visual sutil — ícone de seta (↻) ou cor levemente diferente da folga manual
2. **Tooltip na célula:** "O sistema moveu esta folga de SEG para QUA para melhorar a cobertura"
3. **Info banner compacto no topo do preview** (quando houve redistribuição): "O sistema ajustou {N} folga(s) automática(s) para otimizar cobertura" — tom neutro, sem alarme
4. O banner NÃO é um blocker, NÃO abre drawer, NÃO pede ação — é informativo. O RH vê e segue a vida.

**O que muda no `gerarCicloFase1`:**

```typescript
// Após PASSO 2 (distribuição 5x2), ANTES do PASSO 3 (repair H1):
// NOVO PASSO 2b: Redistribuição automática dos auto-atribuídos
for (let tentativa = 0; tentativa < 3; tentativa++) {
  const diasComDeficit = calcularDiasComDeficit(grid, demandaPorDia)
  if (diasComDeficit.length === 0) break

  for (const dia of diasComDeficit) {
    // Encontrar pessoa AUTO-ATRIBUÍDA que tem folga neste dia
    const candidato = encontrarFolgaAutoRedistribuivel(grid, dia, folgas_origem)
    if (!candidato) continue // Só manual/salvo — não mexe

    // Mover folga auto pra dia com mais sobra
    const melhorDia = pickBestFolgaDay(demandaPorDia, dia)
    if (melhorDia && melhorDia !== dia) {
      grid[candidato.pessoa][dia] = 'T'
      grid[candidato.pessoa][melhorDia] = 'F'
      // Atualizar contadores
    }
  }
}
```

**Parâmetro necessário:** `gerarCicloFase1` precisa receber info de ORIGIN das folgas (quais são auto vs manual vs salvo) pra saber quais pode mover. Adicionar parâmetro `folgasOrigin?: Map<string, PinOrigin>` à assinatura.

- [ ] **Step 1: Add origin tracking to gerarCicloFase1**

Adicionar parâmetro `folgasOrigin` que mapeia `${pessoaIdx}_${diaSemana}` → `PinOrigin`. Construído no SetorDetalhe a partir de overrides e regras do BD.

- [ ] **Step 2: Implement auto-redistribution loop after PASSO 2**

A redistribuição só move folgas com `origin === 'auto'`. Pins `manual` e `saved` são intocáveis.

- [ ] **Step 3: Remove `sugerirTSHierarquico` and `sugerirTSProgressivo`**

Remover de `simula-ciclo.ts`:
- `sugerirTSHierarquico` (linhas ~470-529)
- `sugerirTSProgressivo` (se existir)
- Tipos/exports associados

- [ ] **Step 4: Remove botão "Sugerir" TS do SetorDetalhe**

O botão "Sugerir" no SetorDetalhe.tsx atualmente chama `sugerirTSHierarquico`. Mudar para chamar `runAdvisory` (CP-SAT). Ver Task 8.

- [ ] **Step 5: Typecheck + Test**

Run: `npm run typecheck && npm run test`

- [ ] **Step 6: Commit**

```bash
git add src/shared/simula-ciclo.ts src/renderer/src/paginas/SetorDetalhe.tsx
git commit -m "feat: merge sugerir logic into automatic preview redistribution

pickBestFolgaDay now auto-redistributes auto-assigned pins when they cause
deficit. Manual/saved pins are never moved. sugerirTSHierarquico removed.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Mensagens hierárquicas por origin

**Files:**
- Modify: `src/shared/preview-diagnostics.ts`
- Modify: `src/renderer/src/lib/build-avisos.ts` (se existir como arquivo separado)

**O analyst propõe (linhas 351-381):** as mensagens de aviso devem refletir a ORIGIN do pin que causa o problema:

| Origin do pin | Mensagem | Tom |
|---------------|----------|-----|
| `auto` (peso 100) | Feedback visual sutil no grid (ícone ↻ + tooltip). SEM warning textual — sistema já redistribuiu (Task 6) | Visual discreto |
| `manual` (RH escolheu) | "Folga de {nome} em {dia} (sua escolha): sobram {X} pessoa(s), demanda é {Y}. O sistema vai respeitar." | Informativo com números |
| `saved` (BD) | "Folga de {nome} em {dia} está definida no cadastro. Sobram {X}, demanda é {Y}. [Editar cadastro]" | Estrutural com link direto |

**Princípio:** A mensagem NUNCA diz "mude o que você acabou de fazer". Se o déficit é causado por pin auto, o sistema já redistribuiu (Task 6) e mostra feedback visual discreto. Se é causado por pin manual, INFORMA com dados numéricos mas não manda mudar. Se é causado por pin salvo, informa E dá link direto pra editar o cadastro.

**⚠️ UX REGRAS DE LINGUAGEM (OBRIGATÓRIAS):**
- NUNCA usar: "restrição", "constraint", "motor", "solver", "pin", "origin", "weight", "relaxação", "viabilizar"
- SEMPRE usar: "sistema", "escala", "folga", "cadastro", "escolha"
- Manter DETALHE NUMÉRICO: "sobram X, demanda é Y" — o RH precisa do número pra decidir
- Mensagens saved DEVEM ter link/botão direto pra editar (não só texto "edite a regra")

- [ ] **Step 1: Update warning generation in preview-diagnostics.ts**

Localizar onde `FF_CONFLITO` e `FV_CONFLITO` são gerados. Adicionar campo `origin` ao diagnóstico e condicionar a mensagem:

```typescript
// Quando origin é 'auto': NÃO gerar diagnóstico textual
// (o feedback visual já foi aplicado no grid pela Task 6 — ícone ↻ + tooltip)
if (folgaOrigin === 'auto') continue

// Quando origin é 'manual':
diagnostics.push({
  code: 'FOLGA_MANUAL_DEFICIT',
  severity: 'warning',
  gate: 'ALLOW',
  title: `Folga de ${nome} em ${NOMES_DIA[dia]} (sua escolha): sobram ${sobra}, demanda é ${demanda}`,
  detail: 'O sistema vai respeitar essa escolha ao gerar a escala.',
})

// Quando origin é 'saved':
diagnostics.push({
  code: 'FOLGA_SALVA_DEFICIT',
  severity: 'info',
  gate: 'ALLOW',
  title: `Folga de ${nome} em ${NOMES_DIA[dia]} (cadastro): sobram ${sobra}, demanda é ${demanda}`,
  detail: 'Esta folga está definida no cadastro do colaborador.',
  // NOVO: metadata pra UI renderizar link direto
  action: { type: 'navigate', target: 'colaborador', id: colaboradorId },
})
```

**Nota sobre link direto:** O `action` é metadata — o renderer decide como usar. Pode ser link pra página do colaborador, ou botão inline "Editar cadastro". O diagnostic NÃO renderiza o link sozinho.

- [ ] **Step 2: Update capacity messages**

Substituir "Capacidade insuficiente" genérico por:

```typescript
title: `Faltam ${deficit} pessoa(s) para cobrir ${NOMES_DIA[dia]}. Contrate ou reduza demanda.`
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`

- [ ] **Step 4: Commit**

```bash
git add src/shared/preview-diagnostics.ts
git commit -m "feat: origin-aware warning messages in preview

Auto-assigned pins are silent (system handles them).
Manual pins: 'you chose this, motor will work with it'.
Saved pins: 'structural limitation, edit the rule to change'.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: SugestaoSheet exclusivo CP-SAT + gate inteligente + escape hatch

**Files:**
- Modify: `src/renderer/src/componentes/SugestaoSheet.tsx`
- Modify: `src/renderer/src/paginas/SetorDetalhe.tsx`

**O drawer agora é EXCLUSIVO do CP-SAT advisory.** Os status TS (`TS_REDISTRIBUIU`, `TS_NAO_RESOLVEU`, `TS_FALHOU`) morrem.

**⚠️ REGRAS UX INVIOLÁVEIS (DoD — Definition of Done):**

1. **ZERO termos técnicos na UI:** "pin", "origin", "weight", "custo N", "band", "constraint", "violation" NUNCA aparecem. GREP no código pra garantir.
2. **Gate inteligente (3 níveis):**
   - `pin_cost === 0` → gera direto (sem interrupção)
   - `pin_cost > 0 mas só auto` → gera direto + toast "O sistema ajustou {N} folga(s) para otimizar" (NÃO abre drawer)
   - `pin_cost > 0 com manual/saved violado` → AÍ SIM abre drawer (sistema quer mexer no que o RH escolheu)
3. **Escape hatch obrigatório:** Drawer DEVE ter botão "Gerar mesmo assim" (secundário/ghost). Sem ele = loop infinito (RH fecha drawer → clica Gerar → drawer abre de novo).
4. **Loading state no botão:** "Gerar Escala" → "Analisando..." (imediato, durante advisory) → "Gerando..." (durante solver). O RH nunca vê 5s de nada acontecendo.
5. **Drawer humanizado:** Agrupar por PESSOA, não por "origin". Texto: "{nome}: folga {dia_atual} → {dia_proposto}". Sem "custo total" no rodapé.
6. **Cache do advisory:** Usar `computeAdvisoryInputHash` (já existe) pra não respawnar Python se o input não mudou. Gate instantâneo quando cacheado.

- [ ] **Step 1: Remove TS status codes from SugestaoSheet**

Remover tratamento de `TS_REDISTRIBUIU`, `TS_NAO_RESOLVEU`, `TS_FALHOU`. O drawer só mostra:
- `CURRENT_VALID`: "Suas folgas estão OK!" (com pin_cost=0)
- `PROPOSAL_VALID`: lista de mudanças por pessoa
- `NO_PROPOSAL`: "Não foi possível encontrar um arranjo viável com a equipe atual"

- [ ] **Step 2: Redesign drawer content — humanizado, por pessoa**

O drawer mostra mudanças AGRUPADAS POR PESSOA, sem termos técnicos:

```
┌─────────────────────────────────────────────────────────┐
│ Sugestão de ajuste                                      │
│                                                         │
│ Para que a escala funcione, o sistema sugere:            │
│                                                         │
│ 📋 Ajustes automáticos (sistema decidiu)                │  ← colapsável, starts collapsed
│    Milena: folga segunda → terça                        │
│    Rafaela: folga quinta → sexta                        │
│                                                         │
│ ⚠️ Mudanças nas suas escolhas                           │  ← expandido, destaque
│    Cleunice: turno da manhã → dia inteiro (quarta)      │
│    Maria: folga terça → quarta (sua escolha manual)     │
│                                                         │
│ [Aceitar e Gerar]  [Gerar mesmo assim]  [Cancelar]      │
└─────────────────────────────────────────────────────────┘
```

**Nota:** "Ajustes automáticos" começa COLAPSADO (o RH não precisa ver). "Mudanças nas suas escolhas" começa EXPANDIDO (é o que importa).

- [ ] **Step 3: Add escape hatch — "Gerar mesmo assim"**

Botão secundário/ghost no footer do drawer. Quando clicado:
- Fecha o drawer
- Gera a escala COM as folgas originais do RH (ignora sugestão do advisory)
- Toast: "Escala gerada com as suas folgas originais"

```typescript
const handleGerarSemAceitar = async () => {
  setShowSugestaoSheet(false)
  // Gera com pins originais (sem aplicar diff do advisory)
  await handleGerarEscala()
}
```

- [ ] **Step 4: Rewire botão "Sugerir" → CP-SAT advisory**

Em SetorDetalhe.tsx, o handler do botão "Sugerir":

```typescript
const handleSugerir = async () => {
  setSugerindo(true)
  try {
    const advisoryInput = buildAdvisoryInput()
    const result = await runAdvisory(advisoryInput)
    setAdvisoryResult(result)
    setShowSugestaoSheet(true)
  } finally {
    setSugerindo(false)
  }
}
```

- [ ] **Step 5: Gate inteligente no "Gerar" (3 níveis)**

```typescript
const handleGerarComGate = async () => {
  // Loading state imediato
  setGerandoLabel('Analisando...')

  // Cache check — se input não mudou, usa resultado anterior
  const advisoryResult = await runAdvisoryComCache(buildAdvisoryInput())

  const violations = advisoryResult.pin_violations ?? []
  const temMudancaManualOuSalva = violations.some(
    v => v.origin === 'manual' || v.origin === 'saved'
  )

  if (violations.length === 0) {
    // Nível 1: custo=0 → gera direto
    setGerandoLabel('Gerando...')
    await handleGerarEscala()
    return
  }

  if (!temMudancaManualOuSalva) {
    // Nível 2: só autos → gera direto + toast informativo
    setGerandoLabel('Gerando...')
    await handleGerarEscala()
    toast.info(`O sistema ajustou ${violations.length} folga(s) automática(s) para otimizar a cobertura`)
    return
  }

  // Nível 3: mudança em manual/saved → abre drawer
  setGerandoLabel(null)
  setAdvisoryResult(advisoryResult)
  setShowSugestaoSheet(true)
}
```

- [ ] **Step 6: Loading state no botão**

O botão "Gerar Escala" deve mostrar estado intermediário:

```tsx
<Button onClick={handleGerarComGate} disabled={!!gerandoLabel}>
  {gerandoLabel ? (
    <><Loader2 className="size-4 animate-spin mr-2" />{gerandoLabel}</>
  ) : (
    'Gerar Escala'
  )}
</Button>
```

`gerandoLabel` é state: `null` (normal) → `'Analisando...'` (advisory) → `'Gerando...'` (solver) → `null` (fim).

- [ ] **Step 7: Typecheck + test manual**

Run: `npm run typecheck`

Checklist manual:
1. Gerar com tudo OK → gera direto, sem drawer, sem delay extra ✅
2. Gerar com autos redistribuídos → gera direto + toast "ajustou N folgas" ✅
3. Gerar com manual violado → drawer abre com mudanças por pessoa ✅
4. Drawer: "Aceitar e Gerar" → aplica diff + gera ✅
5. Drawer: "Gerar mesmo assim" → ignora diff + gera com folgas originais ✅
6. Drawer: "Cancelar" → fecha sem gerar ✅
7. Botão mostra "Analisando..." → "Gerando..." → resultado ✅
8. GREP: zero ocorrências de "pin", "origin", "weight", "custo", "band" em strings user-facing ✅

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/componentes/SugestaoSheet.tsx src/renderer/src/paginas/SetorDetalhe.tsx
git commit -m "feat: SugestaoSheet CP-SAT exclusive + intelligent gate + escape hatch

3-level gate: cost=0 direct, auto-only direct+toast, manual/saved opens drawer.
Drawer humanized: grouped by person, no technical terms, collapsible auto section.
Escape hatch: 'Gerar mesmo assim' avoids infinite loop.
Loading: 'Analisando...' → 'Gerando...' on button.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Suprimir avisos absorvidos pelo advisory

**Files:**
- Modify: `src/shared/preview-diagnostics.ts`
- Modify: `src/renderer/src/lib/build-avisos.ts`

**O analyst mapeia (linhas 1131-1141):** avisos que morrem ou são absorvidos:

| Aviso | Ação |
|-------|------|
| D5 (`PREVIEW_ESTRITO_BLOQUEADO`) | **REMOVER** — advisory hierárquico NUNCA é INFEASIBLE por pins |
| W1-W3 (`FF_CONFLITO`, `FV_CONFLITO`) | **SUBSTITUÍDOS** pela Task 7 (mensagens por origin) |
| D6-D8 (`FOLGA_*_CONFLITO` convertidos) | **SUBSTITUÍDOS** pela Task 7 |
| D9 (`ADVISORY_*`) | **SUBSTITUÍDOS** pelo diff hierárquico no drawer |

- [ ] **Step 1: Remove D5 from preview-diagnostics.ts**

Remover ou condicionar D5 (`PREVIEW_ESTRITO_BLOQUEADO`). Este diagnóstico era gerado quando o preview multi-pass falhava. Com o advisory hierárquico (que nunca é INFEASIBLE por pins), D5 não faz sentido.

- [ ] **Step 2: Remove/replace D6-D8 with origin-aware versions**

D6-D8 eram conversões de W1-W3. Com a Task 7 gerando mensagens por origin, estes podem ser removidos ou condicionados a `!hasOriginTracking`.

- [ ] **Step 3: Remove D9 (ADVISORY_*) diagnostics**

D9 era o output do advisory antigo (3 fases binárias). O novo advisory produz `pin_violations` que vão pro drawer, não pra diagnostics do preview.

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`

- [ ] **Step 5: Commit**

```bash
git add src/shared/preview-diagnostics.ts src/renderer/src/lib/build-avisos.ts
git commit -m "feat: suppress dead diagnostics absorbed by advisory hierarchy

Remove D5 (PREVIEW_ESTRITO_BLOQUEADO — advisory never INFEASIBLE by pins).
Replace D6-D8 (FOLGA_*_CONFLITO) with origin-aware messages.
Remove D9 (ADVISORY_*) — replaced by drawer diff.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Fase 5: Pipeline Limpo + Circuito Completo

### Task 10: Persistir resultado do advisory com a escala

**Files:**
- Modify: `src/main/db/schema.ts` (adicionar coluna `advisory_aceito_json` na tabela `escalas`)
- Modify: `src/main/tipc.ts` (salvar advisory result via UPDATE após geração + carregar em `escalasBuscar`)
- Modify: `src/renderer/src/paginas/EscalaPagina.tsx` (expandir banner inline pra mostrar advisory aceito)

**Estado atual após Plan A:**
- `diagnostico_json` JÁ EXISTE na tabela `escalas` (migration v30). Contém `pass_usado`, `regras_relaxadas`, `generation_mode`, etc.
- `escalasBuscar` JÁ carrega `diagnostico_json` e anexa a `EscalaCompletaV3.diagnostico`.
- `EscalaPagina.tsx` JÁ tem banner inline (~20 linhas) que lê `escalaCompleta.diagnostico` e mostra relaxações do solver.
- `EscalaResultBanner.tsx` FOI DELETADO — era código morto. O banner é inline.
- O banner usa `textoResumoRelaxacoes()` de `src/shared/resumo-user.ts`.

**Problema:** Após o RH aceitar o drawer e gerar a escala, o diff aceito (quais pins o advisory mudou) DESAPARECE. O banner pós-geração mostra relaxações do SOLVER (MIN_DIARIO, TIME_WINDOW) via `diagnostico_json`. Mas o RH não sabe mais o que ACEITOU mudar no advisory.

**Solução:** Persistir advisory aceito E expandir o banner inline pra mostrar as duas camadas.

- [ ] **Step 1: Adicionar coluna `advisory_aceito_json` na tabela `escalas`**

Em `schema.ts`, na migration incremental (APÓS v30 que já existe):

```sql
-- v31
ALTER TABLE escalas ADD COLUMN IF NOT EXISTS advisory_aceito_json TEXT;
```

Usar `addColumnIfMissing('escalas', 'advisory_aceito_json', 'TEXT')` — este é o helper correto (NÃO `safeAddColumn`).

Conteúdo: JSON com `{ pin_violations: [...], pin_cost: number }` do advisory que foi aceito. NULL se o advisory não rodou ou custo=0.

- [ ] **Step 2: Salvar advisory result ao persistir escala**

Em `tipc.ts`, no handler `escalasGerar` (ou no caller que invoca `persistirSolverResult`), DEPOIS de persistir, UPDATE com o advisory aceito:

```typescript
// Se houve advisory aceito (gate ou sugerir), salvar junto
if (advisoryAccepted) {
  await execute(
    'UPDATE escalas SET advisory_aceito_json = $1 WHERE id = $2',
    JSON.stringify(advisoryAccepted), escalaId,
  )
}
```

O `advisoryAccepted` vem do state do SetorDetalhe (resultado do advisory que o RH aceitou no drawer). Precisa ser propagado via IPC como parâmetro adicional do handler de geração.

**Nota:** `persistirSolverResult` em `solver-bridge.ts` já recebe `solverResult` e salva `diagnostico_json`. Para `advisory_aceito_json`, preferir UPDATE separado (o advisory vem do renderer, não do solver Python).

- [ ] **Step 3: Carregar advisory_aceito_json em escalasBuscar**

Em `tipc.ts`, `escalasBuscar` já carrega `SELECT * FROM escalas` — `advisory_aceito_json` vem automaticamente.

Parsear e anexar ao resultado:

```typescript
// Já existente (Plan A):
const diagnosticoFromDb = (escala as any).diagnostico_json
  ? JSON.parse((escala as any).diagnostico_json)
  : undefined

// NOVO (Plan B):
const advisoryAceito = (escala as any).advisory_aceito_json
  ? JSON.parse((escala as any).advisory_aceito_json)
  : undefined

// Incluir no return:
...(advisoryAceito ? { advisory_aceito: advisoryAceito } : {}),
```

Adicionar `advisory_aceito?: { pin_violations: PinViolation[]; pin_cost: number }` a `EscalaCompletaV3` em `src/shared/types.ts`.

- [ ] **Step 4: Expandir banner inline em EscalaPagina**

O banner inline existente (~20 linhas, após o PageHeader) mostra UMA linha: relaxações do solver.

Expandir pra mostrar DUAS camadas quando advisory_aceito existe:

```tsx
{escalaCompleta?.diagnostico && (() => {
  // ... (banner existente — relaxações do solver)
  // ADICIONAR se advisory_aceito:
  const advisoryAceito = (escalaCompleta as any).advisory_aceito
  if (advisoryAceito?.pin_violations?.length > 0) {
    // "Você aceitou: Milena folga SEG→TER, Rafaela folga QUI→SEX"
  }
})()}
```

O card "Ajustes do Motor" na aba Apontamentos pode ser expandido de forma similar.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`

- [ ] **Step 6: Commit**

```bash
git add src/main/db/schema.ts src/main/tipc.ts src/shared/types.ts src/renderer/src/paginas/EscalaPagina.tsx
git commit -m "feat: persist advisory result with escala for post-gen transparency

Stores accepted advisory diff in escalas.advisory_aceito_json.
EscalaPagina banner shows what RH accepted + what solver relaxed.
Complete feedback circuit: pre-gen (drawer) + post-gen (banner).

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: Remover Pass 1b + Pass 2 mantém pins + warm-start

**Files:**
- Modify: `solver/solver_ortools.py` (multi-pass logic)
- Modify: `src/main/motor/solver-bridge.ts` (pass handling)

- [ ] **Step 1: Identify multi-pass logic in Python**

Localizar onde Pass 1, 1b, 2, 3 são definidos em `solver_ortools.py` (na função `solve` ou `run_model`). O fluxo atual é:

```python
# Pass 1: full policy + Phase 1 pins
# Pass 1b: keep OFFs, strip bands, relax DIAS_TRABALHO + MIN_DIARIO
# Pass 2: strip all pins, relax DIAS_TRABALHO + MIN_DIARIO
# Pass 3: emergency
```

Remover Pass 1b. Pass 2 muda: MANTÉM pins do advisory (só relaxa MIN_DIARIO, TIME_WINDOW, H10).

- [ ] **Step 2: Add warm-start from advisory pattern**

O `build_model` JÁ TEM `apply_warm_start_hints` (linha 233-244 do solver_ortools.py). A ideia é reutilizar esse mecanismo existente, convertendo o advisory pattern em hints.

Na função `solve()`, após `build_model()` retornar o modelo e variáveis, se o advisory produziu um pattern:

```python
# OFFs from advisory → pin via model.Add (HARD — advisory garantiu)
if pinned_folga:
    for (c, d), band in pinned_folga.items():
        if band == 0:  # OFF
            for s in range(S):
                model.Add(work[c, d, s] == 0)
        else:
            # Bandas como hints (orientação suave)
            # Converter band → slots aproximados usando S/2 como midpoint
            mid_s = S // 2
            if band == 1:  # MANHA
                for s in range(S):
                    model.AddHint(work[c, d, s], 1 if s < mid_s else 0)
            elif band == 2:  # TARDE
                for s in range(S):
                    model.AddHint(work[c, d, s], 1 if s >= mid_s else 0)
            elif band == 3:  # INTEGRAL
                for s in range(S):
                    model.AddHint(work[c, d, s], 1)
```

**Nota:** O warm-start existente (`apply_warm_start_hints`) trabalha com alocações de escalas anteriores (hint temporal). Este novo warm-start trabalha com o advisory pattern (hint estrutural). Ambos podem coexistir — `model.AddHint` é aditivo.

- [ ] **Step 3: Run existing solver tests**

Run: `npm run solver:test`
Expected: ALL PASS

- [ ] **Step 4: Run solver CLI with 3-month period**

Run: `npm run solver:cli -- 2 2026-03-02 2026-05-31 --summary`
Expected: Success, cycle consistent

- [ ] **Step 5: Commit**

```bash
git add solver/solver_ortools.py src/main/motor/solver-bridge.ts
git commit -m "feat: remove Pass 1b, simplify multi-pass with warm-start

Pass 1b eliminated (advisory handles bands + DIAS_TRABALHO).
Pass 2 now keeps advisory pins, only relaxes slot-level constraints.
Warm-start: advisory OFFs as HARD pins, bands as AddHint.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Fase 6: Calibração e Verificação Final

### Task 12: Calibrar pesos com dados reais

**Files:**
- Modify: `src/shared/types.ts` (ajustar PIN_WEIGHTS se necessário)

- [ ] **Step 1: Run 10+ scenarios with real data**

```bash
# Açougue (setor 2) — 1 semana
npm run solver:cli -- 2 2026-03-02 2026-03-08 --json

# Açougue — 4 semanas
npm run solver:cli -- 2 2026-03-02 2026-03-29 --json

# Açougue — 3 meses
npm run solver:cli -- 2 2026-03-02 2026-05-31 --json

# Caixa (setor 1) — mesmos períodos
npm run solver:cli -- 1 2026-03-02 2026-03-08 --json
npm run solver:cli -- 1 2026-03-02 2026-03-29 --json
```

Para cada cenário, verificar no output:
- `pin_violations` — quais pins foram violados?
- `pin_cost` — custo total aceitável?
- Nenhum pin `manual` ou `saved` violado por ganho de spread?

- [ ] **Step 2: Ajustar PIN_WEIGHTS se necessário**

Se pins manuais/saved forem violados, multiplicar pesos por 10x:

```typescript
export const PIN_WEIGHTS: Record<PinOrigin, number> = {
  auto: 1000,
  accepted: 5000,
  manual: 50000,
  saved: 100000,
} as const
```

- [ ] **Step 3: Run solver tests again**

Run: `npm run solver:test`
Expected: ALL PASS

- [ ] **Step 4: Commit**

```bash
git add src/shared/types.ts
git commit -m "chore: calibrate PIN_WEIGHTS with real data

Adjusted pin weights after testing with Supermercado Fernandes data.
Ensures manual/saved pins are never violated for spread gains.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 13: Verificação E2E + DoD (Definition of Done)

---

## Definition of Done — BLOQUEADORES DE MERGE

**Nenhuma task é "done" sem estes critérios. Se falhar em 1, não mergeia.**

### DoD 1: ZERO termos técnicos na UI

```bash
# GREP OBRIGATÓRIO — rodar antes de CADA commit de UI
grep -rn '".*pin\|".*origin\|".*weight\|".*custo [0-9]\|".*band\|".*constraint\|".*violation\|".*solver\|".*relaxa\|".*viabilizar\|".*motor"' \
  src/renderer/src/ --include="*.tsx" --include="*.ts" \
  | grep -v "// " | grep -v "console\." | grep -v "import "
```

Se retornar QUALQUER match em string user-facing (tooltip, título, mensagem, placeholder), é BLOCKER.

Termos PROIBIDOS na UI: `pin`, `origin`, `weight`, `custo N`, `band`, `constraint`, `violation`, `solver`, `relaxação`, `flexibilizad`, `viabilizar`, `motor` (isolado, sem "motor de cálculo")

Termos PERMITIDOS: `sistema`, `escala`, `folga`, `cadastro`, `escolha`, `ajuste`, `cobertura`, `demanda`, `motor de cálculo`

### DoD 2: Escape hatch no drawer

O drawer do gate DEVE ter 3 botões:
- **"Aceitar e Gerar"** (primário) — aplica diff + gera
- **"Gerar mesmo assim"** (secundário/ghost) — ignora diff + gera com folgas originais
- **"Cancelar"** (text/link) — fecha sem gerar

Sem "Gerar mesmo assim" = loop infinito = BLOCKER.

### DoD 3: Loading state no botão Gerar

O botão "Gerar Escala" DEVE mostrar:
- `'Analisando...'` durante o advisory (~1-5s)
- `'Gerando...'` durante o solver (~5-120s)
- Voltar ao normal quando terminar

5s de botão travado sem feedback visual = BLOCKER.

### DoD 4: Gate inteligente (3 níveis)

| Cenário | Comportamento esperado |
|---------|----------------------|
| Advisory custo=0 | Gera direto. Nenhuma interrupção. |
| Advisory custo>0, só auto | Gera direto + toast "O sistema ajustou N folgas" |
| Advisory custo>0, manual/saved violado | Abre drawer. RH decide. |

Se auto-only abre drawer = BLOCKER (interrupção desnecessária).

### DoD 5: Feedback visual de auto-redistribuição

Folgas movidas automaticamente no preview DEVEM ter indicador visual:
- Ícone sutil (↻) ou cor diferenciada na célula do grid
- Tooltip explicando "O sistema moveu esta folga de SEG para QUA para melhorar a cobertura"

Folgas que "dançam" sem feedback visual = BLOCKER.

### DoD 6: Mensagens com dados numéricos

Warnings de folga manual/saved DEVEM incluir números:
- "sobram X pessoa(s), demanda é Y"

Mensagem genérica sem número = BLOCKER.

### DoD 7: Testes passando

- `npm run typecheck` → 0 errors
- `npm run test` → ALL PASS
- `npm run solver:test` → ALL PASS

---

- [ ] **Step 1: Full typecheck**

Run: `npm run typecheck`
Expected: 0 errors

- [ ] **Step 2: Run all tests**

Run: `npm run test`
Expected: ALL PASS

- [ ] **Step 3: Run solver tests**

Run: `npm run solver:test`
Expected: ALL PASS

- [ ] **Step 4: GREP de termos técnicos (DoD 1)**

Run the grep command from DoD 1.
Expected: ZERO matches in user-facing strings.

- [ ] **Step 5: Manual E2E checklist**

**Preview automático (Task 6):**
1. Abrir SetorDetalhe do Açougue ✅
2. Preview auto-distribui folgas (pickBestFolgaDay) ✅
3. Se auto-folga causa déficit, preview redistribui e mostra ícone ↻ na célula ✅ (DoD 5)
4. Tooltip na célula redistribuída: "O sistema moveu esta folga..." ✅ (DoD 5)
5. Info banner compacto no topo: "O sistema ajustou N folga(s)..." ✅ (DoD 5)
6. Trocar folga MANUALMENTE → warning com números: "sobram X, demanda Y" ✅ (DoD 6)
7. Warning saved tem link/botão "Editar cadastro" ✅
8. Warning NÃO diz "mude o que você fez" — só informa ✅

**Sugerir CP-SAT (Task 8):**
9. Clicar "Sugerir" → drawer CP-SAT (NÃO TS antigo) ✅
10. Drawer agrupa por PESSOA (não por "origin") ✅
11. Seção "Ajustes automáticos" colapsada por default ✅
12. Seção "Mudanças nas suas escolhas" expandida com destaque ✅
13. ZERO termos técnicos no drawer (GREP) ✅ (DoD 1)
14. Nenhum status TS_REDISTRIBUIU/TS_NAO_RESOLVEU ✅
15. D5/D6-D8/D9 NÃO aparecem ✅

**Gate no Gerar (Task 8):**
16. Gerar com custo=0 → gera direto, sem drawer, sem delay extra ✅ (DoD 4)
17. Gerar com auto-only violados → gera direto + toast info ✅ (DoD 4)
18. Gerar com manual/saved violado → drawer abre ✅ (DoD 4)
19. Botão mostra "Analisando..." → "Gerando..." ✅ (DoD 3)
20. Drawer tem "Aceitar e Gerar" + "Gerar mesmo assim" + "Cancelar" ✅ (DoD 2)
21. "Gerar mesmo assim" → gera com folgas originais, sem loop ✅ (DoD 2)
22. "Cancelar" → fecha sem gerar, sem side effects ✅

**Pós-geração (Plan A + Task 10):**
23. Toast informativo (verde ou amarelo) ✅
24. Escala no histórico → informação de relaxação visível ✅
25. Advisory aceito persistido → visível ao reabrir escala (info colapsável) ✅
26. Chat IA: "como está minha escala?" → menciona relaxações ✅

**Regressão:**
27. Gerar sem advisory (equipe folgada) → funciona como antes ✅
28. Pins sem origin/weight (legado) → HARD, sem pin_violations ✅
29. Solver CLI 3 meses → resultado consistente ✅
30. Nenhum console.log de debug esquecido ✅

- [ ] **Step 6: Final commit (se ajustes)**

```bash
git add -A
git commit -m "fix: E2E adjustments for advisory hierarchy

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```
