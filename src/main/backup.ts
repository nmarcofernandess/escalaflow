import fs from 'node:fs'
import path from 'node:path'
import AdmZip from 'adm-zip'
import { queryAll, queryOne, execute, transaction, execDDL } from './db/query'
import type { BackupScope, ConfiguracaoBackup, SnapshotTrigger, SnapshotMeta, SnapshotInfo } from '../shared/types'

// ─── Constants (fonte unica de verdade) ──────────────────────

// Categorias de tabelas — organiza o ZIP em pastas.
// EXCLUDES regra_definicao (system table, seeded at startup, protected).
export const BACKUP_CATEGORIAS = {
  cadastros: [
    'empresa', 'tipos_contrato', 'setores', 'demandas', 'colaboradores',
    'excecoes', 'escalas', 'alocacoes', 'funcoes', 'feriados',
    'setor_horario_semana', 'empresa_horario_semana', 'contrato_perfis_horario',
    'colaborador_regra_horario', 'colaborador_regra_horario_excecao_data',
    'demandas_excecao_data', 'escala_ciclo_modelos', 'escala_ciclo_itens',
    'escala_decisoes', 'escala_comparacao_demanda', 'configuracao_ia', 'regra_empresa',
  ],
  conhecimento: [
    'ia_memorias', 'knowledge_sources', 'knowledge_chunks',
    'knowledge_entities', 'knowledge_relations',
  ],
  conversas: [
    'ia_conversas', 'ia_mensagens',
  ],
  config: [
    'configuracao_backup',
  ],
} as const

// Tabelas EXCLUIDAS do backup operacional (auto). So entram no backup completo (manual).
const FULL_ONLY_TABLES = new Set([
  'configuracao_ia',
  'ia_conversas', 'ia_mensagens', 'ia_memorias',
  'knowledge_sources', 'knowledge_chunks', 'knowledge_entities', 'knowledge_relations',
])

// FK-safe order for import (parents before children)
const IMPORT_ORDER = [
  'empresa', 'tipos_contrato', 'setores', 'funcoes', 'contrato_perfis_horario',
  'colaboradores', 'demandas', 'excecoes', 'setor_horario_semana', 'empresa_horario_semana',
  'colaborador_regra_horario', 'colaborador_regra_horario_excecao_data',
  'demandas_excecao_data', 'feriados', 'escalas', 'alocacoes',
  'escala_decisoes', 'escala_comparacao_demanda', 'escala_ciclo_modelos', 'escala_ciclo_itens',
  'configuracao_ia', 'regra_empresa',
  'ia_memorias', 'knowledge_sources', 'knowledge_chunks', 'knowledge_entities', 'knowledge_relations',
  'ia_conversas', 'ia_mensagens',
  'configuracao_backup',
] as const

const MAX_PRE_RESTORE = 5
const log = (...args: unknown[]) => console.log('[BACKUP]', ...args)

// ─── DB critical section (mutex) — Onda 2 ────────────────────
// Serializa snapshot/save/restore no main process para impedir
// que um SELECT * leia estado parcial no meio de uma transacao.

let _dbCsQueue: Promise<void> = Promise.resolve()

export async function withDbCriticalSection<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const prev = _dbCsQueue
  let release!: () => void
  _dbCsQueue = new Promise<void>((r) => { release = r })
  await prev
  log(`[CS] enter: ${label}`)
  try {
    return await fn()
  } finally {
    log(`[CS] exit: ${label}`)
    release()
  }
}

// ─── Helpers ─────────────────────────────────────────────────

export function getDefaultBackupDir(userData: string): string {
  return path.join(userData, 'backups')
}

