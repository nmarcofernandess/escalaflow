import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { executeTool } from '../../../src/main/ia/tools'
import { clearMockDb, setMockDb } from '../../setup/db-test-utils'

type Row = Record<string, any>

function createSemanticasMockDb() {
  const state = {
    setores: [] as Row[],
    tipos_contrato: [] as Row[],
    colaboradores: [] as Row[],
    escalas: [] as Row[],
    alocacoes: [] as Row[],
    excecoes: [] as Row[],
    seq: { excecoes: 100 },
  }

  const normalize = (sql: string) => sql.replace(/\s+/g, ' ').trim()

  const withColaboradorJoins = (row: Row) => ({
    ...row,
    setor_nome: state.setores.find((s) => s.id === row.setor_id)?.nome,
    tipo_contrato_nome: state.tipos_contrato.find((t) => t.id === row.tipo_contrato_id)?.nome,
  })

  const filterColaboradoresByWhere = (normalizedSql: string, params: any[]) => {
    const wherePart = normalizedSql.includes(' WHERE ')
      ? normalizedSql.split(' WHERE ')[1].split(' ORDER BY ')[0]
      : ''
    const clauses = wherePart ? wherePart.split(' AND ') : []
    return state.colaboradores.filter((raw) => {
      let p = 0
      return clauses.every((clause) => {
        if (clause === 'c.ativo = 1') return Number(raw.ativo) === 1

        if (clause === 'c.id = ?') {
          const expected = Number(params[p++])
          return Number(raw.id) === expected
        }

        if (clause === 'c.setor_id = ?') {
          const expected = Number(params[p++])
          return Number(raw.setor_id) === expected
        }

        if (clause === 'c.nome = ? COLLATE NOCASE') {
          const expected = String(params[p++]).toLowerCase()
          return String(raw.nome).toLowerCase() === expected
        }

        if (clause === 'c.nome LIKE ? COLLATE NOCASE') {
          const rawPattern = String(params[p++]).toLowerCase()
          const needle = rawPattern.replace(/^%/, '').replace(/%$/, '')
          return String(raw.nome).toLowerCase().includes(needle)
        }

        throw new Error(`Cláusula de colaborador não suportada no mock: ${clause}`)
      })
    })
  }

  return {
    __seed: {
      insert(table: keyof typeof state, row: Row) {
        ;(state[table] as Row[]).push({ ...row })
      },
    },
    prepare(sql: string) {
      const normalizedSql = normalize(sql)

      return {
        all: (...params: any[]) => {
          if (normalizedSql === 'SELECT id, nome, hora_abertura, hora_fechamento, ativo FROM setores WHERE ativo = 1 ORDER BY nome') {
            return state.setores.filter((s) => Number(s.ativo) === 1).sort((a, b) => String(a.nome).localeCompare(String(b.nome)))
          }

          if (normalizedSql === 'SELECT id, nome, hora_abertura, hora_fechamento, ativo FROM setores ORDER BY nome') {
            return [...state.setores].sort((a, b) => String(a.nome).localeCompare(String(b.nome)))
          }

          if (normalizedSql.includes('FROM colaboradores c LEFT JOIN setores s ON s.id = c.setor_id LEFT JOIN tipos_contrato t ON t.id = c.tipo_contrato_id')) {
            return filterColaboradoresByWhere(normalizedSql, params)
              .map(withColaboradorJoins)
              .sort((a, b) => {
                const ativoDiff = Number(b.ativo ?? 0) - Number(a.ativo ?? 0)
                if (ativoDiff !== 0) return ativoDiff
                return String(a.nome).localeCompare(String(b.nome))
              })
          }

          throw new Error(`Mock all() não suportado para query: ${normalizedSql}`)
        },
        get: (...params: any[]) => {
          if (normalizedSql === 'SELECT id, nome, ativo FROM setores WHERE id = ?') {
            const setorId = Number(params[0])
            return state.setores.find((s) => Number(s.id) === setorId)
          }

          if (normalizedSql.includes("FROM escalas WHERE setor_id = ? AND status IN ('RASCUNHO', 'OFICIAL')")) {
            const setorId = Number(params[0])
            const candidates = state.escalas
              .filter((e) => Number(e.setor_id) === setorId && ['RASCUNHO', 'OFICIAL'].includes(String(e.status)))
              .sort((a, b) => {
                const score = (status: string) => (status === 'OFICIAL' ? 2 : status === 'RASCUNHO' ? 1 : 0)
                const byStatus = score(String(b.status)) - score(String(a.status))
                if (byStatus !== 0) return byStatus
                return Number(b.id) - Number(a.id)
              })
            return candidates[0]
          }

          if (normalizedSql.includes('FROM escalas WHERE setor_id = ? AND status = ?')) {
            const setorId = Number(params[0])
            const status = String(params[1])
            const candidates = state.escalas
              .filter((e) => Number(e.setor_id) === setorId && String(e.status) === status)
              .sort((a, b) => Number(b.id) - Number(a.id))
            return candidates[0]
          }

          if (normalizedSql.includes('FROM alocacoes WHERE escala_id = ?')) {
            const escalaId = Number(params[0])
            const rows = state.alocacoes.filter((a) => Number(a.escala_id) === escalaId)
            return {
              total: rows.length,
              trabalho: rows.filter((a) => a.status === 'TRABALHO').length,
              folga: rows.filter((a) => a.status === 'FOLGA').length,
              indisponivel: rows.filter((a) => a.status === 'INDISPONIVEL').length,
            }
          }

          throw new Error(`Mock get() não suportado para query: ${normalizedSql}`)
        },
        run: (...params: any[]) => {
          if (normalizedSql.startsWith('INSERT INTO excecoes (')) {
            const colsPart = normalizedSql.slice('INSERT INTO excecoes ('.length).split(') VALUES')[0]
            const cols = colsPart.split(',').map((c) => c.trim())
            const row: Row = { id: state.seq.excecoes++ }
            cols.forEach((col, idx) => {
              row[col] = params[idx]
            })
            state.excecoes.push(row)
            return { lastInsertRowid: row.id, changes: 1 }
          }

          throw new Error(`Mock run() não suportado para query: ${normalizedSql}`)
        },
      }
    },
    close() {},
  }
}

