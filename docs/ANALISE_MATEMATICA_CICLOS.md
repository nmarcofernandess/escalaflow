# A Matematica dos Ciclos — Estamos Ofendendo a Fisica?

> Analise matematica pra saber se o modelo S1/S2 de ciclo de 2 semanas
> e viavel ou se estamos forçando algo impossivel.
> Data: 2026-02-25

---

## RESPOSTA CURTA: SIM, ESTAVAMOS ERRADOS

O ciclo **nao e de 2 semanas**. O ciclo de repeticao depende da quantidade
de funcionarios e da demanda de domingo. Com 5 pessoas e 2 no domingo,
o ciclo minimo e de **5 semanas**, nao 2.

E pior: **o ciclo nao e um template estatico**. A folga variavel e uma
**regra condicional** (se trabalhou DOM → folga no dia var), nao um
pattern S1/S2 que se repete.

---

## 1. O PROBLEMA DO DOMINGO COM 5 PESSOAS

5 pessoas no acougue. Demanda domingo = 2 pessoas.
Regra: max 2 domingos consecutivos (nunca 3 seguidos).

### Round-robin justo (5 pessoas, 2 por domingo):

```
         Sem1  Sem2  Sem3  Sem4  Sem5  Sem6  Sem7  Sem8  Sem9  Sem10
Alex      T     T     .     .     .     T     T     .     .     .
Mateus    .     T     T     .     .     .     T     T     .     .
Jose L.   .     .     T     T     .     .     .     T     T     .
Jessica   .     .     .     T     T     .     .     .     T     T
Robert    T     .     .     .     T     T     .     .     .     T

DOM/sem:  2     2     2     2     2     2     2     2     2     2  ✓
```

**Padrao individual do Alex:**
```
T T . . . | T T . . . | T T . . .
2 sim, 3 nao, 2 sim, 3 nao...  → ciclo de 5 semanas
```

**Padrao individual do Robert:**
```
T . . . T | T . . . T | T . . . T
1 sim, 3 nao, 1 sim... → ciclo de 5 semanas (mas defasado)
```

Cada pessoa trabalha **2 domingos a cada 5 semanas**.
Nunca mais que 2 consecutivos. ✓
Ciclo minimo de repeticao = **5 semanas** (nao 2).

---

## 2. POR QUE S1/S2 NAO FUNCIONA

O modelo S1/S2 assume ciclo de 2 semanas:
```
S1: DOM=T, SEG=F
S2: DOM=F, SEG=T
(repete)
```

Isso implica: **cada pessoa trabalha 1 domingo sim, 1 nao (50%)**.

Com 5 pessoas e 50% no domingo = 2.5 pessoas/domingo.
Mas precisa de exatamente 2. Nao fecha. ❌

Com 4 pessoas e 50% = 2 exatas. Fecha. ✓
Com 6 pessoas e 50% = 3. Se demanda = 3, fecha. ✓

**A formula:**
```
Ciclo minimo = N / gcd(N, D)

N = total de pessoas
D = quantas precisam no domingo
gcd = maior divisor comum
```

| N pessoas | D no domingo | gcd(N,D) | Ciclo minimo | S1/S2 funciona? |
|-----------|-------------|----------|--------------|-----------------|
| 4         | 2           | 2        | 2 semanas    | SIM ✓           |
| 5         | 2           | 1        | 5 semanas    | NAO ❌          |
| 6         | 2           | 2        | 3 semanas    | NAO ❌          |
| 6         | 3           | 3        | 2 semanas    | SIM ✓           |
| 8         | 2           | 2        | 4 semanas    | NAO ❌          |
| 10        | 2           | 2        | 5 semanas    | NAO ❌          |

**S1/S2 so funciona quando gcd(N,D) = N/2.** Na maioria dos casos reais, nao funciona.

---

## 3. O QUE A MAE DO MARCO DESCREVEU

A regra REAL nao e um template de ciclo. E uma regra condicional:

```
REGRA: SE trabalhou_domingo(semana N) → folga_variavel(semana N+1) ATIVA
       SE NAO trabalhou_domingo(semana N) → folga_variavel(semana N+1) INATIVA
```

A folga variavel SEGUE o domingo. Nao e o contrario.
O domingo e decidido pela demanda + rotacao justa.
A folga variavel e CONSEQUENCIA, nao causa.

### Exemplo com Alex (var=SEG, fixa=SAB):

```
         DOM da semana    SEG da semana SEGUINTE    SAB
Sem 1    TRABALHA         → Sem 2 SEG = FOLGA       FOLGA (fixa)
Sem 2    TRABALHA         → Sem 3 SEG = FOLGA       FOLGA (fixa)
Sem 3    FOLGA            → Sem 4 SEG = TRABALHA    FOLGA (fixa)
Sem 4    FOLGA            → Sem 5 SEG = TRABALHA    FOLGA (fixa)
Sem 5    FOLGA            → Sem 6 SEG = TRABALHA    FOLGA (fixa)
Sem 6    TRABALHA         → Sem 7 SEG = FOLGA       FOLGA (fixa)
...repete ciclo de 5...
```

