# Como o EscalaFlow Funciona — Guia Técnico Unificado

> Última atualização: 2026-03-21
> Este doc é a referência central de "como as peças se encaixam".
> Para regras CLT detalhadas, veja `motor-regras.md`. Para IA, veja `ia-sistema.md`.

---

## TL;DR

O EscalaFlow gera escalas de trabalho automaticamente usando 3 engines complementares:

1. **Preview TS** (`simula-ciclo.ts`) — heurística rápida em TypeScript, mostra ciclo T/F na UI em tempo real
2. **Solver Phase 1** (`solver_ortools.py:solve_folga_pattern`) — CP-SAT leve, decide padrão OFF/MANHA/TARDE/INTEGRAL
3. **Solver Main** (`solver_ortools.py:solve`) — CP-SAT completo, gera alocações 15-min com multi-pass

O fluxo completo: **UI → Bridge TS → Python solver → Validador TS → Banco → UI**

---

## 1. Arquitetura Geral

```
┌─────────────────────────────────────────────────────────────┐
│                        RENDERER (React 19)                   │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────────────┐ │
│  │ SetorDetalhe│  │ EscalaPagina │  │ IaChatPanel         │ │
│  │ (preview)   │  │ (escala real)│  │ (chat RH + 34 tools)│ │
│  └──────┬──────┘  └──────┬───────┘  └──────────┬──────────┘ │
│         │                │                      │            │
│         │           IPC (tipc)                   │            │
├─────────┼────────────────┼──────────────────────┼────────────┤
│         │         MAIN PROCESS (Node.js)         │            │
│         │                │                      │            │
│  ┌──────▼──────┐  ┌──────▼───────┐  ┌──────────▼──────────┐ │
│  │ simula-     │  │ solver-      │  │ ia/                  │ │
│  │ ciclo.ts    │  │ bridge.ts    │  │ tools.ts + cliente.ts│ │
│  │ (preview)   │  │ (bridge)     │  │ (34 tools + LLM)     │ │
│  └─────────────┘  └──────┬───────┘  └─────────────────────┘ │
│                          │                                   │
│                   ┌──────▼───────┐                           │
│                   │ spawn Python │                           │
│                   │ stdin/stdout │                           │
│                   └──────┬───────┘                           │
│                          │                                   │
│                   ┌──────▼───────┐    ┌──────────────────┐   │
│                   │ solver_      │    │ validador.ts     │   │
│                   │ ortools.py   │───▶│ (revalida + KPIs)│   │
│                   │ (OR-Tools)   │    └────────┬─────────┘   │
│                   └──────────────┘             │             │
│                                         ┌──────▼─────┐      │
│                                         │  PGlite DB │      │
│                                         │ (Postgres)  │      │
│                                         └────────────┘      │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. Os 3 Engines — O Que Cada Um Faz

### 2.1 Preview TS (`simula-ciclo.ts`)

**Onde roda:** Frontend (shared, usado no SetorDetalhe)
**Velocidade:** Instantâneo (<5ms)
**Granularidade:** Dia inteiro (T/F — Trabalho ou Folga)
**Propósito:** Mostrar pro RH como o ciclo de folgas vai ficar ANTES de rodar o solver

**Como funciona:**
1. Recebe: `num_postos`, `trabalham_domingo`, `folgas_forcadas`, `demanda_por_dia`
2. Calcula ciclo: `N / gcd(N, K)` semanas (onde N = postos, K = trabalham domingo)
3. Distribui domingos em round-robin
4. Atribui folgas fixas (FF) e variáveis (FV) via `pickBestFolgaDay`:
   - Prioriza dias com maior sobra (capacidade - demanda)
   - Separa peso FF (toda semana, peso 1.0) vs FV (~50% das semanas, peso 0.5)
   - Evita concentrar folgas no mesmo dia
5. Aplica XOR: se trabalha DOM → folga no dia variável (mesma semana, offset negativo)
6. Repara violações H1 (max 6 consecutivos)
7. Retorna grid T/F por posto × semana + cobertura por dia

**Funções-chave:**
- `gerarCicloFase1()` — orquestra tudo
- `pickBestFolgaDay()` — heurística de espalhamento demand-aware
- `converterNivel1ParaEscala()` — converte grid T/F pra formato de escala (pra exibição)

**Limitação:** Não respeita constraints de slot (almoco, interjornada, max 10h). Opera apenas a nível de DIA.

---

### 2.2 Solver Phase 1 (`solve_folga_pattern`)

**Onde roda:** Python OR-Tools (dentro do solver)
**Velocidade:** ~0.1s (budget 15s max)
**Granularidade:** Meio-dia (OFF/MANHA/TARDE/INTEGRAL por colaborador-dia)
**Propósito:** Encontrar padrão de folgas que o solver principal usa como warm-start

**Como funciona:**
1. Cria modelo CP-SAT leve com 3 BoolVars por (colaborador, dia): `is_manha`, `is_tarde`, `is_integral`
2. Detecta colabs fully-pinned (Tipo B intermitente) → HARD-fixa variáveis, skippa em constraints
3. Aplica constraints HARD: H1 (6 consec), folga_fixa, folga_variavel, ciclo domingo
4. Aplica constraints SOFT: headcount por dia (peso 5000), band coverage manhã/tarde (peso 3000)
5. Objetivo: minimizar spread (diferença entre quem mais e menos trabalha) + penalidades
6. Retorna pattern `{(c,d): band}` que alimenta o solver principal

**Relação com Preview TS:**
- O Preview calcula o ciclo completo no TS (T/F puro)
- A bridge PODE passar o preview como `pinned_folga_externo` (se >80% dos pares cobertos)
- Se o preview cobre <80%, o Phase 1 resolve sozinho
- Pins do Tipo B (intermitente) são pré-computados pela bridge e entram como pins HARD

---

### 2.3 Solver Principal (`solve` → multi-pass)

**Onde roda:** Python OR-Tools (CP-SAT completo)
**Velocidade:** 30-70s (patience-based, estabilização de cobertura)
**Granularidade:** Slot de 15 minutos (variável binária por colaborador × dia × slot)
**Propósito:** Gerar alocações reais com horários, almoço, respeito total a CLT

**Multi-pass com degradação graciosa:**

```
Pass 1: Todas as regras HARD + Phase 1 como constraints
  ↓ (se INFEASIBLE)
