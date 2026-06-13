import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import type { SttModelCatalogItem, SttModelId } from '../../shared/types'

const require = createRequire(import.meta.url)

export const DEFAULT_STT_MODEL_ID: SttModelId = 'parakeet-v3-int8'

export const STT_MODELS: Record<SttModelId, SttModelCatalogItem> = {
  'parakeet-v3-int8': {
    id: 'parakeet-v3-int8',
    label: 'Parakeet V3 int8',
    engine: 'parakeet',
    format: 'sherpa-onnx',
    description: 'ASR local rapido com pontuacao/capitalizacao. Nao faz reescrita contextual.',
    filename: 'parakeet-tdt-0.6b-v3-int8',
    url: 'https://blob.handy.computer/parakeet-v3-int8.tar.gz',
    size_bytes: 478_000_000,
    storage: 'directory',
    ram_minima_gb: 2,
    languages: ['pt', 'en', 'es', 'fr', 'de', 'it', 'nl', 'sv', 'ru', 'uk', 'pl', 'ro', 'cs', 'el', 'hu', 'bg', 'da', 'fi', 'sk', 'hr', 'lt', 'sl', 'lv', 'et', 'mt'],
    supports_pt: true,
    supports_translation: false,
    supports_language_hint: false,
    asr_only: true,
    recommended: true,
    notes: 'ASR local para ditado. O audio vira texto antes de chegar ao chat.',
  },
}

const PARAKEET_REQUIRED_FILE_SETS = [
  ['encoder-model.int8.onnx', 'decoder_joint-model.int8.onnx'],
  ['encoder.int8.onnx', 'decoder.int8.onnx'],
]

export function getUserSttModelBaseDir(): string {
  if (process.env.ESCALAFLOW_STT_MODELS_DIR) {
    return process.env.ESCALAFLOW_STT_MODELS_DIR
  }

  try {
    const electron = require('electron') as { app?: { getPath?: (name: string) => string } }
    const app = electron.app
    if (app?.getPath) {
      return path.join(app.getPath('userData'), 'models', 'stt')
    }
  } catch {
    // dev fallback below
  }

  return path.join(process.cwd(), 'data', 'models', 'stt')
}

export function getBundledSttModelBaseDir(): string | null {
  const candidates = [
    process.resourcesPath ? path.join(process.resourcesPath, 'models', 'stt') : null,
    path.join(process.cwd(), 'models', 'stt'),
  ].filter(Boolean) as string[]

  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null
}

export function getSttModelBaseDir(): string {
  const bundled = getBundledSttModelBaseDir()
  if (bundled) return bundled
  return getUserSttModelBaseDir()
}

export function getSttModelsBaseDir(): string {
  return getUserSttModelBaseDir()
}

export function getSttModelPath(modelId: SttModelId): string {
  return path.join(getSttModelBaseDir(), STT_MODELS[modelId].filename)
}

export function getSttModelInstallPath(modelId: SttModelId): string {
  return path.join(getUserSttModelBaseDir(), STT_MODELS[modelId].filename)
}

function hasNonEmptyFile(filePath: string): boolean {
  if (!fs.existsSync(filePath)) return false
  const stat = fs.statSync(filePath)
  return stat.isFile() && stat.size > 0
}

export function isValidParakeetModelDir(modelPath: string): boolean {
  if (!fs.existsSync(modelPath) || !fs.statSync(modelPath).isDirectory()) return false
  return PARAKEET_REQUIRED_FILE_SETS.some((requiredFiles) =>
    requiredFiles.every((filename) => hasNonEmptyFile(path.join(modelPath, filename))),
  )
}

export function isSttModelDownloaded(modelId: SttModelId): boolean {
  return isValidParakeetModelDir(getSttModelPath(modelId))
}

export function listSttModels(): SttModelCatalogItem[] {
  return Object.values(STT_MODELS)
}
