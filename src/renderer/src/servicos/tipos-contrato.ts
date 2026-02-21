import { client } from './client'
import type { TipoContrato, PerfilHorarioContrato } from '@shared/index'

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

  // --- Perfis de Horario ---
  listarPerfisHorario: (tipoContratoId: number) =>
    client['tiposContrato.listarPerfisHorario']({ tipo_contrato_id: tipoContratoId }) as Promise<PerfilHorarioContrato[]>,

  criarPerfilHorario: (data: Omit<PerfilHorarioContrato, 'id' | 'ativo'>) =>
    client['tiposContrato.criarPerfilHorario'](data as any) as Promise<PerfilHorarioContrato>,

  atualizarPerfilHorario: (id: number, data: Partial<PerfilHorarioContrato>) =>
    client['tiposContrato.atualizarPerfilHorario']({ id, ...data } as any) as Promise<PerfilHorarioContrato>,

  deletarPerfilHorario: (id: number) =>
    client['tiposContrato.deletarPerfilHorario']({ id }) as Promise<void>,
}
