import { getDb } from './database'

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

function migrateSchema(): void {
  const db = getDb()

  // v2.1: Add cnpj + telefone to empresa
  const cols = db.prepare("PRAGMA table_info('empresa')").all() as { name: string }[]
  const colNames = new Set(cols.map((c) => c.name))
  if (!colNames.has('cnpj')) {
    db.exec("ALTER TABLE empresa ADD COLUMN cnpj TEXT NOT NULL DEFAULT ''")
  }
  if (!colNames.has('telefone')) {
    db.exec("ALTER TABLE empresa ADD COLUMN telefone TEXT NOT NULL DEFAULT ''")
  }

  // v2.2: Add icone to setores
  const setorCols = db.prepare("PRAGMA table_info('setores')").all() as { name: string }[]
  const setorColNames = new Set(setorCols.map((c) => c.name))
  if (!setorColNames.has('icone')) {
    db.exec('ALTER TABLE setores ADD COLUMN icone TEXT')
  }

  // v2.3: Add indicadores columns to escalas
  const escalaCols = db.prepare("PRAGMA table_info('escalas')").all() as { name: string }[]
  const escalaColNames = new Set(escalaCols.map((c) => c.name))
  if (!escalaColNames.has('cobertura_percent')) {
    db.exec('ALTER TABLE escalas ADD COLUMN cobertura_percent REAL DEFAULT 0')
  }
  if (!escalaColNames.has('violacoes_hard')) {
    db.exec('ALTER TABLE escalas ADD COLUMN violacoes_hard INTEGER DEFAULT 0')
  }
  if (!escalaColNames.has('violacoes_soft')) {
    db.exec('ALTER TABLE escalas ADD COLUMN violacoes_soft INTEGER DEFAULT 0')
  }
  if (!escalaColNames.has('equilibrio')) {
    db.exec('ALTER TABLE escalas ADD COLUMN equilibrio REAL DEFAULT 0')
  }
}

export function createTables(): void {
  const db = getDb()
  db.exec(DDL)
  migrateSchema()
  console.log('[DB] Tabelas criadas com sucesso')
}
