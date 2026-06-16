import { describe, expect, it } from 'vitest'
import {
  AI_ROUTE_PROVIDER_MODEL_OPTIONS,
  AI_ROUTE_TASKS,
  AI_ROUTE_TASK_LABELS,
  DEFAULT_IA_ROUTING_CONFIG,
  IA_ROUTING_CONFIG_KEY,
  normalizeIaRoutingConfig,
  type AiRouteProvider,
  type AiRouteTask,
} from '../../../src/shared/ia-routing-contract'
import { isValidModelForProvider } from '../../../src/main/ia/config'

describe('ia-routing contract (EscalaFlow)', () => {
  it('lista as 4 tasks reais do EscalaFlow — sem maia_command', () => {
    expect([...AI_ROUTE_TASKS]).toEqual(['chat_ui', 'cli_chat', 'rag_metadata', 'rag_enrichment'])
    expect((AI_ROUTE_TASKS as readonly string[]).includes('maia_command')).toBe(false)
  })

  it('tem label para cada task e key de config estável', () => {
    expect(IA_ROUTING_CONFIG_KEY).toBe('ia.routing')
    for (const task of AI_ROUTE_TASKS) {
      expect(AI_ROUTE_TASK_LABELS[task as AiRouteTask].length).toBeGreaterThan(3)
    }
  })

  it('default herda a chave mestra para chat/cli (provider local Gemma 4)', () => {
    expect(DEFAULT_IA_ROUTING_CONFIG.global).toEqual({ provider: 'local', modelo: 'gemma-4-e2b-it-q4' })
    expect(DEFAULT_IA_ROUTING_CONFIG.tasks.chat_ui).toEqual({ mode: 'inherit' })
    expect(DEFAULT_IA_ROUTING_CONFIG.tasks.cli_chat).toEqual({ mode: 'inherit' })
    expect(DEFAULT_IA_ROUTING_CONFIG.tasks.rag_enrichment).toEqual({ mode: 'auto' })
  })

  it('normaliza DB antigo/sujo para o default, preservando overrides válidos', () => {
    expect(normalizeIaRoutingConfig(null)).toEqual(DEFAULT_IA_ROUTING_CONFIG)
    expect(normalizeIaRoutingConfig('lixo-não-json')).toEqual(DEFAULT_IA_ROUTING_CONFIG)

    const custom = normalizeIaRoutingConfig({
      version: 1,
      global: { provider: 'gemini', modelo: 'gemini-3.5-flash' },
      tasks: { chat_ui: { mode: 'explicit', provider: 'openrouter', modelo: 'openrouter/free' }, lixo: { mode: 'x' } },
    })
    expect(custom.global).toEqual({ provider: 'gemini', modelo: 'gemini-3.5-flash' })
    expect(custom.tasks.chat_ui).toEqual({ mode: 'explicit', provider: 'openrouter', modelo: 'openrouter/free' })
    // task ausente cai no default; chave inválida é ignorada
    expect(custom.tasks.rag_enrichment).toEqual({ mode: 'auto' })
    expect(Object.keys(custom.tasks).sort()).toEqual([...AI_ROUTE_TASKS].sort())
  })

  it('aceita um JSON string como input (formato do JSONB)', () => {
    const parsed = normalizeIaRoutingConfig(JSON.stringify(DEFAULT_IA_ROUTING_CONFIG))
    expect(parsed).toEqual(DEFAULT_IA_ROUTING_CONFIG)
  })

  it('toda opção de modelo ofertada no routing passa no validador de runtime (anti-drift)', () => {
    // Guard contra o drift onde a UI oferece um modelo que checkCloudRoute rejeita
    // como unsupported_model. Cada (provider, modelo) ofertado tem que ser válido.
    for (const provider of Object.keys(AI_ROUTE_PROVIDER_MODEL_OPTIONS) as AiRouteProvider[]) {
      for (const option of AI_ROUTE_PROVIDER_MODEL_OPTIONS[provider]) {
        expect(
          isValidModelForProvider(option.value, provider),
          `${provider}/${option.value} é ofertado no routing mas reprova em isValidModelForProvider`,
        ).toBe(true)
      }
    }
  })
})
