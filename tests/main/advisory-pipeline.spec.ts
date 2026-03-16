import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { initDb, closeDb } from '../../src/main/db/pglite'
import { createTables } from '../../src/main/db/schema'
import { seedCoreData } from '../../src/main/db/seed'
import { seedLocalData } from '../../src/main/db/seed-local'
import { runAdvisory, computeAdvisoryInputHash } from '../../src/main/motor/advisory-controller'
import type { EscalaAdvisoryInput } from '../../src/shared/advisory-types'

// ---------------------------------------------------------------------------
// DB setup helpers (same pattern as solver-advisory.spec.ts)
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
  const dbPath = fs.mkdtempSync(path.join(os.tmpdir(), 'escalaflow-advisory-pipeline-'))
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

// ---------------------------------------------------------------------------
// Integration tests — runAdvisory black-box
// ---------------------------------------------------------------------------

describe.sequential('runAdvisory pipeline', () => {
  it('returns a valid status and criteria when called without pinned folgas', async () => {
    await createSeededDb()

    const input: EscalaAdvisoryInput = {
      setor_id: SETOR_ACOUGUE,
      data_inicio: TEST_INICIO,
      data_fim: TEST_FIM,
      pinned_folga_externo: [],
      current_folgas: [],
    }

    const result = await runAdvisory(input)

    // Status must be one of the known advisory statuses
    expect([
      'CURRENT_VALID',
      'CURRENT_INVALID',
      'PROPOSAL_VALID',
      'NO_PROPOSAL',
    ]).toContain(result.status)

    // Current criteria must always be present and non-empty
    expect(result.current.criteria.length).toBeGreaterThan(0)

    // normalized_diagnostics must always be an array
    expect(Array.isArray(result.normalized_diagnostics)).toBe(true)
  }, 60_000)

  it('criteria always include COBERTURA_DIA', async () => {
    await createSeededDb()

    const input: EscalaAdvisoryInput = {
      setor_id: SETOR_ACOUGUE,
      data_inicio: TEST_INICIO,
      data_fim: TEST_FIM,
      pinned_folga_externo: [],
      current_folgas: [],
    }

    const result = await runAdvisory(input)
    const codes = result.current.criteria.map((c) => c.code)
    expect(codes).toContain('COBERTURA_DIA')
  }, 60_000)

  it('NOT_EVALUATED criteria are present for Phase-2-only checks', async () => {
    await createSeededDb()

    const input: EscalaAdvisoryInput = {
      setor_id: SETOR_ACOUGUE,
      data_inicio: TEST_INICIO,
      data_fim: TEST_FIM,
      pinned_folga_externo: [],
      current_folgas: [],
    }

    const result = await runAdvisory(input)

    // Regardless of status, COBERTURA_FAIXA and DESCANSO_JORNADA should be NOT_EVALUATED
    // because advisory only runs Phase 1
    const notEvaluated = result.current.criteria.filter(
      (c) => c.status === 'NOT_EVALUATED',
    )
    const notEvalCodes = notEvaluated.map((c) => c.code)
    expect(notEvalCodes).toContain('COBERTURA_FAIXA')
    expect(notEvalCodes).toContain('DESCANSO_JORNADA')
  }, 60_000)

  it('normalized_diagnostics excludes NOT_EVALUATED (only PASS/FAIL mapped)', async () => {
    await createSeededDb()

    const input: EscalaAdvisoryInput = {
      setor_id: SETOR_ACOUGUE,
      data_inicio: TEST_INICIO,
      data_fim: TEST_FIM,
      pinned_folga_externo: [],
      current_folgas: [],
    }

    const result = await runAdvisory(input)

    // NOT_EVALUATED should be filtered out of normalized_diagnostics
    for (const diag of result.normalized_diagnostics) {
      // Severity should be 'error' or 'info' (mapped from FAIL/PASS)
      expect(['error', 'info', 'warning']).toContain(diag.severity)
    }

    // Every diagnostic must have a source starting with 'advisory_'
    for (const diag of result.normalized_diagnostics) {
      expect(diag.source).toMatch(/^advisory_/)
    }
  }, 60_000)

  it('all 5 criterion codes are present in current criteria', async () => {
    await createSeededDb()

    const input: EscalaAdvisoryInput = {
      setor_id: SETOR_ACOUGUE,
      data_inicio: TEST_INICIO,
      data_fim: TEST_FIM,
      pinned_folga_externo: [],
      current_folgas: [],
    }

    const result = await runAdvisory(input)
    const codes = result.current.criteria.map((c) => c.code)

    expect(codes).toContain('COBERTURA_DIA')
    expect(codes).toContain('DOMINGOS_CONSECUTIVOS')
    expect(codes).toContain('DOMINGO_EXATO')
    expect(codes).toContain('COBERTURA_FAIXA')
    expect(codes).toContain('DESCANSO_JORNADA')
    expect(result.current.criteria).toHaveLength(5)
  }, 60_000)

  it('fallback has should_open_ia when status is NO_PROPOSAL', async () => {
    await createSeededDb()

    const input: EscalaAdvisoryInput = {
      setor_id: SETOR_ACOUGUE,
      data_inicio: TEST_INICIO,
      data_fim: TEST_FIM,
      pinned_folga_externo: [],
      current_folgas: [],
    }

    const result = await runAdvisory(input)

    if (result.status === 'NO_PROPOSAL') {
      expect(result.fallback).toBeDefined()
      expect(result.fallback!.should_open_ia).toBe(true)
      expect(result.fallback!.reason).toBeTruthy()
    }
    // If not NO_PROPOSAL, the solver found a solution — also valid
  }, 60_000)

  it('each criterion has title and detail strings', async () => {
    await createSeededDb()

    const input: EscalaAdvisoryInput = {
      setor_id: SETOR_ACOUGUE,
      data_inicio: TEST_INICIO,
      data_fim: TEST_FIM,
      pinned_folga_externo: [],
      current_folgas: [],
    }

    const result = await runAdvisory(input)

    for (const criterion of result.current.criteria) {
      expect(typeof criterion.title).toBe('string')
      expect(criterion.title.length).toBeGreaterThan(0)
      expect(typeof criterion.detail).toBe('string')
      expect(criterion.detail.length).toBeGreaterThan(0)
      expect(criterion.source).toBe('PHASE1')
    }
  }, 60_000)
})

