# EscalaFlow

App desktop offline para geração automática de escalas de trabalho em varejo, com motor de compliance CLT/CCT e assistente IA integrado para gestores de RH não técnicos.

---

## O que o sistema entrega

- Geração automática de escala otimizada por período (motor Python OR-Tools CP-SAT)
- 20 regras CLT/CCT aplicadas automaticamente (HARD bloqueantes + SOFT alertas + antipatterns)
- 35 regras configuráveis por empresa (Engine de Regras com override granular)
- Assistente IA integrado (Gemini/OpenRouter) com 34 tools — Chat RH contextual ao sistema
- Knowledge Layer com RAG: embeddings locais (ONNX), knowledge graph, memórias persistentes
- Grid 15 minutos com simulação iterativa (click alterna TRABALHO/FOLGA, recalcula em tempo real)
- Regras individuais por colaborador (janela horária, ciclo domingo, folga fixa, exceções por data)
- Cores de posto/função na grid + legenda visual
- Ciclo rotativo: detecção, salvamento e geração por modelo
- Oficialização com bloqueio de violações críticas
- Export HTML self-contained para impressão (A4 landscape, com almoço)
- Backup seletivo em ZIP compactado (cadastros, conhecimento, histórico de chat — com toggles)
- Histórico de conversas IA persistente com compaction de sessões longas
- Auto-update via GitHub Releases
- Tour guiado de 14 passos para novos usuários
- Dark mode 100% funcional
- 13 páginas, 90+ IPC handlers, 7 formulários com validação Zod
- **100% offline** — sem login, sem internet, sem servidor

---

## Stack

| Camada | Tecnologia | Versão |
|--------|-----------|--------|
| Shell | Electron | 34 |
| Build | electron-vite | 3 |
| IPC | @egoist/tipc (type-safe) | 0.3 |
| Database | PGlite (Postgres 17 WASM) + pgvector | 0.3 |
| Embeddings | @huggingface/transformers (multilingual-e5-small) | local ONNX |
| Motor | Python OR-Tools CP-SAT | via bridge TS → stdin/stdout JSON |
| IA | Vercel AI SDK + Gemini/OpenRouter | v6 / 34 tools |
| Frontend | React | 19 |
| Estilo | Tailwind CSS + shadcn/ui | 3 / 24 components |
| Estado | Zustand | 5 |
| Forms | react-hook-form + Zod | 7 + 4 |
| Router | React Router | v7 |
| Update | electron-updater | 6 |
| CI/CD | GitHub Actions | Mac + Windows automático |

---

## Setup

```bash
npm install    # instala dependências
npm run dev    # abre o app Electron com hot reload (sem reset de banco)
```

O banco PGlite (Postgres WASM) é criado automaticamente no primeiro run com seed de contratos CLT, feriados nacionais, perfis horário e 35 regras do motor.

> **Regra de ouro (dev):** o banco de desenvolvimento é tratado como fonte de verdade.  
> `npm run dev` e os CLIs **nunca devem resetar ou reseedar o banco automaticamente**.  
> Qualquer reset/seed só acontece via comandos explícitos (`db:reset`, `db:seed*`, scripts de testes).

---

## Configurar o Assistente IA (Gemini)

