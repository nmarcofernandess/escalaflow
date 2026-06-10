/**
 * Regressão da recorrência semanal declarativa (semana sim/semana não).
 *
 * A bridge expande recorrencia_* da regra padrão em exceções sintéticas no
 * input do solver. O Python já trata semana bloqueada (H5 + proração H10 +
 * skip DIAS_TRABALHO) — este spec prova o caminho ponta a ponta.
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

let activeDbPath: string | null = null

afterEach(async () => {
  await closeDb()
  if (activeDbPath) {
    fs.rmSync(activeDbPath, { recursive: true, force: true })
    activeDbPath = null
  }
  delete process.env.ESCALAFLOW_DB_PATH
})

// 4 CLTs 5x2; Colab1 com recorrência 1/1 ancorada em 2026-03-02 (SEG).
// Período de 4 semanas exatas: semanas OFF = 09-15/03 e 23-29/03.
//
// Setor 06:00-20:00 (não 08:00): a Phase 1 fixa bandas MANHA/TARDE sem modelar
// horas, e a janela de almoço hard exige 2h de trabalho antes das 11:00 —
// banda TARDE precisa começar <= 09:00 (abertura 06:00 → tarde = 08:30) ou o
// dia fica sem almoço (cap 6h) e a semana 44h vira INFEASIBLE no pass 1,
// caindo pro pass 2 que relaxa DIAS_TRABALHO (6 dias). Pré-existente, não
// relacionado à recorrência (baseline sem recorrência reproduz).
async function createCenarioRecorrencia(): Promise<{ setorId: number; colabRecId: number }> {
  const dbPath = fs.mkdtempSync(path.join(os.tmpdir(), 'escalaflow-rec-'))
  process.env.ESCALAFLOW_DB_PATH = dbPath
  activeDbPath = dbPath

  await initDb()
  await createTables()
  await seedCoreData()

  await execute(
    `INSERT INTO empresa (nome, cnpj, telefone, corte_semanal, tolerancia_semanal_min, min_intervalo_almoco_min, usa_cct_intervalo_reduzido)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    'Teste Recorrencia', '', '', 'SEG_DOM', 30, 60, true,
  )

  const contrato = await queryOne<{ id: number }>(
    `SELECT id FROM tipos_contrato WHERE nome = 'CLT 44h'`,
  )
  expect(contrato, 'seed deve criar CLT 44h').toBeTruthy()

  const setorId = await insertReturningId(
    `INSERT INTO setores (nome, hora_abertura, hora_fechamento, regime_escala, ativo)
     VALUES (?, ?, ?, ?, ?)`,
    'SetorRec', '06:00', '20:00', '5X2', true,
  )
  for (const dia of DIAS) {
    await execute(
      `INSERT INTO setor_horario_semana (setor_id, dia_semana, ativo, usa_padrao, hora_abertura, hora_fechamento)
       VALUES (?, ?, TRUE, TRUE, ?, ?)`,
      setorId, dia, '06:00', '20:00',
    )
    await execute(
      `INSERT INTO demandas (setor_id, dia_semana, hora_inicio, hora_fim, min_pessoas)
       VALUES (?, ?, ?, ?, ?)`,
      setorId, dia, '10:00', '16:00', 1,
    )
  }

  let colabRecId = 0
  for (let i = 1; i <= 4; i++) {
    const funcaoId = await insertReturningId(
      `INSERT INTO funcoes (setor_id, apelido, tipo_contrato_id, ordem, ativo)
       VALUES (?, ?, ?, ?, TRUE)`,
      setorId, `Posto${i}`, contrato!.id, i,
    )
    const colabId = await insertReturningId(
      `INSERT INTO colaboradores (setor_id, tipo_contrato_id, funcao_id, nome, sexo, horas_semanais, rank, ativo)
       VALUES (?, ?, ?, ?, ?, ?, ?, TRUE)`,
      setorId, contrato!.id, funcaoId, `Colab${i}`, 'M', 44, i,
    )
    if (i === 1) colabRecId = colabId
  }

  // Regra padrão do Colab1 com recorrência 1/1
  await execute(
    `INSERT INTO colaborador_regra_horario
       (colaborador_id, dia_semana_regra, ativo, recorrencia_semanas_trabalho, recorrencia_semanas_folga, recorrencia_ancora)
     VALUES (?, NULL, TRUE, 1, 1, '2026-03-02')`,
    colabRecId,
  )

  return { setorId, colabRecId }
}

const SEMANAS_OFF = [
  ['2026-03-09', '2026-03-15'],
  ['2026-03-23', '2026-03-29'],
] as const

function isDataOff(data: string): boolean {
  return SEMANAS_OFF.some(([ini, fim]) => data >= ini && data <= fim)
}

describe.sequential('recorrência semanal declarativa (solver)', () => {
  it('bridge injeta exceções sintéticas das semanas OFF no input', async () => {
    const { setorId, colabRecId } = await createCenarioRecorrencia()
    const input = await buildSolverInput(setorId, '2026-03-02', '2026-03-29')

    const sinteticas = (input.excecoes as Array<{
      colaborador_id: number; data_inicio: string; data_fim: string; tipo: string
    }>).filter((e) => e.colaborador_id === colabRecId)

    expect(sinteticas).toEqual([
      { colaborador_id: colabRecId, data_inicio: '2026-03-09', data_fim: '2026-03-15', tipo: 'BLOQUEIO' },
      { colaborador_id: colabRecId, data_inicio: '2026-03-23', data_fim: '2026-03-29', tipo: 'BLOQUEIO' },
    ])
  }, 60_000)

  it('solver: semanas OFF sem TRABALHO, semanas ON normais, 0 violações hard', async () => {
    const { setorId, colabRecId } = await createCenarioRecorrencia()
    const input = await buildSolverInput(setorId, '2026-03-02', '2026-03-29')
    ;(input.config as Record<string, unknown>).patience_s = 5

    const out = await runSolver(input) as {
      sucesso: boolean
      status: string
      indicadores?: { violacoes_hard: number }
      alocacoes?: Array<{ colaborador_id: number; data: string; status: string }>
    }

    expect(out.sucesso).toBe(true)
    expect(['OPTIMAL', 'FEASIBLE']).toContain(out.status)
    expect(out.indicadores?.violacoes_hard).toBe(0)

    const doColab = (out.alocacoes ?? []).filter((a) => a.colaborador_id === colabRecId)
    expect(doColab.length).toBe(28) // 4 semanas

    const trabalhoOff = doColab.filter((a) => isDataOff(a.data) && a.status === 'TRABALHO')
    expect(trabalhoOff, 'semana OFF não pode ter TRABALHO').toEqual([])

    // Semanas ON: 5 dias de trabalho (CLT 5x2)
    for (const [ini, fim] of [['2026-03-02', '2026-03-08'], ['2026-03-16', '2026-03-22']]) {
      const diasTrabalho = doColab.filter(
        (a) => a.data >= ini && a.data <= fim && a.status === 'TRABALHO',
      ).length
      expect(diasTrabalho, `semana ON ${ini} deve ter 5 dias de trabalho`).toBe(5)
    }

    // Validador: persiste e revalida — semana OFF não pode acusar H10 (paridade
    // via aplicarExcecoesComoIndisponivel + expansão da recorrência no validador)
    const { persistirSolverResult } = await import('../../src/main/motor/solver-bridge')
    const { validarEscalaV3 } = await import('../../src/main/motor/validador')
    const escalaId = await persistirSolverResult(setorId, '2026-03-02', '2026-03-29', out as never)
    const validacao = await validarEscalaV3(escalaId)
    const h10DoColab = validacao.violacoes.filter(
      (v) => v.regra === 'H10_META_SEMANAL' && v.colaborador_id === colabRecId,
    )
    expect(h10DoColab, 'semana OFF não pode acusar H10').toEqual([])
  }, 120_000)
})
