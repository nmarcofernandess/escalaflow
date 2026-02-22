import { useCallback, useEffect, useState } from 'react'
import { Routes, Route, useNavigate } from 'react-router-dom'
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
import { NaoEncontrado } from './paginas/NaoEncontrado'

export function App() {
  const navigate = useNavigate()
  const [tourCompleted, setTourCompleted] = useState(() =>
    localStorage.getItem(TOUR_STORAGE_KEY) === 'true',
  )
  const { toggleAberto } = useIaStore()

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'j' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        toggleAberto()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [toggleAberto])

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
        <SidebarInset className="h-full overflow-hidden">
          <div id={TOUR_STEP_IDS.CONTENT_AREA} className="flex flex-1 flex-col overflow-hidden">
            <div className="flex flex-1 overflow-hidden">
              <main className="flex-1 min-w-0 overflow-auto">
                <ErrorBoundary>
                  <Routes>
                    <Route path="/" element={<Dashboard />} />
                    <Route path="/setores" element={<SetorLista />} />
                    <Route path="/setores/:id" element={<SetorDetalhe />} />
                    <Route path="/setores/:id/escala" element={<EscalaPagina />} />
                    <Route path="/escalas" element={<EscalasHub />} />
                    <Route path="/colaboradores" element={<ColaboradorLista />} />
                    <Route path="/colaboradores/:id" element={<ColaboradorDetalhe />} />
                    <Route path="/tipos-contrato" element={<ContratoLista />} />
                    <Route path="/empresa" element={<EmpresaConfig />} />
                    <Route path="/feriados" element={<FeriadosPagina />} />
                    <Route path="/configuracoes" element={<ConfiguracoesPagina />} />
                    <Route path="/regras" element={<RegrasPagina />} />
                    <Route path="*" element={<NaoEncontrado />} />
                  </Routes>
                </ErrorBoundary>
              </main>
              <IaChatPanel />
            </div>
          </div>
        </SidebarInset>
        <TourSetup />
      </TourProvider>
    </SidebarProvider>
  )
}
