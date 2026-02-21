import { getDb } from './database'

// ============================================================================
// DDL — Tabelas base (v2 original)
// ============================================================================

const DDL = `
CREATE TABLE IF NOT EXISTS empresa (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL,
    cnpj TEXT NOT NULL DEFAULT '',
    telefone TEXT NOT NULL DEFAULT '',
    corte_semanal TEXT NOT NULL DEFAULT 'SEG_DOM' CHECK (corte_semanal IN ('SEG_DOM', 'TER_SEG', 'QUA_TER', 'QUI_QUA', 'SEX_QUI', 'SAB_SEX', 'DOM_SAB')),
    tolerancia_semanal_min INTEGER NOT NULL DEFAULT 30
);

CREATE TABLE IF NOT EXISTS tipos_contrato (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL,
    horas_semanais INTEGER NOT NULL,
    regime_escala TEXT NOT NULL DEFAULT '6X1' CHECK (regime_escala IN ('5X2', '6X1')),
    dias_trabalho INTEGER NOT NULL,
    trabalha_domingo INTEGER NOT NULL DEFAULT 1,
    max_minutos_dia INTEGER NOT NULL DEFAULT 600
);

CREATE TABLE IF NOT EXISTS setores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL,
    icone TEXT,
    hora_abertura TEXT NOT NULL DEFAULT '08:00',
    hora_fechamento TEXT NOT NULL DEFAULT '22:00',
    piso_operacional INTEGER NOT NULL DEFAULT 1,
    ativo INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS demandas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    setor_id INTEGER NOT NULL REFERENCES setores(id),
    dia_semana TEXT CHECK (dia_semana IN ('SEG','TER','QUA','QUI','SEX','SAB','DOM') OR dia_semana IS NULL),
    hora_inicio TEXT NOT NULL,
    hora_fim TEXT NOT NULL,
    min_pessoas INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS colaboradores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    setor_id INTEGER NOT NULL REFERENCES setores(id),
    tipo_contrato_id INTEGER NOT NULL REFERENCES tipos_contrato(id),
    nome TEXT NOT NULL,
    sexo TEXT NOT NULL CHECK (sexo IN ('M', 'F')),
    horas_semanais INTEGER NOT NULL,
    rank INTEGER NOT NULL DEFAULT 0,
    prefere_turno TEXT CHECK (prefere_turno IN ('MANHA', 'TARDE') OR prefere_turno IS NULL),
    evitar_dia_semana TEXT CHECK (evitar_dia_semana IN ('SEG','TER','QUA','QUI','SEX','SAB','DOM') OR evitar_dia_semana IS NULL),
    ativo INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS excecoes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    colaborador_id INTEGER NOT NULL REFERENCES colaboradores(id) ON DELETE CASCADE,
    data_inicio TEXT NOT NULL,
    data_fim TEXT NOT NULL,
    tipo TEXT NOT NULL CHECK (tipo IN ('FERIAS', 'ATESTADO', 'BLOQUEIO')),
    observacao TEXT
);

CREATE TABLE IF NOT EXISTS escalas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    setor_id INTEGER NOT NULL REFERENCES setores(id),
    data_inicio TEXT NOT NULL,
    data_fim TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'RASCUNHO' CHECK (status IN ('RASCUNHO', 'OFICIAL', 'ARQUIVADA')),
    pontuacao INTEGER,
    cobertura_percent REAL DEFAULT 0,
    violacoes_hard INTEGER DEFAULT 0,
    violacoes_soft INTEGER DEFAULT 0,
    equilibrio REAL DEFAULT 0,
    input_hash TEXT,
    simulacao_config_json TEXT,
    criada_em TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS alocacoes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    escala_id INTEGER NOT NULL REFERENCES escalas(id) ON DELETE CASCADE,
    colaborador_id INTEGER NOT NULL REFERENCES colaboradores(id),
    data TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('TRABALHO', 'FOLGA', 'INDISPONIVEL')),
    hora_inicio TEXT,
    hora_fim TEXT,
    minutos INTEGER,
    UNIQUE(escala_id, colaborador_id, data)
);
`

// ============================================================================
// DDL — Tabelas novas v3.1 (RFC §12.1)
// ============================================================================

