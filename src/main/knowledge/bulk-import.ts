import path from 'node:path'
import { promises as fs } from 'node:fs'
import { cancelJob, createJob, failJob, finishJob, getJob, isJobCancelled, isJobPaused, pauseJob, resumeJob, updateJob } from '../jobs'
import { execute } from '../db/query'
import { ingestFromFile } from './ingest'
import {
  createKnowledgeGroup,
  createKnowledgeImportFile,
  createKnowledgeImportJob,
  getKnowledgeImportJob,
  updateKnowledgeImportFile,
  updateKnowledgeImportJob,
} from './bulk-persistence'
import { buildKnowledgeEnrichmentModel, getKnowledgeEnrichmentConfig } from './enrichment-config'
import { enrichAllChunksWithModel } from './enrichment'
import type {
  AppJob,
  BulkRagImportInput,
  BulkRagImportStartResult,
  BulkRagImportSummary,
  KnowledgeGroup,
  KnowledgeImportJob,
} from '../../shared/types'

const SUPPORTED_EXTENSIONS = new Set([
  '.md',
  '.markdown',
  '.txt',
  '.pdf',
  '.json',
  '.jsonl',
  '.zip',
  '.html',
  '.htm',
  '.csv',
])

const SKIP_DIRECTORIES = new Set([
  '.git',
  '.hg',
  '.svn',
  'node_modules',
  'dist',
  'out',
  '.vite',
  '.next',
  'Library',
  'Applications',
])

const liveImportJobsByPersistentId = new Map<number, string>()
const TERMINAL_IMPORT_STATUSES = new Set(['done', 'failed', 'cancelled'])

interface ScannedImportFile {
  path: string
  relative_path: string
  size_bytes: number
  mtime_ms: number
  mime_type: string | null
}

interface ScannedSkippedFile extends ScannedImportFile {
  reason: string
}

