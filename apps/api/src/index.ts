import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { createTables } from './db/schema'
import { empresaRoutes } from './routes/empresa'
import { tiposContratoRoutes } from './routes/tipos-contrato'
import { setoresRoutes } from './routes/setores'
import { colaboradoresRoutes } from './routes/colaboradores'
import { excecoes } from './routes/excecoes'
import { escalasRoutes } from './routes/escalas'
import { dashboardRoutes } from './routes/dashboard'

// ─── Criar tabelas na inicializacao ──────────────────────────────────
createTables()

// ─── App ─────────────────────────────────────────────────────────────
const app = new Hono()

app.use('/*', cors())

// ─── Health check ────────────────────────────────────────────────────
app.get('/api/health', (c) => c.json({ status: 'ok' }))

// ─── Rotas ───────────────────────────────────────────────────────────
app.route('/api', empresaRoutes)
app.route('/api', tiposContratoRoutes)
app.route('/api', setoresRoutes)
app.route('/api', colaboradoresRoutes)
app.route('/api', excecoes)
app.route('/api', escalasRoutes)
app.route('/api', dashboardRoutes)

// ─── Servidor ────────────────────────────────────────────────────────
const PORT = 3333

serve({ fetch: app.fetch, port: PORT }, () => {
  console.log(`[API] EscalaFlow rodando em http://localhost:${PORT}`)
})
