/**
 * advisory-controller.ts — Orchestration logic for solver-backed advisory system.
 *
 * Validates current folga arrangement via Phase 1 (lightweight model),
 * proposes alternatives when invalid, normalizes diagnostics, computes input hash.
 */

import { createHash } from 'node:crypto'
import type {
  AdvisoryStatus,
  AdvisoryCriterion,
  AdvisoryCriterionStatus,
  AdvisoryDiffItem,
  EscalaAdvisoryInput,
  EscalaAdvisoryOutput,
  SemanaDraftAdvisory,
} from '../../shared/advisory-types'
import type { PreviewDiagnostic, PreviewDiagnosticSeverity } from '../../shared/preview-diagnostics'
import type { SolverInput, SolverOutput, DiaSemana, SolverInputDemanda } from '../../shared'
import { buildSolverInput, runSolver, type BuildSolverInputOptions } from './solver-bridge'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DIAS_SEMANA: DiaSemana[] = ['SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB', 'DOM']

/** Timeout for advisory solver calls (lightweight Phase 1) */
const ADVISORY_TIMEOUT_MS = 30_000

// ---------------------------------------------------------------------------
// 1. extractFolgaFromPattern
// ---------------------------------------------------------------------------

/**
 * Converts Phase 1 pattern output (array of {c, d, band} where band=0 is OFF)
 * into fixa/variavel per collaborator.
 *
 * - Day appearing in >80% of total weeks -> fixa
 * - Day appearing in 30-80% of total weeks -> variavel (XOR folga)
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

  // Collect OFF days per collaborator, grouped by day-of-week
  const offsByColab = new Map<number, Map<DiaSemana, number>>()
  for (const { c, d, band } of pattern) {
    if (band !== 0) continue
    if (d < 0 || d >= days.length) continue

    // Append T00:00:00 to force local timezone parsing (bare ISO date = UTC midnight)
    const date = new Date(days[d]! + 'T00:00:00')
    // (getDay()+6)%7 maps: Sun=6(DOM), Mon=0(SEG), ..., Sat=5(SAB)
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
      // Sort by frequency descending to pick highest-freq as fixa first
      const entries = [...dayMap.entries()].sort((a, b) => b[1] - a[1])

      for (const [dia, count] of entries) {
        const ratio = count / totalWeeks
        if (ratio > 0.8 && fixa === null) {
          fixa = dia
        } else if (ratio >= 0.3 && ratio <= 0.8 && variavel === null) {
          variavel = dia
        }
      }
    }

    result.push({ c, fixa, variavel })
  }

  return result
}

// ---------------------------------------------------------------------------
// 2. convertSemanaDraftToDemanda
// ---------------------------------------------------------------------------

/**
 * Converts SemanaDraftAdvisory (from DemandaEditor UI draft) into SolverInput['demanda'] format.
 */
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
// 3. normalizeAdvisoryToDiagnostics
// ---------------------------------------------------------------------------

/**
 * Converts EscalaAdvisoryOutput criteria into PreviewDiagnostic[] for the unified Avisos panel.
 */
export function normalizeAdvisoryToDiagnostics(
  output: EscalaAdvisoryOutput,
): PreviewDiagnostic[] {
  const diagnostics: PreviewDiagnostic[] = []
  const hasProposal = output.proposal != null

  function mapCriteria(
    criteria: AdvisoryCriterion[],
    source: 'advisory_current' | 'advisory_proposal',
  ): void {
    for (const criterion of criteria) {
      if (criterion.status === 'NOT_EVALUATED') continue

      const severity: PreviewDiagnosticSeverity = criterion.status === 'FAIL' ? 'error' : 'info'
      const gate = criterion.status === 'FAIL' ? 'BLOCK' as const : 'ALLOW' as const

      diagnostics.push({
        code: criterion.code,
        severity,
        gate,
        title: criterion.title,
        detail: criterion.detail,
        source,
      })
    }
  }

  mapCriteria(output.current.criteria, 'advisory_current')

  if (output.proposal) {
    mapCriteria(output.proposal.criteria, 'advisory_proposal')
  }

  return diagnostics
}

// ---------------------------------------------------------------------------
// 4. computeAdvisoryInputHash
// ---------------------------------------------------------------------------

/**
 * Creates a deterministic SHA-256 hash (truncated to 16 chars) from the advisory input.
 * Used for invalidation tracking — if hash changes, advisory must re-run.
 */
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
// 5. runAdvisory — main pipeline
// ---------------------------------------------------------------------------

/** Criterion title/detail templates */
const CRITERION_TEMPLATES: Record<
  AdvisoryCriterion['code'],
  { title: string; passDetail: string; failDetail: string }
