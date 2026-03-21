# Análise: Distribuição Ideal de Folgas — Padaria Atendimento

## TL;DR

5 CLTs 44h + 1 Intermitente Tipo B (Maria Clara, só SEG+DOM). Pico de demanda = 4 pessoas simultâneas (10h-12h). Domingo precisa de 3 pessoas. **A melhor distribuição espalha folgas em dias de menor demanda, com rodízio de domingo em ciclo de 2 semanas.**

---

## Dados Reais (seed-local)

### Equipe

| Nome | Tipo | Horas/sem | Dias | FF | FV | Sexo |
|------|------|-----------|------|----|----|------|
| Milena | CLT | 44h | 5 | - | - | F |
| Roberta | CLT | 44h | 5 | - | - | F |
| Érica | CLT | 44h | 5 | - | - | F |
| Célia | CLT | 44h | 5 | - | - | F |
| Rafaela | CLT | 44h | 5 | - | - | F |
| Maria Clara | INTERMITENTE B | 0h | 1 | - | SEG | F |

**Maria Clara — Tipo B:**
- Tem regra de horário para SEG e DOM apenas
- Quando trabalha DOM → folga SEG (FV), quando não trabalha DOM → trabalha SEG
- Todos os outros dias = NT (não trabalha)
- **Efeito prático:** SEG tem 6 pessoas disponíveis (5 CLTs + Maria Clara), outros dias têm 5

### Demanda por faixa horária

| Horário | SEG | TER | QUA | QUI | SEX | SAB | DOM |
|---------|-----|-----|-----|-----|-----|-----|-----|
| 07:00-08:00 | 1 | 1 | 1 | 1 | 1 | 1 | 3 |
| 08:00-10:00 | 2 | 2 | 2 | 2 | 2 | 2 | 3 |
| 10:00-12:00 | **4** | **4** | **4** | **4** | **4** | **4** | 3 |
| 12:00-13:00 | 3 | 3 | 3 | 3 | 3 | 3 | 3 |
| 13:00-15:00 | 2 | 2 | 2 | 2 | 2 | 2 | - |
| 15:00-18:00 | 3 | 3 | 3 | 3 | 3 | 3 | - |
| 18:00-19:30 | 2 | 2 | 2* | 2* | 2* | 2* | - |

*QUA-SAB: demanda 19:00-19:30 = 2p (SEG/TER cortam às 19:30 igual mas com faixa diferente)

**Demanda pico (SEG-SAB):** 4 pessoas (10h-12h)
**Demanda domingo:** 3 pessoas (07:00-13:00, 6 horas)
**Demanda mínima (SEG-SAB):** 1 pessoa (07:00-08:00)

### Restrições CLT

- Máximo 6 dias consecutivos de trabalho (H1)
- Interjornada 11h entre turnos (H2)
- Jornada máxima 10h/dia incluindo extra (H4)
- Intervalo almoço ≥ 60min para jornadas >6h (empresa configurou 60min)
- Mulher: máximo 1 domingo consecutivo (Art 386 CLT)
- Todas são mulheres → **nenhuma pode trabalhar 2 domingos seguidos**

---

## Análise Aritmética

### Capacidade vs Demanda (SEG-SAB)

```
Capacidade bruta por dia:
  SEG: 5 CLTs + Maria Clara (quando não trabalha DOM) = 5 ou 6
  TER-SAB: 5 CLTs apenas = 5

Regime 5x2: cada CLT folga 2 dias por semana
  → 5 CLTs × 2 folgas = 10 folgas/semana para distribuir em 6 dias (SEG-SAB)
  → Média: 10/6 = 1.67 folgas por dia

Cobertura média por dia (SEG-SAB):
  Sem Maria Clara: 5 - 1.67 = 3.33 pessoas
  Pico de demanda: 4 pessoas (10h-12h)

  ⚠️ DEFICIT INEVITÁVEL no pico: 3.33 < 4
  → É MATEMATICAMENTE IMPOSSÍVEL ter 4 pessoas das 10h-12h todo dia
  → O solver vai fazer o melhor possível, mas haverá gaps
```

