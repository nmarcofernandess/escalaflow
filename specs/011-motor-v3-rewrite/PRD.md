# PRD: Motor v3.1 — Rewrite Completo do Gerador + Validador + Testes

> **Workflow:** feature
> **Budget sugerido:** high
> **Criado em:** 2026-02-18T22:00:00Z
> **Fonte:** RFC canonico `docs/MOTOR_V3_RFC.md` v3.1 + conversa com operador
> **Pre-requisito:** S1 Fundacao JA IMPLEMENTADO (schema, types, constants, seed)

---

## Visao Geral

Rewrite completo do motor de escalas (gerador.ts + validador.ts + validacao-compartilhada.ts).
O motor v2 tem 10 regras e ~1100 linhas. O v3 tera 37 regras (20 HARD + 12 APs + 5 SOFT),
8 fases, explicabilidade nativa (DecisaoMotor + Planejado x Executado x Delta),
almoco modelado, grid 30min, suporte a estagiario/aprendiz/feriados, e pinnedCells v3.

**Referencia canonica:** `docs/MOTOR_V3_RFC.md` (sections 2-8, 14, 16-17)

**O que JA existe (S1 implementado):**
- Schema com 5 tabelas novas (funcoes, feriados, setor_horario_semana, escala_decisoes, escala_comparacao_demanda)
- 12 colunas novas em tabelas existentes
- `constants.ts` com CLT v3 (22 campos) + ANTIPATTERNS (32 thresholds+pesos) + tipos novos
- `types.ts` com todas interfaces v3 (Funcao, Feriado, SetorHorarioSemana, EscalaDecisao, etc.)
- Seed de feriados nacionais 2026/2027 + tipo contrato Aprendiz 30h

**O que este spec implementa:**
- `gerador.ts` — rewrite completo (8 fases)
- `validador.ts` — rewrite completo (revalidacao pos-ajuste)
- `validacao-compartilhada.ts` — rewrite completo (regras HARD compartilhadas)
- Suite de testes — 25+ cenarios

---

## Arquivos Envolvidos

### Rewrite completo (apagar e reescrever):

| Arquivo | Linhas v2 | O que muda |
|---------|-----------|------------|
| `src/main/motor/gerador.ts` | 640 | Rewrite 8 fases (RFC §6), 20 HARD, 12 APs, 5 SOFT, explicabilidade |
| `src/main/motor/validador.ts` | 130 | Rewrite pra validar v3 (com almoco, pinnedCells v3, delta) |
| `src/main/motor/validacao-compartilhada.ts` | 358 | Rewrite helpers + todas H1-H20 |
| `src/main/motor/test-motor.ts` | 698 | Expandir pra 25+ cenarios |

### Modificar (ajuste pontual):

| Arquivo | O que muda |
|---------|------------|
| `src/main/motor/worker.ts` | Ajustar chamada pra motor v3 (GerarEscalaInput → GerarEscalaOutput) |

### NAO tocar (fora do escopo):

| Arquivo | Razao |
|---------|-------|
| `src/main/tipc.ts` | IPC e sprint S3 |
| `src/renderer/**` | Frontend e sprint S4 |
| `src/shared/**` | S1 ja implementou |
| `src/main/db/**` | S1 ja implementou |

---

## Requisitos Funcionais

### FASE 0 — PREFLIGHT (RFC §6)

- [ ] RF-00a: Validar que setor existe e esta ativo
- [ ] RF-00b: Validar que existem colaboradores ativos no setor
- [ ] RF-00c: Validar capacidade total (horas disponiveis) >= demanda total (horas target)
- [ ] RF-00d: Validar feriados proibidos no periodo (H17: 25/12 e 01/01 PROIBIDOS, H18: outros sem CCT)
- [ ] RF-00e: Validar tipos especiais (aprendiz/estagiario nao escalados em dias proibidos)
- [ ] RF-00f: Se preflight falha → retornar `GerarEscalaOutput` com `sucesso: false` e erro explicativo (RFC §7.3)
- [ ] RF-00g: Registrar timing da fase com `performance.now()`

