/**
 * EscalaFlow Motor v3 — Test Adapter
 *
 * Reads the fixture JSON (caixa_rita.json), stands up an in-memory SQLite DB
 * with the full EscalaFlow schema, populates it with fixture data, runs the
 * motor, and writes resultado_ts.json in a normalized format for comparison.
 *
 * Usage:
 *   npx tsx horario/teste/adapter_ts/adapter.ts
 */

import Database from 'better-sqlite3'
import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'

// ── Import the motor ────────────────────────────────────────────────────────

import { gerarEscalaV3 } from '../../../src/main/motor/gerador'
import type { GerarEscalaInput, Alocacao } from '../../../src/shared/types'

// ── Fixture types ───────────────────────────────────────────────────────────

interface FixtureColaborador {
  id: number
  nome: string
  horas_semanais: number
  dias_trabalho: number
  max_minutos_dia: number
  trabalha_domingo: boolean
  tipo_trabalhador: string
  sexo: 'M' | 'F'
  funcao_id: number | null
  rank: number
  prefere_turno: string | null
  evitar_dia_semana: string | null
}

interface FixtureFuncao {
  id: number
  apelido: string
  setor_id: number
  tipo_contrato_id: number
  ativo: boolean
  ordem: number
}

interface FixtureDemanda {
  dia_semana: string | null
  hora_inicio: string
  hora_fim: string
  min_pessoas: number
  override: boolean
}

interface FixtureFeriado {
  data: string
  nome: string
  tipo: string
  proibido_trabalhar: boolean
  cct_autoriza: boolean
}

interface FixtureExcecao {
  colaborador_id: number
  data_inicio: string
  data_fim: string
  tipo: string
  observacao: string | null
}

interface Fixture {
  metadata: {
    setor: string
    periodo: { inicio: string; fim: string }
    grid_intervalo_min: number
    hora_abertura: string
    hora_fechamento: string
    fonte: string
    notas: string
  }
  empresa: {
    tolerancia_semanal_min: number
    hora_abertura: string
    hora_fechamento: string
    corte_semanal: string
    min_intervalo_almoco_min: number
    usa_cct_intervalo_reduzido: boolean
    grid_minutos: number
  }
  colaboradores: FixtureColaborador[]
  funcoes: FixtureFuncao[]
  demanda: FixtureDemanda[]
  feriados: FixtureFeriado[]
  excecoes: FixtureExcecao[]
  ground_truth?: unknown // Ignored by adapter
}

// ── Schema DDL (mirrors src/main/db/schema.ts) ─────────────────────────────

const DDL = `
CREATE TABLE IF NOT EXISTS empresa (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL,
    cnpj TEXT NOT NULL DEFAULT '',
    telefone TEXT NOT NULL DEFAULT '',
    corte_semanal TEXT NOT NULL DEFAULT 'SEG_DOM',
    tolerancia_semanal_min INTEGER NOT NULL DEFAULT 30,
    min_intervalo_almoco_min INTEGER NOT NULL DEFAULT 60,
    usa_cct_intervalo_reduzido INTEGER NOT NULL DEFAULT 1,
    grid_minutos INTEGER NOT NULL DEFAULT 30
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

CREATE TABLE IF NOT EXISTS funcoes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    setor_id INTEGER NOT NULL REFERENCES setores(id),
    apelido TEXT NOT NULL,
    tipo_contrato_id INTEGER NOT NULL REFERENCES tipos_contrato(id),
    ativo INTEGER NOT NULL DEFAULT 1,
    ordem INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS demandas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    setor_id INTEGER NOT NULL REFERENCES setores(id),
    dia_semana TEXT CHECK (dia_semana IN ('SEG','TER','QUA','QUI','SEX','SAB','DOM') OR dia_semana IS NULL),
    hora_inicio TEXT NOT NULL,
    hora_fim TEXT NOT NULL,
    min_pessoas INTEGER NOT NULL DEFAULT 1,
    override INTEGER NOT NULL DEFAULT 0
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
    ativo INTEGER NOT NULL DEFAULT 1,
    tipo_trabalhador TEXT NOT NULL DEFAULT 'CLT',
    funcao_id INTEGER REFERENCES funcoes(id)
);

CREATE TABLE IF NOT EXISTS excecoes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    colaborador_id INTEGER NOT NULL REFERENCES colaboradores(id) ON DELETE CASCADE,
    data_inicio TEXT NOT NULL,
    data_fim TEXT NOT NULL,
    tipo TEXT NOT NULL CHECK (tipo IN ('FERIAS', 'ATESTADO', 'BLOQUEIO')),
    observacao TEXT
);

CREATE TABLE IF NOT EXISTS feriados (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    data TEXT NOT NULL,
    nome TEXT NOT NULL,
    tipo TEXT NOT NULL CHECK (tipo IN ('NACIONAL', 'ESTADUAL', 'MUNICIPAL')),
    proibido_trabalhar INTEGER NOT NULL DEFAULT 0,
    cct_autoriza INTEGER NOT NULL DEFAULT 1
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
    minutos_trabalho INTEGER,
    hora_almoco_inicio TEXT,
    hora_almoco_fim TEXT,
    minutos_almoco INTEGER,
    intervalo_15min INTEGER NOT NULL DEFAULT 0,
    funcao_id INTEGER REFERENCES funcoes(id),
    UNIQUE(escala_id, colaborador_id, data)
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
`

