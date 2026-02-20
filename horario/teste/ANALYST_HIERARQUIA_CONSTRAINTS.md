# ANALYST — Hierarquia de Constraints: RFC v3.1 vs Motor TS vs Solver Python

> **Data:** 2026-02-19
> **Objetivo:** Mapear TODAS as 20 regras HARD do RFC, comparar implementação em cada solver, e definir hierarquia de relaxamento multi-sprint.
> **Contexto:** O solver Python bateu 100% de cobertura, mas "trapaceou" — usou gaps de 3h e removeu single-block pra turnos curtos. Isso gera escalas que nenhum supermercado usaria. Antes de corrigir, precisamos ver o quadro completo.

---

## 1. MAPA COMPLETO: 20 HARD CONSTRAINTS (RFC v3.1 §4)

### Legenda de Status

| Simbolo | Significado |
|---------|-------------|
| ✅ GERA | Implementado na GERAÇÃO (motor respeita ao criar a escala) |
| ✅ VALIDA | Implementado na VALIDAÇÃO (pós-geração, detecta violações) |
| ✅ AMBOS | Gera respeitando + valida depois |
| ⚠️ PARCIAL | Implementado mas com limitações ou desvios |
| ❌ AUSENTE | Não implementado |
| 🚫 N/A | Não aplicável ao caso de teste (ex: sem aprendiz na fixture) |

---

### 1.1 Tabela Mestre

