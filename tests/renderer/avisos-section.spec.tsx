/** @vitest-environment jsdom */

import { render, screen, fireEvent } from '@testing-library/react'
import { AvisosSection, type Aviso } from '../../src/renderer/src/componentes/AvisosSection'

const mockAvisos: Aviso[] = [
  { id: 'test1', nivel: 'error', titulo: 'Erro teste', descricao: 'Descricao erro' },
  { id: 'test2', nivel: 'warning', titulo: 'Aviso teste', descricao: 'Descricao aviso' },
  { id: 'test3', nivel: 'info', titulo: 'Info teste', descricao: 'Descricao info' },
]

describe('AvisosSection', () => {
  it('renders nothing when avisos is empty', () => {
    const { container } = render(<AvisosSection avisos={[]} />)
    expect(container.innerHTML).toBe('')
  })

  it('renders all avisos with correct count', () => {
    render(<AvisosSection avisos={mockAvisos} />)
    expect(screen.getByText('Avisos (3)')).toBeTruthy()
  })

  it('renders "Analisar com IA" button when onAnalisarIa is provided', () => {
    const handler = vi.fn()
    render(<AvisosSection avisos={mockAvisos} onAnalisarIa={handler} />)
    expect(screen.getByText('Analisar com IA')).toBeTruthy()
  })

  it('does NOT render "Analisar com IA" button when onAnalisarIa is NOT provided', () => {
    render(<AvisosSection avisos={mockAvisos} />)
    expect(screen.queryByText('Analisar com IA')).toBeNull()
  })

  it('calls onAnalisarIa when button is clicked', () => {
    const handler = vi.fn()
    render(<AvisosSection avisos={mockAvisos} onAnalisarIa={handler} />)
    fireEvent.click(screen.getByText('Analisar com IA'))
    expect(handler).toHaveBeenCalledOnce()
  })

  it('renders error aviso with correct styling class', () => {
    render(<AvisosSection avisos={[mockAvisos[0]]} />)
    expect(screen.getByText('Erro teste')).toBeTruthy()
  })

  it('renders aviso action button when provided', () => {
    const actionHandler = vi.fn()
    const avisoWithAction: Aviso[] = [
      {
        id: 'act1',
        nivel: 'warning',
        titulo: 'Com acao',
        descricao: 'Desc',
        acao: { label: 'Resolver', handler: actionHandler },
      },
    ]
    render(<AvisosSection avisos={avisoWithAction} />)
    fireEvent.click(screen.getByText('Resolver'))
    expect(actionHandler).toHaveBeenCalledOnce()
  })
})
