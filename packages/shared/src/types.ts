import type { DiaSemana, Turno, StatusEscala, TipoExcecao, StatusAlocacao, Severidade } from './constants'

// ─── Entidades ──────────────────────────────────────────────────────────

export interface Empresa {
  id: number
  nome: string
  cidade: string
  estado: string
}

export interface TipoContrato {
  id: number
  nome: string
  horas_semanais: number
  dias_trabalho: number
  trabalha_domingo: boolean
  max_minutos_dia: number
}

export interface Setor {
  id: number
  nome: string
  hora_abertura: string
  hora_fechamento: string
  ativo: boolean
}

export interface Demanda {
  id: number
  setor_id: number
  dia_semana: DiaSemana | null
  hora_inicio: string
  hora_fim: string
  min_pessoas: number
}

export interface Colaborador {
  id: number
  setor_id: number
  tipo_contrato_id: number
  nome: string
  sexo: 'M' | 'F'
  horas_semanais: number
  rank: number
  prefere_turno: Turno | null
  evitar_dia_semana: DiaSemana | null
  ativo: boolean
}

export interface Excecao {
  id: number
  colaborador_id: number
  data_inicio: string   // "2026-03-01"
  data_fim: string      // "2026-03-15"
  tipo: TipoExcecao
  observacao: string | null
}

export interface Escala {
  id: number
  setor_id: number
  data_inicio: string
  data_fim: string
  status: StatusEscala
  pontuacao: number | null
  criada_em: string
}

export interface Alocacao {
  id: number
  escala_id: number
  colaborador_id: number
  data: string            // "2026-03-01"
  status: StatusAlocacao
  hora_inicio: string | null
  hora_fim: string | null
  minutos: number | null
}

// ─── Compostos (respostas da API) ───────────────────────────────────────

export interface Violacao {
  severidade: Severidade
  regra: string
  colaborador_id: number | null
  colaborador_nome: string
  mensagem: string
  data: string | null
}

export interface EscalaCompleta {
  escala: Escala
  alocacoes: Alocacao[]
  violacoes: Violacao[]
}

export interface DashboardResumo {
  total_setores: number
  total_colaboradores: number
  total_em_ferias: number
  total_em_atestado: number
  setores: SetorResumo[]
  alertas: AlertaDashboard[]
}

export interface SetorResumo {
  id: number
  nome: string
  total_colaboradores: number
  escala_atual: 'SEM_ESCALA' | 'RASCUNHO' | 'OFICIAL'
  proxima_geracao: string | null
  violacoes_pendentes: number
}

export interface AlertaDashboard {
  tipo: 'ESCALA_VENCIDA' | 'VIOLACAO_HARD' | 'SEM_ESCALA' | 'POUCOS_COLABORADORES'
  setor_id: number
  setor_nome: string
  mensagem: string
}

// ─── Request Bodies ─────────────────────────────────────────────────────

export interface GerarEscalaRequest {
  data_inicio: string
  data_fim: string
}

export interface CriarColaboradorRequest {
  setor_id: number
  tipo_contrato_id: number
  nome: string
  sexo: 'M' | 'F'
  horas_semanais?: number
  rank?: number
  prefere_turno?: Turno | null
  evitar_dia_semana?: DiaSemana | null
}

export interface ReordenarRankRequest {
  colaborador_ids: number[]
}

export interface AjustarAlocacaoRequest {
  alocacoes: {
    colaborador_id: number
    data: string
    status: StatusAlocacao
    hora_inicio?: string | null
    hora_fim?: string | null
  }[]
}
