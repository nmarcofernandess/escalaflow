import { execute } from '../db/query'

export async function syncKnowledgeGraphSequences(): Promise<void> {
  await execute(
    "SELECT setval(pg_get_serial_sequence('knowledge_entities', 'id'), COALESCE((SELECT MAX(id) FROM knowledge_entities), 0) + 1, false)",
  )
  await execute(
    "SELECT setval(pg_get_serial_sequence('knowledge_relations', 'id'), COALESCE((SELECT MAX(id) FROM knowledge_relations), 0) + 1, false)",
  )
}
