/**
 * advisory-controller.ts — Solver-backed advisory: single solve with hierarchical soft pins.
 *
 * Pipeline (single solve, advisory_only=true = solve_folga_pattern):
 *   Solver WITH weighted pins → pin_violations booleans tell what changed.
 *   Diff comes from pin_violated flags, NOT frequency inference.
 *
 * Output contem APENAS solver diagnostics. TS diagnostics ficam na AvisosSection.
 * Ciclo e abstrato: feriados e excecoes sao stripados.
 */

import { createHash } from 'node:crypto'
import type {
  AdvisoryStatus,
  AdvisoryDiffItem,
  AdvisoryPinViolation,
  EscalaAdvisoryInput,
  EscalaAdvisoryOutputV2,
  SemanaDraftAdvisory,
} from '../../shared/advisory-types'
import type { PreviewDiagnostic } from '../../shared/preview-diagnostics'
import type { SolverInputDemanda, DiaSemana } from '../../shared'
import type { PinOrigin } from '../../shared/types'
import { buildSolverInput, runSolver, type BuildSolverInputOptions } from './solver-bridge'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DIAS_SEMANA: DiaSemana[] = ['SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB', 'DOM']

const ADVISORY_TIMEOUT_MS = 30_000

const BAND_LABELS: Record<number, string> = {
  0: 'folga',
  1: 'manhã',
  2: 'tarde',
  3: 'dia inteiro',
}

// ---------------------------------------------------------------------------
// 1. extractFolgaFromPattern (kept for legacy diff generation)
// ---------------------------------------------------------------------------

/**
 * Converts Phase 1 pattern output (array of {c, d, band} where band=0 is OFF)
 * into fixa/variavel per collaborator.
 *
 * Usa top-2 weekday (excluindo DOM) por frequencia:
 * - 1o mais frequente → fixa
 * - 2o mais frequente → variavel
 */
export function extractFolgaFromPattern(
  pattern: Array<{ c: number; d: number; band: number }>,
  days: string[],
  numColabs: number,
): Array<{ c: number; fixa: DiaSemana | null; variavel: DiaSemana | null }> {
  const totalWeeks = Math.ceil(days.length / 7)
  if (totalWeeks === 0) {
    return Array.from({ length: numColabs }, (_, c) => ({ c, fixa: null, variavel: null }))
  }

  const offsByColab = new Map<number, Map<DiaSemana, number>>()
  for (const { c, d, band } of pattern) {
    if (band !== 0) continue
    if (d < 0 || d >= days.length) continue

    const date = new Date(days[d]! + 'T00:00:00')
    const dowIdx = (date.getDay() + 6) % 7
    const diaSemana = DIAS_SEMANA[dowIdx]!

    let dayMap = offsByColab.get(c)
    if (!dayMap) {
      dayMap = new Map<DiaSemana, number>()
      offsByColab.set(c, dayMap)
    }
    dayMap.set(diaSemana, (dayMap.get(diaSemana) ?? 0) + 1)
  }

  const result: Array<{ c: number; fixa: DiaSemana | null; variavel: DiaSemana | null }> = []

  for (let c = 0; c < numColabs; c++) {
    const dayMap = offsByColab.get(c)
    let fixa: DiaSemana | null = null
    let variavel: DiaSemana | null = null

    if (dayMap) {
      // Top-2 weekday (excl DOM) off days by frequency → fixa (1st) + variavel (2nd)
      const weekdayEntries = [...dayMap.entries()]
        .filter(([dia]) => dia !== 'DOM')
        .sort((a, b) => b[1] - a[1])

      if (weekdayEntries.length >= 1 && weekdayEntries[0]![1] > 0) {
        fixa = weekdayEntries[0]![0]
      }
      if (weekdayEntries.length >= 2 && weekdayEntries[1]![1] > 0) {
        variavel = weekdayEntries[1]![0]
      }
    }

    result.push({ c, fixa, variavel })
  }

  return result
}

// ---------------------------------------------------------------------------
// 2. convertSemanaDraftToDemanda
// ---------------------------------------------------------------------------

