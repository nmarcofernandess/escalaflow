# PRD — Motor Python OR (oficial) + Regras por Colaborador + Grid 15min

Data: 2026-02-21
Status: Decisão de produto consolidada

## 1) TL;DR executivo

Este PRD substitui o plano anterior com base no estado real atual do código.

Decisões travadas:
1. O motor oficial é **somente** o Python OR-Tools (`solver/solver_ortools.py`).
2. O legado `horario/teste` é explicitamente fora de escopo e deve ser ignorado no fluxo.
3. Regras de horário passam a ser por colaborador (1 janela semanal) + exceção por data, com precedência `Exceção > Hard > Soft`.
4. Rodízio de domingo vira política **soft de justiça** (default 2/1), com ciclo configurável por colaborador (1/1, 2/1, 3/1 etc), mantendo compliance legal mínima.
5. O sistema passa de grid de 30 min para **15 min** (solver + backend + validação + UI + export).
6. Compensação diária fica permitida até **9h45 (585 min)** quando necessário para viabilizar encaixe (especialmente 5x2).
7. Feriado deixa de bloquear geração por padrão; operação do dia especial passa a ser guiada por demanda por data (calendário).
8. Teste oficial deve usar DB real + motor real, não fixture paralela.
9. Exportação por funcionário deve mostrar almoço (`hora_almoco_inicio`/`hora_almoco_fim`) em HTML/PDF/CSV/JSON quando existir.
10. Devemos suportar escala cíclica (rotativa contínua), detectando o tamanho de ciclo da escala gerada e reaproveitando esse padrão.
11. No regime 5x2, deve existir cadastro de folga fixa por colaborador; se não estiver cadastrada, a geração continua com folga variável (fallback não bloqueante).
12. A definição formal para repetição é **periodicidade eventual**: após um transiente inicial, a escala entra em ciclo e repete indefinidamente.
13. O transiente inicial não é relevante para reaproveitamento, exceto quando já existir um ciclo ativo determinado no estado atual.
14. Cada posto deve ter cor visual consistente (UI + export), com paleta de 15 cores altamente distintas.

---

## 2) Estado atual confirmado no código (base de decisão)

### 2.1 Motor e bridge
1. `src/main/motor/solver-bridge.ts` já prioriza Python em dev (`resolveSolverPath`, linhas ~52-67).
2. `src/main/tipc.ts` (`escalas.gerar`) já chama `buildSolverInput -> runSolver` (linhas ~1075+).
3. O input do solver ainda assume `grid_minutos` default 30 (`src/main/motor/solver-bridge.ts`, linha ~255).

### 2.2 Hards atuais que conflitam com a nova direção
1. `H3` domingo está hard no solver: `add_h3_rodizio_domingo` em `solver/constraints.py` (linhas ~455+), aplicado em `solver/solver_ortools.py` (linha ~366).
2. Feriado proibido ainda bloqueia hard:
   - Preflight bloqueia `DEMANDA_EM_FERIADO_PROIBIDO` em `src/main/tipc.ts` (linhas ~123-130).
   - Solver cria `blocked_days` por feriado proibido (linhas ~311-315 em `solver/solver_ortools.py`) e aplica `H17/H18`.

### 2.3 Grid 30 min espalhado
1. `CLT.GRID_MINUTOS = 30` em `src/shared/constants.ts` (linha ~28).
2. `setores.salvarTimelineDia` valida horários em múltiplos de 30 em `src/main/tipc.ts` (linhas ~1549, ~1554, ~1579).
3. `TimelineGrid` usa `SLOT_SIZE = 30` em `src/renderer/src/componentes/TimelineGrid.tsx` (linha ~11).
4. `timeline-demanda` snap/min duration em 30 em `src/renderer/src/lib/timeline-demanda.ts` (linhas 1-2).
5. Validador hard H8 reforça 30 min em `src/main/motor/validacao-compartilhada.ts` (linhas ~593-621).

### 2.4 Regras atuais de colaborador
1. Hoje só existem preferências `prefere_turno` e `evitar_dia_semana` no cadastro (`ColaboradorDetalhe.tsx`), usadas como soft de validação, não como hard de solver.
2. Não existe modelo de regra de horário por colaborador com janela hard e exceção por data.
3. Não existe exceção de demanda por data (calendário) persistida em tabela própria.