1. Acesse [aistudio.google.com/apikey](https://aistudio.google.com/apikey)
2. Crie uma API Key (formato: `AIza...`)
3. No app: **Configurações** → **Assistente IA** → cole a key, escolha o modelo → **Salvar**

> O tier gratuito do Gemini é suficiente para uso interno de RH.

---

## Comandos

```bash
# Desenvolvimento
npm run dev              # dev com hot reload (usa o banco atual, sem reset)
npm run dev:seed1        # dev usando dataset seed1 (SEED_DATASET=seed1)
npm run dev:seed2        # dev usando dataset seed2 (SEED_DATASET=seed2)
npm run build            # build de produção
npm run clean            # rm -rf out tmp .vite
npm run clean:dev        # clean + dev

# Verificação
npm run typecheck        # TS check node + web
npm run test             # vitest run (unit tests)
npm run test:watch       # vitest em modo watch
npm run test:coverage    # vitest com cobertura
npm run test:e2e         # Playwright E2E tests

# IA
npm run test:ia:eval     # Roda evals das tools IA
npm run test:ia:live     # Smoke test IA com API real
npm run ia:chat          # CLI interativo para testar IA

# Motor — CLI dev (principal ferramenta de debug)
npm run solver:cli -- list                           # lista setores (usa banco atual)
npm run solver:cli -- 2                              # roda setor 2 (1 semana, banco atual)
npm run solver:cli -- 2 2026-03-02 2026-03-08        # periodo especifico
npm run solver:cli -- 1 2026-03-02 2026-04-26        # 8 semanas
npm run solver:cli -- 2 --mode otimizado             # solver com mais tempo
npm run solver:cli -- 2 --dump                       # salva input JSON em tmp/
npm run solver:cli -- 2 --json                       # output JSON raw (pipe)

# Motor — outros
npm run solver:test      # smoke test E2E (bridge TS → Python)
npm run solver:test:parity # teste de paridade CLI solver real ↔ validador TS
npm run solver:build     # compila binario Python (PyInstaller)

# Banco
npm run db:reset         # deleta e recria banco (usar só quando explicitamente pedido)
# (futuros scripts db:seed* devem ser sempre opt-in e nunca acoplados a dev/CLI)

# Distribuição (local)
npm run dist:mac         # gera .dmg (macOS)
npm run dist:win         # gera .exe installer (Windows)
npm run dist:linux       # gera .AppImage (Linux)
```

---

## Solver CLI — Ferramenta de Dev

O `solver:cli` roda o motor OR-Tools direto do terminal, sem precisar abrir o app Electron. Usa o banco real em `out/data/escalaflow-pg` (criado na primeira execucao do app).

**Pra que serve:**
- Testar escalas rapidamente durante desenvolvimento
- Debugar problemas de cobertura, violacoes e infeasibility
- Comparar resultados entre modos (rapido vs otimizado)
- Exportar input JSON pra analise manual (`--dump`)

**O que mostra no output:**
1. **Status** — OPTIMAL / FEASIBLE / INFEASIBLE com tempo, pass usado, capacidade vs demanda
2. **Indicadores** — cobertura %, pontuacao, equilibrio, violacoes HARD/SOFT
3. **Escala por colaborador** — tabela formatada com dia da semana, horarios, FOLGA, total semanal e delta vs contrato (com cores)
4. **Cobertura de demanda** — por dia, mostrando faixas com falta de pessoal agregadas
5. **Horas por semana** — breakdown semanal por colaborador (se periodo > 7 dias)

**Exemplo:**
```
  ── ESCALA POR COLABORADOR ─────────────────
               │ SEG 02      │ TER 03      │ ... │ DOM 08      │ TOTAL
  ─────────────┼─────────────┼─────────────┼─────┼─────────────┼──────
  Alex         │ 08:00-19:30 │ 08:00-19:30 │ ... │ 07:00-12:00 │ 42h45 (-75min)
  Mateus       │  FOLGA      │ 10:00-19:30 │ ... │ 07:00-12:00 │ 42h45 (-75min)

  ── COBERTURA DE DEMANDA ───────────────────
  ✓ SEG 02 — 100% coberto (50 slots)
  ✗ SAB 07 — 62% coberto (19 slots com falta)
    12:00-14:00: precisa 2, tem 0 (falta 2)
    14:00-18:00: precisa 3, tem 0 (falta 3)
```

**Flags:**

| Flag | Descricao |
|------|-----------|
| `--mode rapido\|otimizado` | Tempo do solver (default: rapido) |
| `--dump` | Salva input JSON em `tmp/solver-input-setor-N.json` |
| `--json` | Output JSON raw (usar com `npm run --silent` + `2>/dev/null` pra pipe limpo) |

---

## Teste de Paridade Solver ↔ Validador

O projeto tem um teste de regressao pesado para blindar a consistencia entre o solver Python e o validador TypeScript:

```bash
npm run solver:test:parity
```

**O que ele faz:**
- cria um banco isolado temporario;
- roda seed core + seed local real;
- executa o `solver:cli` real em modo `OFFICIAL` para cenarios de **Acougue** e **Rotisseria**;
- persiste o resultado e revalida tudo com `validarEscalaV3()`;
- falha se o solver relaxar regra inegociavel, quebrar invariantes de almoco ou divergir do validador alem do toleravel.

**Quando rodar obrigatoriamente:**
- mudou `solver/solver_ortools.py` ou `solver/constraints.py`;
- mudou policy de regras (`HARD` / `SOFT` / `OFFICIAL` / `EXPLORATORY`);
- mudou validador em `src/main/motor/`;
- mudou persistencia/resumo oficial da escala;
- mudou geracao/config de solver no renderer ou na IA.

**Arquivos de referencia:**
- `tests/main/solver-cli-parity.spec.ts`
- `tests/main/rule-policy.spec.ts`

Esse teste e mais lento que o smoke (`~3 min` no ambiente local), entao ele existe para pegar regressao estrutural, nao para substituir todos os testes rapidos.

---

## CI/CD — Releases Automatizados

O projeto usa **GitHub Actions** para build cross-platform. Cada push de tag `v*` dispara builds paralelos no macOS e Windows.

### Como lançar uma versão

```bash
# 1. Bump version em package.json
# 2. Commit + tag + push
git add package.json && git commit -m "chore: bump v1.2.1"
git tag v1.2.1 && git push && git push --tags

# 3. Esperar ~15 min (GitHub Actions compila Mac + Windows)
# 4. Ir em github.com/nmarcofernandess/escalaflow/releases → Publicar o draft
```

### O que acontece no CI

```
Tag v* pushada → GitHub Actions
  ├─ macOS runner:  Python 3.12 → PyInstaller → solver nativo → DMG
  └─ Windows runner: Python 3.12 → PyInstaller → solver.exe nativo → NSIS installer
       ↓
  Draft Release com artefatos prontos para download
```

O solver Python é compilado **nativamente em cada OS** — sem cross-compilation, sem binários incompatíveis.

### Auto-Update

O app verifica atualizações ao iniciar (5s delay). Se há versão nova, baixa em background e mostra botão "Reiniciar e Instalar" nas Configurações.

---

## Tutorial operacional

### 1. Cadastre setores

Em **Setores**, crie os departamentos (Caixa, Açougue, Padaria). Defina horário de funcionamento.

### 2. Defina demandas

Dentro de cada setor, cadastre faixas de demanda:
- 08:00–10:00 = 3 pessoas
- 10:00–15:00 = 5 pessoas
- 15:00–19:30 = 4 pessoas

### 3. Cadastre colaboradores

Em **Colaboradores**, adicione funcionários com nome, sexo e tipo de contrato. Horas semanais são preenchidas automaticamente pelo template.

### 4. Gere a escala

Em **Setores → [Setor] → Escala**, selecione o período e clique em **Gerar Escala**. O motor propõe uma escala otimizada automaticamente.

### 5. Ajuste se quiser

Clique em qualquer célula da grid para alternar TRABALHO/FOLGA. O sistema recalcula indicadores em tempo real.

### 6. Oficialize

Com 0 violações HARD, clique em **Oficializar**. A escala é travada e pode ser exportada/impressa.

---

## Regras de compliance (motor)

### HARD (bloqueiam oficialização)

| Código | Regra |
|--------|-------|
| H1 | Max 6 dias consecutivos de trabalho |
| H2 | Min 11h entre jornadas |
| H3 | Rodízio domingo (mulher: max 1 consecutivo, homem: max 2) → SOFT |
| H4 | Max jornada diária 10h (CLT absoluto) |
| H5 | Contrato max dia (estagiário 4h, etc) |
| H6 | Estagiário nunca trabalha domingo/feriado |
| H7 | Menor aprendiz: nunca noturno (22h–5h), nunca hora extra |
| H8 | Grid 15 minutos em toda alocação |
| H9–H18 | Regras adicionais CLT/CCT (ver `docs/motor-regras.md`) |

### SOFT (alertas, não bloqueiam)

Desvio de meta semanal, preferência de dia/turno, cobertura de demanda, consistência de turno, compensação 9h45.

### Antipatterns (12)

Padrões operacionais indesejáveis detectados e penalizados pelo motor.

**RFC completo:** `docs/motor-regras.md`

---

## Modelo de dados

### Entidades operacionais (snake_case ponta a ponta)

| Entidade | Tabela | Descrição |
|----------|--------|-----------|
| Empresa | `empresa` | Config global (singleton) |
| TipoContrato | `tipos_contrato` | Templates: CLT 44h, 36h, 30h, Estagiário 20h |
| Setor | `setores` | Departamentos da empresa |
| Demanda | `demandas` | Faixas horárias com mínimo de pessoas |
| Colaborador | `colaboradores` | Funcionários vinculados a setor + contrato |
| Excecao | `excecoes` | Férias, atestado, bloqueio |
| Escala | `escalas` | RASCUNHO → OFICIAL → ARQUIVADA |
| Alocacao | `alocacoes` | Um dia de trabalho/folga de uma pessoa |
| Funcao | `funcoes` | Postos de trabalho (com cor na grid) |
| Feriado | `feriados` | Feriados com flag `proibido_trabalhar` (CCT) |

### IA e Knowledge Layer

| Tabela | Descrição |
|--------|-----------|
| `ia_conversas` | Histórico de conversas IA (status, resumo compactado) |
| `ia_mensagens` | Mensagens individuais (role, content, tool_calls, anexos) |
| `ia_memorias` | Memórias curtas do RH (max 20, injetadas no discovery) |
| `knowledge_sources` | Documentos importados (manual, session, auto_extract) |
| `knowledge_chunks` | Chunks com embedding vector(768) + FTS português |
| `knowledge_entities` | Entidades extraídas via LLM (pessoa, setor, regra…) |
| `knowledge_relations` | Relações entre entidades (trabalha_em, regido_por…) |

---

## Estrutura do projeto

```
escalaflow/
├── src/
│   ├── main/                    # Electron Main Process (Node.js)
│   │   ├── index.ts             # bootstrap, BrowserWindow, auto-updater
│   │   ├── tipc.ts              # 90+ IPC handlers type-safe (@egoist/tipc)
│   │   ├── db/                  # PGlite: schema, migrations, seed, conexão
│   │   ├── ia/                  # Chat RH: system-prompt, 34 tools, discovery, cliente, session-processor
│   │   ├── knowledge/           # RAG: embeddings (ONNX), ingest, search, graph
│   │   └── motor/               # solver-bridge.ts (→ Python) + validador.ts
│   │
│   ├── preload/                 # contextBridge (IPC seguro)
│   ├── renderer/src/            # React 19 + Vite (13 páginas, shadcn/ui, Zustand)
│   └── shared/                  # Types + constants compartilhados (main + renderer)
│
├── solver/                      # Motor Python OR-Tools CP-SAT
│   ├── solver_ortools.py        # stdin JSON → stdout JSON
│   ├── constraints.py           # 20 HARD + SOFT constraints
│   └── escalaflow-solver.spec   # PyInstaller spec
│
├── solver-bin/                  # Binário compilado (PyInstaller)
├── scripts/
│   ├── solver-cli.ts            # CLI dev do motor (npm run solver:cli)
│   └── ...                      # db-reset, knowledge-seed, etc
├── tests/                       # Unit (vitest), evals IA, E2E (Playwright)
├── docs/                        # Docs canônicos (motor, release, IA)
│
├── .github/workflows/
│   └── release.yml              # CI/CD: Mac + Windows via GitHub Actions
│
├── electron-builder.yml         # Config de build e publish
└── package.json
```

---

## Backup e Restauração

O sistema exporta dados como **ZIP compactado** com 3 categorias seletivas (toggles na tela de Configurações):

| Categoria | Default | O que inclui |
|-----------|---------|-------------|
| Cadastros e escalas | ON | Empresa, setores, colaboradores, escalas, regras, feriados, config IA |
| Conhecimento e memórias | ON | Documentos importados, memórias IA, knowledge graph |
| Histórico de conversas | OFF | Todas as conversas com a assistente IA |

O import aceita `.zip` (novo) e `.json` (legado). Ao restaurar, **só substitui as categorias presentes no backup** — dados não incluídos permanecem intactos.

---

## Troubleshooting

- **App não abre:** `npm run build` primeiro, depois `npm run dev`
- **Banco corrompido:** Delete `data/pglite/` e reinicie. Seed roda automaticamente
- **Typecheck falha:** `npm run typecheck` mostra erros separados por node e web
- **Motor trava:** Timeout de 30s protege. Verifique dados do setor (demandas, colaboradores)
- **Dark mode quebrado:** Cores usam tokens semânticos de `cores.ts`. Se adicionou cor nova, inclua `dark:` variant
- **Mac "corrompido"/Gatekeeper:** Abra o `LEIA ANTES DE INSTALAR.txt` dentro do `.dmg` e rode o comando indicado no Terminal

---

## Documentação

| Arquivo | Conteúdo |
|---------|----------|
| `.claude/CLAUDE.md` | Instruções para Claude Code |
| `docs/motor-regras.md` | RFC canônico do motor (20 HARD, SOFT, antipatterns) |
| `docs/motor-spec.md` | Spec técnica do motor (edge cases, entrada/saída) |
| `docs/release.md` | Guia completo de releases e auto-update |
| `docs/solver-consistency.md` | Guia de teste de paridade solver/validador |
| `docs/ia-sistema.md` | Como o sistema de IA funciona |
| `docs/ia-resumo-aba.md` | Resumo aba usuário vs IA |
