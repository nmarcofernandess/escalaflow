import { useEffect, useState } from 'react'
import type { Setor } from '@escalaflow/shared'

export function SetorLista() {
  const [setores, setSetores] = useState<Setor[]>([])
  const [nome, setNome] = useState('')

  const carregar = () => {
    fetch('/api/setores?ativo=true')
      .then((r) => r.json())
      .then(setSetores)
  }

  useEffect(carregar, [])

  const criar = async () => {
    if (!nome.trim()) return
    await fetch('/api/setores', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nome, hora_abertura: '08:00', hora_fechamento: '22:00' }),
    })
    setNome('')
    carregar()
  }

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-900 mb-6">Setores</h2>

      {/* Form rapido */}
      <div className="flex gap-2 mb-6">
        <input
          type="text"
          placeholder="Nome do setor..."
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && criar()}
          className="border border-gray-300 rounded-md px-3 py-2 text-sm flex-1"
        />
        <button
          onClick={criar}
          className="bg-blue-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-blue-700"
        >
          + Novo Setor
        </button>
      </div>

      {/* Cards */}
      {setores.length === 0 ? (
        <p className="text-gray-500 text-sm">Nenhum setor cadastrado.</p>
      ) : (
        <div className="grid grid-cols-3 gap-4">
          {setores.map((s) => (
            <div key={s.id} className="bg-white border border-gray-200 rounded-lg p-4">
              <p className="font-medium text-gray-900">{s.nome}</p>
              <p className="text-sm text-gray-500">{s.hora_abertura} - {s.hora_fechamento}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
