#!/usr/bin/env -S npx tsx
/**
 * extract-db-to-seed.ts — Extrai o BD real e gera src/main/db/seed-local.ts
 *
 * Uso:
 *   npm run db:extract-seed              # extrai do BD real (out/data/escalaflow-pg)
 *   npm run db:extract-seed -- --dry     # mostra o que geraria sem escrever
 *
 * IMPORTANTE: Feche o app antes de rodar (PGlite não permite acesso concorrente).
 *
 * O que extrai:
 *   - Empresa (config)
 *   - Setores + horários semanais por setor
 *   - Demandas por setor/dia
 *   - Postos (funcoes) por setor
 *   - Colaboradores (todos os setores)
 *   - Regras de horário por colaborador
 *   - Exceções de horário por data
 *   - Demandas exceção por data
 *   - Exceções (férias/atestado/bloqueio)
 *   - Regras empresa (overrides)
 *   - Configuração IA
 */

import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { initDb, closeDb } from '../src/main/db/pglite'
import { getDb } from '../src/main/db/pglite'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')

const args = process.argv.slice(2)
const dryRun = args.includes('--dry')

const dbPath = process.env.ESCALAFLOW_DB_PATH || path.join(rootDir, 'out', 'data', 'escalaflow-pg')
process.env.ESCALAFLOW_DB_PATH = dbPath

const OUTPUT_PATH = path.join(rootDir, 'src', 'main', 'db', 'seed-local.ts')

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function queryAll<T>(sql: string): Promise<T[]> {
  const db = getDb()
  const result = await db.query<T>(sql)
  return result.rows
}

