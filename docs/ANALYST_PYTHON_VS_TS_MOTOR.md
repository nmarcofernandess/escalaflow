# ANALYST: Python (OR-Tools) vs TypeScript Motor — Decisao Estrategica

## TL;DR EXECUTIVO

O solver Python (OR-Tools CP-SAT) e o motor TypeScript sao **algoritmos fundamentalmente diferentes**. O Python e um **otimizador matematico** que garante solucao OTIMA. O TS e uma **heuristica greedy** que tenta montar algo razoavel passo a passo. NAO da pra replicar a qualidade do OR-Tools em TypeScript puro — e nem precisa. A estrategia correta e: **Python = oraculo de teste, TS = motor de producao**, e usar o Python pra revelar bugs no TS (como ja fez com o H7b).

---

## 1. PERGUNTA: O Python ta muito diferente do motor do Node ne?

**Sim. SAO FUNDAMENTALMENTE DIFERENTES.**

### Motor TS (gerador.ts) — Heuristica Greedy Sequencial

```
FASE 0  Preflight (DB queries)
   |
FASE 1  Montar grid de slots 30min
   |
FASE 2  Distribuir folgas (prioridade: menor demanda)      ← decisao IRREVERSIVEL
   |
FASE 3  Distribuir horas por dia (proporcional a demanda)  ← decisao IRREVERSIVEL
   |
FASE 4  Alocar horarios (sequencial, respeitando H2)       ← decisao IRREVERSIVEL
   |
FASE 5  Posicionar almoco (greedy, com AP3 stagger)        ← decisao IRREVERSIVEL
   |
FASE 6  Validar + backtrack (max 3 tentativas)             ← correcao LIMITADA
   |
FASE 7  Pontuar + explicar + output
   |
POST    Optimizer v2 (simulated annealing, budget ~1.2s)   ← melhoria LOCAL
```

**Problema fundamental:** Cada fase toma decisoes que as fases seguintes NAO conseguem desfazer. Se a Fase 2 da folga no dia errado, a Fase 4 nao consegue corrigir. O backtrack da Fase 6 e limitado a 3 iteracoes e so corrige violacoes HARD, nao otimiza cobertura.

### Solver Python (OR-Tools CP-SAT) — Otimizador Matematico Global

```
1. Declarar 6×6×24 = 864 variaveis booleanas:  work[c,d,s] = 0 ou 1
2. Declarar TODAS as constraints simultaneamente (H1,H2,H4,H6,H7b,H9,H9b,H10,H20,DIAS,MIN)
3. Declarar objetivo: min(deficit×10000 + surplus×5000 + AP1×80 + spread×1)
4. Apertar o botao SOLVE
5. OR-Tools encontra a solucao OTIMA em 2.4 segundos
```

**Vantagem fundamental:** O solver ve TODAS as variaveis e TODAS as constraints ao mesmo tempo. Nao existe "decidir folga antes de saber horario". Ele decide TUDO junto.

### Analogia Simples

| Motor TS | Solver Python |
|----------|---------------|
| Montar quebra-cabeca comecando pelo canto, peca por peca | Ver TODAS as pecas de cima e encaixar tudo ao mesmo tempo |
| GPS recalculando rota a cada esquina | Satellite que ve toda a cidade e calcula a rota otima |
| Humano experiente com 30 anos (Rita) | Computador que testou todas as combinacoes possiveis |

---

## 2. PERGUNTA: E talvez nao e so o H7b que vai ta errado no TS?

**Correto. O TS tem VARIOS problemas potenciais que o Python nao tem, justamente pela natureza greedy.**

### Bugs Provaveis no Motor TS

| # | Problema | Risco | Evidencia |
|---|----------|-------|-----------|
| 1 | **Folgas em dias de alta demanda** | ALTO | Fase 2 escolhe folga pelo dia de menor demanda TOTAL, mas nao considera que tirar UMA pessoa do dia X pode ter impacto diferente do dia Y dependendo do perfil de horas daquela pessoa |
| 2 | **Distribuicao de horas desbalanceada** | MEDIO | Fase 3 distribui proporcional a demanda, mas nao sabe se o HORARIO vai ser viavel — pode atribuir 8h num dia onde a janela so permite 6h de cobertura util |
| 3 | **Horarios empilhados** | ALTO | Fase 4 aloca todos comecando o mais cedo possivel (greedy), resultando em 5 pessoas das 08:00-12:00 e 1 pessoa das 14:00-20:00 |
| 4 | **H7b equivalente no TS** | CONFIRMADO | O gerador.ts NAO tem constraint H7b explicita na Fase 4. Ele simplesmente aloca um bloco continuo. Mas o validador pode reportar violacao H7b em blocos que o optimizer tenta criar |
| 5 | **Almoco sem redistribuicao** | MEDIO | Fase 5 posiciona almoco DEPOIS de alocar horarios. Se 3 pessoas almocam ao mesmo tempo, a cobertura despenca. O AP3 so desloca 30min, nao redistribui |