const DDL_V3 = `
CREATE TABLE IF NOT EXISTS funcoes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    setor_id INTEGER NOT NULL REFERENCES setores(id),
    apelido TEXT NOT NULL,
    tipo_contrato_id INTEGER NOT NULL REFERENCES tipos_contrato(id),
    ativo INTEGER NOT NULL DEFAULT 1,
    ordem INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS feriados (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    data TEXT NOT NULL,
    nome TEXT NOT NULL,
    tipo TEXT NOT NULL CHECK (tipo IN ('NACIONAL', 'ESTADUAL', 'MUNICIPAL')),
    proibido_trabalhar INTEGER NOT NULL DEFAULT 0,
    cct_autoriza INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS setor_horario_semana (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    setor_id INTEGER NOT NULL REFERENCES setores(id),
    dia_semana TEXT NOT NULL CHECK (dia_semana IN ('SEG','TER','QUA','QUI','SEX','SAB','DOM')),
    ativo INTEGER NOT NULL DEFAULT 1,
    usa_padrao INTEGER NOT NULL DEFAULT 1,
    hora_abertura TEXT NOT NULL,
    hora_fechamento TEXT NOT NULL,
    UNIQUE(setor_id, dia_semana)
);

CREATE TABLE IF NOT EXISTS escala_decisoes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    escala_id INTEGER NOT NULL REFERENCES escalas(id) ON DELETE CASCADE,
    colaborador_id INTEGER,
    data TEXT NOT NULL,
    acao TEXT NOT NULL CHECK (acao IN ('ALOCADO', 'FOLGA', 'MOVIDO', 'REMOVIDO')),
    razao TEXT NOT NULL,
    alternativas_tentadas INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS escala_comparacao_demanda (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    escala_id INTEGER NOT NULL REFERENCES escalas(id) ON DELETE CASCADE,
    data TEXT NOT NULL,
    hora_inicio TEXT NOT NULL,
    hora_fim TEXT NOT NULL,
    planejado INTEGER NOT NULL,
    executado INTEGER NOT NULL,
    delta INTEGER NOT NULL,
    override INTEGER NOT NULL DEFAULT 0,
    justificativa TEXT
);

-- v4: Perfis de horario por contrato (ex: estagiario manha, estagiario tarde)
CREATE TABLE IF NOT EXISTS contrato_perfis_horario (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tipo_contrato_id INTEGER NOT NULL REFERENCES tipos_contrato(id),
    nome TEXT NOT NULL,
    ativo INTEGER NOT NULL DEFAULT 1,
    inicio_min TEXT NOT NULL,
    inicio_max TEXT NOT NULL,
    fim_min TEXT NOT NULL,
    fim_max TEXT NOT NULL,
    preferencia_turno_soft TEXT CHECK (preferencia_turno_soft IN ('MANHA','TARDE') OR preferencia_turno_soft IS NULL),
    ordem INTEGER NOT NULL DEFAULT 0
);

-- v4: Regra de horario individual por colaborador (1 janela ativa)
CREATE TABLE IF NOT EXISTS colaborador_regra_horario (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    colaborador_id INTEGER NOT NULL UNIQUE REFERENCES colaboradores(id) ON DELETE CASCADE,
    ativo INTEGER NOT NULL DEFAULT 1,
    perfil_horario_id INTEGER REFERENCES contrato_perfis_horario(id),
    inicio_min TEXT,
    inicio_max TEXT,
    fim_min TEXT,
    fim_max TEXT,
    preferencia_turno_soft TEXT CHECK (preferencia_turno_soft IN ('MANHA','TARDE') OR preferencia_turno_soft IS NULL),
    domingo_ciclo_trabalho INTEGER NOT NULL DEFAULT 2,
    domingo_ciclo_folga INTEGER NOT NULL DEFAULT 1,
    folga_fixa_dia_semana TEXT CHECK (folga_fixa_dia_semana IN ('SEG','TER','QUA','QUI','SEX','SAB','DOM') OR folga_fixa_dia_semana IS NULL)
);

-- v4: Excecao de horario por data especifica (sobrescreve regra semanal)
CREATE TABLE IF NOT EXISTS colaborador_regra_horario_excecao_data (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    colaborador_id INTEGER NOT NULL REFERENCES colaboradores(id) ON DELETE CASCADE,
    data TEXT NOT NULL,
    ativo INTEGER NOT NULL DEFAULT 1,
    inicio_min TEXT,
    inicio_max TEXT,
    fim_min TEXT,
    fim_max TEXT,
    preferencia_turno_soft TEXT CHECK (preferencia_turno_soft IN ('MANHA','TARDE') OR preferencia_turno_soft IS NULL),
    domingo_forcar_folga INTEGER NOT NULL DEFAULT 0,
    UNIQUE(colaborador_id, data)
);

-- v4: Excecao de demanda por data (calendario)
CREATE TABLE IF NOT EXISTS demandas_excecao_data (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    setor_id INTEGER NOT NULL REFERENCES setores(id),
    data TEXT NOT NULL,
    hora_inicio TEXT NOT NULL,
    hora_fim TEXT NOT NULL,
    min_pessoas INTEGER NOT NULL DEFAULT 0,
    override INTEGER NOT NULL DEFAULT 0
);

-- v4: Modelo de ciclo rotativo (escala fixa que repete)
CREATE TABLE IF NOT EXISTS escala_ciclo_modelos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    setor_id INTEGER NOT NULL REFERENCES setores(id),
    nome TEXT NOT NULL,
    semanas_no_ciclo INTEGER NOT NULL,
    ativo INTEGER NOT NULL DEFAULT 1,
    origem_escala_id INTEGER REFERENCES escalas(id),
    criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

-- v4: Itens do ciclo rotativo (por colaborador/dia)
CREATE TABLE IF NOT EXISTS escala_ciclo_itens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ciclo_modelo_id INTEGER NOT NULL REFERENCES escala_ciclo_modelos(id) ON DELETE CASCADE,
    semana_idx INTEGER NOT NULL,
    colaborador_id INTEGER NOT NULL REFERENCES colaboradores(id),
    dia_semana TEXT NOT NULL CHECK (dia_semana IN ('SEG','TER','QUA','QUI','SEX','SAB','DOM')),
    trabalha INTEGER NOT NULL DEFAULT 1,
    ancora_domingo INTEGER NOT NULL DEFAULT 0,
    prioridade INTEGER NOT NULL DEFAULT 0
);
`

