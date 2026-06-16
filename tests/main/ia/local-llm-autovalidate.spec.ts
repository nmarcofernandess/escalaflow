import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// T1 — Auto-valida o modelo local APOS o download (mata o "Testar conexao"
// manual). O handler tipc `ia.local.download` faz
// `const { downloadModel, validateLocalModel } = await import('./ia/local-llm')`
// e, ao terminar `downloadModel`, deve encadear `validateLocalModel(modelId)`.
//
// Mockamos o modulo `local-llm` no LIMITE DE IMPORT (o handler o resolve via
// import dinamico), entao tanto `vi.mock` quanto os spies pegam de verdade —
// diferente de chamar funcoes irmas como identificadores nus dentro do proprio
// local-llm.ts, onde o spy NAO interceptaria.

const mocks = vi.hoisted(() => ({
  downloadModel: vi.fn(),
  validateLocalModel: vi.fn(),
}))

vi.mock('../../../src/main/ia/local-llm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/main/ia/local-llm')>()
  return {
    ...actual,
    downloadModel: mocks.downloadModel,
    validateLocalModel: mocks.validateLocalModel,
  }
})

describe('ia.local.download — auto-validacao pos-download', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.downloadModel.mockResolvedValue(undefined)
    mocks.validateLocalModel.mockResolvedValue({ usable: true, requires_validation: false })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('encadeia validateLocalModel(modelId) APOS downloadModel resolver', async () => {
    const { router } = await import('../../../src/main/tipc')
    const proc = router['ia.local.download'] as { action: (args: { context: unknown; input: { model_id: string } }) => Promise<unknown> }

    const result = await proc.action({ context: {}, input: { model_id: 'gemma-4-e2b-it-q4' } })

    expect(mocks.downloadModel).toHaveBeenCalledTimes(1)
    expect(mocks.validateLocalModel).toHaveBeenCalledTimes(1)
    expect(mocks.validateLocalModel).toHaveBeenCalledWith('gemma-4-e2b-it-q4')
    expect(result).toEqual({ sucesso: true })

    // Ordem: validar so depois que o download terminou.
    const downloadOrder = mocks.downloadModel.mock.invocationCallOrder[0]
    const validateOrder = mocks.validateLocalModel.mock.invocationCallOrder[0]
    expect(validateOrder).toBeGreaterThan(downloadOrder)
  })

  it('nao derruba o download quando a auto-validacao falha (best-effort)', async () => {
    mocks.validateLocalModel.mockRejectedValueOnce(new Error('load falhou'))
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const { router } = await import('../../../src/main/tipc')
    const proc = router['ia.local.download'] as { action: (args: { context: unknown; input: { model_id: string } }) => Promise<unknown> }

    // Download teve sucesso → handler resolve { sucesso: true } mesmo com
    // validacao falhando, e loga o motivo.
    await expect(
      proc.action({ context: {}, input: { model_id: 'gemma-4-e2b-it-q4' } }),
    ).resolves.toEqual({ sucesso: true })

    expect(mocks.validateLocalModel).toHaveBeenCalledTimes(1)
    expect(warnSpy).toHaveBeenCalled()
  })
})
