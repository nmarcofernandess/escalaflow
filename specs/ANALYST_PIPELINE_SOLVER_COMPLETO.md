# PIPELINE DE GERACAO DE ESCALAS — Mapa Completo

## TL;DR Executivo

O EscalaFlow tem **3 motores independentes** que calculam a mesma coisa de formas diferentes:
1. **Preview TS** (`simula-ciclo.ts`) — rapido, T/F puro, sem horarios
2. **Solver Phase 1** (`solve_folga_pattern`) — CP-SAT leve, decide bandas manha/tarde
3. **Solver Phase 2** (`build_model` + passes) — CP-SAT pesado, distribui slots 15min

O problema: cada motor aplica regras DIFERENTES, calcula ciclo de formas DIFERENTES, e o resultado de um nao garante que o proximo aceita. O Phase 2 pode DESFAZER o que o Phase 1 decidiu. O RH ve o preview e assume que a escala vai sair igual — mas nao sai.

---

## Visao Geral — O Pipeline Hoje

```
USUARIO (SetorDetalhe)
  |
  | configura folgas, ve preview
  v
┌──────────────────────────────────────────────────────────┐
│  PREVIEW TS (simula-ciclo.ts)                            │
│  Input: N, K, folgas_forcadas, demanda_por_dia           │
│  Faz: distribui T/F, calcula ciclo = N/gcd(N,K)         │
│  Regras: H1(repair), 5x2, ciclo DOM, coverage(warn)     │
│  NAO faz: H2, H4, H6, H10, horarios, almoco, bandas     │
│  Output: grid T/F + warnings + ciclo_semanas             │
│  *** TEMPO REAL — usuario ve mudancas instantaneamente ***│
└──────────────────────────────────────────────────────────┘
  |
  | usuario clica "Gerar Escala"
  | preview gera pinned_folga_externo (T→INTEGRAL, F→OFF)
  v
┌──────────────────────────────────────────────────────────┐
│  BRIDGE TS (solver-bridge.ts)                            │
│  - Busca BD: colabs, demandas, regras, excecoes          │
│  - calcularCicloDomingo() — RECALCULA ciclo (pode divergir│
│    do preview se demanda/colabs mudaram)                  │
│  - Monta SolverInput JSON                                │
│  - Se tem pinned_folga_externo: envia pro solver          │
└──────────────────────────────────────────────────────────┘
  |
  | spawn Python, stdin JSON
  v
┌──────────────────────────────────────────────────────────┐
│  SOLVER PHASE 1 (solve_folga_pattern)                    │
│  Input: SolverInput + pinned_folga_externo (se >80%)     │
│  Se >80% external pins: PULA Phase 1 inteiro             │
│  Se parcial ou nenhum: roda CP-SAT leve                  │
│  Regras: DIAS_TRAB, H1, folga_fixa, folga_var, XOR,     │
│          min_headcount, H3 ciclo, H3 max_consec,         │
│          band_demand_coverage (manha/tarde)               │
│  Output: pattern {(c,d): band} ou INFEASIBLE             │
│  *** PODE DIVERGIR DO PREVIEW ***                        │
└──────────────────────────────────────────────────────────┘
  |
  | pins do Phase 1 alimentam Pass 1
  v
┌──────────────────────────────────────────────────────────┐
│  SOLVER PASS 1 (build_model completo)                    │
│  Input: SolverInput + Phase 1 pins (se OK)               │
│  Regras: TUDO — H1-H20, H10, H6, DIAS_TRAB, MIN_DIARIO,│
│          folgas, time_window, demanda SOFT                │
│  Output: alocacoes completas ou INFEASIBLE               │
│  *** PODE VIOLAR PINS DO PHASE 1 (raro) ***             │
└──────────────────────────────────────────────────────────┘
  |
  | se Pass 1 FALHA
  v
┌──────────────────────────────────────────────────────────┐
│  PASS 1b — Mantem OFFs, libera bandas                    │
│  Relaxa: DIAS_TRABALHO, MIN_DIARIO → SOFT                │
│  Mantem: padrao de folgas (OFFs pinados)                 │
│  *** ESTRIPA BANDAS DO PHASE 1 ***                       │
└──────────────────────────────────────────────────────────┘
  |
  | se Pass 1b FALHA
  v
┌──────────────────────────────────────────────────────────┐
│  PASS 2 — Tabula rasa, sem pins                          │
│  Relaxa: DIAS_TRABALHO, MIN_DIARIO → SOFT                │
│  *** ESTRIPA TUDO DO PHASE 1 — solver decide sozinho *** │
│  *** AQUI O RH PERDE CONTROLE ***                        │
└──────────────────────────────────────────────────────────┘
  |
  | se Pass 2 FALHA
  v
┌──────────────────────────────────────────────────────────┐
│  PASS 3 — Emergencia                                     │
│  OFFICIAL: relaxa FOLGA_FIXA, FOLGA_VAR, TIME_WINDOW     │
│  EXPLORATORY: relaxa ALL_PRODUCT_RULES                   │
│  *** MODO IMPREVISIVEL — primeira coisa que funciona ***  │
└──────────────────────────────────────────────────────────┘
  |
  | resultado volta pro TS
  v
┌──────────────────────────────────────────────────────────┐
│  VALIDADOR TS (validador.ts)                             │
│  - Le alocacoes do banco                                 │
│  - RECALCULA ciclo domingo (PODE DIVERGIR do solver)     │
│  - Roda H1-H20, AP1-AP16, S1-S5                         │
│  - Persiste indicadores AUTORITATIVOS                    │
│  *** FONTE DE VERDADE FINAL ***                          │
└──────────────────────────────────────────────────────────┘
```

