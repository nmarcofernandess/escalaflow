import { insertReturningId, execute } from '../db/query'
import { generatePassageEmbeddings } from './embeddings'
import { chunkText } from './chunking'

/**
 * Extrai `<!-- quando_usar: ... -->` do topo do documento e prepend como texto plano.
 * O hint vira parte do primeiro chunk, melhorando recall semântico no search.
 */
function extractAndPrependHint(conteudo: string): { hint: string | null; contentForChunking: string } {
  const match = conteudo.match(/^<!--\s*quando_usar:\s*([\s\S]*?)\s*-->\s*/)
  if (!match) return { hint: null, contentForChunking: conteudo }

  const hint = match[1].trim()
  const cleanContent = conteudo.slice(match[0].length)
  return { hint, contentForChunking: `Contexto: ${hint}\n\n${cleanContent}` }
}

/**
 * Ingesta conhecimento na base: chunk → embed → FTS.
 *
 * @returns source_id, chunks criados, entities_count (sempre 0 na v1 — graph é backlog v2)
 */
export async function ingestKnowledge(
  titulo: string,
  conteudo: string,
  importance: 'high' | 'low',
  metadata: Record<string, unknown> = {},
): Promise<{ source_id: number; chunks_count: number; entities_count: number }> {
  // 0. Extrair context hint (se existir)
  const { hint, contentForChunking } = extractAndPrependHint(conteudo)
  if (hint) {
    metadata.context_hint = hint
  }

  // 1. Inserir source (preserva conteudo_original com hint HTML intacto)
  const tipo = (metadata.tipo as string) || (importance === 'low' ? 'auto_capture' : 'manual')
  const source_id = await insertReturningId(
    `INSERT INTO knowledge_sources (tipo, titulo, conteudo_original, metadata, importance)
     VALUES ($1, $2, $3, $4, $5)`,
    tipo,
    titulo,
    conteudo,
    JSON.stringify(metadata),
    importance,
  )

  // 2. Chunk (usa contentForChunking que tem hint como texto plano)
  const chunks = chunkText(contentForChunking)
  if (chunks.length === 0) {
    return { source_id, chunks_count: 0, entities_count: 0 }
  }

  // 3. Embeddings (graceful: null se modelo indisponível)
  const embeddings = await generatePassageEmbeddings(chunks)

  // 4. Inserir chunks com embedding + tsvector
  for (let i = 0; i < chunks.length; i++) {
    const embeddingValue = embeddings?.[i] ?? null
    const embeddingJson = embeddingValue ? JSON.stringify(embeddingValue) : null

    if (embeddingJson) {
      await execute(
        `INSERT INTO knowledge_chunks (source_id, conteudo, embedding, search_tsv, importance)
         VALUES ($1, $2, $3::vector, to_tsvector('portuguese', $4), $5)`,
        source_id,
        chunks[i],
        embeddingJson,
        chunks[i],
        importance,
      )
    } else {
      await execute(
        `INSERT INTO knowledge_chunks (source_id, conteudo, embedding, search_tsv, importance)
         VALUES ($1, $2, NULL, to_tsvector('portuguese', $3), $4)`,
        source_id,
        chunks[i],
        chunks[i],
        importance,
      )
    }
  }

  return { source_id, chunks_count: chunks.length, entities_count: 0 }
}
