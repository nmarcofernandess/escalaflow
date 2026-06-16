/** @vitest-environment jsdom */

import { render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'

// IaModelPill e o seletor oficial de modelo. Mockamos como stub com testid
// estavel para provar ONDE ele e renderizado (dentro da barra do input) sem
// depender da UI interna do Select real.
vi.mock('../../src/renderer/src/componentes/IaModelPill', () => ({
  IaModelPill: () => <div data-testid="ia-model-pill" />,
}))

vi.mock('@/servicos/stt', () => ({
  servicoStt: { transcribe: vi.fn() },
}))

vi.mock('@/hooks/useAudioRecorder', () => ({
  useAudioRecorder: () => {
    const [recording, setRecording] = useState(false)
    return {
      recording,
      start: vi.fn(async () => { setRecording(true) }),
      stop: vi.fn(async () => { setRecording(false); return new Uint8Array([82, 73, 70, 70]) }),
      cancel: vi.fn(() => { setRecording(false) }),
    }
  },
}))

async function renderInput(props?: Record<string, unknown>) {
  const { IaChatInput } = await import('../../src/renderer/src/componentes/IaChatInput')
  render(
    <IaChatInput
      value=""
      onChange={vi.fn()}
      onEnviar={vi.fn()}
      disabled={false}
      conversaId="conv-1"
      provider="gemini"
      providerOptions={[{ provider: 'gemini', label: 'Gemini', disabled: false }]}
      modelo="gemma-4-e2b-it-q4"
      modeloLabel="Gemma 4 E2B IT"
      modelOptions={[{ id: 'gemma-4-e2b-it-q4', label: 'Gemma 4 E2B IT', disabled: false }]}
      onProviderChange={vi.fn()}
      onModeloChange={vi.fn()}
      tokensEstimados={0}
      contextLength={1000}
      supportsMultimodal={false}
      anexos={[]}
      onAnexosChange={vi.fn()}
      {...props}
    />,
  )
}

describe('IaChatInput — seletor de modelo dentro da barra do input', () => {
  beforeEach(() => {
    ;(window as any).electron = { ipcRenderer: { invoke: vi.fn() } }
  })

  it('renderiza o seletor de modelo exatamente 1x (sem duplicacao)', async () => {
    await renderInput()
    expect(screen.getAllByTestId('ia-model-pill')).toHaveLength(1)
  })

  it('renderiza o seletor de modelo DENTRO do form do input, junto do botao enviar', async () => {
    await renderInput()
    const textarea = screen.getByTestId('ia-chat-input')
    const form = textarea.closest('form')
    expect(form).not.toBeNull()
    // Modelo e botao enviar coabitam o mesmo form (a barra unica do input).
    expect(within(form as HTMLElement).getByTestId('ia-model-pill')).toBeInTheDocument()
    expect(within(form as HTMLElement).getByTestId('ia-chat-send')).toBeInTheDocument()
  })
})
