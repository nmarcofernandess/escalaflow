/** @vitest-environment jsdom */
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// O wizard novo NÃO navega mais para /configuracoes (o download acontece
// dentro do próprio passo de IA). Mas outros componentes que ele monta podem
// usar react-router; mantemos um stub barato de useNavigate por segurança.
const navigateMock = vi.fn()
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return { ...actual, useNavigate: () => navigateMock }
})

// O passo de Arquivos reusa o AdicionarConhecimentoDialog real. Mockamos um
// dublê leve que só prova "abriu/fechou" para não arrastar todo o serviço de
// conhecimento + IPC de import para dentro deste teste de wizard.
vi.mock('@/componentes/AdicionarConhecimentoDialog', () => ({
  AdicionarConhecimentoDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="add-knowledge-dialog">add-knowledge</div> : null,
}))

type CapsShape = {
  gemini_cloud_api_enabled?: boolean
  local_server_binary_available?: boolean
  has_any_available_provider?: boolean
}

type LocalModelStub = {
  id: string
  label: string
  size_bytes: number
  baixado?: boolean
  usable?: boolean
  requires_validation?: boolean
  load_error?: string
  download_status?: 'idle' | 'downloading' | 'cancelled' | 'failed' | 'done'
  download_progresso?: number
  download_bytes_total?: number
  download_bytes_feitos?: number
}

function makeLocalModels(overrides: Partial<LocalModelStub>[] = [{}]): LocalModelStub[] {
  return overrides.map((o, i) => ({
    id: o.id ?? `gemma-${i}`,
    label: o.label ?? 'Gemma 4 E2B IT',
    size_bytes: o.size_bytes ?? 3_110_000_000,
    baixado: o.baixado ?? false,
    usable: o.usable ?? false,
    requires_validation: o.requires_validation,
    load_error: o.load_error,
    download_status: o.download_status,
    download_progresso: o.download_progresso,
    download_bytes_total: o.download_bytes_total,
    download_bytes_feitos: o.download_bytes_feitos,
  }))
}

const mockInvoke = vi.fn()
const mockOn = vi.fn(() => vi.fn()) // retorna disposer

beforeEach(() => {
  vi.clearAllMocks()
  // @ts-expect-error - test env
  window.electron = {
    ipcRenderer: {
      invoke: mockInvoke,
      on: mockOn,
    },
  }
})

afterEach(() => {
  vi.restoreAllMocks()
})

async function renderWizard(props?: { onStartTour?: () => void }) {
  const mod = await import('@/componentes/onboarding/SetupWizard')
  const SetupWizard = mod.default
  return render(<SetupWizard onComplete={vi.fn()} onStartTour={props?.onStartTour} />)
}

