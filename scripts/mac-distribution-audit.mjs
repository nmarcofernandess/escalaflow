import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const REQUIRED_MAC_ASSET_NAMES = [
  'dmg',
  'dmgBlockmap',
  'zip',
  'zipBlockmap',
  'signedMacYml',
]

const REQUIRED_SIDECAR_PATHS = [
  'Contents/Resources/solver-bin/escalaflow-solver',
  'Contents/Resources/stt-bin/escalaflow-stt',
  'Contents/Resources/mcp-bin/escalaflow-mcp',
  'Contents/Resources/llama.cpp/darwin-arm64/llama-server',
]

const DMG_BYPASS_MARKERS = [
  /xattr\b/i,
  /codesign\s+--remove-signature/i,
  /Open Anyway/i,
  /Abrir Mesmo Assim/i,
  /Control-?click/i,
  /Instalar-EscalaFlow\.command/i,
]

const MAC_METADATA_PATTERN = /(?:^|-)mac\.yml$/

function getFs(dependencies = {}) {
  return dependencies.fsAdapter ?? fs
}

function getPath(dependencies = {}) {
  return dependencies.pathAdapter ?? path
}

function getOs(dependencies = {}) {
  return dependencies.osAdapter ?? os
}

function lineValue(text, pattern, label) {
  const match = text.match(pattern)
  const value = match?.[1]?.trim()

  if (!value) {
    throw new Error(`missing ${label} in YAML payload`)
  }

  return value
}

function ensureExists(targetPath, label, fsAdapter) {
  if (!fsAdapter.existsSync(targetPath)) {
    throw new Error(`${label} is missing: ${targetPath}`)
  }
}

function toPosixPath(value) {
  return value.split(path.sep).join(path.posix.sep)
}

function parseCodesignDisplay(combined, entitlements = '') {
  const authority = combined.match(/^Authority=(.+)$/m)?.[1]?.trim() ?? ''
  const teamId = combined.match(/^TeamIdentifier=(.+)$/m)?.[1]?.trim() ?? ''
  const timestamp = combined.match(/^Timestamp=(.+)$/m)?.[1]?.trim() ?? ''

  return { authority, teamId, timestamp, entitlements }
}

function parseAppUpdateYml(text) {
  return {
    provider: lineValue(text, /^provider:\s*(.+)$/m, 'provider'),
    owner: lineValue(text, /^owner:\s*(.+)$/m, 'owner'),
    repo: lineValue(text, /^repo:\s*(.+)$/m, 'repo'),
    channel: lineValue(text, /^channel:\s*(.+)$/m, 'channel'),
  }
}

function verifyMountedReadme(text) {
  for (const marker of DMG_BYPASS_MARKERS) {
    if (marker.test(text)) {
      throw new Error(`mounted DMG readme contains bypass marker: ${marker}`)
    }
  }
}

