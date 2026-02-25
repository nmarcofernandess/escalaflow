import { useEffect, useRef } from 'react'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { useIaStore } from '@/store/iaStore'
import { PageHeader } from '@/componentes/PageHeader'
import { IaChatView } from '@/componentes/IaChatView'
import { IaHistoricoView } from '@/componentes/IaHistoricoView'

export function IaPagina() {
  const { inicializar, novaConversa } = useIaStore()
  const inicializadoRef = useRef(false)

  useEffect(() => {
    if (!inicializadoRef.current) {
      inicializadoRef.current = true
      inicializar()
    }
  }, [inicializar])

  return (
    <div className="flex h-full flex-col">
      <PageHeader breadcrumbs={[{ label: 'Assistente IA' }]} />

      <div className="flex flex-1 min-h-0">
        {/* Coluna esquerda: historico */}
        <div className="flex w-[280px] shrink-0 flex-col border-r min-h-0">
          <div className="flex items-center justify-between px-3 h-10 shrink-0">
            <span className="text-sm font-medium">Conversas</span>
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              onClick={() => novaConversa()}
            >
              <Plus className="size-4" />
            </Button>
          </div>
          <Separator />
          <IaHistoricoView />
        </div>

        {/* Coluna direita: chat com max-width */}
        <div className="flex flex-1 min-h-0 min-w-0 justify-center">
          <div className="flex flex-col min-h-0 w-full max-w-3xl">
            <IaChatView />
          </div>
        </div>
      </div>
    </div>
  )
}
