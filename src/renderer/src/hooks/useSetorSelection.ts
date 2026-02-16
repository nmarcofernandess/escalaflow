import { useState, useCallback, useMemo } from 'react'

export type CheckboxState = 'none' | 'indeterminate' | 'all'

export function useSetorSelection() {
  const [selectedSetores, setSelectedSetores] = useState<Set<number>>(new Set())
  const [selectionMode, setSelectionMode] = useState(false)

  const toggleSelection = useCallback((setorId: number) => {
    setSelectedSetores((prev) => {
      const next = new Set(prev)
      if (next.has(setorId)) {
        next.delete(setorId)
      } else {
        next.add(setorId)
      }
      return next
    })
  }, [])

  const selectAll = useCallback((setorIds: number[]) => {
    setSelectedSetores(new Set(setorIds))
  }, [])

  const clearSelection = useCallback(() => {
    setSelectedSetores(new Set())
  }, [])

  const isSelected = useCallback(
    (setorId: number) => selectedSetores.has(setorId),
    [selectedSetores],
  )

  const enterSelectionMode = useCallback(() => {
    setSelectionMode(true)
  }, [])

  const exitSelectionMode = useCallback(() => {
    setSelectionMode(false)
    setSelectedSetores(new Set())
  }, [])

  const selectedCount = selectedSetores.size

  const getCheckboxState = useCallback(
    (totalEligible: number): CheckboxState => {
      if (selectedCount === 0) return 'none'
      if (selectedCount >= totalEligible) return 'all'
      return 'indeterminate'
    },
    [selectedCount],
  )

  return {
    selectedSetores,
    selectionMode,
    selectedCount,
    toggleSelection,
    selectAll,
    clearSelection,
    isSelected,
    enterSelectionMode,
    exitSelectionMode,
    getCheckboxState,
  }
}
