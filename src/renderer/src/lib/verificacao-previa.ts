import type {
  EscalaAdvisoryInput,
  EscalaAdvisoryOutputV2,
  EscalaPreflightIssue,
  EscalaPreflightResult,
  PreviewDiagnostic,
  RegimeEscala,
} from '@shared/index'

type RunPreflight = (
  setorId: number,
  data: {
    data_inicio: string
    data_fim: string
    regimes_override?: Array<{ colaborador_id: number; regime_escala: RegimeEscala }>
  },
) => Promise<EscalaPreflightResult>

type RunAdvisory = (input: EscalaAdvisoryInput) => Promise<EscalaAdvisoryOutputV2>

export type VerificacaoPreviaStage = 'basic' | 'motor'

interface ExecutarVerificacaoPreviaDeps {
  runPreflight: RunPreflight
  runAdvisory: RunAdvisory
  regimesOverride?: Array<{ colaborador_id: number; regime_escala: RegimeEscala }>
  onStage?: (stage: VerificacaoPreviaStage) => void
}

function preflightIssueToDiagnostic(issue: EscalaPreflightIssue): PreviewDiagnostic {
  return {
    code: issue.codigo,
    severity: issue.severidade === 'BLOCKER' ? 'error' : 'warning',
    gate: issue.severidade === 'BLOCKER' ? 'BLOCK' : 'CONFIRM_OVERRIDE',
    title: issue.mensagem,
    detail: issue.detalhe ?? '',
    source: 'capacity',
  }
}

function preflightBlockedOutput(preflight: EscalaPreflightResult): EscalaAdvisoryOutputV2 {
  const diagnostics = [
    ...preflight.blockers.map(preflightIssueToDiagnostic),
    ...preflight.warnings.map(preflightIssueToDiagnostic),
  ]

  return {
    status: 'NO_PROPOSAL',
    diagnostics,
    pin_cost: 0,
    fallback: {
      should_open_ia: true,
      reason: diagnostics[0]?.title ?? 'Ha pendencias antes de gerar a escala.',
      diagnosis_payload: { preflight },
    },
  }
}

function mergePreflightWarnings(
  output: EscalaAdvisoryOutputV2,
  preflight: EscalaPreflightResult,
): EscalaAdvisoryOutputV2 {
  if (preflight.warnings.length === 0) return output
  const warningDiagnostics = preflight.warnings.map(preflightIssueToDiagnostic)
  return {
    ...output,
    diagnostics: [...warningDiagnostics, ...output.diagnostics],
  }
}

export async function executarVerificacaoPrevia(
  input: EscalaAdvisoryInput,
  deps: ExecutarVerificacaoPreviaDeps,
): Promise<EscalaAdvisoryOutputV2> {
  deps.onStage?.('basic')
  const preflight = await deps.runPreflight(input.setor_id, {
    data_inicio: input.data_inicio,
    data_fim: input.data_fim,
    ...(deps.regimesOverride?.length ? { regimes_override: deps.regimesOverride } : {}),
  })

  if (!preflight.ok) {
    return preflightBlockedOutput(preflight)
  }

  deps.onStage?.('motor')
  const output = await deps.runAdvisory(input)
  return mergePreflightWarnings(output, preflight)
}