**Nao e S1/S2 alternando. E o domingo que DITA a segunda-feira.**

---

## 4. A ESCALA COMPLETA (5 pessoas, 5 semanas, 2 no DOM)

```
ACOUGUE — 5 semanas (ciclo completo)
F = folga fixa, V = folga variavel, . = trabalha

         SEG   TER   QUA   QUI   SEX   SAB   DOM
Alex     Sem1   .     .     .     .     .    [F]    .  ← DOM=T
         Sem2  [V]    .     .     .     .    [F]    .  ← DOM=T (var ativa: trab DOM sem1)
         Sem3  [V]    .     .     .     .    [F]    .  ← DOM=. (var ativa: trab DOM sem2)
         Sem4   .     .     .     .     .    [F]    .  ← DOM=.
         Sem5   .     .     .     .     .    [F]    .  ← DOM=.

Mateus   Sem1   .     .     .     .     .    [F]    .  ← DOM=.
         Sem2   .    [V]    .     .     .    [F]    .  ← DOM=T (var ativa: trab DOM sem1? Nao!)
         Sem3   .     .     .     .     .    [F]    .  ← DOM=T
         Sem4   .    [V]    .     .     .    [F]    .  ← DOM=T (var: trab DOM sem3)
         Sem5   .     .     .     .     .    [F]    .  ← DOM=.
```

Hmm, espera. Vamos ser PRECISO com a regra:

```
Regra: SE trabalhou domingo DESTA semana (SEG-DOM)
       ENTAO folga variavel DESTA MESMA semana esta ATIVA
       (a variavel e num dia ANTES do domingo na mesma semana)

OU

Regra: SE trabalhou domingo da semana ANTERIOR
       ENTAO folga variavel DESTA semana esta ATIVA
```

**Qual das duas?**

A semana e SEG-DOM. Se a variavel do Alex e SEG (primeiro dia da semana)
e o domingo e o ultimo dia da semana, a decisao do domingo so pode afetar
a PROXIMA segunda. Entao:

```
REGRA CORRETA:
  domingo(semana N) = TRABALHA → segunda(semana N+1) = FOLGA variavel
  domingo(semana N) = FOLGA    → segunda(semana N+1) = TRABALHA
```

---

## 5. ESCALA CORRETA (regra condicional, 5 pessoas, 2 no DOM)

```
Fixas: Alex=SAB, Mateus=SAB, JoseL=QUI, Jessica=QUA, Robert=SEX
Variaveis: Alex=SEG, Mateus=TER, JoseL=SEG, Jessica=TER, Robert=QUA
Demanda DOM: 2 pessoas

Round-robin DOM: [Alex,Robert] [Alex,Mateus] [JoseL,Jessica] [Mateus,JoseL] [Jessica,Robert]

LEGENDA: [F]=fixa  (V)=variavel  .=trabalha  *=domingo trabalha

         SEG  TER  QUA  QUI  SEX  SAB  DOM     Folgas  DOM?
         ────────────────────────────────────────────────────
Alex  1:  .    .    .    .    .   [F]   *       1F      T
      2: (V)   .    .    .    .   [F]   *       2FV     T  ← trab DOM sem1 → var ativa
      3: (V)   .    .    .    .   [F]   .       2FV     .  ← trab DOM sem2 → var ativa
      4:  .    .    .    .    .   [F]   .       1F      .  ← folga DOM sem3 → var inativa
      5:  .    .    .    .    .   [F]   .       1F      .  ← folga DOM sem4 → var inativa
         ────────────────────────────────────────────────────
Mateus 1: .    .    .    .    .   [F]   .       1F      .
      2:  .    .    .    .    .   [F]   *       1F      T  ← folga DOM sem1 → var inativa
      3:  .   (V)   .    .    .   [F]   .       2FV     .  ← trab DOM sem2 → var ativa
      4:  .    .    .    .    .   [F]   *       1F      T  ← folga DOM sem3 → var inativa
      5:  .   (V)   .    .    .   [F]   .       2FV     .  ← trab DOM sem4 → var ativa
         ────────────────────────────────────────────────────
JoseL  1: .    .    .   [F]   .    .    .       1F      .
      2:  .    .    .   [F]   .    .    .       1F      .  ← folga DOM sem1 → var inativa
      3:  .    .    .   [F]   .    .    *       1F      T  ← folga DOM sem2 → var inativa
      4: (V)   .    .   [F]   .    .    *       2FV     T  ← trab DOM sem3 → var ativa
      5: (V)   .    .   [F]   .    .    .       2FV     .  ← trab DOM sem4 → var ativa
         ────────────────────────────────────────────────────
Jessica 1: .   .   [F]   .    .    .    .       1F      .
      2:  .    .   [F]   .    .    .    .       1F      .  ← folga DOM sem1 → var inativa
      3:  .    .   [F]   .    .    .    *       1F      T  ← folga DOM sem2 → var inativa
      4:  .   (V) [F]   .    .    .    .       2FV     .  ← trab DOM sem3 → var ativa (WAIT)
      5:  .    .   [F]   .    .    .    *       1F      T  ← folga DOM sem4 → var inativa
         ────────────────────────────────────────────────────
Robert 1: .    .    .    .   [F]   .    *       1F      T
      2:  .    .   (V)   .   [F]   .    .       2FV     .  ← trab DOM sem1 → var ativa
      3:  .    .    .    .   [F]   .    .       1F      .  ← folga DOM sem2 → var inativa
      4:  .    .    .    .   [F]   .    .       1F      .  ← folga DOM sem3 → var inativa
      5:  .    .    .    .   [F]   .    *       1F      T  ← folga DOM sem4 → var inativa (WAIT)
         ────────────────────────────────────────────────────

COBERTURA POR DIA:
      SEG  TER  QUA  QUI  SEX  SAB  DOM
Sem1:  5    5    4    4    4    3    2  ✓
Sem2:  4    5    4    4    4    3    2  ✓
Sem3:  4    4    4    4    4    3    2  ✓
Sem4:  4    4    4    3    4    3    2  ✓
Sem5:  4    4    4    4    4    3    2  ✓
```

