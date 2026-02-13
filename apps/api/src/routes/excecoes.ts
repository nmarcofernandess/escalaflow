import { Hono } from 'hono'
import { getDb } from '../db/connection'

export const excecoes = new Hono()

// GET /api/colaboradores/:id/excecoes
excecoes.get('/colaboradores/:id/excecoes', (c) => {
  const db = getDb()
  const lista = db.prepare('SELECT * FROM excecoes WHERE colaborador_id = ? ORDER BY data_inicio').all(c.req.param('id'))
  return c.json(lista)
})

// POST /api/colaboradores/:id/excecoes
excecoes.post('/colaboradores/:id/excecoes', async (c) => {
  const body = await c.req.json()
  const db = getDb()
  const result = db.prepare(`
    INSERT INTO excecoes (colaborador_id, data_inicio, data_fim, tipo, observacao)
    VALUES (?, ?, ?, ?, ?)
  `).run(c.req.param('id'), body.data_inicio, body.data_fim, body.tipo, body.observacao ?? null)

  const created = db.prepare('SELECT * FROM excecoes WHERE id = ?').get(result.lastInsertRowid)
  return c.json(created, 201)
})

// PUT /api/excecoes/:id
excecoes.put('/excecoes/:id', async (c) => {
  const body = await c.req.json()
  const db = getDb()
  const id = c.req.param('id')

  db.prepare(`
    UPDATE excecoes SET data_inicio = ?, data_fim = ?, tipo = ?, observacao = ? WHERE id = ?
  `).run(body.data_inicio, body.data_fim, body.tipo, body.observacao ?? null, id)

  const updated = db.prepare('SELECT * FROM excecoes WHERE id = ?').get(id)
  return c.json(updated)
})

// DELETE /api/excecoes/:id
excecoes.delete('/excecoes/:id', (c) => {
  const db = getDb()
  db.prepare('DELETE FROM excecoes WHERE id = ?').run(c.req.param('id'))
  return c.body(null, 204)
})
