import type { IaLocalStatus } from '@shared/types'

const ipc = window.electron.ipcRenderer

export const servicoIaLocal = {
  status: () =>
    ipc.invoke('ia.local.status') as Promise<IaLocalStatus>,

  models: () =>
    ipc.invoke('ia.local.models') as Promise<Array<{
      id: string
      label: string
      filename: string
      size_bytes: number
      ram_minima_gb: number
      descricao: string
      baixado: boolean
    }>>,

  download: (model_id: string) =>
    ipc.invoke('ia.local.download', { model_id }) as Promise<{ sucesso: boolean }>,

  cancelDownload: () =>
    ipc.invoke('ia.local.cancelDownload') as Promise<{ sucesso: boolean }>,

  deleteModel: (model_id: string) =>
    ipc.invoke('ia.local.deleteModel', { model_id }) as Promise<{ sucesso: boolean }>,

  unload: () =>
    ipc.invoke('ia.local.unload') as Promise<{ sucesso: boolean }>,
}
