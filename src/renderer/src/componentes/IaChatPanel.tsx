import { useEffect, useRef } from 'react'
import { useIaStore } from '@/store/iaStore'
import { IaChatHeader } from './IaChatHeader'
import { IaChatView } from './IaChatView'
import { IaHistoricoView } from './IaHistoricoView'

export function IaChatPanel() {
  const { aberto, tela, inicializar } = useIaStore()
  const inicializadoRef = useRef(false)

  useEffect(() => {
    if (aberto && !inicializadoRef.current) {
      inicializadoRef.current = true
      inicializar()
    }
  }, [aberto, inicializar])

  if (!aberto) return null

  return (
    <aside className="w-[380px] min-w-0 flex flex-col shrink-0 border-l bg-background overflow-hidden">
      <IaChatHeader />
      {tela === 'chat' ? <IaChatView /> : <IaHistoricoView />}
    </aside>
  )
}