---

## Os 5 Problemas que o Marco Identificou

### 1. Sugestao nao e concreta

O preview mostra folgas e cobertura, mas quando o solver roda, pode mudar tudo.
O "Sugerir" roda um advisory CP-SAT leve, mas o resultado nao garante que o solver completo aceita.

**Raiz:** Phase 1 CP-SAT e o solver completo sao modelos DIFERENTES com constraints DIFERENTES.

### 2. Nao existe "pass" verdadeiro

O RH configura folgas no preview → clica gerar → solver ignora e faz o que quer.
Nao tem etapa de "voce configurou X, o solver confirmou que X funciona, agora vamos refinar".

**Raiz:** O preview TS e o solver Python sao mundos separados. O pinned_folga_externo e a unica ponte, e ela pode ser estripada no Pass 1b/2/3.

### 3. Pregas liberadas sem hierarquia

Quando o solver relaxa regras (Pass 1b→2→3), ele faz tudo silenciosamente.
O RH nao sabe QUAIS regras foram liberadas nem PORQUE. Nao tem diff pra aprovar.

**Raiz:** O multi-pass e automatico. Nao para pra perguntar. O diagnostico so diz "pass_usado: 3" depois.

### 4. Modo imprevisivel

Pass 3 roda sem nenhuma informacao do que o RH preferiu. Ele gera a primeira coisa que funciona.

**Raiz:** Pass 2 e 3 dropam todos os pins. O solver comeca do zero, sem contexto.

### 5. Vai-e-volta (zig-zag)

Preview diz ciclo 2 → solver Phase 1 calcula ciclo 5 → solver Pass 1 usa ciclo 2/1 → validador recalcula ciclo 2.
Tres fontes de verdade. Tres resultados.

**Raiz:** O calculo de ciclo existe em **6 lugares independentes** (ver secao abaixo).

---

## Duplicacoes de Logica — Onde a Mesma Coisa e Calculada

### Calculo de Ciclo Domingo (N pessoas, K demanda → periodo)

| # | Local | Arquivo:Funcao | Formula | Usado por |
|---|-------|----------------|---------|-----------|
| 1 | Preview TS | `SetorDetalhe.tsx:setorSimulacaoInfo` | N/gcd(N,K) | UI preview |
| 2 | Simula-ciclo TS | `simula-ciclo.ts:gerarCicloFase1` | Implicito no grid (spacing step) | Grid T/F |
| 3 | Bridge TS | `solver-bridge.ts:calcularCicloDomingo` | Thresholds 1/3,1/2,2/3,3/4 → ratio | `dom_ciclo_trabalho/folga` pro Python |
| 4 | Solver Python Phase 1 | `solver_ortools.py:compute_cycle_length_weeks` | N/gcd(N,D) | Phase 1 diagnostico |
| 5 | Solver Python diag | `solver_ortools.py:_compute_cycle_weeks_fast` | N/gcd(N,D) | Output diagnostico |
| 6 | Escala oficial TS | `ciclo-grid-converters.ts:escalaParaCicloGrid` | mode(sundayWorkers), N/gcd(N,mode) | Grid da escala gerada |

