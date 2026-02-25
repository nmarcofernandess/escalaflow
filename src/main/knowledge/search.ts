import { queryAll, execute, queryOne } from '../db/query'
import { generateQueryEmbedding } from './embeddings'
import type { KnowledgeChunk, KnowledgeRelation } from '../../shared/types'

interface SearchOptions {
  limite?: number
  setor_id?: number
}

interface SearchResult {
  chunks: Array<KnowledgeChunk & { score: number }>
  relations: Array<KnowledgeRelation & { from_nome: string; to_nome: string }>
  context_for_llm: string
}

/**
 * Hybrid search: vector + FTS + trigram com graceful degradation.
 * Se API de embedding offline → keyword-only search.
 * NUNCA lança erro pro usuário — retorna vazio no pior caso.
 */
export async function searchKnowledge(
  query: string,
  options?: SearchOptions,
): Promise<SearchResult> {
  const limite = options?.limite ?? 5

  try {
    const embedding = await generateQueryEmbedding(query)
    if (embedding) {
      return await hybridSearch(embedding, query, limite)
    }
    // Embedding indisponível — fallback keyword-only
    console.warn('[knowledge:search] Embedding indisponível, fallback keyword-only')
    return await keywordOnlySearch(query, limite)
  } catch (err) {
    console.warn('[knowledge:search] Erro na busca:', (err as Error).message)
    return await keywordOnlySearch(query, limite).catch(() => emptyResult())
  }
}

/**
 * Hybrid search: 70% vector + 30% FTS, importance boost, lazy decay.
 */
async function hybridSearch(
  embedding: number[],
  query: string,
  limite: number,
): Promise<SearchResult> {
  const embeddingStr = `[${embedding.join(',')}]`

  const chunks = await queryAll<KnowledgeChunk & { score: number }>(`
    WITH vector_results AS (
      SELECT knowledge_chunks.id, knowledge_chunks.source_id, knowledge_chunks.conteudo,
             knowledge_chunks.importance, knowledge_chunks.access_count,
             knowledge_chunks.last_accessed_at, knowledge_chunks.criada_em,
             1 - (knowledge_chunks.embedding <=> $1::vector) AS vector_score
      FROM knowledge_chunks
      JOIN knowledge_sources ks ON ks.id = knowledge_chunks.source_id AND ks.ativo = true
      WHERE knowledge_chunks.embedding IS NOT NULL
        AND NOT (knowledge_chunks.importance = 'low' AND knowledge_chunks.access_count = 0
                 AND knowledge_chunks.criada_em < NOW() - INTERVAL '30 days')
      ORDER BY knowledge_chunks.embedding <=> $1::vector
      LIMIT 20
    ),
    fts_results AS (
      SELECT knowledge_chunks.id, knowledge_chunks.source_id, knowledge_chunks.conteudo,
             knowledge_chunks.importance, knowledge_chunks.access_count,
             knowledge_chunks.last_accessed_at, knowledge_chunks.criada_em,
             ts_rank(knowledge_chunks.search_tsv, plainto_tsquery('portuguese', $2)) AS fts_score
      FROM knowledge_chunks
      JOIN knowledge_sources ks ON ks.id = knowledge_chunks.source_id AND ks.ativo = true
      WHERE knowledge_chunks.search_tsv @@ plainto_tsquery('portuguese', $2)
        AND NOT (knowledge_chunks.importance = 'low' AND knowledge_chunks.access_count = 0
                 AND knowledge_chunks.criada_em < NOW() - INTERVAL '30 days')
      LIMIT 20
    ),
    combined AS (
      SELECT
        COALESCE(v.id, f.id) AS id,
        COALESCE(v.source_id, f.source_id) AS source_id,
        COALESCE(v.conteudo, f.conteudo) AS conteudo,
        COALESCE(v.importance, f.importance) AS importance,
        COALESCE(v.access_count, f.access_count) AS access_count,
        COALESCE(v.last_accessed_at, f.last_accessed_at) AS last_accessed_at,
        COALESCE(v.criada_em, f.criada_em) AS criada_em,
        CASE WHEN COALESCE(v.importance, f.importance) = 'high'
          THEN (0.7 * COALESCE(v.vector_score, 0) + 0.3 * COALESCE(f.fts_score, 0)) + 0.15
          ELSE (0.7 * COALESCE(v.vector_score, 0) + 0.3 * COALESCE(f.fts_score, 0))
        END AS score
      FROM vector_results v
      FULL OUTER JOIN fts_results f ON v.id = f.id
    )
    SELECT id, source_id, conteudo, importance, access_count, last_accessed_at, criada_em, score
    FROM combined
    WHERE importance = 'high' OR score > 0.6
    ORDER BY score DESC
    LIMIT $3
  `, embeddingStr, query, limite)

  // Track access
  await trackAccess(chunks.map(c => c.id))

  // Graph enrichment
  const relations = await getRelatedEntities(chunks)

  return {
    chunks,
    relations,
    context_for_llm: buildContextForLlm(chunks, relations),
  }
}

