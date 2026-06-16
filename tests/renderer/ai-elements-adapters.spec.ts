import { describe, expect, it } from 'vitest'
import {
  buildStreamingAssistantUiMessage,
  mapCompletedToolCallToToolUiPart,
  mapFlowMessageParts,
  mapRunningToolToToolUiPart,
  mapStoredMessageToUiMessage,
  mapVoiceCaptureSnapshot,
} from '../../src/renderer/src/lib/ai-elements-adapters'
import type { IaMensagem, ToolCall } from '../../src/shared/types'

describe('ai elements adapters', () => {
  it('maps stored assistant markdown into a UIMessage text part', () => {
    const msg: IaMensagem = {
      id: 'm1',
      papel: 'assistente',
      conteudo: '# Ola\n\nTexto',
      timestamp: '2026-06-14T00:00:00.000Z',
    }

    expect(mapStoredMessageToUiMessage(msg)).toMatchObject({
      id: 'm1',
      role: 'assistant',
      parts: [{ type: 'text', text: '# Ola\n\nTexto', state: 'done' }],
    })
  })

  it('maps running tools into AI SDK dynamic-tool input-available state', () => {
    expect(mapRunningToolToToolUiPart('tool-live', {
      tool_name: 'terminal_exec',
      args: { command: 'pwd' },
      started_at: 1,
      estimated_seconds: 2,
    })).toEqual({
      type: 'dynamic-tool',
      toolCallId: 'tool-live',
      toolName: 'terminal_exec',
      title: 'terminal_exec',
      state: 'input-available',
      input: { command: 'pwd' },
    })
  })

  it('maps completed tool calls to AI SDK dynamic-tool output-available state', () => {
    const call: ToolCall = {
      id: 'tool-1',
      name: 'terminal_exec',
      args: { command: 'pwd' },
      result: { ok: true, output: '/tmp' },
    }

    expect(mapCompletedToolCallToToolUiPart(call)).toMatchObject({
      type: 'dynamic-tool',
      toolCallId: 'tool-1',
      toolName: 'terminal_exec',
      state: 'output-available',
      input: { command: 'pwd' },
      output: { ok: true, output: '/tmp' },
    })
  })

  it('maps tool error payloads to AI SDK dynamic-tool output-error state', () => {
    const call: ToolCall = {
      id: 'tool-2',
      name: 'buscar_conhecimento',
      args: {},
      result: { status: 'error', error: 'falhou' },
    }

    expect(mapCompletedToolCallToToolUiPart(call)).toMatchObject({
      type: 'dynamic-tool',
      toolCallId: 'tool-2',
      toolName: 'buscar_conhecimento',
      state: 'output-error',
      input: {},
      errorText: 'falhou',
    })
  })

  it('builds the live assistant UIMessage from text delta, running tools and completed tools', () => {
    const message = buildStreamingAssistantUiMessage({
      streamId: 'stream-1',
      text: 'Resposta parcial',
      runningTools: {
        'tool-live': {
          tool_name: 'terminal_exec',
          args: { command: 'cat "/tmp/a b.txt"' },
          started_at: 10,
        },
      },
      completedToolCalls: [
        { id: 'tool-done', name: 'buscar_conhecimento', args: { query: 'flowkit' }, result: { ok: true } },
      ],
    })

    expect(message).toMatchObject({
      id: 'stream-stream-1',
      role: 'assistant',
      parts: [
        { type: 'text', text: 'Resposta parcial', state: 'streaming' },
        { type: 'dynamic-tool', toolCallId: 'tool-live', state: 'input-available' },
        { type: 'dynamic-tool', toolCallId: 'tool-done', state: 'output-available' },
      ],
    })
  })

  it('keeps mapFlowMessageParts as a compatibility alias for UIMessage parts', () => {
    const msg: IaMensagem = {
      id: 'm2',
      papel: 'assistente',
      conteudo: 'ok',
      timestamp: '2026-06-14T00:00:00.000Z',
      tool_calls: [{ id: 'tool-3', name: 'status_sistema', result: { ok: true } }],
    }

    expect(mapFlowMessageParts(msg).map((part) => part.type)).toEqual(['text', 'dynamic-tool'])
  })

  it('maps transcript-first voice capture without post-processing claims', () => {
    expect(mapVoiceCaptureSnapshot({
      recording: false,
      transcribing: false,
      text: 'texto literal',
      postProcessed: false,
    })).toEqual({
      status: 'ready',
      transcript: 'texto literal',
      postProcessed: false,
      label: 'Transcrição local',
    })
  })
})
