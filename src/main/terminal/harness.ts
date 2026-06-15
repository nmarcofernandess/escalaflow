import { spawn } from 'node:child_process'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import { execute } from '../db/query'
import { createJob, failJob, finishJob, getJob, registerJobCancelHandler, updateJob } from '../jobs'
import { getAiTerminalReadiness } from '../ia/runtime-readiness'
import { getOrCreateToolServerToken } from '../../node/tool-server-auth'
import { buildAiTerminalCommand } from '../../shared/terminal-launch-contract'
import { resolveToolServerUrl } from '../../shared/tool-server-url'
import { getTerminalHarnessConfig } from './config'
import { openSystemTerminalWithScript, spawnDetachedChecked } from './open-system-terminal'
import { resolveExistingDirectory } from './paths'
import { writeAiTerminalWrapper } from './terminal-wrapper'
import { isTerminalExecSuccess } from '../../shared/types'
import type {
  AppJob,
  TerminalExecConfiguredResult,
  TerminalExecInput,
  TerminalExecResult,
  TerminalHarnessConfig,
  TerminalOpenCliResult,
} from '../../shared/types'

const DEFAULT_TIMEOUT_MS = 30_000
const MAX_TIMEOUT_MS = 120_000
const OUTPUT_LIMIT_BYTES = 200 * 1024
const DEFAULT_READ_BYTES = 512 * 1024
const KILL_GRACE_MS = 500

function clampTimeout(raw: number | undefined): number {
  const value = raw ?? DEFAULT_TIMEOUT_MS
  if (!Number.isFinite(value)) return DEFAULT_TIMEOUT_MS
  return Math.max(100, Math.min(Math.floor(value), MAX_TIMEOUT_MS))
}

function clampOutputLimit(raw: number | undefined): number {
  const value = raw ?? OUTPUT_LIMIT_BYTES
  if (!Number.isFinite(value)) return OUTPUT_LIMIT_BYTES
  return Math.max(1_000, Math.min(Math.floor(value), OUTPUT_LIMIT_BYTES))
}

function appendLimited(buffer: Buffer<ArrayBufferLike>, chunk: Buffer, limit: number): {
  buffer: Buffer<ArrayBufferLike>
  truncated: boolean
} {
  const next = Buffer.concat([buffer, chunk])
  if (next.length <= limit) return { buffer: next, truncated: false }
  return { buffer: next.subarray(next.length - limit), truncated: true }
}

