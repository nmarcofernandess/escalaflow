# ANALYST: Pipeline do "Sugerir" — TS + Solver Integrado

> Destilado em 2026-03-18 a partir de conversa com o operador

---

## TL;DR EXECUTIVO

O botao "Sugerir" LIBERA o TS pra resolver o ciclo sem as amarras dos overrides manuais do RH.
O TS tenta preservar o maximo de manuais por hierarquia de postos.
Se o TS resolve: mostra o diff. Passa pro solver pra VALIDAR (band demand).
Se o TS nao resolve nem com tudo automatico: solver tenta.
Mensagens sao contextuais — refletem estado atual, somem quando resolvido.

---

## O QUE O CICLO E (E O QUE NAO E)

**CICLO = padrao abstrato que se repete.**
Nao tem data. Nao tem feriado. Nao tem excecao. Nao tem ferias.
E pura matematica: N pessoas, K trabalham domingo, folga fixa, folga variavel, demanda por dia.

Feriados, excecoes, ferias = preocupacao da GERACAO DE ESCALA (solver full, Phase 2).
NEM o TS NEM o Phase 1 do solver devem considerar isso pro ciclo.

O Phase 1 do solver HOJE usa `_compute_blocked_days` com feriados/excecoes.
Isso esta ERRADO pro contexto de ciclo/advisory. O ciclo e date-agnostic.

---

## HIERARQUIA = ORDEM DOS POSTOS

A hierarquia e a ordem visual dos postos no CicloGrid.
O RH arrasta os postos pra cima/baixo. Isso define prioridade.
Posto 1 (topo) = maior prioridade. Posto N (fundo) = menor.

Quando o "Sugerir" precisa remover overrides manuais, comeca pelo FUNDO.

---

## ESTADO ATUAL: O QUE O TS FAZ AUTOMATICO

Linha 1078-1103 de `SetorDetalhe.tsx`:
```
previewSetorRows = participantes (ordem dos postos)
  .filter(NAO INTERMITENTE)
  .map(cada → {
    baseFixa = regra do colaborador (ou null)
    baseVariavel = regra do colaborador (ou null)
    fixaAtual = override local ?? baseFixa
    variavelAtual = override local ?? baseVariavel
    overrideFixaLocal = fixaAtual !== baseFixa   ← TRUE = RH mexeu manualmente
    folgaForcada = { folga_fixa_dia, folga_variavel_dia, folga_fixa_dom }
  })
```

Depois roda `gerarCicloFase1` com TODAS as `folgasForcadas` (incluindo manuais).
O TS tenta encaixar ao redor das restricoes manuais.
Se nao consegue → mostra erro.

**Problema:** o RH pode ter se enfiado num buraco editando manualmente.
O "Sugerir" deveria LIBERTAR o TS dessas amarras.

---

## PIPELINE DO "SUGERIR" — COMO DEVERIA SER

```
┌─────────────────────────────────────────────────────────────┐
│ 1. COLETA                                                    │
│    - Lista de postos na ordem (hierarquia)                   │
│    - FF/FV atual de cada um (manual ou automatico)           │
│    - Demanda por dia                                         │
│    - Quem trabalha domingo (K)                               │
└───────────────────────────┬─────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. TS LIBERADO (hierarquia top-down)                         │
│                                                              │
│    Tentativa 0: roda com TUDO automatico (null)              │
│    Se sucesso → pula pro passo 3 com diff completo           │
│    Se falha → impossivel matematicamente → mensagem + solver │
│                                                              │
│    (Otimizacao futura: tentar preservar manuais removendo    │
│     de baixo pra cima na hierarquia dos postos, ate achar    │
│     combinacao que funciona. Mas pra v1: tudo auto.)         │
└───────────────────────────┬─────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. DIFF (instantaneo, <1ms)                                  │
│                                                              │
│    Pra cada colaborador (na ordem dos postos):               │
│    ┌──────────┬─────────────────┬───┬────────────────────┐   │
│    │ Nome     │ Hoje (RH)       │   │ Sugestao (TS)      │   │
│    ├──────────┼─────────────────┼───┼────────────────────┤   │
│    │ Alex     │ FF:Ter  FV:Seg  │ → │ FF:⚡Qui  FV:Seg   │   │
│    │ Maria    │ FF:Qua  FV:—    │ → │ FF:Qua  FV:+Sex   │   │
│    │ Carlos   │ FF:Qui  FV:Ter  │   │ FF:Qui  FV:Ter    │   │
│    └──────────┴─────────────────┴───┴────────────────────┘   │
│                                                              │
│    Mostrar imediatamente no drawer enquanto solver roda.     │
└───────────────────────────┬─────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. SOLVER VALIDA (background, ~10s)                          │
│                                                              │
│    Recebe o pattern do TS e valida com CP-SAT:               │
│    - Band demand (manha/tarde) → COBERTURA_FAIXA            │
│    - Constraints HARD (H1, dias_trabalho, XOR)               │
│                                                              │
│    Se FEASIBLE:                                              │
│      → Criterios ficam PASS                                  │
│      → Diff do TS e confirmado                               │
│                                                              │
│    Se INFEASIBLE:                                            │
│      → Solver tenta FREE SOLVE (sem pins)                    │
│      → Se acha solucao: atualiza diff com proposta solver    │
│      → Se nao acha: fallback IA                              │
└─────────────────────────────────────────────────────────────┘
```

---

## MENSAGENS — VOCABULARIO COMPARTILHADO

Mensagens sao CONTEXTUAIS. Refletem o estado ATUAL.
Se o problema sumiu (porque o TS/solver resolveu), a mensagem some.
Se novos problemas surgiram, novas mensagens aparecem.

### Mensagens que o TS SABE dar (instantaneas, real-time):

