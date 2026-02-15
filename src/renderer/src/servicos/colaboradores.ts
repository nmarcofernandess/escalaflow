import { client } from './client'
import type { Colaborador, CriarColaboradorRequest } from '@shared/index'

export const colaboradoresService = {
  listar: (params?: { setor_id?: number; ativo?: boolean }) =>
    client['colaboradores.listar'](params ?? {}) as Promise<Colaborador[]>,

  buscar: (id: number) =>
    client['colaboradores.buscar']({ id }) as Promise<Colaborador>,

  criar: (data: CriarColaboradorRequest) =>
    client['colaboradores.criar'](data as any) as Promise<Colaborador>,

  atualizar: (id: number, data: Partial<Colaborador>) =>
    client['colaboradores.atualizar']({ id, ...data } as any) as Promise<Colaborador>,

  deletar: (id: number) =>
    client['colaboradores.deletar']({ id }) as Promise<void>,
}
