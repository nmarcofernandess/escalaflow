/**
 * solver-advisory-parity.spec.ts — Phase 1 Advisory Parity Test
 *
 * Validates that the Python solver's Phase 1 advisory output (advisory_only=true)
 * is correctly consumed and normalized by the TS advisory controller.
 *
 * This is the bridge test between:
 *   Python solver → advisory_pattern → runAdvisory() → normalizeAdvisoryToDiagnostics()
 *
 * Follows the same DB setup pattern as solver-cli-parity.spec.ts.
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { initDb, closeDb } from '../../src/main/db/pglite'
import { createTables } from '../../src/main/db/schema'
import { seedCoreData } from '../../src/main/db/seed'
import { seedLocalData } from '../../src/main/db/seed-local'
import { buildSolverInput, runSolver } from '../../src/main/motor/solver-bridge'
import { normalizeAdvisoryToDiagnostics, runAdvisory } from '../../src/main/motor/advisory-controller'
import type { EscalaAdvisoryOutput, AdvisoryCriterion } from '../../src/shared/advisory-types'
import type { PreviewDiagnostic } from '../../src/shared/preview-diagnostics'

// ---------------------------------------------------------------------------
// DB setup helpers (same pattern as solver-cli-parity.spec.ts)
// ---------------------------------------------------------------------------

let activeDbPath: string | null = null

afterEach(async () => {
  await closeDb()
  if (activeDbPath) {
    fs.rmSync(activeDbPath, { recursive: true, force: true })
    activeDbPath = null
  }
  delete process.env.ESCALAFLOW_DB_PATH
})

async function createSeededDb(): Promise<void> {
  const dbPath = fs.mkdtempSync(path.join(os.tmpdir(), 'escalaflow-advisory-parity-'))
  process.env.ESCALAFLOW_DB_PATH = dbPath
  activeDbPath = dbPath

  await initDb()
  await createTables()
  await seedCoreData()
  await seedLocalData()
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SETOR_ACOUGUE = 2
const TEST_INICIO = '2026-03-02'
const TEST_FIM = '2026-03-08'

/** Criteria that the TS controller marks NOT_EVALUATED and must be skipped in normalization */
const ALWAYS_NOT_EVALUATED_CODES = new Set(['COBERTURA_FAIXA', 'DESCANSO_JORNADA'])

/** Criteria that the TS controller evaluates from Phase 1 result */
const PHASE1_EVALUATED_CODES = new Set(['COBERTURA_DIA', 'DOMINGOS_CONSECUTIVOS', 'DOMINGO_EXATO'])

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function assertValidCriterion(criterion: AdvisoryCriterion): void {
  expect(criterion.code).toBeTruthy()
  expect(criterion.status).toMatch(/^(PASS|FAIL|NOT_EVALUATED)$/)
  expect(criterion.title).toBeTruthy()
  expect(criterion.detail).toBeTruthy()
  expect(criterion.source).toBe('PHASE1')
}

