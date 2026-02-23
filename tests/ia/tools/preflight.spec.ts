import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { executeTool } from '../../../src/main/ia/tools'
import { clearMockDb, createIaToolsMockDb, setMockDb, type IaToolsMockDb } from '../../setup/db-test-utils'

describe('executeTool(preflight)', () => {
  let db: IaToolsMockDb

  beforeEach(() => {
    db = createIaToolsMockDb()
    setMockDb(db)
  })

  afterEach(() => {
    clearMockDb()
    db.close()
  })

  it('retorna blockers/warnings quando setor não tem equipe nem demanda', async () => {
    db.__seed.insertSetor({ id: 1, nome: 'Caixa', ativo: 1 })

    const result = await executeTool('preflight', {
      setor_id: 1,
      data_inicio: '2026-03-01',
      data_fim: '2026-03-31',
    })

    expect(result.status).toBe('ok')
    expect(result.ok).toBe(false)
    expect(result.summary).toMatch(/blocker/i)
    expect(result._meta).toEqual(
      expect.objectContaining({
        tool_kind: 'validation',
        blockers_count: 1,
        warnings_count: 1,
      }),
    )
    expect(result.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ codigo: 'SEM_COLABORADORES' }),
      ]),
    )
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ codigo: 'SEM_DEMANDA' }),
      ]),
    )
    expect(result.diagnostico).toEqual(
      expect.objectContaining({
        setor_id: 1,
        colaboradores_ativos: 0,
        demandas_cadastradas: 0,
      }),
    )
  })
})
