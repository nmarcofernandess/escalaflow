import { client } from './client'
import type {
  Escala,
  EscalaCompletaV3,
  EscalaPreflightResult,
  AjustarAlocacaoRequest,
  StatusEscala,
  RegimeEscala,
  ModeloCicloEscala,
} from '@shared/index'

export const escalasService = {
  gerar: (
    setorId: number,
    data: {
      data_inicio: string
      data_fim: string
      regimes_override?: Array<{ colaborador_id: number; regime_escala: RegimeEscala }>
      solveMode?: 'rapido' | 'otimizado'
      nivelRigor?: 'ALTO' | 'MEDIO' | 'BAIXO'
    },
  ) =>
    client['escalas.gerar']({ setor_id: setorId, ...data }) as Promise<EscalaCompletaV3>,

  preflight: (
    setorId: number,
    data: {
      data_inicio: string
      data_fim: string
      regimes_override?: Array<{ colaborador_id: number; regime_escala: RegimeEscala }>
    },
  ) =>
    client['escalas.preflight']({ setor_id: setorId, ...data }) as Promise<EscalaPreflightResult>,

  buscar: (id: number) =>
    client['escalas.buscar']({ id }) as Promise<EscalaCompletaV3>,

  resumoPorSetor: () =>
    client['escalas.resumoPorSetor']() as Promise<{ setor_id: number; data_inicio: string; data_fim: string; status: string }[]>,

  listarPorSetor: (setorId: number, params?: { status?: StatusEscala }) =>
    client['escalas.listarPorSetor']({ setor_id: setorId, status: params?.status }) as Promise<Escala[]>,

  oficializar: (id: number) =>
    client['escalas.oficializar']({ id }) as Promise<Escala>,

  ajustar: (id: number, data: AjustarAlocacaoRequest) =>
    client['escalas.ajustar']({ id, alocacoes: data.alocacoes }) as Promise<EscalaCompletaV3>,

  deletar: (id: number) =>
    client['escalas.deletar']({ id }) as Promise<void>,

  // --- Ciclo Rotativo ---
  detectarCicloRotativo: (escalaId: number) =>
    client['escalas.detectarCicloRotativo']({ escala_id: escalaId }) as Promise<{
      ciclo_detectado: boolean
      T: number
      P: number
      semanas: number
      match_percent: number
    }>,

  salvarCicloRotativo: (data: {
    setor_id: number
    nome: string
    semanas_no_ciclo: number
    origem_escala_id?: number | null
    itens: Array<{
      semana_idx: number
      colaborador_id: number
      dia_semana: string
      trabalha: boolean
      ancora_domingo?: boolean
      prioridade?: number
    }>
  }) =>
    client['escalas.salvarCicloRotativo'](data as any) as Promise<ModeloCicloEscala>,

  listarCiclosRotativos: (setorId: number) =>
    client['escalas.listarCiclosRotativos']({ setor_id: setorId }) as Promise<ModeloCicloEscala[]>,

  gerarPorCicloRotativo: (cicloModeloId: number, dataInicio: string, dataFim: string) =>
    client['escalas.gerarPorCicloRotativo']({
      ciclo_modelo_id: cicloModeloId,
      data_inicio: dataInicio,
      data_fim: dataFim,
    }) as Promise<EscalaCompletaV3>,
}