| # | Regra RFC | Descrição | Fundamento Legal | Motor TS (gerador+validador) | Solver Python (OR-Tools) | Fixture Caixa Rita |
|---|-----------|-----------|------------------|------------------------------|--------------------------|---------------------|
| **H1** | MAX_DIAS_CONSECUTIVOS | Max 6 dias seguidos | Art. 67 CLT + OJ 410 TST | ✅ AMBOS — Fase 2 (folgas) + checkH1() | ✅ `add_h1_max_consecutive_days()` | Aplica (6 colabs, 6 dias) |
| **H2** | DESCANSO_ENTRE_JORNADAS | Min 11h entre jornadas | Art. 66 CLT | ✅ AMBOS — Fase 4 (earliestStart) + checkH2() | ✅ `add_h2_inter_journey_rest()` | Aplica (janela 08-20 = 12h gap natural, mas edge cases possíveis) |
| **H2b** | DSR_INTERJORNADA | Min 35h quando DSR (folga semanal) | Súmula 110 TST | ✅ VALIDA — checkH2b() | ❌ AUSENTE | Aplica (DSR obrigatório) |
| **H3** | RODIZIO_DOMINGO_MULHER | Mulher: max 1 dom consecutivo | CLT Art. 386 | ✅ AMBOS — Fase 2 (domConsec) + checkH3() | ❌ AUSENTE | 🚫 N/A (fixture é SEG-SAB, sem domingo) |
| **H3b** | RODIZIO_DOMINGO_HOMEM | Homem: max 2 dom consecutivos | Lei 10.101/2000 | ✅ AMBOS — Fase 2 (domConsec) + checkH3() | ❌ AUSENTE | 🚫 N/A (sem domingo na fixture) |
| **H4** | MAX_JORNADA_DIARIA | Max contrato.max_minutos_dia | Art. 58 + 59 CLT | ✅ AMBOS — Fase 3 (limites) + checkH4() | ✅ `add_h3_max_daily_minutes()` (nomeado H3 no Python) | Aplica (600min/44h, 480min/36h, 360min/30h) |
| **H5** | EXCECOES_RESPEITADAS | Férias/atestado = indisponível | CLT | ✅ AMBOS — Fase 1 (excecaoAtiva) + checkH5() | ❌ AUSENTE | 🚫 N/A (fixture sem exceções) |
| **H6** | ALMOCO_OBRIGATORIO | >6h → almoço 30-120min | Art. 71 CLT + CCT | ✅ AMBOS — Fase 5 (posicionar) + checkH6() | ⚠️ PARCIAL — `add_h6_lunch_break()` força gap na janela 12-15h, mas **não controla duração máxima** separadamente | Aplica (44h/36h colabs trabalham >6h) |
| **H7** | INTERVALO_CURTO | >4h e ≤6h → 15min obrigatório | Art. 71 §1 CLT | ✅ AMBOS — Fase 3+5 (flag) + checkH7() | ❌ AUSENTE | Aplica (30h colabs com turnos de 4-6h) |
| **H7b** | SEM_INTERVALO_4H | ≤4h → sem intervalo | Art. 71 §1 (contrário) | ✅ VALIDA — checkH7b() | ❌ AUSENTE | Pode aplicar (turnos curtos de sábado) |
| **H8** | GRID_HORARIOS | Múltiplos de 30min | Produto (não CLT) | ✅ AMBOS — grid inteiro em 30min | ✅ Por construção (slots de 30min) | Aplica |
| **H9** | MAX_SAIDA_VOLTA | Max 2 blocos trabalho/dia | Art. 71 CLT | ✅ VALIDA — checkH9() | ✅ `add_h5_contiguity()` (nomeado H5 no Python, ≤2 blocos) | Aplica |
| **H10** | META_SEMANAL | Soma semanal ±tolerância | Art. 58 CLT | ✅ AMBOS — Fase 3 (distribuição) + checkH10() | ✅ `add_h9_h10_weekly_hours()` (nomeado H9/H10) | Aplica (tolerância 30min) |
| **H11** | APRENDIZ_DOMINGO | Aprendiz nunca domingo | Art. 432 CLT | ✅ AMBOS — Fase 2 + Fase 6 (pin removal) + checkH11() | ❌ AUSENTE | 🚫 N/A (sem aprendiz na fixture) |
| **H12** | APRENDIZ_FERIADO | Aprendiz nunca feriado | Art. 432 CLT | ✅ VALIDA — checkH12() | ❌ AUSENTE | 🚫 N/A |
| **H13** | APRENDIZ_NOTURNO | Aprendiz nunca 22h-5h | Art. 404 CLT | ✅ AMBOS — Fase 4 (noturno guard) + checkH13() | ❌ AUSENTE | 🚫 N/A |
| **H14** | APRENDIZ_HORA_EXTRA | Aprendiz nunca HE | Art. 432 CLT | ✅ VALIDA — checkH14() | ❌ AUSENTE | 🚫 N/A |
| **H15** | ESTAGIARIO_JORNADA | Max 6h/dia 30h/sem | Lei 11.788 Art. 10 | ✅ AMBOS — Fase 3 (limite) + checkH15() | ❌ AUSENTE | 🚫 N/A (sem estagiário) |
| **H16** | ESTAGIARIO_HORA_EXTRA | Estagiário nunca HE | Lei 11.788 | ✅ VALIDA — checkH16() | ❌ AUSENTE | 🚫 N/A |
| **H17** | FERIADO_PROIBIDO | 25/12 e 01/01 proibidos | CCT FecomercioSP | ✅ AMBOS — Fase 1 (diaProibido) + checkH17() | ❌ AUSENTE | 🚫 N/A (período sem feriado) |
| **H18** | FERIADO_SEM_CCT | Feriado sem CCT proibido | Portaria MTE 3.665 | ✅ AMBOS — Fase 1 (feriadoSemCCT) + checkH18() | ❌ AUSENTE | 🚫 N/A |
| **H19** | FOLGA_COMP_DOM | Folga domingo dentro 7 dias | Lei 605/1949 | ✅ VALIDA — checkH19() | ❌ AUSENTE | 🚫 N/A (sem domingo) |
| **H20** | ALMOCO_POSICAO | Almoço nunca 1ª/última hora. Min 2h antes, 2h depois. | TST 5ª Turma | ✅ AMBOS — Fase 5 (earliest/latest) + checkH20() | ❌ AUSENTE (gap_in_lunch_window é parcial, mas não checa 2h antes/depois) | Aplica (colabs com almoço) |

---

### 1.2 Resumo Quantitativo

| Sistema | Implementadas | Ausentes | N/A na Fixture |
|---------|--------------|----------|----------------|
| **Motor TS** | **20/20** (todas) | 0 | — |
| **Solver Python** | **7/20** | **13/20** | 8 são N/A pra fixture |

**Das 13 ausentes no Python, 8 são N/A na fixture atual** (sem domingo, sem aprendiz, sem estagiário, sem feriado). Restam **5 que DEVERIAM estar no solver e NÃO estão:**

