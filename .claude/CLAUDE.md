# CLAUDE.md

Instruções para Claude Code ao trabalhar neste repositório.

---

## Contexto do Projeto

**EscalaFlow** é um app desktop offline para geração automática de escalas de trabalho em varejo. Desenvolvido para gestores de RH — usuários não técnicos.

- **Produto offline** — sem login, sem internet, sem servidor, sem SaaS
- **Motor Python (OR-Tools CP-SAT)** — o coração do sistema, via bridge TS → Python
- **Electron 34** — shell desktop, IPC type-safe com @egoist/tipc
- **20 regras CLT/CCT** aplicadas automaticamente ao gerar escalas
- **IA integrada** — Chat RH com 30 tools (Vercel AI SDK + Gemini/OpenRouter + IA Local offline via node-llama-cpp)
- **Knowledge Layer** — RAG com embeddings locais, knowledge graph, memórias IA (PGlite + pgvector)

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
│   │   ├── tipc.ts              # ~90+ IPC handlers type-safe (@egoist/tipc)
│   │   ├── db/
│   │   │   ├── database.ts      # conexão PGlite (Postgres WASM)
│   │   │   ├── schema.ts        # DDL (CREATE TABLE IF NOT EXISTS) + migrations
│   │   │   ├── seed.ts          # seed: contratos CLT, feriados, regras motor
│   │   │   └── seed-local.ts    # seed dev: empresa, setores, colaboradores (gitignored)
│   │   ├── ia/
│   │   │   ├── system-prompt.ts # System prompt (370 linhas, 8 seções domínio RH/CLT)
│   │   │   ├── tools.ts         # 30 IA tools (Zod schemas + handlers)
│   │   │   ├── discovery.ts     # Auto-contexto por request (alertas, feriados, regras, memórias)
│   │   │   ├── cliente.ts       # Vercel AI SDK v6, multi-turn, compaction, DevTools
│   │   │   ├── config.ts        # buildModelFactory — reutilizável por módulos
│   │   │   ├── local-llm.ts     # IA Local: download GGUF, lifecycle modelo, chat com tool calling (node-llama-cpp)
│   │   │   └── session-processor.ts # Sanitize, indexação, compaction de sessões
│   │   ├── knowledge/
│   │   │   ├── embeddings.ts    # @huggingface/transformers multilingual-e5-small (ONNX local)
│   │   │   ├── ingest.ts        # Chunking + ingestão de documentos
│   │   │   ├── search.ts        # Busca semântica (pgvector) + FTS + knowledge graph
│   │   │   └── graph.ts         # Extração de entidades/relações via LLM
│   │   └── motor/
│   │       ├── solver-bridge.ts  # spawn Python, stdin/stdout JSON
│   │       └── validador.ts      # PolicyEngine (revalida após ajuste manual)
│   │
│   ├── preload/
│   │   └── index.ts             # contextBridge: expõe ipcRenderer ao renderer
│   │
│   ├── renderer/src/            # React 19 + Vite (frontend)
│   │   ├── paginas/             # 13 páginas (Dashboard, SetorLista, EscalaPagina, MemoriaPagina, IaPagina…)
│   │   ├── componentes/         # componentes custom reutilizáveis
│   │   ├── components/ui/       # 25 shadcn/ui primitives
│   │   ├── servicos/            # wrappers IPC client (chama tipc do renderer) — inclui iaLocal.ts
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
├── docs/                        # Documentação técnica (canônica)
│   ├── motor-regras.md          # RFC canônico do motor (20 HARD, SOFT, explicabilidade)
│   ├── motor-spec.md            # Spec técnica do motor (edge cases, entrada/saída)
│   ├── release.md               # Guia de release e auto-update
│   ├── solver-consistency.md    # Guia de teste de paridade solver/validador
│   ├── ia-sistema.md            # Como o sistema de IA funciona
│   └── ia-resumo-aba.md         # Resumo aba usuário vs IA
│
├── .github/
│   └── workflows/
│       └── release.yml          # CI/CD: build Mac + Windows via GitHub Actions (trigger: tag v*)
│
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
| Database | PGlite (Postgres 17 WASM) | 0.3 |
| Embeddings | @huggingface/transformers (multilingual-e5-small) | local ONNX |
| Motor | Python OR-Tools CP-SAT | via bridge |
| IA (Cloud) | Vercel AI SDK + Gemini/OpenRouter | v6 / 30 tools |
| IA (Local) | node-llama-cpp + Qwen 3.5 GGUF | offline, mesmas 30 tools |
| Frontend | React | 19 |
| Estilo | Tailwind CSS + shadcn/ui | 3 / 24 components |
| Estado | Zustand | 5 |
| Forms | react-hook-form + Zod | 7 + 4 |
| Router | React Router | v7 |
| Update | electron-updater | 6 |
| CI/CD | GitHub Actions | release.yml (Mac + Win) |

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