### O que o Python resolveu que o TS NAO resolve

1. **Cobertura 100% da demanda** — Python: 0 deficit. TS: depende da sorte do greedy.
2. **Distribuicao otima de surplus** — Python minimiza excesso. TS nao tem esse conceito.
3. **Almoco posicionado otimamente** — Python: gap na janela 11:00-15:00 E cobertura mantida. TS: greedy.
4. **Horas semanais exatas** — Python: todos -30min da meta (dentro da tolerancia). TS: pode variar muito.

---

## 3. PERGUNTA: No Python nao temos do H11 ao H19 ne?

**Correto. O Python implementa:**

| Constraint | Python | TS | Nota |
|------------|--------|----|------|
| H1 Max 6 dias consecutivos | ✅ | ✅ | |
| H2 Interjornada 11h | ✅ | ✅ | |
| H3/H3b Rodizio domingo | ❌ | ✅ | Sem domingo na fixture |
| H4 Max jornada diaria | ✅ | ✅ | |
| H5 Excecoes (ferias/atestado) | ❌ | ✅ | Sem excecoes na fixture |
| H6 Almoco obrigatorio >6h | ✅ | ✅ | |
| H7 Intervalo 15min >4h<=6h | Info only | ✅ | |
| H7b Max gap 2h | ✅ (FIXADO) | Parcial | TS nao tem explicito |
| H8 Grid 30min | Implicito | ✅ | |
| H9 Max 2 blocos/dia | ✅ | ❌ | TS nao tem |
| H9b Bloco unico dia curto | ✅ | ❌ | TS nao tem |
| H10 Meta semanal ±tol | ✅ | ✅ | |
| **H11 Aprendiz nunca domingo** | ❌ | ✅ | N/A (sem aprendiz) |
| **H12 Aprendiz nunca feriado** | ❌ | ✅ | N/A |
| **H13 Aprendiz nunca noturno** | ❌ | ✅ | N/A |
| **H14 Estagiario max 6h/dia** | ❌ | ✅ | N/A (sem estagiario) |
| **H15 Estagiario nunca HE** | ❌ | ✅ | N/A |
| **H16 Estagiario max 30h/sem** | ❌ | ✅ | N/A |
| **H17 Feriado proibido** | ❌ | ✅ | N/A (sem feriados) |
| **H18 Feriado sem CCT** | ❌ | ✅ | N/A |
| **H19 Folga compensatoria dom** | ❌ | ✅ | N/A |
| H20 Gap na janela almoco | ✅ | ✅ | |
| DIAS Dias de trabalho | ✅ | ✅ | |
| MIN Min 4h/dia | ✅ | ✅ | |

**H11-H19 sao irrelevantes pra essa fixture** (sem aprendiz, sem estagiario, sem feriados, sem domingos). Mas se quisermos o Python como solver COMPLETO, precisam ser adicionados. A boa noticia: sao constraints simples de implementar em CP-SAT (~50 linhas total).

---

## 4. PERGUNTA: Os inputs do Python sao do BD real?

**Sao EQUIVALENTES, mas com uma DIVERGENCIA IMPORTANTE.**

### O que bate

| Campo | Fixture | DB Seed | Match? |
|-------|---------|---------|--------|
| CLEONICE horas_semanais | 44 | 44 (CLT 44h) | ✅ |
| GABRIEL horas_semanais | 36 | 36 (CLT 36h) | ✅ |
| ALICE/MAYUMI/HELOISA horas | 30 | 30 (CLT 30h) | ✅ |
| CLEONICE max_minutos_dia | 600 | 600 | ✅ |
| GABRIEL max_minutos_dia | 480 | 480 | ✅ |
| 30h workers max_minutos_dia | 360 | 360 | ✅ |
| Demanda por slot | Fixture slots | DB seed segments | ✅ |
| Grid 30min | ✅ | ✅ | ✅ |
| Tolerancia 30min | ✅ | ✅ | ✅ |

