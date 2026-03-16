import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { EscalaAdvisoryOutput } from '../../src/shared/advisory-types'

/* ─── Mock window.electron before iaStore loads ─────────────── */

const ipcMock = {
  invoke: vi.fn().mockResolvedValue([]),
  on: vi.fn(),
  removeListener: vi.fn(),
  removeAllListeners: vi.fn(),
}

// iaStore.ts reads window.electron.ipcRenderer at module scope,
// so we must set the global before the dynamic import.
;(globalThis as any).window = {
  ...(typeof window !== 'undefined' ? window : {}),
  electron: { ipcRenderer: ipcMock },
}

// Dynamic import AFTER the mock is in place
const { useIaStore } = await import('../../src/renderer/src/store/iaStore')

/* ─── iaStore: pendingAutoMessage ───────────────────────────── */

describe('iaStore pendingAutoMessage', () => {
  beforeEach(() => {
    useIaStore.setState({
      pendingAutoMessage: null,
      aberto: false,
    })
  })

  it('starts with null pendingAutoMessage', () => {
    expect(useIaStore.getState().pendingAutoMessage).toBeNull()
  })

  it('setPendingAutoMessage stores the message', () => {
    useIaStore.getState().setPendingAutoMessage('Test message')
    expect(useIaStore.getState().pendingAutoMessage).toBe('Test message')
  })

  it('setPendingAutoMessage(null) clears the message', () => {
    useIaStore.getState().setPendingAutoMessage('Test')
    useIaStore.getState().setPendingAutoMessage(null)
    expect(useIaStore.getState().pendingAutoMessage).toBeNull()
  })

  it('simulates the full fallback flow: set message + open panel', () => {
    // This is what SetorDetalhe does when advisory returns fallback
    const prompt = 'O setor precisa de ajuda com a escala. O solver nao encontrou arranjo viavel.'

    useIaStore.getState().setPendingAutoMessage(prompt)
    useIaStore.getState().setAberto(true)

    const state = useIaStore.getState()
    expect(state.pendingAutoMessage).toBe(prompt)
    expect(state.aberto).toBe(true)
  })

  it('message survives panel toggle', () => {
    useIaStore.getState().setPendingAutoMessage('Important message')
    useIaStore.getState().setAberto(true)
    useIaStore.getState().setAberto(false)
    useIaStore.getState().setAberto(true)

    // Message should still be there until consumed by IaChatView
    expect(useIaStore.getState().pendingAutoMessage).toBe('Important message')
  })

  it('message is independent of conversa state', () => {
    useIaStore.getState().setPendingAutoMessage('Diagnostic prompt')
    useIaStore.setState({ conversa_ativa_id: 'abc-123' })

    expect(useIaStore.getState().pendingAutoMessage).toBe('Diagnostic prompt')
    expect(useIaStore.getState().conversa_ativa_id).toBe('abc-123')
  })
})

/* ─── Advisory fallback contract ────────────────────────────── */

describe('advisory fallback behavior', () => {
  it('NO_PROPOSAL status always has fallback with should_open_ia', () => {
    const output: EscalaAdvisoryOutput = {
      status: 'NO_PROPOSAL',
      normalized_diagnostics: [],
      current: {
        criteria: [
          {
            code: 'COBERTURA_DIA',
            status: 'FAIL',
            title: 'Cobertura insuficiente',
            detail: 'SEG com deficit',
            source: 'PHASE1',
          },
        ],
      },
      fallback: {
        should_open_ia: true,
        reason: 'Solver infeasible',
        diagnosis_payload: { phase1_status: 'INFEASIBLE' },
      },
    }

    expect(output.fallback).toBeDefined()
    expect(output.fallback!.should_open_ia).toBe(true)
    expect(output.fallback!.reason).toBeTruthy()
  })

  it('PROPOSAL_VALID status has no fallback', () => {
    const output: EscalaAdvisoryOutput = {
      status: 'PROPOSAL_VALID',
      normalized_diagnostics: [],
      current: { criteria: [] },
      proposal: { diff: [], criteria: [] },
    }

    expect(output.fallback).toBeUndefined()
  })

  it('CURRENT_VALID status has no fallback', () => {
    const output: EscalaAdvisoryOutput = {
      status: 'CURRENT_VALID',
      normalized_diagnostics: [],
      current: {
        criteria: [
          {
            code: 'COBERTURA_DIA',
            status: 'PASS',
            title: 'Tudo OK',
            detail: 'Todos os dias cobertos',
            source: 'PHASE1',
          },
        ],
      },
    }

    expect(output.fallback).toBeUndefined()
  })

  it('fallback reason includes diagnostic context for IA consumption', () => {
    const output: EscalaAdvisoryOutput = {
      status: 'NO_PROPOSAL',
      normalized_diagnostics: [],
      current: { criteria: [] },
      fallback: {
        should_open_ia: true,
        reason: 'Arranjo atual invalido e nenhuma proposta possivel.',
        diagnosis_payload: {
          capacidade_vs_demanda: { ratio: 0.7 },
          regras_conflitantes: ['H3_DOM_MAX_CONSEC_F'],
        },
      },
    }

    expect(output.fallback!.reason).toContain('invalido')
    expect(output.fallback!.diagnosis_payload).toBeDefined()
  })

  it('fallback diagnosis_payload can carry arbitrary solver context', () => {
    const payload = {
      phase1_status: 'INFEASIBLE',
      pass_used: 'P2_RELAXED',
      relaxed_rules: ['H3_DOM_MAX_CONSEC_M', 'H10_CARGA_SEMANAL'],
      cobertura_deficit: { SEG: -2, TER: 0, QUA: -1 },
    }

    const output: EscalaAdvisoryOutput = {
      status: 'NO_PROPOSAL',
      normalized_diagnostics: [],
      current: { criteria: [] },
      fallback: {
        should_open_ia: true,
        reason: 'Solver infeasible apos 3 passes.',
        diagnosis_payload: payload,
      },
    }

    const dp = output.fallback!.diagnosis_payload as typeof payload
    expect(dp.phase1_status).toBe('INFEASIBLE')
    expect(dp.relaxed_rules).toHaveLength(2)
    expect(dp.cobertura_deficit.SEG).toBe(-2)
  })
})

