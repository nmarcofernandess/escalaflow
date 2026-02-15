import { client } from './client'
import type {
  Escala,
  EscalaCompleta,
  AjustarAlocacaoRequest,
  StatusEscala,
} from '@shared/index'

export const escalasService = {
  gerar: (setorId: number, data: { data_inicio: string; data_fim: string }) =>
    client['escalas.gerar']({ setor_id: setorId, ...data }) as Promise<EscalaCompleta>,

  buscar: (id: number) =>
    client['escalas.buscar']({ id }) as Promise<EscalaCompleta>,

  listarPorSetor: (setorId: number, params?: { status?: StatusEscala }) =>
    client['escalas.listarPorSetor']({ setor_id: setorId, status: params?.status }) as Promise<Escala[]>,

  oficializar: (id: number) =>
    client['escalas.oficializar']({ id }) as Promise<Escala>,

  ajustar: (id: number, data: AjustarAlocacaoRequest) =>
    client['escalas.ajustar']({ id, alocacoes: data.alocacoes }) as Promise<EscalaCompleta>,

  deletar: (id: number) =>
    client['escalas.deletar']({ id }) as Promise<void>,
}
