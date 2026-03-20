# Solver Budget Dinamico — Design Spec

**Data:** 2026-03-20
**Status:** DRAFT
**Arquivos afetados:** `solver/solver_ortools.py`, `src/main/motor/solver-bridge.ts`

---

## TL;DR

O budget atual do solver e um numero fixo por modo (`rapido=120s`, `balanceado=180s`, etc.) que controla TUDO — inclusive se o solver consegue ENCONTRAR uma solucao. Problemas pequenos desperdicam tempo; problemas grandes retornam INFEASIBLE sem necessidade. A proposta e dividir o budget em duas fases: **Fase A** (encontrar qualquer solucao viavel — budget escala com tamanho do problema) e **Fase B** (melhorar a solucao — controlada pelo modo). O modo deixa de ser um limitador e passa a ser um "quanto polir".

---

## Problema

### Estado atual

```python
MODE_PROFILES = {
    "rapido":     {"budget": 120,  "gap": 0.05},
    "balanceado": {"budget": 180,  "gap": 0.02},
    "otimizado":  {"budget": 600,  "gap": 0.005},
    "maximo":     {"budget": 1800, "gap": 0.001},
}
```

O `total_budget` e dividido estaticamente entre passes:
- Pass 1: 50% do budget
- Pass 2: 30% do budget
- Pass 3: 20% do budget

Cada pass chama `solver.solve(model)` com `max_time_in_seconds = pass_time`.

### Sintomas

| Cenario | Problema | Root cause |
|---------|----------|------------|
| 4 pessoas, 1 semana, modo rapido | Resolve em 2s mas ocupa 45s+ esperando gap convergir | Budget fixo ignora tamanho do problema |
| 50 pessoas, 3 meses, modo rapido | INFEASIBLE falso — solver nao teve tempo de ENCONTRAR solucao | Pass 1 = 60s nao e suficiente para o espaco de busca |
| Qualquer tamanho, modo rapido | Cobertura de 72% quando poderia ser 89% com +15s | `_run_with_continuation` tenta dobrar, mas esbarra no cap do modo |
| 5 pessoas, 1 semana, modo otimizado | Usuario espera 10min para algo que ja era OPTIMAL em 8s | Sem early-exit quando solver atinge OPTIMAL |

### Root cause unificado

**O budget nao distingue entre "encontrar solucao" e "melhorar solucao".** O solver do OR-Tools gasta a maior parte do tempo explorando o espaco de busca ate achar a PRIMEIRA solucao viavel. Depois disso, melhorias sao incrementais e rapidas. O budget fixo castiga os dois extremos: problemas triviais esperam demais, problemas grandes nao tem tempo suficiente para a busca inicial.

---

## Arquitetura Proposta: Fase A + Fase B

### Visao geral

```
                    FASE A                         FASE B
             ┌─────────────────┐          ┌──────────────────┐
             │ Encontrar ANY   │          │ Melhorar solucao │
             │ solucao viavel  │   ──►    │ (otimizar obj)   │
             │                 │          │                  │
             │ Budget: f(C,D,S)│          │ Budget: MODO     │
             │ Gap: sem limite │          │ Gap: MODE gap    │
             └─────────────────┘          └──────────────────┘
                  ↓ INFEASIBLE?                ↓ timeout?
                Proximo pass                Retorna best-so-far
```

### Fase A — "Achar solucao"

**Objetivo:** Encontrar a PRIMEIRA solucao viavel. Nao importa a qualidade.

- **Budget:** escalado pelo tamanho do problema (formula abaixo)
- **Gap:** sem limite (`relative_gap_limit` nao setado, ou 1.0)
- **Criterio de sucesso:** solver reporta `FEASIBLE` ou `OPTIMAL`
- **Criterio de falha:** timeout atingido sem solucao → INFEASIBLE para este pass
- **Deteccao de solucao:** usar `CpSolverSolutionCallback` para saber o instante exato que a primeira solucao e encontrada