Pass 2: Relaxa DIAS_TRABALHO + MIN_DIARIO (SOFT) + Phase 1 como hints
  ↓ (se INFEASIBLE)
Pass 3: Relaxa + FOLGA_FIXA + FOLGA_VARIAVEL + TIME_WINDOW + H10_ELASTIC
```

**Coverage Stabilization:**
- Não existe budget fixo de tempo nem modos de resolução
- O solver roda até a cobertura % parar de melhorar (30s sem melhoria)
- Timer reseta a cada melhoria de cobertura
- INFEASIBLE é detectado em <1s — dar mais tempo NÃO resolve

**Warm-start:**
- Pass 1: Phase 1 pattern como constraints HARD no `build_model` + hints (AddHint)
- Pass 2: Phase 1 pattern como hints ONLY (sem constraints) — solver livre
- Pass 3: idem Pass 2

**Output:** JSON via stdout com:
- `alocacoes[]` — 1 registro por colaborador/dia (status, hora_inicio/fim, almoco)
- `decisoes[]` — explicação textual de cada decisão
- `comparacao_demanda[]` — slot-a-slot 15min planejado vs executado
- `indicadores` — cobertura%, violações, equilíbrio
- `diagnostico` — pass usado, regras relaxadas, tempos, Phase 1 status

---

## 3. Pipeline Completo — Do Click ao Resultado

```
UI: "Gerar Escala"
  │
  ▼
[1] tipc.ts → gerarEscala handler
  │
  ▼
