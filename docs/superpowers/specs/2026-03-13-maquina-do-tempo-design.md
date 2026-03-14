# Maquina do Tempo — Backup Automatico com Restauracao Pontual

## TL;DR

Sistema de snapshots automaticos que salva o estado completo do EscalaFlow em JSON, com restauracao pontual via modal "Maquina do Tempo". Separado do Export ZIP existente — snapshots sao internos e automaticos, export e manual e do usuario.

---

## Contexto

O EscalaFlow ja tem backup/restore manual via ZIP categorizado (`dadosExportar`/`dadosImportar`). Porem:

- Zero automacao — o RH precisa lembrar de exportar
- Sem historico — so existe o estado atual
- Sem safety net — se o RH fizer merda (deletar colaborador, oficializar escala errada), nao tem como voltar

A Maquina do Tempo resolve isso com snapshots automaticos que funcionam como "pontos de restauracao" — o RH pode voltar a qualquer momento dos ultimos 30 snapshots.

---

## Dois Mundos, Zero Sobreposicao

| | Snapshots (Maquina do Tempo) | Export (ja existe) |
|---|---|---|
| Pra quem | Pro sistema, invisivel | Pro usuario, consciente |
| Onde | Pasta configuravel (default: `userData/backups/`) | Onde o usuario escolher (file dialog) |
| Formato | `.json` (tudo, sem ZIP) | `.zip` categorizado |
| Trigger | Automatico (fechar app + intervalo) + manual + IA | Manual (botao) |
| Categorias | ALL-IN (foto completa) | Seletivo (3 toggles) |
| UI | Modal "Maquina do Tempo" | Card atual (sem mudanca) |
| Retencao | 30 ultimos, auto-cleanup | Sem retencao (arquivo do user) |
| Se deletar app | Morre se pasta for interna | ZIP sobrevive na pasta do user |

A pasta `userData` e:
- **Mac:** `~/Library/Application Support/EscalaFlow/backups/`
- **Win:** `%APPDATA%/EscalaFlow/backups/`

Se o RH apontar para Google Drive/OneDrive, os snapshots sincronizam automaticamente — backup offsite de graca.

---

## Formato do Snapshot

Um arquivo JSON por snapshot. Dados sao pequenos (~300-500KB por snapshot).

**Nome:** `snapshot-2026-03-13T20-30-00-123.json` (resolucao em milissegundos para evitar colisao)

**Estrutura:**

```json
{
  "_meta": {
    "app": "escalaflow",
    "versao": "1.5.6",
    "criado_em": "2026-03-13T20:30:00.000Z",
    "trigger": "auto_close",
    "tabelas": 27,
    "registros": 1245
  },
  "empresa": [{ "id": 1, "nome": "Supermercado Fernandes", ... }],
  "tipos_contrato": [...],
  "setores": [...],
  "colaboradores": [...],
  "escalas": [...],
  "alocacoes": [...],
  "ia_memorias": [...],
  "ia_conversas": [...],
  "ia_mensagens": [...],
  "knowledge_sources": [...],
  "knowledge_chunks": [...],
  "knowledge_entities": [...],
  "knowledge_relations": [...],
  ...todas as 27 tabelas...
}
```

**Triggers possiveis:**
- `auto_close` — ao fechar o app
- `auto_intervalo` — timer diario
- `manual` — botao "Backup Agora"
- `ia` — via tool `fazer_backup`
- `auto_pre_restore` — criado automaticamente antes de restaurar (safety net)

---

## Arquivos a Criar/Modificar

| # | Arquivo | Camada | Acao |
|---|---------|--------|------|
| 1 | `src/main/db/schema.ts` | Schema | Nova tabela `configuracao_backup` + migration v24 |
| 2 | `src/main/db/seed.ts` | Seed | Default config (ativo=true, fechar=true, 24h, 30 max) |
| 3 | `src/shared/types.ts` | Types | `ConfiguracaoBackup`, `SnapshotInfo`, `SnapshotMeta` |
| 4 | `src/main/backup.ts` | **NOVO** | Engine: create, list, restore, cleanup, config |
| 5 | `src/main/tipc.ts` | IPC | 7 handlers novos |
| 6 | `src/main/index.ts` | Main | Hook `before-quit` + timer |
| 7 | `src/renderer/src/paginas/ConfiguracoesPagina.tsx` | UI | Estender card backup |
| 8 | `src/renderer/src/componentes/TimeMachineModal.tsx` | **NOVO** | Modal com lista + restaurar |
| 9 | `src/main/ia/tools.ts` | IA | Nova tool `fazer_backup` |
| 10 | `src/main/ia/system-prompt.ts` | IA | Mencionar capacidade |
| 11 | `src/main/ia/discovery.ts` | IA | Alerta se backup > 7 dias |

