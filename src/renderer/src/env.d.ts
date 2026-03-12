/// <reference types="electron-vite/client" />

declare module '*.png' {
  const src: string
  export default src
}

declare module '*.svg' {
  const src: string
  export default src
}

declare module '*.jpg' {
  const src: string
  export default src
}

interface ImportMetaEnv {
  readonly DEV: boolean
  readonly PROD: boolean
  readonly MODE: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

interface Window {
  electron: {
    ipcRenderer: {
      invoke(channel: string, ...args: any[]): Promise<any>
      on(channel: string, callback: (...args: any[]) => void): (() => void) | void
      removeAllListeners(channel: string): void
    }
  }
}
