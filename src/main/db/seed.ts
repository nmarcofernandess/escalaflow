import { getDb } from './database'

type DiaSemana = 'SEG' | 'TER' | 'QUA' | 'QUI' | 'SEX' | 'SAB' | 'DOM'

const DIAS_SEMANA: DiaSemana[] = ['SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB', 'DOM']

interface HorarioDiaSeed {
  ativo: boolean
  usa_padrao: boolean
  hora_abertura: string
  hora_fechamento: string
}

interface SegmentoSeed {
  hora_inicio: string
  hora_fim: string
  min_pessoas: number
  override?: boolean
}

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

  // --- Tipos de Contrato ---
  const tiposExistem = db.prepare('SELECT COUNT(*) as count FROM tipos_contrato').get() as { count: number }
  if (tiposExistem.count === 0) {
    const insertTipo = db.prepare(`
      INSERT INTO tipos_contrato (nome, horas_semanais, regime_escala, dias_trabalho, trabalha_domingo, max_minutos_dia)
      VALUES (?, ?, ?, ?, ?, ?)
    `)

    const tipos = [
      ['CLT 44h', 44, '6X1', 6, 1, 600],
      ['CLT 36h', 36, '5X2', 5, 1, 480],
      ['CLT 30h', 30, '5X2', 5, 1, 360],
      ['Estagiario 30h', 30, '5X2', 5, 0, 360],
      ['Aprendiz 30h', 30, '5X2', 5, 0, 360],
    ] as const

    db.transaction(() => {
      for (const tipo of tipos) insertTipo.run(...tipo)
    })()
    console.log('[SEED] 5 tipos de contrato criados')
  }

  // --- Setores (apenas Caixa e Acougue) ---
  const setoresExistem = db.prepare('SELECT COUNT(*) as count FROM setores').get() as { count: number }
  if (setoresExistem.count === 0) {
    const insertSetor = db.prepare(`
      INSERT INTO setores (nome, icone, hora_abertura, hora_fechamento, piso_operacional, ativo)
      VALUES (?, ?, ?, ?, ?, ?)
    `)

    const setores = [
      ['Caixa', 'banknote', '08:00', '20:00', 1, 1],
      ['Acougue', 'beef', '07:00', '19:30', 1, 1],
    ] as const

    db.transaction(() => {
      for (const setor of setores) insertSetor.run(...setor)
    })()
    console.log('[SEED] 2 setores criados (Caixa, Acougue)')
  }

  const setoresRows = db.prepare('SELECT id, nome FROM setores WHERE nome IN (?, ?)').all('Caixa', 'Acougue') as Array<{ id: number; nome: string }>
  const setorIdByNome = new Map(setoresRows.map((r) => [r.nome, r.id]))
  const caixaId = setorIdByNome.get('Caixa')
  const acougueId = setorIdByNome.get('Acougue')

  if (!caixaId || !acougueId) {
    console.warn('[SEED] Caixa/Acougue nao encontrados. Seed interrompido.')
    return
  }

  // --- Horario semanal por setor/dia (14 linhas) ---
  const horariosCaixa: Record<DiaSemana, HorarioDiaSeed> = {
    SEG: { ativo: true, usa_padrao: false, hora_abertura: '08:00', hora_fechamento: '20:00' },
    TER: { ativo: true, usa_padrao: false, hora_abertura: '08:00', hora_fechamento: '20:00' },
    QUA: { ativo: true, usa_padrao: false, hora_abertura: '08:00', hora_fechamento: '20:00' },
    QUI: { ativo: true, usa_padrao: false, hora_abertura: '08:00', hora_fechamento: '20:00' },
    SEX: { ativo: true, usa_padrao: false, hora_abertura: '08:00', hora_fechamento: '20:00' },
    SAB: { ativo: true, usa_padrao: false, hora_abertura: '08:00', hora_fechamento: '20:00' },
    DOM: { ativo: false, usa_padrao: false, hora_abertura: '08:00', hora_fechamento: '12:00' },
  }

  const horariosAcougue: Record<DiaSemana, HorarioDiaSeed> = {
    SEG: { ativo: true, usa_padrao: true, hora_abertura: '07:00', hora_fechamento: '19:30' },
    TER: { ativo: true, usa_padrao: true, hora_abertura: '07:00', hora_fechamento: '19:30' },
    QUA: { ativo: true, usa_padrao: true, hora_abertura: '07:00', hora_fechamento: '19:30' },
    QUI: { ativo: true, usa_padrao: true, hora_abertura: '07:00', hora_fechamento: '19:30' },
    SEX: { ativo: true, usa_padrao: true, hora_abertura: '07:00', hora_fechamento: '19:30' },
    SAB: { ativo: true, usa_padrao: true, hora_abertura: '07:00', hora_fechamento: '19:30' },
    DOM: { ativo: true, usa_padrao: false, hora_abertura: '07:00', hora_fechamento: '12:00' },
  }

  const upsertHorarioDia = db.prepare(`
    INSERT INTO setor_horario_semana (setor_id, dia_semana, ativo, usa_padrao, hora_abertura, hora_fechamento)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(setor_id, dia_semana) DO UPDATE SET
      ativo = excluded.ativo,
      usa_padrao = excluded.usa_padrao,
      hora_abertura = excluded.hora_abertura,
      hora_fechamento = excluded.hora_fechamento
  `)

  db.transaction(() => {
    for (const dia of DIAS_SEMANA) {
      const c = horariosCaixa[dia]
      upsertHorarioDia.run(caixaId, dia, c.ativo ? 1 : 0, c.usa_padrao ? 1 : 0, c.hora_abertura, c.hora_fechamento)

      const a = horariosAcougue[dia]
      upsertHorarioDia.run(acougueId, dia, a.ativo ? 1 : 0, a.usa_padrao ? 1 : 0, a.hora_abertura, a.hora_fechamento)
    }
  })()
  console.log('[SEED] Horario semanal de Caixa/Acougue atualizado (14 linhas)')

  // --- Demandas por dia (sem dia_semana null) ---
  const demandasExistem = db.prepare('SELECT COUNT(*) as count FROM demandas').get() as { count: number }
  if (demandasExistem.count === 0) {
    const insertDemanda = db.prepare(`
      INSERT INTO demandas (setor_id, dia_semana, hora_inicio, hora_fim, min_pessoas, override)
      VALUES (?, ?, ?, ?, ?, ?)
    `)

    const caixaDemandasPorDia: Record<DiaSemana, SegmentoSeed[]> = {
      SEG: [
        { hora_inicio: '08:00', hora_fim: '10:00', min_pessoas: 2 },
        { hora_inicio: '10:00', hora_fim: '13:30', min_pessoas: 3 },
        { hora_inicio: '13:30', hora_fim: '15:00', min_pessoas: 2 },
        { hora_inicio: '15:00', hora_fim: '16:00', min_pessoas: 3 },
        { hora_inicio: '16:00', hora_fim: '16:30', min_pessoas: 4 },
        { hora_inicio: '16:30', hora_fim: '19:00', min_pessoas: 3 },
        { hora_inicio: '19:00', hora_fim: '19:30', min_pessoas: 2 },
        { hora_inicio: '19:30', hora_fim: '20:00', min_pessoas: 1 },
      ],
      TER: [
        { hora_inicio: '08:00', hora_fim: '10:00', min_pessoas: 2 },
        { hora_inicio: '10:00', hora_fim: '12:00', min_pessoas: 3 },
        { hora_inicio: '12:00', hora_fim: '13:00', min_pessoas: 2 },
        { hora_inicio: '13:00', hora_fim: '13:30', min_pessoas: 3 },
        { hora_inicio: '13:30', hora_fim: '15:00', min_pessoas: 2 },
        { hora_inicio: '15:00', hora_fim: '18:30', min_pessoas: 3 },
        { hora_inicio: '18:30', hora_fim: '19:30', min_pessoas: 2 },
      ],
      QUA: [
        { hora_inicio: '08:00', hora_fim: '09:30', min_pessoas: 2 },
        { hora_inicio: '09:30', hora_fim: '13:30', min_pessoas: 3 },
        { hora_inicio: '13:30', hora_fim: '15:00', min_pessoas: 2 },
        { hora_inicio: '15:00', hora_fim: '19:00', min_pessoas: 3 },
        { hora_inicio: '19:00', hora_fim: '19:30', min_pessoas: 1 },
      ],
      QUI: [
        { hora_inicio: '08:00', hora_fim: '10:00', min_pessoas: 3 },
        { hora_inicio: '10:00', hora_fim: '12:00', min_pessoas: 4 },
        { hora_inicio: '12:00', hora_fim: '13:30', min_pessoas: 3 },
        { hora_inicio: '13:30', hora_fim: '15:00', min_pessoas: 2 },
        { hora_inicio: '15:00', hora_fim: '19:00', min_pessoas: 3 },
        { hora_inicio: '19:00', hora_fim: '19:30', min_pessoas: 2 },
      ],
      SEX: [
        { hora_inicio: '08:00', hora_fim: '09:30', min_pessoas: 2 },
        { hora_inicio: '09:30', hora_fim: '10:30', min_pessoas: 3 },
        { hora_inicio: '10:30', hora_fim: '12:00', min_pessoas: 4 },
        { hora_inicio: '12:00', hora_fim: '14:00', min_pessoas: 3 },
        { hora_inicio: '14:00', hora_fim: '15:00', min_pessoas: 2 },
        { hora_inicio: '15:00', hora_fim: '15:30', min_pessoas: 3 },
        { hora_inicio: '15:30', hora_fim: '16:00', min_pessoas: 2 },
        { hora_inicio: '16:00', hora_fim: '19:00', min_pessoas: 3 },
        { hora_inicio: '19:00', hora_fim: '19:30', min_pessoas: 2 },
      ],
      SAB: [
        { hora_inicio: '08:00', hora_fim: '08:30', min_pessoas: 2 },
        { hora_inicio: '08:30', hora_fim: '09:30', min_pessoas: 3 },
        { hora_inicio: '09:30', hora_fim: '12:30', min_pessoas: 4 },
        { hora_inicio: '12:30', hora_fim: '13:30', min_pessoas: 3 },
        { hora_inicio: '13:30', hora_fim: '15:00', min_pessoas: 2 },
        { hora_inicio: '15:00', hora_fim: '16:00', min_pessoas: 3 },
        { hora_inicio: '16:00', hora_fim: '19:00', min_pessoas: 4 },
        { hora_inicio: '19:00', hora_fim: '19:30', min_pessoas: 3 },
      ],
      DOM: [],
    }

    const acouguePadraoSegSab: SegmentoSeed[] = [
      { hora_inicio: '07:00', hora_fim: '08:00', min_pessoas: 2 },
      { hora_inicio: '08:00', hora_fim: '10:00', min_pessoas: 5 },
      { hora_inicio: '10:00', hora_fim: '15:00', min_pessoas: 4 },
      { hora_inicio: '15:00', hora_fim: '17:00', min_pessoas: 7 },
      { hora_inicio: '17:00', hora_fim: '18:00', min_pessoas: 2 },
      { hora_inicio: '18:00', hora_fim: '19:30', min_pessoas: 1 },
    ]

    const acougueDomingo: SegmentoSeed[] = [
      { hora_inicio: '07:00', hora_fim: '08:00', min_pessoas: 2 },
      { hora_inicio: '08:00', hora_fim: '10:00', min_pessoas: 5 },
      { hora_inicio: '10:00', hora_fim: '12:00', min_pessoas: 4 },
    ]

    db.transaction(() => {
      for (const dia of DIAS_SEMANA) {
        const segsCaixa = caixaDemandasPorDia[dia]
        for (const seg of segsCaixa) {
          insertDemanda.run(caixaId, dia, seg.hora_inicio, seg.hora_fim, seg.min_pessoas, seg.override ? 1 : 0)
        }

        const segsAcougue = dia === 'DOM' ? acougueDomingo : acouguePadraoSegSab
        for (const seg of segsAcougue) {
          insertDemanda.run(acougueId, dia, seg.hora_inicio, seg.hora_fim, seg.min_pessoas, seg.override ? 1 : 0)
        }
      }
    })()

    console.log('[SEED] Demandas por dia criadas para Caixa/Acougue (sem legado null)')
  }

  // --- Postos (Funcoes) ---
  const insertFuncao = db.prepare(`
    INSERT INTO funcoes (setor_id, apelido, tipo_contrato_id, ativo, ordem)
    VALUES (?, ?, ?, ?, ?)
  `)
  const existeFuncao = db.prepare(`
    SELECT 1 FROM funcoes WHERE setor_id = ? AND upper(apelido) = upper(?) LIMIT 1
  `)

  const postosCaixa = ['CAI1', 'CAI2', 'CAI3', 'CAI4', 'CAI5', 'CAI6']
  const postosAcougue = ['AC1', 'AC2', 'AC3', 'AC4', 'AC5']

  let postosInseridos = 0
  db.transaction(() => {
    postosCaixa.forEach((apelido, i) => {
      const jaExiste = existeFuncao.get(caixaId, apelido) as { 1: 1 } | undefined
      if (jaExiste) return
      insertFuncao.run(caixaId, apelido, 1, 1, i + 1)
      postosInseridos++
    })

    postosAcougue.forEach((apelido, i) => {
      const jaExiste = existeFuncao.get(acougueId, apelido) as { 1: 1 } | undefined
      if (jaExiste) return
      insertFuncao.run(acougueId, apelido, 1, 1, i + 1)
      postosInseridos++
    })
  })()
  if (postosInseridos > 0) {
    console.log(`[SEED] ${postosInseridos} postos criados (Caixa/Acougue)`) 
  }

  // --- Colaboradores ---
  const colabsExistem = db.prepare('SELECT COUNT(*) as count FROM colaboradores').get() as { count: number }
  if (colabsExistem.count === 0) {
    const funcoesCaixa = db.prepare('SELECT id, apelido FROM funcoes WHERE setor_id = ?').all(caixaId) as Array<{ id: number; apelido: string }>
    const funcoesAcougue = db.prepare('SELECT id, apelido FROM funcoes WHERE setor_id = ?').all(acougueId) as Array<{ id: number; apelido: string }>
    const tipos = db.prepare('SELECT id, nome FROM tipos_contrato').all() as Array<{ id: number; nome: string }>

    const funcaoCaixaByApelido = new Map(funcoesCaixa.map((f) => [f.apelido.toUpperCase(), f.id]))
    const funcaoAcougueByApelido = new Map(funcoesAcougue.map((f) => [f.apelido.toUpperCase(), f.id]))
    const tipoByNome = new Map(tipos.map((t) => [t.nome, t.id]))

    const insertColab = db.prepare(`
      INSERT INTO colaboradores (
        setor_id, tipo_contrato_id, nome, sexo, horas_semanais, rank,
        prefere_turno, evitar_dia_semana, tipo_trabalhador, funcao_id
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    const caixaColabs = [
      { nome: 'Cleonice', sexo: 'F', funcao: 'CAI1', contrato: 'CLT 44h', horas: 44 },
      { nome: 'Gabriel', sexo: 'M', funcao: 'CAI2', contrato: 'CLT 36h', horas: 36 },
      { nome: 'Ana Julia', sexo: 'F', funcao: 'CAI3', contrato: 'CLT 44h', horas: 44 },
      { nome: 'Yasmin', sexo: 'F', funcao: 'CAI4', contrato: 'CLT 30h', horas: 30 },
      { nome: 'Mayumi', sexo: 'F', funcao: 'CAI5', contrato: 'CLT 30h', horas: 30 },
      { nome: 'Heloisa', sexo: 'F', funcao: 'CAI6', contrato: 'CLT 30h', horas: 30 },
    ] as const

    const acougueColabs = [
      { nome: 'Alex', sexo: 'M', funcao: 'AC1' },
      { nome: 'Mateus', sexo: 'M', funcao: 'AC2' },
      { nome: 'Jose Luiz', sexo: 'M', funcao: 'AC3' },
      { nome: 'Jessica', sexo: 'F', funcao: 'AC4' },
      { nome: 'Robert', sexo: 'M', funcao: 'AC5' },
    ] as const

    db.transaction(() => {
      caixaColabs.forEach((c, i) => {
        const tipoContratoId = tipoByNome.get(c.contrato) ?? 1
        insertColab.run(
          caixaId,
          tipoContratoId,
          c.nome,
          c.sexo,
          c.horas,
          i + 1,
          null,
          null,
          'CLT',
          funcaoCaixaByApelido.get(c.funcao) ?? null,
        )
      })

      acougueColabs.forEach((c, i) => {
        insertColab.run(
          acougueId,
          1,
          c.nome,
          c.sexo,
          44,
          i + 1,
          null,
          null,
          'CLT',
          funcaoAcougueByApelido.get(c.funcao) ?? null,
        )
      })
    })()

    console.log('[SEED] 11 colaboradores criados (Caixa + Acougue)')
  }

  // v3.1 — Feriados nacionais (RFC §12.2)
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
    [`${ano}-01-01`, 'Confraternizacao Universal', 'NACIONAL', 1, 0],
    [`${ano}-04-21`, 'Tiradentes', 'NACIONAL', 0, 1],
    [`${ano}-05-01`, 'Dia do Trabalho', 'NACIONAL', 0, 1],
    [`${ano}-09-07`, 'Independencia do Brasil', 'NACIONAL', 0, 1],
    [`${ano}-10-12`, 'Nossa Senhora Aparecida', 'NACIONAL', 0, 1],
    [`${ano}-11-02`, 'Finados', 'NACIONAL', 0, 1],
    [`${ano}-11-15`, 'Proclamacao da Republica', 'NACIONAL', 0, 1],
    [`${ano}-12-25`, 'Natal', 'NACIONAL', 1, 0],
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