**Problema:** #1 e #2 calculam N/gcd(N,K). #3 usa thresholds (1/3 > dDom, 1/2 >= dDom...) que podem dar ratio DIFERENTE. #4 e #5 usam N/gcd(N,D) mas D vem de demand_by_slot. #6 infere da escala real (mode de trabalhadores por domingo).

### Contagem de Pool Rotativo (quem entra no ciclo domingo)

| # | Local | Quem exclui | Inclui tipo B? |
|---|-------|-------------|----------------|
| 1 | `SetorDetalhe.tsx` | `tipo_trabalhador !== 'INTERMITENTE'` (apos fix: inclui tipo B) | Sim |
| 2 | `solver-bridge.ts:calcularCicloDomingo` | Tipo A (sem folga_var) excluido. Tipo B inclui. | Sim |
| 3 | `solver_ortools.py:compute_cycle_length_weeks` | `!= "INTERMITENTE" or has folga_variavel` | Sim |
| 4 | `solver_ortools.py:_compute_cycle_weeks_fast` | Mesma logica | Sim |
| 5 | `ciclo-grid-converters.ts:escalaParaCicloGrid` | Verifica regra folga_variavel via regrasMap | Sim |
| 6 | `preflight-capacity.ts` | Nao filtra por tipo — disponibilidade por dia | N/A |

### Distribuicao de Folgas

| # | Local | Mecanismo |
|---|-------|-----------|
| 1 | Preview TS `simula-ciclo` | Round-robin + pickBestFolgaDay (demand-aware) |
| 2 | Phase 1 Python `solve_folga_pattern` | CP-SAT com band_demand_coverage |
| 3 | Phase 2 Python `build_model` Pass 1 | CP-SAT completo com pins do Phase 1 |
| 4 | Phase 2 Python Pass 2 | CP-SAT completo SEM pins (do zero) |

### Cobertura vs Demanda

| # | Local | O que calcula |
|---|-------|---------------|
| 1 | Preview TS `SetorDetalhe` | cobertura = count(T/DT) por dia. Demanda bruta. |
| 2 | Preview diagnostics | FOLGA_VARIAVEL_CONFLITO, capacity checks |
| 3 | Phase 1 Python | min_headcount_per_day (HARD), band_demand_coverage (HARD) |
| 4 | Phase 2 Python | S_DEFICIT (SOFT penalty 10000), slot-level coverage |
| 5 | Validador TS | Recalcula cobertura_percent das alocacoes reais |

---

## Tabela Mestra de Regras — Jornada por Etapa

