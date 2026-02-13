import { Hono } from 'hono'
import { getDb } from '../db/connection'

export const empresaRoutes = new Hono()

// GET /api/empresa
empresaRoutes.get('/empresa', (c) => {
  const db = getDb()
  const empresa = db.prepare('SELECT * FROM empresa LIMIT 1').get()
  if (!empresa) return c.json({ error: 'Empresa nao configurada' }, 404)
  return c.json(empresa)
})

// PUT /api/empresa
empresaRoutes.put('/empresa', async (c) => {
  const body = await c.req.json()
  const db = getDb()
  const empresa = db.prepare('SELECT id FROM empresa LIMIT 1').get() as { id: number } | undefined

  if (empresa) {
    db.prepare('UPDATE empresa SET nome = ?, cidade = ?, estado = ? WHERE id = ?')
      .run(body.nome, body.cidade, body.estado, empresa.id)
  } else {
    db.prepare('INSERT INTO empresa (nome, cidade, estado) VALUES (?, ?, ?)')
      .run(body.nome, body.cidade, body.estado)
  }

  const updated = db.prepare('SELECT * FROM empresa LIMIT 1').get()
  return c.json(updated)
})
