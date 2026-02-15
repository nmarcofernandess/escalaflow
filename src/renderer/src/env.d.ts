/// <reference types="electron-vite/client" />

interface Window {
  electron: {
    ipcRenderer: {
      invoke(channel: string, ...args: any[]): Promise<any>
      on(channel: string, callback: (...args: any[]) => void): void
      removeAllListeners(channel: string): void
    }
  }
}