// ── Derive tipos_contrato from fixture colaboradores ────────────────────────

interface DerivedContrato {
  id: number
  nome: string
  horas_semanais: number
  dias_trabalho: number
  trabalha_domingo: boolean
  max_minutos_dia: number
}

function deriveTiposContrato(fixture: Fixture): DerivedContrato[] {
  // The fixture funcoes reference tipo_contrato_id, so we derive
  // distinct contract types from the colaborador data and funcao mappings.
  // Strategy: build from funcoes (which have tipo_contrato_id) cross-ref
  // with the colaborador that uses that funcao.
  const map = new Map<number, DerivedContrato>()

  for (const colab of fixture.colaboradores) {
    // Find the funcao this colab uses to get the tipo_contrato_id
    const funcao = fixture.funcoes.find(f => f.id === colab.funcao_id)
    const tipoId = funcao?.tipo_contrato_id ?? 1

    if (!map.has(tipoId)) {
      const nomeParts: string[] = []
      if (colab.tipo_trabalhador === 'ESTAGIARIO') nomeParts.push('Estagiario')
      else if (colab.tipo_trabalhador === 'APRENDIZ') nomeParts.push('Aprendiz')
      else nomeParts.push('CLT')
      nomeParts.push(`${colab.horas_semanais}h`)

      map.set(tipoId, {
        id: tipoId,
        nome: nomeParts.join(' '),
        horas_semanais: colab.horas_semanais,
        dias_trabalho: colab.dias_trabalho,
        trabalha_domingo: colab.trabalha_domingo,
        max_minutos_dia: colab.max_minutos_dia,
      })
    }
  }

  // Make sure all tipo_contrato_ids referenced by funcoes exist
  for (const funcao of fixture.funcoes) {
    if (!map.has(funcao.tipo_contrato_id)) {
      // Fallback: create a generic CLT 44h entry
      map.set(funcao.tipo_contrato_id, {
        id: funcao.tipo_contrato_id,
        nome: `CLT (contrato ${funcao.tipo_contrato_id})`,
        horas_semanais: 44,
        dias_trabalho: 6,
        trabalha_domingo: true,
        max_minutos_dia: 600,
      })
    }
  }

  return Array.from(map.values()).sort((a, b) => a.id - b.id)
}

// ── Populate DB from fixture ────────────────────────────────────────────────