### FASE 1 — MONTAR GRID DE SLOTS (RFC §6)

- [ ] RF-01a: Gerar grid de 30min (CLT.GRID_MINUTOS) por dia do periodo
- [ ] RF-01b: Janela operacional por dia com fallback de 3 niveis:
  1. `setor_horario_semana[dia].ativo=1` → usa abertura/fechamento do registro
  2. Sem registro per-day → fallback `setor.hora_abertura / hora_fechamento`
  3. `setor_horario_semana[dia].ativo=0` → dia FECHADO (sem slots)
- [ ] RF-01c: Para cada slot: buscar `demandas.min_pessoas` como target planejado
- [ ] RF-01d: Slots sem demanda definida dentro da janela → usar `setor.piso_operacional` como fallback
- [ ] RF-01e: Slots FORA da janela diaria → NAO entram no solver
- [ ] RF-01f: Slots com `override = true` → marcar como quasi-hard
- [ ] RF-01g: Marcar dias com feriado proibido (H17/H18) — colaboradores INDISPONIVEL
- [ ] RF-01h: Registrar timing da fase

### FASE 2 — DISTRIBUIR FOLGAS (RFC §6)

- [ ] RF-02a: CLT 44h → 1 folga/semana; CLT 36h e estagiario → 2 folgas/semana
- [ ] RF-02b: Rodizio domingo — mulher max 1 consecutivo (H3), homem max 2 consecutivos (H3b)
- [ ] RF-02c: Aprendiz NUNCA domingo (H11)
- [ ] RF-02d: Max 6 dias consecutivos de trabalho (H1) — usar lookback de escala anterior
- [ ] RF-02e: Folga compensatoria de domingo dentro de 7 dias (H19)
- [ ] RF-02f: Respeitar excecoes (H5) — ferias/atestado = INDISPONIVEL
- [ ] RF-02g: Priorizar folga em dia de MENOR demanda
- [ ] RF-02h: Registrar timing da fase

### FASE 3 — DISTRIBUIR HORAS POR DIA (RFC §6)

- [ ] RF-03a: Distribuicao livre: 8h seg, 6h ter, 4h sab (nao 7.33h x 6 dias)
- [ ] RF-03b: Soma semanal = meta +/- tolerancia (H10)
- [ ] RF-03c: Meta proporcional quando: excecao parcial, semana parcial, feriado proibido
- [ ] RF-03d: Min 4h/dia (CLT.MIN_JORNADA_DIA_MIN = 240min) — decisao de produto
- [ ] RF-03e: Max contrato.max_minutos_dia (H4)
- [ ] RF-03f: >6h → almoco obrigatorio (H6); >4h <=6h → 15min (H7); <=4h → nada (H7b)
- [ ] RF-03g: **GUARD CLIFF SUMULA 437:** NUNCA gerar jornada entre 361min e 389min. Com grid 30min ja e impossivel (360 ou 390), mas guardar no codigo mesmo assim.
- [ ] RF-03h: Priorizar mais horas em dias de MAIOR demanda
- [ ] RF-03i: Estagiario: max 6h/dia, 30h/sem (H15)
- [ ] RF-03j: Aprendiz: max 6h/dia, 30h/sem (mesmas restricoes)
- [ ] RF-03k: Registrar timing da fase

### FASE 4 — ALOCAR HORARIOS (RFC §6)

- [ ] RF-04a: Grid de 30min fixo (H8)
- [ ] RF-04b: Descanso entre jornadas >= 11h (H2)
- [ ] RF-04c: DSR + interjornada >= 35h (H2b — Sumula 110 TST)
- [ ] RF-04d: Aprendiz fora do horario noturno 22:00-05:00 (H13)
- [ ] RF-04e: Max 2 blocos de trabalho/dia (H9)
- [ ] RF-04f: Score por candidato: cobertura de slots deficitarios vs demanda planejada (target)
- [ ] RF-04g: Registrar timing da fase

