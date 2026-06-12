import { describe, expect, it, vi } from 'vitest'
import { executarVerificacaoPrevia } from '../../src/renderer/src/lib/verificacao-previa'
import type {
  EscalaAdvisoryInput,
  EscalaAdvisoryOutputV2,
  EscalaPreflightResult,
} from '../../src/shared'

const baseInput: EscalaAdvisoryInput = {
  setor_id: 1,
  data_inicio: '2026-06-15',
  data_fim: '2026-07-12',
  pinned_folga_externo: [],
  current_folgas: [],
  validate_only: true,
}

function preflight(overrides: Partial<EscalaPreflightResult> = {}): EscalaPreflightResult {
  return {
    ok: true,
    blockers: [],
    warnings: [],
    summary: {
      setor_id: 1,
      data_inicio: '2026-06-15',
      data_fim: '2026-07-12',
      colaboradores_ativos: 5,
      demandas_cadastradas: 3,
      feriados_no_periodo: 0,
      demanda_zero_fallback: false,
    },
    ...overrides,
  }
}

function advisory(overrides: Partial<EscalaAdvisoryOutputV2> = {}): EscalaAdvisoryOutputV2 {
  return {
    status: 'CURRENT_VALID',
    diagnostics: [],
    pin_cost: 0,
    ...overrides,
  }
}

describe('executarVerificacaoPrevia', () => {
  it('so finaliza verde quando a checagem basica e a validacao forte passam', async () => {
    const onStage = vi.fn()
    const runPreflight = vi.fn().mockResolvedValue(preflight())
    const runAdvisory = vi.fn().mockResolvedValue(advisory())

    const result = await executarVerificacaoPrevia(baseInput, {
      runPreflight,
      runAdvisory,
      onStage,
    })

    expect(runPreflight).toHaveBeenCalledWith(1, {
      data_inicio: '2026-06-15',
      data_fim: '2026-07-12',
    })
    expect(runAdvisory).toHaveBeenCalledWith(baseInput)
    expect(onStage).toHaveBeenNthCalledWith(1, 'basic')
    expect(onStage).toHaveBeenNthCalledWith(2, 'motor')
    expect(result.status).toBe('CURRENT_VALID')
    expect(result.diagnostics).toEqual([])
  })

  it('nao chama a validacao forte quando os prerequisitos basicos bloqueiam', async () => {
    const runPreflight = vi.fn().mockResolvedValue(preflight({
      ok: false,
      blockers: [{
        codigo: 'SEM_COLABORADORES',
        severidade: 'BLOCKER',
        mensagem: 'Setor nao tem colaboradores ativos.',
        detalhe: 'Cadastre ao menos 1 colaborador para gerar escala.',
      }],
    }))
    const runAdvisory = vi.fn()

    const result = await executarVerificacaoPrevia(baseInput, {
      runPreflight,
      runAdvisory,
    })

    expect(runAdvisory).not.toHaveBeenCalled()
    expect(result.status).toBe('NO_PROPOSAL')
    expect(result.diagnostics[0]).toEqual(expect.objectContaining({
      code: 'SEM_COLABORADORES',
      severity: 'error',
      title: 'Setor nao tem colaboradores ativos.',
      detail: 'Cadastre ao menos 1 colaborador para gerar escala.',
    }))
  })

  it('mantem vermelho quando os prerequisitos passam mas a validacao forte nao encontra escala', async () => {
    const runPreflight = vi.fn().mockResolvedValue(preflight())
    const runAdvisory = vi.fn().mockResolvedValue(advisory({
      status: 'NO_PROPOSAL',
      diagnostics: [{
        code: 'VALIDACAO_INVIAVEL',
        severity: 'error',
        gate: 'BLOCK',
        title: 'Nao foi possivel fechar a escala.',
        detail: 'Revise equipe e demanda.',
        source: 'advisory_current',
      }],
      fallback: {
        should_open_ia: true,
        reason: 'Sem escala viavel.',
        diagnosis_payload: null,
      },
    }))

    const result = await executarVerificacaoPrevia(baseInput, {
      runPreflight,
      runAdvisory,
    })

    expect(runAdvisory).toHaveBeenCalledOnce()
    expect(result.status).toBe('NO_PROPOSAL')
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: 'VALIDACAO_INVIAVEL',
        severity: 'error',
      }),
    ])
  })
})
