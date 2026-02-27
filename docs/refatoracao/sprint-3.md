# SPRINT 3: H7 INTERVALO 15min + DASHBOARD REAL

> **Status:** CONCLUIDO (2026-02-26)
> **Objetivo:** Intervalo CLT 15min com horarios reais. Dashboard mostra violacoes e escalas desatualizadas.
> **Escopo:** Backend (Python + TS) + Frontend (Dashboard + Export). Motor nao muda constraints — so post-processing.

---

## CONTEXTO

Sprint 1 corrigiu o motor (dados corretos). Sprint 2 limpou armadilhas.
Agora faltam duas coisas pra escala ser COMPLETA:

1. **H7 (Art. 71 §1 CLT):** Jornada >4h e <=6h exige 15min de intervalo. Hoje e so uma FLAG booleana — ninguem sabe QUANDO o intervalo acontece. Export/print nao mostra.
2. **Dashboard mentiroso:** `violacoes_pendentes: 0` HARDCODED. Badge de alertas NUNCA aparece. Escala desatualizada? Ninguem sabe.

---

## PARTE 1: H7 — INTERVALO 15 MINUTOS

### O que a CLT diz

```
┌──────────────────────────────────────────────────────────────────┐
│  Art. 71 §1 CLT                                                   │
│                                                                    │
│  Jornada > 4h e <= 6h  →  INTERVALO 15min OBRIGATORIO            │
│  Jornada > 6h          →  INTERVALO 1h-2h (almoco — ja existe)   │
│  Jornada <= 4h         →  SEM INTERVALO                          │
│                                                                    │
│  - NAO conta como hora trabalhada (unpaid)                        │
│  - DEVE ser registrado no ponto (10+ empregados)                  │
│  - Se suprimido: empregador paga com 50% adicional               │
└──────────────────────────────────────────────────────────────────┘
```

### Realidade do supermercado (Marco confirmou)

```
┌──────────────────────────────────────────────────────────────────┐
│  Funcionario CHEGA 15 MIN ANTES ou SAI 15 MIN DEPOIS             │
│  As 5h de contrato sao PAGAS, mas fica 5h15m no local           │
│  Intervalo NAO reduz minutos_trabalho — e tempo extra presenca   │
│  Horario pode EXTRAPOLAR abertura do setor (07:45 se abre 08:00)│
└──────────────────────────────────────────────────────────────────┘
```

### Estado atual no codigo

```
                 HOJE: FLAG BOOLEANA SEM HORARIO
                 ================================

  Python (solver_ortools.py:786):
    intervalo_15min = 240 < minutos <= 360
                      ↓
                  True/False
                      ↓
  Persist (solver-bridge.ts:804):
    INSERT ... intervalo_15min = true/false
                      ↓
  Validacao (validacao-compartilhada.ts:557-578):
    checkH7() → se jornada 4-6h e flag=false → HARD violation
                      ↓
  Export: NADA. Nao mostra intervalo, nao mostra horario real.
  Grid: NADA. Mostra 08:00-13:00, nao 07:45-13:00.
```

### Decisao arquitetural: POST-PROCESSING (nao solver)

```
┌──────────────────────────────────────────────────────────────────┐
│  POR QUE NAO MODELAR NO CP-SAT?                                  │
│                                                                    │
│  Modelar gap de 15min exigiria:                                   │
│  - Expandir grade em ±1 slot                                      │
│  - Mudar b_starts pra shifts curtos                               │
│  - Adicionar constraints de posicao minima                        │
│  - Complexidade desproporcional pro ganho                         │
│                                                                    │
│  Intervalo e concern de PONTO ELETRONICO, nao de scheduling.     │
│  O solver resolve QUANTO cada pessoa trabalha.                    │
│  O post-processing resolve QUANDO o break acontece.              │
└──────────────────────────────────────────────────────────────────┘
```

### Como vai funcionar (fluxo end-to-end)

