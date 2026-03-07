import { PGlite } from '@electric-sql/pglite'
import { vector } from '@electric-sql/pglite/vector'
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm'
import path from 'node:path'
import { createRequire } from 'node:module'

let _db: PGlite | null = null

const require = createRequire(import.meta.url)

function getDataDir(): string {
  const overridePath = process.env.ESCALAFLOW_DB_PATH?.trim()
  if (overridePath) return overridePath

  try {
    const electron = require('electron') as { app?: { isPackaged?: boolean; getPath?: (name: string) => string } }
    const app = electron.app
    if (app?.isPackaged && app.getPath) {
      return path.join(app.getPath('userData'), 'escalaflow-pg')
    }
  } catch {
    // fallback para modo Node (ex.: test runner)
  }

  return path.join(__dirname, '../../data/escalaflow-pg')
}

export async function initDb(): Promise<PGlite> {
  if (_db) return _db

  const dataDir = getDataDir()

  // Ensure directory exists
  const fs = require('fs')
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true })
  }

  _db = await PGlite.create({
    dataDir,
    extensions: { vector, pg_trgm },
  })

  await _db.exec('CREATE EXTENSION IF NOT EXISTS vector')
  await _db.exec('CREATE EXTENSION IF NOT EXISTS pg_trgm')

  return _db
}

export function getDb(): PGlite {
  if (!_db) throw new Error('DB not initialized. Call initDb() first.')
  return _db
}

export function isDbReady(): boolean {
  return _db !== null
}

export async function closeDb(): Promise<void> {
  if (_db) {
    await _db.close()
    _db = null
  }
}
