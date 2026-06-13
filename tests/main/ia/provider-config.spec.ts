import { describe, expect, it } from 'vitest'
import { PROVIDER_DEFAULTS, resolveModel } from '../../../src/main/ia/config'
import type { IaConfiguracao } from '../../../src/shared/types'

function config(overrides: Partial<IaConfiguracao> = {}): IaConfiguracao {
  return {
    id: 1,
    provider: 'gemini',
    api_key: 'test-key',
    modelo: 'gemini-3.5-flash',
    provider_configs_json: JSON.stringify({
      gemini: { modelo: 'gemini-3.5-flash' },
    }),
    ativo: true,
    memoria_automatica: true,
    criado_em: new Date().toISOString(),
    atualizado_em: new Date().toISOString(),
    ...overrides,
  }
}

describe('IA provider config', () => {
  it('keeps Gemini default on the current approved lite model', () => {
    expect(PROVIDER_DEFAULTS.gemini).toBe('gemini-3.1-flash-lite')
  })

  it('resolves the configured Gemini 3.5 Flash model without falling back to preview ids', () => {
    expect(resolveModel(config(), 'gemini')).toBe('gemini-3.5-flash')
  })

  it('falls back to Gemini 3.1 Flash Lite when a stale namespaced model contaminates Gemini config', () => {
    expect(resolveModel(config({
      modelo: 'google/gemini-2.5-flash',
      provider_configs_json: JSON.stringify({ gemini: { modelo: 'google/gemini-2.5-flash' } }),
    }), 'gemini')).toBe('gemini-3.1-flash-lite')
  })

  it('falls back to Gemini 3.1 Flash Lite when a removed preview id is still stored', () => {
    expect(resolveModel(config({
      modelo: 'gemini-3-flash-preview',
      provider_configs_json: JSON.stringify({ gemini: { modelo: 'gemini-3-flash-preview' } }),
    }), 'gemini')).toBe('gemini-3.1-flash-lite')
  })
})
