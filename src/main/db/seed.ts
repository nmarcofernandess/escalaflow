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

// ============================================================================
// Paleta fixa de cores (15 cores — PRD v4)
// ============================================================================

const PALETA_CORES = [
  '#3B82F6', '#EF4444', '#10B981', '#F59E0B', '#8B5CF6',
  '#EC4899', '#14B8A6', '#F97316', '#6366F1', '#84CC16',
  '#06B6D4', '#D946EF', '#78716C', '#0EA5E9', '#A3E635',
]

// ============================================================================
// SEED principal
// ============================================================================

export function seedData(): void {
  const db = getDb()

  // ── 1. Empresa ─────────────────────────────────────────────────────────
  const empresaExiste = db.prepare('SELECT COUNT(*) as count FROM empresa').get() as { count: number }
  if (empresaExiste.count === 0) {
    db.prepare(`
      INSERT INTO empresa (nome, cnpj, telefone, corte_semanal, tolerancia_semanal_min)
      VALUES (?, ?, ?, ?, ?)
    `).run('Supermercado Fernandes', '', '', 'SEG_DOM', 90)
    console.log('[SEED] Empresa criada (tolerancia_semanal=90, grid_minutos→15 via migration)')
  }

  // ── 2. Tipos de Contrato ──────────────────────────────────────────────
  const tiposExistem = db.prepare('SELECT COUNT(*) as count FROM tipos_contrato').get() as { count: number }
  if (tiposExistem.count === 0) {
    const insertTipo = db.prepare(`
      INSERT INTO tipos_contrato (nome, horas_semanais, regime_escala, dias_trabalho, trabalha_domingo, max_minutos_dia)
      VALUES (?, ?, ?, ?, ?, ?)
    `)

    // CLT 44h/36h: regime 5X2 com compensacao ate 9h45 (585min)
    // Estagiarios: NUNCA domingo, max conforme jornada
    const tipos = [
      ['CLT 44h', 44, '5X2', 5, 1, 585],   // id=1
      ['CLT 36h', 36, '5X2', 5, 1, 585],   // id=2
      ['Estagiario Manha', 20, '5X2', 5, 0, 240],   // id=3  4h/dia
      ['Estagiario Tarde', 30, '5X2', 5, 0, 360],   // id=4  6h/dia
      ['Estagiario Noite-Estudo', 30, '5X2', 5, 0, 360],  // id=5  6h/dia
    ] as const

    db.transaction(() => {
      for (const tipo of tipos) insertTipo.run(...tipo)
    })()
    console.log('[SEED] 5 tipos de contrato criados (CLT 44h, CLT 36h, 3x Estagiario)')
  }

  // ── 3. Setores ────────────────────────────────────────────────────────
  const setoresExistem = db.prepare('SELECT COUNT(*) as count FROM setores').get() as { count: number }
  if (setoresExistem.count === 0) {
    const insertSetor = db.prepare(`
      INSERT INTO setores (nome, icone, hora_abertura, hora_fechamento, ativo)
      VALUES (?, ?, ?, ?, ?)
    `)

    const setores = [
      ['Caixa', 'banknote', '08:00', '20:00', 1],
      ['Acougue', 'beef', '07:00', '19:30', 1],
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

  // ── 4. Horario semanal por setor/dia ──────────────────────────────────
  const horariosCaixa: Record<DiaSemana, HorarioDiaSeed> = {
    SEG: { ativo: true, usa_padrao: false, hora_abertura: '08:00', hora_fechamento: '20:00' },
    TER: { ativo: true, usa_padrao: false, hora_abertura: '08:00', hora_fechamento: '20:00' },
    QUA: { ativo: true, usa_padrao: false, hora_abertura: '08:00', hora_fechamento: '20:00' },
    QUI: { ativo: true, usa_padrao: false, hora_abertura: '08:00', hora_fechamento: '20:00' },
    SEX: { ativo: true, usa_padrao: false, hora_abertura: '08:00', hora_fechamento: '20:00' },
    SAB: { ativo: true, usa_padrao: false, hora_abertura: '08:00', hora_fechamento: '20:00' },
    DOM: { ativo: true, usa_padrao: false, hora_abertura: '08:00', hora_fechamento: '13:00' },
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
  console.log('[SEED] Horario semanal Caixa/Acougue atualizado (Caixa DOM ativo=true 08-13h)')

  // ── 5. Demandas por dia (grid 15min compliant) ────────────────────────
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
      DOM: [
        { hora_inicio: '08:00', hora_fim: '09:00', min_pessoas: 1 },
        { hora_inicio: '09:00', hora_fim: '11:00', min_pessoas: 3 },
        { hora_inicio: '11:00', hora_fim: '12:00', min_pessoas: 2 },
        { hora_inicio: '12:00', hora_fim: '13:00', min_pessoas: 1 },
      ],
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

    console.log('[SEED] Demandas por dia criadas Caixa/Acougue (DOM Caixa: 08-13h, 1-3 pessoas)')
  }

  // ── 6. Postos (Funcoes) — 15 para Caixa, 5 para Acougue ──────────────
  const insertFuncao = db.prepare(`
    INSERT INTO funcoes (setor_id, apelido, tipo_contrato_id, ativo, ordem, cor_hex)
    VALUES (?, ?, ?, ?, ?, ?)
  `)
  const existeFuncao = db.prepare(`
    SELECT 1 FROM funcoes WHERE setor_id = ? AND upper(apelido) = upper(?) LIMIT 1
  `)

  const postosCaixa = [
    'CAI1', 'CAI2', 'CAI3', 'CAI4', 'CAI5', 'CAI6', 'CAI7', 'CAI8',
    'CAI9', 'CAI10', 'CAI11', 'CAI12', 'CAI13', 'CAI14', 'CAI15',
  ]
  const postosAcougue = ['AC1', 'AC2', 'AC3', 'AC4', 'AC5']

  let postosInseridos = 0
  db.transaction(() => {
    postosCaixa.forEach((apelido, i) => {
      const jaExiste = existeFuncao.get(caixaId, apelido) as { 1: 1 } | undefined
      if (jaExiste) return
      insertFuncao.run(caixaId, apelido, 1, 1, i + 1, PALETA_CORES[i % PALETA_CORES.length])
      postosInseridos++
    })

    postosAcougue.forEach((apelido, i) => {
      const jaExiste = existeFuncao.get(acougueId, apelido) as { 1: 1 } | undefined
      if (jaExiste) return
      const corIdx = (postosCaixa.length + i) % PALETA_CORES.length
      insertFuncao.run(acougueId, apelido, 1, 1, i + 1, PALETA_CORES[corIdx])
      postosInseridos++
    })
  })()
  if (postosInseridos > 0) {
    console.log(`[SEED] ${postosInseridos} postos criados (15 Caixa + 5 Acougue)`)
  }

  // v4: Atribuir cores a funcoes existentes sem cor_hex
  const funcoesSemCor = db.prepare('SELECT id, ordem FROM funcoes WHERE cor_hex IS NULL').all() as Array<{ id: number; ordem: number }>
  if (funcoesSemCor.length > 0) {
    const updateCor = db.prepare('UPDATE funcoes SET cor_hex = ? WHERE id = ?')
    db.transaction(() => {
      for (const f of funcoesSemCor) {
        updateCor.run(PALETA_CORES[(f.ordem - 1) % PALETA_CORES.length], f.id)
      }
    })()
    console.log(`[SEED] ${funcoesSemCor.length} funcoes atualizadas com cor_hex`)
  }

  // ── 7. Colaboradores ──────────────────────────────────────────────────
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

    // Caixa: 5 CLT + 3 estagiarios = 8 colaboradores
    // 5 CLT podem trabalhar domingo, 3 estagiarios NUNCA
    const caixaColabs = [
      { nome: 'Cleunice', sexo: 'F', funcao: 'CAI1', contrato: 'CLT 44h', horas: 44, tipo_trabalhador: 'CLT' },
      { nome: 'Gabriel', sexo: 'M', funcao: 'CAI2', contrato: 'CLT 36h', horas: 36, tipo_trabalhador: 'CLT' },
      { nome: 'Ana Julia', sexo: 'F', funcao: 'CAI3', contrato: 'CLT 44h', horas: 44, tipo_trabalhador: 'CLT' },
      { nome: 'Marcos', sexo: 'M', funcao: 'CAI4', contrato: 'CLT 44h', horas: 44, tipo_trabalhador: 'CLT' },
      { nome: 'Fernanda', sexo: 'F', funcao: 'CAI5', contrato: 'CLT 44h', horas: 44, tipo_trabalhador: 'CLT' },
      { nome: 'Lucas', sexo: 'M', funcao: 'CAI6', contrato: 'Estagiario Manha', horas: 20, tipo_trabalhador: 'ESTAGIARIO' },
      { nome: 'Camila', sexo: 'F', funcao: 'CAI7', contrato: 'Estagiario Tarde', horas: 30, tipo_trabalhador: 'ESTAGIARIO' },
      { nome: 'Pedro', sexo: 'M', funcao: 'CAI8', contrato: 'Estagiario Noite-Estudo', horas: 30, tipo_trabalhador: 'ESTAGIARIO' },
    ] as const

    // Acougue: 5 CLT 44h
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
          c.tipo_trabalhador,
          funcaoCaixaByApelido.get(c.funcao) ?? null,
        )
      })

      acougueColabs.forEach((c, i) => {
        insertColab.run(
          acougueId,
          tipoByNome.get('CLT 44h') ?? 1,
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

    console.log('[SEED] 13 colaboradores criados (8 Caixa + 5 Acougue)')
  }

  // ── 8. Perfis de Horario por Contrato ─────────────────────────────────
  const perfisExistem = db.prepare('SELECT COUNT(*) as count FROM contrato_perfis_horario').get() as { count: number }
  if (perfisExistem.count === 0) {
    const tipoByNome = new Map(
      (db.prepare('SELECT id, nome FROM tipos_contrato').all() as Array<{ id: number; nome: string }>)
        .map((t) => [t.nome, t.id]),
    )

    const insertPerfil = db.prepare(`
      INSERT INTO contrato_perfis_horario (tipo_contrato_id, nome, ativo, inicio_min, inicio_max, fim_min, fim_max, preferencia_turno_soft, ordem)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    const perfis = [
      // Estagiario Manha: fixo 08:00-12:00 (4h)
      {
        contrato: 'Estagiario Manha', nome: 'MANHA_08_12',
        inicio_min: '08:00', inicio_max: '08:00',
        fim_min: '12:00', fim_max: '12:00',
        turno: 'MANHA', ordem: 1,
      },
      // Estagiario Tarde: janela 13:30-17:00 inicio, 19:00-20:00 fim (ate 6h)
      {
        contrato: 'Estagiario Tarde', nome: 'TARDE_1330_PLUS',
        inicio_min: '13:30', inicio_max: '17:00',
        fim_min: '19:00', fim_max: '20:00',
        turno: 'TARDE', ordem: 2,
      },
      // Estagiario Noite-Estudo: fixo 08:00-14:00 (6h, sai pra faculdade)
      {
        contrato: 'Estagiario Noite-Estudo', nome: 'ESTUDA_NOITE_08_14',
        inicio_min: '08:00', inicio_max: '08:00',
        fim_min: '14:00', fim_max: '14:00',
        turno: 'MANHA', ordem: 3,
      },
    ] as const

    db.transaction(() => {
      for (const p of perfis) {
        const tipoId = tipoByNome.get(p.contrato)
        if (!tipoId) {
          console.warn(`[SEED] Contrato '${p.contrato}' nao encontrado. Perfil '${p.nome}' ignorado.`)
          continue
        }
        insertPerfil.run(tipoId, p.nome, 1, p.inicio_min, p.inicio_max, p.fim_min, p.fim_max, p.turno, p.ordem)
      }
    })()
    console.log('[SEED] 3 perfis de horario criados (MANHA_08_12, TARDE_1330_PLUS, ESTUDA_NOITE_08_14)')
  }

  // ── 9. Regras de Horario por Colaborador ──────────────────────────────
  const regrasExistem = db.prepare('SELECT COUNT(*) as count FROM colaborador_regra_horario').get() as { count: number }
  if (regrasExistem.count === 0) {
    const colabs = db.prepare('SELECT id, nome FROM colaboradores WHERE setor_id = ?').all(caixaId) as Array<{ id: number; nome: string }>
    const colabByNome = new Map(colabs.map((c) => [c.nome, c.id]))

    const perfis = db.prepare('SELECT id, nome FROM contrato_perfis_horario').all() as Array<{ id: number; nome: string }>
    const perfilByNome = new Map(perfis.map((p) => [p.nome, p.id]))

    const insertRegra = db.prepare(`
      INSERT INTO colaborador_regra_horario (
        colaborador_id, ativo, perfil_horario_id,
        inicio_min, inicio_max, fim_min, fim_max,
        preferencia_turno_soft, domingo_ciclo_trabalho, domingo_ciclo_folga,
        folga_fixa_dia_semana
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    const regras: Array<{
      nome: string
      perfil?: string
      inicio_min?: string
      inicio_max?: string
      fim_min?: string
      fim_max?: string
      turno_soft?: string | null
      dom_trab?: number
      dom_folga?: number
      folga_fixa?: string | null
    }> = [
        // Cleunice: SEMPRE inicia 08:00, horario fixo
        {
          nome: 'Cleunice',
          inicio_min: '08:00', inicio_max: '08:00',
          dom_trab: 2, dom_folga: 1,
        },
        // Gabriel: nunca passa das 16:30, prefere manha, ciclo domingo 2/1
        {
          nome: 'Gabriel',
          fim_max: '16:30',
          turno_soft: 'MANHA',
          dom_trab: 2, dom_folga: 1,
        },
        // Ana Julia: 5x2 com folga fixa na quarta
        {
          nome: 'Ana Julia',
          folga_fixa: 'QUA',
          dom_trab: 2, dom_folga: 1,
        },
        // Marcos: 5x2 SEM folga fixa (solver decide)
        {
          nome: 'Marcos',
          folga_fixa: null,
          dom_trab: 2, dom_folga: 1,
        },
        // Fernanda: 5x2 com folga fixa na segunda
        {
          nome: 'Fernanda',
          folga_fixa: 'SEG',
          dom_trab: 2, dom_folga: 1,
        },
        // Lucas: estagiario manha → perfil MANHA_08_12
        {
          nome: 'Lucas',
          perfil: 'MANHA_08_12',
          dom_trab: 0, dom_folga: 0,
        },
        // Camila: estagiaria tarde → perfil TARDE_1330_PLUS
        {
          nome: 'Camila',
          perfil: 'TARDE_1330_PLUS',
          dom_trab: 0, dom_folga: 0,
        },
        // Pedro: estagiario noite-estudo → perfil ESTUDA_NOITE_08_14
        {
          nome: 'Pedro',
          perfil: 'ESTUDA_NOITE_08_14',
          dom_trab: 0, dom_folga: 0,
        },
      ]

    db.transaction(() => {
      for (const r of regras) {
        const colabId = colabByNome.get(r.nome)
        if (!colabId) {
          console.warn(`[SEED] Colaborador '${r.nome}' nao encontrado. Regra ignorada.`)
          continue
        }
        const perfilId = r.perfil ? (perfilByNome.get(r.perfil) ?? null) : null
        insertRegra.run(
          colabId,
          1,                             // ativo
          perfilId,
          r.inicio_min ?? null,
          r.inicio_max ?? null,
          r.fim_min ?? null,
          r.fim_max ?? null,
          r.turno_soft ?? null,
          r.dom_trab ?? 2,
          r.dom_folga ?? 1,
          r.folga_fixa ?? null,
        )
      }
    })()
    console.log('[SEED] 8 regras de horario criadas (Cleunice=fixo 08h, Gabriel=max 16h, 3 folga fixa, 3 perfis estagiario)')
  }

  // ── 10. Excecoes de Horario por Data ──────────────────────────────────
  // Periodo de teste sugerido: 2026-03-02 a 2026-04-26 (8 semanas)
  const excHorarioExistem = db.prepare('SELECT COUNT(*) as count FROM colaborador_regra_horario_excecao_data').get() as { count: number }
  if (excHorarioExistem.count === 0) {
    const colabs = db.prepare('SELECT id, nome FROM colaboradores WHERE setor_id = ?').all(caixaId) as Array<{ id: number; nome: string }>
    const colabByNome = new Map(colabs.map((c) => [c.nome, c.id]))

    const insertExcData = db.prepare(`
      INSERT INTO colaborador_regra_horario_excecao_data (
        colaborador_id, data, ativo,
        inicio_min, inicio_max, fim_min, fim_max,
        preferencia_turno_soft, domingo_forcar_folga
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    const excecoes = [
      // Lucas: prova na sexta 13/03 — forcar folga
      { nome: 'Lucas', data: '2026-03-13', forcar_folga: 1 },
      // Gabriel: medico quarta 25/03 — so pode ir a tarde (14:00+)
      {
        nome: 'Gabriel', data: '2026-03-25',
        inicio_min: '14:00', inicio_max: '14:00',
        fim_min: '18:00', fim_max: '20:00',
        turno_soft: 'TARDE', forcar_folga: 0,
      },
      // Camila: compromisso manha quarta 18/03 — inicia 14:00 (override do perfil tarde)
      {
        nome: 'Camila', data: '2026-03-18',
        inicio_min: '14:00', inicio_max: '14:00',
        fim_min: '19:00', fim_max: '20:00',
        turno_soft: 'TARDE', forcar_folga: 0,
      },
    ]

    db.transaction(() => {
      for (const e of excecoes) {
        const colabId = colabByNome.get(e.nome)
        if (!colabId) continue
        insertExcData.run(
          colabId,
          e.data,
          1,
          ('inicio_min' in e) ? e.inicio_min : null,
          ('inicio_max' in e) ? e.inicio_max : null,
          ('fim_min' in e) ? e.fim_min : null,
          ('fim_max' in e) ? e.fim_max : null,
          ('turno_soft' in e) ? e.turno_soft : null,
          e.forcar_folga,
        )
      }
    })()
    console.log('[SEED] 3 excecoes de horario por data (Lucas prova, Gabriel medico, Camila compromisso)')
  }

  // ── 11. Demandas Excecao por Data ─────────────────────────────────────
  const demExcExistem = db.prepare('SELECT COUNT(*) as count FROM demandas_excecao_data').get() as { count: number }
  if (demExcExistem.count === 0) {
    const insertDemExc = db.prepare(`
      INSERT INTO demandas_excecao_data (setor_id, data, hora_inicio, hora_fim, min_pessoas, override)
      VALUES (?, ?, ?, ?, ?, ?)
    `)

    db.transaction(() => {
      // Domingo 08/03/2026: demanda mais alta que o padrao (evento especial)
      insertDemExc.run(caixaId, '2026-03-08', '08:00', '09:00', 2, 1)
      insertDemExc.run(caixaId, '2026-03-08', '09:00', '12:00', 4, 1)  // 4 ao inves de 3
      insertDemExc.run(caixaId, '2026-03-08', '12:00', '13:00', 3, 1)  // 3 ao inves de 1

      // Tiradentes 21/04/2026 (terca): feriado COM demanda explicita (feriado orientado a demanda)
      insertDemExc.run(caixaId, '2026-04-21', '08:00', '10:00', 2, 1)
      insertDemExc.run(caixaId, '2026-04-21', '10:00', '14:00', 3, 1)
      insertDemExc.run(caixaId, '2026-04-21', '14:00', '18:00', 2, 1)
    })()
    console.log('[SEED] 6 demandas excecao por data (DOM 08/03 reforco + Tiradentes 21/04 com demanda)')
  }

  // ── 12. Excecoes (ferias/atestado/bloqueio) ───────────────────────────
  const excecoesExistem = db.prepare('SELECT COUNT(*) as count FROM excecoes').get() as { count: number }
  if (excecoesExistem.count === 0) {
    const colabs = db.prepare('SELECT id, nome FROM colaboradores WHERE setor_id = ?').all(caixaId) as Array<{ id: number; nome: string }>
    const colabByNome = new Map(colabs.map((c) => [c.nome, c.id]))

    const insertExcecao = db.prepare(`
      INSERT INTO excecoes (colaborador_id, data_inicio, data_fim, tipo, observacao)
      VALUES (?, ?, ?, ?, ?)
    `)

    const marcosId = colabByNome.get('Marcos')
    if (marcosId) {
      // Marcos: bloqueio semana 16-20/03/2026 (segunda a sexta — compromisso pessoal)
      insertExcecao.run(marcosId, '2026-03-16', '2026-03-20', 'BLOQUEIO', 'Compromisso pessoal — indisponivel a semana toda')
      console.log('[SEED] 1 excecao: Marcos BLOQUEIO 16-20/03/2026')
    }
  }

  // ── 13. Feriados ──────────────────────────────────────────────────────
  seedFeriados()

  // ── 14. Regras do Motor (v6) ──────────────────────────────────────────
  seedRegrasDefinicao()

  // ── 15. Horários de Funcionamento da Empresa ───────────────────────────
  const horarioEmpresaExiste = db.prepare('SELECT COUNT(*) as count FROM empresa_horario_semana').get() as { count: number }
  if (horarioEmpresaExiste.count === 0) {
    const insertHorario = db.prepare(`
      INSERT OR IGNORE INTO empresa_horario_semana (dia_semana, ativo, hora_abertura, hora_fechamento)
      VALUES (?, ?, ?, ?)
    `)
    const horariosEmpresa: [string, number, string, string][] = [
      ['SEG', 1, '08:00', '22:00'],
      ['TER', 1, '08:00', '22:00'],
      ['QUA', 1, '08:00', '22:00'],
      ['QUI', 1, '08:00', '22:00'],
      ['SEX', 1, '08:00', '22:00'],
      ['SAB', 1, '08:00', '20:00'],
      ['DOM', 1, '08:00', '14:00'],
    ]
    db.transaction(() => {
      for (const [dia, ativo, abertura, fechamento] of horariosEmpresa) {
        insertHorario.run(dia, ativo, abertura, fechamento)
      }
    })()
    console.log('[SEED] 7 horários de empresa criados (SEG-SEX 08-22h, SAB 08-20h, DOM 08-14h)')
  }

  console.log('[SEED] Seed concluido')
  console.log('[SEED] >>> Periodo sugerido para teste: 2026-03-02 a 2026-04-26 (8 semanas) <<<')
}

// ============================================================================
// Regras do Motor — Catálogo (v6 SPEC-02B)
// ============================================================================

function seedRegrasDefinicao(): void {
  const db = getDb()
  const count = (db.prepare('SELECT COUNT(*) as count FROM regra_definicao').get() as { count: number }).count
  if (count > 0) return

  const insert = db.prepare(`
    INSERT OR IGNORE INTO regra_definicao (codigo, nome, descricao, categoria, status_sistema, editavel, aviso_dependencia, ordem)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)

  const regras: [string, string, string, string, string, number, string | null, number][] = [
    // ── CLT ─────────────────────────────────────────────────────────────
    ['H1', 'Máximo 6 dias consecutivos', 'Nenhum colaborador pode trabalhar mais de 6 dias seguidos sem folga (CLT Art. 67).', 'CLT', 'HARD', 1, 'Desligar pode afetar o controle da meta semanal de horas.', 1],
    ['H2', 'Descanso mínimo de 11h entre jornadas', 'Intervalo mínimo obrigatório de 11 horas entre o fim de uma jornada e o início da próxima (CLT Art. 66).', 'CLT', 'HARD', 0, null, 2],
    ['H4', 'Jornada máxima diária de 10h', 'Nenhuma jornada pode ultrapassar 10 horas por dia incluindo hora extra (CLT Art. 59).', 'CLT', 'HARD', 0, null, 3],
    ['H5', 'Férias, atestados e bloqueios', 'Colaboradores em férias, atestado ou bloqueio cadastrado não recebem alocação de trabalho.', 'CLT', 'HARD', 0, null, 4],
    ['H6', 'Human blocks — almoço e estrutura de jornada', 'Garante que cada jornada tenha intervalo de almoço e estrutura mínima de blocos (CLT Art. 71).', 'CLT', 'HARD', 1, 'Sem human blocks, o motor pode gerar jornadas sem intervalo de almoço.', 5],
    ['H10', 'Meta semanal de horas', 'Cada colaborador deve atingir a meta semanal de horas conforme seu contrato (CLT Art. 58).', 'CLT', 'HARD', 1, 'Desligar H10 quebra todo o cálculo de horas semanais.', 6],
    ['H11', 'Aprendiz — nunca domingo', 'Menor aprendiz não pode trabalhar aos domingos (CLT Art. 405).', 'CLT', 'HARD', 0, null, 7],
    ['H12', 'Aprendiz — nunca feriado', 'Menor aprendiz não pode trabalhar em feriados (CLT Art. 405).', 'CLT', 'HARD', 0, null, 8],
    ['H13', 'Aprendiz — nunca noturno (22h–5h)', 'Menor aprendiz não pode trabalhar no período noturno entre 22h e 5h (CLT Art. 404).', 'CLT', 'HARD', 0, null, 9],
    ['H14', 'Aprendiz — nunca hora extra', 'Menor aprendiz não pode realizar horas extras (CLT Art. 432).', 'CLT', 'HARD', 0, null, 10],
    ['H15', 'Estagiário — máx 6h/dia e 30h/sem', 'Estagiário tem jornada máxima de 6h/dia e 30h/semana (Lei 11.788/2008 Art. 10).', 'CLT', 'HARD', 0, null, 11],
    ['H16', 'Estagiário — nunca hora extra', 'Estagiário não pode realizar horas extras.', 'CLT', 'HARD', 0, null, 12],
    ['H17', 'Feriado proibido — 25/12 (Natal)', 'Trabalho proibido em 25 de dezembro conforme CCT FecomercioSP.', 'CLT', 'HARD', 0, null, 13],
    ['H18', 'Feriado proibido — 01/01 (Ano Novo)', 'Trabalho proibido em 1º de janeiro conforme CCT FecomercioSP.', 'CLT', 'HARD', 0, null, 14],
    ['DIAS_TRABALHO', 'Dias de trabalho por semana (5x2 / 6x1)', 'Cada colaborador deve trabalhar o número correto de dias conforme regime do contrato.', 'CLT', 'HARD', 1, 'Desligar pode gerar semanas com número incorreto de dias trabalhados.', 15],
    ['MIN_DIARIO', 'Jornada mínima diária (4h)', 'Jornadas abaixo de 4h são microturenos sem valor econômico (CLT Art. 58-A §4).', 'CLT', 'HARD', 1, 'Desligar pode gerar microturnos inúteis de poucos minutos.', 16],

    // ── SOFT ────────────────────────────────────────────────────────────
    ['S_DEFICIT', 'Déficit de cobertura', 'Penaliza slots abaixo da demanda mínima planejada.', 'SOFT', 'ON', 1, null, 101],
    ['S_SURPLUS', 'Excesso de cobertura', 'Penaliza slots com mais pessoas do que a demanda máxima.', 'SOFT', 'ON', 1, null, 102],
    ['S_DOMINGO_CICLO', 'Rodízio justo de domingos', 'Distribui domingos de trabalho de forma equitativa entre a equipe.', 'SOFT', 'ON', 1, null, 103],
    ['S_TURNO_PREF', 'Preferência de turno por colaborador', 'Tenta acomodar a preferência de turno (manhã/tarde) de cada colaborador.', 'SOFT', 'ON', 1, null, 104],
    ['S_CONSISTENCIA', 'Consistência de horários entre dias', 'Penaliza variações bruscas de horário do mesmo colaborador ao longo da semana.', 'SOFT', 'ON', 1, null, 105],
    ['S_SPREAD', 'Equilíbrio de carga entre a equipe', 'Distribui horas de trabalho de forma equilibrada entre os colaboradores.', 'SOFT', 'ON', 1, null, 106],
    ['S_AP1_EXCESS', 'Penalidade por jornada acima de 8h', 'Penaliza jornadas que ultrapassam 8 horas mesmo dentro do limite legal de 10h.', 'SOFT', 'ON', 1, null, 107],

    // ── ANTIPATTERN ─────────────────────────────────────────────────────
    ['AP1', 'Clopening — fechar e abrir no dia seguinte', 'Colaborador fecha o estabelecimento e abre no dia seguinte (intervalo crítico).', 'ANTIPATTERN', 'ON', 1, null, 201],
    ['AP2', 'Instabilidade de horários (ioiô)', 'Horários que variam drasticamente de um dia para o outro sem justificativa.', 'ANTIPATTERN', 'ON', 1, null, 202],
    ['AP3', 'Almoço simultâneo de mais de 50% da equipe', 'Muitos colaboradores em almoço ao mesmo tempo deixa o setor descoberto.', 'ANTIPATTERN', 'ON', 1, null, 203],
    ['AP4', 'Desequilíbrio de carga entre colaboradores', 'Distribuição injusta de horas — alguns trabalham muito mais do que outros.', 'ANTIPATTERN', 'ON', 1, null, 204],
    ['AP5', 'Folga isolada — ilhada entre dias de trabalho', 'Folga única no meio de uma sequência longa de trabalho sem descanso real.', 'ANTIPATTERN', 'ON', 1, null, 205],
    ['AP6', 'Inequidade de turnos (índice abaixo de 40%)', 'Colaboradores sempre escalados no mesmo turno sem rotação justa.', 'ANTIPATTERN', 'ON', 1, null, 206],
    ['AP7', 'Fome de fim de semana (>5 sem folga sáb/dom)', 'Colaborador fica mais de 5 semanas sem folga em sábado ou domingo.', 'ANTIPATTERN', 'ON', 1, null, 207],
    ['AP8', 'Almoço fora da janela ideal (11h30–14h30)', 'Almoço programado muito cedo ou muito tarde em relação à janela ideal.', 'ANTIPATTERN', 'ON', 1, null, 208],
    ['AP9', 'Hora morta — microturno + gap + microturno', 'Jornada fragmentada com dois blocos pequenos e um gap no meio sem sentido operacional.', 'ANTIPATTERN', 'ON', 1, null, 209],
    ['AP10', 'Overstaffing — 2+ pessoas quando meta é 1', 'Escala com excesso de pessoas em slots de baixa demanda.', 'ANTIPATTERN', 'ON', 1, null, 210],
    ['AP15', 'Clustering de dias de pico na mesma equipe', 'Os dias de maior demanda concentram sempre os mesmos colaboradores.', 'ANTIPATTERN', 'ON', 1, null, 211],
    ['AP16', 'Júnior sozinho em slot de alta demanda', 'Colaborador júnior (rank 0) escalonado sem apoio em horário de pico.', 'ANTIPATTERN', 'ON', 1, null, 212],
  ]

  db.transaction(() => {
    for (const r of regras) insert.run(...r)
  })()

  console.log(`[SEED] ${regras.length} regras do motor criadas (16 CLT + 7 SOFT + 12 ANTIPATTERN)`)
}

// ============================================================================
// Feriados nacionais (RFC §12.2)
// ============================================================================

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
