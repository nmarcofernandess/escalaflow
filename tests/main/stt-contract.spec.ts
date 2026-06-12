import { describe, expect, it } from 'vitest'
import type { SttModelId, SttTranscriptResult } from '../../src/shared/types'

describe('STT shared contract', () => {
  it('models Parakeet as transcript-first STT', () => {
    const model: SttModelId = 'parakeet-v3-int8'
    const result: SttTranscriptResult = {
      text: 'Preciso cadastrar uma escala seis por um para o setor de acougue.',
      raw_text: 'Preciso cadastrar uma escala seis por um para o setor de acougue.',
      model_id: model,
      duration_ms: 1200,
      audio_duration_ms: 4500,
      language: 'pt',
      post_processed: false,
    }

    expect(result.model_id).toBe('parakeet-v3-int8')
    expect(result.post_processed).toBe(false)
  })
})
