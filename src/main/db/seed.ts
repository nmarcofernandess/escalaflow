import { getDb } from './database'

// ============================================================================
// Paleta fixa de cores (15 cores — PRD v4)
// ============================================================================

const PALETA_CORES = [
  '#3B82F6', '#EF4444', '#10B981', '#F59E0B', '#8B5CF6',
  '#EC4899', '#14B8A6', '#F97316', '#6366F1', '#84CC16',
  '#06B6D4', '#D946EF', '#78716C', '#0EA5E9', '#A3E635',
]

// ============================================================================
// SEED — Dados de SISTEMA (versionado no git)
//
// Contém APENAS dados imutáveis/universais:
//   - Tipos de contrato CLT (templates legais)
//   - Perfis de horário por contrato (templates operacionais)
//   - Feriados nacionais (calendário legal)
//   - Regras do motor (catálogo de constraints)
//   - Migration helper: cores em funções
//
// Dados de exemplo (empresa, setores, colaboradores, keys IA)
// ficam em seed-local.ts (gitignored).
// ============================================================================

export function seedData(): void {
  const db = getDb()

  // ── 1. Tipos de Contrato ──────────────────────────────────────────────
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

  // ── 2. Perfis de Horario por Contrato ─────────────────────────────────
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

  // ── 3. Feriados ──────────────────────────────────────────────────────
  seedFeriados()

  // ── 4. Regras do Motor (v6) ──────────────────────────────────────────
  seedRegrasDefinicao()

  // ── 5. Migration helper: cores em funcoes sem cor_hex ────────────────
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

  console.log('[SEED] Seed sistema concluido')
}

// ============================================================================
// Seed local (dados de exemplo — gitignored)
// ============================================================================

export function seedLocalData(): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const local = require('./seed-local')
    if (typeof local.seedLocalData === 'function') {
      local.seedLocalData()
    }
  } catch {
    // seed-local.ts não existe — app abre vazio (usuário cadastra do zero)
  }
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
