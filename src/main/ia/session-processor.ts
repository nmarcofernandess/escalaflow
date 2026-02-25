import { generateText, generateObject } from 'ai'
import { z } from 'zod'
import { ingestKnowledge } from '../knowledge/ingest'
import { generateQueryEmbedding } from '../knowledge/embeddings'
import { queryOne, queryAll, execute } from '../db/query'
import type { IaMensagem } from '../../shared/types'

// =============================================================================
// CONSTANTS
// =============================================================================

const SESSION_MAX_SOURCES = 50
const DYNAMIC_MAX_SOURCES = 100
const COMPACTION_TOKEN_THRESHOLD = 30_000
const COMPACTION_KEEP_RECENT = 10
const DEDUP_COSINE_THRESHOLD = 0.85
const TRANSCRIPT_MAX_CHARS = 8000

// =============================================================================
// SANITIZE
// =============================================================================

/**
 * Extrai texto limpo das mensagens (só usuario + assistente, sem tool_calls JSON).
 */
export function sanitizeTranscript(mensagens: IaMensagem[]): string {
  const parts: string[] = []
  for (const m of mensagens) {
    if (m.papel === 'tool_result') continue
    const label = m.papel === 'usuario' ? 'Usuario' : 'Assistente'
    const textoBase = m.conteudo?.trim() ?? ''
    const anexosMarcadores = m.anexos?.map(a => `[Anexo: ${a.nome} (${a.mime_type})]`).join(' ') ?? ''
    const linha = [textoBase, anexosMarcadores].filter(Boolean).join(' ')
    if (!linha) continue
    parts.push(`${label}: ${linha}`)
  }
  return parts.join('\n')
}

/**
 * Estima tokens a partir do comprimento do texto (~3.5 chars/token).
 */
export function estimateTokens(text: string | null | undefined): number {
  return Math.ceil((text?.length ?? 0) / 3.5)
}

// =============================================================================
// SESSION INDEXING (GRATIS — embedding local)
// =============================================================================

/**
 * Indexa o transcript de uma conversa como knowledge source.
 * Idempotente: se já existe source com esse conversa_id, não duplica.
 */
export async function indexSession(
  conversa_id: string,
  titulo: string,
  mensagens: IaMensagem[],
): Promise<void> {
  const transcript = sanitizeTranscript(mensagens)
  if (!transcript || transcript.length < 50) return

  // Dedup: checa se já existe source pra essa conversa
  const existing = await queryOne<{ id: number }>(
    `SELECT id FROM knowledge_sources WHERE metadata::text LIKE $1`,
    `%"conversa_id":"${conversa_id}"%`,
  )
  if (existing) return

  // Ingest (trunca transcript pra não criar chunks gigantes)
  const truncated = transcript.slice(0, TRANSCRIPT_MAX_CHARS)
  await ingestKnowledge(
    `Conversa: ${titulo}`,
    truncated,
    'low',
    { tipo: 'session', conversa_id },
  )

  // Enforce limit: remove oldest never-accessed sessions
  await enforceSourceLimit('session', SESSION_MAX_SOURCES)
}

// =============================================================================
// SMART EXTRACTION (PAGO — 1 LLM call)
// =============================================================================

const ExtractionSchema = z.object({
  items: z.array(z.object({
    summary: z.string().describe('Fato extraido em 1-2 frases'),
    category: z.enum(['fato', 'preferencia', 'correcao', 'decisao', 'entidade']),
    importance: z.enum(['high', 'low']),
  })),
})

/**
 * Extrai fatos relevantes de uma conversa usando LLM.
 * Dedup por cosine similarity > 0.85.
 */