export async function getBackupConfig(): Promise<ConfiguracaoBackup> {
  try {
    const row = await queryOne<ConfiguracaoBackup & { id: number }>(
      'SELECT * FROM configuracao_backup WHERE id = 1',
    )
    return {
      pasta: row?.pasta ?? null,
      ativo: row?.ativo ?? true,
      backup_ao_fechar: row?.backup_ao_fechar ?? true,
      intervalo_horas: row?.intervalo_horas ?? 24,
      max_snapshots: row?.max_snapshots ?? 30,
      ultimo_backup: row?.ultimo_backup ?? null,
    }
  } catch {
    // Table might not exist yet — ensure it does
    await execDDL(`CREATE TABLE IF NOT EXISTS configuracao_backup (
      id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
      pasta TEXT,
      ativo BOOLEAN NOT NULL DEFAULT TRUE,
      backup_ao_fechar BOOLEAN NOT NULL DEFAULT TRUE,
      intervalo_horas INTEGER NOT NULL DEFAULT 24,
      max_snapshots INTEGER NOT NULL DEFAULT 30,
      ultimo_backup TIMESTAMPTZ,
      atualizado_em TIMESTAMPTZ DEFAULT NOW()
    )`)
    await execute('INSERT INTO configuracao_backup (id) VALUES (1) ON CONFLICT DO NOTHING')
    return { pasta: null, ativo: true, backup_ao_fechar: true, intervalo_horas: 24, max_snapshots: 30, ultimo_backup: null }
  }
}

export async function getBackupDir(userData: string): Promise<string> {
  const config = await getBackupConfig()
  return config.pasta ?? getDefaultBackupDir(userData)
}

// ─── Parse backup file (ZIP or legacy JSON) ─────────────────

export function parseBackupFile(filepath: string): { meta: SnapshotMeta; dados: Record<string, unknown[]> } {
  const isZip = filepath.toLowerCase().endsWith('.zip')

  if (isZip) {
    const zip = new AdmZip(filepath)
    const entries = zip.getEntries()

    const metaEntry = entries.find((e) => e.entryName === '_meta.json')
    if (!metaEntry) throw new Error('Arquivo ZIP invalido. Nenhum _meta.json encontrado.')
    const meta = JSON.parse(metaEntry.getData().toString('utf-8')) as SnapshotMeta
    if (meta?.app !== 'escalaflow') throw new Error('Arquivo de backup invalido. Selecione um backup do EscalaFlow.')

    const dados: Record<string, unknown[]> = {}
    for (const entry of entries) {
      if (entry.isDirectory || entry.entryName === '_meta.json') continue
      const parts = entry.entryName.split('/')
      if (parts.length !== 2) continue
      const table = parts[1].replace('.json', '')
      try {
        const rows = JSON.parse(entry.getData().toString('utf-8'))
        if (Array.isArray(rows)) dados[table] = rows
      } catch { /* corrupted entry */ }
    }

    return { meta, dados }
  }

  // Legacy JSON — two formats: flat (snapshot) or nested (old export with .dados)
  const raw = fs.readFileSync(filepath, 'utf-8')
  const parsed = JSON.parse(raw)

  if (parsed?._meta?.app === 'escalaflow') {
    // Flat snapshot format: { _meta, empresa: [...], setores: [...], ... }
    const { _meta, ...tables } = parsed
    const dados: Record<string, unknown[]> = {}
    for (const [k, v] of Object.entries(tables)) {
      if (Array.isArray(v)) dados[k] = v
    }
    return { meta: _meta as SnapshotMeta, dados }
  }

  if (parsed?.dados && typeof parsed.dados === 'object') {
    // Old export format: { _meta, dados: { table: [...] } }
    if (parsed._meta?.app !== 'escalaflow') {
      throw new Error('Arquivo de backup invalido. Selecione um arquivo exportado pelo EscalaFlow.')
    }
    return { meta: parsed._meta as SnapshotMeta, dados: parsed.dados }
  }

  throw new Error('Formato de backup nao reconhecido.')
}

// ─── Import data with transaction safety ─────────────────────

