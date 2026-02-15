# PRD: Migração Web → Electron Desktop

> **Workflow:** migration
> **Budget sugerido:** high
> **Criado em:** 2026-02-14T22:00:00Z
> **Fonte:** gather (conversa interativa)

---

## Visao Geral

O EscalaFlow v2 foi construido como monorepo web (Hono HTTP API + React Vite SPA) para unificar a linguagem (antes era Python + Node). A unificacao de linguagem esta FEITA — agora precisa unificar o PROCESSO.

O produto e OFFLINE (desktop para o RH do Supermercado Fernandes). A arquitetura atual de dois servidores HTTP comunicando via proxy nao faz sentido para um app desktop. Precisa migrar para Electron com comunicacao via IPC.

**De:** Monorepo web (apps/api + apps/web + packages/shared) com HTTP REST
**Para:** App Electron unico com IPC type-safe entre main process e renderer

O frontend (Sprint 001) esta 100% pronto. O motor de escalas esta funcional. O trabalho e reorganizar as pecas e trocar o encanamento de HTTP para IPC.

---

## Requisitos Funcionais

### RF1: Scaffold Electron
- [ ] Criar estrutura electron-vite com template react-ts
- [ ] Configurar `electron.vite.config.ts` com externalizeDepsPlugin
- [ ] Externalizar better-sqlite3 do bundle (native module)
- [ ] Configurar path aliases (@/ para renderer)

### RF2: Main Process
- [ ] Criar `src/main/index.ts` com BrowserWindow, lifecycle (ready, activate, window-all-closed)
- [ ] Configurar webPreferences: contextIsolation=true, sandbox=true, nodeIntegration=false
- [ ] Carregar renderer via electron-vite (dev: URL, prod: file protocol)

### RF3: Database Layer (main process)
- [ ] Mover `apps/api/src/db/database.ts` → `src/main/db/database.ts`
- [ ] Adaptar path do DB: `app.getPath('userData') + '/escalaflow.db'`
- [ ] Mover `apps/api/src/db/schema.ts` → `src/main/db/schema.ts` (sem alteracao de logica)
- [ ] Mover `apps/api/src/db/seed.ts` → `src/main/db/seed.ts` (sem alteracao de logica)
- [ ] Configurar pragmas: WAL mode, foreign_keys ON, cache_size -64000, synchronous NORMAL
- [ ] Fechar conexao graciosamente no evento `before-quit`

### RF4: Motor de Escalas em Worker Thread
- [ ] Mover `apps/api/src/motor/gerador.ts` → `src/main/motor/gerador.ts`
- [ ] Criar `src/main/motor/worker.ts` que roda gerador em thread separada
- [ ] Worker abre conexao SQLite PROPRIA (nunca compartilhar conexao entre threads)
- [ ] Worker envia eventos de progresso via `parentPort.postMessage`
- [ ] Main process recebe resultado e repassa pro renderer via IPC
- [ ] Usar `?modulePath` do electron-vite para resolver path do worker

### RF5: IPC Type-Safe com @egoist/tipc
- [ ] Instalar @egoist/tipc
- [ ] Criar `src/main/tipc.ts` com router definindo todos os handlers
- [ ] Registrar router no main process com `registerIpcMain(router)`
- [ ] Converter rotas Hono → procedures tipc:
  - [ ] Empresa: buscar, atualizar
  - [ ] TiposContrato: listar, criar, atualizar, deletar
  - [ ] Setores: listar, buscar, criar, atualizar, deletar, listarDemandas, criarDemanda, atualizarDemanda, deletarDemanda, reordenarRank
  - [ ] Colaboradores: listar, buscar, criar, atualizar, deletar
  - [ ] Excecoes: listar, criar, atualizar, deletar
  - [ ] Escalas: gerar (via worker), buscar, listarPorSetor, oficializar, ajustar, deletar
  - [ ] Dashboard: resumo

### RF6: Preload Script
- [ ] Criar `src/preload/index.ts` com contextBridge
- [ ] Expor apenas `ipcRenderer.invoke` e `ipcRenderer.on` (whitelisted)
- [ ] NAO expor ipcRenderer inteiro (seguranca)
- [ ] Criar type declaration para `window.electron`

### RF7: Renderer (React App)
- [ ] Mover `apps/web/src/` → `src/renderer/src/`
- [ ] Mover `apps/web/index.html` → `src/renderer/index.html`
- [ ] Mover `apps/web/components.json` → ajustar paths shadcn
- [ ] Mover Tailwind config e index.css
- [ ] Criar tipc client em `src/renderer/src/servicos/client.ts`
- [ ] Reescrever `servicos/api.ts` → usar tipc client ao inves de fetch
- [ ] Reescrever `servicos/setores.ts` → `client.listarSetores()` etc
- [ ] Reescrever `servicos/colaboradores.ts` → tipc client
- [ ] Reescrever `servicos/excecoes.ts` → tipc client
- [ ] Reescrever `servicos/escalas.ts` → tipc client
- [ ] Reescrever `servicos/tipos-contrato.ts` → tipc client
- [ ] Reescrever `servicos/empresa.ts` → tipc client
- [ ] Reescrever `servicos/dashboard.ts` → tipc client
- [ ] Adaptar `hooks/useApiData.ts` para funcionar com IPC (invoke retorna Promise, compativel)
- [ ] Verificar que todas as paginas continuam funcionando