### FASE 5 — POSICIONAR ALMOCO (RFC §6, §3.4)

- [ ] RF-05a: Jornada >6h → almoco OBRIGATORIO (H6)
- [ ] RF-05b: Duracao minima: 30min (CCT, se `empresa.usa_cct_intervalo_reduzido`) ou 60min (CLT padrao)
- [ ] RF-05c: Duracao maxima: 120min (CLT.ALMOCO_MAX_MIN)
- [ ] RF-05d: NUNCA na 1a ou ultima hora da jornada (H20 — TST 5a Turma)
- [ ] RF-05e: Min 2h de trabalho ANTES e 2h de trabalho DEPOIS do almoco
- [ ] RF-05f: Escalonar almocos: max 50% do setor almocando simultaneamente (AP3)
- [ ] RF-05g: Grid de 30min para posicoes de almoco
- [ ] RF-05h: Preferir meio da jornada (natural/conforto)
- [ ] RF-05i: Jornada >4h <=6h → flag `intervalo_15min = true` (H7). NAO conta como hora.
- [ ] RF-05j: Jornada <=4h → sem intervalo nenhum (H7b)
- [ ] RF-05k: Registrar timing da fase

### FASE 6 — VALIDAR (RFC §6)

- [ ] RF-06a: Rodar TODAS as regras H1-H20 sobre a escala gerada
- [ ] RF-06b: Se alguma HARD falhar → backtrack (troca folga, redistribui horas, troca horario)
- [ ] RF-06c: Se esgotou tentativas de backtrack → retornar erro explicativo (RFC §7.3)
- [ ] RF-06d: Aprendiz NUNCA hora extra (H14), estagiario NUNCA hora extra (H16)
- [ ] RF-06e: Aprendiz NUNCA feriado (H12)
- [ ] RF-06f: Registrar timing da fase

### FASE 7 — PONTUAR E EXPLICAR (RFC §6, §8)

- [ ] RF-07a: Tier 1 check — 6 APs graves: AP1 Clopening(-15), AP3 Lunch Collision(-20), AP4 Workload Imbalance(-8/h), AP7 Weekend Starvation(-8), AP15 Peak Day Clustering(-6), AP16 Unsupervised Junior(-12)
- [ ] RF-07b: Se score < 60 apos Tier 1 → reotimizar (tentar redistribuir pra melhorar)
- [ ] RF-07c: Tier 2 check — 6 APs moderados: AP2 Schedule Instability(-10/-5), AP5 Isolated Day Off(-5), AP6 Shift Inequity(-3), AP8 Meal Time Deviation(-3/-8), AP9 Commute-to-Work Ratio(-2), AP10 Overstaffing Cost(-3/exc)
- [ ] RF-07d: Tier 3 check — 5 SOFT: S1-S5 preferencias (prefere_turno, evitar_dia_semana, etc.)
- [ ] RF-07e: Gerar `DecisaoMotor[]` para: folgas, clopenings evitados, cobertura reduzida, APs tier 1 nao evitados
- [ ] RF-07f: Gerar `SlotComparacao[]` — Planejado x Executado x Delta por slot (OBRIGATORIO)
- [ ] RF-07g: Justificativa OBRIGATORIA quando delta != 0 (negativo = por que faltou gente)
- [ ] RF-07h: Calcular pontuacao final (0-100): base 100 + sum(pesos APs) + sum(pesos SOFT)
- [ ] RF-07i: Calcular indicadores: cobertura_percent, violacoes_hard (=0 se gerou), violacoes_soft, equilibrio
- [ ] RF-07j: Registrar timing da fase e timing total

### PINNEDCELLS v3 (RFC §6.1)