export async function importFromData(
  dados: Record<string, unknown[]>,
): Promise<{ tabelas: number; registros: number; repairs: number }> {
  if (Object.keys(dados).length === 0) {
    throw new Error('Nenhuma tabela encontrada no backup.')
  }

  return withDbCriticalSection('importFromData', () => transaction(async () => {
    await execDDL("SET session_replication_role = 'replica'")

    let totalTabelas = 0
    let totalRegistros = 0

    try {
      const backupTables = new Set(Object.keys(dados))

      // Delete in reverse FK order (children before parents)
      for (let i = IMPORT_ORDER.length - 1; i >= 0; i--) {
        const table = IMPORT_ORDER[i]
        if (!backupTables.has(table)) continue
        try {
          await execute(`DELETE FROM ${table}`)
        } catch { /* table might not exist */ }
      }

      // Insert in FK order (parents before children)
      for (const table of IMPORT_ORDER) {
        const rows = dados[table]
        if (!rows || !Array.isArray(rows) || rows.length === 0) continue

        const sample = rows[0] as Record<string, unknown>
        const columns = Object.keys(sample)

        // Tabelas com UNIQUE (setor_id, dia_semana): UPSERT para restaurar usa_padrao e demanda por faixa corretamente
        if (table === 'setor_horario_semana') {
          const wantCols = ['setor_id', 'dia_semana', 'ativo', 'usa_padrao', 'hora_abertura', 'hora_fechamento']
          const setCols = wantCols.filter((c) => columns.includes(c))
          const placeholders = setCols.map((_, i) => `$${i + 1}`).join(', ')
          const updateSet = setCols
            .filter((c) => !['setor_id', 'dia_semana'].includes(c))
            .map((c) => `${c} = excluded.${c}`)
            .join(', ')
          for (const row of rows) {
            const r = row as Record<string, unknown>
            const values = setCols.map((col) => {
              const v = r[col]
              if (col === 'usa_padrao' || col === 'ativo') return v === true || v === 1 || v === '1' || v === 'true'
              return v ?? null
            })
            await execute(
              `INSERT INTO setor_horario_semana (${setCols.join(', ')}) VALUES (${placeholders})
               ON CONFLICT (setor_id, dia_semana) DO UPDATE SET ${updateSet}`,
              ...values,
            )
          }
        } else {
          const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ')
          for (const row of rows) {
            const r = row as Record<string, unknown>
            const values = columns.map((col) => {
              const v = r[col]
              // Normalizar boolean para backups que serializaram 0/1 ou "true"/"false"
              if (typeof v === 'boolean') return v
              if (col === 'usa_padrao' || col === 'ativo' || col === 'override' || col === 'protegido_sistema' || col === 'cct_autoriza') {
                if (v === 1 || v === '1' || v === 'true') return true
                if (v === 0 || v === '0' || v === 'false') return false
              }
              return v ?? null
            })
            await execute(
              `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`,
              ...values,
            )
          }
        }

        totalTabelas++
        totalRegistros += rows.length
      }
    } finally {
      await execDDL("SET session_replication_role = 'origin'")
    }

    // ─── Onda 4: Repair pos-restore ──────────────────────────────
    const repairs = await repairRestoredOperationalState()

    return { tabelas: totalTabelas, registros: totalRegistros, repairs }
  }))
}

// ─── Repair pos-restore (Onda 4) ─────────────────────────────

/**
 * Reconcilia estado operacional apos import. Roda DENTRO da mesma transacao.
 * - O4.1: Reconstroi demanda_padrao_* quando vazio/inconsistente
 * - O4.2: Limpa funcao_id orfao em colaboradores
 * - O4.3: Reindexa funcoes.ordem por setor
 */
