export function buildSttPostProcessPrompt(input: {
  transcript: string
  mode: 'clean_prompt' | 'formal_message' | 'rh_note'
  domainTerms: string[]
}): string {
  const modeInstruction = {
    clean_prompt: 'Transforme o ditado em uma mensagem clara para um assistente de RH. Preserve comandos, nomes, datas, numeros e intencao.',
    formal_message: 'Transforme o ditado em uma mensagem profissional curta, sem inventar informacao.',
    rh_note: 'Transforme o ditado em uma nota operacional de RH, com bullets somente se o ditado pedir multiplos itens.',
  }[input.mode]

  return [
    'Voce vai limpar uma transcricao de fala para texto.',
    'AUDIO NAO ESTA DISPONIVEL. Trabalhe apenas com o texto abaixo.',
    'Nao invente fatos. Nao execute a tarefa. Apenas reescreva o texto.',
    'Mantenha termos do dominio quando fizer sentido.',
    `Termos importantes: ${input.domainTerms.join(', ') || 'nenhum'}`,
    `Instrucao: ${modeInstruction}`,
    '',
    'Transcricao:',
    input.transcript,
  ].join('\n')
}
