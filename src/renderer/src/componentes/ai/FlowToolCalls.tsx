import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from '@/components/ai-elements/tool'
import {
  mapCompletedToolCallToToolUiPart,
  mapRunningToolToToolUiPart,
  type RunningToolSnapshot,
} from '@/lib/ai-elements-adapters'
import { toolLabel } from '@/lib/tool-labels'
import type { ToolCall } from '@shared/index'

interface Props {
  toolCalls: ToolCall[]
  runningTools?: Record<string, RunningToolSnapshot>
}

export function FlowToolCalls({ toolCalls, runningTools = {} }: Props) {
  const parts = [
    ...Object.entries(runningTools).map(([toolCallId, tool]) => mapRunningToolToToolUiPart(toolCallId, tool)),
    ...toolCalls.map((call) => mapCompletedToolCallToToolUiPart(call)),
  ]

  if (parts.length === 0) return null

  return (
    <div data-testid="ia-tool-calls-panel" className="space-y-2">
      {parts.map((part) => {
        const output = part.state === 'output-available' ? part.output : undefined
        const errorText = part.state === 'output-error' ? part.errorText : undefined
        return (
          <Tool
            key={part.toolCallId}
            defaultOpen={part.state !== 'output-available'}
            data-testid="ia-tool-call"
            data-tool-name={part.toolName}
          >
            <ToolHeader
              type="dynamic-tool"
              toolName={part.toolName}
              title={toolLabel(part.toolName)}
              state={part.state}
            />
            <ToolContent>
              <ToolInput input={part.input} />
              {output !== undefined || errorText !== undefined ? (
                <ToolOutput output={output} errorText={errorText} />
              ) : null}
            </ToolContent>
          </Tool>
        )
      })}
    </div>
  )
}
