import { beforeEach, describe, expect, it, vi } from 'vitest'

const dbState = vi.hoisted(() => {
  const makeIaConfig = () => ({
    id: 1,
    provider: 'openrouter',
    api_key: '',
    modelo: 'openai/gpt-oss-20b:free',
    provider_configs_json: JSON.stringify({
      openrouter: { token: 'sk-or-test', modelo: 'openai/gpt-oss-20b:free' },
      gemini: { token: '', modelo: 'gemini-3.5-flash' },
      local: { modelo: 'gemma-4-e2b-it-q4' },
    }),
    ativo: true,
    memoria_automatica: true,
    criado_em: new Date().toISOString(),
    atualizado_em: new Date().toISOString(),
  })
  return {
    configValue: undefined as unknown,
    iaConfig: makeIaConfig() as ReturnType<typeof makeIaConfig>,
    makeIaConfig,
    localDownloaded: true,
    localUsable: true,
  }
})

vi.mock('../../../src/main/db/query', () => ({
  queryOne: vi.fn(async (sql: string) => {
    if (sql.includes('FROM configuracao_ia')) return dbState.iaConfig
    if (sql.includes('FROM config')) {
      return dbState.configValue === undefined ? undefined : { value: dbState.configValue }
    }
    return undefined
  }),
  execute: vi.fn(async (_sql: string, _key: string, value: string) => {
    dbState.configValue = JSON.parse(value)
    return { changes: 1 }
  }),
}))

vi.mock('../../../src/main/ia/local-llm', () => ({
  LOCAL_MODELS: {
    'gemma-4-e2b-it-q4': {
      label: 'Gemma 4 E2B IT',
      size_bytes: 3_110_000_000,
      filename: 'gemma-4-E2B-it-Q4_K_M.gguf',
      url: 'https://example.test/model.gguf',
      ram_minima_gb: 4,
      descricao: 'test',
    },
  },
  getLocalStatus: vi.fn(() => ({
    modelos: {
      'gemma-4-e2b-it-q4': {
        baixado: dbState.localDownloaded,
        usable: dbState.localDownloaded && dbState.localUsable,
        requires_validation: dbState.localDownloaded && !dbState.localUsable,
        tamanho_bytes: 3_110_000_000,
      },
    },
    modelo_carregado: false,
  })),
  // O enrichment `auto` agora delega para a rota `rag_enrichment`, e o engine de routing
  // chama validateLocalModel quando o local não está usable. Não muda o status aqui:
  // mantém o local "não validado" para o teste de fallback para a nuvem.
  validateLocalModel: vi.fn(async () => {}),
}))

vi.mock('../../../src/main/knowledge/enrichment', () => ({
  createLocalEnrichmentModel: vi.fn((modelo: string) => ({ provider: 'local', modelo, generate: vi.fn() })),
  createAiSdkEnrichmentModel: vi.fn((_createModel: unknown, modelo: string, provider: string) => ({ provider, modelo, generate: vi.fn() })),
}))

vi.mock('../../../src/main/ia/config', async () => {
  const actual = await vi.importActual<typeof import('../../../src/main/ia/config')>('../../../src/main/ia/config')
  return {
    ...actual,
    buildModelFactory: vi.fn(() => ({ createModel: vi.fn(), modelo: 'openai/gpt-oss-20b:free' })),
  }
})

