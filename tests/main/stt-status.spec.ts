import { describe, expect, it } from 'vitest'
import { getSttStatus, transcribeWavBase64 } from '../../src/main/stt/download'
import { transcribeWithSidecar } from '../../src/main/stt/stt-bridge'

describe('STT status', () => {
  it('reports sidecar and model readiness separately', () => {
    const status = getSttStatus()

    expect(typeof status.sidecar_disponivel).toBe('boolean')
    expect(status.disponivel).toBe(status.sidecar_disponivel && status.modelos['parakeet-v3-int8'].baixado)
    if (status.sidecar_disponivel && !status.modelos['parakeet-v3-int8'].baixado) {
      expect(status.reason).toBe('download_stt_model')
    }
  })

  it('reports a missing explicit sidecar path clearly', async () => {
    await expect(transcribeWithSidecar({
      sidecarPath: '/tmp/escalaflow-stt-does-not-exist',
      audioPath: '/tmp/audio.wav',
      modelPath: '/tmp/model',
      modelId: 'parakeet-v3-int8',
    })).rejects.toThrow('/tmp/escalaflow-stt-does-not-exist')
  })

  it('rejects oversized base64 audio before touching model or sidecar', async () => {
    await expect(transcribeWavBase64({
      wav_base64: 'a'.repeat(3_000_001),
    })).rejects.toThrow('Audio muito longo')
  })
})
