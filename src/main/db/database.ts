import Database from 'better-sqlite3'
import path from 'node:path'
import { createRequire } from 'node:module'

let _db: Database.Database | null = null
const require = createRequire(import.meta.url)

function getDbPath(): string {
  const overridePath = process.env.ESCALAFLOW_DB_PATH?.trim()
  if (overridePath) return overridePath

  // Evita acoplamento hard com Electron no modo teste/Node puro.
  try {
    const electron = require('electron') as { app?: { isPackaged?: boolean; getPath?: (name: string) => string } }
    const app = electron.app
    if (app?.isPackaged && app.getPath) {
      return path.join(app.getPath('userData'), 'escalaflow.db')
    }
  } catch {
    // fallback para modo Node (ex.: test runner)
  }

  // Dev mode: use project root data/ folder
  return path.join(__dirname, '../../data/escalaflow.db')
}

export function getDb(): Database.Database {
  if (!_db) {
    const dbPath = getDbPath()

    // Ensure directory exists
    const fs = require('fs')
    const dir = path.dirname(dbPath)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }

    _db = new Database(dbPath)
    _db.pragma('journal_mode = WAL')
    _db.pragma('foreign_keys = ON')
    _db.pragma('cache_size = -64000')
    _db.pragma('synchronous = NORMAL')
  }
  return _db
}

export function closeDb(): void {
  if (_db) {
    _db.close()
    _db = null
  }
}

export function getDbPathForWorker(): string {
  return getDbPath()
}
