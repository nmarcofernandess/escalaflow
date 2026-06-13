import { insertReturningId, execute, transaction } from '../db/query'
import { generatePassageEmbeddings } from './embeddings'
import { chunkText, chunkConversation } from './chunking'
import type { UnifiedConversation } from '../../shared/importer-types'

/**
 * Shared helper: inserts a single knowledge chunk with optional embedding + FTS tsvector.
 */
export async function insertChunk(
  sourceId: number,
  text: string,
  embeddingValue: number[] | null,
  importance: 'high' | 'low' = 'high',
): Promise<void> {
  const embeddingJson = embeddingValue ? JSON.stringify(embeddingValue) : null

  if (embeddingJson) {
    await execute(
      `INSERT INTO knowledge_chunks (source_id, conteudo, embedding, search_tsv, importance)
       VALUES ($1, $2, $3::vector, to_tsvector('portuguese', $4), $5)`,
      sourceId,
      text,
      embeddingJson,
      text,
      importance,
    )
  } else {
    await execute(
      `INSERT INTO knowledge_chunks (source_id, conteudo, search_tsv, importance)
       VALUES ($1, $2, to_tsvector('portuguese', $3), $4)`,
      sourceId,
      text,
      text,
      importance,
    )
  }
}

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

function readGroupId(metadata: Record<string, unknown>): number | null {
  const raw = metadata.group_id
  if (typeof raw === 'number' && Number.isInteger(raw) && raw > 0) return raw
  if (typeof raw === 'string' && /^\d+$/.test(raw)) return Number(raw)
  return null
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
  const group_id = readGroupId(metadata)
  const source_id = await insertReturningId(
    `INSERT INTO knowledge_sources (tipo, titulo, conteudo_original, group_id, metadata, importance)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
    tipo,
    titulo,
    conteudo,
    group_id,
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

  // 4. Inserir chunks com embedding + tsvector (transação elimina commit por INSERT)
  await transaction(async () => {
    for (let i = 0; i < chunks.length; i++) {
      const embeddingValue = embeddings?.[i] ?? null
      await insertChunk(source_id, chunks[i], embeddingValue, importance)
    }
  })

  return { source_id, chunks_count: chunks.length, entities_count: 0 }
}

// ---------------------------------------------------------------------------
// File-based Ingestion (routes through importer registry)
// ---------------------------------------------------------------------------

/**
 * Ingest a file by auto-detecting its format (text, PDF, JSON chat, ZIP).
 * Routes to text pipeline or conversation pipeline accordingly.
 */
export async function ingestFromFile(
  filePath: string,
  titulo?: string,
  metadata: Record<string, unknown> = {},
): Promise<{ source_id: number; chunks_count: number; entities_count: number; conversations_count?: number }> {
  const { importFile } = await import('../importers/importer-registry')
  const path = await import('path')

  const result = await importFile(filePath)

  if (result.type === 'error') {
    throw new Error(result.error)
  }

  if (result.type === 'text') {
    const name = titulo || result.data.metadata.fileName.replace(/\.[^.]+$/, '')
    return ingestKnowledge(name, result.data.text, 'high', {
      ...metadata,
      tipo: 'importacao_usuario',
      arquivo_original: filePath,
    })
  }

  // type === 'conversations'
  const convResult = await ingestConversations(
    result.data.conversations,
    titulo || path.basename(filePath, path.extname(filePath)),
    filePath,
    metadata,
  )
  return { ...convResult, conversations_count: result.data.conversations.length }
}

/**
 * Ingest an array of UnifiedConversations: chunk each → embed → persist.
 * Creates one knowledge_source per conversation.
 */
export async function ingestConversations(
  conversations: UnifiedConversation[],
  batchTitle?: string,
  sourceFile?: string,
  extraMetadata: Record<string, unknown> = {},
): Promise<{ source_id: number; chunks_count: number; entities_count: number }> {
  let totalChunks = 0
  let firstSourceId = 0

  for (const conv of conversations) {
    const chunks = chunkConversation(conv)
    if (chunks.length === 0) continue

    const titulo = conv.title || batchTitle || 'Conversa importada'
    const metadata: Record<string, unknown> = {
      ...extraMetadata,
      tipo: 'importacao_conversa',
      conversation_id: conv.id,
      source_format: conv.source,
      ...(sourceFile ? { arquivo_original: sourceFile } : {}),
    }
    const group_id = readGroupId(metadata)

    const source_id = await insertReturningId(
      `INSERT INTO knowledge_sources (tipo, titulo, conteudo_original, group_id, metadata, importance)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
      'importacao_conversa',
      titulo,
      chunks.map(c => c.text).join('\n\n---\n\n'),
      group_id,
      JSON.stringify(metadata),
      'high',
    )

    if (!firstSourceId) firstSourceId = source_id

    const texts = chunks.map(c => c.text)
    const embeddings = await generatePassageEmbeddings(texts)

    await transaction(async () => {
      for (let i = 0; i < texts.length; i++) {
        const embeddingValue = embeddings?.[i] ?? null
        await insertChunk(source_id, texts[i], embeddingValue, 'high')
      }
    })

    totalChunks += texts.length
  }

  return { source_id: firstSourceId, chunks_count: totalChunks, entities_count: 0 }
}
