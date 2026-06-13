import fs from 'node:fs'
import { promises as fsp } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import {
  DEFAULT_STT_MODEL_ID,
  STT_MODELS,
  getSttModelPath,
  getSttModelsBaseDir,
  isSttModelDownloaded,
  listSttModels,
} from './catalog'
import { getSttSidecarPath, isSttSidecarAvailable, transcribeWithSidecar } from './stt-bridge'
import { buildSttPostProcessPrompt } from './post-process'
import type { SttModelId, SttStatus, SttTranscriptResult, SttPostProcessOptions } from '../../shared/types'

const execFileAsync = promisify(execFile)

let downloadInProgress: SttModelId | null = null

export interface TranscribeWavBase64Input extends SttPostProcessOptions {
  wav_base64: string
  model_id?: SttModelId
}

function getArchivePath(modelId: SttModelId): string {
  const model = STT_MODELS[modelId]
  const ext = model.url.endsWith('.tar.gz')
    ? '.tar.gz'
    : model.url.endsWith('.tar.bz2')
      ? '.tar.bz2'
      : '.download'
  return path.join(getSttModelsBaseDir(), `${model.filename}${ext}`)
}

function getPartialPath(modelId: SttModelId): string {
  const model = STT_MODELS[modelId]
  return model.storage === 'directory'
    ? `${getArchivePath(modelId)}.part`
    : `${getSttModelPath(modelId)}.part`
}

function getStatusForModel(modelId: SttModelId) {
  const model = STT_MODELS[modelId]
  const modelPath = getSttModelPath(modelId)
  const partPath = getPartialPath(modelId)
  const baixado = isSttModelDownloaded(modelId)
  let tamanho_atual_bytes: number | undefined

  if (baixado && fs.existsSync(modelPath)) {
    const stat = fs.statSync(modelPath)
    tamanho_atual_bytes = stat.isDirectory() ? directorySize(modelPath) : stat.size
  } else if (fs.existsSync(partPath)) {
    tamanho_atual_bytes = fs.statSync(partPath).size
  }

  return {
    id: modelId,
    baixado,
    caminho: modelPath,
    tamanho_bytes: model.size_bytes,
    ...(tamanho_atual_bytes !== undefined ? { tamanho_atual_bytes } : {}),
  }
}

function directorySize(dir: string): number {
  let total = 0
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const entryPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      total += directorySize(entryPath)
    } else if (entry.isFile()) {
      total += fs.statSync(entryPath).size
    }
  }
  return total
}

export function getSttStatus(): SttStatus {
  const modelos = Object.fromEntries(
    listSttModels().map((model) => [model.id, getStatusForModel(model.id)]),
  ) as SttStatus['modelos']

  const sidecarPath = getSttSidecarPath()
  return {
    default_model_id: DEFAULT_STT_MODEL_ID,
    modelos,
    sidecar_path: sidecarPath,
    sidecar_disponivel: isSttSidecarAvailable(sidecarPath),
    ...(downloadInProgress ? { download_em_andamento: downloadInProgress } : {}),
  }
}

async function writeChunk(stream: fs.WriteStream, chunk: Uint8Array): Promise<void> {
  if (stream.write(Buffer.from(chunk))) return
  await new Promise<void>((resolve, reject) => {
    stream.once('drain', resolve)
    stream.once('error', reject)
  })
}

async function fetchToFile(
  url: string,
  destPath: string,
  onProgress?: (downloaded: number, total: number) => void,
): Promise<void> {
  await fsp.mkdir(path.dirname(destPath), { recursive: true })
  const partPath = `${destPath}.part`
  const response = await fetch(url)

  if (!response.ok) {
    throw new Error(`Download STT falhou: HTTP ${response.status}`)
  }

  const total = Number(response.headers.get('content-length') ?? 0)
  const body = response.body
  if (!body) throw new Error('Download STT sem body')

  const stream = fs.createWriteStream(partPath, { flags: 'w' })
  const reader = body.getReader()
  let downloaded = 0

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      downloaded += value.byteLength
      await writeChunk(stream, value)
      onProgress?.(downloaded, total)
    }
  } finally {
    await new Promise<void>((resolve, reject) => {
      stream.end((err?: Error | null) => {
        if (err) reject(err)
        else resolve()
      })
    })
  }

  await fsp.rename(partPath, destPath)
}

