import { execute, insertReturningId, queryAll, queryOne } from '../db/query'
import type {
  KnowledgeGroup,
  KnowledgeImportFile,
  KnowledgeImportFileStatus,
  KnowledgeImportJob,
  KnowledgeImportJobStatus,
} from '../../shared/types'

function jsonb(value: unknown): string {
  return JSON.stringify(value ?? {})
}

function nowIso(): string {
  return new Date().toISOString()
}

function asBool(value: unknown): boolean {
  return value === true || value === 'true' || value === 1
}

function normalizeGroup(row: KnowledgeGroup & { metadata: unknown }): KnowledgeGroup {
  return {
    ...row,
    metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : (row.metadata as Record<string, unknown> ?? {}),
  }
}

function normalizeJob(row: KnowledgeImportJob): KnowledgeImportJob {
  return {
    ...row,
    recursive: asBool(row.recursive),
    total_bytes: Number(row.total_bytes ?? 0),
    processed_bytes: Number(row.processed_bytes ?? 0),
  }
}

export async function createKnowledgeGroup(input: {
  nome: string
  descricao?: string | null
  origem?: string
  metadata?: Record<string, unknown>
}): Promise<KnowledgeGroup> {
  const timestamp = nowIso()
  const id = await insertReturningId(
    `INSERT INTO knowledge_groups (nome, descricao, origem, metadata)
     VALUES ($1, $2, $3, $4::jsonb)`,
    input.nome,
    input.descricao ?? null,
    input.origem ?? 'usuario',
    jsonb(input.metadata),
  )
  return {
    id,
    nome: input.nome,
    descricao: input.descricao ?? null,
    origem: input.origem ?? 'usuario',
    metadata: input.metadata ?? {},
    criada_em: timestamp,
    atualizada_em: timestamp,
  }
}

export async function getKnowledgeGroup(id: number): Promise<KnowledgeGroup | null> {
  const row = await queryOne<KnowledgeGroup & { metadata: unknown }>(
    `SELECT id, nome, descricao, origem, metadata, criada_em::text, atualizada_em::text
       FROM knowledge_groups
      WHERE id = $1`,
    id,
  )
  return row ? normalizeGroup(row) : null
}

export async function createKnowledgeImportJob(input: {
  group_id: number
  root_path: string
  recursive: boolean
  status?: KnowledgeImportJobStatus
  total_files?: number
  total_bytes?: number
}): Promise<KnowledgeImportJob> {
  const timestamp = nowIso()
  const id = await insertReturningId(
    `INSERT INTO knowledge_import_jobs
       (group_id, root_path, recursive, status, total_files, total_bytes, started_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
    input.group_id,
    input.root_path,
    input.recursive,
    input.status ?? 'pending',
    input.total_files ?? 0,
    input.total_bytes ?? 0,
  )
  return {
    id,
    group_id: input.group_id,
    root_path: input.root_path,
    recursive: input.recursive,
    status: input.status ?? 'pending',
    total_files: input.total_files ?? 0,
    processed_files: 0,
    failed_files: 0,
    total_bytes: input.total_bytes ?? 0,
    processed_bytes: 0,
    chunks_created: 0,
    error_message: null,
    started_at: timestamp,
    finished_at: null,
  }
}

export async function getKnowledgeImportJob(id: number): Promise<KnowledgeImportJob | null> {
  const row = await queryOne<KnowledgeImportJob>(
    `SELECT id, group_id, root_path, recursive, status, total_files, processed_files,
            failed_files, total_bytes, processed_bytes, chunks_created, error_message,
            started_at::text, finished_at::text
       FROM knowledge_import_jobs
      WHERE id = $1`,
    id,
  )
  return row ? normalizeJob(row) : null
}

export async function listKnowledgeImportJobs(limit = 50): Promise<KnowledgeImportJob[]> {
  const rows = await queryAll<KnowledgeImportJob>(
    `SELECT id, group_id, root_path, recursive, status, total_files, processed_files,
            failed_files, total_bytes, processed_bytes, chunks_created, error_message,
            started_at::text, finished_at::text
       FROM knowledge_import_jobs
      ORDER BY COALESCE(started_at, NOW()) DESC, id DESC
      LIMIT $1`,
    limit,
  )
  return rows.map(normalizeJob)
}

export async function updateKnowledgeImportJob(
  id: number,
  patch: {
    status?: KnowledgeImportJobStatus
    total_files?: number
    processed_files?: number
    failed_files?: number
    total_bytes?: number
    processed_bytes?: number
    chunks_created?: number
    error_message?: string | null
    finished?: boolean
  },
): Promise<void> {
  const sets: string[] = []
  const params: unknown[] = []

  function set(column: string, value: unknown): void {
    params.push(value)
    sets.push(`${column} = $${params.length}`)
  }

  if (patch.status !== undefined) set('status', patch.status)
  if (patch.total_files !== undefined) set('total_files', patch.total_files)
  if (patch.processed_files !== undefined) set('processed_files', patch.processed_files)
  if (patch.failed_files !== undefined) set('failed_files', patch.failed_files)
  if (patch.total_bytes !== undefined) set('total_bytes', patch.total_bytes)
  if (patch.processed_bytes !== undefined) set('processed_bytes', patch.processed_bytes)
  if (patch.chunks_created !== undefined) set('chunks_created', patch.chunks_created)
  if (patch.error_message !== undefined) set('error_message', patch.error_message)
  if (patch.finished) sets.push('finished_at = NOW()')

  if (sets.length === 0) return
  params.push(id)
  await execute(`UPDATE knowledge_import_jobs SET ${sets.join(', ')} WHERE id = $${params.length}`, ...params)
}

export async function createKnowledgeImportFile(input: {
  job_id: number
  path: string
  relative_path: string
  size_bytes: number
  mtime_ms: number
  mime_type?: string | null
  status?: KnowledgeImportFileStatus
  error_message?: string | null
}): Promise<number> {
  return await insertReturningId(
    `INSERT INTO knowledge_import_files
       (job_id, path, relative_path, size_bytes, mtime_ms, mime_type, status, error_message)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    input.job_id,
    input.path,
    input.relative_path,
    input.size_bytes,
    input.mtime_ms,
    input.mime_type ?? null,
    input.status ?? 'pending',
    input.error_message ?? null,
  )
}

export async function updateKnowledgeImportFile(
  id: number,
  patch: {
    source_id?: number | null
    sha256?: string | null
    status?: KnowledgeImportFileStatus
    error_message?: string | null
  },
): Promise<void> {
  const sets: string[] = []
  const params: unknown[] = []

  function set(column: string, value: unknown): void {
    params.push(value)
    sets.push(`${column} = $${params.length}`)
  }

  if (patch.source_id !== undefined) set('source_id', patch.source_id)
  if (patch.sha256 !== undefined) set('sha256', patch.sha256)
  if (patch.status !== undefined) set('status', patch.status)
  if (patch.error_message !== undefined) set('error_message', patch.error_message)

  if (sets.length === 0) return
  params.push(id)
  await execute(`UPDATE knowledge_import_files SET ${sets.join(', ')} WHERE id = $${params.length}`, ...params)
}

export async function listKnowledgeImportFiles(jobId: number): Promise<KnowledgeImportFile[]> {
  return await queryAll<KnowledgeImportFile>(
    `SELECT id, job_id, source_id, path, relative_path, size_bytes, mtime_ms,
            sha256, mime_type, status, error_message
       FROM knowledge_import_files
      WHERE job_id = $1
      ORDER BY id ASC`,
    jobId,
  )
}