- [ ] RF-PC1: Aceitar `pinned_cells[]` no input
- [ ] RF-PC2: Pin viola HARD → REMOVE pin automaticamente + avisa na resposta
- [ ] RF-PC3: Pin viola PISO → REJEITA pin + avisa na resposta. Piso SEMPRE vence.
- [ ] RF-PC4: Pin viola AP Tier 1 → MANTEM pin + warning (registra na DecisaoMotor)
- [ ] RF-PC5: Pin viola AP Tier 2/SOFT → MANTEM silenciosamente, penaliza score
- [ ] RF-PC6: Pin com hora_inicio/hora_fim → fixa horario especifico
- [ ] RF-PC7: Pin sem hora_inicio/hora_fim → fixa presenca no dia (motor decide horario)

### VALIDADOR v3 (revalidacao pos-ajuste manual)

- [ ] RF-VA1: Receber escala existente com alocacoes modificadas
- [ ] RF-VA2: Rodar todas H1-H20 sobre alocacoes recebidas
- [ ] RF-VA3: Recalcular score (12 APs + 5 SOFT)
- [ ] RF-VA4: Recalcular DecisaoMotor[] e SlotComparacao[] (delta atualizado)
- [ ] RF-VA5: Retornar `EscalaCompletaV3` completo
- [ ] RF-VA6: Suportar pinnedCells v3 na revalidacao

### INTERFACE (RFC §7)

- [ ] RF-IF1: Input = `GerarEscalaInput` (setor_id, data_inicio, data_fim, pinned_cells?)
- [ ] RF-IF2: Output = `GerarEscalaOutput` (sucesso, escala?, erro?)
- [ ] RF-IF3: Motor busca TUDO do banco sozinho (empresa, setor, setor_horario_semana, demandas, colaboradores, excecoes, feriados, funcoes, escalas anteriores)
- [ ] RF-IF4: Erros em linguagem RH (RFC §7.3) com sugestoes acionaveis
- [ ] RF-IF5: Timing por fase no retorno (`timing: { fase0_ms, ..., fase7_ms, total_ms }`)

### WORKER (ajuste pontual)

- [ ] RF-WK1: `worker.ts` recebe `GerarEscalaInput` e retorna `GerarEscalaOutput`
- [ ] RF-WK2: Manter timeout de 30s

---

## Regras HARD — Referencia Completa (RFC §4)

O motor DEVE implementar TODAS as 20 regras. Violacao = escala invalida.

