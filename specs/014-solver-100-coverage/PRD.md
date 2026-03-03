# PRD: Solver 100% Coverage — Demanda Realista + KPI Efetiva

> **Workflow:** feature
> **Budget sugerido:** medium
> **Criado em:** 2026-03-02T12:00:00-03:00
> **Fonte:** gather
> **Referencia:** `docs/BUILD_SOLVER_100_COVERAGE.md`

---

## Visao Geral

O solver roda ~93% de cobertura no Acougue (8 semanas, balanceado). Diagnostico forense mostrou que **60.3% dos gaps sao em transicoes** (cafe abertura/fechamento + stagger almoco), nao bugs do solver. A demanda esta pedindo o impossivel em momentos de transicao — 100% estrita e matematicamente inviavel com 5 pessoas quando todos precisam de cafe (15min) e almoco (1h) e a demanda nao abre margem.

Plano de 3 camadas:
1. **Fase 1** — Ajustar demanda seed pra valores realistas (maior impacto, trivial)
2. **Fase 2** — KPI `cobertura_efetiva_percent` no output do solver (visibilidade)
3. **Fase 3** — Campo `tol_pessoas` no solver (backlog condicional)

### Fixes ja feitos (contexto desta sessao)
- `seed-local.ts`: `tolerancia_semanal_min` 90 -> 30 (fix H10 weekly hours)
- `solver_ortools.py`: HARD minimum headcount por domingo (fix Sunday coverage)
- Resultado atual: 8/8 domingos 100%, horas 43h30-44h30, cobertura ~92-93%

---

## Requisitos Funcionais

### Fase 1 — Ajustar Demanda Seed (maior impacto)

- [ ] Em `src/main/db/seed-local.ts` -> `acouguePadrao`, ajustar demandas SEG-SAB:
  - `07:00-07:30`: `min_pessoas` 2 -> 1 (cafe abertura — 15min tolerancia)
  - `11:00-12:00`: `min_pessoas` 3 -> 2 (stagger almoco — permite 1 pessoa comecar almoco)
  - `19:00-19:30`: `min_pessoas` 2 -> 1 (cafe fechamento — 15min tolerancia)
- [ ] Domingo inalterado (jornada <=6h, sem almoco, headcount HARD ja garante 3)
- [ ] Rodar `npm run db:reset` + `npm run solver:cli -- 2 2026-03-02 2026-04-26` e verificar cobertura

### Fase 2 — KPI cobertura_efetiva

- [ ] Em `solver/solver_ortools.py` -> `extract_solution()`: calcular `cobertura_efetiva_percent` que ignora gaps de 1 pessoa em slots de transicao (cafe abertura/fechamento + pre-almoco)
  - Logica: identificar slots cujo `hora_inicio` esta em faixas de transicao conhecidas (07:00-07:30, 11:00-12:00, 19:00-19:30) e cujo gap == 1 -> nao contar como deficit efetivo
  - Formula: `cobertura_efetiva = (demanda_total - deficit_efetivo) / demanda_total * 100`
- [ ] Em `src/shared/types.ts`: adicionar `cobertura_efetiva_percent: number` em `SolverOutputIndicadores`
- [ ] Em `scripts/solver-cli.ts`: exibir ambos indicadores lado a lado na secao INDICADORES

### Fase 3 — tol_pessoas no Solver (BACKLOG CONDICIONAL)

> **Condicao:** So implementar se Fase 1 nao atingir 97%+. Se atingir, fica no backlog.

- [ ] `src/shared/types.ts`: +`tol_pessoas?: number` (0-2, default 0) em `DemandaSegmento`
- [ ] `src/main/db/schema.ts`: +coluna `tol_pessoas INTEGER DEFAULT 0` em tabela `demandas`
- [ ] `src/main/motor/solver-bridge.ts`: passar `tol_pessoas` no JSON de input pro solver
- [ ] `solver/constraints.py` -> `add_demand_soft()`: deficit usa `max(0, target - tol - sum(work))` em vez de `max(0, target - sum(work))`
- [ ] `solver/solver_ortools.py`: parsear `tol_pessoas` da demanda de input
- [ ] `src/main/db/seed-local.ts`: setar `tol_pessoas=1` nas faixas de transicao

