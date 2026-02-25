<!-- quando_usar: regras CLT motor, HARD SOFT antipattern, H1 H2 H4 H5 H6, interjornada 11h, max 6 dias, almoco obrigatorio, clopening, AP1 AP2 AP3, DIAS_TRABALHO, configurar regras -->
# Regras de Jornada CLT Aplicadas no EscalaFlow

## As 20 Regras do Motor

O motor do EscalaFlow aplica 20 regras HARD (obrigatorias) automaticamente. Estas sao as regras que o sistema verifica ao gerar e validar escalas.

## Regras CLT Fixas (editavel=0, nao podem ser alteradas)

### H2 — Interjornada minima de 11 horas
**Base legal**: Art. 66 CLT
**Regra**: Entre o fim de uma jornada e o inicio da proxima devem haver no minimo 11 horas de descanso.
**Exemplo**: Se Joao termina as 22:00, so pode comecar no dia seguinte a partir das 09:00.
**Impacto**: Limitante para quem trabalha no fechamento. Se o supermercado fecha as 22:00, a pessoa so pode voltar as 09:00.

### H4 — Jornada maxima de 10 horas por dia
**Base legal**: Art. 59 CLT
**Regra**: Incluindo hora extra, nenhum colaborador pode trabalhar mais de 10 horas em um dia.
**Exemplo**: Se Joao comecou as 08:00, o maximo que pode ficar e ate 18:00 (com almoco nao contado).

### H5 — Respeitar excecoes (ferias, atestado, bloqueio)
**Regra**: Colaboradores com excecao ativa ficam INDISPONIVEIS no periodo. O motor NUNCA escala alguem em ferias ou atestado.

### H11 — Estagiario max horas/dia
**Base legal**: Lei 11.788 Art. 10
**Regra**: Estagiario de 20h max 4h/dia. Estagiario de 30h max 6h/dia.

### H12 — Estagiario max horas/semana
**Base legal**: Lei 11.788 Art. 10
**Regra**: Estagiario de 20h max 20h/semana. Estagiario de 30h max 30h/semana.

### H13 — Estagiario nunca domingo
**Base legal**: Lei 11.788 + pratica do setor
**Regra**: Estagiario NUNCA trabalha domingo, independente do contrato.

### H14 — Estagiario nunca hora extra
**Base legal**: Lei 11.788 Art. 10
**Regra**: Estagiario NUNCA excede a carga diaria/semanal. Nao existe "hora extra" para estagiario.

### H15 — Aprendiz nunca domingo
**Base legal**: CLT Art. 404/432
**Regra**: Jovem Aprendiz NUNCA trabalha domingo.

### H16 — Aprendiz nunca feriado
**Base legal**: CLT Art. 404/432
**Regra**: Jovem Aprendiz NUNCA trabalha em NENHUM feriado (nao apenas os CCT proibidos).

### H17 — Aprendiz nunca noturno
**Base legal**: CLT Art. 404/405
**Regra**: Jovem Aprendiz NUNCA trabalha entre 22:00 e 05:00.

### H18 — Feriados CCT proibidos
**Base legal**: CCT FecomercioSP
**Regra**: Nos dias 25/12 (Natal) e 01/01 (Ano Novo), NINGUEM trabalha. Sao os unicos feriados onde o trabalho e absolutamente proibido pela CCT.

## Regras CLT Configuraveis (editavel=1, empresa pode alterar)

### H1 — Maximo 6 dias consecutivos de trabalho
**Base legal**: Art. 67 CLT + OJ 410 TST
**Regra padrao**: HARD — nenhum colaborador pode trabalhar 7 ou mais dias seguidos sem folga.
**Configuravel**: Pode ser mudado para SOFT (penalidade) ou OFF.
**Cuidado**: Desligar esta regra pode gerar passivo trabalhista. Recomendado manter como HARD.

### H6 — Almoco obrigatorio para jornada acima de 6 horas
**Base legal**: Art. 71 CLT
**Regra padrao**: HARD — jornada acima de 6h exige intervalo minimo de 1h (ou 30min com CCT).
**Detalhes**:
- Jornada > 6h: almoco minimo 30min (CCT) ou 1h (CLT padrao)
- Jornada entre 4h e 6h: intervalo de 15 minutos (nao conta como hora trabalhada)
- Almoco maximo: 2 horas (Art. 71 CLT)
**Configuravel**: Pode ser ajustado para SOFT.