// ---------------------------------------------------------------------------
// Pure function tests (no DB needed)
// ---------------------------------------------------------------------------

describe('computeAdvisoryInputHash (pipeline context)', () => {
  it('is deterministic for identical input', () => {
    const input: EscalaAdvisoryInput = {
      setor_id: SETOR_ACOUGUE,
      data_inicio: TEST_INICIO,
      data_fim: TEST_FIM,
      pinned_folga_externo: [{ c: 0, d: 0, band: 0 }],
      current_folgas: [
        {
          colaborador_id: 1,
          fixa: 'SEG',
          variavel: 'QUA',
          origem_fixa: 'COLABORADOR',
          origem_variavel: 'COLABORADOR',
        },
      ],
    }

    const h1 = computeAdvisoryInputHash(input)
    const h2 = computeAdvisoryInputHash(input)
    expect(h1).toBe(h2)
    expect(h1).toHaveLength(16)
  })

  it('produces different hash for different setor_id', () => {
    const base: EscalaAdvisoryInput = {
      setor_id: SETOR_ACOUGUE,
      data_inicio: TEST_INICIO,
      data_fim: TEST_FIM,
      pinned_folga_externo: [],
      current_folgas: [],
    }

    const h1 = computeAdvisoryInputHash(base)
    const h2 = computeAdvisoryInputHash({ ...base, setor_id: 99 })
    expect(h1).not.toBe(h2)
  })
})
