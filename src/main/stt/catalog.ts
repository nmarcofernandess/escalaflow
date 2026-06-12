import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import type { SttModelCatalogItem, SttModelId } from '../../shared/types'

const require = createRequire(import.meta.url)

export const DEFAULT_STT_MODEL_ID: SttModelId = 'parakeet-v3-int8'

export const STT_MODELS: Record<SttModelId, SttModelCatalogItem & { url: string }> = {
  'parakeet-v3-int8': {
    id: 'parakeet-v3-int8',
    label: 'Parakeet V3 int8',
    engine: 'parakeet',
    filename: 'parakeet-tdt-0.6b-v3-int8',
    url: 'https://blob.handy.computer/parakeet-v3-int8.tar.gz',
    size_bytes: 478_000_000,
    ram_minima_gb: 2,
    languages: ['pt', 'en', 'es', 'fr', 'de', 'it', 'nl', 'sv', 'ru', 'uk', 'pl', 'ro', 'cs', 'el', 'hu', 'bg', 'da', 'fi', 'sk', 'hr', 'lt', 'sl', 'lv', 'et', 'mt'],
    supports_translation: false,
    supports_language_hint: false,
    notes: 'ASR local rapido com pontuacao/capitalizacao. Nao faz reescrita contextual.',
  },
}

export function getSttModelBaseDir(): string {
  const bundled = getBundledSttModelBaseDir()
  if (bundled && fs.existsSync(bundled)) return bundled
  return getUserSttModelBaseDir()
}

export function getUserSttModelBaseDir(): string {
  try {
    const electron = require('electron') as { app?: { getPath?: (name: string) => string } }
    const app = electron.app
    if (app?.getPath) return path.join(app.getPath('userData'), 'models', 'stt')
  } catch { /* dev fallback */ }
  return path.join(__dirname, '../../data/models/stt')
}

export function getBundledSttModelBaseDir(): string | null {
  const packaged = process.resourcesPath
    ? path.join(process.resourcesPath, 'models', 'stt')
    : null
  if (packaged && fs.existsSync(packaged)) return packaged

  const devPath = path.join(process.cwd(), 'models', 'stt')
  if (fs.existsSync(devPath)) return devPath
  return null
}

export function getSttModelPath(modelId: SttModelId): string {
  return path.join(getSttModelBaseDir(), STT_MODELS[modelId].filename)
}

export function isSttModelDownloaded(modelId: SttModelId): boolean {
  const model = STT_MODELS[modelId]
  const modelPath = getSttModelPath(modelId)
  if (!fs.existsSync(modelPath)) return false
  const stat = fs.statSync(modelPath)
  return stat.isDirectory()
    && fs.existsSync(path.join(modelPath, 'encoder-model.int8.onnx'))
    && fs.existsSync(path.join(modelPath, 'decoder_joint-model.int8.onnx'))
}

export function getSttModelInstallPath(modelId: SttModelId): string {
  return path.join(getUserSttModelBaseDir(), STT_MODELS[modelId].filename)
}
