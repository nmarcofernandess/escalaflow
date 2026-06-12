/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { SidebarProvider } from '../../src/renderer/src/components/ui/sidebar'
import { SimulaCicloPagina } from '../../src/renderer/src/paginas/SimulaCicloPagina'

vi.mock('@/store/iaStore', () => ({
  useIaStore: () => ({
    aberto: false,
    toggleAberto: vi.fn(),
  }),
}))

function renderPagina() {
  return render(
    <MemoryRouter initialEntries={['/simula-ciclo']}>
      <SidebarProvider>
        <SimulaCicloPagina />
      </SidebarProvider>
    </MemoryRouter>,
  )
}

describe('SimulaCicloPagina', () => {
  it('permite alternar para 6x1 e apresenta a semântica correta do regime', async () => {
    const user = userEvent.setup()

    renderPagina()

    expect(screen.getByRole('radio', { name: /5x2/i })).toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: /6x1/i }))

    expect(screen.getByText(/1 folga por semana/i)).toBeInTheDocument()
    expect(screen.getByText(/normal no 6x1/i)).toBeInTheDocument()
    expect(screen.getAllByText(/N-1 pessoas/i).length).toBeGreaterThan(0)
  })
})
