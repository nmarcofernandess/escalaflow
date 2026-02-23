import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { executeTool } from '../../../src/main/ia/tools'
import { clearMockDb, setMockDb } from '../../setup/db-test-utils'

type Row = Record<string, any>

function createConsultarMockDb() {
  const state = {
    colaboradores: [] as Row[],
    setores: [] as Row[],
    tipos_contrato: [] as Row[],
  }

  return {
    __seed: {
      insert(table: keyof typeof state, row: Row) {
        state[table].push({ ...row })
      },
    },
    prepare(sql: string) {
      const normalized = sql.replace(/\s+/g, ' ').trim()

      return {
        all: (...params: any[]) => {
          if (normalized === 'SELECT * FROM colaboradores') {
            return [...state.colaboradores]
          }
          if (normalized === 'SELECT * FROM setores') {
            return [...state.setores]
          }
          if (normalized.startsWith('SELECT * FROM colaboradores WHERE ')) {
            // Minimal parser for equality filters used by consultar().
            const clauses = normalized
              .split(' WHERE ')[1]
              .split(' AND ')
              .map((c) => c.replace(' = ? COLLATE NOCASE', '').replace(' = ?', '').trim())

            return state.colaboradores.filter((row) => {
              return clauses.every((field, idx) => {
                const expected = params[idx]
                const actual = row[field]
                if (typeof expected === 'string' && typeof actual === 'string') {
                  return actual.toLowerCase() === expected.toLowerCase()
                }
                return actual === expected
              })
            })
          }
          throw new Error(`Mock consultar all() não suportado para query: ${normalized}`)
        },
        get: (...params: any[]) => {
          if (normalized === 'SELECT id, nome FROM setores WHERE id = ?') {
            return state.setores.find((r) => r.id === params[0])
          }
          if (normalized === 'SELECT id, nome FROM tipos_contrato WHERE id = ?') {
            return state.tipos_contrato.find((r) => r.id === params[0])
          }
          if (normalized === 'SELECT id, nome FROM colaboradores WHERE id = ?') {
            return state.colaboradores.find((r) => r.id === params[0])
          }
          if (normalized === 'SELECT codigo, nome FROM regra_definicao WHERE codigo = ?') {
            return undefined
          }
          throw new Error(`Mock consultar get() não suportado para query: ${normalized}`)
        },
        run: () => {
          throw new Error('run() não suportado no mock de consultar')
        },
      }
    },
    close() {},
  }
}

describe('executeTool(consultar)', () => {
  let db: ReturnType<typeof createConsultarMockDb>

  beforeEach(() => {
    db = createConsultarMockDb()
    setMockDb(db)
  })

  afterEach(() => {
    clearMockDb()
    db.close()
  })

  it('retorna contrato rico + humanização de FKs para colaboradores', async () => {
    db.__seed.insert('setores', { id: 2, nome: 'Açougue' })
    db.__seed.insert('tipos_contrato', { id: 1, nome: 'CLT 44h' })
    db.__seed.insert('colaboradores', {
      id: 10,
      nome: 'Cleunice',
      setor_id: 2,
      tipo_contrato_id: 1,
      ativo: 1,
    })

    const result = await executeTool('consultar', {
      entidade: 'colaboradores',
    })

    expect(result.status).toBe('ok')
    expect(result.entidade).toBe('colaboradores')
    expect(result.total).toBe(1)
    expect(result.summary).toMatch(/retornou 1 registro/i)
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
    db.__seed.insert('setores', { id: 1, nome: 'Caixa' })
    db.__seed.insert('tipos_contrato', { id: 1, nome: 'CLT 44h' })
    for (let i = 1; i <= 55; i++) {
      db.__seed.insert('colaboradores', {
        id: i,
        nome: `Pessoa ${i}`,
        setor_id: 1,
        tipo_contrato_id: 1,
        ativo: 1,
      })
    }

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

