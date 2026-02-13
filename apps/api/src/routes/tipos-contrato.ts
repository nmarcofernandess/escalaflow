import { Hono } from 'hono'
import { getDb } from '../db/connection'

export const tiposContratoRoutes = new Hono()

// GET /api/tipos-contrato
tiposContratoRoutes.get('/tipos-contrato', (c) => {
  const db = getDb()
  const tipos = db.prepare('SELECT * FROM tipos_contrato ORDER BY horas_semanais DESC').all()
  return c.json(tipos)
})

// POST /api/tipos-contrato
tiposContratoRoutes.post('/tipos-contrato', async (c) => {
  const body = await c.req.json()
  const db = getDb()
  const result = db.prepare(`
    INSERT INTO tipos_contrato (nome, horas_semanais, dias_trabalho, trabalha_domingo, max_minutos_dia)
    VALUES (?, ?, ?, ?, ?)
  `).run(body.nome, body.horas_semanais, body.dias_trabalho, body.trabalha_domingo ? 1 : 0, body.max_minutos_dia)

  const created = db.prepare('SELECT * FROM tipos_contrato WHERE id = ?').get(result.lastInsertRowid)
  return c.json(created, 201)
})

// GET /api/tipos-contrato/:id
tiposContratoRoutes.get('/tipos-contrato/:id', (c) => {
  const db = getDb()
  const tipo = db.prepare('SELECT * FROM tipos_contrato WHERE id = ?').get(c.req.param('id'))
  if (!tipo) return c.json({ error: 'Tipo de contrato nao encontrado' }, 404)
  return c.json(tipo)
})

// PUT /api/tipos-contrato/:id
tiposContratoRoutes.put('/tipos-contrato/:id', async (c) => {
  const body = await c.req.json()
  const db = getDb()
  db.prepare(`
    UPDATE tipos_contrato SET nome = ?, horas_semanais = ?, dias_trabalho = ?,
    trabalha_domingo = ?, max_minutos_dia = ? WHERE id = ?
  `).run(body.nome, body.horas_semanais, body.dias_trabalho, body.trabalha_domingo ? 1 : 0, body.max_minutos_dia, c.req.param('id'))

  const updated = db.prepare('SELECT * FROM tipos_contrato WHERE id = ?').get(c.req.param('id'))
  return c.json(updated)
})

// DELETE /api/tipos-contrato/:id
tiposContratoRoutes.delete('/tipos-contrato/:id', (c) => {
  const db = getDb()
  const id = c.req.param('id')

  // Protecao: nao deletar se tem colaboradores usando
  const count = db.prepare('SELECT COUNT(*) as count FROM colaboradores WHERE tipo_contrato_id = ?').get(id) as { count: number }
  if (count.count > 0) {
    return c.json({
      error: `${count.count} colaboradores usam este contrato. Mova-os antes de deletar.`
    }, 409)
  }

  db.prepare('DELETE FROM tipos_contrato WHERE id = ?').run(id)
  return c.body(null, 204)
})