| # | Regra | Descricao | Threshold | Fundamento |
|---|-------|-----------|-----------|------------|
| H1 | MAX_DIAS_CONSECUTIVOS | Max 6 dias seguidos | CLT.MAX_DIAS_CONSECUTIVOS=6 | Art. 67 + OJ 410 TST |
| H2 | DESCANSO_ENTRE_JORNADAS | Min 11h entre jornadas | CLT.MIN_DESCANSO_ENTRE_JORNADAS_MIN=660 | Art. 66 CLT |
| H2b | DSR_INTERJORNADA | Min 35h quando DSR | CLT.DSR_INTERJORNADA_MIN=2100 | Sumula 110 TST |
| H3 | RODIZIO_DOMINGO_MULHER | Mulher max 1 dom consecutivo | CLT.MAX_DOMINGOS_CONSECUTIVOS.F=1 | Art. 386 CLT |
| H3b | RODIZIO_DOMINGO_HOMEM | Homem max 2 dom consecutivos | CLT.MAX_DOMINGOS_CONSECUTIVOS.M=2 | Lei 10.101/2000 |
| H4 | MAX_JORNADA_DIARIA | Max contrato.max_minutos_dia | Via TipoContrato | Art. 58+59 CLT |
| H5 | EXCECOES_RESPEITADAS | Ferias/atestado = indisponivel | DB excecoes | CLT |
| H6 | ALMOCO_OBRIGATORIO | >6h → almoco 30-120min | CLT.LIMIAR_ALMOCO_MIN=360 | Art. 71 CLT + CCT |
| H7 | INTERVALO_CURTO | >4h e <=6h → 15min | CLT.LIMIAR_INTERVALO_CURTO_MIN=240 | Art. 71 §1 CLT |
| H7b | SEM_INTERVALO_4H | <=4h → sem intervalo | CLT.LIMIAR_INTERVALO_CURTO_MIN=240 | Art. 71 §1 contrario |
| H8 | GRID_HORARIOS | Multiplos de 30min | CLT.GRID_MINUTOS=30 | Produto |
| H9 | MAX_SAIDA_VOLTA | Max 2 blocos trabalho/dia | Fixo 2 | Art. 71 CLT |
| H10 | META_SEMANAL | Soma semanal +/- tolerancia | empresa.tolerancia_semanal_min | Art. 58 CLT |
| H11 | APRENDIZ_DOMINGO | Aprendiz nunca domingo | tipo_trabalhador='APRENDIZ' | Art. 432 CLT |
| H12 | APRENDIZ_FERIADO | Aprendiz nunca feriado | tipo_trabalhador='APRENDIZ' | Art. 432 CLT |
| H13 | APRENDIZ_NOTURNO | Aprendiz nunca 22h-5h | CLT.APRENDIZ_HORARIO_NOTURNO_* | Art. 404 CLT |
| H14 | APRENDIZ_HORA_EXTRA | Aprendiz nunca HE | tipo_trabalhador='APRENDIZ' | Art. 432 CLT |
| H15 | ESTAGIARIO_JORNADA | Max 6h/dia 30h/sem | CLT.ESTAGIARIO_MAX_* | Lei 11.788 Art. 10 |
| H16 | ESTAGIARIO_HORA_EXTRA | Estagiario nunca HE | tipo_trabalhador='ESTAGIARIO' | Lei 11.788 |
| H17 | FERIADO_PROIBIDO | 25/12 e 01/01 proibidos | FERIADOS_CCT_PROIBIDOS | CCT FecomercioSP |
| H18 | FERIADO_SEM_CCT | Feriado sem CCT proibido | feriados.cct_autoriza=false | Portaria MTE 3.665 |
| H19 | FOLGA_COMP_DOM | Folga dom dentro de 7 dias | CLT.FOLGA_COMPENSATORIA_DOM_DIAS=7 | Lei 605/1949 |
| H20 | ALMOCO_POSICAO | Almoco nunca 1a/ultima hora | Min 2h antes + 2h depois | TST 5a Turma |

**Guards adicionais:**
- Cliff Sumula 437: NUNCA gerar 361-389min (6h01-6h29). Com grid 30min ja impossivel, guard no codigo.
- H10 proporcional: meta ajustada por dias disponiveis (excecao/feriado/semana parcial).

---

## Antipatterns v3.1 — 12 APs (RFC §5)

### Tier 1 — 6 APs graves (aviso pro RH)

| ID | Nome Industria | Peso | Logica |
|----|----------------|------|--------|
| AP1 | Clopening | -15 | Descanso < 13h entre jornadas (CONFORTAVEL, nao HARD 11h) |
| AP3 | Lunch Collision | -20 | >50% do setor almocando no mesmo slot de 30min |
| AP4 | Workload Imbalance | -8/h | Desvio de horas semanais entre colabs do mesmo contrato |
| AP7 | Weekend Starvation | -8 | Colab sem fim de semana livre em N semanas |
| AP15 | Peak Day Clustering | -6 | Dias de maior demanda com menos cobertura que dias calmos |
| AP16 | Unsupervised Junior | -12 | Colab rank < 3 sozinho num slot sem senior |

### Tier 2 — 6 APs moderados (otimizacao silenciosa)

| ID | Nome Industria | Peso | Logica |
|----|----------------|------|--------|
| AP2 | Schedule Instability (Ioio) | -10/-5 | Variacao de hora_inicio > 2h (-10) ou > 1h (-5) entre dias |
| AP5 | Isolated Day Off | -5 | Folga cercada de trabalho nos 2 lados (nao agrega descanso) |
| AP6 | Shift Inequity | -3 | Distribuicao injusta de aberturas/fechamentos entre colabs |
| AP8 | Meal Time Deviation | -3/-8 | Almoco fora da janela ideal 11:00-13:30 (-3) ou extremo (-8) |
| AP9 | Commute-to-Work Ratio | -2 | Dia com menos de 5h de trabalho (deslocamento nao compensa) |
| AP10 | Overstaffing Cost | -3/exc | Mais pessoas alocadas que target da demanda em slots nao-override |

