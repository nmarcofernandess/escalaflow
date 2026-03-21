import { describe, it, expect } from 'vitest'
import {
  mapPreviewDiagnosticToAviso,
  humanizarOperacao,
  humanizarTexto,
} from '../../src/renderer/src/lib/humanizar-operacao'
import type { PreviewDiagnostic } from '../../src/shared/preview-diagnostics'
import type { OperationFeedback } from '../../src/renderer/src/lib/humanizar-operacao'

describe('humanizarTexto', () => {
  it('replaces Slot with Faixa', () => {
    expect(humanizarTexto('Slot 12:00-13:00 sem cobertura')).toContain('Faixa')
    expect(humanizarTexto('Slot 12:00-13:00 sem cobertura')).not.toContain('Slot')
  })

  it('replaces disponiveis=X, minimo requerido=Y', () => {
    const result = humanizarTexto('disponiveis=2, minimo requerido=3')
    expect(result).toContain('2 pessoas disponíveis')
    expect(result).toContain('demanda pede 3')
    expect(result).not.toContain('disponiveis=')
  })

  it('replaces INFEASIBLE', () => {
    expect(humanizarTexto('model INFEASIBLE')).toContain('inviável')
    expect(humanizarTexto('model INFEASIBLE')).not.toContain('INFEASIBLE')
  })
})

describe('mapPreviewDiagnosticToAviso', () => {
  it('maps a warning diagnostic to Aviso', () => {
    const diag: PreviewDiagnostic = {
      code: 'CAPACIDADE_DIARIA_INSUFICIENTE',
      severity: 'warning',
      gate: 'ALLOW',
      title: 'Cobertura insuficiente',
      detail: 'Terca: disponiveis=2, minimo requerido=3',
      source: 'capacity',
    }
    const aviso = mapPreviewDiagnosticToAviso(diag)
    expect(aviso.nivel).toBe('warning')
    expect(aviso.titulo).toBe('Cobertura insuficiente')
    expect(aviso.descricao).not.toContain('disponiveis=')
    expect(aviso.id).toContain('CAPACIDADE_DIARIA_INSUFICIENTE')
  })
})

describe('humanizarOperacao', () => {
  it('returns empty array for null', () => {
    expect(humanizarOperacao(null)).toEqual([])
  })

  it('translates INFEASIBLE to human-readable message', () => {
    const feedback: OperationFeedback = {
      type: 'INFEASIBLE',
      message: 'INFEASIBLE: model returned status INFEASIBLE after 30s',
      details: ['Reduza demanda', 'Adicione colaboradores'],
    }
    const avisos = humanizarOperacao(feedback)
    expect(avisos.length).toBe(1)
    expect(avisos[0].descricao).not.toContain('INFEASIBLE')
    expect(avisos[0].nivel).toBe('error')
  })

  it('translates PREFLIGHT_BLOCK', () => {
    const feedback: OperationFeedback = {
      type: 'PREFLIGHT_BLOCK',
      message: 'Preflight blocked: insufficient capacity',
    }
    const avisos = humanizarOperacao(feedback)
    expect(avisos[0].nivel).toBe('error')
    expect(avisos[0].descricao).not.toContain('Preflight')
  })
})
