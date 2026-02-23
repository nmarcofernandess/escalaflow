import { useEffect, useRef } from 'react'
import { useIaStore } from '@/store/iaStore'
import { cn } from '@/lib/utils'
import { IaChatHeader } from './IaChatHeader'
import { IaChatView } from './IaChatView'
import { IaHistoricoView } from './IaHistoricoView'

const IA_PANEL_WIDTH = 380

export function IaChatPanel() {
  const { aberto, tela, inicializar } = useIaStore()
  const inicializadoRef = useRef(false)

  useEffect(() => {
    if (aberto && !inicializadoRef.current) {
      inicializadoRef.current = true
      inicializar()
    }
  }, [aberto, inicializar])

  return (
    <div
      className={cn(
        'h-full shrink-0 overflow-hidden border-l bg-background transition-[width] duration-200 ease-linear',
        aberto ? 'w-[380px]' : 'w-0 border-l-0'
      )}
    >
      <div
        className={cn(
          'flex h-full flex-col',
          !aberto && 'invisible'
        )}
        style={{ width: IA_PANEL_WIDTH }}
        aria-hidden={!aberto}
      >
        <IaChatHeader />
        {tela === 'chat' ? <IaChatView /> : <IaHistoricoView />}
      </div>
    </div>
  )
}
