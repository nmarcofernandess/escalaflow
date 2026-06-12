<!-- quando_usar: tipos de contrato, CLT 44h 36h 30h, 6x1, 5x2, estagiario, intermitente, NT, horas semanais, jornada maxima, compensacao 9h45, perfis de horario, aprendiz conhecimento legal nao ativo -->
# Tipos de Contrato no EscalaFlow

## Visao geral

O EscalaFlow vem com contratos de fabrica para os dois regimes de escala (5x2 e 6x1), cada um com restricoes legais distintas que o motor aplica automaticamente. CLT 44h e CLT 36h existem nas duas versoes: a padrao (5x2) e a de varejo ("CLT 44h 6x1" / "CLT 36h 6x1"). Tambem e possivel criar contratos customizados escolhendo o regime no formulario.

Tipos ativos de trabalhador no produto atual: `CLT`, `ESTAGIARIO` e `INTERMITENTE`. Jovem Aprendiz e conhecimento legal geral, mas nao e tipo ativo no cadastro atual.

## CLT 44 horas

O contrato mais comum para funcionarios regulares do supermercado.

- **Regime**: 5X2 (5 dias de trabalho, 2 dias de folga por semana)
- **Horas semanais**: 44 horas
- **Jornada maxima diaria**: 9h45 (585 minutos) com compensacao
- **Trabalha domingo**: Sim, respeitando ciclo de folgas
- **Hora extra**: Permitida ate 10h/dia (Art. 59 CLT)
- **Compensacao**: Pode fazer ate 9h45/dia para compensar o sabado. Em regime 5X2, os 44h semanais sao distribuidos em 5 dias (5 x 8h48min = 44h)

### Exemplos praticos
- Joao (CLT 44h): Trabalha segunda a sexta das 08:00 as 17:48 (8h48 por dia = 44h/semana)
- Maria (CLT 44h): Trabalha segunda a sexta das 07:00 as 16:45, com almoco de 1h (9h45 bruto - 1h almoco = 8h45 liquido)

### Restricoes
- Maximo 6 dias consecutivos de trabalho
- Interjornada minima de 11 horas
- Almoco obrigatorio para jornada acima de 6 horas (minimo 30min com CCT ou 1h CLT padrao)
- Intervalo de 15 minutos para jornada entre 4h e 6h

## CLT 36 horas

Contrato com carga horaria reduzida.

- **Regime**: 5X2 (5 dias de trabalho, 2 dias de folga por semana)
- **Horas semanais**: 36 horas
- **Jornada maxima diaria**: 9h45 (585 minutos) com compensacao
- **Trabalha domingo**: Sim, respeitando ciclo de folgas
- **Hora extra**: Permitida ate 10h/dia
- **Compensacao**: Mesma regra do CLT 44h

### Exemplos praticos
- Ana (CLT 36h): Trabalha segunda a sexta das 08:00 as 15:12 (7h12 por dia = 36h/semana)
- Em dias que compensa, pode fazer ate 9h45

### Diferenca do CLT 44h
Mesmas restricoes legais, apenas a meta semanal e menor. O motor distribui 36h em 5 dias (7h12/dia em media) ao inves de 44h (8h48/dia).

## CLT 44h 6x1 e CLT 36h 6x1 (regime de varejo)

Versoes 6x1 dos contratos CLT — o padrao do comercio: 6 dias de trabalho e 1 folga por semana.

- **Regime**: 6X1 (6 dias de trabalho, 1 folga por semana)
- **Horas semanais**: 44h (ou 36h) — a meta e SEMANAL, com a tolerancia configurada na empresa
- **Jornada maxima diaria**: 9h45 (585 minutos)
- **Trabalha domingo**: Sim, respeitando o ciclo de rodizio
- **Distribuicao**: o motor monta jornadas desiguais que fecham a meta na semana (ex.: 44h em 6 dias = 4 dias de 7h30 + 2 dias de 7h00)

