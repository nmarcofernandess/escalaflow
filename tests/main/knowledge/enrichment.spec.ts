import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  entityCalls: [] as unknown[][],
  relationCalls: [] as unknown[][],
  executeCalls: [] as unknown[][],
  nextId: 10,
}))

vi.mock('../../../src/main/db/query', () => ({
  queryAll: vi.fn(async (sql: string) => {
    if (sql.includes('FROM knowledge_chunks')) {
      return [
        {
          chunk_id: 1,
          conteudo: 'Documento sistema com regra CLT longa suficiente para enrichment funcionar corretamente.',
          source_id: 100,
          source_titulo: 'Manual Sistema',
          source_tipo: 'sistema',
        },
        {
          chunk_id: 2,
          conteudo: 'Documento usuario importado com politica interna longa suficiente para enrichment funcionar.',
          source_id: 200,
          source_titulo: 'Manual Usuario',
          source_tipo: 'importacao_usuario',
        },
      ]
    }
    if (sql.includes('SELECT DISTINCT nome FROM knowledge_entities')) return []
    return []
  }),
  queryOne: vi.fn(async () => undefined),
  insertReturningId: vi.fn(async (sql: string, ...args: unknown[]) => {
    if (sql.includes('INSERT INTO knowledge_entities')) db.entityCalls.push(args)
    return ++db.nextId
  }),
  execute: vi.fn(async (sql: string, ...args: unknown[]) => {
    if (sql.includes('INSERT INTO knowledge_relations')) db.relationCalls.push(args)
    else db.executeCalls.push([sql, ...args])
    return { changes: 1 }
  }),
}))

vi.mock('../../../src/main/knowledge/embeddings', () => ({
  generatePassageEmbedding: vi.fn(async () => null),
}))

describe('knowledge enrichment', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    db.entityCalls = []
    db.relationCalls = []
    db.executeCalls = []
    db.nextId = 10
  })

  it('preserves graph origin when system and user chunks are enriched in one run', async () => {
    const { enrichAllChunksWithModel } = await import('../../../src/main/knowledge/enrichment')

    const result = await enrichAllChunksWithModel({
      provider: 'test',
      modelo: 'deterministic',
      generate: vi.fn(async (prompt: string) => {
        const isSystem = prompt.includes('Manual Sistema')
        const prefix = isSystem ? 'Sistema' : 'Usuario'
        return {
          chunks: [{
            index: 0,
            resumo: `${prefix} resumo`,
            tags: [prefix.toLowerCase()],
            entidades: [
              { nome: `${prefix} Entidade A`, tipo: 'conceito' },
              { nome: `${prefix} Entidade B`, tipo: 'regra' },
            ],
            relacoes: [
              { from: `${prefix} Entidade A`, to: `${prefix} Entidade B`, tipo_relacao: 'relacionado_a', peso: 1 },
            ],
          }],
        }
      }),
    })

    expect(result.chunks_enriquecidos).toBe(2)
    expect(db.entityCalls.map((args) => args[2])).toEqual(['sistema', 'sistema', 'usuario', 'usuario'])
    expect(db.relationCalls).toHaveLength(2)
  })
})