| # | Regra | Impacto na Fixture Caixa Rita |
|---|-------|-------------------------------|
| **H2b** | DSR 35h | Quando tem folga semanal, o descanso total precisa ser 35h (não só 11h). Sem isso, o solver pode colocar alguém saindo 20h sexta e voltando 8h sábado com folga domingo = ok pra H2 mas pode violar H2b. |
| **H6** | Almoço duração máxima | O solver tem `add_h6_lunch_break` mas **não limita gap a 2h max**. O `add_max_gap_size` faz isso, mas está com **max=6 slots (3h)** em vez de **4 slots (2h CLT)**. TRAPAÇA DETECTADA. |
| **H7** | Intervalo 15min >4h≤6h | O solver **ignora completamente**. Turno de 5h deveria ter pausa 15min. Sem isso, o solver gera turnos curtos sem nenhuma pausa. |
| **H20** | Posição do almoço | O `gap_in_lunch_window` força gap entre 11-15h, mas **não garante min 2h de trabalho antes E depois**. Um turno 08:00-17:00 com almoço 08:30-09:30 passaria no solver Python mas viola H20. |
| **Single block ≤6h** | Implícito em H6/H7/H7b | Turno ≤6h = bloco único (sem gap). O solver **removeu** `add_single_block_short_days()`. TRAPAÇA DETECTADA. |

---

## 2. TRAPAÇAS ATUAIS DO SOLVER PYTHON

O solver OR-Tools atualmente "trapaceia" em 3 pontos para atingir 100% de cobertura:

### Trapaça 1: Gap máximo de 3h (deveria ser 2h CLT)

```
SITUAÇÃO ATUAL:  add_max_gap_size(model, ..., max_gap_slots=6)  → 3h
CORRETO (CLT):   add_max_gap_size(model, ..., max_gap_slots=4)  → 2h
RESULTADO:       Solver cria "almoços" de 2.5-3h pra redistribuir pessoas entre picos
```

**Por que o solver precisa de 3h?** Com 2h max, o solver não consegue cobrir TODOS os 71 slots/dia com 6 pessoas. A margem é 1.9% — apertadíssima. O gap de 3h dá flexibilidade extra (pessoa sai do turno da manhã mais cedo, "almoça" 3h, volta pro turno da tarde).

**Efeito real:** Rita NUNCA faz isso. Almoço máximo dela é 1.5h. 3h de "almoço" significa o funcionário sentado no refeitório por 3 horas. Absurdo operacional.

### Trapaça 2: Removeu single-block pra turnos ≤6h

```
SITUAÇÃO ATUAL:  add_single_block_short_days() COMENTADO/REMOVIDO
CORRETO (CLT):   Turno ≤6h = 1 bloco contínuo (sem gap)
RESULTADO:       Solver pode colocar funcionário de 30h trabalhando 3h manhã + pausa 2h + 3h tarde
```

**Por que causa infeasibility?** Os funcionários de 30h (ALICE, MAYUMI, HELOISA) têm max 6h/dia. Com single-block, eles cobrem OU manhã OU tarde, nunca ambos. Mas a demanda pede 4 pessoas das 10-12h E 3 pessoas das 17-19h. Sem os 30h "partidos", falta gente num dos períodos.

**Efeito real:** Rita resolve isso NÃO dando split shift — ela faz os 30h cobrirem OU manhã OU tarde e aceita cobertura menor no outro período. É assim que supermercado funciona.

### Trapaça 3: Almoço sem restrição de posição (H20)

```
SITUAÇÃO ATUAL:  gap_in_lunch_window força gap entre slots 6-14 (11:00-15:00)
                 MAS não garante min 2h de trabalho antes E depois
CORRETO (RFC):   Almoço após min 2h de trabalho E antes de min 2h de trabalho restante
RESULTADO:       Solver pode colocar almoço logo no início ou final do turno
```

---

## 3. A HIERARQUIA DE PRECEDÊNCIA (RFC §2)

O RFC define 5 níveis. Esta é a hierarquia CANÔNICA:

