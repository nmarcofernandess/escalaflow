import { useState, useCallback } from 'react'
import { LayoutGrid, Table2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

export type ViewMode = 'card' | 'table'

interface ViewToggleProps {
  mode: ViewMode
  onChange: (mode: ViewMode) => void
}

export function ViewToggle({ mode, onChange }: ViewToggleProps) {
  return (
    <div className="flex items-center rounded-md border">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant={mode === 'card' ? 'secondary' : 'ghost'}
            size="icon"
            className="size-8 rounded-r-none border-0"
            onClick={() => onChange('card')}
          >
            <LayoutGrid className="size-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">Cards</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant={mode === 'table' ? 'secondary' : 'ghost'}
            size="icon"
            className="size-8 rounded-l-none border-0"
            onClick={() => onChange('table')}
          >
            <Table2 className="size-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">Tabela</TooltipContent>
      </Tooltip>
    </div>
  )
}

export function useViewMode(key: string, defaultMode: ViewMode = 'table'): [ViewMode, (mode: ViewMode) => void] {
  const storageKey = `ef-view-${key}`
  const [mode, setMode] = useState<ViewMode>(() => {
    const stored = localStorage.getItem(storageKey)
    return (stored === 'card' || stored === 'table') ? stored : defaultMode
  })

  const setAndPersist = useCallback((newMode: ViewMode) => {
    setMode(newMode)
    localStorage.setItem(storageKey, newMode)
  }, [storageKey])

  return [mode, setAndPersist]
}
