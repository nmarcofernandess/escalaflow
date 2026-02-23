# PROMPT: Deep Dive do Sistema EscalaFlow para Evolucao da IA

> **Como usar:** Copie TUDO abaixo (a partir de `---START---`) e cole como primeira mensagem num chat limpo.
> O outro chat vai ler o codebase iterativamente e produzir o documento canonico do sistema.
> No final, o doc vai viver em `docs/flowai/COMO_O_SISTEMA_FUNCIONA.md`.

---START---

# MISSAO: Mapeamento Completo do EscalaFlow para Evolucao da IA

## Contexto

Voce vai fazer um deep dive no EscalaFlow — um app desktop Electron offline para geracao automatica de escalas de trabalho em supermercados. O objetivo final e entender o sistema inteiro para:

1. Reescrever o system prompt da IA com conhecimento real (nao superficial)
2. Saber exatamente quais tool calls a IA precisa ter para fazer TUDO que o sistema permite
3. Entender os fluxos de ponta a ponta para que a IA possa guiar o usuario sem pedir informacoes desnecessarias
4. Documentar o "por que" de cada decisao de design, nao so o "o que"

## O que voce vai produzir

Um unico arquivo: `docs/flowai/COMO_O_SISTEMA_FUNCIONA.md`

Esse doc precisa responder, para cada area do sistema:
- **O que e** (conceito)
- **Como funciona** (fluxo tecnico com trechos de codigo relevantes)
- **Por que e assim** (decisao de design, limitacao, trade-off)
- **O que a IA precisa saber** (para operar essa area via tools)
- **O que a IA precisa poder fazer** (tools que faltam ou precisam melhorar)

## Metodo de trabalho

Trabalhe em FASES. Cada fase cobre uma area do sistema. Para cada fase:

1. Leia os arquivos indicados
2. Entenda o fluxo
3. Escreva a secao correspondente no doc
4. Me mostre o que entendeu (resumo curto) antes de prosseguir

NAO tente ler tudo de uma vez. Faca fase por fase, iterativamente.

## FASE 1 — Fundacao (Schema, Tipos, Constantes)

**Objetivo:** Entender as entidades, como se relacionam, e quais sao as regras fundamentais do dominio.

**Arquivos para ler:**

```
src/main/db/schema.ts          # DDL completo — todas as tabelas, campos, constraints
src/main/db/seed.ts             # Dados iniciais — 4 contratos CLT, setores, colaboradores
src/shared/types.ts             # Interfaces TypeScript — o "contrato" de dados
src/shared/constants.ts         # Constantes CLT, grid, paleta, contratos seed
```

**O que documentar:**

- Lista de TODAS as entidades com seus campos criticos (ignorar created_at/updated_at)
- Relacionamentos (quem referencia quem)
- Ciclo de vida de cada entidade (ex: Escala: RASCUNHO → OFICIAL → ARQUIVADA)
- Contratos CLT disponiveis e suas restricoes (horas, tipo, regras especiais)
- O grid de 15 minutos — o que e, por que existe, como afeta tudo
- Soft delete (ativo=1/0) — como funciona
- Entidades que a IA vai precisar manipular vs as que sao read-only

**Pergunta-guia:** "Se eu fosse a IA e precisasse criar/editar/consultar qualquer coisa nesse sistema, quais sao as regras que eu NUNCA posso violar?"

## FASE 2 — Motor Python (OR-Tools CP-SAT)

**Objetivo:** Entender como escalas sao geradas, quais restricoes existem, e o que o solver retorna.

**Arquivos para ler:**

```
docs/MOTOR_V3_RFC.md                        # RFC canonico — 20 HARD, SOFT, explicabilidade
solver/solver_ortools.py                     # O solver real — entrada JSON, saida JSON
solver/constraints.py                        # Todas as constraints (HARD + SOFT)
src/main/motor/solver-bridge.ts              # Bridge TS → Python — buildSolverInput, runSolver
src/main/motor/validador.ts                  # PolicyEngine — revalida apos ajuste manual
```

**O que documentar:**

