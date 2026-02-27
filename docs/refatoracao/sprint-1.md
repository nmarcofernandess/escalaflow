# SPRINT 1: MOTOR CONFIAVEL

> **Status:** ✅ CONCLUIDO (2026-02-26)
> **Objetivo:** O motor gera escalas CORRETAS e o usuario ve violacoes REAIS.
> **Escopo:** So backend e motor. Zero frontend.

---

## CONTEXTO (por que este sprint existiu)

O motor gerava escalas mas os dados retornados eram incorretos ou mascarados:

- Violacoes **NUNCA** apareciam apos gerar (hardcoded `[]`)
- Domingo usava mesma grade horaria de dia util (almoco apos fechamento)
- AP1 penalizava >4h em vez de >8h (threshold quebrado com grid 15min)
- Timeout de 61 minutos travava o app se solver bugasse
- INSERT de alocacoes duplicado em 3 lugares

---

## ITENS EXECUTADOS

### Item 1: BUG 9 — Validacao pos-geracao em `escalasGerar` ✅

**Arquivo:** `src/main/tipc.ts`

**Antes:**
```typescript
return {
  escala: escalaAtual!,
  alocacoes: alocacoesDB,
  indicadores: ind,
  violacoes: [],        // ← HARDCODED
  antipatterns: [],      // ← HARDCODED
  ...
}
```

**Depois:**
```typescript
const validacao = await validarEscalaV3(escalaId)
return {
  ...validacao,
  diagnostico: solverResult.diagnostico,
  timing: { ... },
}
```

**Nota:** Combinado com Item 6 (consolidacao INSERT). O bloco inline de ~50 linhas foi substituido por `persistirSolverResult()` + `validarEscalaV3()`.

---

### Item 2: BUG 9b — Validacao pos-geracao em `escalasAjustar` ✅

**Arquivo:** `src/main/tipc.ts`

Mesmo pattern: return hardcoded substituido por `validarEscalaV3(escalaId)`.

**Nota:** O bloco de persistencia do `escalasAjustar` faz UPDATE (nao INSERT), por isso NAO pode usar `persistirSolverResult()` diretamente. O INSERT inline de alocacoes/decisoes/comparacao permanece neste handler.

---

### Item 3: BUG 1 — Horario per-day (bridge + solver) ✅

O fix mais complexo do sprint. 3 layers.

#### 3a. Bridge: ler horarios por dia

**Arquivo:** `src/main/motor/solver-bridge.ts`

Adicionadas queries pra `setor_horario_semana` e `empresa_horario_semana`. Montagem de `horarioPorDia` com cascata:

```
setor_horario_semana (prioridade) > empresa_horario_semana > setor.hora_abertura/hora_fechamento (fallback)
```

Mapa `horario_por_dia` incluido no objeto `empresa` do `SolverInput` e no hash de cenario (`computeSolverScenarioHash`).

**Type atualizado:** `src/shared/types.ts` — campo `horario_por_dia?` em `SolverInput.empresa`.

#### 3b. Solver: zerar slots alem do fechamento

**Arquivo:** `solver/solver_ortools.py`

1. Le `horario_por_dia` do input da empresa
2. Calcula `S` a partir do MAIOR dia (grade uniforme pro CP-SAT)
3. Calcula `base_h` como o minimo das aberturas
4. Computa `day_max_slot` por dia da semana (convertendo ISO date → weekday → indice 0-6)
5. Forca `model.Add(work[c, d_idx, s] == 0)` para slots alem do fechamento de cada dia

#### 3c. Validacao TS: safety net

**Decisao:** NAO foi necessario expandir `checkH6()` com awareness de fechamento por dia. O solver agora garante via constraint CP-SAT, e o `validador.ts` ja usa `janelaOperacional()` que resolve a cascata setor > empresa > default.

---

### Item 4: BUG 2 — AP1 threshold quebrado ✅

**Arquivo:** `solver/constraints.py`

**Antes:**
```python
def add_ap1_jornada_excessiva(..., threshold_slots: int = 16):
```

**Depois:**
```python
def add_ap1_jornada_excessiva(..., grid_min: int = 30):
    threshold_slots = 480 // grid_min  # 8h em qualquer grid
```

Guard adicionado: `if max_excess <= 0: continue` (evita variavel desnecessaria se S < threshold).

**Arquivo:** `solver/solver_ortools.py` — chamada atualizada com `grid_min=grid_min`.

---

### Item 5: BUG 8 — Timeout 61 minutos ✅

**Arquivo:** `src/main/motor/solver-bridge.ts`

```typescript
// ANTES
timeoutMs = 3_700_000,  // ~61 minutos

// DEPOIS
timeoutMs = 300_000,    // 5 minutos
```

Solver interno ja tem `max_time_seconds` (30s rapido, 120s otimizado). O timeout externo e safety net contra processo travado.

---

### Item 6: Consolidar INSERT duplicado em `escalasGerar` ✅

