import { spawn } from 'node:child_process'

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

export interface SystemTerminalLaunchCommand {
  file: string
  args: string[]
}

export interface SystemTerminalLaunchOptions {
  settleTimeoutMs?: number
}

export interface SpawnDetachedCheckedOptions {
  settleTimeoutMs?: number
  captureStderr?: boolean
  earlyExitMessage?: string
}

export function buildSystemTerminalLaunchCommand(
  platform: NodeJS.Platform,
  scriptPath: string,
): SystemTerminalLaunchCommand {
  if (platform === 'darwin') {
    const command = `exec ${shellQuote(scriptPath)}`
    const script = `tell application "Terminal" to do script ${JSON.stringify(command)}`
    return { file: 'osascript', args: ['-e', script] }
  }

  if (platform === 'win32') {
    return { file: 'cmd.exe', args: ['/c', 'start', '', scriptPath] }
  }

  if (platform === 'linux') {
    return { file: 'x-terminal-emulator', args: ['-e', scriptPath] }
  }

  throw new Error(`Sistema operacional sem suporte para Terminal IA: ${platform}`)
}

export async function openSystemTerminalWithScript(
  scriptPath: string,
  options: SystemTerminalLaunchOptions = {},
): Promise<void> {
  const command = buildSystemTerminalLaunchCommand(process.platform, scriptPath)
  await spawnDetachedChecked(command.file, command.args, {
    settleTimeoutMs: options.settleTimeoutMs,
    captureStderr: true,
    earlyExitMessage: `${command.file} encerrou antes de abrir o terminal`,
  })
}

export async function spawnDetachedChecked(
  command: string,
  args: string[],
  options: SpawnDetachedCheckedOptions = {},
): Promise<void> {
  const settleTimeoutMs = options.settleTimeoutMs ?? 700
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'ignore', options.captureStderr ? 'pipe' : 'ignore'],
      detached: true,
    })
    let settled = false
    let stderr = ''

    const settle = (fn: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      fn()
    }

    const timer = setTimeout(() => {
      child.unref()
      settle(resolve)
    }, settleTimeoutMs)

    if (options.captureStderr) {
      child.stderr?.setEncoding('utf8')
      child.stderr?.on('data', (chunk) => {
        stderr += chunk
      })
    }

    child.once('error', (error) => {
      settle(() => reject(error))
    })
    child.once('exit', (code, signal) => {
      if (code === 0) {
        settle(resolve)
        return
      }

      const details = stderr.trim() || `code=${code ?? 'null'}, signal=${signal ?? 'null'}`
      const prefix = options.earlyExitMessage ?? `${command} encerrou antes de abrir o terminal`
      settle(() => reject(new Error(`${prefix}: ${details}`)))
    })
  })
}
