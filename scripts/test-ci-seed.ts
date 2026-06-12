#!/usr/bin/env -S npx tsx
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { initDb, closeDb } from '../src/main/db/pglite'
import { createTables } from '../src/main/db/schema'
import { seedCoreData } from '../src/main/db/seed'
import {
  CI_INTERMITENTE_6X1_NOME,
  CI_SETOR_5X2_NOME,
  CI_SETOR_6X1_DIFICIL_NOME,
  seedCiData,
} from '../src/main/db/seed-ci'
import { queryOne } from '../src/main/db/query'
import { buildSolverInput, runSolver } from '../src/main/motor/solver-bridge'
import type { SolverInput, SolverOutput } from '../src/shared/types'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')
const dbPath = process.env.ESCALAFLOW_CI_DB_PATH?.trim()
  || path.join(rootDir, 'tmp', 'ci-solver-pglite')

type Scenario = {
  nome: string
  dataInicio: string
  dataFim: string
  minCoverage: number
  validate?: (output: SolverOutput, input: SolverInput) => void
}

function fail(message: string): never {
  throw new Error(`[test-ci-seed] ${message}`)
}

function setFastSolverConfig(input: SolverInput): void {
  const config = input.config as Record<string, unknown>
  config.patience_s = Number(process.env.ESCALAFLOW_CI_PATIENCE_S ?? 3)
  config.max_time_seconds = Number(process.env.ESCALAFLOW_CI_MAX_TIME_SECONDS ?? 90)
  config.num_workers = Number(process.env.ESCALAFLOW_CI_SOLVER_WORKERS ?? 4)
}

async function resetAndSeedDb(): Promise<void> {
  await closeDb()
  fs.rmSync(dbPath, { recursive: true, force: true })
  fs.mkdirSync(path.dirname(dbPath), { recursive: true })
  process.env.ESCALAFLOW_DB_PATH = dbPath

  await initDb()
  await createTables()
  await seedCoreData()
  await seedCiData()
}

function assertBasicSolverHealth(nome: string, output: SolverOutput, minCoverage: number): void {
  if (!output.sucesso) {
    fail(`${nome}: solver nao teve sucesso (${output.status}) ${output.erro?.mensagem ?? ''}`)
  }
  if (!['OPTIMAL', 'FEASIBLE'].includes(output.status)) {
    fail(`${nome}: status inesperado ${output.status}`)
  }
  const hard = output.indicadores?.violacoes_hard ?? 999
  if (hard !== 0) {
    fail(`${nome}: ${hard} violacao(oes) HARD`)
  }
  const coverage = output.indicadores?.cobertura_percent ?? 0
  if (coverage < minCoverage) {
    fail(`${nome}: cobertura ${coverage}% abaixo de ${minCoverage}%`)
  }
}

function assertNoZeroDemandSlots(nome: string, output: SolverOutput): void {
  const zeroSlots = (output.comparacao_demanda ?? []).filter((slot) =>
    slot.planejado > 0 && slot.executado === 0
  )
  if (zeroSlots.length > 0) {
    const sample = zeroSlots.slice(0, 5).map((slot) =>
      `${slot.data} ${slot.hora_inicio}-${slot.hora_fim} alvo=${slot.planejado}`,
    ).join('; ')
    fail(`${nome}: ${zeroSlots.length} slot(s) com demanda e cobertura zero. Exemplos: ${sample}`)
  }
}

function assertDifficult6x1(output: SolverOutput, input: SolverInput): void {
  if (output.diagnostico?.pass_usado !== 1) {
    fail(`6x1 dificil deveria fechar em Pass 1; recebeu Pass ${output.diagnostico?.pass_usado ?? '?'}`)
  }

  assertNoZeroDemandSlots(CI_SETOR_6X1_DIFICIL_NOME, output)

  const intermitente = input.colaboradores.find((colab) => colab.nome === CI_INTERMITENTE_6X1_NOME)
  if (!intermitente) fail('intermitente 6x1 ausente do input')

  const trabalhosIntermitente = (output.alocacoes ?? [])
    .filter((aloc) => aloc.colaborador_id === intermitente.id && aloc.status === 'TRABALHO')
    .map((aloc) => `${aloc.data}:${aloc.hora_inicio}-${aloc.hora_fim}`)

  const foraDoDomingoOn = trabalhosIntermitente.filter((item) =>
    item !== '2026-06-21:07:00-12:45'
  )
  if (foraDoDomingoOn.length > 0) {
    fail(`intermitente trabalhou fora do domingo ON esperado: ${foraDoDomingoOn.join(', ')}`)
  }

  const domOffSlots = (output.comparacao_demanda ?? []).filter((slot) =>
    slot.data === '2026-06-28' && slot.planejado > 0
  )
  if (domOffSlots.length === 0) fail('DOM 2026-06-28 nao apareceu na comparacao de demanda')
  const minDomOff = Math.min(...domOffSlots.map((slot) => slot.executado))
  if (minDomOff < 2) {
    fail(`DOM 2026-06-28 ficou com ${minDomOff} pessoa(s); esperado >=2 sem contar intermitente OFF`)
  }
}

async function runScenario(scenario: Scenario): Promise<void> {
  const setor = await queryOne<{ id: number }>(
    'SELECT id FROM setores WHERE nome = $1 AND ativo = TRUE LIMIT 1',
    scenario.nome,
  )
  if (!setor) fail(`setor seedado nao encontrado: ${scenario.nome}`)

  const input = await buildSolverInput(setor.id, scenario.dataInicio, scenario.dataFim)
  setFastSolverConfig(input)

  console.log(`[test-ci-seed] Rodando ${scenario.nome} (${scenario.dataInicio}..${scenario.dataFim})`)
  const output = await runSolver(input, 180_000, (line) => {
    if (line.includes('PASS ') || line.includes('FINAL') || line.includes('Status')) {
      console.log(`[motor:${scenario.nome}] ${line}`)
    }
  })

  assertBasicSolverHealth(scenario.nome, output, scenario.minCoverage)
  scenario.validate?.(output, input)

  console.log(
    `[test-ci-seed] OK ${scenario.nome}: status=${output.status} ` +
    `pass=${output.diagnostico?.pass_usado ?? '?'} ` +
    `cobertura=${output.indicadores?.cobertura_percent ?? '?'} ` +
    `hard=${output.indicadores?.violacoes_hard ?? '?'}`,
  )
}

async function main(): Promise<void> {
  console.log(`[test-ci-seed] DB descartavel: ${dbPath}`)
  await resetAndSeedDb()

  const scenarios: Scenario[] = [
    {
      nome: CI_SETOR_5X2_NOME,
      dataInicio: '2026-06-15',
      dataFim: '2026-06-21',
      minCoverage: 90,
    },
    {
      nome: CI_SETOR_6X1_DIFICIL_NOME,
      dataInicio: '2026-06-15',
      dataFim: '2026-06-28',
      minCoverage: 90,
      validate: assertDifficult6x1,
    },
  ]

  try {
    for (const scenario of scenarios) {
      await runScenario(scenario)
    }
  } finally {
    await closeDb()
  }
}

void main().catch(async (error) => {
  console.error(error)
  await closeDb()
  process.exit(1)
})