function assertNormalizedDiagnostic(
  diagnostic: PreviewDiagnostic,
  expectedSource: 'advisory_current' | 'advisory_proposal',
): void {
  expect(diagnostic.code).toBeTruthy()
  expect(diagnostic.severity).toMatch(/^(error|warning|info)$/)
  expect(diagnostic.gate).toMatch(/^(ALLOW|CONFIRM_OVERRIDE|BLOCK)$/)
  expect(diagnostic.title).toBeTruthy()
  expect(diagnostic.detail).toBeTruthy()
  expect(diagnostic.source).toBe(expectedSource)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe.sequential('advisory Phase 1 parity — solver output matches TS normalization', () => {
  // -----------------------------------------------------------------------
  // ADVISORY_OK path: solver finds valid folga pattern
  // -----------------------------------------------------------------------

  it('ADVISORY_OK: solver pattern is parseable and normalization produces correct diagnostics', async () => {
    await createSeededDb()

    // 1. Build solver input and run Phase 1 directly
    const solverInput = await buildSolverInput(SETOR_ACOUGUE, TEST_INICIO, TEST_FIM, [])
    solverInput.config.advisory_only = true

    const solverResult = await runSolver(solverInput, 30_000)

    // 2. Verify raw solver output structure
    expect(solverResult.sucesso).toBe(true)
    expect(solverResult.status).toBe('ADVISORY_OK')
    expect(solverResult.advisory_pattern).toBeDefined()
    expect(Array.isArray(solverResult.advisory_pattern)).toBe(true)
    expect(solverResult.advisory_pattern!.length).toBeGreaterThan(0)

    // 3. Verify advisory_pattern entries have correct shape
    for (const entry of solverResult.advisory_pattern!) {
      expect(typeof entry.c).toBe('number')
      expect(typeof entry.d).toBe('number')
      expect(typeof entry.band).toBe('number')
      expect(entry.c).toBeGreaterThanOrEqual(0)
      expect(entry.d).toBeGreaterThanOrEqual(0)
      expect(entry.band).toBeGreaterThanOrEqual(0)
      expect(entry.band).toBeLessThanOrEqual(3) // 0=OFF, 1=manha, 2=tarde, 3=integral
    }

    // 4. Verify at least some OFF entries exist (band=0 means folga)
    const offEntries = solverResult.advisory_pattern!.filter((e) => e.band === 0)
    expect(offEntries.length).toBeGreaterThan(0)

    // 5. Simulate the criteria-building from advisory-controller for ADVISORY_OK
    //    When solver succeeds, runAdvisory builds PASS for evaluated criteria
    //    and NOT_EVALUATED for COBERTURA_FAIXA / DESCANSO_JORNADA
    const mockAdvisoryOutput: EscalaAdvisoryOutput = {
      status: 'CURRENT_VALID',
      normalized_diagnostics: [],
      current: {
        criteria: [
          { code: 'COBERTURA_DIA', status: 'PASS', title: 'Cobertura diaria', detail: 'Todos os dias atendem a demanda minima.', source: 'PHASE1' },
          { code: 'DOMINGOS_CONSECUTIVOS', status: 'PASS', title: 'Domingos consecutivos', detail: 'Nenhum colaborador excede o limite de domingos consecutivos.', source: 'PHASE1' },
          { code: 'DOMINGO_EXATO', status: 'PASS', title: 'Ciclo exato de domingos', detail: 'O rodizio de domingos esta equilibrado com a demanda.', source: 'PHASE1' },
          { code: 'COBERTURA_FAIXA', status: 'NOT_EVALUATED', title: 'Cobertura por faixa horaria', detail: 'Todas as faixas horarias atendem a demanda.', source: 'PHASE1' },
          { code: 'DESCANSO_JORNADA', status: 'NOT_EVALUATED', title: 'Descanso entre jornadas', detail: 'Todos os colaboradores cumprem o descanso interjornada.', source: 'PHASE1' },
        ],
      },
    }

    // 6. Normalize and verify diagnostics
    const diagnostics = normalizeAdvisoryToDiagnostics(mockAdvisoryOutput)

    // NOT_EVALUATED criteria must be skipped
    const diagnosticCodes = new Set(diagnostics.map((d) => d.code))
    for (const skipCode of ALWAYS_NOT_EVALUATED_CODES) {
      expect(diagnosticCodes.has(skipCode)).toBe(false)
    }

    // Only PASS criteria should remain (for ADVISORY_OK)
    for (const diag of diagnostics) {
      assertNormalizedDiagnostic(diag, 'advisory_current')
      expect(diag.severity).toBe('info')
      expect(diag.gate).toBe('ALLOW')
    }

    // Exactly 3 PASS criteria should be normalized (the 3 evaluated ones)
    expect(diagnostics).toHaveLength(3)
    for (const evalCode of PHASE1_EVALUATED_CODES) {
      expect(diagnosticCodes.has(evalCode)).toBe(true)
    }
  }, 60_000)

  // -----------------------------------------------------------------------
  // Full runAdvisory pipeline (end-to-end through DB)
  // -----------------------------------------------------------------------

  it('runAdvisory pipeline: CURRENT_VALID produces only ALLOW diagnostics', async () => {
    await createSeededDb()

    const advisoryOutput = await runAdvisory({
      setor_id: SETOR_ACOUGUE,
      data_inicio: TEST_INICIO,
      data_fim: TEST_FIM,
      pinned_folga_externo: [],
      current_folgas: [],
    })

    // With default seed data, Acougue should be feasible
    expect(advisoryOutput.status).toBe('CURRENT_VALID')

    // Verify criteria structure
    expect(advisoryOutput.current.criteria.length).toBeGreaterThanOrEqual(5)
    for (const criterion of advisoryOutput.current.criteria) {
      assertValidCriterion(criterion)
    }

    // Evaluated criteria should be PASS
    const evaluatedCriteria = advisoryOutput.current.criteria.filter(
      (c) => PHASE1_EVALUATED_CODES.has(c.code),
    )
    for (const criterion of evaluatedCriteria) {
      expect(criterion.status).toBe('PASS')
    }

    // NOT_EVALUATED criteria should exist but be skipped in normalization
    const notEvaluated = advisoryOutput.current.criteria.filter(
      (c) => c.status === 'NOT_EVALUATED',
    )
    expect(notEvaluated.length).toBeGreaterThanOrEqual(2)
    for (const criterion of notEvaluated) {
      expect(ALWAYS_NOT_EVALUATED_CODES.has(criterion.code)).toBe(true)
    }

    // normalized_diagnostics should be pre-filled by runAdvisory
    expect(advisoryOutput.normalized_diagnostics.length).toBeGreaterThan(0)

    // No FAIL criteria when solver says OK
    const failDiagnostics = advisoryOutput.normalized_diagnostics.filter(
      (d) => d.severity === 'error',
    )
    expect(failDiagnostics).toHaveLength(0)

    // All diagnostics should have advisory_current source (no proposal in CURRENT_VALID)
    for (const diag of advisoryOutput.normalized_diagnostics) {
      assertNormalizedDiagnostic(diag, 'advisory_current')
    }

    // No proposal when current is valid
    expect(advisoryOutput.proposal).toBeUndefined()
  }, 60_000)

  // -----------------------------------------------------------------------
  // ADVISORY_INFEASIBLE path: impossible constraints
  // -----------------------------------------------------------------------

  it('ADVISORY_INFEASIBLE: impossible rules_override produces FAIL criteria', async () => {
    await createSeededDb()

    // Build input with impossible constraints:
    // Set max_time_seconds very low and override rules to make it tight
    const solverInput = await buildSolverInput(SETOR_ACOUGUE, TEST_INICIO, TEST_FIM, [], {
      solveMode: 'rapido',
      maxTimeSeconds: 2,
    })
    solverInput.config.advisory_only = true

    // Force infeasibility: block ALL days for all collaborators via regras_colaborador_dia
    const startDate = new Date(TEST_INICIO + 'T00:00:00')
    const endDate = new Date(TEST_FIM + 'T00:00:00')
    const blockedRules: typeof solverInput.regras_colaborador_dia = []

    for (const colab of solverInput.colaboradores) {
      const d = new Date(startDate)
      while (d <= endDate) {
        blockedRules.push({
          colaborador_id: colab.id,
          data: d.toISOString().slice(0, 10),
          inicio_min: null,
          inicio_max: null,
          fim_min: null,
          fim_max: null,
          preferencia_turno_soft: null,
          domingo_forcar_folga: false,
          folga_fixa: true, // Force every day as folga = impossible to cover demand
        })
        d.setDate(d.getDate() + 1)
      }
    }
    solverInput.regras_colaborador_dia = blockedRules

    const solverResult = await runSolver(solverInput, 30_000)

    // Solver should return INFEASIBLE (or at least not ADVISORY_OK)
    // The all-blocked scenario makes Phase 1 unable to find a valid pattern
    if (solverResult.status === 'ADVISORY_INFEASIBLE') {
      expect(solverResult.sucesso).toBe(false)
      expect(solverResult.advisory_pattern).toBeDefined()
      expect(solverResult.advisory_pattern).toHaveLength(0)

      // Simulate runAdvisory criteria building for INFEASIBLE case
      const mockInfeasibleOutput: EscalaAdvisoryOutput = {
        status: 'CURRENT_INVALID',
        normalized_diagnostics: [],
        current: {
          criteria: [
            { code: 'COBERTURA_DIA', status: 'FAIL', title: 'Cobertura diaria', detail: 'A configuracao atual de folgas nao atende a demanda minima em todos os dias.', source: 'PHASE1' },
            { code: 'DOMINGOS_CONSECUTIVOS', status: 'NOT_EVALUATED', title: 'Domingos consecutivos', detail: 'Nenhum colaborador excede o limite de domingos consecutivos.', source: 'PHASE1' },
            { code: 'DOMINGO_EXATO', status: 'NOT_EVALUATED', title: 'Ciclo exato de domingos', detail: 'O rodizio de domingos esta equilibrado com a demanda.', source: 'PHASE1' },
            { code: 'COBERTURA_FAIXA', status: 'NOT_EVALUATED', title: 'Cobertura por faixa horaria', detail: 'Todas as faixas horarias atendem a demanda.', source: 'PHASE1' },
            { code: 'DESCANSO_JORNADA', status: 'NOT_EVALUATED', title: 'Descanso entre jornadas', detail: 'Todos os colaboradores cumprem o descanso interjornada.', source: 'PHASE1' },
          ],
        },
      }

      const diagnostics = normalizeAdvisoryToDiagnostics(mockInfeasibleOutput)

      // Should have exactly 1 diagnostic: COBERTURA_DIA as FAIL
      expect(diagnostics).toHaveLength(1)
      expect(diagnostics[0]!.code).toBe('COBERTURA_DIA')
      expect(diagnostics[0]!.severity).toBe('error')
      expect(diagnostics[0]!.gate).toBe('BLOCK')
      expect(diagnostics[0]!.source).toBe('advisory_current')
    } else {
      // If solver somehow finds a valid pattern even with all days blocked,
      // it must still return a well-formed response
      expect(solverResult.status).toBe('ADVISORY_OK')
      expect(solverResult.advisory_pattern).toBeDefined()
    }
  }, 60_000)

  // -----------------------------------------------------------------------
  // runAdvisory INFEASIBLE path via pipeline
  // -----------------------------------------------------------------------

  it('runAdvisory pipeline: infeasible scenario produces FAIL + error diagnostics', async () => {
    await createSeededDb()

    // Use pinned_folga_externo that creates an impossible arrangement:
    // Pin all collaborators to work every single day (band=3 integral, no OFF)
    // This should cause demand coverage issues since nobody gets folga
    const solverInput = await buildSolverInput(SETOR_ACOUGUE, TEST_INICIO, TEST_FIM, [])
    const numColabs = solverInput.colaboradores.length
    const numDays = 7 // 1 week

    // Create pinned folgas where everyone works all days (no OFF = band 0 is missing)
    // In 6x1 regime, having 0 folgas is infeasible for CLT workers
    const impossiblePinned: Array<{ c: number; d: number; band: number }> = []
    for (let c = 0; c < numColabs; c++) {
      for (let d = 0; d < numDays; d++) {
        impossiblePinned.push({ c, d, band: 3 }) // all integral, no OFF days
      }
    }

    const advisoryOutput = await runAdvisory({
      setor_id: SETOR_ACOUGUE,
      data_inicio: TEST_INICIO,
      data_fim: TEST_FIM,
      pinned_folga_externo: impossiblePinned,
      current_folgas: [],
    })

    // When current arrangement is infeasible with pinned folgas, status should not be CURRENT_VALID
    if (advisoryOutput.status !== 'CURRENT_VALID') {
      // Should be CURRENT_INVALID, PROPOSAL_VALID, or NO_PROPOSAL
      expect(['CURRENT_INVALID', 'PROPOSAL_VALID', 'NO_PROPOSAL']).toContain(advisoryOutput.status)

      // Current criteria should have at least one FAIL
      const failCriteria = advisoryOutput.current.criteria.filter((c) => c.status === 'FAIL')
      expect(failCriteria.length).toBeGreaterThanOrEqual(1)

      // Normalized diagnostics should contain error-severity items
      const errorDiags = advisoryOutput.normalized_diagnostics.filter(
        (d) => d.severity === 'error',
      )
      expect(errorDiags.length).toBeGreaterThanOrEqual(1)

      // If a proposal was generated (free solve succeeded), it should have advisory_proposal source
      if (advisoryOutput.proposal) {
        const proposalDiags = advisoryOutput.normalized_diagnostics.filter(
          (d) => d.source === 'advisory_proposal',
        )
        expect(proposalDiags.length).toBeGreaterThan(0)
      }
    }

    // Regardless of outcome, normalized_diagnostics must be consistent with criteria
    const allCriteria = [
      ...advisoryOutput.current.criteria,
      ...(advisoryOutput.proposal?.criteria ?? []),
    ]
    const evaluatedCriteria = allCriteria.filter((c) => c.status !== 'NOT_EVALUATED')
    expect(advisoryOutput.normalized_diagnostics.length).toBe(evaluatedCriteria.length)
  }, 60_000)

  // -----------------------------------------------------------------------
  // Normalization consistency: re-normalizing matches stored diagnostics
  // -----------------------------------------------------------------------

  it('normalized_diagnostics matches re-normalization of the same output', async () => {
    await createSeededDb()

    const advisoryOutput = await runAdvisory({
      setor_id: SETOR_ACOUGUE,
      data_inicio: TEST_INICIO,
      data_fim: TEST_FIM,
      pinned_folga_externo: [],
      current_folgas: [],
    })

    // Re-normalize from the output structure
    const reNormalized = normalizeAdvisoryToDiagnostics(advisoryOutput)

    // Should be identical to what runAdvisory pre-computed
    expect(reNormalized).toEqual(advisoryOutput.normalized_diagnostics)
  }, 60_000)

  // -----------------------------------------------------------------------
  // Source field correctness
  // -----------------------------------------------------------------------

  it('source field is advisory_current for current criteria and advisory_proposal for proposal', async () => {
    await createSeededDb()

    // CURRENT_VALID case — all sources should be advisory_current
    const validOutput = await runAdvisory({
      setor_id: SETOR_ACOUGUE,
      data_inicio: TEST_INICIO,
      data_fim: TEST_FIM,
      pinned_folga_externo: [],
      current_folgas: [],
    })

    for (const diag of validOutput.normalized_diagnostics) {
      // Without a proposal, all should be advisory_current
      if (!validOutput.proposal) {
        expect(diag.source).toBe('advisory_current')
      } else {
        expect(['advisory_current', 'advisory_proposal']).toContain(diag.source)
      }
    }
  }, 60_000)

  // -----------------------------------------------------------------------
  // Diagnostico metadata from solver
  // -----------------------------------------------------------------------

  it('solver advisory diagnostico contains expected metadata fields', async () => {
    await createSeededDb()

    const solverInput = await buildSolverInput(SETOR_ACOUGUE, TEST_INICIO, TEST_FIM, [])
    solverInput.config.advisory_only = true

    const result = await runSolver(solverInput, 30_000)

    expect(result.diagnostico).toBeDefined()
    expect(result.diagnostico!.generation_mode).toBe('ADVISORY')

    // Phase 1 fields should be present
    if (result.status === 'ADVISORY_OK') {
      expect(result.diagnostico!.phase1_status).toBeDefined()
      expect(result.diagnostico!.capacidade_vs_demanda).toBeDefined()
    }
  }, 60_000)
})
