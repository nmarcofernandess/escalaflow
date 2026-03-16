import { describe, expect, it } from 'vitest'
import {
  extractFolgaFromPattern,
  computeAdvisoryInputHash,
  convertSemanaDraftToDemanda,
  normalizeAdvisoryToDiagnostics,
} from '../../src/main/motor/advisory-controller'
import type { EscalaAdvisoryInput, EscalaAdvisoryOutput, SemanaDraftAdvisory } from '../../src/shared/advisory-types'

// ---------------------------------------------------------------------------
// extractFolgaFromPattern
// ---------------------------------------------------------------------------

describe('extractFolgaFromPattern', () => {
  /**
   * Helper: build days array for N weeks starting from a Monday.
   * 2026-03-02 is a Monday.
   */
  function buildDays(weeks: number, startDate = '2026-03-02'): string[] {
    const days: string[] = []
    const d = new Date(startDate + 'T00:00:00')
    for (let i = 0; i < weeks * 7; i++) {
      days.push(d.toISOString().slice(0, 10))
      d.setDate(d.getDate() + 1)
    }
    return days
  }

  it('2-week pattern with SEG always OFF → fixa=SEG', () => {
    const days = buildDays(2) // 14 days, Mon-Sun x2
    // Collaborator 0: OFF on day 0 (Mon wk1) and day 7 (Mon wk2)
    const pattern = [
      { c: 0, d: 0, band: 0 },  // Mon wk1
      { c: 0, d: 7, band: 0 },  // Mon wk2
    ]

    const result = extractFolgaFromPattern(pattern, days, 1)

    expect(result).toHaveLength(1)
    expect(result[0]!.c).toBe(0)
    expect(result[0]!.fixa).toBe('SEG')
    expect(result[0]!.variavel).toBeNull()
  })

  it('4-week pattern with SEG always OFF + QUA off in 50% → fixa=SEG, variavel=QUA', () => {
    const days = buildDays(4) // 28 days
    const pattern = [
      // SEG off every week (100%) → fixa
      { c: 0, d: 0, band: 0 },   // Mon wk1
      { c: 0, d: 7, band: 0 },   // Mon wk2
      { c: 0, d: 14, band: 0 },  // Mon wk3
      { c: 0, d: 21, band: 0 },  // Mon wk4
      // QUA off 2 of 4 weeks (50%) → variavel
      { c: 0, d: 2, band: 0 },   // Wed wk1
      { c: 0, d: 16, band: 0 },  // Wed wk3
    ]

    const result = extractFolgaFromPattern(pattern, days, 1)

    expect(result).toHaveLength(1)
    expect(result[0]!.fixa).toBe('SEG')
    expect(result[0]!.variavel).toBe('QUA')
  })

  it('returns null folgas for collaborator with no OFF days', () => {
    const days = buildDays(2)
    // Pattern has entries for collaborator 0 but all are working (band != 0)
    const pattern = [
      { c: 0, d: 0, band: 1 },
      { c: 0, d: 1, band: 2 },
    ]

    const result = extractFolgaFromPattern(pattern, days, 1)

    expect(result[0]!.fixa).toBeNull()
    expect(result[0]!.variavel).toBeNull()
  })

  it('handles multiple collaborators independently', () => {
    const days = buildDays(2)
    const pattern = [
      // Colab 0: SEG always OFF
      { c: 0, d: 0, band: 0 },
      { c: 0, d: 7, band: 0 },
      // Colab 1: TER always OFF
      { c: 1, d: 1, band: 0 },
      { c: 1, d: 8, band: 0 },
    ]

    const result = extractFolgaFromPattern(pattern, days, 2)

    expect(result).toHaveLength(2)
    expect(result[0]!.fixa).toBe('SEG')
    expect(result[1]!.fixa).toBe('TER')
  })

  it('handles empty pattern gracefully', () => {
    const days = buildDays(2)
    const result = extractFolgaFromPattern([], days, 2)

    expect(result).toHaveLength(2)
    expect(result[0]!.fixa).toBeNull()
    expect(result[1]!.fixa).toBeNull()
  })

  it('handles zero days gracefully', () => {
    const result = extractFolgaFromPattern([], [], 1)

    expect(result).toHaveLength(1)
    expect(result[0]!.fixa).toBeNull()
    expect(result[0]!.variavel).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// computeAdvisoryInputHash
// ---------------------------------------------------------------------------

describe('computeAdvisoryInputHash', () => {
  function makeInput(overrides: Partial<EscalaAdvisoryInput> = {}): EscalaAdvisoryInput {
    return {
      setor_id: 1,
      data_inicio: '2026-03-02',
      data_fim: '2026-03-08',
      pinned_folga_externo: [{ c: 0, d: 0, band: 0 }],
      current_folgas: [
        {
          colaborador_id: 10,
          fixa: 'SEG',
          variavel: 'QUA',
          origem_fixa: 'COLABORADOR',
          origem_variavel: 'COLABORADOR',
        },
      ],
      ...overrides,
    }
  }

  it('is deterministic — same input produces same hash', () => {
    const input = makeInput()
    const hash1 = computeAdvisoryInputHash(input)
    const hash2 = computeAdvisoryInputHash(input)

    expect(hash1).toBe(hash2)
    expect(hash1).toHaveLength(16)
  })

  it('changes when setor_id changes', () => {
    const hash1 = computeAdvisoryInputHash(makeInput({ setor_id: 1 }))
    const hash2 = computeAdvisoryInputHash(makeInput({ setor_id: 2 }))

    expect(hash1).not.toBe(hash2)
  })

  it('changes when current_folgas change', () => {
    const hash1 = computeAdvisoryInputHash(makeInput())
    const hash2 = computeAdvisoryInputHash(
      makeInput({
        current_folgas: [
          {
            colaborador_id: 10,
            fixa: 'TER', // changed from SEG
            variavel: 'QUA',
            origem_fixa: 'COLABORADOR',
            origem_variavel: 'COLABORADOR',
          },
        ],
      }),
    )

    expect(hash1).not.toBe(hash2)
  })

  it('changes when pinned_folga_externo changes', () => {
    const hash1 = computeAdvisoryInputHash(makeInput())
    const hash2 = computeAdvisoryInputHash(
      makeInput({ pinned_folga_externo: [{ c: 0, d: 1, band: 0 }] }),
    )

    expect(hash1).not.toBe(hash2)
  })

  it('changes when date range changes', () => {
    const hash1 = computeAdvisoryInputHash(makeInput())
    const hash2 = computeAdvisoryInputHash(makeInput({ data_fim: '2026-03-15' }))

    expect(hash1).not.toBe(hash2)
  })

  it('produces hex string of 16 characters', () => {
    const hash = computeAdvisoryInputHash(makeInput())

    expect(hash).toMatch(/^[a-f0-9]{16}$/)
  })

  it('is order-independent for pinned_folga_externo', () => {
    const hash1 = computeAdvisoryInputHash(
      makeInput({
        pinned_folga_externo: [
          { c: 0, d: 0, band: 0 },
          { c: 1, d: 1, band: 0 },
        ],
      }),
    )
    const hash2 = computeAdvisoryInputHash(
      makeInput({
        pinned_folga_externo: [
          { c: 1, d: 1, band: 0 },
          { c: 0, d: 0, band: 0 },
        ],
      }),
    )

    expect(hash1).toBe(hash2)
  })
})

// ---------------------------------------------------------------------------
// convertSemanaDraftToDemanda
// ---------------------------------------------------------------------------

describe('convertSemanaDraftToDemanda', () => {
  it('converts active days with usa_padrao to padrao segmentos', () => {
    const draft: SemanaDraftAdvisory = {
      padrao: {
        hora_abertura: '07:00',
        hora_fechamento: '22:00',
        segmentos: [
          { hora_inicio: '07:00', hora_fim: '14:00', min_pessoas: 2, override: false },
          { hora_inicio: '14:00', hora_fim: '22:00', min_pessoas: 3, override: false },
        ],
      },
      dias: {
        SEG: { ativo: true, usa_padrao: true, hora_abertura: '07:00', hora_fechamento: '22:00', segmentos: [] },
        TER: { ativo: true, usa_padrao: true, hora_abertura: '07:00', hora_fechamento: '22:00', segmentos: [] },
        QUA: { ativo: false, usa_padrao: true, hora_abertura: '07:00', hora_fechamento: '22:00', segmentos: [] },
        QUI: { ativo: false, usa_padrao: true, hora_abertura: '07:00', hora_fechamento: '22:00', segmentos: [] },
        SEX: { ativo: false, usa_padrao: true, hora_abertura: '07:00', hora_fechamento: '22:00', segmentos: [] },
        SAB: { ativo: false, usa_padrao: true, hora_abertura: '07:00', hora_fechamento: '22:00', segmentos: [] },
        DOM: { ativo: false, usa_padrao: true, hora_abertura: '07:00', hora_fechamento: '22:00', segmentos: [] },
      },
    }

    const result = convertSemanaDraftToDemanda(draft)

    // SEG and TER active, each with 2 segmentos from padrao = 4 total
    expect(result).toHaveLength(4)
    expect(result[0]!.dia_semana).toBe('SEG')
    expect(result[1]!.dia_semana).toBe('SEG')
    expect(result[2]!.dia_semana).toBe('TER')
    expect(result[3]!.dia_semana).toBe('TER')
    expect(result[0]!.min_pessoas).toBe(2)
    expect(result[1]!.min_pessoas).toBe(3)
  })

  it('uses day-specific segmentos when usa_padrao is false', () => {
    const draft: SemanaDraftAdvisory = {
      padrao: {
        hora_abertura: '07:00',
        hora_fechamento: '22:00',
        segmentos: [
          { hora_inicio: '07:00', hora_fim: '22:00', min_pessoas: 1, override: false },
        ],
      },
      dias: {
        SEG: {
          ativo: true,
          usa_padrao: false,
          hora_abertura: '08:00',
          hora_fechamento: '20:00',
          segmentos: [
            { hora_inicio: '08:00', hora_fim: '20:00', min_pessoas: 5, override: true },
          ],
        },
        TER: { ativo: false, usa_padrao: true, hora_abertura: '07:00', hora_fechamento: '22:00', segmentos: [] },
        QUA: { ativo: false, usa_padrao: true, hora_abertura: '07:00', hora_fechamento: '22:00', segmentos: [] },
        QUI: { ativo: false, usa_padrao: true, hora_abertura: '07:00', hora_fechamento: '22:00', segmentos: [] },
        SEX: { ativo: false, usa_padrao: true, hora_abertura: '07:00', hora_fechamento: '22:00', segmentos: [] },
        SAB: { ativo: false, usa_padrao: true, hora_abertura: '07:00', hora_fechamento: '22:00', segmentos: [] },
        DOM: { ativo: false, usa_padrao: true, hora_abertura: '07:00', hora_fechamento: '22:00', segmentos: [] },
      },
    }

    const result = convertSemanaDraftToDemanda(draft)

    expect(result).toHaveLength(1)
    expect(result[0]!.dia_semana).toBe('SEG')
    expect(result[0]!.min_pessoas).toBe(5)
    expect(result[0]!.override).toBe(true)
  })

  it('returns empty array when no days are active', () => {
    const draft: SemanaDraftAdvisory = {
      padrao: {
        hora_abertura: '07:00',
        hora_fechamento: '22:00',
        segmentos: [],
      },
      dias: {
        SEG: { ativo: false, usa_padrao: true, hora_abertura: '07:00', hora_fechamento: '22:00', segmentos: [] },
        TER: { ativo: false, usa_padrao: true, hora_abertura: '07:00', hora_fechamento: '22:00', segmentos: [] },
        QUA: { ativo: false, usa_padrao: true, hora_abertura: '07:00', hora_fechamento: '22:00', segmentos: [] },
        QUI: { ativo: false, usa_padrao: true, hora_abertura: '07:00', hora_fechamento: '22:00', segmentos: [] },
        SEX: { ativo: false, usa_padrao: true, hora_abertura: '07:00', hora_fechamento: '22:00', segmentos: [] },
        SAB: { ativo: false, usa_padrao: true, hora_abertura: '07:00', hora_fechamento: '22:00', segmentos: [] },
        DOM: { ativo: false, usa_padrao: true, hora_abertura: '07:00', hora_fechamento: '22:00', segmentos: [] },
      },
    }

    const result = convertSemanaDraftToDemanda(draft)
    expect(result).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// normalizeAdvisoryToDiagnostics
// ---------------------------------------------------------------------------

describe('normalizeAdvisoryToDiagnostics', () => {
  it('maps PASS criteria to info severity + ALLOW gate', () => {
    const output: EscalaAdvisoryOutput = {
      status: 'CURRENT_VALID',
      normalized_diagnostics: [],
      current: {
        criteria: [
          { code: 'COBERTURA_DIA', status: 'PASS', title: 'OK', detail: 'tudo bem', source: 'PHASE1' },
        ],
      },
    }

    const result = normalizeAdvisoryToDiagnostics(output)

    expect(result).toHaveLength(1)
    expect(result[0]!.severity).toBe('info')
    expect(result[0]!.gate).toBe('ALLOW')
    expect(result[0]!.source).toBe('advisory_current')
  })

  it('maps FAIL criteria to error severity + BLOCK gate', () => {
    const output: EscalaAdvisoryOutput = {
      status: 'CURRENT_INVALID',
      normalized_diagnostics: [],
      current: {
        criteria: [
          { code: 'COBERTURA_DIA', status: 'FAIL', title: 'Falha', detail: 'cobertura ruim', source: 'PHASE1' },
        ],
      },
    }

    const result = normalizeAdvisoryToDiagnostics(output)

    expect(result).toHaveLength(1)
    expect(result[0]!.severity).toBe('error')
    expect(result[0]!.gate).toBe('BLOCK')
  })

  it('skips NOT_EVALUATED criteria', () => {
    const output: EscalaAdvisoryOutput = {
      status: 'CURRENT_VALID',
      normalized_diagnostics: [],
      current: {
        criteria: [
          { code: 'COBERTURA_DIA', status: 'PASS', title: 'OK', detail: 'ok', source: 'PHASE1' },
          { code: 'COBERTURA_FAIXA', status: 'NOT_EVALUATED', title: 'N/A', detail: 'nao avaliado', source: 'PHASE1' },
        ],
      },
    }

    const result = normalizeAdvisoryToDiagnostics(output)

    expect(result).toHaveLength(1)
    expect(result[0]!.code).toBe('COBERTURA_DIA')
  })

  it('includes proposal criteria with advisory_proposal source', () => {
    const output: EscalaAdvisoryOutput = {
      status: 'PROPOSAL_VALID',
      normalized_diagnostics: [],
      current: {
        criteria: [
          { code: 'COBERTURA_DIA', status: 'FAIL', title: 'Fail', detail: 'fail', source: 'PHASE1' },
        ],
      },
      proposal: {
        diff: [],
        criteria: [
          { code: 'COBERTURA_DIA', status: 'PASS', title: 'OK', detail: 'ok', source: 'PHASE1' },
        ],
      },
    }

    const result = normalizeAdvisoryToDiagnostics(output)

    expect(result).toHaveLength(2)
    expect(result[0]!.source).toBe('advisory_current')
    expect(result[1]!.source).toBe('advisory_proposal')
  })
})
