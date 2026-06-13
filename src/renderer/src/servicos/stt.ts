import type { SttModelId, SttStatus, SttTranscriptResult } from '@shared/index'

const ipc = window.electron.ipcRenderer

export const servicoStt = {
  status: () => ipc.invoke('ia.stt.status') as Promise<SttStatus>,
  models: () => ipc.invoke('ia.stt.models') as Promise<SttStatus>,
  download: (model_id: SttModelId) => ipc.invoke('ia.stt.download', { model_id }) as Promise<{ sucesso: boolean }>,
  deleteModel: (model_id: SttModelId) => ipc.invoke('ia.stt.deleteModel', { model_id }) as Promise<{ sucesso: boolean }>,
  transcribe: (input: {
    wav_base64: string
    model_id?: SttModelId
    post_process?: boolean
    post_process_mode?: 'clean_prompt' | 'formal_message' | 'rh_note'
  }) => ipc.invoke('ia.stt.transcribe', input) as Promise<SttTranscriptResult>,
}
