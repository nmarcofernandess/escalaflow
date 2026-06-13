import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { resolveExistingDirectory } from './paths'
import type { TerminalSessionInfo, TerminalSessionSnapshot } from '../../shared/types'

const OUTPUT_LIMIT = 200 * 1024

interface TerminalSessionState extends TerminalSessionInfo {
  process: ChildProcessWithoutNullStreams
  output: Buffer
  truncated: boolean
}

const sessions = new Map<string, TerminalSessionState>()

function nowIso(): string {
  return new Date().toISOString()
}

function nextSessionId(): string {
  return `term_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function shellCommand(): { shell: string; args: string[] } {
  if (process.platform === 'win32') return { shell: 'cmd.exe', args: [] }
  return { shell: '/bin/zsh', args: ['-l'] }
}

function appendOutput(session: TerminalSessionState, chunk: Buffer): void {
  const next = Buffer.concat([session.output, chunk])
  if (next.length <= OUTPUT_LIMIT) {
    session.output = next
  } else {
    session.output = next.subarray(next.length - OUTPUT_LIMIT)
    session.truncated = true
  }
  session.updated_at = nowIso()
}

function toInfo(session: TerminalSessionState): TerminalSessionInfo {
  const { id, cwd, shell, status, created_at, updated_at, exit_code } = session
  return { id, cwd, shell, status, created_at, updated_at, exit_code }
}

function toSnapshot(session: TerminalSessionState): TerminalSessionSnapshot {
  return {
    ...toInfo(session),
    output: session.output.toString('utf-8'),
    truncated: session.truncated,
  }
}

export function startTerminalSession(input?: { cwd?: string }): TerminalSessionSnapshot {
  const cwd = resolveExistingDirectory(input?.cwd || process.cwd())
  const { shell, args } = shellCommand()
  const timestamp = nowIso()
  const child = spawn(shell, args, {
    cwd,
    env: process.env,
    stdio: 'pipe',
  })
  const session: TerminalSessionState = {
    id: nextSessionId(),
    cwd,
    shell,
    status: 'running',
    created_at: timestamp,
    updated_at: timestamp,
    process: child,
    output: Buffer.alloc(0),
    truncated: false,
    exit_code: null,
  }

  child.stdout.on('data', (chunk: Buffer) => appendOutput(session, chunk))
  child.stderr.on('data', (chunk: Buffer) => appendOutput(session, chunk))
  child.on('error', (error) => {
    session.status = 'exited'
    session.exit_code = null
    appendOutput(session, Buffer.from(`\n[spawn error] ${error.message}\n`))
  })
  child.on('close', (exitCode) => {
    session.status = 'exited'
    session.exit_code = exitCode
    session.updated_at = nowIso()
  })

  sessions.set(session.id, session)
  return toSnapshot(session)
}

export function listTerminalSessions(): TerminalSessionInfo[] {
  return [...sessions.values()].map(toInfo).sort((a, b) => b.created_at.localeCompare(a.created_at))
}

export function getTerminalSession(id: string): TerminalSessionSnapshot | null {
  const session = sessions.get(id)
  return session ? toSnapshot(session) : null
}

export function writeTerminalSession(id: string, data: string): TerminalSessionSnapshot {
  const session = sessions.get(id)
  if (!session) throw new Error(`Sessao terminal "${id}" nao encontrada.`)
  if (session.status !== 'running') throw new Error(`Sessao terminal "${id}" nao esta em execucao.`)
  session.process.stdin.write(data)
  session.updated_at = nowIso()
  return toSnapshot(session)
}

export function resizeTerminalSession(id: string, _cols: number, _rows: number): TerminalSessionSnapshot {
  const session = sessions.get(id)
  if (!session) throw new Error(`Sessao terminal "${id}" nao encontrada.`)
  session.updated_at = nowIso()
  return toSnapshot(session)
}

export function killTerminalSession(id: string): TerminalSessionSnapshot {
  const session = sessions.get(id)
  if (!session) throw new Error(`Sessao terminal "${id}" nao encontrada.`)
  if (session.status === 'running') session.process.kill('SIGTERM')
  session.status = 'exited'
  session.updated_at = nowIso()
  return toSnapshot(session)
}

export function resetTerminalSessionsForTests(): void {
  for (const session of sessions.values()) {
    if (session.status === 'running') session.process.kill('SIGTERM')
  }
  sessions.clear()
}