function esc(v: unknown): string {
  if (v === null || v === undefined) return 'null'
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  if (typeof v === 'number') return String(v)
  return `'${String(v).replace(/'/g, "\\'")}'`
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log(`[extract] Abrindo BD em: ${dbPath}`)

  if (!fs.existsSync(dbPath)) {
    console.error(`[extract] BD nao encontrado em ${dbPath}. Rode o app ao menos 1x.`)
    process.exit(1)
  }

  await initDb()
  console.log('[extract] BD aberto com sucesso')

  // --- Empresa ---
  const [empresa] = await queryAll<{
    nome: string; cnpj: string; telefone: string; corte_semanal: string
    tolerancia_semanal_min: number; min_intervalo_almoco_min: number
    usa_cct_intervalo_reduzido: boolean; grid_minutos: number
  }>('SELECT nome, cnpj, telefone, corte_semanal, tolerancia_semanal_min, min_intervalo_almoco_min, usa_cct_intervalo_reduzido, grid_minutos FROM empresa LIMIT 1')

  // --- Setores ---
  const setores = await queryAll<{
    id: number; nome: string; icone: string | null; hora_abertura: string; hora_fechamento: string
    regime_escala: string; ativo: boolean
  }>('SELECT id, nome, icone, hora_abertura, hora_fechamento, regime_escala, ativo FROM setores ORDER BY id')

  // --- Horários semanais por setor ---
  const horariosSetor = await queryAll<{
    setor_id: number; dia_semana: string; ativo: boolean; usa_padrao: boolean
    hora_abertura: string; hora_fechamento: string
  }>('SELECT setor_id, dia_semana, ativo, usa_padrao, hora_abertura, hora_fechamento FROM setor_horario_semana ORDER BY setor_id, dia_semana')

  // --- Demandas ---
  const demandas = await queryAll<{
    setor_id: number; dia_semana: string; hora_inicio: string; hora_fim: string
    min_pessoas: number; override: boolean
  }>('SELECT setor_id, dia_semana, hora_inicio, hora_fim, min_pessoas, override FROM demandas ORDER BY setor_id, dia_semana, hora_inicio')

  // --- Postos (funcoes) ---
  const funcoes = await queryAll<{
    id: number; setor_id: number; apelido: string; tipo_contrato_id: number
    ativo: boolean; ordem: number; cor_hex: string | null
  }>('SELECT id, setor_id, apelido, tipo_contrato_id, ativo, ordem, cor_hex FROM funcoes ORDER BY setor_id, ordem')

  // --- Tipos contrato (pra resolver nomes) ---
  const tiposContrato = await queryAll<{ id: number; nome: string }>(
    'SELECT id, nome FROM tipos_contrato ORDER BY id',
  )
  const tipoNomeById = new Map(tiposContrato.map((t) => [t.id, t.nome]))

  // --- Colaboradores ---
  const colaboradores = await queryAll<{
    id: number; setor_id: number; tipo_contrato_id: number; nome: string; sexo: string
    horas_semanais: number; rank: number; tipo_trabalhador: string; funcao_id: number | null; ativo: boolean
  }>('SELECT id, setor_id, tipo_contrato_id, nome, sexo, horas_semanais, rank, tipo_trabalhador, funcao_id, ativo FROM colaboradores ORDER BY setor_id, id')

  // --- Funcao apelido por id ---
  const funcaoApelidoById = new Map(funcoes.map((f) => [f.id, f.apelido]))

  // --- Regras horário colaborador ---
  const regrasHorario = await queryAll<{
    colaborador_id: number; ativo: boolean; perfil_horario_id: number | null
    inicio: string | null; fim: string | null; preferencia_turno_soft: string | null
    domingo_ciclo_trabalho: number | null; domingo_ciclo_folga: number | null
    folga_fixa_dia_semana: string | null; dia_semana_regra: string | null
    folga_variavel_dia_semana: string | null
  }>(`SELECT colaborador_id, ativo, perfil_horario_id, inicio, fim,
      preferencia_turno_soft, domingo_ciclo_trabalho, domingo_ciclo_folga,
      folga_fixa_dia_semana, dia_semana_regra, folga_variavel_dia_semana
      FROM colaborador_regra_horario ORDER BY colaborador_id`)

  // --- Perfis horário (pra resolver nomes) ---
  const perfisHorario = await queryAll<{ id: number; nome: string }>(
    'SELECT id, nome FROM contrato_perfis_horario ORDER BY id',
  )
  const perfilNomeById = new Map(perfisHorario.map((p) => [p.id, p.nome]))

  // --- Colab nome por id ---
  const colabNomeById = new Map(colaboradores.map((c) => [c.id, c.nome]))
  // --- Setor nome by id ---
  const setorNomeById = new Map(setores.map((s) => [s.id, s.nome]))

  // --- Exceções horário por data ---
  const excHorario = await queryAll<{
    colaborador_id: number; data: string; ativo: boolean
    inicio: string | null; fim: string | null
    preferencia_turno_soft: string | null; domingo_forcar_folga: boolean
  }>(`SELECT colaborador_id, data, ativo, inicio, fim,
      preferencia_turno_soft, domingo_forcar_folga
      FROM colaborador_regra_horario_excecao_data ORDER BY colaborador_id, data`)

  // --- Demandas exceção por data ---
  const demExcecao = await queryAll<{
    setor_id: number; data: string; hora_inicio: string; hora_fim: string
    min_pessoas: number; override: boolean
  }>('SELECT setor_id, data, hora_inicio, hora_fim, min_pessoas, override FROM demandas_excecao_data ORDER BY setor_id, data, hora_inicio')

  // --- Exceções (férias/bloqueio/atestado) ---
  const excecoes = await queryAll<{
    colaborador_id: number; data_inicio: string; data_fim: string; tipo: string; observacao: string | null
  }>('SELECT colaborador_id, data_inicio, data_fim, tipo, observacao FROM excecoes ORDER BY colaborador_id')

  // --- Horários empresa ---
  const horariosEmpresa = await queryAll<{
    dia_semana: string; ativo: boolean; hora_abertura: string; hora_fechamento: string
  }>('SELECT dia_semana, ativo, hora_abertura, hora_fechamento FROM empresa_horario_semana ORDER BY dia_semana')

  // --- Regras empresa ---
  const regrasEmpresa = await queryAll<{ codigo: string; status: string }>(
    'SELECT codigo, status FROM regra_empresa ORDER BY codigo',
  )

  // --- Config IA ---
  const [iaConfig] = await queryAll<{
    provider: string; api_key: string; modelo: string; provider_configs_json: string
    ativo: boolean; memoria_automatica: boolean
  }>('SELECT provider, api_key, modelo, provider_configs_json, ativo, memoria_automatica FROM configuracao_ia LIMIT 1')

  await closeDb()

  // ---------------------------------------------------------------------------
  // Gerar o arquivo TypeScript
  // ---------------------------------------------------------------------------
  const today = new Date().toISOString().slice(0, 10)
  const lines: string[] = []

  lines.push(`import { queryOne, queryAll, execute, transaction } from './query'`)
  lines.push(``)
  lines.push(`// ============================================================================`)
  lines.push(`// SEED LOCAL — Dados REAIS do Supermercado Fernandes (gitignored)`)
  lines.push(`// Fonte: dump banco producao ${today}`)
  lines.push(`// ${setores.length} setores, ${colaboradores.length} colaboradores, ${demandas.length} demandas, ${regrasHorario.length} regras horario`)
  lines.push(`// Gerado automaticamente por: npm run db:extract-seed`)
  lines.push(`// ============================================================================`)
  lines.push(``)
  lines.push(`type DiaSemana = 'SEG' | 'TER' | 'QUA' | 'QUI' | 'SEX' | 'SAB' | 'DOM'`)
  lines.push(``)
  lines.push(`const DIAS_SEMANA: DiaSemana[] = ['SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB', 'DOM']`)
  lines.push(``)

  // API keys
  const parsedConfigs = iaConfig?.provider_configs_json ? JSON.parse(iaConfig.provider_configs_json) : {}
  const geminiKey = parsedConfigs.gemini?.token ?? ''
  const geminiModel = parsedConfigs.gemini?.modelo ?? iaConfig?.modelo ?? ''
  const openrouterKey = parsedConfigs.openrouter?.token ?? ''

  lines.push(`// ============================================================================`)
  lines.push(`// >>> COLOQUE SUAS KEYS AQUI <<<`)
  lines.push(`// ============================================================================`)
  lines.push(``)
  lines.push(`const GEMINI_API_KEY = ${esc(geminiKey)}`)
  lines.push(`const GEMINI_MODEL = ${esc(geminiModel)}`)
  lines.push(``)
  lines.push(`const OPENROUTER_API_KEY = ${esc(openrouterKey)}`)
  lines.push(``)
  lines.push(`// ============================================================================`)
  lines.push(``)

  // Setor names
  lines.push(`const SETOR_NAMES = [`)
  for (const s of setores) {
    lines.push(`  ${esc(s.nome)},`)
  }
  lines.push(`] as const`)
  lines.push(``)

  // Main function
  lines.push(`export async function seedLocalData(): Promise<void> {`)

  // -- 1. Empresa --
  lines.push(`  // -- 1. Empresa --`)
  lines.push(`  const empresaExiste = await queryOne<{ id: number }>('SELECT id FROM empresa LIMIT 1')`)
  lines.push(`  if (!empresaExiste) {`)
  lines.push(`    await execute(`)
  lines.push(`      \`INSERT INTO empresa (nome, cnpj, telefone, corte_semanal, tolerancia_semanal_min, min_intervalo_almoco_min, usa_cct_intervalo_reduzido, grid_minutos)`)
  lines.push(`       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)\`,`)
  lines.push(`      ${esc(empresa.nome)}, '', '', ${esc(empresa.corte_semanal)}, ${empresa.tolerancia_semanal_min}, ${empresa.min_intervalo_almoco_min}, ${empresa.usa_cct_intervalo_reduzido}, ${empresa.grid_minutos},`)
  lines.push(`    )`)
  lines.push(`    console.log('[SEED-LOCAL] Empresa criada')`)
  lines.push(`  }`)
  lines.push(``)

  // -- 2. Setores --
  lines.push(`  // -- 2. Setores --`)
  lines.push(`  {`)
  lines.push(`    const setores: [string, string | null, string, string, string, boolean][] = [`)
  for (const s of setores) {
    lines.push(`      [${esc(s.nome)}, ${esc(s.icone)}, ${esc(s.hora_abertura)}, ${esc(s.hora_fechamento)}, ${esc(s.regime_escala)}, ${s.ativo}],`)
  }
  lines.push(`    ]`)
  lines.push(`    let criados = 0`)
  lines.push(`    for (const [nome, icone, ab, fe, regime, ativo] of setores) {`)
  lines.push(`      const existe = await queryOne<{ id: number }>("SELECT id FROM setores WHERE nome = $1", nome)`)
  lines.push(`      if (!existe) {`)
  lines.push(`        await execute(`)
  lines.push(`          'INSERT INTO setores (nome, icone, hora_abertura, hora_fechamento, regime_escala, ativo) VALUES ($1, $2, $3, $4, $5, $6)',`)
  lines.push(`          nome, icone, ab, fe, regime, ativo,`)
  lines.push(`        )`)
  lines.push(`        criados++`)
  lines.push(`      }`)
  lines.push(`    }`)
  lines.push(`    if (criados > 0) console.log(\`[SEED-LOCAL] \${criados} setor(es) criado(s)\`)`)
  lines.push(`  }`)
  lines.push(``)

  // Resolve setor IDs
  lines.push(`  // Resolve setor IDs`)
  lines.push(`  const setoresRows = await queryAll<{ id: number; nome: string }>(`)
  lines.push(`    \`SELECT id, nome FROM setores WHERE nome IN (\${SETOR_NAMES.map((_, i) => \`$\${i + 1}\`).join(', ')})\`,`)
  lines.push(`    ...SETOR_NAMES,`)
  lines.push(`  )`)
  lines.push(`  const setorIdByNome = new Map(setoresRows.map((r) => [r.nome, r.id]))`)
  lines.push(``)

  // -- 3. Horários semanais por setor --
  const setoresComHorario = new Set(horariosSetor.map((h) => h.setor_id))
  if (setoresComHorario.size > 0) {
    lines.push(`  // -- 3. Horarios semanais por setor --`)
    lines.push(`  await transaction(async () => {`)
    lines.push(`    const upsertHorario = async (setorNome: string, dia: DiaSemana, ativo: boolean, usaPadrao: boolean, ab: string, fe: string) => {`)
    lines.push(`      const setorId = setorIdByNome.get(setorNome)`)
    lines.push(`      if (!setorId) return`)
    lines.push(`      await execute(`)
    lines.push(`        \`INSERT INTO setor_horario_semana (setor_id, dia_semana, ativo, usa_padrao, hora_abertura, hora_fechamento)`)
    lines.push(`         VALUES ($1, $2, $3, $4, $5, $6)`)
    lines.push(`         ON CONFLICT(setor_id, dia_semana) DO UPDATE SET`)
    lines.push(`           ativo = EXCLUDED.ativo, usa_padrao = EXCLUDED.usa_padrao,`)
    lines.push(`           hora_abertura = EXCLUDED.hora_abertura, hora_fechamento = EXCLUDED.hora_fechamento\`,`)
    lines.push(`        setorId, dia, ativo, usaPadrao, ab, fe,`)
    lines.push(`      )`)
    lines.push(`    }`)
    lines.push(``)
    for (const h of horariosSetor) {
      const setorNome = setorNomeById.get(h.setor_id) ?? `Setor ${h.setor_id}`
      lines.push(`    await upsertHorario(${esc(setorNome)}, ${esc(h.dia_semana)} as DiaSemana, ${h.ativo}, ${h.usa_padrao}, ${esc(h.hora_abertura)}, ${esc(h.hora_fechamento)})`)
    }
    lines.push(`  })`)
    lines.push(`  console.log('[SEED-LOCAL] Horarios semanais por setor atualizados')`)
    lines.push(``)
  }

  // -- 4. Demandas --
  lines.push(`  // -- 4. Demandas --`)
  lines.push(`  const demandasExistem = await queryOne<{ count: number }>('SELECT COUNT(*)::int as count FROM demandas')`)
  lines.push(`  if ((demandasExistem?.count ?? 0) === 0) {`)
  lines.push(`    await transaction(async () => {`)
  for (const d of demandas) {
    const setorNome = setorNomeById.get(d.setor_id) ?? `Setor ${d.setor_id}`
    lines.push(`      await execute('INSERT INTO demandas (setor_id, dia_semana, hora_inicio, hora_fim, min_pessoas, override) VALUES ($1, $2, $3, $4, $5, $6)', setorIdByNome.get(${esc(setorNome)})!, ${esc(d.dia_semana)}, ${esc(d.hora_inicio)}, ${esc(d.hora_fim)}, ${d.min_pessoas}, ${d.override})`)
  }
  lines.push(`    })`)
  lines.push(`    console.log('[SEED-LOCAL] ${demandas.length} demandas criadas')`)
  lines.push(`  }`)
  lines.push(``)

  // -- 5. Postos --
  lines.push(`  // -- 5. Postos (funcoes) --`)
  lines.push(`  const tipos = await queryAll<{ id: number; nome: string }>('SELECT id, nome FROM tipos_contrato')`)
  lines.push(`  const tipoByNome = new Map(tipos.map((t) => [t.nome, t.id]))`)
  lines.push(``)
  lines.push(`  const postosExistem = await queryOne<{ count: number }>('SELECT COUNT(*)::int as count FROM funcoes')`)
  lines.push(`  if ((postosExistem?.count ?? 0) === 0) {`)
  lines.push(`    await transaction(async () => {`)
  for (const f of funcoes) {
    const setorNome = setorNomeById.get(f.setor_id) ?? `Setor ${f.setor_id}`
    const tipoNome = tipoNomeById.get(f.tipo_contrato_id) ?? 'CLT 44h'
    lines.push(`      await execute('INSERT INTO funcoes (setor_id, apelido, tipo_contrato_id, ativo, ordem, cor_hex) VALUES ($1, $2, $3, $4, $5, $6)', setorIdByNome.get(${esc(setorNome)})!, ${esc(f.apelido)}, tipoByNome.get(${esc(tipoNome)}) ?? 1, ${f.ativo}, ${f.ordem}, ${esc(f.cor_hex)})`)
  }
  lines.push(`    })`)
  lines.push(`    console.log('[SEED-LOCAL] ${funcoes.length} postos criados')`)
  lines.push(`  }`)
  lines.push(``)

  // -- 6. Colaboradores --
  lines.push(`  // -- 6. Colaboradores --`)
  lines.push(`  const colabsExistem = await queryOne<{ count: number }>('SELECT COUNT(*)::int as count FROM colaboradores')`)
  lines.push(`  if ((colabsExistem?.count ?? 0) === 0) {`)
  lines.push(`    const todasFuncoes = await queryAll<{ id: number; setor_id: number; apelido: string }>('SELECT id, setor_id, apelido FROM funcoes')`)
  lines.push(`    const funcaoBySetorApelido = new Map(todasFuncoes.map((f) => [\`\${f.setor_id}:\${f.apelido.toUpperCase()}\`, f.id]))`)
  lines.push(`    const resolveFuncao = (setorId: number, apelido: string | null): number | null => {`)
  lines.push(`      if (!apelido) return null`)
  lines.push(`      return funcaoBySetorApelido.get(\`\${setorId}:\${apelido.toUpperCase()}\`) ?? null`)
  lines.push(`    }`)
  lines.push(``)
  lines.push(`    await transaction(async () => {`)
  for (const c of colaboradores) {
    const setorNome = setorNomeById.get(c.setor_id) ?? `Setor ${c.setor_id}`
    const tipoNome = tipoNomeById.get(c.tipo_contrato_id) ?? 'CLT 44h'
    const funcaoApelido = c.funcao_id ? funcaoApelidoById.get(c.funcao_id) ?? null : null
    lines.push(`      { const sId = setorIdByNome.get(${esc(setorNome)})!; await execute('INSERT INTO colaboradores (setor_id, tipo_contrato_id, nome, sexo, horas_semanais, rank, tipo_trabalhador, funcao_id, ativo) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)', sId, tipoByNome.get(${esc(tipoNome)}) ?? 1, ${esc(c.nome)}, ${esc(c.sexo)}, ${c.horas_semanais}, ${c.rank}, ${esc(c.tipo_trabalhador)}, resolveFuncao(sId, ${esc(funcaoApelido)}), ${c.ativo}) }`)
  }
  lines.push(`    })`)
  lines.push(`    console.log('[SEED-LOCAL] ${colaboradores.length} colaboradores criados')`)
  lines.push(`  }`)
  lines.push(``)

  // -- 7. Regras horário --
  if (regrasHorario.length > 0) {
    lines.push(`  // -- 7. Regras de horario --`)
    lines.push(`  const regrasExistem = await queryOne<{ count: number }>('SELECT COUNT(*)::int as count FROM colaborador_regra_horario')`)
    lines.push(`  if ((regrasExistem?.count ?? 0) === 0) {`)
    lines.push(`    const colabs = await queryAll<{ id: number; nome: string }>('SELECT id, nome FROM colaboradores')`)
    lines.push(`    const colabByNome = new Map(colabs.map((c) => [c.nome, c.id]))`)
    lines.push(`    const perfis = await queryAll<{ id: number; nome: string }>('SELECT id, nome FROM contrato_perfis_horario')`)
    lines.push(`    const perfilByNome = new Map(perfis.map((p) => [p.nome, p.id]))`)
    lines.push(``)
    lines.push(`    await transaction(async () => {`)
    for (const r of regrasHorario) {
      const colabNome = colabNomeById.get(r.colaborador_id)
      const perfilNome = r.perfil_horario_id ? perfilNomeById.get(r.perfil_horario_id) ?? null : null
      if (!colabNome) continue
      lines.push(`      { const cId = colabByNome.get(${esc(colabNome)}); if (cId) await execute('INSERT INTO colaborador_regra_horario (colaborador_id, ativo, perfil_horario_id, inicio, fim, preferencia_turno_soft, domingo_ciclo_trabalho, domingo_ciclo_folga, folga_fixa_dia_semana, dia_semana_regra, folga_variavel_dia_semana) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)', cId, ${r.ativo}, ${perfilNome ? `perfilByNome.get(${esc(perfilNome)}) ?? null` : 'null'}, ${esc(r.inicio)}, ${esc(r.fim)}, ${esc(r.preferencia_turno_soft)}, ${esc(r.domingo_ciclo_trabalho)}, ${esc(r.domingo_ciclo_folga)}, ${esc(r.folga_fixa_dia_semana)}, ${esc(r.dia_semana_regra)}, ${esc(r.folga_variavel_dia_semana)}) }`)
    }
    lines.push(`    })`)
    lines.push(`    console.log('[SEED-LOCAL] ${regrasHorario.length} regras de horario criadas')`)
    lines.push(`  }`)
    lines.push(``)
  }

  // -- 8. Exceções horário por data --
  if (excHorario.length > 0) {
    lines.push(`  // -- 8. Excecoes de horario por data --`)
    lines.push(`  const excHorExistem = await queryOne<{ count: number }>('SELECT COUNT(*)::int as count FROM colaborador_regra_horario_excecao_data')`)
    lines.push(`  if ((excHorExistem?.count ?? 0) === 0) {`)
    lines.push(`    const colabs2 = await queryAll<{ id: number; nome: string }>('SELECT id, nome FROM colaboradores')`)
    lines.push(`    const colabByNome2 = new Map(colabs2.map((c) => [c.nome, c.id]))`)
    lines.push(`    await transaction(async () => {`)
    for (const e of excHorario) {
      const colabNome = colabNomeById.get(e.colaborador_id)
      if (!colabNome) continue
      lines.push(`      { const cId = colabByNome2.get(${esc(colabNome)}); if (cId) await execute('INSERT INTO colaborador_regra_horario_excecao_data (colaborador_id, data, ativo, inicio, fim, preferencia_turno_soft, domingo_forcar_folga) VALUES ($1,$2,$3,$4,$5,$6,$7)', cId, ${esc(e.data)}, ${e.ativo}, ${esc(e.inicio)}, ${esc(e.fim)}, ${esc(e.preferencia_turno_soft)}, ${e.domingo_forcar_folga}) }`)
    }
    lines.push(`    })`)
    lines.push(`    console.log('[SEED-LOCAL] ${excHorario.length} excecoes de horario por data')`)
    lines.push(`  }`)
    lines.push(``)
  }

  // -- 9. Demandas exceção por data --
  if (demExcecao.length > 0) {
    lines.push(`  // -- 9. Demandas excecao por data --`)
    lines.push(`  const demExcExistem = await queryOne<{ count: number }>('SELECT COUNT(*)::int as count FROM demandas_excecao_data')`)
    lines.push(`  if ((demExcExistem?.count ?? 0) === 0) {`)
    lines.push(`    await transaction(async () => {`)
    for (const d of demExcecao) {
      const setorNome = setorNomeById.get(d.setor_id) ?? `Setor ${d.setor_id}`
      lines.push(`      await execute('INSERT INTO demandas_excecao_data (setor_id, data, hora_inicio, hora_fim, min_pessoas, override) VALUES ($1,$2,$3,$4,$5,$6)', setorIdByNome.get(${esc(setorNome)})!, ${esc(d.data)}, ${esc(d.hora_inicio)}, ${esc(d.hora_fim)}, ${d.min_pessoas}, ${d.override})`)
    }
    lines.push(`    })`)
    lines.push(`    console.log('[SEED-LOCAL] ${demExcecao.length} demandas excecao por data')`)
    lines.push(`  }`)
    lines.push(``)
  }

  // -- 10. Exceções --
  if (excecoes.length > 0) {
    lines.push(`  // -- 10. Excecoes (ferias/atestado/bloqueio) --`)
    lines.push(`  const excecoesExistem = await queryOne<{ count: number }>('SELECT COUNT(*)::int as count FROM excecoes')`)
    lines.push(`  if ((excecoesExistem?.count ?? 0) === 0) {`)
    lines.push(`    const colabs3 = await queryAll<{ id: number; nome: string }>('SELECT id, nome FROM colaboradores')`)
    lines.push(`    const colabByNome3 = new Map(colabs3.map((c) => [c.nome, c.id]))`)
    lines.push(`    await transaction(async () => {`)
    for (const e of excecoes) {
      const colabNome = colabNomeById.get(e.colaborador_id)
      if (!colabNome) continue
      lines.push(`      { const cId = colabByNome3.get(${esc(colabNome)}); if (cId) await execute('INSERT INTO excecoes (colaborador_id, data_inicio, data_fim, tipo, observacao) VALUES ($1,$2,$3,$4,$5)', cId, ${esc(e.data_inicio)}, ${esc(e.data_fim)}, ${esc(e.tipo)}, ${esc(e.observacao)}) }`)
    }
    lines.push(`    })`)
    lines.push(`    console.log('[SEED-LOCAL] ${excecoes.length} excecoes criadas')`)
    lines.push(`  }`)
    lines.push(``)
  }

  // -- 11. Horários empresa --
  if (horariosEmpresa.length > 0) {
    lines.push(`  // -- 11. Horarios de funcionamento empresa --`)
    lines.push(`  const horarioEmpresaExiste = await queryOne<{ count: number }>('SELECT COUNT(*)::int as count FROM empresa_horario_semana')`)
    lines.push(`  if ((horarioEmpresaExiste?.count ?? 0) === 0) {`)
    lines.push(`    await transaction(async () => {`)
    for (const h of horariosEmpresa) {
      lines.push(`      await execute('INSERT INTO empresa_horario_semana (dia_semana, ativo, hora_abertura, hora_fechamento) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING', ${esc(h.dia_semana)}, ${h.ativo}, ${esc(h.hora_abertura)}, ${esc(h.hora_fechamento)})`)
    }
    lines.push(`    })`)
    lines.push(`    console.log('[SEED-LOCAL] ${horariosEmpresa.length} horarios empresa')`)
    lines.push(`  }`)
    lines.push(``)
  }

  // -- 12. Regras empresa --
  if (regrasEmpresa.length > 0) {
    lines.push(`  // -- 12. Regras empresa (overrides) --`)
    lines.push(`  const regrasEmpresaExistem = await queryOne<{ count: number }>('SELECT COUNT(*)::int as count FROM regra_empresa')`)
    lines.push(`  if ((regrasEmpresaExistem?.count ?? 0) === 0) {`)
    lines.push(`    await transaction(async () => {`)
    for (const r of regrasEmpresa) {
      lines.push(`      await execute('INSERT INTO regra_empresa (codigo, status) VALUES ($1,$2) ON CONFLICT(codigo) DO UPDATE SET status = EXCLUDED.status', ${esc(r.codigo)}, ${esc(r.status)})`)
    }
    lines.push(`    })`)
    lines.push(`    console.log('[SEED-LOCAL] ${regrasEmpresa.length} regras empresa')`)
    lines.push(`  }`)
    lines.push(``)
  }

  // -- 13. Config IA --
  if (iaConfig) {
    lines.push(`  // -- 13. Configuracao IA --`)
    lines.push(`  const providerConfigsJson = JSON.stringify({`)
    lines.push(`    gemini: { token: GEMINI_API_KEY, modelo: GEMINI_MODEL },`)
    lines.push(`    openrouter: { token: OPENROUTER_API_KEY, modelo: 'openrouter/free' },`)
    lines.push(`  })`)
    lines.push(`  const iaConfigExiste = await queryOne<{ id: number }>('SELECT id FROM configuracao_ia LIMIT 1')`)
    lines.push(`  if (!iaConfigExiste) {`)
    lines.push(`    await execute(`)
    lines.push(`      'INSERT INTO configuracao_ia (provider, api_key, modelo, provider_configs_json, ativo, memoria_automatica) VALUES ($1,$2,$3,$4,$5,$6)',`)
    lines.push(`      'gemini', GEMINI_API_KEY, GEMINI_MODEL, providerConfigsJson, true, true,`)
    lines.push(`    )`)
    lines.push(`    console.log('[SEED-LOCAL] Configuracao IA criada')`)
    lines.push(`  }`)
    lines.push(``)
  }

  lines.push(`  console.log('[SEED-LOCAL] Seed local concluido')`)
  lines.push(`  console.log('[SEED-LOCAL] >>> Periodo sugerido para teste: 2026-03-02 a 2026-04-26 (8 semanas) <<<')`)
  lines.push(`}`)
  lines.push(``)

  const output = lines.join('\n')

  if (dryRun) {
    console.log('\n[extract] --- DRY RUN --- Conteudo que seria gerado:\n')
    console.log(output.slice(0, 3000) + '\n... (truncado)')
    console.log(`\n[extract] Total: ${output.length} chars, ${lines.length} lines`)
  } else {
    fs.writeFileSync(OUTPUT_PATH, output, 'utf-8')
    console.log(`[extract] Arquivo gerado: ${OUTPUT_PATH}`)
    console.log(`[extract] ${setores.length} setores, ${colaboradores.length} colaboradores, ${demandas.length} demandas, ${regrasHorario.length} regras`)
  }
}

main().catch((err) => {
  console.error('[extract] ERRO:', err.message || err)
  process.exit(1)
})