### 2.5 Exportação por funcionário
1. O fluxo de exportação por funcionário está inconsistente e pode omitir horário de almoço no resumo.
2. O PRD passa a exigir paridade de informação entre export completo e export por funcionário.

---

## 3) Objetivo de negócio desta entrega

Permitir que RH configure regras reais de pessoas (horário, estudo, estágio, domingo, exceções de dia específico) sem quebrar cobertura operacional, com solver Python como núcleo único e previsível.

Sucesso = escala gerável na UI com:
1. Menos INFEASIBLE desnecessário.
2. Mais aderência às regras individuais.
3. Controle explícito de dias especiais por calendário.
4. Melhor granularidade para 5x2 e compensação (15 min).
5. Export por funcionário sem perda de dados de almoço.
6. Capacidade de transformar escala gerada em ciclo rotativo contínuo.
7. Leitura visual imediata por posto via codificação de cores consistente.

---

## 4) Escopo funcional

## 4.1 Regras de horário por colaborador
1. Regra semanal ativa (1 janela): `inicio_min`, `inicio_max`, `fim_min`, `fim_max`, `preferencia_turno_soft`.
2. Exceção por data com mesma estrutura, substituindo integralmente a regra semanal no dia.
3. Ordem de aplicação: `exceção_data > regra_colaborador > perfil_contrato > sem regra`.

## 4.2 Perfis de horário por contrato
1. CRUD de perfis por tipo de contrato (inclui estágio).
2. Colaborador seleciona perfil via dropdown e pode sobrescrever por regra individual.
3. Fixture inicial de estágio:
   - Manhã `08:00-12:00`
   - Tarde `inicio >= 13:30`
   - Estuda à noite `08:00-14:00`

## 4.3 Domingo justo por ciclo (soft)
1. Remover H3 como hard universal.
2. Introduzir política soft por colaborador com ciclo configurável:
   - default `2/1`
   - opções por pessoa: `1/1`, `2/1`, `3/1`, etc.
3. Regra deve ser tendência, não bloqueio absoluto.
4. Compliance legal continua garantida por hard mínimo (ex.: folga compensatória e demais hard legais vigentes aplicáveis).

## 4.4 Compensação diária até 9:45
1. Em cenários com aperto de encaixe, permitir dias de até `585 min` (9h45) dentro do contrato/regra.
2. Estratégia recomendada:
   - manter limite contratual padrão;
   - criar variável de compensação soft com teto 585;
   - penalizar compensação para usar só quando necessário.
3. Prioridade da função objetivo: déficit de demanda > violações hard > compensação > conforto.

## 4.5 Demanda por data (calendário)
1. Nova camada de exceção de demanda por data (`demandas_excecao_data`).
2. Precedência da demanda: `exceção_data > dia_semana`.
3. Na UI da demanda semanal, botão de calendário para editar dia específico.

## 4.6 Feriado orientado à demanda
1. Feriado continua cadastrado para relatório/contexto.
2. Remover bloqueio automático de geração por feriado no preflight.
3. Solver só não aloca se a demanda daquele dia pedir zero ou se outras regras bloquearem.

## 4.7 Grid de 15 min
1. Todo o fluxo temporal passa a múltiplos de 15 min.
2. Inclui solver, validação, timeline, editor de demanda, export e tooltips.

## 4.8 Exportação por funcionário com almoço
1. Toda célula `TRABALHO` no export por funcionário deve exibir almoço quando houver (`Almoço HH:MM - HH:MM`).
2. O campo de almoço deve aparecer tanto no resumo semanal quanto nas visões detalhadas/timeline do export.
3. CSV/JSON devem incluir colunas/campos explícitos de almoço (`hora_almoco_inicio`, `hora_almoco_fim`, `minutos_almoco`).

## 4.9 Periodicidade eventual (escala fixa rotativa contínua)
1. O sistema deve detectar **periodicidade eventual** da escala gerada:
   - transiente `T`: trecho inicial variável;
   - período `P`: menor ciclo que passa a se repetir indefinidamente.
