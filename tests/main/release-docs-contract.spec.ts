import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const PUBLIC_SURFACE_PATHS = [
  'README.md',
  'docs/release.md',
  'docs/certificados.md',
  'resources/LEIA ANTES DE INSTALAR.txt',
]

const FORBIDDEN_BYPASS_PATTERNS = [
  /xattr\b/i,
  /codesign --remove-signature/i,
  /Abrir Mesmo Assim/i,
  /Open Anyway/i,
  /Control-click/i,
  /bot[aã]o direito.*Abrir/i,
]

function walkFiles(rootDir: string): string[] {
  const files: string[] = []

  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    const fullPath = path.join(rootDir, entry.name)
    if (entry.isDirectory()) {
      files.push(...walkFiles(fullPath))
      continue
    }
    if (entry.isFile()) {
      files.push(fullPath)
    }
  }

  return files
}

describe('release documentation contract', () => {
  const release = fs.readFileSync('docs/release.md', 'utf8')
  const surfaces = PUBLIC_SURFACE_PATHS
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

  it('requires version convergence before PR and tag creation', () => {
    expect(release).toContain('package.json')
    expect(release).toContain('package-lock.json')
    expect(release).toContain('npm version <versao> --no-git-tag-version')
    expect(release).toContain('npm pkg get version')
    expect(release).toContain('v1.12.1')
    expect(release).toContain('v1.12.2')
    expect(release).toContain('não se cria tag enquanto a versão não bater')
  })

  it('requires browser-origin Gatekeeper proof instead of CLI-downloaded bytes', () => {
    expect(release).toContain('browser UI')
    expect(release).toContain('authenticated GitHub draft/public release page')
    expect(release).toContain('CLI/API downloads are not sufficient')
    expect(release).toContain('without any bypass')
    expect(release).not.toContain('bytes baixados do release ou um Mac/perfil fresco')
  })

  it('keeps bypass tokens out of public surfaces and any unexpected script', () => {
    expect(surfaces).not.toMatch(
      /xattr\b|codesign --remove-signature|Abrir Mesmo Assim|Open Anyway|Control-click|bot[aã]o direito.*Abrir/i,
    )

    // Explicit allowlist: these are internal implementation contexts, not user instructions.
    const allowedScriptContexts = new Map([
      [
        'scripts/fetch-llama-server.mjs',
        ["spawnSync('xattr'", 'remove quarantine', 'best-effort'],
      ],
      [
        'scripts/mac-distribution-audit.mjs',
        ['DMG_BYPASS_MARKERS', 'Instalar-EscalaFlow\\.command', 'verifyMountedReadme', 'for (const marker of DMG_BYPASS_MARKERS)'],
      ],
    ])

    for (const scriptPath of walkFiles('scripts')) {
      const normalized = scriptPath.split(path.sep).join(path.posix.sep)
      const content = fs.readFileSync(scriptPath, 'utf8')
      const hasForbiddenToken = FORBIDDEN_BYPASS_PATTERNS.some((pattern) => pattern.test(content))

      if (!hasForbiddenToken) {
        continue
      }

      const allowedContext = allowedScriptContexts.get(normalized)

      if (!allowedContext) {
        throw new Error(`unexpected bypass token in script: ${normalized}`)
      }

      for (const marker of allowedContext) {
        expect(content).toContain(marker)
      }
    }
  })

  it('does not prescribe bypass or local direct publishing', () => {
    expect(release).not.toContain('--publish always')
    expect(fs.existsSync('scripts/Instalar-EscalaFlow.command')).toBe(false)
  })
})