- Fluxo completo: como uma escala e gerada do inicio ao fim
  - Quem monta o input (buildSolverInput)
  - O que o input contem (colaboradores, demandas, excecoes, regras, feriados)
  - Como o Python processa (CP-SAT model, variables, constraints)
  - O que o output contem (alocacoes, violacoes, indicadores, diagnostico)
  - Como o resultado e persistido (persistirSolverResult)
- Lista de TODAS as constraints com:
  - Codigo (H1, H2, ... H18, S_DEFICIT, S_DOMINGO, etc)
  - O que faz em linguagem humana
  - Se e HARD (bloqueia) ou SOFT (penaliza)
  - Se e configuravel (pode virar OFF/SOFT/HARD)
- O sistema de regras configuraveis:
  - regra_definicao (catalogo fixo) vs regra_empresa (override do usuario)
  - Como o solver le as regras (rule_is() helper no Python)
  - Quais regras sao fixas (CLT, nao desliga) vs configuraveis
- O validador TS (PolicyEngine):
  - Quando roda (apos ajuste manual de alocacao)
  - O que valida (subset das constraints do Python)
  - Como reporta violacoes
- O preflight:
  - O que checa antes de gerar (setor ativo, colabs suficientes, demandas, etc)
  - Diferenca entre blockers e warnings

**Pergunta-guia:** "Se a IA precisa gerar uma escala, ajustar uma alocacao, ou explicar por que algo deu errado, o que ela precisa saber sobre o motor?"

## FASE 3 — Sistema de Regras (Configuraveis + Por Colaborador)

**Objetivo:** Entender o sistema granular de regras — desde as regras globais da empresa ate as regras individuais por colaborador.

**Arquivos para ler:**

```
src/main/db/schema.ts           # Tabelas: regra_definicao, regra_empresa, regras_colaborador,
                                 #          perfis_horario, excecao_data, ciclo_modelo, ciclo_modelo_itens
src/shared/types.ts             # RuleStatus, RuleDefinition, RuleConfig, RegrasColaborador, etc
src/main/tipc.ts                # Handlers: regras.listar/atualizar/resetarEmpresa,
                                 #           regrasColab.*, perfisHorario.*, cicloRotativo.*
```

**O que documentar:**

- Hierarquia de precedencia: excecao_data > regra_colab > perfil_contrato > sem regra
- Regras da empresa (35 catalogadas):
  - 16 CLT (fixas ou configuraveis)
  - 7 SOFT (preferencias)
  - 12 ANTIPATTERN (boas praticas)
  - Quais sao editaveis vs locked
- Regras por colaborador:
  - Janela de horario (hora_inicio_min/max, hora_fim_min/max)
  - Ciclo de domingo (trabalho/folga)
  - Folga fixa (dia da semana)
  - Excecoes por data (ferias, atestado, bloqueio)
- Perfis de horario por contrato
- Ciclo rotativo: o que e, como funciona, como se aplica na geracao

**Pergunta-guia:** "Se o usuario disser 'a Cleunice so pode entrar entre 8h e 9h' ou 'desliga a regra de interjornada', como o sistema processa isso e quais entidades sao afetadas?"

## FASE 4 — IPC (tipc.ts — Os 80+ Handlers)

**Objetivo:** Mapear TUDO que o sistema pode fazer. O tipc.ts e a API interna — cada handler e uma operacao que a IA potencialmente precisa acessar.

**Arquivos para ler:**

```
src/main/tipc.ts                # TODOS os handlers IPC (~80)
src/renderer/src/servicos/      # Wrappers do lado do renderer (como o frontend chama)
```

**O que documentar:**

Agrupe por dominio e para cada handler documente:
- Nome da rota
- Input esperado
- Output retornado
- Efeito colateral (se write)
- Se a IA ja tem acesso (via tool existente) ou nao

