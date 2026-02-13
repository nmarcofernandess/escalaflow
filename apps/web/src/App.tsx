import { Routes, Route } from 'react-router-dom'
import { AppShell } from './componentes/AppShell'
import { Dashboard } from './paginas/Dashboard'
import { SetorLista } from './paginas/SetorLista'
import { ContratoLista } from './paginas/ContratoLista'

export function App() {
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/setores" element={<SetorLista />} />
        <Route path="/tipos-contrato" element={<ContratoLista />} />
      </Routes>
    </AppShell>
  )
}