### CLI do Motor (dev)

```bash
npm run solver:cli -- list                           # lista setores disponíveis
npm run solver:cli -- 2                              # Açougue, 3 meses (estabilização 30s)
npm run solver:cli -- 2 2026-03-02 2026-05-31        # Açougue, período específico
npm run solver:cli -- 2 --dump                       # salva input JSON em tmp/ (debug)
npm run solver:cli -- 2 --summary                    # JSON compacto: indicadores + horas/colab (~1KB)
npm run solver:cli -- 2 --json                       # JSON sem comparacao_demanda (~250KB)
npm run solver:cli -- 2 --json-full                  # JSON completo com comparacao_demanda (~800KB)
```

**Requer:** app ter rodado ao menos 1x (banco em `out/data/escalaflow-pg`).

**Output modes:**
- **Default (sem flag):** Rich output com ANSI colors — tabela de alocações, indicadores, horas/semana
- **`--summary`:** JSON compacto (~1KB) — status, indicadores, diagnóstico, horas por colaborador
- **`--json`:** JSON estruturado (~250KB) — tudo exceto `comparacao_demanda` (que é 67% do peso)
- **`--json-full`:** JSON completo (~800KB) — inclui `comparacao_demanda` (4000+ slots 15min)

**Arquivo:** `scripts/solver-cli.ts`

### Output do Motor Python (SolverOutput)

O Python devolve JSON via stdout com estes campos:

| Campo | Peso (3 meses) | Quem usa | Nota |
|-------|----------------|----------|------|
| `alocacoes` | ~177KB (21%) | App salva no banco | Resultado final: 1 registro por colaborador/dia |
| `decisoes` | ~93KB (11%) | App salva, IA lê | Explicação textual de cada decisão |
| `comparacao_demanda` | ~556KB (67%) | App salva, CSV export | Slot-a-slot 15min planejado vs executado |
| `indicadores` | ~200B | Todos | KPIs: cobertura, violações, equilíbrio |
| `diagnostico` | ~1KB | Todos | Metadata: regras ativas, pass usado, tempos |

**IMPORTANTE:** `comparacao_demanda` é o campo mais pesado (67%). O app persiste no banco para CSV export e futuro gráfico de gaps. O CLI `--json` omite por padrão — use `--json-full` se precisar. A IA tool `gerar_escala` só usa um `.filter(delta < 0).slice(0, 10)` inline — não repassa o array inteiro.

### Coverage Stabilization

O solver usa **estabilização de cobertura** com patience fixo de **30s**. Não existem modos de resolução — o solver sempre busca o melhor resultado possível e para sozinho quando a cobertura estabiliza (30s sem melhoria, timer reseta a cada ganho).

O campo `solve_mode` no JSON é mantido por backward-compatibility mas é **ignorado** pelo solver.

**INFEASIBLE é instantâneo (<1s).** O patience só roda no pass que encontra solução. Passes que falham não desperdiçam tempo.

### Outros testes do motor

```bash
npm run solver:test      # smoke test E2E (bridge TS → Python → resultado)
npm run solver:build     # compila binário Python (PyInstaller)
```

