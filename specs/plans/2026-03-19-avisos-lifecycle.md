# Avisos Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the avisos (validation messages) system so that messages never mix temporal contexts, jargon never leaks to RH users, and validation confidence is derived from evidence — not manual state management.

**Architecture:** Phase-based FSM manages what's visible when. Three surfaces (inline preview, drawer, operation feedback) never cross-contaminate. A hash-based snapshot system tracks solver validation depth, showing the RH user exactly how much confidence to place in the current arrangement. A focused humanization layer translates solver jargon into plain Portuguese.

**Tech Stack:** TypeScript, React 19, Zustand, Vitest, shadcn/ui (Badge)

**Spec:** `specs/PLAN_AVISOS_LIFECYCLE.md`

---

## File Map

| Action | File | Responsibility |
|--------|------|---------------|
| CREATE | `src/shared/advisory-hash.ts` | Isomorphic hash function for advisory input (shared between main + renderer) |
| CREATE | `src/renderer/src/lib/humanizar-operacao.ts` | Translate solver/preflight messages to RH-friendly Portuguese |
| CREATE | `src/renderer/src/componentes/ValidationTag.tsx` | Badge showing validation confidence level |
| CREATE | `src/renderer/src/hooks/useAvisosController.ts` | FSM phase + surface derivation + confidence computation |
| MODIFY | `src/shared/advisory-types.ts` | Add `ValidationSnapshot`, `ValidationConfidence`, `OperationFeedback`, `normalizeSnapshot` |
| MODIFY | `src/main/motor/advisory-controller.ts` | Import hash from shared instead of local |
| MODIFY | `src/shared/setor-simulacao.ts` | Update `advisory` field type to accept `ValidationSnapshot` |
| MODIFY | `src/renderer/src/componentes/SugestaoSheet.tsx` | Receive proposal diagnostics instead of current diagnostics |
| MODIFY | `src/renderer/src/componentes/AvisosSection.tsx` | Import `Aviso` from `humanizar-operacao.ts` instead of defining locally |
| MODIFY | `src/renderer/src/paginas/SetorDetalhe.tsx` | Integrate hook, unify buttons, derive proposal preview, persist snapshots |
| DELETE | `src/renderer/src/lib/build-avisos.ts` | Replaced by hook-based surface derivation |
| DELETE | `tests/renderer/build-avisos-advisory.spec.ts` | Tests for deleted build-avisos.ts |

---

## Task 1: Foundation Types (`shared/advisory-types.ts`)

**Files:**
- Modify: `src/shared/advisory-types.ts`
- Test: `tests/shared/advisory-types.spec.ts`

- [ ] **Step 1: Write tests for `normalizeSnapshot` and `derivarConfidence`**

```typescript
// tests/shared/advisory-types.spec.ts
import { describe, it, expect } from 'vitest'
import { normalizeSnapshot, derivarConfidence } from '../../src/shared/advisory-types'

describe('normalizeSnapshot', () => {
  it('returns null for null/undefined input', () => {
    expect(normalizeSnapshot(null)).toBeNull()
    expect(normalizeSnapshot(undefined)).toBeNull()
  })

  it('converts legacy SimulacaoAdvisorySnapshot format', () => {
    const legacy = {
      origin: 'accepted_suggestion',
      input_hash: 'abc123',
      accepted_at: '2026-03-19T10:00:00Z',
      advisory_status: 'PROPOSAL_VALID',
      diagnostics: [],
    }
    const result = normalizeSnapshot(legacy)
    expect(result).toEqual({
      input_hash: 'abc123',
      generated_at: '2026-03-19T10:00:00Z',
      outcome: 'VALIDATED',
      source: 'SUGERIR',
      diagnostics: [],
    })
  })

  it('passes through new ValidationSnapshot format', () => {
    const snapshot = {
      input_hash: 'def456',
      generated_at: '2026-03-19T12:00:00Z',
      outcome: 'HAD_WARNINGS',
      source: 'GERAR',
      diagnostics: [],
    }
    expect(normalizeSnapshot(snapshot)).toEqual(snapshot)
  })

  it('returns null for unrecognized object', () => {
    expect(normalizeSnapshot({ foo: 'bar' })).toBeNull()
  })
})

describe('derivarConfidence', () => {
  it('returns UNVALIDATED when no snapshot and gate is not ALLOW', () => {
    expect(derivarConfidence({
      previewGate: 'BLOCK',
      currentInputHash: 'abc',
      snapshot: null,
    })).toBe('UNVALIDATED')
  })

  it('returns TS_ONLY when no snapshot but gate is ALLOW', () => {
    expect(derivarConfidence({
      previewGate: 'ALLOW',
      currentInputHash: 'abc',
      snapshot: null,
    })).toBe('TS_ONLY')
  })

  it('returns DIRTY when snapshot hash diverges from current', () => {
    expect(derivarConfidence({
      previewGate: 'ALLOW',
      currentInputHash: 'abc',
      snapshot: { input_hash: 'xyz', outcome: 'VALIDATED', generated_at: '', source: 'SUGERIR', diagnostics: [] },
    })).toBe('DIRTY')
  })

  it('returns SOLVER_VALIDATED when hashes match and outcome is VALIDATED', () => {
    expect(derivarConfidence({
      previewGate: 'ALLOW',
      currentInputHash: 'abc',
      snapshot: { input_hash: 'abc', outcome: 'VALIDATED', generated_at: '', source: 'SUGERIR', diagnostics: [] },
    })).toBe('SOLVER_VALIDATED')
  })

  it('returns SOLVER_HAD_WARNINGS when hashes match and outcome is HAD_WARNINGS', () => {
    expect(derivarConfidence({
      previewGate: 'ALLOW',
      currentInputHash: 'abc',
      snapshot: { input_hash: 'abc', outcome: 'HAD_WARNINGS', generated_at: '', source: 'SUGERIR', diagnostics: [] },
    })).toBe('SOLVER_HAD_WARNINGS')
  })
})
```

- [ ] **Step 2: Run tests — verify they fail**

Run: `npx vitest run tests/shared/advisory-types.spec.ts`
Expected: FAIL — `normalizeSnapshot` and `derivarConfidence` not found

- [ ] **Step 3: Add types and functions to `advisory-types.ts`**

