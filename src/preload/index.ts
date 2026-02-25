import { contextBridge, ipcRenderer } from 'electron'

// Expose only whitelisted IPC methods to renderer
contextBridge.exposeInMainWorld('electron', {
  ipcRenderer: {
    invoke: (channel: string, ...args: any[]) => ipcRenderer.invoke(channel, ...args),
    on: (channel: string, callback: (...args: any[]) => void) => {
      const wrapper = (_event: Electron.IpcRendererEvent, ...args: any[]) => callback(...args)
      ipcRenderer.on(channel, wrapper)
      // Return disposer so callers can remove just their own listener
      return () => { ipcRenderer.removeListener(channel, wrapper) }
    },
    removeAllListeners: (channel: string) => {
      ipcRenderer.removeAllListeners(channel)
    },
  },
})
