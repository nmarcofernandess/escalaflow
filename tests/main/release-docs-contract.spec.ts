import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const PUBLIC_SURFACE_PATHS = [
  'README.md',
  'docs/release.md',
  'docs/certificados.md',
  'resources/LEIA ANTES DE INSTALAR.txt',
]

type ForbiddenBypassPattern = {
  token: string
  regex: RegExp
}

type BypassOccurrence = {
  token: string
  match: string
  line: number
  column: number
  lineText: string
}

const FORBIDDEN_BYPASS_PATTERNS: ForbiddenBypassPattern[] = [
  { token: 'xattr', regex: /xattr\b/i },
  // Match both user-facing text and the escaped regex literal in the internal auditor.
  { token: 'codesign --remove-signature', regex: /codesign(?:\s+|\\s\+)--remove-signature/i },
  { token: 'Abrir Mesmo Assim', regex: /Abrir Mesmo Assim/i },
  { token: 'Open Anyway', regex: /Open Anyway/i },
  // Match both the user-facing spelling and the auditor's optional-hyphen regex literal.
  { token: 'Control-click', regex: /Control-(?:click|\?click)/i },
  { token: 'botão direito.*Abrir', regex: /bot[aã]o direito.*Abrir/i },
  { token: 'Instalar-EscalaFlow.command', regex: /Instalar-EscalaFlow(?:\.|\\\.)command/i },
  { token: '--publish always', regex: /--publish always/i },
]

function collectBypassOccurrences(content: string): BypassOccurrence[] {
  const lines = content.split(/\r?\n/)
  const occurrences: BypassOccurrence[] = []

  for (const { token, regex } of FORBIDDEN_BYPASS_PATTERNS) {
    const globalRegex = new RegExp(regex.source, `${regex.flags}g`)

    for (const match of content.matchAll(globalRegex)) {
      if (match.index === undefined) continue

      const line = content.slice(0, match.index).split(/\r?\n/).length
      const lineStart = content.lastIndexOf('\n', match.index - 1) + 1

      occurrences.push({
        token,
        match: match[0],
        line,
        column: match.index - lineStart + 1,
        lineText: lines[line - 1] ?? '',
      })
    }
  }

  return occurrences.sort((left, right) => left.line - right.line || left.column - right.column)
}

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
    for (const publicSurfacePath of PUBLIC_SURFACE_PATHS) {
      const content = fs.readFileSync(publicSurfacePath, 'utf8')
      expect(collectBypassOccurrences(content), publicSurfacePath).toEqual([])
    }

    // Fail-closed allowlist: fetch-llama-server uses one xattr command internally for
    // best-effort sidecar preparation before signing; mac-distribution-audit keeps the
    // six literal regex markers that reject unsafe DMG readmes. Neither is user guidance.
    // Every other occurrence in any script, including an extra occurrence in an allowlisted
    // file, is a contract failure.
    const allowedScriptOccurrences = new Map<string, BypassOccurrence[]>([
      [
        'scripts/fetch-llama-server.mjs',
        [{
          token: 'xattr',
          line: 140,
          column: 14,
          match: 'xattr',
          lineText: "  spawnSync('xattr', ['-dr', 'com.apple.quarantine', DEST_DIR], { stdio: 'ignore' })",
        }],
      ],
      [
        'scripts/mac-distribution-audit.mjs',
        [
          { token: 'xattr', line: 23, column: 4, match: 'xattr', lineText: '  /xattr\\b/i,' },
          {
            token: 'codesign --remove-signature',
            line: 24,
            column: 4,
            match: 'codesign\\s+--remove-signature',
            lineText: '  /codesign\\s+--remove-signature/i,',
          },
          { token: 'Open Anyway', line: 25, column: 4, match: 'Open Anyway', lineText: '  /Open Anyway/i,' },
          { token: 'Abrir Mesmo Assim', line: 26, column: 4, match: 'Abrir Mesmo Assim', lineText: '  /Abrir Mesmo Assim/i,' },
          { token: 'Control-click', line: 27, column: 4, match: 'Control-?click', lineText: '  /Control-?click/i,' },
          {
            token: 'Instalar-EscalaFlow.command',
            line: 28,
            column: 4,
            match: 'Instalar-EscalaFlow\\.command',
            lineText: '  /Instalar-EscalaFlow\\.command/i,',
          },
        ],
      ],
    ])

    for (const [allowlistedPath] of allowedScriptOccurrences) {
      expect(fs.existsSync(allowlistedPath), allowlistedPath).toBe(true)
    }

    for (const scriptPath of walkFiles('scripts')) {
      const normalized = scriptPath.split(path.sep).join(path.posix.sep)
      const content = fs.readFileSync(scriptPath, 'utf8')
      const expectedOccurrences = allowedScriptOccurrences.get(normalized) ?? []

      expect(collectBypassOccurrences(content), normalized).toEqual(expectedOccurrences)
    }
  })

  it('does not prescribe bypass or local direct publishing', () => {
    expect(release).not.toContain('--publish always')
    expect(fs.existsSync('scripts/Instalar-EscalaFlow.command')).toBe(false)
  })
})
