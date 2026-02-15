import { client } from './client'
import type { TipoContrato } from '@shared/index'

type CriarTipoContratoData = Omit<TipoContrato, 'id'>

export const tiposContratoService = {
  listar: () =>
    client['tiposContrato.listar'](undefined as any) as Promise<TipoContrato[]>,

  buscar: (id: number) =>
    client['tiposContrato.buscar']({ id }) as Promise<TipoContrato>,

  criar: (data: CriarTipoContratoData) =>
    client['tiposContrato.criar'](data) as Promise<TipoContrato>,

  atualizar: (id: number, data: Partial<TipoContrato>) =>
    client['tiposContrato.atualizar']({ id, ...data } as any) as Promise<TipoContrato>,

  deletar: (id: number) =>
    client['tiposContrato.deletar']({ id }) as Promise<void>,
}