A regra da variavel gera um padrao IRREGULAR que so se repete a cada 5 semanas
(ou mais, dependendo de como o solver distribui domingos).

---

## 6. O QUE MUDA NO MODELO

### ANTES (errado — S1/S2 estatico):
```
escala_ciclo_modelos: semanas_no_ciclo=2
escala_ciclo_itens: template fixo S1, S2
Bridge: resolve template → folgas por data
Solver: recebe folgas pre-decididas
```

### DEPOIS (correto — regra condicional):
```
Colaborador tem:
  - folga_fixa_dia_semana = SAB (mesmo dia toda semana, HARD)
  - folga_variavel_dia_semana = SEG (dia que ativa/desativa conforme DOM)

Solver recebe:
  - folga_fixa como constraint HARD (ja existe: add_folga_fixa_5x2)
  - NOVA constraint: works_day[c, seg_n+1] + works_day[c, dom_n] == 1
    (XOR: se trabalha DOM, folga SEG seguinte. Se folga DOM, trabalha SEG)
  - domingo distribuido via demanda + domingo_ciclo_soft (ja existe)

O SOLVER DECIDE TUDO. Nao tem template. Nao tem ciclo pre-definido.
O ciclo EMERGE da matematica.
```

### A constraint em Python:
```python
# NOVA: folga_variavel_condicional
# Para cada colaborador com folga_variavel_dia_semana definido:
#   works_day[c, dia_var_proxima_semana] + works_day[c, dom_desta_semana] == 1

def add_folga_variavel_condicional(model, works_day, colabs, days, day_labels, C, D):
    for c in range(C):
        var_day = colabs[c].get("folga_variavel_dia_semana")
        if not var_day:
            continue
        # Para cada domingo no periodo
        for d in range(D):
            if day_labels[d] != "DOM":
                continue
            # Achar o dia_var da PROXIMA semana (d + offset)
            dom_idx = d
            # dia_var esta N dias depois do DOM (na proxima semana SEG-DOM)
            # SEG=+1, TER=+2, QUA=+3, QUI=+4, SEX=+5, SAB=+6
            offset = {"SEG": 1, "TER": 2, "QUA": 3, "QUI": 4, "SEX": 5, "SAB": 6}
            var_idx = dom_idx + offset.get(var_day, 0)
            if var_idx < D:  # dentro do periodo
                # XOR: trabalha_dom + trabalha_var == 1
                model.add(works_day[c, dom_idx] + works_day[c, var_idx] == 1)
```

---

## 7. CONCLUSAO

| Aspecto | Modelo S1/S2 (errado) | Modelo condicional (correto) |
|---------|----------------------|------------------------------|
| Ciclo | Fixo 2 semanas | Emergente (5+ semanas) |
| Template | Estatico, pre-definido | Nao existe — solver calcula |
| Folga variavel | Alterna S1/S2 | Segue domingo da semana anterior |
| Implementacao | Bridge resolve template | 1 constraint Python nova |
| Complexidade | Alta (tabelas, bridge, persist) | Baixa (1 constraint + 2 campos) |
| Funciona com 5 pessoas? | NAO | SIM |
| Funciona com qualquer N? | So se gcd(N,D)=N/2 | SIM, sempre |

**Nao estamos ofendendo a fisica.** Estamos ofendendo a ARITMETICA.
O S1/S2 so funciona quando o numero de pessoas divide perfeitamente
pela demanda de domingo. Na maioria dos casos reais, nao divide.

**A solucao correta e MAIS SIMPLES:**
- 2 campos novos no colaborador: `folga_fixa_dia_semana` (ja existe) + `folga_variavel_dia_semana` (novo)
- 1 constraint nova no Python: `works_day[c, dia_var] + works_day[c, dom_anterior] == 1`
- O solver resolve o resto sozinho

Nao precisa de escala_ciclo_modelos. Nao precisa de escala_ciclo_itens.
Nao precisa de bridge resolvendo templates. Nao precisa de idempotencia.
O solver JA SABE distribuir domingos. So precisa de 1 regra dizendo
"se trabalhou dom, folga nesse dia".
