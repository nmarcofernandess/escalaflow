import { client } from './client'
import type {
  Escala,
  EscalaCompletaV3,
  EscalaPreflightResult,
  EscalaAdvisoryInput,
  EscalaAdvisoryOutputV2,
  AjustarAlocacaoRequest,
  StatusEscala,
  RegimeEscala,
  RuleConfig,
} from '@shared/index'

export const escalasService = {
  gerar: (
    setorId: number,
    data: {
      data_inicio: string
      data_fim: string
      regimes_override?: Array<{ colaborador_id: number; regime_escala: RegimeEscala }>
      solveMode?: 'rapido' | 'balanceado' | 'otimizado' | 'maximo'
      maxTimeSeconds?: number
      rulesOverride?: RuleConfig
      pinnedFolgaExterno?: Array<{ c: number; d: number; band: number }>
      advisoryAceitoJson?: string
    },
  ) =>
    client['escalas.gerar']({
      setor_id: setorId,
      data_inicio: data.data_inicio,
      data_fim: data.data_fim,
      regimes_override: data.regimes_override,
      solve_mode: data.solveMode,
      max_time_seconds: data.maxTimeSeconds,
      rules_override: data.rulesOverride,
      pinned_folga_externo: data.pinnedFolgaExterno,
      advisory_aceito_json: data.advisoryAceitoJson,
    }) as Promise<EscalaCompletaV3>,

  preflight: (
    setorId: number,
    data: {
      data_inicio: string
      data_fim: string
      regimes_override?: Array<{ colaborador_id: number; regime_escala: RegimeEscala }>
    },
  ) =>
    client['escalas.preflight']({ setor_id: setorId, ...data }) as Promise<EscalaPreflightResult>,

  buscar: (id: number) =>
    client['escalas.buscar']({ id }) as Promise<EscalaCompletaV3>,

  resumoPorSetor: () =>
    client['escalas.resumoPorSetor']() as Promise<{ setor_id: number; data_inicio: string; data_fim: string; status: string }[]>,

  listarPorSetor: (setorId: number, params?: { status?: StatusEscala }) =>
    client['escalas.listarPorSetor']({ setor_id: setorId, status: params?.status }) as Promise<Escala[]>,

  oficializar: (id: number) =>
    client['escalas.oficializar']({ id }) as Promise<Escala>,

  ajustar: (id: number, data: AjustarAlocacaoRequest) =>
    client['escalas.ajustar']({ id, alocacoes: data.alocacoes }) as Promise<EscalaCompletaV3>,

  deletar: (id: number) =>
    client['escalas.deletar']({ id }) as Promise<void>,

  cancelar: () =>
    client['escalas.cancelar']() as Promise<{ cancelled: boolean }>,

  onSolverLog: (cb: (line: string) => void): (() => void) => {
    return window.electron.ipcRenderer.on('solver-log', cb) as unknown as () => void
  },

  advisory: (input: EscalaAdvisoryInput) =>
    client['escalas.advisory'](input) as Promise<EscalaAdvisoryOutputV2>,
}