### Fase B — "Melhorar solucao"

**Objetivo:** Polir a solucao encontrada na Fase A. Quanto mais tempo, melhor a cobertura e o equilibrio.

- **Budget:** definido pelo modo do usuario (rapido, balanceado, etc.)
- **Gap:** definido pelo modo
- **Criterio de sucesso:** gap atingido OU budget esgotado
- **Early exit:** se solver atinge OPTIMAL antes do budget, retorna imediatamente
- **Entrada:** modelo ja tem a solucao da Fase A como warm-start hint

---

## Formula de Escalonamento (Fase A)

### Dimensoes do problema

```
C = numero de colaboradores ativos no input
D = numero de dias no periodo
S = slots por dia (calculado pelo grid — tipicamente 40-56 para grid 15min)
```

### Proposta: escala linear com piso e teto

```python
PHASE_A_BASE_SECONDS = 5          # piso — problemas triviais
PHASE_A_SCALE_FACTOR = 0.002      # segundos por variavel booleana
PHASE_A_MAX_SECONDS = 300         # teto — 5 min max para busca inicial

def compute_phase_a_budget(C: int, D: int, S: int) -> float:
    """Budget para encontrar primeira solucao viavel."""
    n_vars = C * D * S  # numero de variaveis booleanas work[c,d,s]
    budget = PHASE_A_BASE_SECONDS + PHASE_A_SCALE_FACTOR * n_vars
    return min(budget, PHASE_A_MAX_SECONDS)
```

### Exemplos concretos

| Cenario | C | D | S | Variaveis | Budget Fase A |
|---------|---|---|---|-----------|---------------|
| 4 pessoas, 1 semana, grid 15min | 4 | 7 | 48 | 1,344 | 7.7s |
| 6 pessoas, 2 semanas | 6 | 14 | 48 | 4,032 | 13.1s |
| 12 pessoas, 1 mes | 12 | 30 | 48 | 17,280 | 39.6s |
| 30 pessoas, 2 meses | 30 | 60 | 48 | 86,400 | 177.8s |
| 50 pessoas, 3 meses | 50 | 90 | 48 | 216,000 | 300s (cap) |

**Nota:** O fator `0.002` e uma estimativa conservadora. Deve ser calibrado com benchmarks reais. O ponto e que o budget escala com a complexidade real do modelo, nao com a vontade do usuario.

### Ajuste por complexidade de constraints

Opcionalmente, multiplicar por um fator de complexidade de constraints:

```python
def constraint_complexity_factor(data: dict) -> float:
    """Fator extra quando o modelo tem constraints pesadas."""
    factor = 1.0
    rules = data.get("config", {}).get("rules", {})

    # Ciclo domingo com muitas semanas = mais dificil
    cycle_weeks = _compute_cycle_weeks_fast(...)
    if cycle_weeks >= 4:
        factor *= 1.3

    # Muitas excecoes = espaco de busca menor mas mais constrainado
    n_excecoes = len(data.get("excecoes", []))
    if n_excecoes > 5:
        factor *= 1.2

    # Pinned cells = mais constraints
    n_pinned = len(data.get("pinned_cells", []))
    if n_pinned > 10:
        factor *= 1.1

    return min(factor, 2.0)  # cap em 2x
```

Isso e um refinamento futuro. V1 pode ir so com `C * D * S`.

---

## Redefinicao dos Modos

Os modos passam a controlar APENAS a Fase B (melhoria):

| Modo | Fase B budget | Gap | Semantica |
|------|--------------|-----|-----------|
| `rapido` | 30s | 0.05 | Encontra solucao + polimento rapido. Ideal para preview. |
| `balanceado` | 120s | 0.02 | Bom equilibrio entre tempo e qualidade. Padrao recomendado. |
| `otimizado` | 480s | 0.005 | Busca solucao significativamente melhor. Para geracao final. |
| `maximo` | 1500s | 0.001 | Exploracao pesada. So quando o usuario pede o melhor possivel. |

