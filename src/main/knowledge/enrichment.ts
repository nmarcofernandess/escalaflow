import { generateObject } from 'ai'
import { z } from 'zod'
import { queryAll, execute, queryOne, insertReturningId } from '../db/query'
import { generatePassageEmbedding } from './embeddings'

// =============================================================================
// SCHEMA — o que o LLM retorna pra cada chunk no batch
// =============================================================================

const ChunkEnrichmentSchema = z.object({
  chunks: z.array(z.object({
    index: z.number().describe('Índice do chunk no batch (0-based)'),
    resumo: z.string().describe('Resumo em 1 frase clara do conteúdo do chunk'),
    tags: z.array(z.string()).describe('5-10 conceitos-chave incluindo sinônimos em português'),
    entidades: z.array(z.object({
      nome: z.string().describe('Nome canônico da entidade'),
      tipo: z.string().describe('Tipo: pessoa, contrato, setor, regra, feriado, funcao, conceito, legislacao'),
    })),
    relacoes: z.array(z.object({
      from: z.string().describe('Nome da entidade de origem'),
      to: z.string().describe('Nome da entidade de destino'),
      tipo_relacao: z.string().describe('Ex: trabalha_em, regido_por, depende_de, aplica_se_a, exige, proibe'),
      peso: z.number().min(0).max(1).describe('1.0 = explícita, 0.5 = inferida'),
    })),
  })),
})

type ChunkEnrichmentResult = z.infer<typeof ChunkEnrichmentSchema>

// =============================================================================
// CONFIG
// =============================================================================

const BATCH_SIZE = 10
const TIMEOUT_MS = 60_000 // 60s per batch (10 chunks)

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
// PROMPT — batch enrichment
// =============================================================================

function buildBatchPrompt(
  chunks: Array<{ id: number; conteudo: string }>,
  sourceTitulo: string,
  sourceTipo: string,
  existingEntityNames: string[],
): string {
  const entityContext = existingEntityNames.length > 0
    ? `\nENTIDADES JÁ EXISTENTES NO GRAPH (use nomes canônicos quando possível):\n${existingEntityNames.join(', ')}\n`
    : ''

  const chunkBlocks = chunks.map((c, i) =>
    `=== CHUNK ${i} (id: ${c.id}) ===\n${c.conteudo}`
  ).join('\n\n')

  return `Você é um especialista em indexação de conhecimento para RH de supermercado.

SOURCE: "${sourceTitulo}" (tipo: ${sourceTipo})
${entityContext}
Para CADA chunk abaixo, extraia:
1. **resumo**: 1 frase clara e descritiva do conteúdo
2. **tags**: 5-10 conceitos-chave em português, incluindo SINÔNIMOS e termos alternativos que alguém poderia usar para buscar este conteúdo (ex: se fala de "interjornada", inclua também "descanso entre jornadas", "folga entre turnos", "intervalo entre jornadas")
3. **entidades**: entidades mencionadas (nome canônico + tipo)
4. **relacoes**: relações explícitas entre entidades

REGRAS:
- Tags devem ser AMPLAS e inclusivas — pense em como diferentes pessoas buscariam este conteúdo
- Use nomes canônicos já existentes quando possível (veja lista acima)
- Não invente relações que não estão no texto
- peso 1.0 = explícita no texto, 0.5 = inferida pelo contexto

${chunkBlocks}`
}

// =============================================================================
// ENRICH BATCH — 1 LLM call pra N chunks
// =============================================================================

