/** @vitest-environment jsdom */

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RouterProvider, createMemoryRouter } from 'react-router-dom'
import { DEFAULT_AI_ROUTING_CONFIG, cloneRoutingConfig } from '../../src/shared'
import type { IaLocalStatus } from '../../src/shared/types'

const mocks = vi.hoisted(() => ({
  serverBinaryAvailable: false,
}))

// IPC permissivo: tudo retorna vazio/undefined, exceto ia.local.status, que
// carrega a flag de binário que estamos testando. Sem provider/token =>
// nenhuma IA pronta (hasAnyProviderAvailable === false), que é o gate da oferta.
function makeStatus(): IaLocalStatus {
  return {
    modelos: {},
    modelo_carregado: false,
    gpu_detectada: 'cpu',
    server_binary_available: mocks.serverBinaryAvailable,
  }
}

function installElectronMock() {
  // Canais que alimentam .filter()/.map()/Object.values em outros cards da
  // página precisam de shapes válidos, senão o ErrorBoundary do router derruba
  // a árvore inteira (e some com a oferta que estamos testando).
  const invoke = vi.fn(async (channel: string) => {
    switch (channel) {
      case 'ia.local.status':
        return makeStatus()
      case 'ia.local.models':
        // Catálogo real: modelo disponível para baixar (baixado:false).
        return [{
          id: 'gemma-4-e2b-it-q4',
          label: 'Gemma 4 E2B IT',
          filename: 'gemma-4-e2b-it-q4.gguf',
          size_bytes: 3_000_000_000,
          ram_minima_gb: 8,
          descricao: 'Modelo local padrão',
          baixado: false,
        }]
      case 'ia.configuracao.obter':
        return null
      case 'backup.config.obter':
        return { ativo: false }
      case 'knowledge.enrichmentConfig.get':
        return { auto_enrich_after_import: false, provider: 'auto', modelo: '' }
      case 'knowledge.enrichmentModels.list':
        return []
      case 'ia.routing.obter':
        return cloneRoutingConfig(DEFAULT_AI_ROUTING_CONFIG)
      case 'ia.routing.statusAll':
        return []
      case 'ia.stt.status':
        return { active_model_id: 'parakeet-v3-int8', modelos: {} }
      case 'ia.modelos.catalogo':
        return { provider: 'openrouter', source: 'fallback', models: [], fetched_at: '', cached: false }
      default:
        return undefined
    }
  })
  Object.defineProperty(window, 'electron', {
    configurable: true,
    value: { ipcRenderer: { invoke, on: vi.fn(() => vi.fn()), removeAllListeners: vi.fn() } },
  })
}

async function renderConfig() {
  vi.resetModules()
  installElectronMock()
  const { ConfiguracoesPagina } = await import('../../src/renderer/src/paginas/ConfiguracoesPagina')
  const { SidebarProvider } = await import('../../src/renderer/src/components/ui/sidebar')
  // useDirtyGuard usa useBlocker (data router) e PageHeader usa useSidebar.
  const element = (
    <SidebarProvider>
      <ConfiguracoesPagina />
    </SidebarProvider>
  )
  const router = createMemoryRouter([{ path: '/', element }], { initialEntries: ['/'] })
  return render(<RouterProvider router={router} />)
}

describe('ConfiguracoesPagina — oferta de IA local condicionada ao binário', () => {
  beforeEach(() => {
    // jsdom não tem matchMedia/scrollTo, usados por shadcn/radix.
    window.matchMedia = window.matchMedia || (vi.fn(() => ({
      matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(),
      addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
    })) as any)
    window.HTMLElement.prototype.scrollTo = vi.fn()
    // localStorage do jsdom é instável neste runner; stub determinístico.
    const store = new Map<string, string>()
    const localStorageMock = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, String(v)) },
      removeItem: (k: string) => { store.delete(k) },
      clear: () => { store.clear() },
      key: (i: number) => Array.from(store.keys())[i] ?? null,
      get length() { return store.size },
    }
    Object.defineProperty(window, 'localStorage', { configurable: true, value: localStorageMock })
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: localStorageMock })
  })
  afterEach(() => {
    vi.resetModules()
  })

  it('oferece "Baixar IA local" quando o binário do bundle existe', async () => {
    mocks.serverBinaryAvailable = true
    await renderConfig()

    expect(await screen.findByTestId('ia-local-offer')).toBeInTheDocument()
    expect(screen.getByText(/Baixar IA local/i)).toBeInTheDocument()
  })

  it('NÃO oferece "Baixar IA local" quando o binário não existe', async () => {
    mocks.serverBinaryAvailable = false
    await renderConfig()

    // Espera o cartão Assistente IA montar antes de afirmar ausência.
    await screen.findByText('Assistente IA')
    await waitFor(() =>
      expect(screen.queryByTestId('ia-local-offer')).not.toBeInTheDocument(),
    )
  })

  it('clicar na oferta revela os cards de download do fluxo local existente', async () => {
    mocks.serverBinaryAvailable = true
    await renderConfig()

    const offer = await screen.findByTestId('ia-local-offer')
    // Antes do clique não há card/botão de baixar do fluxo local.
    expect(screen.queryByText(/^Baixar \(/i)).not.toBeInTheDocument()

    await userEvent.click(offer)

    // Provider vira local -> card de download existente aparece (com botão Baixar).
    expect(await screen.findByText(/^Baixar \(/i)).toBeInTheDocument()
    expect(screen.getAllByText('Gemma 4 E2B IT').length).toBeGreaterThan(0)
  })
})
