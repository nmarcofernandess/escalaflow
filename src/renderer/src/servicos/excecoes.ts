import { client } from './client'
import type { Excecao, TipoExcecao } from '@shared/index'

interface CriarExcecaoData {
  data_inicio: string
  data_fim: string
  tipo: TipoExcecao
  observacao?: string | null
}

export const excecoesService = {
  listar: (colaboradorId: number) =>
    client['excecoes.listar']({ colaborador_id: colaboradorId }) as Promise<Excecao[]>,

  criar: (colaboradorId: number, data: CriarExcecaoData) =>
    client['excecoes.criar']({ colaborador_id: colaboradorId, ...data }) as Promise<Excecao>,

  atualizar: (id: number, data: Partial<CriarExcecaoData>) =>
    client['excecoes.atualizar']({ id, ...data } as any) as Promise<Excecao>,

  deletar: (id: number) =>
    client['excecoes.deletar']({ id }) as Promise<void>,
}
