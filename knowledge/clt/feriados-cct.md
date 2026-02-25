<!-- quando_usar: feriado CCT FecomercioSP, Natal Ano Novo proibido trabalhar, aprendiz feriado, Black Friday demanda excepcional, Carnaval, domingos CCT -->
# Feriados e CCT FecomercioSP no EscalaFlow

## CCT FecomercioSP — O que e

A CCT (Convencao Coletiva de Trabalho) da FecomercioSP e o acordo sindical que rege o comercio do estado de Sao Paulo. Ela define regras adicionais alem da CLT que se aplicam ao comercio varejista.

## Feriados proibidos pela CCT

A CCT determina que em dois dias do ano e ABSOLUTAMENTE PROIBIDO trabalhar no comercio:

### 25 de Dezembro (Natal)
- Ninguem trabalha. Sem excecao.
- O motor trata como HARD constraint: qualquer colaborador escalado nesse dia e violacao grave.
- Aplica-se a TODOS os tipos de trabalhador (CLT, estagiario, aprendiz).

### 01 de Janeiro (Ano Novo)
- Mesma regra do Natal.
- Ninguem trabalha. Sem excecao.
- HARD constraint no motor.

### Por que apenas esses dois?

A legislacao brasileira permite trabalho em feriados mediante acordo coletivo (CCT). A CCT FecomercioSP autoriza trabalho em todos os feriados EXCETO 25/12 e 01/01. Nos demais feriados, o supermercado pode funcionar normalmente.

## Demais feriados

Nos demais feriados (nacionais, estaduais, municipais), o trabalho e permitido pela CCT. O motor os trata como dias normais em termos de escalonamento, a menos que:
- O feriado esteja marcado como `proibido_trabalhar=TRUE` no banco
- Haja demanda excepcional cadastrada para aquele dia

### Feriados nacionais cadastrados no sistema
- 01/01 — Confraternizacao Universal (**PROIBIDO**)
- Carnaval (terça) — variavel
- Sexta-feira Santa — variavel
- 21/04 — Tiradentes
- 01/05 — Dia do Trabalho
- Corpus Christi — variavel
- 07/09 — Independencia do Brasil
- 12/10 — Nossa Senhora Aparecida
- 02/11 — Finados
- 15/11 — Proclamacao da Republica
- 20/11 — Consciencia Negra
- 25/12 — Natal (**PROIBIDO**)

## Intervalo de almoco reduzido (CCT)

A CLT padrao exige almoco minimo de 1 hora para jornadas acima de 6 horas (Art. 71). Porem, a CCT FecomercioSP autoriza a reducao para 30 minutos mediante acordo.

### Como funciona no EscalaFlow
- A empresa tem a configuracao `usa_cct_intervalo_reduzido` (TRUE/FALSE)
- Se TRUE: almoco minimo de 30 minutos
- Se FALSE: almoco minimo de 1 hora (CLT padrao)
- O campo `min_intervalo_almoco_min` na tabela empresa define o valor exato

### Por que importa?
Com almoco de 30 minutos ao inves de 1 hora, o colaborador ganha 30 minutos de jornada util. Isso pode ser a diferenca entre uma escala viavel e INFEASIBLE, especialmente em setores com poucos colaboradores.

## Aprendiz e feriados

O Jovem Aprendiz tem tratamento especial: NUNCA trabalha em NENHUM feriado, independente da CCT autorizar. Isso vale para todos os feriados (nacionais, estaduais, municipais), nao apenas os CCT proibidos.

Base legal: CLT Arts. 404 e 432.

## Trabalho em feriado e remuneracao

Importante: O EscalaFlow gera escalas, mas NAO calcula folha de pagamento. Questoes como:
- Pagamento em dobro para trabalho em feriado
- Adicional noturno
- Hora extra
- DSR (Descanso Semanal Remunerado)

Sao responsabilidade do sistema de folha de pagamento da empresa. O EscalaFlow apenas garante que as regras de ESCALAMENTO estejam corretas (quem trabalha quando, respeitando limites legais).

## Domingos e a CCT

A legislacao brasileira (Lei 605/1949) exige folga compensatoria dentro de 7 dias apos trabalho no domingo. A CCT FecomercioSP segue esta regra.

No EscalaFlow, o motor implementa o ciclo de domingos:
- Homens: Trabalha ate 2 domingos consecutivos, folga no 3o (ciclo 2:1)
- Mulheres: Trabalha 1 domingo, folga no proximo (ciclo 1:1, conforme Art. 386 CLT)

O ciclo e personalizavel por colaborador. Se o RH definir que "Maria trabalha 1 domingo e folga 2" (ciclo 1:2), o motor respeita.

## Feriados que caem no domingo

Quando um feriado cai no domingo:
- Para CLT: o dia e tratado como feriado (nao como domingo). As regras de feriado prevalecem.
- Para Aprendiz: NUNCA trabalha (feriado + domingo = duplamente proibido).
- O ciclo de domingos pode ser afetado — se o domingo e feriado e a pessoa nao trabalha, ele nao conta como "domingo trabalhado" no ciclo.

## Pontos de atencao praticos

1. **Escalas de fim de ano**: Novembro e dezembro sao os meses mais complexos por causa dos feriados. Natal e Ano Novo fechados podem criar problemas de cobertura.

2. **Carnaval**: Nao e feriado nacional oficialmente, mas e dia de folga por convencao. A empresa decide se abre ou nao.

3. **Black Friday**: Nao e feriado, mas gera demanda excepcional. Usar `demandas_excecao_data` para aumentar a cobertura.

4. **Semana Santa**: Sexta-feira Santa e feriado movil. Verificar se a CCT autoriza trabalho ou nao.