function verifyParakeetDir(modelDir: string): void {
  const required = ['encoder.int8.onnx', 'decoder.int8.onnx']
  for (const filename of required) {
    const filePath = path.join(modelDir, filename)
    if (!fs.existsSync(filePath) || fs.statSync(filePath).size === 0) {
      throw new Error(`Modelo Parakeet incompleto: ${filename} nao encontrado`)
    }
  }
}

async function extractParakeetArchive(modelId: SttModelId, archivePath: string): Promise<void> {
  const model = STT_MODELS[modelId]
  const targetDir = getSttModelPath(modelId)
  const extractRoot = path.join(getSttModelsBaseDir(), `${model.filename}.extract-${Date.now()}`)
  await fsp.rm(extractRoot, { recursive: true, force: true })
  await fsp.mkdir(extractRoot, { recursive: true })

  try {
    await execFileAsync('tar', ['-xf', archivePath, '-C', extractRoot], { timeout: 5 * 60 * 1000 })
    const nestedDir = path.join(extractRoot, model.filename)
    const sourceDir = fs.existsSync(nestedDir) ? nestedDir : extractRoot
    verifyParakeetDir(sourceDir)

    await fsp.rm(targetDir, { recursive: true, force: true })
    await fsp.mkdir(path.dirname(targetDir), { recursive: true })
    await fsp.rename(sourceDir, targetDir)
  } finally {
    await fsp.rm(extractRoot, { recursive: true, force: true })
  }
}

export async function downloadSttModel(
  modelId: SttModelId,
  onProgress?: (downloaded: number, total: number) => void,
): Promise<SttStatus> {
  if (downloadInProgress) {
    throw new Error(`Ja existe download STT em andamento: ${downloadInProgress}`)
  }

  const model = STT_MODELS[modelId]
  if (!model) throw new Error(`Modelo STT desconhecido: ${modelId}`)

  downloadInProgress = modelId
  try {
    await fsp.mkdir(getSttModelsBaseDir(), { recursive: true })

    if (model.storage === 'directory') {
      const archivePath = getArchivePath(modelId)
      await fetchToFile(model.url, archivePath, onProgress)
      await extractParakeetArchive(modelId, archivePath)
      await fsp.rm(archivePath, { force: true })
      verifyParakeetDir(getSttModelPath(modelId))
    } else {
      await fetchToFile(model.url, getSttModelPath(modelId), onProgress)
    }

    return getSttStatus()
  } finally {
    downloadInProgress = null
  }
}

export async function deleteSttModel(modelId: SttModelId): Promise<SttStatus> {
  if (!STT_MODELS[modelId]) throw new Error(`Modelo STT desconhecido: ${modelId}`)
  await fsp.rm(getSttModelPath(modelId), { recursive: true, force: true })
  await fsp.rm(getPartialPath(modelId), { force: true })
  await fsp.rm(getArchivePath(modelId), { force: true })
  return getSttStatus()
}

function decodeWavBase64(wavBase64: string): Buffer {
  const cleaned = wavBase64.includes(',')
    ? wavBase64.slice(wavBase64.indexOf(',') + 1)
    : wavBase64
  return Buffer.from(cleaned, 'base64')
}

export async function transcribeWavBase64(input: TranscribeWavBase64Input): Promise<SttTranscriptResult> {
  const modelId = input.model_id ?? DEFAULT_STT_MODEL_ID
  if (!STT_MODELS[modelId]) throw new Error(`Modelo STT desconhecido: ${modelId}`)
  if (!isSttModelDownloaded(modelId)) {
    throw new Error(`Modelo STT nao baixado: ${modelId}`)
  }

  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'escalaflow-stt-'))
  const wavPath = path.join(tempDir, 'audio.wav')

  try {
    await fsp.writeFile(wavPath, decodeWavBase64(input.wav_base64))
    const result = await transcribeWithSidecar({
      model_id: modelId,
      model_dir: getSttModelPath(modelId),
      audio_path: wavPath,
    })

    if (input.post_process) {
      const prompt = buildSttPostProcessPrompt({
        transcript: result.text,
        mode: input.mode,
        domainTerms: input.domain_terms,
      })
      void prompt
    }

    return {
      ...result,
      post_processed: false,
      raw_text: result.raw_text ?? result.text,
    }
  } finally {
    await fsp.rm(tempDir, { recursive: true, force: true })
  }
}
