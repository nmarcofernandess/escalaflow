# Maquina do Tempo — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatic snapshots with point-in-time restore via "Maquina do Tempo" modal.

**Architecture:** New `backup.ts` engine (pure Node.js, no Electron dependency) handles create/list/restore/cleanup of JSON snapshots. IPC handlers in `tipc.ts` bridge to renderer. Auto-backup on app close via `before-quit` hook + hourly interval timer. UI extends ConfiguracoesPagina with auto-backup config card + TimeMachineModal. IA gets `fazer_backup` tool + discovery alert.

**Tech Stack:** PGlite (queryAll/execute), Node.js fs, Electron app lifecycle, React 19, shadcn/ui (Dialog, Switch, Select, Button, ScrollArea, AlertDialog), @egoist/tipc, Zod, Vercel AI SDK tools.

**Spec:** `docs/superpowers/specs/2026-03-13-maquina-do-tempo-design.md`

**Verification:** `npm run typecheck` after each task. Manual test via `npm run dev` after UI tasks.

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/shared/types.ts` | Modify | Add `ConfiguracaoBackup`, `SnapshotTrigger`, `SnapshotMeta`, `SnapshotInfo` |
| `src/main/db/schema.ts` | Modify | DDL constant + createTables() + migrateSchema() v24 |
| `src/main/db/seed.ts` | Modify | Seed default row in `configuracao_backup` |
| `src/main/backup.ts` | **Create** | Snapshot engine: create, list, restore, cleanup, delete, config |
| `src/main/tipc.ts` | Modify | 7 new IPC handlers + SNAPSHOT_TABLES constant |
| `src/main/index.ts` | Modify | `before-quit` hook + interval timer |
| `src/renderer/src/componentes/TimeMachineModal.tsx` | **Create** | Modal: snapshot list + restore + delete |
| `src/renderer/src/paginas/ConfiguracoesPagina.tsx` | Modify | Auto-backup config card + modal trigger |
| `src/main/ia/tools.ts` | Modify | `fazer_backup` tool + IA_TOOLS + TOOL_SCHEMAS |
| `src/main/ia/system-prompt.ts` | Modify | Mention backup capability |
| `src/main/ia/discovery.ts` | Modify | Alert if no backup > 7 days |

---

## Chunk 1: Foundation (Schema + Types + Engine)

### Task 1: Types

**Files:**
- Modify: `src/shared/types.ts` (append after line ~972, after `IaCapabilities`)

- [ ] **Step 1: Add backup types to shared/types.ts**

Add after the `IaCapabilities` interface:

```typescript
// ─── Backup / Maquina do Tempo ────────────────────────────────

export interface ConfiguracaoBackup {
  pasta: string | null
  ativo: boolean
  backup_ao_fechar: boolean
  intervalo_horas: number
  max_snapshots: number
  ultimo_backup: string | null
}

export type SnapshotTrigger = 'auto_close' | 'auto_intervalo' | 'manual' | 'ia' | 'auto_pre_restore'

export interface SnapshotMeta {
  app: string
  versao: string
  criado_em: string
  trigger: SnapshotTrigger
  tabelas: number
  registros: number
}

export interface SnapshotInfo {
  filename: string
  meta: SnapshotMeta
  tamanho_bytes: number
}
```

- [ ] **Step 2: Verify**

Run: `npm run typecheck`
Expected: PASS (types are just declarations, no consumers yet)

- [ ] **Step 3: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat(backup): add ConfiguracaoBackup, SnapshotInfo types"
```

---

### Task 2: Schema + Seed

**Files:**
- Modify: `src/main/db/schema.ts` (DDL constant + createTables + migrateSchema)
- Modify: `src/main/db/seed.ts` (seed default config row)

- [ ] **Step 1: Add DDL constant in schema.ts**

Add after the last DDL constant (before `async function migrateSchema()`):

```typescript
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
```

- [ ] **Step 2: Add execDDL call in createTables()**

In `createTables()`, add before `await migrateSchema()`:

```typescript
await execDDL(DDL_CONFIGURACAO_BACKUP)
```

- [ ] **Step 3: Add migration v24 in migrateSchema()**

Add at the end of `migrateSchema()`, after the v23 block:

```typescript
// --- v24: configuracao_backup (Maquina do Tempo) ---
await execute(`INSERT INTO configuracao_backup (id) VALUES (1) ON CONFLICT DO NOTHING`)
```

- [ ] **Step 4: Update createTables log message**

Change the console.log in `createTables()` to include v24:

```typescript
console.log('[DB] Tabelas criadas com sucesso (v24 + backup automatico)')
```