### RF8: Shared Types
- [ ] Mover `packages/shared/src/types.ts` → `src/shared/types.ts`
- [ ] Mover `packages/shared/src/constants.ts` → `src/shared/constants.ts`
- [ ] Atualizar imports em main e renderer para `../../shared/`
- [ ] Definir IPC channel types compartilhados (se DIY ao inves de tipc)

### RF9: Empacotamento
- [ ] Criar `electron-builder.yml` com config para mac (dmg), win (nsis), linux (AppImage)
- [ ] Configurar asarUnpack para better-sqlite3 e arquivos .node
- [ ] Configurar icones do app em `resources/`
- [ ] Adicionar scripts: dev, build, pack, dist, dist:mac, dist:win
- [ ] Testar build local (`npm run pack`) gerando diretorio
- [ ] Testar empacotamento (`npm run dist:mac`) gerando .dmg

### RF10: Limpeza
- [ ] Remover `apps/api/` (Hono server inteiro)
- [ ] Remover `apps/web/` (movido para renderer)
- [ ] Remover `packages/shared/` (movido para src/shared)
- [ ] Remover workspace config do root package.json
- [ ] Atualizar .gitignore para Electron (out/, dist/, *.dmg, *.exe)
- [ ] Unificar package.json (um so, sem workspaces)

---

## Criterios de Aceitacao

- [ ] `npm run dev` inicia o app Electron com hot reload no renderer
- [ ] Todas as 8 paginas funcionam: Dashboard, SetorLista, SetorDetalhe, ColaboradorLista, ColaboradorDetalhe, EscalaPagina (3 tabs), ContratoLista, EmpresaConfig
- [ ] Gerar escala funciona sem travar a UI (worker thread)
- [ ] CRUD completo: setores, colaboradores, excecoes, demandas, tipos contrato, empresa
- [ ] DnD de ranking no SetorDetalhe funciona
- [ ] Escalas: gerar, oficializar, descartar, visualizar historico
- [ ] `npx tsc --noEmit` retorna 0 erros
- [ ] `npm run build` completa sem erros
- [ ] `npm run pack` gera diretorio com app funcional
- [ ] Nenhum HTTP server rodando (zero fetch para localhost, zero proxy)
- [ ] DB salvo em `app.getPath('userData')/escalaflow.db`
- [ ] App funciona 100% offline (sem dependencia de rede)

---

## Constraints

- **better-sqlite3 e native module** — precisa ser externalizado do bundle e desempacotado do ASAR
- **Worker threads nao compartilham conexao SQLite** — cada worker abre conexao propria
- **contextIsolation SEMPRE true** — seguranca do Electron
- **nodeIntegration SEMPRE false** — renderer nao acessa Node.js diretamente
- **Manter snake_case** — convencao ponta a ponta nao muda
- **Nao alterar logica de negocio** — motor, schema, seed ficam identicos
- **Nao alterar UI** — paginas, componentes, estilizacao ficam identicos

---

## Fora do Escopo

- Auto-update (atualizacao automatica do app) — futuro
- Tray icon / menu de sistema — futuro
- Backup automatico do banco — futuro
- Multi-window — nao necessario
- Refatoracao do motor de escalas — esta funcional
- Novas paginas ou funcionalidades de UI — Sprint 001 ja entregou
- Testes automatizados — fase posterior
- CI/CD para build multiplataforma — futuro
- Assinatura de codigo (code signing) — futuro
- Migracao de dados do v1 (horario) — futuro

---

## Servicos Envolvidos

- [x] Frontend (React → renderer process)
- [x] Backend (Hono → main process IPC handlers)
- [x] Database (SQLite — muda path, mantem logica)
- [x] Build System (Vite → electron-vite)
- [x] Packaging (novo — electron-builder)

---

## Mapa de Migracao de Arquivos

### MOVE (reuso direto ~85%)
```
apps/web/src/paginas/*           → src/renderer/src/paginas/
apps/web/src/componentes/*       → src/renderer/src/componentes/
apps/web/src/components/ui/*     → src/renderer/src/components/ui/
apps/web/src/estado/*            → src/renderer/src/estado/
apps/web/src/hooks/*             → src/renderer/src/hooks/
apps/web/src/lib/*               → src/renderer/src/lib/
apps/web/src/App.tsx             → src/renderer/src/App.tsx
apps/web/src/main.tsx            → src/renderer/src/main.tsx
apps/web/src/index.css           → src/renderer/src/index.css
apps/web/index.html              → src/renderer/index.html
apps/api/src/db/schema.ts        → src/main/db/schema.ts
apps/api/src/db/seed.ts          → src/main/db/seed.ts
apps/api/src/motor/gerador.ts    → src/main/motor/gerador.ts
packages/shared/src/types.ts     → src/shared/types.ts
packages/shared/src/constants.ts → src/shared/constants.ts
```

