import { create } from 'zustand'

interface RestorePreviewStore {
  active: boolean
  snapshotLabel: string
  preRestoreFilename: string | null

  entrarPreview: (snapshotLabel: string, preRestoreFilename: string | null) => void
  aplicar: () => void
  sair: () => Promise<void>
}

const ipc = window.electron.ipcRenderer

export const useRestorePreviewStore = create<RestorePreviewStore>((set, get) => ({
  active: false,
  snapshotLabel: '',
  preRestoreFilename: null,

  entrarPreview: (snapshotLabel, preRestoreFilename) => {
    set({ active: true, snapshotLabel, preRestoreFilename })
  },

  aplicar: () => {
    set({ active: false, snapshotLabel: '', preRestoreFilename: null })
  },

  sair: async () => {
    const { preRestoreFilename } = get()
    if (preRestoreFilename) {
      await ipc.invoke('backup.snapshots.restaurarPreRestore', { filename: preRestoreFilename })
    }
    set({ active: false, snapshotLabel: '', preRestoreFilename: null })
  },
}))
