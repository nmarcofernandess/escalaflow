import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { initDb, closeDb } from '../../src/main/db/pglite'
import { createTables } from '../../src/main/db/schema'
import { seedCoreData } from '../../src/main/db/seed'
import { seedLocalData } from '../../src/main/db/seed-local'
import { persistirSolverResult } from '../../src/main/motor/solver-bridge'
import { validarEscalaV3 } from '../../src/main/motor/validador'
import type { SolverOutput } from '../../src/shared/types'

const execFileAsync = promisify(execFile)

const TEST_PERIOD = {
  dataInicio: '2026-03-02',
  dataFim: '2026-04-26',
} as const

const MAX_COVERAGE_DRIFT_POINTS = 15
const MAX_EFFECTIVE_COVERAGE_DRIFT_POINTS = 15

const NON_NEGOTIABLE_RULES = new Set([
  'H1',
  'H2',
  'H4',
  'H5',
  'H6',
  'H11',
  'H12',
  'H13',
  'H14',
  'H15',
  'H16',
  'H17',
  'H18',
])

const NEVER_RELAX_IN_OFFICIAL_RULES = new Set([
  ...NON_NEGOTIABLE_RULES,
  'H10',
])

const SCENARIOS = [
  { setorId: 2, nome: 'Acougue' },
  { setorId: 3, nome: 'Rotisseria' },
] as const

let activeDbPath: string | null = null

afterEach(async () => {
  await closeDb()
  if (activeDbPath) {
    fs.rmSync(activeDbPath, { recursive: true, force: true })
    activeDbPath = null
  }
})

function timeToMin(time: string): number {
  const [h, m] = time.split(':').map(Number)
  return h * 60 + m
}

function resolveBin(name: string): string {
  const suffix = process.platform === 'win32' ? '.cmd' : ''
  return path.join(process.cwd(), 'node_modules', '.bin', `${name}${suffix}`)
}

async function createSeededDb(): Promise<string> {
  const dbPath = fs.mkdtempSync(path.join(os.tmpdir(), 'escalaflow-solver-cli-parity-'))
  process.env.ESCALAFLOW_DB_PATH = dbPath
  activeDbPath = dbPath

  await initDb()
  await createTables()
  await seedCoreData()
  await seedLocalData()
  await closeDb()

  return dbPath
}

async function runSolverCliJson(setorId: number, dbPath: string): Promise<SolverOutput> {
  const electronBin = resolveBin('electron')
  const tsxBin = resolveBin('tsx')
  const cliScript = path.join(process.cwd(), 'scripts', 'solver-cli.ts')

  const { stdout, stderr } = await execFileAsync(
    electronBin,
    [tsxBin, cliScript, String(setorId), TEST_PERIOD.dataInicio, TEST_PERIOD.dataFim, '--mode', 'rapido', '--json'],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        ESCALAFLOW_DB_PATH: dbPath,
      },
      timeout: 180_000,
      maxBuffer: 8 * 1024 * 1024,
    },
  )

  try {
    return JSON.parse(stdout) as SolverOutput
  } catch (error) {
    throw new Error(
      `Falha ao parsear JSON do solver CLI para setor ${setorId}: ${(error as Error).message}\nSTDERR:\n${stderr}\nSTDOUT:\n${stdout.slice(0, 1000)}`,
    )
  }
}

function assertLunchLegality(output: SolverOutput): void {
  const shifts = (output.alocacoes ?? []).filter((aloc) => aloc.status === 'TRABALHO')

  for (const shift of shifts) {
    const hasLunch = Boolean(shift.hora_almoco_inicio && shift.hora_almoco_fim && shift.minutos_almoco > 0)

    if (hasLunch) {
      expect(shift.minutos_almoco).toBeGreaterThanOrEqual(60)
      expect(shift.minutos_almoco).toBeLessThanOrEqual(120)

      const almocoInicio = timeToMin(shift.hora_almoco_inicio!)
      const almocoFim = timeToMin(shift.hora_almoco_fim!)
      const jornadaInicio = timeToMin(shift.hora_inicio!)
      const jornadaFim = timeToMin(shift.hora_fim!)

      expect(almocoInicio).toBeGreaterThanOrEqual(11 * 60)
      expect(almocoFim).toBeLessThanOrEqual(14 * 60)
      expect(almocoInicio - jornadaInicio).toBeGreaterThanOrEqual(120)
      expect(jornadaFim - almocoFim).toBeGreaterThanOrEqual(120)
    }

    if ((shift.minutos_trabalho ?? 0) > 360) {
      expect(hasLunch).toBe(true)
    }
  }
}

describe.sequential('solver CLI official parity', () => {
  for (const scenario of SCENARIOS) {
    it(
      `${scenario.nome} permanece oficializavel e sem drift grosseiro`,
      async () => {
        const dbPath = await createSeededDb()
        const solverOutput = await runSolverCliJson(scenario.setorId, dbPath)

        expect(solverOutput.sucesso).toBe(true)
        expect(solverOutput.indicadores).toBeTruthy()
        expect(solverOutput.diagnostico?.generation_mode).toBe('OFFICIAL')
        const relaxedRules = solverOutput.diagnostico?.regras_relaxadas ?? []
        expect(solverOutput.indicadores?.violacoes_hard).toBe(0)

        for (const regra of relaxedRules) {
          expect(NEVER_RELAX_IN_OFFICIAL_RULES.has(regra)).toBe(false)
        }

        assertLunchLegality(solverOutput)

        process.env.ESCALAFLOW_DB_PATH = dbPath
        await initDb()

        const escalaId = await persistirSolverResult(
          scenario.setorId,
          TEST_PERIOD.dataInicio,
          TEST_PERIOD.dataFim,
          solverOutput,
        )

        const validacao = await validarEscalaV3(escalaId)
        const hardViolations = validacao.violacoes.filter((violacao) => violacao.severidade === 'HARD')

        expect(validacao.indicadores.violacoes_hard).toBe(0)
        expect(hardViolations).toHaveLength(0)

        const solverCoverage = solverOutput.indicadores?.cobertura_percent ?? 0
        const validatorCoverage = validacao.indicadores.cobertura_percent
        const coverageDrift = Math.abs(solverCoverage - validatorCoverage)

        expect(coverageDrift).toBeLessThanOrEqual(MAX_COVERAGE_DRIFT_POINTS)

        const solverEffectiveCoverage = solverOutput.indicadores?.cobertura_efetiva_percent ?? solverCoverage
        const validatorEffectiveCoverage = validacao.indicadores.cobertura_efetiva_percent ?? validatorCoverage
        const effectiveCoverageDrift = Math.abs(solverEffectiveCoverage - validatorEffectiveCoverage)

        expect(effectiveCoverageDrift).toBeLessThanOrEqual(MAX_EFFECTIVE_COVERAGE_DRIFT_POINTS)
      },
      180_000,
    )
  }
})
