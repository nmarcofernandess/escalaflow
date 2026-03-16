import type { RuleConfig } from './types'
import type { DiaSemana } from './constants'
import type { SimulaCicloOutput } from './simula-ciclo'

export type PreviewDiagnosticSeverity = 'error' | 'warning' | 'info'
export type PreviewGate = 'ALLOW' | 'CONFIRM_OVERRIDE' | 'BLOCK'

export interface PreviewDiagnostic {
  code: string
  severity: PreviewDiagnosticSeverity
  gate: PreviewGate
  title: string
  detail: string
  source: 'capacity' | 'domingo_ciclo' | 'domingo_consecutivo' | 'preview' | 'advisory_current' | 'advisory_proposal'
  overridableBy?: RuleConfig
}

interface PreviewParticipantDiagnosticInput {
  id: number
  nome: string
  sexo: 'M' | 'F'
  domingo_ciclo_trabalho?: number
  domingo_ciclo_folga?: number
  folga_fixa_dom?: boolean
}

interface BuildPreviewDiagnosticsInput {
  output: SimulaCicloOutput
  participants: PreviewParticipantDiagnosticInput[]
  demandaPorDia: number[]
  trabalhamDomingo: number
  rules?: RuleConfig
}

const DIA_LABELS: DiaSemana[] = ['SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB', 'DOM']

function gatePriority(gate: PreviewGate): number {
  if (gate === 'BLOCK') return 3
  if (gate === 'CONFIRM_OVERRIDE') return 2
  return 1
}

export function resolvePreviewGate(diagnostics: PreviewDiagnostic[]): PreviewGate {
  let current: PreviewGate = 'ALLOW'
  for (const diagnostic of diagnostics) {
    if (gatePriority(diagnostic.gate) > gatePriority(current)) {
      current = diagnostic.gate
    }
  }
  return current
}

function sundayExactCapacity(participants: PreviewParticipantDiagnosticInput[]): number {
  const capacity = participants.reduce((sum, participant) => {
    if (participant.folga_fixa_dom) return sum
    const trabalho = participant.domingo_ciclo_trabalho ?? 2
    const folga = participant.domingo_ciclo_folga ?? 1
    const janela = trabalho + folga
    if (janela <= 0 || trabalho <= 0) return sum
    return sum + (trabalho / janela)
  }, 0)
  return Math.floor(capacity)
}

function sundayStreakForRow(output: SimulaCicloOutput, rowIndex: number): number {
  const row = output.grid[rowIndex]
  if (!row) return 0
  let max = 0
  let current = 0
  for (const semana of row.semanas) {
    if (semana.trabalhou_domingo) {
      current += 1
      max = Math.max(max, current)
    } else {
      current = 0
    }
  }
  return max
}