### H10 — Meta semanal de horas
**Regra padrao**: HARD — colaborador deve cumprir a meta semanal do contrato (44h, 36h, 30h, 20h) com tolerancia (padrao +-30min).
**Configuravel**: Pode ser mudado para SOFT (permite desvio sem bloquear geracao).

### DIAS_TRABALHO — Dias de trabalho por semana
**Regra padrao**: HARD — respeitar o numero de dias de trabalho definido no contrato (5 dias para 5X2, 6 para 6X1).
**Configuravel**: Pode ser mudado para SOFT.

### MIN_DIARIO — Jornada minima diaria
**Regra padrao**: HARD — nenhum colaborador trabalha menos que 4 horas em um dia (decisao de produto).
**Configuravel**: Pode ser mudado para SOFT ou OFF.

## Regras SOFT (otimizacao, nao impedem oficializacao)

### S_DEFICIT — Deficit de cobertura
**Regra**: Penaliza quando a cobertura da demanda fica abaixo de 100%.
**Comportamento**: O motor tenta maximizar cobertura, mas aceita deficit quando necessario.

### S_SURPLUS — Excesso de cobertura
**Regra**: Penaliza quando ha mais pessoas do que necessario em um slot.
**Comportamento**: Evita desperdicar horas em horarios com pessoal excedente.

### S_DOMINGO_CICLO — Ciclo de domingos
**Regra**: Respeitar o ciclo de domingo de cada colaborador (ex: trabalha 2, folga 1).
**Comportamento**: SOFT — o motor tenta respeitar mas nao garante (H3 original virou SOFT).

### S_TURNO_PREF — Preferencia de turno
**Regra**: Respeitar a preferencia de turno (MANHA ou TARDE) de cada colaborador.
**Comportamento**: SOFT — o motor tenta respeitar, penaliza se nao conseguir.

### S_CONSISTENCIA — Consistencia de horario
**Regra**: Manter horarios consistentes ao longo da semana (evitar "ioio" de horarios).
**Comportamento**: Penaliza variacao excessiva de horarios entre dias.

### S_SPREAD — Distribuicao justa
**Regra**: Distribuir carga de trabalho de forma equilibrada entre colaboradores.
**Comportamento**: Penaliza desequilibrio de horas entre pessoas do mesmo setor.

### S_AP1_EXCESS — Penalidade Antipattern agregada
**Regra**: Penalidade extra quando muitos antipatterns acumulam.

## Regras ANTIPATTERN (boas praticas)

### AP1 — Clopening
Colaborador fecha e abre no dia seguinte (descanso < 13h). Mesmo que respeite as 11h legais, e desconfortavel.

### AP2 — Almoco simultaneo excessivo
Mais de 50% dos colaboradores em almoco ao mesmo tempo deixa o setor descoberto.

### AP3 — Hora extra evitavel
Hora extra quando a redistribuicao entre colaboradores seria possivel.

### AP4 — Sem fim de semana ha muito tempo
Colaborador sem sabado ou domingo de folga ha mais de 5 semanas.

### AP5 — Maratona em horario de pico
Mesmo colaborador escalado em pico por muitos dias seguidos.

### AP6 — Junior sozinho
Colaborador com rank baixo sozinho em horario de pico (sem alguem experiente junto).

### AP7 — Ioio de horario (grave)
Variacao de horario maior que 2h entre dias consecutivos.

### AP8 — Ioio de horario (moderado)
Variacao de horario entre 1h e 2h entre dias consecutivos.

### AP9 — Folga isolada
Dia de folga entre dois dias de trabalho (nao descansa de verdade).

### AP10 — Turnos injustos
Distribuicao desigual de turnos bons e ruins entre colaboradores.

### AP15 — Schedule shock
Mudanca brusca no padrao de horario de uma semana para outra.

### AP16 — Fechamento em sequencia
Mesmo colaborador escalado para fechar o supermercado por muitos dias seguidos.

## Hierarquia de precedencia de regras

Quando ha conflito entre regras, a ordem de prioridade e:
1. **HARD CLT fixa** (editavel=0) — sempre prevalece
2. **HARD CLT configuravel** (editavel=1) — prevalece se ativa
3. **HARD empresa** — regra customizada pela empresa como HARD
4. **SOFT** — motor tenta respeitar, penaliza se violar
5. **ANTIPATTERN** — menor prioridade, apenas penalidade
