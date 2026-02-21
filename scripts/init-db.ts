import { getDb, closeDb } from '../src/main/db/database'
import { seedData } from '../src/main/db/seed'
import path from 'node:path'

process.env.ESCALAFLOW_DB_PATH = path.join(process.cwd(), 'data', 'escalaflow.db')

try {
  const db = getDb() // init tables
  
  // Create tables if they don't exist
  db.exec(`
    CREATE TABLE IF NOT EXISTS empresa (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL,
      cnpj TEXT,
      telefone TEXT,
      corte_semanal TEXT NOT NULL DEFAULT 'SEG_DOM',
      tolerancia_semanal_min INTEGER NOT NULL DEFAULT 30,
      min_intervalo_almoco_min INTEGER NOT NULL DEFAULT 60,
      max_intervalo_almoco_min INTEGER NOT NULL DEFAULT 120,
      usa_cct_intervalo_reduzido INTEGER NOT NULL DEFAULT 0,
      grid_minutos INTEGER NOT NULL DEFAULT 15,
      criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
      atualizado_em DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `)
  
  seedData() // run seed
  console.log('DB Seeded')
} catch (e) {
  console.log('Error:', e)
} finally {
  closeDb()
}
