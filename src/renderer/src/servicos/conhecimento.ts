import { client } from './client'

export const servicoConhecimento = {
  stats: () =>
    client['knowledge.stats']() as Promise<{
      fontes: Array<{
        id: number
        tipo: string
        titulo: string
        importance: string
        criada_em: string
        atualizada_em: string
        chunks_count: number
      }>
      totais: {
        total_fontes: number
        total_chunks: number
        total_sistema: number
        total_usuario: number
      }
    }>,

  escolherArquivo: () => client['knowledge.escolherArquivo']() as Promise<string | null>,

  importar: (caminho_arquivo: string) =>
    client['knowledge.importar']({ caminho_arquivo }) as Promise<{ source_id: number; chunks_count: number; entities_count: number }>,

  removerFonte: (id: number) =>
    client['knowledge.removerFonte']({ id }) as Promise<{ ok: boolean }>,
}
