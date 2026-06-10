/**
 * Regressão do regime 6X1 — solve completo (bridge TS → Python CP-SAT).
 *
 * Garante que um setor 6x1 com contrato "CLT 44h 6x1" (seed de fábrica)
 * gera escala com exatamente 6 dias de trabalho por colaborador e meta
 * semanal de 44h dentro da tolerância da empresa.
 *
 * Não depende de seed-local (dataset privado): monta o cenário do zero em
 * banco temporário. Usa patience_s reduzido (test-only) para encurtar o solve.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { initDb, closeDb } from '../../src/main/db/pglite'
import { createTables } from '../../src/main/db/schema'
import { seedCoreData } from '../../src/main/db/seed'
import { execute, insertReturningId, queryOne } from '../../src/main/db/query'
import { buildSolverInput, runSolver } from '../../src/main/motor/solver-bridge'

const DIAS = ['SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB', 'DOM'] as const
const TOLERANCIA_MIN = 30

let activeDbPath: string | null = null

afterEach(async () => {
  await closeDb()
  if (activeDbPath) {
    fs.rmSync(activeDbPath, { recursive: true, force: true })
    activeDbPath = null
  }
  delete process.env.ESCALAFLOW_DB_PATH
})

async function createCenario6x1(): Promise<number> {
  const dbPath = fs.mkdtempSync(path.join(os.tmpdir(), 'escalaflow-6x1-'))
  process.env.ESCALAFLOW_DB_PATH = dbPath
  activeDbPath = dbPath

  await initDb()
  await createTables()
  await seedCoreData()

  await execute(
    `INSERT INTO empresa (nome, cnpj, telefone, corte_semanal, tolerancia_semanal_min, min_intervalo_almoco_min, usa_cct_intervalo_reduzido)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    'Teste 6x1', '', '', 'SEG_DOM', TOLERANCIA_MIN, 60, true,
  )

  // Contrato 6x1 vem do seed de fábrica
  const contrato = await queryOne<{ id: number }>(
    `SELECT id FROM tipos_contrato WHERE nome = 'CLT 44h 6x1'`,
  )
  expect(contrato, 'seed deve criar CLT 44h 6x1').toBeTruthy()
  const contratoId = contrato!.id

  const setorId = await insertReturningId(
    `INSERT INTO setores (nome, hora_abertura, hora_fechamento, regime_escala, ativo)
     VALUES (?, ?, ?, ?, ?)`,
    'Setor6x1', '08:00', '20:00', '6X1', true,
  )
  for (const dia of DIAS) {
    await execute(
      `INSERT INTO setor_horario_semana (setor_id, dia_semana, ativo, usa_padrao, hora_abertura, hora_fechamento)
       VALUES (?, ?, TRUE, TRUE, ?, ?)`,
      setorId, dia, '08:00', '20:00',
    )
    await execute(
      `INSERT INTO demandas (setor_id, dia_semana, hora_inicio, hora_fim, min_pessoas)
       VALUES (?, ?, ?, ?, ?)`,
      setorId, dia, '10:00', '18:00', 1,
    )
  }
  for (let i = 1; i <= 4; i++) {
    const funcaoId = await insertReturningId(
      `INSERT INTO funcoes (setor_id, apelido, tipo_contrato_id, ordem, ativo)
       VALUES (?, ?, ?, ?, TRUE)`,
      setorId, `Posto${i}`, contratoId, i,
    )
    await execute(
      `INSERT INTO colaboradores (setor_id, tipo_contrato_id, funcao_id, nome, sexo, horas_semanais, rank, ativo)
       VALUES (?, ?, ?, ?, ?, ?, ?, TRUE)`,
      setorId, contratoId, funcaoId, `Colab${i}`, 'M', 44, i,
    )
  }
  return setorId
}

describe.sequential('solver regime 6X1', () => {
  it('seed de fábrica inclui contratos 6x1 (44h e 36h) idempotentes', async () => {
    const dbPath = fs.mkdtempSync(path.join(os.tmpdir(), 'escalaflow-6x1-seed-'))
    process.env.ESCALAFLOW_DB_PATH = dbPath
    activeDbPath = dbPath
    await initDb()
    await createTables()
    await seedCoreData()
    // re-rodar não duplica
    await seedCoreData()

    for (const [nome, horas] of [['CLT 44h 6x1', 44], ['CLT 36h 6x1', 36]] as const) {
      const rows = await queryOne<{ n: number }>(
        `SELECT COUNT(*)::int AS n FROM tipos_contrato WHERE regime_escala = '6X1' AND horas_semanais = $1 AND protegido_sistema = TRUE`,
        horas,
      )
      expect(rows?.n, `${nome} deve existir exatamente 1x`).toBe(1)
    }
  }, 30_000)

  it('gera escala 6x1: 6 dias de trabalho e 44h ± tolerância por colaborador', async () => {
    const setorId = await createCenario6x1()

    const input = await buildSolverInput(setorId, '2026-03-02', '2026-03-08')

    // todos entram como 6X1/6 dias
    for (const c of input.colaboradores as Array<{ regime_escala: string; dias_trabalho: number }>) {
      expect(c.regime_escala).toBe('6X1')
      expect(c.dias_trabalho).toBe(6)
    }

    // patience reduzido (test-only) — encurta a estabilização
    ;(input.config as Record<string, unknown>).patience_s = 5

    const out = await runSolver(input) as {
      sucesso: boolean
      status: string
      indicadores?: { violacoes_hard: number }
      alocacoes?: Array<{ colaborador_id: number; status: string; minutos_trabalho: number }>
    }

    expect(out.sucesso).toBe(true)
    expect(['OPTIMAL', 'FEASIBLE']).toContain(out.status)
    expect(out.indicadores?.violacoes_hard).toBe(0)

    const porColab = new Map<number, { dias: number; min: number }>()
    for (const a of out.alocacoes ?? []) {
      const e = porColab.get(a.colaborador_id) ?? { dias: 0, min: 0 }
      if (a.status === 'TRABALHO') {
        e.dias++
        e.min += a.minutos_trabalho
      }
      porColab.set(a.colaborador_id, e)
    }

    expect(porColab.size).toBe(4)
    for (const [id, e] of porColab) {
      expect(e.dias, `colab ${id} deve trabalhar 6 dias (6x1)`).toBe(6)
      const alvo = 44 * 60
      expect(
        Math.abs(e.min - alvo),
        `colab ${id}: ${e.min}min deve ficar a ±${TOLERANCIA_MIN}min de ${alvo}min`,
      ).toBeLessThanOrEqual(TOLERANCIA_MIN)
    }
  }, 180_000)
})