| Regra | Preview TS | Phase 1 Solver | Pass 1 | Pass 1b | Pass 2 | Pass 3 OFF | Pass 3 EXPL | Validador |
|-------|-----------|---------------|--------|---------|--------|-----------|------------|-----------|
| **H1 Max 6 consec** | Repair loop | HARD | HARD | HARD | HARD | HARD | SOFT | Check |
| **H2 Interjornada 11h** | - | - | HARD | HARD | HARD | HARD | HARD | Check |
| **H4 Max 10h/dia** | - | - | HARD | HARD | HARD | HARD | SOFT | Check |
| **H5 Excecoes** | Bloqueado | Bloqueado | HARD | HARD | HARD | HARD | HARD | Check |
| **H6 Almoco** | - | - | HARD | HARD | HARD | HARD | SOFT | Check |
| **H10 Meta semanal** | - | - | HARD/SOFT | SOFT | SOFT | SOFT | SOFT | Check |
| **H3 Ciclo DOM** | Auto-calc | HARD (se cfg) | HARD (se cfg) | HARD | Via demanda | SOFT | SOFT | Recalc |
| **H3 Max DOM consec** | Preflight | HARD | HARD | HARD | HARD | HARD | OFF | Check |
| **DIAS_TRABALHO** | Implicito 5x2 | HARD | HARD | SOFT | SOFT | SOFT | SOFT | Check |
| **MIN_DIARIO** | - | - | HARD | SOFT | SOFT | SOFT | SOFT | Check |
| **Folga Fixa** | Forcada | HARD | HARD | HARD | SOFT | SOFT | OFF | Check |
| **Folga Variavel (XOR)** | Forcada | HARD | HARD | HARD | SOFT | SOFT | OFF | Check |
| **Time Window** | - | - | HARD | HARD | HARD | SOFT | OFF | Check |
| **Band Coverage** | - | HARD (manha/tarde) | Via pins | Parcial | - | - | - | - |
| **S_DEFICIT** | Warning | Guia | SOFT 10k | SOFT 10k | SOFT 10k | SOFT 10k | SOFT 10k | Calc |

**Legenda:**
- **HARD**: constraint inviolavel — solver retorna INFEASIBLE se nao consegue
- **SOFT**: penalidade no objetivo — solver tenta mas pode violar
- **Repair**: pos-processamento (fix H1 depois de gerar grid)
- **Check**: validador reporta mas nao modifica
- **Recalc**: validador recalcula do zero (pode divergir do solver)
- **OFF**: desligado completamente
- **-**: nao se aplica nesta etapa

---

## Analise Profunda: Preview TS (simula-ciclo) — O que Faz, Todas as Mensagens, e Decisoes

### O que `gerarCicloFase1` faz passo a passo

```
PASSO 1 (linhas 227-265): Padrao de domingo
  - Calcula ciclo = N/gcd(N,K), gera spacing pra evitar 2 DT seguidos
  - Se folga_fixa_dom=true: todos os domingos = F (override)
  - Output: array de DT/DF por semana

PASSO 1b (linhas 270-292): Pre-check folgas fixas vs capacidade
  - Conta quantas folgas fixas FORCADAS caem em cada dia
  - Se num dia tem mais folgas fixas que (N - demanda): gera FF_CONFLITO sentinela
  - Sentinela = "o dia inteiro ta comprometido, nao e culpa de 1 pessoa"

PASSO 2 (linhas 294-360): Distribuicao 5x2 (2 folgas por semana)
  - Para cada pessoa, na ordem:
    a) folga_fixa: se forcada pelo RH, usa. Se nao, pickBestFolgaDay(demanda)
    b) folga_variavel: se folga_fixa_dom, vira 2a folga fixa. Se nao, pickBestFolgaDay
    c) Warnings: se a folga atribuida causa deficit, gera FV_CONFLITO
  - pickBestFolgaDay: score = (N - demanda[dia]) - folgasJaAlocadas[dia]
    Escolhe o dia com MAIS SOBRA de cobertura

PASSO 3 (linhas 362-379): Repair H1
  - Varre o grid procurando >6 dias consecutivos de T
  - Se encontra: converte o 7o dia pra F (reparo forcado)
  - NAO recalcula cobertura apos reparo

PASSO 4 (linhas 385-452): Montar output
  - Calcula cobertura por dia/semana
  - Monta stats (min/max cobertura, H1 violacoes, dom consecutivos)
  - Retorna grid + warnings + stats
```

### O algoritmo `pickBestFolgaDay` (coracao da distribuicao)

```
pickBestFolgaDay(demanda_por_dia, excluir_dia):
  Para cada dia SEG-SAB (exceto excluir_dia):
    score[dia] = (N - demanda[dia]) - folgasJaContadas[dia]
  Retorna dia com MAIOR score

Exemplo: N=6, demanda=[4,4,4,4,4,4], folgas_ja=[1,0,1,0,0,2]
  scores = [6-4-1, 6-4-0, 6-4-1, 6-4-0, 6-4-0, 6-4-2] = [1, 2, 1, 2, 2, 0]
  Escolhe TER, QUI ou SEX (empate → primeiro)
```

