import { describe, expect, it } from 'vitest'
import { STT_MODELS } from '../../src/main/stt/catalog'

describe('STT model catalog', () => {
  it('uses Parakeet V3 int8 as default and marks it as ASR only', () => {
    const parakeet = STT_MODELS['parakeet-v3-int8']

    expect(parakeet.engine).toBe('parakeet')
    expect(parakeet.supports_translation).toBe(false)
    expect(parakeet.supports_language_hint).toBe(false)
    expect(parakeet.languages).toContain('pt')
  })

  it('does not expose unsupported Whisper models until the sidecar can route them', () => {
    expect(Object.keys(STT_MODELS)).toEqual(['parakeet-v3-int8'])
  })
})
