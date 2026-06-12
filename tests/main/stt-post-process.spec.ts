import { describe, expect, it } from 'vitest'
import { buildSttPostProcessPrompt } from '../../src/main/stt/post-process'

describe('STT post-processing prompt', () => {
  it('processes text only and preserves intent', () => {
    const prompt = buildSttPostProcessPrompt({
      transcript: 'cria uma escala seis por um para o acougue e ve se a maria pode folgar domingo',
      mode: 'clean_prompt',
      domainTerms: ['6x1', 'Acougue', 'Maria', 'folga domingo'],
    })

    expect(prompt).toContain('AUDIO NAO ESTA DISPONIVEL')
    expect(prompt).toContain('cria uma escala seis por um')
    expect(prompt).toContain('6x1')
    expect(prompt).not.toContain('base64')
  })
})