2. A regra de negócio para reaproveitamento é baseada no ciclo (`P`), não no transiente (`T`).
3. Quando existir padrão cíclico viável, salvar como “modelo rotativo” para reaplicação futura.
4. Se não houver ciclo perfeito no estado atual, aplicar modo assistido de rotação:
   - manter tendência de o mesmo colaborador cobrir o domingo no ciclo seguinte;
   - recalcular o horário desse colaborador conforme carga/demanda real do domingo (não copiar hora fixa cegamente);
   - não forçar manhã, exceto para quem tiver regra hard de manhã.
5. Folga continua podendo ser variável quando necessário para cobertura e horas.
6. Se já houver um ciclo ativo determinado no estado atual, preservar esse ciclo como prioridade de continuidade.

## 4.10 Folga fixa no 5x2
1. Colaborador em regime 5x2 pode ter um dia fixo de folga semanal cadastrado.
2. Se `folga_fixa_dia_semana` estiver preenchido, solver deve respeitar como hard semanal.
3. Se não estiver preenchido, não bloquear geração: solver define folga variável e o sistema entrega o resultado gerado.

## 4.11 Cores por posto (UI e export)
1. Cada posto (`funcao`) deve ter uma cor associada e estável.
2. A mesma cor deve aparecer na visualização geral, timeline, cards e exportações.
3. Paleta base com 15 cores altamente distintas:
   - `#E53935`
   - `#D81B60`
   - `#8E24AA`
   - `#5E35B1`
   - `#3949AB`
   - `#1E88E5`
   - `#00ACC1`
   - `#00897B`
   - `#43A047`
   - `#7CB342`
   - `#C0CA33`
   - `#FDD835`
   - `#FFB300`
   - `#FB8C00`
   - `#6D4C41`
4. Regra de fallback:
   - se `funcao.cor_hex` estiver definida, usar valor cadastrado;
   - se não estiver, atribuir por ordem (`ordem % 15`) para garantir previsibilidade.

---

## 5) Mudanças de dados (DB e tipos)

## 5.1 Novas tabelas
1. `contrato_perfis_horario`
   - `id, tipo_contrato_id, nome, ativo, inicio_min, inicio_max, fim_min, fim_max, preferencia_turno_soft, ordem`
2. `colaborador_regra_horario`
   - `id, colaborador_id UNIQUE, ativo, perfil_horario_id, inicio_min, inicio_max, fim_min, fim_max, preferencia_turno_soft, domingo_ciclo_trabalho, domingo_ciclo_folga, folga_fixa_dia_semana`
3. `colaborador_regra_horario_excecao_data`
   - `id, colaborador_id, data, ativo, inicio_min, inicio_max, fim_min, fim_max, preferencia_turno_soft, domingo_forcar_folga, UNIQUE(colaborador_id, data)`
4. `demandas_excecao_data`
   - `id, setor_id, data, hora_inicio, hora_fim, min_pessoas, override`
5. `escala_ciclo_modelos`
   - `id, setor_id, nome, semanas_no_ciclo, ativo, origem_escala_id, criado_em`
6. `escala_ciclo_itens`
   - `id, ciclo_modelo_id, semana_idx, colaborador_id, dia_semana, trabalha, ancora_domingo, prioridade`

## 5.2 Ajustes de colunas existentes
1. `empresa.grid_minutos` default migra para `15`.
2. Rever documentação de `TipoContrato.max_minutos_dia` para suportar compensação de 585 de forma explícita.
3. `funcoes.cor_hex` para persistir cor de cada posto.

## 5.3 Índices
1. `idx_demandas_excecao_setor_data`
2. `idx_colab_regra_excecao_colab_data`
3. `idx_contrato_perfis_contrato`
4. `idx_ciclo_modelo_setor_ativo`
5. `idx_ciclo_itens_modelo_semana`

## 5.4 Tipos TS (`src/shared/types.ts`)
Adicionar:
1. `PerfilHorarioContrato`
2. `RegraHorarioColaborador`
3. `RegraHorarioColaboradorExcecaoData`
4. `DemandaExcecaoData`
5. Campos de ciclo de domingo no modelo de regra de colaborador.
6. Campo `folga_fixa_dia_semana` para colaboradores em 5x2.
7. `ModeloCicloEscala` e `ModeloCicloEscalaItem`.
8. `SolverInput` com `regras_colaborador_dia`, `demanda_excecao_data` e metadados de rotação/ciclo.
9. `Funcao` com campo `cor_hex`.

