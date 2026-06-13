import path from 'node:path'
import fs from 'node:fs'
import { spawn } from 'node:child_process'
import { z } from 'zod'
import { DEFAULT_STT_MODEL_ID } from './catalog'
import type { SttModelId, SttTranscriptResult } from '../../shared/types'

const SidecarSegmentSchema = z.object({
  start: z.number(),
  end: z.number(),
  text: z.string(),
})

const SidecarResultSchema = z.object({
  text: z.string(),
  language: z.string().optional(),
  duration_seconds: z.number().optional(),
  duration: z.number().optional(),
  segments: z.array(SidecarSegmentSchema).optional(),
  model_id: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

export interface TranscribeWithSidecarInput {
  model_id?: SttModelId
  model_dir: string
  audio_path: string
}

export interface TranscribeWithSidecarOptions {
  sidecar_path?: string
  timeout_ms?: number
}

function sidecarExecutableName(): string {
  return process.platform === 'win32' ? 'escalaflow-stt.exe' : 'escalaflow-stt'
}

export function getSttSidecarPath(): string {
  if (process.env.ESCALAFLOW_STT_SIDECAR_PATH) {
    return process.env.ESCALAFLOW_STT_SIDECAR_PATH
  }

  const exe = sidecarExecutableName()
  const candidates: string[] = []

  if (process.resourcesPath) {
    candidates.push(
      path.join(process.resourcesPath, 'stt-bin', exe),
      path.join(process.resourcesPath, 'app.asar.unpacked', 'stt-bin', exe),
    )
  }

  candidates.push(
    path.join(process.cwd(), 'stt-bin', exe),
    path.resolve(__dirname, '../../../stt-bin', exe),
    path.resolve(__dirname, '../../stt-bin', exe),
  )

  return candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[0]
}

export function isSttSidecarAvailable(sidecarPath = getSttSidecarPath()): boolean {
  return fs.existsSync(sidecarPath)
}

export async function transcribeWithSidecar(
  input: TranscribeWithSidecarInput,
  options: TranscribeWithSidecarOptions = {},
): Promise<SttTranscriptResult> {
  const sidecarPath = options.sidecar_path ?? getSttSidecarPath()
  const timeoutMs = options.timeout_ms ?? 5 * 60 * 1000
  const modelId = input.model_id ?? DEFAULT_STT_MODEL_ID
  const args = ['transcribe', '--model-dir', input.model_dir, '--audio', input.audio_path, '--json']

  return await new Promise((resolve, reject) => {
    const child = spawn(sidecarPath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })

    let stdout = ''
    let stderr = ''
    let settled = false

    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill('SIGKILL')
      reject(new Error(`STT sidecar timeout apos ${timeoutMs}ms`))
    }, timeoutMs)

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })

    child.on('error', (err) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(new Error(`Falha ao executar STT sidecar: ${err.message}`))
    })

    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)

      if (code !== 0) {
        reject(new Error(`STT sidecar falhou (${code}): ${stderr.trim() || stdout.trim() || 'sem detalhes'}`))
        return
      }

      try {
        const parsed = SidecarResultSchema.parse(JSON.parse(stdout))
        resolve({
          text: parsed.text,
          language: parsed.language,
          duration_seconds: parsed.duration_seconds ?? parsed.duration,
          segments: parsed.segments,
          model_id: modelId,
          post_processed: false,
          raw_text: parsed.text,
          metadata: parsed.metadata,
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        reject(new Error(`STT sidecar retornou JSON invalido: ${message}`))
      }
    })
  })
}
