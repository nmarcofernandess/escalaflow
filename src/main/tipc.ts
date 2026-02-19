import { tipc } from '@egoist/tipc/main'
import electron from 'electron'
import { writeFile } from 'node:fs/promises'
import { getDb, getDbPathForWorker } from './db/database'
import { validarEscalaV3 } from './motor/validador'
import { Worker } from 'node:worker_threads'
import path from 'node:path'
import type {
  EscalaCompletaV3,
  EscalaPreflightResult,
  GerarEscalaInput,
  PinnedCell,
  Escala,
  Alocacao,
  DashboardResumo,
  SetorResumo,
  AlertaDashboard,
} from '../shared'

const t = tipc.create()
const { dialog, BrowserWindow } = electron

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

function buildEscalaPreflight(
  setorId: number,
  dataInicio: string,
  dataFim: string,
): EscalaPreflightResult {
  const db = getDb()
  const blockers: EscalaPreflightResult['blockers'] = []
  const warnings: EscalaPreflightResult['warnings'] = []

  const setor = db.prepare('SELECT id, ativo FROM setores WHERE id = ?').get(setorId) as { id: number; ativo: number } | undefined
  if (!setor || setor.ativo !== 1) {
    blockers.push({
      codigo: 'SETOR_INVALIDO',
      severidade: 'BLOCKER',
      mensagem: `Setor ${setorId} nao encontrado ou inativo.`,
    })
  }

  const colabsAtivos = (
    db.prepare('SELECT COUNT(*) as count FROM colaboradores WHERE setor_id = ? AND ativo = 1').get(setorId) as { count: number }
  ).count
  if (colabsAtivos === 0) {
    blockers.push({
      codigo: 'SEM_COLABORADORES',
      severidade: 'BLOCKER',
      mensagem: 'Setor nao tem colaboradores ativos.',
      detalhe: 'Cadastre ao menos 1 colaborador para gerar escala.',
    })
  }

  const demandasCount = (
    db.prepare('SELECT COUNT(*) as count FROM demandas WHERE setor_id = ?').get(setorId) as { count: number }
  ).count
  if (demandasCount === 0) {
    warnings.push({
      codigo: 'SEM_DEMANDA',
      severidade: 'WARNING',
      mensagem: 'Setor sem demanda planejada cadastrada.',
      detalhe: 'O motor vai usar fallback por piso operacional.',
    })
  }

  const feriadosNoPeriodo = (
    db.prepare('SELECT COUNT(*) as count FROM feriados WHERE data BETWEEN ? AND ?').get(dataInicio, dataFim) as { count: number }
  ).count

  return {
    ok: blockers.length === 0,
    blockers,
    warnings,
    summary: {
      setor_id: setorId,
      data_inicio: dataInicio,
      data_fim: dataFim,
      colaboradores_ativos: colabsAtivos,
      demandas_cadastradas: demandasCount,
      feriados_no_periodo: feriadosNoPeriodo,
      fallback_piso: demandasCount === 0,
    },
  }
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
  .input<{ nome: string; cnpj: string; telefone: string; corte_semanal: string; tolerancia_semanal_min: number; min_intervalo_almoco_min?: number; usa_cct_intervalo_reduzido?: boolean }>()
  .action(async ({ input }) => {
    const db = getDb()
    const empresa = db.prepare('SELECT id FROM empresa LIMIT 1').get() as { id: number } | undefined

    if (empresa) {
      db.prepare(`UPDATE empresa SET nome = ?, cnpj = ?, telefone = ?, corte_semanal = ?, tolerancia_semanal_min = ?,
        min_intervalo_almoco_min = ?, usa_cct_intervalo_reduzido = ? WHERE id = ?`)
        .run(
          input.nome, input.cnpj, input.telefone, input.corte_semanal, input.tolerancia_semanal_min,
          input.min_intervalo_almoco_min ?? 60,
          input.usa_cct_intervalo_reduzido !== false ? 1 : 0,
          empresa.id
        )
    } else {
      db.prepare(`INSERT INTO empresa (nome, cnpj, telefone, corte_semanal, tolerancia_semanal_min, min_intervalo_almoco_min, usa_cct_intervalo_reduzido)
        VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run(
          input.nome, input.cnpj, input.telefone, input.corte_semanal, input.tolerancia_semanal_min,
          input.min_intervalo_almoco_min ?? 60,
          input.usa_cct_intervalo_reduzido !== false ? 1 : 0
        )
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
  .input<{ id: number; nome?: string; icone?: string | null; hora_abertura?: string; hora_fechamento?: string; ativo?: boolean; piso_operacional?: number }>()
  .action(async ({ input }) => {
    const db = getDb()
    const fields: string[] = []
    const values: unknown[] = []

    if (input.nome !== undefined) { fields.push('nome = ?'); values.push(input.nome) }
    if (input.icone !== undefined) { fields.push('icone = ?'); values.push(input.icone) }
    if (input.hora_abertura !== undefined) { fields.push('hora_abertura = ?'); values.push(input.hora_abertura) }
    if (input.hora_fechamento !== undefined) { fields.push('hora_fechamento = ?'); values.push(input.hora_fechamento) }
    if (input.ativo !== undefined) { fields.push('ativo = ?'); values.push(input.ativo ? 1 : 0) }
    if (input.piso_operacional !== undefined) { fields.push('piso_operacional = ?'); values.push(input.piso_operacional) }

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
    return db.prepare(`
      SELECT * FROM demandas
      WHERE setor_id = ?
      ORDER BY CASE dia_semana
        WHEN 'SEG' THEN 1
        WHEN 'TER' THEN 2
        WHEN 'QUA' THEN 3
        WHEN 'QUI' THEN 4
        WHEN 'SEX' THEN 5
        WHEN 'SAB' THEN 6
        WHEN 'DOM' THEN 7
        ELSE 8
      END, hora_inicio, hora_fim, id
    `).all(input.setor_id)
  })

const setoresCriarDemanda = t.procedure
  .input<{ setor_id: number; dia_semana?: string | null; hora_inicio: string; hora_fim: string; min_pessoas: number; override?: boolean }>()
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
      INSERT INTO demandas (setor_id, dia_semana, hora_inicio, hora_fim, min_pessoas, override)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(input.setor_id, input.dia_semana ?? null, input.hora_inicio, input.hora_fim, input.min_pessoas, input.override ? 1 : 0)

    return db.prepare('SELECT * FROM demandas WHERE id = ?').get(result.lastInsertRowid)
  })

const setoresAtualizarDemanda = t.procedure
  .input<{ id: number; dia_semana?: string | null; hora_inicio?: string; hora_fim?: string; min_pessoas?: number; override?: boolean }>()
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

    const fields: string[] = []
    const values: unknown[] = []
    if (input.dia_semana !== undefined) { fields.push('dia_semana = ?'); values.push(input.dia_semana) }
    if (input.hora_inicio != null) { fields.push('hora_inicio = ?'); values.push(input.hora_inicio) }
    if (input.hora_fim != null) { fields.push('hora_fim = ?'); values.push(input.hora_fim) }
    if (input.min_pessoas != null) { fields.push('min_pessoas = ?'); values.push(input.min_pessoas) }
    if (input.override !== undefined) { fields.push('override = ?'); values.push(input.override ? 1 : 0) }

    if (fields.length > 0) {
      values.push(input.id)
      db.prepare(`UPDATE demandas SET ${fields.join(', ')} WHERE id = ?`).run(...values)
    }

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
  .input<{ setor_id: number; tipo_contrato_id: number; nome: string; sexo: string; horas_semanais?: number; rank?: number; prefere_turno?: string | null; evitar_dia_semana?: string | null; tipo_trabalhador?: string; funcao_id?: number | null }>()
  .action(async ({ input }) => {
    const db = getDb()

    let horasSemanais = input.horas_semanais
    if (horasSemanais === undefined) {
      const tipo = db.prepare('SELECT horas_semanais FROM tipos_contrato WHERE id = ?').get(input.tipo_contrato_id) as { horas_semanais: number } | undefined
      if (!tipo) throw new Error('Tipo de contrato nao encontrado')
      horasSemanais = tipo.horas_semanais
    }

    const result = db.prepare(`
      INSERT INTO colaboradores (setor_id, tipo_contrato_id, nome, sexo, horas_semanais, rank, prefere_turno, evitar_dia_semana, tipo_trabalhador, funcao_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.setor_id,
      input.tipo_contrato_id,
      input.nome,
      input.sexo,
      horasSemanais,
      input.rank ?? 0,
      input.prefere_turno ?? null,
      input.evitar_dia_semana ?? null,
      input.tipo_trabalhador ?? 'CLT',
      input.funcao_id ?? null
    )

    return db.prepare('SELECT * FROM colaboradores WHERE id = ?').get(result.lastInsertRowid)
  })

const colaboradoresAtualizar = t.procedure
  .input<{ id: number; setor_id?: number; tipo_contrato_id?: number; nome?: string; sexo?: string; horas_semanais?: number; rank?: number; prefere_turno?: string | null; evitar_dia_semana?: string | null; ativo?: boolean; tipo_trabalhador?: string; funcao_id?: number | null }>()
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
    if (input.tipo_trabalhador !== undefined) { fields.push('tipo_trabalhador = ?'); values.push(input.tipo_trabalhador) }
    if (input.funcao_id !== undefined) { fields.push('funcao_id = ?'); values.push(input.funcao_id) }

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
  .action(async ({ input }): Promise<EscalaCompletaV3> => {
    const db = getDb()
    const escala = db.prepare('SELECT * FROM escalas WHERE id = ?').get(input.id) as Escala | undefined
    if (!escala) throw new Error('Escala nao encontrada')

    const alocacoes = db
      .prepare('SELECT * FROM alocacoes WHERE escala_id = ? ORDER BY data, colaborador_id')
      .all(input.id) as Alocacao[]

    const snapshotDecisoes = db.prepare(`
      SELECT ed.*,
             COALESCE(c.nome, 'Sistema') as colaborador_nome
      FROM escala_decisoes ed
      LEFT JOIN colaboradores c ON c.id = ed.colaborador_id
      WHERE ed.escala_id = ?
      ORDER BY ed.data, ed.colaborador_id, ed.id
    `).all(input.id) as Array<{
      colaborador_id: number
      colaborador_nome: string
      data: string
      acao: 'ALOCADO' | 'FOLGA' | 'MOVIDO' | 'REMOVIDO'
      razao: string
      alternativas_tentadas: number
    }>

    const snapshotComparacao = db.prepare(`
      SELECT data, hora_inicio, hora_fim, planejado, executado, delta, override, justificativa
      FROM escala_comparacao_demanda
      WHERE escala_id = ?
      ORDER BY data, hora_inicio, hora_fim, id
    `).all(input.id) as Array<{
      data: string
      hora_inicio: string
      hora_fim: string
      planejado: number
      executado: number
      delta: number
      override: number | boolean
      justificativa: string | null
    }>

    const base = validarEscalaV3(input.id, db)
    const hasSnapshot = snapshotDecisoes.length > 0 || snapshotComparacao.length > 0
    if (!hasSnapshot) return base

    return {
      ...base,
      escala,
      alocacoes,
      decisoes: snapshotDecisoes.map((d) => ({
        colaborador_id: d.colaborador_id,
        colaborador_nome: d.colaborador_nome,
        data: d.data,
        acao: d.acao,
        razao: d.razao,
        alternativas_tentadas: d.alternativas_tentadas ?? 0,
      })),
      comparacao_demanda: snapshotComparacao.map((c) => ({
        data: c.data,
        hora_inicio: c.hora_inicio,
        hora_fim: c.hora_fim,
        planejado: c.planejado,
        executado: c.executado,
        delta: c.delta,
        override: Boolean(c.override),
        justificativa: c.justificativa ?? undefined,
      })),
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

const escalasPreflight = t.procedure
  .input<{ setor_id: number; data_inicio: string; data_fim: string }>()
  .action(async ({ input }): Promise<EscalaPreflightResult> => {
    return buildEscalaPreflight(input.setor_id, input.data_inicio, input.data_fim)
  })

const escalasOficializar = t.procedure
  .input<{ id: number }>()
  .action(async ({ input }) => {
    const db = getDb()
    const escala = db.prepare('SELECT * FROM escalas WHERE id = ?').get(input.id) as { setor_id: number; status: string } | undefined
    if (!escala) throw new Error('Escala nao encontrada')

    const { indicadores } = validarEscalaV3(input.id, db)

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
  .input<{ id: number; alocacoes: { colaborador_id: number; data: string; status: 'TRABALHO' | 'FOLGA' | 'INDISPONIVEL'; hora_inicio?: string | null; hora_fim?: string | null }[] }>()
  .action(async ({ input }): Promise<EscalaCompletaV3> => {
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

    // Converter alocacoes do usuário em PinnedCell[] v3.
    // TRABALHO sem hora = "deve trabalhar neste dia" (horário livre para o motor).
    const pinnedCells: PinnedCell[] = []
    for (const a of input.alocacoes) {
      pinnedCells.push({
        colaborador_id: a.colaborador_id,
        data: a.data,
        status: a.status,
        hora_inicio: a.hora_inicio ?? undefined,
        hora_fim: a.hora_fim ?? undefined,
      })
    }

    const dbPath = getDbPathForWorker()
    const workerPath = path.join(__dirname, 'motor/worker.js')

    const motorInput: GerarEscalaInput = {
      setor_id: escala.setor_id,
      data_inicio: escala.data_inicio,
      data_fim: escala.data_fim,
      pinned_cells: pinnedCells.length > 0 ? pinnedCells : undefined,
    }

    const ajustarWorker = new Worker(workerPath, {
      workerData: { input: motorInput, dbPath },
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

    if (!motor.sucesso) {
      throw new Error(motor.erro?.mensagem ?? 'Erro ao gerar escala')
    }

    const motorEscala: EscalaCompletaV3 = motor.escala

    // Persistir resultado do motor (substituir alocacoes + decisoes + comparacao)
    const persist = db.transaction(() => {
      db.prepare('DELETE FROM alocacoes WHERE escala_id = ?').run(escalaId)
      db.prepare('DELETE FROM escala_decisoes WHERE escala_id = ?').run(escalaId)
      db.prepare('DELETE FROM escala_comparacao_demanda WHERE escala_id = ?').run(escalaId)

      const insertAloc = db.prepare(`
        INSERT INTO alocacoes
          (escala_id, colaborador_id, data, status, hora_inicio, hora_fim,
           minutos, minutos_trabalho, hora_almoco_inicio, hora_almoco_fim,
           minutos_almoco, intervalo_15min, funcao_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      for (const a of motorEscala.alocacoes) {
        insertAloc.run(
          escalaId, a.colaborador_id, a.data, a.status,
          a.hora_inicio ?? null, a.hora_fim ?? null,
          a.minutos ?? null, a.minutos_trabalho ?? null,
          a.hora_almoco_inicio ?? null, a.hora_almoco_fim ?? null,
          a.minutos_almoco ?? null,
          a.intervalo_15min ? 1 : 0,
          a.funcao_id ?? null
        )
      }

      const insertDecisao = db.prepare(`
        INSERT INTO escala_decisoes (escala_id, colaborador_id, data, acao, razao, alternativas_tentadas)
        VALUES (?, ?, ?, ?, ?, ?)
      `)
      for (const d of motorEscala.decisoes) {
        insertDecisao.run(escalaId, d.colaborador_id, d.data, d.acao, d.razao, d.alternativas_tentadas)
      }

      const insertComp = db.prepare(`
        INSERT INTO escala_comparacao_demanda (escala_id, data, hora_inicio, hora_fim, planejado, executado, delta, override, justificativa)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      for (const c of motorEscala.comparacao_demanda) {
        insertComp.run(escalaId, c.data, c.hora_inicio, c.hora_fim, c.planejado, c.executado, c.delta, c.override ? 1 : 0, c.justificativa ?? null)
      }

      const ind = motorEscala.indicadores
      db.prepare(`
        UPDATE escalas
        SET pontuacao = ?, cobertura_percent = ?, violacoes_hard = ?, violacoes_soft = ?, equilibrio = ?
        WHERE id = ?
      `).run(ind.pontuacao, ind.cobertura_percent, ind.violacoes_hard, ind.violacoes_soft, ind.equilibrio, escalaId)
    })
    persist()

    const escalaAtual = db.prepare('SELECT * FROM escalas WHERE id = ?').get(escalaId) as Escala
    const alocacoesDB = db.prepare('SELECT * FROM alocacoes WHERE escala_id = ? ORDER BY data, colaborador_id').all(escalaId) as Alocacao[]

    return {
      ...motorEscala,
      escala: escalaAtual,
      alocacoes: alocacoesDB,
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
  .action(async ({ input }): Promise<EscalaCompletaV3> => {
    const db = getDb()
    const setorId = input.setor_id

    // Preflight antes de spawnar worker.
    const preflight = buildEscalaPreflight(setorId, input.data_inicio, input.data_fim)
    if (!preflight.ok) {
      const msg = preflight.blockers[0]?.mensagem ?? 'Preflight falhou'
      throw new Error(msg)
    }

    const dbPath = getDbPathForWorker()
    const workerPath = path.join(__dirname, 'motor/worker.js')

    const motorInput: GerarEscalaInput = {
      setor_id: setorId,
      data_inicio: input.data_inicio,
      data_fim: input.data_fim,
    }

    const gerarWorker = new Worker(workerPath, {
      workerData: { input: motorInput, dbPath },
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

    if (!motor.sucesso) {
      throw new Error(motor.erro?.mensagem ?? 'Erro ao gerar escala')
    }

    const motorEscala: EscalaCompletaV3 = motor.escala
    const ind = motorEscala.indicadores

    // Persist escala + alocacoes + decisoes + comparacao em transaction
    const persist = db.transaction(() => {
      const result = db.prepare(`
        INSERT INTO escalas
          (setor_id, data_inicio, data_fim, status, pontuacao,
           cobertura_percent, violacoes_hard, violacoes_soft, equilibrio)
        VALUES (?, ?, ?, 'RASCUNHO', ?, ?, ?, ?, ?)
      `).run(
        setorId, input.data_inicio, input.data_fim,
        ind.pontuacao, ind.cobertura_percent, ind.violacoes_hard, ind.violacoes_soft, ind.equilibrio
      )

      const escalaId = result.lastInsertRowid

      const insertAloc = db.prepare(`
        INSERT INTO alocacoes
          (escala_id, colaborador_id, data, status, hora_inicio, hora_fim,
           minutos, minutos_trabalho, hora_almoco_inicio, hora_almoco_fim,
           minutos_almoco, intervalo_15min, funcao_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      for (const a of motorEscala.alocacoes) {
        insertAloc.run(
          escalaId, a.colaborador_id, a.data, a.status,
          a.hora_inicio ?? null, a.hora_fim ?? null,
          a.minutos ?? null, a.minutos_trabalho ?? null,
          a.hora_almoco_inicio ?? null, a.hora_almoco_fim ?? null,
          a.minutos_almoco ?? null,
          a.intervalo_15min ? 1 : 0,
          a.funcao_id ?? null
        )
      }

      const insertDecisao = db.prepare(`
        INSERT INTO escala_decisoes (escala_id, colaborador_id, data, acao, razao, alternativas_tentadas)
        VALUES (?, ?, ?, ?, ?, ?)
      `)
      for (const d of motorEscala.decisoes) {
        insertDecisao.run(escalaId, d.colaborador_id, d.data, d.acao, d.razao, d.alternativas_tentadas)
      }

      const insertComp = db.prepare(`
        INSERT INTO escala_comparacao_demanda (escala_id, data, hora_inicio, hora_fim, planejado, executado, delta, override, justificativa)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      for (const c of motorEscala.comparacao_demanda) {
        insertComp.run(escalaId, c.data, c.hora_inicio, c.hora_fim, c.planejado, c.executado, c.delta, c.override ? 1 : 0, c.justificativa ?? null)
      }

      return escalaId
    })

    const escalaId = persist()
    const escalaAtual = db.prepare('SELECT * FROM escalas WHERE id = ?').get(escalaId) as Escala
    const alocacoesDB = db.prepare('SELECT * FROM alocacoes WHERE escala_id = ? ORDER BY data, colaborador_id').all(escalaId) as Alocacao[]

    return {
      ...motorEscala,
      escala: escalaAtual,
      alocacoes: alocacoesDB,
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
// EXPORT (4 handlers)
// =============================================================================

const exportSalvarHTML = t.procedure
  .input<{ html: string; filename?: string }>()
  .action(async ({ input }): Promise<{ filepath: string } | null> => {
    const result = await dialog.showSaveDialog({
      defaultPath: input.filename || 'escala.html',
      filters: [{ name: 'HTML', extensions: ['html'] }],
    })

    if (result.canceled || !result.filePath) return null

    await writeFile(result.filePath, input.html, 'utf-8')
    return { filepath: result.filePath }
  })

const exportImprimirPDF = t.procedure
  .input<{ html: string; filename?: string }>()
  .action(async ({ input }): Promise<{ filepath: string } | null> => {
    const win = new BrowserWindow({
      show: false,
      width: 794,
      height: 1123,
      webPreferences: { offscreen: true },
    })

    try {
      await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(input.html)}`)

      const pdfBuffer = await win.webContents.printToPDF({
        pageSize: 'A4',
        printBackground: true,
        margins: { top: 0.4, bottom: 0.4, left: 0.4, right: 0.4 },
      })

      const result = await dialog.showSaveDialog({
        defaultPath: input.filename || 'escala.pdf',
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
      })

      if (result.canceled || !result.filePath) return null

      await writeFile(result.filePath, pdfBuffer)
      return { filepath: result.filePath }
    } finally {
      win.close()
    }
  })

const exportSalvarCSV = t.procedure
  .input<{ csv: string; filename?: string }>()
  .action(async ({ input }): Promise<{ filepath: string } | null> => {
    const result = await dialog.showSaveDialog({
      defaultPath: input.filename || 'escala.csv',
      filters: [{ name: 'CSV', extensions: ['csv'] }],
    })

    if (result.canceled || !result.filePath) return null

    // BOM prefix for UTF-8 so Excel opens with correct encoding
    await writeFile(result.filePath, '\uFEFF' + input.csv, 'utf-8')
    return { filepath: result.filePath }
  })

const exportBatchHTML = t.procedure
  .input<{ arquivos: { nome: string; html: string }[] }>()
  .action(async ({ input }): Promise<{ pasta: string; count: number } | null> => {
    if (!input.arquivos || input.arquivos.length === 0) {
      throw new Error('Nenhum arquivo fornecido para exportacao em lote')
    }

    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
    })

    if (result.canceled || !result.filePaths[0]) return null

    const pasta = result.filePaths[0]
    let count = 0

    for (const arq of input.arquivos) {
      const filename = arq.nome.endsWith('.html') ? arq.nome : `${arq.nome}.html`
      const filepath = path.join(pasta, filename)
      await writeFile(filepath, arq.html, 'utf-8')
      count++
    }

    return { pasta, count }
  })

// =============================================================================
// FUNCOES (5 handlers) — RFC §9 2.1
// =============================================================================

const funcoesListar = t.procedure
  .input<{ setor_id: number; ativo?: boolean }>()
  .action(async ({ input }) => {
    const db = getDb()
    let sql = 'SELECT * FROM funcoes WHERE setor_id = ?'
    const params: unknown[] = [input.setor_id]
    if (input.ativo !== undefined) {
      sql += ' AND ativo = ?'
      params.push(input.ativo ? 1 : 0)
    }
    sql += ' ORDER BY ordem ASC, apelido'
    return db.prepare(sql).all(...params)
  })

const funcoesBuscar = t.procedure
  .input<{ id: number }>()
  .action(async ({ input }) => {
    const db = getDb()
    const funcao = db.prepare('SELECT * FROM funcoes WHERE id = ?').get(input.id)
    if (!funcao) throw new Error('Funcao nao encontrada')
    return funcao
  })

const funcoesCriar = t.procedure
  .input<{ setor_id: number; apelido: string; tipo_contrato_id: number; ordem?: number }>()
  .action(async ({ input }) => {
    const db = getDb()
    const result = db.prepare(`
      INSERT INTO funcoes (setor_id, apelido, tipo_contrato_id, ordem)
      VALUES (?, ?, ?, ?)
    `).run(input.setor_id, input.apelido, input.tipo_contrato_id, input.ordem ?? 0)
    return db.prepare('SELECT * FROM funcoes WHERE id = ?').get(result.lastInsertRowid)
  })

const funcoesAtualizar = t.procedure
  .input<{ id: number; apelido?: string; tipo_contrato_id?: number; ativo?: boolean; ordem?: number }>()
  .action(async ({ input }) => {
    const db = getDb()
    const fields: string[] = []
    const values: unknown[] = []
    if (input.apelido !== undefined) { fields.push('apelido = ?'); values.push(input.apelido) }
    if (input.tipo_contrato_id !== undefined) { fields.push('tipo_contrato_id = ?'); values.push(input.tipo_contrato_id) }
    if (input.ativo !== undefined) { fields.push('ativo = ?'); values.push(input.ativo ? 1 : 0) }
    if (input.ordem !== undefined) { fields.push('ordem = ?'); values.push(input.ordem) }
    if (fields.length > 0) {
      values.push(input.id)
      db.prepare(`UPDATE funcoes SET ${fields.join(', ')} WHERE id = ?`).run(...values)
    }
    return db.prepare('SELECT * FROM funcoes WHERE id = ?').get(input.id)
  })

const funcoesDeletar = t.procedure
  .input<{ id: number }>()
  .action(async ({ input }) => {
    const db = getDb()
    // Desassociar colaboradores antes de deletar
    db.prepare('UPDATE colaboradores SET funcao_id = NULL WHERE funcao_id = ?').run(input.id)
    db.prepare('DELETE FROM funcoes WHERE id = ?').run(input.id)
    return undefined
  })

// =============================================================================
// FERIADOS (3 handlers) — RFC §9 2.2
// =============================================================================

const feriadosListar = t.procedure
  .input<{ ano?: number }>()
  .action(async ({ input }) => {
    const db = getDb()
    if (input.ano !== undefined) {
      return db.prepare("SELECT * FROM feriados WHERE data LIKE ? ORDER BY data")
        .all(`${input.ano}-%`)
    }
    return db.prepare('SELECT * FROM feriados ORDER BY data').all()
  })

const feriadosCriar = t.procedure
  .input<{ data: string; nome: string; tipo: string; proibido_trabalhar?: boolean; cct_autoriza?: boolean }>()
  .action(async ({ input }) => {
    const db = getDb()
    const result = db.prepare(`
      INSERT INTO feriados (data, nome, tipo, proibido_trabalhar, cct_autoriza)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      input.data,
      input.nome,
      input.tipo,
      input.proibido_trabalhar ? 1 : 0,
      input.cct_autoriza !== false ? 1 : 0
    )
    return db.prepare('SELECT * FROM feriados WHERE id = ?').get(result.lastInsertRowid)
  })

const feriadosDeletar = t.procedure
  .input<{ id: number }>()
  .action(async ({ input }) => {
    const db = getDb()
    db.prepare('DELETE FROM feriados WHERE id = ?').run(input.id)
    return undefined
  })

// =============================================================================
// SETOR HORARIO SEMANA (3 handlers) — RFC §9 2.3 + 2.4
// =============================================================================

const setoresListarHorarioSemana = t.procedure
  .input<{ setor_id: number }>()
  .action(async ({ input }) => {
    const db = getDb()
    return db.prepare(`
      SELECT * FROM setor_horario_semana
      WHERE setor_id = ?
      ORDER BY CASE dia_semana
        WHEN 'SEG' THEN 1
        WHEN 'TER' THEN 2
        WHEN 'QUA' THEN 3
        WHEN 'QUI' THEN 4
        WHEN 'SEX' THEN 5
        WHEN 'SAB' THEN 6
        WHEN 'DOM' THEN 7
      END
    `).all(input.setor_id)
  })

const setoresUpsertHorarioSemana = t.procedure
  .input<{ setor_id: number; dia_semana: string; ativo: boolean; usa_padrao: boolean; hora_abertura: string; hora_fechamento: string }>()
  .action(async ({ input }) => {
    const db = getDb()
    db.prepare(`
      INSERT INTO setor_horario_semana (setor_id, dia_semana, ativo, usa_padrao, hora_abertura, hora_fechamento)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(setor_id, dia_semana) DO UPDATE SET
        ativo = excluded.ativo,
        usa_padrao = excluded.usa_padrao,
        hora_abertura = excluded.hora_abertura,
        hora_fechamento = excluded.hora_fechamento
    `).run(
      input.setor_id,
      input.dia_semana,
      input.ativo ? 1 : 0,
      input.usa_padrao ? 1 : 0,
      input.hora_abertura,
      input.hora_fechamento
    )
    return db.prepare('SELECT * FROM setor_horario_semana WHERE setor_id = ? AND dia_semana = ?')
      .get(input.setor_id, input.dia_semana)
  })

/** Salva horário do dia + segmentos de demanda de forma transacional (RFC §11.1) */
const setoresSalvarTimelineDia = t.procedure
  .input<{
    setor_id: number
    dia_semana: string
    ativo: boolean
    usa_padrao: boolean
    hora_abertura: string
    hora_fechamento: string
    segmentos: Array<{ hora_inicio: string; hora_fim: string; min_pessoas: number; override: boolean }>
  }>()
  .action(async ({ input }) => {
    const db = getDb()
    const toMin = (hhmm: string): number => {
      const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm)
      if (!m) throw new Error(`Horario invalido: "${hhmm}"`)
      return Number(m[1]) * 60 + Number(m[2])
    }

    const aberturaMin = toMin(input.hora_abertura)
    const fechamentoMin = toMin(input.hora_fechamento)
    if (aberturaMin >= fechamentoMin) {
      throw new Error('Horario invalido: abertura deve ser menor que fechamento')
    }

    if (!input.ativo && input.segmentos.length > 0) {
      throw new Error('Dia inativo nao pode ter segmentos de demanda')
    }

    if (input.ativo) {
      if (input.segmentos.length === 0) {
        throw new Error('Dia ativo precisa de ao menos 1 segmento de demanda')
      }

      let cursor = aberturaMin
      for (let i = 0; i < input.segmentos.length; i++) {
        const seg = input.segmentos[i]
        const inicio = toMin(seg.hora_inicio)
        const fim = toMin(seg.hora_fim)

        if (!Number.isInteger(seg.min_pessoas) || seg.min_pessoas < 1) {
          throw new Error(`Segmento ${i + 1}: min_pessoas invalido`)
        }
        if (inicio % 30 !== 0 || fim % 30 !== 0) {
          throw new Error(`Segmento ${i + 1}: horarios devem respeitar grid de 30min`)
        }
        if (inicio >= fim) {
          throw new Error(`Segmento ${i + 1}: hora_inicio deve ser menor que hora_fim`)
        }
        if (inicio < aberturaMin || fim > fechamentoMin) {
          throw new Error(`Segmento ${i + 1}: fora da janela de abertura/fechamento`)
        }

        if (inicio !== cursor) {
          if (inicio < cursor) {
            throw new Error(`Segmento ${i + 1}: sobreposicao detectada na timeline`)
          }
          throw new Error(`Segmento ${i + 1}: gap detectado na timeline`)
        }

        cursor = fim
      }

      if (cursor !== fechamentoMin) {
        throw new Error('Timeline invalida: segmentos nao cobrem todo o periodo ativo do dia')
      }
    }

    const salvar = db.transaction(() => {
      // 1. Upsert horário do dia
      db.prepare(`
        INSERT INTO setor_horario_semana (setor_id, dia_semana, ativo, usa_padrao, hora_abertura, hora_fechamento)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(setor_id, dia_semana) DO UPDATE SET
          ativo = excluded.ativo,
          usa_padrao = excluded.usa_padrao,
          hora_abertura = excluded.hora_abertura,
          hora_fechamento = excluded.hora_fechamento
      `).run(
        input.setor_id,
        input.dia_semana,
        input.ativo ? 1 : 0,
        input.usa_padrao ? 1 : 0,
        input.hora_abertura,
        input.hora_fechamento
      )

      // 2. Apagar demandas existentes para este setor + dia
      db.prepare('DELETE FROM demandas WHERE setor_id = ? AND dia_semana = ?')
        .run(input.setor_id, input.dia_semana)

      // 3. Inserir novos segmentos
      const insertDemanda = db.prepare(`
        INSERT INTO demandas (setor_id, dia_semana, hora_inicio, hora_fim, min_pessoas, override)
        VALUES (?, ?, ?, ?, ?, ?)
      `)
      for (const seg of input.segmentos) {
        insertDemanda.run(
          input.setor_id,
          input.dia_semana,
          seg.hora_inicio,
          seg.hora_fim,
          seg.min_pessoas,
          seg.override ? 1 : 0
        )
      }
    })

    salvar()

    return {
      horario: db.prepare('SELECT * FROM setor_horario_semana WHERE setor_id = ? AND dia_semana = ?')
        .get(input.setor_id, input.dia_semana),
      demandas: db.prepare('SELECT * FROM demandas WHERE setor_id = ? AND dia_semana = ? ORDER BY hora_inicio')
        .all(input.setor_id, input.dia_semana),
    }
  })

// =============================================================================
// ROUTER
// =============================================================================

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
  'setores.listarHorarioSemana': setoresListarHorarioSemana,
  'setores.upsertHorarioSemana': setoresUpsertHorarioSemana,
  'setores.salvarTimelineDia': setoresSalvarTimelineDia,
  // Funcoes
  'funcoes.listar': funcoesListar,
  'funcoes.buscar': funcoesBuscar,
  'funcoes.criar': funcoesCriar,
  'funcoes.atualizar': funcoesAtualizar,
  'funcoes.deletar': funcoesDeletar,
  // Feriados
  'feriados.listar': feriadosListar,
  'feriados.criar': feriadosCriar,
  'feriados.deletar': feriadosDeletar,
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
  'escalas.preflight': escalasPreflight,
  'escalas.oficializar': escalasOficializar,
  'escalas.ajustar': escalasAjustar,
  'escalas.deletar': escalasDeletar,
  'escalas.gerar': escalasGerar,
  // Dashboard
  'dashboard.resumo': dashboardResumo,
  // Export
  'export.salvarHTML': exportSalvarHTML,
  'export.imprimirPDF': exportImprimirPDF,
  'export.salvarCSV': exportSalvarCSV,
  'export.batchHTML': exportBatchHTML,
}

export type Router = typeof router
