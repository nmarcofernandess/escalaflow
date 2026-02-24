# Entidades do Sistema EscalaFlow

## Empresa

Configuracao global do sistema. Existe apenas 1 registro (singleton).

Campos importantes:
- **corte_semanal**: Define quando a "semana" vira para contagem de horas. Opcoes: SEG_DOM (padrao), TER_SEG, QUA_TER, etc. Afeta o calculo de horas semanais e dias consecutivos.
- **grid_minutos**: Quantizacao universal de horarios (fixo em 15 minutos).
- **tolerancia_semanal_min**: Margem de mais ou menos minutos permitida na meta semanal do colaborador. Padrao: 30 minutos.
- **min_intervalo_almoco_min**: Duracao minima do almoco. Padrao: 60 minutos (CLT). Se a empresa usa CCT FecomercioSP, pode ser 30 minutos.
- **usa_cct_intervalo_reduzido**: Se TRUE, permite almoco de 30 minutos ao inves de 1 hora.

A empresa tambem tem horario de funcionamento por dia da semana (tabela empresa_horario_semana), que define quando abre e fecha cada dia. Setores podem ter overrides proprios.

## Setor

Departamento do supermercado. Os setores sao cadastrados pela empresa de acordo com sua estrutura.

Campos importantes:
- **nome**: Nome do setor
- **hora_abertura / hora_fechamento**: Janela de funcionamento do setor
- **ativo**: Soft delete — setor desativado nao aparece para geracao de escalas

Cada setor tem seus proprios colaboradores, demandas de cobertura e funcoes/postos.

O setor pode ter horarios personalizados por dia da semana (tabela setor_horario_semana), que sobrescrevem o horario da empresa. Exemplo: um setor pode fechar as 20h no sabado mesmo que a empresa feche as 22h.

## Colaborador

Pessoa real que trabalha no supermercado. Pertence a 1 setor e tem 1 tipo de contrato.

Campos importantes:
- **nome**: Nome completo do colaborador
- **setor_id**: Setor onde trabalha
- **tipo_contrato_id**: Tipo de contrato (CLT 44h, CLT 36h, Estagiario, etc.)
- **tipo_trabalhador**: CLT, ESTAGIARIO ou APRENDIZ — chave que define restricoes legais
- **sexo**: M ou F — afeta a regra de domingos consecutivos (mulheres max 1, homens max 2)
- **horas_semanais**: Meta de horas por semana (44, 36, 30 ou 20)
- **rank**: Senioridade (0 = junior). O motor evita deixar junior sozinho em horario de pico.
- **prefere_turno**: MANHA ou TARDE (SOFT — motor tenta respeitar, mas nao garante)
- **funcao_id**: Posto de trabalho (Caixa 1, Repositor, etc.)
- **ativo**: Soft delete

### Regras individuais por colaborador

Cada colaborador pode ter regras personalizadas (tabela colaborador_regra_horario):
- **Janela de horario**: Horario minimo e maximo de entrada/saida
- **Ciclo de domingo**: Quantos domingos trabalha vs folga (padrao: 2 trabalha, 1 folga)
- **Folga fixa**: Dia da semana em que SEMPRE folga (ex: "toda quarta")
- **Perfil de horario**: Vincula a um perfil padrao do contrato

Excecoes por data (tabela colaborador_regra_horario_excecao_data):
- Override pontual: "No dia 15/03, Cleunice so pode de 08:00 a 12:00"
- Forcas folga no domingo especifico
- Prevalece sobre qualquer outra regra naquele dia

## Tipo de Contrato

Template que define as restricoes legais de um grupo de colaboradores.

Contratos padroes do sistema:
- **CLT 44h**: Regime 5X2, 44 horas semanais, max 9h45/dia (compensacao), trabalha domingo
- **CLT 36h**: Regime 5X2, 36 horas semanais, max 9h45/dia (compensacao), trabalha domingo
- **Estagiario Manha**: Regime 5X2, 20 horas semanais, max 4h/dia, NUNCA domingo, NUNCA hora extra
- **Estagiario Tarde/Noite**: Regime 5X2, 30 horas semanais, max 6h/dia, NUNCA domingo, NUNCA hora extra
- **Jovem Aprendiz**: NUNCA domingo, NUNCA feriado, NUNCA noturno (22h-5h), NUNCA hora extra

Cada tipo de contrato pode ter perfis de horario (tabela contrato_perfis_horario) que definem janelas padrao de entrada e saida.

## Demanda

"Quantas pessoas preciso nesse horario". Define a cobertura minima por faixa horaria e dia da semana.

