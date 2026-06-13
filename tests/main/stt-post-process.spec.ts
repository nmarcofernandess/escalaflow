import { describe, expect, it } from 'vitest'
import { buildSttPostProcessPrompt } from '../../src/main/stt/post-process'

describe('stt post-processing prompt', () => {
  it('is text-only, states audio is unavailable, and preserves domain terms', () => {
    const prompt = buildSttPostProcessPrompt({
      transcript: 'gerar escala seis por um com folga domingo',
      mode: 'scale_command',
      domainTerms: ['6x1', 'folga fixa', 'Açougue'],
    })

    expect(prompt).toContain('AUDIO NAO ESTA DISPONIVEL')
    expect(prompt).toContain('gerar escala seis por um com folga domingo')
    expect(prompt).toContain('6x1')
    expect(prompt).toContain('folga fixa')
    expect(prompt).toContain('Açougue')
    expect(prompt.toLowerCase()).not.toContain('base64')
    expect(prompt.toLowerCase()).not.toContain('wav')
    expect(prompt.toLowerCase()).not.toContain('arquivo de audio')
  })
})