[2] solver-bridge.ts → buildSolverInput()
  │  ├─ Query DB: empresa, setor, colaboradores, demanda, excecoes, feriados
  │  ├─ buildEffectiveRulePolicy() → monta policy (rules_override + empresa config)
  │  ├─ calcularCicloDomingo() → ratio N/K → ciclo T:F por pessoa
  │  ├─ derivarTipoTrabalhador() → CLT/ESTAGIARIO/INTERMITENTE do contrato
  │  ├─ Tipo B pré-cálculo → pinned_folga_externo (XOR determinístico)
  │  └─ Monta JSON: SolverInput
  │
  ▼
[3] solver-bridge.ts → spawnSolver()
  │  └─ spawn('python3', ['solver_ortools.py']) — JSON via stdin → stdout
  │
  ▼
[4] solver_ortools.py → solve()
  │  ├─ [4a] solve_folga_pattern() → Phase 1 (pattern OFF/MANHA/TARDE/INTEGRAL)
  │  │   ├─ Detecta fully-pinned (Tipo B) → HARD-fixa, skippa constraints
  │  │   ├─ SOFT headcount + band coverage (evita INFEASIBLE em equipes apertadas)
  │  │   └─ Retorna pattern ou None
  │  │
  │  ├─ [4b] Merge: Phase 1 pattern + Tipo B pins → pinned_folga
  │  │
  │  ├─ [4c] Pass 1: _solve_pass(pinned_folga=merged)
  │  │   ├─ build_model() → cria modelo CP-SAT completo (variáveis 15-min)
  │  │   │   ├─ HARD: H1, H2, H4, H5, H6, H10, H15-H18 (CLT inviolável)
  │  │   │   ├─ HARD/SOFT: DIAS_TRABALHO, MIN_DIARIO (configurável)
  │  │   │   ├─ SOFT: S_DEFICIT(10000), S_SURPLUS(100), S_TURNO_PREF, S_CONSISTENCIA...
  │  │   │   └─ ANTIPATTERN: AP1-AP10, AP15, AP16
  │  │   ├─ CoverageStabilizationCallback (patience 30s)
  │  │   └─ Retorna result ou INFEASIBLE
  │  │
  │  ├─ [4d] Se INFEASIBLE: Pass 2 (relaxa DIAS_TRABALHO, hint_pattern=Phase 1)
  │  ├─ [4e] Se INFEASIBLE: Pass 3 (relaxa mais regras)
  │  └─ Retorna JSON via stdout
  │
  ▼
[5] solver-bridge.ts → parseSolverOutput()
  │  └─ Parse JSON, valida campos, trata erros
  │
  ▼
[6] tipc.ts → persistir alocações no banco (INSERT INTO alocacoes)
  │
  ▼
[7] validador.ts → validarEscalaV3()
  │  ├─ Carrega escala + alocações + colaboradores + demanda do banco
  │  ├─ buildEffectiveRulePolicy() → MESMA policy do solver (fonte única)
  │  ├─ Executa 35 checks (H1-H18, S1-S7, AP1-AP16)
  │  ├─ calcularIndicadoresV3() → cobertura%, violações, equilíbrio
  │  └─ Persiste indicadores AUTORITATIVOS no banco (sobrescreve auto-indicadores do solver)
  │
  ▼
