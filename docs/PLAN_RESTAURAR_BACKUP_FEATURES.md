# Plano: Restaurar Features Perdidas do Backup

> Contexto: A V3 (uncommitted) adicionou auto-backup e Maquina do Tempo, mas removeu
> a granularidade de export (toggles seletivos, save dialog, conversas OFF por default).
> Este plano restaura o que se perdeu SEM quebrar o que foi ganho.

---

## Principio: Dois fluxos, nao um

O erro da V3 foi UNIFICAR dois fluxos distintos num so:

| Fluxo | Proposito | Destino | Conteudo |
|-------|-----------|---------|----------|
| **Snapshot** (auto/manual) | Backup de seguranca, Maquina do Tempo | Pasta configurada, automatico | TUDO (correto - e safety net) |
| **Exportar** | Compartilhar, migrar, pendrive | Save Dialog, usuario escolhe | SELETIVO (usuario decide o que incluir) |

A V2 tinha so o fluxo "Exportar". A V3 trocou por so o fluxo "Snapshot".
O correto: TER OS DOIS.

---

## Mudancas necessarias

### 1. Restaurar `dados.exportar` no tipc.ts

**O que:** Trazer de volta o handler que abre Save Dialog e permite export seletivo.

**Como:**
- Recuperar a logica de `dados.exportar` da V2 (commit `6b05fbf` ou ultimo commit antes das mudancas)
- Mas em vez de inline, DELEGAR para `backup.ts` (aproveitar a centralizacao da V3)
- Input: `BackupOpcoes { incluir_cadastros, incluir_conhecimento, incluir_historico_chat }`
- Logica:
  1. Filtrar `BACKUP_CATEGORIAS` pelas opcoes ligadas
  2. Abrir `dialog.showSaveDialog` (usuario escolhe destino)
  3. Gerar ZIP categorizado com so as categorias selecionadas
  4. Retornar `{ filepath, tamanho_mb }`

**Arquivo:** `src/main/tipc.ts` — adicionar handler `dados.exportar` de volta

### 2. Adicionar funcao `createExportZip` em backup.ts

**O que:** Funcao que gera ZIP seletivo (diferente do `createSnapshot` que e tudo-ou-nada).

**Como:**
```typescript
export async function createExportZip(
  destino: string,
  opcoes: { incluir_cadastros: boolean; incluir_conhecimento: boolean; incluir_historico_chat: boolean }
): Promise<{ filepath: string; tamanho_mb: number }>
```

- Reutiliza `BACKUP_CATEGORIAS` e a logica de dump por tabela do `createSnapshot`
- Filtra categorias conforme `opcoes`
- Escreve no `destino` (path absoluto vindo do Save Dialog)
- Inclui `_meta.json` com `trigger: 'export_manual'`

**Arquivo:** `src/main/backup.ts`

### 3. Restaurar UI de export seletivo na ConfiguracoesPagina

**O que:** Trazer de volta os 3 switches e o botao "Exportar backup".

**Como:**
Na secao de Backup da ConfiguracoesPagina, organizar em 2 blocos visuais:

```
Card "Backup"
├── Bloco 1: Backup automatico (ja existe na V3)
│   ├── Toggle "Backup automatico" (salva ao fechar + cada 24h)
│   ├── Pasta configurada (alterar/resetar)
│   ├── Ultimo backup
│   └── Botoes: "Backup Agora" | "Maquina do Tempo"
│
├── Separator
│
└── Bloco 2: Exportar / Importar (RESTAURAR da V2)
    ├── 3 Switches:
    │   ├── [ON]  Cadastros e escalas (Database icon)
    │   ├── [ON]  Conhecimento e memorias (BookOpen icon)
    │   └── [OFF] Historico de conversas (MessageSquare icon)  ← OFF por default
    └── Botoes: "Exportar backup" (Download) | "Importar" (Upload)
```

**Detalhes:**
- Os 3 switches controlam state local (`backupCadastros`, `backupConhecimento`, `backupChat`)
- Defaults: cadastros=true, conhecimento=true, chat=**false**
- "Exportar backup" chama `dados.exportar` com as opcoes
- "Importar" continua como esta (file picker, aceita ZIP/JSON)
- Validacao: se nenhum switch ligado, toast "Selecione pelo menos uma categoria"

**Arquivo:** `src/renderer/src/paginas/ConfiguracoesPagina.tsx`

### 4. Tipo `BackupOpcoes` em shared/types.ts

**O que:** Restaurar a interface de opcoes de export.

```typescript
export interface BackupOpcoes {
  incluir_cadastros: boolean
  incluir_conhecimento: boolean
  incluir_historico_chat: boolean
}
```

**Arquivo:** `src/shared/types.ts`

---

## O que NAO mudar

- `createSnapshot()` continua exportando TUDO — e safety net, nao export seletivo
- `listSnapshots()`, `restoreSnapshot()`, `cleanupSnapshots()` intocados
- `TimeMachineModal` intocado
- 7 handlers `backup.*` intocados
- `configuracao_backup` tabela intocada
- Auto-backup no `index.ts` intocado
- `dados.importar` intocado (ja funciona com ZIP + JSON legado)

---

## Ordem de implementacao

1. `shared/types.ts` — adicionar `BackupOpcoes`
2. `backup.ts` — adicionar `createExportZip(destino, opcoes)`
3. `tipc.ts` — adicionar handler `dados.exportar` de volta
4. `ConfiguracoesPagina.tsx` — restaurar switches + botao Exportar

---

## Validacao

- [ ] "Exportar backup" abre Save Dialog e gera ZIP no destino escolhido
- [ ] Com so "Cadastros" ligado, ZIP contem apenas pasta `cadastros/`
- [ ] Com "Conversas" ligado, ZIP contem pasta `conversas/`
- [ ] "Backup Agora" continua salvando TUDO na pasta configurada
- [ ] Maquina do Tempo continua funcionando
- [ ] Auto-backup ao fechar continua funcionando
- [ ] Import aceita ZIP seletivo (so as categorias presentes) + ZIP completo + JSON legado

---

## Referencia: Commits uteis

- `6b05fbf` — ultimo commit com `dados.exportar` e toggles na UI (V2)
- `22b1560` — versao mais antiga do backup (V1, JSON flat)
- Working tree atual — V3 com auto-backup + Maquina do Tempo
