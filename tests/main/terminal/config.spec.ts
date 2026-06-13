import { beforeEach, describe, expect, it, vi } from 'vitest'

const execute = vi.fn()
const queryOne = vi.fn()

vi.mock('../../../src/main/db/query', () => ({
  execute,
  queryOne,
}))

describe('terminal harness config', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('defaults to local user home when config is missing', async () => {
    queryOne.mockResolvedValueOnce(undefined)
    const { getTerminalHarnessConfig } = await import('../../../src/main/terminal/config')

    const config = await getTerminalHarnessConfig()

    expect(config.default_cwd).toBeTruthy()
    expect(config.max_timeout_ms).toBe(30000)
  })

  it('saves normalized config', async () => {
    queryOne.mockResolvedValueOnce({
      value: {
        default_cwd: '/tmp',
        max_timeout_ms: 30000,
        max_output_chars: 20000,
      },
    })
    execute.mockResolvedValueOnce({ changes: 1 })
    const { saveTerminalHarnessConfig } = await import('../../../src/main/terminal/config')

    const config = await saveTerminalHarnessConfig({
      max_timeout_ms: 999999,
      max_output_chars: 999999,
    })

    expect(config.max_timeout_ms).toBe(120000)
    expect(config.max_output_chars).toBe(200000)
    expect(execute).toHaveBeenCalled()
  })
})
