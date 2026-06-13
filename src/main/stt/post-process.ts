import type { SttPostProcessOptions } from '../../shared/types'

export interface BuildSttPostProcessPromptInput {
  transcript: string
  mode?: SttPostProcessOptions['mode']
  domainTerms?: string[]
}

export function buildSttPostProcessPrompt(input: BuildSttPostProcessPromptInput): string {
  const mode = input.mode ?? 'clean_transcript'
  const terms = (input.domainTerms ?? [])
    .map((term) => term.trim())
    .filter(Boolean)

  return [
    'Voce vai revisar uma transcricao de fala para texto.',
    'AUDIO NAO ESTA DISPONIVEL. Use somente o texto abaixo.',
    'Nao invente informacoes, nao adicione falas e nao afirme ter ouvido nada.',
    `Modo: ${mode}.`,
    terms.length > 0 ? `Termos de dominio a preservar: ${terms.join(', ')}.` : 'Termos de dominio a preservar: nenhum.',
    'Transcricao:',
    input.transcript,
  ].join('\n')
}