Add these AFTER the existing types (do NOT remove `SimulacaoAdvisorySnapshot` — it's needed for migration):

```typescript
// --- Validation Snapshot (replaces SimulacaoAdvisorySnapshot) ---

export interface ValidationSnapshot {
  input_hash: string
  generated_at: string
  outcome: 'VALIDATED' | 'HAD_WARNINGS'
  source: 'SUGERIR' | 'GERAR'
  diagnostics: PreviewDiagnostic[]
}

export type ValidationConfidence =
  | 'UNVALIDATED'
  | 'TS_ONLY'
  | 'SOLVER_VALIDATED'
  | 'SOLVER_HAD_WARNINGS'
  | 'DIRTY'

export interface OperationFeedback {
  type: 'INFEASIBLE' | 'PREFLIGHT_BLOCK' | 'PREFLIGHT_WARNING' | 'GENERATE_ERROR'
  message: string
  details?: string[]
  setor_id?: number
}

export function normalizeSnapshot(raw: unknown): ValidationSnapshot | null {
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>
  // Legacy format (SimulacaoAdvisorySnapshot)
  if (obj.origin === 'accepted_suggestion') {
    return {
      input_hash: (obj.input_hash as string) ?? '',
      generated_at: (obj.accepted_at as string) ?? new Date().toISOString(),
      outcome: 'VALIDATED',
      source: 'SUGERIR',
      diagnostics: [],
    }
  }
  // New format (ValidationSnapshot)
  if ('input_hash' in obj && 'outcome' in obj) {
    return obj as unknown as ValidationSnapshot
  }
  return null
}

export function derivarConfidence(params: {
  previewGate: PreviewGate
  currentInputHash: string
  snapshot: ValidationSnapshot | null
}): ValidationConfidence {
  const { previewGate, currentInputHash, snapshot } = params

  if (!snapshot) {
    return previewGate === 'ALLOW' ? 'TS_ONLY' : 'UNVALIDATED'
  }

  if (snapshot.input_hash !== currentInputHash) {
    return 'DIRTY'
  }

  return snapshot.outcome === 'VALIDATED'
    ? 'SOLVER_VALIDATED'
    : 'SOLVER_HAD_WARNINGS'
}
```

NOTE: Add `import type { PreviewGate } from './preview-diagnostics'` at the top of the file if not already imported.

- [ ] **Step 3b: Update `setor-simulacao.ts` advisory field type**

In `src/shared/setor-simulacao.ts`, change the `advisory` field in `SetorSimulacaoConfig`:

```typescript
// BEFORE (line ~27):
advisory?: SimulacaoAdvisorySnapshot | null

// AFTER:
advisory?: ValidationSnapshot | SimulacaoAdvisorySnapshot | null
```

Add the import: `import type { ValidationSnapshot } from './advisory-types'`

This allows writing new `ValidationSnapshot` objects while still reading legacy `SimulacaoAdvisorySnapshot` ones. The `normalizeSnapshot` function handles both formats.

- [ ] **Step 4: Run tests — verify they pass**

Run: `npx vitest run tests/shared/advisory-types.spec.ts`
Expected: ALL PASS

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: 0 errors

- [ ] **Step 6: Commit**

```bash
git add src/shared/advisory-types.ts tests/shared/advisory-types.spec.ts
git commit -m "feat(avisos): add ValidationSnapshot, ValidationConfidence, normalizeSnapshot, derivarConfidence"
```

---

## Task 2: Advisory Hash — Move to Shared (`shared/advisory-hash.ts`)

**Files:**
- Create: `src/shared/advisory-hash.ts`
- Modify: `src/main/motor/advisory-controller.ts`
- Test: `tests/shared/advisory-hash.spec.ts`

- [ ] **Step 1: Write test for isomorphic hash**

```typescript
// tests/shared/advisory-hash.spec.ts
import { describe, it, expect } from 'vitest'
import { computeAdvisoryInputHash } from '../../src/shared/advisory-hash'
import type { EscalaAdvisoryInput } from '../../src/shared/advisory-types'

describe('computeAdvisoryInputHash', () => {
  const baseInput: EscalaAdvisoryInput = {
    setor_id: 2,
    data_inicio: '2026-03-02',
    data_fim: '2026-03-08',
    pinned_folga_externo: [],
    current_folgas: [
      { colaborador_id: 1, fixa: 'SEG', variavel: 'QUA', origem_fixa: 'COLABORADOR', origem_variavel: 'COLABORADOR' },
      { colaborador_id: 2, fixa: 'TER', variavel: 'QUI', origem_fixa: 'COLABORADOR', origem_variavel: 'COLABORADOR' },
    ],
  }

  it('produces a 16-char hex string', () => {
    const hash = computeAdvisoryInputHash(baseInput)
    expect(hash).toMatch(/^[0-9a-f]{16}$/)
  })

  it('is deterministic for same input', () => {
    const h1 = computeAdvisoryInputHash(baseInput)
    const h2 = computeAdvisoryInputHash(baseInput)
    expect(h1).toBe(h2)
  })

  it('is order-independent for current_folgas', () => {
    const reversed = {
      ...baseInput,
      current_folgas: [...baseInput.current_folgas].reverse(),
    }
    expect(computeAdvisoryInputHash(baseInput)).toBe(computeAdvisoryInputHash(reversed))
  })

  it('changes when folgas change', () => {
    const modified = {
      ...baseInput,
      current_folgas: baseInput.current_folgas.map((f, i) =>
        i === 0 ? { ...f, variavel: 'SEX' as const } : f
      ),
    }
    expect(computeAdvisoryInputHash(baseInput)).not.toBe(computeAdvisoryInputHash(modified))
  })
})
```

- [ ] **Step 2: Run test — verify it fails**

Run: `npx vitest run tests/shared/advisory-hash.spec.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Create `shared/advisory-hash.ts`**

The current implementation in `advisory-controller.ts` uses Node's `createHash('sha256')`. The shared version must work in both main (Node) and renderer (browser). Use a simple deterministic string hash (djb2 variant) — this is not security-critical, just change detection.

```typescript
// src/shared/advisory-hash.ts
import type { EscalaAdvisoryInput } from './advisory-types'

/**
 * Deterministic hash of advisory input for change detection.
 * Works in both Node (main) and browser (renderer).
 * NOT cryptographic — just consistent change detection.
 */
export function computeAdvisoryInputHash(input: EscalaAdvisoryInput): string {
  const hashPayload = {
    setor_id: input.setor_id,
    data_inicio: input.data_inicio,
    data_fim: input.data_fim,
    pinned_folga_externo: [...input.pinned_folga_externo].sort(
      (a, b) => a.c - b.c || a.d - b.d
    ),
    current_folgas: [...input.current_folgas]
      .sort((a, b) => a.colaborador_id - b.colaborador_id)
      .map((f) => ({
        colaborador_id: f.colaborador_id,
        fixa: f.fixa,
        variavel: f.variavel,
      })),
    demanda_preview: input.demanda_preview ?? null,
  }
  return hashString(JSON.stringify(hashPayload))
}

/** FNV-1a 64-bit hash, returned as 16-char hex string. */
function hashString(str: string): string {
  let h1 = 0x811c9dc5 | 0
  let h2 = 0x01000193 | 0
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 0x01000193)
    h2 = Math.imul(h2 ^ (c >>> 1), 0x811c9dc5)
  }
  const hex1 = (h1 >>> 0).toString(16).padStart(8, '0')
  const hex2 = (h2 >>> 0).toString(16).padStart(8, '0')
  return hex1 + hex2
}
```

- [ ] **Step 4: Run test — verify it passes**

Run: `npx vitest run tests/shared/advisory-hash.spec.ts`
Expected: ALL PASS

- [ ] **Step 5: Update `advisory-controller.ts` to import from shared**

In `src/main/motor/advisory-controller.ts`:
1. Delete the local `computeAdvisoryInputHash` function (lines ~133-155)
2. Verify `createHash` is ONLY used by `computeAdvisoryInputHash` — grep the file: `grep createHash src/main/motor/advisory-controller.ts`. Result will show line 13 (import) and line 151 (usage inside the function being deleted). Both can be removed safely. Delete the `import { createHash } from 'node:crypto'` line.
3. Add: `import { computeAdvisoryInputHash } from '../../shared/advisory-hash'`
4. Keep the `export` by re-exporting: `export { computeAdvisoryInputHash } from '../../shared/advisory-hash'`

- [ ] **Step 6: Run typecheck + existing tests**

Run: `npm run typecheck && npx vitest run tests/shared/advisory-hash.spec.ts`
Expected: 0 errors, ALL PASS

- [ ] **Step 7: Commit**

```bash
git add src/shared/advisory-hash.ts src/main/motor/advisory-controller.ts tests/shared/advisory-hash.spec.ts
git commit -m "refactor(avisos): move computeAdvisoryInputHash to shared for renderer access"
```

---

## Task 3: Humanization Layer (`humanizar-operacao.ts`)

**Files:**
- Create: `src/renderer/src/lib/humanizar-operacao.ts`
- Test: `tests/renderer/humanizar-operacao.spec.ts`

- [ ] **Step 1: Write tests for humanization mappers**

```typescript
// tests/renderer/humanizar-operacao.spec.ts
import { describe, it, expect } from 'vitest'
import {
  mapPreviewDiagnosticToAviso,
  humanizarInfeasible,
  humanizarOperacao,
} from '../../src/renderer/src/lib/humanizar-operacao'
import type { PreviewDiagnostic } from '../../src/shared/preview-diagnostics'
import type { OperationFeedback } from '../../src/shared/advisory-types'

