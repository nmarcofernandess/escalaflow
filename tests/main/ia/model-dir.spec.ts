import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// O nome do app vem de app-config; em dev o app.getPath('userData') resolve
// para ".../Electron/..." porque o binário se chama "Electron". O dir de
// modelos deve estar SEMPRE ancorado no nome real do produto.
vi.mock('../../../src/main/config/app-config', () => ({
  APP_CONFIG: {
    name: 'EscalaFlow',
  },
  isGeminiCloudApiEnabled: vi.fn(() => true),
}))

describe('getModelDir — ancorado no nome do app', () => {
  const originalEnv = process.env.ESCALAFLOW_LOCAL_MODELS_DIR

  beforeEach(() => {
    delete process.env.ESCALAFLOW_LOCAL_MODELS_DIR
  })

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.ESCALAFLOW_LOCAL_MODELS_DIR
    } else {
      process.env.ESCALAFLOW_LOCAL_MODELS_DIR = originalEnv
    }
  })

  it('sem env override, ancora o dir no nome do app (não em /Electron/models)', async () => {
    const { getModelDir } = await import('../../../src/main/ia/local-llm')

    const dir = getModelDir()

    expect(dir).toContain('EscalaFlow')
    expect(dir.endsWith('/Electron/models')).toBe(false)
    expect(dir).not.toContain(`${'/Electron/'}models`)
  })

  it('com ESCALAFLOW_LOCAL_MODELS_DIR setado, retorna exatamente o override', async () => {
    process.env.ESCALAFLOW_LOCAL_MODELS_DIR = '/tmp/x'

    const { getModelDir } = await import('../../../src/main/ia/local-llm')

    expect(getModelDir()).toBe('/tmp/x')
  })
})
