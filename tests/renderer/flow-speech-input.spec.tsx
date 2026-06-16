/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { FlowSpeechInput } from '../../src/renderer/src/componentes/ai/FlowSpeechInput'

const mocks = vi.hoisted(() => ({
  stop: vi.fn(async () => new Uint8Array([82, 73, 70, 70])),
  cancel: vi.fn(),
  transcribe: vi.fn(async () => ({
    text: 'texto literal do parakeet',
    raw_text: 'texto literal do parakeet',
    model_id: 'parakeet-tdt-0.6b-v2',
    duration_ms: 10,
    audio_duration_ms: 100,
    post_processed: false,
  })),
}))

vi.mock('../../src/renderer/src/hooks/useAudioRecorder', () => ({
  useAudioRecorder: () => ({
    recording: true,
    start: vi.fn(),
    stop: mocks.stop,
    cancel: mocks.cancel,
  }),
}))

vi.mock('../../src/renderer/src/servicos/stt', () => ({
  servicoStt: {
    transcribe: mocks.transcribe,
  },
}))

describe('FlowSpeechInput', () => {
  it('uses local STT transcript without claiming post processing', async () => {
    const user = userEvent.setup()
    const onTranscript = vi.fn()

    render(<FlowSpeechInput disabled={false} onTranscript={onTranscript} />)

    await user.click(screen.getByRole('button', { name: /parar ditado/i }))

    expect(mocks.transcribe).toHaveBeenCalledWith(expect.objectContaining({ post_process: false }))
    expect(onTranscript).toHaveBeenCalledWith('texto literal do parakeet')
    expect(screen.queryByText(/melhorado por IA/i)).not.toBeInTheDocument()
  })
})
