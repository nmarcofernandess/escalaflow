# Drawer Sugestao Solver-Backed + Fallback IA — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Substituir o drawer de sugestao heuristico por um advisory solver-backed com fallback automatico para IA.

**Architecture:** Phase 1 do solver Python (`solve_folga_pattern()`) eh exposta como endpoint advisory standalone via flag `config.advisory_only`. O advisory-controller TS orquestra: validar estado atual → propor folgas → confirmar proposta → fallback IA. O drawer recebe criterios estruturados com PASS/FAIL real em vez de checks verdes falsos.

**Tech Stack:** Python OR-Tools CP-SAT (Phase 1 existente), TypeScript (advisory-controller + tipos compartilhados), React (SugestaoSheet refatorado + iaStore pendingAutoMessage), PGlite (leitura, sem migration)

**Spec:** `specs/BUILD_DRAWER_SUGESTAO_SOLVER_IA.md`

**Nota sobre Phase 2 (confirmacao):** O spec descreve Phase 2 como confirmacao autoritativa apos Phase 1. Neste plano V1, Phase 2 NAO eh implementada — o advisory roda apenas Phase 1 (que ja valida cobertura, domingos, ciclo). Phase 2 (full solve da proposta) fica como melhoria futura — o custo de rodar solve completo (~30s+) no drawer a cada clique sacrifica fluidez sem ganho proporcional na V1. Se a proposta Phase 1 nao fechar, cai no fallback IA que lida melhor.

---

## File Structure

### Novos arquivos

| Arquivo | Responsabilidade |
|---------|-----------------|
| `src/shared/advisory-types.ts` | Tipos compartilhados: `AdvisoryStatus`, `AdvisoryCriterion`, `AdvisoryDiffItem`, `EscalaAdvisoryInput`, `EscalaAdvisoryOutput`, `SimulacaoAdvisorySnapshot`, `SemanaDraftAdvisory` |
| `src/main/motor/advisory-controller.ts` | Orquestra pipeline: validate current → propose → confirm → normalize diagnostics. Contem `extractFolgaFromPattern()`, `convertSemanaDraftToDemanda()`, `normalizeAdvisoryToDiagnostics()` |
| `tests/main/advisory-controller.spec.ts` | Testes do controller: pattern extraction, draft conversion, diagnostics normalization |
| `tests/main/solver-advisory.spec.ts` | Teste E2E: IPC → Python Phase 1 → retorno estruturado |
| `tests/renderer/sugestao-sheet.spec.tsx` | Testes do SugestaoSheet: cores por status, cinza em NOT_EVALUATED, sem verde falso |

### Arquivos modificados

| Arquivo | Mudanca |
|---------|---------|
| `solver/solver_ortools.py` | ~15 linhas: check `config.advisory_only`, early return apos Phase 1 |
| `src/shared/preview-diagnostics.ts` | Adicionar `'advisory_current' \| 'advisory_proposal'` ao union `source` |
| `src/shared/setor-simulacao.ts` | Adicionar campo opcional `advisory?: SimulacaoAdvisorySnapshot` ao `SetorSimulacaoConfig` |
| `src/main/motor/solver-bridge.ts` | Exportar `buildSolverInput` como public (ja eh). Nenhuma mudanca real |
| `src/main/tipc.ts` | Novo handler `escalas.advisory` (~40 linhas) |
| `src/renderer/src/store/iaStore.ts` | 2 campos: `pendingAutoMessage`, `setPendingAutoMessage` |
| `src/renderer/src/componentes/IaChatView.tsx` | useEffect para detectar e enviar `pendingAutoMessage` |
| `src/renderer/src/componentes/SugestaoSheet.tsx` | Rewrite completo: 3 blocos (estado atual, proposta, validacao), cores por status |
| `src/renderer/src/lib/build-avisos.ts` | Aceitar advisory diagnostics como 5a source |
| `src/renderer/src/paginas/SetorDetalhe.tsx` | Chamar advisory IPC, flags loading/disabled, aceitar→simulacao, fallback→IA |
| `src/renderer/src/servicos/escalas.ts` | Client `escalas.advisory()` |

---

## Chunk 1: Foundation (tipos + Python + bridge)

### Task 1: Tipos compartilhados

**Files:**
- Create: `src/shared/advisory-types.ts`
- Modify: `src/shared/preview-diagnostics.ts:14`
- Modify: `src/shared/setor-simulacao.ts:16-26`
- Modify: `src/shared/index.ts` (re-export)

- [ ] **Step 1: Criar advisory-types.ts**

