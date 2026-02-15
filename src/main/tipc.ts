import { tipc } from '@egoist/tipc/main'
import { getDb, getDbPathForWorker } from './db/database'
import { validarEscala } from './motor/validador'
import { Worker } from 'node:worker_threads'
import path from 'node:path'
import type {
  EscalaCompleta,
  DashboardResumo,
  SetorResumo,
  AlertaDashboard,
} from '../shared'

const t = tipc.create()

/** Wraps a worker promise with a timeout. On timeout, terminates the worker and rejects. */
function withTimeout<T>(workerPromise: Promise<T>, worker: Worker, ms = 30000): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  return Promise.race([
    workerPromise.then(result => { clearTimeout(timer); return result }),
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        worker.terminate()
        reject(new Error('A geracao demorou mais que o esperado. Tente novamente com menos colaboradores ou um periodo menor.'))
      }, ms)
    }),
  ])
}

// =============================================================================
// EMPRESA (2 handlers)
// =============================================================================

const empresaBuscar = t.procedure
  .action(async () => {
    const db = getDb()
    const empresa = db.prepare('SELECT * FROM empresa LIMIT 1').get()
    if (!empresa) throw new Error('Empresa nao configurada')
    return empresa
  })

const empresaAtualizar = t.procedure
  .input<{ nome: string; cnpj: string; telefone: string; corte_semanal: string; tolerancia_semanal_min: number }>()
  .action(async ({ input }) => {
    const db = getDb()
    const empresa = db.prepare('SELECT id FROM empresa LIMIT 1').get() as { id: number } | undefined

    if (empresa) {
      db.prepare('UPDATE empresa SET nome = ?, cnpj = ?, telefone = ?, corte_semanal = ?, tolerancia_semanal_min = ? WHERE id = ?')
        .run(input.nome, input.cnpj, input.telefone, input.corte_semanal, input.tolerancia_semanal_min, empresa.id)
    } else {
      db.prepare('INSERT INTO empresa (nome, cnpj, telefone, corte_semanal, tolerancia_semanal_min) VALUES (?, ?, ?, ?, ?)')
        .run(input.nome, input.cnpj, input.telefone, input.corte_semanal, input.tolerancia_semanal_min)
    }

    return db.prepare('SELECT * FROM empresa LIMIT 1').get()
  })

// =============================================================================
// TIPOS CONTRATO (5 handlers)
// =============================================================================

const tiposContratoListar = t.procedure
  .action(async () => {
    const db = getDb()
    return db.prepare('SELECT * FROM tipos_contrato ORDER BY horas_semanais DESC').all()
  })

const tiposContratoBuscar = t.procedure
  .input<{ id: number }>()
  .action(async ({ input }) => {
    const db = getDb()
    const tipo = db.prepare('SELECT * FROM tipos_contrato WHERE id = ?').get(input.id)
    if (!tipo) throw new Error('Tipo de contrato nao encontrado')
    return tipo
  })

const tiposContratoCriar = t.procedure
  .input<{ nome: string; horas_semanais: number; dias_trabalho: number; trabalha_domingo: boolean; max_minutos_dia: number }>()
  .action(async ({ input }) => {
    const db = getDb()
    const result = db.prepare(`
      INSERT INTO tipos_contrato (nome, horas_semanais, dias_trabalho, trabalha_domingo, max_minutos_dia)
      VALUES (?, ?, ?, ?, ?)
    `).run(input.nome, input.horas_semanais, input.dias_trabalho, input.trabalha_domingo ? 1 : 0, input.max_minutos_dia)

    return db.prepare('SELECT * FROM tipos_contrato WHERE id = ?').get(result.lastInsertRowid)
  })

const tiposContratoAtualizar = t.procedure
  .input<{ id: number; nome: string; horas_semanais: number; dias_trabalho: number; trabalha_domingo: boolean; max_minutos_dia: number }>()
  .action(async ({ input }) => {
    const db = getDb()
    db.prepare(`
      UPDATE tipos_contrato SET nome = ?, horas_semanais = ?, dias_trabalho = ?,
      trabalha_domingo = ?, max_minutos_dia = ? WHERE id = ?
    `).run(input.nome, input.horas_semanais, input.dias_trabalho, input.trabalha_domingo ? 1 : 0, input.max_minutos_dia, input.id)

    return db.prepare('SELECT * FROM tipos_contrato WHERE id = ?').get(input.id)
  })