async function enrichBatch(
  chunks: Array<{ id: number; conteudo: string }>,
  sourceTitulo: string,
  sourceTipo: string,
  existingEntityNames: string[],
  createModel: (modelo: string) => any,
  modelo: string,
): Promise<ChunkEnrichmentResult> {
  try {
    const prompt = buildBatchPrompt(chunks, sourceTitulo, sourceTipo, existingEntityNames)
    console.log(`[enrichment]   → chamando LLM (${modelo}) com ${prompt.length} chars...`)
    const { object } = await withTimeout(
      generateObject({
        model: createModel(modelo),
        schema: ChunkEnrichmentSchema,
        prompt,
      }),
      TIMEOUT_MS,
      `enrichBatch ${chunks.length} chunks`,
    )
    console.log(`[enrichment]   ✓ LLM retornou ${object.chunks.length} chunks enriquecidos`)
    return object
  } catch (err) {
    console.error(`[enrichment]   ✗ Batch FALHOU (${chunks.length} chunks):`, (err as Error).message)
    return { chunks: [] }
  }
}

// =============================================================================
// APPLY — atualiza chunk no DB + re-embed + graph
// =============================================================================

async function applyEnrichmentToChunk(
  chunkId: number,
  original: string,
  enrichment: ChunkEnrichmentResult['chunks'][0],
): Promise<void> {
  // 1. Construir texto enriquecido pra embedding
  const tagsStr = enrichment.tags.join(', ')
  const enrichedText = `[Resumo: ${enrichment.resumo}]\n[Tags: ${tagsStr}]\n\n${original}`

  // 2. Metadata do enrichment (pra display no inspector)
  const enrichmentData = JSON.stringify({
    resumo: enrichment.resumo,
    tags: enrichment.tags,
    entidades: enrichment.entidades.length,
    relacoes: enrichment.relacoes.length,
  })

  // 3. Gerar novo embedding do texto enriquecido
  const embedding = await generatePassageEmbedding(enrichedText)
  const embeddingJson = embedding ? JSON.stringify(embedding) : null

  // 4. Atualizar chunk: embedding + search_tsv + enrichment_json + enriched_at
  if (embeddingJson) {
    await execute(
      `UPDATE knowledge_chunks
       SET embedding = $1::vector,
           search_tsv = to_tsvector('portuguese', $2),
           enrichment_json = $3,
           enriched_at = NOW()
       WHERE id = $4`,
      embeddingJson,
      enrichedText,
      enrichmentData,
      chunkId,
    )
  } else {
    await execute(
      `UPDATE knowledge_chunks
       SET search_tsv = to_tsvector('portuguese', $1),
           enrichment_json = $2,
           enriched_at = NOW()
       WHERE id = $3`,
      enrichedText,
      enrichmentData,
      chunkId,
    )
  }
}

