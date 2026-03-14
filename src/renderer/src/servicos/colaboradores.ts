import { client } from './client'
import type {
  Colaborador,
  CriarColaboradorRequest,
  AtribuirPostoResult,
  ColaboradorPostoSnapshotItem,
  RegraHorarioColaborador,
  RegraHorarioColaboradorExcecaoData,
  DiaSemana,
} from '@shared/index'

export const colaboradoresService = {
  listar: (params?: { setor_id?: number; ativo?: boolean }) =>
    client['colaboradores.listar'](params ?? {}) as Promise<Colaborador[]>,

  buscar: (id: number) =>
    client['colaboradores.buscar']({ id }) as Promise<Colaborador>,

  criar: (data: CriarColaboradorRequest) =>
    client['colaboradores.criar'](data as any) as Promise<Colaborador>,

  atualizar: (id: number, data: Partial<Colaborador>) =>
    client['colaboradores.atualizar']({ id, ...data } as any) as Promise<Colaborador>,

  atribuirPosto: (data: {
    colaborador_id: number
    funcao_id: number | null
    estrategia?: 'swap' | 'strict'
  }) =>
    client['colaboradores.atribuirPosto'](data) as Promise<AtribuirPostoResult>,

  restaurarPostos: (data: {
    snapshot: ColaboradorPostoSnapshotItem[]
  }) =>
    client['colaboradores.restaurarPostos'](data) as Promise<{ ok: true }>,

  deletar: (id: number) =>
    client['colaboradores.deletar']({ id }) as Promise<void>,

  listarRegrasPadraoSetor: (setorId: number) =>
    client['colaboradores.listarRegrasPadraoSetor']({ setor_id: setorId }) as Promise<RegraHorarioColaborador[]>,

  // --- Regras de Horario ---
  buscarRegraHorario: (colaboradorId: number) =>
    client['colaboradores.buscarRegraHorario']({ colaborador_id: colaboradorId }) as Promise<RegraHorarioColaborador[]>,

  salvarRegraHorario: (data: {
    colaborador_id: number
    dia_semana_regra?: DiaSemana | null
    ativo?: boolean
    perfil_horario_id?: number | null
    inicio?: string | null
    fim?: string | null
    preferencia_turno_soft?: string | null
    folga_fixa_dia_semana?: string | null
    folga_variavel_dia_semana?: string | null
  }) =>
    client['colaboradores.salvarRegraHorario'](data as any) as Promise<RegraHorarioColaborador>,

  salvarPadraoFolgas: (padrao: Array<{
    colaborador_id: number
    folga_fixa_dia_semana: DiaSemana | null
    folga_variavel_dia_semana: DiaSemana | null
  }>, force?: boolean) => {
    return client['colaboradores.salvarPadraoFolgas']({
      padrao: padrao.map(p => ({
        colaborador_id: p.colaborador_id,
        folga_fixa_dia_semana: p.folga_fixa_dia_semana,
        folga_variavel_dia_semana: p.folga_variavel_dia_semana,
      })),
      force,
    }) as Promise<{ ok: boolean; count: number }>
  },

  deletarRegraHorario: (id: number) =>
    client['colaboradores.deletarRegraHorario']({ id }) as Promise<void>,

  listarRegrasExcecaoData: (colaboradorId: number) =>
    client['colaboradores.listarRegrasExcecaoData']({ colaborador_id: colaboradorId }) as Promise<RegraHorarioColaboradorExcecaoData[]>,

  upsertRegraExcecaoData: (data: {
    colaborador_id: number
    data: string
    ativo?: boolean
    inicio?: string | null
    fim?: string | null
    preferencia_turno_soft?: string | null
    domingo_forcar_folga?: boolean
  }) =>
    client['colaboradores.upsertRegraExcecaoData'](data as any) as Promise<RegraHorarioColaboradorExcecaoData>,

  deletarRegraExcecaoData: (id: number) =>
    client['colaboradores.deletarRegraExcecaoData']({ id }) as Promise<void>,
}
