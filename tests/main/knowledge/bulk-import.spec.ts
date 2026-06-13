import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createJob, getJob, resetJobsForTests } from '../../../src/main/jobs'
import { execute, insertReturningId, queryOne } from '../../../src/main/db/query'

vi.mock('../../../src/main/db/query', () => {
  let idCounter = 0
  return {
    insertReturningId: vi.fn(async () => ++idCounter),
    execute: vi.fn(async () => ({ changes: 1 })),
    queryAll: vi.fn(async () => []),
    queryOne: vi.fn(async () => undefined),
    transaction: vi.fn(async (fn: () => Promise<unknown>) => fn()),
  }
})

vi.mock('../../../src/main/knowledge/embeddings', () => ({
  generatePassageEmbeddings: vi.fn(async (texts: string[]) => texts.map(() => null)),
  generatePassageEmbedding: vi.fn(async () => null),
}))

vi.mock('../../../src/main/knowledge/enrichment-config', () => ({
  getKnowledgeEnrichmentConfig: vi.fn(async () => ({
    auto_enrich_after_import: false,
    provider: 'local',
    modelo: 'gemma-4-e2b-it-q4',
    force_all_default: false,
  })),
  buildKnowledgeEnrichmentModel: vi.fn(async () => null),
}))

describe('bulk RAG import', () => {
  let tmpDir: string

  beforeEach(async () => {
    resetJobsForTests()
    vi.clearAllMocks()
    const { resetBulkRagImportRuntimeForTests } = await import('../../../src/main/knowledge/bulk-import')
    resetBulkRagImportRuntimeForTests()
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'flowkit-bulk-rag-'))
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  it('scans supported files recursively and skips generated folders', async () => {
    const { scanBulkImportPath } = await import('../../../src/main/knowledge/bulk-import')

    await writeFile(path.join(tmpDir, 'a.md'), 'Arquivo A com bastante texto para chunk.')
    await writeFile(path.join(tmpDir, 'codex-history.jsonl'), '{"type":"turn","text":"Historico Codex importavel"}\n')
    await mkdir(path.join(tmpDir, 'docs'))
    await writeFile(path.join(tmpDir, 'docs', 'b.txt'), 'Arquivo B com bastante texto para chunk.')
    await writeFile(path.join(tmpDir, 'image.png'), 'not imported')
    await mkdir(path.join(tmpDir, 'node_modules'))
    await writeFile(path.join(tmpDir, 'node_modules', 'ignored.md'), 'ignored')

    const result = await scanBulkImportPath(tmpDir)

    expect(result.root_path).toBe(tmpDir)
    expect(result.files.map((file) => path.relative(tmpDir, file))).toEqual(['a.md', 'codex-history.jsonl', path.join('docs', 'b.txt')])
    expect(result.skipped_files).toBe(1)
  })

  it('applies extension filters during scan', async () => {
    const { scanBulkImportPath } = await import('../../../src/main/knowledge/bulk-import')

    await writeFile(path.join(tmpDir, 'keep.md'), 'Markdown importavel.')
    await writeFile(path.join(tmpDir, 'skip.txt'), 'Texto que deve ser filtrado.')

    const result = await scanBulkImportPath(tmpDir, { filters: ['md'] })

    expect(result.files.map((file) => path.basename(file))).toEqual(['keep.md'])
    expect(result.skipped_entries.map((file) => path.basename(file.path))).toEqual(['skip.txt'])
  })


  it('imports all supported files under one group and finishes the job', async () => {
    const { runBulkRagImport } = await import('../../../src/main/knowledge/bulk-import')

    await writeFile(path.join(tmpDir, 'one.md'), 'Primeiro documento com texto suficiente para importacao.')
    await writeFile(path.join(tmpDir, 'two.txt'), 'Segundo documento com texto suficiente para importacao.')

    const job = createJob({ type: 'bulk_rag_import', label: 'Bulk test' })
    const summary = await runBulkRagImport({
      path: tmpDir,
      group_name: 'Grupo Teste',
      auto_enrich: false,
    }, job.id)

    expect(summary.group_name).toBe('Grupo Teste')
    expect(summary.scanned_files).toBe(2)
    expect(summary.imported_files).toBe(2)
    expect(summary.failed_files).toBe(0)
    expect(summary.chunks_count).toBeGreaterThan(0)

    const storedJob = getJob(job.id)
    expect(storedJob?.status).toBe('done')
    expect(storedJob?.progress.done).toBe(2)
    expect(storedJob?.metadata.group_name).toBe('Grupo Teste')
  })

  it('keeps import done when optional enrichment model is unavailable', async () => {
    const { runBulkRagImport } = await import('../../../src/main/knowledge/bulk-import')
    const enrichmentConfig = await import('../../../src/main/knowledge/enrichment-config')

    vi.mocked(enrichmentConfig.buildKnowledgeEnrichmentModel)
      .mockRejectedValueOnce(new Error('Modelo local indisponivel.'))

    await writeFile(path.join(tmpDir, 'codex-history.jsonl'), '{"type":"turn","text":"Historico Codex importavel"}\n')

    const job = createJob({ type: 'bulk_rag_import', label: 'Bulk test enrich' })
    const summary = await runBulkRagImport({
      path: tmpDir,
      group_name: 'Grupo Enrichment Opcional',
      auto_enrich: true,
    }, job.id)

    expect(summary.imported_files).toBe(1)

    const storedJob = getJob(job.id)
    expect(storedJob?.status).toBe('done')
    expect(storedJob?.metadata.phase).toBe('done')
    expect(storedJob?.metadata.enrichment_error).toBe('Modelo local indisponivel.')
  })

  it('controls the live AppJob when persistent RAG job actions are used', async () => {
    const {
      bindLiveBulkRagImportJob,
      cancelBulkRagImportJob,
      pauseBulkRagImportJob,
      resumeBulkRagImportJob,
    } = await import('../../../src/main/knowledge/bulk-import')

    const job = createJob({ type: 'bulk_rag_import', label: 'Bulk control' })
    bindLiveBulkRagImportJob(99, job.id)
    vi.mocked(queryOne).mockResolvedValue({
      id: 99,
      status: 'importing',
      recursive: true,
      total_bytes: 0,
      processed_bytes: 0,
    })

    const paused = await pauseBulkRagImportJob(99)
    expect(paused.live_job_id).toBe(job.id)
    expect(getJob(job.id)?.status).toBe('paused')

    const resumed = await resumeBulkRagImportJob(99)
    expect(resumed.live_job_id).toBe(job.id)
    expect(getJob(job.id)?.status).toBe('running')

    const cancelled = await cancelBulkRagImportJob(99)
    expect(cancelled.live_job_id).toBe(job.id)
    expect(getJob(job.id)?.status).toBe('cancelled')
  })

  it('rejects invalid persistent RAG job control transitions', async () => {
    const {
      cancelBulkRagImportJob,
      pauseBulkRagImportJob,
      resumeBulkRagImportJob,
    } = await import('../../../src/main/knowledge/bulk-import')

    vi.mocked(queryOne).mockResolvedValueOnce(undefined)
    await expect(cancelBulkRagImportJob(404)).rejects.toMatchObject({ statusCode: 404 })

    vi.mocked(queryOne).mockResolvedValueOnce({
      id: 10,
      status: 'done',
      recursive: true,
      total_bytes: 0,
      processed_bytes: 0,
    })
    await expect(resumeBulkRagImportJob(10)).rejects.toMatchObject({ statusCode: 409 })

    vi.mocked(queryOne).mockResolvedValueOnce({
      id: 11,
      status: 'importing',
      recursive: true,
      total_bytes: 0,
      processed_bytes: 0,
    })
    await expect(pauseBulkRagImportJob(11)).rejects.toMatchObject({ statusCode: 409 })
  })

  it('marks persistent import jobs failed and unbinds live jobs on unexpected failures', async () => {
    const {
      pauseBulkRagImportJob,
      runBulkRagImport,
    } = await import('../../../src/main/knowledge/bulk-import')

    await writeFile(path.join(tmpDir, 'one.md'), 'Documento importavel.')
    vi.mocked(insertReturningId)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(77)
      .mockRejectedValueOnce(new Error('persist file failed'))

    const job = createJob({ type: 'bulk_rag_import', label: 'Bulk failure' })

    await expect(runBulkRagImport({
      path: tmpDir,
      group_name: 'Grupo Falha',
      auto_enrich: false,
    }, job.id)).rejects.toThrow('persist file failed')

    expect(getJob(job.id)?.status).toBe('failed')
    expect(vi.mocked(execute).mock.calls.some((call) => (
      String(call[0]).includes('UPDATE knowledge_import_jobs')
      && call.includes('failed')
      && call.includes('persist file failed')
    ))).toBe(true)

    vi.mocked(queryOne).mockResolvedValueOnce({
      id: 77,
      status: 'importing',
      recursive: true,
      total_bytes: 0,
      processed_bytes: 0,
    })
    await expect(pauseBulkRagImportJob(77)).rejects.toMatchObject({ statusCode: 409 })
  })
})
