import { Hono } from 'hono'
import { getDb } from '../db/connection'

export const setoresRoutes = new Hono()

// GET /api/setores
setoresRoutes.get('/setores', (c) => {
  const db = getDb()
  const ativo = c.req.query('ativo')
  let sql = 'SELECT * FROM setores'
  const params: unknown[] = []

  if (ativo !== undefined) {
    sql += ' WHERE ativo = ?'
    params.push(ativo === 'true' ? 1 : 0)
  }
  sql += ' ORDER BY nome'

  const setores = db.prepare(sql).all(...params)
  return c.json(setores)
})

// POST /api/setores
setoresRoutes.post('/setores', async (c) => {
  const body = await c.req.json()
  const db = getDb()
  const result = db.prepare(`
    INSERT INTO setores (nome, hora_abertura, hora_fechamento)
    VALUES (?, ?, ?)
  `).run(body.nome, body.hora_abertura, body.hora_fechamento)

  const created = db.prepare('SELECT * FROM setores WHERE id = ?').get(result.lastInsertRowid)
  return c.json(created, 201)
})

// GET /api/setores/:id
setoresRoutes.get('/setores/:id', (c) => {
  const db = getDb()
  const setor = db.prepare('SELECT * FROM setores WHERE id = ?').get(c.req.param('id'))
  if (!setor) return c.json({ error: 'Setor nao encontrado' }, 404)
  return c.json(setor)
})

// PUT /api/setores/:id
setoresRoutes.put('/setores/:id', async (c) => {
  const body = await c.req.json()
  const db = getDb()
  const id = c.req.param('id')

  const fields: string[] = []
  const values: unknown[] = []

  if (body.nome !== undefined) { fields.push('nome = ?'); values.push(body.nome) }
  if (body.hora_abertura !== undefined) { fields.push('hora_abertura = ?'); values.push(body.hora_abertura) }
  if (body.hora_fechamento !== undefined) { fields.push('hora_fechamento = ?'); values.push(body.hora_fechamento) }
  if (body.ativo !== undefined) { fields.push('ativo = ?'); values.push(body.ativo ? 1 : 0) }

  if (fields.length > 0) {
    values.push(id)
    db.prepare(`UPDATE setores SET ${fields.join(', ')} WHERE id = ?`).run(...values)
  }

  const updated = db.prepare('SELECT * FROM setores WHERE id = ?').get(id)
  return c.json(updated)
})

// DELETE /api/setores/:id
setoresRoutes.delete('/setores/:id', (c) => {
  const db = getDb()
  db.prepare('DELETE FROM setores WHERE id = ?').run(c.req.param('id'))
  return c.body(null, 204)
})

// ─── DEMANDAS (pertence a setor) ─────────────────────────────────────

// GET /api/setores/:id/demandas
setoresRoutes.get('/setores/:id/demandas', (c) => {
  const db = getDb()
  const demandas = db.prepare('SELECT * FROM demandas WHERE setor_id = ? ORDER BY hora_inicio').all(c.req.param('id'))
  return c.json(demandas)
})

// POST /api/setores/:id/demandas
setoresRoutes.post('/setores/:id/demandas', async (c) => {
  const body = await c.req.json()
  const db = getDb()
  const setorId = c.req.param('id')

  // Validacao: faixa dentro do horario do setor
  const setor = db.prepare('SELECT * FROM setores WHERE id = ?').get(setorId) as { hora_abertura: string; hora_fechamento: string } | undefined
  if (!setor) return c.json({ error: 'Setor nao encontrado' }, 404)

  if (body.hora_inicio < setor.hora_abertura) {
    return c.json({ error: `Faixa inicia antes da abertura do setor (${setor.hora_abertura})` }, 422)
  }
  if (body.hora_fim > setor.hora_fechamento) {
    return c.json({ error: `Faixa termina depois do fechamento do setor (${setor.hora_fechamento})` }, 422)
  }

  const result = db.prepare(`
    INSERT INTO demandas (setor_id, dia_semana, hora_inicio, hora_fim, min_pessoas)
    VALUES (?, ?, ?, ?, ?)
  `).run(setorId, body.dia_semana ?? null, body.hora_inicio, body.hora_fim, body.min_pessoas)

  const created = db.prepare('SELECT * FROM demandas WHERE id = ?').get(result.lastInsertRowid)
  return c.json(created, 201)
})

// PUT /api/demandas/:id
setoresRoutes.put('/demandas/:id', async (c) => {
  const body = await c.req.json()
  const db = getDb()
  const id = c.req.param('id')

  // Carregar demanda pra pegar setor_id
  const demanda = db.prepare('SELECT * FROM demandas WHERE id = ?').get(id) as { setor_id: number } | undefined
  if (!demanda) return c.json({ error: 'Demanda nao encontrada' }, 404)

  const setor = db.prepare('SELECT * FROM setores WHERE id = ?').get(demanda.setor_id) as { hora_abertura: string; hora_fechamento: string }

  if (body.hora_inicio && body.hora_inicio < setor.hora_abertura) {
    return c.json({ error: `Faixa inicia antes da abertura do setor (${setor.hora_abertura})` }, 422)
  }
  if (body.hora_fim && body.hora_fim > setor.hora_fechamento) {
    return c.json({ error: `Faixa termina depois do fechamento do setor (${setor.hora_fechamento})` }, 422)
  }

  db.prepare(`
    UPDATE demandas SET dia_semana = ?, hora_inicio = ?, hora_fim = ?, min_pessoas = ? WHERE id = ?
  `).run(body.dia_semana ?? null, body.hora_inicio, body.hora_fim, body.min_pessoas, id)

  const updated = db.prepare('SELECT * FROM demandas WHERE id = ?').get(id)
  return c.json(updated)
})

// DELETE /api/demandas/:id
setoresRoutes.delete('/demandas/:id', (c) => {
  const db = getDb()
  db.prepare('DELETE FROM demandas WHERE id = ?').run(c.req.param('id'))
  return c.body(null, 204)
})

// ─── RANK (reordenar colaboradores por DnD) ──────────────────────────

// PUT /api/setores/:id/rank
setoresRoutes.put('/setores/:id/rank', async (c) => {
  const body = await c.req.json() as { colaborador_ids: number[] }
  const db = getDb()

  const updateRank = db.prepare('UPDATE colaboradores SET rank = ? WHERE id = ? AND setor_id = ?')
  const setorId = Number(c.req.param('id'))

  const reorder = db.transaction(() => {
    for (let i = 0; i < body.colaborador_ids.length; i++) {
      // rank mais alto = primeiro da lista
      updateRank.run(body.colaborador_ids.length - i, body.colaborador_ids[i], setorId)
    }
  })
  reorder()

  return c.body(null, 204)
})
