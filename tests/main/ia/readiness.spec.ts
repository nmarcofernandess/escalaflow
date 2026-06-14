import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  config: null as any,
  localStatus: {
    baixado: false,
    usable: false,
    requires_validation: false,
    load_error: undefined as string | undefined,
    tamanho_bytes: 3_110_000_000,
  },
  validateShouldFail: false,
  validateCalls: 0,
}))

vi.mock('../../../src/main/db/query', () => ({
  queryOne: vi.fn(async () => state.config),
}))

vi.mock('../../../src/main/config/app-config', () => ({
  isGeminiCloudApiEnabled: vi.fn(() => true),
}))

vi.mock('../../../src/main/ia/local-llm', () => ({
  LOCAL_MODELS: {
    'gemma-4-e2b-it-q4': {
      label: 'Gemma 4 E2B IT',
      filename: 'gemma-4-E2B-it-Q4_K_M.gguf',
      url: 'https://example.test/model.gguf',
      size_bytes: 3_110_000_000,
      ram_minima_gb: 4,
      descricao: 'test',
    },
  },
  getLocalStatus: vi.fn(() => ({
    modelos: {
      'gemma-4-e2b-it-q4': { ...state.localStatus },
    },
    modelo_carregado: state.localStatus.usable,
  })),
  validateLocalModel: vi.fn(async () => {
    state.validateCalls++
    if (state.validateShouldFail) {
      state.localStatus = {
        ...state.localStatus,
        usable: false,
        requires_validation: false,
        load_error: 'Failed to load model',
      }
      throw new Error('Failed to load model')
    }
    state.localStatus = {
      ...state.localStatus,
      usable: true,
      requires_validation: false,
      load_error: undefined,
    }
    return state.localStatus
  }),
}))

function iaConfig(overrides: Partial<any> = {}) {
  return {
    id: 1,
    provider: 'local',
    api_key: '',
    modelo: 'gemma-4-e2b-it-q4',
    provider_configs_json: JSON.stringify({
      local: { modelo: 'gemma-4-e2b-it-q4' },
      openrouter: { token: '', modelo: 'openai/gpt-oss-20b:free' },
      gemini: { token: '', modelo: 'gemini-3.5-flash' },
    }),
    ativo: false,
    memoria_automatica: true,
    criado_em: '2026-06-12T00:00:00.000Z',
    atualizado_em: '2026-06-12T00:00:00.000Z',
    ...overrides,
  }
}