describe('mapPreviewDiagnosticToAviso', () => {
  it('maps a warning diagnostic to Aviso', () => {
    const diag: PreviewDiagnostic = {
      code: 'CAPACIDADE_DIARIA_INSUFICIENTE',
      severity: 'warning',
      gate: 'ALLOW',
      title: 'Cobertura insuficiente',
      detail: 'Terca: disponiveis=2, minimo requerido=3',
      source: 'capacity',
    }
    const aviso = mapPreviewDiagnosticToAviso(diag)
    expect(aviso.nivel).toBe('warning')
    expect(aviso.titulo).toBe('Cobertura insuficiente')
    expect(aviso.descricao).not.toContain('disponiveis=')
    expect(aviso.id).toContain('CAPACIDADE_DIARIA_INSUFICIENTE')
  })

  it('replaces "Slot" with "Faixa" in detail', () => {
    const diag: PreviewDiagnostic = {
      code: 'DEMANDA_FAIXA',
      severity: 'warning',
      gate: 'ALLOW',
      title: 'Faixa descoberta',
      detail: 'Slot 12:00-13:00 sem cobertura',
      source: 'capacity',
    }
    const aviso = mapPreviewDiagnosticToAviso(diag)
    expect(aviso.descricao).toContain('Faixa')
    expect(aviso.descricao).not.toContain('Slot')
  })
})

describe('humanizarOperacao', () => {
  it('returns empty array for null', () => {
    expect(humanizarOperacao(null)).toEqual([])
  })

  it('translates INFEASIBLE to human-readable message', () => {
    const feedback: OperationFeedback = {
      type: 'INFEASIBLE',
      message: 'INFEASIBLE: model returned status INFEASIBLE after 30s',
      details: ['Try reducing demand', 'Add more collaborators'],
    }
    const avisos = humanizarOperacao(feedback)
    expect(avisos.length).toBe(1)
    expect(avisos[0].descricao).not.toContain('INFEASIBLE')
    expect(avisos[0].nivel).toBe('error')
  })

  it('translates PREFLIGHT_BLOCK with details', () => {
    const feedback: OperationFeedback = {
      type: 'PREFLIGHT_BLOCK',
      message: 'Preflight blocked: insufficient capacity',
      details: ['Terca: 2 disponiveis, 3 necessarios'],
    }
    const avisos = humanizarOperacao(feedback)
    expect(avisos[0].nivel).toBe('error')
    expect(avisos[0].descricao).not.toContain('Preflight')
  })
})
```

- [ ] **Step 2: Run test — verify it fails**

Run: `npx vitest run tests/renderer/humanizar-operacao.spec.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Create `humanizar-operacao.ts`**