export async function repairRestoredOperationalState(): Promise<number> {
  let repairs = 0

  // ─── O4.1: Repair demanda_padrao_* ──────────────────────────
  const setores = await queryAll<{
    id: number
    demanda_padrao_hora_abertura: string | null
    demanda_padrao_hora_fechamento: string | null
    demanda_padrao_segmentos_json: string | null
    hora_abertura: string
    hora_fechamento: string
  }>('SELECT id, demanda_padrao_hora_abertura, demanda_padrao_hora_fechamento, demanda_padrao_segmentos_json, hora_abertura, hora_fechamento FROM setores')

  for (const setor of setores) {
    let segmentos: unknown[] = []
    try {
      segmentos = setor.demanda_padrao_segmentos_json ? JSON.parse(setor.demanda_padrao_segmentos_json) : []
    } catch { /* invalid json */ }

    const padraoValido = Array.isArray(segmentos) && segmentos.length > 0
      && setor.demanda_padrao_hora_abertura && setor.demanda_padrao_hora_fechamento

    if (padraoValido) continue

    // Padrao vazio ou invalido — tentar reconstruir a partir dos dias
    const diasHerdados = await queryAll<{
      dia_semana: string
      usa_padrao: boolean
      hora_abertura: string
      hora_fechamento: string
    }>(
      'SELECT dia_semana, usa_padrao, hora_abertura, hora_fechamento FROM setor_horario_semana WHERE setor_id = $1 ORDER BY dia_semana',
      setor.id,
    )

    // Procurar primeiro dia usa_padrao=true com demandas
    let sourceDia: string | null = null
    for (const d of diasHerdados) {
      if (!d.usa_padrao) continue
      const cnt = await queryOne<{ c: number }>(
        'SELECT COUNT(*)::int as c FROM demandas WHERE setor_id = $1 AND dia_semana = $2',
        setor.id, d.dia_semana,
      )
      if (cnt && cnt.c > 0) { sourceDia = d.dia_semana; break }
    }

    // Fallback: qualquer dia com demandas
    if (!sourceDia) {
      for (const d of diasHerdados) {
        const cnt = await queryOne<{ c: number }>(
          'SELECT COUNT(*)::int as c FROM demandas WHERE setor_id = $1 AND dia_semana = $2',
          setor.id, d.dia_semana,
        )
        if (cnt && cnt.c > 0) { sourceDia = d.dia_semana; break }
      }
    }

    if (!sourceDia) continue // sem dados pra reconstruir

    const sourceHorario = diasHerdados.find((d) => d.dia_semana === sourceDia)
    const sourceSegs = await queryAll<{ hora_inicio: string; hora_fim: string; min_pessoas: number; override: boolean }>(
      'SELECT hora_inicio, hora_fim, min_pessoas, override FROM demandas WHERE setor_id = $1 AND dia_semana = $2 ORDER BY hora_inicio',
      setor.id, sourceDia,
    )

    if (sourceSegs.length === 0) continue

    const newAbertura = sourceHorario?.hora_abertura ?? setor.hora_abertura
    const newFechamento = sourceHorario?.hora_fechamento ?? setor.hora_fechamento
    const newJson = JSON.stringify(sourceSegs.map((s) => ({
      hora_inicio: s.hora_inicio,
      hora_fim: s.hora_fim,
      min_pessoas: s.min_pessoas,
      override: s.override,
    })))

    await execute(
      `UPDATE setores SET demanda_padrao_hora_abertura = $1, demanda_padrao_hora_fechamento = $2, demanda_padrao_segmentos_json = $3 WHERE id = $4`,
      newAbertura, newFechamento, newJson, setor.id,
    )
    repairs++
    log(`Repair O4.1: setor ${setor.id} padrao reconstruido a partir de ${sourceDia}`)
  }

  // ─── O4.2: Limpar funcao_id orfao ───────────────────────────
  const orphaned = await execute(`
    UPDATE colaboradores SET funcao_id = NULL
    WHERE funcao_id IS NOT NULL
    AND funcao_id NOT IN (SELECT id FROM funcoes)
  `)
  if (orphaned.changes > 0) {
    repairs += orphaned.changes
    log(`Repair O4.2: ${orphaned.changes} colaboradores com funcao_id orfao corrigidos`)
  }

  // ─── O4.3: Reindexar funcoes.ordem por setor ───────────────
  const setorIds = await queryAll<{ id: number }>('SELECT id FROM setores')
  for (const s of setorIds) {
    const funcoes = await queryAll<{ id: number }>(
      'SELECT id FROM funcoes WHERE setor_id = $1 ORDER BY ordem ASC, apelido ASC',
      s.id,
    )
    for (let i = 0; i < funcoes.length; i++) {
      await execute('UPDATE funcoes SET ordem = $1 WHERE id = $2', i, funcoes[i].id)
    }
  }

  // ─── O4.4: Criar setor_horario_semana ausente ────────────────
  for (const setor of setores) {
    const setorAtualizado = await queryOne<{
      demanda_padrao_segmentos_json: string | null
      demanda_padrao_hora_abertura: string | null
      demanda_padrao_hora_fechamento: string | null
      hora_abertura: string
      hora_fechamento: string
    }>('SELECT demanda_padrao_segmentos_json, demanda_padrao_hora_abertura, demanda_padrao_hora_fechamento, hora_abertura, hora_fechamento FROM setores WHERE id = $1', setor.id)
    if (!setorAtualizado) continue

    let padraoSegs: Array<{ hora_inicio: string; hora_fim: string; min_pessoas: number; override: boolean }> = []
    try { padraoSegs = JSON.parse(setorAtualizado.demanda_padrao_segmentos_json || '[]') } catch { /* invalid */ }
    if (!Array.isArray(padraoSegs)) padraoSegs = []

    const diasComDemandas = await queryAll<{ dia_semana: string }>(
      'SELECT DISTINCT dia_semana FROM demandas WHERE setor_id = $1 AND dia_semana IS NOT NULL', setor.id)

    const existentes = await queryAll<{ dia_semana: string }>(
      'SELECT dia_semana FROM setor_horario_semana WHERE setor_id = $1', setor.id)
    const existentesSet = new Set(existentes.map((e) => e.dia_semana))

    for (const { dia_semana } of diasComDemandas) {
      if (existentesSet.has(dia_semana)) continue

      const daySegs = await queryAll<{ hora_inicio: string; hora_fim: string; min_pessoas: number; override: boolean }>(
        'SELECT hora_inicio, hora_fim, min_pessoas, override FROM demandas WHERE setor_id = $1 AND dia_semana = $2 ORDER BY hora_inicio',
        setor.id, dia_semana)

      const match = daySegs.length === padraoSegs.length && daySegs.every((s, i) =>
        s.hora_inicio === padraoSegs[i]?.hora_inicio
        && s.hora_fim === padraoSegs[i]?.hora_fim
        && s.min_pessoas === padraoSegs[i]?.min_pessoas
        && Boolean(s.override) === Boolean(padraoSegs[i]?.override))

      const abertura = match
        ? (setorAtualizado.demanda_padrao_hora_abertura ?? setorAtualizado.hora_abertura)
        : (daySegs.length > 0 ? daySegs[0].hora_inicio : setorAtualizado.hora_abertura)
      const fechamento = match
        ? (setorAtualizado.demanda_padrao_hora_fechamento ?? setorAtualizado.hora_fechamento)
        : (daySegs.length > 0 ? daySegs[daySegs.length - 1].hora_fim : setorAtualizado.hora_fechamento)

      await execute(
        `INSERT INTO setor_horario_semana (setor_id, dia_semana, ativo, usa_padrao, hora_abertura, hora_fechamento)
         VALUES ($1, $2, true, $3, $4, $5)
         ON CONFLICT(setor_id, dia_semana) DO NOTHING`,
        setor.id, dia_semana, match, abertura, fechamento)

      repairs++
      log(`Repair O4.4: setor ${setor.id} criou setor_horario_semana para ${dia_semana} (usa_padrao=${match})`)
    }
  }

  if (repairs > 0) log(`Repair total: ${repairs} correcoes aplicadas`)
  return repairs
}