```
                    FLUXO H7 POS-SPRINT 3
                    =====================

  ┌─────────────────────────────────────────────────────────┐
  │  1. SOLVER (nao muda)                                    │
  │     Resolve jornada continua: 08:00-13:00 (5h)          │
  │     Flag: intervalo_15min = True                         │
  └─────────────────────┬───────────────────────────────────┘
                        │
                        ▼
  ┌─────────────────────────────────────────────────────────┐
  │  2. POST-PROCESSING (Python — NOVO)                      │
  │                                                          │
  │     Se intervalo_15min == True:                          │
  │                                                          │
  │     Regra de posicao:                                    │
  │       break_start = hora_inicio + 3h (min)              │
  │       break_end   = hora_fim - 2h (min)                 │
  │       posicao = meio da janela valida                    │
  │                                                          │
  │     Calcula extrapolacao:                                │
  │       Se break cabe DENTRO da jornada:                   │
  │         hora_real_inicio = hora_inicio                   │
  │         hora_real_fim = hora_fim + 15min                 │
  │       Se nao cabe (setor abre 08:00, precisa 07:45):    │
  │         hora_real_inicio = hora_inicio - 15min           │
  │         hora_real_fim = hora_fim                         │
  │                                                          │
  │     Output adicional:                                    │
  │       hora_intervalo_inicio = "10:30"                    │
  │       hora_intervalo_fim    = "10:45"                    │
  │       hora_real_inicio      = "07:45"  (ou = hora_inicio)│
  │       hora_real_fim         = "13:15"  (ou = hora_fim)   │
  └─────────────────────┬───────────────────────────────────┘
                        │
                        ▼
  ┌─────────────────────────────────────────────────────────┐
  │  3. PERSIST (solver-bridge.ts)                           │
  │                                                          │
  │     INSERT INTO alocacoes (                              │
  │       ...,                                               │
  │       intervalo_15min,           -- ja existe (boolean)  │
  │       hora_intervalo_inicio,     -- NOVO (TEXT)          │
  │       hora_intervalo_fim,        -- NOVO (TEXT)          │
  │       hora_real_inicio,          -- NOVO (TEXT)          │
  │       hora_real_fim,             -- NOVO (TEXT)          │
  │     )                                                    │
  └─────────────────────┬───────────────────────────────────┘
                        │
                        ▼
  ┌─────────────────────────────────────────────────────────┐
  │  4. EXPORT/PRINT (ExportarEscala.tsx)                    │
  │                                                          │
  │     ANTES:                                               │
  │       Maria  08:00 - 13:00  (5h)                        │
  │                                                          │
  │     DEPOIS:                                              │
  │       Maria  07:45 - 13:00  (5h) ☕ 10:30              │
  │              ^^^^                     ^^^^^              │
  │              hora_real_inicio         break              │
  │                                                          │
  │     Ou se extrapola no fim:                              │
  │       Maria  08:00 - 13:15  (5h) ☕ 10:30              │
  │                       ^^^^^                              │
  │                       hora_real_fim                      │
  └─────────────────────────────────────────────────────────┘
```

### Exemplos concretos

```
  CENARIO 1: Ana, estagiaria 5h, setor abre 08:00 fecha 22:00
  ─────────────────────────────────────────────────────────
  ┌─────────────────────────────────────────────────────────┐
  │  Solver: 08:00-13:00 (5h), intervalo_15min = True       │
  │                                                          │
  │  Post-processing:                                        │
  │    break = 10:30-10:45 (meio da jornada)                │
  │    Extrapola no FIM (preferencia):                       │
  │      hora_real_inicio = 08:00                            │
  │      hora_real_fim    = 13:15 (+15min)                   │
  │    Contrato max: estagiario 5h = 300min.                │
  │    minutos_trabalho = 300, nao muda (break e unpaid).   │
  │    300 <= 300 → OK, nao estoura contrato.               │
  │                                                          │
  │  Export: Ana  08:00 - 13:15  (5h)  pausa 10:30-10:45   │
  │  Ponto:  08:00 → 10:30 sai → 10:45 volta → 13:15 sai  │
  └─────────────────────────────────────────────────────────┘

  CENARIO 2: Joao, CLT 44h, turno tarde, setor fecha 22:00
  ─────────────────────────────────────────────────────────
  ┌─────────────────────────────────────────────────────────┐
  │  Solver: 17:00-22:00 (5h), intervalo_15min = True       │
  │                                                          │
  │  Post-processing:                                        │
  │    break = 19:30-19:45 (meio da jornada)                │
  │    Extrapola no FIM: hora_real_fim = 22:15              │
  │    22:15 > fechamento 22:00? SIM, mas 15min purgavel.  │
  │    → PERMITIDO. CLT > horario do setor.                  │
  │                                                          │
  │  Export: Joao  17:00 - 22:15  (5h)  pausa 19:30-19:45  │
  └─────────────────────────────────────────────────────────┘

  CENARIO 3: Maria, CLT 44h, turno manha, setor abre 07:00
  ─────────────────────────────────────────────────────────
  ┌─────────────────────────────────────────────────────────┐
  │  Solver: 07:00-12:00 (5h), intervalo_15min = True       │
  │                                                          │
  │  Post-processing:                                        │
  │    break = 09:30-09:45                                   │
  │    Extrapola no FIM: hora_real_fim = 12:15              │
  │    12:15 < fechamento? SIM → OK normal.                  │
  │                                                          │
  │  Export: Maria  07:00 - 12:15  (5h)  pausa 09:30-09:45 │
  └─────────────────────────────────────────────────────────┘

  CENARIO 4: Pedro, CLT 44h, abre 08:00, hard "chega 08:00"
  ─────────────────────────────────────────────────────────
  ┌─────────────────────────────────────────────────────────┐
  │  Solver: 08:00-13:00 (5h), intervalo_15min = True       │
  │                                                          │
  │  Post-processing (default = estender no fim):            │
  │    hora_real_fim = 13:15                                 │
  │    → OK, funciona. Mesmo que Pedro tenha hard "sai 13:00"│
  │      os 15min CLT passam por cima.                       │
  │                                                          │
  │  ALTERNATIVA (chegar antes):                             │
  │    hora_real_inicio = 07:45                              │
  │    → TAMBEM OK. Mesmo que setor abre 08:00,             │
  │      15min CLT sao purgaveis.                            │
  │    → Mesmo que Pedro tenha hard "nao antes de 08:00",   │
  │      H7 CLT prevalece.                                   │
  │                                                          │
  │  O post-processing escolhe a PREFERENCIA (fim).          │
  │  O RH pode decidir inverter caso a caso no futuro.      │
  └─────────────────────────────────────────────────────────┘
```

