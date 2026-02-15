import { client } from './client'
import type { Empresa } from '@shared/index'

export const empresaService = {
  buscar: () =>
    client['empresa.buscar'](undefined as any) as Promise<Empresa>,

  atualizar: (data: Omit<Empresa, 'id'>) =>
    client['empresa.atualizar'](data) as Promise<Empresa>,
}
