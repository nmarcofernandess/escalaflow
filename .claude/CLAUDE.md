# CLAUDE.md

Instruções para Claude Code ao trabalhar neste repositório.

---

## Contexto do Projeto

**EscalaFlow** é um app desktop offline para geração automática de escalas de trabalho em supermercados. Desenvolvido para o RH do Supermercado Fernandes (pais do Marco) — usuários não técnicos.

- **Produto offline** — sem login, sem internet, sem servidor, sem SaaS
- **Motor Python (OR-Tools CP-SAT)** — o coração do sistema, via bridge TS → Python
- **Electron 34** — shell desktop, IPC type-safe com @egoist/tipc
- **20 regras CLT/CCT** aplicadas automaticamente ao gerar escalas

---

## Quick Start

```bash
npm install          # instala dependências
npm run dev          # abre o app Electron com hot reload
npm run typecheck    # TypeScript check (node + web) — rodar antes de qualquer commit
npm run build        # build de produção
```

---

## Arquitetura

```
escalaflow/
├── src/
│   ├── main/                    # Electron Main Process (Node.js)
│   │   ├── index.ts             # bootstrap, BrowserWindow, auto-updater, ipcMain
│   │   ├── tipc.ts              # ~67 IPC handlers type-safe (@egoist/tipc)
│   │   ├── db/
│   │   │   ├── database.ts      # conexão better-sqlite3
│   │   │   ├── schema.ts        # DDL (CREATE TABLE IF NOT EXISTS)
│   │   │   └── seed.ts          # seed: 4 contratos CLT + dados iniciais
│   │   └── motor/
│   │       ├── solver-bridge.ts  # spawn Python, stdin/stdout JSON
│   │       └── validador.ts      # PolicyEngine (revalida após ajuste manual)
│   │
│   ├── preload/
│   │   └── index.ts             # contextBridge: expõe ipcRenderer ao renderer
│   │
│   ├── renderer/src/            # React 19 + Vite (frontend)
│   │   ├── paginas/             # 11 páginas (Dashboard, SetorLista, EscalaPagina…)
│   │   ├── componentes/         # componentes custom reutilizáveis
│   │   ├── components/ui/       # 24 shadcn/ui primitives
│   │   ├── servicos/            # wrappers IPC client (chama tipc do renderer)
│   │   ├── estado/              # Zustand stores
│   │   ├── hooks/               # useApiData, useColorTheme…
│   │   └── lib/                 # cn, utils, cores.ts, tour-constants
│   │
│   └── shared/                  # tipos e constantes compartilhados (main + renderer)
│       ├── index.ts
│       ├── types.ts             # interfaces TypeScript (Setor, Colaborador, Escala…)
│       └── constants.ts         # CLT grid, paleta, contratos seed…
│
├── solver/                      # Motor Python OR-Tools
│   ├── solver_ortools.py        # entrada: JSON via stdin → saída: JSON via stdout
│   ├── constraints.py           # 20 HARD + SOFT constraints
│   └── escalaflow-solver.spec   # PyInstaller spec para compilar binário
│
├── solver-bin/                  # Binário compilado (PyInstaller) — incluído no app
│
├── docs/                        # Documentação técnica
│   ├── COMO_FAZER_RELEASE.md    # Guia de release e auto-update
│   ├── MOTOR_V3_RFC.md          # RFC canônico do motor (20 HARD, SOFT, explicabilidade)
│   └── BUILD_V2_ESCALAFLOW.md   # Arquitetura v2 (referência histórica)
│
├── specs/                       # Specs e logs de implementação por feature
├── electron-builder.yml         # Config de build e publish (GitHub Releases)
├── electron.vite.config.ts      # Config electron-vite (main + preload + renderer)
└── package.json
```

---

## Stack e Versões

| Camada | Tecnologia | Versão |
|--------|-----------|--------|
| Shell | Electron | 34 |
| Build | electron-vite | 3 |
| IPC | @egoist/tipc | 0.3 |
| Database | better-sqlite3 | 11 |
| Motor | Python OR-Tools CP-SAT | via bridge |
| Frontend | React | 19 |
| Estilo | Tailwind CSS + shadcn/ui | 3 / 24 components |
| Estado | Zustand | 5 |
| Forms | react-hook-form + Zod | 7 + 4 |
| Router | React Router | v7 |
| Update | electron-updater | 6 |

---

## Convenções Críticas

### Snake_case ponta a ponta

```
coluna_banco (SQLite) = chave_ipc (IPC) = campo_ts (TypeScript) = prop_react (React)
```

**Nunca** usar adaptadores camelCase ↔ snake_case. O que sai do banco é exatamente o que chega no componente React.

### Naming por camada

| Camada | Convenção | Exemplo |
|--------|-----------|---------|
| Banco / IPC | `snake_case` | `hora_inicio`, `setor_id` |
| Variável TS | `camelCase` | `setorAtivo`, `escalaAtual` |
| Componente React | `PascalCase` | `SetorCard.tsx` |
| Hook | `use + PascalCase` | `useApiData` |
| Serviço IPC client | `servico + Entidade` | `servicoSetor` |

### IPC pattern (tipc)

