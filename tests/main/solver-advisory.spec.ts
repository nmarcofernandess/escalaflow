import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { initDb, closeDb } from '../../src/main/db/pglite'
import { createTables } from '../../src/main/db/schema'
import { seedCoreData } from '../../src/main/db/seed'
import { seedLocalData } from '../../src/main/db/seed-local'
import { buildSolverInput, runSolver } from '../../src/main/motor/solver-bridge'

// ---------------------------------------------------------------------------
// DB setup helpers (same pattern as solver-cli-parity and rule-policy specs)
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
  const dbPath = fs.mkdtempSync(path.join(os.tmpdir(), 'escalaflow-solver-advisory-'))
  process.env.ESCALAFLOW_DB_PATH = dbPath
  activeDbPath = dbPath

  await initDb()
  await createTables()
  await seedCoreData()
  await seedLocalData()
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const SETOR_ACOUGUE = 2
const TEST_INICIO = '2026-03-02'
const TEST_FIM = '2026-03-08'

describe.sequential('solver advisory mode', () => {
  it('retorna ADVISORY_OK quando arranjo eh viavel', async () => {
    await createSeededDb()

    const input = await buildSolverInput(SETOR_ACOUGUE, TEST_INICIO, TEST_FIM, [])
    input.config.advisory_only = true

    const result = await runSolver(input, 30_000)

    expect(result.sucesso).toBe(true)
    expect(result.status).toBe('ADVISORY_OK')
    expect(result.advisory_pattern).toBeDefined()
    expect(result.advisory_pattern!.length).toBeGreaterThan(0)
    // Each entry should have collaborator index, day index, and band
    expect(result.advisory_pattern![0]).toHaveProperty('c')
    expect(result.advisory_pattern![0]).toHaveProperty('d')
    expect(result.advisory_pattern![0]).toHaveProperty('band')
  }, 30_000)

  it('retorna diagnostico com generation_mode ADVISORY', async () => {
    await createSeededDb()

    const input = await buildSolverInput(SETOR_ACOUGUE, TEST_INICIO, TEST_FIM, [])
    input.config.advisory_only = true

    const result = await runSolver(input, 30_000)

    expect(result.diagnostico).toBeDefined()
    expect(result.diagnostico!.generation_mode).toBe('ADVISORY')
    expect(result.diagnostico!.tempo_total_s).toBeDefined()
  }, 30_000)

  it('geracao normal continua funcionando sem advisory_only', async () => {
    await createSeededDb()

    const input = await buildSolverInput(SETOR_ACOUGUE, TEST_INICIO, TEST_FIM, [])
    // advisory_only NOT set (undefined/false)

    const result = await runSolver(input, 120_000)

    expect(result.sucesso).toBe(true)
    expect(result.alocacoes!.length).toBeGreaterThan(0)
    // Normal mode should NOT have ADVISORY status
    expect(result.status).not.toBe('ADVISORY_OK')
    expect(result.status).not.toBe('ADVISORY_INFEASIBLE')
  }, 120_000)
})
