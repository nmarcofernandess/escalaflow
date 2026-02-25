import { client } from './client'

export const servicoConhecimento = {
  stats: () =>
    client['knowledge.stats']() as Promise<{
      fontes: Array<{
        id: number
        tipo: string
        titulo: string
        importance: string
        ativo: boolean
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

  toggleAtivo: (id: number, ativo: boolean) =>
    client['knowledge.toggleAtivo']({ id, ativo }) as Promise<{ ok: boolean }>,

  obterTextoOriginal: (id: number) =>
    client['knowledge.obterTextoOriginal']({ id }) as Promise<{ titulo: string; conteudo_original: string; context_hint: string | null }>,

  extrairTexto: (caminho_arquivo: string) =>
    client['knowledge.extrairTexto']({ caminho_arquivo }) as Promise<{ texto: string; nome_arquivo: string }>,

  gerarMetadataIa: (texto: string, campo: 'titulo' | 'quando_consultar' | 'texto') =>
    client['knowledge.gerarMetadataIa']({ texto, campo }) as Promise<{ resultado: string }>,

  importarCompleto: (titulo: string, conteudo: string, quando_consultar: string) =>
    client['knowledge.importarCompleto']({ titulo, conteudo, quando_consultar }) as Promise<{ source_id: number; chunks_count: number; entities_count: number }>,

  rebuildGraph: (origem: 'sistema' | 'usuario' = 'usuario') =>
    client['knowledge.rebuildGraph']({ origem }) as Promise<{ entities_count: number; relations_count: number; chunks_processados: number }>,

  graphStats: (origem?: 'sistema' | 'usuario') =>
    client['knowledge.graphStats']({ origem }) as Promise<{
      entities_count: number
      relations_count: number
      tipos: Array<{ tipo: string; count: number }>
    }>,

  /** DEV-ONLY: Rebuild sistema graph com LLM + export seed JSON */
  rebuildAndExportSistema: () =>
    client['knowledge.rebuildAndExportSistema']() as Promise<{
      entities_count: number
      relations_count: number
      chunks_processados: number
      seed_entities: number
      seed_relations: number
      exported_to: string
    }>,

  graphData: (origem?: 'sistema' | 'usuario', limite?: number) =>
    client['knowledge.graphData']({ origem, limite }) as Promise<{
      nodes: Array<{ id: number; nome: string; tipo: string }>
      links: Array<{ source: number; target: number; tipo_relacao: string; peso: number }>
    }>,

  graphExplore: (entidade: string, profundidade?: number) =>
    client['knowledge.graphExplore']({ entidade, profundidade }) as Promise<{
      entidade_raiz: string | null
      entidades: Array<{ nome: string; tipo: string; nivel: number }>
      relacoes: Array<{ from_nome: string; to_nome: string; tipo_relacao: string; peso: number }>
    }>,
}