```typescript
// main/tipc.ts — define o handler
const minhaRota = t.procedure.action(async (input) => { ... })

// renderer/servicos/servicoX.ts — chama via client
const client = createTipcClient<Router>(window.electron.ipcRenderer)
const resultado = await client.minhaRota.invoke(input)
```

---

## Motor Python

O motor **não é TypeScript**. O `gerador.ts` legado foi removido.

```
renderer → IPC → tipc.ts → solver-bridge.ts → spawn(solver-bin/escalaflow-solver)
                                              ← JSON response via stdout
```

### Compilar o binário Python (necessário para distribuição)

```bash
npm run solver:build
# Gera: solver-bin/escalaflow-solver (macOS) ou solver-bin/escalaflow-solver.exe (Windows)
```

### Testar o motor localmente

```bash
npm run solver:test   # smoke test no DB real
```

---

## Banco de Dados

- **Arquivo:** `data/escalaflow.db` (SQLite, criado automaticamente)
- **Schema:** `src/main/db/schema.ts`
- **Seed:** `src/main/db/seed.ts` (roda na primeira inicialização se banco vazio)
- **Reset:** delete `data/escalaflow.db` e reinicie o app

### Entidades

| Entidade | Tabela | Notas |
|----------|--------|-------|
| Empresa | `empresa` | Singleton (1 registro) |
| TipoContrato | `tipos_contrato` | Templates CLT 44h, 36h, 30h, Estagiário 20h |
| Setor | `setores` | Departamentos do supermercado |
| Demanda | `demandas` | Cobertura mínima por faixa horária/dia |
| Colaborador | `colaboradores` | Funcionários (setor + contrato) |
| Excecao | `excecoes` | Férias, atestado, bloqueio |
| Escala | `escalas` | RASCUNHO → OFICIAL → ARQUIVADA |
| Alocacao | `alocacoes` | Um dia de trabalho/folga de uma pessoa |
| Funcao | `funcoes` | Postos de trabalho (com cor_hex) |
| Feriado | `feriados` | Feriados com flag `proibido_trabalhar` (CCT) |

### Padrões no schema

```sql
-- Soft delete (nunca deletar de verdade)
ativo BOOLEAN DEFAULT 1

-- Timestamps automáticos
criada_em DATETIME DEFAULT CURRENT_TIMESTAMP

-- FKs sempre nomeadas {entidade}_id
setor_id INTEGER REFERENCES setores(id)
```

---

## Auto-Update (GitHub Releases)

O app verifica atualizações automaticamente ao iniciar (5s de delay).

### Como fazer um release

```bash
# 1. Bump version em package.json (ex: "version": "1.1.0")
# 2. Commit, tag e push
git add package.json && git commit -m "chore: bump v1.1.0"
git tag v1.1.0 && git push && git push --tags

# 3. Build + upload automático (Mac)
GH_TOKEN=$(gh auth token) npm run release:mac

# 4. Publicar o draft em github.com/nmarcofernandess/escalaflow/releases
```

**Guia completo:** `docs/COMO_FAZER_RELEASE.md`

### Arquivos chave do auto-update

| Arquivo | Propósito |
|---------|-----------|
| `electron-builder.yml` → `publish` | Aponta para GitHub: nmarcofernandess/escalaflow |
| `src/main/index.ts` → `setupAutoUpdater()` | Eventos do autoUpdater + ipcMain handlers |
| `EmpresaConfig.tsx` → card "Atualizações" | UI com barra de progresso e botão de instalar |
| `dist/latest-mac.yml` | Arquivo que o app baixa pra saber a versão mais recente |

### IPC channels do updater

| Channel | Direção | O que faz |
|---------|---------|-----------|
| `app:version` | renderer → main | Retorna a versão atual instalada |
| `update:check` | renderer → main | Dispara verificação manual |
| `update:install` | renderer → main | Instala e reinicia |
| `update:checking` | main → renderer | Evento: iniciou verificação |
| `update:available` | main → renderer | Evento: tem versão nova, baixando |
| `update:not-available` | main → renderer | Evento: já está na última versão |
| `update:progress` | main → renderer | Evento: progresso do download (%) |
| `update:downloaded` | main → renderer | Evento: pronto para instalar |
| `update:error` | main → renderer | Evento: erro na verificação/download |

---

## Comandos de Referência

```bash
npm run dev              # dev com hot reload
npm run build            # build de produção
npm run typecheck        # TS check (SEMPRE rodar antes de commit)
npm run solver:test      # testa motor Python no DB real
npm run solver:build     # compila binário Python (PyInstaller)
npm run dist:mac         # gera .dmg localmente (sem publicar)
npm run dist:win         # gera .exe localmente (sem publicar)
npm run release:mac      # build + upload para GitHub Releases (Mac)
```

---

## Checklist antes de commitar

- [ ] `npm run typecheck` retorna 0 erros
- [ ] `snake_case` em todo campo banco/IPC/TS
- [ ] Novos handlers IPC registrados em `tipc.ts`
- [ ] Novos tipos adicionados em `src/shared/types.ts`
- [ ] Nenhum `console.log` de debug esquecido no código
- [ ] Componentes shadcn verificados antes de criar div soup
