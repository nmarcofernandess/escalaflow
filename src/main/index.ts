import { app, BrowserWindow, shell } from 'electron'
import path from 'node:path'
import { registerIpcMain } from '@egoist/tipc/main'
import { createTables } from './db/schema'
import { seedData } from './db/seed'
import { closeDb, getDb } from './db/database'
import { router } from './tipc'
import { runMotorTest } from './motor/test-motor'

let mainWindow: BrowserWindow | null = null

const isTestMotor = process.argv.includes('--test-motor')

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    webPreferences: {
      contextIsolation: true,
      sandbox: false, // required for better-sqlite3 native module in preload
      nodeIntegration: false,
      preload: path.join(__dirname, '../preload/index.mjs'),
    },
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  // Open external links in default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  // Dev mode: load from Vite dev server; prod: load from file
  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

// --- App Lifecycle ---

app.whenReady().then(() => {
  createTables()
  seedData()

  if (isTestMotor) {
    const code = runMotorTest(getDb())
    closeDb()
    app.exit(code)
    return
  }

  registerIpcMain(router)
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  closeDb()
})
