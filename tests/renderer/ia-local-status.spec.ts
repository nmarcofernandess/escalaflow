import { describe, expect, it } from 'vitest'
import { getLocalModelAvailability, getLocalModelCardState } from '../../src/renderer/src/lib/ia-local-status'

describe('IA local UI status', () => {
  it('keeps an in-progress backend download visible after the settings page remounts', () => {
    const state = getLocalModelCardState({
      id: 'gemma-4-e2b-it-q4',
      baixado: false,
      download_status: 'downloading',
    })

    expect(state).toMatchObject({
      label: 'Baixando',
      tone: 'installed',
    })
  })

  it('does not mark a merely downloaded model as available before validation', () => {
    const availability = getLocalModelAvailability([
      {
        id: 'gemma-4-e2b-it-q4',
        baixado: true,
        usable: false,
        requires_validation: true,
      },
    ], 'gemma-4-e2b-it-q4')

    expect(availability.hasInstalled).toBe(true)
    expect(availability.selectedInstalled).toBe(true)
    expect(availability.hasUsable).toBe(false)
    expect(availability.selectedUsable).toBe(false)
    expect(availability.reason).toContain('precisa passar em Testar conexao')
  })

  it('surfaces local load errors as an unavailable model state', () => {
    const state = getLocalModelCardState({
      id: 'gemma-4-e2b-it-q4',
      baixado: true,
      usable: false,
      load_error: 'Failed to load model',
    })

    expect(state).toMatchObject({
      label: 'Erro',
      tone: 'error',
      detail: 'Failed to load model',
    })
  })

  it('marks a validated downloaded model as ready', () => {
    const availability = getLocalModelAvailability([
      {
        id: 'gemma-4-e2b-it-q4',
        baixado: true,
        usable: true,
      },
    ], 'gemma-4-e2b-it-q4')

    expect(availability.selectedUsable).toBe(true)
    expect(getLocalModelCardState({
      id: 'gemma-4-e2b-it-q4',
      baixado: true,
      usable: true,
    }).label).toBe('Pronto')
  })
})
