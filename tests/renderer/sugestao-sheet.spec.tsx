/** @vitest-environment jsdom */

import { render, screen, within } from '@testing-library/react'
import { SugestaoSheet } from '../../src/renderer/src/componentes/SugestaoSheet'
import type { EscalaAdvisoryOutput } from '../../src/shared/advisory-types'

/* ─── Mock data ──────────────────────────────────────────────── */

const mockAdvisory: EscalaAdvisoryOutput = {
  status: 'PROPOSAL_VALID',
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
      {
        code: 'DOMINGOS_CONSECUTIVOS',
        status: 'PASS',
        title: 'Domingos OK',
        detail: 'Dentro do limite',
        source: 'PHASE1',
      },
    ],
  },
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
    criteria: [
      {
        code: 'COBERTURA_DIA',
        status: 'PASS',
        title: 'Proposta cobre todos os dias',
        detail: 'OK',
        source: 'PHASE1',
      },
      {
        code: 'DESCANSO_JORNADA',
        status: 'NOT_EVALUATED',
        title: 'Descanso nao avaliado',
        detail: 'So na geracao',
        source: 'PHASE1',
      },
    ],
  },
}

const noop = () => {}

/* ─── Helpers ────────────────────────────────────────────────── */

function renderSheet(overrides: Partial<Parameters<typeof SugestaoSheet>[0]> = {}) {
  return render(
    <SugestaoSheet
      open={true}
      onOpenChange={noop}
      loading={false}
      advisory={mockAdvisory}
      onAceitar={noop}
      onDescartar={noop}
      {...overrides}
    />,
  )
}

/* ─── Tests ──────────────────────────────────────────────────── */

