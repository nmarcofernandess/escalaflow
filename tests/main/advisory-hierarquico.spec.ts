import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { EscalaAdvisoryInput, EscalaAdvisoryOutputV2 } from '../../src/shared/advisory-types'

// Mock solver-bridge — must be before imports that use it
vi.mock('../../src/main/motor/solver-bridge', () => ({
  buildSolverInput: vi.fn().mockResolvedValue({
    colaboradores: [
      { id: 1, nome: 'Colab A' },
      { id: 2, nome: 'Colab B' },
    ],
    config: {},
    demanda: [],
    feriados: [],
    excecoes: [],
    data_inicio: '2026-03-02',
    data_fim: '2026-03-08',
  }),
  runSolver: vi.fn(),
}))

function makeInput(overrides: Partial<EscalaAdvisoryInput> = {}): EscalaAdvisoryInput {
  return {
    setor_id: 1,
    data_inicio: '2026-03-02',
    data_fim: '2026-03-08',
    pinned_folga_externo: [],
    current_folgas: [],
    ...overrides,
  }
}

describe('runAdvisory (hierarchical single solve)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns CURRENT_VALID when no pins violated (pin_cost=0)', async () => {
    const { runSolver } = await import('../../src/main/motor/solver-bridge')
    vi.mocked(runSolver).mockResolvedValue({
      sucesso: true,
      status: 'ADVISORY_OK',
      advisory_pattern: [{ c: 0, d: 0, band: 3 }],
      diagnostico: { pin_violations: [], pin_cost: 0 },
    } as any)

    const { runAdvisory } = await import('../../src/main/motor/advisory-controller')
    const result: EscalaAdvisoryOutputV2 = await runAdvisory(
      makeInput({
        pinned_folga_externo: [{ c: 0, d: 5, band: 0, origin: 'auto', weight: 100 }],
      }),
    )

    expect(result.status).toBe('CURRENT_VALID')
    expect(result.pin_cost).toBe(0)
    expect(result.pin_violations).toBeUndefined()
  })

  it('returns PROPOSAL_VALID with pin_violations when pins violated', async () => {
    const { runSolver } = await import('../../src/main/motor/solver-bridge')
    vi.mocked(runSolver).mockResolvedValue({
      sucesso: true,
      status: 'ADVISORY_OK',
      advisory_pattern: [
        { c: 0, d: 0, band: 3 }, { c: 0, d: 1, band: 3 }, { c: 0, d: 2, band: 3 },
        { c: 0, d: 3, band: 3 }, { c: 0, d: 4, band: 3 }, { c: 0, d: 5, band: 3 },
        { c: 0, d: 6, band: 0 },
      ],
      diagnostico: {
        pin_violations: [
          { c: 0, d: 5, origin: 'auto', weight: 100, band_expected: 0, band_actual: 3 },
        ],
        pin_cost: 100,
      },
    } as any)

    const { runAdvisory } = await import('../../src/main/motor/advisory-controller')
    const result: EscalaAdvisoryOutputV2 = await runAdvisory(
      makeInput({
        pinned_folga_externo: [{ c: 0, d: 5, band: 0, origin: 'auto', weight: 100 }],
        current_folgas: [{
          colaborador_id: 1,
          fixa: 'SAB',
          variavel: null,
          origem_fixa: 'COLABORADOR',
          origem_variavel: 'COLABORADOR',
        }],
      }),
    )

    expect(result.status).toBe('PROPOSAL_VALID')
    expect(result.pin_cost).toBe(100)
    expect(result.pin_violations).toHaveLength(1)
    expect(result.pin_violations![0]!.origin).toBe('auto')
    expect(result.pin_violations![0]!.nome).toBe('Colab A')
    expect(result.pin_violations![0]!.band_expected).toBe(0)
    expect(result.pin_violations![0]!.band_actual).toBe(3)
    // d=5 in a Mon-start week is SAB
    expect(result.pin_violations![0]!.dia).toBe('SAB')
    expect(result.pin_violations![0]!.descricao).toContain('folga')
    expect(result.pin_violations![0]!.descricao).toContain('dia inteiro')
  })

  it('returns NO_PROPOSAL when solver fails (ADVISORY_INFEASIBLE)', async () => {
    const { runSolver } = await import('../../src/main/motor/solver-bridge')
    vi.mocked(runSolver).mockResolvedValue({
      sucesso: false,
      status: 'ADVISORY_INFEASIBLE',
      diagnostico: {},
    } as any)

    const { runAdvisory } = await import('../../src/main/motor/advisory-controller')
    const result: EscalaAdvisoryOutputV2 = await runAdvisory(makeInput())

    expect(result.status).toBe('NO_PROPOSAL')
    expect(result.diagnostics).toHaveLength(1)
    expect(result.diagnostics[0]!.code).toBe('VALIDACAO_INVIAVEL')
    expect(result.fallback?.should_open_ia).toBe(true)
  })

  it('returns NO_PROPOSAL when solver throws', async () => {
    const { runSolver } = await import('../../src/main/motor/solver-bridge')
    vi.mocked(runSolver).mockRejectedValue(new Error('Solver binary not found'))

    const { runAdvisory } = await import('../../src/main/motor/advisory-controller')
    const result: EscalaAdvisoryOutputV2 = await runAdvisory(makeInput())

    expect(result.status).toBe('NO_PROPOSAL')
    expect(result.diagnostics[0]!.code).toBe('VALIDACAO_ERRO')
    expect(result.diagnostics[0]!.detail).toContain('Solver binary not found')
    expect(result.fallback?.should_open_ia).toBe(true)
  })

  it('includes hierarchy_summary with correct counts', async () => {
    const { runSolver } = await import('../../src/main/motor/solver-bridge')
    vi.mocked(runSolver).mockResolvedValue({
      sucesso: true,
      status: 'ADVISORY_OK',
      advisory_pattern: [],
      diagnostico: {
        pin_violations: [
          { c: 0, d: 0, origin: 'auto', weight: 100, band_expected: 0, band_actual: 3 },
          { c: 1, d: 1, origin: 'manual', weight: 5000, band_expected: 0, band_actual: 3 },
          { c: 0, d: 2, origin: 'saved', weight: 10000, band_expected: 0, band_actual: 1 },
        ],
        pin_cost: 15100,
      },
    } as any)

    const { runAdvisory } = await import('../../src/main/motor/advisory-controller')
    const result: EscalaAdvisoryOutputV2 = await runAdvisory(makeInput())

    expect(result.hierarchy_summary).toEqual({
      auto_changes: 1,
      manual_changes: 1,
      saved_changes: 1,
    })
    expect(result.pin_cost).toBe(15100)
  })

  it('returns CURRENT_VALID for validate_only even with solver success', async () => {
    const { runSolver } = await import('../../src/main/motor/solver-bridge')
    vi.mocked(runSolver).mockResolvedValue({
      sucesso: true,
      status: 'ADVISORY_OK',
      advisory_pattern: [],
      diagnostico: {
        pin_violations: [
          { c: 0, d: 0, origin: 'auto', weight: 100, band_expected: 0, band_actual: 3 },
        ],
        pin_cost: 100,
      },
    } as any)

    const { runAdvisory } = await import('../../src/main/motor/advisory-controller')
    const result: EscalaAdvisoryOutputV2 = await runAdvisory(
      makeInput({ validate_only: true }),
    )

    expect(result.status).toBe('CURRENT_VALID')
    // validate_only skips pin_violations/hierarchy_summary processing
    expect(result.pin_violations).toBeUndefined()
    expect(result.pin_cost).toBeUndefined()
  })

  it('returns NO_PROPOSAL for validate_only when solver fails', async () => {
    const { runSolver } = await import('../../src/main/motor/solver-bridge')
    vi.mocked(runSolver).mockResolvedValue({
      sucesso: false,
      status: 'INFEASIBLE',
      diagnostico: {},
    } as any)

    const { runAdvisory } = await import('../../src/main/motor/advisory-controller')
    const result: EscalaAdvisoryOutputV2 = await runAdvisory(
      makeInput({ validate_only: true }),
    )

    expect(result.status).toBe('NO_PROPOSAL')
  })

  it('calls runSolver exactly once (single solve)', async () => {
    const { runSolver } = await import('../../src/main/motor/solver-bridge')
    vi.mocked(runSolver).mockResolvedValue({
      sucesso: true,
      status: 'ADVISORY_OK',
      advisory_pattern: [],
      diagnostico: { pin_violations: [], pin_cost: 0 },
    } as any)

    const { runAdvisory } = await import('../../src/main/motor/advisory-controller')
    await runAdvisory(makeInput())

    expect(runSolver).toHaveBeenCalledTimes(1)
  })

  it('handles missing diagnostico gracefully', async () => {
    const { runSolver } = await import('../../src/main/motor/solver-bridge')
    vi.mocked(runSolver).mockResolvedValue({
      sucesso: true,
      status: 'ADVISORY_OK',
      advisory_pattern: [],
      // no diagnostico field
    } as any)

    const { runAdvisory } = await import('../../src/main/motor/advisory-controller')
    const result: EscalaAdvisoryOutputV2 = await runAdvisory(makeInput())

    expect(result.status).toBe('CURRENT_VALID')
    expect(result.pin_cost).toBe(0)
    expect(result.pin_violations).toBeUndefined()
  })

  it('strips feriados and excecoes from solver input', async () => {
    const { buildSolverInput, runSolver } = await import('../../src/main/motor/solver-bridge')
    vi.mocked(runSolver).mockResolvedValue({
      sucesso: true,
      status: 'ADVISORY_OK',
      advisory_pattern: [],
      diagnostico: { pin_violations: [], pin_cost: 0 },
    } as any)

    const { runAdvisory } = await import('../../src/main/motor/advisory-controller')
    await runAdvisory(makeInput())

    // Verify the solver was called with stripped feriados/excecoes
    const solverCallArg = vi.mocked(runSolver).mock.calls[0]?.[0] as any
    expect(solverCallArg.feriados).toEqual([])
    expect(solverCallArg.excecoes).toEqual([])
    expect(solverCallArg.config.advisory_only).toBe(true)
  })
})
