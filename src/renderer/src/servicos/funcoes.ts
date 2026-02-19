import { client } from './client'
import type { Funcao } from '@shared/index'

export const funcoesService = {
  listar: (setor_id: number, ativo?: boolean) =>
    client['funcoes.listar']({ setor_id, ativo }) as Promise<Funcao[]>,

  buscar: (id: number) =>
    client['funcoes.buscar']({ id }) as Promise<Funcao>,

  criar: (data: { setor_id: number; apelido: string; tipo_contrato_id: number; ordem?: number }) =>
    client['funcoes.criar'](data) as Promise<Funcao>,

  atualizar: (id: number, data: Partial<Omit<Funcao, 'id' | 'setor_id'>>) =>
    client['funcoes.atualizar']({ id, ...data }) as Promise<Funcao>,

  deletar: (id: number) =>
    client['funcoes.deletar']({ id }) as Promise<void>,
}
