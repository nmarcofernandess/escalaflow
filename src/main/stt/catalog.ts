import path from 'node:path'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import type { SttModelCatalogItem, SttModelId } from '../../shared/types'

const require = createRequire(import.meta.url)

export const DEFAULT_STT_MODEL_ID: SttModelId = 'parakeet-v3-int8'

export const STT_MODELS: Record<SttModelId, SttModelCatalogItem> = {
  'parakeet-v3-int8': {
    id: 'parakeet-v3-int8',
    label: 'Parakeet TDT 0.6B v3 INT8',
    engine: 'parakeet',
    format: 'sherpa-onnx',
    description: 'Modelo ASR local multilingue recomendado para transcricao offline.',
    url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8.tar.bz2',
    filename: 'sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8',
    size_bytes: 670_000_000,
    storage: 'directory',
    languages: [
      'bg', 'hr', 'cs', 'da', 'nl', 'en', 'et', 'fi', 'fr', 'de',
      'el', 'hu', 'it', 'lv', 'lt', 'mt', 'pl', 'pt', 'ro', 'sk',
      'sl', 'es', 'sv', 'ru', 'uk',
    ],
    supports_pt: true,
    asr_only: true,
    recommended: true,
  },
  'whisper-small-q5': {
    id: 'whisper-small-q5',
    label: 'Whisper Small Q5',
    engine: 'whisper',
    format: 'whisper-ggml',
    description: 'Fallback local menor para ambientes onde Parakeet nao estiver disponivel.',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small-q5_1.bin',
    filename: 'ggml-small-q5_1.bin',
    size_bytes: 190_000_000,
    storage: 'file',
    languages: ['multilingual', 'pt'],
    supports_pt: true,
    asr_only: true,
    recommended: false,
  },
  'whisper-medium-q5': {
    id: 'whisper-medium-q5',
    label: 'Whisper Medium Q5',
    engine: 'whisper',
    format: 'whisper-ggml',
    description: 'Fallback local com maior qualidade e custo de memoria.',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium-q5_0.bin',
    filename: 'ggml-medium-q5_0.bin',
    size_bytes: 540_000_000,
    storage: 'file',
    languages: ['multilingual', 'pt'],
    supports_pt: true,
    asr_only: true,
    recommended: false,
  },
}

export function getSttModelsBaseDir(): string {
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
    // fallback below
  }

  return path.join(process.cwd(), 'data', 'models', 'stt')
}

export function getSttModelPath(modelId: SttModelId): string {
  const model = STT_MODELS[modelId]
  return path.join(getSttModelsBaseDir(), model.filename)
}

function hasNonEmptyFile(filePath: string): boolean {
  if (!fs.existsSync(filePath)) return false
  const stat = fs.statSync(filePath)
  return stat.isFile() && stat.size > 0
}

export function isSttModelDownloaded(modelId: SttModelId): boolean {
  const model = STT_MODELS[modelId]
  const modelPath = getSttModelPath(modelId)

  if (model.storage === 'directory') {
    if (!fs.existsSync(modelPath) || !fs.statSync(modelPath).isDirectory()) return false
    return hasNonEmptyFile(path.join(modelPath, 'encoder.int8.onnx'))
      && hasNonEmptyFile(path.join(modelPath, 'decoder.int8.onnx'))
  }

  return hasNonEmptyFile(modelPath)
}

export function listSttModels(): SttModelCatalogItem[] {
  return Object.values(STT_MODELS)
}
