import { Hono } from 'hono'
import { getDb } from '../db/connection'

export const colaboradoresRoutes = new Hono()

// GET /api/colaboradores
colaboradoresRoutes.get('/colaboradores', (c) => {
  const db = getDb()
  const setorId = c.req.query('setor_id')
  const ativo = c.req.query('ativo')

  let sql = 'SELECT * FROM colaboradores WHERE 1=1'
  const params: unknown[] = []

  if (setorId) {
    sql += ' AND setor_id = ?'
    params.push(Number(setorId))
  }
  if (ativo !== undefined) {
    sql += ' AND ativo = ?'
    params.push(ativo === 'true' ? 1 : 0)
  }
  sql += ' ORDER BY rank DESC, nome'

  return c.json(db.prepare(sql).all(...params))
})

// POST /api/colaboradores
colaboradoresRoutes.post('/colaboradores', async (c) => {
  const body = await c.req.json()
  const db = getDb()

  // Se horas_semanais nao informado, pegar do tipo de contrato
  let horasSemanais = body.horas_semanais
  if (horasSemanais === undefined) {
    const tipo = db.prepare('SELECT horas_semanais FROM tipos_contrato WHERE id = ?').get(body.tipo_contrato_id) as { horas_semanais: number } | undefined
    if (!tipo) return c.json({ error: 'Tipo de contrato nao encontrado' }, 404)
    horasSemanais = tipo.horas_semanais
  }

  const result = db.prepare(`
    INSERT INTO colaboradores (setor_id, tipo_contrato_id, nome, sexo, horas_semanais, rank, prefere_turno, evitar_dia_semana)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    body.setor_id,
    body.tipo_contrato_id,
    body.nome,
    body.sexo,
    horasSemanais,
    body.rank ?? 0,
    body.prefere_turno ?? null,
    body.evitar_dia_semana ?? null
  )

  const created = db.prepare('SELECT * FROM colaboradores WHERE id = ?').get(result.lastInsertRowid)
  return c.json(created, 201)
})

// GET /api/colaboradores/:id
colaboradoresRoutes.get('/colaboradores/:id', (c) => {
  const db = getDb()
  const colab = db.prepare('SELECT * FROM colaboradores WHERE id = ?').get(c.req.param('id'))
  if (!colab) return c.json({ error: 'Colaborador nao encontrado' }, 404)
  return c.json(colab)
})

// PUT /api/colaboradores/:id
colaboradoresRoutes.put('/colaboradores/:id', async (c) => {
  const body = await c.req.json()
  const db = getDb()
  const id = c.req.param('id')

  // Validacao: se mudar de setor, nao pode ter escala RASCUNHO aberta
  if (body.setor_id !== undefined) {
    const atual = db.prepare('SELECT setor_id FROM colaboradores WHERE id = ?').get(id) as { setor_id: number } | undefined
    if (atual && body.setor_id !== atual.setor_id) {
      const rascunho = db.prepare(`
        SELECT COUNT(*) as count FROM escalas e
        JOIN alocacoes a ON a.escala_id = e.id
        WHERE a.colaborador_id = ? AND e.status = 'RASCUNHO'
      `).get(id) as { count: number }
      if (rascunho.count > 0) {
        return c.json({
          error: 'Colaborador tem escala em rascunho no setor atual. Descarte antes de mover.'
        }, 422)
      }
    }
  }

  const fields: string[] = []
  const values: unknown[] = []

  if (body.setor_id !== undefined) { fields.push('setor_id = ?'); values.push(body.setor_id) }
  if (body.tipo_contrato_id !== undefined) { fields.push('tipo_contrato_id = ?'); values.push(body.tipo_contrato_id) }
  if (body.nome !== undefined) { fields.push('nome = ?'); values.push(body.nome) }
  if (body.sexo !== undefined) { fields.push('sexo = ?'); values.push(body.sexo) }
  if (body.horas_semanais !== undefined) { fields.push('horas_semanais = ?'); values.push(body.horas_semanais) }
  if (body.rank !== undefined) { fields.push('rank = ?'); values.push(body.rank) }
  if (body.prefere_turno !== undefined) { fields.push('prefere_turno = ?'); values.push(body.prefere_turno) }
  if (body.evitar_dia_semana !== undefined) { fields.push('evitar_dia_semana = ?'); values.push(body.evitar_dia_semana) }
  if (body.ativo !== undefined) { fields.push('ativo = ?'); values.push(body.ativo ? 1 : 0) }

  if (fields.length > 0) {
    values.push(id)
    db.prepare(`UPDATE colaboradores SET ${fields.join(', ')} WHERE id = ?`).run(...values)
  }

  const updated = db.prepare('SELECT * FROM colaboradores WHERE id = ?').get(id)
  return c.json(updated)
})

// DELETE /api/colaboradores/:id
colaboradoresRoutes.delete('/colaboradores/:id', (c) => {
  const db = getDb()
  db.prepare('DELETE FROM colaboradores WHERE id = ?').run(c.req.param('id'))
  return c.body(null, 204)
})
