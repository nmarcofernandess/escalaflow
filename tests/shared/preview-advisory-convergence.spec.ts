import { describe, it, expect } from 'vitest'
import { runPreviewMultiPass } from '../../src/shared/preview-multi-pass'
import { buildPreviewAvisos } from '../../src/renderer/src/lib/build-avisos'
import type { PreviewDiagnostic } from '../../src/shared/preview-diagnostics'

describe('preview + advisory convergence', () => {
  it('advisory diagnostics coexistem com preview diagnostics (sem dedup por ADVISORY_ prefix)', () => {
    // Advisory now uses plain codes (VALIDACAO_INVIAVEL etc), not ADVISORY_ prefix.
    // Both preview and advisory entries are shown independently.
    const previewDiagnostics: PreviewDiagnostic[] = [
      { code: 'CAPACIDADE_DIARIA_INSUFICIENTE', severity: 'error', gate: 'BLOCK', title: 'Preview: deficit', detail: 'SEG', source: 'capacity' },
    ]
    const advisoryDiagnostics: PreviewDiagnostic[] = [
      { code: 'VALIDACAO_INVIAVEL', severity: 'error', gate: 'BLOCK', title: 'Advisory: inviavel', detail: 'Restricoes conflitantes', source: 'advisory_current' },
    ]

    const avisos = buildPreviewAvisos({
      previewDiagnostics,
      storePreviewAvisos: [],
      avisosOperacao: [],
      semTitular: 0,
      foraDoPreview: 0,
      advisoryDiagnostics,
    })

    const previewAviso = avisos.find((a) => a.id === 'diagnostic_CAPACIDADE_DIARIA_INSUFICIENTE')
    const advisoryAviso = avisos.find((a) => a.id === 'advisory_VALIDACAO_INVIAVEL')

    // Both survive — no automatic dedup by ADVISORY_ prefix stripping
    expect(previewAviso).toBeDefined()
    expect(advisoryAviso).toBeDefined()
    expect(advisoryAviso!.nivel).toBe('error')
  })

  it('preview diagnostics sobrevivem quando nao ha advisory', () => {
    const previewDiagnostics: PreviewDiagnostic[] = [
      { code: 'CAPACIDADE_DIARIA_INSUFICIENTE', severity: 'error', gate: 'BLOCK', title: 'Deficit', detail: 'SEG', source: 'capacity' },
    ]

    const avisos = buildPreviewAvisos({
      previewDiagnostics,
      storePreviewAvisos: [],
      avisosOperacao: [],
      semTitular: 0,
      foraDoPreview: 0,
    })

    expect(avisos.find((a) => a.id === 'diagnostic_CAPACIDADE_DIARIA_INSUFICIENTE')).toBeDefined()
  })

  it('multi-pass SOFT warning nao bloqueia geracao', () => {
    // N=6, K=4 => strict fails (K > N/2=3), but SOFT rules allow relaxation
    const result = runPreviewMultiPass({
      fase1Input: { num_postos: 6, trabalham_domingo: 4 },
      participants: Array.from({ length: 6 }, (_, i) => ({
        id: i + 1, nome: `P${i}`, sexo: 'M' as const,
      })),
      demandaPorDia: [4, 4, 4, 4, 4, 3, 4],
      trabalhamDomingo: 4,
      rules: { H3_DOM_MAX_CONSEC_M: 'SOFT', H3_DOM_MAX_CONSEC_F: 'SOFT' },
    })

    expect(result.output.sucesso).toBe(true)
    expect(result.relaxed).toBe(true)
    const blocks = result.diagnostics.filter((d) => d.gate === 'BLOCK')
    expect(blocks).toHaveLength(0)
  })

  it('multi-pass HARD violation bloqueia geracao', () => {
    // N=6, K=4 => strict fails (K > N/2=3), HARD rules prevent relaxation
    const result = runPreviewMultiPass({
      fase1Input: { num_postos: 6, trabalham_domingo: 4 },
      participants: Array.from({ length: 6 }, (_, i) => ({
        id: i + 1, nome: `P${i}`, sexo: 'M' as const,
      })),
      demandaPorDia: [4, 4, 4, 4, 4, 3, 4],
      trabalhamDomingo: 4,
      rules: { H3_DOM_MAX_CONSEC_M: 'HARD', H3_DOM_MAX_CONSEC_F: 'HARD' },
    })

    expect(result.output.sucesso).toBe(false)
    expect(result.relaxed).toBe(false)
  })
})
