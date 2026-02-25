import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  resetMockDbState,
  seedTable,
  onQueryAll,
  onQueryOne,
} from '../../setup/db-test-utils'

// Mock query.ts at the module level — all tools.ts calls go through here
const queryMocks = vi.hoisted(() => ({
  queryOne: vi.fn(),
  queryAll: vi.fn(),
  execute: vi.fn(),
  insertReturningId: vi.fn(),
}))

vi.mock('../../../src/main/db/query', () => queryMocks)

// Mock knowledge search (not needed here)
vi.mock('../../../src/main/knowledge/search', () => ({
  searchKnowledge: vi.fn().mockResolvedValue([]),
  exploreRelations: vi.fn().mockResolvedValue([]),
}))
vi.mock('../../../src/main/knowledge/ingest', () => ({
  ingestKnowledge: vi.fn().mockResolvedValue({ chunks_count: 0 }),
}))

import { executeTool } from '../../../src/main/ia/tools'

type Row = Record<string, any>

function setupConsultarMocks(state: {
  colaboradores?: Row[]
  setores?: Row[]
  tipos_contrato?: Row[]
}) {
  const colabs = state.colaboradores ?? []
  const setores = state.setores ?? []
  const tipos = state.tipos_contrato ?? []

  queryMocks.queryAll.mockImplementation(async (sql: string, ...params: unknown[]) => {
    const n = sql.replace(/\s+/g, ' ').trim()

    if (n === 'SELECT * FROM colaboradores') {
      return [...colabs]
    }
    if (n === 'SELECT * FROM setores') {
      return [...setores]
    }
    if (n.startsWith('SELECT * FROM colaboradores WHERE')) {
      // Simple equality filter parser
      const wherePart = n.split(' WHERE ')[1]
      const clauses = wherePart.split(' AND ').map(c => c.replace(/LOWER\((\w+)\) = LOWER\(\?\)/, '$1').replace(/ = \?/, '').trim())

      return colabs.filter(row => {
        return clauses.every((field, idx) => {
          const f = field.replace('LOWER(', '').replace(')', '')
          const expected = params[idx]
          const actual = row[f]
          if (typeof expected === 'string' && typeof actual === 'string') {
            return actual.toLowerCase() === expected.toLowerCase()
          }
          return actual === expected
        })
      })
    }

    return []
  })

  queryMocks.queryOne.mockImplementation(async (sql: string, ...params: unknown[]) => {
    const n = sql.replace(/\s+/g, ' ').trim()

    if (n === 'SELECT id, nome FROM setores WHERE id = $1' || n === 'SELECT id, nome FROM setores WHERE id = ?') {
      return setores.find(r => r.id === params[0])
    }
    if (n === 'SELECT id, nome FROM tipos_contrato WHERE id = $1' || n === 'SELECT id, nome FROM tipos_contrato WHERE id = ?') {
      return tipos.find(r => r.id === params[0])
    }
    if (n === 'SELECT id, nome FROM colaboradores WHERE id = $1' || n === 'SELECT id, nome FROM colaboradores WHERE id = ?') {
      return colabs.find(r => r.id === params[0])
    }
    if (n.includes('SELECT codigo, nome FROM regra_definicao WHERE codigo')) {
      return undefined
    }
    return undefined
  })
}

describe('executeTool(consultar)', () => {
  beforeEach(() => {
    resetMockDbState()
    vi.clearAllMocks()
  })

  afterEach(() => {
    resetMockDbState()
  })

  it('retorna contrato rico + humanização de FKs para colaboradores', async () => {
    setupConsultarMocks({
      setores: [{ id: 2, nome: 'Açougue' }],
      tipos_contrato: [{ id: 1, nome: 'CLT 44h' }],
      colaboradores: [{
        id: 10,
        nome: 'Cleunice',
        setor_id: 2,
        tipo_contrato_id: 1,
        ativo: 1,
      }],
    })

    const result = await executeTool('consultar', {
      entidade: 'colaboradores',
    })

    expect(result.status).toBe('ok')
    expect(result.entidade).toBe('colaboradores')
    expect(result.total).toBe(1)
    expect(result.summary).toMatch(/1 colaboradores.*CLT 44h/i)
    expect(result._meta).toEqual(
      expect.objectContaining({
        tool_kind: 'discovery',
        entidade: 'colaboradores',
        ids_usaveis_em: expect.arrayContaining(['atualizar']),
      }),
    )

    expect(result.dados[0]).toEqual(
      expect.objectContaining({
        id: 10,
        nome: 'Cleunice',
        setor_id: 2,
        setor_nome: 'Açougue',
        tipo_contrato_id: 1,
        tipo_contrato_nome: 'CLT 44h',
      }),
    )
  })

  it('retorna erro semântico com status/error quando campo do filtro é inválido', async () => {
    setupConsultarMocks({})

    const result = await executeTool('consultar', {
      entidade: 'excecoes',
      filtros: { nome: 'Maria' },
    })

    expect(result.status).toBe('error')
    expect(result.code).toBe('CONSULTAR_CAMPO_INVALIDO')
    expect(result.message).toMatch(/Campo inválido/i)
    expect(result.erro).toMatch(/Campo inválido/i)
    expect(result._meta).toEqual(
      expect.objectContaining({
        entidade: 'excecoes',
        campo_invalido: 'nome',
      }),
    )
  })

  it('retorna status truncated quando consulta excede o limite de linhas', async () => {
    const manyColabs: Row[] = []
    for (let i = 1; i <= 55; i++) {
      manyColabs.push({
        id: i,
        nome: `Pessoa ${i}`,
        setor_id: 1,
        tipo_contrato_id: 1,
        ativo: 1,
      })
    }

    setupConsultarMocks({
      setores: [{ id: 1, nome: 'Caixa' }],
      tipos_contrato: [{ id: 1, nome: 'CLT 44h' }],
      colaboradores: manyColabs,
    })

    const result = await executeTool('consultar', { entidade: 'colaboradores' })

    expect(result.status).toBe('truncated')
    expect(result.total).toBe(55)
    expect(result.retornados).toBe(50)
    expect(result.dados).toHaveLength(50)
    expect(result._meta).toEqual(
      expect.objectContaining({
        retornados: 50,
        total: 55,
      }),
    )
  })
})