const tiposContratoDeletar = t.procedure
  .input<{ id: number }>()
  .action(async ({ input }) => {
    const db = getDb()
    const count = db.prepare('SELECT COUNT(*) as count FROM colaboradores WHERE tipo_contrato_id = ?').get(input.id) as { count: number }
    if (count.count > 0) {
      throw new Error(`${count.count} colaboradores usam este contrato. Mova-os antes de deletar.`)
    }
    db.prepare('DELETE FROM tipos_contrato WHERE id = ?').run(input.id)
    return undefined
  })

// =============================================================================
// SETORES (5 handlers) + DEMANDAS (4 handlers) + RANK (1 handler)
// =============================================================================

const setoresListar = t.procedure
  .input<{ ativo?: boolean }>()
  .action(async ({ input }) => {
    const db = getDb()
    let sql = 'SELECT * FROM setores'
    const params: unknown[] = []

    if (input?.ativo !== undefined) {
      sql += ' WHERE ativo = ?'
      params.push(input.ativo ? 1 : 0)
    }
    sql += ' ORDER BY nome'

    return db.prepare(sql).all(...params)
  })

const setoresBuscar = t.procedure
  .input<{ id: number }>()
  .action(async ({ input }) => {
    const db = getDb()
    const setor = db.prepare('SELECT * FROM setores WHERE id = ?').get(input.id)
    if (!setor) throw new Error('Setor nao encontrado')
    return setor
  })

const setoresCriar = t.procedure
  .input<{ nome: string; hora_abertura: string; hora_fechamento: string; icone?: string | null }>()
  .action(async ({ input }) => {
    const db = getDb()
    const result = db.prepare(`
      INSERT INTO setores (nome, icone, hora_abertura, hora_fechamento)
      VALUES (?, ?, ?, ?)
    `).run(input.nome, input.icone ?? null, input.hora_abertura, input.hora_fechamento)

    return db.prepare('SELECT * FROM setores WHERE id = ?').get(result.lastInsertRowid)
  })

const setoresAtualizar = t.procedure
  .input<{ id: number; nome?: string; icone?: string | null; hora_abertura?: string; hora_fechamento?: string; ativo?: boolean }>()
  .action(async ({ input }) => {
    const db = getDb()
    const fields: string[] = []
    const values: unknown[] = []

    if (input.nome !== undefined) { fields.push('nome = ?'); values.push(input.nome) }
    if (input.icone !== undefined) { fields.push('icone = ?'); values.push(input.icone) }
    if (input.hora_abertura !== undefined) { fields.push('hora_abertura = ?'); values.push(input.hora_abertura) }
    if (input.hora_fechamento !== undefined) { fields.push('hora_fechamento = ?'); values.push(input.hora_fechamento) }
    if (input.ativo !== undefined) { fields.push('ativo = ?'); values.push(input.ativo ? 1 : 0) }

    if (fields.length > 0) {
      values.push(input.id)
      db.prepare(`UPDATE setores SET ${fields.join(', ')} WHERE id = ?`).run(...values)
    }

    return db.prepare('SELECT * FROM setores WHERE id = ?').get(input.id)
  })

const setoresDeletar = t.procedure
  .input<{ id: number }>()
  .action(async ({ input }) => {
    const db = getDb()
    db.prepare('DELETE FROM setores WHERE id = ?').run(input.id)
    return undefined
  })

// --- Demandas ---

const setoresListarDemandas = t.procedure
  .input<{ setor_id: number }>()
  .action(async ({ input }) => {
    const db = getDb()
    return db.prepare('SELECT * FROM demandas WHERE setor_id = ? ORDER BY hora_inicio').all(input.setor_id)
  })

