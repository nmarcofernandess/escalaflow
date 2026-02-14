import { getDb, closeDb } from './connection'
import { createTables } from './schema'

function seed(): void {
  createTables()
  const db = getDb()

  // ─── Empresa ────────────────────────────────────────────────────────
  const empresaExiste = db.prepare('SELECT COUNT(*) as count FROM empresa').get() as { count: number }
  if (empresaExiste.count === 0) {
    db.prepare(`
      INSERT INTO empresa (nome, corte_semanal, tolerancia_semanal_min)
      VALUES (?, ?, ?)
    `).run('Supermercado Fernandes', 'SEG_DOM', 30)
    console.log('[SEED] Empresa criada')
  }

  // ─── Tipos de Contrato (CLT) ───────────────────────────────────────
  const tiposExistem = db.prepare('SELECT COUNT(*) as count FROM tipos_contrato').get() as { count: number }
  if (tiposExistem.count === 0) {
    const insertTipo = db.prepare(`
      INSERT INTO tipos_contrato (nome, horas_semanais, dias_trabalho, trabalha_domingo, max_minutos_dia)
      VALUES (?, ?, ?, ?, ?)
    `)

    const tipos = [
      ['CLT 44h', 44, 6, 1, 600],   // id 1 — correto conforme BUILD
      ['CLT 36h', 36, 5, 1, 480],   // id 2 — corrigido: dias_trabalho 6→5
      ['CLT 30h', 30, 5, 1, 360],   // id 3 — corrigido: max_minutos_dia 480→360, trabalha_domingo 0→1
      ['Estagiario 20h', 20, 5, 0, 240], // id 4 — corrigido: max_minutos_dia 360→240
    ] as const

    db.transaction(() => {
      for (const tipo of tipos) insertTipo.run(...tipo)
    })()
    console.log('[SEED] 4 tipos de contrato CLT criados')
  }

  // ─── Setores ─────────────────────────────────────────────────────────
  const setoresExistem = db.prepare('SELECT COUNT(*) as count FROM setores').get() as { count: number }
  if (setoresExistem.count === 0) {
    const insertSetor = db.prepare(`
      INSERT INTO setores (nome, hora_abertura, hora_fechamento, ativo)
      VALUES (?, ?, ?, ?)
    `)

    const setores = [
      ['Caixa',      '08:00', '22:00', 1], // id 1
      ['Acougue',    '08:00', '20:00', 1], // id 2
      ['Padaria',    '06:00', '21:00', 1], // id 3
      ['Hortifruti', '07:00', '20:00', 1], // id 4
    ] as const

    db.transaction(() => {
      for (const s of setores) insertSetor.run(...s)
    })()
    console.log('[SEED] 4 setores criados')
  }

  // ─── Demandas (faixas horarias por setor) ────────────────────────────
  const demandasExistem = db.prepare('SELECT COUNT(*) as count FROM demandas').get() as { count: number }
  if (demandasExistem.count === 0) {
    const insertDemanda = db.prepare(`
      INSERT INTO demandas (setor_id, dia_semana, hora_inicio, hora_fim, min_pessoas)
      VALUES (?, ?, ?, ?, ?)
    `)

    const demandas = [
      // Caixa (setor 1) — 3 faixas normais + sabado reforco
      [1, null,  '08:00', '12:00', 4],
      [1, null,  '12:00', '18:00', 6],
      [1, null,  '18:00', '22:00', 4],
      [1, 'SAB', '08:00', '22:00', 5],
      // Acougue (setor 2)
      [2, null,  '08:00', '12:00', 2],
      [2, null,  '12:00', '20:00', 3],
      // Padaria (setor 3)
      [3, null,  '06:00', '10:00', 3],
      [3, null,  '10:00', '21:00', 2],
      // Hortifruti (setor 4)
      [4, null,  '07:00', '13:00', 2],
      [4, null,  '13:00', '20:00', 2],
    ] as const

    db.transaction(() => {
      for (const d of demandas) insertDemanda.run(...d)
    })()
    console.log('[SEED] 10 faixas de demanda criadas')
  }

  // ─── Colaboradores ───────────────────────────────────────────────────
  const colabsExistem = db.prepare('SELECT COUNT(*) as count FROM colaboradores').get() as { count: number }
  if (colabsExistem.count === 0) {
    const insertColab = db.prepare(`
      INSERT INTO colaboradores (setor_id, tipo_contrato_id, nome, sexo, horas_semanais, rank, prefere_turno, evitar_dia_semana)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)

    const colabs = [
      // Caixa (setor 1) — 8 colaboradores
      [1, 1, 'Ana Julia Santos',        'F', 44, 1, 'MANHA', null],
      [1, 1, 'Carlos Eduardo Silva',    'M', 44, 2, null,    'SAB'],
      [1, 2, 'Maria Fernanda Lima',     'F', 36, 3, 'TARDE', null],
      [1, 1, 'Pedro Henrique Souza',    'M', 44, 4, null,    'SEG'],
      [1, 1, 'Juliana Oliveira',        'F', 44, 5, 'MANHA', null],
      [1, 4, 'Lucas Mendes',            'M', 20, 6, 'TARDE', null],
      [1, 1, 'Fernanda Costa',          'F', 44, 7, null,    null],
      [1, 1, 'Rafael Almeida',          'M', 44, 8, 'MANHA', null],
      // Acougue (setor 2) — 3 colaboradores
      [2, 1, 'Jose Roberto Dias',       'M', 44, 1, 'MANHA', null],
      [2, 1, 'Marcos Pereira',          'M', 44, 2, null,    null],
      [2, 2, 'Sandra Rocha',            'F', 36, 3, 'TARDE', null],
      // Padaria (setor 3) — 3 colaboradores
      [3, 1, 'Antonio Barbosa',         'M', 44, 1, 'MANHA', null],
      [3, 1, 'Lucia Ferreira',          'F', 44, 2, null,    null],
      [3, 3, 'Camila Nunes',            'F', 30, 3, 'MANHA', null],
      // Hortifruti (setor 4) — 2 colaboradores
      [4, 1, 'Roberto Gomes',           'M', 44, 1, null,    null],
      [4, 2, 'Patricia Martins',        'F', 36, 2, 'MANHA', null],
    ] as const

    db.transaction(() => {
      for (const c of colabs) insertColab.run(...c)
    })()
    console.log('[SEED] 16 colaboradores criados')
  }

  // ─── Excecoes (ferias e atestados de teste) ──────────────────────────
  const excecoesExistem = db.prepare('SELECT COUNT(*) as count FROM excecoes').get() as { count: number }
  if (excecoesExistem.count === 0) {
    const insertExcecao = db.prepare(`
      INSERT INTO excecoes (colaborador_id, data_inicio, data_fim, tipo, observacao)
      VALUES (?, ?, ?, ?, ?)
    `)

    const excecoes = [
      [3,  '2026-03-01', '2026-03-15', 'FERIAS',   'Ferias programadas'],  // Maria Fernanda
      [7,  '2026-03-10', '2026-03-12', 'ATESTADO', null],                  // Fernanda Costa
      [12, '2026-04-01', '2026-04-15', 'FERIAS',   null],                  // Antonio Barbosa
    ] as const

    db.transaction(() => {
      for (const e of excecoes) insertExcecao.run(...e)
    })()
    console.log('[SEED] 3 excecoes criadas')
  }

  console.log('[SEED] Seed concluido')
  closeDb()
}

seed()
