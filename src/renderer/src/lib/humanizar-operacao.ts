import type { PreviewDiagnostic } from '@shared/preview-diagnostics'

// ---------------------------------------------------------------------------
// Aviso — tipo canônico (fonte única de verdade)
// ---------------------------------------------------------------------------

export interface Aviso {
  /** Codigo unico do aviso (ex: COB_DEFICIT_SEG, TT_ALEX_S3) — usado pra deduplicacao */
  id: string
  nivel: 'error' | 'warning' | 'info'
  titulo: string
  descricao: string
  /** Botao de acao opcional (ex: "Resolver automatico") */
  acao?: {
    label: string
    handler: () => void
  }
  /** Texto pro sistema de IA usar quando o RH perguntar sobre esse aviso */
  contexto_ia?: string
}

// ---------------------------------------------------------------------------
// OperationFeedback — feedback de operacoes (INFEASIBLE, preflight, etc)
// ---------------------------------------------------------------------------

export interface OperationFeedback {
  type: 'INFEASIBLE' | 'PREFLIGHT_BLOCK' | 'PREFLIGHT_WARNING' | 'GENERATE_ERROR'
  message: string
  details?: string[]
  setor_id?: number
}

// ---------------------------------------------------------------------------
// humanizarTexto — substitui jargao tecnico em strings
// ---------------------------------------------------------------------------

export function humanizarTexto(text: string): string {
  return text
    .replace(/\bSlot\b/g, 'Faixa')
    .replace(/\bpreview\b/gi, 'simulacao')
    .replace(/disponiveis=(\d+),?\s*minimo requerido=(\d+)/g,
      '$1 pessoas disponíveis, mas a demanda pede $2')
    .replace(/\bINFEASIBLE\b/g, 'inviável')
    .replace(/\bpreflight\b/gi, 'pré-validação')
}

// ---------------------------------------------------------------------------
// mapPreviewDiagnosticToAviso — converte diagnostic do preview pra Aviso
// ---------------------------------------------------------------------------

export function mapPreviewDiagnosticToAviso(diag: PreviewDiagnostic): Aviso {
  return {
    id: `diag-${diag.code}-${diag.source}`,
    nivel: diag.severity,
    titulo: diag.title,
    descricao: humanizarTexto(diag.detail),
    contexto_ia: `[${diag.code}] ${diag.detail}`,
  }
}

// ---------------------------------------------------------------------------
// humanizarOperacao — traduz OperationFeedback pra Aviso[]
// ---------------------------------------------------------------------------

const TIPO_CONFIG: Record<OperationFeedback['type'], { titulo: string; nivel: Aviso['nivel'] }> = {
  INFEASIBLE: {
    titulo: 'Não foi possível gerar uma escala viável para este período',
    nivel: 'error',
  },
  PREFLIGHT_BLOCK: {
    titulo: 'Pré-requisitos não atendidos para gerar escala',
    nivel: 'error',
  },
  PREFLIGHT_WARNING: {
    titulo: 'Atenção antes de gerar',
    nivel: 'warning',
  },
  GENERATE_ERROR: {
    titulo: 'Erro ao gerar escala',
    nivel: 'error',
  },
}

export function humanizarOperacao(feedback: OperationFeedback | null): Aviso[] {
  if (!feedback) return []

  const config = TIPO_CONFIG[feedback.type]
  const detalhes = feedback.details?.map(humanizarTexto).join('. ') ?? ''

  return [{
    id: `op-${feedback.type}`,
    nivel: config.nivel,
    titulo: config.titulo,
    descricao: detalhes || humanizarTexto(feedback.message),
    contexto_ia: feedback.message,
  }]
}