---

## SOFT Rules — 5 preferencias (RFC §7)

| # | Regra | Peso | Logica |
|---|-------|------|--------|
| S1 | Prefere turno | -2 | Se colab tem `prefere_turno` e nao foi alocado nele |
| S2 | Evitar dia | -3 | Se colab tem `evitar_dia_semana` e foi alocado nele |
| S3 | Equilibrio aberturas | -1 | Distribuir aberturas/fechamentos igualmente (complementa AP6) |
| S4 | Folga preferida | -1 | Tentar folga no dia com menor demanda pessoal |
| S5 | Consistencia horario | -2 | Tentar manter hora_inicio similar entre dias da semana |

---

## Logica de Intervalos — Arvore de Decisao (RFC §3.4)

```
SE minutos_trabalho > 360 (> 6h):
  → Almoco OBRIGATORIO
  → Duracao: min = empresa.min_intervalo_almoco_min (30 ou 60), max = 120min
  → Posicao: entre 2 blocos. Nunca 1a/ultima hora (H20).
    Min 2h antes, min 2h depois.
  → Grid 30min.
  → NAO conta como hora trabalhada (Art. 71 §2)

SE minutos_trabalho > 240 E <= 360 (> 4h e <= 6h):
  → Intervalo 15min OBRIGATORIO (H7)
  → NAO conta como hora trabalhada
  → Funcionario NAO sai do local (pausa no posto)
  → 1 bloco continuo. Flag: intervalo_15min = true
  → SEM almoco formal (hora_almoco = null)

SE minutos_trabalho <= 240 (<= 4h):
  → SEM intervalo nenhum (H7b)
  → Bloco continuo puro
  → intervalo_15min = false, almoco = null
```

---

## Cadeia de Precedencia — REGRA DE OURO (RFC §2)

```
NIVEL 1 — HARD LEGAL (H1-H20) → Violacao = escala invalida
NIVEL 2 — PISO OPERACIONAL   → setor.piso_operacional (hard)
NIVEL 3 — DEMANDA PLANEJADA  → demandas.min_pessoas (target soft)
NIVEL 4 — ANTIPATTERNS        → Tier 1 (aviso) + Tier 2 (silencioso)
NIVEL 5 — SOFT                → Preferencias (bonus/penalidade leve)
```

Se satisfazer nivel N impede nivel N+1, nivel N VENCE. Sem excecao.

---

## Criterios de Aceitacao

### Corretude

- [ ] CA-01: tsc --noEmit retorna 0 erros
- [ ] CA-02: npm run build completa sem erros
- [ ] CA-03: Motor gera escala valida para setor com 8 CLT 44h (seed Caixa) — 0 violacoes HARD
- [ ] CA-04: Motor gera escala valida para setor com 3 colaboradores (seed Acougue) — 0 violacoes HARD
- [ ] CA-05: Motor gera escala valida com estagiario no setor (max 6h/dia, 30h/sem, nunca HE)
- [ ] CA-06: Motor gera escala valida com aprendiz (nunca domingo, feriado, noturno, HE)
- [ ] CA-07: Motor respeita feriado proibido (25/12, 01/01) — todos INDISPONIVEL
- [ ] CA-08: Motor modela almoco corretamente (>6h = almoco, >4h<=6h = 15min, <=4h = nada)
- [ ] CA-09: Motor NUNCA gera jornada 361-389min (guard cliff Sumula 437)
- [ ] CA-10: Motor respeita interjornada 11h (H2) e DSR 35h (H2b)

### Explicabilidade

