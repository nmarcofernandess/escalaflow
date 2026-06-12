import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { transcribeWithSidecar } from '../../src/main/stt/stt-bridge'

function fakeSidecar(body: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'stt-sidecar-'))
  const bin = path.join(dir, process.platform === 'win32' ? 'fake-stt.cmd' : 'fake-stt')
  if (process.platform === 'win32') {
    writeFileSync(bin, `@echo off\r\necho ${body.replaceAll('"', '\\"')}\r\n`)
  } else {
    writeFileSync(bin, `#!/bin/sh\nprintf '%s\\n' '${body}'\n`)
    chmodSync(bin, 0o755)
  }
  return bin
}

describe('stt bridge', () => {
  it('parses sidecar transcript JSON', async () => {
    const bin = fakeSidecar(JSON.stringify({
      text: 'Cadastrar escala seis por um.',
      raw_text: 'Cadastrar escala seis por um.',
      model_id: 'parakeet-v3-int8',
      duration_ms: 100,
      audio_duration_ms: 1000,
      language: 'pt',
      post_processed: false,
    }))

    const result = await transcribeWithSidecar({
      sidecarPath: bin,
      audioPath: '/tmp/audio.wav',
      modelPath: '/tmp/model',
      modelId: 'parakeet-v3-int8',
      timeoutMs: 2000,
    })

    expect(result.text).toBe('Cadastrar escala seis por um.')
    expect(result.post_processed).toBe(false)
  })
})
