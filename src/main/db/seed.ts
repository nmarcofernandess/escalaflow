import { getDb } from './database'

export function seedData(): void {
  const db = getDb()

  // --- Empresa ---
  const empresaExiste = db.prepare('SELECT COUNT(*) as count FROM empresa').get() as { count: number }
  if (empresaExiste.count === 0) {
    db.prepare(`
      INSERT INTO empresa (nome, cnpj, telefone, corte_semanal, tolerancia_semanal_min)
      VALUES (?, ?, ?, ?, ?)
    `).run('Supermercado Fernandes', '', '', 'SEG_DOM', 30)
    console.log('[SEED] Empresa criada')
  }

  // --- Tipos de Contrato (CLT) ---
  const tiposExistem = db.prepare('SELECT COUNT(*) as count FROM tipos_contrato').get() as { count: number }
  if (tiposExistem.count === 0) {
    const insertTipo = db.prepare(`
      INSERT INTO tipos_contrato (nome, horas_semanais, dias_trabalho, trabalha_domingo, max_minutos_dia)
      VALUES (?, ?, ?, ?, ?)
    `)

    const tipos = [
      ['CLT 44h', 44, 6, 1, 600],
      ['CLT 36h', 36, 5, 1, 480],
      ['CLT 30h', 30, 5, 1, 360],
      ['Estagiario 30h', 30, 5, 0, 360],
      ['Aprendiz 30h', 30, 5, 0, 360],
    ] as const

    db.transaction(() => {
      for (const tipo of tipos) insertTipo.run(...tipo)
    })()
    console.log('[SEED] 5 tipos de contrato criados')
  }

  // --- Setores ---
  const setoresExistem = db.prepare('SELECT COUNT(*) as count FROM setores').get() as { count: number }
  if (setoresExistem.count === 0) {
    const insertSetor = db.prepare(`
      INSERT INTO setores (nome, icone, hora_abertura, hora_fechamento, ativo)
      VALUES (?, ?, ?, ?, ?)
    `)

    const setores = [
      ['Caixa',      'banknote',          '08:00', '22:00', 1],
      ['Acougue',    'beef',              '08:00', '20:00', 1],
      ['Padaria',    'croissant',         '06:00', '21:00', 1],
      ['Hortifruti', 'leaf',              '07:00', '20:00', 1],
    ] as const

    db.transaction(() => {
      for (const s of setores) insertSetor.run(...s)
    })()
    console.log('[SEED] 4 setores criados')
  }

  // --- Demandas ---
  const demandasExistem = db.prepare('SELECT COUNT(*) as count FROM demandas').get() as { count: number }
  if (demandasExistem.count === 0) {
    const insertDemanda = db.prepare(`
      INSERT INTO demandas (setor_id, dia_semana, hora_inicio, hora_fim, min_pessoas)
      VALUES (?, ?, ?, ?, ?)
    `)

    const demandas = [
      [1, null,  '08:00', '12:00', 4],
      [1, null,  '12:00', '18:00', 6],
      [1, null,  '18:00', '22:00', 4],
      [1, 'SAB', '08:00', '22:00', 5],
      [2, null,  '08:00', '12:00', 2],
      [2, null,  '12:00', '20:00', 3],
      [3, null,  '06:00', '10:00', 3],
      [3, null,  '10:00', '21:00', 2],
      [4, null,  '07:00', '13:00', 2],
      [4, null,  '13:00', '20:00', 2],
    ] as const

    db.transaction(() => {
      for (const d of demandas) insertDemanda.run(...d)
    })()
    console.log('[SEED] 10 faixas de demanda criadas')
  }

  // --- Colaboradores ---
  const colabsExistem = db.prepare('SELECT COUNT(*) as count FROM colaboradores').get() as { count: number }
  if (colabsExistem.count === 0) {
    const insertColab = db.prepare(`
      INSERT INTO colaboradores (setor_id, tipo_contrato_id, nome, sexo, horas_semanais, rank, prefere_turno, evitar_dia_semana)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)

    const colabs = [
      [1, 1, 'Ana Julia Santos',        'F', 44, 1, 'MANHA', null],
      [1, 1, 'Carlos Eduardo Silva',    'M', 44, 2, null,    'SAB'],
      [1, 2, 'Maria Fernanda Lima',     'F', 36, 3, 'TARDE', null],
      [1, 1, 'Pedro Henrique Souza',    'M', 44, 4, null,    'SEG'],
      [1, 1, 'Juliana Oliveira',        'F', 44, 5, 'MANHA', null],
      [1, 4, 'Lucas Mendes',            'M', 30, 6, 'TARDE', null],
      [1, 1, 'Fernanda Costa',          'F', 44, 7, null,    null],
      [1, 1, 'Rafael Almeida',          'M', 44, 8, 'MANHA', null],
      [2, 1, 'Jose Roberto Dias',       'M', 44, 1, 'MANHA', null],
      [2, 1, 'Marcos Pereira',          'M', 44, 2, null,    null],
      [2, 2, 'Sandra Rocha',            'F', 36, 3, 'TARDE', null],
      [3, 1, 'Antonio Barbosa',         'M', 44, 1, 'MANHA', null],
      [3, 1, 'Lucia Ferreira',          'F', 44, 2, null,    null],
      [3, 3, 'Camila Nunes',            'F', 30, 3, 'MANHA', null],
      [4, 1, 'Roberto Gomes',           'M', 44, 1, null,    null],
      [4, 2, 'Patricia Martins',        'F', 36, 2, 'MANHA', null],
    ] as const

    db.transaction(() => {
      for (const c of colabs) insertColab.run(...c)
    })()
    console.log('[SEED] 16 colaboradores criados')
  }

  // --- Excecoes ---
  const excecoesExistem = db.prepare('SELECT COUNT(*) as count FROM excecoes').get() as { count: number }
  if (excecoesExistem.count === 0) {
    const insertExcecao = db.prepare(`
      INSERT INTO excecoes (colaborador_id, data_inicio, data_fim, tipo, observacao)
      VALUES (?, ?, ?, ?, ?)
    `)

    const excecoes = [
      [3,  '2026-03-01', '2026-03-15', 'FERIAS',   'Ferias programadas'],
      [7,  '2026-03-10', '2026-03-12', 'ATESTADO', null],
      [12, '2026-04-01', '2026-04-15', 'FERIAS',   null],
    ] as const

    db.transaction(() => {
      for (const e of excecoes) insertExcecao.run(...e)
    })()
    console.log('[SEED] 3 excecoes criadas')
  }

  // ==========================================================================
  // v3.1 — Feriados nacionais (RFC §12.2)
  // ==========================================================================
  seedFeriados()

  console.log('[SEED] Seed concluido')
}

/**
 * Seed de feriados nacionais para o ano corrente e proximo.
 * Idempotente: so insere se tabela feriados estiver vazia.
 * 25/12 e 01/01: proibido_trabalhar=1, cct_autoriza=0 (CCT FecomercioSP)
 * Demais: proibido_trabalhar=0, cct_autoriza=1 (editaveis pelo RH)
 */
function seedFeriados(): void {
  const db = getDb()
  const feriadosExistem = db.prepare('SELECT COUNT(*) as count FROM feriados').get() as { count: number }
  if (feriadosExistem.count > 0) return

  const insertFeriado = db.prepare(`
    INSERT INTO feriados (data, nome, tipo, proibido_trabalhar, cct_autoriza)
    VALUES (?, ?, ?, ?, ?)
  `)

  const currentYear = new Date().getFullYear()

  const gerarFeriadosAno = (ano: number) => [
    [`${ano}-01-01`, 'Confraternizacao Universal',    'NACIONAL', 1, 0],
    [`${ano}-04-21`, 'Tiradentes',                    'NACIONAL', 0, 1],
    [`${ano}-05-01`, 'Dia do Trabalho',               'NACIONAL', 0, 1],
    [`${ano}-09-07`, 'Independencia do Brasil',       'NACIONAL', 0, 1],
    [`${ano}-10-12`, 'Nossa Senhora Aparecida',       'NACIONAL', 0, 1],
    [`${ano}-11-02`, 'Finados',                       'NACIONAL', 0, 1],
    [`${ano}-11-15`, 'Proclamacao da Republica',      'NACIONAL', 0, 1],
    [`${ano}-12-25`, 'Natal',                         'NACIONAL', 1, 0],
  ] as const

  const toIso = (d: Date): string => {
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
  }

  const addDays = (base: Date, days: number): Date => {
    const d = new Date(base.getTime())
    d.setUTCDate(d.getUTCDate() + days)
    return d
  }

  // Algoritmo de Meeus/Jones/Butcher (calendario gregoriano).
  const calcularPascoa = (ano: number): Date => {
    const a = ano % 19
    const b = Math.floor(ano / 100)
    const c = ano % 100
    const d = Math.floor(b / 4)
    const e = b % 4
    const f = Math.floor((b + 8) / 25)
    const g = Math.floor((b - f + 1) / 3)
    const h = (19 * a + b - d - g + 15) % 30
    const i = Math.floor(c / 4)
    const k = c % 4
    const l = (32 + 2 * e + 2 * i - h - k) % 7
    const m = Math.floor((a + 11 * h + 22 * l) / 451)
    const month = Math.floor((h + l - 7 * m + 114) / 31) // 3=mar, 4=abr
    const day = ((h + l - 7 * m + 114) % 31) + 1
    return new Date(Date.UTC(ano, month - 1, day))
  }

  const gerarFeriadosMoveis = (ano: number) => {
    const pascoa = calcularPascoa(ano)
    const carnavalSeg = addDays(pascoa, -48)
    const carnavalTer = addDays(pascoa, -47)
    const sextaSanta = addDays(pascoa, -2)
    const corpusChristi = addDays(pascoa, 60)
    return [
      [toIso(carnavalSeg), 'Carnaval (ponto facultativo)', 'NACIONAL', 0, 1],
      [toIso(carnavalTer), 'Carnaval (ponto facultativo)', 'NACIONAL', 0, 1],
      [toIso(sextaSanta), 'Sexta-feira Santa', 'NACIONAL', 0, 1],
      [toIso(corpusChristi), 'Corpus Christi', 'NACIONAL', 0, 1],
    ] as const
  }

  db.transaction(() => {
    for (const ano of [currentYear, currentYear + 1]) {
      for (const f of gerarFeriadosAno(ano)) {
        insertFeriado.run(...f)
      }
      for (const f of gerarFeriadosMoveis(ano)) {
        insertFeriado.run(...f)
      }
    }
  })()

  const total = db.prepare('SELECT COUNT(*) as count FROM feriados').get() as { count: number }
  console.log(`[SEED] ${total.count} feriados nacionais criados (${currentYear}-${currentYear + 1})`)
}
