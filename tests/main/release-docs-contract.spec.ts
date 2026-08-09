import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('release documentation contract', () => {
  const release = fs.readFileSync('docs/release.md', 'utf8')
  const surfaces = [
    'README.md',
    'docs/release.md',
    'docs/certificados.md',
    'resources/LEIA ANTES DE INSTALAR.txt',
  ]
    .map((path) => fs.readFileSync(path, 'utf8'))
    .join('\n')

  it('documents Developer ID and the one-time legacy reinstall', () => {
    expect(release).toContain('Developer ID Application')
    expect(release).toContain('v1.12.0')
    expect(release).toContain('reinstalação')
    expect(release).toContain('v1.12.1 → v1.12.2')
    expect(release).toContain('signed-mac.yml')
    expect(release).toContain('latest-mac.yml')
  })

  it('does not prescribe bypass or local direct publishing', () => {
    expect(surfaces).not.toMatch(
      /xattr\b|codesign --remove-signature|Abrir Mesmo Assim|Open Anyway|Control-click|bot[aã]o direito.*Abrir/i,
    )
    expect(release).not.toContain('--publish always')
    expect(fs.existsSync('scripts/Instalar-EscalaFlow.command')).toBe(false)
  })
})
