import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { createRequire } from 'node:module'
import electron from 'electron'
import { createTables } from './db/schema'
import { seedData } from './db/seed'
import { closeDb, getDb } from './db/database'
import { runMotorTest } from './motor/test-motor'

let mainWindow: import('electron').BrowserWindow | null = null
const require = createRequire(import.meta.url)

const isTestMotor = process.argv.includes('--test-motor')

function prepareMotorTestDb(): string {
  const baseDir = path.join(os.tmpdir(), 'escalaflow-motor-tests')
  fs.mkdirSync(baseDir, { recursive: true })
  const dbPath = path.join(baseDir, `motor-${process.pid}-${Date.now()}.db`)
  process.env.ESCALAFLOW_DB_PATH = dbPath
  if (fs.existsSync(dbPath)) fs.rmSync(dbPath, { force: true })
  return dbPath
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
      sandbox: false, // required for better-sqlite3 native module in preload
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
  let motorTestDbPath: string | null = null
  if (isTestMotor) {
    motorTestDbPath = prepareMotorTestDb()
  }

  createTables()
  seedData()

  if (isTestMotor) {
    const code = runMotorTest(getDb())
    closeDb()
    if (motorTestDbPath && fs.existsSync(motorTestDbPath)) {
      fs.rmSync(motorTestDbPath, { force: true })
    }
    process.exit(code)
    return
  }
  const { app, BrowserWindow, shell } = electron

  app.whenReady().then(async () => {
    const { registerIpcMain } = require('@egoist/tipc/main') as typeof import('@egoist/tipc/main')
    const { router } = await import('./tipc')
    registerIpcMain(router)
    createWindow(BrowserWindow, shell)

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
    closeDb()
  })
}

bootstrap().catch((err) => {
  console.error('[MAIN] Falha no bootstrap:', err)
  closeDb()
  process.exit(1)
})
