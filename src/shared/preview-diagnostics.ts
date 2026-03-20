import type { RuleConfig } from './types'
import type { DiaSemana } from './constants'
import type { SimulaCicloOutput, FolgaWarning } from './simula-ciclo'

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
  /** Action metadata for UI rendering (e.g., navigate to colaborador) */
  action?: { type: string; target: string; id?: number }
}

interface PreviewParticipantDiagnosticInput {
  id: number
  nome: string
  sexo: 'M' | 'F'
  domingo_ciclo_trabalho?: number
  domingo_ciclo_folga?: number
  folga_fixa_dom?: boolean
}

export interface DemandaSegmento {
  dia_semana: DiaSemana | null
  hora_inicio: string
  hora_fim: string
  min_pessoas: number
}

export type FolgaOriginKind = 'auto' | 'manual' | 'saved'

export interface FolgaOriginEntry {
  pessoa: number
  fixaOrigin: FolgaOriginKind
  varOrigin: FolgaOriginKind
}

interface BuildPreviewDiagnosticsInput {
  output: SimulaCicloOutput
  participants: PreviewParticipantDiagnosticInput[]
  demandaPorDia: number[]
  trabalhamDomingo: number
  rules?: RuleConfig
  /** Segmentos de demanda com hora — pra check manha/tarde. Opcional. */
  demandaSegmentos?: DemandaSegmento[]
  horaAbertura?: string
  horaFechamento?: string
  /** Origin per person's folgas — for origin-aware messages */
  folgaOrigins?: FolgaOriginEntry[]
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

// ---------------------------------------------------------------------------
// Helper: compute morning/afternoon peak demand per weekday
// ---------------------------------------------------------------------------

function timeToMin(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

function computeHalfDemand(
  segmentos: DemandaSegmento[],
  horaAbertura: string,
  horaFechamento: string,
): { morningByDay: Map<DiaSemana, number>; afternoonByDay: Map<DiaSemana, number> } {
  const aberturaMin = timeToMin(horaAbertura)
  const fechamentoMin = timeToMin(horaFechamento)
  const midpointMin = aberturaMin + Math.floor((fechamentoMin - aberturaMin) / 2)

  const morningByDay = new Map<DiaSemana, number>()
  const afternoonByDay = new Map<DiaSemana, number>()

  for (const seg of segmentos) {
    const inicioMin = timeToMin(seg.hora_inicio)
    const fimMin = timeToMin(seg.hora_fim)

    const applyToDay = (dia: DiaSemana): void => {
      // Segmento toca a manha? (qualquer parte antes do midpoint)
      if (inicioMin < midpointMin) {
        morningByDay.set(dia, Math.max(morningByDay.get(dia) ?? 0, seg.min_pessoas))
      }
      // Segmento toca a tarde? (qualquer parte no ou apos midpoint)
      if (fimMin > midpointMin) {
        afternoonByDay.set(dia, Math.max(afternoonByDay.get(dia) ?? 0, seg.min_pessoas))
      }
    }

    if (seg.dia_semana) {
      applyToDay(seg.dia_semana)
    } else {
      // null = aplica a todos os dias
      for (const dia of DIA_LABELS) applyToDay(dia)
    }
  }

  return { morningByDay, afternoonByDay }
}

// ---------------------------------------------------------------------------

export function buildPreviewDiagnostics({
  output,
  participants,
  demandaPorDia,
  trabalhamDomingo,
  rules,
  demandaSegmentos,
  horaAbertura,
  horaFechamento,
  folgaOrigins,
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
    const deficitRule = rules?.S_DEFICIT ?? 'SOFT'

    if (deficitRule !== 'OFF') {
      const isHard = deficitRule === 'HARD'
      diagnostics.push({
        code: 'CAPACIDADE_DIARIA_INSUFICIENTE',
        severity: isHard ? 'error' : 'warning',
        gate: isHard ? 'BLOCK' : 'ALLOW',
        title: `Cobertura diaria insuficiente em ${dias.join(', ')}.`,
        detail: isHard
          ? 'O ciclo mostrado deixa o setor abaixo da demanda minima nesses dias.'
          : `O ciclo deixa o setor abaixo da demanda em ${dias.length} dia(s). O motor vai tentar compensar, mas pode nao conseguir cobertura total.`,
        source: 'capacity',
      })
    }
  }

  // --- Check: demanda por faixa horaria (manha/tarde) ---
  if (demandaSegmentos?.length && horaAbertura && horaFechamento && deficits.size === 0) {
    const { morningByDay, afternoonByDay } = computeHalfDemand(demandaSegmentos, horaAbertura, horaFechamento)

    // Per-day: cobertura media do ciclo vs max(manha, tarde)
    const avgCoverage = new Map<DiaSemana, number>()
    for (const semana of output.cobertura_dia) {
      for (let idx = 0; idx < 7; idx += 1) {
        const dia = DIA_LABELS[idx]!
        const prev = avgCoverage.get(dia)
        const val = semana.cobertura[idx] ?? 0
        avgCoverage.set(dia, prev === undefined ? val : Math.min(prev, val))
      }
    }

    const faixaProblems: string[] = []
    for (const dia of DIA_LABELS) {
      const cob = avgCoverage.get(dia) ?? 0
      const manha = morningByDay.get(dia) ?? 0
      const tarde = afternoonByDay.get(dia) ?? 0
      if (manha === 0 && tarde === 0) continue
      // Se cobertura < max(manha, tarde), impossivel cobrir mesmo com turnos integrais
      if (cob < Math.max(manha, tarde)) {
        faixaProblems.push(`${dia} (manha: ${manha}, tarde: ${tarde}, disponiveis: ${cob})`)
      }
    }

    if (faixaProblems.length > 0) {
      diagnostics.push({
        code: 'DEMANDA_FAIXA_INSUFICIENTE',
        severity: 'warning',
        gate: 'ALLOW',
        title: `Cobertura por faixa horaria pode ser insuficiente em ${faixaProblems.length} dia(s).`,
        detail: faixaProblems.join('; '),
        source: 'capacity',
      })
    }
  }

  // --- Check: folga warnings do ciclo (FF/FV causando deficit) ---
  if (output.folga_warnings?.length) {
    for (const w of output.folga_warnings) {
      const diaLabel = DIA_LABELS[w.dia] ?? `dia ${w.dia}`

      if (w.pessoa === -1) {
        // Sentinela: excesso de folgas no dia inteiro (pre-check)
        diagnostics.push({
          code: 'FOLGA_FIXA_CONFLITO',
          severity: 'warning',
          gate: 'ALLOW',
          title: `Muitas folgas fixas em ${diaLabel}: sobram ${w.coberturaRestante}, demanda e ${w.demandaDia}.`,
          detail: 'Troque a folga fixa de alguem nesse dia para outro dia da semana.',
          source: 'capacity',
        })
        continue
      }

      // Determine origin for this person's folga
      const originInfo = folgaOrigins?.find((o) => o.pessoa === w.pessoa)
      const origin = w.tipo === 'FV_CONFLITO' ? originInfo?.varOrigin : originInfo?.fixaOrigin
      const nomePessoa = participants[w.pessoa]?.nome ?? `Pessoa ${w.pessoa + 1}`

      // Auto: skip — auto-redistribution handles this with visual feedback
      if (origin === 'auto') continue

      // Manual: informative with numbers, no command to change
      if (origin === 'manual') {
        diagnostics.push({
          code: 'FOLGA_MANUAL_DEFICIT',
          severity: 'warning',
          gate: 'ALLOW',
          title: `Folga de ${nomePessoa} em ${diaLabel} (sua escolha): sobram ${w.coberturaRestante}, demanda e ${w.demandaDia}.`,
          detail: 'O sistema vai respeitar essa escolha ao gerar a escala.',
          source: 'capacity',
        })
        continue
      }

      // Saved: structural info with action metadata
      if (origin === 'saved') {
        diagnostics.push({
          code: 'FOLGA_SALVA_DEFICIT',
          severity: 'info',
          gate: 'ALLOW',
          title: `Folga de ${nomePessoa} em ${diaLabel} (cadastro): sobram ${w.coberturaRestante}, demanda e ${w.demandaDia}.`,
          detail: 'Esta folga esta definida no cadastro do colaborador.',
          source: 'capacity',
          action: { type: 'navigate', target: 'colaborador', id: participants[w.pessoa]?.id },
        })
        continue
      }

      // Fallback: no origin info (legacy) — keep original message
      diagnostics.push({
        code: w.tipo === 'FV_CONFLITO' ? 'FOLGA_VARIAVEL_CONFLITO' : 'FOLGA_FIXA_CONFLITO',
        severity: 'warning',
        gate: 'ALLOW',
        title: `Folga de ${nomePessoa} em ${diaLabel}: sobram ${w.coberturaRestante}, demanda e ${w.demandaDia}.`,
        detail: 'Troque o dia de folga para reduzir o deficit.',
        source: 'capacity',
      })
    }
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
