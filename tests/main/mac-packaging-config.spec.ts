import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const yaml = require('js-yaml') as { load(source: string): unknown }
const { getNodeModuleFileMatcher } = require('app-builder-lib/out/fileMatcher') as {
  getNodeModuleFileMatcher: (...args: unknown[]) => {
    isEmpty: () => boolean
    createFilter: () => (filePath: string, stats: fs.Stats) => boolean
  }
}

interface BuilderTarget {
  target: string
  arch: string[]
}

interface PublishConfig {
  provider: string
  owner: string
  repo: string
  channel?: string
}

interface PlatformConfig {
  files?: string[]
  forceCodeSigning?: boolean
  type?: string
  hardenedRuntime?: boolean
  identity?: string
  entitlements?: string
  entitlementsInherit?: string
  binaries?: string[]
  target?: BuilderTarget[]
  notarize?: boolean
  publish?: PublishConfig
}

interface BuilderConfig {
  files?: string[]
  forceCodeSigning?: boolean
  mac?: PlatformConfig
  publish?: PublishConfig
  win?: {
    target?: BuilderTarget[]
    forceCodeSigning?: boolean
  }
}

function readBuilderConfig(): BuilderConfig {
  const parsed = yaml.load(fs.readFileSync('electron-builder.yml', 'utf8'))

  if (!parsed || typeof parsed !== 'object') throw new Error('electron-builder.yml did not parse into an object')

  return parsed as BuilderConfig
}

describe('macOS packaging trust contract', () => {
  const config = readBuilderConfig()
  const entitlements = fs.readFileSync('build/entitlements.mac.plist', 'utf8')
  const mac = config.mac
  const publish = config.publish
  const win = config.win

  it('requires signed and notarized arm64 targets only on macOS', () => {
    expect(mac).toBeDefined()
    expect(mac?.forceCodeSigning).toBe(true)
    expect(mac?.type).toBe('distribution')
    expect(mac?.hardenedRuntime).toBe(true)
    expect(mac?.notarize).toBe(true)
    expect(mac?.identity).toBeUndefined()
    expect(mac?.entitlements).toBe('build/entitlements.mac.plist')
    expect(mac?.entitlementsInherit).toBe('build/entitlements.mac.plist')
    expect(mac?.target).toEqual([
      { target: 'dmg', arch: ['arm64'] },
      { target: 'zip', arch: ['arm64'] },
    ])
    expect(config.forceCodeSigning).toBeUndefined()
  })

  it('declares every extensionless native sidecar', () => {
    expect(mac?.binaries).toEqual([
      'Contents/Resources/solver-bin/escalaflow-solver',
      'Contents/Resources/stt-bin/escalaflow-stt',
      'Contents/Resources/mcp-bin/escalaflow-mcp',
      'Contents/Resources/llama.cpp/darwin-arm64/llama-server',
    ])
  })

  it('prunes only the unused ONNX Darwin x64 native subtree', () => {
    expect(mac?.files).toEqual([
      '!node_modules/onnxruntime-node/bin/napi-v3/darwin/x64${/*}',
    ])
    expect(mac?.files).not.toContain(
      '!node_modules/onnxruntime-node/bin/napi-v3/darwin/arm64${/*}',
    )
  })

  it('applies the installed electron-builder matcher to real ONNX Darwin bindings', () => {
    const projectDir = path.resolve('.')
    const arm64Binding = path.join(
      projectDir,
      'node_modules/onnxruntime-node/bin/napi-v3/darwin/arm64/onnxruntime_binding.node',
    )
    const x64Binding = path.join(
      projectDir,
      'node_modules/onnxruntime-node/bin/napi-v3/darwin/x64/onnxruntime_binding.node',
    )

    expect(fs.existsSync(arm64Binding)).toBe(true)
    expect(fs.existsSync(x64Binding)).toBe(true)

    // Mirrors PlatformPackager.createGetFileMatchersOptions' { "/*": "{,/**/*}" } expansion.
    const macroExpander = (value: string): string => value.replace(/\$\{\/\*\}/g, '{,/**/*}')
    const packager = {
      config: { files: config.files },
      debugLogger: { isEnabled: false },
    }
    const matcher = getNodeModuleFileMatcher(
      projectDir,
      path.join(projectDir, 'dist', 'app'),
      macroExpander,
      { files: mac?.files },
      packager,
    )
    const filter = matcher.createFilter()

    expect(filter(arm64Binding, fs.statSync(arm64Binding))).toBe(true)
    expect(filter(x64Binding, fs.statSync(x64Binding))).toBe(false)

    const nonMacMatcher = getNodeModuleFileMatcher(
      projectDir,
      path.join(projectDir, 'dist', 'app'),
      macroExpander,
      {},
      packager,
    )
    // NodeModuleCopyHelper treats an empty matcher as no filter, retaining all files.
    expect(nonMacMatcher.isEmpty()).toBe(true)
    const nonMacFilter = nonMacMatcher.isEmpty() ? () => true : nonMacMatcher.createFilter()

    expect(nonMacFilter(arm64Binding, fs.statSync(arm64Binding))).toBe(true)
    expect(nonMacFilter(x64Binding, fs.statSync(x64Binding))).toBe(true)
  })

  it('isolates signed Mac updates without moving Windows off latest', () => {
    expect(mac?.publish).toEqual({
      provider: 'github',
      owner: 'nmarcofernandess',
      repo: 'escalaflow',
      channel: 'signed',
    })
    expect(publish).toEqual({
      provider: 'github',
      owner: 'nmarcofernandess',
      repo: 'escalaflow',
    })
    expect(win).toEqual({
      icon: 'icon.ico',
      target: [{ target: 'nsis', arch: ['x64'] }],
      artifactName: '${productName}-Setup-${version}.${ext}',
    })
    expect(win?.forceCodeSigning).toBeUndefined()
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
