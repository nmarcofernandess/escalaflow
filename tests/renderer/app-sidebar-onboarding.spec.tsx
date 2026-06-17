/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import React from 'react'
import { MemoryRouter } from 'react-router-dom'
import { SidebarProvider } from '@/components/ui/sidebar'
import { AppSidebar } from '@/componentes/AppSidebar'

// Mock next-themes
vi.mock('next-themes', () => ({
  useTheme: () => ({ theme: 'dark', setTheme: vi.fn() }),
}))

// Mock useAppVersion
vi.mock('@/hooks/useAppVersion', () => ({
  useAppVersion: () => '1.0.0-test',
}))

// Mock stores / servicos usados no sidebar
vi.mock('@/store/restorePreviewStore', () => ({
  useRestorePreviewStore: () => ({ active: false }),
}))

vi.mock('@/servicos/empresa', () => ({
  empresaService: { buscar: async () => ({ nome: 'Test Empresa' }) },
}))

vi.mock('@shared/index', () => ({
  getTerminalIaAccess: () => ({ enabled: true }),
  TERMINAL_IA_PERSONA_STORAGE_KEY: 'k',
}))

// Mock o hook do tour
const startTourMock = vi.fn()
vi.mock('@/componentes/onboarding/OnboardingTour', async (importOriginal) => {
  const actual = await importOriginal<any>()
  return {
    ...actual,
    useOnboardingTour: () => ({ startTour: startTourMock }),
  }
})

function renderSidebar(props?: { onReopenSetup?: () => void }) {
  return render(
    <MemoryRouter>
      <SidebarProvider>
        <AppSidebar {...props} />
      </SidebarProvider>
    </MemoryRouter>,
  )
}

describe('AppSidebar onboarding items (EscalaFlow)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Garantir localStorage no jsdom para o cálculo síncrono do terminalIaAccess no render de AppSidebar
    Object.defineProperty(window, 'localStorage', {
      value: {
        getItem: vi.fn(() => null),
        setItem: vi.fn(),
        removeItem: vi.fn(),
      },
      writable: true,
      configurable: true,
    })
  })

  it('renderiza item "Setup" quando onReopenSetup passado', async () => {
    const onReopen = vi.fn()
    renderSidebar({ onReopenSetup: onReopen })

    // Abre o dropdown do footer (clica no trigger da conta). Nome é assíncrono via effect.
    const trigger = await screen.findByRole('button', { name: /Empresa/i })
    await userEvent.click(trigger)

    const setupItem = await screen.findByText('Setup')
    expect(setupItem).toBeInTheDocument()

    await userEvent.click(setupItem)
    expect(onReopen).toHaveBeenCalledTimes(1)
  })

  it('renderiza "Como funciona" e dispara startTour', async () => {
    renderSidebar({ onReopenSetup: vi.fn() })

    const trigger = await screen.findByRole('button', { name: /Empresa/i })
    await userEvent.click(trigger)

    const como = await screen.findByText('Como funciona')
    await userEvent.click(como)

    expect(startTourMock).toHaveBeenCalledTimes(1)
  })

  it('não quebra quando onReopenSetup ausente (só mostra Como funciona)', async () => {
    renderSidebar()

    const trigger = await screen.findByRole('button', { name: /Empresa/i })
    await userEvent.click(trigger)

    expect(await screen.findByText('Como funciona')).toBeInTheDocument()
    expect(screen.queryByText('Setup')).not.toBeInTheDocument()
  })
})
