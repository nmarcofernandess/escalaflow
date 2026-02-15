import { create } from 'zustand'

interface AppState {
  setorAtivoId: number | null
  setSetorAtivo: (id: number | null) => void
}

export const useAppStore = create<AppState>((set) => ({
  setorAtivoId: null,
  setSetorAtivo: (id) => set({ setorAtivoId: id }),
}))
