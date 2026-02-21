import { create } from 'zustand'
import { IaMensagem } from '@shared/index'

interface IaStore {
    aberto: boolean
    setAberto: (aberto: boolean) => void
    toggleAberto: () => void
    historico: IaMensagem[]
    adicionarMensagem: (msg: IaMensagem) => void
    limparHistorico: () => void
    carregando: boolean
    setCarregando: (carregando: boolean) => void
}

export const useIaStore = create<IaStore>((set) => ({
    aberto: false,
    setAberto: (aberto) => set({ aberto }),
    toggleAberto: () => set((state) => ({ aberto: !state.aberto })),
    historico: [],
    adicionarMensagem: (msg) => set((state) => ({ historico: [...state.historico, msg] })),
    limparHistorico: () => set({ historico: [] }),
    carregando: false,
    setCarregando: (carregando) => set({ carregando })
}))