/**
 * Keyword-only search usando FTS + trigram. Fallback quando API offline.
 */
async function keywordOnlySearch(query: string, limite: number): Promise<SearchResult> {
  const chunks = await queryAll<KnowledgeChunk & { score: number }>(`
    WITH fts AS (
      SELECT knowledge_chunks.id, knowledge_chunks.source_id, knowledge_chunks.conteudo,
             knowledge_chunks.importance, knowledge_chunks.access_count,
             knowledge_chunks.last_accessed_at, knowledge_chunks.criada_em,
             ts_rank(knowledge_chunks.search_tsv, plainto_tsquery('portuguese', $1)) AS fts_score
      FROM knowledge_chunks
      JOIN knowledge_sources ks ON ks.id = knowledge_chunks.source_id AND ks.ativo = true
      WHERE knowledge_chunks.search_tsv @@ plainto_tsquery('portuguese', $1)
        AND NOT (knowledge_chunks.importance = 'low' AND knowledge_chunks.access_count = 0
                 AND knowledge_chunks.criada_em < NOW() - INTERVAL '30 days')
    ),
    trgm AS (
      SELECT knowledge_chunks.id, knowledge_chunks.source_id, knowledge_chunks.conteudo,
             knowledge_chunks.importance, knowledge_chunks.access_count,
             knowledge_chunks.last_accessed_at, knowledge_chunks.criada_em,
             similarity(knowledge_chunks.conteudo, $1) AS trgm_score
      FROM knowledge_chunks
      JOIN knowledge_sources ks ON ks.id = knowledge_chunks.source_id AND ks.ativo = true
      WHERE similarity(knowledge_chunks.conteudo, $1) > 0.1
        AND NOT (knowledge_chunks.importance = 'low' AND knowledge_chunks.access_count = 0
                 AND knowledge_chunks.criada_em < NOW() - INTERVAL '30 days')
    ),
    combined AS (
      SELECT
        COALESCE(f.id, t.id) AS id,
        COALESCE(f.source_id, t.source_id) AS source_id,
        COALESCE(f.conteudo, t.conteudo) AS conteudo,
        COALESCE(f.importance, t.importance) AS importance,
        COALESCE(f.access_count, t.access_count) AS access_count,
        COALESCE(f.last_accessed_at, t.last_accessed_at) AS last_accessed_at,
        COALESCE(f.criada_em, t.criada_em) AS criada_em,
        CASE WHEN COALESCE(f.importance, t.importance) = 'high'
          THEN (0.7 * COALESCE(f.fts_score, 0) + 0.3 * COALESCE(t.trgm_score, 0)) + 0.15
          ELSE (0.7 * COALESCE(f.fts_score, 0) + 0.3 * COALESCE(t.trgm_score, 0))
        END AS score
      FROM fts f
      FULL OUTER JOIN trgm t ON f.id = t.id
    )
    SELECT id, source_id, conteudo, importance, access_count, last_accessed_at, criada_em, score
    FROM combined
    WHERE importance = 'high' OR score > 0.3
    ORDER BY score DESC
    LIMIT $2
  `, query, limite)

  await trackAccess(chunks.map(c => c.id))

  const relations = await getRelatedEntities(chunks)

  return {
    chunks,
    relations,
    context_for_llm: buildContextForLlm(chunks, relations),
  }
}