function createDefaultTempDirFactory(dependencies = {}) {
  const fsAdapter = getFs(dependencies)
  const osAdapter = getOs(dependencies)

  return (label) => fsAdapter.mkdtempSync(path.join(osAdapter.tmpdir(), `mac-distribution-audit-${label}-`))
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function isMacReleaseArtifactForVersion(entryName, version) {
  const escapedVersion = escapeRegExp(version)
  const productVersionPattern = new RegExp(`^EscalaFlow-${escapedVersion}-(.+)\\.(dmg|zip)(\\.blockmap)?$`)

  return productVersionPattern.test(entryName) || MAC_METADATA_PATTERN.test(entryName)
}

function listUnexpectedMacArtifacts(distDir, version, allowedEntries, dependencies = {}) {
  const fsAdapter = getFs(dependencies)
  const disallowedEntries = []

  for (const entryName of fsAdapter.readdirSync(distDir)) {
    if (!isMacReleaseArtifactForVersion(entryName, version)) {
      continue
    }

    if (!allowedEntries.has(entryName)) {
      disallowedEntries.push(entryName)
    }
  }

  return disallowedEntries.sort()
}

function combineErrors(primaryError, cleanupErrors, contextLabel) {
  if (cleanupErrors.length === 0) {
    if (primaryError) {
      throw primaryError
    }

    return
  }

  const cleanupMessage = cleanupErrors.map((error) => error.message).join('; ')

  if (primaryError) {
    throw new Error(`${primaryError.message}; ${contextLabel} cleanup failed: ${cleanupMessage}`, { cause: primaryError })
  }

  throw new Error(`${contextLabel} cleanup failed: ${cleanupMessage}`, { cause: cleanupErrors[0] })
}

function collectAppBundles(rootPath, dependencies = {}) {
  const fsAdapter = getFs(dependencies)
  const pathAdapter = getPath(dependencies)
  const appPaths = []

  const walk = (currentPath) => {
    const stats = fsAdapter.lstatSync(currentPath)

    if (stats.isSymbolicLink()) {
      return
    }

    if (stats.isDirectory()) {
      const baseName = pathAdapter.basename(currentPath)

      if (baseName === 'EscalaFlow.app') {
        appPaths.push(currentPath)
        return
      }

      if (currentPath.endsWith('.app')) {
        return
      }

      for (const entry of fsAdapter.readdirSync(currentPath)) {
        walk(pathAdapter.join(currentPath, entry))
      }
    }
  }

  walk(rootPath)

  return appPaths
}

function findExactlyOneApp(rootPath, dependencies = {}) {
  const appPaths = collectAppBundles(rootPath, dependencies)

  if (appPaths.length !== 1) {
    throw new Error(`expected exactly one EscalaFlow.app in ${rootPath}, found ${appPaths.length}`)
  }

  return appPaths[0]
}

function verifyRequiredMachOPaths(records) {
  const recordPaths = new Set(records.map((record) => record.relativePath))

  for (const requiredPath of REQUIRED_SIDECAR_PATHS) {
    if (!recordPaths.has(requiredPath)) {
      throw new Error(`missing required native sidecar: ${requiredPath}`)
    }
  }
}

export function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  })
  const stdout = result.stdout ?? ''
  const stderr = result.stderr ?? ''
  const combined = [stdout, stderr].filter(Boolean).join('\n')

  if (result.error) {
    throw result.error
  }

  if (result.status !== 0) {
    throw new Error(`${command} exited ${result.status}: ${combined}`)
  }

  return { stdout, stderr, combined }
}

export function parseMacUpdateYml(text) {
  const version = lineValue(text, /^version:\s*(.+)$/m, 'version')
  const zipName = lineValue(text, /^path:\s*(.+)$/m, 'path')
  const sha512 = lineValue(text, /^sha512:\s*(.+)$/m, 'sha512')
  const nestedZipName = text.match(/^\s+-\s+url:\s*(.+)$/m)?.[1]?.trim() ?? zipName
  const nestedSha512 = text.match(/^\s+sha512:\s*(.+)$/m)?.[1]?.trim() ?? sha512
  const size = Number(text.match(/^\s+size:\s*(\d+)$/m)?.[1] ?? 0)

  if (zipName !== nestedZipName) {
    throw new Error(`signed-mac.yml path mismatch: ${zipName} !== ${nestedZipName}`)
  }

  if (sha512 !== nestedSha512) {
    throw new Error('signed-mac.yml sha512 mismatch between top-level and files[0]')
  }

  return { version, zipName, sha512, size }
}

export function verifySignatureMetadata(metadata, expectedTeamId) {
  if (!metadata.authority.startsWith('Developer ID Application:')) {
    throw new Error(`invalid authority: ${metadata.authority}`)
  }

  if (metadata.teamId !== expectedTeamId) {
    throw new Error(`unexpected TeamIdentifier: ${metadata.teamId}`)
  }

  if (!metadata.timestamp) {
    throw new Error('secure timestamp is missing')
  }

  if (/<key>com\.apple\.security\.get-task-allow<\/key>\s*<true\s*\/>/.test(metadata.entitlements)) {
    throw new Error('get-task-allow=true is forbidden')
  }
}