---

## 6) Backend/API (main process)

## 6.1 Novas rotas TIPC
1. `tiposContrato.listarPerfisHorario`
2. `tiposContrato.criarPerfilHorario`
3. `tiposContrato.atualizarPerfilHorario`
4. `tiposContrato.deletarPerfilHorario`
5. `colaboradores.buscarRegraHorario`
6. `colaboradores.salvarRegraHorario`
7. `colaboradores.listarRegrasExcecaoData`
8. `colaboradores.upsertRegraExcecaoData`
9. `colaboradores.deletarRegraExcecaoData`
10. `setores.listarDemandasExcecaoData`
11. `setores.salvarDemandaExcecaoData`
12. `setores.deletarDemandaExcecaoData`
13. `escalas.detectarCicloRotativo`
14. `escalas.salvarCicloRotativo`
15. `escalas.listarCiclosRotativos`
16. `escalas.gerarPorCicloRotativo`

## 6.2 Rotas existentes a alterar
1. `setores.salvarTimelineDia` (`src/main/tipc.ts`) para validar em 15 min (hoje hard 30 nas linhas ~1549/~1554/~1579).
2. `escalas.preflight` para remover blocker de feriado proibido automático.
3. `buildEscalaPreflight` para considerar demanda final do dia (incluindo exceção de data).
4. Pipeline de export por funcionário para sempre incluir almoço quando houver.
5. Pipeline de export para refletir cores de posto de forma consistente com a UI.

## 6.3 Serviços renderer
Atualizar:
1. `src/renderer/src/servicos/tipos-contrato.ts`
2. `src/renderer/src/servicos/colaboradores.ts`
3. `src/renderer/src/servicos/setores.ts`

---

## 7) Solver Python (núcleo)

## 7.1 Input
1. Ler `regras_colaborador_dia` (já resolvidas por data no bridge).
2. Ler `demanda_excecao_data`.

## 7.2 Demanda por slot
1. Alterar parser de demanda para aplicar precedência por data.
2. Se houver exceção na data, ignorar demanda semanal daquele dia.

## 7.3 Regras hard/soft novas
1. `add_colaborador_time_window_hard`
   - aplica janela de início/fim quando `works_day=1`.
2. `add_colaborador_soft_preferences`
   - preferência manhã/tarde.
3. `add_consistencia_horario_soft`
   - penaliza variação excessiva de início/fim entre dias próximos.

## 7.4 Domingo
1. Remover `add_h3_rodizio_domingo` do pipeline hard.
2. Criar `add_domingo_ciclo_soft` por colaborador usando `domingo_ciclo_trabalho/domingo_ciclo_folga`.
3. Peso soft abaixo de déficit/override, acima de conforto cosmético.

## 7.5 Compensação 9:45
1. Introduzir variável de excesso diário controlado por colaborador/dia.
2. Hard cap absoluto em `585` quando compensação habilitada.
3. Penalidade crescente no objetivo para evitar abuso.

## 7.6 Feriado
1. Desligar bloqueio automático de feriado no `blocked_days` geral.
2. Manter regras específicas legais (aprendiz etc.) quando aplicável.

## 7.7 Grid 15
1. `grid_min` passa a 15 em todas as conversões `time_to_slot/slot_to_time`.
2. Revisar limites derivados (`threshold_slots`, lunch windows, AP1 etc.) para manter semântica em minutos.

## 7.8 Rotação contínua e âncora dominical
1. Adicionar etapa de detecção de periodicidade eventual após geração:
   - identificar transiente `T`;
   - identificar menor período `P` aceitável.
2. Se ciclo salvo estiver ativo, usar esse ciclo como guia na geração do período.
3. No domingo, priorizar manutenção de colaborador-âncora do ciclo, com horário recalculado por demanda do dia.
4. Colaboradores com regra hard de manhã continuam obrigatoriamente na manhã nos dias aplicáveis.
5. Transiente não entra no template rotativo, salvo quando fizer parte de ciclo já validado como ativo.

## 7.9 Folga fixa 5x2
1. Para colaborador 5x2 com `folga_fixa_dia_semana`, forçar `works_day=0` nesse dia da semana (hard).
2. Para 5x2 sem folga fixa cadastrada, manter folga variável (sem blocker).