> = {
  COBERTURA_DIA: {
    title: 'Cobertura diaria',
    passDetail: 'Todos os dias atendem a demanda minima.',
    failDetail: 'A configuracao atual de folgas nao atende a demanda minima em todos os dias.',
  },
  DOMINGOS_CONSECUTIVOS: {
    title: 'Domingos consecutivos',
    passDetail: 'Nenhum colaborador excede o limite de domingos consecutivos.',
    failDetail: 'Pelo menos um colaborador excederia o limite de domingos consecutivos.',
  },
  DOMINGO_EXATO: {
    title: 'Ciclo exato de domingos',
    passDetail: 'O rodizio de domingos esta equilibrado com a demanda.',
    failDetail: 'O ciclo de domingos nao atende ao rodizio exato configurado.',
  },
  COBERTURA_FAIXA: {
    title: 'Cobertura por faixa horaria',
    passDetail: 'Todas as faixas horarias atendem a demanda.',
    failDetail: 'Pelo menos uma faixa horaria nao atende a demanda minima.',
  },
  DESCANSO_JORNADA: {
    title: 'Descanso entre jornadas',
    passDetail: 'Todos os colaboradores cumprem o descanso interjornada.',
    failDetail: 'Pelo menos um colaborador nao teria descanso interjornada minimo.',
  },
}

function buildCriterion(
  code: AdvisoryCriterion['code'],
  status: AdvisoryCriterionStatus,
): AdvisoryCriterion {
  const tmpl = CRITERION_TEMPLATES[code]
  return {
    code,
    status,
    title: tmpl.title,
    detail: status === 'FAIL' ? tmpl.failDetail : tmpl.passDetail,
    source: 'PHASE1',
  }
}

/**
 * Orchestrates the full advisory flow:
 * 1. Build solver input from DB
 * 2. Patch demanda if preview provided
 * 3. Run Phase 1 solver with pinned folgas
 * 4. If invalid, run free solve to propose alternatives
 * 5. Normalize and return diagnostics
 */
