import { useEffect, useState } from 'react'
import type { DashboardResumo } from '@escalaflow/shared'

export function Dashboard() {
  const [dados, setDados] = useState<DashboardResumo | null>(null)

  useEffect(() => {
    fetch('/api/dashboard')
      .then((r) => r.json())
      .then(setDados)
  }, [])

  if (!dados) return <p className="text-gray-500">Carregando...</p>

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-900 mb-6">Dashboard</h2>

      {/* Widgets */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        <Widget label="Setores" value={dados.total_setores} />
        <Widget label="Colaboradores" value={dados.total_colaboradores} />
        <Widget label="Em ferias" value={dados.total_em_ferias} />
        <Widget label="Em atestado" value={dados.total_em_atestado} />
      </div>

      {/* Alertas */}
      {dados.alertas.length > 0 && (
        <div className="mb-8">
          <h3 className="text-lg font-semibold text-gray-800 mb-3">Alertas</h3>
          <div className="space-y-2">
            {dados.alertas.map((a, i) => (
              <div key={i} className="bg-amber-50 border border-amber-200 rounded-md px-4 py-2 text-sm text-amber-800">
                {a.mensagem}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Setores */}
      <h3 className="text-lg font-semibold text-gray-800 mb-3">Setores</h3>
      {dados.setores.length === 0 ? (
        <p className="text-gray-500 text-sm">Nenhum setor cadastrado.</p>
      ) : (
        <div className="grid grid-cols-3 gap-4">
          {dados.setores.map((s) => (
            <div key={s.id} className="bg-white border border-gray-200 rounded-lg p-4">
              <p className="font-medium text-gray-900">{s.nome}</p>
              <p className="text-sm text-gray-500">{s.total_colaboradores} colaboradores</p>
              <span className={`inline-block mt-2 text-xs px-2 py-0.5 rounded-full ${
                s.escala_atual === 'OFICIAL' ? 'bg-green-100 text-green-700' :
                s.escala_atual === 'RASCUNHO' ? 'bg-yellow-100 text-yellow-700' :
                'bg-gray-100 text-gray-500'
              }`}>
                {s.escala_atual === 'SEM_ESCALA' ? 'Sem escala' : s.escala_atual}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function Widget({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4">
      <p className="text-sm text-gray-500">{label}</p>
      <p className="text-2xl font-bold text-gray-900">{value}</p>
    </div>
  )
}