function nowIso(): string {
  return new Date().toISOString()
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function normalizeGroupName(input: string): string {
  const trimmed = input.trim()
  if (!trimmed) throw new Error('Nome do grupo é obrigatório.')
  return trimmed
}

function normalizeFilters(filters?: string[]): string[] {
  if (!filters?.length) return [...SUPPORTED_EXTENSIONS]
  const normalized = filters
    .map((filter) => filter.trim().toLowerCase())
    .filter(Boolean)
    .map((filter) => filter.startsWith('.') ? filter : `.${filter}`)
    .filter((filter) => SUPPORTED_EXTENSIONS.has(filter))
  return normalized.length > 0 ? [...new Set(normalized)] : [...SUPPORTED_EXTENSIONS]
}

function isTerminalImportStatus(status: string): boolean {
  return TERMINAL_IMPORT_STATUSES.has(status)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export class BulkRagImportControlError extends Error {
  constructor(message: string, public readonly statusCode: 404 | 409) {
    super(message)
  }
}

async function getControllableImportJob(importJobId: number, action: 'pause' | 'resume' | 'cancel'): Promise<{
  liveJobId: string | null
}> {
  const persistent = await getKnowledgeImportJob(importJobId)
  if (!persistent) {
    throw new BulkRagImportControlError(`RAG job "${importJobId}" nao encontrado.`, 404)
  }
  if (isTerminalImportStatus(persistent.status)) {
    throw new BulkRagImportControlError(`RAG job "${importJobId}" ja esta em estado terminal: ${persistent.status}.`, 409)
  }

  const liveJobId = liveImportJobsByPersistentId.get(importJobId) ?? null
  if ((action === 'pause' || action === 'resume') && !liveJobId) {
    throw new BulkRagImportControlError(`RAG job "${importJobId}" nao tem worker ativo para ${action}.`, 409)
  }

  return { liveJobId }
}

export function bindLiveBulkRagImportJob(importJobId: number, appJobId?: string): void {
  if (appJobId) liveImportJobsByPersistentId.set(importJobId, appJobId)
}

export function unbindLiveBulkRagImportJob(importJobId: number, appJobId?: string): void {
  if (!appJobId) return
  if (liveImportJobsByPersistentId.get(importJobId) === appJobId) {
    liveImportJobsByPersistentId.delete(importJobId)
  }
}

export function resetBulkRagImportRuntimeForTests(): void {
  liveImportJobsByPersistentId.clear()
}

function scanTotals(scan: {
  file_entries: ScannedImportFile[]
  skipped_entries: ScannedSkippedFile[]
}): { totalFiles: number; totalBytes: number } {
  const totalFiles = scan.file_entries.length + scan.skipped_entries.length
  const totalBytes = [...scan.file_entries, ...scan.skipped_entries]
    .reduce((sum, entry) => sum + entry.size_bytes, 0)
  return { totalFiles, totalBytes }
}

type PreparedBulkRagImport = {
  groupName: string
  recursive: boolean
  filters: string[]
  scan: Awaited<ReturnType<typeof scanBulkImportPath>>
  totalFiles: number
  totalBytes: number
  group: KnowledgeGroup
  importJob: KnowledgeImportJob
}

async function prepareBulkRagImport(
  input: BulkRagImportInput,
  preloaded?: {
    group: KnowledgeGroup
    importJob: KnowledgeImportJob
    scan: Awaited<ReturnType<typeof scanBulkImportPath>>
  },
): Promise<PreparedBulkRagImport> {
  const groupName = normalizeGroupName(input.group_name)
  const recursive = input.recursive ?? true
  const filters = normalizeFilters(input.filters)
  const scan = preloaded?.scan ?? await scanBulkImportPath(input.path, { recursive, filters })
  const { totalFiles, totalBytes } = scanTotals(scan)
  const group = preloaded?.group ?? await createKnowledgeGroup({
    nome: groupName,
    origem: 'usuario',
    metadata: {
      root_path: scan.root_path,
      recursive,
      filters,
      created_by: 'bulk_rag_import',
    },
  })
  const importJob = preloaded?.importJob ?? await createKnowledgeImportJob({
    group_id: group.id,
    root_path: scan.root_path,
    recursive,
    status: 'importing',
    total_files: totalFiles,
    total_bytes: totalBytes,
  })

  return {
    groupName,
    recursive,
    filters,
    scan,
    totalFiles,
    totalBytes,
    group,
    importJob,
  }
}

async function isImportCancelled(importJobId: number, appJobId?: string): Promise<boolean> {
  if (appJobId && isJobCancelled(appJobId)) return true
  const persistent = await getKnowledgeImportJob(importJobId)
  if (persistent?.status !== 'cancelled') return false
  if (appJobId && getJob(appJobId)?.status !== 'cancelled') cancelJob(appJobId)
  return true
}

async function waitWhileImportPaused(importJobId: number, appJobId?: string): Promise<void> {
  while (true) {
    const persistent = await getKnowledgeImportJob(importJobId)
    if (persistent?.status === 'cancelled' || (appJobId && isJobCancelled(appJobId))) return

    if (appJobId) {
      if (!isJobPaused(appJobId)) {
        if (persistent?.status === 'paused') {
          await updateKnowledgeImportJob(importJobId, { status: 'importing' })
        }
        return
      }
      await updateKnowledgeImportJob(importJobId, { status: 'paused' })
      await delay(500)
      continue
    }

    if (persistent?.status !== 'paused') return
    await delay(500)
  }
}

export async function pauseBulkRagImportJob(importJobId: number): Promise<{
  job: Awaited<ReturnType<typeof getKnowledgeImportJob>>
  live_job_id: string | null
}> {
  const { liveJobId } = await getControllableImportJob(importJobId, 'pause')
  if (liveJobId) pauseJob(liveJobId)
  await updateKnowledgeImportJob(importJobId, { status: 'paused' })
  return { job: await getKnowledgeImportJob(importJobId), live_job_id: liveJobId }
}

export async function resumeBulkRagImportJob(importJobId: number): Promise<{
  job: Awaited<ReturnType<typeof getKnowledgeImportJob>>
  live_job_id: string | null
}> {
  const { liveJobId } = await getControllableImportJob(importJobId, 'resume')
  if (liveJobId) resumeJob(liveJobId)
  await updateKnowledgeImportJob(importJobId, { status: 'importing' })
  return { job: await getKnowledgeImportJob(importJobId), live_job_id: liveJobId }
}

export async function cancelBulkRagImportJob(importJobId: number): Promise<{
  job: Awaited<ReturnType<typeof getKnowledgeImportJob>>
  live_job_id: string | null
}> {
  const { liveJobId } = await getControllableImportJob(importJobId, 'cancel')
  if (liveJobId) cancelJob(liveJobId)
  await updateKnowledgeImportJob(importJobId, { status: 'cancelled', finished: true })
  return { job: await getKnowledgeImportJob(importJobId), live_job_id: liveJobId }
}

function shouldImportFile(filePath: string, allowedExtensions = SUPPORTED_EXTENSIONS): boolean {
  return allowedExtensions.has(path.extname(filePath).toLowerCase())
}

function mimeForPath(filePath: string): string | null {
  const ext = path.extname(filePath).toLowerCase()
  if (ext === '.md' || ext === '.markdown') return 'text/markdown'
  if (ext === '.txt') return 'text/plain'
  if (ext === '.json') return 'application/json'
  if (ext === '.jsonl') return 'application/x-ndjson'
  if (ext === '.csv') return 'text/csv'
  if (ext === '.pdf') return 'application/pdf'
  if (ext === '.zip') return 'application/zip'
  if (ext === '.html' || ext === '.htm') return 'text/html'
  return null
}

function titleForFile(rootPath: string, filePath: string): string {
  const relative = path.relative(rootPath, filePath) || path.basename(filePath)
  return relative.replace(path.extname(relative), '').split(path.sep).join(' / ')
}

async function scannedEntry(rootPath: string, filePath: string): Promise<ScannedImportFile> {
  const stat = await fs.stat(filePath)
  return {
    path: filePath,
    relative_path: path.relative(rootPath, filePath) || path.basename(filePath),
    size_bytes: stat.size,
    mtime_ms: Math.floor(stat.mtimeMs),
    mime_type: mimeForPath(filePath),
  }
}

async function statPath(inputPath: string): Promise<{ resolvedPath: string; stat: Awaited<ReturnType<typeof fs.stat>> }> {
  const resolvedPath = path.resolve(inputPath)
  const stat = await fs.stat(resolvedPath)
  return { resolvedPath, stat }
}

async function walkDirectory(
  rootPath: string,
  dirPath: string,
  files: ScannedImportFile[],
  skipped: ScannedSkippedFile[],
  recursive: boolean,
  allowedExtensions: Set<string>,
): Promise<void> {
  const entries = await fs.readdir(dirPath, { withFileTypes: true })

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name)
    if (entry.isDirectory()) {
      if (SKIP_DIRECTORIES.has(entry.name)) continue
      if (!recursive) continue
      await walkDirectory(rootPath, fullPath, files, skipped, recursive, allowedExtensions)
      continue
    }

    if (!entry.isFile()) continue
    if (!shouldImportFile(fullPath, allowedExtensions)) {
      skipped.push({
        ...(await scannedEntry(rootPath, fullPath)),
        reason: 'Tipo de arquivo nao suportado.',
      })
      continue
    }
    files.push(await scannedEntry(rootPath, fullPath))
  }
}

