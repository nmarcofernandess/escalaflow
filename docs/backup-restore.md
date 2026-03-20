# Backup e Restore — Guia Tecnico

Documentacao canonica do sistema de backup/restore do EscalaFlow.

---

## Arquitetura

```
src/main/backup.ts          <- fonte unica: create/list/restore/parse/import/repair
src/main/tipc.ts             <- 9 IPC handlers (backup.*, dados.*)
src/main/index.ts            <- auto-backup (close + intervalo)
src/shared/types.ts          <- BackupScope, SnapshotMeta, SnapshotTrigger
```

---

## Formato ZIP

```
escalaflow-backup-2026-03-19T14-30-00-000.zip
├── _meta.json                    <- versao, data, trigger, scope, contagem
├── cadastros/                    <- empresa, setores, colaboradores, escalas, regras...
│   ├── empresa.json
│   ├── colaboradores.json
│   └── ...
├── conhecimento/                 <- memorias IA, knowledge sources/chunks/entities/relations
│   ├── ia_memorias.json
│   └── ...
├── conversas/                    <- historico de chats IA
│   ├── ia_conversas.json
│   └── ia_mensagens.json
└── config/                       <- configuracao_backup
    └── configuracao_backup.json
```

### `_meta.json`

```json
{
  "app": "escalaflow",
  "versao": "1.7.1",
  "criado_em": "2026-03-19T14:30:00.000Z",
  "trigger": "auto_close",
  "tabelas": 18,
  "registros": 1234,
  "scope": "operational"
}
```

---

## Escopos de Backup

| Scope | Quando | O que inclui |
|-------|--------|--------------|
| `operational` | Auto-close, auto-intervalo, botao rapido Config, IA tool | Tudo EXCETO 8 tabelas IA/knowledge |
| `full` | Time Machine "Criar backup", Export manual | Todas as tabelas |

### Tabelas excluidas do `operational` (`FULL_ONLY_TABLES`)

- `configuracao_ia`
- `ia_conversas`, `ia_mensagens`, `ia_memorias`
- `knowledge_sources`, `knowledge_chunks`, `knowledge_entities`, `knowledge_relations`

### Retrocompatibilidade

Backups antigos sem campo `scope` no `_meta.json` sao tratados como `full`. Import aceita qualquer formato: ZIP novo, ZIP antigo, JSON flat (snapshot legado), JSON nested (export legado).

---

## Triggers de Backup

| Trigger | Scope | Automatico? | Onde |
|---------|-------|-------------|------|
| `auto_close` | operational | Sim (se `backup_ao_fechar=true`) | `index.ts` before-quit |
| `auto_intervalo` | operational | Sim (a cada `intervalo_horas`) | `index.ts` timer 1h |
| `manual` | full ou operational | Nao | UI (Time Machine = full, Config = operational) |
| `ia` | operational | Nao | IA tool `fazer_backup` |
| `auto_pre_restore` | full | Sim (antes de qualquer restore) | `restoreSnapshot()` |

---

## Mutex de DB (`withDbCriticalSection`)

Mutex de processo baseado em Promise chain. Garante que snapshot, save e restore nunca rodam ao mesmo tempo.

```
withDbCriticalSection(label, fn)
  <- buildBackupZip usa
  <- importFromData usa
  <- setores.salvarCompleto usa
```

Impede a race condition onde um snapshot le `setores` novo mas `demandas` velha.

**Nao** envolver `transaction()` diretamente — o CS e uma camada acima. Uma funcao que ja esta dentro do CS pode chamar `transaction()` normalmente.

---

## Fluxo de Backup (createSnapshot)

```
createSnapshot(trigger, userData, version, {scope})
  -> buildBackupZip({scope})              <- dentro do CS
       -> para cada tabela em BACKUP_CATEGORIAS
            se scope=operational e tabela in FULL_ONLY_TABLES: skip
            SELECT * FROM tabela -> zip.addFile
  -> gravar _meta.json com scope
  -> writeZip no disco
  -> UPDATE configuracao_backup.ultimo_backup
  -> cleanupSnapshots (respeita max_snapshots)
```

---

## Fluxo de Restore (restoreSnapshot)

```
restoreSnapshot(filename, userData, version)
  -> createSnapshot('auto_pre_restore', ..., {scope:'full'})  <- safety net
  -> parseBackupFile(filepath)                                  <- ZIP ou JSON legado
  -> importFromData(dados)                                      <- dentro do CS
       -> transaction:
            SET session_replication_role = 'replica'
            DELETE tabelas em ordem reversa de FK
            INSERT tabelas em ordem de FK
            SET session_replication_role = 'origin'
            -> repairRestoredOperationalState()                 <- 4 repairs
  -> broadcastInvalidation(['all'])                             <- notifica renderer
```

---

## Repair Pos-Restore (`repairRestoredOperationalState`)

Roda dentro da mesma transacao do import. Corrige inconsistencias que o import cru nao resolve.

### O4.1 — Reconstituir `demanda_padrao_*`

Quando `demanda_padrao_segmentos_json` esta vazio/null/invalido:
1. Procura primeiro dia com `usa_padrao=true` e com segmentos
2. Fallback: qualquer dia com segmentos
3. Reconstroi `demanda_padrao_hora_abertura`, `_fechamento`, `_segmentos_json`

