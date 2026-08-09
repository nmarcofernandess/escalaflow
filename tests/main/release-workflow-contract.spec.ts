import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

const workflow = fs.readFileSync('.github/workflows/release.yml', 'utf8')

function job(id: string, nextId?: string): string {
  const start = workflow.indexOf(`  ${id}:`)

  if (start < 0) {
    throw new Error(`missing job ${id}`)
  }

  const end = nextId ? workflow.indexOf(`  ${nextId}:`, start + 1) : workflow.length

  return workflow.slice(start, end > 0 ? end : workflow.length)
}

describe('release workflow trust boundaries', () => {
  it('isolates Apple material to the arm64 Mac job', () => {
    const mac = job('build-mac', 'build-windows')
    const windows = job('build-windows', 'release-draft')

    expect(mac).toContain('runs-on: macos-15')
    expect(mac).toContain('needs: verify')
    expect(mac).toContain('Verify runner architecture')
    expect(mac).toContain('test "$(uname -m)" = "arm64"')
    expect(mac).toContain('--mac --arm64 --publish never')
    expect(mac).toContain('APPLE_API_KEY_BASE64')
    expect(mac).toContain("export APPLE_API_KEY=")
    expect(mac).toContain("trap 'rm -f \"$api_key_path\"' EXIT")
    expect(mac).toContain('dist/signed-mac.yml')
    expect(mac).not.toContain('dist/latest-mac.yml')

    expect(windows).toContain('needs: verify')
    expect(windows).toContain('dist/latest.yml')
    expect(windows).not.toMatch(/APPLE_|CSC_/)
  })

  it('uploads private artifacts and creates a single draft after both builds', () => {
    const mac = job('build-mac', 'build-windows')
    const windows = job('build-windows', 'release-draft')
    const draft = job('release-draft')

    expect(mac).toContain('actions/upload-artifact@v4')
    expect(mac).toContain('name: release-mac')
    expect(windows).toContain('actions/upload-artifact@v4')
    expect(windows).toContain('name: release-windows')
    expect(draft).toContain('needs: [build-mac, build-windows]')
    expect(draft).toContain('actions/download-artifact@v4')
    expect(draft).toContain('pattern: release-*')
    expect(draft).toContain('node scripts/verify-release-assets.mjs release-assets')
    expect(workflow.match(/softprops\/action-gh-release@v3/g)).toHaveLength(1)
  })
})