export function buildPreviewDiagnostics({
  output,
  participants,
  demandaPorDia,
  trabalhamDomingo,
  rules,
}: BuildPreviewDiagnosticsInput): PreviewDiagnostic[] {
  const diagnostics: PreviewDiagnostic[] = []

  if (!output.sucesso) {
    diagnostics.push({
      code: 'PREVIEW_INVALIDO',
      severity: 'error',
      gate: 'BLOCK',
      title: 'Nao foi possivel montar o preview do ciclo.',
      detail: output.erro ?? 'A configuracao atual nao permite gerar um ciclo de preview valido.',
      source: 'preview',
    })
    return diagnostics
  }

  const deficits = new Set<DiaSemana>()
  for (const semana of output.cobertura_dia) {
    for (let idx = 0; idx < 7; idx += 1) {
      if ((semana.cobertura[idx] ?? 0) < (demandaPorDia[idx] ?? 0)) {
        deficits.add(DIA_LABELS[idx]!)
      }
    }
  }

  if (deficits.size > 0) {
    const dias = [...deficits]
    diagnostics.push({
      code: 'CAPACIDADE_DIARIA_INSUFICIENTE',
      severity: 'error',
      gate: 'BLOCK',
      title: `Cobertura diaria insuficiente em ${dias.join(', ')}.`,
      detail: 'O ciclo mostrado ainda deixa o setor abaixo da demanda minima nesses dias. O solver nao deve ser chamado enquanto isso nao for corrigido.',
      source: 'capacity',
    })
  }

  const exactRule = rules?.H3_DOM_CICLO_EXATO ?? 'SOFT'
  const exactCapacity = sundayExactCapacity(participants)
  if (trabalhamDomingo > exactCapacity) {
    const detail = `Demanda de domingo = ${trabalhamDomingo}, mas o maximo com o ciclo exato atual e ${exactCapacity} participante(s).`
    if (exactRule === 'HARD') {
      diagnostics.push({
        code: 'H3_DOM_CICLO_EXATO',
        severity: 'error',
        gate: 'CONFIRM_OVERRIDE',
        title: 'Rodizio exato de domingos inviavel com a regra atual.',
        detail,
        source: 'domingo_ciclo',
        overridableBy: { H3_DOM_CICLO_EXATO: 'SOFT' },
      })
    } else if (exactRule === 'SOFT') {
      diagnostics.push({
        code: 'H3_DOM_CICLO_EXATO',
        severity: 'warning',
        gate: 'ALLOW',
        title: 'Cobertura de domingo acima do ciclo exato configurado.',
        detail,
        source: 'domingo_ciclo',
      })
    }
  }

  let maxMasc = 0
  let maxFem = 0
  for (let index = 0; index < participants.length; index += 1) {
    const streak = sundayStreakForRow(output, index)
    const participant = participants[index]
    if (!participant) continue
    if (participant.sexo === 'F') maxFem = Math.max(maxFem, streak)
    else maxMasc = Math.max(maxMasc, streak)
  }

  const maxMascRule = rules?.H3_DOM_MAX_CONSEC_M ?? rules?.H3_DOM_MAX_CONSEC ?? 'HARD'
  if (maxMasc > 2) {
    const detail = `O preview chegou a ${maxMasc} domingos consecutivos para homens, acima do limite atual de 2.`
    if (maxMascRule === 'HARD') {
      diagnostics.push({
        code: 'H3_DOM_MAX_CONSEC_M',
        severity: 'error',
        gate: 'CONFIRM_OVERRIDE',
        title: 'Domingos consecutivos masculinos excedidos.',
        detail,
        source: 'domingo_consecutivo',
        overridableBy: { H3_DOM_MAX_CONSEC_M: 'SOFT' },
      })
    } else if (maxMascRule === 'SOFT') {
      diagnostics.push({
        code: 'H3_DOM_MAX_CONSEC_M',
        severity: 'warning',
        gate: 'ALLOW',
        title: 'Domingos consecutivos masculinos acima do limite ideal.',
        detail,
        source: 'domingo_consecutivo',
      })
    }
  }

  const maxFemRule = rules?.H3_DOM_MAX_CONSEC_F ?? rules?.H3_DOM_MAX_CONSEC ?? 'HARD'
  if (maxFem > 1) {
    const detail = `O preview chegou a ${maxFem} domingo(s) consecutivo(s) para mulheres, acima do limite atual de 1.`
    if (maxFemRule === 'HARD') {
      diagnostics.push({
        code: 'H3_DOM_MAX_CONSEC_F',
        severity: 'error',
        gate: 'CONFIRM_OVERRIDE',
        title: 'Domingos consecutivos femininos excedidos.',
        detail,
        source: 'domingo_consecutivo',
        overridableBy: { H3_DOM_MAX_CONSEC_F: 'SOFT' },
      })
    } else if (maxFemRule === 'SOFT') {
      diagnostics.push({
        code: 'H3_DOM_MAX_CONSEC_F',
        severity: 'warning',
        gate: 'ALLOW',
        title: 'Domingos consecutivos femininos acima do limite ideal.',
        detail,
        source: 'domingo_consecutivo',
      })
    }
  }

  return diagnostics
}
