import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { TOUR_STORAGE_KEY } from '@/lib/tour-constants'

// --- Types ---

export type ContentPosition = 'top' | 'bottom' | 'left' | 'right'

export interface TourStep {
  targetId: string
  position: ContentPosition
  content: ReactNode
  onEnter?: () => void
}

interface TourContextValue {
  isActive: boolean
  currentStep: number
  startTour: () => void
  stopTour: () => void
  nextStep: () => void
  prevStep: () => void
  setSteps: (steps: TourStep[]) => void
}

const TourContext = createContext<TourContextValue | null>(null)

export function useTour() {
  const ctx = useContext(TourContext)
  if (!ctx) throw new Error('useTour must be used within TourProvider')
  return ctx
}

// --- Position helpers ---

interface Rect {
  top: number
  left: number
  width: number
  height: number
  bottom: number
  right: number
}

function getElementRect(id: string): Rect | null {
  const el = document.getElementById(id)
  if (!el) return null
  const r = el.getBoundingClientRect()
  return {
    top: r.top,
    left: r.left,
    width: r.width,
    height: r.height,
    bottom: r.bottom,
    right: r.right,
  }
}

const CARD_GAP = 12
const CARD_WIDTH = 320
const CARD_MAX_HEIGHT = 260
const VIEWPORT_PAD = 16

function calculateCardStyle(
  rect: Rect,
  position: ContentPosition,
): React.CSSProperties {
  const vw = window.innerWidth
  const vh = window.innerHeight
  let top = 0
  let left = 0

  switch (position) {
    case 'right':
      top = rect.top
      left = rect.right + CARD_GAP
      if (left + CARD_WIDTH > vw - VIEWPORT_PAD) {
        left = rect.left - CARD_WIDTH - CARD_GAP
      }
      break
    case 'left':
      top = rect.top
      left = rect.left - CARD_WIDTH - CARD_GAP
      if (left < VIEWPORT_PAD) {
        left = rect.right + CARD_GAP
      }
      break
    case 'bottom':
      top = rect.bottom + CARD_GAP
      left = rect.left
      if (top + CARD_MAX_HEIGHT > vh - VIEWPORT_PAD) {
        top = rect.top - CARD_MAX_HEIGHT - CARD_GAP
      }
      break
    case 'top':
      top = rect.top - CARD_MAX_HEIGHT - CARD_GAP
      left = rect.left
      if (top < VIEWPORT_PAD) {
        top = rect.bottom + CARD_GAP
      }
      break
  }

  // Clamp
  top = Math.max(VIEWPORT_PAD, Math.min(top, vh - CARD_MAX_HEIGHT - VIEWPORT_PAD))
  left = Math.max(VIEWPORT_PAD, Math.min(left, vw - CARD_WIDTH - VIEWPORT_PAD))

  return {
    position: 'fixed',
    top,
    left,
    width: CARD_WIDTH,
    zIndex: 101,
  }
}

// --- Provider ---

interface TourProviderProps {
  children: ReactNode
  onComplete?: () => void
  isTourCompleted?: boolean
}

