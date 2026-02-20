import { client } from './client'
import type {
  Escala,
  EscalaCompletaV3,
  EscalaPreflightResult,
  AjustarAlocacaoRequest,
  StatusEscala,
  RegimeEscala,
} from '@shared/index'

export const escalasService = {
  gerar: (
    setorId: number,
    data: {
      data_inicio: string
      data_fim: string
      regimes_override?: Array<{ colaborador_id: number; regime_escala: RegimeEscala }>
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
}
