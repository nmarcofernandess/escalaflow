<!-- quando_usar: como gerar escala, passo a passo, preflight, modo rapido otimizado, rules override, ajustar escala, cadastrar ferias, INFEASIBLE, cadastrar lote, demanda excepcional, oficializar -->
# Fluxos de Trabalho no EscalaFlow

## Fluxo 1: Gerar uma escala do mes

Este e o fluxo principal do sistema. O usuario quer gerar a escala de trabalho de um setor para um periodo (normalmente 1 mes).

### Pre-requisitos
- Setor cadastrado com colaboradores ativos
- Demandas de cobertura definidas (quantas pessoas por faixa horaria)
- Excecoes cadastradas (ferias, atestados do periodo)

### Passo a passo
1. **Preflight**: O sistema verifica se o setor tem tudo necessario para gerar a escala. Identifica blockers: setor sem colaboradores, sem demanda, colaboradores sem contrato valido, etc.
2. **Geracao**: O motor Python (OR-Tools CP-SAT) recebe todos os dados e gera a melhor escala possivel. O solver usa estabilizacao de cobertura — roda ate a cobertura parar de melhorar (30s sem melhoria, timer reseta a cada ganho). Nao existe budget fixo de tempo nem modos de resolucao.
3. **Resultado**: A escala sai como RASCUNHO com indicadores: cobertura (%), violacoes hard/soft, equilibrio, pontuacao.
4. **Revisao**: O RH analisa a escala no grid visual. Pode ver cada dia de cada pessoa, horarios, folgas, funcoes.
5. **Ajustes**: Se necessario, o RH ajusta manualmente (muda status de um dia, altera horarios).
6. **Oficializacao**: Quando satisfeito e com 0 violacoes hard, o RH oficializa a escala.

### Modos de resolucao
- **Rapido** (30 segundos): Feedback rapido, resultado bom o suficiente para a maioria dos casos.
- **Otimizado** (120 segundos): Busca a melhor solucao possivel. Recomendado para periodos longos ou setores complexos.

### Rules Override
O usuario pode temporariamente relaxar regras para uma geracao especifica. Exemplo: `{"H1":"SOFT"}` transforma a regra de max 6 dias consecutivos de HARD para SOFT so naquela geracao. Nao altera a configuracao permanente.

## Fluxo 2: Ajustar uma escala existente

Apos gerar a escala, o RH pode precisar fazer ajustes manuais.

### Ajuste de status
Mudar o dia de uma pessoa entre TRABALHO, FOLGA e INDISPONIVEL. Exemplo: "Cleunice nao pode quarta — trocar para FOLGA".

### Ajuste de horario
Mudar hora de inicio/fim de uma alocacao. Exemplo: "Joao comeca as 09:00 no lugar de 08:00 na segunda".

### Validacao pos-ajuste
Apos cada ajuste, o sistema revalida a escala inteira. Se o ajuste criou uma violacao CLT (ex: agora tem 7 dias consecutivos), o sistema avisa imediatamente.

## Fluxo 3: Cadastrar ferias de um funcionario

1. Identificar o colaborador pelo nome
2. Criar uma excecao do tipo FERIAS com data de inicio e fim
3. Se existir escala ativa cobrindo o periodo, avisar que precisa regerar

As ferias sao tratadas como HARD constraint — o colaborador fica INDISPONIVEL e nao aparece na escala.

## Fluxo 4: Lidar com INFEASIBLE

INFEASIBLE significa que o motor nao conseguiu gerar uma escala valida. As regras ativas sao matematicamente incompativeis com os colaboradores disponiveis.

### Causas comuns
- Poucos colaboradores para cobrir a demanda respeitando folgas obrigatorias
- Muitas excecoes no mesmo periodo (3 de 6 colaboradores de ferias)
- Janelas de horario muito apertadas
- Estagiario com janela de 3h mas contrato exige minimo 4h/dia

### O que fazer
1. Ler o campo `diagnostico` do resultado — ele explica o motivo e sugere solucoes
2. Usar `explicar_violacao` para entender cada regra mencionada
3. Opcoes praticas:
   - Relaxar uma regra: transformar HARD em SOFT via rules_override
   - Adicionar mais gente ao setor
   - Reduzir a demanda de cobertura
   - Ajustar excecoes (adiar ferias, etc.)
   - Ampliar janelas de horario dos colaboradores

## Fluxo 5: Importar lista de funcionarios

Para cadastrar muitos colaboradores de uma vez:

1. Mapear setores e contratos disponiveis no sistema
2. Preparar dados (nomes, setor, contrato, sexo, etc.)
3. Se mais de 10 registros, o sistema mostra um plano resumido antes de executar
4. Cadastro em lote via `cadastrar_lote` (ate 200 registros por vez)
5. Resumo: quantos criados com sucesso, erros (se houver)

## Fluxo 6: Configurar regras personalizadas por colaborador

Cada colaborador pode ter regras individuais que sobrescrevem o padrao:

### Janela de horario
"Cleunice so pode trabalhar de manha" -> Define inicio_min=08:00, inicio_max=08:00, fim_min=12:00, fim_max=14:00.

### Folga fixa
"Joao sempre folga na quarta" -> Define folga_fixa_dia_semana=QUA.

### Ciclo de domingo
"Maria trabalha 1 domingo e folga 2" -> Define domingo_ciclo_trabalho=1, domingo_ciclo_folga=2.

### Excecao por data
"No dia 15/03, Pedro so pode ate 12:00" -> Cria excecao com inicio_min/max e fim_min/max especificos.

### Hierarquia de precedencia
Quando existem multiplas configuracoes, a ordem de prioridade e:
1. Excecao por data (maior precedencia)
2. Regra individual do colaborador
3. Perfil do contrato
4. Padrao do setor/empresa (menor precedencia)

## Fluxo 7: Demanda excepcional (Black Friday)

Para datas especiais que precisam de mais pessoas:

1. Definir a demanda excepcional: setor, data, faixa horaria, numero de pessoas
2. A demanda excepcional sobrescreve a demanda semanal normal naquele dia
3. Regerar a escala para o periodo que inclui a data especial
4. O motor vai tentar alocar mais pessoas conforme a demanda extra

## Fluxo 8: Verificar horas do setor

Para conferir se as horas estao equilibradas:

1. Consultar resumo de horas: setor + periodo
2. O sistema retorna: total por pessoa, media, desvio, quem fez mais/menos
3. Util para: verificar hora extra, equilibrio de carga, compliance semanal

## Fluxo 9: Oficializar escala

A oficializacao trava a escala para uso real:

1. Verificar que violacoes_hard = 0 (obrigatorio)
2. Oficializar — status muda para OFICIAL
3. Escala fica protegida contra edicoes acidentais
4. Para voltar a editar, precisa criar nova escala ou arquivar a atual

## Fluxo 10: Configurar horario de funcionamento

O horario de funcionamento pode ser definido em dois niveis:

### Nivel empresa (padrao para todos os setores)
Exemplo: "A empresa funciona de segunda a sexta das 08:00 as 22:00, sabado das 08:00 as 20:00, domingo das 08:00 as 14:00".

### Nivel setor (override por setor)
Exemplo: "O Acougue fecha as 20:00 no sabado" — sobrescreve o padrao da empresa so para aquele setor naquele dia.