// ─── Core functions ──────────────────────────────────────────

/** Monta ZIP filtrando por scope. Roda dentro de critical section para consistencia. */
async function buildBackupZip(options?: { scope?: BackupScope }): Promise<{ zip: AdmZip; totalTabelas: number; totalRegistros: number; scope: BackupScope }> {
  const scope: BackupScope = options?.scope ?? 'full'

  return withDbCriticalSection('buildBackupZip', async () => {
    const zip = new AdmZip()
    let totalRegistros = 0
    let totalTabelas = 0

    for (const [categoria, tables] of Object.entries(BACKUP_CATEGORIAS)) {
      for (const table of tables) {
        if (scope === 'operational' && FULL_ONLY_TABLES.has(table)) continue
        try {
          const rows = await queryAll<Record<string, unknown>>(`SELECT * FROM ${table}`)
          if (rows.length === 0) continue
          zip.addFile(`${categoria}/${table}.json`, Buffer.from(JSON.stringify(rows), 'utf-8'))
          totalTabelas++
          totalRegistros += rows.length
        } catch { /* table might not exist yet */ }
      }
    }

    return { zip, totalTabelas, totalRegistros, scope }
  })
}

export async function createSnapshot(
  trigger: SnapshotTrigger,
  userData: string,
  appVersion?: string,
  options?: { scope?: BackupScope },
): Promise<SnapshotInfo | null> {
  try {
    const dir = await getBackupDir(userData)
    fs.mkdirSync(dir, { recursive: true })

    const { zip, totalTabelas, totalRegistros, scope } = await buildBackupZip(options)

    const now = new Date()
    const meta: SnapshotMeta = {
      app: 'escalaflow',
      versao: appVersion ?? '0.0.0',
      criado_em: now.toISOString(),
      trigger,
      tabelas: totalTabelas,
      registros: totalRegistros,
      scope,
    }
    zip.addFile('_meta.json', Buffer.from(JSON.stringify(meta, null, 2), 'utf-8'))

    const ts = now.toISOString().replace(/[:.]/g, '-').replace('Z', '')
    const filename = `escalaflow-backup-${ts}.zip`
    const filepath = path.join(dir, filename)

    zip.writeZip(filepath)

    await execute(
      'UPDATE configuracao_backup SET ultimo_backup = $1, atualizado_em = NOW() WHERE id = 1',
      now.toISOString(),
    )

    const stat = fs.statSync(filepath)
    log(`Created: ${filename} (${trigger} ${scope}, ${totalRegistros} records, ${(stat.size / 1024).toFixed(0)}KB)`)

    const config = await getBackupConfig()
    await cleanupSnapshots(config.max_snapshots, userData)

    return { filename, meta, tamanho_bytes: stat.size }
  } catch (err) {
    log('Error creating snapshot:', err)
    throw err
  }
}