### O que NAO bate (CRITICO)

| Campo | Fixture | DB Seed | Impacto |
|-------|---------|---------|---------|
| **GABRIEL dias_trabalho** | **6** | **5** (CLT 36h) | Solver forca 6 dias; DB daria folga |
| **ALICE dias_trabalho** | **6** | **5** (CLT 30h) | Idem |
| **MAYUMI dias_trabalho** | **6** | **5** (CLT 30h) | Idem |
| **HELOISA dias_trabalho** | **6** | **5** (CLT 30h) | Idem |

**Consequencia:** A fixture forca TODO MUNDO a trabalhar 6 dias (SEG-SAB). Mas na realidade (DB seed), CLT 30h e CLT 36h tem 5 dias de trabalho. Rita da folga pra cada um num dia diferente (GABRIEL folga TER, MAYUMI folga QUA, HELOISA folga SEX).

**Isso explica porque o Python gera dias de 4h (240min):** 30h em 6 dias = 5h/dia medio. Rita faz 30h em 5 dias = 6h/dia medio — muito mais natural.

### Input ideal pro solver

Para usar o solver como referencia REAL, a fixture precisa usar `dias_trabalho` do DB seed:

```
CLEONICE: 6 dias ← ok
GABRIEL:  5 dias ← precisa folga
ANA JULIA: 6 dias ← ok
ALICE:    5 dias ← precisa folga
MAYUMI:   5 dias ← precisa folga
HELOISA:  5 dias ← precisa folga
```

Com isso o solver vai ESCOLHER qual dia dar folga pra cada um — que e exatamente o que a Rita faz.

---

## 5. PERGUNTA: O codigo Python pode ser replicado no TS?

### Resposta Curta: NAO. E nem deveria.

### Por que nao

| Aspecto | Viabilidade | Nota |
|---------|-------------|------|
| OR-Tools em WASM | Teoricamente possivel | Binary ~50MB, nao cabe num Electron app decente |
| OR-Tools via Python no Electron | Possivel | Exige Python instalado no PC dos pais. INACEITAVEL. |
| Solver JS/TS equivalente | Nao existe | Nenhum solver JS chega perto do CP-SAT |
| Port manual do algoritmo | Impossivel | CP-SAT usa pesquisa industrial (branch-and-bound, clause learning, restarts). Decadas de pesquisa. |
| MiniZinc + WASM | Possivel mas fragil | Ainda precisa de backend solver |

### O que DEVEMOS fazer

```
┌──────────────────────────────────────────────────────────┐
│                    ESTRATEGIA CORRETA                     │
│                                                          │
│  Python OR-Tools = ORACULO DE TESTE / BENCHMARK          │
│                    Roda no DEV, valida qualidade          │
│                    Encontra bugs no motor TS              │
│                    Define o "teto" de qualidade           │
│                                                          │
│  Motor TS = PRODUTO DE PRODUCAO                          │
│             Roda no Electron, offline, sem deps           │
│             Melhorado iterativamente usando               │
│             insights do oraculo Python                    │
│                                                          │
│  NAO MANTER 2 MOTORES EM PRODUCAO                        │
│  Python e ferramenta de desenvolvimento, nao de produto.  │
└──────────────────────────────────────────────────────────┘
```

### Ciclo de melhoria

```
1. Rodar Python solver com fixture X
2. Comparar resultado com motor TS no mesmo input
3. Encontrar divergencias (deficit, violacoes, horas)
4. Identificar QUAL fase do motor TS causa o problema
5. Corrigir o motor TS
6. Repetir com fixture Y
```

Isso e exatamente o que aconteceu com H7b: o Python revelou que 100% de cobertura e POSSIVEL, e achamos o bug.

---

## 6. PERGUNTA: O TS agora nao chega nem perto ne?

### Comparacao Honesta

| Metrica | Python OR-Tools | Motor TS (estimativa) | Rita (humano) |
|---------|-----------------|----------------------|---------------|
| **Cobertura demanda** | 100% (0 deficit) | ~70-85% (depende da sorte) | ~85% (experiencia) |
| **Violacoes HARD** | 0 | 0-3 (backtrack corrige) | 0 (30 anos de pratica) |
| **Horas semanais** | -30min de cada meta | ±60-120min | ±270min (GABRIEL -4.5h!) |
| **Solve time** | 2.4s | <500ms | 2-3 horas manuais |
| **Almoco posicionado** | Janela 11-15h | Greedy ~11:00 pra todos | Variado, natural |
| **Surplus** | 58 slots | Alto (empilhamento) | Baixo (experiencia) |

