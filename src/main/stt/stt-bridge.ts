import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import { z } from 'zod'
import type { SttModelId, SttTranscriptResult } from '../../shared/types'

const execFileAsync = promisify(execFile)

const SidecarResultSchema = z.object({
  text: z.string(),
  raw_text: z.string().optional(),
  model_id: z.string().optional(),
  duration_ms: z.number(),
  audio_duration_ms: z.number().default(0),
  language: z.string().optional(),
  segments: z.array(z.object({
    start_ms: z.number(),
    end_ms: z.number(),
    text: z.string(),
  })).optional(),
  post_processed: z.boolean().optional(),
})

export function getSttSidecarPath(): string {
  const filename = process.platform === 'win32' ? 'escalaflow-stt.exe' : 'escalaflow-stt'
  const packagedPath = path.join(process.resourcesPath ?? '', 'stt-bin', filename)
  if (process.resourcesPath && fs.existsSync(packagedPath)) return packagedPath
  return path.join(process.cwd(), 'stt-bin', filename)
}

export function isSttSidecarAvailable(): boolean {
  return fs.existsSync(getSttSidecarPath())
}

export async function transcribeWithSidecar(input: {
  sidecarPath?: string
  audioPath: string
  modelPath: string
  modelId: SttModelId
  timeoutMs?: number
}): Promise<SttTranscriptResult> {
  const sidecarPath = input.sidecarPath ?? getSttSidecarPath()
  if (!fs.existsSync(sidecarPath)) {
    throw new Error(`Binario de ditado local nao encontrado: ${sidecarPath}`)
  }

  const { stdout } = await execFileAsync(sidecarPath, [
    'transcribe',
    '--model-dir', input.modelPath,
    '--audio', input.audioPath,
    '--json',
  ], {
    timeout: input.timeoutMs ?? 120_000,
    maxBuffer: 1024 * 1024,
  })

  const parsed = SidecarResultSchema.parse(JSON.parse(stdout))
  return {
    text: parsed.text,
    raw_text: parsed.raw_text ?? parsed.text,
    model_id: input.modelId,
    duration_ms: parsed.duration_ms,
    audio_duration_ms: parsed.audio_duration_ms,
    language: parsed.language,
    segments: parsed.segments,
    post_processed: parsed.post_processed ?? false,
  }
}