export async function extractMemories(
  conversa_id: string,
  mensagens: IaMensagem[],
  createModel: (modelo: string) => any,
  modelo: string,
): Promise<void> {
  const transcript = sanitizeTranscript(mensagens).slice(0, TRANSCRIPT_MAX_CHARS)
  if (transcript.length < 100) return

  let result: z.infer<typeof ExtractionSchema>
  try {
    const { object } = await generateObject({
      model: createModel(modelo),
      schema: ExtractionSchema,
      prompt: `Analise esta conversa de RH de supermercado e extraia FATOS CONCRETOS relevantes para conversas futuras.
Foque em: decisoes tomadas, preferencias de colaboradores, excecoes combinadas, regras especificas da empresa, correcoes de dados.
NAO extraia: saudacoes, perguntas genericas, dados que ja estao no banco (escalas geradas, horarios padrao).
Se nao houver fatos relevantes, retorne items vazio.

CONVERSA:
${transcript}`,
    })
    result = object
  } catch (err) {
    console.warn('[session-processor] extractMemories falhou:', (err as Error).message)
    return
  }

  if (!result.items || result.items.length === 0) return

  for (const item of result.items) {
    // Gera embedding pra dedup
    const embedding = await generateQueryEmbedding(item.summary)

    if (embedding) {
      // Busca dedup por cosine similarity
      const embeddingStr = `[${embedding.join(',')}]`
      const similar = await queryOne<{ id: number; source_id: number; score: number }>(
        `SELECT kc.id, kc.source_id,
                1 - (kc.embedding <=> $1::vector) AS score
         FROM knowledge_chunks kc
         JOIN knowledge_sources ks ON ks.id = kc.source_id
         WHERE ks.metadata::text LIKE '%"tipo":"auto_extract"%'
           AND kc.embedding IS NOT NULL
         ORDER BY kc.embedding <=> $1::vector
         LIMIT 1`,
        embeddingStr,
      )

      if (similar && similar.score > DEDUP_COSINE_THRESHOLD) {
        // Atualiza existente: deleta source+chunks antigo, reingest atualizado
        await execute('DELETE FROM knowledge_sources WHERE id = $1', similar.source_id)
      }
    }

    // Ingesta novo
    await ingestKnowledge(
      `Auto: ${item.summary.slice(0, 80)}`,
      item.summary,
      item.importance,
      { tipo: 'auto_extract', category: item.category, conversa_id },
    )
  }

  // Enforce limit
  await enforceSourceLimit('auto_extract', DYNAMIC_MAX_SOURCES)
}

// =============================================================================
// HISTORY COMPACTION (PAGO — 1 LLM call quando necessario)
// =============================================================================

/**
 * Se o historico excede 30K tokens E tem >10 msgs, resume as msgs antigas.
 * Retorna resumo se compactou, null se não precisa.
 * Cache em ia_conversas.resumo_compactado (invalidado por nova msg).
 */
export async function maybeCompact(
  conversa_id: string,
  historico: IaMensagem[],
  createModel: (modelo: string) => any,
  modelo: string,
): Promise<string | null> {
  // Estima tokens total
  const totalText = historico.map(m => m.conteudo || '').join(' ')
  const tokens = estimateTokens(totalText)

  if (tokens <= COMPACTION_TOKEN_THRESHOLD || historico.length <= COMPACTION_KEEP_RECENT) {
    return null
  }

  // Busca cache
  const cached = await queryOne<{ resumo_compactado: string | null }>(
    'SELECT resumo_compactado FROM ia_conversas WHERE id = $1',
    conversa_id,
  )
  if (cached?.resumo_compactado) return cached.resumo_compactado

  // Gera resumo das msgs antigas (exceto as 10 mais recentes)
  const msgsAntigas = historico.slice(0, -COMPACTION_KEEP_RECENT)
  const transcriptAntigas = sanitizeTranscript(msgsAntigas).slice(0, 6000)

  if (transcriptAntigas.length < 100) return null

  try {
    const { text: resumo } = await generateText({
      model: createModel(modelo),
      prompt: `Resuma a conversa abaixo preservando: decisoes tomadas, dados consultados, acoes executadas, preferencias expressas.
Formato: lista concisa de fatos em portugues. Maximo 500 palavras.

CONVERSA:
${transcriptAntigas}`,
    })

    if (resumo && resumo.length > 20) {
      // Salva cache
      await execute(
        'UPDATE ia_conversas SET resumo_compactado = $1 WHERE id = $2',
        resumo,
        conversa_id,
      )
      return resumo
    }
  } catch (err) {
    console.warn('[session-processor] maybeCompact falhou:', (err as Error).message)
  }

  return null
}

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Remove oldest never-accessed sources de um tipo se count excede limit.
 */
async function enforceSourceLimit(tipo: string, maxSources: number): Promise<void> {
  const count = await queryOne<{ total: number }>(
    `SELECT COUNT(*)::int AS total FROM knowledge_sources WHERE metadata::text LIKE $1`,
    `%"tipo":"${tipo}"%`,
  )

  if (!count || count.total <= maxSources) return

  const excess = count.total - maxSources
  // Remove oldest que nunca foram acessados (access_count = 0 em todos chunks)
  await execute(
    `DELETE FROM knowledge_sources WHERE id IN (
      SELECT ks.id FROM knowledge_sources ks
      LEFT JOIN knowledge_chunks kc ON kc.source_id = ks.id
      WHERE ks.metadata::text LIKE $1
      GROUP BY ks.id
      HAVING COALESCE(MAX(kc.access_count), 0) = 0
      ORDER BY ks.criada_em ASC
      LIMIT $2
    )`,
    `%"tipo":"${tipo}"%`,
    excess,
  )
}
