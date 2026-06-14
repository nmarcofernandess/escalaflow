import { stat } from 'node:fs/promises'
import path from 'node:path'
import { queryOne } from '../db/query'
import { IA_TOOLS } from './tools'
import { getIaChatReadiness } from './readiness'
import { resolveModel } from './config'
import { buildAiTerminalCommand } from '../../shared/terminal-launch-contract'
import {
  AI_RUNTIME_READINESS_COPY,
  type AiRuntimeReadinessCode,
  type AiTerminalReadiness,
  type ResolvedAiRuntime,
} from '../../shared/ai-runtime-contract'
import type { IaConfiguracao } from '../../shared/types'

const VALIDATION_TTL_MS = 5 * 60 * 1000

async function cliExists(): Promise<boolean> {
  const candidates = [
    path.resolve(process.cwd(), 'src/cli/index.ts'),
    path.resolve(process.cwd(), 'out/cli/index.js'),
  ]

  for (const candidate of candidates) {
    try {
      await stat(candidate)
      return true
    } catch {
      // Try next known CLI location.
    }
  }

  return false
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
  const command = buildAiTerminalCommand({ projectCwd: process.cwd() })
  const config = (await queryOne<IaConfiguracao>('SELECT * FROM configuracao_ia LIMIT 1')) ?? null
  const model = config ? resolveModel(config, config.provider) : null
  const runtime = baseRuntime(config, model)

  if (!await cliExists()) return fromCode('cliMissing', runtime, command, cwd)

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
