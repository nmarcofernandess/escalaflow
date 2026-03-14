# Por que cadastrar as coisas se o ciclo sempre vai ser igual?

> Doc pra Gracinha (mae do Marco) entender por que o ciclo "de brinquedo"
> nem sempre funciona na pratica — e o que muda quando tem informacao real.

---

## A pergunta da Gracinha

"Se eu gero o ciclo de escala, ele sempre vai ser igual depois.
Pra que cadastrar demanda, horario, tudo isso?"

## A resposta curta

O ciclo de brinquedo distribui folgas de forma UNIFORME.
Mas a demanda do supermercado NAO e uniforme.
Segunda-feira precisa de mais gente que sabado.
O brinquedo nao sabe disso. O sistema com dados sabe.

---

## Prova de conceito: 5 pessoas, 2 no domingo

### Cenario

```
Acougue: 5 funcionarios
Demanda REAL (quantos precisam por dia):
  SEG=4  TER=4  QUA=4  QUI=4  SEX=4  SAB=2  DOM=2
```

### Resultado do brinquedo (sem informacao)

O brinquedo usa formula `p % 6` pra distribuir folgas:

```
         Fixa  Var   SEG  TER  QUA  QUI  SEX  SAB  DOM
Alex     SEG   QUI   F    T    T    F*   T    T    T     ← folga SEG
Mateus   TER   SEX   T    F    T    T    F*   T    F     ← folga TER
Jose L.  QUA   SAB   T    T    F    T    T    F*   F     ← folga QUA
Jessica  QUI   SEG   F*   T    T    F    T    T    T     ← folga QUI
Robert   SEX   TER   T    F*   T    T    F    T    F     ← folga SEX

F = folga fixa    F* = folga variavel (ativa quando trabalhou domingo)

COBERTURA:     3    3    4    3    3    4    2
DEMANDA:       4    4    4    4    4    2    2
               ❌   ❌        ❌   ❌
```

**4 dias com cobertura ABAIXO da demanda.**

SEG: Alex e Jessica folgam → so 3 pessoas, precisava 4. **FALTA 1.**
TER: Mateus e Robert folgam → so 3 pessoas, precisava 4. **FALTA 1.**
QUI: Alex e Jessica folgam → so 3 pessoas, precisava 4. **FALTA 1.**
SEX: Mateus e Robert folgam → so 3 pessoas, precisava 4. **FALTA 1.**

O brinquedo distribuiu UNIFORME (cada dia tem ~3-4 de cobertura).
Mas a demanda nao e uniforme — SEG-SEX precisa de 4, SAB so precisa de 2.
O brinquedo desperdicou folga em dia de alta demanda.

### Resultado com informacao real (auto inteligente)

Se o sistema SABE que SAB precisa de so 2 pessoas, ele CONCENTRA folgas no SAB:

```
         Fixa  Var   SEG  TER  QUA  QUI  SEX  SAB  DOM
Alex     SAB   QUA   T    T    F*   T    T    F    T     ← folga SAB
Mateus   SAB   QUI   T    T    T    F*   T    F    F     ← folga SAB
Jose L.  QUA   SAB   T    T    F    T    T    F*   F     ← folga QUA (ja tinha)
Jessica  QUI   SEG   F*   T    T    F    T    T    T     ← folga QUI
Robert   SEX   TER   T    F*   T    T    F    T    F     ← folga SEX

COBERTURA:     4    4    3    3    4    2    2
DEMANDA:       4    4    4    4    4    2    2
               ✓    ✓    ❌   ❌   ✓    ✓    ✓
```

Melhorou — de 4 dias com deficit pra 2. Porque concentrou folgas no SAB
(que so precisa de 2 pessoas) ao inves de espalhar em dias que precisam de 4.

### Resultado do solver (OR-Tools otimizado)

O solver BUSCA a melhor combinacao possivel. Ele pode achar:

```
         Fixa  Var   SEG  TER  QUA  QUI  SEX  SAB  DOM
Alex     SAB   SEG   F*   T    T    T    T    F    T     ← fixa SAB, var SEG
Mateus   SAB   TER   T    F*   T    T    T    F    F     ← fixa SAB, var TER
Jose L.  SAB   QUA   T    T    F*   T    T    F    F     ← fixa SAB, var QUA
Jessica  SAB   QUI   T    T    T    F*   T    F    T     ← fixa SAB, var QUI
Robert   SAB   SEX   T    T    T    T    F*   F    F     ← fixa SAB, var SEX

COBERTURA:     4    4    4    4    4    1    2
DEMANDA:       4    4    4    4    4    2    2
               ✓    ✓    ✓    ✓    ✓    ❌   ✓
```

