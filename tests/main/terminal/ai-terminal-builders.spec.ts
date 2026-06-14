import { describe, expect, it } from 'vitest'
import { buildSystemTerminalLaunchCommand } from '../../../src/main/terminal/open-system-terminal'
import { buildAiTerminalWrapperContent } from '../../../src/main/terminal/terminal-wrapper'

describe('AI terminal launch builders', () => {
  it('quotes macOS Terminal scripts without executing path fragments', () => {
    const command = buildSystemTerminalLaunchCommand('darwin', '/tmp/Escala Flow/open terminal.sh')

    expect(command.file).toBe('osascript')
    expect(command.args).toHaveLength(2)
    expect(command.args[1]).toContain('tell application "Terminal"')
    expect(command.args[1]).toContain("exec '/tmp/Escala Flow/open terminal.sh'")
  })

  it('passes Windows wrapper paths as one start argument', () => {
    const scriptPath = 'C:\\Users\\Marco Flow\\App Data\\open-escalaflow-ai-terminal.cmd'
    const command = buildSystemTerminalLaunchCommand('win32', scriptPath)

    expect(command.file).toBe('cmd.exe')
    expect(command.args).toEqual(['/c', 'start', '', scriptPath])
  })

  it('writes Unix wrapper content with a quoted cwd containing spaces', () => {
    const wrapper = buildAiTerminalWrapperContent({
      platform: 'darwin',
      cwd: "/Users/marco/Escala Flow's App",
      command: "npm --prefix '/Users/marco/Escala Flow'\\''s App' run cli -- chat --attach",
      env: {
        ESCALAFLOW_TOOL_SERVER: 'http://127.0.0.1:17380',
        ESCALAFLOW_TOOL_SERVER_TOKEN: 'proof token',
      },
    })

    expect(wrapper.extension).toBe('.sh')
    expect(wrapper.content).toContain("cd '/Users/marco/Escala Flow'\\''s App'")
    expect(wrapper.content).toContain("export ESCALAFLOW_TOOL_SERVER='http://127.0.0.1:17380'")
    expect(wrapper.content).toContain("export ESCALAFLOW_TOOL_SERVER_TOKEN='proof token'")
    expect(wrapper.content).toContain("exec npm --prefix '/Users/marco/Escala Flow'\\''s App' run cli -- chat --attach")
  })

  it('writes Windows wrapper content with a quoted cwd containing spaces', () => {
    const wrapper = buildAiTerminalWrapperContent({
      platform: 'win32',
      cwd: 'C:\\Users\\Marco Flow\\App Data',
      command: 'npm run cli -- chat --attach',
      env: {
        ESCALAFLOW_TOOL_SERVER: 'http://127.0.0.1:17380',
        ESCALAFLOW_TOOL_SERVER_TOKEN: 'proof token',
      },
    })

    expect(wrapper.extension).toBe('.cmd')
    expect(wrapper.content).toContain('cd /d "C:\\Users\\Marco Flow\\App Data"')
    expect(wrapper.content).toContain('set "ESCALAFLOW_TOOL_SERVER=http://127.0.0.1:17380"')
    expect(wrapper.content).toContain('set "ESCALAFLOW_TOOL_SERVER_TOKEN=proof token"')
    expect(wrapper.content).toContain('npm run cli -- chat --attach')
  })
})
