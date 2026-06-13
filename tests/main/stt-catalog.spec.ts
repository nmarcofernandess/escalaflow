import { describe, expect, it } from 'vitest'
import { DEFAULT_STT_MODEL_ID, STT_MODELS } from '../../src/main/stt/catalog'

describe('stt catalog', () => {
  it('uses Parakeet v3 INT8 as the default ASR-only Portuguese-capable model', () => {
    const model = STT_MODELS[DEFAULT_STT_MODEL_ID]

    expect(DEFAULT_STT_MODEL_ID).toBe('parakeet-v3-int8')
    expect(model.engine).toBe('parakeet')
    expect(model.asr_only).toBe(true)
    expect(model.supports_pt).toBe(true)
    expect(model.languages).toContain('pt')
    expect(model.storage).toBe('directory')
    expect(model.recommended).toBe(true)
  })

  it('keeps Whisper entries as fallback files', () => {
    expect(STT_MODELS['whisper-small-q5'].engine).toBe('whisper')
    expect(STT_MODELS['whisper-small-q5'].storage).toBe('file')
    expect(STT_MODELS['whisper-medium-q5'].engine).toBe('whisper')
    expect(STT_MODELS['whisper-medium-q5'].storage).toBe('file')
  })
})
