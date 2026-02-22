import { client } from './client'
import type { RuleDefinition, RuleStatus } from '@shared/index'

export const regrasService = {
  listar: () => client['regras.listar']() as Promise<RuleDefinition[]>,

  atualizar: (codigo: string, status: RuleStatus) =>
    client['regras.atualizar']({ codigo, status }) as Promise<void>,

  resetarEmpresa: () => client['regras.resetarEmpresa']() as Promise<void>,

  resetarRegra: (codigo: string) =>
    client['regras.resetarRegra']({ codigo }) as Promise<void>,
}
