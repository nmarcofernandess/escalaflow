#!/usr/bin/env node

import { runCommand, verifyMacDistribution } from './mac-distribution-audit.mjs'

const HELP_TEXT = `Usage: node scripts/verify-mac-distribution.mjs --app <path> --dist <path> --team-id <team> --version <version> --arch <arch>

Required flags:
  --app       Path to the packaged EscalaFlow.app
  --dist      Path to the dist directory containing DMG/ZIP/blockmaps/metadata
  --team-id   Expected Apple Team ID
  --version   Release version to audit
  --arch      Expected architecture (for this task: arm64)

Options:
  --help      Show this help message
`

function parseArgs(argv) {
  if (argv.includes('--help') || argv.includes('-h')) {
    return { help: true }
  }

  const requiredFlags = {
    appPath: '--app',
    distDir: '--dist',
    teamId: '--team-id',
    version: '--version',
    arch: '--arch',
  }
  const values = new Map()

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]

    if (!token.startsWith('--')) {
      throw new Error(`unexpected positional argument: ${token}`)
    }

    const value = argv[index + 1]
    if (!value || value.startsWith('--')) {
      throw new Error(`missing value for ${token}`)
    }

    values.set(token.slice(2), value)
    index += 1
  }

  const config = {
    appPath: values.get('app'),
    distDir: values.get('dist'),
    teamId: values.get('team-id'),
    version: values.get('version'),
    arch: values.get('arch'),
  }

  for (const [key, value] of Object.entries(config)) {
    if (!value) {
      throw new Error(`missing required flag: ${requiredFlags[key]}`)
    }
  }

  return { help: false, ...config }
}

async function main() {
  try {
    const parsed = parseArgs(process.argv.slice(2))

    if (parsed.help) {
      console.log(HELP_TEXT)
      return
    }

    const summary = await verifyMacDistribution({
      appPath: parsed.appPath,
      distDir: parsed.distDir,
      teamId: parsed.teamId,
      version: parsed.version,
      arch: parsed.arch,
      runCommand,
    })

    console.log(JSON.stringify(summary, null, 2))
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}

await main()
