import type { SttPostProcessOptions } from '../../shared/types'

export interface BuildSttPostProcessPromptInput {
  transcript: string
  mode?: SttPostProcessOptions['mode'] | 'clean_prompt' | 'formal_message' | 'rh_note'
  domainTerms?: string[]
}

function modeInstruction(mode: BuildSttPostProcessPromptInput['mode']): string {
  switch (mode) {
    case 'formal_message':
      return 'Transforme o ditado em uma mensagem profissional curta, sem inventar informacao.'
    case 'rh_note':
    case 'rh_notes':
      return 'Transforme o ditado em uma nota operacional de RH, com bullets somente se o ditado pedir multiplos itens.'
    case 'scale_command':
    case 'clean_prompt':
      return 'Transforme o ditado em uma mensagem clara para o assistente de RH. Preserve comandos, nomes, datas, numeros e intencao.'
    case 'none':
      return 'Nao reescreva o conteudo; apenas preserve a transcricao.'
    case 'clean_transcript':
    default:
      return 'Limpe pontuacao e capitalizacao sem mudar intencao, fatos ou comandos.'
  }
}

export function buildSttPostProcessPrompt(input: BuildSttPostProcessPromptInput): string {
  const terms = (input.domainTerms ?? [])
    .map((term) => term.trim())
    .filter(Boolean)

  return [
    'Voce vai revisar uma transcricao de fala para texto.',
    'AUDIO NAO ESTA DISPONIVEL. Use somente o texto abaixo.',
    'Nao invente informacoes, nao adicione falas e nao afirme ter ouvido nada.',
    'Nao execute a tarefa. Apenas reescreva o texto.',
    `Instrucao: ${modeInstruction(input.mode)}.`,
    terms.length > 0 ? `Termos de dominio a preservar: ${terms.join(', ')}.` : 'Termos de dominio a preservar: nenhum.',
    '',
    'Transcricao:',
    input.transcript,
  ].join('\n')
}
