import { execFile } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

async function runCli(args: string[]) {
  return execFileAsync('npx', ['tsx', 'src/cli/index.ts', ...args], {
    cwd: root,
    env: { ...process.env, ESCALAFLOW_TOOL_SERVER: 'http://127.0.0.1:9' },
  })
}

describe('escalaflow cli offline behavior', () => {
  it('prints a useful message when the app is closed', async () => {
    await expect(runCli(['status'])).rejects.toMatchObject({
      stderr: expect.stringContaining('EscalaFlow nao esta rodando. Abra o app primeiro.'),
    })
  })

  it('rejects invalid JSON passed to tool', async () => {
    await expect(runCli(['tool', 'gerar_escala', '--json', '{'])).rejects.toMatchObject({
      stderr: expect.stringContaining('JSON invalido em --json.'),
    })
  })
})
