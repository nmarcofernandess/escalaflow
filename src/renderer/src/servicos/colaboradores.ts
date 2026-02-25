import { client } from './client'
import type {
  Colaborador,
  CriarColaboradorRequest,
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

  deletar: (id: number) =>
    client['colaboradores.deletar']({ id }) as Promise<void>,

  // --- Regras de Horario ---
  buscarRegraHorario: (colaboradorId: number) =>
    client['colaboradores.buscarRegraHorario']({ colaborador_id: colaboradorId }) as Promise<RegraHorarioColaborador[]>,

  salvarRegraHorario: (data: {
    colaborador_id: number
    dia_semana_regra?: DiaSemana | null
    ativo?: boolean
    perfil_horario_id?: number | null
    inicio_min?: string | null
    inicio_max?: string | null
    fim_min?: string | null
    fim_max?: string | null
    preferencia_turno_soft?: string | null
    domingo_ciclo_trabalho?: number
    domingo_ciclo_folga?: number
    folga_fixa_dia_semana?: string | null
  }) =>
    client['colaboradores.salvarRegraHorario'](data as any) as Promise<RegraHorarioColaborador>,

  deletarRegraHorario: (id: number) =>
    client['colaboradores.deletarRegraHorario']({ id }) as Promise<void>,

  listarRegrasExcecaoData: (colaboradorId: number) =>
    client['colaboradores.listarRegrasExcecaoData']({ colaborador_id: colaboradorId }) as Promise<RegraHorarioColaboradorExcecaoData[]>,

  upsertRegraExcecaoData: (data: {
    colaborador_id: number
    data: string
    ativo?: boolean
    inicio_min?: string | null
    inicio_max?: string | null
    fim_min?: string | null
    fim_max?: string | null
    preferencia_turno_soft?: string | null
    domingo_forcar_folga?: boolean
  }) =>
    client['colaboradores.upsertRegraExcecaoData'](data as any) as Promise<RegraHorarioColaboradorExcecaoData>,

  deletarRegraExcecaoData: (id: number) =>
    client['colaboradores.deletarRegraExcecaoData']({ id }) as Promise<void>,
}
