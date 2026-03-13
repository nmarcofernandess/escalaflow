import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetMockDbState } from '../../setup/db-test-utils'

const queryMocks = vi.hoisted(() => ({
  queryOne: vi.fn(),
  queryAll: vi.fn(),
  execute: vi.fn(),
  insertReturningId: vi.fn(),
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

type MemoriaRow = { id: number; conteudo: string; criada_em: string; atualizada_em: string }

let memorias: MemoriaRow[] = []
let nextId = 1

function setupMemoriaMocks() {
  memorias = []
  nextId = 1

  queryMocks.queryOne.mockImplementation(async (sql: string, ...params: unknown[]) => {
    const n = sql.replace(/\s+/g, ' ').trim()

    // COUNT for limit check
    if (n.includes('COUNT') && n.includes('ia_memorias')) {
      return { c: memorias.length }
    }

    // SELECT id for remover_memoria existence check
    if (n.includes('SELECT id FROM ia_memorias WHERE id')) {
      return memorias.find(m => m.id === Number(params[0])) ?? undefined
    }

    return undefined
  })

  queryMocks.queryAll.mockImplementation(async (sql: string) => {
    const n = sql.replace(/\s+/g, ' ').trim()

    if (n.includes('FROM ia_memorias')) {
      return [...memorias].sort((a, b) => b.atualizada_em.localeCompare(a.atualizada_em))
    }

    return []
  })

  queryMocks.execute.mockImplementation(async (sql: string, ...params: unknown[]) => {
    const n = sql.replace(/\s+/g, ' ').trim()

    // UPDATE (salvar_memoria com id)
    if (n.includes('UPDATE ia_memorias SET conteudo')) {
      const mem = memorias.find(m => m.id === Number(params[1]))
      if (mem) {
        mem.conteudo = String(params[0])
        mem.atualizada_em = new Date().toISOString()
      }
      return { changes: mem ? 1 : 0 }
    }

    // DELETE (remover_memoria)
    if (n.includes('DELETE FROM ia_memorias WHERE id')) {
      const idx = memorias.findIndex(m => m.id === Number(params[0]))
      if (idx >= 0) {
        memorias.splice(idx, 1)
        return { changes: 1 }
      }
      return { changes: 0 }
    }

    return { changes: 1 }
  })

  queryMocks.insertReturningId.mockImplementation(async () => {
    const id = nextId++
    memorias.push({
      id,
      conteudo: 'stub',
      criada_em: new Date().toISOString(),
      atualizada_em: new Date().toISOString(),
    })
    return id
  })
}

describe('executeTool memórias IA', () => {
  beforeEach(() => {
    resetMockDbState()
    vi.clearAllMocks()
    setupMemoriaMocks()
  })

  afterEach(() => {
    resetMockDbState()
  })

  // ===== salvar_memoria =====

  it('salvar_memoria cria nova memória com sucesso', async () => {
    const result = await executeTool('salvar_memoria', {
      conteudo: 'Maria sempre trabalha no Açougue às segundas',
    })

    expect(result.status).toBe('ok')
    expect(result.id).toBeDefined()
    expect(result.conteudo).toBe('Maria sempre trabalha no Açougue às segundas')
    expect(result.total).toBe(1)
    expect(result.summary).toMatch(/Memória salva/i)
    expect(result._meta).toEqual(expect.objectContaining({ tool_kind: 'memoria' }))
  })

  it('salvar_memoria atualiza memória existente quando id é passado', async () => {
    // Pre-seed a memory
    memorias.push({
      id: 42,
      conteudo: 'original',
      criada_em: '2026-01-01T00:00:00Z',
      atualizada_em: '2026-01-01T00:00:00Z',
    })

    const result = await executeTool('salvar_memoria', {
      conteudo: 'conteudo atualizado',
      id: 42,
    })

    expect(result.status).toBe('ok')
    expect(result.id).toBe(42)
    expect(result.conteudo).toBe('conteudo atualizado')
    expect(result.summary).toMatch(/atualizada/i)
  })

  it('salvar_memoria retorna erro quando limite de 50 é atingido', async () => {
    // Seed 50 memories
    for (let i = 1; i <= 50; i++) {
      memorias.push({
        id: i,
        conteudo: `memo ${i}`,
        criada_em: new Date().toISOString(),
        atualizada_em: new Date().toISOString(),
      })
    }

    const result = await executeTool('salvar_memoria', {
      conteudo: 'tentando a 51ª',
    })

    expect(result.status).toBe('error')
    expect(result.code).toBe('LIMITE_MEMORIAS')
    expect(result.erro).toMatch(/Limite de 50/i)
    expect(result.correction).toMatch(/listar_memorias/i)
  })

  // ===== listar_memorias =====

  it('listar_memorias retorna lista vazia quando não há memórias', async () => {
    const result = await executeTool('listar_memorias', {})

    expect(result.status).toBe('ok')
    expect(result.memorias).toEqual([])
    expect(result.total).toBe(0)
    expect(result.limite).toBe(50)
    expect(result.summary).toMatch(/0 memória/i)
  })

  it('listar_memorias retorna memórias existentes ordenadas', async () => {
    memorias.push(
      { id: 1, conteudo: 'primeira', criada_em: '2026-01-01T00:00:00Z', atualizada_em: '2026-01-01T00:00:00Z' },
      { id: 2, conteudo: 'segunda', criada_em: '2026-01-02T00:00:00Z', atualizada_em: '2026-01-02T00:00:00Z' },
    )

    const result = await executeTool('listar_memorias', {})

    expect(result.status).toBe('ok')
    expect(result.total).toBe(2)
    expect(result.memorias).toHaveLength(2)
    expect(result.memorias[0].conteudo).toBe('segunda') // mais recente primeiro
  })

  // ===== remover_memoria =====

  it('remover_memoria remove memória existente', async () => {
    memorias.push({
      id: 5,
      conteudo: 'a ser removida',
      criada_em: '2026-01-01T00:00:00Z',
      atualizada_em: '2026-01-01T00:00:00Z',
    })

    const result = await executeTool('remover_memoria', { id: 5 })

    expect(result.status).toBe('ok')
    expect(result.id).toBe(5)
    expect(result.summary).toMatch(/removida/i)
  })

  it('remover_memoria retorna erro quando memória não existe', async () => {
    const result = await executeTool('remover_memoria', { id: 999 })

    expect(result.status).toBe('error')
    expect(result.code).toBe('NOT_FOUND')
    expect(result.erro).toMatch(/não encontrada/i)
    expect(result.correction).toMatch(/listar_memorias/i)
  })
})