```typescript
// src/renderer/src/lib/humanizar-operacao.ts
import type { PreviewDiagnostic } from '@shared/preview-diagnostics'
import type { OperationFeedback } from '@shared/advisory-types'

export interface Aviso {
  id: string
  nivel: 'error' | 'warning' | 'info'
  titulo: string
  descricao: string
  acao?: { label: string; handler: () => void }
  contexto_ia?: string
}

/** Replace solver jargon in detail strings */
function humanizarTexto(text: string): string {
  return text
    .replace(/\bSlot\b/g, 'Faixa')
    .replace(/\bpreview\b/gi, 'simulacao')
    .replace(/disponiveis=(\d+),?\s*minimo requerido=(\d+)/g,
      '$1 pessoas disponiveis, mas a demanda pede $2')
    .replace(/\bINFEASIBLE\b/g, 'inviavel')
}

export function mapPreviewDiagnosticToAviso(diag: PreviewDiagnostic): Aviso {
  return {
    id: `diag-${diag.code}-${diag.source}`,
    nivel: diag.severity,
    titulo: diag.title,
    descricao: humanizarTexto(diag.detail),
    contexto_ia: `[${diag.code}] ${diag.detail}`,
  }
}

export function humanizarOperacao(feedback: OperationFeedback | null): Aviso[] {
  if (!feedback) return []

  const TIPO_CONFIG: Record<OperationFeedback['type'], { titulo: string; nivel: Aviso['nivel'] }> = {
    INFEASIBLE: {
      titulo: 'Nao foi possivel gerar uma escala viavel para este periodo',
      nivel: 'error',
    },
    PREFLIGHT_BLOCK: {
      titulo: 'Pre-requisitos nao atendidos para gerar escala',
      nivel: 'error',
    },
    PREFLIGHT_WARNING: {
      titulo: 'Atencao antes de gerar',
      nivel: 'warning',
    },
    GENERATE_ERROR: {
      titulo: 'Erro ao gerar escala',
      nivel: 'error',
    },
  }

  const config = TIPO_CONFIG[feedback.type]
  const detalhes = feedback.details?.map(humanizarTexto).join('. ') ?? ''

  return [{
    id: `op-${feedback.type}`,
    nivel: config.nivel,
    titulo: config.titulo,
    descricao: detalhes || humanizarTexto(feedback.message),
    contexto_ia: feedback.message,
  }]
}
```

- [ ] **Step 4: Run test — verify it passes**

Run: `npx vitest run tests/renderer/humanizar-operacao.spec.ts`
Expected: ALL PASS

- [ ] **Step 5: Consolidate `Aviso` type — single source of truth**

`AvisosSection.tsx` (line 5-18) currently defines its own `Aviso` interface. This must be consolidated. `humanizar-operacao.ts` becomes the canonical source.

In `src/renderer/src/componentes/AvisosSection.tsx`:
1. Delete the local `Aviso` interface (lines 5-18)
2. Delete `AvisoEscala`-related imports if they exist
3. Add: `import type { Aviso } from '../lib/humanizar-operacao'`
4. The `AvisosSectionProps` interface stays as-is (it references `Aviso` which now comes from the import)

Run: `npm run typecheck`
Expected: 0 errors (the shapes are structurally identical)

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/lib/humanizar-operacao.ts src/renderer/src/componentes/AvisosSection.tsx tests/renderer/humanizar-operacao.spec.ts
git commit -m "feat(avisos): add humanization layer, consolidate Aviso type"
```

---

## Task 4: ValidationTag Component

**Files:**
- Create: `src/renderer/src/componentes/ValidationTag.tsx`

- [ ] **Step 1: Create the component**

```tsx
// src/renderer/src/componentes/ValidationTag.tsx
import { Badge } from '@/components/ui/badge'
import { CheckCircle2, AlertTriangle } from 'lucide-react'
import type { ValidationConfidence } from '@shared/advisory-types'

interface ValidationTagProps {
  confidence: ValidationConfidence
}

const TAG_CONFIG: Record<ValidationConfidence, {
  label: string
  variant: 'default' | 'secondary' | 'outline' | 'destructive'
  className: string
  icon: typeof CheckCircle2 | typeof AlertTriangle | null
} | null> = {
  UNVALIDATED: null,
  TS_ONLY: {
    label: 'Validacao recomendada',
    variant: 'outline',
    className: 'border-yellow-500/50 text-yellow-600 dark:text-yellow-400',
    icon: AlertTriangle,
  },
  SOLVER_VALIDATED: {
    label: 'Validado',
    variant: 'outline',
    className: 'border-emerald-500/50 text-emerald-600 dark:text-emerald-400',
    icon: CheckCircle2,
  },
  SOLVER_HAD_WARNINGS: {
    label: 'Validacao encontrou avisos',
    variant: 'outline',
    className: 'border-orange-500/50 text-orange-600 dark:text-orange-400',
    icon: AlertTriangle,
  },
  DIRTY: {
    label: 'Validacao recomendada',
    variant: 'outline',
    className: 'border-yellow-500/50 text-yellow-600 dark:text-yellow-400',
    icon: AlertTriangle,
  },
}

export function ValidationTag({ confidence }: ValidationTagProps) {
  const config = TAG_CONFIG[confidence]
  if (!config) return null

  const Icon = config.icon

  return (
    <Badge variant={config.variant} className={`gap-1 text-xs ${config.className}`}>
      {Icon && <Icon className="h-3 w-3" />}
      {config.label}
    </Badge>
  )
}
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/componentes/ValidationTag.tsx
git commit -m "feat(avisos): add ValidationTag component for confidence display"
```

---

## Task 5: Avisos Controller Hook (`useAvisosController.ts`)

**Files:**
- Create: `src/renderer/src/hooks/useAvisosController.ts`
- Test: `tests/renderer/useAvisosController.spec.ts`

- [ ] **Step 1: Write tests for surface derivation functions**

The hook exports pure functions for surface derivation. Test those:

```typescript
// tests/renderer/useAvisosController.spec.ts
import { describe, it, expect } from 'vitest'
import {
  derivarInlinePreview,
  derivarSugestaoSheet,
  derivarOperationFeedback,
} from '../../src/renderer/src/hooks/useAvisosController'
import type { PreviewDiagnostic } from '../../src/shared/preview-diagnostics'
import type { OperationFeedback } from '../../src/shared/advisory-types'

const makeDiag = (code: string, source: PreviewDiagnostic['source']): PreviewDiagnostic => ({
  code,
  severity: 'warning',
  gate: 'ALLOW',
  title: `Title ${code}`,
  detail: `Detail ${code}`,
  source,
})

describe('derivarInlinePreview', () => {
  it('includes structural avisos and current preview diagnostics', () => {
    const result = derivarInlinePreview({
      structuralAvisos: [{ id: 'struct-1', nivel: 'info', titulo: 'Sem titular', descricao: '2 sem titular' }],
      currentPreviewDiagnostics: [makeDiag('CAP_DIARIA', 'capacity')],
    })
    expect(result).toHaveLength(2)
    expect(result[0].id).toBe('struct-1')
    expect(result[1].id).toContain('CAP_DIARIA')
  })

  it('never includes proposed diagnostics', () => {
    const result = derivarInlinePreview({
      structuralAvisos: [],
      currentPreviewDiagnostics: [makeDiag('CAP_DIARIA', 'capacity')],
    })
    expect(result.every(a => !a.id.includes('PROPOSED'))).toBe(true)
  })
})