describe('knowledge enrichment config', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    dbState.configValue = undefined
    dbState.localDownloaded = true
    dbState.localUsable = true
    dbState.iaConfig = dbState.makeIaConfig()
  })

  it('returns automatic enrichment model selection by default', async () => {
    const { getKnowledgeEnrichmentConfig } = await import('../../../src/main/knowledge/enrichment-config')

    await expect(getKnowledgeEnrichmentConfig()).resolves.toEqual({
      auto_enrich_after_import: false,
      provider: 'auto',
      modelo: 'auto',
      force_all_default: false,
    })
  })

  it('saves normalized enrichment config', async () => {
    const { saveKnowledgeEnrichmentConfig, getKnowledgeEnrichmentConfig } = await import('../../../src/main/knowledge/enrichment-config')

    const saved = await saveKnowledgeEnrichmentConfig({
      auto_enrich_after_import: true,
      provider: 'auto',
      modelo: 'gemma-4-e2b-it-q4',
    })

    expect(saved.auto_enrich_after_import).toBe(true)
    expect(saved.provider).toBe('auto')
    expect(saved.modelo).toBe('auto')
    await expect(getKnowledgeEnrichmentConfig()).resolves.toMatchObject({ provider: 'auto', modelo: 'auto' })
  })

  it('rejects invalid provider/model pairs before persistence', async () => {
    const { saveKnowledgeEnrichmentConfig } = await import('../../../src/main/knowledge/enrichment-config')

    await expect(saveKnowledgeEnrichmentConfig({
      provider: 'gemini',
      modelo: 'gemma-4-e2b-it-q4',
    })).rejects.toThrow('Modelo de enrichment inválido: gemini/gemma-4-e2b-it-q4.')
    expect(dbState.configValue).toBeUndefined()
  })

  it('rejects unavailable concrete providers before persistence', async () => {
    dbState.localDownloaded = true
    dbState.localUsable = false
    const { saveKnowledgeEnrichmentConfig } = await import('../../../src/main/knowledge/enrichment-config')

    await expect(saveKnowledgeEnrichmentConfig({
      provider: 'local',
      modelo: 'gemma-4-e2b-it-q4',
    })).rejects.toThrow('precisa passar em Testar conexao')
    expect(dbState.configValue).toBeUndefined()
  })

  it('lists local and cloud model availability', async () => {
    const { listKnowledgeEnrichmentModelOptions } = await import('../../../src/main/knowledge/enrichment-config')

    const models = await listKnowledgeEnrichmentModelOptions()

    expect(models).toContainEqual(expect.objectContaining({
      provider: 'local',
      modelo: 'gemma-4-e2b-it-q4',
      available: true,
    }))
    expect(models).toContainEqual(expect.objectContaining({
      provider: 'openrouter',
      available: true,
    }))
  })

  it('auto resolver prefers local when downloaded', async () => {
    const { buildKnowledgeEnrichmentModel } = await import('../../../src/main/knowledge/enrichment-config')

    const model = await buildKnowledgeEnrichmentModel({
      auto_enrich_after_import: false,
      provider: 'auto',
      modelo: 'ignored',
      force_all_default: false,
    })

    expect(model).toMatchObject({ provider: 'local', modelo: 'gemma-4-e2b-it-q4' })
  })

  it('auto resolver falls back to cloud when local is missing', async () => {
    dbState.localDownloaded = false
    const { buildKnowledgeEnrichmentModel } = await import('../../../src/main/knowledge/enrichment-config')

    const model = await buildKnowledgeEnrichmentModel({
      auto_enrich_after_import: false,
      provider: 'auto',
      modelo: 'ignored',
      force_all_default: false,
    })

    expect(model).toMatchObject({ provider: 'openrouter', modelo: 'openai/gpt-oss-20b:free' })
  })

  it('auto resolver falls back to cloud when local is downloaded but not validated', async () => {
    dbState.localDownloaded = true
    dbState.localUsable = false
    const { listKnowledgeEnrichmentModelOptions, buildKnowledgeEnrichmentModel } = await import('../../../src/main/knowledge/enrichment-config')

    const models = await listKnowledgeEnrichmentModelOptions()
    expect(models).toContainEqual(expect.objectContaining({
      provider: 'local',
      modelo: 'gemma-4-e2b-it-q4',
      available: false,
      reason: expect.stringContaining('precisa passar em Testar conexao'),
    }))

    const model = await buildKnowledgeEnrichmentModel({
      auto_enrich_after_import: false,
      provider: 'auto',
      modelo: 'ignored',
      force_all_default: false,
    })

    expect(model).toMatchObject({ provider: 'openrouter', modelo: 'openai/gpt-oss-20b:free' })
  })

  it('auto resolver herda o token do api_key legado quando o openrouter ativo nao tem token em provider_configs', async () => {
    // Token salvo só na linha ativa (configuracao_ia.api_key), não em provider_configs.openrouter.token.
    // Antes do fallback alinhado ao route-config, a rota válida ficava sem token.
    dbState.localDownloaded = false // força a rota auto para a nuvem
    dbState.iaConfig = {
      ...dbState.makeIaConfig(),
      provider: 'openrouter',
      api_key: 'sk-or-legacy',
      provider_configs_json: JSON.stringify({
        openrouter: { modelo: 'openai/gpt-oss-20b:free' }, // sem token aqui
        gemini: { token: '', modelo: 'gemini-3.5-flash' },
        local: { modelo: 'gemma-4-e2b-it-q4' },
      }),
    }
    const config = await import('../../../src/main/ia/config')
    const { buildKnowledgeEnrichmentModel } = await import('../../../src/main/knowledge/enrichment-config')

    const model = await buildKnowledgeEnrichmentModel({
      auto_enrich_after_import: false,
      provider: 'auto',
      modelo: 'ignored',
      force_all_default: false,
    })

    expect(model).toMatchObject({ provider: 'openrouter', modelo: 'openai/gpt-oss-20b:free' })
    expect(config.buildModelFactory).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'openrouter',
      api_key: 'sk-or-legacy',
    }))
  })

  it('auto resolver retorna null quando a rota rag_enrichment nao esta pronta (caller pula o enrichment)', async () => {
    // Local indisponível + nenhum token cloud → rota não-pronta. Contrato EscalaFlow: null
    // (o caller, ex. bulk-import, encerra o job sem enrichment). Diverge do throw do FlowKit.
    dbState.localDownloaded = false
    dbState.iaConfig = {
      ...dbState.makeIaConfig(),
      provider: 'openrouter',
      api_key: '',
      provider_configs_json: JSON.stringify({
        openrouter: { token: '', modelo: 'openai/gpt-oss-20b:free' },
        gemini: { token: '', modelo: 'gemini-3.5-flash' },
        local: { modelo: 'gemma-4-e2b-it-q4' },
      }),
    }
    const { buildKnowledgeEnrichmentModel } = await import('../../../src/main/knowledge/enrichment-config')

    const model = await buildKnowledgeEnrichmentModel({
      auto_enrich_after_import: false,
      provider: 'auto',
      modelo: 'ignored',
      force_all_default: false,
    })

    expect(model).toBeNull()
  })
})
