/** @vitest-environment jsdom */

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  transcribe: vi.fn(),
  ipcInvoke: vi.fn(),
}))

vi.mock('@/servicos/stt', () => ({
  servicoStt: {
    transcribe: mocks.transcribe,
  },
}))

vi.mock('@/hooks/useAudioRecorder', () => ({
  useAudioRecorder: () => {
    const [recording, setRecording] = useState(false)
    return {
      recording,
      start: vi.fn(async () => { setRecording(true) }),
      stop: vi.fn(async () => {
        setRecording(false)
        return new Uint8Array([82, 73, 70, 70])
      }),
      cancel: vi.fn(() => { setRecording(false) }),
    }
  },
}))

vi.mock('../../src/renderer/src/componentes/IaModelPill', () => ({
  IaModelPill: () => <div data-testid="ia-model-pill" />,
}))

async function renderInput(props?: Record<string, unknown>) {
  const { IaChatInput } = await import('../../src/renderer/src/componentes/IaChatInput')
  const onChange = vi.fn()
  const onAnexosChange = vi.fn()
  render(
    <IaChatInput
      value=""
      onChange={onChange}
      onEnviar={vi.fn()}
      disabled={false}
      conversaId="conv-1"
      provider="gemini"
      providerOptions={[{ provider: 'gemini', label: 'Gemini', disabled: false }]}
      modelo="gemini-3.1-flash-lite"
      modeloLabel="Gemini"
      modelOptions={[{ id: 'gemini-3.1-flash-lite', label: 'Gemini', disabled: false }]}
      onProviderChange={vi.fn()}
      onModeloChange={vi.fn()}
      tokensEstimados={0}
      contextLength={1000}
      supportsMultimodal={false}
      anexos={[]}
      onAnexosChange={onAnexosChange}
      {...props}
    />,
  )
  return { onChange, onAnexosChange }
}

describe('IaChatInput mic dictation', () => {
  beforeEach(() => {
    mocks.transcribe.mockReset()
    mocks.ipcInvoke.mockReset()
    ;(window as any).electron = { ipcRenderer: { invoke: mocks.ipcInvoke } }
    vi.stubGlobal('btoa', (value: string) => Buffer.from(value, 'binary').toString('base64'))
  })

  it('transcribes mic audio into text without mutating attachments', async () => {
    mocks.transcribe.mockResolvedValue({
      text: 'Criar escala 6x1 para o acougue.',
      raw_text: 'Criar escala 6x1 para o acougue.',
      model_id: 'parakeet-v3-int8',
      duration_ms: 100,
      audio_duration_ms: 1000,
      post_processed: false,
    })
    const user = userEvent.setup()
    const { onChange, onAnexosChange } = await renderInput()

    await user.click(screen.getByRole('button', { name: /iniciar ditado/i }))
    await user.click(screen.getByRole('button', { name: /parar ditado/i }))

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith('Criar escala 6x1 para o acougue.')
    })
    expect(onAnexosChange).not.toHaveBeenCalled()
    expect(mocks.ipcInvoke).not.toHaveBeenCalledWith('ia.chat.salvarAnexo', expect.anything())
    expect(mocks.transcribe).toHaveBeenCalledWith({
      wav_base64: 'UklGRg==',
      post_process: false,
    })
  })
})
