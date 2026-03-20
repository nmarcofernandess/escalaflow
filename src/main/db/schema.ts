import { queryOne, queryAll, execute, execDDL, transaction } from './query'

// ============================================================================
// DDL — Tabelas base (v2 original) — Postgres
// ============================================================================

const DDL = `
CREATE TABLE IF NOT EXISTS empresa (
    id SERIAL PRIMARY KEY,
    nome TEXT NOT NULL,
    cnpj TEXT NOT NULL DEFAULT '',
    telefone TEXT NOT NULL DEFAULT '',
    corte_semanal TEXT NOT NULL DEFAULT 'SEG_DOM' CHECK (corte_semanal IN ('SEG_DOM', 'TER_SEG', 'QUA_TER', 'QUI_QUA', 'SEX_QUI', 'SAB_SEX', 'DOM_SAB')),
    tolerancia_semanal_min INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS tipos_contrato (
    id SERIAL PRIMARY KEY,
    nome TEXT NOT NULL,
    horas_semanais INTEGER NOT NULL,
    regime_escala TEXT NOT NULL DEFAULT '6X1' CHECK (regime_escala IN ('5X2', '6X1')),
    dias_trabalho INTEGER NOT NULL,
    max_minutos_dia INTEGER NOT NULL DEFAULT 600,
    protegido_sistema BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS setores (
    id SERIAL PRIMARY KEY,
    nome TEXT NOT NULL,
    icone TEXT,
    hora_abertura TEXT NOT NULL DEFAULT '08:00',
    hora_fechamento TEXT NOT NULL DEFAULT '22:00',
    regime_escala TEXT NOT NULL DEFAULT '5X2' CHECK (regime_escala IN ('5X2', '6X1')),
    ativo BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS demandas (
    id SERIAL PRIMARY KEY,
    setor_id INTEGER NOT NULL REFERENCES setores(id),
    dia_semana TEXT CHECK (dia_semana IN ('SEG','TER','QUA','QUI','SEX','SAB','DOM') OR dia_semana IS NULL),
    hora_inicio TEXT NOT NULL,
    hora_fim TEXT NOT NULL,
    min_pessoas INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS colaboradores (
    id SERIAL PRIMARY KEY,
    setor_id INTEGER NOT NULL REFERENCES setores(id),
    tipo_contrato_id INTEGER NOT NULL REFERENCES tipos_contrato(id),
    nome TEXT NOT NULL,
    sexo TEXT NOT NULL CHECK (sexo IN ('M', 'F')),
    horas_semanais INTEGER NOT NULL,
    rank INTEGER NOT NULL DEFAULT 0,
    prefere_turno TEXT CHECK (prefere_turno IN ('MANHA', 'TARDE') OR prefere_turno IS NULL),
    evitar_dia_semana TEXT CHECK (evitar_dia_semana IN ('SEG','TER','QUA','QUI','SEX','SAB','DOM') OR evitar_dia_semana IS NULL),
    ativo BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS excecoes (
    id SERIAL PRIMARY KEY,
    colaborador_id INTEGER NOT NULL REFERENCES colaboradores(id) ON DELETE CASCADE,
    data_inicio TEXT NOT NULL,
    data_fim TEXT NOT NULL,
    tipo TEXT NOT NULL CHECK (tipo IN ('FERIAS', 'ATESTADO', 'BLOQUEIO')),
    observacao TEXT
);

CREATE TABLE IF NOT EXISTS escalas (
    id SERIAL PRIMARY KEY,
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
    equipe_snapshot_json TEXT,
    criada_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS alocacoes (
    id SERIAL PRIMARY KEY,
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
// DDL — Tabelas novas v3.1 (RFC ss12.1)
// ============================================================================

const DDL_V3 = `
CREATE TABLE IF NOT EXISTS funcoes (
    id SERIAL PRIMARY KEY,
    setor_id INTEGER NOT NULL REFERENCES setores(id),
    apelido TEXT NOT NULL,
    tipo_contrato_id INTEGER NOT NULL REFERENCES tipos_contrato(id),
    ativo BOOLEAN NOT NULL DEFAULT TRUE,
    ordem INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS feriados (
    id SERIAL PRIMARY KEY,
    data TEXT NOT NULL,
    nome TEXT NOT NULL,
    tipo TEXT NOT NULL CHECK (tipo IN ('NACIONAL', 'ESTADUAL', 'MUNICIPAL')),
    proibido_trabalhar BOOLEAN NOT NULL DEFAULT FALSE,
    cct_autoriza BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS setor_horario_semana (
    id SERIAL PRIMARY KEY,
    setor_id INTEGER NOT NULL REFERENCES setores(id),
    dia_semana TEXT NOT NULL CHECK (dia_semana IN ('SEG','TER','QUA','QUI','SEX','SAB','DOM')),
    ativo BOOLEAN NOT NULL DEFAULT TRUE,
    usa_padrao BOOLEAN NOT NULL DEFAULT TRUE,
    hora_abertura TEXT NOT NULL,
    hora_fechamento TEXT NOT NULL,
    UNIQUE(setor_id, dia_semana)
);

CREATE TABLE IF NOT EXISTS escala_decisoes (
    id SERIAL PRIMARY KEY,
    escala_id INTEGER NOT NULL REFERENCES escalas(id) ON DELETE CASCADE,
    colaborador_id INTEGER,
    data TEXT NOT NULL,
    acao TEXT NOT NULL CHECK (acao IN ('ALOCADO', 'FOLGA', 'MOVIDO', 'REMOVIDO')),
    razao TEXT NOT NULL,
    alternativas_tentadas INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS escala_comparacao_demanda (
    id SERIAL PRIMARY KEY,
    escala_id INTEGER NOT NULL REFERENCES escalas(id) ON DELETE CASCADE,
    data TEXT NOT NULL,
    hora_inicio TEXT NOT NULL,
    hora_fim TEXT NOT NULL,
    planejado INTEGER NOT NULL,
    executado INTEGER NOT NULL,
    delta INTEGER NOT NULL,
    override BOOLEAN NOT NULL DEFAULT FALSE,
    justificativa TEXT
);

CREATE TABLE IF NOT EXISTS contrato_perfis_horario (
    id SERIAL PRIMARY KEY,
    tipo_contrato_id INTEGER NOT NULL REFERENCES tipos_contrato(id),
    nome TEXT NOT NULL,
    ativo BOOLEAN NOT NULL DEFAULT TRUE,
    inicio TEXT,
    fim TEXT,
    preferencia_turno_soft TEXT CHECK (preferencia_turno_soft IN ('MANHA','TARDE') OR preferencia_turno_soft IS NULL),
    ordem INTEGER NOT NULL DEFAULT 0,
    horas_semanais INTEGER,
    max_minutos_dia INTEGER
);

CREATE TABLE IF NOT EXISTS colaborador_regra_horario (
    id SERIAL PRIMARY KEY,
    colaborador_id INTEGER NOT NULL REFERENCES colaboradores(id) ON DELETE CASCADE,
    dia_semana_regra TEXT CHECK (dia_semana_regra IN ('SEG','TER','QUA','QUI','SEX','SAB','DOM') OR dia_semana_regra IS NULL),
    ativo BOOLEAN NOT NULL DEFAULT TRUE,
    perfil_horario_id INTEGER REFERENCES contrato_perfis_horario(id),
    inicio TEXT,
    fim TEXT,
    preferencia_turno_soft TEXT CHECK (preferencia_turno_soft IN ('MANHA','TARDE') OR preferencia_turno_soft IS NULL),
    domingo_ciclo_trabalho INTEGER NOT NULL DEFAULT 2,
    domingo_ciclo_folga INTEGER NOT NULL DEFAULT 1,
    folga_fixa_dia_semana TEXT CHECK (folga_fixa_dia_semana IN ('SEG','TER','QUA','QUI','SEX','SAB','DOM') OR folga_fixa_dia_semana IS NULL)
);

CREATE TABLE IF NOT EXISTS colaborador_regra_horario_excecao_data (
    id SERIAL PRIMARY KEY,
    colaborador_id INTEGER NOT NULL REFERENCES colaboradores(id) ON DELETE CASCADE,
    data TEXT NOT NULL,
    ativo BOOLEAN NOT NULL DEFAULT TRUE,
    inicio TEXT,
    fim TEXT,
    preferencia_turno_soft TEXT CHECK (preferencia_turno_soft IN ('MANHA','TARDE') OR preferencia_turno_soft IS NULL),
    domingo_forcar_folga BOOLEAN NOT NULL DEFAULT FALSE,
    UNIQUE(colaborador_id, data)
);

CREATE TABLE IF NOT EXISTS demandas_excecao_data (
    id SERIAL PRIMARY KEY,
    setor_id INTEGER NOT NULL REFERENCES setores(id),
    data TEXT NOT NULL,
    hora_inicio TEXT NOT NULL,
    hora_fim TEXT NOT NULL,
    min_pessoas INTEGER NOT NULL DEFAULT 0,
    override BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS escala_ciclo_modelos (
    id SERIAL PRIMARY KEY,
    setor_id INTEGER NOT NULL REFERENCES setores(id),
    nome TEXT NOT NULL,
    semanas_no_ciclo INTEGER NOT NULL,
    ativo BOOLEAN NOT NULL DEFAULT TRUE,
    origem_escala_id INTEGER REFERENCES escalas(id),
    criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS escala_ciclo_itens (
    id SERIAL PRIMARY KEY,
    ciclo_modelo_id INTEGER NOT NULL REFERENCES escala_ciclo_modelos(id) ON DELETE CASCADE,
    semana_idx INTEGER NOT NULL,
    colaborador_id INTEGER NOT NULL REFERENCES colaboradores(id),
    dia_semana TEXT NOT NULL CHECK (dia_semana IN ('SEG','TER','QUA','QUI','SEX','SAB','DOM')),
    trabalha BOOLEAN NOT NULL DEFAULT TRUE,
    ancora_domingo BOOLEAN NOT NULL DEFAULT FALSE,
    prioridade INTEGER NOT NULL DEFAULT 0
);
`

// ============================================================================
// DDL — Horarios de Funcionamento da Empresa por Dia da Semana (v5)
// ============================================================================

const DDL_V5_EMPRESA_HORARIO = `
CREATE TABLE IF NOT EXISTS empresa_horario_semana (
    id SERIAL PRIMARY KEY,
    dia_semana TEXT NOT NULL CHECK (dia_semana IN ('SEG','TER','QUA','QUI','SEX','SAB','DOM')),
    ativo BOOLEAN NOT NULL DEFAULT TRUE,
    hora_abertura TEXT NOT NULL DEFAULT '08:00',
    hora_fechamento TEXT NOT NULL DEFAULT '22:00',
    UNIQUE(dia_semana)
);
`

// ============================================================================
// DDL — Configuracoes IA
// ============================================================================

const DDL_IA = `
CREATE TABLE IF NOT EXISTS configuracao_ia (
  id INTEGER PRIMARY KEY DEFAULT 1,
  provider TEXT NOT NULL DEFAULT 'gemini',
  api_key TEXT NOT NULL DEFAULT '',
  modelo TEXT NOT NULL DEFAULT 'gemini-3-flash-preview',
  provider_configs_json TEXT NOT NULL DEFAULT '{}',
  ativo BOOLEAN NOT NULL DEFAULT FALSE,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`

// ============================================================================
// DDL — Historico de Chat IA
// ============================================================================

const DDL_IA_HISTORICO = `
CREATE TABLE IF NOT EXISTS ia_conversas (
  id TEXT PRIMARY KEY,
  titulo TEXT NOT NULL DEFAULT 'Nova conversa',
  status TEXT NOT NULL DEFAULT 'ativo'
    CHECK (status IN ('ativo', 'arquivado')),
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ia_mensagens (
  id TEXT PRIMARY KEY,
  conversa_id TEXT NOT NULL REFERENCES ia_conversas(id) ON DELETE CASCADE,
  papel TEXT NOT NULL
    CHECK (papel IN ('usuario', 'assistente', 'tool_result')),
  conteudo TEXT NOT NULL,
  tool_calls_json TEXT,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ia_mensagens_conversa
  ON ia_mensagens(conversa_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_ia_conversas_status
  ON ia_conversas(status, atualizado_em DESC);
`

// ============================================================================
// DDL — Engine de Regras Configuraveis (v6)
// ============================================================================

const DDL_V6_REGRAS = `
CREATE TABLE IF NOT EXISTS regra_definicao (
    codigo TEXT PRIMARY KEY,
    nome TEXT NOT NULL,
    descricao TEXT,
    categoria TEXT NOT NULL CHECK (categoria IN ('CLT','SOFT','ANTIPATTERN')),
    status_sistema TEXT NOT NULL DEFAULT 'HARD'
        CHECK (status_sistema IN ('HARD','SOFT','OFF','ON')),
    editavel BOOLEAN NOT NULL DEFAULT TRUE,
    aviso_dependencia TEXT,
    ordem INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS regra_empresa (
    codigo TEXT PRIMARY KEY REFERENCES regra_definicao(codigo),
    status TEXT NOT NULL CHECK (status IN ('HARD','SOFT','OFF','ON')),
    atualizado_em TIMESTAMPTZ DEFAULT NOW()
);
`

// ============================================================================
// DDL — Memorias IA (v8): fatos curtos do RH, sempre injetados
// ============================================================================

const DDL_V8_MEMORIAS = `
CREATE TABLE IF NOT EXISTS ia_memorias (
  id SERIAL PRIMARY KEY,
  conteudo TEXT NOT NULL,
  criada_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizada_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`

// ============================================================================
// DDL — Knowledge Layer (v7): RAG + Knowledge Graph
// ============================================================================

const DDL_V7_KNOWLEDGE = `
CREATE TABLE IF NOT EXISTS knowledge_sources (
  id SERIAL PRIMARY KEY,
  tipo TEXT NOT NULL DEFAULT 'manual'
    CHECK (tipo IN ('manual', 'auto_capture', 'sistema', 'importacao_usuario')),
  titulo TEXT NOT NULL,
  conteudo_original TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  importance TEXT NOT NULL DEFAULT 'high'
    CHECK (importance IN ('high', 'low')),
  ativo BOOLEAN NOT NULL DEFAULT TRUE,
  criada_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizada_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS knowledge_chunks (
  id SERIAL PRIMARY KEY,
  source_id INTEGER NOT NULL REFERENCES knowledge_sources(id) ON DELETE CASCADE,
  conteudo TEXT NOT NULL,
  embedding vector(768),
  search_tsv TSVECTOR,
  importance TEXT NOT NULL DEFAULT 'high'
    CHECK (importance IN ('high', 'low')),
  access_count INTEGER NOT NULL DEFAULT 0,
  last_accessed_at TIMESTAMPTZ,
  criada_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_chunks_tsv ON knowledge_chunks USING gin(search_tsv);
CREATE INDEX IF NOT EXISTS idx_chunks_trgm ON knowledge_chunks USING gin(conteudo gin_trgm_ops);

CREATE TABLE IF NOT EXISTS knowledge_entities (
  id SERIAL PRIMARY KEY,
  nome TEXT NOT NULL,
  tipo TEXT NOT NULL,
  embedding vector(768),
  valid_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  valid_to TIMESTAMPTZ DEFAULT NULL,
  criada_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(nome, tipo)
);

CREATE TABLE IF NOT EXISTS knowledge_relations (
  id SERIAL PRIMARY KEY,
  entity_from_id INTEGER NOT NULL REFERENCES knowledge_entities(id) ON DELETE CASCADE,
  entity_to_id INTEGER NOT NULL REFERENCES knowledge_entities(id) ON DELETE CASCADE,
  tipo_relacao TEXT NOT NULL,
  peso REAL NOT NULL DEFAULT 1.0,
  valid_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  valid_to TIMESTAMPTZ DEFAULT NULL,
  criada_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_relations_from ON knowledge_relations(entity_from_id);
CREATE INDEX IF NOT EXISTS idx_relations_to ON knowledge_relations(entity_to_id);
`

// ============================================================================
// Migrations — idempotentes (Postgres: ADD COLUMN IF NOT EXISTS nativo)
// ============================================================================

function toMin(hhmm: string): number {
  const [hh, mm] = hhmm.split(':').map(Number)
  return hh * 60 + mm
}

function minToHHMM(min: number): string {
  const h = Math.floor(min / 60)
  const m = min % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

async function addColumnIfMissing(table: string, column: string, definition: string): Promise<void> {
  // Postgres supports ADD COLUMN IF NOT EXISTS natively (PG 9.6+)
  await execDDL(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${column} ${definition}`)
}

/**
 * Migra demandas legadas (dia_semana = null) para o formato v3.1 por dia.
 */
async function migrateLegacyDemandasNullToByDay(): Promise<void> {
  const legacyRow = await queryOne<{ count: number }>('SELECT COUNT(*)::int as count FROM demandas WHERE dia_semana IS NULL')
  const legacyCount = legacyRow?.count ?? 0
  if (legacyCount === 0) return

  const DIAS: Array<'SEG' | 'TER' | 'QUA' | 'QUI' | 'SEX' | 'SAB' | 'DOM'> = [
    'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB', 'DOM',
  ]

  type SetorRow = { id: number; hora_abertura: string; hora_fechamento: string }
  type DemandaRow = { dia_semana: string | null; hora_inicio: string; hora_fim: string; min_pessoas: number; override: boolean | null }

  const setores = await queryAll<SetorRow>('SELECT id, hora_abertura, hora_fechamento FROM setores')

  await transaction(async () => {
    for (const setor of setores) {
      const allRows = await queryAll<DemandaRow>(
        'SELECT dia_semana, hora_inicio, hora_fim, min_pessoas, override FROM demandas WHERE setor_id = $1 ORDER BY hora_inicio, hora_fim',
        setor.id,
      )
      if (allRows.length === 0) continue

      const hasLegacy = allRows.some((r) => r.dia_semana == null)
      if (!hasLegacy) continue

      const abertura = toMin(setor.hora_abertura)
      const fechamento = toMin(setor.hora_fechamento)
      if (abertura >= fechamento) continue

      const rebuilt: Array<{ dia: string; inicio: number; fim: number; pessoas: number; override: boolean }> = []

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
              override: segOverride,
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
            override: segOverride,
          })
        }
      }

      await execute('DELETE FROM demandas WHERE setor_id = $1', setor.id)
      for (const seg of rebuilt) {
        await execute(
          'INSERT INTO demandas(setor_id, dia_semana, hora_inicio, hora_fim, min_pessoas, override) VALUES($1, $2, $3, $4, $5, $6)',
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
}

async function backfillSetorDemandaPadraoWindow(): Promise<void> {
  const setores = await queryAll<{
    id: number
    demanda_padrao_hora_abertura: string | null
    demanda_padrao_hora_fechamento: string | null
    demanda_padrao_segmentos_json: string | null
  }>('SELECT id, demanda_padrao_hora_abertura, demanda_padrao_hora_fechamento, demanda_padrao_segmentos_json FROM setores')

  for (const setor of setores) {
    if (
      setor.demanda_padrao_hora_abertura
      && setor.demanda_padrao_hora_fechamento
      && setor.demanda_padrao_segmentos_json
    ) continue

    const padraoLegacy = await queryAll<{
      hora_inicio: string
      hora_fim: string
      min_pessoas: number
      override: boolean | null
    }>(`
      SELECT hora_inicio, hora_fim, min_pessoas, override
      FROM demandas
      WHERE setor_id = $1 AND dia_semana IS NULL
      ORDER BY hora_inicio, hora_fim, id
    `, setor.id)

    const horarioPadrao = await queryOne<{ hora_abertura: string; hora_fechamento: string }>(`
      SELECT hora_abertura, hora_fechamento
      FROM setor_horario_semana
      WHERE setor_id = $1 AND usa_padrao = TRUE
      ORDER BY CASE dia_semana
        WHEN 'SEG' THEN 1
        WHEN 'TER' THEN 2
        WHEN 'QUA' THEN 3
        WHEN 'QUI' THEN 4
        WHEN 'SEX' THEN 5
        WHEN 'SAB' THEN 6
        WHEN 'DOM' THEN 7
      END
      LIMIT 1
    `, setor.id)

    const abertura = setor.demanda_padrao_hora_abertura
      ?? padraoLegacy[0]?.hora_inicio
      ?? horarioPadrao?.hora_abertura
      ?? null
    const fechamento = setor.demanda_padrao_hora_fechamento
      ?? padraoLegacy[padraoLegacy.length - 1]?.hora_fim
      ?? horarioPadrao?.hora_fechamento
      ?? null
    const segmentosJson = setor.demanda_padrao_segmentos_json ?? (
      padraoLegacy.length > 0
        ? JSON.stringify(padraoLegacy.map((seg) => ({
            hora_inicio: seg.hora_inicio,
            hora_fim: seg.hora_fim,
            min_pessoas: seg.min_pessoas,
            override: Boolean(seg.override),
          })))
        : null
    )

    if (!abertura || !fechamento || !segmentosJson) continue

    await execute(
      `UPDATE setores
       SET demanda_padrao_hora_abertura = $1,
           demanda_padrao_hora_fechamento = $2,
           demanda_padrao_segmentos_json = $3
       WHERE id = $4`,
      abertura,
      fechamento,
      segmentosJson,
      setor.id,
    )
  }
}

async function migrateSchema(): Promise<void> {
  // --- v3.1: Empresa columns ---
  await addColumnIfMissing('empresa', 'min_intervalo_almoco_min', 'INTEGER NOT NULL DEFAULT 60')
  await addColumnIfMissing('empresa', 'usa_cct_intervalo_reduzido', 'BOOLEAN NOT NULL DEFAULT TRUE')
  await addColumnIfMissing('empresa', 'grid_minutos', 'INTEGER NOT NULL DEFAULT 30')

  // --- v3.1: Colaborador columns ---
  await addColumnIfMissing('colaboradores', 'tipo_trabalhador', "TEXT NOT NULL DEFAULT 'CLT'")
  await addColumnIfMissing('colaboradores', 'funcao_id', 'INTEGER REFERENCES funcoes(id)')

  // --- v3.1: Demanda override ---
  await addColumnIfMissing('demandas', 'override', 'BOOLEAN NOT NULL DEFAULT FALSE')
  await addColumnIfMissing('setores', 'demanda_padrao_hora_abertura', 'TEXT')
  await addColumnIfMissing('setores', 'demanda_padrao_hora_fechamento', 'TEXT')
  await addColumnIfMissing('setores', 'demanda_padrao_segmentos_json', 'TEXT')

  // --- v3.1: Alocacao columns ---
  await addColumnIfMissing('alocacoes', 'hora_almoco_inicio', 'TEXT')
  await addColumnIfMissing('alocacoes', 'hora_almoco_fim', 'TEXT')
  await addColumnIfMissing('alocacoes', 'minutos_almoco', 'INTEGER')
  await addColumnIfMissing('alocacoes', 'intervalo_15min', 'BOOLEAN NOT NULL DEFAULT FALSE')
  await addColumnIfMissing('alocacoes', 'funcao_id', 'INTEGER REFERENCES funcoes(id)')
  await addColumnIfMissing('alocacoes', 'minutos_trabalho', 'INTEGER')
  await addColumnIfMissing('escalas', 'equipe_snapshot_json', 'TEXT')

  await backfillSetorDemandaPadraoWindow()
  await migrateLegacyDemandasNullToByDay()

  // --- v4: Funcao cor_hex ---
  await addColumnIfMissing('funcoes', 'cor_hex', 'TEXT')

  // --- v4: grid_minutos 30->15 ---
  await execute('UPDATE empresa SET grid_minutos = 15 WHERE grid_minutos = 30')

  // --- v4: Indices ---
  await execDDL('CREATE INDEX IF NOT EXISTS idx_contrato_perfis_contrato ON contrato_perfis_horario(tipo_contrato_id)')
  await execDDL('CREATE INDEX IF NOT EXISTS idx_demandas_excecao_setor_data ON demandas_excecao_data(setor_id, data)')
  await execDDL('CREATE INDEX IF NOT EXISTS idx_colab_regra_excecao_colab_data ON colaborador_regra_horario_excecao_data(colaborador_id, data)')
  await execDDL('CREATE INDEX IF NOT EXISTS idx_ciclo_modelo_setor_ativo ON escala_ciclo_modelos(setor_id, ativo)')
  await execDDL('CREATE INDEX IF NOT EXISTS idx_ciclo_itens_modelo_semana ON escala_ciclo_itens(ciclo_modelo_id, semana_idx)')

  // --- v5: Horarios empresa default ---
  const horarioEmpresaRow = await queryOne<{ count: number }>('SELECT COUNT(*)::int as count FROM empresa_horario_semana')
  if ((horarioEmpresaRow?.count ?? 0) === 0) {
    const horariosDefault: [string, boolean, string, string][] = [
      ['SEG', true, '08:00', '22:00'],
      ['TER', true, '08:00', '22:00'],
      ['QUA', true, '08:00', '22:00'],
      ['QUI', true, '08:00', '22:00'],
      ['SEX', true, '08:00', '22:00'],
      ['SAB', true, '08:00', '20:00'],
      ['DOM', true, '08:00', '14:00'],
    ]
    await transaction(async () => {
      for (const [dia, ativo, abertura, fechamento] of horariosDefault) {
        await execute(
          'INSERT INTO empresa_horario_semana (dia_semana, ativo, hora_abertura, hora_fechamento) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING',
          dia, ativo, abertura, fechamento,
        )
      }
    })
  }

  // --- v7: Tool Calls Visiveis ---
  await addColumnIfMissing('ia_mensagens', 'tool_calls_json', 'TEXT')

  // --- v8: IA sempre ativo ---
  await execute('UPDATE configuracao_ia SET ativo = TRUE WHERE ativo = FALSE')

  // --- v10: Embedding migration e5-small(384) → e5-base(768) ---
  // Detecta se embeddings antigos (384d) existem — se sim, limpa tudo pra re-seed
  await addColumnIfMissing('knowledge_sources', 'ativo', 'BOOLEAN NOT NULL DEFAULT TRUE')
  const hasOldEmbeddings = await queryOne<{ count: number }>(
    `SELECT COUNT(*)::int as count FROM knowledge_chunks WHERE embedding IS NOT NULL`
  )
  if ((hasOldEmbeddings?.count ?? 0) > 0) {
    // Checa dimensão do primeiro embedding existente
    const dimCheck = await queryOne<{ dims: number }>(
      `SELECT vector_dims(embedding) as dims FROM knowledge_chunks WHERE embedding IS NOT NULL LIMIT 1`
    )
    if (dimCheck && dimCheck.dims !== 768) {
      console.log('[DB] Migration v10: Limpando embeddings 384d → será re-seedado com 768d...')
      await execute('DELETE FROM knowledge_relations')
      await execute('DELETE FROM knowledge_entities')
      await execute('DELETE FROM knowledge_chunks')
      await execute('DELETE FROM knowledge_sources')
      // Recria colunas com vector(768)
      await execDDL('ALTER TABLE knowledge_chunks DROP COLUMN IF EXISTS embedding')
      await execDDL('ALTER TABLE knowledge_chunks ADD COLUMN embedding vector(768)')
      await execDDL('ALTER TABLE knowledge_entities DROP COLUMN IF EXISTS embedding')
      await execDDL('ALTER TABLE knowledge_entities ADD COLUMN embedding vector(768)')
    }
  }

  // --- v11: Re-seed knowledge com context hints ---
  const hasHints = await queryOne<{ count: number }>(
    `SELECT COUNT(*)::int as count FROM knowledge_sources
     WHERE metadata::text LIKE '%context_hint%'`
  )
  if ((hasHints?.count ?? 0) === 0) {
    const hasKnowledge = await queryOne<{ count: number }>(
      'SELECT COUNT(*)::int as count FROM knowledge_sources'
    )
    if ((hasKnowledge?.count ?? 0) > 0) {
      console.log('[DB] Migration v11: Limpando knowledge para re-seed com context hints...')
      await execute('DELETE FROM knowledge_relations')
      await execute('DELETE FROM knowledge_entities')
      await execute('DELETE FROM knowledge_chunks')
      await execute('DELETE FROM knowledge_sources')
    }
  }

  // --- v12: Phase 5 — Session Indexing + Compaction ---
  await addColumnIfMissing('ia_conversas', 'resumo_compactado', 'TEXT')
  await addColumnIfMissing('configuracao_ia', 'memoria_automatica', 'BOOLEAN NOT NULL DEFAULT TRUE')

  // Expand knowledge_sources.tipo CHECK to include 'session' and 'auto_extract'
  // PGlite: drop old constraint, add new one (CHECK constraints are named by convention)
  try {
    await execDDL(`ALTER TABLE knowledge_sources DROP CONSTRAINT IF EXISTS knowledge_sources_tipo_check`)
    await execDDL(`ALTER TABLE knowledge_sources ADD CONSTRAINT knowledge_sources_tipo_check
      CHECK (tipo IN ('manual', 'auto_capture', 'sistema', 'importacao_usuario', 'session', 'auto_extract'))`)
  } catch {
    // Constraint may not exist or may already be updated — safe to ignore
  }

  // --- v13: Anexos metadata em ia_mensagens ---
  await addColumnIfMissing('ia_mensagens', 'anexos_meta_json', 'TEXT')

  // --- v14: Knowledge Graph origem (sistema vs usuario) ---
  await addColumnIfMissing('knowledge_entities', 'origem', "TEXT NOT NULL DEFAULT 'usuario'")

  // --- v15: Cleanup session/auto_extract pollution + ia_memorias columns ---
  // Remove session transcripts and auto_extract entries from knowledge_sources (Fase 1+2 Pit Stop)
  await execute(`DELETE FROM knowledge_sources WHERE metadata::text LIKE '%"tipo":"session"%'`)
  await execute(`DELETE FROM knowledge_sources WHERE metadata::text LIKE '%"tipo":"auto_extract"%'`)
  // Revert CHECK to exclude session/auto_extract types (no longer used)
  try {
    await execDDL(`ALTER TABLE knowledge_sources DROP CONSTRAINT IF EXISTS knowledge_sources_tipo_check`)
    await execDDL(`ALTER TABLE knowledge_sources ADD CONSTRAINT knowledge_sources_tipo_check
      CHECK (tipo IN ('manual', 'auto_capture', 'sistema', 'importacao_usuario'))`)
  } catch {
    // safe to ignore
  }
  // Add origem + embedding columns to ia_memorias for auto-extraction dedup
  await addColumnIfMissing('ia_memorias', 'origem', "TEXT NOT NULL DEFAULT 'manual'")
  await addColumnIfMissing('ia_memorias', 'embedding', 'vector(768)')

  // --- v16: inicio/fim já existem no DDL. Colunas legadas (inicio_min/max, fim_min/max) removidas. ---
  await addColumnIfMissing('contrato_perfis_horario', 'inicio', 'TEXT')
  await addColumnIfMissing('contrato_perfis_horario', 'fim', 'TEXT')
  await addColumnIfMissing('colaborador_regra_horario', 'inicio', 'TEXT')
  await addColumnIfMissing('colaborador_regra_horario', 'fim', 'TEXT')
  await addColumnIfMissing('colaborador_regra_horario_excecao_data', 'inicio', 'TEXT')
  await addColumnIfMissing('colaborador_regra_horario_excecao_data', 'fim', 'TEXT')

  // --- v9: dia_semana_regra em colaborador_regra_horario ---
  await addColumnIfMissing('colaborador_regra_horario', 'dia_semana_regra',
    "TEXT CHECK (dia_semana_regra IN ('SEG','TER','QUA','QUI','SEX','SAB','DOM') OR dia_semana_regra IS NULL) DEFAULT NULL")

  // Drop o UNIQUE antigo (Postgres auto-name: {tabela}_{coluna}_key)
  await execDDL(`ALTER TABLE colaborador_regra_horario DROP CONSTRAINT IF EXISTS colaborador_regra_horario_colaborador_id_key`)

  // Partial indexes: max 1 default (NULL) + max 1 por dia específico por pessoa
  await execDDL(`CREATE UNIQUE INDEX IF NOT EXISTS idx_crh_colab_padrao
    ON colaborador_regra_horario (colaborador_id) WHERE dia_semana_regra IS NULL`)
  await execDDL(`CREATE UNIQUE INDEX IF NOT EXISTS idx_crh_colab_dia
    ON colaborador_regra_horario (colaborador_id, dia_semana_regra) WHERE dia_semana_regra IS NOT NULL`)

  // --- v17: Fase 1 Limpeza de Contratos ---
  // Drop trabalha_domingo (campo morto — controle de domingo vive em tipo_trabalhador/folga_fixa/domingo_ciclo)
  try { await execDDL('ALTER TABLE tipos_contrato DROP COLUMN IF EXISTS trabalha_domingo') } catch { /* safe */ }

  // Add horas_semanais/max_minutos_dia override em contrato_perfis_horario
  await addColumnIfMissing('contrato_perfis_horario', 'horas_semanais', 'INTEGER')
  await addColumnIfMissing('contrato_perfis_horario', 'max_minutos_dia', 'INTEGER')

  // Unificar 3 estagiarios em 1 contrato "Estagiario" + perfis com override
  const estManha = await queryOne<{ id: number }>(`SELECT id FROM tipos_contrato WHERE nome = 'Estagiario Manha'`)
  if (estManha) {
    // Find/create the unified "Estagiario" contract
    let estUnificadoId: number
    const estExistente = await queryOne<{ id: number }>(`SELECT id FROM tipos_contrato WHERE nome = 'Estagiario'`)
    if (estExistente) {
      estUnificadoId = estExistente.id
    } else {
      // Rename "Estagiario Manha" → "Estagiario" (reuse its id, update horas to 20)
      await execute(`UPDATE tipos_contrato SET nome = 'Estagiario', horas_semanais = 20, max_minutos_dia = 360 WHERE id = ?`, estManha.id)
      estUnificadoId = estManha.id
    }

    // Move colaboradores from the other 2 estagiario contracts to the unified one
    const estTarde = await queryOne<{ id: number }>(`SELECT id FROM tipos_contrato WHERE nome = 'Estagiario Tarde'`)
    const estNoite = await queryOne<{ id: number }>(`SELECT id FROM tipos_contrato WHERE nome = 'Estagiario Noite-Estudo'`)
    for (const est of [estTarde, estNoite]) {
      if (est && est.id !== estUnificadoId) {
        await execute('UPDATE colaboradores SET tipo_contrato_id = ? WHERE tipo_contrato_id = ?', estUnificadoId, est.id)
        await execute('UPDATE funcoes SET tipo_contrato_id = ? WHERE tipo_contrato_id = ?', estUnificadoId, est.id)
        // Move perfis to unified contract
        await execute('UPDATE contrato_perfis_horario SET tipo_contrato_id = ? WHERE tipo_contrato_id = ?', estUnificadoId, est.id)
        // Delete empty contract
        const remaining = await queryOne<{ count: number }>('SELECT COUNT(*)::int as count FROM colaboradores WHERE tipo_contrato_id = ?', est.id)
        if ((remaining?.count ?? 0) === 0) {
          await execute('DELETE FROM tipos_contrato WHERE id = ?', est.id)
        }
      }
    }
    // Also handle if estManha was renamed but had id != estUnificadoId
    if (estManha.id !== estUnificadoId) {
      await execute('UPDATE colaboradores SET tipo_contrato_id = ? WHERE tipo_contrato_id = ?', estUnificadoId, estManha.id)
      await execute('UPDATE funcoes SET tipo_contrato_id = ? WHERE tipo_contrato_id = ?', estUnificadoId, estManha.id)
      await execute('UPDATE contrato_perfis_horario SET tipo_contrato_id = ? WHERE tipo_contrato_id = ?', estUnificadoId, estManha.id)
      const remaining = await queryOne<{ count: number }>('SELECT COUNT(*)::int as count FROM colaboradores WHERE tipo_contrato_id = ?', estManha.id)
      if ((remaining?.count ?? 0) === 0) {
        await execute('DELETE FROM tipos_contrato WHERE id = ?', estManha.id)
      }
    }

    // Set horas_semanais/max_minutos_dia on existing perfis
    await execute(`UPDATE contrato_perfis_horario SET horas_semanais = 20, max_minutos_dia = 240 WHERE nome = 'MANHA_08_12' AND horas_semanais IS NULL`)
    await execute(`UPDATE contrato_perfis_horario SET horas_semanais = 30, max_minutos_dia = 360 WHERE nome = 'TARDE_1330_PLUS' AND horas_semanais IS NULL`)
    await execute(`UPDATE contrato_perfis_horario SET horas_semanais = 30, max_minutos_dia = 360 WHERE nome = 'ESTUDA_NOITE_08_14' AND horas_semanais IS NULL`)
  }

  // Insert "Intermitente" contract if not exists
  const intermitente = await queryOne<{ id: number }>(`SELECT id FROM tipos_contrato WHERE nome = 'Intermitente'`)
  if (!intermitente) {
    await execute(
      `INSERT INTO tipos_contrato (nome, horas_semanais, regime_escala, dias_trabalho, max_minutos_dia) VALUES ('Intermitente', 0, '6X1', 6, 585)`
    )
  }

  // --- v18: Folga variavel condicional ---
  await addColumnIfMissing('colaborador_regra_horario', 'folga_variavel_dia_semana',
    "TEXT CHECK (folga_variavel_dia_semana IN ('SEG','TER','QUA','QUI','SEX','SAB') OR folga_variavel_dia_semana IS NULL) DEFAULT NULL")

  // --- v19: H7 campos de intervalo 15min (hora real + posicao do break) ---
  await addColumnIfMissing('alocacoes', 'hora_intervalo_inicio', 'TEXT')
  await addColumnIfMissing('alocacoes', 'hora_intervalo_fim', 'TEXT')
  await addColumnIfMissing('alocacoes', 'hora_real_inicio', 'TEXT')
  await addColumnIfMissing('alocacoes', 'hora_real_fim', 'TEXT')

  // --- v20: Regime por setor + contratos de sistema protegidos ---
  await addColumnIfMissing(
    'setores',
    'regime_escala',
    "TEXT NOT NULL DEFAULT '5X2' CHECK (regime_escala IN ('5X2', '6X1'))",
  )
  await addColumnIfMissing('tipos_contrato', 'protegido_sistema', 'BOOLEAN NOT NULL DEFAULT FALSE')
  await execute(
    `UPDATE tipos_contrato
     SET protegido_sistema = TRUE
     WHERE nome IN ('CLT 44h', 'CLT 36h', 'Estagiario', 'Intermitente')`,
  )

  // --- v21: tolerancia_semanal_min default 30 → 0 ---
  await execute(`UPDATE empresa SET tolerancia_semanal_min = 0 WHERE tolerancia_semanal_min = 30`)

  // --- v22: Ciclo domingo automatico — remove config manual ---
  // Bridge agora calcula ciclo a partir de demanda do setor + N elegiveis.
  // Colunas ficam no schema (backward compat) mas nullable e ignoradas.
  await execDDL(`ALTER TABLE colaborador_regra_horario ALTER COLUMN domingo_ciclo_trabalho DROP NOT NULL`)
  await execDDL(`ALTER TABLE colaborador_regra_horario ALTER COLUMN domingo_ciclo_trabalho SET DEFAULT NULL`)
  await execDDL(`ALTER TABLE colaborador_regra_horario ALTER COLUMN domingo_ciclo_folga DROP NOT NULL`)
  await execDDL(`ALTER TABLE colaborador_regra_horario ALTER COLUMN domingo_ciclo_folga SET DEFAULT NULL`)
  await execute(`UPDATE colaborador_regra_horario SET domingo_ciclo_trabalho = NULL, domingo_ciclo_folga = NULL`)

  // --- v23: Remove regras H11-H14 (APRENDIZ) — tipo nao existe no negocio ---
  await execute(`DELETE FROM regra_empresa WHERE codigo IN ('H11','H12','H13','H14')`)
  await execute(`DELETE FROM regra_definicao WHERE codigo IN ('H11','H12','H13','H14')`)

  // --- v24: configuracao_backup (Maquina do Tempo) ---
  await execute(`INSERT INTO configuracao_backup (id) VALUES (1) ON CONFLICT DO NOTHING`)

  // --- v25: simulacao_config_json por setor ---
  await addColumnIfMissing('setores', 'simulacao_config_json', 'TEXT')

  // --- v26: split da familia H3 domingo ---
  const regraEmpresaH3 = await queryOne<{ status: string | null }>(
    `SELECT status FROM regra_empresa WHERE codigo = 'H3_DOM_MAX_CONSEC'`,
  )
  if (regraEmpresaH3?.status) {
    await execute(
      `INSERT INTO regra_empresa (codigo, status)
       VALUES ('H3_DOM_MAX_CONSEC_M', ?)
       ON CONFLICT(codigo) DO NOTHING`,
      regraEmpresaH3.status,
    )
    await execute(
      `INSERT INTO regra_empresa (codigo, status)
       VALUES ('H3_DOM_MAX_CONSEC_F', ?)
       ON CONFLICT(codigo) DO NOTHING`,
      regraEmpresaH3.status,
    )
  }
  await execute(`DELETE FROM regra_empresa WHERE codigo = 'H3_DOM_MAX_CONSEC'`)
  await execute(`DELETE FROM regra_definicao WHERE codigo = 'H3_DOM_MAX_CONSEC'`)

  // --- v28: enrichment tracking + metadata ---
  await addColumnIfMissing('knowledge_chunks', 'enriched_at', 'TIMESTAMPTZ')
  await addColumnIfMissing('knowledge_chunks', 'enrichment_json', 'TEXT')

  // --- v29: S_DEFICIT default SOFT → HARD ---
  await execute(`UPDATE regra_definicao SET status_sistema = 'HARD', descricao = 'Bloqueia geracao quando a cobertura fica abaixo da demanda minima planejada.' WHERE codigo = 'S_DEFICIT' AND status_sistema = 'SOFT'`)

  // --- v30: Persistir diagnostico do solver com a escala ---
  await addColumnIfMissing('escalas', 'diagnostico_json', 'TEXT')

  // --- v27: Re-enable 'session' tipo in knowledge_sources for session indexing ---
  try {
    await execDDL(`ALTER TABLE knowledge_sources DROP CONSTRAINT IF EXISTS knowledge_sources_tipo_check`)
    await execDDL(`ALTER TABLE knowledge_sources ADD CONSTRAINT knowledge_sources_tipo_check
      CHECK (tipo IN ('manual', 'auto_capture', 'sistema', 'importacao_usuario', 'session'))`)
  } catch {
    // safe to ignore
  }
}

// ============================================================================
// Backup / Maquina do Tempo
// ============================================================================

const DDL_CONFIGURACAO_BACKUP = `
CREATE TABLE IF NOT EXISTS configuracao_backup (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  pasta TEXT,
  ativo BOOLEAN NOT NULL DEFAULT TRUE,
  backup_ao_fechar BOOLEAN NOT NULL DEFAULT TRUE,
  intervalo_horas INTEGER NOT NULL DEFAULT 24,
  max_snapshots INTEGER NOT NULL DEFAULT 30,
  ultimo_backup TIMESTAMPTZ,
  atualizado_em TIMESTAMPTZ DEFAULT NOW()
);
`

// ============================================================================
// Entry point
// ============================================================================

export async function createTables(): Promise<void> {
  await execDDL(DDL)
  await execDDL(DDL_V3)
  await execDDL(DDL_V5_EMPRESA_HORARIO)
  await execDDL(DDL_IA)
  await execDDL(DDL_IA_HISTORICO)
  await execDDL(DDL_V6_REGRAS)
  await execDDL(DDL_V8_MEMORIAS)
  await execDDL(DDL_V7_KNOWLEDGE)
  await execDDL(DDL_CONFIGURACAO_BACKUP)
  await migrateSchema()
  console.log('[DB] Tabelas criadas com sucesso (v29)')
}
