import { queryOne } from '../db/query'
import { enrichPreflightWithCapacityChecks, normalizeRegimesOverride, type SimulacaoRegimeOverride } from '../preflight-capacity'
import type { EscalaPreflightResult } from '../../shared'
import { buildSolverInput } from './solver-bridge'

export async function buildEscalaPreflight(
  setorId: number,
  dataInicio: string,
  dataFim: string,
  regimesOverride?: SimulacaoRegimeOverride[],
): Promise<EscalaPreflightResult> {
  const blockers: EscalaPreflightResult['blockers'] = []
  const warnings: EscalaPreflightResult['warnings'] = []

  const setor = await queryOne<{ id: number; ativo: boolean }>('SELECT id, ativo FROM setores WHERE id = ?', setorId)
  if (!setor || !setor.ativo) {
    blockers.push({
      codigo: 'SETOR_INVALIDO',
      severidade: 'BLOCKER',
      mensagem: `Setor ${setorId} nao encontrado ou inativo.`,
    })
  }

  const colabsRow = await queryOne<{ count: number }>('SELECT COUNT(*)::int as count FROM colaboradores WHERE setor_id = ? AND ativo = TRUE', setorId)
  const colabsAtivos = colabsRow?.count ?? 0
  if (colabsAtivos === 0) {
    blockers.push({
      codigo: 'SEM_COLABORADORES',
      severidade: 'BLOCKER',
      mensagem: 'Setor nao tem colaboradores ativos.',
      detalhe: 'Cadastre ao menos 1 colaborador para gerar escala.',
    })
  }

  const demandasRow = await queryOne<{ count: number }>('SELECT COUNT(*)::int as count FROM demandas WHERE setor_id = ?', setorId)
  const demandasCount = demandasRow?.count ?? 0
  if (demandasCount === 0) {
    warnings.push({
      codigo: 'SEM_DEMANDA',
      severidade: 'WARNING',
      mensagem: 'Setor sem demanda planejada cadastrada.',
      detalhe: 'Sem demanda cadastrada, o sistema não terá meta de cobertura para o período.',
    })
  }

  const feriadosRow = await queryOne<{ count: number }>('SELECT COUNT(*)::int as count FROM feriados WHERE data BETWEEN ? AND ?', dataInicio, dataFim)
  const feriadosNoPeriodo = feriadosRow?.count ?? 0

  if (blockers.length === 0) {
    try {
      const input = await buildSolverInput(setorId, dataInicio, dataFim, undefined, {
        regimesOverride: normalizeRegimesOverride(regimesOverride),
      })
      enrichPreflightWithCapacityChecks(input, blockers, warnings)
    } catch (err) {
      warnings.push({
        codigo: 'PREFLIGHT_DIAGNOSTICO_INDISPONIVEL',
        severidade: 'WARNING',
        mensagem: 'Nao foi possivel rodar a verificação detalhada de capacidade.',
        detalhe: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return {
    ok: blockers.length === 0,
    blockers,
    warnings,
    summary: {
      setor_id: setorId,
      data_inicio: dataInicio,
      data_fim: dataFim,
      colaboradores_ativos: colabsAtivos,
      demandas_cadastradas: demandasCount,
      feriados_no_periodo: feriadosNoPeriodo,
      demanda_zero_fallback: demandasCount === 0,
    },
  }
}
