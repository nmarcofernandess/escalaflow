import { ChevronDown, Wrench, CheckCircle, AlertCircle, Eye } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { useState } from 'react'
import type { ToolCall } from '@shared/index'

const TOOL_ICONS: Record<string, string> = {
  consultar: '📊',
  buscar_colaborador: '🔍',
  criar: '➕',
  atualizar: '✏️',
  deletar: '🗑️',
  gerar_escala: '🗓️',
  ajustar_alocacao: '📌',
  oficializar_escala: '✅',
  preflight: '🛫',
  editar_regra: '⚙️',
  explicar_violacao: '📖',
}

interface Props {
  toolCalls: ToolCall[]
}

type ToolCallCompat = ToolCall & {
  input?: unknown
  output?: unknown
}

// We must check property presence (not truthiness) because valid tool data can be:
// args = {}, result = null, false, 0, etc.
function hasOwn(value: unknown, key: string): boolean {
  return typeof value === 'object' && value !== null && Object.prototype.hasOwnProperty.call(value, key)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function formatJson(value: unknown): string {
  try {
    const serialized = JSON.stringify(value, null, 2)
    if (serialized !== undefined) return serialized
    return String(value)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Falha ao serializar JSON'
    return `[json indisponivel: ${message}]`
  }
}

export function IaToolCallsCollapsible({ toolCalls }: Props) {
  const [isOpen, setIsOpen] = useState(false)  // Fechado por padrão
  const [expandedOutputs, setExpandedOutputs] = useState<Set<string>>(new Set())

  if (!toolCalls || toolCalls.length === 0) return null

  const toggleOutput = (callId: string) => {
    setExpandedOutputs((prev) => {
      const next = new Set(prev)
      if (next.has(callId)) {
        next.delete(callId)
      } else {
        next.add(callId)
      }
      return next
    })
  }

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <Card data-testid="ia-tool-calls-panel" className="w-full min-w-0 max-w-full border-muted bg-muted/30 overflow-hidden">
        <CollapsibleTrigger className="flex w-full min-w-0 items-center justify-between p-3 text-sm hover:bg-muted/50 transition-colors">
          <div className="flex items-center gap-2">
            <Wrench className="size-3.5 text-muted-foreground" />
            <span className="font-medium text-muted-foreground">
              {toolCalls.length} {toolCalls.length === 1 ? 'ferramenta utilizada' : 'ferramentas utilizadas'}
            </span>
          </div>
          <ChevronDown
            className={`size-4 text-muted-foreground transition-transform ${isOpen ? 'rotate-180' : ''}`}
          />
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="min-w-0 max-w-full border-t border-muted">
            {toolCalls.map((call) => {
              const compatCall = call as ToolCallCompat
              // Runtime compatibility: newer payloads use args/result, but older/raw payloads may expose input/output.
              const hasArgsProp = hasOwn(compatCall, 'args') || hasOwn(compatCall, 'input')
              const hasResultProp = hasOwn(compatCall, 'result') || hasOwn(compatCall, 'output')
              // Preserve explicit null/false/0 by checking property presence instead of nullish coalescing.
              const argsValue = hasArgsProp
                ? (hasOwn(compatCall, 'args') ? compatCall.args : compatCall.input)
                : undefined
              const resultValue = hasResultProp
                ? (hasOwn(compatCall, 'result') ? compatCall.result : compatCall.output)
                : undefined
              const hasError =
                hasResultProp &&
                isRecord(resultValue) &&
                (
                  'erro' in resultValue ||
                  'error' in resultValue ||
                  resultValue.status === 'error'
                )
              const icon = TOOL_ICONS[call.name] || '🔧'
              const outputExpanded = expandedOutputs.has(call.id)

              return (
                <div
                  key={call.id}
                  data-testid="ia-tool-call"
                  data-tool-name={call.name}
                  className="w-full min-w-0 max-w-full border-b border-muted last:border-0 p-3 text-xs space-y-2"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="text-base shrink-0">{icon}</span>
                    <code className="min-w-0 break-all font-mono font-semibold text-foreground">{call.name}</code>
                    {!hasResultProp ? (
                      <Badge variant="secondary" className="gap-1 h-5 shrink-0">
                        Sem output
                      </Badge>
                    ) : hasError ? (
                      <Badge variant="destructive" className="gap-1 h-5">
                        <AlertCircle className="size-3" />
                        Erro
                      </Badge>
                    ) : (
                      <Badge
                        variant="outline"
                        className="gap-1 h-5 bg-success/10 text-success border-success/20"
                      >
                        <CheckCircle className="size-3" />
                        OK
                      </Badge>
                    )}
                  </div>

                  {/* Args (sempre visível se existir) */}
                  {hasArgsProp && (
                    <div className="pl-6 min-w-0 max-w-full">
                      <div className="text-xs text-muted-foreground font-medium mb-1">Argumentos:</div>
                      <pre className="w-full min-w-0 max-w-full whitespace-pre p-2 bg-muted/50 rounded text-xs overflow-x-auto">
                        {formatJson(argsValue)}
                      </pre>
                    </div>
                  )}

                  {/* Botão Ver Output */}
                  {hasResultProp ? (
                    <div className="pl-6 min-w-0 max-w-full">
                      <Button
                        variant="ghost"
                        size="sm"
                        type="button"
                        onClick={() => toggleOutput(call.id)}
                        className="h-7 text-xs gap-1.5 hover:bg-muted"
                      >
                        <Eye className="size-3" />
                        {outputExpanded ? 'Ocultar output' : 'Ver output'}
                      </Button>

                      {outputExpanded && (
                        <pre
                          className={`mt-2 w-full min-w-0 max-w-full whitespace-pre p-2 rounded text-xs overflow-x-auto max-h-[400px] overflow-y-auto ${
                            hasError ? 'bg-destructive/10 text-destructive' : 'bg-muted/50'
                          }`}
                        >
                          {formatJson(resultValue)}
                        </pre>
                      )}
                    </div>
                  ) : (
                    <div className="pl-6 min-w-0 max-w-full">
                      <div className="text-xs text-muted-foreground">
                        Output não persistido
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  )
}