export function verifyMachORecords(records, expected) {
  for (const record of records) {
    if (!record.valid) {
      throw new Error(`invalid code signature: ${record.path}`)
    }

    if (record.teamId !== expected.teamId) {
      throw new Error(`unexpected TeamIdentifier ${record.teamId}: ${record.path}`)
    }

    const architectures = new Set(record.architectures)

    if (!architectures.has(expected.arch)) {
      throw new Error(`missing ${expected.arch}: ${record.path}`)
    }

    if (architectures.size !== 1) {
      throw new Error(
        `unexpected architecture set [${[...architectures].join(', ')}], expected exactly [${expected.arch}]: ${record.path}`,
      )
    }

    if (!record.timestamp) {
      throw new Error(`secure timestamp is missing: ${record.path}`)
    }
  }
}

export function findMacAssets(distDir, version, arch, dependencies = {}) {
  const fsAdapter = getFs(dependencies)
  const pathAdapter = getPath(dependencies)
  const artifactBase = `EscalaFlow-${version}-${arch}`
  const assets = {
    dmg: pathAdapter.join(distDir, `${artifactBase}.dmg`),
    dmgBlockmap: pathAdapter.join(distDir, `${artifactBase}.dmg.blockmap`),
    zip: pathAdapter.join(distDir, `${artifactBase}.zip`),
    zipBlockmap: pathAdapter.join(distDir, `${artifactBase}.zip.blockmap`),
    signedMacYml: pathAdapter.join(distDir, 'signed-mac.yml'),
    latestMacYml: pathAdapter.join(distDir, 'latest-mac.yml'),
  }
  const allowedEntries = new Set([
    `${artifactBase}.dmg`,
    `${artifactBase}.dmg.blockmap`,
    `${artifactBase}.zip`,
    `${artifactBase}.zip.blockmap`,
    'signed-mac.yml',
  ])

  for (const assetName of REQUIRED_MAC_ASSET_NAMES) {
    ensureExists(assets[assetName], assetName, fsAdapter)
  }

  if (fsAdapter.existsSync(assets.latestMacYml)) {
    throw new Error(`latest-mac.yml is forbidden for signed macOS releases: ${assets.latestMacYml}`)
  }

  const unexpectedMacArtifacts = listUnexpectedMacArtifacts(distDir, version, allowedEntries, dependencies)
  if (unexpectedMacArtifacts.length > 0) {
    throw new Error(`unexpected mac artifacts in ${distDir}: ${unexpectedMacArtifacts.join(', ')}`)
  }

  return assets
}

export function inspectMachO(appPath, runCommandImpl, dependencies = {}) {
  const fsAdapter = getFs(dependencies)
  const pathAdapter = getPath(dependencies)
  const records = []

  const walk = (currentPath) => {
    const stats = fsAdapter.lstatSync(currentPath)

    if (stats.isSymbolicLink()) {
      return
    }

    if (stats.isDirectory()) {
      for (const entry of fsAdapter.readdirSync(currentPath)) {
        walk(pathAdapter.join(currentPath, entry))
      }
      return
    }

    if (!stats.isFile()) {
      return
    }

    const fileInfo = runCommandImpl('file', ['-b', currentPath])

    if (!/Mach-O/.test(fileInfo.combined)) {
      return
    }

    const relativePath = toPosixPath(pathAdapter.relative(appPath, currentPath))
    const record = {
      path: currentPath,
      relativePath,
      architectures: [],
      teamId: '',
      authority: '',
      timestamp: '',
      valid: true,
    }

    try {
      runCommandImpl('codesign', ['--verify', '--strict', '--verbose=2', currentPath])
    } catch (_error) {
      record.valid = false
    }

    try {
      const signatureDetails = runCommandImpl('codesign', ['-dvvv', currentPath])
      const metadata = parseCodesignDisplay(signatureDetails.combined)
      record.teamId = metadata.teamId
      record.authority = metadata.authority
      record.timestamp = metadata.timestamp
    } catch (_error) {
      record.valid = false
    }

    try {
      const archs = runCommandImpl('lipo', ['-archs', currentPath])
      record.architectures = archs.combined.trim().split(/\s+/).filter(Boolean)
    } catch (_error) {
      record.valid = false
    }

    records.push(record)
  }

  walk(appPath)

  return records
}

