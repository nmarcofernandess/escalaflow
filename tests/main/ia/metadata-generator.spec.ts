import { beforeEach, describe, expect, it, vi } from 'vitest'

// Cobre o caminho roteado de rag_metadata (gerarMetadataIa religado ao metadata-generator):
// rota local usa localLlmGenerateJson/localLlmChat; rota cloud monta a config via
// buildRouteBackedIaConfig a partir da ROTA resolvida (não do provider ativo).
const state = vi.hoisted(() => ({
  route: {
    ok: true,
    task: 'rag_metadata',
    label: 'Nome e resumo dos arquivos',
    mode: 'explicit',
    provider: 'local',
    model: 'gemma-4-e2b-it-q4',
    reason: 'ready',
    message: 'ready',
    inherited: false,
    auto_selected: false,
  } as any,
  iaConfig: {
    id: 1,
    provider: 'gemini',
    api_key: 'gemini-token',
    modelo: 'gemini-old',
    provider_configs_json: JSON.stringify({
      openrouter: { token: 'or-token', modelo: 'openrouter-old' },
      gemini: { token: 'gemini-token', modelo: 'gemini-old' },
      local: { modelo: 'gemma-4-e2b-it-q4' },
    }),
    ativo: true,
    memoria_automatica: true,
    criado_em: '2026-06-14T00:00:00.000Z',
    atualizado_em: '2026-06-14T00:00:00.000Z',
  },
  localJson: '{"titulo":"Documento Local","quando_consultar":"Quando precisar do documento local"}',
  localChatResponse: 'Texto corrigido',
  generatedText: '{"titulo":"Documento Cloud","quando_consultar":"Quando a rota cloud for usada"}',
  buildModelFactory: vi.fn((config: any) => ({
    createModel: vi.fn((modelo: string) => ({ provider: config.provider, modelo })),
    modelo: JSON.parse(config.provider_configs_json)[config.provider].modelo,
  })),
  generateText: vi.fn(async () => ({ text: state.generatedText })),
  localLlmGenerateJson: vi.fn(async () => state.localJson),
  localLlmChat: vi.fn(async () => ({ resposta: state.localChatResponse, acoes: [] })),
}))

vi.mock('../../../src/main/ia/routing', () => ({
  assertIaRouteReady: vi.fn(async () => state.route),
}))

vi.mock('../../../src/main/db/query', () => ({
  queryOne: vi.fn(async () => state.iaConfig),
}))

vi.mock('../../../src/main/ia/config', () => ({
  buildModelFactory: state.buildModelFactory,
}))

vi.mock('ai', () => ({
  generateText: state.generateText,
}))

// EscalaFlow: asLocalModelId é função LOCAL do metadata-generator (usa LOCAL_MODELS),
// não um export do local-llm. O mock só precisa expor LOCAL_MODELS + as funções locais.
vi.mock('../../../src/main/ia/local-llm', () => ({
  LOCAL_MODELS: {
    'gemma-4-e2b-it-q4': { label: 'Gemma 4 E2B IT', filename: 'x.gguf', url: 'https://x/y.gguf', size_bytes: 1, ram_minima_gb: 4, descricao: 't' },
  },
  localLlmGenerateJson: state.localLlmGenerateJson,
  localLlmChat: state.localLlmChat,
}))

describe('parseMetadataSuggestion', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('extrai, normaliza e limita o JSON de metadados de uma resposta ruidosa', async () => {
    const { parseMetadataSuggestion } = await import('../../../src/main/ia/metadata-generator')
    const longTitle = `  ${'Titulo '.repeat(30)}  `
    const longContext = `  ${'Quando consultar este documento '.repeat(20)}  `

    const parsed = parseMetadataSuggestion(`texto antes\n{"titulo":${JSON.stringify(longTitle)},"quando_consultar":${JSON.stringify(longContext)}}\ntexto depois`)

    expect(parsed.titulo.length).toBeLessThanOrEqual(120)
    expect(parsed.quando_consultar.length).toBeLessThanOrEqual(280)
    expect(parsed.titulo).toBe(parsed.titulo.trim())
    expect(parsed.quando_consultar).toBe(parsed.quando_consultar.trim())
  })

  it('rejeita não-json e campos faltantes', async () => {
    const { parseMetadataSuggestion } = await import('../../../src/main/ia/metadata-generator')

    expect(() => parseMetadataSuggestion('sem json')).toThrow(/JSON/)
    expect(() => parseMetadataSuggestion('{"titulo":"Ok","quando_consultar":"  "}')).toThrow(/titulo e quando_consultar/)
  })
})