**Arquivo:** `src/main/tipc.ts`

**Antes:** ~50 linhas de `transaction()` com INSERT manual em `escalas`, `alocacoes`, `escala_decisoes`, `escala_comparacao_demanda`.

**Depois:**
```typescript
await execute("DELETE FROM escalas WHERE setor_id = ? AND status = 'RASCUNHO'", setorId)
const escalaId = await persistirSolverResult(
  setorId, input.data_inicio, input.data_fim,
  solverResult, inputHash, regimesOverride,
)
```

Import adicionado: `persistirSolverResult` de `./motor/solver-bridge`.

---

## ARQUIVOS MODIFICADOS

| Arquivo | Mudancas |
|---------|----------|
| `src/main/tipc.ts` | +import `persistirSolverResult`. `escalasGerar`: inline INSERT → persist + validacao. `escalasAjustar`: return hardcoded → validacao |
| `src/main/motor/solver-bridge.ts` | Timeout 300s. Queries horario per-day. Monta `horario_por_dia` com cascata. Campo no return + hash |
| `src/shared/types.ts` | `SolverInput.empresa.horario_por_dia?` adicionado |
| `solver/solver_ortools.py` | Le `horario_por_dia`, S do maior dia, `day_max_slot`, zera slots per-day. Passa `grid_min` ao AP1 |
| `solver/constraints.py` | `add_ap1_jornada_excessiva()`: parametro `grid_min`, threshold `480 // grid_min`, guard `max_excess` |

---

## O QUE NAO FOI TOCADO (Sprint 2+ precisa saber)

1. **`escalasAjustar` ainda tem INSERT inline** — faz UPDATE na escala (nao INSERT), nao pode usar `persistirSolverResult` diretamente. Se quiser extrair, criar funcao auxiliar separada
2. **`checkH6` NAO foi expandido** com awareness de fechamento por dia — solver garante via constraint, `janelaOperacional()` no validador ja resolve a cascata
3. **`add_human_blocks()` (H6 almoco)** continua usando janela global 11-15h — mas slots apos fechamento sao zerados ANTES, entao bug corrigido indiretamente
4. **Frontend ZERO** — nenhum .tsx tocado
5. **Python `add_h19_folga_comp_domingo()` continua no-op** — Sprint 2 item de codigo morto

---

## VERIFICACAO

```bash
npm run typecheck  # 0 erros ✅
```

---

## CHECKLIST DE TESTE MANUAL

> Rodar apos `npm run dev`. Todos os testes assumem setor com `setor_horario_semana` configurado (ex: DOM 07:00-13:00).

| # | Teste | Como verificar | Esperado |
|---|-------|---------------|----------|
| T1 | Violacoes reais apos gerar | Gerar escala para qualquer setor → olhar KPIs imediatamente (sem reload) | Violacoes HARD e antipatterns aparecem SE existirem. Nao mais `[]` vazio |
| T2 | Violacoes reais apos ajustar | Gerar escala → editar celula no grid (trocar TRABALHO/FOLGA) → "Ajustar" | Violacoes recalculadas aparecem imediatamente |
| T3 | Domingo com horario reduzido | Configurar setor com DOM 07:00-13:00 (via `setor_horario_semana`). Gerar escala que inclua domingos | Alocacoes de domingo terminam ate 13:00. Nenhum `hora_fim` > 13:00 em domingos |
| T4 | Almoco nao ultrapassa fechamento | Mesmo cenario T3. Verificar colabs que trabalham domingo | `hora_almoco_fim` nao pode ser > hora_fechamento do domingo |
| T5 | AP1 nao penaliza jornadas curtas | Gerar escala com estagiarios (5h/dia). Verificar antipatterns | AP1 (jornada excessiva) NAO aparece para jornadas <= 8h |
| T6 | Timeout funciona | (Dificil de testar — se solver demorar > 5min) | Erro "Solver excedeu timeout de 300s" em vez de travar 1h |
| T7 | Typecheck limpo | `npm run typecheck` | 0 erros |
| T8 | Gerar + Oficializar | Gerar escala → se 0 violacoes HARD → oficializar | Oficializacao funciona. Se tem violacoes HARD, botao bloqueado |
| T9 | Hash de cenario | Gerar escala → mudar horario do setor → consultar | Hash do input muda (badge "desatualizada" se discovery/IA checar) |

### Prioridade de teste

1. **T1 e T2** — CRITICOS. Se violacoes nao aparecem, sprint falhou.
2. **T3 e T4** — CRITICOS. Se domingo ignora fechamento, BUG 1 continua.
3. **T5** — MEDIO. AP1 threshold.
4. **T7 e T8** — Basicos. Smoke test.
5. **T6 e T9** — BAIXA. Dificeis de testar manualmente.

---

*Sprint 1 concluido em 2026-02-26. Proximo: Sprint 2 (Bugs Secundarios + Limpeza).*