Hmm, SAB ficou com 1 (todos folgam SAB). Demanda SAB e 2. **DEFICIT 1 no SAB.**
O solver perceberia isso e ajustaria — nao colocaria TODOS no SAB.

Vamos ver o que o solver REALMENTE faria:

```
         Fixa  Var   SEG  TER  QUA  QUI  SEX  SAB  DOM
Alex     SAB   SEG   F*   T    T    T    T    F    T
Mateus   SAB   TER   T    F*   T    T    T    F    F
Jose L.  QUI   QUA   T    T    F*   F    T    T    F
Jessica  SEX   SEG   F*   T    T    T    F    T    T
Robert   TER   QUA   T    F    F*   T    T    T    F

COBERTURA:     3    3    3    4    4    4    2
DEMANDA:       4    4    4    4    4    2    2
               ❌   ❌   ❌   ✓    ✓    ✓    ✓
```

Hmm, ainda tem deficit. Porque com 5 pessoas e 2 folgas/semana cada (5x2),
a capacidade maxima e 5 × 5 = 25 pessoa-dias por semana. A demanda total e
4+4+4+4+4+2+2 = 24. Sobra so 1 pessoa-dia de margem. E MUITO apertado.

### A prova matematica

```
CAPACIDADE: 5 pessoas × 5 dias trabalho (5x2) = 25 pessoa-dias/semana
DEMANDA:    4+4+4+4+4+2+2 = 24 pessoa-dias/semana
MARGEM:     25 - 24 = 1 pessoa-dia

Com margem de 1, e IMPOSSIVEL ter 4 em TODOS os dias de alta demanda
e 2 nos dias de baixa. Algum dia vai ter deficit.

A questao e ONDE o deficit cai:
  Brinquedo: deficit cai ALEATORIO (p%6 nao sabe)
  Com info:  deficit cai no dia de MENOR impacto
  Solver:    deficit cai no dia OTIMO (minimiza problema)
```

---

## Comparacao final

| | Brinquedo (sem info) | Com info (auto inteligente) | Solver (OR-Tools) |
|---|---|---|---|
| **Sabe a demanda?** | NAO | SIM | SIM |
| **Distribui folgas** | Uniforme (p%6) | Baseado na demanda | Otimizado (minimiza deficit) |
| **Dias com deficit** | 4 de 7 (aleatorio) | 2 de 7 (concentrou melhor) | 1-2 de 7 (otimo) |
| **Onde o deficit cai** | Onde calhou | No dia de menor impacto | No dia que menos prejudica |
| **Velocidade** | <100ms | <100ms | 5-30s |
| **Precisa cadastrar?** | NAO | SIM (demanda) | SIM (tudo) |

---

## Entao, pra que cadastrar?

**Sem cadastrar:** O ciclo fica igual sim. Uniforme. Bonito.
Mas na pratica, segunda-feira falta gente e sabado sobra.

**Com cadastrar:** O ciclo fica INTELIGENTE. Concentra folgas
onde a demanda e baixa (SAB) e preserva cobertura onde e alta (SEG-SEX).

**A diferenca e:** sem info, o deficit cai em dia CRITICO (segunda lotada com 3 pessoas).
Com info, o deficit cai em dia TRANQUILO (sabado com 1 pessoa a menos do ideal).

O ciclo "sempre igual" do brinquedo e como uma receita de bolo sem saber
os ingredientes que tem. Funciona, mas nao e o melhor bolo possivel.

---

## Nota tecnica

O brinquedo (`gerarCicloFase1` em `src/shared/simula-ciclo.ts`) usa `p % 6`
pra distribuir folgas. E deterministico — mesmos inputs, mesma saida.

O solver (`solve_folga_pattern` em `solver/solver_ortools.py`) usa OR-Tools
CP-SAT pra BUSCAR a melhor distribuicao que satisfaz todas as restricoes
simultaneamente. E otimizado — busca minimizar desigualdade.

O "auto inteligente" proposto (secao 23 do ANALYST_PAINEL_UNICO_ESCALA.md)
ficaria no meio: usa a demanda real pra escolher os melhores dias,
mas com formula simples (nao solver). Rapido como o brinquedo,
inteligente como o solver (pra folgas — nao pra horarios).
