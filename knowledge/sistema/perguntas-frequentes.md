# Perguntas Frequentes - EscalaFlow

## Geracao de Escalas

### Por que a escala nao consegue cobrir 100% da demanda?

Com um numero limitado de colaboradores e todas as restricoes da CLT (folgas obrigatorias, interjornada 11h, max 6 dias consecutivos), atingir 100% de cobertura e matematicamente impossivel na maioria dos casos. Profissionais experientes de RH atingem cerca de 85% de cobertura manualmente. O motor busca o mesmo nivel ou melhor.

O deficit de cobertura e tratado como SOFT constraint — o motor maximiza a cobertura sem tornar a geracao impossivel. Se fosse HARD, a maioria das escalas daria INFEASIBLE.

### O que significa INFEASIBLE?

INFEASIBLE indica que o motor nao encontrou nenhuma solucao que respeite todas as regras HARD ao mesmo tempo. Nao e um bug — e uma impossibilidade matematica real. As causas mais comuns sao: poucos colaboradores, muitas excecoes simultaneas, ou janelas de horario muito restritivas.

O campo `diagnostico` do resultado sempre explica o motivo e sugere solucoes: relaxar regras, adicionar gente, reduzir demanda, etc.

### Qual a diferenca entre modo Rapido e Otimizado?

O modo Rapido (30 segundos) encontra uma boa solucao rapidamente. E suficiente para a maioria dos casos do dia a dia. O modo Otimizado (120 segundos) dedica mais tempo para encontrar a melhor solucao possivel — recomendado para periodos longos, setores complexos, ou quando o Rapido nao atingiu uma cobertura satisfatoria.

### Posso gerar escala para qualquer periodo?

Sim, o periodo e flexivel. O mais comum e gerar por mes (ex: 01/03 a 31/03), mas pode gerar por quinzena, semana ou qualquer intervalo. Periodos mais longos exigem mais tempo de processamento.

### O que sao violacoes HARD e SOFT?

- **HARD**: Violacoes de leis trabalhistas obrigatorias (CLT). Uma escala com violacoes HARD nao pode ser oficializada. Exemplo: colaborador trabalhando 7 dias consecutivos.
- **SOFT**: Alertas de otimizacao ou boas praticas. Nao impedem oficializacao, mas indicam oportunidades de melhoria. Exemplo: turno preferido nao respeitado.

### Como funciona o rules_override?

O rules_override permite relaxar temporariamente uma regra para uma unica geracao. Exemplo: `{"H1":"SOFT"}` transforma a regra de max 6 dias consecutivos de HARD para SOFT so naquela geracao. A configuracao permanente da empresa nao e alterada. Util para cenarios excepcionais onde a regra padrao impede uma solucao viavel.

## Colaboradores

### Qual a diferenca entre CLT, Estagiario e Aprendiz?

- **CLT**: Funcionario regular. Pode trabalhar domingo, pode fazer hora extra (ate 10h/dia). Compensacao 9h45 permitida em regime 5X2.
- **Estagiario**: Max 6h/dia (30h/sem) ou 4h/dia (20h/sem). NUNCA trabalha domingo. NUNCA faz hora extra.
- **Aprendiz**: NUNCA trabalha domingo. NUNCA trabalha feriado. NUNCA trabalha em horario noturno (22h-5h). NUNCA faz hora extra.

### O que e compensacao 9h45?

Colaboradores CLT em regime 5X2 (5 dias de trabalho, 2 de folga) podem trabalhar ate 9h45 por dia para compensar o sabado sem trabalho. Isso esta previsto na CLT e permite que a meta semanal de 44h seja atingida em 5 dias (5 x 8h48min = 44h). Estagiarios e aprendizes NUNCA compensam.

### Como funciona a regra de domingos?

O domingo e tratado como dia especial pela CLT:
- **Homens**: Podem trabalhar ate 2 domingos consecutivos, depois precisam de 1 domingo de folga (ciclo 2:1 padrao)
- **Mulheres**: Podem trabalhar ate 1 domingo consecutivo, depois precisam de 1 domingo de folga (ciclo 1:1)
- **Estagiarios e Aprendizes**: NUNCA trabalham domingo

O ciclo pode ser personalizado por colaborador. Exemplo: "Maria trabalha 1 domingo e folga 2" (ciclo 1:2).