### Capacidade Domingo

```
3 pessoas necessárias das 07:00-13:00
5 CLTs disponíveis, todas mulheres (max 1 DOM consecutivo)
Maria Clara participa do rodízio (Tipo B)

Com 5 CLTs + 1 Tipo B no pool:
  N=6 no pool, K=3 trabalham DOM
  Ciclo = N/gcd(N,3) = 6/gcd(6,3) = 6/3 = 2 semanas

  Semana 1: 3 trabalham, 3 folgam
  Semana 2: 3 folgam, 3 trabalham (os outros)

  → Cada pessoa trabalha 1 DOM a cada 2 semanas ✓
  → Nenhuma mulher trabalha 2 DOMs seguidos ✓
```

---

## Distribuição Ideal (calculada à mão)

### Princípio: espalhar folgas nos dias de MENOR demanda

Demanda mínima é 1 pessoa (07-08h) — isso acontece em TODOS os dias. A demanda cresce igualmente SEG-SAB. Então **não existe dia "melhor" pra folga** — a demanda é uniforme.

Consequência: a melhor estratégia é **espalhar uniformemente**. Com 10 folgas em 6 dias: 2 folgas em 4 dias + 1 folga em 2 dias. Ou ainda melhor: distribuir de forma que NUNCA tenhamos 3+ folgas no mesmo dia (senão cobertura fica 2 e pico exige 4).

### Grade ideal para 2 semanas (1 ciclo completo)

```
REGRA: Cada CLT trabalha 5 dias/semana (FF + FV quando DOM trab)
REGRA: Max 1 DOM consecutivo (todas mulheres)
REGRA: Maria Clara só trabalha SEG e DOM

Nomes:  MI=Milena  RO=Roberta  ER=Érica  CE=Célia  RA=Rafaela  MC=Maria Clara

         │ SEG  │ TER  │ QUA  │ QUI  │ SEX  │ SAB  │ DOM  │
─────────┼──────┼──────┼──────┼──────┼──────┼──────┼──────┤
S1:      │      │      │      │      │      │      │      │
  Milena │  T   │  T   │  T   │ FF   │  T   │  T   │  DT  │ ← trab DOM, folga QUI (FF) + dom conta
  Robert │  T   │  T   │ FF   │  T   │  T   │  T   │  DT  │ ← trab DOM, folga QUA (FF) + dom conta
  Érica  │  T   │  T   │  T   │  T   │ FF   │  T   │  DT  │ ← trab DOM, folga SEX (FF) + dom conta
  Célia  │  T   │ FF   │  T   │  T   │  T   │ FV   │  DF  │ ← folga DOM, FF=TER, FV=SAB
  Rafaela│ FF   │  T   │  T   │  T   │  T   │ FV   │  DF  │ ← folga DOM, FF=SEG, FV=SAB
  M.Clara│ FV   │  NT  │  NT  │  NT  │  NT  │  NT  │  DF  │ ← não trab DOM, trab SEG? NÃO — XOR: DF → folga SEG (FV)
─────────┼──────┼──────┼──────┼──────┼──────┼──────┼──────┤
Cobert.  │ 4    │ 4    │ 4    │ 4    │ 4    │ 3    │ 3/3  │
Demanda  │ 4*   │ 4*   │ 4*   │ 4*   │ 4*   │ 4*   │ 3    │
         │ ✓    │ ✓    │ ✓    │ ✓    │ ✓    │ ✗-1  │ ✓    │

* pico 10h-12h. Fora do pico a demanda é 1-3, sempre coberta.

─────────┼──────┼──────┼──────┼──────┼──────┼──────┼──────┤
S2:      │      │      │      │      │      │      │      │
  Milena │  T   │ FF   │  T   │  T   │  T   │ FV   │  DF  │ ← folga DOM, FF=TER, FV=SAB
  Robert │  T   │  T   │  T   │ FF   │  T   │ FV   │  DF  │ ← folga DOM, FF=QUI, FV=SAB
  Érica  │  T   │  T   │  T   │  T   │  T   │ FF   │  DF  │ ← folga DOM, FF=SAB (só 1 folga weekday + DOM)
  Célia  │  T   │  T   │ FF   │  T   │  T   │  T   │  DT  │ ← trab DOM, folga QUA (FF)
  Rafaela│  T   │  T   │  T   │  T   │ FF   │  T   │  DT  │ ← trab DOM, folga SEX (FF)
  M.Clara│  T   │  NT  │  NT  │  NT  │  NT  │  NT  │  DT  │ ← trab DOM → trabalha SEG
─────────┼──────┼──────┼──────┼──────┼──────┼──────┼──────┤
Cobert.  │ 5    │ 4    │ 4    │ 4    │ 4    │ 2    │ 3/3  │
Demanda  │ 4*   │ 4*   │ 4*   │ 4*   │ 4*   │ 4*   │ 3    │
         │ ✓    │ ✓    │ ✓    │ ✓    │ ✓    │ ✗-2  │ ✓    │
```

