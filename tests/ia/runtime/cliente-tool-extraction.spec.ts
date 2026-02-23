import { describe, expect, it } from 'vitest'
import { __iaClienteTestables } from '../../../src/main/ia/cliente'
import { makeToolStepFixture } from '../../setup/ia-fixtures'

describe('cliente.ts tool step mapping', () => {
  it('pareia toolCalls/toolResults por toolCallId e preserva outputs falsy', () => {
    const steps = [makeToolStepFixture()]
    const acoes = __iaClienteTestables.extractToolCallsFromSteps(steps as any[])

    expect(acoes).toHaveLength(2)
    expect(acoes[0]).toEqual({
      id: 'tc-1',
      name: 'get_context',
      args: {},
      result: null,
    })
    expect(acoes[1]).toEqual({
      id: 'tc-2',
      name: 'consultar',
      args: { value: 'Caixa' },
      result: false,
    })
  })

  it('gera assistant tool-call + tool tool-result para msgs com tool_calls', () => {
    const messages = __iaClienteTestables.buildChatMessages(
      [
        { id: '1', papel: 'usuario', conteudo: 'Oi', timestamp: 't1' },
        {
          id: '2',
          papel: 'assistente',
          conteudo: 'Vou verificar',
          timestamp: 't2',
          tool_calls: [
            {
              id: 'tc-1',
              name: 'preflight',
              args: { setor_id: 1, data_inicio: '2026-03-01', data_fim: '2026-03-31' },
              result: { status: 'ok', summary: 'Preflight concluido', blockers: [], warnings: [] },
            },
          ],
        },
      ],
      'Proxima pergunta',
    )

    // user + assistant(tool-call) + tool(tool-result) + user(current)
    expect(messages).toHaveLength(4)
    expect(messages[0]).toEqual({ role: 'user', content: 'Oi' })

    // Assistant message with text + tool-call parts
    const assistant = messages[1] as any
    expect(assistant.role).toBe('assistant')
    expect(Array.isArray(assistant.content)).toBe(true)
    expect(assistant.content[0]).toEqual({ type: 'text', text: 'Vou verificar' })
    expect(assistant.content[1]).toMatchObject({
      type: 'tool-call',
      toolCallId: 'tc-1',
      toolName: 'preflight',
      input: { setor_id: 1, data_inicio: '2026-03-01', data_fim: '2026-03-31' },
    })

    // Tool message with tool-result parts
    const toolMsg = messages[2] as any
    expect(toolMsg.role).toBe('tool')
    expect(Array.isArray(toolMsg.content)).toBe(true)
    expect(toolMsg.content[0]).toMatchObject({
      type: 'tool-result',
      toolCallId: 'tc-1',
      toolName: 'preflight',
    })
    expect(toolMsg.content[0].output.type).toBe('text')
    expect(toolMsg.content[0].output.value).toContain('ok')

    expect(messages[3]).toEqual({ role: 'user', content: 'Proxima pergunta' })
  })

  it('mantém [TOOL_RESULT_LEGADO] para papel tool_result antigo', () => {
    const messages = __iaClienteTestables.buildChatMessages(
      [
        { id: '1', papel: 'usuario', conteudo: 'Oi', timestamp: 't1' },
        { id: '2', papel: 'tool_result', conteudo: '{"ok":true,"legacy":1}', timestamp: 't2' },
      ],
      'Proxima',
    )

    expect(messages).toHaveLength(3)
    expect(messages[1]).toEqual({
      role: 'assistant',
      content: expect.stringContaining('[TOOL_RESULT_LEGADO]'),
    })
    expect((messages[1] as any).content).toContain('legacy')
  })

  it('mensagem sem tool_calls gera text simples', () => {
    const messages = __iaClienteTestables.buildChatMessages(
      [
        { id: '1', papel: 'usuario', conteudo: 'Oi', timestamp: 't1' },
        { id: '2', papel: 'assistente', conteudo: 'Ola!', timestamp: 't2' },
      ],
      'Tudo bem?',
    )

    expect(messages).toHaveLength(3)
    expect(messages[1]).toEqual({ role: 'assistant', content: 'Ola!' })
  })

  it('trunca results grandes com safeCompactJson', () => {
    const bigResult = { data: 'x'.repeat(1000) }
    const messages = __iaClienteTestables.buildChatMessages(
      [
        { id: '1', papel: 'usuario', conteudo: 'Oi', timestamp: 't1' },
        {
          id: '2',
          papel: 'assistente',
          conteudo: '',
          timestamp: 't2',
          tool_calls: [
            { id: 'tc-big', name: 'consultar', args: { entidade: 'setores' }, result: bigResult },
          ],
        },
      ],
      'E ai?',
    )

    const toolMsg = messages[2] as any
    expect(toolMsg.role).toBe('tool')
    // Result text should be truncated (much shorter than the raw 1000+ chars)
    const resultText = toolMsg.content[0].output.value as string
    expect(resultText.length).toBeLessThan(500)
    expect(resultText.endsWith('…')).toBe(true)
  })

  it('usa o system prompt novo como fonte principal (sem overlay de runtime)', () => {
    const full = __iaClienteTestables.buildFullSystemPrompt()

    expect(full).not.toContain('ATUALIZACAO OPERACIONAL (FASE 3)')
    expect(full).toContain('## 2) O Motor e Como Ele Funciona')
    expect(full).toContain('solver_status')
  })
})