export function verifySignedApp({ appPath, teamId, version, arch, runCommand: runCommandImpl }, dependencies = {}) {
  const fsAdapter = getFs(dependencies)
  const pathAdapter = getPath(dependencies)

  ensureExists(appPath, 'app bundle', fsAdapter)
  if (!appPath.endsWith('.app')) {
    throw new Error(`expected a .app bundle: ${appPath}`)
  }

  runCommandImpl('codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath])
  const signatureDetails = runCommandImpl('codesign', ['-dvvv', appPath])
  const entitlements = runCommandImpl('codesign', ['-d', '--entitlements', ':-', appPath])
  const metadata = parseCodesignDisplay(signatureDetails.combined, entitlements.combined)
  verifySignatureMetadata(metadata, teamId)

  runCommandImpl('xcrun', ['stapler', 'validate', appPath])
  const spctl = runCommandImpl('spctl', ['--assess', '--verbose=4', '--type', 'exec', appPath])
  if (!/Notarized Developer ID/i.test(spctl.combined)) {
    throw new Error(`spctl did not report Notarized Developer ID: ${spctl.combined}`)
  }

  const machORecords = inspectMachO(appPath, runCommandImpl, dependencies)
  verifyMachORecords(machORecords, { teamId, arch })
  verifyRequiredMachOPaths(machORecords)

  return {
    appPath,
    version,
    arch,
    authority: metadata.authority,
    teamId: metadata.teamId,
    machORecords,
    gateStatuses: {
      codesignDeepStrict: 'passed',
      developerIdAuthority: 'passed',
      secureTimestamp: 'passed',
      getTaskAllowForbidden: 'passed',
      staplerValidate: 'passed',
      spctlNotarizedDeveloperId: 'passed',
      nestedMachOInventory: 'passed',
      nestedMachOSignatures: 'passed',
    },
  }
}

export async function verifyMacDistribution(
  {
    appPath,
    distDir,
    teamId,
    version,
    arch,
    runCommand: runCommandImpl,
    verifySignedAppFn: verifySignedAppFnOverride,
    createTempDir: createTempDirOverride,
  },
  dependencies = {},
) {
  const fsAdapter = getFs(dependencies)
  const pathAdapter = getPath(dependencies)
  const verifySignedAppFn = verifySignedAppFnOverride ?? dependencies.verifySignedAppFn ?? verifySignedApp
  const createTempDir = createTempDirOverride ?? dependencies.createTempDir ?? createDefaultTempDirFactory(dependencies)

  const packagedAppReport = await verifySignedAppFn({ appPath, distDir, teamId, version, arch, runCommand: runCommandImpl }, dependencies)
  const assets = findMacAssets(distDir, version, arch, dependencies)
  const signedMacYml = parseMacUpdateYml(fsAdapter.readFileSync(assets.signedMacYml, 'utf8'))

  if (signedMacYml.version !== version) {
    throw new Error(`signed-mac.yml version mismatch: ${signedMacYml.version} !== ${version}`)
  }

  const expectedZipName = pathAdapter.basename(assets.zip)
  if (signedMacYml.zipName !== expectedZipName) {
    throw new Error(`signed-mac.yml zip mismatch: ${signedMacYml.zipName} !== ${expectedZipName}`)
  }

  const actualZipSha512 = crypto.createHash('sha512').update(fsAdapter.readFileSync(assets.zip)).digest('base64')
  if (signedMacYml.sha512 !== actualZipSha512) {
    throw new Error('signed-mac.yml sha512 does not match the actual ZIP artifact')
  }

  const appUpdateYmlPath = pathAdapter.join(appPath, 'Contents/Resources/app-update.yml')
  ensureExists(appUpdateYmlPath, 'app-update.yml', fsAdapter)
  const appUpdate = parseAppUpdateYml(fsAdapter.readFileSync(appUpdateYmlPath, 'utf8'))

  if (appUpdate.owner !== 'nmarcofernandess' || appUpdate.repo !== 'escalaflow' || appUpdate.channel !== 'signed') {
    throw new Error(`unexpected app-update.yml contract: ${JSON.stringify(appUpdate)}`)
  }

  const zipTempDir = createTempDir('zip')
  let zippedAppReport
  let zipPrimaryError = null

  try {
    runCommandImpl('ditto', ['-xk', assets.zip, zipTempDir])
    const zippedAppPath = findExactlyOneApp(zipTempDir, dependencies)
    zippedAppReport = await verifySignedAppFn(
      { appPath: zippedAppPath, distDir, teamId, version, arch, runCommand: runCommandImpl },
      dependencies,
    )
  } catch (error) {
    zipPrimaryError = error
  } finally {
    const cleanupErrors = []

    try {
      fsAdapter.rmSync(zipTempDir, { recursive: true, force: true })
    } catch (error) {
      cleanupErrors.push(error instanceof Error ? error : new Error(String(error)))
    }

    combineErrors(
      zipPrimaryError instanceof Error ? zipPrimaryError : zipPrimaryError ? new Error(String(zipPrimaryError)) : null,
      cleanupErrors,
      'ZIP',
    )
  }

  const dmgMountDir = createTempDir('dmg')
  let dmgAttached = false
  let mountedAppReport
  let dmgPrimaryError = null

  try {
    runCommandImpl('hdiutil', ['attach', assets.dmg, '-nobrowse', '-readonly', '-mountpoint', dmgMountDir])
    dmgAttached = true
    const mountedAppPath = findExactlyOneApp(dmgMountDir, dependencies)
    const readmePath = pathAdapter.join(dmgMountDir, 'LEIA ANTES DE INSTALAR.txt')
    ensureExists(readmePath, 'mounted DMG readme', fsAdapter)
    verifyMountedReadme(fsAdapter.readFileSync(readmePath, 'utf8'))
    mountedAppReport = await verifySignedAppFn(
      { appPath: mountedAppPath, distDir, teamId, version, arch, runCommand: runCommandImpl },
      dependencies,
    )
  } catch (error) {
    dmgPrimaryError = error
  } finally {
    const cleanupErrors = []

    if (dmgAttached) {
      try {
        runCommandImpl('hdiutil', ['detach', dmgMountDir])
      } catch (error) {
        cleanupErrors.push(error instanceof Error ? error : new Error(String(error)))
      }
    }

    try {
      fsAdapter.rmSync(dmgMountDir, { recursive: true, force: true })
    } catch (error) {
      cleanupErrors.push(error instanceof Error ? error : new Error(String(error)))
    }

    combineErrors(
      dmgPrimaryError instanceof Error ? dmgPrimaryError : dmgPrimaryError ? new Error(String(dmgPrimaryError)) : null,
      cleanupErrors,
      'DMG',
    )
  }

  return {
    version,
    architecture: arch,
    teamId,
    artifactNames: {
      dmg: pathAdapter.basename(assets.dmg),
      dmgBlockmap: pathAdapter.basename(assets.dmgBlockmap),
      zip: pathAdapter.basename(assets.zip),
      zipBlockmap: pathAdapter.basename(assets.zipBlockmap),
      signedMacYml: pathAdapter.basename(assets.signedMacYml),
    },
    machOCount: packagedAppReport.machORecords.length,
    gateStatuses: {
      packagedApp: 'passed',
      assetInventory: 'passed',
      signedMacYml: 'passed',
      appUpdateYml: 'passed',
      zipReplay: 'passed',
      dmgReplay: 'passed',
      mountedReadme: 'passed',
    },
    reports: {
      packagedApp: packagedAppReport,
      zippedApp: zippedAppReport,
      mountedApp: mountedAppReport,
    },
  }
}