/* ─── Full flow simulation (store + advisory contract) ──────── */

describe('full advisory fallback → IA flow', () => {
  beforeEach(() => {
    useIaStore.setState({
      pendingAutoMessage: null,
      aberto: false,
    })
  })

  it('simulates SetorDetalhe handler: NO_PROPOSAL → close sheet → set message → open IA', () => {
    // Step 1: Advisory returns NO_PROPOSAL with fallback
    const advisory: EscalaAdvisoryOutput = {
      status: 'NO_PROPOSAL',
      normalized_diagnostics: [],
      current: {
        criteria: [
          {
            code: 'COBERTURA_DIA',
            status: 'FAIL',
            title: 'Cobertura insuficiente',
            detail: 'SEG e TER com deficit',
            source: 'PHASE1',
          },
        ],
      },
      fallback: {
        should_open_ia: true,
        reason: 'Solver nao encontrou arranjo viavel.',
        diagnosis_payload: { cobertura: 0.65 },
      },
    }

    // Step 2: Handler checks fallback
    expect(advisory.fallback?.should_open_ia).toBe(true)

    // Step 3: Build diagnostic prompt (simplified version of what SetorDetalhe does)
    const diagnosticPrompt = `O setor precisa de ajuda. ${advisory.fallback!.reason}`

    // Step 4: Set pending message + open IA panel
    useIaStore.getState().setPendingAutoMessage(diagnosticPrompt)
    useIaStore.getState().setAberto(true)

    // Step 5: Verify state is ready for IaChatView's useEffect
    const state = useIaStore.getState()
    expect(state.aberto).toBe(true)
    expect(state.pendingAutoMessage).toContain('Solver nao encontrou arranjo viavel')

    // Step 6: Simulate IaChatView consuming the message
    useIaStore.getState().setPendingAutoMessage(null)
    expect(useIaStore.getState().pendingAutoMessage).toBeNull()
    // Panel stays open after message is consumed
    expect(useIaStore.getState().aberto).toBe(true)
  })

  it('does NOT set pendingAutoMessage when advisory has no fallback', () => {
    const advisory: EscalaAdvisoryOutput = {
      status: 'PROPOSAL_VALID',
      normalized_diagnostics: [],
      current: { criteria: [] },
      proposal: {
        diff: [
          {
            colaborador_id: 1,
            nome: 'Ana',
            posto_apelido: 'Caixa 1',
            fixa_atual: 'SEG',
            fixa_proposta: 'QUA',
            variavel_atual: null,
            variavel_proposta: 'SEX',
          },
        ],
        criteria: [],
      },
    }

    // No fallback → no IA redirect
    if (advisory.fallback?.should_open_ia) {
      useIaStore.getState().setPendingAutoMessage('Should not reach here')
      useIaStore.getState().setAberto(true)
    }

    expect(useIaStore.getState().pendingAutoMessage).toBeNull()
    expect(useIaStore.getState().aberto).toBe(false)
  })
})
