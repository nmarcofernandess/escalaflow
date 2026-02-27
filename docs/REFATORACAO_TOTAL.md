# REFATORACAO TOTAL — EscalaFlow

## Objetivo deste documento

Este documento serve como **prompt de inicializacao** para um chat dedicado a mapear como o sistema funciona HOJE (dado do 0 ao 100%), identificar tudo que esta burro, inutil ou over-engineered, e planejar a refatoracao completa.

**Contexto:** O EscalaFlow foi construido iterativamente por multiplos chats de IA, cada um adicionando camadas de complexidade sem visao do todo. O resultado: um sistema que DEVERIA ser simples (gerar escalas de trabalho para um supermercado familiar) mas que PARECE um ERP enterprise com KPIs, configs triplicadas, avisos assustadores e UI poluida.

**Usuarios reais:** Os pais do Marco. RH de supermercado. Nao sao tecnicos. Se parecer planilha de NASA, FALHOU.

**Principio fundamental:** O sistema PROPOE, o RH aceita ou ajusta. Menor input possivel. Gerar escala tem que ser tao simples quanto apertar um botao.

---

## FASE 1: Mapeamento do Fluxo Real

**Missao:** Ler arquivo por arquivo, iterativamente, e documentar como cada dado flui do 0 ao 100%. Comecar pelo entry point (usuario abre o app) ate a escala estar gerada, oficializada e exportada. Pequenas explicacoes em cada parte. Ir ajustando conforme ler mais arquivos.

### Arquivos para mapear (ordem sugerida):

1. `src/renderer/src/App.tsx` — Entry point do frontend, rotas, layout
2. `src/renderer/src/paginas/SetorDetalhe.tsx` — Pagina do setor (onde tudo comeca)
3. `src/renderer/src/paginas/EscalaPagina.tsx` — Pagina de escala (geracao, visualizacao, oficializacao)
4. `src/renderer/src/servicos/escalas.ts` — Servico IPC do frontend
5. `src/main/tipc.ts` — Handlers IPC (backend) — GIGANTE, mapear so os de escala
6. `src/main/motor/solver-bridge.ts` — Bridge TS → Python
7. `solver/solver_ortools.py` — Motor Python
8. `solver/constraints.py` — Constraints do motor
9. `src/main/db/schema.ts` — Schema do banco
10. `src/main/db/seed.ts` — Dados iniciais
11. `src/shared/types.ts` — Tipos compartilhados
12. `src/shared/constants.ts` — Constantes (contratos, grid, etc)

### O que documentar em cada arquivo:

- **O que faz** (1 frase)
- **Dados que recebe** (de onde vem)
- **Dados que produz** (pra onde vai)
- **Complexidade desnecessaria identificada** (se houver)
- **Sugestao de simplificacao** (se obvio)

---

## FASE 2: Hall da Vergonha — UI/UX

Levantamento inicial do Marco. TODOS os itens. Nenhum pode ser esquecido.

### 1. DUPLICIDADE DE CONFIGURACAO (O PECADO CAPITAL)

O tipo de escala (5x2 ou 6x1) esta configurado em **TRES lugares diferentes**:
- No **colaborador** (cadastro individual)
- Nas **regras da empresa** (tela de regras)
- No **config do gerador** ("Cenario de Regimes - simulacao")

**Realidade:** Isso e configuracao do SETOR, ponto. Se um tipo de contrato nao se relaciona com isso (ex: Intermitente), ele nem deveria ver essa opcao. Hoje ta no "Cenario de Regimes (simulacao)" com um modal cheio de dropdowns por funcionario — over-engineering puro.

### 2. CONTRATOS BURROS

Hoje em contratos tem "CLT 44h" e ai pergunta: "quantas horas trabalha?" — PORRA, 44! O nome ja diz!

**Como deveria ser:**
- Sistema ja vem com contratos pre-cadastrados (CLT 44h, CLT 36h, Estagiario 20h, Intermitente)
- Selecao por autocomplete
- Horario na frente, NAO editavel
- So fica editavel se o usuario digitar um contrato custom que nao existe no autocomplete
- Sem campo redundante de horas quando o nome ja contem a informacao

### 3. CHIPS DE REGRAS E AVISOS ASSUSTADORES

Tela cheia de chips de regras e avisos que:
- NAO sao clicaveis
- NAO levam a lugar nenhum
- So servem pra dar cagaco na pessoa
- Sao uteis pro motor e pra IA, mas NAO pro usuario leigo

