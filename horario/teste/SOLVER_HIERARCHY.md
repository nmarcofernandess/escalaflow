# Hierarquia do Solver — Logica Definitiva

> **Versao:** 2.0 | **Data:** 2026-02-19
> **Premissa:** Solver honesto, 0 trapaças, hierarquia correta.

---

## Como CP-SAT Funciona (Essencial)

CP-SAT NAO funciona "tentando strict, falhando, desligando uma constraint, tentando de novo."
Funciona em **1 solve com weighted objective**:

1. **HARD constraints** (`model.add()`): solver DEVE satisfazer. Se conflitam → INFEASIBLE.
2. **SOFT constraints** (penalidades no objective): solver OTIMIZA o tradeoff automaticamente.
3. **Pesos** criam a hierarquia: deficit de demanda custa 10000, AP custa 100, preferencia custa 1. O solver naturalmente prioriza demanda sobre APs sobre SOFTs.
4. **Time budget** (60s): solver melhora a solucao progressivamente dentro do tempo.

**Nao existe "retry".** O solver tenta TODAS as combinacoes em paralelo e acha o melhor equilíbrio possivel.

**Unico caso de retry:** se HARD constraints conflitam entre si (ex: meta semanal impossivel com o quadro de pessoal). Ai relaxamos parametros de PRODUTO (nao CLT) e tentamos de novo.

---

## Arquitetura de 3 Camadas

```
CAMADA 1 — HARD (model.add → INVIOLAVEL)
│  Se violar qualquer uma → INFEASIBLE
│  CLT pura. NUNCA relaxar. NUNCA negociar.
│
│  H1:  Max 6 dias consecutivos (Art. 67 CLT)
│  H2:  Interjornada >= 11h (Art. 66 CLT)
│  H4:  Max minutos/dia per contrato (Art. 58+59 CLT)
│  H6:  Almoco obrigatorio se >6h (Art. 71 CLT) — min 1h na janela 11-15h
│  H7b: Max gap = 2h (Art. 71 CLT) — almoco nunca passa de 2h
│  H8:  Grid 30min (produto, by construction)
│  H9:  Max 2 blocos/dia (Art. 71 implicito)
│  H9b: Dia curto (<=6h) = bloco unico (Art. 71 §1)
│  H10: Meta semanal ± tolerancia (Art. 58 CLT)
│  H20: Gap na janela almoco 11-15h (TST 5a Turma)
│  DIAS: Dias de trabalho per contrato (produto)
│  MIN:  Min 4h por dia se trabalha (produto: CLT.MIN_JORNADA_DIA_MIN=240)
│
├── CAMADA 2 — SOFT CARO (peso 10000 no objective)
│     Demanda planejada. Solver TENTA atingir 100%.
│     Mas se CLT impede → aceita deficit.
│
│     DEMANDA: min_pessoas por slot → deficit = max(0, target - cobertura)
│     CUSTO: 10000 × deficit_total
│
│     Isso significa: 1 slot sem cobertura custa mais que qualquer AP.
│     Solver so aceita deficit quando CLT nao permite cobrir.
│
└── CAMADA 3 — SOFT BARATO (peso 1-200 no objective)
      Qualidade. Antipatterns e preferencias.
      Solver otimiza se possivel, sacrifica se demanda exige.

      AP1:  Jornada excessiva (>8h/dia) — peso 80 per excess slot
      AP8:  Spread semanal (desbalanceamento) — peso 1 per minute

      [Futuros APs: AP5 almoco longo, AP9 pico almoco, AP15/16 abertura/fechamento]
```

---

## Tabela de Pesos

| Camada | Constraint | Peso CP-SAT | Significado |
|--------|-----------|-------------|-------------|
| HARD | H1-H20, DIAS, MIN | ∞ (model.add) | Violar = INFEASIBLE |
| SOFT 2 | Deficit demanda | 10000 / slot | 1 slot vazio custa 10000 |
| SOFT 3 | AP1 (excess >8h) | 80 / slot over | 1 slot over 8h custa 80 |
| SOFT 3 | Spread | 1 / min | Desbalanceamento custa 1/min |

**Exemplos de tradeoff automatico:**
- Solver aceita 1 slot excess AP1 (80) pra salvar 1 slot demanda (10000)? **SIM.**
- Solver aceita 100 slots excess AP1 (8000) pra salvar 1 slot demanda (10000)? **SIM.**
- Solver aceita 200 slots excess (16000) pra salvar 1 slot demanda (10000)? **NAO** — prefere o deficit.

---

## Fallback (se INFEASIBLE)

Se o solver retornar INFEASIBLE, significa que as HARD constraints conflitam entre si.
Isso so acontece com dados invalidos (ex: meta semanal impossivel pro contrato).

**Sprint 1 (padrao):** Tudo HARD + demanda soft. Deve funcionar sempre.
**Sprint 2 (se infeasible):** Relaxar tolerancia semanal de ±30 pra ±60.
**Sprint 3 (se infeasible):** Relaxar min diario de 4h pra 3h.
**Sprint 4 (diagnostico):** "Quadro de pessoal invalido. Verificar contratos."

Com demanda como SOFT, Sprint 1 deve SEMPRE ser feasible.

---

## Pos-Solve: O que Validamos Depois

Estas verificacoes NAO afetam o solve. Sao REPORTADAS no output.

| AP/SOFT | O que checa | Como |
|---------|------------|------|
| AP2 | Desequilibrio diario | max_dia - min_dia por pessoa |
| AP3 | Almoco fora 11-13:30 | Gap start/end vs janela ideal |
| AP5 | Almoco > 2h | Gap size > 4 slots |
| AP6 | Turno aberto (08h-20h) | Inicio=08:00 ou fim=20:00 |
| AP9 | Pico almoco | >50% em break no mesmo slot |
| AP10 | Almoco inicio/fim turno | Gap com <2h antes ou <2h depois |
| AP15 | Abertura mesma pessoa | Mesmo colab abre N dias seguidos |
| AP16 | Fechamento mesma pessoa | Mesmo colab fecha N dias seguidos |
| H7 | Intervalo 15min (>4h ≤6h) | Anotacao: dia curto sem pausa |
| S1-S5 | Preferencias | Turno, dia, equilibrio (N/A nesta fixture) |

---

## Resultado Esperado (Caixa Rita)

| Metrica | Solver Honesto | Rita (GT) |
|---------|---------------|-----------|
| Violacoes HARD | 0 | 0 |
| Cobertura | 80-95% | ~85% |
| Spread semanal | < 1000 min | 840 min |
| AP1 violations | Poucos (44h workers >8h) | Sim (CLEO/ANA 9.5h dias) |

**100% de cobertura e MATEMATICAMENTE IMPOSSIVEL** com 6 pessoas e CLT strict.
Total demand = 426 person-slots. Total capacity = 428 person-slots. Margem: 0.5%.
Com timing constraints (almoco, blocos), perda inevitavel.

A Rita prova isso: ela aceita deficit nos picos e distribui o melhor possivel.
O solver honesto faz o mesmo.