const setoresCriarDemanda = t.procedure
  .input<{ setor_id: number; dia_semana?: string | null; hora_inicio: string; hora_fim: string; min_pessoas: number }>()
  .action(async ({ input }) => {
    const db = getDb()
    const setor = db.prepare('SELECT * FROM setores WHERE id = ?').get(input.setor_id) as { hora_abertura: string; hora_fechamento: string } | undefined
    if (!setor) throw new Error('Setor nao encontrado')

    if (input.hora_inicio < setor.hora_abertura) {
      throw new Error(`Faixa inicia antes da abertura do setor (${setor.hora_abertura})`)
    }
    if (input.hora_fim > setor.hora_fechamento) {
      throw new Error(`Faixa termina depois do fechamento do setor (${setor.hora_fechamento})`)
    }

    const result = db.prepare(`
      INSERT INTO demandas (setor_id, dia_semana, hora_inicio, hora_fim, min_pessoas)
      VALUES (?, ?, ?, ?, ?)
    `).run(input.setor_id, input.dia_semana ?? null, input.hora_inicio, input.hora_fim, input.min_pessoas)

    return db.prepare('SELECT * FROM demandas WHERE id = ?').get(result.lastInsertRowid)
  })

const setoresAtualizarDemanda = t.procedure
  .input<{ id: number; dia_semana?: string | null; hora_inicio: string; hora_fim: string; min_pessoas: number }>()
  .action(async ({ input }) => {
    const db = getDb()
    const demanda = db.prepare('SELECT * FROM demandas WHERE id = ?').get(input.id) as { setor_id: number } | undefined
    if (!demanda) throw new Error('Demanda nao encontrada')

    const setor = db.prepare('SELECT * FROM setores WHERE id = ?').get(demanda.setor_id) as { hora_abertura: string; hora_fechamento: string }

    if (input.hora_inicio && input.hora_inicio < setor.hora_abertura) {
      throw new Error(`Faixa inicia antes da abertura do setor (${setor.hora_abertura})`)
    }
    if (input.hora_fim && input.hora_fim > setor.hora_fechamento) {
      throw new Error(`Faixa termina depois do fechamento do setor (${setor.hora_fechamento})`)
    }

    db.prepare(`
      UPDATE demandas SET dia_semana = ?, hora_inicio = ?, hora_fim = ?, min_pessoas = ? WHERE id = ?
    `).run(input.dia_semana ?? null, input.hora_inicio, input.hora_fim, input.min_pessoas, input.id)

    return db.prepare('SELECT * FROM demandas WHERE id = ?').get(input.id)
  })

const setoresDeletarDemanda = t.procedure
  .input<{ id: number }>()
  .action(async ({ input }) => {
    const db = getDb()
    db.prepare('DELETE FROM demandas WHERE id = ?').run(input.id)
    return undefined
  })

// --- Rank ---

const setoresReordenarRank = t.procedure
  .input<{ setor_id: number; colaborador_ids: number[] }>()
  .action(async ({ input }) => {
    const db = getDb()
    const updateRank = db.prepare('UPDATE colaboradores SET rank = ? WHERE id = ? AND setor_id = ?')

    const reorder = db.transaction(() => {
      for (let i = 0; i < input.colaborador_ids.length; i++) {
        updateRank.run(input.colaborador_ids.length - i, input.colaborador_ids[i], input.setor_id)
      }
    })
    reorder()

    return undefined
  })

// =============================================================================
// COLABORADORES (5 handlers)
// =============================================================================

const colaboradoresListar = t.procedure
  .input<{ setor_id?: number; ativo?: boolean }>()
  .action(async ({ input }) => {
    const db = getDb()
    let sql = 'SELECT * FROM colaboradores WHERE 1=1'
    const params: unknown[] = []

    if (input?.setor_id !== undefined) {
      sql += ' AND setor_id = ?'
      params.push(input.setor_id)
    }
    if (input?.ativo !== undefined) {
      sql += ' AND ativo = ?'
      params.push(input.ativo ? 1 : 0)
    }
    sql += ' ORDER BY rank DESC, nome'

    return db.prepare(sql).all(...params)
  })

const colaboradoresBuscar = t.procedure
  .input<{ id: number }>()
  .action(async ({ input }) => {
    const db = getDb()
    const colab = db.prepare('SELECT * FROM colaboradores WHERE id = ?').get(input.id)
    if (!colab) throw new Error('Colaborador nao encontrado')
    return colab
  })

