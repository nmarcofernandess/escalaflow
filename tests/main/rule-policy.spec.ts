import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { initDb, closeDb } from '../../src/main/db/pglite'
import { createTables } from '../../src/main/db/schema'
import { seedCoreData } from '../../src/main/db/seed'
import { buildEffectiveRulePolicy, inferGenerationModeForOverrides } from '../../src/main/motor/rule-policy'

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
  const dbPath = fs.mkdtempSync(path.join(os.tmpdir(), 'escalaflow-rule-policy-'))
  process.env.ESCALAFLOW_DB_PATH = dbPath
  activeDbPath = dbPath

  await initDb()
  await createTables()
  await seedCoreData()
}

describe.sequential('rule policy', () => {
  it('mantem H10 como HARD em modo official', async () => {
    await createSeededDb()

    const policy = await buildEffectiveRulePolicy({ generationMode: 'OFFICIAL' })

    expect(policy.generationMode).toBe('OFFICIAL')
    expect(policy.solverRules.H10).toBe('HARD')
    expect(policy.validatorRules.H10).toBe('HARD')
  }, 20_000)

  it('permite endurecer regra sem cair para exploratory', async () => {
    await createSeededDb()

    const generationMode = await inferGenerationModeForOverrides({
      H10: 'HARD',
      S_DEFICIT: 'OFF',
    })

    expect(generationMode).toBe('OFFICIAL')
  }, 20_000)

  it('detecta relaxamento de regra hard como exploratory', async () => {
    await createSeededDb()

    await expect(inferGenerationModeForOverrides({ H10: 'SOFT' })).resolves.toBe('EXPLORATORY')
    await expect(inferGenerationModeForOverrides({ H1: 'SOFT' })).resolves.toBe('EXPLORATORY')
  }, 20_000)
})