Se o padrao ja e valido, **nao toca**.

### O4.2 — Limpar `funcao_id` orfao

```sql
UPDATE colaboradores SET funcao_id = NULL
WHERE funcao_id IS NOT NULL AND funcao_id NOT IN (SELECT id FROM funcoes)
```

### O4.3 — Reindexar `funcoes.ordem`

Para cada setor, reordena `funcoes.ordem` sequencialmente (0, 1, 2...) para evitar buracos.

### O4.4 — Criar `setor_horario_semana` ausente

Quando um setor tem `demandas` por dia mas ZERO linhas em `setor_horario_semana`:
1. Para cada dia com demandas
2. Compara segmentos do dia com o padrao do setor
3. Se iguais: `usa_padrao=true`, bounds do padrao
4. Se diferentes: `usa_padrao=false`, bounds do dia (min/max das faixas)
5. Cria a linha

Isso impede que o `buildInitialDraft` do `DemandaEditor` aplique `usa_padrao=true` default em dias que deveriam ser custom.

---

## Save Unificado do Setor (`setores.salvarCompleto`)

Endpoint que salva dados basicos do setor + timeline (padrao + 7 dias) em uma unica transacao, dentro do critical section.

```
setores.salvarCompleto({setor_id, setor, timeline})
  -> withDbCriticalSection
       -> transaction:
            UPDATE setores (nome, icone, hora_abertura, hora_fechamento, regime_escala)
            UPDATE setores (demanda_padrao_*)
            DELETE demandas legado (dia_semana IS NULL)
            para cada dia:
              UPSERT setor_horario_semana
              DELETE + INSERT demandas
  -> broadcastInvalidation
```

O antigo fluxo fragmentado (2 IPCs: `setores.atualizar` + `setores.salvarTimelineSemana`) foi substituido por este endpoint unico. O handler `setoresSalvarTimelineSemana` ainda existe para compatibilidade mas nao e mais usado pelo `handleSalvarTudo`.

---

## Hardening da UI (buildInitialDraft)

Quando o padrao persistido fica vazio apos clipping (bounds incompativeis pos-restore), o `DemandaEditor.buildInitialDraft` cai para:
1. Primeiro dia `usa_padrao=true` com segmentos
2. Primeiro dia com qualquer segmento
3. Segmento full-window default (ultimo fallback)

---

## Invalidacao Pos-Restore

Os 3 handlers de import/restore chamam `broadcastInvalidation(['all'])` apos conclusao:
- `dadosImportar` (import via file picker)
- `backupSnapshotsRestaurar` (restore normal)
- `backupSnapshotsRestaurarPreRestore` (restore pre-restore/visualizar)

O renderer recebe `data:invalidated` e recarrega stores automaticamente.

---

## Configuracao

Tabela `configuracao_backup` (singleton id=1):

| Campo | Default | Descricao |
|-------|---------|-----------|
| `pasta` | `{userData}/backups` | Diretorio dos ZIPs |
| `ativo` | `true` | Habilita auto-backup |
| `backup_ao_fechar` | `true` | Snapshot ao fechar app |
| `intervalo_horas` | `24` | Intervalo entre auto-backups (0 = desligado) |
| `max_snapshots` | `30` | Maximo de snapshots regulares (cleanup automatico) |
| `ultimo_backup` | null | Timestamp do ultimo backup |

Pre-restores tem limite separado: `MAX_PRE_RESTORE = 5`.

---

## Testes

`tests/main/backup-restore.spec.ts` — 6 cenarios:

| ID | Cenario |
|----|---------|
| T1 | Mutex serializa chamadas concorrentes |
| T2 | Repair reconstroi padrao vazio a partir de dia herdado |
| T3 | Padrao valido nao e tocado pelo repair |
| T4 | funcao_id orfao e limpado |
| T5 | BACKUP_CATEGORIAS contem tabelas IA/knowledge (filtradas em runtime) |
| T6 | O4.4 cria setor_horario_semana com usa_padrao correto |

---

## Arquivos Chave

| Arquivo | Papel |
|---------|-------|
| `src/main/backup.ts` | Fonte unica: BACKUP_CATEGORIAS, FULL_ONLY_TABLES, withDbCriticalSection, buildBackupZip, createSnapshot, importFromData, repairRestoredOperationalState, parseBackupFile |
| `src/main/tipc.ts` | 9 IPC handlers: dados.importar, dados.exportar, backup.config.*, backup.snapshots.*, setores.salvarCompleto |
| `src/main/index.ts` | Auto-backup: before-quit (auto_close) + timer (auto_intervalo) |
| `src/shared/types.ts` | BackupScope, SnapshotMeta, SnapshotTrigger, SnapshotInfo, ConfiguracaoBackup |
| `src/renderer/src/componentes/TimeMachineModal.tsx` | UI da Maquina do Tempo |
| `src/renderer/src/paginas/ConfiguracoesPagina.tsx` | UI de configuracao de backup |
| `src/renderer/src/componentes/DemandaEditor.tsx` | buildInitialDraft com hardening pos-restore |
| `tests/main/backup-restore.spec.ts` | Suite de regressao T1-T6 |
| `specs/WARLOG_BACKUP_RESTORE_DEMANDA_OPERACIONAL.md` | Warlog original com diagnostico e backlog |
