import { parentPort, workerData } from 'node:worker_threads'
import Database from 'better-sqlite3'
import { gerarProposta, type PinnedCell } from './gerador'

interface WorkerInput {
  setorId: number
  dataInicio: string
  dataFim: string
  tolerancia: number
  dbPath: string
  /** Serializado como [key, value][] para workerData (Map nao e serializavel) */
  pinnedCellsArr?: [string, PinnedCell][]
}

const input = workerData as WorkerInput

function toPinnedMap(arr?: [string, PinnedCell][]): Map<string, PinnedCell> | undefined {
  if (!arr || arr.length === 0) return undefined
  return new Map(arr)
}

try {
  // Worker opens its OWN DB connection (never share between threads)
  const db = new Database(input.dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  const pinnedCells = toPinnedMap(input.pinnedCellsArr)

  const resultado = gerarProposta(
    input.setorId,
    input.dataInicio,
    input.dataFim,
    db,
    input.tolerancia,
    pinnedCells
  )

  // Close own connection
  db.close()

  parentPort?.postMessage({ type: 'result', data: resultado })
} catch (err: any) {
  parentPort?.postMessage({ type: 'error', error: err.message || String(err) })
}