// ============================================================================
// DDL — Configurações IA
// ============================================================================

const DDL_IA = `
CREATE TABLE IF NOT EXISTS configuracao_ia (
  id INTEGER PRIMARY KEY DEFAULT 1,
  provider TEXT NOT NULL DEFAULT 'gemini',
  api_key TEXT NOT NULL DEFAULT '',
  modelo TEXT NOT NULL DEFAULT 'gemini-2.5-flash',
  ativo INTEGER NOT NULL DEFAULT 0,
  criado_em TEXT NOT NULL DEFAULT (datetime('now')),
  atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
);
`

// ============================================================================
// DDL — Histórico de Chat IA
// ============================================================================

const DDL_IA_HISTORICO = `
CREATE TABLE IF NOT EXISTS ia_conversas (
  id TEXT PRIMARY KEY,
  titulo TEXT NOT NULL DEFAULT 'Nova conversa',
  status TEXT NOT NULL DEFAULT 'ativo'
    CHECK (status IN ('ativo', 'arquivado')),
  criado_em TEXT NOT NULL DEFAULT (datetime('now')),
  atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ia_mensagens (
  id TEXT PRIMARY KEY,
  conversa_id TEXT NOT NULL REFERENCES ia_conversas(id) ON DELETE CASCADE,
  papel TEXT NOT NULL
    CHECK (papel IN ('usuario', 'assistente', 'tool_result')),
  conteudo TEXT NOT NULL,
  timestamp TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ia_mensagens_conversa
  ON ia_mensagens(conversa_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_ia_conversas_status
  ON ia_conversas(status, atualizado_em DESC);
`

// ============================================================================
// Migrations — idempotentes (check column exists antes de ALTER)
// ============================================================================

function getColumnNames(table: string): Set<string> {
  const db = getDb()
  const query = "PRAGMA table_info('" + table + "')"
  const cols = db.prepare(query).all() as { name: string }[]
  return new Set(cols.map((c) => c.name))
}

function addColumnIfMissing(table: string, column: string, definition: string, cols?: Set<string>): void {
  const colNames = cols ?? getColumnNames(table)
  if (!colNames.has(column)) {
    const db = getDb()
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition} `)
  }
}

function toMin(hhmm: string): number {
  const [hh, mm] = hhmm.split(':').map(Number)
  return hh * 60 + mm
}

function minToHHMM(min: number): string {
  const h = Math.floor(min / 60)
  const m = min % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')} `
}

/**
 * Migra demandas legadas (dia_semana = null) para o formato v3.1 por dia.
 * Estratégia:
 * - agrega cobertura por slot de 30min (somando sobreposições)
 * - mantém slots sem cobertura como 0
 * - comprime slots contínuos em segmentos
 * - regrava todas as demandas do setor por SEG..DOM
 *
 * Idempotente: se não há linhas legadas, não faz nada.
 */
