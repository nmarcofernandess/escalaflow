# CLAUDE.md

Instruções para Claude Code ao trabalhar neste repositório.

---

## Contexto do Projeto

**EscalaFlow** é um app desktop offline para geração automática de escalas de trabalho em supermercados. Desenvolvido para o RH do Supermercado Fernandes (pais do Marco) — usuários não técnicos.

- **Produto offline** — sem login, sem internet, sem servidor, sem SaaS
- **Motor Python (OR-Tools CP-SAT)** — o coração do sistema, via bridge TS → Python
- **Electron 34** — shell desktop, IPC type-safe com @egoist/tipc
- **20 regras CLT/CCT** aplicadas automaticamente ao gerar escalas
- **IA integrada** — Chat RH com 28 tools (Vercel AI SDK + Gemini)

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
│   │   ├── tipc.ts              # ~80+ IPC handlers type-safe (@egoist/tipc)
│   │   ├── db/
│   │   │   ├── database.ts      # conexão better-sqlite3
│   │   │   ├── schema.ts        # DDL (CREATE TABLE IF NOT EXISTS)
│   │   │   ├── seed.ts          # seed: contratos CLT, feriados, regras motor
│   │   │   └── seed-local.ts    # seed dev: empresa, setores, colaboradores (gitignored)
│   │   ├── ia/
│   │   │   ├── system-prompt.ts # System prompt (370 linhas, 8 seções domínio RH/CLT)
│   │   │   ├── tools.ts         # 28 IA tools (Zod schemas + handlers)
│   │   │   ├── discovery.ts     # Auto-contexto por request (alertas, feriados, regras)
│   │   │   └── cliente.ts       # Vercel AI SDK v6, multi-turn, DevTools
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
├── tests/
│   ├── ia/
│   │   ├── tools/               # Unit tests das 28 IA tools (vitest)
│   │   ├── evals/               # Evals de tool calling (scoring automático)
│   │   └── live/                # Smoke tests com API real + CLI interativo
│   ├── e2e/                     # Playwright E2E tests
│   └── renderer/                # Component tests
│
├── docs/                        # Documentação técnica
│   ├── COMO_FAZER_RELEASE.md    # Guia de release e auto-update
│   ├── MOTOR_V3_RFC.md          # RFC canônico do motor (20 HARD, SOFT, explicabilidade)
│   ├── BUILD_V2_ESCALAFLOW.md   # Arquitetura v2 (referência histórica)
│   └── flowai/                  # Docs do sistema de IA (tools, prompts, evals)
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
| IA | Vercel AI SDK + Gemini/OpenRouter | v6 / 28 tools |
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

## Sistema de IA (Chat RH)

### Arquitetura

```
renderer → IPC (ia.chat) → cliente.ts → Vercel AI SDK generateText()
                                        ↕ tools loop (max 10 steps)
                                        → system-prompt.ts (370 linhas, 8 seções CLT/RH)
                                        → discovery.ts (auto-contexto por request)
                                        → tools.ts (28 tools, Zod schemas + handlers)
```

### Arquivos Chave

| Arquivo | Papel |
|---------|-------|
| `src/main/ia/system-prompt.ts` | System prompt — 8 seções: identidade, CLT/CCT, motor, entidades, tools, schema, workflows, conduta |
| `src/main/ia/tools.ts` | 28 tools com Zod schemas, runtime validation, enrichment, 3-status pattern |
| `src/main/ia/discovery.ts` | Auto-contexto: feriados, regras custom, exceções, alertas proativos, dica de página |
| `src/main/ia/cliente.ts` | Orquestrador: Vercel AI SDK v6, multi-turn, follow-up silencioso, DevTools |

### Padrões de Tool Calling