### A folga unica do 6x1 (como funciona)
- Na semana em que a pessoa FOLGA o domingo, o proprio domingo e a folga da semana.
- Na semana em que TRABALHA o domingo, a folga cai num dia de SEG a SAB (o "dia variavel").
- Folga fixa em dia de SEG-SAB significa trabalhar TODOS os domingos (senao haveria 2 folgas).
- **Transicao de domingo**: quando a pessoa trabalha o domingo de uma semana e folga o domingo da seguinte, o sistema insere uma folga extra naquela semana — sem ela haveria 7+ dias corridos de trabalho, violando o maximo de 6 consecutivos. Nessa semana especifica a pessoa trabalha 5 dias. Isso e correto e automatico.

### Exemplo pratico
- Carlos (CLT 44h 6x1, acougue): trabalha SEG-SAB com folga DOM numa semana; na outra trabalha DOM e folga QUA. Total ~44h/semana, jornadas de 7h a 7h30.

## Estagiario Manha (20 horas)

Contrato de estagio com restricoes severas. Protegido pela Lei 11.788 (Lei do Estagio).

- **Regime**: 5X2
- **Horas semanais**: 20 horas
- **Jornada maxima diaria**: 4 horas (240 minutos)
- **Trabalha domingo**: Sim, se a operacao/TCE permitir; o motor nao bloqueia automaticamente
- **Hora extra**: NUNCA (proibido por lei)
- **Compensacao**: Nao se aplica

### Restricoes especificas
- Maximo 4 horas por dia, 20 horas por semana
- Pode trabalhar domingo se permitido pela operacao/TCE, respeitando o limite diario/semanal
- NUNCA faz hora extra — e proibido por lei, nao e so uma regra de empresa
- Intervalo de 15 minutos obrigatorio (jornada entre 4h e 6h)
- Nao tem direito a almoco (jornada de 4h nao exige)

### Exemplo pratico
- Lucas (Estagiario Manha): Trabalha segunda a sexta das 08:00 as 12:00 (4h/dia = 20h/semana)

## Estagiario Tarde/Noite (30 horas)

Estagio com carga horaria maior, mas ainda protegido pela Lei 11.788.

- **Regime**: 5X2
- **Horas semanais**: 30 horas
- **Jornada maxima diaria**: 6 horas (360 minutos)
- **Trabalha domingo**: Sim, se a operacao/TCE permitir; o motor nao bloqueia automaticamente
- **Hora extra**: NUNCA
- **Compensacao**: Nao se aplica

### Restricoes especificas
- Maximo 6 horas por dia, 30 horas por semana
- Pode trabalhar domingo se permitido pela operacao/TCE, respeitando o limite diario/semanal
- NUNCA faz hora extra
- Almoco obrigatorio para jornada acima de 6h (na pratica, se a jornada e exatamente 6h, nao precisa de almoco, mas precisa de intervalo de 15min)
- Intervalo de 15 minutos obrigatorio para jornada entre 4h e 6h

### Exemplo pratico
- Camila (Estagiario Tarde): Trabalha segunda a sexta das 14:00 as 20:00 (6h/dia = 30h/semana)

## Intermitente

Contrato convocado sob demanda. No EscalaFlow, o intermitente trabalha apenas nos dias definidos por regra de horario e recorrencia.

- **Horas semanais**: nao usar como meta fixa de tela. A meta exibida no resumo e a carga convocada/trabalhada no periodo.
- **Dias sem regra**: aparecem como **NT (Nao Trabalha)** na UI/export/IA.
- **Persistencia**: NT nao e status novo no banco. As alocacoes continuam usando `TRABALHO`, `FOLGA` e `INDISPONIVEL`.
- **Tipo A**: `folga_variavel = NULL`; trabalha dias fixos/recorrentes. Para domingo quinzenal, use regra no DOM + recorrencia 1 semana ON / 1 OFF.
- **Tipo B**: `folga_variavel != NULL`; participa do rodizio DOM↔dia variavel.