**Limitacao:** greedy per-person. Nao faz otimizacao global. O "Sugerir" (sugerirTSHierarquico) tenta melhorar depois, mas o ganho e marginal.

### TODAS as mensagens de aviso geradas pelo preview TS

#### Fonte 1: `simula-ciclo.ts` → `FolgaWarning[]`

| # | Tipo | Trigger | Dados | Linha |
|---|------|---------|-------|-------|
| W1 | `FF_CONFLITO` (sentinela, pessoa=-1) | Pre-check: folgas fixas FORCADAS num dia excedem `N - demanda` | `dia`, `coberturaRestante`, `demandaDia` | 281-290 |
| W2 | `FF_CONFLITO` (per-person) | Folga fixa atribuida causa `N - folgasNoDia < demanda` | `pessoa` (index), `dia`, `coberturaRestante`, `demandaDia` | 323-330 |
| W3 | `FV_CONFLITO` (per-person) | Folga variavel atribuida causa deficit | `pessoa` (index), `dia`, `coberturaRestante`, `demandaDia` | 339-346 |

#### Fonte 2: `preview-diagnostics.ts` → `PreviewDiagnostic[]`

| # | Code | Severity | Gate | Titulo (template) | Trigger |
|---|------|----------|------|--------------------|---------|
| D1 | `CAPACITY_TOTAL` | error | BLOCK | "Capacidade insuficiente: N ativos, demanda pico P" | N total < pico demanda qualquer dia |
| D2 | `CAPACITY_DOMINGO` | error | BLOCK | "Capacidade insuficiente no domingo: N elegíveis, K necessários" | Pool domingo < demanda domingo |
| D3 | `DOMINGO_CICLO_IMPOSSIVEL` | error | BLOCK | "Ciclo de domingo impossível: N pessoas, K demanda, ciclo X semanas" | K > N (matematicamente impossivel) |
| D4 | `DOMINGO_TT_INEVITAVEL` | warning | WARN | "Domingos consecutivos inevitáveis: K={K}, N={N}" | K > floor(N/2) (TT = 2 domingos seguidos) |
| D5 | `PREVIEW_ESTRITO_BLOQUEADO` | error | BLOCK | "Preview bloqueado: modo estrito inviável" | Multi-pass Pass 1 falhou E nao pode relaxar |
| D6 | `FOLGA_FIXA_CONFLITO` (sentinela) | warning | ALLOW | "Muitas folgas fixas em {dia}: sobram {X}, demanda {Y}" | W1 convertido |
| D7 | `FOLGA_FIXA_CONFLITO` (per-person) | warning | ALLOW | "Folga fixa de {nome} em {dia}: sobram {X}, demanda {Y}" | W2 convertido |
| D8 | `FOLGA_VARIAVEL_CONFLITO` | warning | ALLOW | "Folga variavel de {nome} em {dia}: sobram {X}, demanda {Y}" | W3 convertido |
| D9 | `ADVISORY_*` (varios) | varies | varies | Diagnosticos do advisory CP-SAT (substituem D1-D8 quando advisory roda) | Advisory retornou |
| D10 | `CAPACITY_SEGMENTO_*` | warning | ALLOW | "Demanda de {faixa} em {dia}: max {X} pessoas, precisa {Y}" | Demanda por segmento horario > capacidade |

#### Fonte 3: `build-avisos.ts` → `Aviso[]` (final, mostrado na UI)

| # | ID | Nivel | Titulo | Trigger |
|---|---|-------|--------|---------|
| A1 | `diagnostic_*` | error/warning/info | Mesmo titulo do diagnostic D1-D10 | Qualquer diagnostic gerado |
| A2 | `preview_sem_titular` | info | "{N} posto(s) ativo(s) ainda sem titular" | Postos ativos sem colaborador anexado |
| A3 | `preview_intermitentes` | info | "{N} participante(s) intermitente(s) ficaram fora do ciclo" | Tipo A fora do preview (NOTA: hoje zerado porque tipo B entra) |
| A4 | `store_*` | varies | Avisos do appDataStore (derivados) | Store detecta inconsistencias |
| A5 | `operacao_*` | varies | Avisos de operacao (preflight, solver feedback) | Gerou escala com warnings |
| A6 | `advisory_*` | varies | Diagnosticos do advisory (substitui diagnostics basicos) | Advisory CP-SAT rodou |