export function convertSemanaDraftToDemanda(
  draft: SemanaDraftAdvisory,
  _empresa?: { hora_abertura?: string; hora_fechamento?: string },
): SolverInputDemanda[] {
  const demanda: SolverInputDemanda[] = []

  for (const dia of DIAS_SEMANA) {
    const diaConfig = draft.dias[dia]
    if (!diaConfig || !diaConfig.ativo) continue

    const segmentos = diaConfig.usa_padrao ? draft.padrao.segmentos : diaConfig.segmentos

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
// 3. computeAdvisoryInputHash
// ---------------------------------------------------------------------------

export function computeAdvisoryInputHash(input: EscalaAdvisoryInput): string {
  const hashPayload = {
    setor_id: input.setor_id,
    data_inicio: input.data_inicio,
    data_fim: input.data_fim,
    pinned_folga_externo: [...input.pinned_folga_externo].sort(
      (a, b) => a.c - b.c || a.d - b.d || a.band - b.band,
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

  return createHash('sha256')
    .update(JSON.stringify(hashPayload))
    .digest('hex')
    .slice(0, 16)
}

// ---------------------------------------------------------------------------
// 4. Helpers
// ---------------------------------------------------------------------------

function generateDaysList(dataInicio: string, dataFim: string): string[] {
  const days: string[] = []
  const start = new Date(dataInicio + 'T00:00:00')
  const end = new Date(dataFim + 'T00:00:00')
  const d = new Date(start)
  while (d <= end) {
    days.push(d.toISOString().slice(0, 10))
    d.setDate(d.getDate() + 1)
  }
  return days
}

function dayOfWeekLabel(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  return DIAS_SEMANA[(d.getDay() + 6) % 7] ?? '?'
}

function buildViolationDescription(bandExpected: number, bandActual: number, dia: string): string {
  const expected = BAND_LABELS[bandExpected] ?? '?'
  const actual = BAND_LABELS[bandActual] ?? '?'
  return `${dia}: ${expected} → ${actual}`
}

function buildDiffFromPattern(
  pattern: Array<{ c: number; d: number; band: number }>,
  days: string[],
  numColabs: number,
  colabIdMap: number[],
  colaboradores: Array<{ id: number; nome: string }>,
  currentFolgas: EscalaAdvisoryInput['current_folgas'],
): AdvisoryDiffItem[] {
  const proposed = extractFolgaFromPattern(pattern, days, numColabs)
  return proposed.map(({ c, fixa, variavel }) => {
    const colabId = colabIdMap[c] ?? -1
    const cur = currentFolgas.find((f) => f.colaborador_id === colabId)
    const colab = colaboradores[c]
    return {
      colaborador_id: colabId,
      nome: colab?.nome ?? `Colaborador ${colabId}`,
      posto_apelido: '',
      fixa_atual: cur?.fixa ?? null,
      fixa_proposta: fixa,
      variavel_atual: cur?.variavel ?? null,
      variavel_proposta: variavel,
    }
  })
}

function hasMeaningfulChanges(diff: AdvisoryDiffItem[]): boolean {
  return diff.some(
    (d) => d.fixa_atual !== d.fixa_proposta || d.variavel_atual !== d.variavel_proposta,
  )
}

// ---------------------------------------------------------------------------
// 5. runAdvisory — single solve with hierarchical soft pins
// ---------------------------------------------------------------------------

/**
 * Single solve with weighted pins. Diff comes from pin_violated booleans
 * (Task 4 output), NOT from extractFolgaFromPattern frequency inference.
 *
 * validate_only=true → returns immediately with CURRENT_VALID/NO_PROPOSAL.
 * validate_only=false → also builds pin_violations and legacy diff.
 *
 * Output contem APENAS solver diagnostics. TS diagnostics ficam na AvisosSection.
 */
export async function runAdvisory(
  input: EscalaAdvisoryInput,
): Promise<EscalaAdvisoryOutputV2> {
  // ═══════════════════════════════════════════════════════════════════════════
  // 1. Build solver input WITH weighted pins
  // ═══════════════════════════════════════════════════════════════════════════

  const options: BuildSolverInputOptions = {
    solveMode: input.solve_mode ?? 'rapido',
    ...(input.rules_override ? { rulesOverride: input.rules_override } : {}),
    pinnedFolgaExterno: input.pinned_folga_externo.length > 0
      ? input.pinned_folga_externo
      : undefined,
  }

  const solverInput = await buildSolverInput(
    input.setor_id,
    input.data_inicio,
    input.data_fim,
    [],
    options,
  )

  if (input.demanda_preview) {
    solverInput.demanda = convertSemanaDraftToDemanda(input.demanda_preview)
  }

  // Ciclo e abstrato — strip feriados e excecoes
  solverInput.feriados = []
  solverInput.excecoes = []
  solverInput.config.advisory_only = true

  const colabIdMap = solverInput.colaboradores.map((c) => c.id)
  const days = generateDaysList(input.data_inicio, input.data_fim)
  const solverDiagnostics: PreviewDiagnostic[] = []

  // ═══════════════════════════════════════════════════════════════════════════
  // 2. SINGLE SOLVE
  // ═══════════════════════════════════════════════════════════════════════════

  let solverResult: any
  try {
    console.log('[advisory] Single solve with weighted pins...')
    solverResult = await runSolver(solverInput, ADVISORY_TIMEOUT_MS)
    console.log(`[advisory] Result: sucesso=${solverResult.sucesso}, status=${solverResult.status}`)
  } catch (err: any) {
    console.error('[advisory] Solver crashed:', err?.message ?? err)
    return {
      status: 'NO_PROPOSAL',
      diagnostics: [{
        code: 'VALIDACAO_ERRO',
        severity: 'error',
        gate: 'BLOCK',
        title: 'Erro ao analisar o arranjo.',
        detail: err?.message ?? 'Erro desconhecido.',
        source: 'advisory_current',
      }],
      fallback: { should_open_ia: true, reason: err?.message ?? 'Erro', diagnosis_payload: null },
    }
  }

  if (!solverResult.sucesso || solverResult.status === 'ADVISORY_INFEASIBLE' || solverResult.status === 'INFEASIBLE') {
    return {
      status: 'NO_PROPOSAL',
      diagnostics: [{
        code: 'VALIDACAO_INVIAVEL',
        severity: 'error',
        gate: 'BLOCK',
        title: 'O arranjo de folgas atual nao e viavel para o periodo selecionado.',
        detail: 'Com as restricoes de jornada e demanda, este arranjo nao funciona.',
        source: 'advisory_current',
      }],
      fallback: { should_open_ia: true, reason: 'Arranjo inviavel.', diagnosis_payload: null },
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 3. validate_only → return early
  // ═══════════════════════════════════════════════════════════════════════════

  if (input.validate_only) {
    return {
      status: 'CURRENT_VALID',
      diagnostics: solverDiagnostics,
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 4. Extract pin violations from solver diagnostico
  // ═══════════════════════════════════════════════════════════════════════════

  const rawViolations: Array<{
    c: number; d: number; origin: string; weight: number;
    band_expected: number; band_actual: number
  }> = solverResult.diagnostico?.pin_violations ?? []
  const pinCost: number = solverResult.diagnostico?.pin_cost ?? 0

  // ═══════════════════════════════════════════════════════════════════════════
  // 5. Build human-readable violations
  // ═══════════════════════════════════════════════════════════════════════════

  const pinViolations: AdvisoryPinViolation[] = rawViolations.map((v) => {
    const colabId = colabIdMap[v.c] ?? -1
    const colab = solverInput.colaboradores[v.c]
    const date = days[v.d] ?? ''
    const diaSemana = date ? dayOfWeekLabel(date) : '?'
    return {
      colaborador_id: colabId,
      nome: colab?.nome ?? `Colaborador ${colabId}`,
      dia: diaSemana,
      data: date,
      origin: v.origin as PinOrigin,
      weight: v.weight,
      band_expected: v.band_expected,
      band_actual: v.band_actual,
      descricao: buildViolationDescription(v.band_expected, v.band_actual, diaSemana),
    }
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // 6. Determine status
  // ═══════════════════════════════════════════════════════════════════════════

  const status: AdvisoryStatus = pinCost === 0 ? 'CURRENT_VALID' : 'PROPOSAL_VALID'

  // ═══════════════════════════════════════════════════════════════════════════
  // 7. Build legacy diff for retrocompat with SugestaoSheet
  // ═══════════════════════════════════════════════════════════════════════════

  let proposal: EscalaAdvisoryOutputV2['proposal'] | undefined
  if (pinCost > 0 && solverResult.advisory_pattern) {
    const diff = buildDiffFromPattern(
      solverResult.advisory_pattern,
      days,
      colabIdMap.length,
      colabIdMap,
      solverInput.colaboradores,
      input.current_folgas,
    )
    if (hasMeaningfulChanges(diff)) {
      proposal = { diff }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 8. Build hierarchy summary
  // ═══════════════════════════════════════════════════════════════════════════

  const hierarchySummary = {
    auto_changes: pinViolations.filter((v) => v.origin === 'auto').length,
    manual_changes: pinViolations.filter((v) => v.origin === 'manual').length,
    saved_changes: pinViolations.filter((v) => v.origin === 'saved').length,
  }

  return {
    status,
    diagnostics: solverDiagnostics,
    ...(proposal ? { proposal } : {}),
    pin_violations: pinViolations.length > 0 ? pinViolations : undefined,
    pin_cost: pinCost,
    hierarchy_summary: hierarchySummary,
  }
}
