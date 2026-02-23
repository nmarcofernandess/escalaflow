# EscalaFlow

App desktop offline para geração automática de escalas de trabalho em supermercados, com motor de compliance CLT/CCT e assistente IA integrado para gestores de RH não técnicos.

---

## O que o sistema entrega

- Geração automática de escala otimizada por período (motor Python OR-Tools CP-SAT)
- 20 regras CLT/CCT aplicadas automaticamente (HARD bloqueantes + SOFT alertas + antipatterns)
- 35 regras configuráveis por empresa (Engine de Regras com override granular)
- Assistente IA integrado (Gemini) com 28 tools — Chat RH contextual ao sistema
- Grid 15 minutos com simulação iterativa (click alterna TRABALHO/FOLGA, recalcula em tempo real)
- Regras individuais por colaborador (janela horária, ciclo domingo, folga fixa, exceções por data)
- Cores de posto/função na grid + legenda visual
- Ciclo rotativo: detecção, salvamento e geração por modelo
- Oficialização com bloqueio de violações críticas
- Export HTML self-contained para impressão (A4 landscape, com almoço)
- Histórico de conversas IA persistente (SQLite)
- Auto-update via GitHub Releases
- Tour guiado de 14 passos para novos usuários
- Dark mode 100% funcional
- 11 páginas, 80+ IPC handlers, 7 formulários com validação Zod
- **100% offline** — sem login, sem internet, sem servidor

---

## Stack

| Camada | Tecnologia | Versão |
|--------|-----------|--------|
| Shell | Electron | 34 |
| Build | electron-vite | 3 |
| IPC | @egoist/tipc (type-safe) | 0.3 |
| Database | SQLite via better-sqlite3 | 11 |
| Motor | Python OR-Tools CP-SAT | via bridge TS → stdin/stdout JSON |
| IA | Vercel AI SDK + Gemini/OpenRouter | v6 / 28 tools |
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
npm run dev    # abre o app Electron com hot reload
```

O banco SQLite é criado automaticamente no primeiro run com seed de contratos CLT, feriados nacionais, perfis horário e 35 regras do motor.

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
npm run dev              # dev com hot reload
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

# Motor
npm run solver:test      # smoke test motor Python no DB real
npm run solver:build     # compila binário Python (PyInstaller)

# Banco
npm run db:reset         # deleta e recria banco

# Distribuição (local)
npm run dist:mac         # gera .dmg (macOS)
npm run dist:win         # gera .exe installer (Windows)
npm run dist:linux       # gera .AppImage (Linux)
```

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
| H9–H18 | Regras adicionais CLT/CCT (ver `docs/MOTOR_V3_RFC.md`) |

### SOFT (alertas, não bloqueiam)

Desvio de meta semanal, preferência de dia/turno, cobertura de demanda, consistência de turno, compensação 9h45.

### Antipatterns (12)

Padrões operacionais indesejáveis detectados e penalizados pelo motor.

**RFC completo:** `docs/MOTOR_V3_RFC.md`

---

## Modelo de dados

10 entidades, snake_case ponta a ponta:

| Entidade | Tabela | Descrição |
|----------|--------|-----------|
| Empresa | `empresa` | Config global (singleton) |
| TipoContrato | `tipos_contrato` | Templates: CLT 44h, 36h, 30h, Estagiário 20h |
| Setor | `setores` | Departamentos do supermercado |
| Demanda | `demandas` | Faixas horárias com mínimo de pessoas |
| Colaborador | `colaboradores` | Funcionários vinculados a setor + contrato |
| Excecao | `excecoes` | Férias, atestado, bloqueio |
| Escala | `escalas` | RASCUNHO → OFICIAL → ARQUIVADA |
| Alocacao | `alocacoes` | Um dia de trabalho/folga de uma pessoa |
| Funcao | `funcoes` | Postos de trabalho (com cor na grid) |
| Feriado | `feriados` | Feriados com flag `proibido_trabalhar` (CCT) |

---

## Estrutura do projeto

```
escalaflow/
├── src/
│   ├── main/                    # Electron Main Process (Node.js)
│   │   ├── index.ts             # bootstrap, BrowserWindow, auto-updater
│   │   ├── tipc.ts              # 80+ IPC handlers type-safe (@egoist/tipc)
│   │   ├── db/                  # SQLite: schema, seed, conexão
│   │   ├── ia/                  # Chat RH: system-prompt, 28 tools, discovery, cliente
│   │   └── motor/               # solver-bridge.ts (→ Python) + validador.ts
│   │
│   ├── preload/                 # contextBridge (IPC seguro)
│   ├── renderer/src/            # React 19 + Vite (11 páginas, shadcn/ui, Zustand)
│   └── shared/                  # Types + constants compartilhados (main + renderer)
│
├── solver/                      # Motor Python OR-Tools CP-SAT
│   ├── solver_ortools.py        # stdin JSON → stdout JSON
│   ├── constraints.py           # 20 HARD + SOFT constraints
│   └── escalaflow-solver.spec   # PyInstaller spec
│
├── solver-bin/                  # Binário compilado (PyInstaller)
├── tests/                       # Unit (vitest), evals IA, E2E (Playwright)
├── docs/                        # RFCs, guias, arquitetura
├── specs/                       # Specs por feature
│
├── .github/workflows/
│   └── release.yml              # CI/CD: Mac + Windows via GitHub Actions
│
├── electron-builder.yml         # Config de build e publish
└── package.json
```

---

## Troubleshooting

- **App não abre:** `npm run build` primeiro, depois `npm run dev`
- **Banco corrompido:** Delete `data/escalaflow.db` e reinicie. Seed roda automaticamente
- **Typecheck falha:** `npm run typecheck` mostra erros separados por node e web
- **Motor trava:** Timeout de 30s protege. Verifique dados do setor (demandas, colaboradores)
- **Dark mode quebrado:** Cores usam tokens semânticos de `cores.ts`. Se adicionou cor nova, inclua `dark:` variant
- **Mac "vírus" (Gatekeeper):** Clique direito no app → Abrir (primeira vez apenas)

---

## Documentação

| Arquivo | Conteúdo |
|---------|----------|
| `.claude/CLAUDE.md` | Instruções para Claude Code |
| `docs/MOTOR_V3_RFC.md` | RFC canônico do motor (20 HARD, SOFT, antipatterns) |
| `docs/COMO_FAZER_RELEASE.md` | Guia completo de releases e auto-update |
| `docs/BUILD_V2_ESCALAFLOW.md` | Arquitetura v2 (referência histórica) |
| `docs/flowai/` | Docs do sistema de IA (tools, prompts, evals) |
| `specs/` | Specs e logs de cada feature implementada |
