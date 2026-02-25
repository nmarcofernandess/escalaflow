import { generateObject } from 'ai'
import { z } from 'zod'
import { queryAll, queryOne, execute, insertReturningId } from '../db/query'
import { generateQueryEmbedding } from './embeddings'

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout ${ms}ms: ${label}`)), ms)
    promise.then(
      (v) => { clearTimeout(timer); resolve(v) },
      (e) => { clearTimeout(timer); reject(e) },
    )
  })
}

// =============================================================================
// SCHEMA — o que o LLM extrai de cada chunk
// =============================================================================

const ChunkEntitiesSchema = z.object({
  entities: z.array(z.object({
    nome: z.string().describe('Nome canônico da entidade (ex: "Cleunice", "CLT 44h", "Setor Caixa")'),
    tipo: z.string().describe('Tipo da entidade: pessoa, contrato, setor, regra, feriado, funcao, conceito'),
  })),
  relations: z.array(z.object({
    from: z.string().describe('Nome da entidade de origem'),
    to: z.string().describe('Nome da entidade de destino'),
    tipo_relacao: z.string().describe('Tipo da relação (ex: "trabalha_em", "regido_por", "depende_de", "aplica_se_a")'),
    peso: z.number().min(0).max(1).describe('Peso/confiança da relação (0-1)'),
  })),
})

type ExtractedChunk = z.infer<typeof ChunkEntitiesSchema>

// =============================================================================
// EXTRACT — 1 LLM call por chunk
// =============================================================================

const EXTRACTION_PROMPT = `Extraia entidades e relações deste trecho de conhecimento sobre RH de supermercado.

TIPOS DE ENTIDADE válidos: pessoa, contrato, setor, regra, feriado, funcao, conceito
TIPOS DE RELAÇÃO válidos: trabalha_em, regido_por, depende_de, aplica_se_a, exige, proibe, compoe, substitui, supervisiona

REGRAS:
- Nomes canônicos: "CLT 44h" (não "contrato de 44 horas"), "Caixa" (não "setor de caixa")
- Só extraia relações EXPLÍCITAS no texto (não invente)
- Se não houver entidades/relações claras, retorne arrays vazios
- Peso 1.0 = relação explícita e certa, 0.5 = implícita/inferida