### O "Sugerir" TS: `sugerirTSHierarquico`

```
Algoritmo (simula-ciclo.ts:470-529):
  1. Roda gerarCicloFase1 com folgas_forcadas originais
  2. Se sucesso e cobertura OK → nada a sugerir
  3. Se falha ou cobertura ruim:
     a) "Libera" 1 pessoa (remove folga forcada dela)
     b) Roda gerarCicloFase1 de novo
     c) Se melhorou → propoe diff: "liberar fulano melhora X"
     d) Se nao → libera mais 1, repete
  4. Ordem de liberacao: HIERARQUICA
     - Primeiro: quem tem override_local (user mudou no preview)
     - Depois: quem tem regra do colaborador (fixo no BD)
     - Por ultimo: quem tem auto-assigned (preview decidiu)
  5. Output: lista de diffs {colaborador_id, fixa_atual, fixa_proposta, variavel_atual, variavel_proposta}
```

**O drawer (SugestaoSheet)** mostra:
- Tabela com nome, posto, folga atual → folga proposta
- Botoes: "Aceitar" (aplica diff nos overrides_locais) ou "Descartar"
- Status: TS_REDISTRIBUIU, TS_NAO_RESOLVEU, TS_FALHOU

### Decisao de Sessao: Unificar Automatico + Sugerir

**O "Sugerir" TS deve MORRER como botao separado.** Razoes:

1. O `pickBestFolgaDay` no automatico ja faz 90% do que o sugerir faz
2. O ganho marginal do sugerir (redistribuicao hierarquica) deve ser INCORPORADO no automatico
3. Se o RH quer sugestao REAL (validada), vai pro CP-SAT advisory — nao pro TS
4. O drawer do sugerir TS deve virar drawer exclusivo do CP-SAT advisory

**O que muda:**

| Antes | Depois |
|-------|--------|
| Automatico roda `gerarCicloFase1` (greedy) | Automatico roda `gerarCicloFase1` + redistribuicao hierarquica integrada |
| Botao "Sugerir" roda `sugerirTSHierarquico` separado | Botao "Sugerir" roda CP-SAT advisory |
| Drawer mostra diff TS ou CP-SAT (confuso) | Drawer mostra APENAS diff CP-SAT (claro) |
| Avisos misturam TS warnings com advisory | Avisos TS = automaticos (sempre visiveis). Advisory = drawer |

**Sobre as mensagens de aviso:**

| Mensagem atual | Problema | Proposta |
|---------------|----------|----------|
| "Folga variavel de {nome} em {dia}: sobram X, demanda Y" | Nao diz o que fazer | "Cobertura insuficiente em {dia}: mover folga de {nome} para {diaSugerido} resolve" |
| "Muitas folgas fixas em {dia}" (sentinela) | Nao identifica quem mudar | Listar hierarquicamente: primeiro quem e automatico, depois quem e manual |
| "Troque o dia de folga de {nome}" | Sugere mudar o ULTIMO que o RH mexeu | Sugerir mudar quem tem MAIS IMPACTO (menor score no pickBestFolgaDay) |
| "Capacidade insuficiente" | Generico | Mostrar: "Faltam X pessoas pra cobrir {dia}. Contrate ou reduza demanda." |

**Hierarquia das mensagens de aviso (proposta):**

```
1. BLOQUEADORES (gate=BLOCK, nao gera escala):
   - Capacidade total insuficiente (D1)
   - Capacidade domingo insuficiente (D2)
   - Ciclo matematicamente impossivel (D3)

2. WARNINGS ACIONAVEIS (gate=ALLOW, gera mas com ressalvas):
   - "Mover folga de {nomeAutoAtribuido} de {diaAtual} para {diaMelhor}"
     → so pra quem ta AUTOMATICO (preview decidiu)
   - "Folga de {nomeManual} em {dia} causa deficit de {X}"
     → pra quem ta MANUAL (RH escolheu) — informa, nao manda mudar
   - "Folga de {nomeColaborador} em {dia} (regra fixa) causa deficit"
     → pra quem ta no BD — informa que e limitacao estrutural

3. INFORMATIVOS (gate=ALLOW):
   - Domingos consecutivos inevitaveis (D4)
   - Postos sem titular (A2)
```