### Problemas encontrados na análise

**1. SAB é o gargalo inevitável.**

Com 10 folgas semanais em 6 dias, e demanda uniforme de pico=4, é impossível não ter pelo menos 1 dia com ≤3 pessoas. SAB acumula folgas variáveis (FV) porque é quando os que folgaram DOM precisam da segunda folga.

**2. Érica na S2 tem problema.**

Se Érica folga DOM (DF) na S2, ela precisa de 2 folgas weekday. Mas se FF=SAB, ela só tem 1 folga weekday + DOM = 5 dias de trabalho. Correto no 5x2 (DOM conta como folga). MAS ela não tem FV! Isso é porque quando ela NÃO trabalha DOM, a FV não se aplica. Então ela fica com FF+DOM = 2 folgas = 5 dias. ✓

**3. Maria Clara XOR funciona:**
- S1: DF (não trab DOM) → FV=SEG ativa → folga SEG. Trabalha 0 dias (NT nos demais). ✓
- S2: DT (trab DOM) → trabalha SEG (FV não ativa). Trabalha 2 dias (SEG+DOM). ✓

### Contagem de dias por pessoa por semana

```
S1:
  Milena:  6 dias marcados T + DT = 6 trabalho?

  ESPERA. Milena S1 trabalha SEG TER QUA SEX SAB DOM = 6 DIAS.
  FF=QUI (1 folga). Mas ela trabalha DOM (DT).
  No regime 5x2, quando trabalha DOM: FF + FV = 2 folgas weekday.
  Milena não tem FV atribuída! Ela precisa de FV!
```

**Corrigindo — TODOS que trabalham DOM precisam de FV:**

```
S1 (3 trabalham DOM: Milena, Roberta, Érica):
  Cada uma precisa de FF + FV = 2 folgas weekday
  → 3 × 2 = 6 folgas weekday

S1 (3 folgam DOM: Célia, Rafaela, Maria Clara):
  Cada CLT precisa de FF = 1 folga weekday (DOM já é a 2ª)
  Célia: FF = 1 folga weekday
  Rafaela: FF = 1 folga weekday
  Maria Clara: FV=SEG (não trab DOM → folga SEG)
  → 2 folgas weekday (+ Maria Clara que é NT anyway)

Total folgas weekday S1: 6 + 2 = 8 folgas em 6 dias
  → Média 8/6 = 1.33 folgas/dia
  → Cobertura CLT média: 5 - 1.33 = 3.67
```

### Grade corrigida

```
         │ SEG  │ TER  │ QUA  │ QUI  │ SEX  │ SAB  │ DOM  │ Dias trab
─────────┼──────┼──────┼──────┼──────┼──────┼──────┼──────┼──────────
S1:      │      │      │      │      │      │      │      │
  Milena │  T   │  T   │ FF   │  T   │  T   │ FV   │  DT  │ 5 ✓
  Roberta│  T   │  T   │  T   │ FF   │  T   │ FV   │  DT  │ 5 ✓
  Érica  │  T   │ FF   │  T   │  T   │  T   │ FV   │  DT  │ 5 ✓
  Célia  │  T   │  T   │  T   │  T   │ FF   │  T   │  DF  │ 5 ✓
  Rafaela│  T   │  T   │  T   │  T   │  T   │ FF   │  DF  │ 5 ✓
  M.Clara│ FV   │  NT  │  NT  │  NT  │  NT  │  NT  │  DF  │ 0 ✓
─────────┼──────┼──────┼──────┼──────┼──────┼──────┼──────┤
CLTs trab│  5   │  4   │  4   │  4   │  4   │  2   │ 3/3  │
+MC      │  5   │  4   │  4   │  4   │  4   │  2   │ 3/3  │
Dem pico │  4   │  4   │  4   │  4   │  4   │  4   │  3   │
         │  ✓   │  ✓   │  ✓   │  ✓   │  ✓   │ ✗-2  │  ✓   │
```