describe('generateRagMetadata', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.route = { ...state.route, provider: 'local', model: 'gemma-4-e2b-it-q4' }
    state.iaConfig = { ...state.iaConfig, ativo: true }
    state.localJson = '{"titulo":"Documento Local","quando_consultar":"Quando precisar do documento local"}'
    state.generatedText = '{"titulo":"Documento Cloud","quando_consultar":"Quando a rota cloud for usada"}'
  })

  it('usa o modelo local roteado para os metadados em JSON', async () => {
    const { generateRagMetadata } = await import('../../../src/main/ia/metadata-generator')

    const result = await generateRagMetadata({ texto: 'conteudo', fileNameFallback: 'fallback.md' })

    expect(result).toMatchObject({
      titulo: 'Documento Local',
      quando_consultar: 'Quando precisar do documento local',
      route: expect.objectContaining({ provider: 'local', model: 'gemma-4-e2b-it-q4' }),
    })
    expect(state.localLlmGenerateJson).toHaveBeenCalledWith(expect.any(String), {
      modelId: 'gemma-4-e2b-it-q4',
      maxTokens: 512,
    })
  })

  it('monta a geração cloud a partir da ROTA resolvida, não do provider/modelo ativo', async () => {
    state.route = { ...state.route, provider: 'openrouter', model: 'openai/gpt-oss-20b:free' }
    const { generateRagMetadata } = await import('../../../src/main/ia/metadata-generator')

    const result = await generateRagMetadata({ texto: 'conteudo', fileNameFallback: 'fallback.md' })

    expect(result.titulo).toBe('Documento Cloud')
    expect(state.buildModelFactory).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'openrouter',
      modelo: 'openai/gpt-oss-20b:free',
      api_key: 'or-token',
    }))
    expect(state.generateText).toHaveBeenCalledWith(expect.objectContaining({
      model: { provider: 'openrouter', modelo: 'openai/gpt-oss-20b:free' },
    }))
  })

  it('usa os tokens cloud salvos mesmo com a linha de config inativa', async () => {
    state.route = { ...state.route, provider: 'openrouter', model: 'openai/gpt-oss-20b:free' }
    state.iaConfig = { ...state.iaConfig, ativo: false }
    const { generateRagMetadata } = await import('../../../src/main/ia/metadata-generator')

    await generateRagMetadata({ texto: 'conteudo', fileNameFallback: 'fallback.md' })

    expect(state.buildModelFactory).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'openrouter',
      modelo: 'openai/gpt-oss-20b:free',
      api_key: 'or-token',
      ativo: false,
    }))
  })
})

describe('generateRagTextCorrection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.route = { ...state.route, provider: 'local', model: 'gemma-4-e2b-it-q4' }
  })

  it('usa o chat local para correção de texto na rota local de metadados', async () => {
    const { generateRagTextCorrection } = await import('../../../src/main/ia/metadata-generator')

    const result = await generateRagTextCorrection('texto com erro')

    expect(result).toMatchObject({
      resultado: 'Texto corrigido',
      route: expect.objectContaining({ provider: 'local' }),
    })
    // EscalaFlow's localLlmChat é single-model (3 args, sem modelId override como o FlowKit).
    expect(state.localLlmChat).toHaveBeenCalledWith(
      expect.stringContaining('texto com erro'),
      [],
      expect.stringMatching(/^rag-text-correction-/),
    )
  })
})