export async function scanBulkImportPath(inputPath: string, options?: { recursive?: boolean; filters?: string[] }): Promise<{
  root_path: string
  files: string[]
  file_entries: ScannedImportFile[]
  skipped_files: number
  skipped_entries: ScannedSkippedFile[]
}> {
  const recursive = options?.recursive ?? true
  const allowedExtensions = new Set(normalizeFilters(options?.filters))
  const { resolvedPath, stat } = await statPath(inputPath)

  if (stat.isFile()) {
    const rootPath = path.dirname(resolvedPath)
    const entry = await scannedEntry(rootPath, resolvedPath)
    const supported = shouldImportFile(resolvedPath, allowedExtensions)
    return {
      root_path: rootPath,
      files: supported ? [resolvedPath] : [],
      file_entries: supported ? [entry] : [],
      skipped_files: supported ? 0 : 1,
      skipped_entries: supported ? [] : [{ ...entry, reason: 'Tipo de arquivo nao suportado.' }],
    }
  }

  if (!stat.isDirectory()) {
    throw new Error(`Caminho nao é arquivo nem pasta: ${resolvedPath}`)
  }

  const fileEntries: ScannedImportFile[] = []
  const skippedEntries: ScannedSkippedFile[] = []
  await walkDirectory(resolvedPath, resolvedPath, fileEntries, skippedEntries, recursive, allowedExtensions)
  fileEntries.sort((a, b) => a.path.localeCompare(b.path))
  skippedEntries.sort((a, b) => a.path.localeCompare(b.path))

  return {
    root_path: resolvedPath,
    files: fileEntries.map((entry) => entry.path),
    file_entries: fileEntries,
    skipped_files: skippedEntries.length,
    skipped_entries: skippedEntries,
  }
}