### Tempo total estimado por cenario

| Cenario | Fase A | rapido | balanceado | otimizado |
|---------|--------|--------|------------|-----------|
| 4 pessoas, 1 sem | ~3s* | ~5s | ~8s | ~15s |
| 12 pessoas, 1 mes | ~20s | ~50s | ~2.5min | ~8.5min |
| 50 pessoas, 3 meses | ~2min | ~2.5min | ~4min | ~10min |

*Fase A retorna mais rapido que o budget calculado quando o problema e pequeno (OPTIMAL em <1s).

### Backward compatibility

```python
# Antigo — significava "budget total fixo"
MODE_PROFILES = {
    "rapido":     {"budget": 120,  "gap": 0.05},
    ...
}

# Novo — significa "budget de MELHORIA apos achar solucao"
MODE_PROFILES = {
    "rapido":     {"improvement_budget": 30,  "gap": 0.05},
    "balanceado": {"improvement_budget": 120, "gap": 0.02},
    "otimizado":  {"improvement_budget": 480, "gap": 0.005},
    "maximo":     {"improvement_budget": 1500, "gap": 0.001},
}
```

O campo `max_time_seconds` do input (override manual via bridge) passa a significar "override do budget TOTAL (Fase A + B)". Se fornecido, substitui o calculo automatico.

---

## Integracao com Multi-Pass

### Estrutura atual dos passes

```
Phase 1 (folga pattern)  →  Pass 1  →  Pass 1b  →  Pass 2  →  Pass 3
     15% budget             50%         reutiliza      30%       20%
```

### Estrutura proposta

Cada pass executa internamente Fase A + Fase B:

```
Phase 1 (folga pattern)  →  Pass 1         →  Pass 1b        →  Pass 2        →  Pass 3
     15s cap                 A(auto) + B(modo)  A(auto) + B(modo)  A(auto) + B(modo)  A(auto) + B(modo)
```

### Divisao de budget entre passes

A Fase A tem budget proprio (baseado em `C*D*S`), calculado UMA VEZ e igual para todos os passes. A Fase B (melhoria) e dividida entre passes com pesos:

```python
PASS_B_WEIGHTS = {
    1:    0.50,   # pass principal — leva mais tempo de melhoria
    "1b": 0.20,   # fallback rapido
    2:    0.20,   # relaxacao
    3:    0.10,   # emergencia
}
```

Exemplo com `balanceado` (improvement_budget=120s) e Fase A=20s:
- Pass 1: Fase A (ate 20s) + Fase B (60s)
- Pass 1b: Fase A (ate 20s) + Fase B (24s)
- Pass 2: Fase A (ate 20s) + Fase B (24s)
- Pass 3: Fase A (ate 20s) + Fase B (12s)

**Nota:** Se um pass atinge OPTIMAL na Fase A e nao precisa de Fase B, o budget de Fase B nao e redistribuido para o proximo pass. Manter simples.

### Comportamento por resultado de Fase A

| Resultado Fase A | Acao |
|-----------------|------|
| OPTIMAL | Pular Fase B — ja e o melhor possivel. Retornar. |
| FEASIBLE | Iniciar Fase B com warm-start da solucao encontrada. |
| INFEASIBLE (timeout) | Marcar pass como falho. Ir pro proximo pass. |
| INFEASIBLE (provado) | Marcar pass como falho. Ir pro proximo pass. |

### Interacao com `_run_with_continuation`

O loop de continuation atual (que dobra budget se cobertura < 90%) e absorvido pela Fase B. Em vez de dobrar budget cegamente, a Fase B ja tem budget generoso de melhoria. Se apos a Fase B a cobertura ainda esta abaixo de `MIN_COVERAGE_THRESHOLD`, o continuation pode rodar com budget adicional, mas limitado a `PHASE_B_CONTINUATION_MAX = 2` tentativas.