**O que NAO muda:**
- `dadosExportar` / `dadosImportar` — intactos
- UI de export/import — intacta
- Formato ZIP — continua sendo o formato de export do usuario

---

## Schema

### Nova tabela `configuracao_backup`

```sql
CREATE TABLE IF NOT EXISTS configuracao_backup (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  pasta TEXT,
  ativo BOOLEAN NOT NULL DEFAULT TRUE,
  backup_ao_fechar BOOLEAN NOT NULL DEFAULT TRUE,
  intervalo_horas INTEGER NOT NULL DEFAULT 24,
  max_snapshots INTEGER NOT NULL DEFAULT 30,
  ultimo_backup TIMESTAMPTZ,
  atualizado_em TIMESTAMPTZ DEFAULT NOW()
)
```

Singleton (CHECK id = 1), mesmo padrao de `empresa`.

- `pasta`: `null` = default (`userData/backups/`). Se preenchido, usa o path informado.
- `intervalo_horas`: 0 = desligado (so ao fechar). Default 24.
- `max_snapshots`: quantos manter. Default 30.

### Migration v24

Tres pontos de integracao em `schema.ts` (padrao existente):

1. **Constante DDL** — `const DDL_CONFIGURACAO_BACKUP = \`...\`` com o CREATE TABLE acima
2. **`createTables()`** — adicionar `await execDDL(DDL_CONFIGURACAO_BACKUP)` apos as tabelas existentes
3. **`migrateSchema()`** — bloco inline v24:

```sql
-- v24: configuracao_backup
CREATE TABLE IF NOT EXISTS configuracao_backup (...)
INSERT INTO configuracao_backup (id) VALUES (1) ON CONFLICT DO NOTHING
```

---

## Types (src/shared/types.ts)

```typescript
export interface ConfiguracaoBackup {
  pasta: string | null
  ativo: boolean
  backup_ao_fechar: boolean
  intervalo_horas: number
  max_snapshots: number
  ultimo_backup: string | null
}

export type SnapshotTrigger = 'auto_close' | 'auto_intervalo' | 'manual' | 'ia'

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

---

## Engine (src/main/backup.ts)

Arquivo novo, ~250 linhas. Funcoes puras sem dependencia de Electron — `userData` e passado como parametro pelos callers (tipc/index.ts).

### Concorrencia

Flag `let snapshotInProgress = false` — se `createSnapshot` e chamado enquanto outro esta rodando, retorna `null` silenciosamente. Impede race conditions entre timer, before-quit e IPC manual.

### `getDefaultBackupDir(userData: string): string`

```typescript
import path from 'node:path'

