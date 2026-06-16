/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { FlowPromptInput } from '../../src/renderer/src/componentes/ai/FlowPromptInput'

describe('FlowPromptInput', () => {
  it('sends text through existing callback', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const onEnviar = vi.fn()

    render(
      <FlowPromptInput
        value="me conta uma piada de padeiro"
        onChange={onChange}
        onEnviar={onEnviar}
        disabled={false}
        canAttach
      />,
    )

    await user.click(screen.getByRole('button', { name: /enviar/i }))
    expect(onEnviar).toHaveBeenCalledTimes(1)
  })

  it('does not send when backend route disables chat', async () => {
    const user = userEvent.setup()
    const onEnviar = vi.fn()

    render(
      <FlowPromptInput
        value="oi"
        onChange={() => undefined}
        onEnviar={onEnviar}
        disabled
        canAttach={false}
      />,
    )

    await user.click(screen.getByRole('button', { name: /enviar/i }))
    expect(onEnviar).not.toHaveBeenCalled()
  })
})