[8] UI recebe resultado → exibe escala como RASCUNHO
```

**Pontos críticos:**
- **Fonte de verdade:** O validador TS (passo 7) é autoritativo. Os KPIs do solver são diagnósticos.
- **Policy compartilhada:** Solver e validador usam `buildEffectiveRulePolicy()` — mesma função.
- **Tipo B determinístico:** Bridge pré-calcula XOR (SEG↔DOM), solver recebe como pins HARD.
- **INFEASIBLE instantâneo:** <1s. Se deu INFEASIBLE, usar `diagnosticar_infeasible` — mais tempo NÃO resolve.

---

## 4. Cálculos Importantes

### 4.1 Ciclo Domingo — `N / gcd(N, K)` semanas

O ciclo de domingos é calculado automaticamente (não configurado pelo RH):

```
N = total de postos no pool rotativo (exclui Tipo A intermitente e folga_fixa=DOM)
K = quantos trabalham no domingo (da demanda)
Ciclo = N / gcd(N, K) semanas
```

**Exemplos:**
| N postos | K domingo | gcd | Ciclo | Pattern |
|----------|-----------|-----|-------|---------|
| 5 | 3 | 1 | 5 sem | 3T-2F-3T-2F-3T... |
| 6 | 3 | 3 | 2 sem | 3T-3F alternando |
| 4 | 2 | 2 | 2 sem | 2T-2F alternando |

**Onde é calculado (6 locais — manter sincronizados!):**
1. `SetorDetalhe.tsx:setorSimulacaoInfo` — N/K pro preview
2. `simula-ciclo.ts:gerarCicloFase1` — grid T/F (spacing implícito)
3. `solver-bridge.ts:calcularCicloDomingo` — ratio por pessoa (thresholds)
4. `solver_ortools.py:compute_cycle_length_weeks` — Phase 1 diagnóstico
5. `solver_ortools.py:_compute_cycle_weeks_fast` — output diagnóstico
6. `ciclo-grid-converters.ts:escalaParaCicloGrid` — grid escala oficial

### 4.2 XOR Folga Variável — Mesma Semana (offset negativo)

```
Se trabalhou DOM(semana N) → folga no dia_variável(da MESMA semana)
Se não trabalhou DOM(semana N) → trabalha no dia_variável(da MESMA semana)

Constraint: works_day[c, dom_idx] + works_day[c, var_idx] == 1
```

Offsets do DOM ao dia variável (mesma semana, NEGATIVOS):
```
SEG: -6, TER: -5, QUA: -4, QUI: -3, SEX: -2, SAB: -1
```

### 4.3 Intermitente Tipo A vs Tipo B

| | Tipo A (fixo) | Tipo B (rotativo) |
|---|---|---|
| `folga_variavel` | NULL | dia da semana (ex: SEG) |
| Dias que trabalha | Fixos pela regra de horário | XOR: DOM↔dia_var |
| Pool domingo | Não participa | Participa do ciclo |
| Dias sem regra | NT (não trabalha) — HARD | NT — HARD |
| Pré-cálculo | Trivial (mesmos dias toda semana) | Bridge calcula XOR deterministicamente |

### 4.4 Hierarquia de Horários (5 níveis)

Quando o solver precisa saber a janela de horário de uma pessoa num dia específico:

```
1. Exceção por data (maior precedência)     → "dia 15/03, só pode 08-12"
2. Regra por dia da semana                   → "toda quarta entra 09:00"
3. Regra individual padrão                   → janela/ciclo/folga do colaborador
4. Perfil do contrato                        → janelas por tipo (estagiário manhã)
5. Padrão setor/empresa (menor precedência)  → usa janela cheia de funcionamento
```

---

## 5. Constraints do Motor — Resumo

### HARD (CLT — nunca relaxa no núcleo legal)

| Código | Regra | Artigo |
|--------|-------|--------|
| H1 | Max 6 dias consecutivos | Art. 67 CLT |
| H2 | Interjornada 11h entre turnos | Art. 66 CLT |
| H4 | Max 10h/dia (incluindo extra) | Art. 59 CLT |
| H5 | Exceções (férias, atestado) respeitadas | — |
| H6 | Almoço obrigatório >6h (min 30min CCT) | Art. 71 CLT |
| H10 | Meta semanal (horas/semana do contrato) | Contrato |
| H15 | Estagiário: max 6h/dia, nunca extra | Lei 11.788 |
| H17/H18 | 25/12 e 01/01 proibido trabalhar | CCT |

### Configuráveis (empresa pode mudar via `editar_regra`)

| Código | Padrão | Pode virar |
|--------|--------|-----------|
| DIAS_TRABALHO | HARD | SOFT (Pass 2+) |
| MIN_DIARIO | HARD | SOFT (Pass 2+) |
| H3_DOM_CICLO_EXATO | SOFT | HARD |
| H3_DOM_MAX_CONSEC | HARD | SOFT |

### SOFT (otimização — penalidades no objetivo)

| Código | Peso | O que faz |
|--------|------|-----------|
| S_DEFICIT | 10000 | Penaliza slot sem cobertura |
| S_SURPLUS | 100 | Penaliza excesso de pessoas |
| S_TURNO_PREF | 500 | Respeita preferência manhã/tarde |
| S_CONSISTENCIA | 300 | Mesmo horário dia-a-dia |
| S_SPREAD | 200 | Distribuir horas uniformemente |

---

## 6. Validador TS — Fonte de Verdade

Após o solver gerar e as alocações serem salvas, o **validador TypeScript** (`validador.ts`) roda:

1. **Carrega** escala + alocações + colaboradores + demanda do banco
2. **Usa a MESMA policy** do solver (`buildEffectiveRulePolicy`)
3. **Executa 35 checks** individuais (mesmo catálogo de regras)
4. **Calcula indicadores** autoritativos:
   - `cobertura_percent` — % de demanda coberta
   - `violacoes_hard` — quantas regras CLT violadas (0 = pode oficializar)
   - `violacoes_soft` — quantas regras SOFT violadas
   - `equilibrio` — distribuição de horas entre colaboradores
   - `pontuacao` — score composto
5. **Persiste no banco** — sobrescreve os auto-indicadores do solver

**Por que o validador existe:**
- O solver Python pode ter bugs ou diferenças de implementação
- O validador TypeScript é a mesma linguagem do restante do app
- Garante que a UI e a IA sempre veem os MESMOS números
- Após ajustes manuais (ajustar_alocacao), o validador roda novamente

---

## 7. Lifecycle da Escala

```
        ┌───────────┐     oficializar      ┌──────────┐    arquivar    ┌───────────┐
 gerar  │           │  (violacoes_hard=0)  │          │               │           │
