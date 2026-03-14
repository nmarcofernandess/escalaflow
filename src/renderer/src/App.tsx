import { useCallback, useEffect, useState } from 'react'
import { Outlet, useNavigate, useLocation, createHashRouter } from 'react-router-dom'
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar'
import { useIaStore } from '@/store/iaStore'
import { AppSidebar } from './componentes/AppSidebar'
import { ErrorBoundary } from './componentes/ErrorBoundary'
import { TourProvider } from './componentes/Tour'
import { TourSetup } from './componentes/TourSetup'
import { IaChatPanel } from './componentes/IaChatPanel'
import { TOUR_NAVIGATE_EVENT, TOUR_STEP_IDS, TOUR_STORAGE_KEY } from '@/lib/tour-constants'
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
import { NaoEncontrado } from './paginas/NaoEncontrado'

function AppLayout() {
  const navigate = useNavigate()
  const location = useLocation()
  const [tourCompleted, setTourCompleted] = useState(() =>
    localStorage.getItem(TOUR_STORAGE_KEY) === 'true',
  )
  const { toggleAberto } = useIaStore()

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

  const handleTourComplete = useCallback(() => {
    setTourCompleted(true)
  }, [])

  return (
    <SidebarProvider className="h-svh overflow-hidden">
      <TourProvider
        onComplete={handleTourComplete}
        isTourCompleted={tourCompleted}
      >
        <AppSidebar />
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
        <TourSetup />
      </TourProvider>
    </SidebarProvider>
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
      { path: '/ia', element: <IaPagina /> },
      { path: '*', element: <NaoEncontrado /> },
    ],
  },
])