**SAB = 2 pessoas quando pico exige 4.** 3 FVs no sábado (quem trabalhou DOM precisa de FV, e SAB é onde sobra).

### O insight fundamental

```
┌────────────────────────────────────────────────────────────────────┐
│  PROBLEMA ARITMÉTICO INESCAPÁVEL:                                  │
│                                                                    │
│  Quem trabalha DOM precisa de 2 folgas weekday (FF + FV).          │
│  Com 3 no DOM × 2 folgas = 6 folgas weekday nessa semana.          │
│  + 2 CLTs com 1 folga cada (FF, DOM é a 2ª) = 2 folgas.          │
│  Total: 8 folgas em 6 dias.                                        │
│                                                                    │
│  Com 5 CLTs e 8 folgas em 6 dias:                                  │
│  Cobertura média = 5 - 8/6 = 3.67                                 │
│  Pico = 4 → DEFICIT EM PELO MENOS 2 DIAS.                         │
│                                                                    │
│  A questão NÃO é "onde colocar as folgas".                         │
│  É "QUAIS 2 dias vão ter déficit e quanto".                        │
│                                                                    │
│  MELHOR ESTRATÉGIA: concentrar déficit em dias/horários             │
│  de MENOR demanda relativa. Como a demanda é uniforme SEG-SAB,     │
│  a escolha é arbitrária — mas SAB tende a acumular FVs.            │
└────────────────────────────────────────────────────────────────────┘
```

### Distribuição ótima realista

A MELHOR coisa que o solver pode fazer:

```
         │ SEG  │ TER  │ QUA  │ QUI  │ SEX  │ SAB  │ DOM  │
─────────┼──────┼──────┼──────┼──────┼──────┼──────┼──────┤
S1 (3DT):│      │      │      │      │      │      │      │
  Milena │  T   │ FV   │  T   │  T   │ FF   │  T   │  DT  │ FF=SEX, FV=TER
  Roberta│  T   │  T   │  T   │ FV   │  T   │ FF   │  DT  │ FF=SAB, FV=QUI
  Érica  │  T   │  T   │ FV   │  T   │  T   │ FF   │  DT  │ FF=SAB, FV=QUA
  Célia  │ FF   │  T   │  T   │  T   │  T   │  T   │  DF  │ FF=SEG
  Rafaela│  T   │  T   │ FF   │  T   │  T   │  T   │  DF  │ FF=QUA
  M.Clara│ FV   │  NT  │  NT  │  NT  │  NT  │  NT  │  DF  │ XOR: DF→FV SEG
─────────┼──────┼──────┼──────┼──────┼──────┼──────┼──────┤
Cobert.  │  4   │  4   │  3   │  4   │  4   │  3   │ 3/3  │
Dem pico │  4   │  4   │  4   │  4   │  4   │  4   │  3   │
         │  ✓   │  ✓   │ ✗-1  │  ✓   │  ✓   │ ✗-1  │  ✓   │

S2 (3DT invertido):
  Milena │  T   │  T   │ FF   │  T   │  T   │  T   │  DF  │ FF=QUA
  Roberta│  T   │  T   │  T   │ FF   │  T   │  T   │  DF  │ FF=QUI
  Érica  │  T   │  T   │  T   │  T   │ FF   │  T   │  DF  │ FF=SEX
  Célia  │  T   │ FV   │  T   │  T   │  T   │ FF   │  DT  │ FF=SAB, FV=TER
  Rafaela│ FV   │  T   │  T   │  T   │  T   │ FF   │  DT  │ FF=SAB, FV=SEG
  M.Clara│  T   │  NT  │  NT  │  NT  │  NT  │  NT  │  DT  │ XOR: DT→trab SEG
─────────┼──────┼──────┼──────┼──────┼──────┼──────┼──────┤
Cobert.  │  4+1 │  4   │  4   │  4   │  4   │  3   │ 3/3  │
Dem pico │  4   │  4   │  4   │  4   │  4   │  4   │  3   │
         │  ✓   │  ✓   │  ✓   │  ✓   │  ✓   │ ✗-1  │  ✓   │
```

