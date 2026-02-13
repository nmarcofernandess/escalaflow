import { Hono } from 'hono'
import { getDb } from '../db/connection'
import type { DashboardResumo, SetorResumo, AlertaDashboard } from '@escalaflow/shared'

export const dashboardRoutes = new Hono()

// GET /api/dashboard
dashboardRoutes.get('/dashboard', (c) => {
  const db = getDb()

  const totalSetores = (db.prepare('SELECT COUNT(*) as count FROM setores WHERE ativo = 1').get() as { count: number }).count
  const totalColaboradores = (db.prepare('SELECT COUNT(*) as count FROM colaboradores WHERE ativo = 1').get() as { count: number }).count

  const hoje = new Date().toISOString().split('T')[0]
  const totalEmFerias = (db.prepare(`
    SELECT COUNT(DISTINCT colaborador_id) as count FROM excecoes
    WHERE tipo = 'FERIAS' AND data_inicio <= ? AND data_fim >= ?
  `).get(hoje, hoje) as { count: number }).count

  const totalEmAtestado = (db.prepare(`
    SELECT COUNT(DISTINCT colaborador_id) as count FROM excecoes
    WHERE tipo = 'ATESTADO' AND data_inicio <= ? AND data_fim >= ?
  `).get(hoje, hoje) as { count: number }).count

  // Resumo por setor
  const setoresDb = db.prepare('SELECT * FROM setores WHERE ativo = 1 ORDER BY nome').all() as { id: number; nome: string }[]
  const setores: SetorResumo[] = setoresDb.map((s) => {
    const totalColab = (db.prepare('SELECT COUNT(*) as count FROM colaboradores WHERE setor_id = ? AND ativo = 1').get(s.id) as { count: number }).count
    const escalaAtual = db.prepare(`
      SELECT status FROM escalas WHERE setor_id = ? AND status IN ('RASCUNHO', 'OFICIAL')
      ORDER BY CASE status WHEN 'OFICIAL' THEN 1 WHEN 'RASCUNHO' THEN 2 END LIMIT 1
    `).get(s.id) as { status: string } | undefined

    return {
      id: s.id,
      nome: s.nome,
      total_colaboradores: totalColab,
      escala_atual: (escalaAtual?.status ?? 'SEM_ESCALA') as SetorResumo['escala_atual'],
      proxima_geracao: null,
      violacoes_pendentes: 0,
    }
  })

  // Alertas
  const alertas: AlertaDashboard[] = []
  for (const s of setores) {
    if (s.escala_atual === 'SEM_ESCALA') {
      alertas.push({
        tipo: 'SEM_ESCALA',
        setor_id: s.id,
        setor_nome: s.nome,
        mensagem: `${s.nome}: sem escala gerada`,
      })
    }
    if (s.total_colaboradores < 2) {
      alertas.push({
        tipo: 'POUCOS_COLABORADORES',
        setor_id: s.id,
        setor_nome: s.nome,
        mensagem: `${s.nome}: apenas ${s.total_colaboradores} colaborador(es)`,
      })
    }
  }

  const resumo: DashboardResumo = {
    total_setores: totalSetores,
    total_colaboradores: totalColaboradores,
    total_em_ferias: totalEmFerias,
    total_em_atestado: totalEmAtestado,
    setores,
    alertas,
  }

  return c.json(resumo)
})
