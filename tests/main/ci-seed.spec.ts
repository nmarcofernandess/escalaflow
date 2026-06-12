import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { initDb, closeDb } from '../../src/main/db/pglite'
import { createTables } from '../../src/main/db/schema'
import { seedCoreData } from '../../src/main/db/seed'
import {
  CI_SETOR_5X2_NOME,
  CI_SETOR_6X1_DIFICIL_NOME,
  CI_INTERMITENTE_6X1_NOME,
  seedCiData,
} from '../../src/main/db/seed-ci'
import { queryAll, queryOne } from '../../src/main/db/query'
import { buildSolverInput } from '../../src/main/motor/solver-bridge'

let activeDbPath: string | null = null

async function createCleanSeededDb(): Promise<void> {
  const dbPath = fs.mkdtempSync(path.join(os.tmpdir(), 'escalaflow-ci-seed-spec-'))
  process.env.ESCALAFLOW_DB_PATH = dbPath
  activeDbPath = dbPath

  await initDb()
  await createTables()
  await seedCoreData()
  await seedCiData()
}

afterEach(async () => {
  await closeDb()
  if (activeDbPath) {
    fs.rmSync(activeDbPath, { recursive: true, force: true })
    activeDbPath = null
  }
  delete process.env.ESCALAFLOW_DB_PATH
})

describe.sequential('seed CI descartavel', () => {
  it('cria cenarios versionados 5x2 e 6x1 dificil de forma idempotente', async () => {
    await createCleanSeededDb()
    await seedCiData()

    const setores = await queryAll<{
      nome: string
      regime_escala: string
      piso_operacional: number
      colaboradores: number
      demandas: number
    }>(`
      SELECT s.nome, s.regime_escala, s.piso_operacional,
             COUNT(DISTINCT c.id)::int AS colaboradores,
             COUNT(DISTINCT d.id)::int AS demandas
      FROM setores s
      LEFT JOIN colaboradores c ON c.setor_id = s.id AND c.ativo = TRUE
      LEFT JOIN demandas d ON d.setor_id = s.id
      WHERE s.nome IN ($1, $2)
      GROUP BY s.id, s.nome, s.regime_escala, s.piso_operacional
      ORDER BY s.nome
    `, CI_SETOR_5X2_NOME, CI_SETOR_6X1_DIFICIL_NOME)

    expect(setores).toHaveLength(2)
    expect(setores.find((s) => s.nome === CI_SETOR_5X2_NOME)).toMatchObject({
      regime_escala: '5X2',
      piso_operacional: 1,
      colaboradores: 4,
      demandas: 5,
    })
    expect(setores.find((s) => s.nome === CI_SETOR_6X1_DIFICIL_NOME)).toMatchObject({
      regime_escala: '6X1',
      piso_operacional: 1,
      colaboradores: 6,
      demandas: 7,
    })

    const duplicateCheck = await queryAll<{ nome: string; count: number }>(`
      SELECT nome, COUNT(*)::int AS count
      FROM setores
      WHERE nome IN ($1, $2)
      GROUP BY nome
    `, CI_SETOR_5X2_NOME, CI_SETOR_6X1_DIFICIL_NOME)
    expect(duplicateCheck.every((row) => row.count === 1)).toBe(true)
  }, 30_000)

  it('modela o 6x1 dificil com intermitente apenas em domingos alternados', async () => {
    await createCleanSeededDb()

    const setor = await queryOne<{ id: number }>(
      'SELECT id FROM setores WHERE nome = $1',
      CI_SETOR_6X1_DIFICIL_NOME,
    )
    expect(setor).toBeTruthy()

    const input = await buildSolverInput(setor!.id, '2026-06-15', '2026-06-28')
    const intermitente = input.colaboradores.find((colab) => colab.nome === CI_INTERMITENTE_6X1_NOME)

    expect(intermitente).toBeTruthy()
    expect(intermitente).toMatchObject({
      tipo_trabalhador: 'INTERMITENTE',
      dias_trabalho: 1,
    })
    expect(intermitente?.domingo_ciclo_trabalho).toBeUndefined()
    expect(intermitente?.domingo_ciclo_folga).toBeUndefined()

    const clts = input.colaboradores.filter((colab) => colab.tipo_trabalhador === 'CLT')
    expect(clts).toHaveLength(5)
    for (const clt of clts) {
      expect(clt.domingo_ciclo_trabalho).toBe(2)
      expect(clt.domingo_ciclo_folga).toBe(1)
    }

    const regrasIntermitente = input.regras_colaborador_dia?.filter(
      (regra) => regra.colaborador_id === intermitente!.id,
    ) ?? []
    const regrasDomingo = regrasIntermitente.filter((regra) =>
      regra.data === '2026-06-21' || regra.data === '2026-06-28',
    )
    expect(regrasIntermitente).toHaveLength(14)
    expect(regrasDomingo).toHaveLength(2)
    expect(regrasDomingo[0]).toMatchObject({
      data: '2026-06-21',
      inicio_min: '07:00',
      inicio_max: '07:00',
      fim_min: null,
      fim_max: '12:45',
      folga_fixa: false,
    })
    expect(regrasIntermitente.filter((regra) => regra.inicio_min != null).map((regra) => regra.data))
      .toEqual(['2026-06-21', '2026-06-28'])

    expect(input.excecoes).toContainEqual({
      colaborador_id: intermitente!.id,
      data_inicio: '2026-06-22',
      data_fim: '2026-06-28',
      tipo: 'BLOQUEIO',
    })

    const domingoDemand = input.demanda.find((demanda) => demanda.dia_semana === 'DOM')
    const quartaDemand = input.demanda.find((demanda) => demanda.dia_semana === 'QUA')
    expect(domingoDemand?.min_pessoas).toBeGreaterThanOrEqual(3)
    expect(quartaDemand).toMatchObject({
      hora_inicio: '07:00',
      min_pessoas: 4,
    })
  }, 30_000)
})
