import { client } from './client'
import type { Setor, Demanda, SetorHorarioSemana, SalvarTimelineDiaInput } from '@shared/index'

export const setoresService = {
  listar: (ativo?: boolean) =>
    client['setores.listar']({ ativo }) as Promise<Setor[]>,

  buscar: (id: number) =>
    client['setores.buscar']({ id }) as Promise<Setor>,

  criar: (data: { nome: string; hora_abertura: string; hora_fechamento: string; icone?: string | null }) =>
    client['setores.criar'](data) as Promise<Setor>,

  atualizar: (id: number, data: Partial<Setor>) =>
    client['setores.atualizar']({ id, ...data }) as Promise<Setor>,

  deletar: (id: number) =>
    client['setores.deletar']({ id }) as Promise<void>,

  listarDemandas: (setorId: number) =>
    client['setores.listarDemandas']({ setor_id: setorId }) as Promise<Demanda[]>,

  criarDemanda: (setorId: number, data: Omit<Demanda, 'id' | 'setor_id'>) =>
    client['setores.criarDemanda']({ setor_id: setorId, ...data }) as Promise<Demanda>,

  atualizarDemanda: (id: number, data: Partial<Omit<Demanda, 'id' | 'setor_id'>>) => {
    // Strip undefined values to prevent null serialization over IPC
    const clean: Record<string, unknown> = { id }
    for (const [k, v] of Object.entries(data)) {
      if (v !== undefined) clean[k] = v
    }
    return client['setores.atualizarDemanda'](clean as any) as Promise<Demanda>
  },

  deletarDemanda: (id: number) =>
    client['setores.deletarDemanda']({ id }) as Promise<void>,

  reordenarRank: (setorId: number, colaborador_ids: number[]) =>
    client['setores.reordenarRank']({ setor_id: setorId, colaborador_ids }) as Promise<void>,

  listarHorarioSemana: (setorId: number) =>
    client['setores.listarHorarioSemana']({ setor_id: setorId }) as Promise<SetorHorarioSemana[]>,

  upsertHorarioSemana: (data: Omit<SetorHorarioSemana, 'id'>) =>
    client['setores.upsertHorarioSemana'](data as any) as Promise<SetorHorarioSemana>,

  salvarTimelineDia: (data: SalvarTimelineDiaInput) =>
    client['setores.salvarTimelineDia'](data as any) as Promise<{ horario: SetorHorarioSemana; demandas: Demanda[] }>,
}