/**
 * Atualiza access_count e last_accessed_at nos chunks retornados.
 */
async function trackAccess(chunkIds: number[]): Promise<void> {
  if (chunkIds.length === 0) return
  try {
    for (const id of chunkIds) {
      await execute(
        'UPDATE knowledge_chunks SET access_count = access_count + 1, last_accessed_at = NOW() WHERE id = $1',
        id,
      )
    }
  } catch {
    // Tracking failure is non-critical
  }
}

/**
 * Busca relações válidas das entidades mencionadas nos chunks.
 */
async function getRelatedEntities(
  chunks: Array<KnowledgeChunk & { score: number }>,
): Promise<Array<KnowledgeRelation & { from_nome: string; to_nome: string }>> {
  if (chunks.length === 0) return []

  try {
    // Extrai nomes de entidades que podem aparecer nos chunks
    const entityNames = await queryAll<{ nome: string }>(`
      SELECT DISTINCT ke.nome
      FROM knowledge_entities ke
      WHERE ke.valid_to IS NULL OR ke.valid_to > NOW()
    `)

    if (entityNames.length === 0) return []

    // Filtra apenas entidades que aparecem nos chunks
    const chunkText = chunks.map(c => c.conteudo).join(' ').toLowerCase()
    const matchingNames = entityNames
      .filter(e => chunkText.includes(e.nome.toLowerCase()))
      .map(e => e.nome)

    if (matchingNames.length === 0) return []

    return await queryAll<KnowledgeRelation & { from_nome: string; to_nome: string }>(`
      SELECT kr.id, kr.entity_from_id, kr.entity_to_id, kr.tipo_relacao, kr.peso,
             kr.valid_from, kr.valid_to, kr.criada_em,
             ke_from.nome AS from_nome, ke_to.nome AS to_nome
      FROM knowledge_relations kr
      JOIN knowledge_entities ke_from ON kr.entity_from_id = ke_from.id
      JOIN knowledge_entities ke_to ON kr.entity_to_id = ke_to.id
      WHERE (ke_from.nome = ANY($1) OR ke_to.nome = ANY($1))
        AND (kr.valid_to IS NULL OR kr.valid_to > NOW())
        AND (ke_from.valid_to IS NULL OR ke_from.valid_to > NOW())
        AND (ke_to.valid_to IS NULL OR ke_to.valid_to > NOW())
    `, matchingNames)
  } catch {
    return []
  }
}

/**
 * Monta texto contextual formatado para injeção no LLM.
 * Cada chunk é truncado em CHUNK_CONTEXT_MAX_CHARS para controlar o tamanho total.
 */
const CHUNK_CONTEXT_MAX_CHARS = 500

function buildContextForLlm(
  chunks: Array<KnowledgeChunk & { score: number }>,
  relations: Array<{ from_nome: string; to_nome: string; tipo_relacao: string }>,
): string {
  if (chunks.length === 0) return ''

  const parts: string[] = []

  for (const chunk of chunks) {
    const snippet = chunk.conteudo.length > CHUNK_CONTEXT_MAX_CHARS
      ? chunk.conteudo.slice(0, CHUNK_CONTEXT_MAX_CHARS) + '…'
      : chunk.conteudo
    parts.push(`\n**[${chunk.importance.toUpperCase()}]**`)
    parts.push(snippet)
  }

  if (relations.length > 0) {
    parts.push('\n**Relações:**')
    for (const rel of relations) {
      parts.push(`- ${rel.from_nome} → ${rel.to_nome} (${rel.tipo_relacao})`)
    }
  }

  return parts.join('\n')
}

