import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { promisify } from 'node:util'
import type { SttModelId, SttStatus, SttTranscriptResult } from '../../shared/types'
import { DEFAULT_STT_MODEL_ID, getSttModelInstallPath, getSttModelPath, getUserSttModelBaseDir, isSttModelDownloaded, STT_MODELS } from './catalog'
import { getSttSidecarPath, isSttSidecarAvailable, transcribeWithSidecar } from './stt-bridge'
import { buildSttPostProcessPrompt } from './post-process'

const execFileAsync = promisify(execFile)
const MAX_WAV_BASE64_BYTES = 3_000_000

export function getSttStatus(): SttStatus {
  const sidecar_disponivel = isSttSidecarAvailable()
  const modelos = Object.fromEntries(
    (Object.keys(STT_MODELS) as SttModelId[]).map((id) => {
      const model = STT_MODELS[id]
      const modelPath = getSttModelPath(id)
      const baixado = isSttModelDownloaded(id)
      return [id, {
        id,
        label: model.label,
        baixado,
        path: modelPath,
        size_bytes: model.size_bytes,
        notes: model.notes,
      }]
    })
  ) as SttStatus['modelos']

  const modelReady = modelos[DEFAULT_STT_MODEL_ID].baixado
  return {
    disponivel: sidecar_disponivel && modelReady,
    active_model_id: DEFAULT_STT_MODEL_ID,
    modelos,
    sidecar_path: getSttSidecarPath(),
    sidecar_disponivel,
    reason: !sidecar_disponivel ? 'missing_sidecar' : modelReady ? undefined : 'download_stt_model',
  }
}

export async function downloadSttModel(modelId: SttModelId): Promise<void> {
  const model = STT_MODELS[modelId]
  const baseDir = getUserSttModelBaseDir()
  const modelPath = getSttModelInstallPath(modelId)
  fs.mkdirSync(baseDir, { recursive: true })
  if (isSttModelDownloaded(modelId)) return

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'escalaflow-stt-model-'))
  const archivePath = path.join(tmpDir, `${model.filename}.download`)
  try {
    const response = await fetch(model.url)
    if (!response.ok || !response.body) {
      throw new Error(`Falha ao baixar ${model.label}: HTTP ${response.status}`)
    }

    await pipeline(
      Readable.fromWeb(response.body as unknown as import('node:stream/web').ReadableStream),
      fs.createWriteStream(archivePath)
    )

    fs.rmSync(modelPath, { recursive: true, force: true })
    await execFileAsync('tar', ['-xzf', archivePath, '-C', baseDir])
    if (!isSttModelDownloaded(modelId)) {
      throw new Error(`Modelo Parakeet extraido sem arquivos esperados: ${modelPath}`)
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
}

export function deleteSttModel(modelId: SttModelId): void {
  fs.rmSync(getSttModelPath(modelId), { recursive: true, force: true })
}

export async function transcribeWavBase64(input: {
  wav_base64: string
  model_id?: SttModelId
  post_process?: boolean
  post_process_mode?: 'clean_prompt' | 'formal_message' | 'rh_note'
}): Promise<SttTranscriptResult> {
  const modelId = input.model_id ?? DEFAULT_STT_MODEL_ID
  if (input.wav_base64.length > MAX_WAV_BASE64_BYTES) {
    throw new Error('Audio muito longo para ditado local. Grave ate 60 segundos por vez.')
  }
  if (!isSttModelDownloaded(modelId)) {
    throw new Error(`Modelo de ditado local nao instalado: ${modelId}`)
  }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'escalaflow-stt-'))
  const audioPath = path.join(dir, 'audio.wav')
  fs.writeFileSync(audioPath, Buffer.from(input.wav_base64, 'base64'))

  try {
    const result = await transcribeWithSidecar({
      audioPath,
      modelPath: getSttModelPath(modelId),
      modelId,
    })

    if (input.post_process && input.post_process_mode && result.text.trim()) {
      buildSttPostProcessPrompt({
        transcript: result.text,
        mode: input.post_process_mode,
        domainTerms: ['6x1', '5x2', 'CLT', 'folga domingo', 'escala', 'setor', 'colaborador'],
      })
    }

    return result
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}
