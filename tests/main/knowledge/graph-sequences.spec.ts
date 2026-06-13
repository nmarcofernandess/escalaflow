import { describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  execute: vi.fn(async () => ({ changes: 1 })),
}))

vi.mock('../../../src/main/db/query', () => ({
  execute: db.execute,
}))

describe('knowledge graph sequence sync', () => {
  it('syncs entity and relation serial sequences before graph inserts', async () => {
    const { syncKnowledgeGraphSequences } = await import('../../../src/main/knowledge/graph-sequences')

    await syncKnowledgeGraphSequences()

    expect(db.execute).toHaveBeenCalledTimes(2)
    expect(db.execute.mock.calls[0][0]).toContain("pg_get_serial_sequence('knowledge_entities', 'id')")
    expect(db.execute.mock.calls[1][0]).toContain("pg_get_serial_sequence('knowledge_relations', 'id')")
  })
})