async function persistEnrichmentGraph(
  allEntities: Array<{ nome: string; tipo: string }>,
  allRelations: Array<{ from: string; to: string; tipo_relacao: string; peso: number }>,
  origem: 'sistema' | 'usuario',
): Promise<{ entities_count: number; relations_count: number }> {
  // Dedup entities
  const entityMap = new Map<string, { nome: string; tipo: string }>()
  for (const e of allEntities) {
    const key = `${e.nome.toLowerCase()}::${e.tipo.toLowerCase()}`
    if (!entityMap.has(key)) entityMap.set(key, { nome: e.nome, tipo: e.tipo.toLowerCase() })
  }

  // Dedup relations
  const relationMap = new Map<string, { from: string; to: string; tipo_relacao: string; peso: number }>()
  for (const r of allRelations) {
    const key = `${r.from.toLowerCase()}::${r.to.toLowerCase()}::${r.tipo_relacao.toLowerCase()}`
    const existing = relationMap.get(key)
    if (!existing || r.peso > existing.peso) {
      relationMap.set(key, { from: r.from, to: r.to, tipo_relacao: r.tipo_relacao.toLowerCase(), peso: r.peso })
    }
  }

  // Persist entities with embeddings
  const entityIdMap = new Map<string, number>()
  for (const e of entityMap.values()) {
    const embedding = await generatePassageEmbedding(e.nome)
    const embeddingJson = embedding ? JSON.stringify(embedding) : null

    let id: number | undefined
    if (embeddingJson) {
      id = await insertReturningId(
        `INSERT INTO knowledge_entities (nome, tipo, embedding, origem)
         VALUES ($1, $2, $3::vector, $4)
         ON CONFLICT (nome, tipo) DO UPDATE SET embedding = EXCLUDED.embedding
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
      if (!id) {
        const existing = await queryOne<{ id: number }>(
          'SELECT id FROM knowledge_entities WHERE nome = $1 AND tipo = $2', e.nome, e.tipo,
        )
        if (existing) id = existing.id
      }
    }
    if (id) entityIdMap.set(e.nome.toLowerCase(), id)
  }

  // Persist relations
  let relationsInserted = 0
  for (const r of relationMap.values()) {
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
      // duplicate or FK error — skip
    }
  }

  return { entities_count: entityIdMap.size, relations_count: relationsInserted }
}

// =============================================================================
// MAIN — enrichAllChunks
// =============================================================================

export interface EnrichmentProgress {
  fase: 'carregando' | 'enriquecendo' | 'aplicando' | 'graph' | 'concluido'
  batch_atual?: number
  total_batches?: number
  chunks_enriquecidos?: number
  entities_count?: number
  relations_count?: number
}

export interface EnrichmentOptions {
  /** Filtro por tipo de source: 'sistema', 'manual', 'importacao_usuario', etc. Se omitido, processa todos. */
  sourceTipo?: string
  /** Se true, re-enriquece chunks já enriquecidos. Default: false (só processa novos). */
  forceAll?: boolean
}

export async function enrichAllChunks(
  createModel: (modelo: string) => any,
  modelo: string,
  options?: EnrichmentOptions,
  onProgress?: (p: EnrichmentProgress) => void,
): Promise<{
  chunks_enriquecidos: number
  entities_count: number
  relations_count: number
  batches_processados: number
  batches_failed: number
}> {
  onProgress?.({ fase: 'carregando' })

  // 1. Carregar chunks agrupados por source
  const tipoFilter = options?.sourceTipo ? `AND ks.tipo = '${options.sourceTipo}'` : ''
  const enrichedFilter = options?.forceAll ? '' : 'AND kc.enriched_at IS NULL'

  const chunks = await queryAll<{
    chunk_id: number
    conteudo: string
    source_id: number
    source_titulo: string
    source_tipo: string
  }>(`
    SELECT kc.id AS chunk_id, kc.conteudo, ks.id AS source_id, ks.titulo AS source_titulo, ks.tipo AS source_tipo
    FROM knowledge_chunks kc
    JOIN knowledge_sources ks ON ks.id = kc.source_id AND ks.ativo = true
    WHERE length(kc.conteudo) > 50
      ${tipoFilter}
      ${enrichedFilter}
    ORDER BY ks.tipo, ks.id, kc.id
  `)

  if (chunks.length === 0) {
    onProgress?.({ fase: 'concluido', chunks_enriquecidos: 0, entities_count: 0, relations_count: 0 })
    return { chunks_enriquecidos: 0, entities_count: 0, relations_count: 0, batches_processados: 0, batches_failed: 0 }
  }

  // 2. Carregar entidades existentes pra contexto do LLM
  const existingEntities = await queryAll<{ nome: string }>(
    `SELECT DISTINCT nome FROM knowledge_entities WHERE valid_to IS NULL OR valid_to > NOW()`
  )
  const existingEntityNames = existingEntities.map(e => e.nome)

  // 3. Agrupar por source pra manter contexto sequencial
  const sourceGroups = new Map<number, typeof chunks>()
  for (const c of chunks) {
    const group = sourceGroups.get(c.source_id) ?? []
    group.push(c)
    sourceGroups.set(c.source_id, group)
  }

  // 4. Criar batches de ~BATCH_SIZE, respeitando fronteiras de source
  const batches: Array<{
    chunks: Array<{ id: number; conteudo: string }>
    sourceTitulo: string
    sourceTipo: string
  }> = []

  for (const [, group] of sourceGroups) {
    for (let i = 0; i < group.length; i += BATCH_SIZE) {
      const slice = group.slice(i, i + BATCH_SIZE)
      batches.push({
        chunks: slice.map(c => ({ id: c.chunk_id, conteudo: c.conteudo })),
        sourceTitulo: slice[0].source_titulo,
        sourceTipo: slice[0].source_tipo,
      })
    }
  }

  console.log(`[enrichment] ══════════════════════════════════════════════`)
  console.log(`[enrichment] INICIO: ${chunks.length} chunks em ${batches.length} batches (${sourceGroups.size} sources)`)
  console.log(`[enrichment] Modelo: ${modelo}`)
  console.log(`[enrichment] Entidades existentes no graph: ${existingEntityNames.length}`)
  console.log(`[enrichment] ══════════════════════════════════════════════`)

  // 5. Processar batches
  let totalEnriched = 0
  let batchesFailed = 0
  const allEntities: Array<{ nome: string; tipo: string }> = []
  const allRelations: Array<{ from: string; to: string; tipo_relacao: string; peso: number }> = []

  for (let b = 0; b < batches.length; b++) {
    const batch = batches[b]
    console.log(`[enrichment] batch ${b + 1}/${batches.length} (${batch.chunks.length} chunks de "${batch.sourceTitulo}")`)
    onProgress?.({ fase: 'enriquecendo', batch_atual: b + 1, total_batches: batches.length })

    const result = await enrichBatch(
      batch.chunks,
      batch.sourceTitulo,
      batch.sourceTipo,
      existingEntityNames,
      createModel,
      modelo,
    )

    if (result.chunks.length === 0) {
      batchesFailed++
      console.warn(`[enrichment]   ⚠ batch ${b + 1} retornou 0 chunks (falha LLM ou timeout)`)
      continue
    }

    // 6. Aplicar enriquecimento chunk a chunk
    onProgress?.({ fase: 'aplicando', batch_atual: b + 1, total_batches: batches.length })

    for (const enriched of result.chunks) {
      const originalChunk = batch.chunks[enriched.index]
      if (!originalChunk) continue

      await applyEnrichmentToChunk(originalChunk.id, originalChunk.conteudo, enriched)
      totalEnriched++

      // Acumular graph data
      allEntities.push(...enriched.entidades)
      allRelations.push(...enriched.relacoes)

      // Adicionar novas entidades ao contexto pra próximos batches
      for (const e of enriched.entidades) {
        if (!existingEntityNames.includes(e.nome)) {
          existingEntityNames.push(e.nome)
        }
      }
    }
  }

  // 7. Persistir graph acumulado
  onProgress?.({ fase: 'graph' })
  console.log(`[enrichment] persistindo graph: ${allEntities.length} entidades, ${allRelations.length} relações`)

  // Determinar origem do graph pelo tipo mais comum
  const origem = batches[0]?.sourceTipo === 'sistema' ? 'sistema' as const : 'usuario' as const
  const graphResult = allEntities.length > 0
    ? await persistEnrichmentGraph(allEntities, allRelations, origem)
    : { entities_count: 0, relations_count: 0 }

  onProgress?.({
    fase: 'concluido',
    chunks_enriquecidos: totalEnriched,
    entities_count: graphResult.entities_count,
    relations_count: graphResult.relations_count,
  })

  console.log(`[enrichment] ══════════════════════════════════════════════`)
  console.log(`[enrichment] CONCLUIDO: ${totalEnriched} chunks enriquecidos, ${batchesFailed} batches falharam`)
  console.log(`[enrichment] Graph: ${graphResult.entities_count} entidades, ${graphResult.relations_count} relações`)
  console.log(`[enrichment] ══════════════════════════════════════════════`)

  return {
    chunks_enriquecidos: totalEnriched,
    entities_count: graphResult.entities_count,
    relations_count: graphResult.relations_count,
    batches_processados: batches.length,
    batches_failed: batchesFailed,
  }
}