export function getDefaultBackupDir(userData: string): string {
  return path.join(userData, 'backups')
}
```

O caller (tipc handler ou index.ts) chama `app.getPath('userData')` e passa o resultado. Isso mantem `backup.ts` testavel sem mock de Electron.

### `getBackupDir(userData: string): Promise<string>`

Le config do DB, retorna `config.pasta ?? getDefaultBackupDir(userData)`.

### `createSnapshot(trigger: SnapshotTrigger, userData: string): Promise<SnapshotInfo | null>`

1. Checka `snapshotInProgress` — se true, retorna null (skip)
2. Seta `snapshotInProgress = true` (+ finally para resetar)
3. Le tabelas usando mesma lista de `BACKUP_CATEGORIAS` (cadastros + conhecimento + conversas)
   - **EXCLUI `regra_definicao`** — tabela de sistema, seedada no startup, protegida
   - Inclui `regra_empresa` (overrides do usuario)
4. Monta objeto JSON com `_meta` + dados
5. Garante que pasta existe (`mkdirSync recursive`)
6. Escreve arquivo com nome `snapshot-{ISO timestamp com ms}.json`
7. Atualiza `ultimo_backup` na tabela `configuracao_backup`
8. Chama `cleanupSnapshots()` apos salvar
9. Retorna `SnapshotInfo`

### `listSnapshots(userData: string): Promise<SnapshotInfo[]>`

1. Le pasta de backups
2. Filtra arquivos `snapshot-*.json`
3. Le `_meta` de cada um (pode ler so o header sem parsear tudo — ou parsear tudo, sao 300KB)
4. Retorna lista ordenada por data (mais recente primeiro)
5. Inclui `tamanho_bytes` via `fs.statSync`

### `restoreSnapshot(filename: string, userData: string): Promise<{ tabelas: number; registros: number }>`

1. **Antes de restaurar: cria snapshot `auto_pre_restore`** — safety net
2. Le o arquivo JSON
3. Valida `_meta.app === 'escalaflow'`
4. Importa usando mesma logica do `dadosImportar`:
   - **So deleta tabelas PRESENTES no snapshot** — `regra_definicao` e outras tabelas de sistema ficam intactas
   - DELETE em ordem reversa de FK
   - INSERT em ordem FK (`IMPORT_ORDER`)
   - `ON CONFLICT DO NOTHING`
5. Retorna contagem

**NOTA:** O `SET session_replication_role = 'replica'` que `dadosImportar` usa e ignorado pelo PGlite (GUC nao suportado em Postgres WASM). A seguranca real vem da `IMPORT_ORDER` (delete reverso + insert ordenado). O restore usa o mesmo pattern por consistencia.

### `cleanupSnapshots(max: number, userData: string): Promise<void>`

1. Lista snapshots ordenados por data
2. Separa `auto_pre_restore` (protegidos, max 5 — deleta os mais velhos acima de 5)
3. Para os demais: se count > max, deleta os mais velhos

### `deleteSnapshot(filename: string, userData: string): Promise<void>`

Deleta um snapshot especifico por filename. Usado pelo modal.

---

## IPC Handlers (src/main/tipc.ts)

7 novos handlers:

### `backup.config.obter`
- Input: nenhum
- Output: `ConfiguracaoBackup`
- Query `SELECT * FROM configuracao_backup WHERE id = 1`
- Se `pasta` null, resolve pra `getDefaultBackupDir()` no retorno

### `backup.config.salvar`
- Input: `Partial<ConfiguracaoBackup>`
- Output: `ConfiguracaoBackup`
- UPDATE no singleton

### `backup.snapshots.listar`
- Input: nenhum
- Output: `SnapshotInfo[]`
- Chama `listSnapshots()`

### `backup.snapshots.criar`
- Input: `{ trigger?: SnapshotTrigger }` (default `'manual'`)
- Output: `SnapshotInfo`
- Chama `createSnapshot(trigger)`

### `backup.snapshots.restaurar`
- Input: `{ filename: string }`
- Output: `{ tabelas: number; registros: number }`
- Chama `restoreSnapshot(filename)`

### `backup.snapshots.deletar`
- Input: `{ filename: string }`
- Output: `{ ok: boolean }`
- Chama `deleteSnapshot(filename)`

### `backup.pasta.escolher`
- Input: nenhum
- Output: `string | null`
- `dialog.showOpenDialog({ properties: ['openDirectory'] })`
- Retorna o path selecionado ou null se cancelou

---

## Main Process (src/main/index.ts)

### Hook before-quit

**Ordem critica:** snapshot ANTES de closeDb. O DB deve estar aberto durante todo o snapshot. `clearInterval` do timer como primeira acao para evitar race.

```typescript
let isQuitting = false
let backupTimer: ReturnType<typeof setInterval> | null = null

app.on('before-quit', async (e) => {
  if (isQuitting) return
  e.preventDefault()
  isQuitting = true

  // 1. Parar timer para evitar race condition
  if (backupTimer) clearInterval(backupTimer)

  // 2. Snapshot (DB ainda aberto)
  try {
    const { getBackupConfig, createSnapshot } = await import('./backup')
    const config = await getBackupConfig()
    if (config.ativo && config.backup_ao_fechar) {
      const userData = app.getPath('userData')
      await createSnapshot('auto_close', userData)
    }
  } catch (err) {
    console.error('[BACKUP] Falha no auto-backup ao fechar:', err)
  }

  // 3. Cleanup (DEPOIS do snapshot)
  void import('./ia/local-llm').then(m => m.unloadModel()).catch(() => {})
  void closeDb().catch(() => {})
  app.quit()
})
```

### Timer de intervalo

Apos `app.whenReady()`, inicia timer que checka a cada 1h. Referencia salva em `backupTimer` para cleanup no quit.

```typescript
backupTimer = setInterval(async () => {
  try {
    const { getBackupConfig, createSnapshot } = await import('./backup')
    const config = await getBackupConfig()
    if (!config.ativo || config.intervalo_horas === 0) return

    const last = config.ultimo_backup ? new Date(config.ultimo_backup) : null
    const hoursAgo = last ? (Date.now() - last.getTime()) / 3600000 : Infinity

    if (hoursAgo >= config.intervalo_horas) {
      const userData = app.getPath('userData')
      await createSnapshot('auto_intervalo', userData)
    }
  } catch (err) {
    console.error('[BACKUP] Falha no auto-backup intervalo:', err)
  }
}, 3600000)
```

---

## UI

### ConfiguracoesPagina — Card estendido

Abaixo do card existente de "Backup e Restauracao", adicionar secao "Backup Automatico":

```
Backup Automatico
  [ON/OFF] Backup automatico
  [ON/OFF] Ao fechar o sistema
  [dropdown] A cada: 24 horas / 12 horas / 6 horas / Desligado
  Manter ultimos: [input number] snapshots
  Pasta: ~/Library/.../backups/  [Alterar]
  Ultimo backup: hoje as 20:30
  [Backup Agora]  [Maquina do Tempo]