const colaboradoresCriar = t.procedure
  .input<{ setor_id: number; tipo_contrato_id: number; nome: string; sexo: string; horas_semanais?: number; rank?: number; prefere_turno?: string | null; evitar_dia_semana?: string | null }>()
  .action(async ({ input }) => {
    const db = getDb()

    let horasSemanais = input.horas_semanais
    if (horasSemanais === undefined) {
      const tipo = db.prepare('SELECT horas_semanais FROM tipos_contrato WHERE id = ?').get(input.tipo_contrato_id) as { horas_semanais: number } | undefined
      if (!tipo) throw new Error('Tipo de contrato nao encontrado')
      horasSemanais = tipo.horas_semanais
    }

    const result = db.prepare(`
      INSERT INTO colaboradores (setor_id, tipo_contrato_id, nome, sexo, horas_semanais, rank, prefere_turno, evitar_dia_semana)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.setor_id,
      input.tipo_contrato_id,
      input.nome,
      input.sexo,
      horasSemanais,
      input.rank ?? 0,
      input.prefere_turno ?? null,
      input.evitar_dia_semana ?? null
    )

    return db.prepare('SELECT * FROM colaboradores WHERE id = ?').get(result.lastInsertRowid)
  })

const colaboradoresAtualizar = t.procedure
  .input<{ id: number; setor_id?: number; tipo_contrato_id?: number; nome?: string; sexo?: string; horas_semanais?: number; rank?: number; prefere_turno?: string | null; evitar_dia_semana?: string | null; ativo?: boolean }>()
  .action(async ({ input }) => {
    const db = getDb()

    // Validacao: se mudar de setor, nao pode ter escala RASCUNHO aberta
    if (input.setor_id !== undefined) {
      const atual = db.prepare('SELECT setor_id FROM colaboradores WHERE id = ?').get(input.id) as { setor_id: number } | undefined
      if (atual && input.setor_id !== atual.setor_id) {
        const rascunho = db.prepare(`
          SELECT COUNT(*) as count FROM escalas e
          JOIN alocacoes a ON a.escala_id = e.id
          WHERE a.colaborador_id = ? AND e.status = 'RASCUNHO'
        `).get(input.id) as { count: number }
        if (rascunho.count > 0) {
          throw new Error('Colaborador tem escala em rascunho no setor atual. Descarte antes de mover.')
        }
      }
    }

    const fields: string[] = []
    const values: unknown[] = []

    if (input.setor_id !== undefined) { fields.push('setor_id = ?'); values.push(input.setor_id) }
    if (input.tipo_contrato_id !== undefined) { fields.push('tipo_contrato_id = ?'); values.push(input.tipo_contrato_id) }
    if (input.nome !== undefined) { fields.push('nome = ?'); values.push(input.nome) }
    if (input.sexo !== undefined) { fields.push('sexo = ?'); values.push(input.sexo) }
    if (input.horas_semanais !== undefined) { fields.push('horas_semanais = ?'); values.push(input.horas_semanais) }
    if (input.rank !== undefined) { fields.push('rank = ?'); values.push(input.rank) }
    if (input.prefere_turno !== undefined) { fields.push('prefere_turno = ?'); values.push(input.prefere_turno) }
    if (input.evitar_dia_semana !== undefined) { fields.push('evitar_dia_semana = ?'); values.push(input.evitar_dia_semana) }
    if (input.ativo !== undefined) { fields.push('ativo = ?'); values.push(input.ativo ? 1 : 0) }

    if (fields.length > 0) {
      values.push(input.id)
      db.prepare(`UPDATE colaboradores SET ${fields.join(', ')} WHERE id = ?`).run(...values)
    }

    return db.prepare('SELECT * FROM colaboradores WHERE id = ?').get(input.id)
  })

const colaboradoresDeletar = t.procedure
  .input<{ id: number }>()
  .action(async ({ input }) => {
    const db = getDb()
    db.prepare('DELETE FROM colaboradores WHERE id = ?').run(input.id)
    return undefined
  })

// =============================================================================
// EXCECOES (5 handlers)
// =============================================================================

const excecoesListar = t.procedure
  .input<{ colaborador_id: number }>()
  .action(async ({ input }) => {
    const db = getDb()
    return db.prepare('SELECT * FROM excecoes WHERE colaborador_id = ? ORDER BY data_inicio').all(input.colaborador_id)
  })

const excecoesListarAtivas = t.procedure
  .input<Record<string, never>>()
  .action(async () => {
    const db = getDb()
    const hoje = new Date().toISOString().split('T')[0]
    return db.prepare('SELECT * FROM excecoes WHERE data_inicio <= ? AND data_fim >= ? ORDER BY tipo, data_inicio').all(hoje, hoje)
  })

const excecoesCriar = t.procedure
  .input<{ colaborador_id: number; data_inicio: string; data_fim: string; tipo: string; observacao?: string | null }>()
  .action(async ({ input }) => {
    const db = getDb()
    const result = db.prepare(`
      INSERT INTO excecoes (colaborador_id, data_inicio, data_fim, tipo, observacao)
      VALUES (?, ?, ?, ?, ?)
    `).run(input.colaborador_id, input.data_inicio, input.data_fim, input.tipo, input.observacao ?? null)

    return db.prepare('SELECT * FROM excecoes WHERE id = ?').get(result.lastInsertRowid)
  })

const excecoesAtualizar = t.procedure
  .input<{ id: number; data_inicio: string; data_fim: string; tipo: string; observacao?: string | null }>()
  .action(async ({ input }) => {
    const db = getDb()
    db.prepare(`
      UPDATE excecoes SET data_inicio = ?, data_fim = ?, tipo = ?, observacao = ? WHERE id = ?
    `).run(input.data_inicio, input.data_fim, input.tipo, input.observacao ?? null, input.id)

    return db.prepare('SELECT * FROM excecoes WHERE id = ?').get(input.id)
  })

const excecoesDeletar = t.procedure
  .input<{ id: number }>()
  .action(async ({ input }) => {
    const db = getDb()
    db.prepare('DELETE FROM excecoes WHERE id = ?').run(input.id)
    return undefined
  })

// =============================================================================
// ESCALAS (6 handlers)
// =============================================================================

const escalasBuscar = t.procedure
  .input<{ id: number }>()
  .action(async ({ input }): Promise<EscalaCompleta> => {
    const db = getDb()
    const escala = db.prepare('SELECT * FROM escalas WHERE id = ?').get(input.id) as any
    if (!escala) throw new Error('Escala nao encontrada')

    const alocacoes = db.prepare('SELECT * FROM alocacoes WHERE escala_id = ? ORDER BY data, colaborador_id').all(input.id)

    return {
      escala,
      alocacoes: alocacoes as EscalaCompleta['alocacoes'],
      violacoes: [],
      indicadores: {
        cobertura_percent: escala.cobertura_percent ?? 0,
        violacoes_hard: escala.violacoes_hard ?? 0,
        violacoes_soft: escala.violacoes_soft ?? 0,
        equilibrio: escala.equilibrio ?? 0,
        pontuacao: escala.pontuacao ?? 0,
      },
    }
  })

const escalasResumoPorSetor = t.procedure
  .action(async () => {
    const db = getDb()
    return db.prepare(`
      SELECT e.setor_id, e.data_inicio, e.data_fim, e.status
      FROM escalas e
      INNER JOIN (
        SELECT setor_id, MAX(
          CASE status WHEN 'OFICIAL' THEN 2 WHEN 'RASCUNHO' THEN 1 ELSE 0 END * 1000000 + id
        ) as prio
        FROM escalas
        WHERE status IN ('RASCUNHO', 'OFICIAL')
        GROUP BY setor_id
      ) latest ON e.setor_id = latest.setor_id
        AND (CASE e.status WHEN 'OFICIAL' THEN 2 WHEN 'RASCUNHO' THEN 1 ELSE 0 END * 1000000 + e.id) = latest.prio
    `).all() as { setor_id: number; data_inicio: string; data_fim: string; status: string }[]
  })

const escalasListarPorSetor = t.procedure
  .input<{ setor_id: number; status?: string }>()
  .action(async ({ input }) => {
    const db = getDb()
    let sql = 'SELECT * FROM escalas WHERE setor_id = ?'
    const params: unknown[] = [input.setor_id]

    if (input.status) {
      sql += ' AND status = ?'
      params.push(input.status)
    }
    sql += ' ORDER BY data_inicio DESC'

    return db.prepare(sql).all(...params)
  })

const escalasOficializar = t.procedure
  .input<{ id: number }>()
  .action(async ({ input }) => {
    const db = getDb()
    const escala = db.prepare('SELECT * FROM escalas WHERE id = ?').get(input.id) as { setor_id: number; status: string } | undefined
    if (!escala) throw new Error('Escala nao encontrada')

    const empresa = db.prepare('SELECT tolerancia_semanal_min FROM empresa LIMIT 1').get() as { tolerancia_semanal_min: number } | undefined
    const { indicadores } = validarEscala(input.id, db, empresa?.tolerancia_semanal_min ?? 30)

    if (indicadores.violacoes_hard > 0) {
      throw new Error(`Escala tem ${indicadores.violacoes_hard} violacoes criticas. Corrija antes de oficializar.`)
    }

    // Arquivar oficial anterior do mesmo setor
    db.prepare(`
      UPDATE escalas SET status = 'ARQUIVADA'
      WHERE setor_id = ? AND status = 'OFICIAL'
    `).run(escala.setor_id)

    // Oficializar esta
    db.prepare("UPDATE escalas SET status = 'OFICIAL' WHERE id = ?").run(input.id)

    return db.prepare('SELECT * FROM escalas WHERE id = ?').get(input.id)
  })

const escalasAjustar = t.procedure
  .input<{ id: number; alocacoes: { colaborador_id: number; data: string; status: string; hora_inicio?: string | null; hora_fim?: string | null }[] }>()
  .action(async ({ input }): Promise<EscalaCompleta> => {
    const db = getDb()
    const escalaId = input.id

    const escala = db.prepare('SELECT * FROM escalas WHERE id = ?').get(escalaId) as { setor_id: number; data_inicio: string; data_fim: string; status: string } | undefined
    if (!escala) throw new Error('Escala nao encontrada')
    if (escala.status !== 'RASCUNHO') {
      throw new Error('So e possivel ajustar escalas em rascunho')
    }
    if (!input.alocacoes || input.alocacoes.length === 0) {
      throw new Error('Nenhuma alocacao fornecida para ajuste')
    }

    // Smart Recalc: tratar input.alocacoes como pinned cells e regenerar via motor
    const pinnedCellsArr: [string, { status: 'TRABALHO' | 'FOLGA' | 'INDISPONIVEL'; hora_inicio?: string | null; hora_fim?: string | null }][] = []
    for (const a of input.alocacoes) {
      const key = `${a.colaborador_id}-${a.data}`
      const status = a.status as 'TRABALHO' | 'FOLGA' | 'INDISPONIVEL'
      pinnedCellsArr.push([key, { status, hora_inicio: a.hora_inicio ?? undefined, hora_fim: a.hora_fim ?? undefined }])
    }

    const empresa = db.prepare('SELECT tolerancia_semanal_min FROM empresa LIMIT 1').get() as { tolerancia_semanal_min: number } | undefined
    const tolerancia = empresa?.tolerancia_semanal_min ?? 30
    const dbPath = getDbPathForWorker()
    const workerPath = path.join(__dirname, 'motor/worker.js')

    const ajustarWorker = new Worker(workerPath, {
      workerData: {
        setorId: escala.setor_id,
        dataInicio: escala.data_inicio,
        dataFim: escala.data_fim,
        tolerancia,
        dbPath,
        pinnedCellsArr: pinnedCellsArr.length > 0 ? pinnedCellsArr : undefined,
      },
    })

    const ajustarPromise = new Promise<any>((resolve, reject) => {
      ajustarWorker.on('message', (msg) => {
        if (msg.type === 'result') resolve(msg.data)
        else if (msg.type === 'error') reject(new Error(msg.error))
      })
      ajustarWorker.on('error', reject)
      ajustarWorker.on('exit', (code) => {
        if (code !== 0) reject(new Error(`Worker stopped with exit code ${code}`))
      })
    })

    const motor = await withTimeout(ajustarPromise, ajustarWorker)

    // Persistir resultado do motor (substituir alocacoes)
    const persist = db.transaction(() => {
      db.prepare('DELETE FROM alocacoes WHERE escala_id = ?').run(escalaId)
      const insertAloc = db.prepare(`
        INSERT INTO alocacoes (escala_id, colaborador_id, data, status, hora_inicio, hora_fim, minutos)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      for (const a of motor.alocacoes) {
        insertAloc.run(escalaId, a.colaborador_id, a.data, a.status, a.hora_inicio ?? null, a.hora_fim ?? null, a.minutos ?? null)
      }
      db.prepare(`
        UPDATE escalas SET pontuacao = ?, cobertura_percent = ?, violacoes_hard = ?, violacoes_soft = ?, equilibrio = ?
        WHERE id = ?
      `).run(
        motor.pontuacao,
        motor.cobertura_percent,
        motor.violacoes_hard,
        motor.violacoes_soft,
        motor.equilibrio,
        escalaId
      )
    })
    persist()

    const escalaAtual = db.prepare('SELECT * FROM escalas WHERE id = ?').get(escalaId) as EscalaCompleta['escala']
    const alocacoes = db.prepare('SELECT * FROM alocacoes WHERE escala_id = ? ORDER BY data, colaborador_id').all(escalaId) as EscalaCompleta['alocacoes']

    return {
      escala: escalaAtual,
      alocacoes,
      indicadores: {
        cobertura_percent: motor.cobertura_percent,
        violacoes_hard: motor.violacoes_hard,
        violacoes_soft: motor.violacoes_soft,
        equilibrio: motor.equilibrio,
        pontuacao: motor.pontuacao,
      },
      violacoes: motor.violacoes,
    }
  })