**Como deveria ser:** Essas informacoes vao pra uma aba "Resumo" dedicada. O usuario so ve se quiser. Na tela principal, ZERO ruido.

### 4. AVISOS EM EXCESSO SEM LUGAR DEDICADO

Avisos aparecem espalhados por todo canto sem contexto. Nao tem um lugar onde a pessoa clica e ve "aqui estao todos os avisos/problemas da sua escala".

**Como deveria ser:** Tab "Resumo" na pagina de escala (igual ja existe o conceito de tabs). Todos os avisos, violacoes, metricas e detalhes ficam LA. A view principal e LIMPA.

### 5. KPIs COMPLEXAS PARA LEIGOS

Score, Cobertura %, Infracoes CLT, Antipadroes, Equidade % — tudo isso com cards coloridos e numeros que os pais do Marco nao entendem.

**Como deveria ser:** Se necessario, vai pro Resumo. Na view principal: "Escala gerada com sucesso" ou "Escala gerada com X problemas (ver resumo)". Simples.

### 6. EXCECOES DE DEMANDA POR DATA (INUTIL)

Card inteiro dedicado a "Excecoes de Demanda por Data" no SetorDetalhe. Complexidade que ninguem usa.

**Decisao:** Remover ou esconder. Se precisar no futuro, a IA configura via chat.

### 7. MOTOR PODE SER MAIS SIMPLES

O motor e a parte que FUNCIONA. Mas a interface em volta dele e um pesadelo:
- Inputs de data inicio/fim com date pickers manuais
- Dropdown de cenario por funcionario
- Drawer de configuracao avancada (solve mode, max time, rules override)
- Preflight com modal de warnings
- Logs do solver em tempo real

**Como deveria ser:**
- Default: gerar para **3 meses a frente**, comecando no proximo ciclo
- Dropdown simples: "3 meses (padrao)", "6 meses", "1 ano", "Personalizado"
- So mostra date pickers se escolher "Personalizado"
- Sem cenario por funcionario (e config do setor)
- Sem drawer de config avancada (defaults inteligentes, IA ajusta se precisar)
- Preflight roda silencioso, so mostra se BLOQUEAR
- Logs do solver: hidden por default, clica pra expandir se quiser

### 8. ESCALA DEVERIA ESTAR NA PRIMEIRA PAGINA DO SETOR

Hoje: Setor > clica "Abrir Escala" > vai pra outra pagina > configura > gera.

**Como deveria ser:** O botao "Gerar Escala" ta ALI no SetorDetalhe. Clicou, gerou. O resultado aparece inline ou navega pra visualizacao completa.

### 9. PREVIEW COMPLETO vs RESUMO

Hoje o preview mostra o calendario inteiro com todos os dias, setinhas pra navegar, etc. E um GRID interativo onde voce clica pra mudar status. Isso e bom pra editar, mas PESSIMO como primeira visualizacao.

**Como deveria ser:**
- Ao gerar: mostra um **resumo compacto** (funcionou? quantos problemas? ciclo de cada funcionario)
- Clicou "Ver resultado completo": ai sim mostra a escala inteira, igual na exportacao, de forma COMPLETA e DECENTE
- Sem complexidade de ficar passando mouse clicando setinha pra ir pra outros dias
- Joga o bagulho na integra

### 10. EXPORTAR JUNTO DO RESULTADO COMPLETO

Hoje o exportar e um botao separado que abre um modal com opcoes confusas.

**Como deveria ser:** Dentro da view de resultado completo, botao "Exportar" direto. Sem modal intermediario cheio de opcoes.

### 11. EXPORTACAO — OPCOES QUE NAO DEVERIAM EXISTIR

Opcoes atuais que sao poluicao:
- "Incluir avisos" — NAO. Avisos ficam no sistema, no Resumo. Se quiser exportar, exporta DO resumo.
- "Incluir horas (Real vs Meta)" — NAO. Poluicao.
- "Incluir mensagens de erro" — NAO. So no sistema.

**O que deveria ter como toggle:**
- "Incluir calendario visual" — porque o DEFAULT e a escala de ciclo dos funcionarios
- So isso. Simples.

### 12. VISUALIZACAO E EXPORTACAO — POSTOS COMO COLUNA

Hoje cada quadradinho do grid tem o posto escrito junto, poluindo tudo.

**Como deveria ser:**
- Postos como COLUNA
- Nome do funcionario na frente (primeira coluna)
- Remove a poluicao de ter "Posto X" dentro de cada celula do grid
- Mesma logica na exportacao

