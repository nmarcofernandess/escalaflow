import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), 'utf8')
}

function extractClientKeys(source: string): string[] {
  return [...source.matchAll(/client\['([^']+)'\]/g)].map((match) => match[1])
}

describe('renderer IPC contracts', () => {
  it('keeps conhecimento renderer service keys registered in main TIPC router', () => {
    const service = readRepoFile('src/renderer/src/servicos/conhecimento.ts')
    const router = readRepoFile('src/main/tipc.ts')

    for (const key of extractClientKeys(service)) {
      expect(router, key).toContain(`'${key}'`)
    }
  })

  it('keeps terminal renderer service keys registered in main TIPC router', () => {
    const service = readRepoFile('src/renderer/src/servicos/terminal.ts')
    const router = readRepoFile('src/main/tipc.ts')

    for (const key of extractClientKeys(service)) {
      expect(router, key).toContain(`'${key}'`)
    }
  })
})