---

## Sistema de IA (Chat RH)

### Arquitetura

```
renderer → IPC (ia.chat) → cliente.ts ─┬─ provider='gemini'|'openrouter'
                                       │    → Vercel AI SDK generateText()
                                       │    ↕ tools loop (max 10 steps)
                                       │
                                       └─ provider='local'
                                            → local-llm.ts → node-llama-cpp
                                            ↕ LlamaChatSession + defineChatSessionFunction

                                        → system-prompt.ts (full 460 linhas cloud / ~90 linhas local)
                                        → discovery.ts (auto-contexto: alertas, feriados, regras, memórias)
                                        → tools.ts (30 tools, Zod schemas + handlers — compartilhadas)
                                        → knowledge/ (RAG: embeddings + search + graph)
```

### Arquivos Chave

| Arquivo | Papel |
|---------|-------|
| `src/main/ia/system-prompt.ts` | System prompt — 8 seções: identidade, CLT/CCT, motor, entidades, tools, schema, workflows, conduta |
| `src/main/ia/tools.ts` | 30 tools com Zod schemas, runtime validation, enrichment, 3-status pattern |
| `src/main/ia/discovery.ts` | Auto-contexto: feriados, regras custom, exceções, alertas proativos, memórias IA |
| `src/main/ia/cliente.ts` | Orquestrador: Vercel AI SDK v6, multi-turn, compaction, DevTools |
| `src/main/ia/config.ts` | Factory de modelo (reutilizável por knowledge graph, session-processor, etc) |
| `src/main/ia/local-llm.ts` | IA Local: download GGUF, lifecycle singleton, chat com tool calling via node-llama-cpp |
| `src/main/ia/session-processor.ts` | Sanitize transcripts, indexação, compaction de sessões longas |
| `src/main/knowledge/search.ts` | Busca semântica (pgvector cosine) + FTS português + knowledge graph CTE |
| `src/main/knowledge/graph.ts` | Extração de entidades/relações via LLM + persist com embedding |

### Padrões de Tool Calling

| Pattern | Implementação |
|---------|---------------|
| Response 3-status | `toolOk()`, `toolError()`, `toolTruncated()` — helpers centralizados |
| Zod .describe() | Todos os 30 schemas com .describe() em cada campo |
| Runtime validation | `safeParse` + mensagem de correção se falha |
| FK enrichment | `enrichConsultarRows()` — traduz setor_id→setor_nome, etc |
| Navigation metadata | `_meta.ids_usaveis_em`, `_meta.next_tools_hint` |
| Error correction | `toolError()` sempre com `correction` (instrução de fix pro LLM) |
| Discovery layering | get_context() → consultar() → tools semânticas |
| Truncation | CONSULTAR_MODEL_ROW_LIMIT = 50 com status 'truncated' |
| SQL error translation | NOT NULL / UNIQUE / FK → mensagens acionáveis |

### Tools (30)

**Discovery:** consultar, buscar_colaborador, listar_perfis_horario, obter_alertas
**CRUD genérico:** criar, atualizar, deletar, cadastrar_lote
**Escalas:** gerar_escala, ajustar_alocacao, ajustar_horario, oficializar_escala
**Validação:** preflight, preflight_completo, diagnosticar_escala, diagnosticar_infeasible, explicar_violacao
**Regras:** editar_regra, salvar_regra_horario_colaborador, upsert_regra_excecao_data, resetar_regras_empresa
**Config:** configurar_horario_funcionamento, salvar_perfil_horario, deletar_perfil_horario
**KPI:** resumir_horas_setor
**Demanda:** salvar_demanda_excecao_data
**Knowledge:** buscar_conhecimento, salvar_conhecimento, listar_conhecimento, explorar_relacoes
**Memórias:** salvar_memoria, listar_memorias, remover_memoria

### IA Local (Offline)

Provider `'local'` roda inferência in-process via `node-llama-cpp` — sem internet, sem API key.

