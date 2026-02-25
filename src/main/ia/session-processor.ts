import { generateObject } from 'ai'
import { z } from 'zod'
import { generateQueryEmbedding } from '../knowledge/embeddings'
import { queryOne, queryAll, execute, insertReturningId } from '../db/query'
import type { IaMensagem } from '../../shared/types'

// =============================================================================
// CONSTANTS
// =============================================================================

const COMPACTION_TOKEN_THRESHOLD = 30_000
const COMPACTION_KEEP_RECENT = 10
const DEDUP_COSINE_THRESHOLD = 0.85
const TRANSCRIPT_MAX_CHARS = 8000
const IA_MEMORIAS_AUTO_LIMIT = 50

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
// SMART EXTRACTION (PAGO — 1 LLM call) → ia_memorias
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
 * Salva em ia_memorias (com origem='auto') em vez de knowledge_sources.
 * Dedup por cosine similarity > 0.85 contra ia_memorias.embedding.
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
    if (item.importance === 'low') continue

    const embedding = await generateQueryEmbedding(item.summary)

    if (embedding) {
      const embeddingStr = `[${embedding.join(',')}]`

      // Dedup: busca memória similar em ia_memorias
      const similar = await queryOne<{ id: number; score: number }>(
        `SELECT id,
                1 - (embedding <=> $1::vector) AS score
         FROM ia_memorias
         WHERE embedding IS NOT NULL
         ORDER BY embedding <=> $1::vector
         LIMIT 1`,
        embeddingStr,
      )

      if (similar && similar.score > DEDUP_COSINE_THRESHOLD) {
        // Atualiza memória existente com conteúdo mais recente
        await execute(
          'UPDATE ia_memorias SET conteudo = $1, embedding = $2::vector, atualizada_em = NOW() WHERE id = $3',
          item.summary,
          embeddingStr,
          similar.id,
        )
        continue
      }

      // Evict: se total > limite, deleta o auto mais antigo
      const countRow = await queryOne<{ c: number }>(
        `SELECT COUNT(*)::int as c FROM ia_memorias`,
      )
      if ((countRow?.c ?? 0) >= IA_MEMORIAS_AUTO_LIMIT) {
        await execute(
          `DELETE FROM ia_memorias WHERE id = (
            SELECT id FROM ia_memorias WHERE origem = 'auto'
            ORDER BY atualizada_em ASC LIMIT 1
          )`,
        )
      }

      // Insert nova memória auto
      await insertReturningId(
        `INSERT INTO ia_memorias (conteudo, origem, embedding) VALUES ($1, 'auto', $2::vector)`,
        item.summary,
        embeddingStr,
      )
    } else {
      // Sem embedding disponível — insert sem dedup
      const countRow = await queryOne<{ c: number }>(
        `SELECT COUNT(*)::int as c FROM ia_memorias`,
      )
      if ((countRow?.c ?? 0) >= IA_MEMORIAS_AUTO_LIMIT) {
        await execute(
          `DELETE FROM ia_memorias WHERE id = (
            SELECT id FROM ia_memorias WHERE origem = 'auto'
            ORDER BY atualizada_em ASC LIMIT 1
          )`,
        )
      }
      await insertReturningId(
        `INSERT INTO ia_memorias (conteudo, origem) VALUES ($1, 'auto')`,
        item.summary,
      )
    }
  }
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
    const { generateText } = await import('ai')
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