/**
 * Exploração de grafo: traversal recursivo a partir de uma entidade.
 */
export async function exploreRelations(
  entidade: string,
  profundidade: number = 2,
): Promise<{
  entidade_raiz: string | null
  entidades: Array<{ nome: string; tipo: string; nivel: number }>
  relacoes: Array<{ from_nome: string; to_nome: string; tipo_relacao: string; peso: number }>
}> {
  // Encontra a entidade raiz
  const raiz = await queryOne<{ id: number; nome: string; tipo: string }>(
    `SELECT id, nome, tipo FROM knowledge_entities
     WHERE LOWER(nome) = LOWER($1) AND (valid_to IS NULL OR valid_to > NOW())
     LIMIT 1`,
    entidade,
  )

  if (!raiz) {
    return { entidade_raiz: null, entidades: [], relacoes: [] }
  }

  // CTE recursivo para traversal
  const result = await queryAll<{
    nome: string
    tipo: string
    nivel: number
    from_nome: string
    to_nome: string
    tipo_relacao: string
    peso: number
  }>(`
    WITH RECURSIVE graph AS (
      SELECT ke.id, ke.nome, ke.tipo, 0 AS nivel
      FROM knowledge_entities ke
      WHERE ke.id = $1 AND (ke.valid_to IS NULL OR ke.valid_to > NOW())

      UNION

      SELECT ke2.id, ke2.nome, ke2.tipo, g.nivel + 1
      FROM graph g
      JOIN knowledge_relations kr ON (kr.entity_from_id = g.id OR kr.entity_to_id = g.id)
      JOIN knowledge_entities ke2 ON ke2.id = CASE
        WHEN kr.entity_from_id = g.id THEN kr.entity_to_id
        ELSE kr.entity_from_id
      END
      WHERE g.nivel < $2
        AND (kr.valid_to IS NULL OR kr.valid_to > NOW())
        AND (ke2.valid_to IS NULL OR ke2.valid_to > NOW())
    )
    SELECT DISTINCT g.nome, g.tipo, g.nivel,
           COALESCE(ke_from.nome, '') AS from_nome,
           COALESCE(ke_to.nome, '') AS to_nome,
           COALESCE(kr.tipo_relacao, '') AS tipo_relacao,
           COALESCE(kr.peso, 0) AS peso
    FROM graph g
    LEFT JOIN knowledge_relations kr ON (kr.entity_from_id = g.id OR kr.entity_to_id = g.id)
      AND (kr.valid_to IS NULL OR kr.valid_to > NOW())
    LEFT JOIN knowledge_entities ke_from ON kr.entity_from_id = ke_from.id
    LEFT JOIN knowledge_entities ke_to ON kr.entity_to_id = ke_to.id
    ORDER BY g.nivel, g.nome
  `, raiz.id, profundidade)

  const entidades = [...new Map(result.map(r => [r.nome, { nome: r.nome, tipo: r.tipo, nivel: r.nivel }])).values()]
  const relacoes = result
    .filter(r => r.from_nome && r.to_nome && r.tipo_relacao)
    .map(r => ({ from_nome: r.from_nome, to_nome: r.to_nome, tipo_relacao: r.tipo_relacao, peso: r.peso }))

  // Deduplica relações
  const relacoesUnique = [...new Map(
    relacoes.map(r => [`${r.from_nome}::${r.to_nome}::${r.tipo_relacao}`, r])
  ).values()]

  return {
    entidade_raiz: raiz.nome,
    entidades,
    relacoes: relacoesUnique,
  }
}

function emptyResult(): SearchResult {
  return { chunks: [], relations: [], context_for_llm: '' }
}