### O que e rank e para que serve?

O rank indica a senioridade do colaborador (0 = junior, valores maiores = mais senior). O motor usa o rank para evitar deixar um junior sozinho em horario de pico — garante que sempre tenha alguem experiente junto.

## Regras e Configuracoes

### Posso desligar uma regra CLT?

Depende. Regras marcadas como `editavel=0` sao CLT obrigatorias e NAO podem ser desligadas (aparece um cadeado na interface). Regras marcadas como `editavel=1` podem ter o status alterado: HARD, SOFT ou OFF. Exemplos de regras configuraveis: max 6 dias consecutivos (H1), almoco obrigatorio (H6), meta semanal (H10).

### O que sao as 35 regras do motor?

O motor aplica 35 regras automaticamente, divididas em:
- **16 CLT**: Legislacao trabalhista (interjornada, jornada maxima, almoco, estagiarios, aprendizes, feriados)
- **7 SOFT**: Otimizacao (deficit de cobertura, turno preferido, consistencia de horario, equilibrio)
- **12 ANTIPATTERN**: Boas praticas (clopening, junior sozinho, almoco simultaneo, hora extra evitavel, ioio de horario, etc.)

### O que e clopening?

Clopening (close + opening) e quando um colaborador fecha o supermercado (ex: termina as 22:00) e abre no dia seguinte (ex: comeca as 06:00). Embora a interjornada minima de 11h esteja sendo respeitada (8h entre 22h e 06h NAO respeita — mas 22h→09h sim), o clopening e desconfortavel e prejudica a qualidade de vida. O motor trata como antipattern (penalidade SOFT).

Nota: Se a interjornada de 11h nao for respeitada, e violacao HARD (CLT), nao apenas antipattern.

### O que sao perfis de horario?

Perfis de horario sao templates de janela de entrada/saida por tipo de contrato. Exemplo: o contrato "Estagiario Manha" pode ter um perfil "Manha Padrao" (entrada 08:00, saida 12:00) e outro "Manha Flexivel" (entrada 07:00-09:00, saida 11:00-13:00). O colaborador pode ser vinculado a um perfil, ou ter janela individual.

## Banco de Dados e Dados

### Onde ficam os dados?

Todos os dados ficam localmente no computador do usuario, em um arquivo de banco de dados PGlite. O caminho e `data/escalaflow.db` na pasta do aplicativo. Nao ha servidor, nao ha nuvem.

### Como faco backup?

O arquivo do banco de dados pode ser copiado manualmente. O sistema nao tem funcao de backup automatico por enquanto. Recomendacao: copiar periodicamente a pasta `data/` para um local seguro.

### Posso resetar o banco?

Sim. O comando `npm run db:reset` (para desenvolvedores) ou simplesmente deletar o arquivo do banco e reiniciar o app recria tudo do zero com os dados padrao (contratos CLT, feriados nacionais, regras do motor).

## IA e Chat

### O que a IA pode fazer?

A IA integrada e como uma colega de RH inteligente. Ela pode:
- Gerar escalas e analisar resultados
- Cadastrar e editar colaboradores, excecoes, demandas
- Importar listas em lote
- Explicar regras CLT e violacoes
- Diagnosticar problemas em escalas
- Configurar regras e horarios
- Responder duvidas sobre legislacao trabalhista

### A IA precisa de internet?

Sim, a IA funciona via API (Gemini ou OpenRouter). Sem internet, o chat nao funciona. Porem, o restante do sistema (geracao de escalas, cadastros, visualizacao) funciona 100% offline.

### A IA pode errar?

A IA sempre usa dados reais do sistema via tools — ela nao inventa informacoes. Porem, para perguntas sobre legislacao que nao estao no seu conhecimento integrado, ela pode nao ter certeza. Nesse caso, ela avisa: "nao tenho certeza sobre esse ponto especifico da legislacao".

## Atualizacoes

### Como atualizo o EscalaFlow?

O app verifica atualizacoes automaticamente ao iniciar. Se houver uma nova versao, aparece uma notificacao com opcao de baixar e instalar. O processo e automatico via GitHub Releases.

### A atualizacao apaga meus dados?

Nao. Os dados ficam na pasta `data/` que nao e alterada pela atualizacao. O schema do banco e migrado automaticamente (novas colunas sao adicionadas sem perder dados existentes).