- [ ] CA-11: Output inclui `DecisaoMotor[]` com pelo menos 1 decisao por colaborador-dia
- [ ] CA-12: Output inclui `SlotComparacao[]` cobrindo TODOS os slots do periodo
- [ ] CA-13: Todo delta != 0 tem justificativa nao-vazia
- [ ] CA-14: Erros de preflight incluem mensagem em linguagem RH + sugestoes acionaveis

### Antipatterns

- [ ] CA-15: AP1 Clopening detectado quando descanso < 13h entre jornadas
- [ ] CA-16: AP3 Lunch Collision penaliza quando >50% almocando simultaneamente
- [ ] CA-17: AP4 Workload Imbalance detecta desvio de horas entre colabs
- [ ] CA-18: Score final reflete sum dos pesos (base 100 + penalidades)

### PinnedCells

- [ ] CA-19: Pin violando HARD e removido automaticamente com aviso
- [ ] CA-20: Pin violando PISO e rejeitado com aviso
- [ ] CA-21: Pin violando AP Tier 1 e mantido com warning

### Performance

- [ ] CA-22: Timing por fase presente no retorno
- [ ] CA-23: Setor com 8 colabs (seed Caixa) gera em < 10s
- [ ] CA-24: Timeout de 30s no worker mantido

### Compatibilidade

- [ ] CA-25: Campo `minutos` mantido na alocacao (compat v2). Motor v3 preenche `minutos_trabalho`.
- [ ] CA-26: Motor v2 test-motor.ts continua rodando (ou foi substituido pela suite v3)

---

## Testes Requeridos — Suite v3

### Testes HARD (1 por regra)

| Teste | Valida |
|-------|--------|
| h1-max-dias-consecutivos | 7o dia seguido → folga forcada |
| h2-descanso-entre-jornadas | Descanso < 11h entre dias → reposicionar |
| h2b-dsr-interjornada | DSR < 35h → ajustar |
| h3-rodizio-domingo-mulher | 2o dom consecutivo mulher → folga |
| h3b-rodizio-domingo-homem | 3o dom consecutivo homem → folga |
| h4-max-jornada-diaria | Exceder max_minutos_dia → reduzir |
| h5-excecoes-respeitadas | Colab em ferias → INDISPONIVEL |
| h6-almoco-obrigatorio | >6h sem almoco → gerar almoco |
| h7-intervalo-curto | >4h <=6h → intervalo_15min=true |
| h8-grid-horarios | Horarios nao-multiplos de 30min → erro |
| h9-max-saida-volta | 3+ blocos/dia → erro |
| h10-meta-semanal | Soma fora da tolerancia → redistribuir |
| h11-aprendiz-domingo | Aprendiz escalado domingo → erro |
| h12-aprendiz-feriado | Aprendiz em feriado → erro |
| h13-aprendiz-noturno | Aprendiz 22h-5h → erro |
| h14-aprendiz-hora-extra | Aprendiz com HE → erro |
| h15-estagiario-jornada | Estagiario >6h/dia ou >30h/sem → erro |
| h16-estagiario-hora-extra | Estagiario com HE → erro |
| h17-feriado-proibido | 25/12 com alocacao → erro |
| h18-feriado-sem-cct | Feriado cct_autoriza=false com alocacao → erro |
| h19-folga-comp-dom | Domingo sem folga em 7 dias → erro |
| h20-almoco-posicao | Almoco na 1a/ultima hora → reposicionar |

### Testes adicionais

| Teste | Valida |
|-------|--------|
| preflight-capacidade | Demanda impossivel → erro com sugestao |
| integracao-escala-completa | Geracao ponta a ponta para seed Caixa |
| delta-planejado-executado | SlotComparacao correto + justificativas |
| distribuicao-livre | 8h/6h/4h distribuidos corretamente |
| cliff-sumula-437 | Nunca gerar 361-389min |
| pinnedcells-hard | Pin aprendiz domingo → pin removido |
| pinnedcells-piso | Pin remove unica pessoa → pin rejeitado |
| pinnedcells-ap | Pin causa clopening → pin mantido com warning |

