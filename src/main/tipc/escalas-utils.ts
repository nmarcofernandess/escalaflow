import { execute, queryOne, transaction } from '../db/query'
import type { SolverOutput } from '../../shared'
import type { EscalaSimulacaoConfig } from '../preflight-capacity'
import { buildEscalaEquipeSnapshot } from '../escala-equipe-snapshot'

export async function persistirAjusteResult(
  escalaId: number,
  solverResult: SolverOutput,
  ind: NonNullable<SolverOutput['indicadores']>,
  decisoes: NonNullable<SolverOutput['decisoes']>,
  comparacao: NonNullable<SolverOutput['comparacao_demanda']>,
  inputHash: string,
  cfg: EscalaSimulacaoConfig,
): Promise<void> {
  const escala = await queryOne<{ setor_id: number }>('SELECT setor_id FROM escalas WHERE id = ?', escalaId)
  if (!escala) throw new Error('Escala nao encontrada para atualizar snapshot')
  const equipeSnapshot = await buildEscalaEquipeSnapshot(escala.setor_id)

  await transaction(async () => {
    await execute('DELETE FROM alocacoes WHERE escala_id = ?', escalaId)
    await execute('DELETE FROM escala_decisoes WHERE escala_id = ?', escalaId)
    await execute('DELETE FROM escala_comparacao_demanda WHERE escala_id = ?', escalaId)

    for (const a of solverResult.alocacoes ?? []) {
      await execute(
        `
        INSERT INTO alocacoes
          (escala_id, colaborador_id, data, status, hora_inicio, hora_fim,
           minutos, minutos_trabalho, hora_almoco_inicio, hora_almoco_fim,
           minutos_almoco, intervalo_15min, funcao_id,
           hora_intervalo_inicio, hora_intervalo_fim, hora_real_inicio, hora_real_fim)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
        escalaId,
        a.colaborador_id,
        a.data,
        a.status,
        a.hora_inicio ?? null,
        a.hora_fim ?? null,
        a.minutos_trabalho ?? null,
        a.minutos_trabalho ?? null,
        a.hora_almoco_inicio ?? null,
        a.hora_almoco_fim ?? null,
        a.minutos_almoco ?? null,
        a.intervalo_15min ?? false,
        a.funcao_id ?? null,
        a.hora_intervalo_inicio ?? null,
        a.hora_intervalo_fim ?? null,
        a.hora_real_inicio ?? null,
        a.hora_real_fim ?? null,
      )
    }

    for (const d of decisoes) {
      await execute(
        `
        INSERT INTO escala_decisoes (escala_id, colaborador_id, data, acao, razao, alternativas_tentadas)
        VALUES (?, ?, ?, ?, ?, ?)
      `,
        escalaId,
        d.colaborador_id,
        d.data,
        d.acao,
        d.razao,
        d.alternativas_tentadas,
      )
    }

    for (const c of comparacao) {
      await execute(
        `
        INSERT INTO escala_comparacao_demanda (escala_id, data, hora_inicio, hora_fim, planejado, executado, delta, override, justificativa)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
        escalaId,
        c.data,
        c.hora_inicio,
        c.hora_fim,
        c.planejado,
        c.executado,
        c.delta,
        c.override ?? false,
        c.justificativa ?? null,
      )
    }

    await execute(
      `
      UPDATE escalas
      SET pontuacao = ?, cobertura_percent = ?, violacoes_hard = ?, violacoes_soft = ?, equilibrio = ?, input_hash = ?, simulacao_config_json = ?, equipe_snapshot_json = ?
      WHERE id = ?
    `,
      ind.pontuacao,
      ind.cobertura_percent,
      ind.violacoes_hard,
      ind.violacoes_soft,
      ind.equilibrio,
      inputHash,
      JSON.stringify({ regimes_override: cfg.regimes_override ?? [] } satisfies EscalaSimulacaoConfig),
      JSON.stringify(equipeSnapshot),
      escalaId,
    )
  })
}