**Principio:** a mensagem nunca diz "mude o que voce acabou de fazer". Ela sugere mudar o automatico primeiro. Se nao resolve, informa sobre o manual. Se nao resolve, informa sobre o fixo. Hierarquia natural, sem tosquice.

---

## Gestao de Pins — O que Fixa, o que Solta

### O que o usuario PINA (controla)

| Acao do usuario | Onde fica | Quem respeita | Quem pode estripar |
|-----------------|-----------|---------------|---------------------|
| Escolhe folga fixa no preview | overrides_locais (store) | Preview TS (forcado) | Phase 1 respeita. Pass 2+ pode ignorar. |
| Escolhe folga variavel no preview | overrides_locais (store) | Preview TS (forcado) | Phase 1 respeita. Pass 2+ pode ignorar. |
| Aceita sugestao do advisory | overrides_locais atualizado | Preview TS | Mesmo comportamento |
| Configura regra horario do colab | BD (colaborador_regra_horario) | Bridge, Phase 1, todos os passes | Pass 3 OFFICIAL pode relaxar TIME_WINDOW |
| Tipo B pre-computado | pinned_folga_externo (gerado automaticamente) | Phase 1 (merge), Pass 1 (constraint) | Pass 1b mantem OFFs. Pass 2+ dropa. |

### O que cada Pass ESTRIPA

| Pass | O que mantem | O que estripa |
|------|-------------|---------------|
| **Pass 1** | Phase 1 pins (band constraints) | Nada |
| **Pass 1b** | OFFs do Phase 1 (quais dias sao folga) | Bandas (manha/tarde → tudo vira INTEGRAL) |
| **Pass 2** | Nada do Phase 1 | TODOS os pins — solver decide do zero |
| **Pass 3 OFFICIAL** | H1, H2, H4, H5 (CLT core) | FOLGA_FIXA, FOLGA_VARIAVEL, TIME_WINDOW |
| **Pass 3 EXPLORATORY** | H2, H5 (minimo absoluto) | TUDO exceto interjornada e excecoes |

---

## Analise: O Processo Deveria Ser Linear?

### O Problema do Vai-e-Volta Atual

```
Preview TS decide folgas (A)
  → Phase 1 CP-SAT RECALCULA folgas (B ≠ A as vezes)
    → Pass 1 APLICA pins de B
      → Pass 1 FALHA
        → Pass 1b ESTRIPA bandas de B
          → Pass 1b FALHA
            → Pass 2 ESTRIPA TUDO de B
              → Pass 2 FALHA
                → Pass 3 ESTRIPA TUDO — primeira coisa que funciona
```

**O RH configurou A. O resultado final pode ser D, E, ou F — sem saber porque.**

### O Processo Linear Ideal

```
Preview TS decide folgas (A)
  → Phase 1 CP-SAT VALIDA se A funciona
    → SE SIM: "Pass! Suas folgas funcionam. Gerando horarios..."
      → Solver distribui horarios respeitando A
    → SE NAO: "Suas folgas tem problemas. Sugestoes:"
      → Mostra DIFF: "Mover folga de Milena de SEG→TER resolve"
      → RH ACEITA ou AJUSTA
      → Volta pro Phase 1 validar de novo
      → Quando PASS: gera horarios
```

**Diferenca critica:** o Phase 1 CP-SAT nao RECALCULA — ele VALIDA. Se nao passa, mostra o que precisa mudar. O RH decide. So depois de PASS e que o solver completo roda.

### O que o Phase 1 CP-SAT Precisa Validar (nao inventar)

O Phase 1 hoje INVENTA um pattern novo. O Phase 1 ideal:

1. Recebe os pins do preview (folgas que o RH escolheu)
2. Testa se esses pins sao VIAVEIS com as constraints CLT
3. Se sim → PASS → vai pro solver completo com pins garantidos
4. Se nao → identifica QUAIS pins causam conflito
5. Retorna DIFF com sugestoes minimas de ajuste
6. RH aceita o diff → novo set de pins → valida de novo

