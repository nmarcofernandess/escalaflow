/** @vitest-environment jsdom */

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IaToolCallsCollapsible } from '../../src/renderer/src/componentes/IaToolCallsCollapsible'

describe('IaToolCallsCollapsible', () => {
  it('renderiza args vazios e output null quando a propriedade existe', async () => {
    const user = userEvent.setup()

    render(
      <IaToolCallsCollapsible
        toolCalls={[
          {
            id: 'tc-1',
            name: 'consultar',
            args: {},
            result: null,
          },
        ]}
      />,
    )

    await user.click(screen.getByRole('button', { name: /1 ferramenta utilizada/i }))

    expect(screen.getByText('Argumentos:')).toBeInTheDocument()
    expect(screen.getByText('{}')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /ver output/i }))
    expect(screen.getByText('null')).toBeInTheDocument()
  })
})

