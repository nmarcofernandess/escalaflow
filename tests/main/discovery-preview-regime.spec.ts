import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { initDb, closeDb } from '../../src/main/db/pglite'
import { createTables } from '../../src/main/db/schema'
import { seedCoreData } from '../../src/main/db/seed'
import { execute, insertReturningId, queryOne } from '../../src/main/db/query'
import { buildContextBundle } from '../../src/main/ia/discovery'

const DIAS = ['SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB', 'DOM'] as const

let activeDbPath: string | null = null

afterEach(async () => {
  await closeDb()
  if (activeDbPath) {
    fs.rmSync(activeDbPath, { recursive: true, force: true })
    activeDbPath = null
  }
  delete process.env.ESCALAFLOW_DB_PATH
})

async function createPreviewScenario6x1(): Promise<number> {
  const dbPath = fs.mkdtempSync(path.join(os.tmpdir(), 'escalaflow-discovery-preview-'))
  process.env.ESCALAFLOW_DB_PATH = dbPath
  activeDbPath = dbPath

  await initDb()
  await createTables()
  await seedCoreData()

  const contrato = await queryOne<{ id: number }>(
    `SELECT id FROM tipos_contrato WHERE nome = 'CLT 44h 6x1'`,
  )
  expect(contrato).toBeTruthy()

  const setorId = await insertReturningId(
    `INSERT INTO setores (nome, hora_abertura, hora_fechamento, regime_escala, ativo)
     VALUES (?, ?, ?, ?, TRUE)`,
    'Preview 6x1', '08:00', '20:00', '6X1',
  )

  for (const dia of DIAS) {
    await execute(
      `INSERT INTO demandas (setor_id, dia_semana, hora_inicio, hora_fim, min_pessoas)
       VALUES (?, ?, ?, ?, ?)`,
      setorId, dia, '10:00', '18:00', dia === 'DOM' ? 2 : 4,
    )
  }

  for (let i = 1; i <= 5; i++) {
    const funcaoId = await insertReturningId(
      `INSERT INTO funcoes (setor_id, apelido, tipo_contrato_id, ordem, ativo)
       VALUES (?, ?, ?, ?, TRUE)`,
      setorId, `Posto ${i}`, contrato!.id, i,
    )
    await execute(
      `INSERT INTO colaboradores (setor_id, tipo_contrato_id, funcao_id, nome, sexo, horas_semanais, rank, ativo)
       VALUES (?, ?, ?, ?, ?, ?, ?, TRUE)`,
      setorId, contrato!.id, funcaoId, `Pessoa ${i}`, 'M', 44, i,
    )
  }

  return setorId
}

describe.sequential('discovery preview regime', () => {
  it('usa regime 6x1 do setor ao montar preview automatico da IA', async () => {
    const setorId = await createPreviewScenario6x1()

    const bundle = await buildContextBundle({
      pagina: 'setor_detalhe',
      rota: `/setores/${setorId}`,
      setor_id: setorId,
    })

    const segunda = bundle?.setor?.preview?.cobertura_por_dia.find((d) => d.dia === 'SEG')
    expect(segunda).toBeTruthy()
    expect(segunda!.demanda).toBe(4)
    expect(segunda!.cobertura).toBeGreaterThan(4)
  }, 30_000)
})