export async function runAdvisory(
  input: EscalaAdvisoryInput,
): Promise<EscalaAdvisoryOutput> {
  // 1. Build solver input from DB
  const options: BuildSolverInputOptions = {
    solveMode: input.solve_mode ?? 'rapido',
    ...(input.max_time_seconds != null ? { maxTimeSeconds: input.max_time_seconds } : {}),
    ...(input.rules_override ? { rulesOverride: input.rules_override } : {}),
    pinnedFolgaExterno: input.pinned_folga_externo.length > 0
      ? input.pinned_folga_externo
      : undefined,
  }

  const solverInput = await buildSolverInput(
    input.setor_id,
    input.data_inicio,
    input.data_fim,
    [], // pinnedCells — empty for advisory
    options,
  )

  // 2. Patch demanda if preview draft provided
  if (input.demanda_preview) {
    solverInput.demanda = convertSemanaDraftToDemanda(input.demanda_preview)
  }

  // 3. Set advisory_only flag
  solverInput.config.advisory_only = true

  // 4. Save collaborator ID map for index -> ID mapping
  const colabIdMap = solverInput.colaboradores.map((c) => c.id)

  // 5. Run solver with 30s timeout
  let currentResult: SolverOutput
  try {
    currentResult = await runSolver(solverInput, ADVISORY_TIMEOUT_MS)
  } catch (err: any) {
    // Solver crashed or timed out — return as CURRENT_INVALID with fallback
    return {
      status: 'CURRENT_INVALID',
      normalized_diagnostics: [],
      current: {
        criteria: [
          buildCriterion('COBERTURA_DIA', 'FAIL'),
          buildCriterion('DOMINGOS_CONSECUTIVOS', 'NOT_EVALUATED'),
          buildCriterion('DOMINGO_EXATO', 'NOT_EVALUATED'),
          buildCriterion('COBERTURA_FAIXA', 'NOT_EVALUATED'),
          buildCriterion('DESCANSO_JORNADA', 'NOT_EVALUATED'),
        ],
      },
      fallback: {
        should_open_ia: true,
        reason: `Solver falhou: ${err.message ?? 'erro desconhecido'}`,
        diagnosis_payload: null,
      },
    }
  }

  // 6. Build criteria from result
  const isCurrentValid = currentResult.sucesso && currentResult.status !== 'INFEASIBLE'
  const currentCriteria: AdvisoryCriterion[] = isCurrentValid
    ? [
        buildCriterion('COBERTURA_DIA', 'PASS'),
        buildCriterion('DOMINGOS_CONSECUTIVOS', 'PASS'),
        buildCriterion('DOMINGO_EXATO', 'PASS'),
        buildCriterion('COBERTURA_FAIXA', 'NOT_EVALUATED'),
        buildCriterion('DESCANSO_JORNADA', 'NOT_EVALUATED'),
      ]
    : [
        buildCriterion('COBERTURA_DIA', 'FAIL'),
        buildCriterion('DOMINGOS_CONSECUTIVOS', 'NOT_EVALUATED'),
        buildCriterion('DOMINGO_EXATO', 'NOT_EVALUATED'),
        buildCriterion('COBERTURA_FAIXA', 'NOT_EVALUATED'),
        buildCriterion('DESCANSO_JORNADA', 'NOT_EVALUATED'),
      ]

  // 7. If current invalid AND has pinned folgas, try free solve (propose alternatives)
  let proposal: EscalaAdvisoryOutput['proposal'] | undefined
  let fallback: EscalaAdvisoryOutput['fallback'] | undefined

  if (!isCurrentValid && input.pinned_folga_externo.length > 0) {
    try {
      // Deep clone: remove pinned folgas so solver can propose freely.
      // pinned_folga_externo is injected at runtime by buildSolverInput (not in TS type),
      // so we strip it via rest destructure on the raw config object.
      const { pinned_folga_externo: _dropped, ...cleanConfig } =
        solverInput.config as Record<string, unknown>
      const freeInput: SolverInput = {
        ...solverInput,
        config: { ...cleanConfig, advisory_only: true } as SolverInput['config'],
      }

      const freeResult = await runSolver(freeInput, ADVISORY_TIMEOUT_MS)

      if (freeResult.sucesso && freeResult.status !== 'INFEASIBLE' && freeResult.advisory_pattern) {
        // Extract proposed folgas from pattern
        const proposedFolgas = extractFolgaFromPattern(
          freeResult.advisory_pattern,
          generateDaysList(input.data_inicio, input.data_fim),
          colabIdMap.length,
        )

        // Build diff between current and proposed
        const diff: AdvisoryDiffItem[] = proposedFolgas.map(({ c, fixa, variavel }) => {
          const colabId = colabIdMap[c] ?? -1
          const currentFolga = input.current_folgas.find((f) => f.colaborador_id === colabId)
          const colab = solverInput.colaboradores[c]

          return {
            colaborador_id: colabId,
            nome: colab?.nome ?? `Colaborador ${colabId}`,
            posto_apelido: '',
            fixa_atual: currentFolga?.fixa ?? null,
            fixa_proposta: fixa,
            variavel_atual: currentFolga?.variavel ?? null,
            variavel_proposta: variavel,
          }
        })

        // Only include items that actually changed
        const meaningfulDiff = diff.filter(
          (d) => d.fixa_atual !== d.fixa_proposta || d.variavel_atual !== d.variavel_proposta,
        )

        proposal = {
          diff: meaningfulDiff,
          criteria: [
            buildCriterion('COBERTURA_DIA', 'PASS'),
            buildCriterion('DOMINGOS_CONSECUTIVOS', 'PASS'),
            buildCriterion('DOMINGO_EXATO', 'PASS'),
            buildCriterion('COBERTURA_FAIXA', 'NOT_EVALUATED'),
            buildCriterion('DESCANSO_JORNADA', 'NOT_EVALUATED'),
          ],
        }
      } else {
        // Free solve also failed
        fallback = {
          should_open_ia: true,
          reason: 'Solver nao encontrou arranjo viavel mesmo sem restricoes de folga.',
          diagnosis_payload: freeResult.erro ?? null,
        }
      }
    } catch {
      // Free solve crashed
      fallback = {
        should_open_ia: true,
        reason: 'Solver falhou ao tentar propor arranjo alternativo.',
        diagnosis_payload: null,
      }
    }
  }

  // 8. Determine final status
  let status: AdvisoryStatus
  if (isCurrentValid) {
    status = 'CURRENT_VALID'
  } else if (proposal) {
    status = 'PROPOSAL_VALID'
  } else if (fallback) {
    status = 'NO_PROPOSAL'
  } else {
    status = 'CURRENT_INVALID'
  }

  // 9. Build output and normalize diagnostics
  const output: EscalaAdvisoryOutput = {
    status,
    normalized_diagnostics: [], // placeholder, filled below
    current: { criteria: currentCriteria },
    ...(proposal ? { proposal } : {}),
    ...(fallback ? { fallback } : {}),
  }

  output.normalized_diagnostics = normalizeAdvisoryToDiagnostics(output)

  return output
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Generates an array of ISO date strings for each day in the range [start, end] inclusive.
 */
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
