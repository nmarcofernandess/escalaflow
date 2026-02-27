import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetMockDbState } from '../../setup/db-test-utils'

const queryMocks = vi.hoisted(() => ({
  queryOne: vi.fn(),
  queryAll: vi.fn(),
  execute: vi.fn(),
  insertReturningId: vi.fn(),
  transaction: vi.fn(),
}))

vi.mock('../../../src/main/db/query', () => queryMocks)
vi.mock('../../../src/main/knowledge/search', () => ({
  searchKnowledge: vi.fn().mockResolvedValue([]),
  exploreRelations: vi.fn().mockResolvedValue([]),
}))
vi.mock('../../../src/main/knowledge/ingest', () => ({
  ingestKnowledge: vi.fn().mockResolvedValue({ chunks_count: 0 }),
}))

import { executeTool } from '../../../src/main/ia/tools'

let insertCall = 0
let failInsertCalls = new Set<number>()

function setupMutationMocks(opts?: { failInsertCalls?: number[] }) {
  insertCall = 0
  failInsertCalls = new Set(opts?.failInsertCalls ?? [])

  queryMocks.queryOne.mockImplementation(async (sql: string, ...params: unknown[]) => {
    const n = sql.replace(/\s+/g, ' ').trim()

    // criar colaborador → valida setor
    if (n.includes('FROM setores WHERE id') && n.includes('ativo')) {
      const id = Number(params[0])
      if (id === 1) return { id: 1, nome: 'Caixa', hora_abertura: '08:00', hora_fechamento: '22:00' }
      return undefined
    }

    // cadastrar_lote → resolve horas_semanais do contrato
    if (n.includes('horas_semanais FROM tipos_contrato WHERE id')) {
      return { horas_semanais: 44 }
    }

    return undefined
  })

  queryMocks.execute.mockImplementation(async () => {
    return { changes: 1 }
  })
  queryMocks.transaction.mockImplementation(async (fn: () => Promise<unknown>) => fn())

  queryMocks.insertReturningId.mockImplementation(async () => {
    insertCall++
    if (failInsertCalls.has(insertCall)) {
      throw new Error(`forced insert error #${insertCall}`)
    }
    return 100 + insertCall
  })
}

describe('executeTool mutações (contrato padronizado)', () => {
  beforeEach(() => {
    resetMockDbState()
    vi.clearAllMocks()
    setupMutationMocks()
  })

  afterEach(() => {
    resetMockDbState()
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
    expect(result.correction).toMatch(/contexto autom|consultar/i)
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

  it('cadastrar_lote retorna erro atomico quando qualquer insert falha', async () => {
    setupMutationMocks({ failInsertCalls: [2] })

    const result = await executeTool('cadastrar_lote', {
      entidade: 'setores',
      registros: [
        { nome: 'Padaria', hora_abertura: '08:00', hora_fechamento: '22:00', ativo: 1 },
        { nome: 'Frios', hora_abertura: '08:00', hora_fechamento: '22:00', ativo: 1 },
      ],
    })

    expect(result.status).toBe('error')
    expect(result.code).toBe('CADASTRAR_LOTE_ATOMICO_FALHOU')
    expect(result.total_criado).toBe(0)
    expect(result.total_erros).toBe(1)
    expect(result._meta).toEqual(
      expect.objectContaining({
        tool_kind: 'action',
        action: 'batch-create',
        entidade: 'setores',
        atomic: true,
      }),
    )
  })

  it('cadastrar_lote retorna status error quando inserts falham no primeiro registro', async () => {
    setupMutationMocks({ failInsertCalls: [1, 2] })

    const result = await executeTool('cadastrar_lote', {
      entidade: 'setores',
      registros: [
        { nome: 'Padaria', hora_abertura: '08:00', hora_fechamento: '22:00', ativo: 1 },
        { nome: 'Frios', hora_abertura: '08:00', hora_fechamento: '22:00', ativo: 1 },
      ],
    })

    expect(result.status).toBe('error')
    expect(result.code).toBe('CADASTRAR_LOTE_ATOMICO_FALHOU')
    expect(result.erro).toMatch(/Nenhum registro foi persistido/i)
    expect(result.total_criado).toBe(0)
    expect(result.total_erros).toBe(1)
  })
})