**Dominios esperados:**
- Empresa (config, horarios)
- Setores (CRUD, horarios do setor)
- Colaboradores (CRUD, detalhes)
- Contratos / Perfis de horario
- Demandas (cobertura por faixa/dia)
- Excecoes (ferias, atestado, bloqueio)
- Funcoes/Postos (CRUD com cor)
- Feriados
- Escalas (gerar, ajustar, oficializar, exportar)
- Alocacoes (timeline dia a dia)
- Regras (empresa, colaborador, ciclo rotativo)
- IA (conversas, mensagens, chat)

**Pergunta-guia:** "Quais operacoes o sistema suporta que a IA NAO consegue fazer hoje? Isso e o gap de tools."

## FASE 5 — Sistema IA Atual (Cliente, Tools, Prompt, Discovery)

**Objetivo:** Entender como a IA funciona HOJE — o loop, as tools, o prompt, o discovery, o historico, os hacks.

**Arquivos para ler:**

```
src/main/ia/cliente.ts           # O coracao — iaEnviarMensagem, generateText, loop, fallbacks
src/main/ia/tools.ts             # Todas as 13 tools com schemas Zod e executeTool()
src/main/ia/system-prompt.ts     # SYSTEM_PROMPT completo (390+ linhas)
src/main/ia/discovery.ts         # buildContextBriefing — injeta dados frescos no prompt
```

**O que documentar:**

- Fluxo completo de uma mensagem:
  1. Renderer envia via IPC
  2. cliente.ts monta prompt + historico + tools
  3. generateText roda com loop multi-step
  4. Tools executam (como? dispatch por nome)
  5. Resultado extraido dos steps
  6. Fallback de resposta forcada (quando? por que?)
  7. Retorno pro renderer
- Para CADA uma das 13 tools:
  - Nome, categoria, tipo (read/write)
  - Schema Zod EXATO (campos, tipos, validacoes)
  - O que o execute() faz (com trechos de codigo)
  - O que retorna (shape exata)
  - Problemas conhecidos (array cru, sem .describe, etc)
- O system prompt:
  - Estrutura (secoes, tamanho)
  - O que ensina (dominio, regras, workflow, exemplos)
  - O que contradiz (discovery duplicado, instrucoes conflitantes)
  - O que falta (few-shots de resolucao de problemas reais)
- O discovery:
  - O que buildContextBriefing injeta (quais dados, formato)
  - Quando roda (a cada request)
  - Conflito com get_context obrigatorio
- O historico:
  - Como e montado (buildChatMessages)
  - O que e filtrado (tool_results removidos)
  - Impacto na continuidade

**Pergunta-guia:** "Se eu fosse reescrever o system prompt e as tools do zero com conhecimento perfeito do sistema, o que mudaria?"

## FASE 6 — Frontend e Jornadas do Usuario

**Objetivo:** Entender como o USUARIO interage com o sistema — quais telas existem, quais acoes ele faz, e onde a IA poderia ajudar.

**Arquivos para ler:**

```
src/renderer/src/paginas/              # Todas as 11+ paginas
src/renderer/src/App.tsx               # Router — mapa de rotas
src/renderer/src/componentes/          # Componentes de IA (IaChatPanel, IaChatView, etc)
src/renderer/src/estado/               # Zustand stores
```

**O que documentar:**

- Mapa de paginas (rota → o que faz)
- Para cada pagina principal:
  - O que o usuario ve
  - Quais acoes pode fazer
  - Quais IPC handlers sao chamados
  - Onde a IA poderia automatizar/ajudar
- Jornadas criticas:
  1. "Quero gerar a escala do mes" (passo a passo do usuario)
  2. "Preciso ajustar a escala de alguem" (manual)
  3. "Preciso cadastrar um funcionario novo"
  4. "Funcionario entrou de ferias"
  5. "Quero oficializar a escala"
  6. "Quero entender por que deu erro"
- O painel de IA:
  - Como funciona o chat
  - Como tool calls aparecem na UI
  - O que e persistido vs o que e so da sessao

**Pergunta-guia:** "Quais sao as 10 coisas mais comuns que um gestor de RH de supermercado faz nesse app, e como a IA deveria resolver cada uma sem que ele precise clicar?"

## FASE 7 — Consolidacao e Gap Analysis