describe('SugestaoSheet', () => {
  describe('criterion data-status attributes', () => {
    it('FAIL criteria get data-status=FAIL, never PASS', () => {
      renderSheet()

      const failRows = document.querySelectorAll('[data-status="FAIL"]')
      expect(failRows.length).toBeGreaterThanOrEqual(1)

      for (const row of failRows) {
        expect(row.getAttribute('data-status')).toBe('FAIL')
        // Double-check: no green success class on FAIL rows
        expect(row.querySelector('.text-success')).toBeNull()
        // Must have destructive (red) styling
        expect(row.querySelector('.text-destructive')).toBeTruthy()
      }
    })

    it('PASS criteria get data-status=PASS with success styling', () => {
      renderSheet()

      const passRows = document.querySelectorAll('[data-status="PASS"]')
      expect(passRows.length).toBeGreaterThanOrEqual(1)

      for (const row of passRows) {
        expect(row.getAttribute('data-status')).toBe('PASS')
        expect(row.querySelector('.text-success')).toBeTruthy()
        expect(row.querySelector('.text-destructive')).toBeNull()
      }
    })

    it('NOT_EVALUATED criteria get data-status=NOT_EVALUATED with muted styling', () => {
      renderSheet()

      const notEvalRows = document.querySelectorAll('[data-status="NOT_EVALUATED"]')
      expect(notEvalRows.length).toBeGreaterThanOrEqual(1)

      for (const row of notEvalRows) {
        expect(row.getAttribute('data-status')).toBe('NOT_EVALUATED')
        expect(row.querySelector('.text-muted-foreground')).toBeTruthy()
        // Must NOT have success or destructive styling
        expect(row.querySelector('.text-success')).toBeNull()
        expect(row.querySelector('.text-destructive')).toBeNull()
      }
    })
  })

  describe('no false green checks (the core invariant)', () => {
    it('all-FAIL advisory has zero PASS data-status rows', () => {
      const allFail: EscalaAdvisoryOutput = {
        status: 'CURRENT_INVALID',
        normalized_diagnostics: [],
        current: {
          criteria: [
            {
              code: 'COBERTURA_DIA',
              status: 'FAIL',
              title: 'Cobertura insuficiente',
              detail: 'Deficit geral',
              source: 'PHASE1',
            },
            {
              code: 'DOMINGOS_CONSECUTIVOS',
              status: 'FAIL',
              title: 'Domingos estourados',
              detail: '3 consecutivos',
              source: 'PHASE1',
            },
          ],
        },
      }

      renderSheet({ advisory: allFail })

      const passRows = document.querySelectorAll('[data-status="PASS"]')
      expect(passRows.length).toBe(0)

      const failRows = document.querySelectorAll('[data-status="FAIL"]')
      expect(failRows.length).toBe(2)
    })

    it('mixed criteria map exactly: each status appears the right number of times', () => {
      renderSheet()

      // mockAdvisory has: current(1 FAIL, 1 PASS) + proposal(1 PASS, 1 NOT_EVALUATED)
      const failRows = document.querySelectorAll('[data-status="FAIL"]')
      const passRows = document.querySelectorAll('[data-status="PASS"]')
      const notEvalRows = document.querySelectorAll('[data-status="NOT_EVALUATED"]')

      expect(failRows.length).toBe(1) // 1 FAIL in current
      expect(passRows.length).toBe(2) // 1 PASS in current + 1 PASS in proposal
      expect(notEvalRows.length).toBe(1) // 1 NOT_EVALUATED in proposal
    })
  })

  describe('loading state', () => {
    it('shows spinner and analyzing text when loading', () => {
      renderSheet({ loading: true, advisory: null })

      // "Analisando..." appears in both SheetDescription and the spinner area
      const matches = screen.getAllByText('Analisando...')
      expect(matches.length).toBeGreaterThanOrEqual(1)

      // The spinner container with animate-spin class must be present
      const spinner = document.querySelector('.animate-spin')
      expect(spinner).toBeTruthy()

      // Criteria should NOT be rendered during loading
      const criterionRows = document.querySelectorAll('[data-status]')
      expect(criterionRows.length).toBe(0)
    })

    it('does not show criteria when loading even with advisory present', () => {
      renderSheet({ loading: true })

      // The component gates on !loading, so criteria should not appear
      const criterionRows = document.querySelectorAll('[data-status]')
      expect(criterionRows.length).toBe(0)
    })
  })

  describe('proposal diff table', () => {
    it('renders collaborator name in diff table', () => {
      renderSheet()

      expect(screen.getByText('Alex')).toBeInTheDocument()
    })

    it('hides diff table when no proposal', () => {
      const noProposal: EscalaAdvisoryOutput = {
        status: 'CURRENT_VALID',
        normalized_diagnostics: [],
        current: {
          criteria: [
            {
              code: 'COBERTURA_DIA',
              status: 'PASS',
              title: 'Tudo OK',
              detail: 'Sem problemas',
              source: 'PHASE1',
            },
          ],
        },
      }

      renderSheet({ advisory: noProposal })

      expect(screen.queryByText('Proposta de ajuste')).not.toBeInTheDocument()
      expect(screen.queryByText('Colaborador')).not.toBeInTheDocument()
    })
  })

  describe('aceitar button state', () => {
    it('aceitar button is disabled when no proposal', () => {
      const noProposal: EscalaAdvisoryOutput = {
        status: 'NO_PROPOSAL',
        normalized_diagnostics: [],
        current: {
          criteria: [
            {
              code: 'COBERTURA_DIA',
              status: 'FAIL',
              title: 'Falhou',
              detail: 'Sem cobertura',
              source: 'PHASE1',
            },
          ],
        },
        fallback: {
          should_open_ia: true,
          reason: 'Solver nao encontrou solucao.',
          diagnosis_payload: null,
        },
      }

      renderSheet({ advisory: noProposal })

      const aceitarBtn = screen.getByRole('button', { name: /aceitar sugestao/i })
      expect(aceitarBtn).toBeDisabled()
    })

    it('aceitar button is disabled while loading', () => {
      renderSheet({ loading: true, advisory: null })

      const aceitarBtn = screen.getByRole('button', { name: /aceitar sugestao/i })
      expect(aceitarBtn).toBeDisabled()
    })

    it('aceitar button is enabled when proposal exists and not loading', () => {
      renderSheet()

      const aceitarBtn = screen.getByRole('button', { name: /aceitar sugestao/i })
      expect(aceitarBtn).toBeEnabled()
    })
  })
})