/** Exporta backup completo para destino escolhido pelo usuario (Save Dialog) */
export async function createExportZip(
  destino: string,
  appVersion?: string,
): Promise<{ filepath: string; tamanho_mb: number }> {
  const { zip, totalTabelas, totalRegistros } = await buildBackupZip({ scope: 'full' })

  const meta: SnapshotMeta = {
    app: 'escalaflow',
    versao: appVersion ?? '0.0.0',
    criado_em: new Date().toISOString(),
    trigger: 'manual',
    tabelas: totalTabelas,
    registros: totalRegistros,
    scope: 'full',
  }
  zip.addFile('_meta.json', Buffer.from(JSON.stringify(meta, null, 2), 'utf-8'))

  zip.writeZip(destino)
  const stat = fs.statSync(destino)
  log(`Exported: ${destino} (${totalRegistros} records, ${(stat.size / 1024).toFixed(0)}KB)`)

  return { filepath: destino, tamanho_mb: +(stat.size / 1024 / 1024).toFixed(2) }
}

export async function listSnapshots(userData: string): Promise<SnapshotInfo[]> {
  const dir = await getBackupDir(userData)
  if (!fs.existsSync(dir)) return []

  const files = fs.readdirSync(dir).filter((f) =>
    (f.startsWith('escalaflow-backup-') && f.endsWith('.zip')) ||
    (f.startsWith('snapshot-') && f.endsWith('.json')),
  )
  const snapshots: SnapshotInfo[] = []

  for (const filename of files) {
    try {
      const filepath = path.join(dir, filename)
      const stat = fs.statSync(filepath)

      if (filename.endsWith('.zip')) {
        const zip = new AdmZip(filepath)
        const metaEntry = zip.getEntry('_meta.json')
        if (!metaEntry) continue
        const meta = JSON.parse(metaEntry.getData().toString('utf-8')) as SnapshotMeta
        if (meta?.app === 'escalaflow') {
          snapshots.push({ filename, meta, tamanho_bytes: stat.size })
        }
      } else {
        // Legacy JSON
        const content = fs.readFileSync(filepath, 'utf-8')
        const parsed = JSON.parse(content) as { _meta?: SnapshotMeta }
        if (parsed._meta?.app === 'escalaflow') {
          snapshots.push({ filename, meta: parsed._meta, tamanho_bytes: stat.size })
        }
      }
    } catch { /* skip corrupted files */ }
  }

  snapshots.sort((a, b) => new Date(b.meta.criado_em).getTime() - new Date(a.meta.criado_em).getTime())
  return snapshots
}

