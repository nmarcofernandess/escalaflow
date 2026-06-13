import type { AppJob, JobStatus } from '../shared/types'

const jobs = new Map<string, AppJob>()
const cancelHandlers = new Map<string, () => void>()

function isTerminalStatus(status: JobStatus): boolean {
  return status === 'done' || status === 'failed' || status === 'cancelled'
}

function nowIso(): string {
  return new Date().toISOString()
}

function nextJobId(): string {
  return `job_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

export function createJob(input: {
  type: string
  label: string
  metadata?: Record<string, unknown>
  total?: number
}): AppJob {
  const timestamp = nowIso()
  const job: AppJob = {
    id: nextJobId(),
    type: input.type,
    label: input.label,
    status: 'pending',
    progress: {
      total: input.total ?? 0,
      done: 0,
    },
    metadata: input.metadata ?? {},
    error_message: null,
    created_at: timestamp,
    updated_at: timestamp,
    finished_at: null,
  }
  jobs.set(job.id, job)
  return job
}

export function listJobs(): AppJob[] {
  return [...jobs.values()].sort((a, b) => b.created_at.localeCompare(a.created_at))
}

export function getJob(id: string): AppJob | null {
  return jobs.get(id) ?? null
}

export function updateJob(id: string, patch: {
  status?: JobStatus
  done?: number
  total?: number
  metadata?: Record<string, unknown>
  error_message?: string | null
}): AppJob {
  const job = jobs.get(id)
  if (!job) throw new Error(`Job "${id}" nao encontrado.`)
  const currentIsTerminal = isTerminalStatus(job.status)
  const nextStatus = currentIsTerminal && patch.status && patch.status !== job.status
    ? job.status
    : (patch.status ?? job.status)

  const next: AppJob = {
    ...job,
    status: nextStatus,
    progress: {
      total: patch.total ?? job.progress.total,
      done: patch.done ?? job.progress.done,
    },
    metadata: {
      ...job.metadata,
      ...(patch.metadata ?? {}),
    },
    error_message: patch.error_message !== undefined ? patch.error_message : job.error_message,
    updated_at: nowIso(),
  }
  jobs.set(id, next)
  return next
}

export function finishJob(id: string, metadata?: Record<string, unknown>): AppJob {
  const current = getJob(id)
  if (current && isTerminalStatus(current.status)) return current

  const job = updateJob(id, {
    status: 'done',
    done: getJob(id)?.progress.total,
    metadata,
    error_message: null,
  })
  const next: AppJob = {
    ...job,
    finished_at: nowIso(),
    updated_at: nowIso(),
  }
  jobs.set(id, next)
  return next
}

export function failJob(id: string, error: unknown, metadata?: Record<string, unknown>): AppJob {
  const current = getJob(id)
  if (current && isTerminalStatus(current.status)) return current

  const message = error instanceof Error ? error.message : String(error)
  const job = updateJob(id, {
    status: 'failed',
    metadata,
    error_message: message,
  })
  const next: AppJob = {
    ...job,
    finished_at: nowIso(),
    updated_at: nowIso(),
  }
  jobs.set(id, next)
  return next
}

export function cancelJob(id: string): AppJob {
  const job = jobs.get(id)
  if (!job) throw new Error(`Job "${id}" nao encontrado.`)
  if (isTerminalStatus(job.status)) return job

  const timestamp = nowIso()
  const next: AppJob = {
    ...job,
    status: 'cancelled',
    updated_at: timestamp,
    finished_at: timestamp,
  }
  jobs.set(id, next)
  cancelHandlers.get(id)?.()
  return next
}

export function registerJobCancelHandler(id: string, handler: () => void): () => void {
  if (!jobs.has(id)) throw new Error(`Job "${id}" nao encontrado.`)
  cancelHandlers.set(id, handler)
  return () => {
    if (cancelHandlers.get(id) === handler) cancelHandlers.delete(id)
  }
}

export function pauseJob(id: string): AppJob {
  const job = jobs.get(id)
  if (!job) throw new Error(`Job "${id}" nao encontrado.`)
  if (job.status === 'done' || job.status === 'failed' || job.status === 'cancelled') return job
  const next: AppJob = {
    ...job,
    status: 'paused',
    updated_at: nowIso(),
  }
  jobs.set(id, next)
  return next
}

export function resumeJob(id: string): AppJob {
  const job = jobs.get(id)
  if (!job) throw new Error(`Job "${id}" nao encontrado.`)
  if (job.status !== 'paused') return job
  const next: AppJob = {
    ...job,
    status: 'running',
    updated_at: nowIso(),
  }
  jobs.set(id, next)
  return next
}

export function isJobCancelled(id: string): boolean {
  return jobs.get(id)?.status === 'cancelled'
}

export function isJobPaused(id: string): boolean {
  return jobs.get(id)?.status === 'paused'
}

export function resetJobsForTests(): void {
  jobs.clear()
  cancelHandlers.clear()
}