describe('derivarSugestaoSheet', () => {
  it('includes advisory solver diagnostics and proposal preview diagnostics', () => {
    const result = derivarSugestaoSheet({
      advisorySolverDiagnostics: [makeDiag('VALIDACAO_INVIAVEL', 'advisory_current')],
      proposalPreviewDiagnostics: [makeDiag('CAP_DIARIA', 'advisory_proposal')],
    })
    expect(result).toHaveLength(2)
  })

  it('never includes current preview diagnostics', () => {
    const result = derivarSugestaoSheet({
      advisorySolverDiagnostics: [],
      proposalPreviewDiagnostics: [],
    })
    expect(result).toHaveLength(0)
  })
})

describe('derivarOperationFeedback', () => {
  it('returns empty for null', () => {
    expect(derivarOperationFeedback(null)).toEqual([])
  })

  it('humanizes INFEASIBLE feedback', () => {
    const feedback: OperationFeedback = {
      type: 'INFEASIBLE',
      message: 'INFEASIBLE after 30s',
    }
    const result = derivarOperationFeedback(feedback)
    expect(result).toHaveLength(1)
    expect(result[0].nivel).toBe('error')
  })
})
```

- [ ] **Step 2: Run test — verify it fails**

Run: `npx vitest run tests/renderer/useAvisosController.spec.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Create the hook**

```typescript
// src/renderer/src/hooks/useAvisosController.ts
import { useMemo } from 'react'
import type { PreviewDiagnostic, PreviewGate } from '@shared/preview-diagnostics'
import type {
  EscalaAdvisoryOutput,
  ValidationSnapshot,
  ValidationConfidence,
  OperationFeedback,
} from '@shared/advisory-types'
import { derivarConfidence, normalizeSnapshot } from '@shared/advisory-types'
import { computeAdvisoryInputHash } from '@shared/advisory-hash'
import type { EscalaAdvisoryInput } from '@shared/advisory-types'
import {
  mapPreviewDiagnosticToAviso,
  humanizarOperacao,
  type Aviso,
} from '../lib/humanizar-operacao'

// --- Pure functions exported for testing ---

interface InlinePreviewInput {
  structuralAvisos: Aviso[]
  currentPreviewDiagnostics: PreviewDiagnostic[]
}

export function derivarInlinePreview(input: InlinePreviewInput): Aviso[] {
  return [
    ...input.structuralAvisos,
    ...input.currentPreviewDiagnostics.map(mapPreviewDiagnosticToAviso),
  ]
}

interface SugestaoSheetInput {
  advisorySolverDiagnostics: PreviewDiagnostic[]
  proposalPreviewDiagnostics: PreviewDiagnostic[]
}

export function derivarSugestaoSheet(input: SugestaoSheetInput): Aviso[] {
  return [
    ...input.advisorySolverDiagnostics.map(mapPreviewDiagnosticToAviso),
    ...input.proposalPreviewDiagnostics.map(mapPreviewDiagnosticToAviso),
  ]
}

export function derivarOperationFeedback(feedback: OperationFeedback | null): Aviso[] {
  return humanizarOperacao(feedback)
}

// --- Structural avisos (always visible in inline preview) ---

export function buildStructuralAvisos(params: {
  semTitular: number
  foraDoPreview: number
  setorNome?: string
}): Aviso[] {
  const avisos: Aviso[] = []
  if (params.semTitular > 0) {
    avisos.push({
      id: 'structural-sem-titular',
      nivel: 'warning',
      titulo: `${params.semTitular} colaborador(es) sem funcao titular`,
      descricao: 'Colaboradores sem funcao nao participam da escala.',
    })
  }
  if (params.foraDoPreview > 0) {
    avisos.push({
      id: 'structural-fora-preview',
      nivel: 'info',
      titulo: `${params.foraDoPreview} colaborador(es) fora da simulacao`,
      descricao: 'Intermitentes sem folga variavel nao participam do ciclo rotativo.',
    })
  }
  return avisos
}

// --- Hook ---

interface UseAvisosControllerParams {
  currentPreviewDiagnostics: PreviewDiagnostic[]
  previewGate: PreviewGate
  advisoryResult: EscalaAdvisoryOutput | null
  proposalPreviewDiagnostics: PreviewDiagnostic[]
  operationFeedback: OperationFeedback | null
  semTitular: number
  foraDoPreview: number
  setorNome?: string
  snapshotRaw: unknown
  advisoryInput: EscalaAdvisoryInput | null
}

export function useAvisosController(params: UseAvisosControllerParams) {
  const {
    currentPreviewDiagnostics,
    previewGate,
    advisoryResult,
    proposalPreviewDiagnostics,
    operationFeedback,
    semTitular,
    foraDoPreview,
    setorNome,
    snapshotRaw,
    advisoryInput,
  } = params

  const structuralAvisos = useMemo(
    () => buildStructuralAvisos({ semTitular, foraDoPreview, setorNome }),
    [semTitular, foraDoPreview, setorNome],
  )

  const inlinePreviewAvisos = useMemo(
    () => derivarInlinePreview({ structuralAvisos, currentPreviewDiagnostics }),
    [structuralAvisos, currentPreviewDiagnostics],
  )

  const sugestaoSheetAvisos = useMemo(
    () => derivarSugestaoSheet({
      advisorySolverDiagnostics: advisoryResult?.diagnostics ?? [],
      proposalPreviewDiagnostics,
    }),
    [advisoryResult?.diagnostics, proposalPreviewDiagnostics],
  )

  const operationAvisos = useMemo(
    () => derivarOperationFeedback(operationFeedback),
    [operationFeedback],
  )

  const snapshot = useMemo(() => normalizeSnapshot(snapshotRaw), [snapshotRaw])

  const currentInputHash = useMemo(
    () => advisoryInput ? computeAdvisoryInputHash(advisoryInput) : '',
    [advisoryInput],
  )

  const confidence = useMemo(
    () => derivarConfidence({ previewGate, currentInputHash, snapshot }),
    [previewGate, currentInputHash, snapshot],
  )

  return {
    inlinePreviewAvisos,
    sugestaoSheetAvisos,
    operationAvisos,
    confidence,
    currentInputHash,
  }
}
```

- [ ] **Step 4: Run test — verify it passes**

