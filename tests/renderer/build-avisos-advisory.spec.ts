import { describe, it, expect } from 'vitest'
import { buildPreviewAvisos } from '../../src/renderer/src/lib/build-avisos'
import type { PreviewDiagnostic } from '../../src/shared/preview-diagnostics'

describe('buildPreviewAvisos with advisoryDiagnostics', () => {
  const baseParams = {
    previewDiagnostics: [],
    storePreviewAvisos: [],
    avisosOperacao: [],
    semTitular: 0,
    foraDoPreview: 0,
    setorNome: 'Acougue',
  }

  it('includes advisory diagnostics with advisory_ prefix in id', () => {
    const advisoryDiagnostics: PreviewDiagnostic[] = [
      {
        code: 'ADVISORY_COBERTURA_DIA',
        severity: 'error',
        gate: 'BLOCK',
        title: 'Cobertura insuficiente',
        detail: 'SEG com deficit',
        source: 'advisory_current',
      },
    ]
    const result = buildPreviewAvisos({ ...baseParams, advisoryDiagnostics })
    expect(result).toContainEqual(
      expect.objectContaining({
        id: 'advisory_ADVISORY_COBERTURA_DIA',
        nivel: 'error',
        titulo: 'Cobertura insuficiente',
      }),
    )
  })

  it('maps severity correctly: error->error, warning->warning, info->info', () => {
    const advisoryDiagnostics: PreviewDiagnostic[] = [
      { code: 'A', severity: 'error', gate: 'BLOCK', title: 'E', detail: '', source: 'advisory_current' },
      { code: 'B', severity: 'warning', gate: 'ALLOW', title: 'W', detail: '', source: 'advisory_current' },
      { code: 'C', severity: 'info', gate: 'ALLOW', title: 'I', detail: '', source: 'advisory_current' },
    ]
    const result = buildPreviewAvisos({ ...baseParams, advisoryDiagnostics })
    expect(result.find((a) => a.id === 'advisory_A')?.nivel).toBe('error')
    expect(result.find((a) => a.id === 'advisory_B')?.nivel).toBe('warning')
    expect(result.find((a) => a.id === 'advisory_C')?.nivel).toBe('info')
  })

  it('populates contexto_ia with advisory solver prefix', () => {
    const advisoryDiagnostics: PreviewDiagnostic[] = [
      {
        code: 'X',
        severity: 'info',
        gate: 'ALLOW',
        title: 'Test',
        detail: 'Detail',
        source: 'advisory_proposal',
      },
    ]
    const result = buildPreviewAvisos({ ...baseParams, advisoryDiagnostics })
    const aviso = result.find((a) => a.id === 'advisory_X')
    expect(aviso?.contexto_ia).toContain('advisory solver')
    expect(aviso?.contexto_ia).toContain('Test')
    expect(aviso?.contexto_ia).toContain('Detail')
  })

  it('deduplicates advisory with same code', () => {
    const advisoryDiagnostics: PreviewDiagnostic[] = [
      { code: 'DUP', severity: 'info', gate: 'ALLOW', title: 'First', detail: '', source: 'advisory_current' },
      {
        code: 'DUP',
        severity: 'error',
        gate: 'BLOCK',
        title: 'Second',
        detail: '',
        source: 'advisory_current',
      },
    ]
    const result = buildPreviewAvisos({ ...baseParams, advisoryDiagnostics })
    const dups = result.filter((a) => a.id === 'advisory_DUP')
    // Map dedup keeps last occurrence
    expect(dups).toHaveLength(1)
  })

  it('returns empty when advisoryDiagnostics is undefined', () => {
    const result = buildPreviewAvisos(baseParams)
    const advisoryAvisos = result.filter((a) => a.id.startsWith('advisory_'))
    expect(advisoryAvisos).toHaveLength(0)
  })

  it('mixes advisory with other sources without conflict', () => {
    const advisoryDiagnostics: PreviewDiagnostic[] = [
      {
        code: 'ADV1',
        severity: 'error',
        gate: 'BLOCK',
        title: 'Advisory',
        detail: '',
        source: 'advisory_current',
      },
    ]
    const previewDiagnostics: PreviewDiagnostic[] = [
      {
        code: 'PREV1',
        severity: 'warning',
        gate: 'ALLOW',
        title: 'Preview',
        detail: '',
        source: 'capacity',
      },
    ]
    const result = buildPreviewAvisos({ ...baseParams, previewDiagnostics, advisoryDiagnostics })
    expect(result.find((a) => a.id === 'advisory_ADV1')).toBeDefined()
    expect(result.find((a) => a.id === 'diagnostic_PREV1')).toBeDefined()
  })
})