describe('IA chat readiness', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.config = null
    state.localStatus = {
      baixado: false,
      usable: false,
      requires_validation: false,
      load_error: undefined,
      tamanho_bytes: 3_110_000_000,
    }
    state.validateShouldFail = false
    state.validateCalls = 0
  })

  it('requires provider configuration before chat', async () => {
    const { getIaChatReadiness } = await import('../../../src/main/ia/readiness')

    await expect(getIaChatReadiness()).resolves.toMatchObject({
      ok: false,
      reason: 'configure_provider',
    })
  })

  it('does not treat a downloaded local model as ready until validated', async () => {
    state.config = iaConfig()
    state.localStatus = {
      baixado: true,
      usable: false,
      requires_validation: true,
      load_error: undefined,
      tamanho_bytes: 3_110_000_000,
    }
    const { getIaChatReadiness } = await import('../../../src/main/ia/readiness')

    await expect(getIaChatReadiness()).resolves.toMatchObject({
      ok: false,
      provider: 'local',
      model: 'gemma-4-e2b-it-q4',
      reason: 'validate_local_model',
    })
    expect(state.validateCalls).toBe(0)
  })

  it('surfaces local model download progress before asking to launch chat', async () => {
    state.config = iaConfig()
    state.localStatus = {
      baixado: false,
      usable: false,
      requires_validation: false,
      load_error: undefined,
      tamanho_bytes: 3_110_000_000,
      download_status: 'downloading',
      download_progresso: 0.42,
    }
    const { getIaChatReadiness } = await import('../../../src/main/ia/readiness')

    await expect(getIaChatReadiness()).resolves.toMatchObject({
      ok: false,
      provider: 'local',
      model: 'gemma-4-e2b-it-q4',
      reason: 'download_local_model_downloading',
    })
    expect(state.validateCalls).toBe(0)
  })

  it('surfaces cancelled local model downloads as a retry state', async () => {
    state.config = iaConfig()
    state.localStatus = {
      baixado: false,
      usable: false,
      requires_validation: false,
      load_error: undefined,
      tamanho_bytes: 3_110_000_000,
      download_status: 'cancelled',
      download_progresso: 0.19,
    }
    const { getIaChatReadiness } = await import('../../../src/main/ia/readiness')

    await expect(getIaChatReadiness()).resolves.toMatchObject({
      ok: false,
      provider: 'local',
      model: 'gemma-4-e2b-it-q4',
      reason: 'download_local_model_cancelled',
    })
    expect(state.validateCalls).toBe(0)
  })

  it('can validate a downloaded local model when explicitly requested', async () => {
    state.config = iaConfig()
    state.localStatus = {
      baixado: true,
      usable: false,
      requires_validation: true,
      load_error: undefined,
      tamanho_bytes: 3_110_000_000,
    }
    const { getIaChatReadiness } = await import('../../../src/main/ia/readiness')

    await expect(getIaChatReadiness({ validateLocal: true })).resolves.toMatchObject({
      ok: true,
      reason: 'ready',
    })
    expect(state.validateCalls).toBe(1)
  })

  it('surfaces local load failures as a hard readiness error', async () => {
    state.config = iaConfig()
    state.validateShouldFail = true
    state.localStatus = {
      baixado: true,
      usable: false,
      requires_validation: true,
      load_error: undefined,
      tamanho_bytes: 3_110_000_000,
    }
    const { getIaChatReadiness } = await import('../../../src/main/ia/readiness')

    await expect(getIaChatReadiness({ validateLocal: true })).resolves.toMatchObject({
      ok: false,
      reason: 'local_model_error',
      message: expect.stringContaining('Failed to load model'),
    })
  })

  it('flags stale local model configuration instead of asking for an impossible download', async () => {
    state.config = iaConfig({
      modelo: 'qwen3.5-9b',
      provider_configs_json: JSON.stringify({
        local: { modelo: 'qwen3.5-9b' },
      }),
    })
    const { getIaChatReadiness } = await import('../../../src/main/ia/readiness')

    await expect(getIaChatReadiness()).resolves.toMatchObject({
      ok: false,
      provider: 'local',
      model: 'qwen3.5-9b',
      reason: 'invalid_local_model_config',
      message: expect.stringContaining('não existe no catálogo atual'),
    })
    expect(state.validateCalls).toBe(0)
  })

  it('requires cloud token for OpenRouter chat', async () => {
    state.config = iaConfig({
      provider: 'openrouter',
      modelo: 'openai/gpt-oss-20b:free',
    })
    const { getIaChatReadiness } = await import('../../../src/main/ia/readiness')

    await expect(getIaChatReadiness()).resolves.toMatchObject({
      ok: false,
      provider: 'openrouter',
      reason: 'configure_cloud_token',
    })
  })

  it('normalizes removed Gemini preview models before reporting readiness', async () => {
    state.config = iaConfig({
      provider: 'gemini',
      api_key: 'gemini-key',
      modelo: 'gemini-3-flash-preview',
      provider_configs_json: JSON.stringify({
        gemini: { token: 'gemini-key', modelo: 'gemini-3-flash-preview' },
      }),
    })
    const { getIaChatReadiness } = await import('../../../src/main/ia/readiness')

    await expect(getIaChatReadiness()).resolves.toMatchObject({
      ok: true,
      provider: 'gemini',
      model: 'gemini-3.1-flash-lite',
      reason: 'ready',
    })
  })
})
