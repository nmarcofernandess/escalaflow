import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  entityCalls: [] as unknown[][],
  relationCalls: [] as unknown[][],
  executeCalls: [] as unknown[][],
  chunkRows: undefined as Array<{
    chunk_id: number
    conteudo: string
    source_id: number
    source_titulo: string
    source_tipo: string
  }> | undefined,
  nextId: 10,
}))

vi.mock('../../../src/main/db/query', () => ({
  queryAll: vi.fn(async (sql: string) => {
    if (sql.includes('FROM knowledge_chunks')) {
      return db.chunkRows ?? [
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
    db.chunkRows = undefined
    db.nextId = 10
  })

  it('detects missing, duplicate, and out-of-range enrichment indexes', async () => {
    const { validateChunkEnrichmentBatch } = await import('../../../src/main/knowledge/enrichment')

    const validation = validateChunkEnrichmentBatch(3, {
      chunks: [
        { index: 0, resumo: 'zero', tags: [], entidades: [], relacoes: [] },
        { index: 1, resumo: 'um', tags: [], entidades: [], relacoes: [] },
        { index: 1, resumo: 'um duplicado', tags: [], entidades: [], relacoes: [] },
        { index: 9, resumo: 'fora', tags: [], entidades: [], relacoes: [] },
      ],
    })

    expect(validation.validChunks.map((chunk) => chunk.index)).toEqual([0, 1])
    expect(validation.missingIndexes).toEqual([2])
    expect(validation.duplicateIndexes).toEqual([1])
    expect(validation.outOfRangeIndexes).toEqual([9])
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

  it('marks partial enrichment batches as failed and applies each chunk once', async () => {
    const { enrichAllChunksWithModel } = await import('../../../src/main/knowledge/enrichment')

    db.chunkRows = [
      {
        chunk_id: 1,
        conteudo: 'Primeiro documento longo suficiente para enrichment parcial revelar falha de cobertura.',
        source_id: 100,
        source_titulo: 'Manual Sistema',
        source_tipo: 'sistema',
      },
      {
        chunk_id: 2,
        conteudo: 'Segundo documento longo suficiente para enrichment parcial revelar falha de cobertura.',
        source_id: 100,
        source_titulo: 'Manual Sistema',
        source_tipo: 'sistema',
      },
    ]

    const result = await enrichAllChunksWithModel({
      provider: 'test',
      modelo: 'partial',
      generate: vi.fn(async () => ({
        chunks: [
          { index: 0, resumo: 'primeiro', tags: ['primeiro'], entidades: [], relacoes: [] },
          { index: 0, resumo: 'duplicado', tags: ['duplicado'], entidades: [], relacoes: [] },
          { index: 99, resumo: 'fora', tags: ['fora'], entidades: [], relacoes: [] },
        ],
      })),
    })

    expect(result.chunks_enriquecidos).toBe(1)
    expect(result.batches_failed).toBe(1)
    expect(db.executeCalls.filter((call) => String(call[0]).includes('UPDATE knowledge_chunks'))).toHaveLength(1)
  })
})