```python
def _run_pass_phased(pass_num, relaxations, pinned_folga, phase_a_budget, phase_b_budget, gap_limit):
    # Fase A: encontrar solucao
    result_a = _solve_pass(
        data, pass_num, relaxations,
        max_time=phase_a_budget,
        gap_limit=1.0,  # sem restricao de gap na busca
        num_workers=num_workers,
        pinned_folga=pinned_folga,
    )

    if not result_a.get("sucesso"):
        return result_a  # INFEASIBLE

    if result_a.get("status") == "OPTIMAL":
        return result_a  # ja e perfeito

    # Fase B: melhorar
    # (usar solucao da Fase A como warm-start hint no modelo reconstruido
    #  OU continuar no mesmo solver com budget adicional — ver secao OR-Tools)
    result_b = _solve_pass(
        data, pass_num, relaxations,
        max_time=phase_b_budget,
        gap_limit=gap_limit,
        num_workers=num_workers,
        pinned_folga=pinned_folga,
        warm_start=result_a,  # <-- nova capability
    )

    return result_b if result_b.get("sucesso") else result_a
```

---

## Notas de Implementacao OR-Tools

### Opcao 1: Duas chamadas `solver.solve()` (recomendada)

```python
# Fase A — busca
solver_a = cp_model.CpSolver()
solver_a.parameters.max_time_in_seconds = phase_a_budget
solver_a.parameters.num_workers = 8
# NAO setar relative_gap_limit — aceitar qualquer solucao viavel
status_a = solver_a.solve(model)

if status_a in (cp_model.OPTIMAL, cp_model.FEASIBLE):
    # Extrair solucao como hints para Fase B
    for c in range(C):
        for d in range(D):
            for s in range(S):
                model.AddHint(work[c, d, s], solver_a.value(work[c, d, s]))

    # Fase B — melhoria
    solver_b = cp_model.CpSolver()
    solver_b.parameters.max_time_in_seconds = phase_b_budget
    solver_b.parameters.num_workers = 8
    solver_b.parameters.relative_gap_limit = gap_limit
    status_b = solver_b.solve(model)

    # Usar resultado de B se melhorou, senao manter A
    if status_b in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return extract_solution(solver_b, ...)
    else:
        return extract_solution(solver_a, ...)
```

**Pros:** Limpo, cada fase tem seu proprio solver. Hints propagam a solucao da Fase A.
**Cons:** Overhead de reconstrucao do solver B (~100ms, desprezivel).

### Opcao 2: `CpSolverSolutionCallback` com controle de tempo

```python
class FirstSolutionCallback(cp_model.CpSolverSolutionCallback):
    def __init__(self):
        super().__init__()
        self.first_solution_time = None
        self.solution_count = 0

    def on_solution_callback(self):
        self.solution_count += 1
        if self.first_solution_time is None:
            self.first_solution_time = self.wall_time()
            # Podemos injetar novo time limit aqui:
            # self.StopSearch() NAO — queremos continuar na Fase B
```

Usar callback para DETECTAR quando a primeira solucao foi encontrada e logar progresso, mas manter o controle de tempo via `max_time_in_seconds`.

**Recomendacao:** Opcao 1 (duas chamadas). Mais simples, mais previsivel, e funciona com warm-start hints nativos do OR-Tools.

### Early exit em OPTIMAL

Se `solver.solve()` retorna `OPTIMAL` na Fase A, pular Fase B inteiramente. Esse e o caso mais comum para problemas pequenos — resolve em <1s e retorna OPTIMAL, economizando todo o budget de melhoria.

---

## Safety Caps

| Cap | Valor | Finalidade |
|-----|-------|------------|
| `PHASE_A_MAX_SECONDS` | 300s (5min) | Teto absoluto da busca inicial por pass |
| `PHASE_B_MAX_SECONDS` | 1800s (30min) | Teto absoluto da melhoria por pass |
| `HARD_TIME_CAP_SECONDS` | 3600s (1h) | Teto global de todo o solve (todos os passes) |
| Bridge timeout | `HARD_TIME_CAP + 60s` | Kill do processo Python se travou |