export function TourProvider({
  children,
  onComplete,
  isTourCompleted,
}: TourProviderProps) {
  const [steps, setSteps] = useState<TourStep[]>([])
  const [currentStep, setCurrentStep] = useState(0)
  const [isActive, setIsActive] = useState(false)
  const [showWelcome, setShowWelcome] = useState(false)
  const [targetRect, setTargetRect] = useState<Rect | null>(null)
  const rafRef = useRef<number>(0)

  // Show welcome dialog on first visit
  useEffect(() => {
    if (isTourCompleted === false) {
      const timer = setTimeout(() => setShowWelcome(true), 600)
      return () => clearTimeout(timer)
    }
  }, [isTourCompleted])

  const updateRect = useCallback(() => {
    if (!isActive || steps.length === 0) return
    const step = steps[currentStep]
    if (!step) return
    const rect = getElementRect(step.targetId)
    setTargetRect(rect)
  }, [isActive, steps, currentStep])

  // Reposition on resize/scroll
  useEffect(() => {
    if (!isActive) return

    const handleUpdate = () => {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = requestAnimationFrame(updateRect)
    }

    window.addEventListener('resize', handleUpdate)
    window.addEventListener('scroll', handleUpdate, true)
    return () => {
      window.removeEventListener('resize', handleUpdate)
      window.removeEventListener('scroll', handleUpdate, true)
      cancelAnimationFrame(rafRef.current)
    }
  }, [isActive, updateRect])

  // Run onEnter and recalc rect when step changes
  useEffect(() => {
    if (!isActive || steps.length === 0) return
    const step = steps[currentStep]
    if (!step) return

    if (step.onEnter) {
      step.onEnter()
      // Wait for navigation/render then recalc
      const timer = setTimeout(updateRect, 150)
      return () => clearTimeout(timer)
    } else {
      updateRect()
    }
  }, [isActive, currentStep, steps, updateRect])

  const startTour = useCallback(() => {
    setCurrentStep(0)
    setIsActive(true)
  }, [])

  const stopTour = useCallback(() => {
    setIsActive(false)
    setTargetRect(null)
    setCurrentStep(0)
    localStorage.setItem(TOUR_STORAGE_KEY, 'true')
    onComplete?.()
  }, [onComplete])

  const nextStep = useCallback(() => {
    if (currentStep < steps.length - 1) {
      setCurrentStep((s) => s + 1)
    } else {
      stopTour()
    }
  }, [currentStep, steps.length, stopTour])

  const prevStep = useCallback(() => {
    if (currentStep > 0) {
      setCurrentStep((s) => s - 1)
    }
  }, [currentStep])

  const ctx = useMemo(
    () => ({
      isActive,
      currentStep,
      startTour,
      stopTour,
      nextStep,
      prevStep,
      setSteps,
    }),
    [isActive, currentStep, startTour, stopTour, nextStep, prevStep],
  )

  const step = isActive ? steps[currentStep] : null
  const isLast = currentStep === steps.length - 1

  return (
    <TourContext.Provider value={ctx}>
      {children}

      {/* Welcome dialog */}
      <AlertDialog open={showWelcome} onOpenChange={setShowWelcome}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Bem-vindo ao EscalaFlow!</AlertDialogTitle>
            <AlertDialogDescription>
              Quer fazer um tour rapido pelo sistema? Vai levar menos de 1
              minuto e te mostra tudo que precisa saber.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => {
                setShowWelcome(false)
                localStorage.setItem(TOUR_STORAGE_KEY, 'true')
              }}
            >
              Agora nao
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setShowWelcome(false)
                startTour()
              }}
            >
              Iniciar Tour
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Overlay + Content */}
      {isActive && step && targetRect && (
        <>
          {/* Backdrop escuro */}
          <div
            className="fixed inset-0 z-[99] bg-black/50 transition-opacity"
            onClick={stopTour}
          />

          {/* Highlight sobre o elemento */}
          <div
            className="fixed z-[100] rounded-md border-2 border-primary bg-primary/10 transition-all duration-200 pointer-events-none"
            style={{
              top: targetRect.top - 4,
              left: targetRect.left - 4,
              width: targetRect.width + 8,
              height: targetRect.height + 8,
            }}
          />

          {/* Card de conteudo */}
          <div
            className="rounded-lg border bg-popover p-4 text-popover-foreground shadow-lg"
            style={calculateCardStyle(targetRect, step.position)}
          >
            <div className="mb-3">{step.content}</div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">
                {currentStep + 1} de {steps.length}
              </span>
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={stopTour}
                >
                  Pular
                </Button>
                {currentStep > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={prevStep}
                  >
                    Anterior
                  </Button>
                )}
                <Button size="sm" onClick={nextStep}>
                  {isLast ? 'Concluir' : 'Proximo'}
                </Button>
              </div>
            </div>
          </div>
        </>
      )}
    </TourContext.Provider>
  )
}
