import path from 'node:path'
import { createRequire } from 'node:module'
import electron from 'electron'
import { createTables } from './db/schema'
import { seedData, seedLocalData } from './db/seed'
import { seedE2eData } from './db/seed-e2e'
import { initDb, closeDb } from './db/pglite'
import { startToolServer, stopToolServer } from './tool-server'
import { setupAutoUpdater } from './auto-updater'

// Em modo packaged nao ha terminal — EPIPE em stdout/stderr nao deve crashar o app
process.stdout.on('error', (err: NodeJS.ErrnoException) => { if (err.code !== 'EPIPE') console.error(err) })
process.stderr.on('error', (err: NodeJS.ErrnoException) => { if (err.code !== 'EPIPE') console.error(err) })
process.on('uncaughtException', (err: Error) => {
  if ((err as NodeJS.ErrnoException).code === 'EPIPE') return
  console.error('[MAIN] uncaughtException:', err)
})

let mainWindow: import('electron').BrowserWindow | null = null
let isQuitting = false
let backupTimer: ReturnType<typeof setInterval> | null = null
const require = createRequire(import.meta.url)

function createWindow(
  app: import('electron').App,
  BrowserWindow: typeof import('electron').BrowserWindow,
  shell: typeof import('electron').shell,
): void {
  // Ícone: dev usa resources/ na raiz; prod usa extraResources. Formato nativo por plataforma.
  const resourcesDir = app.isPackaged ? process.resourcesPath : path.join(app.getAppPath(), 'resources')
  const iconExt = process.platform === 'win32' ? 'ico' : process.platform === 'darwin' ? 'icns' : 'png'
  const iconPath = path.join(resourcesDir, `icon.${iconExt}`)

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    icon: iconPath,
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
  await seedE2eData()
  startToolServer()

  const { app, BrowserWindow, shell, ipcMain, Menu } = electron

  app.whenReady().then(async () => {
    // Menu de aplicação: no macOS, o primeiro item define o nome na barra de menu (evita "Electron" em dev)
    const appName = app.name === 'Electron' ? 'EscalaFlow' : (app.name ?? 'EscalaFlow')
    const menuTemplate: Electron.MenuItemConstructorOptions[] = [
      {
        label: appName,
        submenu: [
          { role: 'about' as const },
          { type: 'separator' as const },
          { role: 'quit' as const },
        ],
      },
      { label: 'Editar', submenu: [{ role: 'undo' as const }, { role: 'redo' as const }, { type: 'separator' as const }, { role: 'cut' as const }, { role: 'copy' as const }, { role: 'paste' as const }] },
      {
        label: 'Janela',
        submenu: [
          { role: 'minimize' as const },
          { role: 'zoom' as const },
          { type: 'separator' as const },
          { role: 'zoomIn' as const },
          { role: 'zoomOut' as const },
          { role: 'resetZoom' as const },
          { type: 'separator' as const },
          { role: 'close' as const },
        ],
      },
    ]
    Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate))

    const { registerIpcMain } = require('@egoist/tipc/main') as typeof import('@egoist/tipc/main')
    const { router } = await import('./tipc')
    registerIpcMain(router)
    createWindow(app, BrowserWindow, shell)
    setupAutoUpdater({
      ipcMain,
      getMainWindow: () => mainWindow,
      isDevelopment: Boolean(process.env.ELECTRON_RENDERER_URL),
    })

    // Auto-backup timer — check every hour if a periodic backup is due
    backupTimer = setInterval(async () => {
      try {
        const { getBackupConfig, createSnapshot } = await import('./backup')
        const config = await getBackupConfig()
        if (!config.ativo || config.intervalo_horas === 0) return

        const last = config.ultimo_backup ? new Date(config.ultimo_backup) : null
        const hoursAgo = last ? (Date.now() - last.getTime()) / 3600000 : Infinity

        if (hoursAgo >= config.intervalo_horas) {
          await createSnapshot('auto_intervalo', app.getPath('userData'), app.getVersion(), { scope: 'operational' })
        }
      } catch (err) {
        console.error('[BACKUP] Falha no auto-backup intervalo:', err)
      }
    }, 3600000)

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow(app, BrowserWindow, shell)
      }
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })

  app.on('before-quit', async (e) => {
    if (isQuitting) return
    e.preventDefault()
    isQuitting = true

    // 1. Stop timer to prevent race condition
    if (backupTimer) clearInterval(backupTimer)

    // 2. Auto-backup (DB still open) — com timeout: pasta de backup
    //    inacessível (drive removido, permissão) não pode segurar o quit.
    try {
      const { getBackupConfig, createSnapshot } = await import('./backup')
      const config = await getBackupConfig()
      if (config.ativo && config.backup_ao_fechar) {
        await Promise.race([
          createSnapshot('auto_close', app.getPath('userData'), app.getVersion(), { scope: 'operational' }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('auto-backup timeout (15s)')), 15_000)),
        ])
      }
    } catch (err) {
      console.error('[BACKUP] Falha no auto-backup ao fechar:', err)
    }

    // 3. Cleanup (AFTER snapshot)
    stopToolServer()
    void import('./ia/local-llm').then(m => m.unloadModel()).catch(() => {})
    void closeDb().catch(() => {})
    app.quit()
  })
}

bootstrap().catch(async (err) => {
  console.error('[MAIN] Falha no bootstrap:', err)
  await closeDb().catch(() => {})
  process.exit(1)
})
