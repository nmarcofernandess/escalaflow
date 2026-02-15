import { useState, useCallback } from 'react'
import { Table2, GanttChart } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

export type EscalaViewMode = 'grid' | 'timeline'

interface EscalaViewToggleProps {
  mode: EscalaViewMode
  onChange: (mode: EscalaViewMode) => void
}

export function EscalaViewToggle({ mode, onChange }: EscalaViewToggleProps) {
  return (
    <div className="flex items-center rounded-md border">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant={mode === 'grid' ? 'secondary' : 'ghost'}
            size="icon"
            className="size-8 rounded-r-none border-0"
            onClick={() => onChange('grid')}
          >
            <Table2 className="size-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">Grade</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant={mode === 'timeline' ? 'secondary' : 'ghost'}
            size="icon"
            className="size-8 rounded-l-none border-0"
            onClick={() => onChange('timeline')}
          >
            <GanttChart className="size-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">Timeline</TooltipContent>
      </Tooltip>
    </div>
  )
}

export function useEscalaViewMode(): [EscalaViewMode, (mode: EscalaViewMode) => void] {
  const storageKey = 'ef-view-escala'
  const [mode, setMode] = useState<EscalaViewMode>(() => {
    const stored = localStorage.getItem(storageKey)
    return (stored === 'grid' || stored === 'timeline') ? stored : 'grid'
  })

  const setAndPersist = useCallback((newMode: EscalaViewMode) => {
    setMode(newMode)
    localStorage.setItem(storageKey, newMode)
  }, [storageKey])

  return [mode, setAndPersist]
}