function shellArgs(command: string): { shell: string; args: string[] } {
  if (process.platform === 'win32') {
    return { shell: 'cmd.exe', args: ['/d', '/s', '/c', command] }
  }
  return { shell: '/bin/zsh', args: ['-lc', command] }
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

function normalizeInput(input: TerminalExecInput): TerminalExecInput & { cwd: string; timeout_ms: number } {
  const command = input.command.trim()
  if (!command) throw new Error('Campo "command" é obrigatório.')
  return {
    ...input,
    command,
    cwd: path.resolve(input.cwd || process.cwd()),
    timeout_ms: clampTimeout(input.timeout_ms),
  }
}

async function recordTerminalCommand(input: {
  source: string
  command: string
  cwd: string
  status: 'executed' | 'failed'
  exit_code?: number | null
  timed_out?: boolean
  output_preview?: string
}): Promise<void> {
  try {
    await execute(
      `INSERT INTO terminal_command_log
         (source, command, cwd, status, exit_code, timed_out, output_preview, finished_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
      input.source,
      input.command,
      input.cwd,
      input.status,
      input.exit_code ?? null,
      input.timed_out ?? false,
      input.output_preview ?? null,
    )
  } catch (error) {
    // Logging must never make terminal execution fail.
    console.warn('[TERMINAL] Falha ao registrar auditoria do comando:', error)
  }
}

export async function resolveTerminalExecInput(input: TerminalExecInput): Promise<{
  input: TerminalExecInput & { cwd: string; timeout_ms: number }
  config: TerminalHarnessConfig
}> {
  const config = await getTerminalHarnessConfig()
  const normalized = normalizeInput({
    ...input,
    cwd: input.cwd ?? config.default_cwd,
    timeout_ms: Math.min(input.timeout_ms ?? config.max_timeout_ms, config.max_timeout_ms),
    max_output_chars: Math.min(input.max_output_chars ?? config.max_output_chars, config.max_output_chars),
  })

  return { input: normalized, config }
}

export async function runTerminalCommand(
  input: TerminalExecInput,
  options: { signal?: AbortSignal } = {},
): Promise<TerminalExecResult> {
  const normalized = normalizeInput(input)
  const started = Date.now()
  const { shell, args } = shellArgs(normalized.command)
  const outputLimit = clampOutputLimit(normalized.max_output_chars)

  return await new Promise<TerminalExecResult>((resolve, reject) => {
    let stdout: Buffer<ArrayBufferLike> = Buffer.alloc(0)
    let stderr: Buffer<ArrayBufferLike> = Buffer.alloc(0)
    let truncated = false
    let timedOut = false
    let aborted = false
    let settled = false
    let killTimer: NodeJS.Timeout | null = null

    const child = spawn(shell, args, {
      cwd: normalized.cwd,
      env: {
        ...process.env,
        ...(normalized.env ?? {}),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    })

    function killProcess(signal: NodeJS.Signals): void {
      if (!child.pid) return
      try {
        if (process.platform !== 'win32') {
          process.kill(-child.pid, signal)
        } else {
          child.kill(signal)
        }
      } catch {
        try { child.kill(signal) } catch { /* already exited */ }
      }
    }

    function terminate(): void {
      killProcess('SIGTERM')
      if (!killTimer) {
        killTimer = setTimeout(() => {
          killProcess('SIGKILL')
        }, KILL_GRACE_MS)
      }
    }

    const timer = setTimeout(() => {
      timedOut = true
      terminate()
    }, normalized.timeout_ms)

    const abort = () => {
      aborted = true
      terminate()
    }

    if (options.signal?.aborted) abort()
    options.signal?.addEventListener('abort', abort, { once: true })

    child.stdout.on('data', (chunk: Buffer) => {
      const next = appendLimited(stdout, chunk, outputLimit)
      stdout = next.buffer
      truncated ||= next.truncated
    })
    child.stderr.on('data', (chunk: Buffer) => {
      const next = appendLimited(stderr, chunk, outputLimit)
      stderr = next.buffer
      truncated ||= next.truncated
    })

    child.on('error', (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (killTimer) clearTimeout(killTimer)
      options.signal?.removeEventListener('abort', abort)
      reject(error)
    })

    child.on('close', (exitCode, signal) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (killTimer) clearTimeout(killTimer)
      options.signal?.removeEventListener('abort', abort)
      resolve({
        command: normalized.command,
        cwd: normalized.cwd,
        exit_code: exitCode,
        signal,
        stdout: stdout.toString('utf-8'),
        stderr: stderr.toString('utf-8'),
        duration_ms: Date.now() - started,
        timed_out: timedOut && !aborted,
        truncated,
      })
    })
  })
}

export async function runTerminalCommandWithConfig(
  input: TerminalExecInput,
  source = 'api',
  options: { signal?: AbortSignal } = {},
): Promise<TerminalExecConfiguredResult> {
  const { input: normalized, config } = await resolveTerminalExecInput(input)

  const result = await runTerminalCommand(normalized, options)
  await recordTerminalCommand({
    source,
    command: normalized.command,
    cwd: normalized.cwd,
    status: isTerminalExecSuccess(result) ? 'executed' : 'failed',
    exit_code: result.exit_code,
    timed_out: result.timed_out,
    output_preview: `${result.stdout}\n${result.stderr}`.trim().slice(0, 20_000),
  })
  return { status: isTerminalExecSuccess(result) ? 'ok' : 'error', result, config }
}

export function startTerminalCommand(input: TerminalExecInput, source = 'api'): AppJob {
  const normalized = normalizeInput(input)
  const controller = new AbortController()
  const job = createJob({
    type: 'terminal_exec',
    label: `Terminal: ${normalized.command.slice(0, 80)}`,
    total: 1,
    metadata: {
      command: normalized.command,
      cwd: normalized.cwd,
      timeout_ms: normalized.timeout_ms,
    },
  })
  const unregisterCancel = registerJobCancelHandler(job.id, () => controller.abort())

  updateJob(job.id, { status: 'running', done: 0 })
  void runTerminalCommandWithConfig(normalized, source, { signal: controller.signal })
    .then(({ result }) => {
      const current = getJob(job.id)
      if (current?.status === 'cancelled') {
        updateJob(job.id, {
          done: current.progress.done,
          metadata: { result },
          error_message: 'Comando cancelado pelo usuario.',
        })
        return
      }

      if (!isTerminalExecSuccess(result)) {
        updateJob(job.id, { done: 1, metadata: { result } })
        failJob(
          job.id,
          new Error(result.timed_out ? 'Comando excedeu o timeout.' : (result.stderr || `exit ${result.exit_code}`)),
          { result },
        )
        return
      }

      updateJob(job.id, {
        done: 1,
        metadata: { result },
        error_message: null,
      })
      finishJob(job.id, { result })
    })
    .catch((error) => {
      const current = getJob(job.id)
      if (current?.status === 'cancelled') {
        updateJob(job.id, {
          metadata: { error: error instanceof Error ? error.message : String(error) },
          error_message: 'Comando cancelado pelo usuario.',
        })
        return
      }
      failJob(job.id, error)
    })
    .finally(() => {
      unregisterCancel()
    })

  return job
}

export function buildOpenCliCommand(input?: { command?: string; cwd?: string }): TerminalOpenCliResult {
  const cwd = resolveExistingDirectory(input?.cwd || process.cwd())
  const command = input?.command?.trim() || buildAiTerminalCommand({ projectCwd: process.cwd() })
  return { opened: false, command, cwd }
}

export function buildOpenCliShellCommand(input?: { command?: string; cwd?: string }): string {
  const base = buildOpenCliCommand(input)
  return `cd ${shellQuote(base.cwd)} && ${base.command}`
}

export async function openCliInSystemTerminal(input?: { command?: string; cwd?: string }): Promise<TerminalOpenCliResult> {
  const base = buildOpenCliCommand(input)
  const shellCommand = buildOpenCliShellCommand(base)

  if (process.platform === 'darwin') {
    const script = `tell application "Terminal" to do script ${JSON.stringify(shellCommand)}`
    await spawnDetachedChecked('osascript', ['-e', script])
    return { ...base, opened: true }
  }

  const terminal = process.platform === 'win32' ? 'cmd.exe' : 'x-terminal-emulator'
  const args = process.platform === 'win32'
    ? ['/c', 'start', 'cmd.exe', '/k', shellCommand]
    : ['-e', shellCommand]
  await spawnDetachedChecked(terminal, args)
  return { ...base, opened: true }
}

export async function openAiTerminalInSystemTerminal(input?: { cwd?: string }): Promise<TerminalOpenCliResult> {
  const readiness = await getAiTerminalReadiness({ cwd: input?.cwd })
  const base: TerminalOpenCliResult = {
    opened: false,
    command: readiness.command,
    cwd: readiness.cwd,
    readiness,
    status: readiness.ok ? 'dispatched' : 'blocked',
  }

  if (!readiness.ok || readiness.blocksLaunch) {
    return {
      ...base,
      status: 'blocked',
      error_message: readiness.message,
    }
  }

  try {
    const wrapper = await writeAiTerminalWrapper({
      cwd: readiness.cwd,
      command: readiness.command,
      env: {
        ESCALAFLOW_TOOL_SERVER: resolveToolServerUrl(),
        ESCALAFLOW_TOOL_SERVER_TOKEN: getOrCreateToolServerToken(),
        ESCALAFLOW_USER_DATA_DIR: process.env.ESCALAFLOW_USER_DATA_DIR,
      },
    })
    await openSystemTerminalWithScript(wrapper.path)
    return {
      ...base,
      opened: true,
      status: 'dispatched',
      wrapper_path: wrapper.path,
    }
  } catch (error) {
    return {
      ...base,
      status: 'failed',
      error_message: error instanceof Error ? error.message : String(error),
    }
  }
}

export async function readHarnessFile(filePath: string, maxBytes = DEFAULT_READ_BYTES): Promise<{
  path: string
  content: string
  truncated: boolean
}> {
  const resolvedPath = path.resolve(filePath)
  const handle = await fs.open(resolvedPath, 'r')
  try {
    const size = (await handle.stat()).size
    const limit = Math.max(1, Math.min(maxBytes, DEFAULT_READ_BYTES))
    const buffer = Buffer.alloc(Math.min(size, limit))
    await handle.read(buffer, 0, buffer.length, 0)
    return {
      path: resolvedPath,
      content: buffer.toString('utf-8'),
      truncated: size > limit,
    }
  } finally {
    await handle.close()
  }
}

export async function writeHarnessFile(filePath: string, content: string): Promise<{
  path: string
  bytes: number
}> {
  const resolvedPath = path.resolve(filePath)
  await fs.mkdir(path.dirname(resolvedPath), { recursive: true })
  await fs.writeFile(resolvedPath, content, 'utf-8')
  return {
    path: resolvedPath,
    bytes: Buffer.byteLength(content, 'utf-8'),
  }
}