### Resultado ideal

- **S1:** déficit de 1 pessoa em QUA e SAB (no horário de pico 10-12h apenas)
- **S2:** déficit de 1 pessoa só em SAB
- **DOM:** 100% coberto sempre (3/3)
- **Equilíbrio:** cada CLT trabalha exatamente 5 dias/semana, 44h
- **Maria Clara:** 0 ou 2 dias conforme XOR (correto)
- **Nenhuma mulher com 2 DOMs seguidos** ✓

### Comparação com solver CLI

| Métrica | Ideal (manual) | Solver CLI |
|---------|---------------|------------|
| Cobertura geral | ~95-97% | 93.5% |
| Dias com déficit | 2-3 por semana (pico) | Vários |
| DOM cobertura | 100% | 83-100% |
| Equilíbrio horas | 44h cada | 44h cada ✓ |
| Max consecutivos | ≤6 | ≤6 ✓ |
| Violações HARD | 0 | 0 ✓ |

**O solver está ABAIXO do ideal.** O ideal manual distribui folgas espalhadas (1 por dia ou no máximo 2 no SAB). O solver está concentrando folgas, causando mais déficit.

---

## Disclaimers Críticos

🚨 **Com 5 CLTs e demanda pico=4, déficit é INEVITÁVEL.** A aritmética não permite 4 pessoas todo dia quando cada uma precisa de 2 folgas/semana na semana que trabalha DOM. O solver faz o melhor possível — se chegar em 95%+, está excelente.

🚨 **SAB é o dia mais difícil.** As FVs tendem a cair no SAB porque é o último dia antes do DOM. Duas FVs + 1 FF no SAB = 3 folgas = só 2 pessoas. Não tem como resolver sem mudar a demanda de SAB ou contratar mais gente.

🚨 **Maria Clara contribui pouco.** Ela só trabalha 2 dias por ciclo (SEG+DOM quando DT). Nos outros 12 dias, é NT. Ela ajuda no DOM (3ª pessoa) e eventualmente no SEG, mas não resolve o problema de cobertura SEG-SAB.

---

## Preview Atual vs Ideal (20/03/2026)

### O que o preview TS gera hoje

