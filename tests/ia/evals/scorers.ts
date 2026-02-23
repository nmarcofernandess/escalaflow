import type { ToolCall } from '../../../src/shared/types'
import type { EscalaFlowEvalCase } from './dataset'

export interface EvalRunOutput {
  text: string
  stepsCount: number
  totalTokens?: number
  toolCalls: ToolCall[]
}

export interface EvalScoreItem {
  name: string
  passed: boolean
  detail?: string
}

export interface EvalCaseResult {
  passed: boolean
  scores: EvalScoreItem[]
}

function includesTool(toolCalls: ToolCall[], toolName: string) {
  return toolCalls.some((tc) => tc.name === toolName)
}

function findToolCall(toolCalls: ToolCall[], toolName: string) {
  return toolCalls.find((tc) => tc.name === toolName)
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function objectContainsSubset(actual: unknown, subset: Record<string, unknown>): boolean {
  if (!isObject(actual)) return false

  return Object.entries(subset).every(([key, expectedValue]) => {
    const actualValue = actual[key]

    if (isObject(expectedValue)) {
      return objectContainsSubset(actualValue, expectedValue)
    }

    return actualValue === expectedValue
  })
}

export function evaluateCase(output: EvalRunOutput, evalCase: EscalaFlowEvalCase, db?: any): EvalCaseResult {
  const scores: EvalScoreItem[] = []

  // --- shouldCallTool (exato) ---
  const shouldCallTool = evalCase.expected.shouldCallTool
  if (shouldCallTool) {
    const passed = includesTool(output.toolCalls, shouldCallTool)
    scores.push({
      name: 'correct_tool',
      passed,
      detail: passed
        ? `Chamou ${shouldCallTool}.`
        : `Nao chamou ${shouldCallTool}. Chamadas: ${output.toolCalls.map((tc) => tc.name).join(', ') || '(nenhuma)'}`,
    })
  }

  // --- shouldCallAnyOf (pelo menos uma das opções) ---
  const shouldCallAnyOf = evalCase.expected.shouldCallAnyOf
  if (shouldCallAnyOf && shouldCallAnyOf.length > 0) {
    const matched = shouldCallAnyOf.find((toolName) => includesTool(output.toolCalls, toolName))
    scores.push({
      name: 'correct_tool_any_of',
      passed: !!matched,
      detail: matched
        ? `Chamou ${matched} (aceito: ${shouldCallAnyOf.join('|')}).`
        : `Nao chamou nenhuma de [${shouldCallAnyOf.join(', ')}]. Chamadas: ${output.toolCalls.map((tc) => tc.name).join(', ') || '(nenhuma)'}`,
    })
  }

  // --- shouldNotCallTools (proibidas) ---
  const shouldNotCallTools = evalCase.expected.shouldNotCallTools ?? []
  if (shouldNotCallTools.length > 0) {
    const violator = shouldNotCallTools.find((toolName) => includesTool(output.toolCalls, toolName))
    scores.push({
      name: 'forbidden_tools',
      passed: !violator,
      detail: violator ? `Chamou tool proibida neste cenário: ${violator}` : 'Nenhuma tool proibida chamada.',
    })
  }

  // --- toolArgsMustInclude (subset de args em QUALQUER chamada da tool correta) ---
  if (shouldCallTool && evalCase.expected.toolArgsMustInclude) {
    const allCalls = output.toolCalls.filter((tc) => tc.name === shouldCallTool)
    const matchingCall = allCalls.find((tc) =>
      objectContainsSubset(tc.args, evalCase.expected.toolArgsMustInclude!)
    )
    const firstCall = allCalls[0]

    scores.push({
      name: 'correct_args_subset',
      passed: !!matchingCall,
      detail: matchingCall
        ? `Args de ${shouldCallTool} contem o subset esperado.`
        : `Args de ${shouldCallTool} nao batem. Esperado subset=${JSON.stringify(evalCase.expected.toolArgsMustInclude)} atual=${JSON.stringify(firstCall?.args ?? null)}`,
    })
  }

  // --- maxSteps ---
  if (typeof evalCase.expected.maxSteps === 'number') {
    const passed = output.stepsCount <= evalCase.expected.maxSteps
    scores.push({
      name: 'steps_budget',
      passed,
      detail: passed
        ? `${output.stepsCount} step(s) <= limite ${evalCase.expected.maxSteps}.`
        : `${output.stepsCount} step(s) > limite ${evalCase.expected.maxSteps}.`,
    })
  }

  // --- textShouldInclude ---
  if (evalCase.expected.textShouldInclude?.length) {
    const textLower = (output.text ?? '').toLowerCase()
    const missing = evalCase.expected.textShouldInclude.filter((snippet) => !textLower.includes(snippet.toLowerCase()))
    scores.push({
      name: 'text_contains',
      passed: missing.length === 0,
      detail: missing.length === 0 ? 'Texto final contem trechos esperados.' : `Texto final nao contem: ${missing.join(', ')}`,
    })
  }

  // --- textShouldNotInclude ---
  if (evalCase.expected.textShouldNotInclude?.length) {
    const textLower = (output.text ?? '').toLowerCase()
    const found = evalCase.expected.textShouldNotInclude.filter((snippet) => textLower.includes(snippet.toLowerCase()))
    scores.push({
      name: 'text_excludes',
      passed: found.length === 0,
      detail: found.length === 0 ? 'Texto final nao contem trechos proibidos.' : `Texto final contem trecho proibido: ${found.join(', ')}`,
    })
  }

  // --- dbVerify (efeito real no banco) ---
  if (evalCase.dbVerify && db) {
    try {
      const { ok, detail } = evalCase.dbVerify(db)
      scores.push({
        name: 'db_effect',
        passed: ok,
        detail,
      })
    } catch (err: any) {
      scores.push({
        name: 'db_effect',
        passed: false,
        detail: `Erro ao verificar DB: ${err.message}`,
      })
    }
  }

  return {
    passed: scores.every((s) => s.passed),
    scores,
  }
}