function populateFromFixture(db: Database.Database, fixture: Fixture): void {
  const SETOR_ID = 1

  // 1. Empresa
  db.prepare(`
    INSERT INTO empresa (nome, cnpj, telefone, corte_semanal, tolerancia_semanal_min,
                         min_intervalo_almoco_min, usa_cct_intervalo_reduzido, grid_minutos)
    VALUES (?, '', '', ?, ?, ?, ?, ?)
  `).run(
    'Supermercado Fernandes (test)',
    fixture.empresa.corte_semanal,
    fixture.empresa.tolerancia_semanal_min,
    fixture.empresa.min_intervalo_almoco_min,
    fixture.empresa.usa_cct_intervalo_reduzido ? 1 : 0,
    fixture.empresa.grid_minutos,
  )

  // 2. Setor
  db.prepare(`
    INSERT INTO setores (id, nome, icone, hora_abertura, hora_fechamento, ativo)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    SETOR_ID,
    fixture.metadata.setor,
    'banknote',
    fixture.metadata.hora_abertura,
    fixture.metadata.hora_fechamento,
    1, // ativo
  )

  // 3. Tipos de contrato (derived from fixture data)
  const tipos = deriveTiposContrato(fixture)
  const insertTipo = db.prepare(`
    INSERT INTO tipos_contrato (id, nome, horas_semanais, dias_trabalho, trabalha_domingo, max_minutos_dia)
    VALUES (?, ?, ?, ?, ?, ?)
  `)
  for (const tipo of tipos) {
    insertTipo.run(
      tipo.id,
      tipo.nome,
      tipo.horas_semanais,
      tipo.dias_trabalho,
      tipo.trabalha_domingo ? 1 : 0,
      tipo.max_minutos_dia,
    )
  }

  // 4. Funcoes (postos)
  const insertFuncao = db.prepare(`
    INSERT INTO funcoes (id, setor_id, apelido, tipo_contrato_id, ativo, ordem)
    VALUES (?, ?, ?, ?, ?, ?)
  `)
  for (const f of fixture.funcoes) {
    insertFuncao.run(f.id, f.setor_id, f.apelido, f.tipo_contrato_id, f.ativo ? 1 : 0, f.ordem)
  }

  // 5. Colaboradores
  const insertColab = db.prepare(`
    INSERT INTO colaboradores (id, setor_id, tipo_contrato_id, nome, sexo, horas_semanais,
                               rank, prefere_turno, evitar_dia_semana, ativo, tipo_trabalhador, funcao_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  for (const c of fixture.colaboradores) {
    // Resolve tipo_contrato_id from funcao
    const funcao = fixture.funcoes.find(f => f.id === c.funcao_id)
    const tipoContratoId = funcao?.tipo_contrato_id ?? 1

    insertColab.run(
      c.id,
      SETOR_ID,
      tipoContratoId,
      c.nome,
      c.sexo,
      c.horas_semanais,
      c.rank,
      c.prefere_turno,
      c.evitar_dia_semana,
      1, // ativo
      c.tipo_trabalhador,
      c.funcao_id,
    )
  }

  // 6. Demandas
  const insertDemanda = db.prepare(`
    INSERT INTO demandas (setor_id, dia_semana, hora_inicio, hora_fim, min_pessoas, override)
    VALUES (?, ?, ?, ?, ?, ?)
  `)
  for (const d of fixture.demanda) {
    insertDemanda.run(
      SETOR_ID,
      d.dia_semana,
      d.hora_inicio,
      d.hora_fim,
      d.min_pessoas,
      d.override ? 1 : 0,
    )
  }

  // 7. Setor horario semana (7 days — same hours for all days, matching the fixture)
  const DIAS: string[] = ['SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB', 'DOM']
  const insertHorario = db.prepare(`
    INSERT INTO setor_horario_semana (setor_id, dia_semana, ativo, usa_padrao, hora_abertura, hora_fechamento)
    VALUES (?, ?, ?, ?, ?, ?)
  `)
  for (const dia of DIAS) {
    insertHorario.run(
      SETOR_ID,
      dia,
      1, // ativo
      1, // usa_padrao
      fixture.metadata.hora_abertura,
      fixture.metadata.hora_fechamento,
    )
  }

  // 8. Excecoes
  if (fixture.excecoes && fixture.excecoes.length > 0) {
    const insertExcecao = db.prepare(`
      INSERT INTO excecoes (colaborador_id, data_inicio, data_fim, tipo, observacao)
      VALUES (?, ?, ?, ?, ?)
    `)
    for (const e of fixture.excecoes) {
      insertExcecao.run(e.colaborador_id, e.data_inicio, e.data_fim, e.tipo, e.observacao)
    }
  }

  // 9. Feriados
  if (fixture.feriados && fixture.feriados.length > 0) {
    const insertFeriado = db.prepare(`
      INSERT INTO feriados (data, nome, tipo, proibido_trabalhar, cct_autoriza)
      VALUES (?, ?, ?, ?, ?)
    `)
    for (const f of fixture.feriados) {
      insertFeriado.run(
        f.data,
        f.nome,
        f.tipo,
        f.proibido_trabalhar ? 1 : 0,
        f.cct_autoriza ? 1 : 0,
      )
    }
  }

  // 10. Escalas & Alocacoes (empty — no lookback data for this test)
  // Tables already exist but are empty. Motor will proceed without lookback.
}

// ── Convert motor output → normalized JSON ──────────────────────────────────

interface AlocacaoOutput {
  inicio: string | null
  fim: string | null
  almoco: string | null
  minutos: number
  status: string
}

interface ResultadoOutput {
  solver: string
  status: 'OK' | 'ERROR'
  error_message?: string
  solve_time_ms: number
  alocacoes: Record<string, Record<string, AlocacaoOutput>>
  indicadores: {
    pontuacao: number
    cobertura_percent: number
    violacoes_hard: number
    violacoes_soft: number
    equilibrio: number
  }
  horas_semanais: Record<string, number>
  violacoes: Array<{
    severidade: string
    regra: string
    colaborador_nome: string
    mensagem: string
    data: string | null
  }>
  decisoes: Array<{
    colaborador_nome: string
    data: string
    acao: string
    razao: string
  }>
  timing?: Record<string, number>
}

function buildColabNameMap(fixture: Fixture): Map<number, string> {
  const m = new Map<number, string>()
  for (const c of fixture.colaboradores) {
    m.set(c.id, c.nome)
  }
  return m
}

function convertToOutput(
  result: ReturnType<typeof gerarEscalaV3>,
  fixture: Fixture,
  solveTimeMs: number,
): ResultadoOutput {
  if (!result.sucesso || !result.escala) {
    return {
      solver: 'escalaflow_motor_v3',
      status: 'ERROR',
      error_message: result.erro?.mensagem ?? 'Unknown error',
      solve_time_ms: solveTimeMs,
      alocacoes: {},
      indicadores: {
        pontuacao: 0,
        cobertura_percent: 0,
        violacoes_hard: 0,
        violacoes_soft: 0,
        equilibrio: 0,
      },
      horas_semanais: {},
      violacoes: [],
      decisoes: [],
    }
  }

  const { escala: escalaCompleta } = result
  const nameMap = buildColabNameMap(fixture)

  // Build alocacoes map: { NOME: { "2026-02-09": { ... } } }
  const alocacoesMap: Record<string, Record<string, AlocacaoOutput>> = {}
  const minutosAccum: Record<string, number> = {}

  for (const aloc of escalaCompleta.alocacoes) {
    const nome = nameMap.get(aloc.colaborador_id) ?? `colab_${aloc.colaborador_id}`

    if (!alocacoesMap[nome]) alocacoesMap[nome] = {}
    if (!minutosAccum[nome]) minutosAccum[nome] = 0

    const almoco =
      aloc.hora_almoco_inicio && aloc.hora_almoco_fim
        ? `${aloc.hora_almoco_inicio}-${aloc.hora_almoco_fim}`
        : null

    const minutos = aloc.minutos_trabalho ?? aloc.minutos ?? 0

    alocacoesMap[nome][aloc.data] = {
      inicio: aloc.hora_inicio ?? null,
      fim: aloc.hora_fim ?? null,
      almoco,
      minutos,
      status: aloc.status,
    }

    if (aloc.status === 'TRABALHO') {
      minutosAccum[nome] += minutos
    }
  }

  // Violacoes
  const violacoes = escalaCompleta.violacoes.map(v => ({
    severidade: v.severidade,
    regra: v.regra,
    colaborador_nome: v.colaborador_nome,
    mensagem: v.mensagem,
    data: v.data,
  }))

  // Decisoes (filter to ALOCADO only for readability, include all)
  const decisoes = escalaCompleta.decisoes.map(d => ({
    colaborador_nome: d.colaborador_nome,
    data: d.data,
    acao: d.acao,
    razao: d.razao,
  }))

  return {
    solver: 'escalaflow_motor_v3',
    status: 'OK',
    solve_time_ms: solveTimeMs,
    alocacoes: alocacoesMap,
    indicadores: {
      pontuacao: escalaCompleta.indicadores.pontuacao,
      cobertura_percent: escalaCompleta.indicadores.cobertura_percent,
      violacoes_hard: escalaCompleta.indicadores.violacoes_hard,
      violacoes_soft: escalaCompleta.indicadores.violacoes_soft,
      equilibrio: escalaCompleta.indicadores.equilibrio,
    },
    horas_semanais: minutosAccum,
    violacoes,
    decisoes,
    timing: escalaCompleta.timing
      ? {
          fase0_ms: escalaCompleta.timing.fase0_ms,
          fase1_ms: escalaCompleta.timing.fase1_ms,
          fase2_ms: escalaCompleta.timing.fase2_ms,
          fase3_ms: escalaCompleta.timing.fase3_ms,
          fase4_ms: escalaCompleta.timing.fase4_ms,
          fase5_ms: escalaCompleta.timing.fase5_ms,
          fase6_ms: escalaCompleta.timing.fase6_ms,
          fase7_ms: escalaCompleta.timing.fase7_ms,
          total_ms: escalaCompleta.timing.total_ms,
          otimizacao_ms: escalaCompleta.timing.otimizacao_ms ?? 0,
          otimizacao_moves: escalaCompleta.timing.otimizacao_moves ?? 0,
        }
      : undefined,
  }
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const __dirname = path.dirname(fileURLToPath(import.meta.url))

  // 1. Read fixture
  const fixturePath = path.join(__dirname, '..', 'fixture', 'caixa_rita.json')
  if (!fs.existsSync(fixturePath)) {
    console.error(`Fixture not found: ${fixturePath}`)
    process.exit(1)
  }
  const fixture: Fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf-8'))

  console.log('='.repeat(60))
  console.log('EscalaFlow Motor v3 — Test Adapter')
  console.log('='.repeat(60))
  console.log(`Setor:   ${fixture.metadata.setor}`)
  console.log(`Periodo: ${fixture.metadata.periodo.inicio} a ${fixture.metadata.periodo.fim}`)
  console.log(`Colabs:  ${fixture.colaboradores.length}`)
  console.log(`Demanda: ${fixture.demanda.length} slots`)
  console.log(`Funcoes: ${fixture.funcoes.length}`)
  console.log('')

  // 2. Create in-memory DB
  const db = new Database(':memory:')
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  // 3. Create schema
  db.exec(DDL)

  // 4. Populate from fixture
  populateFromFixture(db, fixture)

  // Verify population
  const empresaCount = (db.prepare('SELECT COUNT(*) as c FROM empresa').get() as { c: number }).c
  const setorCount = (db.prepare('SELECT COUNT(*) as c FROM setores').get() as { c: number }).c
  const colabCount = (db.prepare('SELECT COUNT(*) as c FROM colaboradores').get() as { c: number }).c
  const demandaCount = (db.prepare('SELECT COUNT(*) as c FROM demandas').get() as { c: number }).c
  const funcaoCount = (db.prepare('SELECT COUNT(*) as c FROM funcoes').get() as { c: number }).c
  const horarioCount = (db.prepare('SELECT COUNT(*) as c FROM setor_horario_semana').get() as { c: number }).c
  const tipoCount = (db.prepare('SELECT COUNT(*) as c FROM tipos_contrato').get() as { c: number }).c

  console.log('DB populated:')
  console.log(`  empresa:              ${empresaCount}`)
  console.log(`  setores:              ${setorCount}`)
  console.log(`  tipos_contrato:       ${tipoCount}`)
  console.log(`  funcoes:              ${funcaoCount}`)
  console.log(`  colaboradores:        ${colabCount}`)
  console.log(`  demandas:             ${demandaCount}`)
  console.log(`  setor_horario_semana: ${horarioCount}`)
  console.log('')

  // 5. Run motor
  const input: GerarEscalaInput = {
    setor_id: 1,
    data_inicio: fixture.metadata.periodo.inicio,
    data_fim: fixture.metadata.periodo.fim,
  }

  console.log('Running motor v3...')
  const t0 = performance.now()
  const result = gerarEscalaV3(db, input)
  const solveTimeMs = Math.round(performance.now() - t0)
  console.log(`Motor finished in ${solveTimeMs}ms`)
  console.log('')

  if (result.sucesso && result.escala) {
    const ind = result.escala.indicadores
    console.log('Result:')
    console.log(`  Sucesso:        ${result.sucesso}`)
    console.log(`  Pontuacao:      ${ind.pontuacao}`)
    console.log(`  Cobertura:      ${ind.cobertura_percent.toFixed(1)}%`)
    console.log(`  Violacoes HARD: ${ind.violacoes_hard}`)
    console.log(`  Violacoes SOFT: ${ind.violacoes_soft}`)
    console.log(`  Equilibrio:     ${ind.equilibrio.toFixed(3)}`)
    console.log(`  Alocacoes:      ${result.escala.alocacoes.length}`)
    console.log(`  Antipatterns:   ${result.escala.antipatterns.length}`)
  } else {
    console.log('Result: ERROR')
    console.log(`  Tipo:     ${result.erro?.tipo}`)
    console.log(`  Regra:    ${result.erro?.regra}`)
    console.log(`  Mensagem: ${result.erro?.mensagem}`)
  }
  console.log('')

  // 6. Convert and write output
  const output = convertToOutput(result, fixture, solveTimeMs)
  const outputPath = path.join(__dirname, 'resultado_ts.json')
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2), 'utf-8')
  console.log(`Output written to: ${outputPath}`)

  // 7. Cleanup
  db.close()
  console.log('Done.')
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