| Codigo | Mensagem | Quando |
|--------|----------|--------|
| `CAPACIDADE_DIARIA_INSUFICIENTE` | "Cobertura insuficiente em SEG, QUA" | Gente < demanda naquele dia |
| `H3_DOM_CICLO_EXATO` | "Ciclo de domingos inviavel" | Demanda domingo > capacidade ciclo |
| `H3_DOM_MAX_CONSEC_M` | "Domingos consecutivos masculinos excedidos" | Homem com >2 dom seguidos |
| `H3_DOM_MAX_CONSEC_F` | "Domingos consecutivos femininos excedidos" | Mulher com >1 dom seguido |

### Mensagens que o TS DEVERIA dar mas NAO da hoje:

| Codigo | Mensagem | Por que nao da |
|--------|----------|----------------|
| `DEMANDA_FAIXA_MANHA` | "Cobertura insuficiente de manha em QUA" | TS nao sabe split manha/tarde |
| `DEMANDA_FAIXA_TARDE` | "Cobertura insuficiente de tarde em SEX" | TS nao sabe split manha/tarde |

### Mensagens que SO o solver da (pos-validacao, ~10s):

| Codigo | Mensagem | Quando |
|--------|----------|--------|
| `COBERTURA_FAIXA` | "Band demand de manha/tarde nao atendida" | Solver detecta split insuficiente |
| `INFEASIVEL_PATTERN` | "Nenhum arranjo viavel encontrado" | Impossivel com constraints atuais |

### Regra de ouro das mensagens:

```
SE o TS sabe avaliar → TS mostra/remove em tempo real
SE so o solver sabe  → mensagem persiste ate proximo solver run
SE ambos sabem       → TS e autoritativo (mais rapido)
```

**Evolucao desejavel:** TS aprender a fazer split manha/tarde (demand_by_slot simplificado)
pra que as mensagens de faixa tambem sejam real-time. Isso eliminaria o gap.

---

## INTERMITENTE

**Hoje:** `previewSetorRows` JA filtra INTERMITENTE fora (linha 1078).
O TS `gerarCicloFase1` NAO recebe intermitentes — eles nao entram no ciclo.

**O que falta:** o TS nao tem awareness explicita de INTERMITENTE.
Ele so nao recebe porque o `SetorDetalhe` filtra antes.
Se alguem chamar `gerarCicloFase1` direto passando intermitente, vai tratar como CLT.

**Correto:** manter o filtro no `SetorDetalhe` (ja funciona).
O solver Phase 1 tambem exclui INTERMITENTE de `dias_trabalho` — coerente.

---

## FERIADOS E EXCECOES NO CICLO

**NAO ENTRAM. PONTO.**

O ciclo e abstrato. Se repete. Nao tem data.
Feriados/excecoes sao da geracao de escala (Phase 2).

O Phase 1 do solver HOJE usa `_compute_blocked_days` que inclui feriados/excecoes.
Isso e INCOERENTE com o proposito de gerar/validar CICLO.
Quando o solver Phase 1 roda no contexto de advisory/sugestao,
deveria ignorar blocked days de feriados/excecoes.

**Nota:** se um dia o ciclo precisar mudar por causa de um feriado
(ex: 25/12 cai numa terca e o cara tem folga fixa terca — o feriado ja "cobriu"),
isso e preocupacao do Phase 2 na geracao, nao do ciclo.

---

## PERGUNTAS E RESPOSTAS DEFINITIVAS

**O solver mudaria a distribuicao que o TS entregou?**
NAO pro ciclo em si. A distribuicao de folgas num ciclo e matematica pura.
Se o TS achou uma solucao, o solver acha a mesma (ou equivalente).
O solver SO muda se detectar problema de band demand (manha/tarde).

**Compensaria fazer o TS entregar no sugerir?**
SIM. O TS e instantaneo. O diff aparece na hora. O solver valida depois em background.
Melhor UX: feedback imediato + confirmacao assincrona.

**Rodar apenas o solver no sugerir?**
POSSIVEL mas pior UX. 10s de espera pra ver qualquer coisa.
E o solver nao da mensagens diagnosticas (so binario).
O TS da mensagens ricas instantaneamente.

**O TS consegue demand by slot?**
NAO hoje. Ele recebe `demanda_por_dia: number[]` — um total por dia.
Mas PODE evoluir: receber `demanda_por_dia: {total, manha, tarde}[]` e checar splits.
Isso tornaria as mensagens de faixa tambem real-time.

---

## RESUMO DA PIPELINE

```
ESTADO NORMAL (real-time):
  TS roda com folgas_forcadas (manuais + regras) → preview + mensagens

BOTAO "SUGERIR" (sob demanda):
  1. TS roda com tudo AUTO (null) → diff instantaneo + mensagens TS
  2. Solver Phase 1 valida (background) → COBERTURA_FAIXA + criterios
  3. Se solver OK → diff confirmado
  4. Se solver FAIL → solver free solve → proposta alternativa ou IA

RESULTADO NO DRAWER:
  - Diff: Hoje (RH) vs Sugestao (TS ou solver)
  - Criterios: TS (3 instantaneos) + Solver (banda, +10s)
  - Aceitar: aplica sugestao como overrides
  - Descartar: fecha sem mudar nada
```

---

## DISCLAIMERS CRITICOS

- O Phase 1 do solver HOJE e date-aware (usa feriados/excecoes pro ciclo). Isso deveria mudar.
- O TS NAO sabe split manha/tarde. Evolucao desejavel mas nao bloqueante.
- Mensagens do solver persistem ate proximo solver run — nao sao real-time.
- A logica de "remover manuais por hierarquia" nao existe no TS hoje. V1 pode ser: tudo auto.