---

## 8) Bridge + validação

## 8.1 `src/main/motor/solver-bridge.ts`
1. Resolver regra efetiva por colaborador/dia com precedência completa.
2. Incluir demandas exceção por data no payload.
3. Atualizar `computeSolverScenarioHash` para incluir novas regras/ciclos/exceções.
4. Incluir `folga_fixa_dia_semana` e metadados de ciclo no hash do cenário.

## 8.2 `src/main/motor/validacao-compartilhada.ts`
1. H8 passa de 30 para 15 min.
2. H3 deixa de gerar violação hard e vira indicador/soft de justiça por ciclo.
3. `SlotGrid` e comparações de cobertura devem deixar de assumir “+30min” (linha ~61).
4. Adicionar checker hard para regra de janela por colaborador em pós-ajuste manual.
5. Adicionar checker de folga fixa 5x2 quando configurada.

## 8.3 `src/main/motor/validador.ts`
1. Carregar novas entidades de regra e exceção por data.
2. Incluir novos indicadores soft (`domingo_ciclo`, `consistencia_horario`, `preferencia_turno`).
3. Incluir indicador de aderência ao ciclo rotativo.
4. Incluir indicador de período detectado (`P`) e tamanho de transiente (`T`) para auditoria.

---

## 9) UI/UX

## 9.1 Contrato (`src/renderer/src/paginas/ContratoLista.tsx`)
1. Adicionar aba/seção “Perfis de Horário”.
2. CRUD simples (nome, janela, preferência).
3. Exibir se perfil é de estágio ou geral.

## 9.2 Colaborador (`src/renderer/src/paginas/ColaboradorDetalhe.tsx`)
1. Dropdown de perfil horário.
2. Editor da regra hard individual (1 janela).
3. Campo de ciclo de domingo (default 2/1).
4. Seção de exceções por data de horário.
5. Campo `folga_fixa_dia_semana` (visível quando regime do contrato for 5x2).

## 9.3 Demanda (`src/renderer/src/componentes/DemandaEditor.tsx`)
1. Botão calendário por aba da semana para editar demanda de data específica.
2. Grid/snap passa para 15 min (`timeline-demanda.ts` + editor).

## 9.4 Timeline/escala gerada
1. `TimelineGrid.tsx` trocar `SLOT_SIZE = 30` para 15 e ajustar labels.
2. Manter/garantir tooltip com almoço e fluxo (não regredir).

## 9.5 Export (`src/renderer/src/componentes/ExportarEscala.tsx`)
1. Corrigir export por funcionário para exibir almoço em todos os formatos visuais.
2. Garantir paridade de campos entre export completo e export por funcionário.

## 9.6 Gestão de ciclo rotativo
1. Incluir ação na tela de escala para “detectar ciclo” da escala gerada.
2. Permitir salvar ciclo e reutilizar como base em gerações futuras.

## 9.7 Cores de posto
1. Em `src/renderer/src/componentes/EscalaGrid.tsx` e `src/renderer/src/componentes/TimelineGrid.tsx`, usar cor do posto em badges/barras/cards.
2. Em `src/renderer/src/componentes/ExportarEscala.tsx`, manter a mesma codificação de cores da UI.
3. Exibir legenda com posto -> cor no export para facilitar leitura humana.

---

## 10) Migração técnica (ordem recomendada)

Fase 1 — Dados e contratos de API
1. Criar migrações DB + tipos shared.
2. Expor endpoints TIPC novos.
3. Migrar/atribuir `cor_hex` inicial para funções existentes usando a paleta base.

Fase 2 — Solver e bridge
1. Bridge resolve regras/demandas por data.
2. Solver consome novos campos, ativa hard/soft novos.
3. Migrar grid para 15 min no solver.
4. Implementar detecção/aplicação de ciclo rotativo e folga fixa 5x2.

Fase 3 — Validação e preflight
1. Remover blocker de feriado.
2. Atualizar H8 e checkers de regra individual.

Fase 4 — UI
1. Contrato: perfis horário.
2. Colaborador: regra + ciclo domingo + exceções por data + folga fixa 5x2.
3. Demanda: calendário por data.
4. Timeline/visual: 15 min.
5. Export por funcionário com almoço.
6. Gestão de ciclo rotativo.
7. Cores de posto em toda a visualização e export.

