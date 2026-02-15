import { Routes, Route } from 'react-router-dom'
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar'
import { AppSidebar } from './componentes/AppSidebar'
import { OnboardingTour } from './componentes/OnboardingTour'
import { ErrorBoundary } from './componentes/ErrorBoundary'
import { Dashboard } from './paginas/Dashboard'
import { SetorLista } from './paginas/SetorLista'
import { SetorDetalhe } from './paginas/SetorDetalhe'
import { EscalaPagina } from './paginas/EscalaPagina'
import { ColaboradorLista } from './paginas/ColaboradorLista'
import { ColaboradorDetalhe } from './paginas/ColaboradorDetalhe'
import { ContratoLista } from './paginas/ContratoLista'
import { EmpresaConfig } from './paginas/EmpresaConfig'
import { Perfil } from './paginas/Perfil'
import { NaoEncontrado } from './paginas/NaoEncontrado'

export function App() {
  return (
    <SidebarProvider>
      <AppSidebar />
      <OnboardingTour />
      <SidebarInset>
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
            <Route path="/perfil" element={<Perfil />} />
            <Route path="*" element={<NaoEncontrado />} />
          </Routes>
        </ErrorBoundary>
      </SidebarInset>
    </SidebarProvider>
  )
}
