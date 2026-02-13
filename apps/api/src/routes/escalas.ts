import { Hono } from 'hono'
import { getDb } from '../db/connection'
import type { EscalaCompleta } from '@escalaflow/shared'

export const escalasRoutes = new Hono()

// POST /api/setores/:id/gerar-escala (placeholder — motor vem na F5)
escalasRoutes.post('/setores/:id/gerar-escala', async (c) => {
  const body = await c.req.json()
  const db = getDb()
  const setorId = c.req.param('id')

  // Validacoes
  const colabs = db.prepare('SELECT COUNT(*) as count FROM colaboradores WHERE setor_id = ? AND ativo = 1').get(setorId) as { count: number }
  if (colabs.count === 0) {
    return c.json({ error: 'Setor nao tem colaboradores ativos. Cadastre ao menos 1.' }, 422)
  }

  const demandas = db.prepare('SELECT COUNT(*) as count FROM demandas WHERE setor_id = ?').get(setorId) as { count: number }
  if (demandas.count === 0) {
    return c.json({ error: 'Setor nao tem faixas de demanda. Defina ao menos 1.' }, 422)
  }

  // TODO: Motor de Proposta (F5) — por enquanto cria escala vazia
  const result = db.prepare(`
    INSERT INTO escalas (setor_id, data_inicio, data_fim, status)
    VALUES (?, ?, ?, 'RASCUNHO')
  `).run(setorId, body.data_inicio, body.data_fim)

  const escala = db.prepare('SELECT * FROM escalas WHERE id = ?').get(result.lastInsertRowid)

  const response: EscalaCompleta = {
    escala: escala as EscalaCompleta['escala'],
    alocacoes: [],
    violacoes: []
  }

  return c.json(response, 201)
})

// GET /api/escalas/:id
escalasRoutes.get('/escalas/:id', (c) => {
  const db = getDb()
  const id = c.req.param('id')
  const escala = db.prepare('SELECT * FROM escalas WHERE id = ?').get(id)
  if (!escala) return c.json({ error: 'Escala nao encontrada' }, 404)

  const alocacoes = db.prepare('SELECT * FROM alocacoes WHERE escala_id = ? ORDER BY data, colaborador_id').all(id)

  return c.json({ escala, alocacoes, violacoes: [] })
})

// GET /api/setores/:id/escalas
escalasRoutes.get('/setores/:id/escalas', (c) => {
  const db = getDb()
  const status = c.req.query('status')
  let sql = 'SELECT * FROM escalas WHERE setor_id = ?'
  const params: unknown[] = [c.req.param('id')]

  if (status) {
    sql += ' AND status = ?'
    params.push(status)
  }
  sql += ' ORDER BY data_inicio DESC'

  return c.json(db.prepare(sql).all(...params))
})

// PUT /api/escalas/:id/oficializar
escalasRoutes.put('/escalas/:id/oficializar', (c) => {
  const db = getDb()
  const id = c.req.param('id')

  const escala = db.prepare('SELECT * FROM escalas WHERE id = ?').get(id) as { setor_id: number; status: string } | undefined
  if (!escala) return c.json({ error: 'Escala nao encontrada' }, 404)

  // TODO: checar violacoes HARD quando motor existir

  // Arquivar oficial anterior do mesmo setor
  db.prepare(`
    UPDATE escalas SET status = 'ARQUIVADA'
    WHERE setor_id = ? AND status = 'OFICIAL'
  `).run(escala.setor_id)

  // Oficializar esta
  db.prepare("UPDATE escalas SET status = 'OFICIAL' WHERE id = ?").run(id)

  const updated = db.prepare('SELECT * FROM escalas WHERE id = ?').get(id)
  return c.json(updated)
})

// POST /api/escalas/:id/ajustar
escalasRoutes.post('/escalas/:id/ajustar', async (c) => {
  const body = await c.req.json() as { alocacoes: { colaborador_id: number; data: string; status: string; hora_inicio?: string | null; hora_fim?: string | null }[] }
  const db = getDb()
  const escalaId = c.req.param('id')

  const upsert = db.prepare(`
    INSERT INTO alocacoes (escala_id, colaborador_id, data, status, hora_inicio, hora_fim, minutos)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(escala_id, colaborador_id, data) DO UPDATE SET
      status = excluded.status,
      hora_inicio = excluded.hora_inicio,
      hora_fim = excluded.hora_fim,
      minutos = excluded.minutos
  `)

  // Precisa de unique constraint — vou adicionar index depois
  const adjust = db.transaction(() => {
    for (const a of body.alocacoes) {
      const minutos = a.hora_inicio && a.hora_fim ? calcMinutos(a.hora_inicio, a.hora_fim) : null
      upsert.run(escalaId, a.colaborador_id, a.data, a.status, a.hora_inicio ?? null, a.hora_fim ?? null, minutos)
    }
  })
  adjust()

  const alocacoes = db.prepare('SELECT * FROM alocacoes WHERE escala_id = ? ORDER BY data, colaborador_id').all(escalaId)
  return c.json({ alocacoes })
})

// DELETE /api/escalas/:id
escalasRoutes.delete('/escalas/:id', (c) => {
  const db = getDb()
  db.prepare('DELETE FROM escalas WHERE id = ?').run(c.req.param('id'))
  return c.body(null, 204)
})

function calcMinutos(inicio: string, fim: string): number {
  const [h1, m1] = inicio.split(':').map(Number)
  const [h2, m2] = fim.split(':').map(Number)
  return (h2 * 60 + m2) - (h1 * 60 + m1)
}