**Modelos disponíveis:**

| Modelo | Tamanho | RAM mínima | Uso |
|--------|---------|------------|-----|
| Qwen 3.5 9B Q4_K_M | ~5.7 GB | 8GB+ | Padrão — melhor tool calling |
| Qwen 3.5 4B Q4_K_M | ~2.8 GB | 4GB+ | Leve — máquinas com pouca RAM |

**Arquivo principal:** `src/main/ia/local-llm.ts` (~460 linhas)
- Download GGUF do HuggingFace com resume (Range header + `.part` temp)
- Lifecycle singleton: `getLlama()` → `loadModel()` → `createContext()`, auto GPU (Metal/CUDA/Vulkan)
- Idle timer: unload após 5min sem uso
- Chat: `LlamaChatSession` + `defineChatSessionFunction` (mesmas 30 tools via `zodToJsonSchema`)
- System prompt trimado (~90 linhas) via `buildLocalSystemPrompt()` em `system-prompt.ts`
- Context guard: trim histórico a 20 msgs para modelos com janela menor
- Emite mesmos `IaStreamEvent` que providers cloud — UI idêntica

**IPC handlers (6):**

| Handler | O que faz |
|---------|-----------|
| `ia.local.status` | Status de todos os modelos, GPU, tok/s |
| `ia.local.models` | Catálogo com status de download |
| `ia.local.download` | Inicia download com broadcast de progresso |
| `ia.local.cancelDownload` | Cancela via AbortController |
| `ia.local.deleteModel` | Remove GGUF do disco |
| `ia.local.unload` | Descarrega modelo da RAM |

**Serviço renderer:** `src/renderer/src/servicos/iaLocal.ts`
**UI:** Card "IA Local" em ConfiguracoesPagina (download/progresso/remover por modelo)

---

## Banco de Dados

- **Engine:** PGlite (Postgres 17 WASM) com pgvector, FTS português, pg_trgm
- **Diretório:** `data/pglite/` (criado automaticamente)
- **Schema:** `src/main/db/schema.ts` (DDL + migrations incrementais)
- **Seed:** `src/main/db/seed.ts` (roda na primeira inicialização se banco vazio)
- **Reset:** `npm run db:reset` (ou delete `data/pglite/` e reinicie o app)

### Entidades Operacionais

| Entidade | Tabela | Notas |
|----------|--------|-------|
| Empresa | `empresa` | Singleton (1 registro) |
| TipoContrato | `tipos_contrato` | Templates CLT 44h, 36h, 30h, Estagiário 20h |
| Setor | `setores` | Departamentos da empresa |
| Demanda | `demandas` | Cobertura mínima por faixa horária/dia |
| Colaborador | `colaboradores` | Funcionários (setor + contrato) |
| Excecao | `excecoes` | Férias, atestado, bloqueio |
| Escala | `escalas` | RASCUNHO → OFICIAL → ARQUIVADA |
| Alocacao | `alocacoes` | Um dia de trabalho/folga de uma pessoa |
| Funcao | `funcoes` | Postos de trabalho (com cor_hex) |
| Feriado | `feriados` | Feriados com flag `proibido_trabalhar` (CCT) |

### IA e Knowledge

| Tabela | Notas |
|--------|-------|
| `ia_conversas` | Histórico de conversas IA (status, resumo_compactado) |
| `ia_mensagens` | Mensagens individuais (role, content, tool_calls_json, anexos) |
| `ia_memorias` | Memórias curtas do RH (max 20, injetadas no discovery) |
| `knowledge_sources` | Documentos importados (manual, session, auto_extract) |
| `knowledge_chunks` | Chunks com embedding vector(768) + FTS português |
| `knowledge_entities` | Entidades extraídas (pessoa, setor, regra, conceito…) com `origem` (sistema/usuario) |
| `knowledge_relations` | Relações entre entidades (trabalha_em, regido_por, etc) |

### Knowledge Graph — Sistema vs Usuário

