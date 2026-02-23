import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { executeTool } from '../../../src/main/ia/tools'
import { clearMockDb, setMockDb } from '../../setup/db-test-utils'

function createMutationsMockDb(options?: { failInsertCalls?: number[] }) {
  let insertCall = 0
  const failSet = new Set(options?.failInsertCalls ?? [])

  return {
    prepare(sql: string) {
      const normalized = sql.replace(/\s+/g, ' ').trim()

      return {
        get: (...args: any[]) => {
          if (normalized.startsWith('SELECT id, nome, hora_abertura, hora_fechamento FROM setores WHERE id = ? AND ativo = 1')) {
            const id = Number(args[0])
            if (id === 1) {
              return { id: 1, nome: 'Caixa', hora_abertura: '08:00', hora_fechamento: '22:00' }
            }
            return undefined
          }
          if (normalized.startsWith('SELECT horas_semanais FROM tipos_contrato WHERE id = ?')) {
            return { horas_semanais: 44 }
          }
          throw new Error(`Mock get() não suportado: ${normalized}`)
        },
        all: (..._args: any[]) => {
          throw new Error(`Mock all() não suportado: ${normalized}`)
        },
        run: (..._args: any[]) => {
          if (normalized.startsWith('INSERT INTO ')) {
            insertCall += 1
            if (failSet.has(insertCall)) {
              throw new Error(`forced insert error #${insertCall}`)
            }
            return { lastInsertRowid: 100 + insertCall, changes: 1 }
          }
          if (normalized.startsWith('UPDATE ')) {
            return { changes: 1 }
          }
          throw new Error(`Mock run() não suportado: ${normalized}`)
        },
      }
    },
    close() {},
  }
}

describe('executeTool mutações (contrato padronizado)', () => {
  let db: ReturnType<typeof createMutationsMockDb>

  beforeEach(() => {
    db = createMutationsMockDb()
    setMockDb(db)
  })

  afterEach(() => {
    clearMockDb()
    db.close()
  })

  it('criar retorna status ok + compat legado em sucesso', async () => {
    const result = await executeTool('criar', {
      entidade: 'setores',
      dados: { nome: 'Padaria', hora_abertura: '08:00', hora_fechamento: '22:00', ativo: 1 },
    })

    expect(result.status).toBe('ok')
    expect(result.sucesso).toBe(true)
    expect(result.entidade).toBe('setores')
    expect(result.id).toBeDefined()
    expect(result.summary).toMatch(/Registro criado em setores/i)
    expect(result._meta).toEqual(
      expect.objectContaining({
        tool_kind: 'action',
        action: 'create',
        entidade: 'setores',
      }),
    )
  })

  it('criar retorna status error com code/correction para erro semântico alcançável', async () => {
    const result = await executeTool('criar', {
      entidade: 'colaboradores',
      dados: { nome: 'Maria' },
    })

    expect(result.status).toBe('error')
    expect(result.code).toBe('CRIAR_COLABORADOR_SETOR_ID_OBRIGATORIO')
    expect(result.erro).toMatch(/setor_id/i)
    expect(result.correction).toMatch(/get_context/i)
  })

  it('atualizar retorna status ok + meta de campos atualizados', async () => {
    const result = await executeTool('atualizar', {
      entidade: 'setores',
      id: 7,
      dados: { nome: 'Açougue Premium' },
    })

    expect(result.status).toBe('ok')
    expect(result.sucesso).toBe(true)
    expect(result.id).toBe(7)
    expect(result.summary).toMatch(/atualizado com sucesso/i)
    expect(result._meta).toEqual(
      expect.objectContaining({
        tool_kind: 'action',
        action: 'update',
        entidade: 'setores',
        campos_atualizados: ['nome'],
      }),
    )
  })

  it('cadastrar_lote retorna status ok com partial_failure em erro parcial', async () => {
    const partialDb = createMutationsMockDb({ failInsertCalls: [2] })
    setMockDb(partialDb)

    const result = await executeTool('cadastrar_lote', {
      entidade: 'setores',
      registros: [
        { nome: 'Padaria', hora_abertura: '08:00', hora_fechamento: '22:00', ativo: 1 },
        { nome: 'Frios', hora_abertura: '08:00', hora_fechamento: '22:00', ativo: 1 },
      ],
    })

    partialDb.close()
    setMockDb(db)

    expect(result.status).toBe('ok')
    expect(result.sucesso).toBe(false)
    expect(result.total_criado).toBe(1)
    expect(result.total_erros).toBe(1)
    expect(result.summary).toMatch(/parcial/i)
    expect(result._meta).toEqual(
      expect.objectContaining({
        tool_kind: 'action',
        action: 'batch-create',
        entidade: 'setores',
        partial_failure: true,
      }),
    )
  })

  it('cadastrar_lote retorna status error quando todos os inserts falham', async () => {
    const failAllDb = createMutationsMockDb({ failInsertCalls: [1, 2] })
    setMockDb(failAllDb)

    const result = await executeTool('cadastrar_lote', {
      entidade: 'setores',
      registros: [
        { nome: 'Padaria', hora_abertura: '08:00', hora_fechamento: '22:00', ativo: 1 },
        { nome: 'Frios', hora_abertura: '08:00', hora_fechamento: '22:00', ativo: 1 },
      ],
    })

    failAllDb.close()
    setMockDb(db)

    expect(result.status).toBe('error')
    expect(result.code).toBe('CADASTRAR_LOTE_FALHOU_TOTAL')
    expect(result.erro).toMatch(/Nenhum registro foi criado/i)
    expect(result.total_criado).toBe(0)
    expect(result.total_erros).toBe(2)
  })
})
