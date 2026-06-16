/** @vitest-environment jsdom */

import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'

// IaModelPill e o seletor oficial de modelo (abaixo do input). Mockamos como
// stub vazio para que qualquer ocorrencia do texto do modelo na tela so possa
// vir de DENTRO do input (a Badge redundante que estamos removendo).
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

describe('IaChatInput — modelo nao aparece dentro do input', () => {
  beforeEach(() => {
    ;(window as any).electron = { ipcRenderer: { invoke: vi.fn() } }
  })

  it('nao renderiza o label do modelo dentro do input (so no IaModelPill abaixo)', async () => {
    await renderInput()
    // Com o IaModelPill mockado, se o texto do modelo aparecer e porque a Badge
    // redundante ainda esta dentro do input.
    expect(screen.queryByText('Gemma 4 E2B IT')).toBeNull()
  })
})