### Congruencia Preview TS vs Phase 1 CP-SAT

**O que o Preview TS faz que o Phase 1 TAMBEM deveria fazer:**

| Aspecto | Preview TS | Phase 1 CP-SAT Ideal |
|---------|-----------|---------------------|
| Distribui folgas | Sim (pickBestFolgaDay) | NAO — aceita do preview |
| Valida H1 (max 6 consec) | Sim (repair) | Sim (HARD constraint) |
| Valida ciclo domingo | Sim (N/gcd(N,K)) | Sim (HARD se config) |
| Valida cobertura | Warning | HARD min_headcount |
| Valida bandas (manha/tarde) | NAO | Sim — UNICA coisa que faz a mais |
| Detecta conflito | Warning textual | INFEASIBLE + IIS (quais constraints conflitam) |
| Sugere ajuste | Nao | SIM — diff minimo pra viabilizar |

**Conclusao:** A UNICA coisa que o Phase 1 faz que o Preview NAO faz e validar bandas (manha/tarde). Todo o resto o Preview ja calcula. Se o Phase 1 VALIDASSE em vez de RECALCULAR, a congruencia seria quase total.

### Implicacao: Se Phase 1 e Validador

Se o Phase 1 CP-SAT so VALIDA (com pins do preview):
- Pass 1 NUNCA falha por pins errados (ja foram validados)
- Pass 1b e desnecessario (pins estao corretos)
- Pass 2 so existe pra quando o solver completo tem constraints extras (H2, H6, H10) que o Phase 1 nao testa
- Pass 3 so existe pra emergencia real (matematicamente impossivel)

**O multi-pass atual tem 4 passes porque o Phase 1 pode INVENTAR pins errados.** Se o Phase 1 so VALIDASSE, bastaria 2 passes: Pass 1 (com pins validados) e Pass 2 (emergencia).

---

## Proposta: Fluxo Linear com Validacao

```
PREVIEW TS (usuario configura)
  |
  v
PHASE 1 CP-SAT: VALIDACAO
  - Recebe pins do preview como input FIXO
  - Testa VIABILIDADE (constraints CLT + bandas)
  - Se PASS → vai pro solver com CONFIANCA
  - Se FAIL → retorna DIFF (quais pins mudar)
  |
  v (se PASS)
SOLVER CP-SAT: DISTRIBUICAO
  - Pins GARANTIDOS (Phase 1 validou)
  - So distribui horarios, almoco, slots
  - NUNCA muda folgas (ja estao fixas e validadas)
  - Se INFEASIBLE → e por H2/H6/H10 (nao por folgas)
  |
  v (se FAIL — raro)
FALLBACK: Relaxa horarios (nao folgas)
  - Mantem folgas intactas
  - Relaxa MIN_DIARIO, H10 (meta semanal), TIME_WINDOW
  - Mostra ao RH o que foi relaxado
```

### Ganhos

1. **Sugestao concreta**: Phase 1 retorna diff exato ("mover folga da Milena de SEG→TER")
2. **Pass verdadeiro**: se Phase 1 validou, o solver completo GARANTE respeitar os pins
3. **Hierarquia de pregas**: so relaxa horarios, NUNCA folgas (que o RH controla)
4. **Sem modo imprevisivel**: o fallback mantem a estrutura de folgas do RH
5. **Sem zig-zag**: Preview → Phase 1 valida → Solver executa. Linear.

---

## Disclaimer Critico

Esta analise mapeia o estado ATUAL do sistema e propoe uma direcao.
A implementacao do fluxo linear requer mudancas significativas:
- Phase 1 precisa aceitar pins como INPUT (hoje GERA pins)
- Multi-pass precisa ser reestruturado (2 passes em vez de 4)
- IIS (Irreducible Infeasible Subsystem) do OR-Tools pra identificar quais pins conflitam
- UI precisa de tela de diff/aprovacao entre Phase 1 e solver

Estimativa: trabalho de 2-3 sessoes focadas.