```
NÍVEL 1 — HARD LEGAL (H1-H20)
│  INVIOLÁVEL. Motor não gera escala com violação.
│  Sub-categorias:
│  ├── CLT PURA (Art. 66, 67, 71, 58, 59, 386, 404, 432) → JAMAIS relaxar
│  ├── TST (Súmula 110, 437, 5ª Turma) → JAMAIS relaxar
│  ├── LEI FEDERAL (605/1949, 10.101/2000, 11.788) → JAMAIS relaxar
│  ├── CCT (FecomercioSP, Portaria 3.665) → Relaxar SÓ se CCT mudar
│  └── PRODUTO (Grid 30min, Min 4h/dia) → Relaxável por decisão do Marco
│
├── NÍVEL 2 — PISO OPERACIONAL
│     Mínimo estrutural do setor. Relaxar = setor não funciona.
│     Caixa Rita: piso = 2 (nunca menos de 2 caixas abertas).
│
├── NÍVEL 3 — DEMANDA PLANEJADA (target)
│     O que o RH QUER por slot. Soft por padrão, quasi-hard com override.
│     Este é o "100%" que queremos atingir.
│
├── NÍVEL 4 — ANTIPATTERNS (qualidade)
│     AP1-AP17: clopening, lunch collision, workload imbalance...
│     Penalizam score mas NÃO impedem geração.
│
└── NÍVEL 5 — SOFT (preferências)
      S1-S5: turno preferido, dia a evitar, equilíbrio aberturas...
      Bonus/penalidade leve.
```

**REGRA DE OURO:** Quando nível N impede nível N+1, nível N VENCE.

---

## 4. HIERARQUIA DE RELAXAMENTO MULTI-SPRINT

O solver deve tentar na seguinte ordem. Só avança pro próximo sprint se PROVAR infeasibility no anterior.

### Sprint 1 — STRICT (Zero Concessões)

Todas as constraints CLT ativas, demanda HARD:

| Constraint | Config | Fundamento |
|------------|--------|------------|
| H1: Max consecutivos | 6 dias | CLT |
| H2: Interjornada | 11h (22 slots) | CLT |
| H2b: DSR | 35h | TST |
| H4: Max jornada | Per contrato | CLT |
| H6: Almoço >6h | Gap 2-4 slots (1-2h) | CLT Art. 71 |
| H7: Intervalo >4h≤6h | 15min (1 slot, não conta como trabalho) | CLT Art. 71 §1 |
| H8: Grid | 30min | Produto |
| H9: Max 2 blocos | ≤2 rising edges | CLT Art. 71 |
| H10: Meta semanal | ±30min (tolerância) | CLT Art. 58 |
| H20: Posição almoço | Min 2h antes, 2h depois | TST |
| Single block ≤6h | 1 bloco contínuo | CLT Art. 71 (sem gap = sem almoço) |
| Max gap | 4 slots (2h) | CLT Art. 71 |
| Min diário | 8 slots (4h) | Produto |
| **Demanda** | **HARD (100%)** | **Nível 3** |

**Resultado esperado:** INFEASIBLE (já provamos isso).

**Diagnóstico:** Com 6 pessoas e 71 demand-slots/dia, margem de 1.9%. Single-block + max-gap-2h + strict CLT não permite cobrir 100%.

---

### Sprint 2 — RELAXAR DEMANDA (Nível 3 → Soft)

Mesmas constraints CLT do Sprint 1, mas demanda vira SOFT com penalização:

| Mudança | De | Para |
|---------|-----|------|
| Demanda | HARD (100%) | SOFT — minimizar déficit total |
| Tudo mais | Igual Sprint 1 | Igual Sprint 1 |

**Objetivo:** `minimize(sum(deficit[d,s]) * peso_deficit + spread * peso_spread)`

**Resultado esperado:** FEASIBLE. Cobertura ~80-90% (similar à Rita).

**POR QUE ISSO É O CORRETO:** A Rita também não atinge 100% (ground truth = 81.2%). Com o quadro de funcionários existente e CLT strict, 100% é MATEMATICAMENTE IMPOSSÍVEL. O solver agora mostra ONDE falta cobertura, e o RH decide: contratar mais gente ou aceitar o déficit.

---

### Sprint 3 — RELAXAR PRODUTO (Se Sprint 2 der <70%)

**SÓ SE** Sprint 2 resultar em cobertura inaceitável (<70%):

| Mudança | De | Para | Justificativa |
|---------|-----|------|---------------|
| Min diário | 4h (8 slots) | 3h (6 slots) | Permite turnos mais curtos pra cobrir gaps |
| Grid | 30min | 30min (não muda) | — |
| Tolerância | 30min | 60min | Mais flexibilidade na distribuição semanal |

