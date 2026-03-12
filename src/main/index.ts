import path from 'node:path'
import os from 'node:os'
import { createRequire } from 'node:module'
import { execSync } from 'node:child_process'
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

/**
 * Instala update no macOS sem usar ShipIt (que exige code signing da Apple).
 * Pega o .app extraído do cache, limpa quarantine + assinatura, e substitui o app atual.
 */
function installMacUpdateManually(app: import('electron').App): void {
  const cacheDir = path.join(os.homedir(), 'Library', 'Caches', 'com.escalaflow.desktop.ShipIt')
  const result = execSync(
    `find "${cacheDir}" -maxdepth 2 -name "EscalaFlow.app" -type d 2>/dev/null || true`
  ).toString().trim()

  const updateAppPath = result.split('\n').filter(Boolean)[0]
  if (!updateAppPath) throw new Error('Update .app not found in ShipIt cache')

  // App atual (ex: /Applications/EscalaFlow.app)
  const currentAppPath = app.getAppPath().replace(/\/Contents\/Resources\/app(\.asar)?$/, '')
  if (!currentAppPath.endsWith('.app')) throw new Error('Cannot determine current .app path: ' + currentAppPath)

  console.log('[AUTO-UPDATER] Mac manual install:', updateAppPath, '→', currentAppPath)

  // Limpa quarantine e remove assinaturas do update
  execSync(`xattr -cr "${updateAppPath}" 2>/dev/null || true`)
  execSync(`codesign --remove-signature --deep "${updateAppPath}" 2>/dev/null || true`)

  // Substituição atômica: backup → move update → remove backup
  const backupPath = `${currentAppPath}.update-backup`
  execSync(`rm -rf "${backupPath}"`)
  execSync(`mv "${currentAppPath}" "${backupPath}"`)

  try {
    execSync(`mv "${updateAppPath}" "${currentAppPath}"`)
    execSync(`rm -rf "${backupPath}"`)
  } catch (err) {
    // Rollback se falhar
    execSync(`mv "${backupPath}" "${currentAppPath}" 2>/dev/null || true`)
    throw err
  }

  // Limpa cache do ShipIt
  execSync(`rm -rf "${cacheDir}" 2>/dev/null || true`)

  app.relaunch()
  app.exit(0)
}

function setupAutoUpdater(ipcMain: import('electron').IpcMain, app: import('electron').App): void {
  const log = (...args: unknown[]) => console.log('[AUTO-UPDATER]', ...args)

  // Handlers de versão e update: sempre registrados (para a UI mostrar a versão em dev também)
  ipcMain.handle('app:version', () => app.getVersion())
  ipcMain.handle('update:check', () => {
    if (process.env.ELECTRON_RENDERER_URL) return
    log('Manual check triggered, current version:', app.getVersion())
    return autoUpdater.checkForUpdates()
  })
  ipcMain.handle('update:install', () => {
    if (process.platform === 'darwin') {
      try {
        installMacUpdateManually(app)
        return
      } catch (err) {
        log('Mac manual install failed, trying standard:', err)
      }
    }
    autoUpdater.quitAndInstall()
  })

  // Em dev não configura auto-update (só os handlers acima)
  if (process.env.ELECTRON_RENDERER_URL) return

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = false // No Mac, ShipIt falha sem Apple cert — instalamos manualmente

  autoUpdater.on('checking-for-update', () => {
    log('Checking for update...')
    mainWindow?.webContents.send('update:checking')
  })
  autoUpdater.on('update-available', (info) => {
    log('Update available:', info.version)
    mainWindow?.webContents.send('update:available', info)
  })
  autoUpdater.on('update-not-available', (info) => {
    log('No update available. Latest:', info?.version, '| Current:', app.getVersion())
    mainWindow?.webContents.send('update:not-available')
  })
  autoUpdater.on('download-progress', (progress) => {
    mainWindow?.webContents.send('update:progress', progress)
  })
  autoUpdater.on('update-downloaded', (info) => {
    log('Update downloaded:', info.version)
    mainWindow?.webContents.send('update:downloaded')
  })
  autoUpdater.on('error', (err) => {
    log('Update error:', err.message)
    mainWindow?.webContents.send('update:error', err.message)
  })

  // Checa ao iniciar (5s de delay pra janela estar pronta)
  log('Auto-updater configured. Current version:', app.getVersion())
  setTimeout(() => {
    log('Starting auto-check...')
    autoUpdater.checkForUpdates()
  }, 5000)
}

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
    setupAutoUpdater(ipcMain, app)

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