Run: `npx vitest run tests/renderer/useAvisosController.spec.ts`
Expected: ALL PASS

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: 0 errors

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/hooks/useAvisosController.ts tests/renderer/useAvisosController.spec.ts
git commit -m "feat(avisos): add useAvisosController hook with FSM surface derivation"
```

---

## Task 6: Update SugestaoSheet — Proposal Diagnostics

**Files:**
- Modify: `src/renderer/src/componentes/SugestaoSheet.tsx`

- [ ] **Step 1: Read current SugestaoSheet**

Read `src/renderer/src/componentes/SugestaoSheet.tsx` to understand current props interface (line 34-46).

- [ ] **Step 2: Change `previewDiagnostics` prop to `proposalAvisos`**

In the `SugestaoSheetProps` interface:
- Remove: `previewDiagnostics?: PreviewDiagnostic[]`
- Remove: `mode?: 'sugestao' | 'validacao'` (no longer needed — only one mode)
- Add: `proposalAvisos?: Aviso[]` (already humanized, from `sugestaoSheetAvisos`)

Import `Aviso` from `../lib/humanizar-operacao`.

- [ ] **Step 3: Update rendering to use `proposalAvisos`**

Replace the section that renders `previewDiagnostics` (the "Avisos do Ciclo" section, lines ~316-328) with:

```tsx
{proposalAvisos && proposalAvisos.length > 0 && (
  <div className="space-y-2">
    <h4 className="text-sm font-medium text-muted-foreground">Avisos da simulacao</h4>
    {proposalAvisos.map((aviso) => (
      <div key={aviso.id} className={cn(
        'rounded-md border p-3 text-sm',
        aviso.nivel === 'error' && 'border-rose-500/20 bg-rose-500/10',
        aviso.nivel === 'warning' && 'border-yellow-500/20 bg-yellow-500/10',
        aviso.nivel === 'info' && 'border-indigo-500/20 bg-indigo-500/10',
      )}>
        <p className="font-medium">{aviso.titulo}</p>
        <p className="text-muted-foreground">{aviso.descricao}</p>
      </div>
    ))}
  </div>
)}
```

- [ ] **Step 4: Handle NO_PROPOSAL state explicitly**

In the rendering logic, when `advisory?.status === 'NO_PROPOSAL'`:
- Show humanized message (not raw solver error)
- Hide "Aceitar" button (nothing to accept)
- Show only "Fechar" button

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: Errors in `SetorDetalhe.tsx` where `SugestaoSheet` is used (expected — will fix in Task 7). No errors in `SugestaoSheet.tsx` itself.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/componentes/SugestaoSheet.tsx
git commit -m "refactor(avisos): SugestaoSheet receives proposal avisos instead of raw diagnostics"
```

---

## Task 7: Rewire SetorDetalhe — Integrate Hook + Unify Buttons

**Files:**
- Modify: `src/renderer/src/paginas/SetorDetalhe.tsx`
- Reference: `src/shared/advisory-hash.ts`, `src/renderer/src/hooks/useAvisosController.ts`

This is the largest task. Work carefully through each sub-step.

- [ ] **Step 1: Read SetorDetalhe.tsx state variables and button handlers**

Read lines around:
- `avisosOperacao` (line ~469)
- `advisoryResult` (line ~479)
- `previewAvisos` useMemo (line ~2031-2041)
- `handleSugerirSolver` (line ~2043-2098)
- `handleSugerirTS` (line ~2100-2150)
- Button rendering (search for "Sugerir TS", "Sugerir Solver", "Validar")
- `SugestaoSheet` rendering (line ~3404-3443)
- `AvisosSection` rendering (line ~3378-3396)

- [ ] **Step 2: Replace `avisosOperacao: AvisoEscala[]` with `operationFeedback: OperationFeedback | null`**

```typescript
// REMOVE:
const [avisosOperacao, setAvisosOperacao] = useState<AvisoEscala[]>([])

// ADD:
const [operationFeedback, setOperationFeedback] = useState<OperationFeedback | null>(null)
```

Update all places that set `avisosOperacao` (primarily in `handleGerar`):
- Preflight blockers → `setOperationFeedback({ type: 'PREFLIGHT_BLOCK', message: '...', details: [...] })`
- Preflight warnings → `setOperationFeedback({ type: 'PREFLIGHT_WARNING', message: '...', details: [...] })`
- INFEASIBLE → `setOperationFeedback({ type: 'INFEASIBLE', message: '...', details: [...] })`
- Generate error → `setOperationFeedback({ type: 'GENERATE_ERROR', message: '...' })`
- Success → `setOperationFeedback(null)`

- [ ] **Step 3: Add proposal preview derivation**

After the existing `simulacaoPreview` useMemo (line ~1266-1382) and `previewDiagnostics` useMemo (line ~1384-1387), add a new useMemo that derives proposal diagnostics by re-running the same preview pipeline with the proposal's overrides applied.

The existing `simulacaoPreview` calls `runPreviewMultiPass` (line ~1302-1324) with these inputs:
- `fase1Input`: `{ num_postos, trabalham_domingo, num_meses, folgas_forcadas, demanda_por_dia }`
- `participants`: from `previewSetorRows` (id, nome, sexo, folga_fixa_dom)
- `demandaPorDia`, `trabalhamDomingo`, `rules`, `demandaSegmentos`, `horaAbertura`, `horaFechamento`

The key difference for the proposal: `folgasForcadas` must be rebuilt with the proposed folgas instead of the current ones.