function migrateLegacyDemandasNullToByDay(): void {
  const db = getDb()
  const legacyCount = (
    db.prepare('SELECT COUNT(*) as count FROM demandas WHERE dia_semana IS NULL').get() as { count: number }
  ).count

  if (legacyCount === 0) return

  const DIAS: Array<'SEG' | 'TER' | 'QUA' | 'QUI' | 'SEX' | 'SAB' | 'DOM'> = [
    'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB', 'DOM',
  ]

  type SetorRow = {
    id: number
    hora_abertura: string
    hora_fechamento: string
  }
  type DemandaRow = {
    dia_semana: string | null
    hora_inicio: string
    hora_fim: string
    min_pessoas: number
    override: number | null
  }

  const setores = db.prepare(`
    SELECT id, hora_abertura, hora_fechamento
    FROM setores
  `).all() as SetorRow[]

  const run = db.transaction(() => {
    const selectDemandas = db.prepare(`
      SELECT dia_semana, hora_inicio, hora_fim, min_pessoas, override
      FROM demandas
      WHERE setor_id = ?
  ORDER BY hora_inicio, hora_fim
    `)
    const deleteDemandas = db.prepare('DELETE FROM demandas WHERE setor_id = ?')
    const insertDemanda = db.prepare(`
      INSERT INTO demandas(setor_id, dia_semana, hora_inicio, hora_fim, min_pessoas, override)
VALUES(?, ?, ?, ?, ?, ?)
  `)

    for (const setor of setores) {
      const allRows = selectDemandas.all(setor.id) as DemandaRow[]
      if (allRows.length === 0) continue

      const hasLegacy = allRows.some((r) => r.dia_semana == null)
      if (!hasLegacy) continue

      const abertura = toMin(setor.hora_abertura)
      const fechamento = toMin(setor.hora_fechamento)
      if (abertura >= fechamento) continue

      const rebuilt: Array<{
        dia: string
        inicio: number
        fim: number
        pessoas: number
        override: number
      }> = []

      for (const dia of DIAS) {
        const slots: Array<{ pessoas: number; override: boolean }> = []
        for (let t = abertura; t < fechamento; t += 30) {
          let pessoas = 0
          let override = false

          for (const d of allRows) {
            if (d.dia_semana != null && d.dia_semana !== dia) continue
            const dInicio = toMin(d.hora_inicio)
            const dFim = toMin(d.hora_fim)
            if (dInicio <= t && dFim >= t + 30) {
              pessoas += d.min_pessoas
              override = override || Boolean(d.override)
            }
          }

          if (pessoas <= 0) pessoas = 0
          slots.push({ pessoas, override })
        }

        if (slots.length === 0) continue

        let segStart = abertura
        let segPeople = slots[0].pessoas
        let segOverride = slots[0].override

        for (let i = 1; i < slots.length; i++) {
          const s = slots[i]
          if (s.pessoas === segPeople && s.override === segOverride) continue

          if (segPeople > 0) {
            rebuilt.push({
              dia,
              inicio: segStart,
              fim: abertura + i * 30,
              pessoas: segPeople,
              override: segOverride ? 1 : 0,
            })
          }
          segStart = abertura + i * 30
          segPeople = s.pessoas
          segOverride = s.override
        }

        if (segPeople > 0) {
          rebuilt.push({
            dia,
            inicio: segStart,
            fim: fechamento,
            pessoas: segPeople,
            override: segOverride ? 1 : 0,
          })
        }
      }

      deleteDemandas.run(setor.id)
      for (const seg of rebuilt) {
        insertDemanda.run(
          setor.id,
          seg.dia,
          minToHHMM(seg.inicio),
          minToHHMM(seg.fim),
          seg.pessoas,
          seg.override,
        )
      }
    }
  })

  run()
}

