import { describe, expect, it } from 'vitest'
import { DEFAULT_STT_MODEL_ID, STT_MODELS } from '../../src/main/stt/catalog'

describe('stt catalog', () => {
  it('exposes only Parakeet v3 INT8 as the local ASR model', () => {
    const model = STT_MODELS[DEFAULT_STT_MODEL_ID]

    expect(Object.keys(STT_MODELS)).toEqual(['parakeet-v3-int8'])
    expect(DEFAULT_STT_MODEL_ID).toBe('parakeet-v3-int8')
    expect(model.engine).toBe('parakeet')
    expect(model.asr_only).toBe(true)
    expect(model.supports_pt).toBe(true)
    expect(model.supports_translation).toBe(false)
    expect(model.supports_language_hint).toBe(false)
    expect(model.languages).toContain('pt')
    expect(model.storage).toBe('directory')
    expect(model.recommended).toBe(true)
  })
})
