import { useState, useCallback } from 'react'
import { Table2, Rows3 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

export type CicloViewMode = 'tabela' | 'resumo'

interface CicloViewToggleProps {
  mode: CicloViewMode
  onChange: (mode: CicloViewMode) => void
}

export function CicloViewToggle({ mode, onChange }: CicloViewToggleProps) {
  return (
    <div className="flex items-center rounded-md border">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant={mode === 'tabela' ? 'secondary' : 'ghost'}
            size="icon"
            className="size-8 rounded-r-none border-0"
            onClick={() => onChange('tabela')}
          >
            <Table2 className="size-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">Semana</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant={mode === 'resumo' ? 'secondary' : 'ghost'}
            size="icon"
            className="size-8 rounded-l-none border-0"
            onClick={() => onChange('resumo')}
          >
            <Rows3 className="size-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">Ciclo completo</TooltipContent>
      </Tooltip>
    </div>
  )
}

const CICLO_VIEW_STORAGE_KEY = 'ef-view-ciclo'

export function useCicloViewMode(): [CicloViewMode, (m: CicloViewMode) => void] {
  const [mode, setMode] = useState<CicloViewMode>(() => {
    const stored = localStorage.getItem(CICLO_VIEW_STORAGE_KEY)
    return stored === 'tabela' || stored === 'resumo' ? stored : 'tabela'
  })

  const setAndPersist = useCallback((newMode: CicloViewMode) => {
    setMode(newMode)
    localStorage.setItem(CICLO_VIEW_STORAGE_KEY, newMode)
  }, [])

  return [mode, setAndPersist]
}
