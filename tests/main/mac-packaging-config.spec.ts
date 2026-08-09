import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

function topLevelSection(text: string, name: string): string {
  const lines = text.split('\n')
  const start = lines.findIndex((line) => line === `${name}:`)

  if (start < 0) throw new Error(`missing ${name} section`)

  let end = start + 1

  while (end < lines.length && (lines[end].startsWith('  ') || lines[end].trim() === '')) end += 1

  return lines.slice(start, end).join('\n')
}

describe('macOS packaging trust contract', () => {
  const config = fs.readFileSync('electron-builder.yml', 'utf8')
  const entitlements = fs.readFileSync('build/entitlements.mac.plist', 'utf8')
  const mac = topLevelSection(config, 'mac')
  const publish = topLevelSection(config, 'publish')

  it('requires signed and notarized arm64 targets only on macOS', () => {
    expect(mac).toContain('forceCodeSigning: true')
    expect(mac).toContain('type: distribution')
    expect(mac).toContain('hardenedRuntime: true')
    expect(mac).toContain('notarize: true')
    expect(mac).not.toMatch(/identity:\s*["']?-["']?/)
    expect(mac).toContain('target: dmg')
    expect(mac).toContain('target: zip')
    expect(mac.match(/- arm64/g)).toHaveLength(2)
    expect(config).not.toMatch(/^forceCodeSigning:/m)
  })

  it('declares every extensionless native sidecar', () => {
    for (const path of [
      'Contents/Resources/solver-bin/escalaflow-solver',
      'Contents/Resources/stt-bin/escalaflow-stt',
      'Contents/Resources/mcp-bin/escalaflow-mcp',
      'Contents/Resources/llama.cpp/darwin-arm64/llama-server',
    ]) expect(mac).toContain(path)
  })

  it('isolates signed Mac updates without moving Windows off latest', () => {
    expect(mac).toContain('channel: signed')
    expect(publish).not.toContain('channel:')
  })

  it('does not ship the debug entitlement', () => {
    expect(entitlements).not.toContain('com.apple.security.get-task-allow')
  })

  it('keeps package manifests synchronized', () => {
    const manifest = JSON.parse(fs.readFileSync('package.json', 'utf8'))
    const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'))

    expect(lock.version).toBe(manifest.version)
    expect(lock.packages[''].version).toBe(manifest.version)
    expect(manifest.scripts['release:mac']).toContain('npm run llama:bin')
    expect(manifest.scripts['release:mac']).toContain('--mac --arm64 --publish never')
  })
})