### REWRITE (~10%)
```
apps/api/src/db/connection.ts    → src/main/db/database.ts (adaptar path para app.getPath)
apps/web/src/servicos/api.ts     → src/renderer/src/servicos/client.ts (tipc client)
apps/web/src/servicos/setores.ts → src/renderer/src/servicos/setores.ts (fetch→invoke)
apps/web/src/servicos/colaboradores.ts → (idem)
apps/web/src/servicos/excecoes.ts      → (idem)
apps/web/src/servicos/escalas.ts       → (idem)
apps/web/src/servicos/tipos-contrato.ts → (idem)
apps/web/src/servicos/empresa.ts       → (idem)
apps/web/src/servicos/dashboard.ts     → (idem)
```

### DELETE
```
apps/api/src/index.ts            (Hono server)
apps/api/src/routes/*            (HTTP routes — viram IPC handlers)
apps/web/vite.config.ts          (substituido por electron.vite.config.ts)
root package.json workspaces     (sem monorepo)
```

### CREATE (novo)
```
src/main/index.ts                (Electron lifecycle + BrowserWindow)
src/main/tipc.ts                 (IPC router com todos os handlers)
src/main/motor/worker.ts         (Worker thread pro gerador)
src/preload/index.ts             (contextBridge)
electron.vite.config.ts          (build config unificado)
electron-builder.yml             (empacotamento)
src/renderer/src/env.d.ts        (type augmentation Window)
```

---

## Stack Tecnica

| Camada | Tecnologia | Versao Sugerida |
|--------|-----------|-----------------|
| Runtime | Electron | ^34.x |
| Build | electron-vite | ^3.x |
| IPC | @egoist/tipc | latest |
| DB | better-sqlite3 | ^11.x (ja usa) |
| UI | React 19 + shadcn/ui | (ja usa) |
| State | Zustand | ^5.x (ja usa) |
| Routing | React Router | ^7.x (ja usa) |
| DnD | @dnd-kit | (ja usa) |
| CSS | Tailwind | ^3.x (ja usa) |
| Package | electron-builder | ^25.x |

---

## Fases Sugeridas para Orchestrate

| Fase | Nome | Descricao |
|------|------|-----------|
| 1 | Scaffold | Criar estrutura electron-vite, configs, package.json |
| 2 | Main Process | BrowserWindow, lifecycle, database.ts, schema, seed |
| 3 | IPC Router | tipc router com todos os handlers (converter Hono routes) |
| 4 | Worker Thread | Motor em worker, comunicacao progress |
| 5 | Preload | contextBridge, type declarations |
| 6 | Renderer Migration | Mover React app, reescrever servicos pra IPC |
| 7 | Integration Test | Verificar todas as paginas, CRUD, geracao de escala |
| 8 | Packaging | electron-builder, testar pack e dist |
| 9 | Cleanup | Remover apps/, packages/, workspace config |

---

## Riscos

| Risco | Impacto | Mitigacao |
|-------|---------|-----------|
| better-sqlite3 nao builda no Electron | ALTO | electron-rebuild, asarUnpack, externalizar do bundle |
| Worker thread nao carrega native module em prod | ALTO | Conexao SQLite propria no worker, testar em pack |
| Imports quebram ao mover arquivos | MEDIO | Atualizar todos os imports, rodar tsc apos cada fase |
| shadcn paths quebram no electron-vite | MEDIO | Reconfigurar components.json com novos aliases |
| Tamanho do bundle Electron grande demais | BAIXO | Aceitavel (~150MB), otimizar depois se necessario |

---

## Budget Sugerido

**high** — Migracao arquitetural completa, 40+ arquivos movidos, 9 fases, native modules, worker threads, reescrita de camada de comunicacao. Risco alto de quebra se feito sem cuidado. Precisa de Opus em todas as camadas.

---

## Notas Adicionais

- O projeto original (v1 em `~/horario/`) era Electron + Python. A migracao e um "retorno as origens" mas agora com stack unificada TypeScript
- O frontend (Sprint 001) esta 100% pronto e testado — nao deve ser alterado
- O motor de escalas (764 linhas, 7 fases) esta funcional — apenas mover pra worker
- Referencia de como era o Electron no v1: `~/horario/apps/frontend/src/main/`
- Memoria do projeto em `~/.claude/projects/-Users-marcofernandes-escalaflow/memory/migration-electron.md`
