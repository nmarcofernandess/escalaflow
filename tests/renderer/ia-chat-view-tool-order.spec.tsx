/** @vitest-environment jsdom */

import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IaMensagem } from '../../src/shared'
import { IaChatView } from '../../src/renderer/src/componentes/IaChatView'

const storeState = vi.hoisted(() => ({
  mensagens: [
    {
      id: 'user-1',
      timestamp: '2026-06-14T12:00:00.000Z',
      papel: 'usuario',
      conteudo: 'Use a ferramenta e depois responda.',
    },
    {
      id: 'assistant-1',
      timestamp: '2026-06-14T12:00:00.000Z',
      papel: 'assistente',
      conteudo: 'A ferramenta encontrou o contexto certo.',
      tool_calls: [
        {
          id: 'tool-1',
          name: 'consultar_contexto',
          args: { consulta: 'flowkit_toolcall_123' },
          result: { ok: true },
        },
      ],
    },
  ] as IaMensagem[],
  carregando: false,
  conversa_ativa_id: 'conversation-1',
  adicionarMensagem: vi.fn(),
  texto_parcial: '',
  tool_calls_parciais: [],
  tools_em_andamento: {},
  stream_id_ativo: null,
  iniciarStream: vi.fn(),
  processarStreamEvent: vi.fn(),
  finalizarStream: vi.fn(),
  cancelarStream: vi.fn(),
  editarEReenviar: vi.fn(),
  pendingAutoMessage: null,
  setPendingAutoMessage: vi.fn(),
}))

vi.mock('@/store/iaStore', () => {
  const useIaStore = (selector?: (state: typeof storeState) => unknown) => (
    selector ? selector(storeState) : storeState
  )
  useIaStore.getState = () => storeState
  return { useIaStore }
})

vi.mock('@/store/appDataStore', () => ({
  useAppDataStore: (selector: (state: { snapshot: () => null }) => unknown) => selector({ snapshot: () => null }),
}))

vi.mock('@/hooks/useIaModelConfig', () => ({
  useIaModelConfig: () => ({
    provider: 'local',
    providerOptions: [{ provider: 'local', label: 'IA local', disabled: false }],
    modelo: 'gemma-4-e2b-it-q4',
    modeloLabel: 'Gemma 4 E2B IT',
    modelOptions: [{ id: 'gemma-4-e2b-it-q4', label: 'Gemma 4 E2B IT', disabled: false }],
    contextLength: 8192,
    supportsMultimodal: false,
    isLoading: false,
    canSendMessages: true,
    showUnconfiguredState: false,
    activeProviderReason: undefined,
    modelSelectDisabled: false,
    setProvider: vi.fn(),
    setModelo: vi.fn(),
  }),
}))

vi.mock('../../src/renderer/src/componentes/IaChatInput', () => ({
  IaChatInput: () => null,
}))

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return {
    ...actual,
    useNavigate: () => vi.fn(),
    useLocation: () => ({ pathname: '/ia' }),
  }
})

describe('IaChatView tool chronology', () => {
  beforeEach(() => {
    window.HTMLElement.prototype.scrollTo = vi.fn()
    Object.assign(window, {
      electron: {
        ipcRenderer: {
          invoke: vi.fn(),
          on: vi.fn(() => vi.fn()),
        },
      },
    })
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn(),
      },
    })
  })

  it('renders persisted tool calls before the final assistant answer', async () => {
    render(<IaChatView />)

    const turn = await screen.findByTestId('ia-assistant-turn-with-tool')
    const toolPanel = await screen.findByTestId('ia-tool-calls-panel')
    const assistantMessage = await screen.findByTestId('ia-assistant-message')

    expect(turn.contains(toolPanel)).toBe(true)
    expect(turn.contains(assistantMessage)).toBe(true)
    expect(
      Boolean(toolPanel.compareDocumentPosition(assistantMessage) & Node.DOCUMENT_POSITION_FOLLOWING),
    ).toBe(true)
  })
})
