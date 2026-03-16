import type { DiaSemana } from './constants'
import type { PreviewDiagnostic } from './preview-diagnostics'

export type AdvisoryStatus =
  | 'CURRENT_VALID'
  | 'CURRENT_INVALID'
  | 'PROPOSAL_VALID'
  | 'PROPOSAL_INVALID'
  | 'NO_PROPOSAL'

export type AdvisoryCriterionStatus = 'PASS' | 'FAIL' | 'NOT_EVALUATED'

export interface AdvisoryCriterion {
  code:
    | 'COBERTURA_DIA'
    | 'DOMINGOS_CONSECUTIVOS'
    | 'DOMINGO_EXATO'
    | 'COBERTURA_FAIXA'
    | 'DESCANSO_JORNADA'
  status: AdvisoryCriterionStatus
  title: string
  detail: string
  source: 'PHASE1' | 'PHASE2' | 'DIAGNOSTIC'
}

export interface AdvisoryDiffItem {
  colaborador_id: number
  nome: string
  posto_apelido: string
  fixa_atual: DiaSemana | null
  fixa_proposta: DiaSemana | null
  variavel_atual: DiaSemana | null
  variavel_proposta: DiaSemana | null
}

export interface EscalaAdvisoryInput {
  setor_id: number
  data_inicio: string
  data_fim: string
  solve_mode?: 'rapido' | 'balanceado' | 'otimizado' | 'maximo'
  max_time_seconds?: number
  rules_override?: Record<string, string>
  pinned_folga_externo: Array<{ c: number; d: number; band: number }>
  current_folgas: Array<{
    colaborador_id: number
    fixa: DiaSemana | null
    variavel: DiaSemana | null
    origem_fixa: 'COLABORADOR' | 'OVERRIDE_LOCAL'
    origem_variavel: 'COLABORADOR' | 'OVERRIDE_LOCAL'
  }>
  demanda_preview?: SemanaDraftAdvisory | null
}

export interface SemanaDraftSegmento {
  hora_inicio: string
  hora_fim: string
  min_pessoas: number
  override: boolean
}

export interface SemanaDraftAdvisory {
  padrao: {
    hora_abertura: string
    hora_fechamento: string
    segmentos: SemanaDraftSegmento[]
  }
  dias: Record<DiaSemana, {
    ativo: boolean
    usa_padrao: boolean
    hora_abertura: string
    hora_fechamento: string
    segmentos: SemanaDraftSegmento[]
  }>
}

export interface EscalaAdvisoryOutput {
  status: AdvisoryStatus
  normalized_diagnostics: PreviewDiagnostic[]
  current: {
    criteria: AdvisoryCriterion[]
  }
  proposal?: {
    diff: AdvisoryDiffItem[]
    criteria: AdvisoryCriterion[]
  }
  fallback?: {
    should_open_ia: boolean
    reason: string
    diagnosis_payload: unknown
  }
}

export interface SimulacaoAdvisorySnapshot {
  input_hash: string
  generated_at: string
  origin: 'accepted_suggestion'
  diagnostics: PreviewDiagnostic[]
  advisory_status: AdvisoryStatus
}
