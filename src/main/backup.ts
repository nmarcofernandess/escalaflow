import fs from 'node:fs'
import path from 'node:path'
import AdmZip from 'adm-zip'
import { queryAll, queryOne, execute, transaction, execDDL } from './db/query'
import type { ConfiguracaoBackup, SnapshotTrigger, SnapshotMeta, SnapshotInfo } from '../shared/types'

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

// ─── Concurrency guard ───────────────────────────────────────

let snapshotInProgress = false

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
): Promise<{ tabelas: number; registros: number }> {
  if (Object.keys(dados).length === 0) {
    throw new Error('Nenhuma tabela encontrada no backup.')
  }

  return transaction(async () => {
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
        const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ')

        for (const row of rows) {
          const r = row as Record<string, unknown>
          const values = columns.map((col) => r[col] ?? null)
          await execute(
            `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`,
            ...values,
          )
        }

        totalTabelas++
        totalRegistros += rows.length
      }
    } finally {
      await execDDL("SET session_replication_role = 'origin'")
    }

    return { tabelas: totalTabelas, registros: totalRegistros }
  })
}

// ─── Core functions ──────────────────────────────────────────

/** Categorias a EXCLUIR no modo light (backup rapido sem IA stuff) */
const LIGHT_EXCLUDE: (keyof typeof BACKUP_CATEGORIAS)[] = ['conversas', 'conhecimento']

/** Monta ZIP com as categorias selecionadas. Retorna { zip, totalTabelas, totalRegistros } */
async function buildBackupZip(options?: { light?: boolean }): Promise<{ zip: AdmZip; totalTabelas: number; totalRegistros: number }> {
  const zip = new AdmZip()
  let totalRegistros = 0
  let totalTabelas = 0

  for (const [categoria, tables] of Object.entries(BACKUP_CATEGORIAS)) {
    if (options?.light && LIGHT_EXCLUDE.includes(categoria as keyof typeof BACKUP_CATEGORIAS)) continue
    for (const table of tables) {
      try {
        const rows = await queryAll<Record<string, unknown>>(`SELECT * FROM ${table}`)
        if (rows.length === 0) continue
        zip.addFile(`${categoria}/${table}.json`, Buffer.from(JSON.stringify(rows), 'utf-8'))
        totalTabelas++
        totalRegistros += rows.length
      } catch { /* table might not exist yet */ }
    }
  }

  return { zip, totalTabelas, totalRegistros }
}

export async function createSnapshot(
  trigger: SnapshotTrigger,
  userData: string,
  appVersion?: string,
  options?: { light?: boolean },
): Promise<SnapshotInfo | null> {
  if (snapshotInProgress) {
    log('Snapshot already in progress, skipping')
    return null
  }
  snapshotInProgress = true

  try {
    const dir = await getBackupDir(userData)
    fs.mkdirSync(dir, { recursive: true })

    const { zip, totalTabelas, totalRegistros } = await buildBackupZip(options)

    const now = new Date()
    const meta: SnapshotMeta = {
      app: 'escalaflow',
      versao: appVersion ?? '0.0.0',
      criado_em: now.toISOString(),
      trigger,
      tabelas: totalTabelas,
      registros: totalRegistros,
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
    log(`Created: ${filename} (${trigger}${options?.light ? ' light' : ''}, ${totalRegistros} records, ${(stat.size / 1024).toFixed(0)}KB)`)

    const config = await getBackupConfig()
    await cleanupSnapshots(config.max_snapshots, userData)

    return {
      filename,
      meta,
      tamanho_bytes: stat.size,
    }
  } catch (err) {
    log('Error creating snapshot:', err)
    throw err
  } finally {
    snapshotInProgress = false
  }
}

/** Exporta backup completo para destino escolhido pelo usuario (Save Dialog) */
export async function createExportZip(
  destino: string,
  appVersion?: string,
): Promise<{ filepath: string; tamanho_mb: number }> {
  const { zip, totalTabelas, totalRegistros } = await buildBackupZip()

  const meta: SnapshotMeta = {
    app: 'escalaflow',
    versao: appVersion ?? '0.0.0',
    criado_em: new Date().toISOString(),
    trigger: 'manual',
    tabelas: totalTabelas,
    registros: totalRegistros,
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
): Promise<{ tabelas: number; registros: number }> {
  // Safety net: create pre-restore snapshot
  await createSnapshot('auto_pre_restore', userData, appVersion)

  const dir = await getBackupDir(userData)
  const filepath = path.join(dir, filename)
  const { meta, dados } = parseBackupFile(filepath)

  if (meta?.app !== 'escalaflow') {
    throw new Error('Arquivo invalido: nao e um backup EscalaFlow')
  }

  const result = await importFromData(dados)
  log(`Restored: ${filename} (${result.tabelas} tables, ${result.registros} records)`)
  return result
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