const escalasDeletar = t.procedure
  .input<{ id: number }>()
  .action(async ({ input }) => {
    const db = getDb()
    db.prepare('DELETE FROM escalas WHERE id = ?').run(input.id)
    return undefined
  })

// Gerar escala via worker thread
const escalasGerar = t.procedure
  .input<{ setor_id: number; data_inicio: string; data_fim: string }>()
  .action(async ({ input }): Promise<EscalaCompleta> => {
    const db = getDb()
    const setorId = input.setor_id

    // Validacoes
    const colabs = db.prepare('SELECT COUNT(*) as count FROM colaboradores WHERE setor_id = ? AND ativo = 1').get(setorId) as { count: number }
    if (colabs.count === 0) {
      throw new Error('Setor nao tem colaboradores ativos. Cadastre ao menos 1.')
    }

    const demandasCount = db.prepare('SELECT COUNT(*) as count FROM demandas WHERE setor_id = ?').get(setorId) as { count: number }
    if (demandasCount.count === 0) {
      throw new Error('Setor nao tem faixas de demanda. Defina ao menos 1.')
    }

    const empresa = db.prepare('SELECT tolerancia_semanal_min FROM empresa LIMIT 1').get() as { tolerancia_semanal_min: number } | undefined
    const tolerancia = empresa?.tolerancia_semanal_min ?? 30

    const dbPath = getDbPathForWorker()

    // Spawn worker thread
    const workerPath = path.join(__dirname, 'motor/worker.js')

    const gerarWorker = new Worker(workerPath, {
      workerData: {
        setorId,
        dataInicio: input.data_inicio,
        dataFim: input.data_fim,
        tolerancia,
        dbPath,
      },
    })

    const gerarPromise = new Promise<any>((resolve, reject) => {
      gerarWorker.on('message', (msg) => {
        if (msg.type === 'result') {
          resolve(msg.data)
        } else if (msg.type === 'error') {
          reject(new Error(msg.error))
        }
      })

      gerarWorker.on('error', (err) => {
        console.error('[MOTOR] Worker error:', err)
        reject(err)
      })
      gerarWorker.on('exit', (code) => {
        if (code !== 0) {
          console.error('[MOTOR] Worker exited with code:', code)
          reject(new Error(`Worker stopped with exit code ${code}`))
        }
      })
    })

    const motor = await withTimeout(gerarPromise, gerarWorker)

    // Persist escala + alocacoes in transaction on main thread
    const persist = db.transaction(() => {
      const result = db.prepare(`
        INSERT INTO escalas (setor_id, data_inicio, data_fim, status, pontuacao, cobertura_percent, violacoes_hard, violacoes_soft, equilibrio)
        VALUES (?, ?, ?, 'RASCUNHO', ?, ?, ?, ?, ?)
      `).run(setorId, input.data_inicio, input.data_fim, motor.pontuacao, motor.cobertura_percent, motor.violacoes_hard, motor.violacoes_soft, motor.equilibrio)

      const escalaId = result.lastInsertRowid

      const insertAloc = db.prepare(`
        INSERT INTO alocacoes (escala_id, colaborador_id, data, status, hora_inicio, hora_fim, minutos)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `)

      for (const a of motor.alocacoes) {
        insertAloc.run(escalaId, a.colaborador_id, a.data, a.status, a.hora_inicio, a.hora_fim, a.minutos)
      }

      return escalaId
    })

    const escalaId = persist()
    const escala = db.prepare('SELECT * FROM escalas WHERE id = ?').get(escalaId)
    const alocacoes = db.prepare('SELECT * FROM alocacoes WHERE escala_id = ? ORDER BY data, colaborador_id').all(escalaId)

    return {
      escala: escala as EscalaCompleta['escala'],
      alocacoes: alocacoes as EscalaCompleta['alocacoes'],
      violacoes: motor.violacoes,
      indicadores: {
        cobertura_percent: motor.cobertura_percent,
        violacoes_hard: motor.violacoes_hard,
        violacoes_soft: motor.violacoes_soft,
        equilibrio: motor.equilibrio,
        pontuacao: motor.pontuacao,
      },
    }
  })