| Pattern | Implementação |
|---------|---------------|
| Response 3-status | `toolOk()`, `toolError()`, `toolTruncated()` — helpers centralizados |
| Zod .describe() | Todos os 28 schemas com .describe() em cada campo |
| Runtime validation | `safeParse` + mensagem de correção se falha |
| FK enrichment | `enrichConsultarRows()` — traduz setor_id→setor_nome, etc |
| Navigation metadata | `_meta.ids_usaveis_em`, `_meta.next_tools_hint` |
| Error correction | `toolError()` sempre com `correction` (instrução de fix pro LLM) |
| Discovery layering | get_context() → consultar() → tools semânticas |
| Truncation | CONSULTAR_MODEL_ROW_LIMIT = 50 com status 'truncated' |
| SQL error translation | NOT NULL / UNIQUE / FK → mensagens acionáveis |

### Tools (28)

**Discovery:** get_context, consultar, buscar_colaborador, obter_regra_horario_colaborador, listar_perfis_horario, obter_alertas
**CRUD genérico:** criar, atualizar, deletar, cadastrar_lote
**Escalas:** gerar_escala, ajustar_alocacao, ajustar_horario, oficializar_escala
**Validação:** preflight, preflight_completo, diagnosticar_escala, explicar_violacao
**Regras:** editar_regra, salvar_regra_horario_colaborador, definir_janela_colaborador, upsert_regra_excecao_data, resetar_regras_empresa
**Config:** configurar_horario_funcionamento, salvar_perfil_horario, deletar_perfil_horario
**KPI:** resumir_horas_setor
**Demanda:** salvar_demanda_excecao_data

---

## Banco de Dados

- **Arquivo:** `data/escalaflow.db` (SQLite, criado automaticamente)
- **Schema:** `src/main/db/schema.ts`
- **Seed:** `src/main/db/seed.ts` (roda na primeira inicialização se banco vazio)
- **Reset:** `npm run db:reset` (ou delete `data/escalaflow.db` e reinicie o app)

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

### Seeds

| Arquivo | Conteúdo | Git? |
|---------|----------|------|
| `src/main/db/seed.ts` | Contratos CLT, feriados nacionais, perfis horário, 35 regras motor | Tracked |
| `src/main/db/seed-local.ts` | Empresa exemplo, 2 setores, 13 colaboradores, horários, demandas, API keys | Gitignored |

- `seed.ts` roda na primeira inicialização (banco vazio)
- `seed-local.ts` opcional — dados de teste completos para dev. Período sugerido: 2026-03-02 a 2026-04-26
- **Reset completo:** `npm run db:reset` (ou delete `data/escalaflow.db` + reiniciar)

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
# Desenvolvimento
npm run dev              # dev com hot reload
npm run build            # build de produção
npm run clean            # rm -rf out tmp .vite
npm run clean:dev        # clean + dev

# Verificação
npm run typecheck        # TS check node + web (SEMPRE rodar antes de commit)
npm run test             # vitest run (unit tests)
npm run test:watch       # vitest em modo watch
npm run test:coverage    # vitest com cobertura
npm run test:e2e         # Playwright E2E tests

# IA
npm run test:ia:eval     # Roda evals das tools IA
npm run test:ia:live     # Smoke test IA com API real
npm run ia:chat          # CLI interativo para testar IA

# Motor
npm run solver:test      # smoke test motor Python no DB real
npm run solver:build     # compila binário Python (PyInstaller)

# Banco
npm run db:reset         # deleta e recria banco

# Distribuição
npm run dist:mac         # gera .dmg (sem publicar)
npm run dist:win         # gera .exe (sem publicar)
npm run release:mac      # build + upload GitHub Releases (Mac)
```

---

## Layout Contract (NUNCA QUEBRAR)

O layout do app é uma cadeia de altura fixa do viewport até os componentes. Quebrar qualquer elo = gap preto, scroll duplo, conteúdo cortado.

### Cadeia de altura (cada nível depende do anterior)

```
html (height: 100%)
  └─ body (height: 100%)
      └─ #root (height: 100%)
          └─ SidebarProvider (h-svh overflow-hidden)
              ├─ AppSidebar
              └─ SidebarInset (h-full min-h-0 overflow-hidden)
                  └─ #CONTENT_AREA (flex min-h-0 flex-1)
                      ├─ main (min-h-0 flex-1 min-w-0 overflow-auto)  ← ÚNICO scroll owner de página
                      └─ IaChatPanel (h-full shrink-0 border-l)       ← largura animada, sem absolute
