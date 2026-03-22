import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import { execSync } from 'node:child_process'
import electron from 'electron'
import { createTables } from './db/schema'
import { seedData, seedLocalData } from './db/seed'
import { seedE2eData } from './db/seed-e2e'
import { initDb, closeDb } from './db/pglite'
import { startToolServer, stopToolServer } from './tool-server'
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
let isQuitting = false
let backupTimer: ReturnType<typeof setInterval> | null = null
const require = createRequire(import.meta.url)

// --- Auto-Update ---
// No Mac, Squirrel.Mac (ShipIt) exige Apple Developer cert ($99/ano) para validar
// code signature ao instalar updates. Sem cert, QUALQUER download via electron-updater falha.
// Solução: no Mac, usamos electron-updater APENAS para detectar versão nova.
// O download e instalação são feitos manualmente (fetch + ditto + mv).
// No Windows, o fluxo padrão do electron-updater (NSIS) funciona normalmente.

const updaterLog = (...args: unknown[]) => console.log('[AUTO-UPDATER]', ...args)
let pendingMacZipPath: string | null = null

/**
 * Baixa o ZIP do release via fetch (sem Squirrel, sem quarantine).
 * Streama direto pro disco — não bufferiza 300MB em RAM.
 */
async function downloadMacUpdate(zipUrl: string, version: string): Promise<void> {
  const tmpDir = path.join(os.tmpdir(), 'escalaflow-update')
  fs.mkdirSync(tmpDir, { recursive: true })
  const zipPath = path.join(tmpDir, `update-${version}.zip`)

  updaterLog('Downloading ZIP:', zipUrl)
  const response = await fetch(zipUrl, { redirect: 'follow' })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  if (!response.body) throw new Error('No response body')

  const total = parseInt(response.headers.get('content-length') || '0')
  let downloaded = 0
  const reader = response.body.getReader()
  const fileStream = fs.createWriteStream(zipPath)

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    fileStream.write(value)
    downloaded += value.length
    if (total > 0) {
      mainWindow?.webContents.send('update:progress', { percent: (downloaded / total) * 100 })
    }
  }

  await new Promise<void>((resolve, reject) => {
    fileStream.on('finish', resolve)
    fileStream.on('error', reject)
    fileStream.end()
  })

  updaterLog('ZIP saved:', zipPath, `(${(downloaded / 1024 / 1024).toFixed(1)}MB)`)
  pendingMacZipPath = zipPath
  mainWindow?.webContents.send('update:downloaded')
}

/**
 * Extrai ZIP, limpa signatures/quarantine, substitui o app, relança.
 * Rollback automático se falhar.
 */
function installMacUpdate(zipPath: string, app: import('electron').App): void {
  const extractDir = path.join(os.tmpdir(), 'escalaflow-update-extract')
  execSync(`rm -rf "${extractDir}" && mkdir -p "${extractDir}"`)

  // Extrair (ditto preserva resource forks do macOS)
  updaterLog('Extracting ZIP...')
  execSync(`ditto -xk "${zipPath}" "${extractDir}"`)

  // Encontrar o .app extraído
  const findResult = execSync(
    `find "${extractDir}" -maxdepth 2 -name "EscalaFlow.app" -type d 2>/dev/null || true`
  ).toString().trim()
  const updateAppPath = findResult.split('\n').filter(Boolean)[0]
  if (!updateAppPath) throw new Error('EscalaFlow.app not found in ZIP')

  // App atual (ex: /Applications/EscalaFlow.app)
  const currentAppPath = app.getAppPath().replace(/\/Contents\/Resources\/app(\.asar)?$/, '')
  if (!currentAppPath.endsWith('.app')) throw new Error('Cannot determine .app path: ' + currentAppPath)

  updaterLog('Installing:', updateAppPath, '→', currentAppPath)

  // Limpar quarantine e code signatures
  execSync(`xattr -cr "${updateAppPath}" 2>/dev/null || true`)
  execSync(`codesign --remove-signature --deep "${updateAppPath}" 2>/dev/null || true`)

  // Substituição atômica com rollback
  const backupPath = `${currentAppPath}.update-backup`
  execSync(`rm -rf "${backupPath}"`)
  execSync(`mv "${currentAppPath}" "${backupPath}"`)

  try {
    execSync(`mv "${updateAppPath}" "${currentAppPath}"`)
    // Limpar tudo
    execSync(`rm -rf "${backupPath}" "${extractDir}" "${zipPath}" 2>/dev/null || true`)
    // Limpar cache do ShipIt (pode ter lixo de tentativas anteriores)
    const shipItCache = path.join(os.homedir(), 'Library', 'Caches', 'com.escalaflow.desktop.ShipIt')
    execSync(`rm -rf "${shipItCache}" 2>/dev/null || true`)
  } catch (err) {
    // Rollback
    execSync(`mv "${backupPath}" "${currentAppPath}" 2>/dev/null || true`)
    throw err
  }

  updaterLog('Install complete. Relaunching...')
  app.relaunch()
  app.exit(0)
}

