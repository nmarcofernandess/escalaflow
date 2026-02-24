# Intervalos e Descanso na CLT — Aplicacao no EscalaFlow

## Visao geral dos intervalos

A CLT define varios tipos de intervalo obrigatorio que o motor do EscalaFlow respeita automaticamente:
- Intervalo intrajornada (almoco e 15 minutos)
- Intervalo interjornada (11 horas entre jornadas)
- Descanso Semanal Remunerado (DSR)

## Intervalo intrajornada — Almoco

### Quando e obrigatorio
- Jornada **acima de 6 horas**: almoco obrigatorio
- Duracao minima: **1 hora** (CLT padrao) ou **30 minutos** (com CCT FecomercioSP)
- Duracao maxima: **2 horas** (Art. 71 CLT)

### Base legal
- Art. 71 CLT: "Em qualquer trabalho continuo, cuja duracao exceda de 6 horas, e obrigatoria a concessao de um intervalo para repouso ou alimentacao, o qual sera, no minimo, de 1 hora e, salvo acordo escrito ou contrato coletivo em contrario, nao podera exceder de 2 horas."

### CCT FecomercioSP
A CCT permite reducao do almoco para 30 minutos. No EscalaFlow, a empresa configura isso via `usa_cct_intervalo_reduzido`. Quando ativo, o motor aceita almoco de 30 minutos.

### Impacto no motor
O almoco NAO conta como hora trabalhada. Se Joao trabalha das 08:00 as 17:00 com 1h de almoco, ele trabalhou 8 horas (nao 9). O motor calcula automaticamente.

### Horario ideal de almoco
O motor tenta alocar o almoco entre 11:00 e 13:30 (horario convencional). Almoco fora desse horario gera penalidade ANTIPATTERN (AP). Almoco muito cedo (antes das 11:00) ou muito tarde (depois das 14:00) e penalizado mais severamente.

### Almoco simultaneo
O motor evita que mais de 50% dos colaboradores de um setor almocem ao mesmo tempo (AP2 — almoco simultaneo excessivo). Se 6 pessoas trabalham no setor, no maximo 3 devem estar em almoco simultaneamente.

## Intervalo intrajornada — 15 minutos

### Quando e obrigatorio
- Jornada **entre 4 horas e 6 horas**: intervalo de 15 minutos obrigatorio
- Base legal: Art. 71, paragrafo 1 da CLT

### Quem se aplica
Principalmente a estagiarios:
- Estagiario 20h (4h/dia): intervalo de 15min obrigatorio
- Estagiario 30h (6h/dia): intervalo de 15min obrigatorio (nao precisa de almoco porque a jornada nao EXCEDE 6h)

### Detalhe importante
O intervalo de 15 minutos NAO conta como hora trabalhada. O campo `intervalo_15min` na alocacao indica se o intervalo foi aplicado.

## Intervalo interjornada — 11 horas

### Regra
Entre o FIM de uma jornada e o INICIO da proxima, devem haver no minimo 11 horas de descanso.

### Base legal
Art. 66 CLT: "Entre 2 jornadas de trabalho havera um periodo minimo de 11 horas consecutivas para descanso."

### Exemplos praticos

**Cenario 1 — OK:**
- Joao termina segunda as 18:00
- Joao comeca terca as 08:00
- Intervalo: 14 horas (18:00 → 08:00) ✅

**Cenario 2 — Violacao:**
- Maria termina segunda as 22:00
- Maria comeca terca as 07:00
- Intervalo: 9 horas (22:00 → 07:00) ❌ VIOLACAO H2

**Cenario 3 — Limite:**
- Pedro termina segunda as 22:00
- Pedro comeca terca as 09:00
- Intervalo: 11 horas (22:00 → 09:00) ✅ (exatamente no limite)

### Impacto no supermercado
Esta e uma das regras mais limitantes. Se o supermercado fecha as 22:00, quem trabalha no fechamento so pode voltar a partir das 09:00. Isso reduz a flexibilidade de escalonamento e pode contribuir para INFEASIBLE.