```

### Regras invioláveis

| Regra | Por quê |
|-------|---------|
| `main` é o ÚNICO scroll owner de página | Dois `overflow-auto` aninhados = scroll duplo |
| Páginas NUNCA adicionam `overflow-y-auto` no wrapper interno | Cria segundo scroll owner, compete com `main` |
| `IaChatPanel` usa `w-[380px]` / `w-0` (width animation) | Absolute + transform + rail = over-engineering que quebra |
| `IaChatView` usa `viewport.scrollTo()`, NUNCA `scrollIntoView` | `scrollIntoView` propaga para TODOS os ancestrais scrolláveis |
| `ScrollArea` em flex context DEVE ter `min-h-0` | Sem isso, conteúdo cresce e empurra irmãos pra fora do viewport |
| Componentes que retornam lista (ScrollArea + Input) DEVEM ter wrapper div com `overflow-hidden min-h-0` | Fragment (`<>`) perde contenção de overflow — filhos viram flex children diretos do pai |

### Padrão correto para páginas

```tsx
// BOM — página delega scroll ao <main> do App.tsx
export function MinhaPagina() {
  return (
    <div className="flex flex-1 flex-col">
      <PageHeader ... />
      <div className="flex flex-col gap-6 p-6">
        {/* conteúdo */}
      </div>
    </div>
  )
}

// ERRADO — cria segundo scroll owner
export function MinhaPagina() {
  return (
    <div className="flex flex-1 flex-col">
      <PageHeader ... />
      <div className="flex flex-1 flex-col gap-6 overflow-y-auto p-6">  {/* ← PROIBIDO */}
        {/* conteúdo */}
      </div>
    </div>
  )
}
```

### Padrão correto para scroll interno (ex: chat)

```tsx
// BOM — scroll targeted no viewport do Radix
const scrollAreaRef = useRef<HTMLDivElement>(null)
useEffect(() => {
  const viewport = scrollAreaRef.current?.querySelector('[data-radix-scroll-area-viewport]')
  if (viewport) {
    viewport.scrollTo({ top: viewport.scrollHeight, behavior: 'smooth' })
  }
}, [mensagens])

// ERRADO — propaga scroll pra main e qualquer ancestral
msgEndRef.current?.scrollIntoView({ behavior: 'smooth' })  // ← PROIBIDO
```

### Arquivos críticos do layout (tocar com cuidado)

| Arquivo | Papel |
|---------|-------|
| `index.css` | `html, body, #root { height: 100% }` — base da cadeia |
| `App.tsx` | Shell: SidebarProvider → SidebarInset → main + IaChatPanel |
| `IaChatPanel.tsx` | Painel IA: width animation, `shrink-0`, `overflow-hidden` |
| `IaChatView.tsx` | Chat: ScrollArea com `min-h-0`, scroll targeted |

---

## Checklist antes de commitar

- [ ] `npm run typecheck` retorna 0 erros
- [ ] `snake_case` em todo campo banco/IPC/TS
- [ ] Novos handlers IPC registrados em `tipc.ts`
- [ ] Novos tipos adicionados em `src/shared/types.ts`
- [ ] Nenhum `console.log` de debug esquecido no código
- [ ] Componentes shadcn verificados antes de criar div soup
- [ ] Layout chain intacto (ver "Layout Contract") — sem `overflow-y-auto` em páginas, sem `scrollIntoView`
- [ ] Novas tools IA: schema Zod + handler + entry no IA_TOOLS + TOOL_SCHEMAS
- [ ] TOOL_SCHEMAS sincronizado com IA_TOOLS (28 entries)
