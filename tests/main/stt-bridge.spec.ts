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

function makeFakeSidecar(): string {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stt-sidecar-test-'))
  const scriptPath = path.join(tempDir, process.platform === 'win32' ? 'fake-stt.cmd' : 'fake-stt')
  const nodeScriptPath = path.join(tempDir, 'fake-stt.mjs')

  fs.writeFileSync(nodeScriptPath, `
const args = process.argv.slice(2)
if (!args.includes('transcribe') || !args.includes('--json')) {
  console.error('bad args: ' + args.join(' '))
  process.exit(2)
}
console.log(JSON.stringify({
  text: 'folga domingo acougue',
  language: 'pt',
  duration_seconds: 2.5,
  segments: [{ start: 0, end: 2.5, text: 'folga domingo acougue' }],
  metadata: { fake: true }
}))
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
  it('spawns a sidecar and parses transcript JSON', async () => {
    const sidecarPath = makeFakeSidecar()
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
})