O DSR do intermitente e tratado na convocacao/pagamento. O produto nao deve criar folga variavel artificial para representar "nao convocado".

## Jovem Aprendiz (conhecimento legal, nao tipo ativo)

Contrato com as restricoes mais severas. Protegido pela CLT (Arts. 404, 405, 432).

O EscalaFlow atual NAO tem `APRENDIZ` como `tipo_trabalhador` ativo. Nao crie contrato/colaborador prometendo suporte operacional a Aprendiz; esta secao fica como referencia legal para evolucao futura.

- **Regime**: Variavel (definido pelo programa de aprendizagem)
- **Horas semanais**: Variavel (geralmente 20-30h)
- **Jornada maxima diaria**: 6 horas (360 minutos)
- **Trabalha domingo**: NUNCA
- **Trabalha feriado**: NUNCA
- **Horario noturno**: NUNCA (22:00 as 05:00 e proibido)
- **Hora extra**: NUNCA
- **Compensacao**: Nao se aplica

### Restricoes legais especificas
- NUNCA trabalha domingo
- NUNCA trabalha feriado (nenhum, nao so os CCT proibidos)
- NUNCA trabalha em horario noturno (entre 22:00 e 05:00)
- NUNCA faz hora extra
- Jornada maxima de 6 horas por dia

### Exemplo legal
- Pedro (Jovem Aprendiz): poderia trabalhar segunda a sexta das 08:00 as 14:00 (6h/dia = 30h/semana), nunca domingo, feriado ou noite. No EscalaFlow atual, isso exigiria suporte futuro de tipo ativo.

## Tabela comparativa

| Aspecto | CLT 44h | CLT 44h 6x1 | CLT 36h | CLT 36h 6x1 | Estagiario 20h | Estagiario 30h | Intermitente | Aprendiz legal |
|---------|---------|-------------|---------|-------------|-----------------|-----------------|--------------|----------|
| Regime | 5X2 | 6X1 | 5X2 | 6X1 | 5X2 | 5X2 | Por convocacao | Variavel |
| Folgas/semana | 2 | 1 | 2 | 1 | 2 | 2 | N/A (NT fora da convocacao) | Variavel |
| Horas/semana | 44h | 44h | 36h | 36h | 20h | 30h | Convocadas | 20-30h |
| Max/dia | 9h45 | 9h45 | 9h45 | 9h45 | 4h | 6h | 9h45 | 6h |
| Domingo | Sim (ciclo) | Sim (ciclo) | Sim (ciclo) | Sim (ciclo) | Se permitido | Se permitido | Se convocado por regra | NUNCA |
| Feriado | Sim* | Sim* | Sim* | Sim* | Sim* | Sim* | Se convocado e permitido | NUNCA |
| Hora extra | Sim (ate 10h) | Sim (ate 10h) | Sim (ate 10h) | Sim (ate 10h) | NUNCA | NUNCA | Evitar | NUNCA |
| Noturno | Sim | Sim | Sim | Sim | Sim | Sim | Sim | NUNCA |
| Compensacao | 9h45 | 9h45 | 9h45 | 9h45 | Nao | Nao | Nao | Nao |

*Exceto 25/12 e 01/01 que sao proibidos pela CCT FecomercioSP para todos.

## Perfis de horario

Cada tipo de contrato pode ter multiplos perfis de horario associados. Um perfil define a janela de entrada e saida esperada. Exemplos:

- CLT 44h pode ter: "Manha" (entrada 07:00-08:00, saida 16:00-17:00), "Tarde" (entrada 13:00-14:00, saida 21:00-22:00)
- Estagiario Manha pode ter: "Padrao" (entrada 08:00, saida 12:00), "Flexivel" (entrada 07:00-09:00, saida 11:00-13:00)

Colaboradores podem ser vinculados a um perfil ou ter janela individual. O perfil serve como template padrao.
