import { Link, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'

const NAV_ITEMS = [
  { path: '/', label: 'Dashboard' },
  { path: '/setores', label: 'Setores' },
  { path: '/tipos-contrato', label: 'Contratos' },
]

export function AppShell({ children }: { children: ReactNode }) {
  const location = useLocation()

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Sidebar */}
      <aside className="w-56 bg-white border-r border-gray-200 flex flex-col">
        <div className="p-4 border-b border-gray-200">
          <h1 className="text-lg font-bold text-gray-900">EscalaFlow</h1>
          <p className="text-xs text-gray-500">Gestao de Escalas</p>
        </div>
        <nav className="flex-1 p-2">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.path}
              to={item.path}
              className={`block px-3 py-2 rounded-md text-sm mb-1 ${
                location.pathname === item.path
                  ? 'bg-blue-50 text-blue-700 font-medium'
                  : 'text-gray-700 hover:bg-gray-100'
              }`}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </aside>

      {/* Content */}
      <main className="flex-1 overflow-auto p-6">
        {children}
      </main>
    </div>
  )
}