**CLT CONTINUA INTACTA.** Só relaxa decisões de PRODUTO.

---

### Sprint 4 — RELAXAR ALMOCO (Se Sprint 3 der <70%)

**ÚLTIMO RECURSO, com aviso ao RH:**

| Mudança | De | Para | Justificativa |
|---------|-----|------|---------------|
| Max gap | 4 slots (2h) | 5 slots (2.5h) | CCT FecomercioSP autoriza redução |
| Single block ≤6h | Obrigatório | Permitir 2 blocos com gap 15min | Flexibilidade operacional |

**NOTA:** Mesmo no Sprint 4, o max gap NUNCA passa de 5 slots (2.5h). 3h (6 slots) é PROIBIDO em qualquer sprint.

---

### Sprint 5 — DIAGNÓSTICO (Se Sprint 4 der <70%)

Se nada funcionar: o problema NÃO é o solver. É o QUADRO DE PESSOAL.

**Output:** "Impossível atingir cobertura aceitável com o quadro atual. Sugestão: contratar +1 funcionário de 30h para cobrir [slots X-Y]."

---

## 5. CONSTRAINTS AUSENTES: PRIORIDADE DE IMPLEMENTAÇÃO

Para o teste cego Caixa Rita, as constraints que IMPORTAM (são aplicáveis à fixture):

### Prioridade ALTA (impactam resultado)

| # | Constraint | Impacto | Complexidade |
|---|-----------|---------|--------------|
| 1 | **Fix max_gap → 4 slots (2h)** | ALTO — remove a trapaça principal | Trivial (mudar 1 número) |
| 2 | **Restaurar single_block_short_days** | ALTO — impede split shifts ilegais pra ≤6h | Trivial (descomentar) |
| 3 | **H20: Posição almoço** | MEDIO — garante 2h antes/depois | Novo constraint (~20 linhas) |
| 4 | **H6: Max gap = almoço max 2h** | MEDIO — já coberto por fix #1, mas reforçar | Validação extra |
| 5 | **Demanda SOFT em Sprint 1** | ALTO — reconhecer infeasibility gracefully | Mover de HARD→SOFT com penalização |

### Prioridade BAIXA (N/A na fixture, mas necessárias pro produto final)

| # | Constraint | Quando implementar |
|---|-----------|-------------------|
| 6 | H2b: DSR 35h | Quando testar fixtures com domingo |
| 7 | H3/H3b: Rodízio domingo | Quando testar fixtures com domingo |
| 8 | H5: Exceções | Quando testar fixtures com férias/atestado |
| 9 | H7/H7b: Intervalo 15min | Agora (impacta turnos curtos de 30h workers) |
| 10 | H11-H16: Aprendiz/Estagiário | Quando testar fixtures específicas |
| 11 | H17-H19: Feriado/DSR | Quando testar fixtures com feriados |

---

## 6. COMO A RITA RESOLVE O PROBLEMA

Analisando o ground truth do PDF:

### Padrão da Rita (escaladora humana experiente)

1. **44h workers (CLEONICE, ANA JULIA):** Turnos longos (8-10h) com almoço de 1h-1.5h. Cobrem manhã E tarde.
2. **36h worker (GABRIEL):** Turnos médios (4.5-7.5h). Sem almoço nos dias curtos.
3. **30h workers (ALICE, MAYUMI, HELOISA):** Turnos de **4.5-5.5h em bloco único**. Revezam: uns de manhã, outros de tarde. NUNCA split shift.

### Insight crítico: Cobertura da Rita

A Rita **NÃO atinge 100%** nos slots de pico:
- 10:00-12:00 pede 4 pessoas → Rita coloca 3-4 (às vezes 3)
- 17:00-19:00 pede 3 pessoas → Rita coloca 2-3 (às vezes 2)

**Ela aceita o déficit** porque sabe que com 6 pessoas e CLT, é IMPOSSÍVEL cobrir tudo. E preferível ter 3 em vez de 4 do que ter alguém com turno ilegal.

---

## 7. NOMENCLATURA PYTHON vs RFC

O solver Python usa nomes diferentes do RFC. Mapeamento:

| Python (constraints.py) | RFC (H#) | Equivalência |
|------------------------|----------|--------------|
| `add_h1_max_consecutive_days` | H1 | ✅ Exata |
| `add_h2_inter_journey_rest` | H2 | ✅ Exata |
| `add_h3_max_daily_minutes` | **H4** (não H3!) | ⚠️ Nome errado no Python |
| `add_h5_contiguity` | **H9** (não H5!) | ⚠️ Nome errado no Python |
| `add_h6_lunch_break` | H6 | ⚠️ Parcial (sem max duration) |
| `add_h9_h10_weekly_hours` | H10 | ✅ Exata |
| `add_demand_hard` | Nível 3 | ✅ (mas deveria ser soft) |
| `add_max_gap_size` | Implícito em H6 | ⚠️ Config errada (3h em vez de 2h) |
| `add_single_block_short_days` | Implícito em H6/H7 | ❌ Removido |
| `add_gap_in_lunch_window` | H20 (parcial) | ⚠️ Sem check de 2h antes/depois |
| `add_min_daily_work` | Produto (min 4h) | ⚠️ Config 3.5h em vez de 4h |

**Ação necessária:** Renomear funções Python para alinhar com o RFC (H1→H1, H3→H4, H5→H9, etc.)

---

## 8. PLANO DE AÇÃO

### Fase 1: Corrigir Trapaças (30min)
1. `max_gap_slots`: 6 → **4** (2h CLT)
2. Restaurar `add_single_block_short_days()`
3. `min_daily_work`: 7 → **8** (4h = decisão de produto)
4. Demanda: HARD → **SOFT** com penalização (Sprint 2 automático)

### Fase 2: Implementar Constraints Faltantes (1h)
5. **H20:** `add_h20_lunch_position()` — min 2h antes e 2h depois do gap
6. **H7:** `add_h7_short_break()` — turno >4h≤6h precisa de pausa 15min (modelar como: minutos efetivos = minutos alocados - 15min, ou simplesmente como anotação pós-solve)
7. Renomear funções Python → nomenclatura RFC

### Fase 3: Multi-Sprint Solver (1h)
8. Implementar loop: Sprint 1 (strict) → Sprint 2 (demanda soft) → Sprint 3 (relaxar produto) → Sprint 4 (relaxar almoço)
9. Cada sprint tenta resolver. Se INFEASIBLE, avança. Se OPTIMAL, para e reporta qual sprint conseguiu.
10. Output inclui: "Sprint N — constraints relaxadas: [lista]"

### Fase 4: Re-rodar Teste Cego (15min)
11. Rodar solver Python com hierarquia correta
12. Re-rodar comparador
13. Esperar: cobertura ~80-90% (similar à Rita), 0 violações CLT

---

## 9. DISCLAIMERS CRÍTICOS

- 🚨 **100% de cobertura com 6 pessoas e CLT strict é MATEMATICAMENTE IMPOSSÍVEL** para esta fixture. O solver que diz 100% está TRAPACEANDO.
- 🚨 **A Rita prova isso:** Com 30+ anos de experiência, ela atinge 81-90%. Se o solver supera a Rita significativamente, desconfie.
- 🚨 **O nome H3/H5 no Python está ERRADO** — pode confundir na manutenção. Alinhar com RFC antes de prosseguir.
- 🚨 **Intervalo de 15min (H7)** não é modelável facilmente como constraint CP-SAT (é uma pausa que não gera gap no grid). Alternativa: modelar como redução do tempo efetivo no pós-processamento.
- 🚨 **Multi-sprint NÃO é "tentar tudo e pegar o melhor"** — é uma PROVA de impossibilidade progressiva. Sprint N só roda se Sprint N-1 PROVOU infeasibility.

---

## 10. TL;DR EXECUTIVO

| Aspecto | Estado Atual | Estado Desejado |
|---------|-------------|-----------------|
| Constraints no Python | 7/20 | 12/20 (fixture) → 20/20 (produto) |
| Max gap | 3h (TRAPAÇA) | 2h (CLT) |
| Single block ≤6h | REMOVIDO (TRAPAÇA) | ATIVO |
| Demanda | HARD (causa infeasibility) | SOFT com penalização (Sprint 2) |
| Cobertura esperada | 100% (falso) | ~80-90% (real, similar à Rita) |
| Nomenclatura | Desalinhada RFC | Alinhada H1-H20 |
| Multi-sprint | Não existe | 4 sprints com prova de infeasibility |