O graph separa entidades por `origem`:
- **sistema**: extraídas dos docs em `knowledge/` (CLT, regras, conceitos). Pre-computadas pelo dev.
- **usuario**: extraídas dos docs importados pelo RH. O botão "Analisar Relações" na UI processa apenas estes.
- **IA**: vê TUDO (ambas origens) via `explorar_relacoes` e RAG enrichment.

**Fluxo dev para popular knowledge sistema (enrichment + graph):**

O sistema usa dois seed JSONs pre-computados — gerados pelo dev, sem LLM em runtime:

1. **Enrichment seed** (resumo + tags por chunk): gerado por Claude Code (Opus) que lê os docs, chunkea e gera enrichment inteligente. Salvo em `knowledge/sistema/enrichment-seed.json`
2. **Graph seed** (entidades + relações): gerado via botão "Rebuild Graph" na UI (DEV mode, filtro Sistema) que usa API LLM. Salvo em `knowledge/sistema/graph-seed.json`

**Quando regerar:**
- Editou/adicionou docs em `knowledge/` → regerar enrichment-seed (via Claude Code) + graph-seed (via UI)
- `npm run db:reset` + reiniciar app → seeds são aplicados automaticamente

**Em produção:** `seed.ts` cria chunks → aplica enrichment-seed (re-embeda com tags) → importa graph-seed. Tudo local, sem LLM, sem API key.

**Para docs importados pelo RH (em runtime):** o `autoEnrichAfterIngest` roda automaticamente usando a API key configurada. Zero interação manual.

### Seeds

| Arquivo | Conteúdo | Git? |
|---------|----------|------|
| `src/main/db/seed.ts` | Contratos CLT, feriados, perfis, 35 regras, knowledge docs, enrichment seed, graph seed | Tracked |
| `src/main/db/seed-local.ts` | Empresa exemplo, 2 setores, 13 colaboradores, horários, demandas, API keys | Gitignored |
| `knowledge/sistema/enrichment-seed.json` | Resumo + tags por chunk, pre-gerados por Claude Opus | Tracked |
| `knowledge/sistema/graph-seed.json` | Entidades e relações pre-extraídas do graph sistema | Tracked |

- `seed.ts` roda na primeira inicialização (banco vazio)
- `seed-local.ts` opcional — dados de teste completos para dev. Período sugerido: 2026-03-02 a 2026-05-31
- **Reset completo:** `npm run db:reset` (ou delete `data/pglite/` + reiniciar)

### Padrões no schema

```sql
-- Soft delete (nunca deletar de verdade)
ativo BOOLEAN NOT NULL DEFAULT TRUE

-- Timestamps automáticos (Postgres syntax)
criada_em TIMESTAMPTZ DEFAULT NOW()

-- FKs sempre nomeadas {entidade}_id
setor_id INTEGER REFERENCES setores(id)

-- Embeddings (pgvector)
embedding vector(768)
```

---

## CI/CD e Releases (GitHub Actions)

O projeto usa **GitHub Actions** para build e distribuição cross-platform automatizada.

### Como funciona

```
git tag v1.2.1 && git push --tags
     ↓
GitHub Actions dispara (.github/workflows/release.yml)
     ↓
2 runners em paralelo:
  - macOS: Python → PyInstaller → solver nativo → electron-builder → DMG + latest-mac.yml
  - Windows: Python → PyInstaller → solver.exe nativo → electron-builder → NSIS .exe + latest.yml
     ↓
Draft Release criado com artefatos Mac + Windows
     ↓
Dev VERIFICA que latest-mac.yml e latest.yml estão nos assets
     ↓
Dev publica o draft em github.com/nmarcofernandess/escalaflow/releases
```

### Regra de ouro do auto-updater

**O release DEVE conter `latest-mac.yml` e/ou `latest.yml`.** Sem esses arquivos, o `electron-updater` dá erro e o auto-update não funciona. Eles são gerados automaticamente pelo `electron-builder` — mas se fizer upload manual dos assets, precisa gerar e subir os YAMLs também.

