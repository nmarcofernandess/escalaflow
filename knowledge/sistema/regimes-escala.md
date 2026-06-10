<!-- quando_usar: regime de escala, 5x2, 6x1, folga unica, rodizio de domingo, dia avulso, trabalhar na folga, intermitente quinzenal, alternar semanas, a cada 15 dias, mudar regime do setor -->
# Regimes de Escala: 5x2 e 6x1

## O que sao

- **5x2**: 5 dias de trabalho + 2 folgas por semana. Cada pessoa tem uma folga FIXA (sempre no mesmo dia, SEG-SAB) e uma folga VARIAVEL que funciona em XOR com o domingo: na semana em que trabalha domingo, folga no dia variavel; na semana em que folga domingo, trabalha no dia variavel.
- **6x1**: 6 dias de trabalho + 1 folga por semana — o padrao do varejo (acougue, padaria, caixas). A folga unica e o XOR puro: folga DOM quando nao trabalha domingo; folga no dia variavel quando trabalha domingo. Folga fixa em SEG-SAB implica trabalhar TODOS os domingos.

## Quem define o regime (cascata)

1. Override individual do colaborador (raro)
2. **Regime do setor** (`setores.regime_escala`) — configuravel no detalhe do setor
3. **Regime do contrato** (`tipos_contrato.regime_escala`)

Para montar um setor 6x1: configure o regime do setor para 6X1 e use contratos 6x1 (de fabrica: "CLT 44h 6x1" e "CLT 36h 6x1") nos colaboradores.

## Como o motor trata

O regime vira `dias_trabalho` (5 ou 6) e o solver aplica a soma exata de dias de trabalho por semana — as folgas emergem. A meta de horas e SEMANAL com tolerancia (configurada na empresa), entao 44h em 6 dias fecham com jornadas desiguais (ex.: 4 dias de 7h30 + 2 de 7h00) dentro do grid de 15 minutos.

## Transicao de domingo no 6x1 (importante)

Quando alguem trabalha o domingo de uma semana e folga o domingo da seguinte, a sequencia teria 7+ dias corridos de trabalho — o que viola o maximo de 6 dias consecutivos (CLT Art. 67). Por isso o sistema insere automaticamente uma folga extra nessa semana de transicao (a pessoa trabalha 5 dias naquela semana). Isso acontece tanto no preview de ciclo quanto na geracao real. E correto, esperado, e nao e um erro.

## Preview de ciclo e sugestoes no 6x1

O Preview Nivel 1 (simulacao instantanea de ciclo na tela do setor) funciona nos dois regimes. No 6x1 ele mostra a folga unica rodando com o domingo e as folgas extras de transicao. O fluxo de sugestoes (advisory) que roda antes de gerar tambem funciona nos dois regimes.

## Dia avulso — pessoa trabalha num dia que seria folga

Exemplo: "O Joao folga na quarta, mas vai trabalhar nesta quarta dia 15."

- O caminho certo e ajustar a celula na escala: gere a escala normalmente (ou use a existente) e mude a celula do dia para TRABALHO (clique na grid, ou via IA com `ajustar_alocacao`). O validador recalcula tudo na hora.
- A excecao por data NAO serve para isso: ela define janela de horario num dia em que a pessoa ja trabalharia, ou forca FOLGA avulsa (`domingo_forcar_folga`) — o caso inverso.
- Atencao CLT: o dia extra alem da meta semanal aparece nos indicadores como desvio de horas (hora extra). O controle do pagamento e externo ao sistema.

## Folga avulsa — pessoa folga num dia que trabalharia

Use a excecao por data com `domingo_forcar_folga: true` (apesar do nome, forca folga na data), ou ajuste a celula da escala para FOLGA. Para ausencias de periodo (ferias, atestado, bloqueio), use a excecao de periodo.

## Recorrencia de intermitente

O modelo nativo e SEMANAL: regras de horario por dia da semana + ciclo de domingo automatico.

- **Domingo sim, domingo nao (quinzenal nos domingos)**: automatico. O ciclo de domingo aceita qualquer razao (1/1 alterna domingos). Configure o intermitente Tipo B (com folga variavel) e o motor calcula o ciclo sozinho a partir da equipe e da demanda.
- **Semana sim, semana nao (alternar semanas inteiras)**: NAO ha suporte nativo. Contorno pratico: criar excecoes de BLOQUEIO cobrindo as semanas em que a pessoa nao vem, antes de gerar a escala. Funciona, mas precisa ser repetido a cada novo periodo.
- **"A cada 15 dias" num dia especifico**: mesmo contorno do BLOQUEIO alternado, ou gerar e ajustar as celulas manualmente.

## Mudando o regime de um setor existente

Trocar o regime do setor (5x2 → 6x1 ou vice-versa) vale para as PROXIMAS geracoes — escalas ja geradas nao mudam. Confira tambem os contratos dos colaboradores: o ideal e que estejam no mesmo regime do setor (ex.: mover os colaboradores para "CLT 44h 6x1"). Regras de folga salvas (fixa/variavel) continuam validas, mas lembre que no 6x1 a folga fixa em SEG-SAB significa trabalhar todos os domingos.
