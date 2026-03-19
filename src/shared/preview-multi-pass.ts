import { gerarCicloFase1, type SimulaCicloFase1Input, type SimulaCicloOutput } from './simula-ciclo'
import { buildPreviewDiagnostics, type PreviewDiagnostic, type DemandaSegmento } from './preview-diagnostics'
import type { RuleConfig } from './types'

interface MultiPassParticipant {
  id: number
  nome: string
  sexo: 'M' | 'F'
  domingo_ciclo_trabalho?: number
  domingo_ciclo_folga?: number
  folga_fixa_dom?: boolean
}

export interface MultiPassInput {
  fase1Input: SimulaCicloFase1Input
  participants: MultiPassParticipant[]
  demandaPorDia: number[]
  trabalhamDomingo: number
  rules: RuleConfig
  demandaSegmentos?: DemandaSegmento[]
  horaAbertura?: string
  horaFechamento?: string
}

export interface MultiPassResult {
  output: SimulaCicloOutput
  diagnostics: PreviewDiagnostic[]
  pass_usado: 1 | 2
  relaxed: boolean
}

export function runPreviewMultiPass(input: MultiPassInput): MultiPassResult {
  const { fase1Input, participants, demandaPorDia, trabalhamDomingo, rules,
    demandaSegmentos, horaAbertura, horaFechamento } = input

  const diagExtra = { demandaSegmentos, horaAbertura, horaFechamento }

  // --- Pass 1: strict (preflight=true) ---
  const pass1 = gerarCicloFase1({ ...fase1Input, preflight: true })

  if (pass1.sucesso) {
    const diagnostics = buildPreviewDiagnostics({
      output: pass1, participants, demandaPorDia, trabalhamDomingo, rules, ...diagExtra,
    })
    return { output: pass1, diagnostics, pass_usado: 1, relaxed: false }
  }

  // --- Check if relaxable ---
  const N = fase1Input.num_postos
  const K = fase1Input.trabalham_domingo
  const kMaxSemTT = Math.floor(N / 2)
  const causaEhTT = K > kMaxSemTT && K <= N

  const h3MascSoft = (rules.H3_DOM_MAX_CONSEC_M ?? rules.H3_DOM_MAX_CONSEC ?? 'HARD') !== 'HARD'
  const h3FemSoft = (rules.H3_DOM_MAX_CONSEC_F ?? rules.H3_DOM_MAX_CONSEC ?? 'HARD') !== 'HARD'
  const podeRelaxar = causaEhTT && (h3MascSoft || h3FemSoft)

  if (!podeRelaxar) {
    const diagnostics = buildPreviewDiagnostics({
      output: pass1, participants, demandaPorDia, trabalhamDomingo, rules, ...diagExtra,
    })
    return { output: pass1, diagnostics, pass_usado: 1, relaxed: false }
  }

  // --- Pass 2: relaxed (preflight=false) ---
  const pass2 = gerarCicloFase1({ ...fase1Input, preflight: false })

  const diagnostics = buildPreviewDiagnostics({
    output: pass2, participants, demandaPorDia, trabalhamDomingo, rules, ...diagExtra,
  })

  return { output: pass2, diagnostics, pass_usado: 2, relaxed: true }
}
