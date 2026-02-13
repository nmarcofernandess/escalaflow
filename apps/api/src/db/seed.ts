import { getDb, closeDb } from './connection'
import { createTables } from './schema'

function seed(): void {
  createTables()
  const db = getDb()

  // ─── Empresa ────────────────────────────────────────────────────────
  const empresaExiste = db.prepare('SELECT COUNT(*) as count FROM empresa').get() as { count: number }
  if (empresaExiste.count === 0) {
    db.prepare(`
      INSERT INTO empresa (nome, cidade, estado)
      VALUES (?, ?, ?)
    `).run('Supermercado Fernandes', '', '')
    console.log('[SEED] Empresa criada')
  }

  // ─── Tipos de Contrato (CLT) ───────────────────────────────────────
  const tiposExistem = db.prepare('SELECT COUNT(*) as count FROM tipos_contrato').get() as { count: number }
  if (tiposExistem.count === 0) {
    const insertTipo = db.prepare(`
      INSERT INTO tipos_contrato (nome, horas_semanais, dias_trabalho, trabalha_domingo, max_minutos_dia)
      VALUES (?, ?, ?, ?, ?)
    `)

    const tipos = [
      ['CLT 44h', 44, 6, 1, 600],
      ['CLT 36h', 36, 6, 1, 480],
      ['CLT 30h', 30, 5, 0, 480],
      ['Estagiario 20h', 20, 5, 0, 360],
    ] as const

    const insertMany = db.transaction(() => {
      for (const tipo of tipos) {
        insertTipo.run(...tipo)
      }
    })
    insertMany()
    console.log('[SEED] 4 tipos de contrato CLT criados')
  }

  console.log('[SEED] Seed concluido')
  closeDb()
}

seed()
