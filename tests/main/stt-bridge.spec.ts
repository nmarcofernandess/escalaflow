import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { transcribeWithSidecar } from '../../src/main/stt/stt-bridge'

let tempDir: string | null = null

afterEach(() => {
  if (tempDir) {
    fs.rmSync(tempDir, { recursive: true, force: true })
    tempDir = null
  }
})

function makeFakeSidecar(body: Record<string, unknown>): string {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stt-sidecar-test-'))
  const scriptPath = path.join(tempDir, process.platform === 'win32' ? 'fake-stt.cmd' : 'fake-stt')
  const nodeScriptPath = path.join(tempDir, 'fake-stt.mjs')

  fs.writeFileSync(nodeScriptPath, `
const args = process.argv.slice(2)
if (!args.includes('transcribe') || !args.includes('--json') || !args.includes('--model-dir') || !args.includes('--audio')) {
  console.error('bad args: ' + args.join(' '))
  process.exit(2)
}
console.log(JSON.stringify(${JSON.stringify(body)}))
`)

  if (process.platform === 'win32') {
    fs.writeFileSync(scriptPath, `@echo off\r\n"${process.execPath}" "${nodeScriptPath}" %*\r\n`)
  } else {
    fs.writeFileSync(scriptPath, `#!/usr/bin/env sh\n"${process.execPath}" "${nodeScriptPath}" "$@"\n`)
    fs.chmodSync(scriptPath, 0o755)
  }

  return scriptPath
}

describe('stt sidecar bridge', () => {
  it('spawns a sidecar and parses transcript JSON with second-based timing', async () => {
    const sidecarPath = makeFakeSidecar({
      text: 'folga domingo acougue',
      language: 'pt',
      duration_seconds: 2.5,
      segments: [{ start: 0, end: 2.5, text: 'folga domingo acougue' }],
      metadata: { fake: true },
    })
    const audioPath = path.join(tempDir!, 'audio.wav')
    fs.writeFileSync(audioPath, Buffer.from('RIFFfakeWAVE'))

    const result = await transcribeWithSidecar(
      {
        model_id: 'parakeet-v3-int8',
        model_dir: tempDir!,
        audio_path: audioPath,
      },
      {
        sidecar_path: sidecarPath,
        timeout_ms: 5_000,
      },
    )

    expect(result.text).toBe('folga domingo acougue')
    expect(result.language).toBe('pt')
    expect(result.duration_seconds).toBe(2.5)
    expect(result.model_id).toBe('parakeet-v3-int8')
    expect(result.post_processed).toBe(false)
    expect(result.segments?.[0]?.text).toBe('folga domingo acougue')
  })

  it('accepts packaged sidecar JSON with millisecond timing', async () => {
    const sidecarPath = makeFakeSidecar({
      text: 'Cadastrar escala seis por um.',
      raw_text: 'Cadastrar escala seis por um.',
      model_id: 'parakeet-v3-int8',
      duration_ms: 100,
      audio_duration_ms: 1000,
      language: 'pt',
      post_processed: false,
    })

    const result = await transcribeWithSidecar({
      sidecarPath,
      audioPath: '/tmp/audio.wav',
      modelPath: '/tmp/model',
      modelId: 'parakeet-v3-int8',
      timeoutMs: 2_000,
    })

    expect(result.text).toBe('Cadastrar escala seis por um.')
    expect(result.duration_ms).toBe(100)
    expect(result.audio_duration_ms).toBe(1000)
    expect(result.post_processed).toBe(false)
  })
})
