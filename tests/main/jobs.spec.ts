import { describe, expect, it } from 'vitest'
import {
  cancelJob,
  createJob,
  failJob,
  finishJob,
  getJob,
  isJobCancelled,
  isJobPaused,
  listJobs,
  pauseJob,
  registerJobCancelHandler,
  resetJobsForTests,
  resumeJob,
  updateJob,
} from '../../src/main/jobs'

describe('jobs registry', () => {
  it('creates, lists, reads, and cancels jobs', () => {
    resetJobsForTests()

    const job = createJob({
      type: 'test',
      label: 'Contract test',
      metadata: { source: 'vitest' },
    })

    expect(job.id).toMatch(/^job_/)
    expect(job.status).toBe('pending')
    expect(listJobs()).toHaveLength(1)
    expect(getJob(job.id)?.label).toBe('Contract test')

    const running = updateJob(job.id, {
      status: 'running',
      total: 4,
      done: 1,
      metadata: { phase: 'scan' },
    })
    expect(running.status).toBe('running')
    expect(running.progress).toEqual({ total: 4, done: 1 })
    expect(running.metadata.phase).toBe('scan')
    expect(isJobCancelled(job.id)).toBe(false)

    const paused = pauseJob(job.id)
    expect(paused.status).toBe('paused')
    expect(isJobPaused(job.id)).toBe(true)

    const resumed = resumeJob(job.id)
    expect(resumed.status).toBe('running')
    expect(isJobPaused(job.id)).toBe(false)

    const cancelled = cancelJob(job.id)

    expect(cancelled.status).toBe('cancelled')
    expect(cancelled.finished_at).toEqual(expect.any(String))
    expect(isJobCancelled(job.id)).toBe(true)
  })

  it('finishes and fails jobs with terminal metadata', () => {
    resetJobsForTests()

    const doneJob = createJob({ type: 'test', label: 'Done job', total: 2 })
    updateJob(doneJob.id, { status: 'running', done: 1 })
    const done = finishJob(doneJob.id, { imported_files: 2 })

    expect(done.status).toBe('done')
    expect(done.progress.done).toBe(2)
    expect(done.finished_at).toEqual(expect.any(String))
    expect(done.metadata.imported_files).toBe(2)

    const failedJob = createJob({ type: 'test', label: 'Failed job' })
    const failed = failJob(failedJob.id, new Error('boom'), { failed_files: 1 })

    expect(failed.status).toBe('failed')
    expect(failed.error_message).toBe('boom')
    expect(failed.metadata.failed_files).toBe(1)
  })

  it('keeps terminal job states terminal and invokes cancel handlers', () => {
    resetJobsForTests()

    const job = createJob({ type: 'test', label: 'Cancelable job', total: 1 })
    let cancelled = false
    registerJobCancelHandler(job.id, () => {
      cancelled = true
    })

    const cancelledJob = cancelJob(job.id)
    const finishedAfterCancel = finishJob(job.id, { result: 'late success' })
    const failedAfterCancel = failJob(job.id, new Error('late failure'))
    const patchedAfterCancel = updateJob(job.id, {
      status: 'done',
      done: 1,
      metadata: { result: 'late metadata only' },
    })

    expect(cancelled).toBe(true)
    expect(cancelledJob.status).toBe('cancelled')
    expect(finishedAfterCancel.status).toBe('cancelled')
    expect(failedAfterCancel.status).toBe('cancelled')
    expect(patchedAfterCancel.status).toBe('cancelled')
    expect(patchedAfterCancel.metadata.result).toBe('late metadata only')
  })

  it('throws a direct error for missing jobs', () => {
    resetJobsForTests()
    expect(() => updateJob('job_missing', { status: 'running' })).toThrow('Job "job_missing" nao encontrado.')
    expect(() => cancelJob('job_missing')).toThrow('Job "job_missing" nao encontrado.')
  })
})
