import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()

// PGlite data directories (dev mode uses out/data/, packaged uses userData)
const paths = [
  path.join(root, 'out', 'data', 'escalaflow-pg'),
  path.join(root, 'data', 'escalaflow-pg'),
]

// Allow override via env
const overridePath = process.env.ESCALAFLOW_DB_PATH?.trim()
if (overridePath) paths.unshift(overridePath)

let removed = 0

for (const dir of paths) {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true })
    removed += 1
    console.log(`[db:reset] removido: ${dir}`)
  } else {
    console.log(`[db:reset] nao existe: ${dir}`)
  }
}

console.log(`[db:reset] concluido. Diretorios removidos: ${removed}/${paths.length}`)
