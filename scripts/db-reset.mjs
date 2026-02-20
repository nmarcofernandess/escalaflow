import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const defaultDb = path.join(root, 'data', 'escalaflow.db')
const dbPath = (process.env.ESCALAFLOW_DB_PATH && process.env.ESCALAFLOW_DB_PATH.trim()) || defaultDb

const files = [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]
let removed = 0

for (const file of files) {
  if (fs.existsSync(file)) {
    fs.rmSync(file, { force: true })
    removed += 1
    console.log(`[db:reset] removido: ${file}`)
  } else {
    console.log(`[db:reset] nao existe: ${file}`)
  }
}

console.log(`[db:reset] concluido. Arquivos removidos: ${removed}/${files.length}`)
