import { client } from './client'
import type { IaMemoria } from '@shared/types'

export const servicoMemorias = {
  listar: () =>
    client['ia.memorias.listar']() as Promise<IaMemoria[]>,

  salvar: (input: { id?: number; conteudo: string }) =>
    client['ia.memorias.salvar'](input) as Promise<IaMemoria>,

  remover: (id: number) =>
    client['ia.memorias.remover']({ id }) as Promise<void>,

  contar: () =>
    client['ia.memorias.contar']() as Promise<{ total: number; limite: number }>,

  getMemoriaAutomatica: async (): Promise<boolean> => {
    const result = await client['ia.config.memoriaAutomatica']({}) as { memoria_automatica: boolean }
    return result.memoria_automatica
  },

  setMemoriaAutomatica: async (valor: boolean): Promise<boolean> => {
    const result = await client['ia.config.memoriaAutomatica']({ valor }) as { memoria_automatica: boolean }
    return result.memoria_automatica
  },
}