### Hierarquia de precedencia (QUEM MANDA)

```
  ┌─────────────────────────────────────────────────────────┐
  │  PRECEDENCIA DOS 15min CLT                               │
  │                                                          │
  │  ★ Contrato/Perfil (max_minutos_dia do estagiario)      │
  │  │  → MAIS FORTE. 15min nao pode estourar contrato.     │
  │  │  → Se estagiario tem max 300min, 15min NAO vira 315. │
  │  │                                                       │
  │  │  ↑ nao passa                                          │
  │  │                                                       │
  │  ★ H7 CLT 15min                                          │
  │  │  → PASSA POR CIMA de tudo abaixo.                    │
  │  │  → Pode extrapolar abertura E fechamento do setor.   │
  │  │  → Ignora regra hard do colab (entrada/saida fixa).  │
  │  │  → Os 15min sao "purgaveis": permitidos antes da     │
  │  │    abertura ou apos o fechamento.                     │
  │  │                                                       │
  │  │  ↑ passa por cima                                     │
  │  │                                                       │
  │  ★ Regra hard do colaborador (entrada/saida manual)      │
  │  │  → H7 IGNORA. Se colab tem "sair 13:00" mas precisa  │
  │  │    de 15min, sai 13:15 (ou chega 07:45).             │
  │  │                                                       │
  │  │  ↑ passa por cima                                     │
  │  │                                                       │
  │  ★ Horario do setor (abertura/fechamento)                │
  │     → H7 IGNORA. Se setor abre 08:00 e colab precisa    │
  │       chegar 07:45, pode. Os 15min sao "purgaveis".     │
  └─────────────────────────────────────────────────────────┘
```

### Regra de posicionamento do break

```
  ┌─────────────────────────────────────────────────────────┐
  │  ALGORITMO DE POSICAO + EXTRAPOLACAO                     │
  │                                                          │
  │  Dado: hora_inicio, hora_fim, minutos_trabalho,         │
  │        max_minutos_dia (do contrato/perfil)              │
  │                                                          │
  │  1. Se minutos <= 240 ou minutos > 360:                 │
  │     → SEM intervalo (H6 almoco cuida do >6h)            │
  │                                                          │
  │  2. Posicao do break:                                    │
  │     janela_inicio = hora_inicio + 2h                    │
  │     janela_fim    = hora_fim    - 1h                    │
  │     Se janela invalida → meio da jornada (fallback)     │
  │     break_start = meio da janela                         │
  │     break_end   = break_start + 15min                   │
  │                                                          │
  │  3. Extrapolacao (ONDE colocar os 15min extra):          │
  │                                                          │
  │     PREFERENCIA: sair 15min depois (estender no fim)    │
  │       hora_real_inicio = hora_inicio                     │
  │       hora_real_fim    = hora_fim + 15min                │
  │                                                          │
  │     SE contrato tem max_minutos_dia E                    │
  │        (minutos + 15) > max_minutos_dia:                │
  │       → NAO extrapola. Contrato prevalece.               │
  │       → hora_real = hora normal (intervalo absorvido     │
  │         dentro da presenca, sem esticar)                 │
  │                                                          │
  │     SE hora_real_fim ultrapassa MUITO o fechamento       │
  │        (>30min alem) E chegar antes e viavel:           │
  │       → ALTERNATIVA: chegar 15min antes                  │
  │       hora_real_inicio = hora_inicio - 15min             │
  │       hora_real_fim    = hora_fim                        │
  │                                                          │
  │  NOTA: 15min purgaveis do setor sao SEMPRE permitidos.  │
  │  O setor abre 08:00? Colab pode chegar 07:45.           │
  │  O setor fecha 13:00? Colab pode sair 13:15.            │
  │  Isso NAO e violacao — e direito CLT Art. 71 §1.        │
  └─────────────────────────────────────────────────────────┘
```