---

## Criterios de Aceitacao

- [ ] Apos Fase 1: cobertura estrita >= 95% no Acougue (8 semanas, balanceado)
- [ ] Apos Fase 1: domingos continuam 100% (HARD constraint)
- [ ] Apos Fase 1: horas semanais entre 43h30-44h30 (sem regressao)
- [ ] Apos Fase 1: 0 violacoes HARD
- [ ] Apos Fase 2: CLI exibe `cobertura_efetiva_percent` ao lado de `cobertura_percent`
- [ ] Apos Fase 2: `npm run typecheck` retorna 0 erros
- [ ] Se Fase 3 implementada: `cobertura_efetiva_percent` >= 99% no Acougue

---

## Constraints

- `seed-local.ts` e gitignored — mudancas nao vao pro repo, sao de dev local
- O solver Python e o binario compilado via PyInstaller — Fase 2 requer mudanca no `.py` fonte (nao no binario)
- Fase 3 envolve migration de schema — so implementar se realmente necessario
- Domingos tem jornada <=6h sem almoco — nao precisam de ajuste de demanda
- Nunca alterar constraints HARD existentes — apenas ajustar demanda e KPI

---

## Fora do Escopo

- Mudar o solver Python para otimizar gaps de transicao (o solver esta correto)
- Alterar perfis de horario ou contratos de trabalho
- Mudar a UI de escalas (`EscalaPagina.tsx`) — mostrar KPI efetiva no frontend e backlog separado
- Recompilar o binario PyInstaller (`npm run solver:build`) — so necessario pra release
- Ajustar demandas de outros setores (apenas Acougue neste spec)

---

## Servicos Envolvidos

- [ ] Backend (seed-local.ts, solver-bridge.ts)
- [ ] Database (schema.ts — apenas se Fase 3)
- [ ] Motor Python (solver_ortools.py, constraints.py)
- [ ] CLI (solver-cli.ts)
- [ ] Shared types (types.ts)

---

## Arquivos Afetados por Fase

### Fase 1

| Arquivo | Mudanca |
|---------|---------|
| `src/main/db/seed-local.ts` | Ajustar 3 faixas de `acouguePadrao` |

### Fase 2

| Arquivo | Mudanca |
|---------|---------|
| `solver/solver_ortools.py` | `extract_solution()` calcula `cobertura_efetiva_percent` |
| `src/shared/types.ts` | +`cobertura_efetiva_percent` em `SolverOutputIndicadores` |
| `scripts/solver-cli.ts` | Exibir ambos indicadores |

### Fase 3 (condicional)

| Arquivo | Mudanca |
|---------|---------|
| `src/shared/types.ts` | +`tol_pessoas` em `DemandaSegmento` |
| `src/main/db/schema.ts` | +coluna `tol_pessoas` em `demandas` |
| `src/main/motor/solver-bridge.ts` | Passar `tol_pessoas` no JSON |
| `solver/constraints.py` | `add_demand_soft()` usa tolerancia |
| `solver/solver_ortools.py` | Parsear `tol_pessoas` |
| `src/main/db/seed-local.ts` | Setar `tol_pessoas=1` em transicoes |

---

## Budget Sugerido

**Recomendacao:** medium — Fase 1 e trivial (1 arquivo), Fase 2 e baixa complexidade (3 arquivos, logica simples), Fase 3 e condicional. Nenhuma mudanca arquitetural, mas toca Python + TS + CLI.

---

## Notas Adicionais

- BUILD completo com diagnostico forense e diagramas: `docs/BUILD_SOLVER_100_COVERAGE.md`
- O solver NAO esta errado — a demanda e que pede o impossivel em transicoes
- 60.3% dos gaps sao estruturais (cafe + almoco), nao falha de otimizacao
- Fase 1 sozinha deve resolver a maior parte — rodar e medir antes de implementar Fase 3
- Validacao: `npm run solver:cli -- 2 2026-03-02 2026-04-26` (Acougue, 8 semanas)
