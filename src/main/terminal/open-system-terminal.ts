import { spawn } from 'node:child_process'

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

export interface SystemTerminalLaunchCommand {
  file: string
  args: string[]
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

export function openSystemTerminalWithScript(scriptPath: string): void {
  const command = buildSystemTerminalLaunchCommand(process.platform, scriptPath)
  spawn(command.file, command.args, { stdio: 'ignore', detached: true }).unref()
}
