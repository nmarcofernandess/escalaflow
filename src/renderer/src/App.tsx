import { useCallback, useEffect, useState } from 'react'
import { Outlet, useNavigate, useLocation, createHashRouter } from 'react-router-dom'
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar'
import { useIaStore } from '@/store/iaStore'
import { useAppDataStore } from '@/store/appDataStore'
import { AppSidebar } from './componentes/AppSidebar'
import { ErrorBoundary } from './componentes/ErrorBoundary'
import { IaChatPanel } from './componentes/IaChatPanel'
import {
  OnboardingTourProvider,
  useOnboardingTour,
} from './componentes/onboarding/OnboardingTour'
import { escalaflowTourSteps } from './componentes/onboarding/tour-steps'
import SetupWizard from './componentes/onboarding/SetupWizard'
import { TOUR_NAVIGATE_EVENT, TOUR_STEP_IDS } from '@/lib/tour-constants'
import { Dashboard } from './paginas/Dashboard'
import { SetorLista } from './paginas/SetorLista'
import { SetorDetalhe } from './paginas/SetorDetalhe'
import { EscalaPagina } from './paginas/EscalaPagina'
import { ColaboradorLista } from './paginas/ColaboradorLista'
import { ColaboradorDetalhe } from './paginas/ColaboradorDetalhe'
import { ContratoLista } from './paginas/ContratoLista'
import { EscalasHub } from './paginas/EscalasHub'
import { EmpresaConfig } from './paginas/EmpresaConfig'
import { FeriadosPagina } from './paginas/FeriadosPagina'
import { ConfiguracoesPagina } from './paginas/ConfiguracoesPagina'
import { RegrasPagina } from './paginas/RegrasPagina'
import { MemoriaPagina } from './paginas/MemoriaPagina'
import { IaPagina } from './paginas/IaPagina'
import { SimulaCicloPagina } from './paginas/SimulaCicloPagina'
import { TerminalPagina } from './paginas/TerminalPagina'
import { NaoEncontrado } from './paginas/NaoEncontrado'

function AppLayout() {
  const navigate = useNavigate()
  const location = useLocation()
  const [showWizard, setShowWizard] = useState(false)
  const { toggleAberto } = useIaStore()
  const initAppData = useAppDataStore((s) => s.init)
  const invalidate = useAppDataStore((s) => s.invalidate)

  // A1: Carrega entidades globais ao abrir o app
  useEffect(() => {
    initAppData()
  }, [initAppData])

  // A6: Listener de invalidação — main process notifica quando dados mudam
  useEffect(() => {
    const cleanup = window.electron.ipcRenderer.on(
      'data:invalidated',
      (payload: { entidades: string[]; setor_id?: number }) => {
        invalidate(payload.entidades, payload.setor_id)
      },
    )
    return cleanup
  }, [invalidate])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'j' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        if (location.pathname === '/ia') return
        toggleAberto()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [toggleAberto, location.pathname])

  useEffect(() => {
    const handler = (e: Event) => {
      const path = (e as CustomEvent<{ path: string }>).detail.path
      navigate(path)
    }
    window.addEventListener(TOUR_NAVIGATE_EVENT, handler)
    return () => window.removeEventListener(TOUR_NAVIGATE_EVENT, handler)
  }, [navigate])

  // Verifica onboarding no primeiro boot (gate no DB via config.get, não localStorage)
  useEffect(() => {
    window.electron.ipcRenderer
      .invoke('config.get', { key: 'onboarding_complete' })
      .then((result: { key: string; value: unknown } | null) => {
        const v = result?.value
        const isComplete = v === '"true"' || v === 'true' || v === true
        if (!isComplete) {
          setShowWizard(true)
        }
      })
      .catch(() => setShowWizard(true))
  }, [])

  return (
    <SidebarProvider className="h-svh overflow-hidden">
      {/* Tour é uma engine ISOLADA do Setup: on-demand, sem auto-abrir no boot
          e sem flag de conclusão. O gate de 1º boot continua sendo só o
          onboarding_complete do Setup. */}
      <OnboardingTourProvider steps={escalaflowTourSteps}>
        <AppSidebar onReopenSetup={() => setShowWizard(true)} />
        <SidebarInset className="h-full min-h-0 overflow-hidden">
          <div id={TOUR_STEP_IDS.CONTENT_AREA} className="flex min-h-0 flex-1">
            <main className="min-h-0 flex-1 min-w-0 overflow-auto">
              <ErrorBoundary>
                <Outlet />
              </ErrorBoundary>
            </main>
            {location.pathname !== '/ia' && <IaChatPanel />}
          </div>
        </SidebarInset>
        {/* WizardComTour vive DENTRO do provider para poder chamar startTour
            na emenda "Ver como funciona". showWizard segue no AppLayout. */}
        {showWizard && (
          <WizardComTour onClose={() => setShowWizard(false)} />
        )}
      </OnboardingTourProvider>
    </SidebarProvider>
  )
}

/**
 * Consumidor fino do provider: liga o Setup ao Tour. O botão "Ver como
 * funciona" só dispara o tour DEPOIS de fechar o wizard (senão o tour abriria
 * atrás do modal Radix, com a sidebar inerte).
 */
function WizardComTour({ onClose }: { onClose: () => void }) {
  const { startTour } = useOnboardingTour()
  return (
    <SetupWizard
      onComplete={onClose}
      // SetupWizard já chama handleFinish (grava onboarding_complete + onClose)
      // antes de disparar onStartTour — aqui só falta iniciar o tour.
      onStartTour={startTour}
    />
  )
}

export const router = createHashRouter([
  {
    element: <AppLayout />,
    children: [
      { path: '/', element: <Dashboard /> },
      { path: '/setores', element: <SetorLista /> },
      { path: '/setores/:id', element: <SetorDetalhe /> },
      { path: '/setores/:id/escala', element: <EscalaPagina /> },
      { path: '/escalas', element: <EscalasHub /> },
      { path: '/simula-ciclo', element: <SimulaCicloPagina /> },
      { path: '/colaboradores', element: <ColaboradorLista /> },
      { path: '/colaboradores/:id', element: <ColaboradorDetalhe /> },
      { path: '/tipos-contrato', element: <ContratoLista /> },
      { path: '/empresa', element: <EmpresaConfig /> },
      { path: '/feriados', element: <FeriadosPagina /> },
      { path: '/configuracoes', element: <ConfiguracoesPagina /> },
      { path: '/regras', element: <RegrasPagina /> },
      { path: '/memoria', element: <MemoriaPagina /> },
      { path: '/terminal', element: <TerminalPagina /> },
      { path: '/ia', element: <IaPagina /> },
      { path: '*', element: <NaoEncontrado /> },
    ],
  },
])