### Onde o TS PERDE feio

1. **Cobertura:** TS nao tem conceito de "redistribuir surplus". Empilha pessoas onde nao precisa, falta onde precisa.
2. **Horarios:** TS aloca sequencialmente, comecando todo mundo cedo. Python distribui globalmente.
3. **Almoco:** TS empilha almocos no mesmo horario (AP3 so desloca 30min). Python distribui otimamente.

### Onde o TS PODE melhorar sem solver

1. **Optimizer v2 (simulated annealing)** ja existe mas tem budget de 1.2s e poucas neighborhoods. Pode ser expandido.
2. **Fase 4 melhorada** — alocar horarios considerando demanda por slot, nao so "o mais cedo possivel".
3. **Feedback loop** — apos Fase 6, recalcular cobertura e redistribuir surplus.

### Estimativa realista

Com melhorias incrementais no motor TS, da pra chegar a **90-95% da qualidade do Python** para cenarios simples (sem aprendiz, sem feriados complexos). Para cenarios complexos, o gap sera maior.

---

## 7. PERGUNTA: Comparando com a da Rita, o Python gerou algo estranho?

### Analise Detalhada: Python vs Rita

#### Horas Semanais

| Pessoa | Rita | Python | Meta | Rita vs Meta | Python vs Meta |
|--------|------|--------|------|--------------|----------------|
| CLEONICE | 2640 | 2610 | 2640 (44h) | ✅ 0 | ✅ -30min |
| GABRIEL | 1890 | 2130 | 2160 (36h) | ❌ **-270min!** | ✅ -30min |
| ANA JULIA | 2640 | 2610 | 2640 (44h) | ✅ 0 | ✅ -30min |
| ALICE | 1560 | 1770 | 1800 (30h) | ❌ **-240min!** | ✅ -30min |
| MAYUMI | 1530 | 1770 | 1800 (30h) | ❌ **-270min!** | ✅ -30min |
| HELOISA | 1530 | 1770 | 1800 (30h) | ❌ **-270min!** | ✅ -30min |

**ACHADO IMPORTANTE:** Rita nao bate as horas semanais! GABRIEL fica 4.5h ABAIXO da meta de 36h. As 30h ficam 4-4.5h abaixo. Isso pode significar:
- A) Rita prioriza cobertura sobre conformidade de horas
- B) O contrato real dos colaboradores e diferente do que assumimos
- C) Rita compensa em outras semanas (o PDF e de UMA semana so)

O Python bate TODAS as metas com -30min (exatamente na tolerancia).

#### Distribuicao Diaria (CLEONICE — referencia)

| Dia | Rita (min) | Python (min) | Diferenca |
|-----|-----------|-------------|-----------|
| SEG | 570 | 480 | Rita +90 |
| TER | 360 | 480 | Python +120 |
| QUA | 570 | 450 | Rita +120 |
| QUI | 330 | 270 | Rita +60 |
| SEX | 540 | 480 | Rita +60 |
| SAB | 270 | 450 | Python +180 |
| **TOTAL** | **2640** | **2610** | |

Rita faz dias MUITO longos (570min = 9.5h!) compensados por dias curtos. Python distribui mais uniformemente.

**Observacao:** Rita tem CLEONICE trabalhando 9.5h na SEG e QUA. Isso ULTRAPASSA o max_minutos_dia de 600min (10h) mas esta dentro dos 570min que esta na CLT pra 44h. Na verdade, 570min = 9h30. Com almoco de 1h30, a presenca e de 11h. Isso e viavel mas PESADO.

#### Algo "estranho" no Python?

| Aspecto | Avaliacao | Nota |
|---------|-----------|------|
| Dias de 4h (240min) | ⚠️ Parece estranho | Resultado de dias_trabalho=6 na fixture. Com 5 dias, nao teria dias tao curtos |
| Todos trabalham 6 dias | ⚠️ Parece estranho | Rita da folgas. Fixture forca 6 dias |
| Cobertura 100% | ✅ Excelente | Rita nao consegue 100% |
| Almocos variados | ✅ Natural | 12:00-13:00, 12:30-13:30, 13:00-14:00 — bom |
| Surplus de 58 | ✅ Controlado | 58 slots de excesso em 364 de demanda = 16% |
| Horarios escalonados | ✅ Bom | Nem todo mundo comeca as 08:00 |