// =============================================================================
// DASHBOARD (1 handler)
// =============================================================================

const dashboardResumo = t.procedure
  .action(async (): Promise<DashboardResumo> => {
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

    return {
      total_setores: totalSetores,
      total_colaboradores: totalColaboradores,
      total_em_ferias: totalEmFerias,
      total_em_atestado: totalEmAtestado,
      setores,
      alertas,
    }
  })

// =============================================================================
// ROUTER
// =============================================================================

function calcMinutos(inicio: string, fim: string): number {
  const [h1, m1] = inicio.split(':').map(Number)
  const [h2, m2] = fim.split(':').map(Number)
  return (h2 * 60 + m2) - (h1 * 60 + m1)
}

export const router = {
  // Empresa
  'empresa.buscar': empresaBuscar,
  'empresa.atualizar': empresaAtualizar,
  // Tipos Contrato
  'tiposContrato.listar': tiposContratoListar,
  'tiposContrato.buscar': tiposContratoBuscar,
  'tiposContrato.criar': tiposContratoCriar,
  'tiposContrato.atualizar': tiposContratoAtualizar,
  'tiposContrato.deletar': tiposContratoDeletar,
  // Setores
  'setores.listar': setoresListar,
  'setores.buscar': setoresBuscar,
  'setores.criar': setoresCriar,
  'setores.atualizar': setoresAtualizar,
  'setores.deletar': setoresDeletar,
  'setores.listarDemandas': setoresListarDemandas,
  'setores.criarDemanda': setoresCriarDemanda,
  'setores.atualizarDemanda': setoresAtualizarDemanda,
  'setores.deletarDemanda': setoresDeletarDemanda,
  'setores.reordenarRank': setoresReordenarRank,
  // Colaboradores
  'colaboradores.listar': colaboradoresListar,
  'colaboradores.buscar': colaboradoresBuscar,
  'colaboradores.criar': colaboradoresCriar,
  'colaboradores.atualizar': colaboradoresAtualizar,
  'colaboradores.deletar': colaboradoresDeletar,
  // Excecoes
  'excecoes.listar': excecoesListar,
  'excecoes.listarAtivas': excecoesListarAtivas,
  'excecoes.criar': excecoesCriar,
  'excecoes.atualizar': excecoesAtualizar,
  'excecoes.deletar': excecoesDeletar,
  // Escalas
  'escalas.buscar': escalasBuscar,
  'escalas.resumoPorSetor': escalasResumoPorSetor,
  'escalas.listarPorSetor': escalasListarPorSetor,
  'escalas.oficializar': escalasOficializar,
  'escalas.ajustar': escalasAjustar,
  'escalas.deletar': escalasDeletar,
  'escalas.gerar': escalasGerar,
  // Dashboard
  'dashboard.resumo': dashboardResumo,
}

export type Router = typeof router
