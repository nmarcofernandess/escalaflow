import { describe, it, expect } from 'vitest'
import { calcularCicloDomingo, runSolver } from '../../src/main/motor/solver-bridge'
import type { SolverInput } from '../../src/shared/types'

function buildHorarioPorDia(): Record<number, { abertura: string; fechamento: string }> {
  return Object.fromEntries(
    Array.from({ length: 7 }, (_, dia) => [dia, { abertura: '08:00', fechamento: '14:00' }]),
  )
}

function buildIntermitenteSundayRules(
  colaboradorId: number,
  dataInicio: string,
  dataFim: string,
  withWindow = true,
): NonNullable<SolverInput['regras_colaborador_dia']> {
  const regras: NonNullable<SolverInput['regras_colaborador_dia']> = []
  const cursor = new Date(`${dataInicio}T00:00:00`)
  const end = new Date(`${dataFim}T00:00:00`)

  while (cursor <= end) {
    const iso = cursor.toISOString().slice(0, 10)
    const sunday = cursor.getDay() === 0
    regras.push({
      colaborador_id: colaboradorId,
      data: iso,
      inicio_min: sunday && withWindow ? '08:00' : null,
      inicio_max: sunday && withWindow ? '08:00' : null,
      fim_min: null,
      fim_max: sunday && withWindow ? '14:00' : null,
      preferencia_turno_soft: null,
      domingo_forcar_folga: false,
      folga_fixa: !sunday,
    })
    cursor.setDate(cursor.getDate() + 1)
  }

  return regras
}

function buildInput(): SolverInput {
  return buildInputWithRuleWindow(true)
}

function buildInputWithRuleWindow(withWindow: boolean): SolverInput {
  const data_inicio = '2026-03-02'
  const data_fim = '2026-03-15'

  return {
    setor_id: 999,
    data_inicio,
    data_fim,
    empresa: {
      tolerancia_semanal_min: 60,
      hora_abertura: '08:00',
      hora_fechamento: '14:00',
      min_intervalo_almoco_min: 60,
      max_intervalo_almoco_min: 120,
      grid_minutos: 30,
      horario_por_dia: buildHorarioPorDia(),
    },
    colaboradores: [
      ...Array.from({ length: 5 }, (_, idx) => ({
        id: idx + 1,
        nome: `CLT ${idx + 1}`,
        horas_semanais: 30,
        regime_escala: '5X2' as const,
        dias_trabalho: 5,
        max_minutos_dia: 360,
        tipo_trabalhador: 'CLT',
        sexo: 'F',
        funcao_id: idx + 1,
        rank: idx,
        domingo_ciclo_trabalho: 1,
        domingo_ciclo_folga: 1,
      })),
      {
        id: 6,
        nome: 'Intermitente DOM',
        horas_semanais: 6,
        regime_escala: '5X2' as const,
        dias_trabalho: 1,
        max_minutos_dia: 360,
        tipo_trabalhador: 'INTERMITENTE',
        sexo: 'F',
        funcao_id: 6,
        rank: 10,
      },
    ],
    demanda: [
      { dia_semana: 'SEG', hora_inicio: '08:00', hora_fim: '14:00', min_pessoas: 2, override: false },
      { dia_semana: 'TER', hora_inicio: '08:00', hora_fim: '14:00', min_pessoas: 2, override: false },
      { dia_semana: 'QUA', hora_inicio: '08:00', hora_fim: '14:00', min_pessoas: 2, override: false },
      { dia_semana: 'QUI', hora_inicio: '08:00', hora_fim: '14:00', min_pessoas: 2, override: false },
      { dia_semana: 'SEX', hora_inicio: '08:00', hora_fim: '14:00', min_pessoas: 2, override: false },
      { dia_semana: 'SAB', hora_inicio: '08:00', hora_fim: '14:00', min_pessoas: 2, override: false },
      { dia_semana: 'DOM', hora_inicio: '08:00', hora_fim: '14:00', min_pessoas: 3, override: false },
    ],
    feriados: [],
    excecoes: [],
    pinned_cells: [],
    regras_colaborador_dia: buildIntermitenteSundayRules(6, data_inicio, data_fim, withWindow),
    config: {
      solve_mode: 'rapido',
      max_time_seconds: 10,
      num_workers: 2,
      generation_mode: 'OFFICIAL',
      rules: {
        H3_DOM_MAX_CONSEC_F: 'HARD',
        H3_DOM_MAX_CONSEC_M: 'HARD',
        S_DEFICIT: 'ON',
        S_SURPLUS: 'ON',
        S_DOMINGO_CICLO: 'ON',
      },
    },
  }
}

describe('solver sunday capacity with intermitente', () => {
  it('reduces the rotating CLT sunday demand when an intermitente has fixed DOM coverage', () => {
    const ciclo = calcularCicloDomingo(
      [{ dia_semana: 'DOM', min_pessoas: 3 }],
      [
        { id: 1, tipo_trabalhador: 'CLT' },
        { id: 2, tipo_trabalhador: 'CLT' },
        { id: 3, tipo_trabalhador: 'CLT' },
        { id: 4, tipo_trabalhador: 'CLT' },
        { id: 5, tipo_trabalhador: 'CLT' },
        { id: 6, tipo_trabalhador: 'INTERMITENTE' },
      ],
      new Map([
        [1, { padrao: null, dias: new Map() }],
        [2, { padrao: null, dias: new Map() }],
        [3, { padrao: null, dias: new Map() }],
        [4, { padrao: null, dias: new Map() }],
        [5, { padrao: null, dias: new Map() }],
        [6, { padrao: null, dias: new Map([['DOM', { inicio: '08:00', fim: '16:00' }]]) }],
      ]),
    )

    expect(ciclo).toEqual({ cicloTrabalho: 1, cicloFolga: 1 })
  })

  it('solver stays feasible with 5 CLTs + 1 intermitente covering the extra Sunday slot', async () => {
    const result = await runSolver(buildInput(), 30_000)

    expect(result.sucesso).toBe(true)
    expect(result.alocacoes).toBeDefined()

    const domingos = ['2026-03-08', '2026-03-15']
    const sundayWorkByDay = new Map<string, number>()
    for (const alocacao of result.alocacoes ?? []) {
      if (alocacao.status !== 'TRABALHO') continue
      if (!domingos.includes(alocacao.data)) continue
      sundayWorkByDay.set(alocacao.data, (sundayWorkByDay.get(alocacao.data) ?? 0) + 1)
    }

    for (const domingo of domingos) {
      expect(
        result.alocacoes?.some((alocacao) =>
          alocacao.colaborador_id === 6
          && alocacao.data === domingo
          && alocacao.status === 'TRABALHO',
        ),
      ).toBe(true)
      expect(sundayWorkByDay.get(domingo)).toBeGreaterThanOrEqual(3)
    }
  }, 60_000)

  it('solver stays feasible when the intermitente has DOM ativo sem horario fixo', async () => {
    const result = await runSolver(buildInputWithRuleWindow(false), 30_000)

    expect(result.sucesso).toBe(true)
    expect(
      result.alocacoes?.some((alocacao) =>
        alocacao.colaborador_id === 6
        && alocacao.data === '2026-03-08'
        && alocacao.status === 'TRABALHO',
      ),
    ).toBe(true)
  }, 60_000)
})
