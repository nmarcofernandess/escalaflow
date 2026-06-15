import { stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { queryOne } from '../db/query'
import { IA_TOOLS } from './tools'
import { getIaChatReadiness } from './readiness'
import { resolveModel } from './config'
import { buildAiTerminalCommand, buildPackagedAiTerminalCommand } from '../../shared/terminal-launch-contract'
import {
  AI_RUNTIME_READINESS_COPY,
  type AiRuntimeReadinessCode,
  type AiTerminalReadiness,
  type ResolvedAiRuntime,
} from '../../shared/ai-runtime-contract'
import type { IaConfiguracao } from '../../shared/types'

const VALIDATION_TTL_MS = 5 * 60 * 1000
const require = createRequire(import.meta.url)

function getElectronRuntimeInfo(): {
  isPackaged: boolean
  executablePath: string
  resourcesPath: string | null
} {
  try {
    const electron = require('electron') as { app?: { isPackaged?: boolean } }
    return {
      isPackaged: Boolean(electron.app?.isPackaged),
      executablePath: process.execPath,
      resourcesPath: typeof process.resourcesPath === 'string' ? process.resourcesPath : null,
    }
  } catch {
    return {
      isPackaged: false,
      executablePath: process.execPath,
      resourcesPath: typeof process.resourcesPath === 'string' ? process.resourcesPath : null,
    }
  }
}

export interface AiTerminalCliResolutionPlan {
  candidates: string[]
  commandFor: (cliPath?: string | null) => string
}

export function buildAiTerminalCliResolutionPlan(input: {
  isPackaged: boolean
  executablePath: string
  resourcesPath: string | null
  projectCwd: string
}): AiTerminalCliResolutionPlan {
  if (input.isPackaged && input.resourcesPath) {
    const candidates = [
      path.join(input.resourcesPath, 'app.asar', 'out', 'main', 'cli.js'),
      path.join(input.resourcesPath, 'app.asar.unpacked', 'out', 'main', 'cli.js'),
    ]
    return {
      candidates,
      commandFor: (cliPath) => buildPackagedAiTerminalCommand({
        executablePath: input.executablePath,
        cliPath: cliPath ?? candidates[0],
      }),
    }
  }

  const candidates = [
    path.resolve(input.projectCwd, 'src/cli/index.ts'),
    path.resolve(input.projectCwd, 'out', 'main', 'cli.js'),
    path.resolve(input.projectCwd, 'out', 'cli', 'index.js'),
  ]

  return {
    candidates,
    commandFor: () => buildAiTerminalCommand({ projectCwd: input.projectCwd }),
  }
}

async function findExistingPath(candidates: string[]): Promise<string | null> {
  for (const candidate of candidates) {
    try {
      await stat(candidate)
      return candidate
    } catch {
      // Try next known CLI location.
    }
  }

  return null
}

async function resolveAiTerminalCli(): Promise<{
  exists: boolean
  command: string
}> {
  const runtime = getElectronRuntimeInfo()
  const plan = buildAiTerminalCliResolutionPlan({
    ...runtime,
    projectCwd: process.cwd(),
  })
  const cliPath = await findExistingPath(plan.candidates)

  return {
    exists: Boolean(cliPath),
    command: plan.commandFor(cliPath),
  }
}

function baseRuntime(config: IaConfiguracao | null, model: string | null): ResolvedAiRuntime {
  return {
    provider: config?.provider ?? null,
    model,
    displayName: config?.provider ? `${config.provider}:${model ?? 'sem modelo'}` : 'Sem IA configurada',
    toolsAvailable: IA_TOOLS.length > 0,
    toolsCount: IA_TOOLS.length,
    validatedAt: null,
    validationTtlMs: VALIDATION_TTL_MS,
  }
}

function fromCode(
  code: AiRuntimeReadinessCode,
  runtime: ResolvedAiRuntime,
  command: string,
  cwd: string,
): AiTerminalReadiness {
  return {
    ...AI_RUNTIME_READINESS_COPY[code],
    runtime,
    command,
    cwd,
  }
}

function mapChatReason(reason: string): AiRuntimeReadinessCode {
  if (reason === 'configure_provider') return 'configMissing'
  if (reason === 'configure_cloud_token') return 'credentialMissing'
  if (reason === 'download_local_model') return 'modelDownloadRequired'
  if (reason === 'download_local_model_downloading') return 'modelDownloading'
  if (reason === 'download_local_model_cancelled') return 'modelDownloadCanceled'
  if (reason === 'validate_local_model') return 'modelLoadingFailed'
  if (reason === 'local_model_error') return 'modelLoadingFailed'
  if (reason === 'invalid_local_model_config') return 'modelCorrupt'
  return 'configMissing'
}

export async function getAiTerminalReadiness(input: { cwd?: string } = {}): Promise<AiTerminalReadiness> {
  const cwd = path.resolve(input.cwd || process.cwd())
  const cli = await resolveAiTerminalCli()
  const command = cli.command
  const config = (await queryOne<IaConfiguracao>('SELECT * FROM configuracao_ia LIMIT 1')) ?? null
  const model = config ? resolveModel(config, config.provider) : null
  const runtime = baseRuntime(config, model)

  if (!cli.exists) return fromCode('cliMissing', runtime, command, cwd)

  if (process.platform !== 'darwin' && process.platform !== 'win32' && process.platform !== 'linux') {
    return fromCode('osUnsupported', runtime, command, cwd)
  }

  const chat = await getIaChatReadiness({ validateLocal: true })
  if (!chat.ok) {
    return fromCode(mapChatReason(chat.reason), {
      ...runtime,
      provider: chat.provider,
      model: chat.model,
      displayName: chat.provider ? `${chat.provider}:${chat.model ?? 'sem modelo'}` : runtime.displayName,
    }, command, cwd)
  }

  if (!runtime.toolsAvailable) return fromCode('toolsUnavailable', runtime, command, cwd)

  return fromCode('ready', {
    ...runtime,
    provider: chat.provider,
    model: chat.model,
    displayName: `${chat.provider}:${chat.model}`,
    validatedAt: new Date().toISOString(),
  }, command, cwd)
}
