import { access, mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { execute } from '../../../src/main/db/query'
import {
  readHarnessFile,
  buildOpenCliShellCommand,
  runTerminalCommand,
  runTerminalCommandWithConfig,
  startTerminalCommand,
  writeHarnessFile,
} from '../../../src/main/terminal/harness'
import {
  getTerminalSession,
  killTerminalSession,
  resetTerminalSessionsForTests,
  startTerminalSession,
  writeTerminalSession,
} from '../../../src/main/terminal/sessions'
import { cancelJob, getJob, resetJobsForTests } from '../../../src/main/jobs'

vi.mock('../../../src/main/db/query', () => ({
  execute: vi.fn(async () => undefined),
  queryOne: vi.fn(async () => undefined),
}))

describe('terminal harness', () => {
  let tmpDir: string

  beforeEach(async () => {
    resetJobsForTests()
    resetTerminalSessionsForTests()
    vi.clearAllMocks()
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'flowkit-terminal-'))
  })

  afterEach(async () => {
    resetTerminalSessionsForTests()
    await rm(tmpDir, { recursive: true, force: true })
  })

  it('runs shell commands and captures stdout', async () => {
    const result = await runTerminalCommand({
      command: 'printf ok',
      cwd: tmpDir,
    })

    expect(result.exit_code).toBe(0)
    expect(result.stdout).toBe('ok')
    expect(result.stderr).toBe('')
    expect(result.cwd).toBe(tmpDir)
  })

  it('marks timed out commands', async () => {
    const result = await runTerminalCommand({
      command: 'trap "" TERM; sleep 5',
      timeout_ms: 100,
    })

    expect(result.timed_out).toBe(true)
    expect(result.signal).toBeTruthy()
  })

  it('treats open-cli cwd as quoted path data', async () => {
    const trickyDir = path.join(tmpDir, '$(touch pwned)')
    await import('node:fs/promises').then(({ mkdir }) => mkdir(trickyDir))
    const markerPath = path.join(tmpDir, 'pwned')
    const shellCommand = buildOpenCliShellCommand({
      cwd: trickyDir,
      command: 'printf safe',
    })

    const result = await runTerminalCommand({
      command: shellCommand,
      cwd: tmpDir,
    })

    expect(result.exit_code).toBe(0)
    expect(result.stdout).toBe('safe')
    await expect(access(markerPath)).rejects.toThrow()
  })

  it('reads and writes files', async () => {
    const filePath = path.join(tmpDir, 'nested', 'out.txt')
    const write = await writeHarnessFile(filePath, 'hello')
    const read = await readHarnessFile(filePath)

    expect(write.bytes).toBe(5)
    expect(read.content).toBe('hello')
    expect(read.truncated).toBe(false)
  })

  it('starts async terminal jobs', async () => {
    const job = startTerminalCommand({
      command: 'printf job',
      cwd: tmpDir,
    })

    expect(job.status).toBe('pending')

    const started = Date.now()
    while (Date.now() - started < 3000) {
      const current = getJob(job.id)
      if (current?.status === 'done') {
        expect((current.metadata.result as any).stdout).toBe('job')
        expect(vi.mocked(execute)).toHaveBeenCalled()
        return
      }
      await new Promise((resolve) => setTimeout(resolve, 20))
    }

    throw new Error('terminal job did not finish')
  })

  it('organizes local files into a folder and records the audit row', async () => {
    await writeFile(path.join(tmpDir, 'nota.txt'), 'nota')
    await writeFile(path.join(tmpDir, 'print.png'), 'png')
    await writeFile(path.join(tmpDir, 'agenda.pdf'), 'pdf')

    const result = await runTerminalCommandWithConfig({
      command: 'mkdir -p Organizados && mv nota.txt print.png agenda.pdf Organizados/ && find Organizados -maxdepth 1 -type f -exec basename {} \\; | sort',
      cwd: tmpDir,
      timeout_ms: 5_000,
    }, 'test')

    expect(result.status).toBe('ok')
    expect(result.result.exit_code).toBe(0)
    expect(result.result.stdout.trim().split('\n')).toEqual(['agenda.pdf', 'nota.txt', 'print.png'])
    await expect(readdir(path.join(tmpDir, 'Organizados')).then((files) => files.sort())).resolves.toEqual(['agenda.pdf', 'nota.txt', 'print.png'])
    expect(vi.mocked(execute)).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO terminal_command_log'),
      'test',
      expect.stringContaining('mkdir -p Organizados'),
      tmpDir,
      'executed',
      0,
      false,
      expect.stringContaining('agenda.pdf'),
    )
  })

  it('marks failed async terminal jobs as failed', async () => {
    const job = startTerminalCommand({
      command: 'printf erro >&2; exit 42',
      cwd: tmpDir,
    })

    const started = Date.now()
    while (Date.now() - started < 3000) {
      const current = getJob(job.id)
      if (current?.status === 'failed') {
        expect(current.error_message).toContain('erro')
        expect((current.metadata.result as any).exit_code).toBe(42)
        return
      }
      await new Promise((resolve) => setTimeout(resolve, 20))
    }

    throw new Error('terminal job did not fail')
  })

  it('cancels async terminal jobs and stops later side effects', async () => {
    const markerPath = path.join(tmpDir, 'should-not-exist.txt')
    const job = startTerminalCommand({
      command: `sleep 0.6; printf late > ${JSON.stringify(markerPath)}`,
      cwd: tmpDir,
      timeout_ms: 5_000,
    })

    cancelJob(job.id)
    await new Promise((resolve) => setTimeout(resolve, 900))

    const current = getJob(job.id)
    expect(current?.status).toBe('cancelled')
    await expect(access(markerPath)).rejects.toThrow()
  })

  it('starts interactive terminal sessions and captures output', async () => {
    const session = startTerminalSession({ cwd: tmpDir })
    writeTerminalSession(session.id, 'pwd\n')

    const started = Date.now()
    while (Date.now() - started < 3000) {
      const current = getTerminalSession(session.id)
      if (current?.output.includes(tmpDir)) {
        const killed = killTerminalSession(session.id)
        expect(killed.status).toBe('exited')
        return
      }
      await new Promise((resolve) => setTimeout(resolve, 50))
    }

    throw new Error('terminal session did not capture pwd')
  })

  it('rejects interactive terminal sessions with invalid cwd before reporting running', () => {
    expect(() => startTerminalSession({ cwd: path.join(tmpDir, 'missing') })).toThrow('Diretorio nao encontrado')
  })
})