### Quando roda

| Ação | CI dispara? |
|------|-------------|
| `git push` (sem tag) | **Não** |
| `git push --tags` com tag `v*` | **Sim** |

### Ritual de release

```bash
# 1. Bump version em package.json (DEVE bater com a tag)
# 2. Commit, tag e push
git add package.json && git commit -m "chore: bump v1.2.1"
git tag v1.2.1 && git push && git push --tags

# 3. Esperar CI (~15 min) OU build local:
GH_TOKEN=$(gh auth token) npm run release:mac

# 4. VERIFICAR assets ANTES de publicar:
gh release view v1.2.1 --repo nmarcofernandess/escalaflow --json assets --jq '.assets[].name'
#    DEVE conter: *.dmg, latest-mac.yml (Mac) e/ou *.exe, latest.yml (Win)

# 5. Publicar o draft
gh release edit v1.2.1 --repo nmarcofernandess/escalaflow --draft=false
```

### Build local (sem CI)

```bash
npm run dist:mac         # gera .dmg localmente (sem upload)
npm run dist:win         # gera .exe localmente (solver precisa ser nativo do OS)
npm run release:mac      # build + upload direto pro GitHub (gera YAMLs automaticamente)
```

### Auto-Update

O app verifica atualizações automaticamente ao iniciar (5s de delay).

**Guia completo:** `docs/release.md`

### Arquivos chave do auto-update

| Arquivo | Propósito |
|---------|-----------|
| `electron-builder.yml` → `publish` | Aponta para GitHub: nmarcofernandess/escalaflow |
| `src/main/index.ts` → `setupAutoUpdater()` | Eventos do autoUpdater + ipcMain handlers |
| `ConfiguracoesPagina.tsx` → card "Atualizações" | UI com barra de progresso e botão de instalar |
| `latest-mac.yml` (no GitHub Release) | **CRITICO** — electron-updater lê pra detectar versão nova (Mac) |
| `latest.yml` (no GitHub Release) | **CRITICO** — idem para Windows |

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
npm run solver:cli -- <setor_id> [inicio] [fim]  # CLI dev completo (rich output)
npm run solver:cli -- list                       # lista setores
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

## Backup e Restauracao (Sistema Unificado ZIP)

Sistema unico de backup: formato ZIP organizado por categorias, com auto-backup + Maquina do Tempo.

### Formato ZIP

```
escalaflow-backup-2026-03-13T14-30-00-000.zip
├── _meta.json                    ← versao, data, trigger, contagem
├── cadastros/                    ← empresa, setores, colaboradores, escalas, regras...
│   ├── empresa.json
│   ├── colaboradores.json
│   └── ...
├── conhecimento/                 ← memorias IA, knowledge sources/chunks/entities/relations
│   ├── ia_memorias.json
│   └── ...
├── conversas/                    ← historico de chats IA
│   ├── ia_conversas.json
│   └── ia_mensagens.json
└── config/                       ← configuracao_backup
    └── configuracao_backup.json
```

### Fluxos

| Acao | O que acontece |
|------|----------------|
| **Backup Agora** | `createSnapshot('manual')` → ZIP na pasta configurada |
| **Auto-backup fechar** | `createSnapshot('auto_close')` → ZIP automatico |
| **Auto-backup intervalo** | `createSnapshot('auto_intervalo')` → ZIP periodico |
| **IA "faz backup"** | `createSnapshot('ia')` → ZIP via tool |
| **Maquina do Tempo** | `listSnapshots()` → lista ZIPs + JSONs legados → `restoreSnapshot()` |
| **Importar** | File picker → `parseBackupFile()` + `importFromData()` (ZIP ou JSON legado) |

### Retrocompatibilidade

- `listSnapshots()` le tanto `escalaflow-backup-*.zip` quanto `snapshot-*.json` antigos
- `parseBackupFile()` aceita ZIP, JSON flat (snapshot) e JSON nested (export legado com `.dados`)
- Import com transaction safety (`session_replication_role = 'replica'`)

