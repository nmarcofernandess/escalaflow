import type { DynamicToolUIPart, TextUIPart, UIMessage } from 'ai'
import type { IaContextMeta, IaMensagem, ToolCall } from '@shared/index'

export type FlowAiMessagePart =
  | TextUIPart
  | DynamicToolUIPart

export type FlowAiMessage = UIMessage<{ turnMeta?: IaContextMeta; source: 'flowkit' }>

export interface RunningToolSnapshot {
  tool_name: string
  args?: Record<string, unknown>
  estimated_seconds?: number
  started_at: number
}

export interface VoiceCaptureInput {
  recording: boolean
  transcribing: boolean
  text: string
  error?: string
  postProcessed: boolean
}

export interface VoiceCaptureSnapshot {
  status: 'idle' | 'recording' | 'transcribing' | 'ready' | 'error'
  transcript: string
  postProcessed: boolean
  label: string
  error?: string
}

function hasOwn(value: unknown, key: string): boolean {
  return typeof value === 'object' && value !== null && Object.prototype.hasOwnProperty.call(value, key)
}

function safeRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function isErrorOutput(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const output = value as Record<string, unknown>
  return output.ok === false
    || output.status === 'error'
    || output.erro != null
    || output.error != null
}

function errorText(value: unknown): string {
  if (!value || typeof value !== 'object') return 'Ferramenta retornou erro.'
  const output = value as Record<string, unknown>
  const raw = output.error ?? output.erro ?? output.message ?? 'Ferramenta retornou erro.'
  return typeof raw === 'string' ? raw : JSON.stringify(raw)
}

export function mapRunningToolToToolUiPart(toolCallId: string, tool: RunningToolSnapshot): DynamicToolUIPart {
  return {
    type: 'dynamic-tool',
    toolCallId,
    toolName: tool.tool_name,
    title: tool.tool_name,
    state: 'input-available',
    input: tool.args ?? {},
  }
}

export function mapCompletedToolCallToToolUiPart(call: ToolCall): DynamicToolUIPart {
  const compat = call as ToolCall & { input?: unknown; output?: unknown }
  const input = safeRecord(hasOwn(compat, 'args') ? compat.args : compat.input)
  const hasOutput = hasOwn(compat, 'result') || hasOwn(compat, 'output')
  const output = hasOwn(compat, 'result') ? compat.result : compat.output

  if (!hasOutput) {
    return {
      type: 'dynamic-tool',
      toolCallId: call.id,
      toolName: call.name,
      title: call.name,
      state: 'input-available',
      input,
    }
  }

  if (isErrorOutput(output)) {
    return {
      type: 'dynamic-tool',
      toolCallId: call.id,
      toolName: call.name,
      title: call.name,
      state: 'output-error',
      input,
      errorText: errorText(output),
    }
  }

  return {
    type: 'dynamic-tool',
    toolCallId: call.id,
    toolName: call.name,
    title: call.name,
    state: 'output-available',
    input,
    output,
  }
}

export function mapFlowMessageParts(msg: IaMensagem): FlowAiMessagePart[] {
  const parts: FlowAiMessagePart[] = []
  if (msg.conteudo.trim()) {
    parts.push({ type: 'text', text: msg.conteudo, state: 'done' })
  }
  for (const call of msg.tool_calls ?? []) {
    parts.push(mapCompletedToolCallToToolUiPart(call))
  }
  return parts
}

export function mapStoredMessageToUiMessage(msg: IaMensagem, turnMeta?: IaContextMeta): FlowAiMessage {
  return {
    id: msg.id,
    role: msg.papel === 'usuario' ? 'user' : 'assistant',
    metadata: { source: 'flowkit', ...(turnMeta ? { turnMeta } : {}) },
    parts: mapFlowMessageParts(msg),
  }
}

export function buildStreamingAssistantUiMessage(input: {
  streamId: string
  text: string
  runningTools: Record<string, RunningToolSnapshot>
  completedToolCalls: ToolCall[]
  turnMeta?: IaContextMeta
}): FlowAiMessage {
  const parts: FlowAiMessagePart[] = []
  if (input.text.trim()) {
    parts.push({ type: 'text', text: input.text, state: 'streaming' })
  }
  for (const [toolCallId, tool] of Object.entries(input.runningTools)) {
    parts.push(mapRunningToolToToolUiPart(toolCallId, tool))
  }
  for (const call of input.completedToolCalls) {
    parts.push(mapCompletedToolCallToToolUiPart(call))
  }

  return {
    id: `stream-${input.streamId}`,
    role: 'assistant',
    metadata: { source: 'flowkit', ...(input.turnMeta ? { turnMeta: input.turnMeta } : {}) },
    parts,
  }
}

export function mapVoiceCaptureSnapshot(input: VoiceCaptureInput): VoiceCaptureSnapshot {
  if (input.error) {
    return {
      status: 'error',
      transcript: input.text,
      postProcessed: input.postProcessed,
      label: 'Erro no ditado local',
      error: input.error,
    }
  }
  if (input.recording) {
    return {
      status: 'recording',
      transcript: input.text,
      postProcessed: input.postProcessed,
      label: 'Gravando áudio',
    }
  }
  if (input.transcribing) {
    return {
      status: 'transcribing',
      transcript: input.text,
      postProcessed: input.postProcessed,
      label: 'Transcrevendo localmente',
    }
  }
  if (input.text.trim()) {
    return {
      status: 'ready',
      transcript: input.text,
      postProcessed: input.postProcessed,
      label: 'Transcrição local',
    }
  }
  return {
    status: 'idle',
    transcript: '',
    postProcessed: input.postProcessed,
    label: 'Ditado local',
  }
}