Fase 5 — Rollout
1. Script de migração para normalizar horários existentes em 15 min.
2. Regenerar escala de referência em ambiente de teste DB real.

---

## 11) Critérios de aceite

1. Cleunice com regra fixa 08:00 inicia 08:00 em todos os dias trabalhados.
2. Gabriel com `fim_max=16:00` nunca passa de 16:00 e tende a manhã.
3. Estagiário manhã respeita 08:00-12:00.
4. Estagiário tarde nunca inicia antes de 13:30.
5. Domingo:
   - sem bloqueio hard indevido por sequência;
   - ciclo configurado influencia distribuição (soft observável).
6. Compensação:
   - em cenário apertado, solver usa até 9:45;
   - sem estourar cap definido.
7. Feriado com demanda de calendário gera normalmente (sem preflight blocker automático).
8. Demanda por data sobrepõe padrão semanal no dia específico.
9. Ajuste manual que viola regra hard de janela individual aparece como violação hard.
10. UI e export continuam funcionando com 15 min.
11. Export por funcionário mostra almoço sempre que a alocação tiver almoço.
12. 5x2 com folga fixa cadastrada respeita folga fixa em todas as semanas.
13. 5x2 sem folga fixa cadastrada gera normalmente com folga variável.
14. Escala gerada permite detectar e salvar ciclo rotativo quando houver repetição.
15. No modo assistido, domingo mantém tendência de colaborador-âncora sem travar horário fixo de manhã para quem não é hard manhã.
16. Detectado ciclo, o sistema informa `T` (transiente) e `P` (período) de forma auditável.
17. Visualização geral e export mostram cores de posto consistentes.

---

## 12) Testes obrigatórios

1. `npm run typecheck:web`
2. `npm run typecheck:node`
3. `npm run build`
4. `npm run solver:test:db` (DB real)
5. Cenários manuais de geração na UI (`escalas.gerar`) em setor com:
   - domingo no período,
   - feriado no período,
   - estagiário,
   - regra individual hard,
   - exceção de demanda por data,
   - colaborador 5x2 com folga fixa,
   - colaborador 5x2 sem folga fixa.
6. Teste manual de export por funcionário validando almoço no HTML e PDF.
7. Teste de detecção de ciclo em escala de múltiplas semanas e reaplicação do ciclo salvo.
8. Teste de periodicidade eventual:
   - cenário com transiente + ciclo;
   - validar que apenas ciclo é reaproveitado.
9. Teste visual de paleta:
   - 15 postos distintos com 15 cores diferentes;
   - consistência de cor entre UI e export.

---

## 13) Fora de escopo

1. Voltar motor TS legado.
2. Reintroduzir fluxo `horario/teste` para decisão operacional.
3. Pré-fixação manual de pessoas para dia especial no solver (continua no ajuste pós-geração).

---

## 14) Riscos e mitigação

1. Risco: migração 30→15 aumentar espaço de busca e tempo de solve.
   - Mitigação: manter `solve_mode=rapido` com `relative_gap_limit`, warm-start hints e pesos calibrados.
2. Risco: quebrar consistência de validações/exports por suposição 30 min.
   - Mitigação: checklist de varredura global por “30min” e testes visuais em UI/export.
3. Risco: conflito entre compensação 9:45 e limites contratuais atuais.
   - Mitigação: definir contrato/política explícita por tipo de vínculo antes do rollout.

---

## 15) Decisões abertas (para travar antes da implementação final)

1. Compensação 9:45 vale para quais tipos de contrato (CLT 44h somente, ou configurável por contrato)?
2. Campo de ciclo domingo fica no colaborador ou também no contrato como default herdável?
3. Exceção de domingo por data terá apenas “forçar folga” ou também “forçar trabalho”?
4. Política legal final para H17/H18: totalmente informativo ou manter bloqueio em datas absolutas (25/12, 01/01) apenas?
5. Detecção de ciclo deve buscar até quantas semanas no histórico/escala de origem (ex.: 4, 8, 12)?
6. No 5x2, folga fixa será obrigatória no cadastro ou apenas fortemente recomendada com fallback automático?
7. A paleta de 15 cores será fixa de produto ou o RH poderá customizar manualmente por posto?