### Compatibilidade com bridge timeout

O bridge (`solver-bridge.ts`) tem:

```typescript
timeoutMs = 3_660_000 // 61 min — matches Python HARD_TIME_CAP (3600s) + margin
```

O `HARD_TIME_CAP_SECONDS = 3600` nao muda. Os budgets de Fase A e B sao distribuidos DENTRO desse cap global. Se a soma de todos os passes excederia o cap, o `remaining` time e clamped:

```python
elapsed_total = time.time() - t_global_start
remaining = HARD_TIME_CAP_SECONDS - elapsed_total
if remaining <= 5:
    break  # acabou o tempo global
```

Isso ja existe no `_run_with_continuation` atual e sera preservado.

---

## Implicacoes na UX

### Progress streaming

O solver ja emite logs via stderr que o bridge captura e repassa via `onLog`. A proposta e adicionar logs estruturados para as fases:

```python
# Fase A
log(f"[FASE_A] Buscando solucao viavel (budget {phase_a_budget:.0f}s)...")
# ... apos encontrar:
log(f"[FASE_A] Solucao encontrada em {t:.1f}s — cobertura {cob}%")

# Fase B
log(f"[FASE_B] Melhorando solucao (budget {phase_b_budget:.0f}s, gap {gap_limit})...")
# ... apos cada melhoria (via callback):
log(f"[FASE_B] Cobertura melhorou: {cob_old}% → {cob_new}%")
# ... ao finalizar:
log(f"[FASE_B] Melhor solucao: cobertura {cob}% em {t:.1f}s")
```

O frontend pode parsear esses prefixos `[FASE_A]` / `[FASE_B]` para mostrar status diferenciado:

- `[FASE_A]` → "Buscando solucao..."
- `[FASE_B]` → "Melhorando (cobertura 89%)..."

### Cancelamento

O cancelamento (`cancelSolver()` → `SIGTERM`) ja existe e continua funcionando. Se o usuario cancela durante a Fase B, o solver retorna a melhor solucao encontrada ate aquele momento. Se cancela durante a Fase A, retorna INFEASIBLE (nenhuma solucao encontrada ainda).

Para melhorar a UX de cancelamento durante Fase B: o bridge pode interceptar o SIGTERM e emitir a melhor solucao encontrada pela Fase A antes de morrer. Isso requer que a solucao da Fase A seja persistida em memoria (ja e, pelo design de duas chamadas `solver.solve()`).

**V1 simplificado:** SIGTERM mata o processo, bridge retorna erro. Aceitavel — o usuario sabe que cancelou.

**V2 futuro:** Signal handler no Python que emite o resultado da Fase A via stdout antes de sair.

---

## Diagnostico atualizado

O campo `diagnostico` do resultado recebe novos campos:

```python
diagnostico = {
    # Existentes (mantidos)
    "pass_usado": 1,
    "generation_mode": "OFFICIAL",
    "regras_relaxadas": [],
    "capacidade_vs_demanda": {...},
    "cycle_length_weeks": 3,
    "tempo_total_s": 12.3,

    # Novos
    "budget_dinamico": {
        "problem_size": {"C": 6, "D": 14, "S": 48, "n_vars": 4032},
        "phase_a_budget_s": 13.1,
        "phase_b_budget_s": 30.0,
        "phase_a_time_s": 2.4,      # quanto realmente usou
        "phase_b_time_s": 8.7,      # quanto realmente usou
        "phase_a_status": "FEASIBLE",  # OPTIMAL / FEASIBLE
        "improvement_percent": 12.3,   # quanto a Fase B melhorou a cobertura
        "mode": "rapido",
    },
}
```

---

## Plano de Migracao

### Fase 1 — Implementacao no Python (solver_ortools.py)

