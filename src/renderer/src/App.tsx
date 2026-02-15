import { useCallback, useEffect, useState } from 'react'
import { Routes, Route, useNavigate } from 'react-router-dom'
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar'
import { AppSidebar } from './componentes/AppSidebar'
import { ErrorBoundary } from './componentes/ErrorBoundary'
import { TourProvider } from './componentes/Tour'
import { TourSetup } from './componentes/TourSetup'
import { TOUR_NAVIGATE_EVENT, TOUR_STEP_IDS, TOUR_STORAGE_KEY } from '@/lib/tour-constants'
import { Dashboard } from './paginas/Dashboard'
import { SetorLista } from './paginas/SetorLista'
import { SetorDetalhe } from './paginas/SetorDetalhe'
import { EscalaPagina } from './paginas/EscalaPagina'
import { ColaboradorLista } from './paginas/ColaboradorLista'
import { ColaboradorDetalhe } from './paginas/ColaboradorDetalhe'
import { ContratoLista } from './paginas/ContratoLista'
import { EmpresaConfig } from './paginas/EmpresaConfig'
import { NaoEncontrado } from './paginas/NaoEncontrado'

export function App() {
  const navigate = useNavigate()
  const [tourCompleted, setTourCompleted] = useState(() =>
    localStorage.getItem(TOUR_STORAGE_KEY) === 'true',
  )

  // Listen for tour navigation events
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
    <SidebarProvider>
      <TourProvider
        onComplete={handleTourComplete}
        isTourCompleted={tourCompleted}
      >
        <AppSidebar />
        <SidebarInset>
          <div id={TOUR_STEP_IDS.CONTENT_AREA} className="flex-1">
            <ErrorBoundary>
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/setores" element={<SetorLista />} />
                <Route path="/setores/:id" element={<SetorDetalhe />} />
                <Route path="/setores/:id/escala" element={<EscalaPagina />} />
                <Route path="/colaboradores" element={<ColaboradorLista />} />
                <Route path="/colaboradores/:id" element={<ColaboradorDetalhe />} />
                <Route path="/tipos-contrato" element={<ContratoLista />} />
                <Route path="/empresa" element={<EmpresaConfig />} />
                <Route path="*" element={<NaoEncontrado />} />
              </Routes>
            </ErrorBoundary>
          </div>
        </SidebarInset>
        <TourSetup />
      </TourProvider>
    </SidebarProvider>
  )
}