export async function startBulkRagImport(input: BulkRagImportInput): Promise<BulkRagImportStartResult> {
  const prepared = await prepareBulkRagImport(input)
  const job = createJob({
    type: 'bulk_rag_import',
    label: `Importar RAG: ${prepared.groupName}`,
    total: prepared.totalFiles,
    metadata: {
      path: input.path,
      group_name: prepared.groupName,
      auto_enrich: input.auto_enrich,
      group_id: prepared.group.id,
      import_job_id: prepared.importJob.id,
    },
  })
  bindLiveBulkRagImportJob(prepared.importJob.id, job.id)

  void runBulkRagImport({ ...input, group_name: prepared.groupName }, job.id, prepared).catch((error) => {
    if (getJob(job.id)?.status !== 'failed') failJob(job.id, error)
  })

  return { app_job: job, import_job: prepared.importJob }
}

export async function runBulkRagImport(
  input: BulkRagImportInput,
  jobId?: string,
  preloaded?: {
    group: KnowledgeGroup
    importJob: KnowledgeImportJob
    scan: Awaited<ReturnType<typeof scanBulkImportPath>>
  },
): Promise<BulkRagImportSummary> {
  const groupName = normalizeGroupName(input.group_name)

  if (jobId) {
    updateJob(jobId, {
      status: 'running',
      metadata: { group_name: groupName, phase: 'scanning' },
    })
  }

  const prepared = await prepareBulkRagImport(input, preloaded)
  const { scan, totalFiles, group, importJob } = prepared
  bindLiveBulkRagImportJob(importJob.id, jobId)

  const summary: BulkRagImportSummary = {
    group_id: group.id,
    import_job_id: importJob.id,
    group_name: groupName,
    root_path: scan.root_path,
    scanned_files: totalFiles,
    imported_files: 0,
    skipped_files: scan.skipped_files,
    failed_files: 0,
    chunks_count: 0,
    conversations_count: 0,
    errors: [],
  }

  try {

    if (jobId) {
      updateJob(jobId, {
        status: 'running',
        total: totalFiles,
        done: scan.skipped_entries.length,
        metadata: { ...summary, phase: 'importing' },
      })
    }

    await Promise.all(scan.skipped_entries.map((entry) => createKnowledgeImportFile({
      job_id: importJob.id,
      path: entry.path,
      relative_path: entry.relative_path,
      size_bytes: entry.size_bytes,
      mtime_ms: entry.mtime_ms,
      mime_type: entry.mime_type,
      status: 'skipped',
      error_message: entry.reason,
    })))

    const persistedFileIds = new Map<string, number>()
    for (const entry of scan.file_entries) {
      const persistedId = await createKnowledgeImportFile({
        job_id: importJob.id,
        path: entry.path,
        relative_path: entry.relative_path,
        size_bytes: entry.size_bytes,
        mtime_ms: entry.mtime_ms,
        mime_type: entry.mime_type,
        status: 'pending',
      })
      persistedFileIds.set(entry.path, persistedId)
    }

    let processedFiles = scan.skipped_entries.length
    let processedBytes = scan.skipped_entries.reduce((sum, entry) => sum + entry.size_bytes, 0)
    await updateKnowledgeImportJob(importJob.id, {
      processed_files: processedFiles,
      processed_bytes: processedBytes,
    })

    for (const entry of scan.file_entries) {
      const filePath = entry.path
      const persistedFileId = persistedFileIds.get(filePath)
      await waitWhileImportPaused(importJob.id, jobId)
      if (jobId && !isJobPaused(jobId) && !isJobCancelled(jobId)) {
        await updateKnowledgeImportJob(importJob.id, { status: 'importing' })
      }
      if (await isImportCancelled(importJob.id, jobId)) {
        if (jobId) updateJob(jobId, { metadata: { ...summary, phase: 'cancelled' } })
        await updateKnowledgeImportJob(importJob.id, { status: 'cancelled', finished: true })
        return summary
      }

      try {
        if (persistedFileId) await updateKnowledgeImportFile(persistedFileId, { status: 'reading' })
        const result = await ingestFromFile(filePath, titleForFile(scan.root_path, filePath), {
          group_id: group.id,
          bulk_group_id: String(group.id),
          bulk_group_name: groupName,
          bulk_root_path: scan.root_path,
          relative_path: entry.relative_path,
          imported_at: nowIso(),
        })

        if (!result.source_id || result.chunks_count <= 0) {
          if (result.source_id) {
            await execute('UPDATE knowledge_sources SET ativo = FALSE WHERE id = $1', result.source_id)
          }
          throw new Error(`Arquivo "${entry.relative_path}" nao gerou chunks pesquisaveis.`)
        }

        summary.imported_files++
        summary.chunks_count += result.chunks_count
        summary.conversations_count += result.conversations_count ?? 0
        if (persistedFileId) {
          await updateKnowledgeImportFile(persistedFileId, {
            source_id: result.source_id || null,
            status: 'done',
            error_message: null,
          })
        }
      } catch (error) {
        const message = errorMessage(error)
        summary.failed_files++
        summary.errors.push({
          path: filePath,
          message,
        })
        if (persistedFileId) {
          await updateKnowledgeImportFile(persistedFileId, {
            status: 'failed',
            error_message: message,
          })
        }
      } finally {
        processedFiles++
        processedBytes += entry.size_bytes
        await updateKnowledgeImportJob(importJob.id, {
          status: 'importing',
          processed_files: processedFiles,
          failed_files: summary.failed_files,
          processed_bytes: processedBytes,
          chunks_created: summary.chunks_count,
        })
        if (jobId) {
          updateJob(jobId, {
            done: processedFiles,
            metadata: { ...summary, phase: 'importing' },
          })
        }
      }
    }

    const config = await getKnowledgeEnrichmentConfig()
    const shouldEnrich = input.auto_enrich ?? config.auto_enrich_after_import
    let enrichmentError: string | null = null
    if (shouldEnrich && summary.imported_files > 0 && !(await isImportCancelled(importJob.id, jobId))) {
      if (jobId) updateJob(jobId, { metadata: { ...summary, phase: 'enriching' } })
      await updateKnowledgeImportJob(importJob.id, { status: 'enriching' })
      try {
        const model = await buildKnowledgeEnrichmentModel(config)
        if (!model) {
          enrichmentError = 'Nenhum modelo de enrichment disponivel.'
          if (jobId) updateJob(jobId, { metadata: { ...summary, phase: 'enrichment_skipped', enrichment_error: enrichmentError } })
        } else {
          const enrichment = await enrichAllChunksWithModel(model, { bulkGroupId: group.id })
          if (enrichment.batches_failed > 0) {
            enrichmentError = enrichment.chunks_enriquecidos === 0
              ? `Enrichment falhou em ${enrichment.batches_failed} batch(es).`
              : `Enrichment parcial: ${enrichment.batches_failed} batch(es) falharam.`
          }
          if (jobId) {
            updateJob(jobId, {
              metadata: {
                ...summary,
                phase: enrichmentError ? 'enrichment_partial' : 'enriched',
                enrichment,
              },
            })
          }
        }
      } catch (error) {
        enrichmentError = errorMessage(error)
        if (jobId) updateJob(jobId, { metadata: { ...summary, phase: 'enrichment_failed', enrichment_error: enrichmentError } })
      }
    }

    const cancelled = await isImportCancelled(importJob.id, jobId)
    const enrichmentFailure = shouldEnrich && enrichmentError
      ? `Importacao concluiu, mas enrichment falhou: ${enrichmentError}`
      : null
    if (jobId && !cancelled) {
      if (enrichmentFailure) {
        failJob(jobId, new Error(enrichmentFailure), {
          ...summary,
          phase: 'enrichment_failed',
          enrichment_error: enrichmentError,
        })
      } else {
        finishJob(jobId, {
          ...summary,
          phase: 'done',
        })
      }
    }
    await updateKnowledgeImportJob(importJob.id, {
      status: cancelled ? 'cancelled' : enrichmentFailure ? 'failed' : 'done',
      failed_files: summary.failed_files,
      chunks_created: summary.chunks_count,
      error_message: enrichmentFailure
        ? enrichmentFailure
        : summary.failed_files > 0
          ? `${summary.failed_files} arquivo(s) com erro; importacao concluida com avisos.`
          : null,
      finished: true,
    })

    return summary
  } catch (error) {
    const message = errorMessage(error)
    await updateKnowledgeImportJob(importJob.id, {
      status: 'failed',
      error_message: message,
      finished: true,
    })
    if (jobId) failJob(jobId, error, { ...summary, phase: 'failed' })
    throw error
  } finally {
    unbindLiveBulkRagImportJob(importJob.id, jobId)
  }
}