function setupAutoUpdater(ipcMain: import('electron').IpcMain, app: import('electron').App): void {
  const isMac = process.platform === 'darwin'

  // Handlers sempre registrados (inclusive em dev, pra UI mostrar versão)
  ipcMain.handle('app:version', () => app.getVersion())
  ipcMain.handle('update:check', () => {
    if (process.env.ELECTRON_RENDERER_URL) return
    updaterLog('Manual check, version:', app.getVersion())
    return autoUpdater.checkForUpdates()
  })
  ipcMain.handle('update:install', () => {
    if (isMac && pendingMacZipPath) {
      try {
        installMacUpdate(pendingMacZipPath, app)
        return
      } catch (err) {
        updaterLog('Mac install failed:', err)
        mainWindow?.webContents.send('update:error', `Falha ao instalar: ${(err as Error).message}`)
      }
      return
    }
    autoUpdater.quitAndInstall()
  })

  // Em dev não configura auto-update
  if (process.env.ELECTRON_RENDERER_URL) return

  // Mac: NÃO deixar electron-updater baixar (ele usa Squirrel.Mac que exige Apple cert)
  // Windows: fluxo normal
  autoUpdater.autoDownload = !isMac
  autoUpdater.autoInstallOnAppQuit = !isMac

  autoUpdater.on('checking-for-update', () => {
    updaterLog('Checking...')
    mainWindow?.webContents.send('update:checking')
  })

  autoUpdater.on('update-available', (info) => {
    updaterLog('Available:', info.version, 'files:', info.files?.map((f: { url: string }) => f.url))
    mainWindow?.webContents.send('update:available', info)

    if (isMac) {
      // No Mac, baixar o ZIP direto (sem Squirrel)
      const zipFile = info.files?.find((f: { url: string }) => f.url.endsWith('.zip'))
      if (zipFile) {
        const zipUrl = `https://github.com/nmarcofernandess/escalaflow/releases/download/v${info.version}/${zipFile.url}`
        downloadMacUpdate(zipUrl, info.version).catch((err) => {
          updaterLog('Mac download error:', err)
          mainWindow?.webContents.send('update:error', `Download falhou: ${(err as Error).message}`)
        })
      } else {
        updaterLog('No ZIP in release — Mac update impossible')
        mainWindow?.webContents.send('update:error', 'ZIP nao encontrado no release. Baixe o DMG manualmente.')
      }
    }
    // Windows: autoDownload = true já cuida
  })

  autoUpdater.on('update-not-available', (info) => {
    updaterLog('Up to date. Latest:', info?.version, '| Current:', app.getVersion())
    mainWindow?.webContents.send('update:not-available')
  })

  // Windows: progresso do electron-updater
  autoUpdater.on('download-progress', (progress) => {
    mainWindow?.webContents.send('update:progress', progress)
  })

  // Windows: download completo via electron-updater
  autoUpdater.on('update-downloaded', (info) => {
    updaterLog('Downloaded (electron-updater):', info.version)
    mainWindow?.webContents.send('update:downloaded')
  })

  autoUpdater.on('error', (err) => {
    updaterLog('Error:', err.message)
    // No Mac, ignorar erros do Squirrel — o download manual é quem manda
    if (isMac) return
    mainWindow?.webContents.send('update:error', err.message)
  })

  updaterLog('Configured. Version:', app.getVersion(), '| Platform:', process.platform)
  setTimeout(() => {
    updaterLog('Auto-check...')
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
    setupAutoUpdater(ipcMain, app)

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

    // 2. Auto-backup (DB still open)
    try {
      const { getBackupConfig, createSnapshot } = await import('./backup')
      const config = await getBackupConfig()
      if (config.ativo && config.backup_ao_fechar) {
        await createSnapshot('auto_close', app.getPath('userData'), app.getVersion(), { scope: 'operational' })
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
