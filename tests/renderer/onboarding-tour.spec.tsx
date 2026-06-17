/** @vitest-environment jsdom */
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import React from 'react'
import {
  OnboardingTourProvider,
  useOnboardingTour,
  type TourStep,
} from '@/componentes/onboarding/OnboardingTour'

const steps: TourStep[] = [
  {
    targetId: 'tour-step-1',
    position: 'right',
    content: <div data-testid="step-1-content">Passo 1</div>,
  },
  {
    targetId: 'tour-step-2',
    position: 'bottom',
    content: <div data-testid="step-2-content">Passo 2</div>,
  },
]

function TestConsumer() {
  const { startTour, stopTour, nextStep, prevStep, isActive, currentStep } = useOnboardingTour()
  return (
    <div>
      <button data-testid="start" onClick={startTour}>Start</button>
      <button data-testid="stop" onClick={stopTour}>Stop</button>
      <button data-testid="next" onClick={nextStep}>Next</button>
      <button data-testid="prev" onClick={prevStep}>Prev</button>
      <div data-testid="status">{isActive ? `active-${currentStep}` : 'idle'}</div>
      {/* targets para rects */}
      <div id="tour-step-1" style={{ position: 'absolute', top: 10, left: 10, width: 50, height: 20 }}>t1</div>
      <div id="tour-step-2" style={{ position: 'absolute', top: 100, left: 10, width: 50, height: 20 }}>t2</div>
    </div>
  )
}

describe('OnboardingTour engine (EscalaFlow)', () => {
  let origGetRect: any
  beforeEach(() => {
    // reset body
    document.body.innerHTML = ''
    origGetRect = Element.prototype.getBoundingClientRect
    // Forçar rects positivos para a engine calcular targetRect e renderizar o card (jsdom não layouta)
    Element.prototype.getBoundingClientRect = function (this: Element) {
      const id = (this as HTMLElement).id
      if (id === 'tour-step-1') return { top: 10, left: 10, width: 120, height: 30, bottom: 40, right: 130, x: 10, y: 10, toJSON() {} } as any
      if (id === 'tour-step-2') return { top: 120, left: 10, width: 120, height: 30, bottom: 150, right: 130, x: 10, y: 120, toJSON() {} } as any
      return origGetRect.call(this)
    } as any
  })
  afterEach(() => {
    Element.prototype.getBoundingClientRect = origGetRect
    vi.restoreAllMocks()
  })

  it('não renderiza nada quando inativo', () => {
    render(
      <OnboardingTourProvider steps={steps}>
        <TestConsumer />
      </OnboardingTourProvider>,
    )
    expect(screen.queryByTestId('step-1-content')).not.toBeInTheDocument()
    expect(screen.getByTestId('status').textContent).toBe('idle')
  })

  it('startTour ativa e mostra primeiro passo + backdrop', async () => {
    render(
      <OnboardingTourProvider steps={steps}>
        <TestConsumer />
      </OnboardingTourProvider>,
    )
    fireEvent.click(screen.getByTestId('start'))
    await waitFor(() => {
      expect(screen.getByTestId('status').textContent).toBe('active-0')
      expect(screen.getByTestId('step-1-content')).toBeInTheDocument()
      // backdrop
      const backdrops = document.querySelectorAll('.fixed.inset-0')
      expect(backdrops.length).toBeGreaterThan(0)
    })
  })

  it('next avança e last conclui (chama onComplete)', async () => {
    const onComplete = vi.fn()
    render(
      <OnboardingTourProvider steps={steps} onComplete={onComplete}>
        <TestConsumer />
      </OnboardingTourProvider>,
    )
    fireEvent.click(screen.getByTestId('start'))
    await screen.findByTestId('step-1-content')
    fireEvent.click(screen.getByTestId('next'))
    await waitFor(() => {
      expect(screen.getByTestId('step-2-content')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByTestId('next'))
    await waitFor(() => {
      expect(onComplete).toHaveBeenCalledTimes(1)
      expect(screen.getByTestId('status').textContent).toBe('idle')
    })
  })

  it('prev volta', async () => {
    render(
      <OnboardingTourProvider steps={steps}>
        <TestConsumer />
      </OnboardingTourProvider>,
    )
    fireEvent.click(screen.getByTestId('start'))
    await screen.findByTestId('step-1-content')
    fireEvent.click(screen.getByTestId('next'))
    await screen.findByTestId('step-2-content')
    fireEvent.click(screen.getByTestId('prev'))
    await waitFor(() => {
      expect(screen.getByTestId('step-1-content')).toBeInTheDocument()
      expect(screen.queryByTestId('step-2-content')).not.toBeInTheDocument()
    })
  })

  it('clicar backdrop para (stop)', async () => {
    const onComplete = vi.fn()
    render(
      <OnboardingTourProvider steps={steps} onComplete={onComplete}>
        <TestConsumer />
      </OnboardingTourProvider>,
    )
    fireEvent.click(screen.getByTestId('start'))
    await screen.findByTestId('step-1-content')
    // o backdrop é o primeiro .fixed.inset-0
    const backdrop = document.querySelector('.fixed.inset-0.bg-black\\/50') as HTMLElement
    fireEvent.click(backdrop)
    await waitFor(() => {
      expect(onComplete).toHaveBeenCalledTimes(1)
    })
  })
})