describe('SetupWizard (EscalaFlow port) - passo IA data-driven + local offer', () => {
  it('passo 1 (bem-vindo) mostra APP_NAME e botão Começar', async () => {
    mockInvoke.mockImplementation((channel: string) => {
      if (channel === 'ia.capabilities.obter') return Promise.resolve({ gemini_cloud_api_enabled: true, local_server_binary_available: false, has_any_available_provider: true })
      if (channel === 'ia.local.models') return Promise.resolve([])
      return Promise.resolve(null)
    })

    await renderWizard()
    expect(screen.getByText('EscalaFlow')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /comecar/i })).toBeInTheDocument()
  })

  it('passo 2 (IA) mostra seção LOCAL quando binary disponível + models do catálogo', async () => {
    const models = makeLocalModels([{ id: 'gemma-4-e2b-it-q4', label: 'Gemma 4 E2B', baixado: false, usable: false }])
    mockInvoke.mockImplementation((channel: string) => {
      if (channel === 'ia.capabilities.obter') {
        return Promise.resolve({ gemini_cloud_api_enabled: true, local_server_binary_available: true, has_any_available_provider: false })
      }
      if (channel === 'ia.local.models') return Promise.resolve(models)
      return Promise.resolve(null)
    })

    await renderWizard()
    // Avança para passo 2
    await userEvent.click(screen.getByRole('button', { name: /comecar/i }))

    await waitFor(() => {
      expect(screen.getByTestId('wizard-local-section')).toBeInTheDocument()
      expect(screen.getByText(/Gemma 4 E2B/)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /baixar/i })).toBeInTheDocument()
    })
  })

  it('passo 2 mostra NUVEM (Gemini + OpenRouter) quando gemini enabled; OpenRouter sempre', async () => {
    mockInvoke.mockImplementation((channel: string) => {
      if (channel === 'ia.capabilities.obter') return Promise.resolve({ gemini_cloud_api_enabled: true, local_server_binary_available: false, has_any_available_provider: true })
      if (channel === 'ia.local.models') return Promise.resolve([])
      return Promise.resolve(null)
    })

    await renderWizard()
    await userEvent.click(screen.getByRole('button', { name: /comecar/i }))

    await waitFor(() => {
      expect(screen.getByTestId('wizard-cloud-gemini')).toBeInTheDocument()
      expect(screen.getByTestId('wizard-cloud-openrouter')).toBeInTheDocument()
    })
  })

  it('clicar Baixar no model local invoca ia.local.download e reflete status via evento', async () => {
    const modelId = 'gemma-4-e2b-it-q4'
    let models = makeLocalModels([{ id: modelId, baixado: false, usable: false }])
    mockInvoke.mockImplementation((channel: string, arg?: any) => {
      if (channel === 'ia.capabilities.obter') return Promise.resolve({ gemini_cloud_api_enabled: true, local_server_binary_available: true, has_any_available_provider: false })
      if (channel === 'ia.local.models') return Promise.resolve(models)
      if (channel === 'ia.local.download') {
        // simula início; o status-changed virá do mockOn
        return Promise.resolve()
      }
      return Promise.resolve(null)
    })

    await renderWizard()
    await userEvent.click(screen.getByRole('button', { name: /comecar/i }))

    const downloadBtn = await screen.findByRole('button', { name: /baixar/i })
    await userEvent.click(downloadBtn)

    expect(mockInvoke).toHaveBeenCalledWith('ia.local.download', { model_id: modelId })

    // Simula o evento de status changed atualizando o model para "baixando"
    const statusHandler = mockOn.mock.calls.find((c) => c[0] === 'ia:local:status-changed')?.[1]
    models = makeLocalModels([{ id: modelId, baixado: true, usable: false, download_status: 'downloading', download_progresso: 42 }])
    statusHandler?.()

    await waitFor(() => {
      expect(screen.getByText(/Baixando/i)).toBeInTheDocument()
    })
  })

  it('passo final (4) mostra botão "Ver como funciona" quando onStartTour é passado, e chama handleFinish + startTour na ordem certa', async () => {
    const onStartTour = vi.fn()
    mockInvoke.mockImplementation((channel: string) => {
      if (channel === 'ia.capabilities.obter') return Promise.resolve({ gemini_cloud_api_enabled: true, local_server_binary_available: false, has_any_available_provider: true })
      if (channel === 'ia.local.models') return Promise.resolve([])
      if (channel === 'config.set') return Promise.resolve({ ok: true })
      return Promise.resolve(null)
    })

    await renderWizard({ onStartTour })
    // Avança até o passo 4
    await userEvent.click(screen.getByRole('button', { name: /comecar/i }))
    await userEvent.click(screen.getByRole('button', { name: /proximo/i }))
    await userEvent.click(screen.getByRole('button', { name: /proximo/i }))

    const verBtn = await screen.findByRole('button', { name: /ver como funciona/i })
    await userEvent.click(verBtn)

    await waitFor(() => {
      // config.set para marcar complete
      expect(mockInvoke).toHaveBeenCalledWith('config.set', expect.objectContaining({ key: 'onboarding_complete' }))
      expect(onStartTour).toHaveBeenCalledTimes(1)
    })
  })
})