- [ ] **Step 5: Add seed in seed.ts**

In `seedCoreData()`, after the last seed block (feriados or regras), add:

```typescript
// Configuracao backup (Maquina do Tempo) — default row
const backupConfig = await queryOne<{ id: number }>('SELECT id FROM configuracao_backup WHERE id = 1')
if (!backupConfig) {
  await execute('INSERT INTO configuracao_backup (id) VALUES (1) ON CONFLICT DO NOTHING')
  console.log('[SEED] Configuracao backup criada (auto-backup ativo)')
}
```

- [ ] **Step 6: Verify**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/main/db/schema.ts src/main/db/seed.ts
git commit -m "feat(backup): add configuracao_backup table + migration v24 + seed"
```

---

### Task 3: Backup Engine

**Files:**
- Create: `src/main/backup.ts`

- [ ] **Step 1: Create the backup engine**

Create `src/main/backup.ts` with the full implementation. This file has NO Electron imports — `userData` is passed by callers.

```typescript
import fs from 'node:fs'
import path from 'node:path'
import { queryAll, queryOne, execute } from './db/query'
import type { ConfiguracaoBackup, SnapshotTrigger, SnapshotMeta, SnapshotInfo } from '../shared/types'

// ─── Constants ────────────────────────────────────────────────

// All tables to snapshot — same as BACKUP_CATEGORIAS but flat, ALL-IN.
// EXCLUDES regra_definicao (system table, seeded at startup, protected).
const SNAPSHOT_TABLES = [
  'empresa', 'tipos_contrato', 'setores', 'demandas', 'colaboradores',
  'excecoes', 'escalas', 'alocacoes', 'funcoes', 'feriados',
  'setor_horario_semana', 'empresa_horario_semana', 'contrato_perfis_horario',
  'colaborador_regra_horario', 'colaborador_regra_horario_excecao_data',
  'demandas_excecao_data', 'escala_ciclo_modelos', 'escala_ciclo_itens',
  'escala_decisoes', 'escala_comparacao_demanda', 'configuracao_ia', 'regra_empresa',
  'ia_memorias', 'knowledge_sources', 'knowledge_chunks',
  'knowledge_entities', 'knowledge_relations',
  'ia_conversas', 'ia_mensagens',
  'configuracao_backup',
] as const

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
  const row = await queryOne<ConfiguracaoBackup & { id: number }>(
    'SELECT * FROM configuracao_backup WHERE id = 1'
  )
  return {
    pasta: row?.pasta ?? null,
    ativo: row?.ativo ?? true,
    backup_ao_fechar: row?.backup_ao_fechar ?? true,
    intervalo_horas: row?.intervalo_horas ?? 24,
    max_snapshots: row?.max_snapshots ?? 30,
    ultimo_backup: row?.ultimo_backup ?? null,
  }
}

export async function getBackupDir(userData: string): Promise<string> {
  const config = await getBackupConfig()
  return config.pasta ?? getDefaultBackupDir(userData)
}

// ─── Core functions ──────────────────────────────────────────

export async function createSnapshot(
  trigger: SnapshotTrigger,
  userData: string,
  appVersion?: string,
): Promise<SnapshotInfo | null> {
  if (snapshotInProgress) {
    log('Snapshot already in progress, skipping')
    return null
  }
  snapshotInProgress = true

  try {
    const dir = await getBackupDir(userData)
    fs.mkdirSync(dir, { recursive: true })

    // Query all tables
    const data: Record<string, unknown[]> = {}
    let totalRegistros = 0
    for (const table of SNAPSHOT_TABLES) {
      try {
        const rows = await queryAll<Record<string, unknown>>(`SELECT * FROM ${table}`)
        data[table] = rows
        totalRegistros += rows.length
      } catch {
        // Table might not exist yet (e.g., new tables not yet migrated)
      }
    }

    // Build snapshot
    const now = new Date()
    const meta: SnapshotMeta = {
      app: 'escalaflow',
      versao: appVersion ?? '0.0.0',
      criado_em: now.toISOString(),
      trigger,
      tabelas: Object.keys(data).length,
      registros: totalRegistros,
    }

    const snapshot = { _meta: meta, ...data }
    const json = JSON.stringify(snapshot)

    // Filename with millisecond resolution
    const ts = now.toISOString().replace(/[:.]/g, '-').replace('Z', '')
    const filename = `snapshot-${ts}.json`
    const filepath = path.join(dir, filename)

    fs.writeFileSync(filepath, json, 'utf-8')

    // Update ultimo_backup
    await execute(
      `UPDATE configuracao_backup SET ultimo_backup = $1, atualizado_em = NOW() WHERE id = 1`,
      now.toISOString(),
    )

    log(`Created: ${filename} (${trigger}, ${totalRegistros} records, ${(json.length / 1024).toFixed(0)}KB)`)

    // Cleanup old snapshots
    const config = await getBackupConfig()
    await cleanupSnapshots(config.max_snapshots, userData)

    const info: SnapshotInfo = {
      filename,
      meta,
      tamanho_bytes: Buffer.byteLength(json, 'utf-8'),
    }
    return info
  } catch (err) {
    log('Error creating snapshot:', err)
    throw err
  } finally {
    snapshotInProgress = false
  }
}