```
         │ SEG  │ TER  │ QUA  │ QUI  │ SEX  │ SAB  │ DOM  │
─────────┼──────┼──────┼──────┼──────┼──────┼──────┼──────┤
S1 (3DT):│      │      │      │      │      │      │      │
  Milena │ FF   │ FV   │  T   │  T   │  T   │  T   │  DT  │ Fixo=SEG, Var=TER
  Roberta│ FF   │  T   │  T   │  T   │  T   │  T   │  DF  │ Fixo=SEG
  Érica  │  T   │  T   │  T   │ FF   │ FV   │  T   │  DT  │ Fixo=QUI, Var=SEX
  Célia  │  T   │  T   │  T   │  T   │  T   │ FF   │  DF  │ Fixo=SAB
  Rafaela│  T   │ FF   │ FV   │  T   │  T   │  T   │  DT  │ Fixo=TER, Var=QUA
  M.Clara│  T   │  NT  │  NT  │  NT  │  NT  │  NT  │  DF  │ XOR: DF→trab SEG
─────────┼──────┼──────┼──────┼──────┼──────┼──────┼──────┤
Cobert.  │  4   │  3   │  4   │  4   │  4   │  4   │ 3/3  │
Dem pico │  4   │  4   │  4   │  4   │  4   │  4   │  3   │
         │  ✓   │ ✗-1  │  ✓   │  ✓   │  ✓   │  ✓   │  ✓   │

S2 (3DT invertido):
  Milena │ FF   │  T   │  T   │  T   │  T   │  T   │  DF  │ Fixo=SEG
  Roberta│ FF   │  T   │ FV   │  T   │  T   │  T   │  DT  │ Fixo=SEG, Var=QUA
  Érica  │  T   │  T   │  T   │ FF   │  T   │  T   │  DF  │ Fixo=QUI
  Célia  │ FV   │  T   │  T   │  T   │  T   │ FF   │  DT  │ Fixo=SAB, Var=SEG
  Rafaela│  T   │ FF   │  T   │  T   │  T   │  T   │  DF  │ Fixo=TER
  M.Clara│ FV   │  NT  │  NT  │  NT  │  NT  │  NT  │  DT  │ XOR: DT→folga SEG (FV)
─────────┼──────┼──────┼──────┼──────┼──────┼──────┼──────┤
Cobert.  │  2   │  4   │  4   │  4   │  5   │  4   │ 3/3  │
Dem pico │  4   │  4   │  4   │  4   │  4   │  4   │  3   │
         │ ✗✗-2 │  ✓   │  ✓   │  ✓   │  ✓+1 │  ✓   │  ✓   │
```

### Diagnóstico: por que SEG S2 = 2/4 (DÉFICIT DE 2)

```
Quem folga na SEG em S2:
  1. Milena  — FF=SEG (folga fixa toda semana)
  2. Roberta — FF=SEG (folga fixa toda semana)      ← MESMO DIA que Milena!
  3. Célia   — FV=SEG (trabalha DOM → folga variável na SEG)
  4. M.Clara — FV=SEG (trabalha DOM → folga variável na SEG, XOR tipo B)

4 pessoas folgando na SEG = só 2 trabalhando (Érica + Rafaela)
Demanda pico = 4 → DÉFICIT DE 2
```

**Causa raiz: `pickBestFolgaDay` atribuiu FF=SEG pra Milena E Roberta.**

O algoritmo avalia surplus dia a dia conforme itera pelas pessoas. Quando atribui Milena, SEG parece ter sobra (5 disponíveis, demanda 4 → sobra 1). Quando atribui Roberta, SEG ainda parece ok (4 disponíveis, demanda 4 → empate). Mas ele NÃO considera que SEG vai acumular 2 FVs extras (Célia + Maria Clara) nas semanas DT.

**O pickBestFolgaDay é míope: conta folgas JÁ atribuídas, mas não antecipa FVs futuras.**

### Ideal vs Preview — tabela comparativa

| Métrica | Ideal (manual) | Preview TS |
|---------|---------------|------------|
| **Pior dia S1** | QUA ou SAB: 3/4 (✗-1) | TER: 3/4 (✗-1) |
| **Pior dia S2** | SAB: 3/4 (✗-1) | **SEG: 2/4 (✗✗-2)** |
| **Max déficit** | 1 pessoa | **2 pessoas** |
| **Dias com déficit** | 2-3 | 2 |
| **FFs repetidos** | Nenhum (todos em dias diferentes) | **Milena=SEG + Roberta=SEG** |
| **Consciência de FV** | FFs escolhidos evitando dias com FV | **Ignora FVs futuras** |

### O fix necessário no `pickBestFolgaDay`

O algoritmo precisa considerar as FVs que VÃO EXISTIR, não só as folgas já atribuídas:

```
ANTES (míope):
  score = capacidade[d] - demanda[d] - folgasJáAtribuídas[d]

DEPOIS (antecipa FVs):
  fvsPrevistas[d] = quantas pessoas TÊM folga_variavel nesse dia
                    × proporção de semanas DT (tipicamente 50%)
  score = capacidade[d] - demanda[d] - folgasJáAtribuídas[d] - fvsPrevistas[d]
```

Isso faria o algoritmo EVITAR SEG pra folga fixa, já que SEG vai acumular FVs de Célia e Maria Clara.