Campos importantes:
- **setor_id**: Setor da demanda
- **dia_semana**: SEG, TER, QUA, QUI, SEX, SAB, DOM
- **hora_inicio / hora_fim**: Faixa horaria (em blocos de 15min)
- **min_pessoas**: Numero minimo de pessoas necessarias nessa faixa

Importante: O deficit de cobertura e tratado como SOFT constraint, nao HARD. Com poucos colaboradores e muitas restricoes CLT, atingir 100% de cobertura e matematicamente impossivel. O motor maximiza a cobertura sem tornar a geracao impossivel.

Demandas excepcionais por data (tabela demandas_excecao_data):
- Override pontual: "Na Black Friday, preciso de 5 pessoas no caixa das 08:00 as 22:00"
- Prevalece sobre a demanda semanal normal naquele dia

## Excecao

Periodo em que o colaborador esta INDISPONIVEL. O motor respeita como HARD constraint.

Tipos:
- **FERIAS**: Periodo de ferias do colaborador
- **ATESTADO**: Afastamento medico
- **BLOQUEIO**: Indisponibilidade generica (motivo livre na observacao)

O colaborador NAO aparece na escala nos dias cobertos pela excecao.

## Funcao / Posto

No supermercado, as pessoas pensam em POSTOS de trabalho, nao em cargos abstratos.

Exemplos: Caixa 1, Caixa 2, Repositor, Acougueiro, Padeiro, Frentista.

Cada funcao tem:
- **apelido**: Nome curto ("Caixa 1")
- **cor_hex**: Cor para identificacao visual no grid da escala
- **tipo_contrato_id**: Tipo de contrato esperado pro posto
- **setor_id**: Setor onde o posto existe
- **ativo**: Se o posto esta em uso
- **ordem**: Ordenacao visual

## Escala

Resultado do motor. Contem tudo sobre um periodo de trabalho.

Campos importantes:
- **setor_id**: Setor da escala
- **data_inicio / data_fim**: Periodo coberto
- **status**: RASCUNHO, OFICIAL ou ARQUIVADA
- **pontuacao**: Score de qualidade (maior = melhor)
- **cobertura_percent**: Percentual de cobertura da demanda (85% e tipico)
- **violacoes_hard**: Numero de violacoes CLT graves (deve ser 0 para oficializar)
- **violacoes_soft**: Numero de alertas de otimizacao
- **equilibrio**: Indice de equilibrio entre colaboradores (0 a 100%)
- **input_hash**: Hash dos dados de entrada — permite detectar se a escala ficou desatualizada

## Alocacao

Uma linha de alocacao = 1 dia de 1 pessoa em 1 escala.

Campos importantes:
- **escala_id / colaborador_id / data**: Chave unica
- **status**: TRABALHO, FOLGA ou INDISPONIVEL
- **hora_inicio / hora_fim**: Horario de trabalho
- **minutos_trabalho**: Total de minutos trabalhados
- **hora_almoco_inicio / hora_almoco_fim**: Intervalo de almoco
- **funcao_id**: Posto de trabalho naquele dia

## Feriado

Datas especiais com tratamento diferenciado.

Campos importantes:
- **data**: Data do feriado (formato YYYY-MM-DD)
- **nome**: Nome do feriado
- **tipo**: NACIONAL, ESTADUAL ou MUNICIPAL
- **proibido_trabalhar**: Se TRUE, NINGUEM pode trabalhar nesse dia (CLT/CCT)
- **cct_autoriza**: Se TRUE, a CCT autoriza trabalho mediante acordo

Feriados CCT proibidos: 25/12 (Natal) e 01/01 (Ano Novo) — nesses dias e PROIBIDO trabalhar por determinacao da CCT FecomercioSP.

## Regras do Motor

35 regras catalogadas que o motor aplica automaticamente:

- **16 regras CLT**: Legislacao trabalhista obrigatoria (interjornada 11h, max 10h/dia, max 6 dias consecutivos, almoco, estagiarios, aprendizes, feriados CCT)
- **7 regras SOFT**: Otimizacao de qualidade (deficit de cobertura, turno preferido, consistencia de horario, spread justo, ciclo de domingo)
- **12 regras ANTIPATTERN**: Boas praticas (clopening, junior sozinho, almoco simultaneo, hora extra evitavel, ioio de horario, etc.)

Regras podem ser:
- **HARD**: Obrigatorio — violacao impede oficializacao
- **SOFT**: Desejavel — motor tenta respeitar, penalidade se violar
- **OFF**: Desligada — motor ignora

Regras CLT fixas (editavel=0) nao podem ser desligadas pelo usuario. Regras configuráveis (editavel=1) podem ter o status alterado pela empresa.