export async function listSnapshots(userData: string): Promise<SnapshotInfo[]> {
  const dir = await getBackupDir(userData)

  if (!fs.existsSync(dir)) return []

  const files = fs.readdirSync(dir).filter((f) => f.startsWith('snapshot-') && f.endsWith('.json'))
  const snapshots: SnapshotInfo[] = []

  for (const filename of files) {
    try {
      const filepath = path.join(dir, filename)
      const stat = fs.statSync(filepath)
      const content = fs.readFileSync(filepath, 'utf-8')
      const parsed = JSON.parse(content) as { _meta?: SnapshotMeta }

      if (parsed._meta?.app === 'escalaflow') {
        snapshots.push({
          filename,
          meta: parsed._meta,
          tamanho_bytes: stat.size,
        })
      }
    } catch {
      // Skip corrupted files
    }
  }

  // Sort by date descending (most recent first)
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
  const content = fs.readFileSync(filepath, 'utf-8')
  const snapshot = JSON.parse(content) as { _meta: SnapshotMeta; [table: string]: unknown }

  if (snapshot._meta?.app !== 'escalaflow') {
    throw new Error('Arquivo invalido: nao e um snapshot EscalaFlow')
  }

  const backupTables = new Set(Object.keys(snapshot).filter((k) => k !== '_meta'))
  let totalTabelas = 0
  let totalRegistros = 0

  // Delete in reverse FK order (children before parents)
  for (let i = IMPORT_ORDER.length - 1; i >= 0; i--) {
    const table = IMPORT_ORDER[i]
    if (!backupTables.has(table)) continue
    try {
      await execute(`DELETE FROM ${table}`)
    } catch {
      // Table might not exist
    }
  }

  // Insert in FK order (parents before children)
  for (const table of IMPORT_ORDER) {
    const rows = snapshot[table]
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

  log(`Restored: ${filename} (${totalTabelas} tables, ${totalRegistros} records)`)
  return { tabelas: totalTabelas, registros: totalRegistros }
}

export async function cleanupSnapshots(max: number, userData: string): Promise<void> {
  const all = await listSnapshots(userData)
  const dir = await getBackupDir(userData)

  // Separate pre-restore snapshots (capped at MAX_PRE_RESTORE)
  const preRestore = all.filter((s) => s.meta.trigger === 'auto_pre_restore')
  const regular = all.filter((s) => s.meta.trigger !== 'auto_pre_restore')

  // Cleanup excess pre-restore (keep latest MAX_PRE_RESTORE)
  if (preRestore.length > MAX_PRE_RESTORE) {
    const excess = preRestore.slice(MAX_PRE_RESTORE)
    for (const snap of excess) {
      try {
        fs.unlinkSync(path.join(dir, snap.filename))
        log(`Cleanup pre-restore: ${snap.filename}`)
      } catch { /* ignore */ }
    }
  }

  // Cleanup excess regular (keep latest max)
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
```

- [ ] **Step 2: Verify**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/main/backup.ts
git commit -m "feat(backup): create snapshot engine — create, list, restore, cleanup, delete"
```

---

## Chunk 2: IPC + Main Process Integration

### Task 4: IPC Handlers

**Files:**
- Modify: `src/main/tipc.ts` (add 7 handlers + register in router)

- [ ] **Step 1: Add 7 backup handlers**

Add before the `dadosExportar` handler (or after it — near the backup section). Import at top of file:

```typescript
import type { SnapshotTrigger } from '../shared/types'
```

Define the handlers:

```typescript
// ─── Backup automatico (Maquina do Tempo) ────────────────────

const backupConfigObter = t.procedure.action(async () => {
  const { getBackupConfig, getDefaultBackupDir } = await import('./backup')
  const config = await getBackupConfig()
  // Resolve pasta to actual path for UI display
  if (!config.pasta) {
    config.pasta = getDefaultBackupDir(electron.app.getPath('userData'))
  }
  return config
})

const backupConfigSalvar = t.procedure
  .input<{ pasta?: string | null; ativo?: boolean; backup_ao_fechar?: boolean; intervalo_horas?: number; max_snapshots?: number }>()
  .action(async ({ input }) => {
    const sets: string[] = []
    const vals: unknown[] = []
    let idx = 1

    if (input.pasta !== undefined) { sets.push(`pasta = $${idx++}`); vals.push(input.pasta) }
    if (input.ativo !== undefined) { sets.push(`ativo = $${idx++}`); vals.push(input.ativo) }
    if (input.backup_ao_fechar !== undefined) { sets.push(`backup_ao_fechar = $${idx++}`); vals.push(input.backup_ao_fechar) }
    if (input.intervalo_horas !== undefined) { sets.push(`intervalo_horas = $${idx++}`); vals.push(input.intervalo_horas) }
    if (input.max_snapshots !== undefined) { sets.push(`max_snapshots = $${idx++}`); vals.push(input.max_snapshots) }

    if (sets.length > 0) {
      sets.push(`atualizado_em = NOW()`)
      await execute(`UPDATE configuracao_backup SET ${sets.join(', ')} WHERE id = 1`, ...vals)
    }

    const { getBackupConfig, getDefaultBackupDir } = await import('./backup')
    const config = await getBackupConfig()
    if (!config.pasta) config.pasta = getDefaultBackupDir(electron.app.getPath('userData'))
    return config
  })

const backupSnapshotsListar = t.procedure.action(async () => {
  const { listSnapshots } = await import('./backup')
  return listSnapshots(electron.app.getPath('userData'))
})

const backupSnapshotsCriar = t.procedure
  .input<{ trigger?: string }>()
  .action(async ({ input }) => {
    const { createSnapshot } = await import('./backup')
    const trigger = (input?.trigger ?? 'manual') as SnapshotTrigger
    const info = await createSnapshot(trigger, electron.app.getPath('userData'), electron.app.getVersion())
    return info
  })

const backupSnapshotsRestaurar = t.procedure
  .input<{ filename: string }>()
  .action(async ({ input }) => {
    const { restoreSnapshot } = await import('./backup')
    return restoreSnapshot(input.filename, electron.app.getPath('userData'), electron.app.getVersion())
  })

const backupSnapshotsDeletar = t.procedure
  .input<{ filename: string }>()
  .action(async ({ input }) => {
    const { deleteSnapshot } = await import('./backup')
    await deleteSnapshot(input.filename, electron.app.getPath('userData'))
    return { ok: true }
  })

const backupPastaEscolher = t.procedure.action(async () => {
  const result = await electron.dialog.showOpenDialog({
    properties: ['openDirectory', 'createDirectory'],
    title: 'Escolher pasta para backups automaticos',
  })
  if (result.canceled || !result.filePaths[0]) return null
  return result.filePaths[0]
})
```

- [ ] **Step 2: Register handlers in router**

Add to the `router` object (near the `dados.exportar` / `dados.importar` entries):

```typescript
'backup.config.obter': backupConfigObter,
'backup.config.salvar': backupConfigSalvar,
'backup.snapshots.listar': backupSnapshotsListar,
'backup.snapshots.criar': backupSnapshotsCriar,
'backup.snapshots.restaurar': backupSnapshotsRestaurar,
'backup.snapshots.deletar': backupSnapshotsDeletar,
'backup.pasta.escolher': backupPastaEscolher,
```

- [ ] **Step 3: Verify**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/main/tipc.ts
git commit -m "feat(backup): add 7 IPC handlers for backup config, snapshots, restore"
```

---

### Task 5: Main Process — Auto-backup hooks

**Files:**
- Modify: `src/main/index.ts`

- [ ] **Step 1: Replace before-quit handler and add timer**

The existing `before-quit` handler (lines ~314-317) is:

```typescript
app.on('before-quit', () => {
  void import('./ia/local-llm').then(m => m.unloadModel()).catch(() => {})
  void closeDb().catch(() => {})
})
```

Replace with the async version. Also add `backupTimer` variable and timer setup.

Add at module level (after `let mainWindow`):

```typescript
let isQuitting = false
let backupTimer: ReturnType<typeof setInterval> | null = null
```

Replace the `before-quit` handler:

```typescript
app.on('before-quit', async (e) => {
  if (isQuitting) return
  e.preventDefault()
  isQuitting = true

  // 1. Stop timer to prevent race condition
  if (backupTimer) clearInterval(backupTimer)

  // 2. Auto-backup (DB still open)
  try {
    const { getBackupConfig, createSnapshot } = await import('./backup')
    const config = await getBackupConfig()
    if (config.ativo && config.backup_ao_fechar) {
      await createSnapshot('auto_close', electron.app.getPath('userData'), electron.app.getVersion())
    }
  } catch (err) {
    console.error('[BACKUP] Falha no auto-backup ao fechar:', err)
  }

  // 3. Cleanup (AFTER snapshot)
  void import('./ia/local-llm').then(m => m.unloadModel()).catch(() => {})
  void closeDb().catch(() => {})
  electron.app.quit()
})
```

Add after `setupAutoUpdater(ipcMain, app)` inside `app.whenReady()`:

```typescript
// Auto-backup timer — check every hour
backupTimer = setInterval(async () => {
  try {
    const { getBackupConfig, createSnapshot } = await import('./backup')
    const config = await getBackupConfig()
    if (!config.ativo || config.intervalo_horas === 0) return

    const last = config.ultimo_backup ? new Date(config.ultimo_backup) : null
    const hoursAgo = last ? (Date.now() - last.getTime()) / 3600000 : Infinity

    if (hoursAgo >= config.intervalo_horas) {
      await createSnapshot('auto_intervalo', app.getPath('userData'), app.getVersion())
    }
  } catch (err) {
    console.error('[BACKUP] Falha no auto-backup intervalo:', err)
  }
}, 3600000)
```

- [ ] **Step 2: Verify**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/main/index.ts
git commit -m "feat(backup): auto-backup on app close + hourly interval timer"
```

---

## Chunk 3: UI

### Task 6: TimeMachineModal

**Files:**
- Create: `src/renderer/src/componentes/TimeMachineModal.tsx`

- [ ] **Step 1: Create the modal component**

```tsx
import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../components/ui/alert-dialog'
import { Button } from '../components/ui/button'
import { ScrollArea } from '../components/ui/scroll-area'
import { History, RotateCcw, Trash2, Clock, Bot, Hand, Power } from 'lucide-react'
import { toast } from 'sonner'
import type { SnapshotInfo } from '../../../shared/types'

interface TimeMachineModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const TRIGGER_LABELS: Record<string, { label: string; icon: typeof Clock }> = {
  auto_close: { label: 'ao fechar', icon: Power },
  auto_intervalo: { label: 'automatico', icon: Clock },
  manual: { label: 'manual', icon: Hand },
  ia: { label: 'via IA', icon: Bot },
  auto_pre_restore: { label: 'pre-restauracao', icon: RotateCcw },
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const isToday = d.toDateString() === now.toDateString()
  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  const isYesterday = d.toDateString() === yesterday.toDateString()

  const time = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  if (isToday) return `Hoje, ${time}`
  if (isYesterday) return `Ontem, ${time}`
  return `${d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}, ${time}`
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  return `${(bytes / 1024).toFixed(0)}KB`
}

export function TimeMachineModal({ open, onOpenChange }: TimeMachineModalProps) {
  const [snapshots, setSnapshots] = useState<SnapshotInfo[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [confirmRestore, setConfirmRestore] = useState(false)
  const [restoring, setRestoring] = useState(false)

  async function loadSnapshots() {
    try {
      const list = await window.electron.ipcRenderer.invoke('backup.snapshots.listar') as SnapshotInfo[]
      setSnapshots(list)
    } catch (err) {
      console.error('Erro ao listar snapshots:', err)
    }
  }

  async function handleRestore() {
    if (!selected) return
    setRestoring(true)
    try {
      const result = await window.electron.ipcRenderer.invoke('backup.snapshots.restaurar', { filename: selected }) as { tabelas: number; registros: number }
      toast.success('Restaurado com sucesso!', {
        description: `${result.tabelas} tabelas, ${result.registros} registros. Reinicie o sistema para aplicar.`,
        duration: 10000,
      })
      setConfirmRestore(false)
      onOpenChange(false)
    } catch (err) {
      toast.error('Erro ao restaurar', { description: (err as Error).message })
    } finally {
      setRestoring(false)
    }
  }

  async function handleDelete(filename: string) {
    try {
      await window.electron.ipcRenderer.invoke('backup.snapshots.deletar', { filename })
      setSnapshots((prev) => prev.filter((s) => s.filename !== filename))
      if (selected === filename) setSelected(null)
      toast.success('Snapshot removido')
    } catch (err) {
      toast.error('Erro ao remover', { description: (err as Error).message })
    }
  }

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(v) => {
          onOpenChange(v)
          if (v) {
            setLoading(true)
            loadSnapshots().finally(() => setLoading(false))
            setSelected(null)
          }
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <History className="size-5" />
              Maquina do Tempo
            </DialogTitle>
            <DialogDescription>
              Selecione um ponto no tempo para restaurar o sistema.
            </DialogDescription>
          </DialogHeader>

          <ScrollArea className="h-[400px] pr-3">
            {loading ? (
              <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
                Carregando snapshots...
              </div>
            ) : snapshots.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
                <History className="size-8 opacity-30" />
                <p>Nenhum snapshot encontrado.</p>
                <p>O primeiro backup sera criado ao fechar o sistema.</p>
              </div>
            ) : (
              <div className="space-y-1">
                {snapshots.map((snap) => {
                  const trigger = TRIGGER_LABELS[snap.meta.trigger] ?? TRIGGER_LABELS.manual
                  const Icon = trigger.icon
                  const isSelected = selected === snap.filename

                  return (
                    <div
                      key={snap.filename}
                      role="button"
                      tabIndex={0}
                      className={`flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
                        isSelected
                          ? 'bg-primary/10 ring-1 ring-primary/30'
                          : 'hover:bg-muted/50'
                      }`}
                      onClick={() => setSelected(snap.filename)}
                      onKeyDown={(e) => { if (e.key === 'Enter') setSelected(snap.filename) }}
                    >
                      <Icon className="size-4 shrink-0 text-muted-foreground" />
                      <div className="flex-1 min-w-0">
                        <div className="font-medium">{formatDate(snap.meta.criado_em)}</div>
                        <div className="text-xs text-muted-foreground">
                          {trigger.label} &middot; {formatSize(snap.tamanho_bytes)} &middot; v{snap.meta.versao}
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7 shrink-0 text-muted-foreground hover:text-destructive"
                        onClick={(e) => {
                          e.stopPropagation()
                          handleDelete(snap.filename)
                        }}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  )
                })}
              </div>
            )}
          </ScrollArea>

          {selected && (
            <div className="flex justify-end pt-2 border-t">
              <Button onClick={() => setConfirmRestore(true)}>
                <RotateCcw className="mr-1.5 size-3.5" />
                Restaurar este ponto
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmRestore} onOpenChange={setConfirmRestore}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restaurar sistema?</AlertDialogTitle>
            <AlertDialogDescription>
              Restaurar substitui TODOS os dados atuais. O sistema criara um backup automatico do estado atual antes de restaurar.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={restoring}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleRestore} disabled={restoring}>
              {restoring ? 'Restaurando...' : 'Confirmar restauracao'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
```

- [ ] **Step 2: Verify**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/componentes/TimeMachineModal.tsx
git commit -m "feat(backup): create TimeMachineModal — snapshot list, restore, delete"
```

---

### Task 7: ConfiguracoesPagina — Auto-backup card

**Files:**
- Modify: `src/renderer/src/paginas/ConfiguracoesPagina.tsx`

- [ ] **Step 1: Add imports and state**

Add to existing imports:

```typescript
import { TimeMachineModal } from '../componentes/TimeMachineModal'
import { History } from 'lucide-react'  // if not already imported
```

Add to imports from shadcn (if not already):

```typescript
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select'
```

Add state variables (near the existing backup state):

```typescript
const [backupConfig, setBackupConfig] = useState<{
  pasta: string | null; ativo: boolean; backup_ao_fechar: boolean;
  intervalo_horas: number; max_snapshots: number; ultimo_backup: string | null
} | null>(null)
const [timeMachineOpen, setTimeMachineOpen] = useState(false)
const [backupNowLoading, setBackupNowLoading] = useState(false)
```

Add useEffect to load config (near existing useEffect):

```typescript
useEffect(() => {
  window.electron.ipcRenderer.invoke('backup.config.obter').then((config: any) => {
    setBackupConfig(config)
  }).catch(console.error)
}, [])
```

Add handler functions:

```typescript
async function handleBackupConfigChange(field: string, value: unknown) {
  try {
    const updated = await window.electron.ipcRenderer.invoke('backup.config.salvar', { [field]: value }) as typeof backupConfig
    setBackupConfig(updated)
  } catch (err) {
    toast.error('Erro ao salvar configuracao', { description: (err as Error).message })
  }
}

async function handleBackupNow() {
  setBackupNowLoading(true)
  try {
    const result = await window.electron.ipcRenderer.invoke('backup.snapshots.criar', { trigger: 'manual' })
    if (result) {
      toast.success('Backup criado!', { description: `${result.meta.registros} registros salvos` })
      // Refresh config to update ultimo_backup
      const config = await window.electron.ipcRenderer.invoke('backup.config.obter') as typeof backupConfig
      setBackupConfig(config)
    } else {
      toast.info('Backup ja em andamento')
    }
  } catch (err) {
    toast.error('Erro ao criar backup', { description: (err as Error).message })
  } finally {
    setBackupNowLoading(false)
  }
}

async function handleChooseBackupFolder() {
  const folder = await window.electron.ipcRenderer.invoke('backup.pasta.escolher') as string | null
  if (folder) {
    await handleBackupConfigChange('pasta', folder)
  }
}
```

- [ ] **Step 2: Add auto-backup card to JSX**

Add a new Card AFTER the existing "Backup e Restauracao" card:

```tsx
{/* Backup Automatico (Maquina do Tempo) */}
<Card>
  <CardHeader>
    <CardTitle className="flex items-center gap-2 text-base">
      <History className="size-4" />
      Backup Automatico
    </CardTitle>
    <CardDescription>
      O sistema cria snapshots automaticamente. Use a Maquina do Tempo para restaurar qualquer ponto.
    </CardDescription>
  </CardHeader>
  <CardContent className="space-y-4">
    {backupConfig && (
      <>
        <div className="space-y-3">
          {/* Toggle: backup ativo */}
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium">Backup automatico</div>
              <div className="text-xs text-muted-foreground">Salva o estado do sistema periodicamente</div>
            </div>
            <Switch
              checked={backupConfig.ativo}
              onCheckedChange={(v) => handleBackupConfigChange('ativo', v)}
            />
          </div>

          {backupConfig.ativo && (
            <>
              {/* Toggle: ao fechar */}
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium">Ao fechar o sistema</div>
                  <div className="text-xs text-muted-foreground">Cria snapshot toda vez que fechar o app</div>
                </div>
                <Switch
                  checked={backupConfig.backup_ao_fechar}
                  onCheckedChange={(v) => handleBackupConfigChange('backup_ao_fechar', v)}
                />
              </div>

              {/* Intervalo */}
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium">Intervalo</div>
                  <div className="text-xs text-muted-foreground">Backup periodico enquanto o app esta aberto</div>
                </div>
                <Select
                  value={String(backupConfig.intervalo_horas)}
                  onValueChange={(v) => handleBackupConfigChange('intervalo_horas', Number(v))}
                >
                  <SelectTrigger className="w-[140px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="6">A cada 6h</SelectItem>
                    <SelectItem value="12">A cada 12h</SelectItem>
                    <SelectItem value="24">A cada 24h</SelectItem>
                    <SelectItem value="0">Desligado</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Pasta */}
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">Pasta</div>
                  <div className="truncate text-xs text-muted-foreground" title={backupConfig.pasta ?? ''}>
                    {backupConfig.pasta ?? 'Padrao do sistema'}
                  </div>
                </div>
                <Button variant="outline" size="sm" onClick={handleChooseBackupFolder}>
                  Alterar
                </Button>
              </div>

              {/* Ultimo backup */}
              {backupConfig.ultimo_backup && (
                <div className="text-xs text-muted-foreground">
                  Ultimo backup: {new Date(backupConfig.ultimo_backup).toLocaleString('pt-BR')}
                </div>
              )}
            </>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex gap-2 pt-2 border-t">
          <Button
            variant="outline"
            size="sm"
            onClick={handleBackupNow}
            disabled={backupNowLoading}
          >
            {backupNowLoading ? 'Salvando...' : 'Backup Agora'}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setTimeMachineOpen(true)}
          >
            <History className="mr-1.5 size-3.5" />
            Maquina do Tempo
          </Button>
        </div>
      </>
    )}
  </CardContent>
</Card>

<TimeMachineModal open={timeMachineOpen} onOpenChange={setTimeMachineOpen} />
```

- [ ] **Step 3: Verify**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 4: Visual test**

Run: `npm run dev`
Navigate to Configuracoes. Verify:
- Auto-backup card appears below existing backup card
- Toggles work (ativo, ao fechar)
- Dropdown for interval works
- "Backup Agora" creates a snapshot (check toast)
- "Maquina do Tempo" opens modal
- Modal shows empty state if no snapshots exist yet
- After creating a snapshot, modal shows it in the list

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/paginas/ConfiguracoesPagina.tsx src/renderer/src/componentes/TimeMachineModal.tsx
git commit -m "feat(backup): auto-backup config card + TimeMachineModal in ConfiguracoesPagina"
```

---

## Chunk 4: IA Integration + Final Verification

### Task 8: IA Tool — fazer_backup

**Files:**
- Modify: `src/main/ia/tools.ts`

- [ ] **Step 1: Add Zod schema**

Near the other schema definitions (after the last `z.object({...})`):

```typescript
const FazerBackupSchema = z.object({})
```

- [ ] **Step 2: Add handler**

In the `handleToolCall` function (or equivalent tool dispatch), add the `fazer_backup` case:

```typescript
case 'fazer_backup': {
  const { createSnapshot } = await import('../backup')
  const { app } = await import('electron')
  const info = await createSnapshot('ia', app.getPath('userData'), app.getVersion())
  if (!info) return toolError('BACKUP_IN_PROGRESS', 'Backup ja em andamento, tente novamente em alguns segundos')
  return toolOk({
    mensagem: 'Backup criado com sucesso',
    criado_em: info.meta.criado_em,
    tamanho_kb: Math.round(info.tamanho_bytes / 1024),
    total_registros: info.meta.registros,
  })
}
```

- [ ] **Step 3: Add to IA_TOOLS array**

```typescript
{
  name: 'fazer_backup',
  description: 'Cria um snapshot (backup) do estado atual do sistema. Use quando o RH pedir para fazer backup ou salvar o estado.',
  parameters: toJsonSchema(FazerBackupSchema),
},
```

- [ ] **Step 4: Add to TOOL_SCHEMAS**

```typescript
fazer_backup: FazerBackupSchema,
```

- [ ] **Step 5: Update tool count comment**

Find and update the comment that says `// 34 tools` (or similar) to `// 35 tools`.

- [ ] **Step 6: Verify**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/main/ia/tools.ts
git commit -m "feat(backup): add fazer_backup IA tool (35 tools total)"
```

---

### Task 9: System Prompt + Discovery

**Files:**
- Modify: `src/main/ia/system-prompt.ts`
- Modify: `src/main/ia/discovery.ts`

- [ ] **Step 1: Update system prompt**

Find the section that lists capabilities (tools section or general instructions). Add:

```typescript
`- Voce pode criar backups do sistema a pedido do RH (tool fazer_backup). O sistema tambem faz backups automaticos ao fechar e diariamente.`
```

- [ ] **Step 2: Add discovery alert**

In `discovery.ts`, in the function that builds context/alerts (e.g., `get_context` or `_alertasProativos`), add:

```typescript
// Alerta de backup desatualizado
try {
  const backupConfig = await queryOne<{ ultimo_backup: string | null }>('SELECT ultimo_backup FROM configuracao_backup WHERE id = 1')
  if (backupConfig) {
    const last = backupConfig.ultimo_backup ? new Date(backupConfig.ultimo_backup) : null
    const daysAgo = last ? Math.floor((Date.now() - last.getTime()) / 86400000) : null

    if (!last) {
      sections.push('\n### Alerta: Backup')
      sections.push('- O sistema NUNCA fez backup. Sugira ao RH fazer um backup (tool fazer_backup).')
    } else if (daysAgo !== null && daysAgo > 7) {
      sections.push('\n### Alerta: Backup')
      sections.push(`- O ultimo backup foi ha ${daysAgo} dias. Sugira ao RH fazer um backup.`)
    }
  }
} catch { /* table might not exist yet */ }
```

- [ ] **Step 3: Verify**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/main/ia/system-prompt.ts src/main/ia/discovery.ts
git commit -m "feat(backup): add backup mention to system prompt + discovery alert"
```

---

### Task 10: Final Verification

- [ ] **Step 1: Full typecheck**

Run: `npm run typecheck`
Expected: PASS (0 errors)

- [ ] **Step 2: Parity test (regression guard)**

Run: `npm run solver:test:parity`
Expected: 2/2 PASS (backup changes should not affect solver)

- [ ] **Step 3: Manual end-to-end test**

Run: `npm run dev`

Test checklist:
1. Navigate to Configuracoes
2. Verify auto-backup card shows with defaults (ativo=ON, fechar=ON, 24h)
3. Click "Backup Agora" — toast shows success
4. Click "Maquina do Tempo" — modal shows the snapshot just created
5. Close the app (Cmd+Q) — re-open — check modal for `auto_close` snapshot
6. Select a snapshot in modal — click "Restaurar" — confirm — verify toast
7. Change backup folder via "Alterar" button — verify next backup goes there
8. Toggle backup off — close app — verify NO new snapshot created

- [ ] **Step 4: Final commit (if any fixes needed)**

```bash
git add -A
git commit -m "fix(backup): adjustments from manual testing"
```
