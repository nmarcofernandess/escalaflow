import type { App, BrowserWindow, IpcMain } from 'electron'
import pkg from 'electron-updater'

export interface UpdaterLike {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  checkForUpdates: () => Promise<unknown>
  quitAndInstall: () => void
  on: (event: string, listener: (...args: unknown[]) => void) => unknown
}

export interface SetupAutoUpdaterOptions {
  app: Pick<App, 'getVersion'>
  ipcMain: Pick<IpcMain, 'handle'>
  getMainWindow: () => BrowserWindow | null
  isDevelopment: boolean
  updater?: UpdaterLike
  schedule?: (callback: () => void, delayMs: number) => unknown
}

const updaterLog = (...args: unknown[]) => console.log('[AUTO-UPDATER]', ...args)

function getDefaultUpdater(): UpdaterLike {
  return pkg.autoUpdater as unknown as UpdaterLike
}

function send(
  getMainWindow: () => BrowserWindow | null,
  channel: string,
  payload?: unknown,
): void {
  const contents = getMainWindow()?.webContents
  if (!contents) return

  if (payload === undefined) {
    contents.send(channel)
    return
  }

  contents.send(channel, payload)
}

export function setupAutoUpdater(options: SetupAutoUpdaterOptions): void {
  const schedule = options.schedule ?? setTimeout
  const resolveUpdater = () => options.updater ?? getDefaultUpdater()

  options.ipcMain.handle('app:version', () => options.app.getVersion())
  options.ipcMain.handle('update:check', () => {
    if (options.isDevelopment) return
    return resolveUpdater().checkForUpdates()
  })
  options.ipcMain.handle('update:install', () => {
    if (options.isDevelopment) return
    return resolveUpdater().quitAndInstall()
  })

  if (options.isDevelopment) return

  const updater = resolveUpdater()

  updater.autoDownload = true
  updater.autoInstallOnAppQuit = true
  updater.on('checking-for-update', () => send(options.getMainWindow, 'update:checking'))
  updater.on('update-available', (info) => send(options.getMainWindow, 'update:available', info))
  updater.on('update-not-available', () => send(options.getMainWindow, 'update:not-available'))
  updater.on('download-progress', (progress) => send(options.getMainWindow, 'update:progress', progress))
  updater.on('update-downloaded', () => send(options.getMainWindow, 'update:downloaded'))
  updater.on('error', (value) => {
    const message = value instanceof Error ? value.message : String(value)
    updaterLog('Error:', message)
    send(options.getMainWindow, 'update:error', message)
  })

  schedule(() => {
    void updater.checkForUpdates()
  }, 5_000)
}
