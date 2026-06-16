import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AiRouteResolution } from '../../../src/shared/ia-routing-contract'
import type { IaConfiguracao } from '../../../src/shared/types'

// Prova central do Plano 1: o runtime de chat (iaEnviarMensagem/Stream) gera pela ROTA
// resolvida, não pelo provider ATIVO de configuracao_ia. routing é mockado (a rota é
// dada), mas route-config (buildRouteBackedIaConfig/resolveProviderApiKey) roda REAL —
// é ele quem extrai o token correto do provider_configs_json a partir da rota.
//
// Adaptação EscalaFlow: localLlmChat é single-model com 6 args (msg, hist, streamId,
// contexto, conversa_id, anexos) — sem o 7º { modelId } do FlowKit.
const mocks = vi.hoisted(() => {
  const localLlmChat = vi.fn(async () => ({ resposta: 'local ok', acoes: [] }))
  const googleModel = vi.fn((modelo: string) => ({ provider: 'gemini', modelo }))
  const openrouterModel = vi.fn((modelo: string) => ({ provider: 'openrouter', modelo }))
  const route: AiRouteResolution = {
    ok: true,
    task: 'chat_ui',
    label: 'Chat do app',
    mode: 'explicit',
    provider: 'local',
    model: 'gemma-4-e2b-it-q4',
    reason: 'ready',
    message: 'IA local pronta.',
    inherited: false,
    auto_selected: false,
  }

  return {
    route,
    queryOne: vi.fn(),
    assertIaRouteReady: vi.fn(async () => route),
    localLlmChat,
    createGoogleGenerativeAI: vi.fn(() => googleModel),
    createOpenRouter: vi.fn(() => openrouterModel),
    googleModel,
    openrouterModel,
  }
})

vi.mock('../../../src/main/db/query', () => ({
  queryOne: mocks.queryOne,
}))

vi.mock('../../../src/main/ia/routing', () => ({
  assertIaRouteReady: mocks.assertIaRouteReady,
}))

vi.mock('../../../src/main/ia/local-llm', () => ({
  localLlmChat: mocks.localLlmChat,
  asLocalModelId: (value: string) => value,
}))

vi.mock('@ai-sdk/google', () => ({
  createGoogleGenerativeAI: mocks.createGoogleGenerativeAI,
}))

vi.mock('@openrouter/ai-sdk-provider', () => ({
  createOpenRouter: mocks.createOpenRouter,
}))

vi.mock('ai', () => ({
  generateText: vi.fn(),
  streamText: vi.fn(),
  stepCountIs: vi.fn((count: number) => ({ type: 'step-count', count })),
  wrapLanguageModel: vi.fn(({ model }: { model: unknown }) => model),
}))

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
  app: { getPath: vi.fn(() => '/tmp') },
  default: { BrowserWindow: { getAllWindows: vi.fn(() => []) }, app: { getPath: vi.fn(() => '/tmp') } },
}))

vi.mock('../../../src/main/ia/discovery', () => ({
  buildContextBundle: vi.fn(async () => null),
  renderContextBriefing: vi.fn(() => ''),
  buildContextBriefing: vi.fn(async () => ''),
}))

vi.mock('../../../src/main/ia/session-processor', () => ({
  maybeCompact: vi.fn(async () => null),
}))

vi.mock('../../../src/main/ia/tools', () => ({
  getVercelAiFamilyTools: vi.fn(() => ({})),
}))

vi.mock('../../../src/main/config/app-config', () => ({
  isGeminiCloudApiEnabled: vi.fn(() => true),
}))

function activeGeminiConfig(): IaConfiguracao {
  return {
    id: 1,
    provider: 'gemini',
    api_key: 'gemini-active-token',
    modelo: 'gemini-3.5-flash',
    provider_configs_json: JSON.stringify({
      gemini: { token: 'gemini-provider-token', modelo: 'gemini-3.5-flash' },
      local: { modelo: 'gemma-4-e2b-it-q4' },
      openrouter: { token: 'or-token', modelo: 'openai/gpt-oss-20b:free' },
    }),
    ativo: true,
    memoria_automatica: true,
    criado_em: new Date(0).toISOString(),
    atualizado_em: new Date(0).toISOString(),
  } as IaConfiguracao
}