### Arquivos chave

| Arquivo | Papel |
|---------|-------|
| `src/main/backup.ts` | Fonte unica: `BACKUP_CATEGORIAS`, `IMPORT_ORDER`, create/list/restore/parse/import |
| `src/main/tipc.ts` → `dadosImportar` | File picker → delega pra `parseBackupFile` + `importFromData` |
| `src/main/tipc.ts` → 7 handlers `backup.*` | Config, listar, criar, restaurar, deletar, pasta |
| `ConfiguracoesPagina.tsx` | UI: toggle auto-backup, pasta, botoes |
| `TimeMachineModal.tsx` | UI: navega/restaura snapshots |

---

## Ciclo V3 + Intermitente Tipo A/B — Estado atual

O sistema de ciclos passou por refatoracao significativa:

- **domingo_ciclo**: removido do `RegraHorarioColaborador`. Calculado automaticamente pela bridge (`calcularCicloDomingo`).
- **XOR folga variavel**: offset NEGATIVO (mesma semana). `constraints.py` OFFSET = {SEG:-6..SAB:-1}.
- **folga_fixa=DOM**: guards implementados no solver, bridge e TS.
- **Preview Nivel 1**: funciona no SetorDetalhe via `previewNivel1` useMemo + `converterNivel1ParaEscala`.

### Intermitente Tipo A (fixo) vs Tipo B (rotativo)

Detectado automaticamente por `folga_variavel_dia_semana`:
- **Tipo A** (`null`): dias fixos via regra de horario. Fora do pool rotativo. Cobertura garantida se tem DOM.
- **Tipo B** (`!= null`): participa do ciclo domingo. XOR: trabalha DOM → folga variavel, nao trabalha DOM → trabalha variavel.
- Dias sem regra = **NT (Nao Trabalha)** — HARD, inviolavel.
- Tipo B e **pre-calculado** na bridge como `pinned_folga_externo` (determinístico, sem solver search).
- `folga_fixa` e SEMPRE null pra intermitente.

### Calculo de ciclo domingo — 6 locais (manter sincronizados!)

O calculo `N/gcd(N,K)` existe em 6 locais independentes. Se mudar a logica de quem entra no pool, atualizar TODOS:

1. `SetorDetalhe.tsx:setorSimulacaoInfo` — N/K pro preview
2. `simula-ciclo.ts:gerarCicloFase1` — grid T/F (spacing implicito)
3. `solver-bridge.ts:calcularCicloDomingo` — ratio por pessoa (thresholds)
4. `solver_ortools.py:compute_cycle_length_weeks` — Phase 1 diagnostico
5. `solver_ortools.py:_compute_cycle_weeks_fast` — output diagnostico
6. `ciclo-grid-converters.ts:escalaParaCicloGrid` — grid escala oficial

### Pipeline de geracao — doc canonico

Ver `specs/ANALYST_PIPELINE_SOLVER_COMPLETO.md` para mapeamento completo de:
- Preview TS → Phase 1 CP-SAT → Passes 1/1b/2/3 → Validador
- Onde pins sao fixados e estripados
- Duplicacoes de logica
- Tabela de regras por etapa

## Checklist antes de commitar

- [ ] `npm run typecheck` retorna 0 erros
- [ ] `snake_case` em todo campo banco/IPC/TS
- [ ] Novos handlers IPC registrados em `tipc.ts`
- [ ] Novos tipos adicionados em `src/shared/types.ts`
- [ ] Nenhum `console.log` de debug esquecido no código
- [ ] Componentes shadcn verificados antes de criar div soup
- [ ] Layout chain intacto (ver "Layout Contract") — sem `overflow-y-auto` em páginas, sem `scrollIntoView`
- [ ] Novas tools IA: schema Zod + handler + entry no IA_TOOLS + TOOL_SCHEMAS
- [ ] TOOL_SCHEMAS sincronizado com IA_TOOLS (30 entries)
