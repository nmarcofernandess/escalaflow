/** @vitest-environment jsdom */

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AiRoutingSection } from '../../src/renderer/src/componentes/ai/AiRoutingSection'
import { DEFAULT_AI_ROUTING_CONFIG, type AiRouteResolution, type AiRoutingConfig } from '../../src/shared'

const mocks = vi.hoisted(() => ({
  obterIaRouting: vi.fn(),
  salvarIaRouting: vi.fn(),
  listarIaRouteStatus: vi.fn(),
}))

vi.mock('@/servicos/conhecimento', () => ({
  servicoConhecimento: {
    obterIaRouting: mocks.obterIaRouting,
    salvarIaRouting: mocks.salvarIaRouting,
    listarIaRouteStatus: mocks.listarIaRouteStatus,
  },
}))

function cloneRoutingConfig(): AiRoutingConfig {
  return JSON.parse(JSON.stringify(DEFAULT_AI_ROUTING_CONFIG))
}

function route(overrides: Partial<AiRouteResolution>): AiRouteResolution {
  return {
    ok: true,
    task: 'chat_ui',
    label: 'Chat do app',
    mode: 'inherit',
    provider: 'gemini',
    model: 'gemini-3.5-flash',
    reason: 'ready',
    message: 'Rota pronta.',
    inherited: true,
    auto_selected: false,
    ...overrides,
  }
}

describe('AiRoutingSection', () => {
  beforeEach(() => {
    window.HTMLElement.prototype.scrollIntoView = vi.fn()
    window.HTMLElement.prototype.hasPointerCapture = vi.fn(() => false)
    window.HTMLElement.prototype.releasePointerCapture = vi.fn()
    window.HTMLElement.prototype.setPointerCapture = vi.fn()
    mocks.obterIaRouting.mockReset()
    mocks.salvarIaRouting.mockReset()
    mocks.listarIaRouteStatus.mockReset()
    mocks.obterIaRouting.mockResolvedValue(cloneRoutingConfig())
    mocks.salvarIaRouting.mockImplementation(async (config) => config)
  })

  it('mostra a nota da IA ativa (sem chave mestra), modos por tarefa e status do backend', async () => {
    mocks.listarIaRouteStatus.mockResolvedValue([
      route({ task: 'chat_ui', label: 'Chat do app', message: 'Chat pronto via Gemini.' }),
      route({
        ok: false,
        task: 'rag_metadata',
        label: 'Nome e resumo dos arquivos',
        mode: 'explicit',
        provider: 'local',
        model: 'gemma-4-e2b-it-q4',
        reason: 'validate_local_model',
        message: 'O modelo local está baixado, mas ainda precisa ser testado.',
        action: 'Teste o modelo local antes de usar.',
        inherited: false,
      }),
    ])

    render(<AiRoutingSection />)

    expect(await screen.findByText('IA e Modelos')).toBeTruthy()
    // Não há mais "chave mestra": a IA global vem de Configurações > Assistente IA.
    expect(screen.getByTestId('ia-routing-active-note')).toBeTruthy()
    expect(screen.queryByTestId('ia-routing-global-provider')).toBeNull()
    expect(screen.queryByTestId('ia-routing-global-model')).toBeNull()
    expect(screen.getByTestId('ia-routing-mode-chat_ui')).toBeTruthy()
    // rag_metadata é explicit no default → provider/modelo viram selects editáveis.
    expect(screen.getByTestId('ia-routing-provider-rag_metadata')).toBeTruthy()
    expect(await screen.findByText('Chat do app')).toBeTruthy()
    expect(screen.getByText('Nome e resumo dos arquivos')).toBeTruthy()
    expect(screen.getByText('O modelo local está baixado, mas ainda precisa ser testado.')).toBeTruthy()
    expect(screen.getByText('Teste o modelo local antes de usar.')).toBeTruthy()
    expect(screen.getAllByText('Indisponível').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('Falta testar')).toBeTruthy()
  })

  it('mostra a IA resolvida (read-only) para tarefas em "Seguir IA ativa"', async () => {
    mocks.listarIaRouteStatus.mockResolvedValue([
      route({ task: 'chat_ui', label: 'Chat do app', provider: 'gemini', model: 'gemini-3.5-flash' }),
    ])

    render(<AiRoutingSection />)

    // chat_ui é inherit → a IA aparece como texto read-only (provider resolvido), não select.
    const providerCell = await screen.findByTestId('ia-routing-provider-chat_ui')
    expect(providerCell.tagName).toBe('SPAN')
    expect(providerCell.textContent).toContain('Google Gemini')
  })

  it('salva uma rota explícita por tarefa (override sobre a IA ativa)', async () => {
    const user = userEvent.setup()
    mocks.listarIaRouteStatus.mockResolvedValue([
      route({ task: 'chat_ui', label: 'Chat do app', provider: 'local', model: 'gemma-4-e2b-it-q4' }),
    ])

    render(<AiRoutingSection />)

    await screen.findByTestId('ia-routing-mode-chat_ui')
    await user.click(screen.getByTestId('ia-routing-mode-chat_ui'))
    await user.click(await screen.findByRole('option', { name: 'Escolher manualmente' }))

    // Agora o provider vira select editável.
    await user.click(screen.getByTestId('ia-routing-provider-chat_ui'))
    await user.click(await screen.findByRole('option', { name: 'Google Gemini' }))

    await user.click(screen.getByRole('button', { name: /Salvar escolhas/i }))

    await waitFor(() => {
      expect(mocks.salvarIaRouting).toHaveBeenCalledWith(expect.objectContaining({
        tasks: expect.objectContaining({
          chat_ui: expect.objectContaining({ mode: 'explicit', provider: 'gemini' }),
        }),
      }))
    })
  })
})