```ts
// src/shared/advisory-types.ts
import type { DiaSemana } from './constants'
import type { PreviewDiagnostic } from './preview-diagnostics'

export type AdvisoryStatus =
  | 'CURRENT_VALID'
  | 'CURRENT_INVALID'
  | 'PROPOSAL_VALID'
  | 'PROPOSAL_INVALID'
  | 'NO_PROPOSAL'

export type AdvisoryCriterionStatus = 'PASS' | 'FAIL' | 'NOT_EVALUATED'

export interface AdvisoryCriterion {
  code:
    | 'COBERTURA_DIA'
    | 'DOMINGOS_CONSECUTIVOS'
    | 'DOMINGO_EXATO'
    | 'COBERTURA_FAIXA'
    | 'DESCANSO_JORNADA'
  status: AdvisoryCriterionStatus
  title: string
  detail: string
  source: 'PHASE1' | 'PHASE2' | 'DIAGNOSTIC'
}

export interface AdvisoryDiffItem {
  colaborador_id: number
  nome: string
  posto_apelido: string
  fixa_atual: DiaSemana | null
  fixa_proposta: DiaSemana | null
  variavel_atual: DiaSemana | null
  variavel_proposta: DiaSemana | null
}

export interface EscalaAdvisoryInput {
  setor_id: number
  data_inicio: string
  data_fim: string
  solve_mode?: 'rapido' | 'balanceado' | 'otimizado' | 'maximo'
  max_time_seconds?: number
  rules_override?: Record<string, string>
  pinned_folga_externo: Array<{ c: number; d: number; band: number }>
  current_folgas: Array<{
    colaborador_id: number
    fixa: DiaSemana | null
    variavel: DiaSemana | null
    origem_fixa: 'COLABORADOR' | 'OVERRIDE_LOCAL'
    origem_variavel: 'COLABORADOR' | 'OVERRIDE_LOCAL'
  }>
  demanda_preview?: SemanaDraftAdvisory | null
}

export interface SemanaDraftSegmento {
  hora_inicio: string
  hora_fim: string
  min_pessoas: number
  override: boolean
}

export interface SemanaDraftAdvisory {
  padrao: {
    hora_abertura: string
    hora_fechamento: string
    segmentos: SemanaDraftSegmento[]
  }
  dias: Record<DiaSemana, {
    ativo: boolean
    usa_padrao: boolean
    hora_abertura: string
    hora_fechamento: string
    segmentos: SemanaDraftSegmento[]
  }>
}

export interface EscalaAdvisoryOutput {
  status: AdvisoryStatus
  normalized_diagnostics: PreviewDiagnostic[]
  current: {
    criteria: AdvisoryCriterion[]
  }
  proposal?: {
    diff: AdvisoryDiffItem[]
    criteria: AdvisoryCriterion[]
  }
  fallback?: {
    should_open_ia: boolean
    reason: string
    diagnosis_payload: unknown
  }
}

export interface SimulacaoAdvisorySnapshot {
  input_hash: string
  generated_at: string
  origin: 'accepted_suggestion'
  diagnostics: PreviewDiagnostic[]
  advisory_status: AdvisoryStatus
}
```

- [ ] **Step 2: Expandir source em preview-diagnostics.ts**

Em `src/shared/preview-diagnostics.ts:14`, mudar:
```ts
// ANTES
source: 'capacity' | 'domingo_ciclo' | 'domingo_consecutivo' | 'preview'
// DEPOIS
source: 'capacity' | 'domingo_ciclo' | 'domingo_consecutivo' | 'preview' | 'advisory_current' | 'advisory_proposal'
```

- [ ] **Step 2b: Adicionar advisory_only e advisory_pattern aos tipos do solver**

Em `src/shared/types.ts`, dentro de `SolverInput.config`:
```ts
advisory_only?: boolean
```

Em `src/shared/types.ts`, dentro de `SolverOutput`:
```ts
advisory_pattern?: Array<{ c: number; d: number; band: number }>
```

Isso elimina todos os `as unknown as Record` casts no advisory-controller.

- [ ] **Step 3: Expandir SetorSimulacaoConfig + preservar advisory na normalizacao**

Em `src/shared/setor-simulacao.ts`, adicionar campo opcional ao tipo:
```ts
import type { SimulacaoAdvisorySnapshot } from './advisory-types'

export interface SetorSimulacaoConfig {
  mode: SetorSimulacaoMode
  setor: {
    overrides_locais: Record<string, SetorSimulacaoOverrideLocal>
  }
  livre: {
    n: number
    k: number
    folgas_forcadas: SetorSimulacaoFolgaForcada[]
  }
  advisory?: SimulacaoAdvisorySnapshot | null  // ← NOVO
}
```

**CRITICO:** Atualizar `normalizeSetorSimulacaoConfig()` (linha 105-118) para preservar o campo advisory. No return, adicionar:
```ts
return {
  mode,
  setor: {
    overrides_locais: normalizeOverridesLocais(
      setorRaw.overrides_locais ?? parsed?.folgas_setor ?? {},
    ),
  },
  livre: {
    n: livreN,
    k: livreK,
    folgas_forcadas: normalizeFolgasForcadas(livreRaw.folgas_forcadas),
  },
  advisory: parsed?.advisory ?? null,  // ← PRESERVAR
}
```

Sem isso, o advisory salvo some no proximo ciclo de normalizacao.

- [ ] **Step 4: Re-exportar em shared/index.ts**

Adicionar `export * from './advisory-types'` no barrel export.

- [ ] **Step 5: Rodar typecheck**

Run: `npm run typecheck`
Expected: 0 erros

- [ ] **Step 6: Commit**

```
feat(advisory): tipos compartilhados do advisory system
```

---

### Task 2: Python advisory_only mode

**Files:**
- Modify: `solver/solver_ortools.py:1719-1762`

- [ ] **Step 1: Adicionar check advisory_only no solve()**

Em `solver/solver_ortools.py`, logo apos a linha `# ---- Phase 1: Folga Pattern ----` (linha ~1719), ANTES do check de `external_pinned`, adicionar:

```python
    # ---- Advisory-only mode: run Phase 1 and return immediately ----
    advisory_only = config.get("advisory_only", False)
```

Depois, apos todo o bloco Phase 1 (apos linha ~1762, depois de `log("Padrao de folgas nao encontrado...")`), adicionar:

```python
    if advisory_only:
        log("Modo advisory: retornando resultado da Phase 1")
        advisory_diag = {
            "generation_mode": "ADVISORY",
            "capacidade_vs_demanda": capacidade_diag,
            "cycle_length_weeks": cycle_weeks,
            "tempo_total_s": round(time.time() - t_global_start, 1),
        }
        advisory_diag.update(phase1_diag)

        if pinned_folga is not None:
            # Serialize pattern as list of {c, d, band} for JSON
            pattern_list = [
                {"c": c, "d": d, "band": band}
                for (c, d), band in sorted(pinned_folga.items())
            ]
            return {
                "sucesso": True,
                "status": "ADVISORY_OK",
                "advisory_pattern": pattern_list,
                "diagnostico": advisory_diag,
                "alocacoes": [],
                "decisoes": [],
                "comparacao_demanda": [],
                "indicadores": {
                    "pontuacao": 0, "cobertura_percent": 0,
                    "violacoes_hard": 0, "violacoes_soft": 0,
                    "equilibrio": 0,
                },
            }
        else:
            return {
                "sucesso": False,
                "status": "ADVISORY_INFEASIBLE",
                "advisory_pattern": [],
                "diagnostico": advisory_diag,
                "alocacoes": [],
                "decisoes": [],
                "comparacao_demanda": [],
                "indicadores": {
                    "pontuacao": 0, "cobertura_percent": 0,
                    "violacoes_hard": 0, "violacoes_soft": 0,
                    "equilibrio": 0,
                },
            }
```

