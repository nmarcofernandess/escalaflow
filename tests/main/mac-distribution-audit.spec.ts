import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  findMacAssets,
  inspectMachO,
  parseMacUpdateYml,
  verifyMacDistribution,
  verifyMachORecords,
  verifySignatureMetadata,
} from '../../scripts/mac-distribution-audit.mjs'

const TEAM_ID = 'TEAM123456'

function writeFile(filePath: string, content = ''): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, content)
}

function makeTrackedTempDir(name: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`))
}

function makeSignedMacYml(version: string, zipName: string, sha512: string): string {
  return `version: ${version}
files:
  - url: ${zipName}
    sha512: ${sha512}
    size: 42
path: ${zipName}
sha512: ${sha512}
`
}

function makeApp(appRoot: string): string {
  const appPath = path.join(appRoot, 'EscalaFlow.app')
  writeFile(
    path.join(appPath, 'Contents/Resources/app-update.yml'),
    `provider: github
owner: nmarcofernandess
repo: escalaflow
channel: signed
`,
  )

  return appPath
}

function addNestedHelperApp(appPath: string): void {
  writeFile(path.join(appPath, 'Contents/Frameworks/EscalaFlow Helper.app/Contents/MacOS/helper'), 'helper')
}

describe('mac distribution audit', () => {
  const tempDirs: string[] = []

  afterEach(() => {
    for (const tempDir of tempDirs.splice(0)) {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('parses the update ZIP contract', () => {
    const info = parseMacUpdateYml(`version: 1.12.1
files:
  - url: EscalaFlow-1.12.1-arm64.zip
    sha512: abc123
    size: 42
path: EscalaFlow-1.12.1-arm64.zip
sha512: abc123
`)

    expect(info).toMatchObject({
      version: '1.12.1',
      zipName: 'EscalaFlow-1.12.1-arm64.zip',
      sha512: 'abc123',
    })
  })

  it('rejects latest-mac.yml in the signed inventory', () => {
    const distDir = makeTrackedTempDir('mac-audit-dist')
    tempDirs.push(distDir)

    for (const fileName of [
      'EscalaFlow-1.12.1-arm64.dmg',
      'EscalaFlow-1.12.1-arm64.dmg.blockmap',
      'EscalaFlow-1.12.1-arm64.zip',
      'EscalaFlow-1.12.1-arm64.zip.blockmap',
      'signed-mac.yml',
      'latest-mac.yml',
    ]) {
      writeFile(path.join(distDir, fileName), 'artifact')
    }

    expect(() => findMacAssets(distDir, '1.12.1', 'arm64')).toThrow(/latest-mac\.yml/i)
  })

  it('rejects extra stale mac release artifacts while ignoring intended windows files', () => {
    const distDir = makeTrackedTempDir('mac-audit-dist-exact')
    tempDirs.push(distDir)

    for (const fileName of [
      'EscalaFlow-1.12.1-arm64.dmg',
      'EscalaFlow-1.12.1-arm64.dmg.blockmap',
      'EscalaFlow-1.12.1-arm64.zip',
      'EscalaFlow-1.12.1-arm64.zip.blockmap',
      'signed-mac.yml',
      'EscalaFlow-1.12.0-arm64.zip',
      'EscalaFlow-1.12.0-arm64.dmg',
      'staging-mac.yml',
      'EscalaFlow-Setup-1.12.1.exe',
      'EscalaFlow-Setup-1.12.1.exe.blockmap',
      'latest.yml',
    ]) {
      writeFile(path.join(distDir, fileName), 'artifact')
    }

    expect(() => findMacAssets(distDir, '1.12.1', 'arm64')).toThrow(/unexpected mac artifacts|stale mac artifacts|extra mac/i)
  })

  it('rejects x64 and universal mac artifacts for the same product version', () => {
    const distDir = makeTrackedTempDir('mac-audit-dist-arch-leak')
    tempDirs.push(distDir)

    for (const fileName of [
      'EscalaFlow-1.12.1-arm64.dmg',
      'EscalaFlow-1.12.1-arm64.dmg.blockmap',
      'EscalaFlow-1.12.1-arm64.zip',
      'EscalaFlow-1.12.1-arm64.zip.blockmap',
      'signed-mac.yml',
      'EscalaFlow-1.12.1-x64.zip',
      'EscalaFlow-1.12.1-universal.dmg',
      'EscalaFlow-Setup-1.12.1.exe',
      'EscalaFlow-Setup-1.12.1.exe.blockmap',
      'latest.yml',
    ]) {
      writeFile(path.join(distDir, fileName), 'artifact')
    }

    expect(() => findMacAssets(distDir, '1.12.1', 'arm64')).toThrow(/unexpected mac artifacts|x64|universal/i)
  })

  it('skips symlink loops while inspecting Mach-O payloads', () => {
    const rootDir = makeTrackedTempDir('mac-audit-app')
    tempDirs.push(rootDir)

    const appPath = path.join(rootDir, 'EscalaFlow.app')
    const machOPath = path.join(appPath, 'Contents/Resources/solver-bin/escalaflow-solver')
    writeFile(machOPath, 'solver')
    writeFile(path.join(appPath, 'Contents/Resources/readme.txt'), 'plain text')
    fs.symlinkSync(appPath, path.join(appPath, 'Contents/Resources/loop'))

    const runCommand = vi.fn((command: string, args: string[]) => {
      const subject = args.at(-1) ?? ''

      if (command === 'file') {
        return {
          stdout: subject === machOPath ? 'Mach-O 64-bit executable arm64' : 'ASCII text',
          stderr: '',
          combined: subject === machOPath ? 'Mach-O 64-bit executable arm64' : 'ASCII text',
        }
      }

      if (command === 'codesign' && args[0] === '--verify') {
        return { stdout: '', stderr: '', combined: '' }
      }

      if (command === 'codesign' && args[0] === '-dvvv') {
        return {
          stdout: '',
          stderr: '',
          combined: `Authority=Developer ID Application: EscalaFlow (${TEAM_ID})
TeamIdentifier=${TEAM_ID}
Timestamp=Aug 9, 2026 at 12:00:00
`,
        }
      }

      if (command === 'lipo') {
        return { stdout: 'arm64', stderr: '', combined: 'arm64' }
      }

      throw new Error(`unexpected command: ${command} ${args.join(' ')}`)
    })

    const records = inspectMachO(appPath, runCommand)

    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({
      path: machOPath,
      relativePath: 'Contents/Resources/solver-bin/escalaflow-solver',
      architectures: ['arm64'],
      teamId: TEAM_ID,
      valid: true,
    })
    expect(runCommand.mock.calls.map(([, args]) => args.at(-1))).not.toContain(path.join(appPath, 'Contents/Resources/loop'))
  })

  it('rejects a nested binary from another team', () => {
    expect(() =>
      verifyMachORecords(
        [
          {
            path: '/app/solver',
            architectures: ['arm64'],
            teamId: 'WRONGTEAM',
            timestamp: 'Aug 9, 2026 at 12:00:00',
            valid: true,
          },
        ],
        { teamId: TEAM_ID, arch: 'arm64' },
      ),
    ).toThrow(/WRONGTEAM/)
  })

  it('rejects debug entitlement on the outer app', () => {
    expect(() =>
      verifySignatureMetadata(
        {
          authority: `Developer ID Application: EscalaFlow (${TEAM_ID})`,
          teamId: TEAM_ID,
          timestamp: 'Aug 9, 2026 at 12:00:00',
          entitlements: '<key>com.apple.security.get-task-allow</key><true />',
        },
        TEAM_ID,
      ),
    ).toThrow(/get-task-allow/)
  })

  it('rejects a missing secure timestamp even when authority and team match', () => {
    expect(() =>
      verifySignatureMetadata(
        {
          authority: `Developer ID Application: EscalaFlow (${TEAM_ID})`,
          teamId: TEAM_ID,
          timestamp: '',
          entitlements: '<plist></plist>',
        },
        TEAM_ID,
      ),
    ).toThrow(/timestamp/i)
  })

  it('cleans the extracted ZIP temp dir when the embedded app fails verification', async () => {
    const rootDir = makeTrackedTempDir('mac-audit-zip')
    tempDirs.push(rootDir)

    const appPath = makeApp(path.join(rootDir, 'packaged'))
    const distDir = path.join(rootDir, 'dist')
    fs.mkdirSync(distDir, { recursive: true })

    const zipName = 'EscalaFlow-1.12.1-arm64.zip'
    const zipPath = path.join(distDir, zipName)
    const zipSha512 = crypto.createHash('sha512').update('zip-bytes').digest('base64')

    writeFile(zipPath, 'zip-bytes')
    writeFile(path.join(distDir, 'EscalaFlow-1.12.1-arm64.dmg'), 'dmg')
    writeFile(path.join(distDir, 'EscalaFlow-1.12.1-arm64.dmg.blockmap'), 'dmg-blockmap')
    writeFile(path.join(distDir, 'EscalaFlow-1.12.1-arm64.zip.blockmap'), 'zip-blockmap')
    writeFile(path.join(distDir, 'signed-mac.yml'), makeSignedMacYml('1.12.1', zipName, zipSha512))

    const createdTempDirs: string[] = []
    const verifySignedAppFn = vi.fn(async ({ appPath: candidatePath }: { appPath: string }) => {
      const zipTempDir = createdTempDirs[0] ?? ''

      if (zipTempDir && candidatePath.startsWith(zipTempDir)) {
        throw new Error('embedded zip app failed verification')
      }

      return { appPath: candidatePath, machORecords: [] }
    })

    const runCommand = vi.fn((command: string, args: string[]) => {
      if (command === 'ditto' && args[0] === '-xk') {
        const targetDir = args[2]
        makeApp(targetDir)
        return { stdout: '', stderr: '', combined: '' }
      }

      throw new Error(`unexpected command: ${command} ${args.join(' ')}`)
    })

    await expect(
      verifyMacDistribution({
        appPath,
        distDir,
        teamId: TEAM_ID,
        version: '1.12.1',
        arch: 'arm64',
        runCommand,
        verifySignedAppFn,
        createTempDir: (label: string) => {
          const tempDir = path.join(rootDir, `temp-${label}-${createdTempDirs.length + 1}`)
          createdTempDirs.push(tempDir)
          fs.mkdirSync(tempDir, { recursive: true })
          return tempDir
        },
      }),
    ).rejects.toThrow(/embedded zip app failed verification/)

    expect(createdTempDirs).toHaveLength(1)
    expect(fs.existsSync(createdTempDirs[0])).toBe(false)
  })

  it('detaches the mounted DMG and cleans the mount dir when the embedded app fails verification', async () => {
    const rootDir = makeTrackedTempDir('mac-audit-dmg')
    tempDirs.push(rootDir)

    const appPath = makeApp(path.join(rootDir, 'packaged'))
    const distDir = path.join(rootDir, 'dist')
    fs.mkdirSync(distDir, { recursive: true })

    const zipName = 'EscalaFlow-1.12.1-arm64.zip'
    const zipPath = path.join(distDir, zipName)
    const zipSha512 = crypto.createHash('sha512').update('zip-bytes').digest('base64')

    writeFile(zipPath, 'zip-bytes')
    writeFile(path.join(distDir, 'EscalaFlow-1.12.1-arm64.dmg'), 'dmg')
    writeFile(path.join(distDir, 'EscalaFlow-1.12.1-arm64.dmg.blockmap'), 'dmg-blockmap')
    writeFile(path.join(distDir, 'EscalaFlow-1.12.1-arm64.zip.blockmap'), 'zip-blockmap')
    writeFile(path.join(distDir, 'signed-mac.yml'), makeSignedMacYml('1.12.1', zipName, zipSha512))

    const createdTempDirs: string[] = []
    const verifySignedAppFn = vi.fn(async ({ appPath: candidatePath }: { appPath: string }) => {
      const mountDir = createdTempDirs[1] ?? ''

      if (mountDir && candidatePath.startsWith(mountDir)) {
        throw new Error('embedded dmg app failed verification')
      }

      return { appPath: candidatePath, machORecords: [] }
    })

    const runCommand = vi.fn((command: string, args: string[]) => {
      if (command === 'ditto' && args[0] === '-xk') {
        makeApp(args[2])
        return { stdout: '', stderr: '', combined: '' }
      }

      if (command === 'hdiutil' && args[0] === 'attach') {
        const mountDir = args[args.indexOf('-mountpoint') + 1]
        makeApp(mountDir)
        writeFile(path.join(mountDir, 'LEIA ANTES DE INSTALAR.txt'), 'Abra normalmente. Se algo falhar, pare e fale com o suporte.')
        return { stdout: '', stderr: '', combined: 'attached' }
      }

      if (command === 'hdiutil' && args[0] === 'detach') {
        return { stdout: '', stderr: '', combined: 'detached' }
      }

      throw new Error(`unexpected command: ${command} ${args.join(' ')}`)
    })

    await expect(
      verifyMacDistribution({
        appPath,
        distDir,
        teamId: TEAM_ID,
        version: '1.12.1',
        arch: 'arm64',
        runCommand,
        verifySignedAppFn,
        createTempDir: (label: string) => {
          const tempDir = path.join(rootDir, `temp-${label}-${createdTempDirs.length + 1}`)
          createdTempDirs.push(tempDir)
          fs.mkdirSync(tempDir, { recursive: true })
          return tempDir
        },
      }),
    ).rejects.toThrow(/embedded dmg app failed verification/)

    expect(createdTempDirs).toHaveLength(2)
    expect(runCommand).toHaveBeenCalledWith('hdiutil', ['detach', createdTempDirs[1]])
    expect(fs.existsSync(createdTempDirs[1])).toBe(false)
  })

  it('still removes the mount dir when detach throws and preserves the primary verification failure', async () => {
    const rootDir = makeTrackedTempDir('mac-audit-dmg-detach-fails')
    tempDirs.push(rootDir)

    const appPath = makeApp(path.join(rootDir, 'packaged'))
    const distDir = path.join(rootDir, 'dist')
    fs.mkdirSync(distDir, { recursive: true })

    const zipName = 'EscalaFlow-1.12.1-arm64.zip'
    const zipSha512 = crypto.createHash('sha512').update('zip-bytes').digest('base64')

    writeFile(path.join(distDir, zipName), 'zip-bytes')
    writeFile(path.join(distDir, 'EscalaFlow-1.12.1-arm64.dmg'), 'dmg')
    writeFile(path.join(distDir, 'EscalaFlow-1.12.1-arm64.dmg.blockmap'), 'dmg-blockmap')
    writeFile(path.join(distDir, 'EscalaFlow-1.12.1-arm64.zip.blockmap'), 'zip-blockmap')
    writeFile(path.join(distDir, 'signed-mac.yml'), makeSignedMacYml('1.12.1', zipName, zipSha512))

    const createdTempDirs: string[] = []
    const verifySignedAppFn = vi.fn(async ({ appPath: candidatePath }: { appPath: string }) => {
      const mountDir = createdTempDirs[1] ?? ''

      if (mountDir && candidatePath.startsWith(mountDir)) {
        throw new Error('primary dmg verification failure')
      }

      return { appPath: candidatePath, machORecords: [] }
    })

    const runCommand = vi.fn((command: string, args: string[]) => {
      if (command === 'ditto' && args[0] === '-xk') {
        makeApp(args[2])
        return { stdout: '', stderr: '', combined: '' }
      }

      if (command === 'hdiutil' && args[0] === 'attach') {
        const mountDir = args[args.indexOf('-mountpoint') + 1]
        makeApp(mountDir)
        writeFile(path.join(mountDir, 'LEIA ANTES DE INSTALAR.txt'), 'Abra normalmente. Se algo falhar, pare e fale com o suporte.')
        return { stdout: '', stderr: '', combined: 'attached' }
      }

      if (command === 'hdiutil' && args[0] === 'detach') {
        throw new Error('detach failure')
      }

      throw new Error(`unexpected command: ${command} ${args.join(' ')}`)
    })

    await expect(
      verifyMacDistribution({
        appPath,
        distDir,
        teamId: TEAM_ID,
        version: '1.12.1',
        arch: 'arm64',
        runCommand,
        verifySignedAppFn,
        createTempDir: (label: string) => {
          const tempDir = path.join(rootDir, `temp-${label}-${createdTempDirs.length + 1}`)
          createdTempDirs.push(tempDir)
          fs.mkdirSync(tempDir, { recursive: true })
          return tempDir
        },
      }),
    ).rejects.toThrow(/primary dmg verification failure.*detach failure|detach failure.*primary dmg verification failure/i)

    expect(createdTempDirs).toHaveLength(2)
    expect(runCommand).toHaveBeenCalledWith('hdiutil', ['detach', createdTempDirs[1]])
    expect(fs.existsSync(createdTempDirs[1])).toBe(false)
  })

  it('still removes the zip temp dir when cleanup throws and preserves the primary verification failure', async () => {
    const rootDir = makeTrackedTempDir('mac-audit-zip-cleanup-fails')
    tempDirs.push(rootDir)

    const appPath = makeApp(path.join(rootDir, 'packaged'))
    const distDir = path.join(rootDir, 'dist')
    fs.mkdirSync(distDir, { recursive: true })

    const zipName = 'EscalaFlow-1.12.1-arm64.zip'
    const zipSha512 = crypto.createHash('sha512').update('zip-bytes').digest('base64')

    writeFile(path.join(distDir, zipName), 'zip-bytes')
    writeFile(path.join(distDir, 'EscalaFlow-1.12.1-arm64.dmg'), 'dmg')
    writeFile(path.join(distDir, 'EscalaFlow-1.12.1-arm64.dmg.blockmap'), 'dmg-blockmap')
    writeFile(path.join(distDir, 'EscalaFlow-1.12.1-arm64.zip.blockmap'), 'zip-blockmap')
    writeFile(path.join(distDir, 'signed-mac.yml'), makeSignedMacYml('1.12.1', zipName, zipSha512))

    const createdTempDirs: string[] = []
    const realFs = fs
    const verifySignedAppFn = vi.fn(async ({ appPath: candidatePath }: { appPath: string }) => {
      const zipTempDir = createdTempDirs[0] ?? ''

      if (zipTempDir && candidatePath.startsWith(zipTempDir)) {
        throw new Error('primary zip verification failure')
      }

      return { appPath: candidatePath, machORecords: [] }
    })

    const runCommand = vi.fn((command: string, args: string[]) => {
      if (command === 'ditto' && args[0] === '-xk') {
        makeApp(args[2])
        return { stdout: '', stderr: '', combined: '' }
      }

      if (command === 'hdiutil' && args[0] === 'attach') {
        const mountDir = args[args.indexOf('-mountpoint') + 1]
        makeApp(mountDir)
        writeFile(path.join(mountDir, 'LEIA ANTES DE INSTALAR.txt'), 'Abra normalmente. Se algo falhar, pare e fale com o suporte.')
        return { stdout: '', stderr: '', combined: 'attached' }
      }

      if (command === 'hdiutil' && args[0] === 'detach') {
        return { stdout: '', stderr: '', combined: 'detached' }
      }

      throw new Error(`unexpected command: ${command} ${args.join(' ')}`)
    })

    const fsAdapter = {
      ...realFs,
      rmSync: (targetPath: fs.PathLike, options?: fs.RmOptions) => {
        realFs.rmSync(targetPath, options)

        if (String(targetPath) === createdTempDirs[0]) {
          throw new Error('zip cleanup failure')
        }
      },
    }

    await expect(
      verifyMacDistribution(
        {
          appPath,
          distDir,
          teamId: TEAM_ID,
          version: '1.12.1',
          arch: 'arm64',
          runCommand,
          verifySignedAppFn,
          createTempDir: (label: string) => {
            const tempDir = path.join(rootDir, `temp-${label}-${createdTempDirs.length + 1}`)
            createdTempDirs.push(tempDir)
            fs.mkdirSync(tempDir, { recursive: true })
            return tempDir
          },
        },
        { fsAdapter },
      ),
    ).rejects.toThrow(/primary zip verification failure.*zip cleanup failure|zip cleanup failure.*primary zip verification failure/i)

    expect(createdTempDirs).toHaveLength(1)
    expect(fs.existsSync(createdTempDirs[0])).toBe(false)
  })

  it('accepts the top-level EscalaFlow.app even when nested helper apps exist inside it', async () => {
    const rootDir = makeTrackedTempDir('mac-audit-helper-apps')
    tempDirs.push(rootDir)

    const appPath = makeApp(path.join(rootDir, 'packaged'))
    addNestedHelperApp(appPath)

    const distDir = path.join(rootDir, 'dist')
    fs.mkdirSync(distDir, { recursive: true })

    const zipName = 'EscalaFlow-1.12.1-arm64.zip'
    const zipSha512 = crypto.createHash('sha512').update('zip-bytes').digest('base64')

    writeFile(path.join(distDir, zipName), 'zip-bytes')
    writeFile(path.join(distDir, 'EscalaFlow-1.12.1-arm64.dmg'), 'dmg')
    writeFile(path.join(distDir, 'EscalaFlow-1.12.1-arm64.dmg.blockmap'), 'dmg-blockmap')
    writeFile(path.join(distDir, 'EscalaFlow-1.12.1-arm64.zip.blockmap'), 'zip-blockmap')
    writeFile(path.join(distDir, 'signed-mac.yml'), makeSignedMacYml('1.12.1', zipName, zipSha512))

    const verifySignedAppFn = vi.fn(async ({ appPath: candidatePath }: { appPath: string }) => ({
      appPath: candidatePath,
      machORecords: [],
    }))

    const runCommand = vi.fn((command: string, args: string[]) => {
      if (command === 'ditto' && args[0] === '-xk') {
        const extractedApp = makeApp(args[2])
        addNestedHelperApp(extractedApp)
        return { stdout: '', stderr: '', combined: '' }
      }

      if (command === 'hdiutil' && args[0] === 'attach') {
        const mountDir = args[args.indexOf('-mountpoint') + 1]
        const mountedApp = makeApp(mountDir)
        addNestedHelperApp(mountedApp)
        writeFile(path.join(mountDir, 'LEIA ANTES DE INSTALAR.txt'), 'Abra normalmente. Se algo falhar, pare e fale com o suporte.')
        return { stdout: '', stderr: '', combined: 'attached' }
      }

      if (command === 'hdiutil' && args[0] === 'detach') {
        return { stdout: '', stderr: '', combined: 'detached' }
      }

      throw new Error(`unexpected command: ${command} ${args.join(' ')}`)
    })

    const summary = await verifyMacDistribution({
      appPath,
      distDir,
      teamId: TEAM_ID,
      version: '1.12.1',
      arch: 'arm64',
      runCommand,
      verifySignedAppFn,
    })

    expect(summary.artifactNames).toMatchObject({
      dmg: 'EscalaFlow-1.12.1-arm64.dmg',
      zip: 'EscalaFlow-1.12.1-arm64.zip',
      signedMacYml: 'signed-mac.yml',
    })
    expect(verifySignedAppFn).toHaveBeenCalledTimes(3)
    expect(verifySignedAppFn.mock.calls.map(([call]) => call.appPath.endsWith('EscalaFlow.app'))).toEqual([true, true, true])
  })
})