1. **Renomear** `MODE_PROFILES` keys de `budget` para `improvement_budget`
2. **Criar** funcao `compute_phase_a_budget(C, D, S) -> float`
3. **Criar** funcao `_run_pass_phased(...)` que executa Fase A + Fase B internamente
4. **Refatorar** `solve()` para chamar `_run_pass_phased` em vez de `_run_with_continuation`
5. **Manter** `_solve_pass()` inalterada — ela continua sendo a unidade atomica que roda `solver.solve()`
6. **Adicionar** warm-start hints entre Fase A e Fase B (via `model.AddHint`)
7. **Adicionar** early-exit se Fase A retorna OPTIMAL
8. **Atualizar** logs com prefixos `[FASE_A]` / `[FASE_B]`
9. **Atualizar** diagnostico com `budget_dinamico`

### Fase 2 — Atualizacao do Bridge (solver-bridge.ts)

1. **Nenhuma mudanca obrigatoria** — o bridge so spawna o Python e le stdout/stderr
2. **Opcional:** parsear prefixos `[FASE_A]`/`[FASE_B]` nos logs para metadata de progresso
3. **Validar** que o `timeoutMs` do bridge continua compativel (ja e — 61min > qualquer cenario)

### Fase 3 — Testes

1. **Benchmark:** rodar solver com 3 cenarios (pequeno/medio/grande) antes e depois
2. **Regressao:** verificar que problemas que davam INFEASIBLE agora encontram solucao
3. **Timing:** verificar que problemas pequenos resolvem em <10s no modo rapido
4. **Paridade:** solver/validador continuam concordando (nenhuma mudanca no modelo)

### O que NAO muda

- `build_model()` — nenhuma alteracao
- `extract_solution()` — nenhuma alteracao
- `constraints.py` — nenhuma alteracao
- Multi-pass structure (1 → 1b → 2 → 3) — mesma logica de degradacao
- `solve_folga_pattern()` (Phase 1) — budget proprio, nao afetado
- Bridge interface (JSON in/out) — backward compatible
- `HARD_TIME_CAP_SECONDS` — mantido em 3600s
- `MIN_COVERAGE_THRESHOLD` — mantido em 90%

---

## Riscos e Mitigacoes

| Risco | Impacto | Probabilidade | Mitigacao |
|-------|---------|---------------|-----------|
| Fator de escala `0.002` muito conservador (Fase A curta demais para problemas constrainados) | Falso INFEASIBLE em problemas medios | Media | Benchmark com dados reais. Ajustar fator apos testes. Fallback: `constraint_complexity_factor` multiplica o budget. |
| Warm-start hints nao aceleram Fase B suficientemente | Fase B desperdica tempo re-explorando | Baixa | OR-Tools hints sao eficazes. Se nao forem, manter resultado da Fase A como fallback. |
| Duas chamadas `solver.solve()` causam overhead de reconstrucao | ~200ms extras por pass | Muito baixa | Overhead desprezivel vs minutos de solve. Nao e risco real. |
| `max_time_seconds` override manual nao interage bem com Fase A/B split | Confusao sobre o que o override controla | Media | Documentar: override substitui budget TOTAL. Fase A recebe `min(auto, override*0.3)`, Fase B recebe o resto. |
| SIGTERM durante Fase A perde solucao parcial | Usuario cancela e nao recebe nada | Baixa (UX existente) | V1: aceitavel. V2: signal handler emite Fase A result. |

---

## Metricas de Sucesso

Apos implementacao, comparar com baseline atual:

1. **Problemas pequenos (C<=6, D<=7):** tempo total cai de ~45s para <10s no modo rapido
2. **Problemas grandes (C>=20, D>=60):** taxa de INFEASIBLE falso cai para ~0
3. **Cobertura media:** melhora em pelo menos 3pp (pontos percentuais) no modo rapido
4. **Zero regressao:** nenhum problema que resolvia antes passa a dar INFEASIBLE