### 13. PLANEJADO x EXECUTADO (CARD LIXO)

O card "Planejado x Executado" ta incompreensivel. Ninguem entende o que significa.

**Como deveria ser:** Faz parte do Resumo, NAO da view principal da escala. E precisa ser redesenhado pra ser legivel por leigos.

### 14. REGRAS DA EMPRESA vs CONFIG DO MOTOR

Se o motor tem config na hora de gerar, pra que serve a tela de "Regras da Empresa"? Duplicidade pura.

**Como deveria ser:** Config e do SETOR. Regras sao do MOTOR (e a IA pode ajustar). O usuario NAO precisa ver/editar regras individualmente. Se precisar, a IA faz via chat.

### 15. CONFIGURAR ESCALA DEVERIA RESUMIR TUDO

Hoje as configs estao espalhadas:
- Cenario de regimes (modal separado)
- Drawer de solver config
- Date pickers
- Preflight

**Como deveria ser:** Um unico card/drawer "Configurar" que resume TUDO que pode ser ajustado antes de gerar. Simples, compacto, sem modais dentro de modais.

### 16. DISCOVERY DESIGN PESSIMO

O sistema aparenta ser complexo quando na verdade e simples:
1. Tem setores
2. Setores tem colaboradores
3. Gera escala pro setor
4. Oficializa
5. Exporta

Mas a UI faz parecer que voce precisa de um MBA pra operar. Campos demais, opcoes demais, informacoes demais na tela errada.

---

## FASE 3: Bugs Conhecidos

### BUG 1: Escala de Ciclo nao aparece

As badges F/V (folga fixa / folga variavel) NAO estao aparecendo no grid da escala. O fix foi tentado (adicionar `folga_variavel_dia_semana` na serializacao do solver-bridge.ts) mas o fluxo completo precisa ser validado:

- [ ] `solver-bridge.ts` envia `folga_variavel_dia_semana` ao Python? (fix aplicado, nao testado)
- [ ] `constraints.py` recebe e usa o valor? (`add_folga_variavel_condicional()`)
- [ ] O solver retorna decisoes com info de ciclo?
- [ ] O frontend le e renderiza as badges?
- [ ] O `ResumoFolgas` aparece corretamente?

**Prioridade:** CRITICA — sem isso, a feature principal do Ciclos V2 nao funciona.

### BUG 2: Simulacao some ao navegar

A escala gerada (RASCUNHO) fica so em React state. Navega pra outro lugar e volta = sumiu.

- Fix parcial aplicado (loadRascunho no mount, Tabs controlado, DELETE de rascunhos antigos)
- Precisa validar se funciona end-to-end

---

## FASE 4: Visao do Futuro (pos-refatoracao)

### Fluxo ideal do usuario:

1. **Abre o app** → Dashboard com setores
2. **Clica no setor** → Ve info basica + equipe + botao "Gerar Escala"
3. **Clica "Gerar Escala"** → Sistema gera automaticamente (3 meses, defaults inteligentes)
4. **Ve resumo rapido** → "Escala gerada! 0 problemas." ou "Escala gerada com 2 avisos (ver resumo)"
5. **Clica "Ver Escala"** → Escala completa, decente, igual exportacao
6. **Clica "Exportar"** → Salva/imprime direto
7. **Se quiser detalhes** → Tab "Resumo" com avisos, metricas, comparacao
8. **Se quiser ajustar** → Chat com IA ou edita inline no grid

**Total de cliques pra gerar e ver uma escala: 3** (setor → gerar → ver)
**Hoje: ~8-10 cliques** com configs, modais, warnings, tabs.

---

## Instrucoes para o Chat de Mapeamento

Voce vai receber este documento como contexto. Sua missao:

1. **Leia arquivo por arquivo** na ordem da Fase 1
2. **Documente o fluxo real** — como cada dado nasce, transforma e chega no destino
3. **Identifique complexidade desnecessaria** — codigo que existe mas nao deveria
4. **Valide os itens do Hall da Vergonha** — confirme ou refute cada ponto com evidencia do codigo
5. **Encontre mais problemas** — alem dos listados, identifique padroes que seguem a mesma logica de poluicao/over-engineering
6. **Documente bugs** — confirme os bugs listados e encontre outros
7. **Produza um .md final** com o mapa completo do sistema e um plano de refatoracao priorizado

**Regra:** Nao mexa em NADA. So leia, documente e analise. Zero edits. Puro diagnostico.
