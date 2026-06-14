import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  config: null as any,
  chatReadiness: {
    ok: false,
    provider: null as 'gemini' | 'openrouter' | 'local' | null,
    model: null as string | null,
    reason: 'configure_provider',
    message: 'Configure provider e modelo.',
    action: 'Configure a IA.',
  },
  cliAvailable: true,
  tools: [{ name: 'terminal.exec' }],
}))

vi.mock('../../../src/main/db/query', () => ({
  queryOne: vi.fn(async () => state.config),
}))

vi.mock('../../../src/main/ia/readiness', () => ({
  getIaChatReadiness: vi.fn(async () => state.chatReadiness),
}))

vi.mock('../../../src/main/ia/tools', () => ({
  get IA_TOOLS() {
    return state.tools
  },
}))

vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
  return {
    ...actual,
    stat: vi.fn(async (target: string | URL) => {
      const value = String(target)
      if (value.endsWith('src/cli/index.ts') || value.endsWith('out/cli/index.js')) {
        if (!state.cliAvailable) throw new Error(`ENOENT: ${value}`)
        return {
          isFile: () => true,
          isDirectory: () => false,
        }
      }
      return {
        isFile: () => false,
        isDirectory: () => true,
      }
    }),
  }
})

function cloudConfig() {
  return {
    id: 1,
    provider: 'gemini',
    api_key: 'test-key',
    modelo: 'gemini-3.5-flash',
    provider_configs_json: JSON.stringify({
      gemini: { token: 'test-key', modelo: 'gemini-3.5-flash' },
    }),
    ativo: true,
    memoria_automatica: true,
    criado_em: '2026-06-14T00:00:00.000Z',
    atualizado_em: '2026-06-14T00:00:00.000Z',
  }
}

describe('AI terminal runtime readiness', () => {
  beforeEach(() => {
    state.config = null
    state.chatReadiness = {
      ok: false,
      provider: null,
      model: null,
      reason: 'configure_provider',
      message: 'Configure provider e modelo.',
      action: 'Configure a IA.',
    }
    state.cliAvailable = true
    state.tools = [{ name: 'terminal.exec' }]
  })

  it('maps missing IA configuration to configMissing', async () => {
    const { getAiTerminalReadiness } = await import('../../../src/main/ia/runtime-readiness')

    await expect(getAiTerminalReadiness({ cwd: '/tmp/Escala Flow' })).resolves.toMatchObject({
      ok: false,
      code: 'configMissing',
      command: expect.stringContaining('npm --prefix'),
      cwd: '/tmp/Escala Flow',
      runtime: {
        provider: null,
        model: null,
      },
    })
  })

  it('maps missing cloud credentials to credentialMissing', async () => {
    state.config = cloudConfig()
    state.chatReadiness = {
      ok: false,
      provider: 'gemini',
      model: 'gemini-3.5-flash',
      reason: 'configure_cloud_token',
      message: 'Informe a API key/token do provider ativo.',
      action: 'Abra Configuracoes.',
    }
    const { getAiTerminalReadiness } = await import('../../../src/main/ia/runtime-readiness')

    await expect(getAiTerminalReadiness()).resolves.toMatchObject({
      ok: false,
      code: 'credentialMissing',
      runtime: {
        provider: 'gemini',
        model: 'gemini-3.5-flash',
      },
    })
  })

  it.each([
    ['download_local_model', 'modelDownloadRequired'],
    ['download_local_model_downloading', 'modelDownloading'],
    ['download_local_model_cancelled', 'modelDownloadCanceled'],
    ['local_model_error', 'modelLoadingFailed'],
    ['invalid_local_model_config', 'modelCorrupt'],
  ])('maps chat reason %s to terminal readiness %s', async (reason, code) => {
    state.config = cloudConfig()
    state.chatReadiness = {
      ok: false,
      provider: 'local',
      model: 'gemma-4-e2b-it-q4',
      reason,
      message: `blocked: ${reason}`,
      action: 'Corrigir IA.',
    }
    const { getAiTerminalReadiness } = await import('../../../src/main/ia/runtime-readiness')

    await expect(getAiTerminalReadiness()).resolves.toMatchObject({
      ok: false,
      code,
      blocksLaunch: true,
      runtime: {
        provider: 'local',
        model: 'gemma-4-e2b-it-q4',
      },
    })
  })

  it('blocks before opening when the CLI is missing', async () => {
    state.config = cloudConfig()
    state.cliAvailable = false
    const { getAiTerminalReadiness } = await import('../../../src/main/ia/runtime-readiness')

    await expect(getAiTerminalReadiness()).resolves.toMatchObject({
      ok: false,
      code: 'cliMissing',
      blocksLaunch: true,
    })
  })

  it('returns ready with provider, model, command and tool count', async () => {
    state.config = cloudConfig()
    state.chatReadiness = {
      ok: true,
      provider: 'gemini',
      model: 'gemini-3.5-flash',
      reason: 'ready',
      message: 'IA pronta.',
      action: 'Abrir Terminal.',
    }
    const { getAiTerminalReadiness } = await import('../../../src/main/ia/runtime-readiness')

    await expect(getAiTerminalReadiness({ cwd: '/tmp/Escala Flow' })).resolves.toMatchObject({
      ok: true,
      code: 'ready',
      command: expect.stringContaining('npm --prefix'),
      cwd: '/tmp/Escala Flow',
      runtime: {
        provider: 'gemini',
        model: 'gemini-3.5-flash',
        toolsAvailable: true,
        toolsCount: 1,
      },
    })
  })

  it('blocks ready chat when tool execution is unavailable', async () => {
    state.config = cloudConfig()
    state.tools = []
    state.chatReadiness = {
      ok: true,
      provider: 'gemini',
      model: 'gemini-3.5-flash',
      reason: 'ready',
      message: 'IA pronta.',
      action: 'Abrir Terminal.',
    }
    const { getAiTerminalReadiness } = await import('../../../src/main/ia/runtime-readiness')

    await expect(getAiTerminalReadiness()).resolves.toMatchObject({
      ok: false,
      code: 'toolsUnavailable',
      blocksLaunch: true,
      runtime: {
        toolsAvailable: false,
        toolsCount: 0,
      },
    })
  })
})
