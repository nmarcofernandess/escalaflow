import { client } from './client'
import type { Empresa } from '@shared/index'

type AtualizarEmpresaInput = Pick<
  Empresa,
  'nome' | 'cnpj' | 'telefone' | 'corte_semanal' | 'tolerancia_semanal_min'
> & {
  min_intervalo_almoco_min?: number
  usa_cct_intervalo_reduzido?: boolean
}

export const empresaService = {
  buscar: () =>
    client['empresa.buscar']() as Promise<Empresa>,

  atualizar: (data: AtualizarEmpresaInput) =>
    client['empresa.atualizar'](data) as Promise<Empresa>,
}
