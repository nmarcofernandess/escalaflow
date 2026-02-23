export function makeToolStepFixture() {
  return {
    toolCalls: [
      { toolCallId: 'tc-1', toolName: 'get_context', input: {} },
      { toolCallId: 'tc-2', toolName: 'consultar', input: 'Caixa' },
    ],
    toolResults: [
      { toolCallId: 'tc-2', output: false },
      { toolCallId: 'tc-1', output: null },
    ],
  }
}

