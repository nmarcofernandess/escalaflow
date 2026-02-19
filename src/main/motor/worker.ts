import { parentPort, workerData } from 'node:worker_threads'
import Database from 'better-sqlite3'
import { gerarEscalaV3 } from './gerador'
import type { GerarEscalaInput, GerarEscalaOutput } from '../../shared'

interface WorkerInput {
  input: GerarEscalaInput   // setor_id, data_inicio, data_fim, pinned_cells?
  dbPath: string
}

const data = workerData as WorkerInput

let db: InstanceType<typeof Database> | null = null

try {
  db = new Database(data.dbPath, { readonly: false })
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  const resultado: GerarEscalaOutput = gerarEscalaV3(db, data.input)

  parentPort?.postMessage({ type: 'result', data: resultado })
} catch (err) {
  parentPort?.postMessage({
    type: 'error',
    error: err instanceof Error ? err.message : String(err)
  })
} finally {
  db?.close()
}