describe('ia cliente route-backed runtime selection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.queryOne.mockResolvedValue(activeGeminiConfig())
    mocks.assertIaRouteReady.mockResolvedValue({
      ok: true,
      task: 'chat_ui',
      label: 'Chat do app',
      mode: 'explicit',
      provider: 'local',
      model: 'gemma-4-e2b-it-q4',
      reason: 'ready',
      message: 'IA local pronta.',
      inherited: false,
      auto_selected: false,
    })
  })

  it('usa a rota local resolvida mesmo com a config ativa em Gemini', async () => {
    const { iaEnviarMensagem } = await import('../../../src/main/ia/cliente')

    const result = await iaEnviarMensagem('oi', [], undefined, undefined, undefined, { task: 'chat_ui' })

    expect(result).toEqual({ resposta: 'local ok', acoes: [] })
    expect(mocks.assertIaRouteReady).toHaveBeenCalledWith('chat_ui', { validateLocal: true })
    expect(mocks.localLlmChat).toHaveBeenCalledWith('oi', [], 'non-stream', undefined, undefined, undefined)
    expect(mocks.createGoogleGenerativeAI).not.toHaveBeenCalled()
    expect(mocks.createOpenRouter).not.toHaveBeenCalled()
  })

  it('usa a rota local pronta mesmo sem nenhuma linha de configuracao_ia legada', async () => {
    mocks.queryOne.mockResolvedValue(null)
    const { iaEnviarMensagemStream } = await import('../../../src/main/ia/cliente')

    const result = await iaEnviarMensagemStream('oi', [], 'stream-local', undefined, undefined, undefined, { task: 'chat_ui' })

    expect(result).toEqual({ resposta: 'local ok', acoes: [] })
    expect(mocks.localLlmChat).toHaveBeenCalledWith('oi', [], 'stream-local', undefined, undefined, undefined)
    expect(mocks.createGoogleGenerativeAI).not.toHaveBeenCalled()
    expect(mocks.createOpenRouter).not.toHaveBeenCalled()
  })

  it('usa a rota cloud resolvida (com o token dela) mesmo com a config ativa em local', async () => {
    // Config ativa é local; a rota resolve OpenRouter — a geração deve seguir a ROTA,
    // e o token sai do provider_configs_json.openrouter via buildRouteBackedIaConfig real.
    mocks.queryOne.mockResolvedValue({
      ...activeGeminiConfig(),
      provider: 'local',
      api_key: '',
      modelo: 'gemma-4-e2b-it-q4',
    })
    mocks.assertIaRouteReady.mockResolvedValueOnce({
      ok: true,
      task: 'cli_chat',
      label: 'Chat no Terminal',
      mode: 'explicit',
      provider: 'openrouter',
      model: 'openai/gpt-oss-20b:free',
      reason: 'ready',
      message: 'OpenRouter pronto.',
      inherited: false,
      auto_selected: false,
    })
    const { iaEnviarMensagem } = await import('../../../src/main/ia/cliente')

    // generateText está mockado como undefined → a geração lança DEPOIS que o provider é
    // construído, o que basta pra provar que o provider/token da rota venceu o config local.
    await expect(
      iaEnviarMensagem('oi', [], undefined, undefined, undefined, { task: 'cli_chat' }),
    ).rejects.toThrow()

    expect(mocks.createOpenRouter).toHaveBeenCalledWith({ apiKey: 'or-token' })
    expect(mocks.localLlmChat).not.toHaveBeenCalled()
    expect(mocks.createGoogleGenerativeAI).not.toHaveBeenCalled()
  })
})