### Dados: novos campos em alocacoes

```
  ┌─────────────────────────────────────────────────────────┐
  │  TABELA: alocacoes                                       │
  │                                                          │
  │  Campos EXISTENTES:                                      │
  │    intervalo_15min       BOOLEAN NOT NULL DEFAULT FALSE  │
  │    hora_inicio           TEXT                            │
  │    hora_fim              TEXT                            │
  │    minutos_trabalho      INTEGER                        │
  │    hora_almoco_inicio    TEXT                            │
  │    hora_almoco_fim       TEXT                            │
  │                                                          │
  │  Campos NOVOS (migration v19):                           │
  │  + hora_intervalo_inicio TEXT   -- "10:30"               │
  │  + hora_intervalo_fim    TEXT   -- "10:45"               │
  │  + hora_real_inicio      TEXT   -- "07:45" ou null       │
  │  + hora_real_fim         TEXT   -- "13:15" ou null       │
  │                                                          │
  │  Quando NULL: hora_real = hora normal (sem extrapolacao) │
  └─────────────────────────────────────────────────────────┘
```

### Types (Alocacao interface)

```
  ┌─────────────────────────────────────────────────────────┐
  │  interface Alocacao {                                     │
  │    ...campos existentes...                               │
  │    intervalo_15min?: boolean         // ja existe         │
  │  + hora_intervalo_inicio?: string    // NOVO "10:30"     │
  │  + hora_intervalo_fim?: string       // NOVO "10:45"     │
  │  + hora_real_inicio?: string         // NOVO "07:45"     │
  │  + hora_real_fim?: string            // NOVO "13:15"     │
  │  }                                                       │
  │                                                          │
  │  interface SolverOutputAlocacao {                         │
  │    ...campos existentes...                               │
  │    intervalo_15min: boolean          // ja existe         │
  │  + hora_intervalo_inicio: string | null  // NOVO         │
  │  + hora_intervalo_fim: string | null     // NOVO         │
  │  + hora_real_inicio: string | null       // NOVO         │
  │  + hora_real_fim: string | null          // NOVO         │
  │  }                                                       │
  └─────────────────────────────────────────────────────────┘
```

---

## PARTE 2: DASHBOARD REAL

### Estado atual

```
                    DASHBOARD HOJE
                    ==============

  ┌──────────────────────────────────────────────────────────┐
  │  [4 stat cards]  Setores | Colaboradores | Ferias | Atest│
  │                                                           │
  │  ┌──────────────────────────────────┐  ┌────────────────┐│
  │  │  Setores                          │  │  Alertas       ││
  │  │  ┌──────────────────────────────┐ │  │                ││
  │  │  │ Padaria   [OFICIAL] [0 alert]│ │  │  Sem escala:   ││
  │  │  │ 8 colabs  Ver Escala    →    │ │  │  - Acougue     ││
  │  │  ├──────────────────────────────┤ │  │                ││
  │  │  │ Caixa     [RASCUNHO]        │ │  │  Poucos colabs:││
  │  │  │ 12 colabs  Ver Escala   →    │ │  │  - Hortifruti ││
  │  │  ├──────────────────────────────┤ │  │                ││
  │  │  │ Acougue   [SEM_ESCALA]      │ │  │                ││
  │  │  │ 5 colabs                →    │ │  │                ││
  │  │  └──────────────────────────────┘ │  └────────────────┘│
  │  └──────────────────────────────────┘                     │
  │                                                           │
  │  PROBLEMAS:                                               │
  │  1. violacoes_pendentes = 0 HARDCODED (nunca aparece)    │
  │  2. Sem check de escala desatualizada (input_hash)       │
  │  3. Alertas so: SEM_ESCALA e POUCOS_COLABORADORES        │
  └──────────────────────────────────────────────────────────┘
```

### Como deve ficar

