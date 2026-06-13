import { describe, expect, it, vi } from 'vitest'
import { encodePcm16Wav, uint8ToBase64 } from '../../src/renderer/src/lib/audio-wav'

describe('encodePcm16Wav', () => {
  it('writes a mono 16k WAV header', () => {
    const wav = encodePcm16Wav(new Float32Array([0, 0.5, -0.5]), 16000)
    const view = new DataView(wav.buffer)

    expect(String.fromCharCode(...wav.slice(0, 4))).toBe('RIFF')
    expect(String.fromCharCode(...wav.slice(8, 12))).toBe('WAVE')
    expect(view.getUint32(24, true)).toBe(16000)
    expect(view.getUint16(22, true)).toBe(1)
    expect(view.getUint16(34, true)).toBe(16)
  })

  it('encodes large byte arrays to base64 in chunks', () => {
    vi.stubGlobal('btoa', (value: string) => Buffer.from(value, 'binary').toString('base64'))

    const bytes = new Uint8Array(100_000)
    bytes.fill(65)

    expect(uint8ToBase64(bytes)).toBe(Buffer.from(bytes).toString('base64'))

    vi.unstubAllGlobals()
  })
})