```typescript
const proposalPreviewDiagnostics = useMemo<PreviewDiagnostic[]>(() => {
  if (!advisoryResult?.proposal?.diff || modoSimulacaoEfetivo !== 'SETOR') return []
  if (regimeEfetivo !== '5X2') return []

  // Build a map of proposed folgas from the advisory diff
  const proposedFolgaMap = new Map<number, { fixa: DiaSemana | null; variavel: DiaSemana | null }>()
  for (const d of advisoryResult.proposal.diff) {
    proposedFolgaMap.set(d.colaborador_id, { fixa: d.fixa_proposta, variavel: d.variavel_proposta })
  }

  // Rebuild folgasForcadas with proposed overrides
  const proposalFolgasForcadas = previewSetorRows.map((row) => {
    const proposed = proposedFolgaMap.get(row.titular.id)
    if (proposed) {
      return {
        folga_fixa_dia: diaSemanaParaIdxPreview(proposed.fixa),
        folga_variavel_dia: diaSemanaParaIdxPreview(proposed.variavel),
        folga_fixa_dom: proposed.fixa === 'DOM',
      }
    }
    return row.folgaForcada
  })

  const hasForcadas = proposalFolgasForcadas.some(
    (f) => f.folga_fixa_dia != null || f.folga_variavel_dia != null || f.folga_fixa_dom
  )

  const proposalResult = runPreviewMultiPass({
    fase1Input: {
      num_postos: simulacaoPreview.effectiveN,
      trabalham_domingo: simulacaoPreview.effectiveK,
      num_meses: simulacaoPreviewMeses,
      folgas_forcadas: hasForcadas ? proposalFolgasForcadas : undefined,
      demanda_por_dia: demandaPorDiaPreviewCiclo,
    },
    participants: previewSetorRows.map((row) => ({
      id: row.titular.id,
      nome: row.titular.nome,
      sexo: row.titular.sexo as 'M' | 'F',
      folga_fixa_dom: proposedFolgaMap.get(row.titular.id)?.fixa === 'DOM' || row.folgaFixaDom,
    })),
    demandaPorDia: demandaPorDiaPreviewCiclo,
    trabalhamDomingo: simulacaoPreview.effectiveK,
    rules: previewRuleConfig,
    demandaSegmentos: demandaSegmentosPreviewCiclo,
    horaAbertura: horaAberturaPreview,
    horaFechamento: horaFechamentoPreview,
  })

  return proposalResult.diagnostics
}, [
  advisoryResult?.proposal?.diff,
  modoSimulacaoEfetivo,
  regimeEfetivo,
  previewSetorRows,
  simulacaoPreview.effectiveN,
  simulacaoPreview.effectiveK,
  simulacaoPreviewMeses,
  demandaPorDiaPreviewCiclo,
  demandaSegmentosPreviewCiclo,
  previewRuleConfig,
  horaAberturaPreview,
  horaFechamentoPreview,
])
```

This re-uses the exact same `runPreviewMultiPass` pipeline but with proposed folgas applied. The result goes to `sugestaoSheetAvisos` via the hook — never to inline preview.

- [ ] **Step 4: Build `advisoryInput` for the hook**

Construct the `EscalaAdvisoryInput` for hash computation. This is the same input that `handleSugerirSolver` sends to the advisory controller. Extract it into a `useMemo`:

```typescript
const advisoryInput = useMemo<EscalaAdvisoryInput | null>(() => {
  if (!setor || !previewSetorRows?.length) return null
  return {
    setor_id: setor.id,
    data_inicio: periodoPreviewInicio,
    data_fim: periodoPreviewFim,
    pinned_folga_externo: /* same as handleSugerirSolver builds */,
    current_folgas: /* same as handleSugerirSolver builds */,
    demanda_preview: /* same */,
  }
}, [setor, previewSetorRows, periodoPreviewInicio, periodoPreviewFim, /* etc */])
```

- [ ] **Step 5: Wire up `useAvisosController` hook**

```typescript
import { useAvisosController } from '../hooks/useAvisosController'

const {
  inlinePreviewAvisos,
  sugestaoSheetAvisos,
  operationAvisos,
  confidence,
  currentInputHash,
} = useAvisosController({
  currentPreviewDiagnostics: previewDiagnostics,
  previewGate,
  advisoryResult,
  proposalPreviewDiagnostics,
  operationFeedback,
  semTitular: /* existing count */,
  foraDoPreview: /* existing count */,
  setorNome: setor?.nome,
  snapshotRaw: simulacaoConfig.advisory,
  advisoryInput,
})
```

- [ ] **Step 6: Delete old `previewAvisos` useMemo and `buildPreviewAvisos` import**

Remove the `previewAvisos` useMemo (line ~2031-2041) and the import of `buildPreviewAvisos` from `../lib/build-avisos`.

- [ ] **Step 7: Unify buttons — single "Sugerir"**

Replace the 3 separate buttons (Sugerir TS, Sugerir Solver, Validar) with one "Sugerir" button.

Create a unified handler:

```typescript
const handleSugerir = useCallback(async () => {
  setOperationFeedback(null)
  setSugestaoOpen(true)
  setAdvisoryLoading(true)
  try {
    // Step 1: Try advisory pipeline (TS → solver escalation)
    const result = await escalasService.advisory(advisoryInput!)
    setAdvisoryResult(result)

    // Step 2: Handle CURRENT_VALID (arrangement is already valid)
    if (result.status === 'CURRENT_VALID') {
      // Persist snapshot VALIDATED for current hash
      persistSnapshot(currentInputHash, 'VALIDATED', 'SUGERIR', result.diagnostics)
      // Brief success display, then close
    }

    // Step 3: Handle NO_PROPOSAL (solver could not find solution)
    if (result.status === 'NO_PROPOSAL') {
      persistSnapshot(currentInputHash, 'HAD_WARNINGS', 'SUGERIR', result.diagnostics)
    }

    // Step 4: Handle PROPOSAL_VALID (solver has proposal) — user decides in drawer
  } catch (err) {
    setOperationFeedback({
      type: 'GENERATE_ERROR',
      message: err instanceof Error ? err.message : 'Erro desconhecido',
    })
    setSugestaoOpen(false)
  } finally {
    setAdvisoryLoading(false)
  }
}, [advisoryInput, currentInputHash])
```

**Delete** the old `handleSugerirTS` and `handleSugerirSolver` functions.

In the JSX, replace the 3 buttons with:

```tsx
<Button onClick={handleSugerir} disabled={!advisoryInput}>
  Sugerir
</Button>
<Button onClick={handleGerar}>
  Gerar Escala
</Button>
```

Remove: any "Validar" button, "Sugerir TS" button, "Sugerir Solver" button.

- [ ] **Step 8: Update `SugestaoSheet` props**

```tsx
<SugestaoSheet
  open={sugestaoOpen}
  onOpenChange={setSugestaoOpen}
  loading={advisoryLoading}
  advisory={advisoryResult}
  proposalAvisos={sugestaoSheetAvisos}
  onAceitar={() => {
    // Apply proposal overrides
    atualizarSimulacaoConfig((prev) => {
      const newOverrides = { ...prev.setor.overrides_locais }
      for (const d of advisoryResult!.proposal!.diff) {
        newOverrides[String(d.colaborador_id)] = {
          fixa: d.fixa_proposta,
          variavel: d.variavel_proposta,
        }
      }
      // Compute POST-proposal hash and persist snapshot
      const postInput = { ...advisoryInput!, current_folgas: /* updated */ }
      const postHash = computeAdvisoryInputHash(postInput)
      return {
        ...prev,
        setor: { ...prev.setor, overrides_locais: newOverrides },
        advisory: {
          input_hash: postHash,
          generated_at: new Date().toISOString(),
          outcome: advisoryResult!.diagnostics.some(d => d.severity === 'error') ? 'HAD_WARNINGS' : 'VALIDATED',
          source: 'SUGERIR',
          diagnostics: advisoryResult!.diagnostics,
        } satisfies ValidationSnapshot,
      }
    })
    setSugestaoOpen(false)
    setAdvisoryResult(null)
  }}
  onDescartar={() => {
    // If advisory had warnings, persist HAD_WARNINGS for current hash
    if (advisoryResult?.diagnostics.some(d => d.severity !== 'info')) {
      persistSnapshot(currentInputHash, 'HAD_WARNINGS', 'SUGERIR', advisoryResult!.diagnostics)
    }
    setSugestaoOpen(false)
    setAdvisoryResult(null)
  }}
  onAnalisarIa={abrirAnaliseIa}
/>
```