describe('executeTool ferramentas semânticas (Fase 4 - início / poda)', () => {
  let db: ReturnType<typeof createSemanticasMockDb>

  beforeEach(() => {
    db = createSemanticasMockDb()
    setMockDb(db)
  })

  afterEach(() => {
    clearMockDb()
    db.close()
  })

  it('wrappers CRUD/de discovery removidos retornam UNKNOWN_TOOL', async () => {
    for (const toolName of ['listar_setores', 'listar_colaboradores_do_setor', 'obter_escala_atual', 'criar_excecao'] as const) {
      const result = await executeTool(toolName, {})
      expect(result.status).toBe('error')
      expect(result.code).toBe('UNKNOWN_TOOL')
    }
  })

  it('buscar_colaborador resolve por nome com enriquecimento e retorna um único match', async () => {
    db.__seed.insert('setores', { id: 1, nome: 'Açougue', ativo: 1 })
    db.__seed.insert('tipos_contrato', { id: 2, nome: 'CLT 44h' })
    db.__seed.insert('colaboradores', { id: 10, nome: 'Cleunice Souza', setor_id: 1, tipo_contrato_id: 2, ativo: 1 })

    const result = await executeTool('buscar_colaborador', { nome: 'cleunice', modo: 'PARCIAL' })

    expect(result.status).toBe('ok')
    expect(result.colaborador).toEqual(
      expect.objectContaining({
        id: 10,
        nome: 'Cleunice Souza',
        setor_nome: 'Açougue',
        tipo_contrato_nome: 'CLT 44h',
      }),
    )
    expect(result.encontrado_por).toBe('nome_parcial')
    expect(result._meta).toEqual(
      expect.objectContaining({
        tool_kind: 'discovery',
        resolution: 'single',
      }),
    )
  })

  it('buscar_colaborador retorna ambiguidade quando há múltiplos matches', async () => {
    db.__seed.insert('setores', { id: 1, nome: 'Caixa', ativo: 1 })
    db.__seed.insert('tipos_contrato', { id: 1, nome: 'CLT' })
    db.__seed.insert('colaboradores', { id: 1, nome: 'Maria Silva', setor_id: 1, tipo_contrato_id: 1, ativo: 1 })
    db.__seed.insert('colaboradores', { id: 2, nome: 'Maria Souza', setor_id: 1, tipo_contrato_id: 1, ativo: 1 })

    const result = await executeTool('buscar_colaborador', { nome: 'Maria', modo: 'PARCIAL' })

    expect(result.status).toBe('ok')
    expect(result.ambiguous).toBe(true)
    expect(result.total).toBe(2)
    expect(result.candidatos).toHaveLength(2)
    expect(result.summary).toMatch(/Refine o nome/i)
  })

})
