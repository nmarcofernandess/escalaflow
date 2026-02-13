import { useEffect, useState } from 'react'
import type { TipoContrato } from '@escalaflow/shared'

export function ContratoLista() {
  const [tipos, setTipos] = useState<TipoContrato[]>([])

  useEffect(() => {
    fetch('/api/tipos-contrato')
      .then((r) => r.json())
      .then(setTipos)
  }, [])

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-900 mb-6">Tipos de Contrato</h2>

      {tipos.length === 0 ? (
        <p className="text-gray-500 text-sm">Nenhum tipo cadastrado. Rode o seed.</p>
      ) : (
        <div className="grid grid-cols-3 gap-4">
          {tipos.map((t) => (
            <div key={t.id} className="bg-white border border-gray-200 rounded-lg p-4">
              <p className="font-medium text-gray-900">{t.nome}</p>
              <p className="text-sm text-gray-500">{t.horas_semanais}h/semana | {t.dias_trabalho} dias</p>
              <p className="text-xs text-gray-400 mt-1">
                {t.trabalha_domingo ? 'Trabalha domingo' : 'Nao trabalha domingo'} | Max {t.max_minutos_dia / 60}h/dia
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