Nota: manter `alocacoes`, `decisoes`, `comparacao_demanda` e `indicadores` vazios para satisfazer o contrato de `SolverOutput` no TS sem quebrar `runSolver()`.

- [ ] **Step 2: Testar via CLI**

Run: `echo '{"advisory_only": true}' | npm run solver:cli -- 2 --dump`

Verificar que o JSON em `tmp/` tem `config.advisory_only: true`. Depois confirmar que nao quebrou geracao normal:

Run: `npm run solver:cli -- 2 2026-03-02 2026-03-08 --summary`
Expected: resultado normal sem mencao de advisory

- [ ] **Step 3: Commit**

```
feat(solver): advisory_only mode — Phase 1 early return
```

---

### Task 3: Advisory Controller

**Files:**
- Create: `src/main/motor/advisory-controller.ts`
- Create: `tests/main/advisory-controller.spec.ts`

- [ ] **Step 1: Criar advisory-controller.ts**

```ts
// src/main/motor/advisory-controller.ts
import { createHash } from 'node:crypto'
import type {
  AdvisoryStatus,
  AdvisoryCriterion,
  AdvisoryDiffItem,
  EscalaAdvisoryInput,
  EscalaAdvisoryOutput,
  SemanaDraftAdvisory,
} from '../../shared/advisory-types'
import type { PreviewDiagnostic, PreviewDiagnosticSeverity } from '../../shared/preview-diagnostics'
import type { SolverInput, SolverOutput, DiaSemana } from '../../shared'
import { buildSolverInput, runSolver, type BuildSolverInputOptions } from './solver-bridge'

const BAND_OFF = 0
const DIAS_SEMANA: DiaSemana[] = ['SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB', 'DOM']

// ---------------------------------------------------------------------------
// Pattern → folga extraction (Gap B)
// ---------------------------------------------------------------------------

export function extractFolgaFromPattern(
  pattern: Array<{ c: number; d: number; band: number }>,
  days: string[], // array of ISO dates matching solver input
  numColabs: number,
): Array<{ c: number; fixa: DiaSemana | null; variavel: DiaSemana | null }> {
  const result: Array<{ c: number; fixa: DiaSemana | null; variavel: DiaSemana | null }> = []

  for (let c = 0; c < numColabs; c++) {
    // Group OFF days by week
    const offsByDayOfWeek = new Map<number, number>() // dayOfWeekIdx → count
    let totalWeeks = 0
    const colabPattern = pattern.filter((p) => p.c === c && p.band === BAND_OFF)
    const daysByWeek = new Map<number, number[]>() // weekIdx → dayOfWeekIdx[]

    for (const p of colabPattern) {
      const date = new Date(days[p.d])
      const dow = (date.getDay() + 6) % 7 // 0=SEG, 6=DOM
      const weekIdx = Math.floor(p.d / 7)
      offsByDayOfWeek.set(dow, (offsByDayOfWeek.get(dow) ?? 0) + 1)
      if (!daysByWeek.has(weekIdx)) daysByWeek.set(weekIdx, [])
      daysByWeek.get(weekIdx)!.push(dow)
    }

    // totalWeeks conta TODAS as semanas do periodo, nao so as que tem OFF
    // Isso evita classificar variavel como fixa quando uma semana inteira eh trabalho
    totalWeeks = Math.max(1, Math.ceil(days.length / 7))

    // fixa = day of week that appears in ALL weeks (or most, >80%)
    let fixa: DiaSemana | null = null
    let variavel: DiaSemana | null = null
    const threshold = totalWeeks * 0.8

    const candidates = [...offsByDayOfWeek.entries()]
      .sort((a, b) => b[1] - a[1]) // most frequent first

    for (const [dow, count] of candidates) {
      if (count >= threshold && fixa === null) {
        fixa = DIAS_SEMANA[dow] ?? null
      } else if (count >= totalWeeks * 0.3 && variavel === null) {
        variavel = DIAS_SEMANA[dow] ?? null
      }
    }

    result.push({ c, fixa, variavel })
  }

  return result
}

// ---------------------------------------------------------------------------
// Demanda draft → SolverInput demanda (Gap E)
// ---------------------------------------------------------------------------

export function convertSemanaDraftToDemanda(
  draft: SemanaDraftAdvisory,
  empresa: SolverInput['empresa'],
): SolverInput['demanda'] {
  const demanda: SolverInput['demanda'] = []
  for (const [dia, config] of Object.entries(draft.dias) as [DiaSemana, typeof draft.dias[DiaSemana]][]) {
    if (!config.ativo) continue
    const segmentos = config.usa_padrao ? draft.padrao.segmentos : config.segmentos
    for (const seg of segmentos) {
      demanda.push({
        dia_semana: dia,
        hora_inicio: seg.hora_inicio,
        hora_fim: seg.hora_fim,
        min_pessoas: seg.min_pessoas,
        override: seg.override,
      })
    }
  }
  return demanda
}

// ---------------------------------------------------------------------------
// Normalize Phase 1 result → PreviewDiagnostic[] (Gap A)
// ---------------------------------------------------------------------------

function criterionToDiagnostic(
  criterion: AdvisoryCriterion,
  source: 'advisory_current' | 'advisory_proposal',
): PreviewDiagnostic | null {
  if (criterion.status === 'NOT_EVALUATED') return null
  const severity: PreviewDiagnosticSeverity = criterion.status === 'PASS' ? 'info' : 'error'
  return {
    code: `ADVISORY_${criterion.code}`,
    severity,
    gate: criterion.status === 'FAIL' ? 'BLOCK' : 'ALLOW',
    title: criterion.title,
    detail: criterion.detail,
    source,
  }
}

export function normalizeAdvisoryToDiagnostics(output: EscalaAdvisoryOutput): PreviewDiagnostic[] {
  const diagnostics: PreviewDiagnostic[] = []
  const source = output.proposal ? 'advisory_proposal' : 'advisory_current'
  const criteria = output.proposal?.criteria ?? output.current.criteria
  for (const c of criteria) {
    const d = criterionToDiagnostic(c, source)
    if (d) diagnostics.push(d)
  }
  return diagnostics
}

// ---------------------------------------------------------------------------
// Input hash for invalidation (Gap spec)
// ---------------------------------------------------------------------------

export function computeAdvisoryInputHash(input: EscalaAdvisoryInput): string {
  const normalized = JSON.stringify({
    setor_id: input.setor_id,
    data_inicio: input.data_inicio,
    data_fim: input.data_fim,
    pinned: input.pinned_folga_externo,
    folgas: input.current_folgas,
    demanda: input.demanda_preview ?? null,
  })
  return createHash('sha256').update(normalized).digest('hex').slice(0, 16)
}

// ---------------------------------------------------------------------------
// Main pipeline
// ---------------------------------------------------------------------------

export async function runAdvisory(input: EscalaAdvisoryInput): Promise<EscalaAdvisoryOutput> {
  // 1. Build solver input from DB
  const options: BuildSolverInputOptions = {
    solveMode: input.solve_mode ?? 'rapido',
    maxTimeSeconds: input.max_time_seconds ?? 20,
    rulesOverride: input.rules_override,
    pinnedFolgaExterno: input.pinned_folga_externo,
  }

  const solverInput = await buildSolverInput(
    input.setor_id,
    input.data_inicio,
    input.data_fim,
    [],      // pinnedCells (4th arg) — advisory nao usa pinned_cells
    options, // BuildSolverInputOptions (5th arg)
  )

  // Patch demanda if draft provided (Gap E)
  if (input.demanda_preview) {
    solverInput.demanda = convertSemanaDraftToDemanda(input.demanda_preview, solverInput.empresa)
  }

  // Inject advisory_only flag (tipo adicionado em types.ts Step 2b)
  solverInput.config.advisory_only = true

  const colabIdMap = solverInput.colaboradores.map((c) => c.id)

  // 2. Run Phase 1 via solver
  const solverResult: SolverOutput = await runSolver(solverInput, 30_000)

  // 3. Build criteria from result
  const currentCriteria: AdvisoryCriterion[] = []

  if (solverResult.status === 'ADVISORY_OK') {
    currentCriteria.push({
      code: 'COBERTURA_DIA',
      status: 'PASS',
      title: 'Cobertura diaria atendida.',
      detail: 'O arranjo atende a demanda minima em todos os dias.',
      source: 'PHASE1',
    })
    currentCriteria.push({
      code: 'DOMINGOS_CONSECUTIVOS',
      status: 'PASS',
      title: 'Domingos consecutivos dentro do limite.',
      detail: 'Nenhum colaborador excede o maximo de domingos consecutivos.',
      source: 'PHASE1',
    })
    currentCriteria.push({
      code: 'DOMINGO_EXATO',
      status: 'PASS',
      title: 'Ciclo de domingos viavel.',
      detail: 'A rotacao de domingos respeita o ciclo configurado.',
      source: 'PHASE1',
    })
    // Phase 1 doesn't evaluate these
    currentCriteria.push({
      code: 'COBERTURA_FAIXA',
      status: 'NOT_EVALUATED',
      title: 'Cobertura por faixa horaria nao avaliada.',
      detail: 'Avaliacao detalhada de faixa horaria so acontece na geracao completa.',
      source: 'PHASE1',
    })
    currentCriteria.push({
      code: 'DESCANSO_JORNADA',
      status: 'NOT_EVALUATED',
      title: 'Descanso entre jornadas nao avaliado.',
      detail: 'H2 (interjornada 11h) exige horarios completos — nao avaliado neste drawer.',
      source: 'PHASE1',
    })
  } else {
    // INFEASIBLE
    const diag = solverResult.diagnostico ?? {}
    const detail = diag.capacidade_vs_demanda
      ? `Capacidade maxima insuficiente para cobrir demanda.`
      : 'O solver nao encontrou arranjo viavel com as regras atuais.'

    currentCriteria.push({
      code: 'COBERTURA_DIA',
      status: 'FAIL',
      title: 'Arranjo atual inviavel.',
      detail,
      source: 'PHASE1',
    })
  }

  // 4. If current is invalid and we have external pinned, try free solve
  const currentValid = solverResult.status === 'ADVISORY_OK'
  let proposal: EscalaAdvisoryOutput['proposal'] | undefined
  let fallback: EscalaAdvisoryOutput['fallback'] | undefined

  if (!currentValid && input.pinned_folga_externo.length > 0) {
    // Run again WITHOUT pinned — let solver find its own pattern
    const freeInput = {
      ...solverInput,
      config: { ...solverInput.config, advisory_only: true, pinned_folga_externo: undefined },
    }

    const freeResult: SolverOutput = await runSolver(freeInput, 30_000)

    if (freeResult.status === 'ADVISORY_OK' && freeResult.advisory_pattern) {
      const advisoryPattern = freeResult.advisory_pattern
      const days = buildDayArray(input.data_inicio, input.data_fim)
      const extracted = extractFolgaFromPattern(advisoryPattern, days, colabIdMap.length)

      const diff: AdvisoryDiffItem[] = extracted.map((e) => {
        const current = input.current_folgas.find((f) => f.colaborador_id === colabIdMap[e.c])
        const colab = solverInput.colaboradores[e.c]
        return {
          colaborador_id: colabIdMap[e.c],
          nome: colab?.nome ?? `Colaborador ${colabIdMap[e.c]}`,
          posto_apelido: '', // filled by renderer
          fixa_atual: current?.fixa ?? null,
          fixa_proposta: e.fixa,
          variavel_atual: current?.variavel ?? null,
          variavel_proposta: e.variavel,
        }
      })

      proposal = {
        diff,
        criteria: [
          { code: 'COBERTURA_DIA', status: 'PASS', title: 'Proposta cobre todos os dias.', detail: 'O solver encontrou uma distribuicao de folgas que atende a demanda.', source: 'PHASE1' },
          { code: 'DOMINGOS_CONSECUTIVOS', status: 'PASS', title: 'Domingos consecutivos OK na proposta.', detail: 'A proposta respeita os limites de domingos consecutivos.', source: 'PHASE1' },
          { code: 'DOMINGO_EXATO', status: 'PASS', title: 'Ciclo de domingos respeitado.', detail: 'A proposta segue o ciclo de domingos configurado.', source: 'PHASE1' },
          { code: 'COBERTURA_FAIXA', status: 'NOT_EVALUATED', title: 'Cobertura por faixa nao avaliada.', detail: 'So na geracao completa.', source: 'PHASE1' },
          { code: 'DESCANSO_JORNADA', status: 'NOT_EVALUATED', title: 'Descanso entre jornadas nao avaliado.', detail: 'Exige horarios completos.', source: 'PHASE1' },
        ],
      }
    } else {
      fallback = {
        should_open_ia: true,
        reason: 'O solver nao encontrou nenhuma distribuicao de folgas viavel com as regras atuais.',
        diagnosis_payload: freeResult.diagnostico ?? null,
      }
    }
  } else if (!currentValid) {
    fallback = {
      should_open_ia: true,
      reason: 'Arranjo atual invalido e nenhuma proposta possivel.',
      diagnosis_payload: solverResult.diagnostico ?? null,
    }
  }

  // 5. Determine status
  let status: AdvisoryStatus
  if (currentValid) {
    status = 'CURRENT_VALID'
  } else if (proposal) {
    status = 'PROPOSAL_VALID'
  } else if (fallback) {
    status = 'NO_PROPOSAL'
  } else {
    status = 'CURRENT_INVALID'
  }

  const output: EscalaAdvisoryOutput = {
    status,
    normalized_diagnostics: [],
    current: { criteria: currentCriteria },
    proposal,
    fallback,
  }

  // 6. Normalize to PreviewDiagnostic[]
  output.normalized_diagnostics = normalizeAdvisoryToDiagnostics(output)

  return output
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildDayArray(inicio: string, fim: string): string[] {
  const days: string[] = []
  const start = new Date(inicio)
  const end = new Date(fim)
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    days.push(d.toISOString().slice(0, 10))
  }
  return days
}
```

