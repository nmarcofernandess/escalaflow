import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const tempDirs: string[] = []

function makeTempDir(label: string): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `${label}-`))
  tempDirs.push(tempDir)
  return tempDir
}

function writeFile(filePath: string, content = 'artifact'): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, content)
}

async function loadModule() {
  return import(pathToFileURL(path.resolve('scripts/verify-release-assets.mjs')).href)
}

describe('release asset inventory', () => {
  afterEach(() => {
    for (const tempDir of tempDirs.splice(0)) {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('accepts the exact public release inventory while ignoring proof artifacts', async () => {
    const version = '9.9.9'
    const distDir = makeTempDir('release-assets-exact')

    for (const fileName of [
      `EscalaFlow-${version}-arm64.dmg`,
      `EscalaFlow-${version}-arm64.dmg.blockmap`,
      `EscalaFlow-${version}-arm64.zip`,
      `EscalaFlow-${version}-arm64.zip.blockmap`,
      `EscalaFlow-Setup-${version}.exe`,
      `EscalaFlow-Setup-${version}.exe.blockmap`,
      'signed-mac.yml',
      'latest.yml',
    ]) {
      writeFile(path.join(distDir, fileName))
    }

    writeFile(path.join(distDir, 'proof', 'audit.txt'), 'receipt')

    const { expectedReleaseAssetsForVersion, verifyReleaseAssetInventory } = await loadModule()

    expect(expectedReleaseAssetsForVersion(version)).toEqual([
      `EscalaFlow-${version}-arm64.dmg`,
      `EscalaFlow-${version}-arm64.dmg.blockmap`,
      `EscalaFlow-${version}-arm64.zip`,
      `EscalaFlow-${version}-arm64.zip.blockmap`,
      `EscalaFlow-Setup-${version}.exe`,
      `EscalaFlow-Setup-${version}.exe.blockmap`,
      'latest.yml',
      'signed-mac.yml',
    ])

    expect(() => verifyReleaseAssetInventory(distDir, version)).not.toThrow()
  })

  it('rejects missing public release assets', async () => {
    const version = '9.9.9'
    const distDir = makeTempDir('release-assets-missing')

    for (const fileName of [
      `EscalaFlow-${version}-arm64.dmg`,
      `EscalaFlow-${version}-arm64.dmg.blockmap`,
      `EscalaFlow-${version}-arm64.zip`,
      `EscalaFlow-Setup-${version}.exe`,
      `EscalaFlow-Setup-${version}.exe.blockmap`,
      'signed-mac.yml',
      'latest.yml',
    ]) {
      writeFile(path.join(distDir, fileName))
    }

    const { verifyReleaseAssetInventory } = await loadModule()

    expect(() => verifyReleaseAssetInventory(distDir, version)).toThrow(/missing/i)
  })

  it('rejects unexpected assets including latest-mac metadata', async () => {
    const version = '9.9.9'
    const distDir = makeTempDir('release-assets-unexpected')

    for (const fileName of [
      `EscalaFlow-${version}-arm64.dmg`,
      `EscalaFlow-${version}-arm64.dmg.blockmap`,
      `EscalaFlow-${version}-arm64.zip`,
      `EscalaFlow-${version}-arm64.zip.blockmap`,
      `EscalaFlow-Setup-${version}.exe`,
      `EscalaFlow-Setup-${version}.exe.blockmap`,
      'signed-mac.yml',
      'latest.yml',
      'latest-mac.yml',
    ]) {
      writeFile(path.join(distDir, fileName))
    }

    const { verifyReleaseAssetInventory } = await loadModule()

    expect(() => verifyReleaseAssetInventory(distDir, version)).toThrow(/unexpected|latest-mac\.yml/i)
  })
})