---

## Constraints

- Motor roda em Worker Thread com timeout 30s — nao pode bloquear main process
- Motor busca TUDO do banco sozinho — recebe apenas setor_id + periodo + pins
- Database e better-sqlite3 (sync) — motor recebe handle do DB diretamente
- Campo `minutos` mantido na Alocacao pra compat v2 — motor v3 usa `minutos_trabalho`
- Constants e types v3 JA existem (`src/shared/constants.ts` e `src/shared/types.ts`)
- Schema v3 JA existe (`src/main/db/schema.ts`) — 5 tabelas novas ja criadas
- Motor v2 pode ser apagado — testes v3 substituem a suite v2

---

## Fora do Escopo

- IPC handlers (S3)
- Frontend / paginas / componentes (S4)
- Tabelas novas no schema (S1 JA FEZ)
- Types e constants (S1 JA FEZ)
- Persistencia de explicabilidade no banco (isso e responsabilidade do IPC handler em S3, nao do motor)
  - Motor RETORNA DecisaoMotor[] e SlotComparacao[] no output. Quem persiste e o handler.

---

## Servicos Envolvidos

- [x] Backend (motor)
- [ ] ~~Frontend~~
- [ ] ~~Database schema~~  (ja implementado em S1)
- [ ] ~~IPC~~  (S3)

---

## Budget Sugerido

**high** — Este e o componente mais critico do sistema inteiro. 20 regras HARD com fundamento legal,
12 antipatterns com scoring complexo, 8 fases interligadas com backtracking, explicabilidade obrigatoria,
guard contra edge cases legais (cliff Sumula 437, aprendiz/estagiario). Zero margem pra erro.

---

## Notas para o Agente Coder

### Padrao de imports

```typescript
import { CLT, ANTIPATTERNS, FERIADOS_CCT_PROIBIDOS, type DiaSemana } from '../../shared'
import type {
  Setor, Demanda, Colaborador, Excecao, Alocacao, Funcao, Feriado,
  SetorHorarioSemana, Empresa, TipoContrato,
  GerarEscalaInput, GerarEscalaOutput, EscalaCompletaV3,
  DecisaoMotor, SlotComparacao, AntipatternViolacao, PinnedCell,
  Indicadores, Violacao,
} from '../../shared'
```

### Funcao principal exportada

```typescript
export function gerarEscalaV3(db: Database, input: GerarEscalaInput): GerarEscalaOutput
```

### Logica de DB query

O motor recebe o `db` handle (better-sqlite3). Ele faz as queries diretamente:

```typescript
const empresa = db.prepare('SELECT * FROM empresa LIMIT 1').get() as Empresa
const setor = db.prepare('SELECT * FROM setores WHERE id = ?').get(input.setor_id) as Setor
const horarios = db.prepare('SELECT * FROM setor_horario_semana WHERE setor_id = ?').all(input.setor_id) as SetorHorarioSemana[]
const demandas = db.prepare('SELECT * FROM demandas WHERE setor_id = ?').all(input.setor_id) as Demanda[]
const colabs = db.prepare('SELECT * FROM colaboradores WHERE setor_id = ? AND ativo = 1').all(input.setor_id) as Colaborador[]
const contratos = db.prepare('SELECT * FROM tipos_contrato').all() as TipoContrato[]
const funcoes = db.prepare('SELECT * FROM funcoes WHERE setor_id = ? AND ativo = 1').all(input.setor_id) as Funcao[]
const feriados = db.prepare('SELECT * FROM feriados WHERE data BETWEEN ? AND ?').all(input.data_inicio, input.data_fim) as Feriado[]
// etc
```

### Referencia canonica

TODO o comportamento esperado esta documentado em `docs/MOTOR_V3_RFC.md`.
Em caso de duvida, consultar o RFC — ele tem a resposta.