function migrateSchema(): void {
  const db = getDb()

  // --- v2.1: cnpj + telefone ---
  const empresaCols = getColumnNames('empresa')
  addColumnIfMissing('empresa', 'cnpj', "TEXT NOT NULL DEFAULT ''", empresaCols)
  addColumnIfMissing('empresa', 'telefone', "TEXT NOT NULL DEFAULT ''", empresaCols)

  // --- v2.2: icone ---
  addColumnIfMissing('setores', 'icone', 'TEXT')

  // --- v2.4: regime de escala no contrato ---
  const contratoCols = getColumnNames('tipos_contrato')
  addColumnIfMissing('tipos_contrato', 'regime_escala', "TEXT NOT NULL DEFAULT '6X1'", contratoCols)
  db.exec(`
    UPDATE tipos_contrato
    SET regime_escala = CASE
      WHEN dias_trabalho <= 5 THEN '5X2'
      ELSE '6X1'
END
    WHERE regime_escala IS NULL OR regime_escala NOT IN('5X2', '6X1')
  `)

  // --- v2.5: piso operacional no setor ---
  const setorCols = getColumnNames('setores')
  addColumnIfMissing('setores', 'piso_operacional', 'INTEGER NOT NULL DEFAULT 1', setorCols)

  // --- v2.3: indicadores escalas ---
  const escalaCols = getColumnNames('escalas')
  addColumnIfMissing('escalas', 'cobertura_percent', 'REAL DEFAULT 0', escalaCols)
  addColumnIfMissing('escalas', 'violacoes_hard', 'INTEGER DEFAULT 0', escalaCols)
  addColumnIfMissing('escalas', 'violacoes_soft', 'INTEGER DEFAULT 0', escalaCols)
  addColumnIfMissing('escalas', 'equilibrio', 'REAL DEFAULT 0', escalaCols)
  addColumnIfMissing('escalas', 'input_hash', 'TEXT', escalaCols)
  addColumnIfMissing('escalas', 'simulacao_config_json', 'TEXT', escalaCols)

  // ==========================================================================
  // v3.1 — Motor v3 schema migration (RFC §12.1)
  // ==========================================================================

  // Empresa: +min_intervalo_almoco_min, +usa_cct_intervalo_reduzido, +grid_minutos
  addColumnIfMissing('empresa', 'min_intervalo_almoco_min', 'INTEGER NOT NULL DEFAULT 60', empresaCols)
  addColumnIfMissing('empresa', 'usa_cct_intervalo_reduzido', 'INTEGER NOT NULL DEFAULT 1', empresaCols)
  addColumnIfMissing('empresa', 'grid_minutos', 'INTEGER NOT NULL DEFAULT 30', empresaCols)

  // Colaborador: +tipo_trabalhador, +funcao_id
  const colabCols = getColumnNames('colaboradores')
  addColumnIfMissing('colaboradores', 'tipo_trabalhador', "TEXT NOT NULL DEFAULT 'CLT'", colabCols)
  addColumnIfMissing('colaboradores', 'funcao_id', 'INTEGER REFERENCES funcoes(id)', colabCols)

  // Demanda: +override
  addColumnIfMissing('demandas', 'override', 'INTEGER NOT NULL DEFAULT 0')

  // Alocacao: +hora_almoco_*, +minutos_almoco, +intervalo_15min, +funcao_id, +minutos_trabalho
  const alocCols = getColumnNames('alocacoes')
  addColumnIfMissing('alocacoes', 'hora_almoco_inicio', 'TEXT', alocCols)
  addColumnIfMissing('alocacoes', 'hora_almoco_fim', 'TEXT', alocCols)
  addColumnIfMissing('alocacoes', 'minutos_almoco', 'INTEGER', alocCols)
  addColumnIfMissing('alocacoes', 'intervalo_15min', 'INTEGER NOT NULL DEFAULT 0', alocCols)
  addColumnIfMissing('alocacoes', 'funcao_id', 'INTEGER REFERENCES funcoes(id)', alocCols)
  addColumnIfMissing('alocacoes', 'minutos_trabalho', 'INTEGER', alocCols)
  // NOTA: campo 'minutos' mantido pra compat v2. Motor v3 usa 'minutos_trabalho'.
  // Rename real fica pra quando frontend migrar.

  migrateLegacyDemandasNullToByDay()

  // ==========================================================================
  // v4 — PRD Motor Python + Regras Colaborador + Grid 15min
  // ==========================================================================

  // Funcao: +cor_hex
  addColumnIfMissing('funcoes', 'cor_hex', 'TEXT')

  // Empresa: grid_minutos default 30→15 (atualiza se ainda no default antigo)
  db.exec(`UPDATE empresa SET grid_minutos = 15 WHERE grid_minutos = 30`)

  // Indices para novas tabelas v4
  db.exec(`CREATE INDEX IF NOT EXISTS idx_contrato_perfis_contrato ON contrato_perfis_horario(tipo_contrato_id)`)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_demandas_excecao_setor_data ON demandas_excecao_data(setor_id, data)`)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_colab_regra_excecao_colab_data ON colaborador_regra_horario_excecao_data(colaborador_id, data)`)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_ciclo_modelo_setor_ativo ON escala_ciclo_modelos(setor_id, ativo)`)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_ciclo_itens_modelo_semana ON escala_ciclo_itens(ciclo_modelo_id, semana_idx)`)
}

// ============================================================================
// Entry point
// ============================================================================

export function createTables(): void {
  const db = getDb()
  db.exec(DDL)
  db.exec(DDL_V3)
  db.exec(DDL_IA)
  db.exec(DDL_IA_HISTORICO)
  migrateSchema()
  console.log('[DB] Tabelas criadas com sucesso (v4 + IA + Histórico)')
}
