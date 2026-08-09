import fs from 'node:fs'
import path from 'node:path'

const PROOF_DIRECTORY_NAME = 'proof'

export function expectedReleaseAssetsForVersion(version) {
  return [
    `EscalaFlow-${version}-arm64.dmg`,
    `EscalaFlow-${version}-arm64.dmg.blockmap`,
    `EscalaFlow-${version}-arm64.zip`,
    `EscalaFlow-${version}-arm64.zip.blockmap`,
    `EscalaFlow-Setup-${version}.exe`,
    `EscalaFlow-Setup-${version}.exe.blockmap`,
    'signed-mac.yml',
    'latest.yml',
  ].sort()
}

export function verifyReleaseAssetInventory(distDir, version) {
  const expected = expectedReleaseAssetsForVersion(version)
  const expectedSet = new Set(expected)
  const actual = []
  const unexpected = []

  for (const entry of fs.readdirSync(distDir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (entry.name === PROOF_DIRECTORY_NAME) {
        continue
      }

      unexpected.push(`${entry.name}/`)
      continue
    }

    if (!entry.isFile()) {
      unexpected.push(entry.name)
      continue
    }

    actual.push(entry.name)

    if (!expectedSet.has(entry.name)) {
      unexpected.push(entry.name)
    }
  }

  const missing = expected.filter((entryName) => !actual.includes(entryName))

  if (missing.length > 0 || unexpected.length > 0) {
    const details = []

    if (missing.length > 0) {
      details.push(`missing: ${missing.sort().join(', ')}`)
    }

    if (unexpected.length > 0) {
      details.push(`unexpected: ${unexpected.sort().join(', ')}`)
    }

    throw new Error(`release asset inventory mismatch for ${distDir} (${version}) — ${details.join(' | ')}`)
  }

  return expected
}

function readPackageVersion() {
  const manifestPath = new URL('../package.json', import.meta.url)
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))

  if (!manifest.version || typeof manifest.version !== 'string') {
    throw new Error(`package.json version missing in ${manifestPath.pathname}`)
  }

  return manifest.version
}

function main(argv) {
  const [targetDir] = argv

  if (!targetDir) {
    throw new Error('usage: node scripts/verify-release-assets.mjs <release-assets-dir>')
  }

  const distDir = path.resolve(targetDir)
  const version = readPackageVersion()
  const verified = verifyReleaseAssetInventory(distDir, version)

  console.log(`verified ${verified.length} release assets for ${version} in ${distDir}`)
}

if (import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  try {
    main(process.argv.slice(2))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(message)
    process.exitCode = 1
  }
}