- [ ] **Step 9: Update `AvisosSection` props**

```tsx
{/* Inline preview avisos */}
{inlinePreviewAvisos.length > 0 && (
  <AvisosSection avisos={inlinePreviewAvisos} onAnalisarIa={abrirAnaliseIa} />
)}

{/* Operation feedback (separate from preview) */}
{operationAvisos.length > 0 && (
  <AvisosSection avisos={operationAvisos} />
)}
```

- [ ] **Step 10: Add `ValidationTag` to cycle header**

Find the cycle header (near the "Preview" badge) and add:

```tsx
import { ValidationTag } from '../componentes/ValidationTag'

// In the cycle header, after the "Preview" badge:
<ValidationTag confidence={confidence} />
```

- [ ] **Step 11: Create helper `persistSnapshot`**

```typescript
const persistSnapshot = useCallback((
  hash: string,
  outcome: 'VALIDATED' | 'HAD_WARNINGS',
  source: 'SUGERIR' | 'GERAR',
  diagnostics: PreviewDiagnostic[],
) => {
  atualizarSimulacaoConfig((prev) => ({
    ...prev,
    advisory: {
      input_hash: hash,
      generated_at: new Date().toISOString(),
      outcome,
      source,
      diagnostics,
    } satisfies ValidationSnapshot,
  }))
}, [atualizarSimulacaoConfig])
```

- [ ] **Step 12: Update `handleGerar` to persist snapshot on success**

After successful generation (where escala is saved), add:

```typescript
persistSnapshot(currentInputHash, 'VALIDATED', 'GERAR', [])
setOperationFeedback(null)
```

On INFEASIBLE:

```typescript
setOperationFeedback({
  type: 'INFEASIBLE',
  message: errorMessage,
  details: solverSuggestions,
})
```

- [ ] **Step 13: Run typecheck**

Run: `npm run typecheck`
Expected: 0 errors (fix any remaining issues)

- [ ] **Step 14: Commit**

```bash
git add src/renderer/src/paginas/SetorDetalhe.tsx
git commit -m "refactor(avisos): integrate useAvisosController hook, unify buttons, add confidence tag"
```

---

## Task 8: Delete `build-avisos.ts`

**Files:**
- Delete: `src/renderer/src/lib/build-avisos.ts`

- [ ] **Step 1: Verify no remaining imports**

Search for any remaining imports of `buildPreviewAvisos` or `build-avisos`:

Run: `grep -r "build-avisos\|buildPreviewAvisos" src/`

If any found, remove them (they should have been removed in Task 7).

- [ ] **Step 2: Delete the file**

```bash
rm src/renderer/src/lib/build-avisos.ts
```

- [ ] **Step 3: Delete the related test file**

```bash
rm tests/renderer/build-avisos-advisory.spec.ts
```

- [ ] **Step 4: Run typecheck**

Run: `npm run typecheck`
Expected: 0 errors

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "cleanup(avisos): delete build-avisos.ts — replaced by useAvisosController"
```

---

## Task 9: Verification

All tests from spec section 5. Run manually in the app with dev mode.

- [ ] **Step 1: Run all unit tests**

```bash
npx vitest run tests/shared/advisory-types.spec.ts tests/shared/advisory-hash.spec.ts tests/renderer/humanizar-operacao.spec.ts tests/renderer/useAvisosController.spec.ts
```

Expected: ALL PASS

- [ ] **Step 2: Run full typecheck**

```bash
npm run typecheck
```

Expected: 0 errors

- [ ] **Step 3: Start app and verify manually**

```bash
npm run dev
```

Test checklist (from spec section 5):

| # | Scenario | Expected |
|---|----------|----------|
| 5.1 | Open SetorDetalhe → check inline preview | Never shows proposal diagnostics |
| 5.2 | Click Sugerir → check drawer | Never shows current state diagnostics |
| 5.3 | Sugerir → accept proposal | New arrangement becomes current, tag turns green |
| 5.4 | Sugerir → cancel with warnings | Returns to current + tag shows orange |
| 5.5 | After validation, change a folga | Hash diverges → tag goes yellow |
| 5.6 | Gerar → INFEASIBLE | Single red feedback card, no duplicates |
| 5.7 | Check all messages | Zero "INFEASIBLE", "Slot", "disponiveis=" text |
| 5.8 | Check surfaces | Nivel ciclo and nivel escala never in same surface |
| 5.9 | Check buttons | Only "Sugerir" and "Gerar Escala" visible |
| 5.10 | Intermitente tipo B in preview | No technical jargon |
| 5.11 | Guard T5 rejection | Humanized error, no stack trace |
| 5.12 | Sugerir → NO_PROPOSAL → dismiss | Tag shows SOLVER_HAD_WARNINGS |

- [ ] **Step 4: Commit final state**

```bash
git add -A
git commit -m "test(avisos): verify all lifecycle scenarios pass"
```

---

## Dependency Graph

```
Task 1 (types) ──► Task 2 (hash) ──► Task 5 (hook) ──► Task 7 (SetorDetalhe)
                                   ▲                        │
Task 3 (humanization) ────────────┘                        ▼
                                                     Task 8 (delete build-avisos)
Task 4 (ValidationTag) ──────────────────────────────► Task 7
                                                           │
Task 6 (SugestaoSheet) ──────────────────────────────► Task 7
                                                           │
                                                           ▼
                                                     Task 9 (verification)
```

**Parallel opportunities:**
- Tasks 1, 3, 4 can run in parallel (no deps between them)
- Task 6 can run in parallel with Task 5 (both depend on Task 1)
- Task 2 depends only on Task 1
- Task 7 depends on all of 2, 3, 4, 5, 6
- Tasks 8 and 9 are sequential after 7