```
                    DASHBOARD POS-SPRINT 3
                    ======================

  ┌──────────────────────────────────────────────────────────┐
  │  [4 stat cards]  Setores | Colaboradores | Ferias | Atest│
  │                                                           │
  │  ┌──────────────────────────────────┐  ┌────────────────┐│
  │  │  Setores                          │  │  Alertas       ││
  │  │  ┌──────────────────────────────┐ │  │                ││
  │  │  │ Padaria   [OFICIAL]          │ │  │  Violacoes:    ││
  │  │  │ 8 colabs  Ver Escala    →    │ │  │  - Caixa: 3   ││
  │  │  ├──────────────────────────────┤ │  │    alertas     ││
  │  │  │ Caixa     [RASCUNHO]        │ │  │                ││
  │  │  │ 12 colabs  ⚠ 3 alertas      │ │  │  Desatualizada:││
  │  │  │           Ver Escala    →    │ │  │  - Padaria     ││
  │  │  ├──────────────────────────────┤ │  │    (hash diff) ││
  │  │  │ Padaria   [OFICIAL]          │ │  │                ││
  │  │  │ 8 colabs  ⟳ Desatualizada   │ │  │  Sem escala:   ││
  │  │  │           Ver Escala    →    │ │  │  - Acougue     ││
  │  │  └──────────────────────────────┘ │  └────────────────┘│
  │  └──────────────────────────────────┘                     │
  │                                                           │
  │  MUDANCAS:                                                │
  │  1. violacoes_pendentes = COUNT real de violacoes HARD   │
  │  2. Badge "⟳ Desatualizada" se input_hash difere         │
  │  3. Alertas: +VIOLACAO_HARD +ESCALA_DESATUALIZADA        │
  └──────────────────────────────────────────────────────────┘
```

### Fluxo: como calcular violacoes_pendentes

```
  ┌─────────────────────────────────────────────────────────┐
  │  dashboardResumo handler (tipc.ts)                       │
  │                                                          │
  │  Para cada setor com escala OFICIAL ou RASCUNHO:         │
  │                                                          │
  │  1. Buscar escala ativa:                                 │
  │     SELECT id, input_hash FROM escalas                   │
  │     WHERE setor_id = ? AND status IN ('OFICIAL','RASCUNHO')│
  │     ORDER BY ... LIMIT 1                                 │
  │                                                          │
  │  2. Contar violacoes HARD:                               │
  │     → Chamar validarEscalaV3(escala.id)                  │
  │     → Contar v.severidade === 'HARD'                     │
  │     → violacoes_pendentes = count                        │
  │                                                          │
  │  ⚠ PERFORMANCE: validarEscalaV3 e pesado.               │
  │  ALTERNATIVA LEVE:                                       │
  │     → Ler escalas.violacoes_hard (ja persistido)         │
  │     → Nao precisa revalidar — ja foi validado ao gerar   │
  │                                                          │
  │  DECISAO: Usar escalas.violacoes_hard (1 query, O(1)).  │
  │  Se usuario quer revalidar, abre a escala.               │
  └─────────────────────────────────────────────────────────┘
```

### Fluxo: como detectar escala desatualizada

```
  ┌─────────────────────────────────────────────────────────┐
  │  "DESATUALIZADA" = algo mudou desde que a escala foi     │
  │  gerada. O solver usou inputs que nao refletem mais      │
  │  a realidade.                                            │
  │                                                          │
  │  Mecanismo: input_hash                                   │
  │  ─────────────────                                       │
  │  Ao gerar, computeSolverScenarioHash() cria hash de:     │
  │  - Colaboradores + contratos + regras                    │
  │  - Demandas + excecoes + horarios                        │
  │  - Regimes + configs                                     │
  │  Hash e salvo em escalas.input_hash                      │
  │                                                          │
  │  Para checar:                                            │
  │  1. Recomputar hash ATUAL (sem gerar)                    │
  │  2. Comparar com escalas.input_hash                      │
  │  3. Se diferente → escala desatualizada                  │
  │                                                          │
  │  ⚠ PERFORMANCE: computeSolverScenarioHash chama          │
  │  buildSolverInput que faz ~15 queries.                   │
  │                                                          │
  │  ALTERNATIVA LEVE:                                       │
  │  → Nao recomputar hash no dashboard (pesado demais)      │
  │  → Checar TIMESTAMP: se algum colaborador/regra/demanda  │
  │    foi atualizado DEPOIS de escalas.criada_em            │
  │  → 1 query com MAX(atualizada_em) vs escalas.criada_em   │
  │                                                          │
  │  DECISAO: Usar timestamp comparison (1 query leve).      │
  │  Se qualquer dado do setor mudou apos gerar → stale.     │
  └─────────────────────────────────────────────────────────┘
```

### Query de staleness (proposta)