──────▶ │ RASCUNHO  │ ──────────────────▶  │ OFICIAL  │ ────────────▶ │ ARQUIVADA │
        │           │                      │          │               │           │
        └───────────┘                      └──────────┘               └───────────┘
             │                                  │
             │ ajustar (status, horário)         │ (travada — read-only)
             │ revalidar automaticamente         │
             ▼                                  │
        ┌───────────┐                           │
        │ RASCUNHO  │ ◄────────────────────────-┘ (regerar se necessário)
        │ (ajustado)│
        └───────────┘
```

---

## 8. OFFICIAL vs EXPLORATORY

| Modo | Quando | O que muda |
|------|--------|-----------|
| OFFICIAL | Padrão — geração normal | Multi-pass relaxa apenas regras de produto. Regras CLT intocáveis. |
| EXPLORATORY | Quando `rules_override` rebaixa regra HARD | Pode relaxar H1, H6, etc. Serve pra explorar cenários. |

**EXPLORATORY não é "modo de emergência"** — é uma flag que indica ao RH que a escala precisa revisão cuidadosa.

---

## 9. Relação Entre os Docs

| Doc | Escopo | Quando ler |
|-----|--------|-----------|
| **Este doc** (`como-funciona.md`) | Pipeline completo, arquitetura, engines, fluxo | Visão geral do sistema |
| `motor-regras.md` | RFC canônico — 35 regras, decisões travadas | Detalhes de cada regra |
| `motor-spec.md` | Spec técnica — edge cases, modelo de dados | Implementação detalhada |
| `ANALYST_PIPELINE_SOLVER_COMPLETO.md` | Mapa de divergências entre engines | Debug de paridade preview/solver |
| `ia-sistema.md` | Sistema de IA — 34 tools, discovery, RAG | Quando mexer na IA |
| `knowledge/sistema/*.md` | Base de conhecimento pro RAG | Quando a IA precisa responder o RH |
