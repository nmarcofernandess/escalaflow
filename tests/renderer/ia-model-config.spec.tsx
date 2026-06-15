/** @vitest-environment jsdom */

import { render, screen, waitFor } from '@testing-library/react'
import { act } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IaCapabilities } from '../../src/shared'

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
}))

const readyCapabilities: IaCapabilities = {
  active_provider: 'gemini',
  active_provider_available: true,
  show_unconfigured_state: false,
  message: 'Gemini pronto.',
  providers: [
    {
      provider: 'gemini',
      label: 'Gemini',
      available: true,
      models: [],
    },
  ],
}

function installElectronMock() {
  Object.defineProperty(window, 'electron', {
    configurable: true,
    value: {
      ipcRenderer: {
        invoke: mocks.invoke,
      },
    },
  })
}

async function renderHarness() {
  vi.resetModules()
  installElectronMock()
  const { useIaModelConfig } = await import('../../src/renderer/src/hooks/useIaModelConfig')

  function Harness() {
    const config = useIaModelConfig()
    return (
      <div>
        <div data-testid="loading">{String(config.isLoading)}</div>
        <div data-testid="can-send">{String(config.canSendMessages)}</div>
        <div data-testid="reason">{config.activeProviderReason ?? ''}</div>
        <button onClick={() => window.dispatchEvent(new Event('ia-config-changed'))}>
          reload
        </button>
      </div>
    )
  }

  return render(<Harness />)
}

describe('useIaModelConfig readiness state', () => {
  beforeEach(() => {
    mocks.invoke.mockReset()
  })

  it('clears stale send readiness when a reload fails', async () => {
    mocks.invoke.mockImplementation(async (channel: string) => {
      if (channel === 'ia.configuracao.obter') {
        return {
          provider: 'gemini',
          modelo: 'gemini-3.1-flash-lite',
          provider_configs: { gemini: { modelo: 'gemini-3.1-flash-lite' } },
        }
      }
      if (channel === 'ia.capabilities.obter') return readyCapabilities
      if (channel === 'ia.modelos.catalogo') {
        return {
          models: [
            {
              id: 'gemini-3.1-flash-lite',
              label: 'Gemini 3.1 Flash Lite',
              context_length: 1_000_000,
            },
          ],
        }
      }
      throw new Error(`unexpected channel ${channel}`)
    })

    await renderHarness()

    await waitFor(() => {
      expect(screen.getByTestId('can-send')).toHaveTextContent('true')
    })

    mocks.invoke.mockImplementation(async (channel: string) => {
      if (channel === 'ia.configuracao.obter') return { provider: 'gemini', modelo: 'gemini-3.1-flash-lite' }
      if (channel === 'ia.capabilities.obter') throw new Error('DB bridge down')
      throw new Error(`unexpected channel ${channel}`)
    })

    await act(async () => {
      window.dispatchEvent(new Event('ia-config-changed'))
    })

    await waitFor(() => {
      expect(screen.getByTestId('loading')).toHaveTextContent('false')
      expect(screen.getByTestId('can-send')).toHaveTextContent('false')
      expect(screen.getByTestId('reason')).toHaveTextContent('Nao foi possivel verificar')
    })
  })
})