**Objetivo:** Cruzar tudo e produzir a analise final.

**O que documentar:**

### 7.1 — Mapa completo de capacidades

| Operacao | Via UI? | Via IA? | Tool existe? | Gap |
|----------|---------|---------|-------------|-----|
| Gerar escala | Sim | Sim | gerar_escala | - |
| Cadastrar colaborador | Sim | Parcial | criar (generico) | Precisa de tool semantica |
| ... | ... | ... | ... | ... |

### 7.2 — Tools que precisam ser criadas

Para cada tool nova:
- Nome sugerido
- Categoria (discovery / validacao / acao)
- Schema de input
- O que retorna
- Por que a IA precisa disso (caso de uso real)

### 7.3 — Melhorias nas tools existentes

Para cada tool atual:
- O que mudar no schema (adicionar .describe)
- O que mudar no retorno (status, _meta, humanizar FKs)
- O que mudar na description

### 7.4 — System prompt: o que precisa mudar

- O que remover (redundancias, instrucoes conflitantes)
- O que adicionar (few-shots reais, conhecimento tacito)
- O que reformular (discovery harmonizado)

### 7.5 — Decisoes de design documentadas

Para cada decisao nao-obvia:
- O que foi decidido
- Por que (limitacao tecnica, trade-off, premissa)
- Se ainda faz sentido ou pode mudar

## Regras do trabalho

1. **Leia o codigo REAL, nao assuma.** Se eu descrevo algo generico, va confirmar no arquivo.
2. **Cite trechos de codigo** quando relevante (arquivo:linha). Nao parafraseie — mostre.
3. **Pergunte se nao entender** algo. Melhor perguntar que inventar.
4. **Documente decisoes de design** — o "por que" e mais importante que o "o que".
5. **Pense como a IA** — para cada area, pergunte "o que a IA precisaria saber para operar aqui sem ajuda humana?"
6. **Nao proponha solucoes ainda** — so mapeie. A solucao vem depois.
7. **Escreva em portugues BR** — o doc e para consumo interno.

## Estrutura do doc final

```markdown
# Como o EscalaFlow Funciona — Doc Canonico para Evolucao da IA

## 1. Visao Geral
## 2. Entidades e Dados (Fase 1)
## 3. Motor de Escalas (Fase 2)
## 4. Sistema de Regras (Fase 3)
## 5. API Interna — IPC Handlers (Fase 4)
## 6. Sistema IA Atual (Fase 5)
## 7. Frontend e Jornadas (Fase 6)
## 8. Gap Analysis e Recomendacoes (Fase 7)
## Apendice A: Mapa completo de IPC handlers
## Apendice B: Catalogo de regras (35)
## Apendice C: Inventario de tools IA
```

## Docs de referencia existentes (leia se precisar de contexto adicional)

```
docs/MOTOR_V3_RFC.md                                    # RFC canonico do motor
docs/MOTOR_V3_SPEC.md                                   # Detalhes de regras e modelo de dados
docs/MOTOR_V3_ANTIPATTERNS.md                            # 17 antipatterns com exemplos
docs/MOTOR_V3_CALENDARIO_CICLO_SOLICITACOES.md           # Calendario operacional
docs/RESEARCH_CLT_CCT_MOTOR_V3.md                        # Pesquisa CLT/CCT
docs/BUILD_V2_ESCALAFLOW.md                              # Arquitetura v2
docs/COMO_FAZER_RELEASE.md                               # Release e auto-update
docs/SPEC-05-capacidades-ia.md                           # Spec das capacidades IA
docs/flowai/SISTEMA_TOOL_CALLING_ATUAL_E_GUIA_IA.md     # Diagnostico feito por outra sessao
docs/flowai/PLANO_EVOLUCAO_TOOL_CALLING_E_TESTES.md     # Plano de evolucao (referencia)
.claude/CLAUDE.md                                        # Instrucoes do projeto (convencoes, stack, layout)
```

## Comece pela Fase 1

Leia os 4 arquivos da Fase 1 e me mostre o que entendeu. Depois eu confirmo e voce escreve a secao.

---END---