- [ ] **Step 2: Criar teste do controller**

```ts
// tests/main/advisory-controller.spec.ts
import { describe, it, expect } from 'vitest'
import { extractFolgaFromPattern, computeAdvisoryInputHash } from '../../src/main/motor/advisory-controller'

describe('extractFolgaFromPattern', () => {
  it('extrai fixa quando OFF aparece em todas as semanas', () => {
    // 2 semanas, colab 0, SEG sempre OFF (d=0 e d=7)
    const days = [
      '2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05', '2026-03-06', '2026-03-07', '2026-03-08',
      '2026-03-09', '2026-03-10', '2026-03-11', '2026-03-12', '2026-03-13', '2026-03-14', '2026-03-15',
    ]
    const pattern = [
      { c: 0, d: 0, band: 0 }, // SEG sem1
      { c: 0, d: 7, band: 0 }, // SEG sem2
      // rest are work
      ...Array.from({ length: 12 }, (_, i) => ({
        c: 0, d: [1,2,3,4,5,6,8,9,10,11,12,13][i], band: 3,
      })),
    ]
    const result = extractFolgaFromPattern(pattern, days, 1)
    expect(result[0].fixa).toBe('SEG')
  })

  it('extrai variavel quando OFF aparece em ~50% das semanas', () => {
    const days = Array.from({ length: 28 }, (_, i) => {
      const d = new Date('2026-03-02')
      d.setDate(d.getDate() + i)
      return d.toISOString().slice(0, 10)
    })
    // fixa = SEG (always OFF), variavel = QUA (OFF in weeks 1 and 3 only = 50%)
    const pattern: Array<{ c: number; d: number; band: number }> = []
    for (let d = 0; d < 28; d++) {
      const weekIdx = Math.floor(d / 7)
      const dow = d % 7
      if (dow === 0) { // SEG
        pattern.push({ c: 0, d, band: 0 })
      } else if (dow === 2 && (weekIdx === 0 || weekIdx === 2)) { // QUA, weeks 0 and 2
        pattern.push({ c: 0, d, band: 0 })
      } else {
        pattern.push({ c: 0, d, band: 3 })
      }
    }
    const result = extractFolgaFromPattern(pattern, days, 1)
    expect(result[0].fixa).toBe('SEG')
    expect(result[0].variavel).toBe('QUA')
  })
})

describe('computeAdvisoryInputHash', () => {
  it('retorna hash determinístico', () => {
    const input = {
      setor_id: 1,
      data_inicio: '2026-03-02',
      data_fim: '2026-03-08',
      pinned_folga_externo: [],
      current_folgas: [],
    } as any
    const h1 = computeAdvisoryInputHash(input)
    const h2 = computeAdvisoryInputHash(input)
    expect(h1).toBe(h2)
    expect(h1).toHaveLength(16)
  })

  it('hash muda quando input muda', () => {
    const base = {
      setor_id: 1,
      data_inicio: '2026-03-02',
      data_fim: '2026-03-08',
      pinned_folga_externo: [],
      current_folgas: [],
    } as any
    const h1 = computeAdvisoryInputHash(base)
    const h2 = computeAdvisoryInputHash({ ...base, setor_id: 2 })
    expect(h1).not.toBe(h2)
  })
})
```