### Clopening (antipattern relacionado)
Mesmo respeitando as 11h legais, descanso inferior a 13h e considerado desconfortavel (antipattern AP1 — "clopening"). O motor penaliza com SOFT mas nao bloqueia.

## Descanso Semanal Remunerado (DSR)

### Regra principal
Todo trabalhador tem direito a pelo menos 1 dia de folga por semana, preferencialmente no domingo.

### Base legal
- Art. 67 CLT: "Sera assegurado a todo empregado um descanso semanal de 24 horas consecutivas"
- Lei 605/1949: DSR preferencialmente aos domingos

### No EscalaFlow
O motor implementa via regra H1 (max 6 dias consecutivos). Se uma pessoa trabalhou 6 dias seguidos, OBRIGATORIAMENTE folga no 7o dia.

### DSR Interjornada
Quando o DSR inclui a interjornada de 11h, o descanso total e de 35h (24h DSR + 11h interjornada). Base: Sumula 110 TST.

Exemplo:
- Joao trabalha segunda a sabado
- Sabado termina as 18:00
- Domingo inteiro de folga (24h)
- Segunda so pode comecar apos 05:00 (18:00 + 35h = 05:00 de segunda)
- Na pratica, comeca as 08:00 normalmente

## Domingos

### Regra geral
O trabalho no domingo e permitido para o comercio mediante CCT. A folga compensatoria deve ocorrer dentro de 7 dias (Lei 605/1949).

### Ciclos por genero
- **Homens**: Maximo 2 domingos consecutivos de trabalho, depois 1 domingo de folga (ciclo 2:1)
- **Mulheres**: Maximo 1 domingo consecutivo de trabalho, depois 1 domingo de folga (ciclo 1:1) — Art. 386 CLT

### No EscalaFlow
O domingo virou SOFT constraint (S_DOMINGO_CICLO). O motor tenta respeitar o ciclo, mas nao bloqueia a geracao se nao conseguir. A razao: com poucos colaboradores, forcar o ciclo como HARD frequentemente causa INFEASIBLE.

O ciclo e personalizavel por colaborador na tabela `colaborador_regra_horario`.

### Estagiarios e Aprendizes
NUNCA trabalham domingo. E HARD constraint, nao SOFT.

## Jornada maxima

### CLT regular
- Jornada normal: 8 horas (480 minutos)
- Com hora extra: maximo 10 horas (600 minutos) — Art. 59 CLT
- Compensacao semanal (5X2): ate 9h45 (585 minutos) por dia para CLT 44h e 36h

### Estagiarios
- 20h semanais: maximo 4h/dia (240 minutos)
- 30h semanais: maximo 6h/dia (360 minutos)
- NUNCA hora extra

### Aprendizes
- Maximo 6h/dia (360 minutos)
- NUNCA hora extra

### Jornada minima
O EscalaFlow define jornada minima de 4 horas (240 minutos) como decisao de produto. Nao faz sentido escalar alguem para menos de 4h — o custo de deslocamento e preparacao nao compensa.

## Resumo de limites temporais

| Limite | Valor | Base legal |
|--------|-------|------------|
| Interjornada | 11h minimo | Art. 66 CLT |
| DSR | 24h + 11h = 35h | Sumula 110 TST |
| Almoco minimo CLT | 1 hora | Art. 71 CLT |
| Almoco minimo CCT | 30 minutos | CCT FecomercioSP |
| Almoco maximo | 2 horas | Art. 71 CLT |
| Intervalo curto | 15 minutos (4h-6h) | Art. 71 §1 CLT |
| Max dias consecutivos | 6 dias | Art. 67 CLT |
| Jornada max normal | 8h | CLT |
| Jornada max com HE | 10h | Art. 59 CLT |
| Compensacao 5X2 | 9h45 | CLT |
| Clopening confortavel | 13h minimo | Boa pratica |