TRECHO:
`

export async function extractEntitiesFromChunk(
  chunkText: string,
  createModel: (modelo: string) => any,
  modelo: string,
): Promise<ExtractedChunk> {
  try {
    const { object } = await withTimeout(
      generateObject({
        model: createModel(modelo),
        schema: ChunkEntitiesSchema,
        prompt: EXTRACTION_PROMPT + chunkText,
      }),
      30_000,
      'extractEntities chunk',
    )
    return object
  } catch (err) {
    console.warn('[graph] extractEntitiesFromChunk falhou:', (err as Error).message)
    return { entities: [], relations: [] }
  }
}

// =============================================================================
// MERGE — dedup entidades por (nome, tipo), acumula relações
// =============================================================================

interface MergedEntity {
  nome: string
  tipo: string
}

interface MergedRelation {
  from: string
  to: string
  tipo_relacao: string
  peso: number
}

function mergeExtractions(extractions: ExtractedChunk[]): {
  entities: MergedEntity[]
  relations: MergedRelation[]
} {
  const entityMap = new Map<string, MergedEntity>()
  const relationSet = new Map<string, MergedRelation>()

  for (const ext of extractions) {
    for (const e of ext.entities) {
      const key = `${e.nome.toLowerCase()}::${e.tipo.toLowerCase()}`
      if (!entityMap.has(key)) {
        entityMap.set(key, { nome: e.nome, tipo: e.tipo.toLowerCase() })
      }
    }
    for (const r of ext.relations) {
      const key = `${r.from.toLowerCase()}::${r.to.toLowerCase()}::${r.tipo_relacao.toLowerCase()}`
      const existing = relationSet.get(key)
      if (!existing || r.peso > existing.peso) {
        relationSet.set(key, {
          from: r.from,
          to: r.to,
          tipo_relacao: r.tipo_relacao.toLowerCase(),
          peso: r.peso,
        })
      }
    }
  }

  return {
    entities: [...entityMap.values()],
    relations: [...relationSet.values()],
  }
}

// =============================================================================
// PERSIST — insere entidades + relações no PGlite
// =============================================================================

async function persistGraph(
  entities: MergedEntity[],
  relations: MergedRelation[],
  origem: 'sistema' | 'usuario' = 'usuario',
): Promise<{ entities_count: number; relations_count: number }> {
  // Mapa nome→id pra resolver FKs das relações
  const entityIdMap = new Map<string, number>()

  for (const e of entities) {
    // Embedding local (grátis) pra cada entidade
    const embedding = await generateQueryEmbedding(e.nome)
    const embeddingJson = embedding ? JSON.stringify(embedding) : null

    let id: number
    if (embeddingJson) {
      id = await insertReturningId(
        `INSERT INTO knowledge_entities (nome, tipo, embedding, origem)
         VALUES ($1, $2, $3::vector, $4)
         ON CONFLICT (nome, tipo) DO UPDATE SET embedding = EXCLUDED.embedding, origem = EXCLUDED.origem
         RETURNING id`,
        e.nome, e.tipo, embeddingJson, origem,
      )
    } else {
      id = await insertReturningId(
        `INSERT INTO knowledge_entities (nome, tipo, origem)
         VALUES ($1, $2, $3)
         ON CONFLICT (nome, tipo) DO NOTHING
         RETURNING id`,
        e.nome, e.tipo, origem,
      )
      // Se ON CONFLICT DO NOTHING, RETURNING pode retornar vazio — busca o ID
      if (!id) {
        const existing = await queryOne<{ id: number }>(
          'SELECT id FROM knowledge_entities WHERE nome = $1 AND tipo = $2',
          e.nome, e.tipo,
        )
        if (existing) id = existing.id
      }
    }

    if (id) {
      entityIdMap.set(e.nome.toLowerCase(), id)
    }
  }

  let relationsInserted = 0
  for (const r of relations) {
    const fromId = entityIdMap.get(r.from.toLowerCase())
    const toId = entityIdMap.get(r.to.toLowerCase())
    if (!fromId || !toId || fromId === toId) continue

    try {
      await execute(
        `INSERT INTO knowledge_relations (entity_from_id, entity_to_id, tipo_relacao, peso)
         VALUES ($1, $2, $3, $4)`,
        fromId, toId, r.tipo_relacao, r.peso,
      )
      relationsInserted++
    } catch {
      // Relação duplicada ou FK inválida — skip
    }
  }

  return { entities_count: entityIdMap.size, relations_count: relationsInserted }
}

// =============================================================================
// REBUILD — orquestrador principal
// =============================================================================

export interface GraphProgress {
  fase: 'limpando' | 'lendo_chunks' | 'extraindo' | 'persistindo' | 'concluido'
  chunk_atual?: number
  total_chunks?: number
  entities_count?: number
  relations_count?: number
}

export async function rebuildGraph(
  createModel: (modelo: string) => any,
  modelo: string,
  origem: 'sistema' | 'usuario' = 'usuario',
  onProgress?: (p: GraphProgress) => void,
): Promise<{ entities_count: number; relations_count: number; chunks_processados: number }> {
  // 1. Limpa entidades+relações APENAS da origem sendo reconstruída
  onProgress?.({ fase: 'limpando' })
  // Relações que envolvem entidades dessa origem
  await execute(
    `DELETE FROM knowledge_relations WHERE entity_from_id IN (SELECT id FROM knowledge_entities WHERE origem = $1)
     OR entity_to_id IN (SELECT id FROM knowledge_entities WHERE origem = $1)`,
    origem,
  )
  await execute('DELETE FROM knowledge_entities WHERE origem = $1', origem)

  // 2. Lê chunks ativos filtrados por origem
  //    sistema → knowledge_sources.tipo = 'sistema'
  //    usuario → knowledge_sources.tipo != 'sistema'
  onProgress?.({ fase: 'lendo_chunks' })
  const tipoFilter = origem === 'sistema' ? "ks.tipo = 'sistema'" : "ks.tipo != 'sistema'"
  const chunks = await queryAll<{ id: number; conteudo: string }>(
    `SELECT kc.id, kc.conteudo
     FROM knowledge_chunks kc
     JOIN knowledge_sources ks ON ks.id = kc.source_id AND ks.ativo = true
     WHERE length(kc.conteudo) > 50 AND ${tipoFilter}
     ORDER BY kc.id
     LIMIT 100`,
  )

  if (chunks.length === 0) {
    onProgress?.({ fase: 'concluido', entities_count: 0, relations_count: 0 })
    return { entities_count: 0, relations_count: 0, chunks_processados: 0 }
  }

  // 3. Extrai entidades/relações de cada chunk (1 LLM call por chunk, timeout 30s)
  console.log(`[graph] iniciando extracao de ${chunks.length} chunks (origem: ${origem})`)
  const extractions: ExtractedChunk[] = []
  for (let i = 0; i < chunks.length; i++) {
    console.log(`[graph] extraindo chunk ${i + 1}/${chunks.length}...`)
    onProgress?.({ fase: 'extraindo', chunk_atual: i + 1, total_chunks: chunks.length })
    const ext = await extractEntitiesFromChunk(chunks[i].conteudo, createModel, modelo)
    if (ext.entities.length > 0 || ext.relations.length > 0) {
      extractions.push(ext)
    }
  }
  console.log(`[graph] extracao concluida: ${extractions.length} chunks com dados de ${chunks.length} total`)

  // 4. Merge (dedup)
  const merged = mergeExtractions(extractions)

  // 5. Persiste
  onProgress?.({ fase: 'persistindo' })
  const result = await persistGraph(merged.entities, merged.relations, origem)

  onProgress?.({
    fase: 'concluido',
    entities_count: result.entities_count,
    relations_count: result.relations_count,
  })

  return {
    entities_count: result.entities_count,
    relations_count: result.relations_count,
    chunks_processados: chunks.length,
  }
}

// =============================================================================
// STATS — leitura rápida do estado atual do graph
// =============================================================================

// =============================================================================
// EXPORT / IMPORT — seed do graph sistema (pre-computed, sem LLM)
// =============================================================================

export async function exportGraphSeed(origem: 'sistema' | 'usuario' = 'sistema'): Promise<{
  entities: Array<{ nome: string; tipo: string }>
  relations: Array<{ from_nome: string; to_nome: string; tipo_relacao: string; peso: number }>
}> {
  const entities = await queryAll<{ nome: string; tipo: string }>(
    `SELECT nome, tipo FROM knowledge_entities
     WHERE origem = $1 AND (valid_to IS NULL OR valid_to > NOW())
     ORDER BY tipo, nome`,
    origem,
  )

  const relations = await queryAll<{ from_nome: string; to_nome: string; tipo_relacao: string; peso: number }>(
    `SELECT ke_from.nome AS from_nome, ke_to.nome AS to_nome, kr.tipo_relacao, kr.peso
     FROM knowledge_relations kr
     JOIN knowledge_entities ke_from ON kr.entity_from_id = ke_from.id AND ke_from.origem = $1
     JOIN knowledge_entities ke_to ON kr.entity_to_id = ke_to.id AND ke_to.origem = $1
     WHERE (kr.valid_to IS NULL OR kr.valid_to > NOW())
     ORDER BY ke_from.nome, ke_to.nome`,
    origem,
  )

  return { entities, relations }
}

/**
 * Importa graph seed pre-computado (sem LLM). Idempotente — se já existe, skip.
 * Embeddings são gerados localmente (grátis) durante import.
 */
export async function importGraphSeed(
  seed: {
    entities: Array<{ nome: string; tipo: string }>
    relations: Array<{ from_nome: string; to_nome: string; tipo_relacao: string; peso: number }>
  },
  origem: 'sistema' | 'usuario' = 'sistema',
): Promise<{ entities_count: number; relations_count: number }> {
  if (seed.entities.length === 0) return { entities_count: 0, relations_count: 0 }

  // Idempotente: se já tem entidades dessa origem, skip
  const existing = await queryOne<{ c: number }>(
    `SELECT COUNT(*)::int AS c FROM knowledge_entities WHERE origem = $1`,
    origem,
  )
  if ((existing?.c ?? 0) > 0) {
    return { entities_count: existing!.c, relations_count: 0 }
  }

  return await persistGraph(
    seed.entities,
    seed.relations.map(r => ({ from: r.from_nome, to: r.to_nome, tipo_relacao: r.tipo_relacao, peso: r.peso })),
    origem,
  )
}

// =============================================================================
// STATS — leitura rápida do estado atual do graph
// =============================================================================

export async function graphStats(origem?: 'sistema' | 'usuario'): Promise<{
  entities_count: number
  relations_count: number
  tipos: Array<{ tipo: string; count: number }>
}> {
  const origemFilter = origem ? ` AND origem = '${origem}'` : ''
  const entCount = await queryOne<{ c: number }>(
    `SELECT COUNT(*)::int AS c FROM knowledge_entities WHERE (valid_to IS NULL OR valid_to > NOW())${origemFilter}`,
  )

  // Para relações, se filtrando por origem, conta apenas relações cujas AMBAS entidades são dessa origem
  const relQuery = origem
    ? `SELECT COUNT(*)::int AS c FROM knowledge_relations kr
       JOIN knowledge_entities kf ON kf.id = kr.entity_from_id AND kf.origem = '${origem}'
       JOIN knowledge_entities kt ON kt.id = kr.entity_to_id AND kt.origem = '${origem}'
       WHERE (kr.valid_to IS NULL OR kr.valid_to > NOW())`
    : `SELECT COUNT(*)::int AS c FROM knowledge_relations WHERE valid_to IS NULL OR valid_to > NOW()`
  const relCount = await queryOne<{ c: number }>(relQuery)

  const tipos = await queryAll<{ tipo: string; count: number }>(
    `SELECT tipo, COUNT(*)::int AS count
     FROM knowledge_entities
     WHERE (valid_to IS NULL OR valid_to > NOW())${origemFilter}
     GROUP BY tipo
     ORDER BY count DESC`,
  )

  return {
    entities_count: entCount?.c ?? 0,
    relations_count: relCount?.c ?? 0,
    tipos,
  }
}