```

### TimeMachineModal (NOVO)

Modal (Dialog do shadcn/ui) com:

**Header:** "Maquina do Tempo" + icone History

**Lista de snapshots:**
- Cada item: data/hora formatada, tipo de trigger (icone), tamanho
- Triggers mostrados como:
  - `auto_close` → "ao fechar"
  - `auto_intervalo` → "automatico"
  - `manual` → "manual"
  - `ia` → "via IA"
  - `auto_pre_restore` → "pre-restauracao"
- Selecionavel (highlight ao clicar)

**Acoes:**
- Botao "Restaurar este ponto" (aparece ao selecionar)
- Botao "Deletar" (icone lixeira, por snapshot)
- Confirmacao com AlertDialog: "Restaurar substitui TODOS os dados atuais. O sistema criara um backup do estado atual antes de restaurar. Deseja continuar?"
- Apos restaurar: toast de sucesso + prompt de restart

**Empty state:** "Nenhum snapshot encontrado. O primeiro backup sera criado ao fechar o sistema."

---

## IA Integration

### Nova tool: `fazer_backup`

**Handler:**

```typescript
{
  name: 'fazer_backup',
  description: 'Cria um snapshot (backup) do estado atual do sistema',
  parameters: z.object({}),
  handler: async () => {
    const { createSnapshot } = await import('./backup')
    const { app } = await import('electron')
    const info = await createSnapshot('ia', app.getPath('userData'))
    if (!info) return toolError('Backup ja em andamento, tente novamente em alguns segundos')
    return toolOk({
      mensagem: `Backup criado com sucesso`,
      criado_em: info.meta.criado_em,
      tamanho_kb: Math.round(info.tamanho_bytes / 1024),
      total_registros: info.meta.registros,
    })
  }
}
```

**Integracao obrigatoria em `tools.ts`:**

1. Adicionar entry em `IA_TOOLS` (formato Gemini):
   ```typescript
   { name: 'fazer_backup', description: 'Cria um snapshot (backup) do estado atual do sistema', parameters: { type: 'object', properties: {} } }
   ```

2. Adicionar entry em `TOOL_SCHEMAS`:
   ```typescript
   TOOL_SCHEMAS['fazer_backup'] = z.object({})
   ```

3. Total de tools passa de 34 para 35. Atualizar comentario `// 35 tools` e checklist.

### System prompt (system-prompt.ts)

Adicionar na secao de capacidades:

```
- Voce pode criar backups do sistema a pedido do RH (tool fazer_backup).
  O sistema tambem faz backups automaticos ao fechar e diariamente.
```

### Discovery (discovery.ts)

Se `ultimo_backup` for null ou > 7 dias atras, injetar alerta:

```
ALERTA: O sistema nao tem backup ha X dias. Sugira ao RH fazer um backup.
```

---

## Safety

### Pre-restore snapshot

Antes de QUALQUER restauracao, o sistema cria automaticamente um snapshot com trigger `auto_pre_restore`. Isso garante que o RH nunca perde o estado atual mesmo se restaurar por engano.

Snapshots `auto_pre_restore` tem limite separado: **max 5**. O cleanup deleta os mais velhos acima de 5. Isso evita acumulo infinito se o RH restaurar muitas vezes. O RH tambem pode deletar manualmente via modal.

### Validacao

- Arquivo deve ter `_meta.app === 'escalaflow'`
- Arquivo deve ser JSON valido
- Se pasta configurada nao existir, cria automaticamente
- Se pasta configurada nao for acessivel (permissao, disco cheio), loga erro e nao crasha

---

## Retencao

- Default: 30 snapshots
- Configuravel pelo RH
- Auto-cleanup apos cada novo snapshot
- Snapshots `auto_pre_restore` tem limite separado de 5 (deleta mais velhos acima de 5)
- 30 snapshots normais + 5 pre-restore = 35 max x 500KB = ~17MB maximo — negligivel

---

## O que NAO faz parte deste scope

- Encriptacao de snapshots
- Diff/delta entre snapshots (volume nao justifica)
- Sync cloud nativo (o RH aponta a pasta pro Google Drive)
- Versionamento de schema no snapshot (se schema mudar entre versoes, o import pode falhar — trataremos quando acontecer)
- Compressao (JSON cru, dados pequenos)
