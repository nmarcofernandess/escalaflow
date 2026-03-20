/** @vitest-environment jsdom */

import { render, screen } from '@testing-library/react'
import { SugestaoSheet } from '../../src/renderer/src/componentes/SugestaoSheet'
import type { EscalaAdvisoryOutputV2 } from '../../src/shared/advisory-types'

/* ─── Mock data ──────────────────────────────────────────────── */

const mockAdvisoryV2: EscalaAdvisoryOutputV2 = {
  status: 'PROPOSAL_VALID',
  diagnostics: [
    {
      code: 'COBERTURA_DIA',
      severity: 'warning',
      title: 'Cobertura insuficiente',
      detail: 'SEG com deficit',
    },
  ],
  proposal: {
    diff: [
      {
        colaborador_id: 1,
        nome: 'Alex',
        posto_apelido: 'Caixa 1',
        fixa_atual: 'SEG',
        fixa_proposta: 'QUA',
        variavel_atual: null,
        variavel_proposta: 'SEX',
      },
    ],
  },
  pin_violations: [
    {
      colaborador_id: 1,
      nome: 'Alex',
      dia: 'SEG',
      data: '2026-03-02',
      origin: 'manual',
      weight: 100,
      band_expected: 0,
      band_actual: 3,
      descricao: 'SEG: folga → integral',
    },
    {
      colaborador_id: 2,
      nome: 'Maria',
      dia: 'QUA',
      data: '2026-03-04',
      origin: 'auto',
      weight: 10,
      band_expected: 0,
      band_actual: 1,
      descricao: 'QUA: folga → manha',
    },
  ],
  pin_cost: 110,
}

const noop = () => {}

/* ─── Helpers ────────────────────────────────────────────────── */

function renderSheet(overrides: Partial<Parameters<typeof SugestaoSheet>[0]> = {}) {
  return render(
    <SugestaoSheet
      open={true}
      onOpenChange={noop}
      loading={false}
      advisory={mockAdvisoryV2}
      onAceitarEGerar={noop}
      onGerarMesmoAssim={noop}
      onCancelar={noop}
      {...overrides}
    />,
  )
}

/* ─── Tests ──────────────────────────────────────────────────── */

describe('SugestaoSheet', () => {
  describe('V2 pin violations', () => {
    it('renders user violations (manual/saved) in the main section', () => {
      renderSheet()

      // Alex's manual violation should be visible
      expect(screen.getByText('Alex')).toBeInTheDocument()
    })

    it('shows user violation count in header', () => {
      renderSheet()

      // Header shows "Mudancas nas suas escolhas (1)" for the manual violation
      expect(screen.getByText(/Mudancas nas suas escolhas/)).toBeInTheDocument()
    })

    it('shows auto adjustments section (collapsed by default)', () => {
      renderSheet()

      // Auto violations are under "Ajustes automaticos" toggle
      expect(screen.getByText(/Ajustes automaticos/)).toBeInTheDocument()
    })
  })

  describe('loading state', () => {
    it('shows spinner and analyzing text when loading', () => {
      renderSheet({ loading: true, advisory: null })

      // "Analisando o arranjo..." appears in both description and the spinner area
      const matches = screen.getAllByText('Analisando o arranjo...')
      expect(matches.length).toBeGreaterThanOrEqual(1)

      // The spinner container with animate-spin class must be present
      const spinner = document.querySelector('.animate-spin')
      expect(spinner).toBeTruthy()
    })

    it('does not show violations when loading even with advisory present', () => {
      renderSheet({ loading: true })

      // The component gates on !loading, so violations should not appear
      expect(screen.queryByText('Alex')).not.toBeInTheDocument()
    })
  })

  describe('escape hatch buttons', () => {
    it('shows all 3 buttons: Aceitar e Gerar, Gerar mesmo assim, Cancelar', () => {
      renderSheet()

      expect(screen.getByRole('button', { name: /Aceitar e Gerar/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /Gerar mesmo assim/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /Cancelar/i })).toBeInTheDocument()
    })

    it('Aceitar e Gerar is only visible when pin_cost > 0', () => {
      const noCost: EscalaAdvisoryOutputV2 = {
        ...mockAdvisoryV2,
        pin_violations: [],
        pin_cost: 0,
      }

      renderSheet({ advisory: noCost })

      expect(screen.queryByRole('button', { name: /Aceitar e Gerar/i })).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: /Gerar mesmo assim/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /Cancelar/i })).toBeInTheDocument()
    })

    it('buttons are disabled while loading', () => {
      renderSheet({ loading: true, advisory: null })

      const gerarBtn = screen.getByRole('button', { name: /Gerar mesmo assim/i })
      expect(gerarBtn).toBeDisabled()
    })
  })

  describe('status config', () => {
    it('CURRENT_VALID shows success message', () => {
      const valid: EscalaAdvisoryOutputV2 = {
        status: 'CURRENT_VALID',
        diagnostics: [],
        pin_violations: [],
        pin_cost: 0,
      }

      renderSheet({ advisory: valid })

      expect(screen.getByText('Tudo certo!')).toBeInTheDocument()
    })

    it('NO_PROPOSAL shows error state', () => {
      const noProposal: EscalaAdvisoryOutputV2 = {
        status: 'NO_PROPOSAL',
        diagnostics: [
          { code: 'INFEASIBLE', severity: 'error', title: 'Sem solucao', detail: 'Impossivel' },
        ],
        pin_violations: [],
        pin_cost: 0,
        fallback: {
          should_open_ia: true,
          reason: 'Solver nao encontrou solucao.',
          diagnosis_payload: null,
        },
      }

      renderSheet({ advisory: noProposal, onAnalisarIa: noop })

      // Error diagnostics are shown
      expect(screen.getByText('Sem solucao')).toBeInTheDocument()
      // IA button is shown
      expect(screen.getByRole('button', { name: /Analisar com IA/i })).toBeInTheDocument()
    })
  })

  describe('diagnostics display', () => {
    it('shows warning diagnostics', () => {
      renderSheet()

      expect(screen.getByText('Cobertura insuficiente')).toBeInTheDocument()
    })

    it('hides info-level diagnostics', () => {
      const withInfo: EscalaAdvisoryOutputV2 = {
        ...mockAdvisoryV2,
        diagnostics: [
          { code: 'OK', severity: 'info', title: 'Tudo OK', detail: 'Sem problemas' },
        ],
      }

      renderSheet({ advisory: withInfo })

      // Info diagnostics are filtered out from the display
      expect(screen.queryByText('Tudo OK')).not.toBeInTheDocument()
    })
  })

  describe('legacy fallback', () => {
    it('renders legacy diff table when pin_violations is empty but proposal exists', () => {
      const legacy: EscalaAdvisoryOutputV2 = {
        status: 'PROPOSAL_VALID',
        diagnostics: [],
        proposal: {
          diff: [
            {
              colaborador_id: 1,
              nome: 'Alex',
              posto_apelido: 'Caixa 1',
              fixa_atual: 'SEG',
              fixa_proposta: 'QUA',
              variavel_atual: null,
              variavel_proposta: null,
            },
          ],
        },
        // No pin_violations → falls back to legacy table
        pin_cost: 0,
      }

      renderSheet({ advisory: legacy })

      // Legacy diff table shows collaborator name
      expect(screen.getByText('Alex')).toBeInTheDocument()
      // Shows "Ajustes sugeridos" header
      expect(screen.getByText('Ajustes sugeridos')).toBeInTheDocument()
    })
  })
})
