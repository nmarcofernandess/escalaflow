export type JobStatus = 'pending' | 'running' | 'done' | 'failed' | 'cancelled'

export interface AppJob {
  id: string
  type: string
  label: string
  status: JobStatus
  progress: {
    total: number
    done: number
  }
  metadata: Record<string, unknown>
  error_message: string | null
  created_at: string
  updated_at: string
  finished_at: string | null
}

const jobs = new Map<string, AppJob>()

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

export function cancelJob(id: string): AppJob {
  const job = jobs.get(id)
  if (!job) throw new Error(`Job "${id}" nao encontrado.`)
  const timestamp = nowIso()
  const next: AppJob = {
    ...job,
    status: 'cancelled',
    updated_at: timestamp,
    finished_at: timestamp,
  }
  jobs.set(id, next)
  return next
}

export function resetJobsForTests(): void {
  jobs.clear()
}
