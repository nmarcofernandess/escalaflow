import { client } from './client'
import type { Feriado } from '@shared/index'

export const feriadosService = {
  listar: (ano?: number) =>
    client['feriados.listar']({ ano }) as Promise<Feriado[]>,

  criar: (data: Omit<Feriado, 'id'>) =>
    client['feriados.criar'](data as any) as Promise<Feriado>,

  deletar: (id: number) =>
    client['feriados.deletar']({ id }) as Promise<void>,
}
