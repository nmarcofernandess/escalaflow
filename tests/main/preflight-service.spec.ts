import { beforeEach, describe, expect, it, vi } from 'vitest'
import { queryOne } from '../../src/main/db/query'
import { buildSolverInput } from '../../src/main/motor/solver-bridge'
import { buildEscalaPreflight } from '../../src/main/motor/preflight-service'

vi.mock('../../src/main/db/query', () => ({
  queryOne: vi.fn(),
}))

vi.mock('../../src/main/motor/solver-bridge', () => ({
  buildSolverInput: vi.fn(),
}))

const emptySolverInput = {
  data_inicio: '2026-07-01',
  data_fim: '2026-07-07',
  empresa: {
    hora_abertura: '08:00',
    hora_fechamento: '18:00',
    grid_minutos: 30,
    horario_por_dia: {},
  },
  colaboradores: [
    {
      id: 1,
      nome: 'Ana',
      tipo_trabalhador: 'MENSALISTA',
      domingo_ciclo_trabalho: 1,
    },
  ],
  demanda: [],
  feriados: [],
  excecoes: [],
  regras_colaborador_dia: [],
  piso_operacional: 1,
}

describe('preflight service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns blockers without calling solver input when sector is invalid', async () => {
    vi.mocked(queryOne)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 0 })

    const result = await buildEscalaPreflight(99, '2026-07-01', '2026-07-07')

    expect(result.ok).toBe(false)
    expect(result.blockers.map((blocker) => blocker.codigo)).toEqual(['SETOR_INVALIDO', 'SEM_COLABORADORES'])
    expect(result.warnings.map((warning) => warning.codigo)).toEqual(['SEM_DEMANDA'])
    expect(result.summary).toMatchObject({
      setor_id: 99,
      colaboradores_ativos: 0,
      demandas_cadastradas: 0,
      demanda_zero_fallback: true,
    })
    expect(buildSolverInput).not.toHaveBeenCalled()
  })

  it('builds detailed capacity preflight for a valid sector', async () => {
    vi.mocked(queryOne)
      .mockResolvedValueOnce({ id: 2, ativo: true })
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 })
    vi.mocked(buildSolverInput).mockResolvedValueOnce(emptySolverInput as any)

    const result = await buildEscalaPreflight(2, '2026-07-01', '2026-07-07', [
      { colaborador_id: 1, regime_escala: '6X1' },
    ])

    expect(result.ok).toBe(true)
    expect(result.blockers).toEqual([])
    expect(result.warnings).toEqual([])
    expect(result.summary).toMatchObject({
      setor_id: 2,
      colaboradores_ativos: 1,
      demandas_cadastradas: 1,
      feriados_no_periodo: 0,
      demanda_zero_fallback: false,
    })
    expect(buildSolverInput).toHaveBeenCalledWith(2, '2026-07-01', '2026-07-07', undefined, {
      regimesOverride: [{ colaborador_id: 1, regime_escala: '6X1' }],
    })
  })

  it('surfaces detailed diagnostic failures as warnings while preserving preflight result', async () => {
    vi.mocked(queryOne)
      .mockResolvedValueOnce({ id: 2, ativo: true })
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 })
    vi.mocked(buildSolverInput).mockRejectedValueOnce(new Error('DB incompleto para montar solver input'))

    const result = await buildEscalaPreflight(2, '2026-07-01', '2026-07-07')

    expect(result.ok).toBe(true)
    expect(result.blockers).toEqual([])
    expect(result.warnings).toEqual([
      expect.objectContaining({
        codigo: 'PREFLIGHT_DIAGNOSTICO_INDISPONIVEL',
        detalhe: 'DB incompleto para montar solver input',
      }),
    ])
  })
})