```sql
-- Para cada setor com escala ativa:
SELECT
  e.id as escala_id,
  e.criada_em,
  GREATEST(
    COALESCE((SELECT MAX(atualizada_em) FROM colaboradores WHERE setor_id = s.id), '1970-01-01'),
    COALESCE((SELECT MAX(atualizada_em) FROM demandas WHERE setor_id = s.id), '1970-01-01'),
    COALESCE((SELECT MAX(criada_em) FROM excecoes ex
              JOIN colaboradores c ON c.id = ex.colaborador_id
              WHERE c.setor_id = s.id), '1970-01-01')
  ) as ultimo_dado_atualizado
FROM escalas e
JOIN setores s ON s.id = e.setor_id
WHERE e.status IN ('OFICIAL', 'RASCUNHO')

-- Se ultimo_dado_atualizado > e.criada_em → DESATUALIZADA
```

---

## ITENS DO SPRINT

### Item 1: Migration v19 — 4 colunas em alocacoes

**Arquivo:** `src/main/db/schema.ts`

```typescript
// Migration v19 — H7 campos de intervalo
await addColumnIfMissing('alocacoes', 'hora_intervalo_inicio', 'TEXT')
await addColumnIfMissing('alocacoes', 'hora_intervalo_fim', 'TEXT')
await addColumnIfMissing('alocacoes', 'hora_real_inicio', 'TEXT')
await addColumnIfMissing('alocacoes', 'hora_real_fim', 'TEXT')
```

**Risco:** Zero. Colunas nullable, default NULL. Alocacoes existentes nao quebram.

---

### Item 2: Types — Alocacao + SolverOutputAlocacao

**Arquivo:** `src/shared/types.ts`

Adicionar 4 campos opcionais em `Alocacao` e 4 em `SolverOutputAlocacao`.

---

### Item 3: Post-processing Python — posicionar intervalo

**Arquivo:** `solver/solver_ortools.py`, funcao `extract_solution()`

Apos calcular `intervalo_15min = 240 < minutos <= 360` (linha 786):

```python
# H7: posicionar intervalo 15min
hora_intervalo_inicio = None
hora_intervalo_fim = None
hora_real_inicio = None
hora_real_fim = None

if intervalo_15min and hora_inicio and hora_fim:
    hi_min = int(hora_inicio[:2]) * 60 + int(hora_inicio[3:5])
    hf_min = int(hora_fim[:2]) * 60 + int(hora_fim[3:5])

    # Posicao do break: janela min 2h apos inicio, 1h antes de fim
    janela_ini = hi_min + 120
    janela_fim = hf_min - 60
    if janela_ini >= janela_fim:
        break_min = (hi_min + hf_min) // 2  # fallback: meio
    else:
        break_min = (janela_ini + janela_fim) // 2

    hora_intervalo_inicio = f"{break_min // 60:02d}:{break_min % 60:02d}"
    hora_intervalo_fim = f"{(break_min + 15) // 60:02d}:{(break_min + 15) % 60:02d}"

    # Extrapolacao: preferencia = estender no fim (sair 15min depois)
    # 15min sao "purgaveis" — podem ultrapassar horario do setor E
    # regras hard do colaborador. So NAO ultrapassam contrato.
    #
    # Checar se contrato limita (max_minutos_dia do perfil/tipo_contrato):
    max_dia = colabs[c].get("max_minutos_dia")  # pode ser None
    if max_dia and (minutos + 15) > max_dia:
        # Contrato prevalece — nao extrapola (break absorvido)
        hora_real_inicio = hora_inicio
        hora_real_fim = hora_fim
    else:
        # Default: estender no fim
        hora_real_inicio = hora_inicio
        hora_real_fim = f"{(hf_min + 15) // 60:02d}:{(hf_min + 15) % 60:02d}"
```

Adicionar os 4 campos no dict de output da alocacao (apos linha 800):

```python
            alocacoes.append({
                ...campos_existentes...,
                "hora_intervalo_inicio": hora_intervalo_inicio,
                "hora_intervalo_fim": hora_intervalo_fim,
                "hora_real_inicio": hora_real_inicio,
                "hora_real_fim": hora_real_fim,
            })
```

**Variavel correta:** No loop de `extract_solution()`, o colaborador e acessado via `colabs[c]` (dict completo com `id`, `nome`, `max_minutos_dia`, `tipo_trabalhador`, etc). NAO existe variavel `colab_info` — usar `colabs[c]` diretamente.

---

### Item 4: Persist — 2 funcoes de INSERT (AMBAS precisam mudar)

**Funcao 1:** `persistirSolverResult()` em `src/main/motor/solver-bridge.ts` (linhas 791-806)

INSERT atual tem 13 campos. Adicionar 4:

```sql
INSERT INTO alocacoes
  (escala_id, colaborador_id, data, status, hora_inicio, hora_fim,
   minutos, minutos_trabalho, hora_almoco_inicio, hora_almoco_fim,
   minutos_almoco, intervalo_15min, funcao_id,
   hora_intervalo_inicio, hora_intervalo_fim,      -- NOVO
   hora_real_inicio, hora_real_fim)                 -- NOVO
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
```

