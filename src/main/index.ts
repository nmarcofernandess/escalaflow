import path from 'node:path'
import { createRequire } from 'node:module'
import electron from 'electron'
import { createTables } from './db/schema'
import { seedData, seedLocalData } from './db/seed'
import { initDb, closeDb } from './db/pglite'
import pkg from 'electron-updater'
const { autoUpdater } = pkg

// Em modo packaged nao ha terminal — EPIPE em stdout/stderr nao deve crashar o app
process.stdout.on('error', (err: NodeJS.ErrnoException) => { if (err.code !== 'EPIPE') console.error(err) })
process.stderr.on('error', (err: NodeJS.ErrnoException) => { if (err.code !== 'EPIPE') console.error(err) })
process.on('uncaughtException', (err: Error) => {
  if ((err as NodeJS.ErrnoException).code === 'EPIPE') return
  console.error('[MAIN] uncaughtException:', err)
})

let mainWindow: import('electron').BrowserWindow | null = null
const require = createRequire(import.meta.url)

function setupAutoUpdater(ipcMain: import('electron').IpcMain, app: import('electron').App): void {
  // Não roda auto-update em dev
  if (process.env.ELECTRON_RENDERER_URL) return

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => {
    mainWindow?.webContents.send('update:checking')
  })
  autoUpdater.on('update-available', (info) => {
    mainWindow?.webContents.send('update:available', info)
  })
  autoUpdater.on('update-not-available', () => {
    mainWindow?.webContents.send('update:not-available')
  })
  autoUpdater.on('download-progress', (progress) => {
    mainWindow?.webContents.send('update:progress', progress)
  })
  autoUpdater.on('update-downloaded', () => {
    mainWindow?.webContents.send('update:downloaded')
  })
  autoUpdater.on('error', (err) => {
    mainWindow?.webContents.send('update:error', err.message)
  })

  // Checa ao iniciar (5s de delay pra janela estar pronta)
  setTimeout(() => autoUpdater.checkForUpdates(), 5000)

  ipcMain.handle('update:check', () => {
    if (process.env.ELECTRON_RENDERER_URL) return
    return autoUpdater.checkForUpdates()
  })
  ipcMain.handle('update:install', () => {
    autoUpdater.quitAndInstall()
  })
  ipcMain.handle('app:version', () => app.getVersion())
}

function createWindow(
  BrowserWindow: typeof import('electron').BrowserWindow,
  shell: typeof import('electron').shell,
): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    webPreferences: {
      contextIsolation: true,
      sandbox: false,
      nodeIntegration: false,
      preload: path.join(__dirname, '../preload/index.mjs'),
    },
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  // Open external links in default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }: { url: string }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  // Dev mode: load from Vite dev server; prod: load from file
  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

async function bootstrap(): Promise<void> {
  await initDb()
  await createTables()
  await seedData()
  await seedLocalData()

  const { app, BrowserWindow, shell, ipcMain } = electron

  app.whenReady().then(async () => {
    const { registerIpcMain } = require('@egoist/tipc/main') as typeof import('@egoist/tipc/main')
    const { router } = await import('./tipc')
    registerIpcMain(router)
    createWindow(BrowserWindow, shell)
    setupAutoUpdater(ipcMain, app)

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow(BrowserWindow, shell)
      }
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })

  app.on('before-quit', () => {
    void import('./ia/local-llm').then(m => m.unloadModel()).catch(() => {})
    void closeDb().catch(() => {})
  })
}

bootstrap().catch(async (err) => {
  console.error('[MAIN] Falha no bootstrap:', err)
  await closeDb().catch(() => {})
  process.exit(1)
})