### Conclusao: DA PRA ENCARAR

O resultado do Python e **valido e usavel**. Os pontos "estranhos" (dias de 4h, sem folgas) sao resultado da fixture com dias_trabalho=6, NAO do solver. Se corrigirmos a fixture, o resultado vai ficar mais parecido com o da Rita.

**Pra comparacao honesta com a Rita:** precisamos rodar novamente com dias_trabalho correto (5 pra 30h e 36h).

---

## 8. PLANO DE ACAO: Jornada para Ajustar Tudo

### FASE 1: Fix Imediato (hoje)

- [x] Corrigir H7b no Python (FEITO)
- [ ] Corrigir filtro `< 60min` no DemandaEditor.tsx (2 linhas)
- [ ] Corrigir fixture `caixa_rita.json`: dias_trabalho=5 pra GABRIEL/ALICE/MAYUMI/HELOISA

### FASE 2: Validacao Completa do Python (1-2 dias)

1. **Rodar Python com fixture corrigida** (dias_trabalho=5)
   - Validar que solver agora da folgas
   - Validar que horas semanais batem melhor
   - Comparar novamente com Rita

2. **Adicionar H11-H19 no Python** (~50 linhas em constraints.py)
   - H3/H3b: Rodizio de domingo (so importa quando fixture tem domingo)
   - H11-H13: Aprendiz (pra fixtures com aprendiz)
   - H14-H16: Estagiario (pra fixtures com estagiario)
   - H17-H18: Feriados (pra fixtures com feriados)
   - H19: Folga compensatoria domingo (quando tem domingo)

3. **Criar fixture Acougue** (segundo setor, pra validar com perfil diferente)

4. **Criar fixture com Aprendiz/Estagiario** (pra validar H11-H16)

### FASE 3: Adapter TS + Comparador (2-3 dias)

1. **Adapter TS** — converter fixture → GerarEscalaInput, rodar motor v3, gravar resultado
2. **Comparador** — ler ambos resultados + ground truth, gerar relatorio automatico
3. **Rodar teste cego completo** — Python vs TS vs Rita, metricas lado a lado

### FASE 4: Melhorar Motor TS (1 semana+)

Com base nos gaps identificados pelo comparador:

1. **Prioridade 1:** Fase 4 — alocar horarios considerando demanda por slot (nao so "o mais cedo possivel")
2. **Prioridade 2:** Surplus redistribution — apos alocacao, redistribuir excesso pra slots com deficit
3. **Prioridade 3:** Optimizer v2 — expandir neighborhoods e budget
4. **Prioridade 4:** H9/H9b — max blocos e bloco unico dia curto (TS nao tem)

### FASE 5: Integrar no Produto (apos Fase 4)

1. Motor TS gera escala → UI exibe → usuario valida
2. Python fica como ferramenta de dev/QA — NAO vai pra producao
3. Suite de testes automaticos: rodar Python + TS na mesma fixture, comparar metricas

---

## DECISAO ESTRATEGICA

### NAO MANTER 2 MOTORES

```
Python OR-Tools  =  Termometro (ferramenta de medicao)
Motor TS         =  Paciente (o que estamos curando)

Voce nao SUBSTITUI o paciente pelo termometro.
Voce USA o termometro pra saber se o tratamento ta funcionando.
```

### Racional

1. **OR-Tools nao roda em Electron offline** — exigiria Python no PC dos pais. INACEITAVEL.
2. **Motor TS ja tem 1000+ linhas** de logica CLT que o Python NAO tem (H11-H19, excecoes, pinnedCells, lookback, funcoes).
3. **O Python provou que o PROBLEMA e soluvel** — agora sabemos que 100% de cobertura e possivel.
4. **O Python revelou bugs no TS** (H7b) e vai continuar revelando.
5. **Custo de manutencao de 2 motores** e alto e o beneficio e zero em producao.

### Resumo Final

| Decisao | Status |
|---------|--------|
| Python fica como benchmark/oraculo | ✅ Confirmado |
| TS e o motor de producao | ✅ Confirmado |
| H7b precisa ser verificado/corrigido no TS | ⏳ Pendente |
| Fixture precisa ser corrigida (dias_trabalho) | ⏳ Pendente |
| H11-H19 adicionados no Python (completude) | ⏳ Baixa prioridade |
| Motor TS melhorado com insights do Python | ⏳ Sprint futuro |

---

*Gerado em 2026-02-19 — Sessao ANALYST: Python vs TS Motor*