E adicionar os valores:
```typescript
a.hora_intervalo_inicio ?? null,
a.hora_intervalo_fim ?? null,
a.hora_real_inicio ?? null,
a.hora_real_fim ?? null,
```

**Funcao 2:** `persistirAjusteResult()` em `src/main/tipc.ts` (linhas 129-144)

IDENTICO ao acima — mesmo INSERT, mesmos 4 campos extras. Esta funcao e usada pelo `escalasAjustar` handler.

**ATENCAO:** Sao funcoes separadas, duplicadas de proposito (persistirAjusteResult faz UPDATE na escala, nao INSERT). Ambas DEVEM ter os 4 campos novos.

---

### Item 5: Export — mostrar horario real + intervalo

**Arquivo:** `src/renderer/src/componentes/ExportarEscala.tsx`

**Tabela macro (resumo semanal)** — linhas 315-328:

Onde mostra `hora_inicio - hora_fim`, usar `hora_real_inicio ?? hora_inicio` e `hora_real_fim ?? hora_fim`.

Se `intervalo_15min === true`, adicionar marcacao do break (ex: texto "pausa 10:30-10:45" em font-size menor).

**Timeline de quantidade de pessoas por horario** — linhas 394-619:

NAO mudar. A timeline de fluxo (pessoas/slot) opera no range do horario operacional do setor (`buildSlots` usa `hora_abertura`/`hora_fechamento`). Os 15min purgaveis ficam FORA desse range — e correto porque a timeline mede COBERTURA OPERACIONAL, nao presenca individual.

**Decisao de design (confirmada com Marco):**
- **Visualizacao de colaborador** (celulas com horario): MOSTRA hora_real. O leigo precisa ver o horario REAL de cada pessoa.
- **Timeline de fluxo** (quantidade de pessoas por slot): NAO mostra. A timeline mede quantas pessoas estao NO SETOR em cada faixa horaria operacional. Os 15min de pausa CLT sao presenca individual, nao cobertura.

---

### Item 6: Dashboard — violacoes_pendentes REAL

**Arquivo:** `src/main/tipc.ts`, handler `dashboardResumo`

Substituir `violacoes_pendentes: 0` por:

```typescript
// Ler violacoes_hard da escala ativa (ja persistido)
const escalaAtual = await queryOne<{ status: string; violacoes_hard: number; criada_em: string }>(`
  SELECT status, violacoes_hard, criada_em FROM escalas
  WHERE setor_id = ? AND status IN ('RASCUNHO', 'OFICIAL')
  ORDER BY CASE status WHEN 'OFICIAL' THEN 1 WHEN 'RASCUNHO' THEN 2 END LIMIT 1
`, s.id)

// ...
violacoes_pendentes: escalaAtual?.violacoes_hard ?? 0,
```

---

### Item 7: Dashboard — badge "Escala desatualizada"

**Arquivos:** `src/main/tipc.ts` + `src/shared/types.ts` + `src/renderer/src/paginas/Dashboard.tsx`

1. **Type:** Adicionar `escala_desatualizada: boolean` em `SetorResumo`
2. **Handler:** Checar timestamp:

```typescript
// Algo mudou no setor depois que a escala foi gerada?
const ultimoChange = await queryOne<{ ts: string }>(`
  SELECT GREATEST(
    COALESCE((SELECT MAX(atualizada_em) FROM colaboradores WHERE setor_id = ?), '1970-01-01'),
    COALESCE((SELECT MAX(atualizada_em) FROM demandas WHERE setor_id = ?), '1970-01-01')
  )::text as ts
`, s.id, s.id)

const stale = escalaAtual && ultimoChange
  ? new Date(ultimoChange.ts) > new Date(escalaAtual.criada_em)
  : false
```

3. **Dashboard.tsx:** Mostrar badge amber "Desatualizada" + alerta no feed.

---

## ORDEM DE EXECUCAO

```
┌──────────────────────────────────────────────────────────┐
│  FASE A: H7 (backend puro, zero frontend)                 │
│  ────────────────────────────────────────                 │
│  1. Item 1 (migration v19) — 4 linhas                    │
│  2. Item 2 (types) — 8 campos                            │
│  3. Item 3 (Python post-processing) — ~25 linhas         │
│  4. Item 4 (persist bridge + tipc) — 4 campos no INSERT  │
│  → npm run typecheck                                      │
│                                                           │
│  FASE B: Dashboard (backend + frontend)                   │
│  ────────────────────────────────────────                 │
│  5. Item 6 (violacoes_pendentes real)                    │
│  6. Item 7 (escala desatualizada)                        │
│  → npm run typecheck                                      │
│                                                           │
│  FASE C: Export (frontend)                                │
│  ────────────────────────────────────────                 │
│  7. Item 5 (export mostra horario real + break)          │
│  → npm run typecheck                                      │
└──────────────────────────────────────────────────────────┘
```