export async function restoreSnapshot(
  filename: string,
  userData: string,
  appVersion?: string,
  options?: { skipPreRestore?: boolean },
): Promise<{ tabelas: number; registros: number; repairs: number; preRestoreFilename: string | null }> {
  let preRestoreFilename: string | null = null

  if (!options?.skipPreRestore) {
    const preSnap = await createSnapshot('auto_pre_restore', userData, appVersion, { scope: 'full' })
    preRestoreFilename = preSnap?.filename ?? null
  }

  const dir = await getBackupDir(userData)
  const filepath = path.join(dir, filename)
  const { meta, dados } = parseBackupFile(filepath)

  if (meta?.app !== 'escalaflow') {
    throw new Error('Arquivo invalido: nao e um backup EscalaFlow')
  }

  const result = await importFromData(dados)
  log(`Restored: ${filename} (${result.tabelas} tables, ${result.registros} records, ${result.repairs} repairs)`)
  return { ...result, preRestoreFilename }
}

export async function cleanupSnapshots(max: number, userData: string): Promise<void> {
  const all = await listSnapshots(userData)
  const dir = await getBackupDir(userData)

  const preRestore = all.filter((s) => s.meta.trigger === 'auto_pre_restore')
  const regular = all.filter((s) => s.meta.trigger !== 'auto_pre_restore')

  if (preRestore.length > MAX_PRE_RESTORE) {
    const excess = preRestore.slice(MAX_PRE_RESTORE)
    for (const snap of excess) {
      try {
        fs.unlinkSync(path.join(dir, snap.filename))
        log(`Cleanup pre-restore: ${snap.filename}`)
      } catch { /* ignore */ }
    }
  }

  if (regular.length > max) {
    const excess = regular.slice(max)
    for (const snap of excess) {
      try {
        fs.unlinkSync(path.join(dir, snap.filename))
        log(`Cleanup: ${snap.filename}`)
      } catch { /* ignore */ }
    }
  }
}

export async function deleteSnapshot(filename: string, userData: string): Promise<void> {
  const dir = await getBackupDir(userData)
  const filepath = path.join(dir, filename)
  if (fs.existsSync(filepath)) {
    fs.unlinkSync(filepath)
    log(`Deleted: ${filename}`)
  }
}
