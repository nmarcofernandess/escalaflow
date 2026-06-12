import { describe, expect, it } from 'vitest'
import { runSolver } from '../../src/main/motor/solver-bridge'
import type { SolverInput, SolverInputHint } from '../../src/shared/types'

const DIAS = ['2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05', '2026-03-06', '2026-03-07', '2026-03-08']
const DIA_SEMANA = ['SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB', 'DOM'] as const

function buildInputWithExternalHints(): SolverInput {
  const colaboradores = Array.from({ length: 4 }, (_, idx) => ({
    id: idx + 1,
    nome: `CLT ${idx + 1}`,
    horas_semanais: 44,
    regime_escala: '6X1' as const,
    dias_trabalho: 6,
    max_minutos_dia: 720,
    tipo_trabalhador: 'CLT',
    sexo: 'M',
    funcao_id: idx + 1,
    rank: idx,
    domingo_ciclo_trabalho: 3,
    domingo_ciclo_folga: 1,
  }))

  const hints: SolverInputHint[] = []
  for (const c of colaboradores) {
    for (const data of DIAS) {
      hints.push({
        colaborador_id: c.id,
        data,
        status: data.endsWith('-08') && c.id === 1 ? 'FOLGA' : 'TRABALHO',
        hora_inicio: data.endsWith('-08') && c.id === 1 ? null : '08:00',
        hora_fim: data.endsWith('-08') && c.id === 1 ? null : '16:00',
      })
    }
  }

  return {
    setor_id: 991,
    data_inicio: DIAS[0],
    data_fim: DIAS.at(-1)!,
    piso_operacional: 1,
    empresa: {
      tolerancia_semanal_min: 30,
      hora_abertura: '08:00',
      hora_fechamento: '20:00',
      min_intervalo_almoco_min: 60,
      max_intervalo_almoco_min: 120,
      grid_minutos: 30,
      horario_por_dia: Object.fromEntries(
        Array.from({ length: 7 }, (_, dia) => [dia, { abertura: '08:00', fechamento: '20:00' }]),
      ),
    },
    colaboradores,
    demanda: DIA_SEMANA.map((dia_semana) => ({
      dia_semana,
      hora_inicio: '10:00',
      hora_fim: '18:00',
      min_pessoas: 1,
      override: false,
    })),
    feriados: [],
    excecoes: [],
    pinned_cells: [],
    hints,
    config: {
      solve_mode: 'rapido',
      max_time_seconds: 20,
      num_workers: 2,
      generation_mode: 'OFFICIAL',
      patience_s: 3,
      rules: {
        H1: 'HARD',
        H2: 'HARD',
        H4: 'HARD',
        H5: 'HARD',
        H6: 'HARD',
        H10: 'HARD',
        H15: 'HARD',
        H3_DOM_MAX_CONSEC_M: 'HARD',
        H3_DOM_MAX_CONSEC_F: 'HARD',
        DIAS_TRABALHO: 'HARD',
        MIN_DIARIO: 'HARD',
        S_DEFICIT: 'ON',
        S_SURPLUS: 'ON',
        S_SPREAD: 'ON',
      },
    },
  }
}

describe('solver warm-start hints', () => {
  it('does not return MODEL_INVALID when persisted schedule hints overlap advisory hints', async () => {
    const solverLogs: string[] = []
    const result = await runSolver(buildInputWithExternalHints(), 30_000, (line) => {
      solverLogs.push(line)
    })

    expect(result.status).not.toBe('MODEL_INVALID')
    expect(solverLogs.join('\n')).not.toContain('MODEL_INVALID')
    expect(result.sucesso, result.erro?.mensagem).toBe(true)
    expect(['OPTIMAL', 'FEASIBLE']).toContain(result.status)
    expect(result.indicadores?.violacoes_hard).toBe(0)
  }, 60_000)
})