- [ ] **Step 3: Rodar testes**

Run: `npx vitest run tests/main/advisory-controller.spec.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```
feat(advisory): controller com extractFolga, draftConvert, pipeline
```

---

### Task 4: IPC handler escalas.advisory

**Files:**
- Modify: `src/main/tipc.ts`
- Modify: `src/renderer/src/servicos/escalas.ts`

- [ ] **Step 1: Adicionar handler no tipc.ts**

Adicionar perto dos outros handlers de escalas:

```ts
import { runAdvisory, computeAdvisoryInputHash } from './motor/advisory-controller'
import type { EscalaAdvisoryInput, EscalaAdvisoryOutput } from '../shared'

// ... dentro do router
escalasAdvisory: t.procedure.action(async (input: EscalaAdvisoryInput): Promise<EscalaAdvisoryOutput> => {
  return runAdvisory(input)
}),
```

- [ ] **Step 2: Adicionar client no servico renderer**

Em `src/renderer/src/servicos/escalas.ts`:

```ts
import type { EscalaAdvisoryInput, EscalaAdvisoryOutput } from '@shared/index'

// Na classe/objeto de servico
async advisory(input: EscalaAdvisoryInput): Promise<EscalaAdvisoryOutput> {
  return await client.escalasAdvisory.invoke(input)
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: 0 erros

- [ ] **Step 4: Commit**

```
feat(advisory): IPC handler escalas.advisory + servico renderer
```

---

## Chunk 2: Frontend (drawer + IA autostart + integracao)

### Task 5: iaStore pendingAutoMessage (Gap D)

**Files:**
- Modify: `src/renderer/src/store/iaStore.ts`
- Modify: `src/renderer/src/componentes/IaChatView.tsx`

- [ ] **Step 1: Adicionar campos no iaStore**

Em `iaStore.ts`, na interface `IaStore`:

```ts
pendingAutoMessage: string | null
setPendingAutoMessage: (msg: string | null) => void
```

E no create:

```ts
pendingAutoMessage: null,
setPendingAutoMessage: (pendingAutoMessage) => set({ pendingAutoMessage }),
```

- [ ] **Step 2: Consumir em IaChatView**

Em `IaChatView.tsx`, adicionar useEffect perto dos outros effects:

```ts
// Auto-send pending message (advisory fallback → IA)
const pendingAutoMessage = useIaStore((s) => s.pendingAutoMessage)
useEffect(() => {
  if (pendingAutoMessage && !carregando && conversa_ativa_id) {
    useIaStore.getState().setPendingAutoMessage(null)
    enviar(pendingAutoMessage)
  }
}, [pendingAutoMessage, carregando, conversa_ativa_id])
```

Nota: `enviar` eh a closure local que ja existe na linha 187. O useEffect tem acesso a ela via closure do componente.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: 0 erros

- [ ] **Step 4: Commit**

```
feat(ia): pendingAutoMessage no iaStore para autostart
```

---

### Task 6: SugestaoSheet refatorado

**Files:**
- Modify: `src/renderer/src/componentes/SugestaoSheet.tsx` (rewrite)

- [ ] **Step 1: Reescrever SugestaoSheet com 3 blocos**

O componente deixa de receber `resultados: string[]` e passa a receber dados estruturados do advisory.

Nova interface de props:

```tsx
import type { AdvisoryCriterion, AdvisoryDiffItem, AdvisoryStatus, EscalaAdvisoryOutput } from '@shared/index'

interface SugestaoSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  loading: boolean
  advisory: EscalaAdvisoryOutput | null
  onAceitar: () => void
  onDescartar: () => void
}
```

O componente renderiza 3 blocos:

1. **Estado atual** — `advisory.current.criteria` com icones coloridos por status
2. **Proposta** (se existir) — `advisory.proposal.diff` tabela + `advisory.proposal.criteria`
3. **Footer** — Aceitar/Descartar (Aceitar disabled se `PROPOSAL_INVALID` ou sem proposta)

Cores: PASS=verde, FAIL=vermelho, NOT_EVALUATED=cinza. Nunca check verde sem validacao.

O loading state mostra skeleton enquanto advisory roda.

Implementacao completa (o rewrite inteiro do componente vai no step 3 do plano de execucao — aqui fica a direcao).

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: 0 erros

- [ ] **Step 3: Commit**

```
feat(advisory): SugestaoSheet com 3 blocos + criterios reais
```

---

### Task 7: build-avisos aceita advisory diagnostics

**Files:**
- Modify: `src/renderer/src/lib/build-avisos.ts`

- [ ] **Step 1: Adicionar advisory como 5a source**

Em `BuildPreviewAvisosParams`, adicionar:

```ts
advisoryDiagnostics?: PreviewDiagnostic[]
```

No corpo de `buildPreviewAvisos`, apos o loop de `avisosOperacao`, adicionar:

```ts
if (advisoryDiagnostics) {
  for (const diagnostic of advisoryDiagnostics) {
    entries.push({
      id: `advisory_${diagnostic.code}`,
      nivel: diagnostic.severity === 'error' ? 'error' : diagnostic.severity === 'warning' ? 'warning' : 'info',
      titulo: diagnostic.title,
      descricao: diagnostic.detail,
      contexto_ia: `Diagnostico do advisory solver: ${diagnostic.title}. ${diagnostic.detail}`,
    })
  }
}
```

- [ ] **Step 2: Commit**

```
feat(advisory): build-avisos aceita diagnostics do advisory
```

---

### Task 8: SetorDetalhe — integracao completa

**Files:**
- Modify: `src/renderer/src/paginas/SetorDetalhe.tsx`

Este eh o task mais complexo. Mudancas:

- [ ] **Step 1: Adicionar state do advisory**

```ts
const [advisoryResult, setAdvisoryResult] = useState<EscalaAdvisoryOutput | null>(null)
const [advisoryLoading, setAdvisoryLoading] = useState(false)
```

- [ ] **Step 2: Criar handler handleSugerir**

Substitui `setSugestaoOpen(true)` por:

```ts
const handleSugerir = async () => {
  if (advisoryLoading) return
  setSugestaoOpen(true)
  setAdvisoryLoading(true)
  setAdvisoryResult(null)

  try {
    const pinnedFolgaExterno = simulacaoPreview.mode === 'SETOR' && simulacaoPreview.resultado.sucesso
      ? converterPreviewParaPinned(
          simulacaoPreview.resultado,
          simulacaoPreview.previewRows.map((row) => ({ funcao: row.funcao, titular: row.titular })),
        )
      : []

    const currentFolgas = previewSetorRows.map((row) => ({
      colaborador_id: row.titular.id,
      fixa: row.fixaAtual,
      variavel: row.variavelAtual,
      origem_fixa: row.overrideFixaLocal ? 'OVERRIDE_LOCAL' as const : 'COLABORADOR' as const,
      origem_variavel: row.overrideVariavelLocal ? 'OVERRIDE_LOCAL' as const : 'COLABORADOR' as const,
    }))

    const result = await escalasService.advisory({
      setor_id: setorId,
      data_inicio: periodoGeracao.inicio,
      data_fim: periodoGeracao.fim,
      pinned_folga_externo: pinnedFolgaExterno,
      current_folgas: currentFolgas,
      demanda_preview: isDirty ? buildDemandaDraftFromEditor() : undefined,
    })

    // Nota: buildDemandaDraftFromEditor() extrai o draft atual do DemandaEditor
    // e converte para SemanaDraftAdvisory. Se DemandaEditor nao esta sujo (isDirty=false),
    // advisory usa demanda do banco normalmente.

    setAdvisoryResult(result)

    // Auto-fallback to IA
    if (result.fallback?.should_open_ia) {
      setSugestaoOpen(false)
      toast.info('Abrindo IA com o diagnostico do solver...')
      const prompt = `O setor ${setor?.nome ?? ''} precisa de ajuda com a escala. O solver nao encontrou arranjo viavel: ${result.fallback.reason}. Diagnostico: ${JSON.stringify(result.fallback.diagnosis_payload)}`
      useIaStore.getState().setPendingAutoMessage(prompt)
      useIaStore.getState().setAberto(true)
    }
  } catch (err) {
    toast.error('Erro ao analisar sugestao')
    console.error(err)
  } finally {
    setAdvisoryLoading(false)
  }
}
```

- [ ] **Step 3: Atualizar onAceitar**

No `onAceitar` do SugestaoSheet, alem de aplicar overrides, salvar advisory na simulacao:

```ts
onAceitar={async () => {
  if (!advisoryResult?.proposal) return
  try {
    atualizarSimulacaoConfig((prev) => ({
      ...prev,
      setor: {
        ...prev.setor,
        overrides_locais: advisoryResult.proposal!.diff.reduce((acc, item) => {
          acc[String(item.colaborador_id)] = {
            fixa: item.fixa_proposta,
            variavel: item.variavel_proposta,
          }
          return acc
        }, { ...prev.setor.overrides_locais }),
      },
      advisory: {
        input_hash: computeAdvisoryInputHash(advisoryInput),
        generated_at: new Date().toISOString(),
        origin: 'accepted_suggestion',
        diagnostics: advisoryResult.normalized_diagnostics,
        advisory_status: advisoryResult.status,
      },
    }))
    toast.success('Sugestao aplicada na simulacao')
    setSugestaoOpen(false)
  } catch {
    toast.error('Erro ao aplicar sugestao')
  }
}}
```

- [ ] **Step 4: Passar advisory diagnostics para buildPreviewAvisos**

No `useMemo` de `previewAvisos`, adicionar:

```ts
advisoryDiagnostics: advisoryResult?.normalized_diagnostics,
```

- [ ] **Step 5: Disable "Gerar" durante advisory (Gap F)**

No botao de gerar, adicionar `disabled={advisoryLoading}`.

- [ ] **Step 6: Invalidar advisory quando overrides mudam**

```ts
// Limpar advisory salvo quando user mexe nas folgas
useEffect(() => {
  setAdvisoryResult(null)
}, [simulacaoPreview.previewRows])
```

- [ ] **Step 7: Remover logica legada**

- Remover `sugestaoFolgasData` useMemo (heuristica greedy)
- Remover `traduzirResultadoSugestao` function
- Remover import de `calcularSugestaoFolgas`

- [ ] **Step 8: Typecheck + teste manual**

Run: `npm run typecheck`
Expected: 0 erros

- [ ] **Step 9: Commit**

```
feat(advisory): SetorDetalhe integrado com advisory pipeline
```

---

## Chunk 3: Testes E2E + polish

### Task 9: Teste E2E solver advisory

**Files:**
- Create: `tests/main/solver-advisory.spec.ts`

- [ ] **Step 1: Criar teste E2E**

```ts
// tests/main/solver-advisory.spec.ts
import { describe, it, expect } from 'vitest'
import { buildSolverInput, runSolver } from '../../src/main/motor/solver-bridge'

describe('solver advisory mode', () => {
  it('retorna ADVISORY_OK quando arranjo é viavel', async () => {
    const input = await buildSolverInput(2, '2026-03-02', '2026-03-08', {
      solveMode: 'rapido',
    })
    ;(input.config as any).advisory_only = true

    const result = await runSolver(input, 30_000)

    expect(result.sucesso).toBe(true)
    expect(result.status).toBe('ADVISORY_OK')
    expect((result as any).advisory_pattern).toBeDefined()
    expect((result as any).advisory_pattern.length).toBeGreaterThan(0)
  }, 30_000)

  it('retorna diagnostico mesmo em advisory mode', async () => {
    const input = await buildSolverInput(2, '2026-03-02', '2026-03-08', {
      solveMode: 'rapido',
    })
    ;(input.config as any).advisory_only = true

    const result = await runSolver(input, 30_000)

    expect(result.diagnostico).toBeDefined()
    expect(result.diagnostico.generation_mode).toBe('ADVISORY')
  }, 30_000)

  it('geracao normal continua funcionando', async () => {
    const input = await buildSolverInput(2, '2026-03-02', '2026-03-08', {
      solveMode: 'rapido',
    })
    // sem advisory_only
    const result = await runSolver(input, 120_000)

    expect(result.sucesso).toBe(true)
    expect(result.alocacoes.length).toBeGreaterThan(0)
    expect(result.status).not.toBe('ADVISORY_OK')
  }, 120_000)
})
```

- [ ] **Step 2: Rodar**

Run: `npx vitest run tests/main/solver-advisory.spec.ts`
Expected: PASS (requer banco com seed)

- [ ] **Step 3: Commit**

```
test(advisory): E2E solver advisory mode
```

---

### Task 10: Teste renderer SugestaoSheet

**Files:**
- Create: `tests/renderer/sugestao-sheet.spec.tsx`

- [ ] **Step 1: Criar testes do componente**

```tsx
// tests/renderer/sugestao-sheet.spec.tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SugestaoSheet } from '../../src/renderer/src/componentes/SugestaoSheet'
import type { EscalaAdvisoryOutput } from '../../src/shared/advisory-types'

const mockAdvisory: EscalaAdvisoryOutput = {
  status: 'PROPOSAL_VALID',
  normalized_diagnostics: [],
  current: {
    criteria: [
      { code: 'COBERTURA_DIA', status: 'FAIL', title: 'Cobertura insuficiente', detail: 'SEG com deficit', source: 'PHASE1' },
    ],
  },
  proposal: {
    diff: [
      { colaborador_id: 1, nome: 'Alex', posto_apelido: 'Caixa 1', fixa_atual: 'SEG', fixa_proposta: 'QUA', variavel_atual: null, variavel_proposta: 'SEX' },
    ],
    criteria: [
      { code: 'COBERTURA_DIA', status: 'PASS', title: 'Proposta cobre todos os dias', detail: 'OK', source: 'PHASE1' },
      { code: 'DESCANSO_JORNADA', status: 'NOT_EVALUATED', title: 'Descanso nao avaliado', detail: 'So na geracao', source: 'PHASE1' },
    ],
  },
}

describe('SugestaoSheet', () => {
  it('nao mostra check verde quando criterio eh FAIL', () => {
    render(<SugestaoSheet open advisory={mockAdvisory} loading={false} onOpenChange={() => {}} onAceitar={() => {}} onDescartar={() => {}} />)
    // FAIL criteria should have red/error styling, not green
    const failItem = screen.getByText('Cobertura insuficiente')
    expect(failItem.closest('[data-status]')?.getAttribute('data-status')).toBe('FAIL')
  })

  it('mostra cinza em NOT_EVALUATED', () => {
    render(<SugestaoSheet open advisory={mockAdvisory} loading={false} onOpenChange={() => {}} onAceitar={() => {}} onDescartar={() => {}} />)
    const notEval = screen.getByText('Descanso nao avaliado')
    expect(notEval.closest('[data-status]')?.getAttribute('data-status')).toBe('NOT_EVALUATED')
  })

  it('mostra loading skeleton quando loading=true', () => {
    render(<SugestaoSheet open advisory={null} loading={true} onOpenChange={() => {}} onAceitar={() => {}} onDescartar={() => {}} />)
    expect(screen.getByText(/analisando/i)).toBeTruthy()
  })
})
```

- [ ] **Step 2: Rodar**

Run: `npx vitest run tests/renderer/sugestao-sheet.spec.tsx`
Expected: PASS

- [ ] **Step 3: Commit**

```
test(advisory): SugestaoSheet renderer tests
```

---

### Task 11: Limpeza e verificacao final

**Files:**
- Possivelmente: `src/shared/sugestao-folgas.ts` (pode deletar se nao usado)

- [ ] **Step 1: Verificar se sugestao-folgas.ts ainda eh importado**

Se nenhum arquivo importa `calcularSugestaoFolgas`, deletar `src/shared/sugestao-folgas.ts`.

- [ ] **Step 2: Rodar parity test**

Run: `npm run solver:test:parity`
Expected: PASS (advisory_only nao afeta geracao normal)

- [ ] **Step 3: Rodar typecheck final**

Run: `npm run typecheck`
Expected: 0 erros

- [ ] **Step 4: Rodar testes completos**

Run: `npx vitest run`
Expected: todos PASS

- [ ] **Step 5: Commit final**

```
chore(advisory): limpeza + verificacao de paridade
```

---

## Resumo de tasks

| Task | Chunk | Descricao | Estimativa |
|------|-------|-----------|-----------|
| 1 | Foundation | Tipos compartilhados + tipos solver | 5 min |
| 2 | Foundation | Python advisory_only | 10 min |
| 3 | Foundation | Advisory controller | 20 min |
| 4 | Foundation | IPC handler + servico | 10 min |
| 5 | Frontend | iaStore pendingAutoMessage | 5 min |
| 6 | Frontend | SugestaoSheet rewrite | 20 min |
| 7 | Frontend | build-avisos extensao | 5 min |
| 8 | Frontend | SetorDetalhe integracao | 25 min |
| 9 | Tests | E2E solver advisory | 10 min |
| 10 | Tests | Renderer SugestaoSheet tests | 10 min |
| 11 | Tests | Limpeza + verificacao | 10 min |

**Total: 11 tasks, 3 chunks**

**Total: 10 tasks, 3 chunks**