---

## ARQUIVOS AFETADOS

| Arquivo | Itens |
|---------|-------|
| `src/main/db/schema.ts` | 1 |
| `src/shared/types.ts` | 2, 7 |
| `solver/solver_ortools.py` | 3 |
| `src/main/motor/solver-bridge.ts` | 4 |
| `src/main/tipc.ts` | 4, 6, 7 |
| `src/renderer/src/componentes/ExportarEscala.tsx` | 5 |
| `src/renderer/src/paginas/Dashboard.tsx` | 7 |

---

## CHECKLIST DE TESTE MANUAL

| # | Teste | Como verificar | Esperado |
|---|-------|---------------|----------|
| T1 | Intervalo 15min calculado | Gerar escala com estagiario 5h → inspecionar alocacao no DB | `hora_intervalo_inicio` e `hora_intervalo_fim` preenchidos |
| T2 | Hora real com extrapolacao | Mesmo T1 → checar `hora_real_fim` | 15min alem de `hora_fim` |
| T3 | Jornada <=4h sem intervalo | Gerar escala com colab 4h | Campos intervalo = NULL |
| T4 | Jornada >6h sem intervalo 15min | Gerar com CLT 44h (8h/dia) | `intervalo_15min = false`, almoco normal |
| T5 | Export mostra horario real | Gerar + Exportar HTML | Horario real no lugar do nominal, break marcado |
| T6 | Dashboard violacoes reais | Gerar escala com violacoes HARD → Dashboard | Badge "X alertas" aparece |
| T7 | Dashboard escala desatualizada | Gerar escala → mudar colaborador → Dashboard | Badge "Desatualizada" aparece |
| T8 | Dashboard sem falsos positivos | Gerar escala limpa sem mudar nada → Dashboard | Sem badges de alerta |
| T9 | Typecheck limpo | `npm run typecheck` | 0 erros |

### Prioridade

1. **T1, T2, T3, T4** — CRITICOS. H7 tem que funcionar corretamente por faixa de jornada.
2. **T6, T7** — ALTOS. Dashboard tem que mostrar verdade.
3. **T5** — MEDIO. Export visual.
4. **T8, T9** — BASICOS.

---

## O QUE NAO ENTRA (decisoes explicitas)

1. **Visualizacao (grid/export) MOSTRA hora_real** — resumo macro e celulas de colaborador usam `hora_real_inicio ?? hora_inicio`. **Timeline de quantidade de pessoas por horario NAO mostra** — timeline opera no range operacional do setor (cobertura), nao presenca individual. Os ±15min purgaveis ficam fora do horario do setor por design.
2. **Solver NAO modela gap** — post-processing only. Complexidade CP-SAT desproporcional.
3. **Dashboard NAO revalida** — usa `violacoes_hard` persistido. Revalidar seria ~2s por setor.
4. **Hash comparison NAO e usado** — timestamp e suficiente e O(1). Hash exigiria rebuild de solver input.
5. **Alertas do Dashboard ficam passivos** — sem modal, sem botao de acao. So informacao visual.

---

---

## AUDITORIA DO MOTOR (validacao da spec)

Auditoria feita em 2026-02-26 — leitura completa do codigo antes de implementar.

| Ponto verificado | Resultado | Observacao |
|-----------------|-----------|------------|
| `colabs[c]` tem `max_minutos_dia`? | OK | Dict completo passado de `build_model()` → `extract_solution()` |
| `minutos` e trabalho (nao presenca)? | OK | `len(slots_worked) * grid_min` — exclui gap almoco |
| `persistirSolverResult` tem 13 campos? | OK | Precisa subir pra 17 (4 novos) |
| `persistirAjusteResult` tambem? | OK | Duplicada — ambas precisam dos 4 campos |
| `checkH7` precisa mudar? | NAO | Valida flag boolean, nao horario do break |
| Export timeline vs hora_real | DESIGN | Timeline = horario setor, Resumo = hora real. OK por design |
| `dashboardResumo` ja tem `violacoes_hard`? | SIM | Na tabela escalas (persistido), so falta ler |
| Variavel `colab_info` existe? | NAO | Corrigido pra `colabs[c]` na spec |

---

*Sprint 3 spec criada em 2026-02-26. Auditoria motor: 2026-02-26. Implementado: 2026-02-26. Status: CONCLUIDO.*
