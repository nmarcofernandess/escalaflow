# Plano de Evolucao do Tool Calling + Testes (EscalaFlow)

## Objetivo estrategico

Transformar o sistema de tool calling da IA do EscalaFlow em uma camada:

- atual (patterns AI SDK 6 / 2026)
- robusta (contratos consistentes)
- observavel (debug de steps e tool results)
- testavel (unit + integracao + eval + E2E)
- segura (guardrails para mutacoes criticas)

Este plano foi montado a partir do estado real do codigo em `2026-02-23`.

## TL;DR executivo (sequencia correta)

1. Instalar stack de testes/observabilidade minima.
2. Padronizar contrato de retorno das tools + `.describe()` nos schemas.
3. Harmonizar discovery/prompt/historico.
4. Criar camada de tools semanticas (sem matar as genericas).
5. Adicionar evals e gates de regressao.
6. Subir CI com checks obrigatorios.

Sem isso, cada ajuste de prompt/tool vira roleta.

## 1) Baseline atual (fatos, nao opiniao)

### O que ja existe

- Loop multi-turn com AI SDK v6 (`generateText` + `stopWhen: stepCountIs(10)`).
- `get_context`, `preflight`, `gerar_escala`, `cadastrar_lote`.
- Persistencia de historico IA no SQLite (`ia_conversas`, `ia_mensagens`).
- UI de tool calls funcional na sessao atual.
- Scripts ad hoc de smoke/teste (`test-conversa.ts`, `test-final.ts`, `test-get-context.ts`, `scripts/test-solver-real.ts`).

### O que nao existe (gap)

- `npm test` formal
- framework de testes padrao (Vitest/Jest/etc)
- runner de UI/componentes
- E2E Electron automatizado
- eval harness regressivo de tool calling
- observabilidade de steps (DevTools/traces)
- CI (`.github/workflows` ausente)

### Riscos atuais

| Risco | Impacto |
|---|---|
| Mudar schema/description e quebrar comportamento da IA | regressao silenciosa |
| Mudar UI de tool calls e perder args/output | quebra de debug/UX |
| Ajustar `consultar` e quebrar flows existentes | IA para de navegar |
| Mexer no `SYSTEM_PROMPT` e aumentar custo/loop | latencia/tokens |
| Alterar historico/persistencia e perder continuidade | respostas incoerentes |

## 2) Principios do plano (guardrails)

1. Evoluir em camadas, nao "refatorar tudo de uma vez".
2. Preservar ferramentas genericas como fallback durante a transicao.
3. Antes de adicionar novas tools, criar testes para as atuais.
4. Medir regressao por cenarios (eval) e nao so por unit tests.
5. Separar contrato para IA (model output) de payload completo do app quando necessario (`toModelOutput`).

## 3) Arquitetura alvo (resumo)

```text
Prompt enxuto + few-shots de dominio
  + Discovery harmonizado (prompt OU tool, sem redundancia obrigatoria)
  + Tools em 4 camadas (discovery / validacao / acao / escape hatch)
  + Contrato de retorno padrao (ok/error/truncated + meta)
  + Historico com continuidade suficiente (tool summaries)
  + Observabilidade (DevTools + traces)
  + Testes multi-nivel + evals em batch
  + CI gates
```

## 4) Plano faseado (bem barrudo)

## Fase 0 — Congelar baseline e instrumentar diagnostico rapido

### Objetivo

Parar de evoluir no escuro.

### Entregas

- Documento de baseline (este plano + mapa atual em `docs/flowai`)
- Script de diagnostico local para imprimir:
  - modelo ativo
  - numero de steps
  - tool calls por turno
  - finish reason
  - tamanho de texto final
- Ligacao opcional de `@ai-sdk/devtools` em ambiente dev

### Acoes tecnicas

- Adicionar feature flag de devtools no cliente IA (`process.env.IA_DEVTOOLS=1`)
- Wrap do model com `devToolsMiddleware()` somente em dev
- Log estruturado por request de IA (id da conversa + timing)

### Testes/gates

- Smoke manual de 3 cenarios documentados
- Confirmar que devtools nao roda em producao

## Fase 1 — Instalar stack de testes (fundacao)

### Objetivo

Criar `npm test` e separar testes por camada sem travar o desenvolvimento.

### Stack recomendada (por fit com Electron + Vite + TS)

#### Testes TS (unit/integracao)

- `vitest`
- `@vitest/coverage-v8`
- `tsx` (ja existe, pode ser mantido para scripts)

#### Testes de componentes React (renderer)

- `jsdom`
- `@testing-library/react`
- `@testing-library/jest-dom`
- `@testing-library/user-event`

#### E2E Electron

- `@playwright/test` (com API `_electron`)

#### Observabilidade / debug de AI SDK (dev)

- `@ai-sdk/devtools`

### Instalacao sugerida

```bash
npm i -D vitest @vitest/coverage-v8 jsdom
npm i -D @testing-library/react @testing-library/jest-dom @testing-library/user-event
npm i -D @playwright/test
npm i -D @ai-sdk/devtools
```

### Scripts sugeridos (`package.json`)

```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "test:ui": "vitest --ui",
    "test:e2e": "playwright test",
    "test:ia:eval": "tsx tests/ia/evals/run-evals.ts",
    "test:ia:live": "tsx tests/ia/live/live-smoke.ts"
  }
}
```

### Estrutura sugerida

```text
tests/
  setup/
    vitest.setup.ts
    db-test-utils.ts
    ia-fixtures.ts
  ia/
    tools/
      contracts.spec.ts
      get-context.spec.ts
      consultar.spec.ts
      preflight.spec.ts
      cadastrar-lote.spec.ts
    runtime/
      cliente-tool-extraction.spec.ts
      historico-messages.spec.ts
      fallback-resposta-forcada.spec.ts
    evals/
      dataset.ts
      scorers.ts
      run-evals.ts
    live/
      live-smoke.ts
  renderer/
    IaToolCallsCollapsible.spec.tsx
    IaChatView.spec.tsx
  e2e/
    ia-chat-tool-calls.spec.ts
```

### Testes/gates da Fase 1

- `npm test` roda localmente.
- 1 teste de exemplo em cada camada:
  - tool
  - runtime mapper
  - componente UI
- sem mexer em comportamento de producao ainda.

## Fase 2 — Contrato das tools (padrao unico + `.describe()`)

### Objetivo

Fazer a IA receber retornos previsiveis e schemas que ensinam comportamento.

### Entregas

- Padrao de resposta para todas as tools:
  - `status: "ok" | "error" | "truncated"`
  - `summary`
  - payload semantico
  - `_meta`
- `.describe()` em campos Zod prioritarios (todos os IDs, enums, datas, formatos)
- Normalizacao de erros (`code`, `message`, `correction`)

### Ordem de implementacao (recomendada)

1. `get_context`
2. `consultar`
3. `preflight`
4. `gerar_escala`
5. `cadastrar_lote`
6. `criar/atualizar/deletar`
7. restantes

### Testes obrigatorios (por tool)

Para cada tool:

- sucesso simples
- erro de validacao schema
- erro semantico (entidade/campo invalido, item nao encontrado)
- shape de retorno (snapshot estrutural)
- `status` correto

### Exemplo de criterio de aceite

- Nenhuma tool retorna array cru no caminho principal.
- Nenhuma tool retorna apenas `{ erro: string }` sem `status`.
- Todos os schemas Zod de tools possuem `.describe()` em campos criticos.

## Fase 3 — Harmonizar discovery + system prompt + historico

### Objetivo

Remover contradicoes e reduzir custo de tokens/steps sem perder continuidade.

### Decisao que precisa ficar explicita

Escolher qual estrategia manda no discovery:

#### Opcao A (recomendada agora): discovery no prompt como principal

Porque:

- app pequeno/local ainda cabe no prompt
- `buildContextBriefing` ja existe e roda a cada request
- reduz step desnecessario

`get_context` vira:

- refresh manual
- fallback quando a IA precisa ampliar detalhes
- ferramenta de debug/confirmacao

#### Opcao B: discovery via tool como principal

Melhor quando:

- base crescer e estourar budget de prompt
- quiser reduzir token fixo por request

### Entregas da Fase 3

- `SYSTEM_PROMPT` reduzido (meta: ~80-150 linhas, nao 423)
- few-shots focados em intents reais de EscalaFlow
- instrucao de discovery alinhada com estrategia escolhida
- politica de historico documentada:
  - incluir tool summaries (ou tool results compactados)
  - limites de janela
  - quando truncar/sumarizar

### Testes obrigatorios

- Cenarios multi-turno mantem continuidade minima
- IA nao chama `get_context()` sem necessidade em cenarios simples
- IA ainda chama `get_context()` quando precisa refresh/resolucao
- latencia/steps nao pioram nos cenarios base

## Fase 4 — Camada de tools semanticas (sem matar fallback generico)

### Objetivo

Parar de depender de `consultar/criar/atualizar` para tudo.

Revisao de estrategia (apos implementacao inicial):

- **Nao** criar wrappers semanticos que so duplicam CRUD/read generico (ex.: `listar_setores`, `criar_excecao`) quando `consultar/criar` + raciocinio resolvem.
- Priorizar apenas tools com **logica propria** (fuzzy search, agregacao/diagnostico, solver/validacao, IPC fora do whitelist generico, traducao de intent natural).

Referencia de escopo:

- O **MVP desta fase** e um subconjunto do catalogo completo em `docs/flowai/CATALOGO_TARGET_TOOLS_IA.md` (Onda 1 / P0).
- O catalogo completo existe para evitar esquecer dominios do produto; a implementacao continua incremental.

### Entregas (MVP de semantica)

#### Discovery (so quando genericas nao resolvem)

- `buscar_colaborador` (nome fuzzy / ambiguidades)

#### Acoes com logica propria

- `ajustar_horario` (ajuste de horario manual de alocacao)
- `salvar_regra_horario_colaborador`
- `definir_janela_colaborador` (traducao de intent)

#### Validacao/diagnostico com computacao/agregacao

- `preflight_completo`
- `diagnosticar_escala` (resumo com status + proximas acoes possiveis)

### Estrategia de migracao

- manter `consultar/criar/atualizar` como escape hatch
- atualizar prompt para preferir tools semanticas **apenas quando agregam logica propria**
- adicionar `_meta.ids_usaveis_em` nas tools discovery

### Testes/evals obrigatorios

- dataset de intents reais mapeando ferramenta esperada
- scorer de "tool correta"
- scorer de "args corretos"
- scorer de "nao usou tool wrapper desnecessaria quando `consultar/criar` resolviam"

## Fase 5 — Confiabilidade do runtime (sem hacks invisiveis)

### Objetivo

Reduzir dependencia do fallback de "resposta forcada" e tornar o loop mais previsivel.

### Entregas

- Medicao de quantos casos usam fallback de resposta forcada
- Padrao de `status` + `summary` em tools ja implantado (Fase 2)
- Revisao do hack de fallback:
  - manter temporariamente com metrica
  - remover ou reduzir quando taxa de silencio cair
- Avaliar `experimental_repairToolCall` para erros de args invalidos

### Testes obrigatorios

- cenarios que antes caiam em silencio agora respondem naturalmente
- se fallback existir, teste dedicado protege comportamento
- loop nao entra em repeticao de tools

## Fase 6 — Evals em batch (regressao de comportamento da IA)

### Objetivo

Trocar "teste manual no chat" por regressao reproduzivel.

### Entregas

- dataset de cenarios do EscalaFlow
- scorers deterministicos (tool e args)
- scorer semantico opcional (texto final)
- relatorio com taxa de acerto por categoria

### Dataset inicial recomendado (minimo util)

#### Categoria A — Discovery / leitura

- "Quantas pessoas tem no Caixa?"
- "Quem trabalha no Acougue?"
- "Qual a escala atual do Caixa?"

#### Categoria B — Excecoes

- "Adiciona ferias da Maria de 2026-03-10 a 2026-03-20"
- "A Cleunice tem atestado ativo?"

#### Categoria C — Escala

- "Faz preflight do Acougue para marco de 2026"
- "Gera escala do Caixa para marco de 2026"
- "Oficializa a ultima escala do Caixa" (deve exigir confirmacao ou recusar se hard > 0)

#### Categoria D — Regras

- "Desliga H2" (deve negar; regra fixa)
- "Explica a H14"

#### Categoria E — Importacao/lote

- CSV pequeno (3 linhas)
- CSV com setor inexistente
- CSV > 10 linhas (deve planejar/confirmar antes)

### Ferramenta de eval (escolha por fase)

- Agora: DIY (`tests/ia/evals/run-evals.ts`)
- Depois: Braintrust ou Langfuse + eval pipeline

### Gates

- Score minimo por categoria (exemplo):
  - tool correta >= 90%
  - args corretos >= 85%
  - sem erro tecnico exposto ao usuario >= 95%

## Fase 7 — UI e experiencia (streaming + debug)

### Objetivo

Melhorar experiencia de uso e debugar sem sofrimento.

### Entregas

- AI SDK DevTools integrado em dev
- melhoria de telemetria local (timings/steps)
- avaliacao de `streamText` no Electron
- indicadores de progresso de tool call no chat (opcional)

### Testes obrigatorios

- UI de tool calls nao quebra com outputs grandes
- renderiza `args = {}` e `result = null/false/0`
- historico recarregado degrada com fallback esperado (sem output persistido)

## Fase 8 — CI/CD de qualidade (gates reais)

### Objetivo

Garantir que evolucao de prompt/tool/schema nao quebre o sistema silenciosamente.

### Entregas

- GitHub Actions (ou pipeline equivalente) com:
  - `npm ci`
  - `npm run typecheck`
  - `npm test`
  - `npm run test:ia:eval` (dataset local/mocado)
  - opcional: `npm run test:e2e` em job separado
- job de smoke live com API keys (manual/scheduled) fora do PR gate

### Politica de merge recomendada

- Sem cobertura minima de tools -> nao mergear mudanca em `src/main/ia/tools.ts`
- Mudou `SYSTEM_PROMPT` ou schemas -> rodar evals obrigatoriamente
- Mudou UI de tool calls -> rodar teste de componente + smoke E2E

## 5) Matriz de testes (o que testar em cada nivel)

## 5.1 Unit (rapido, barato)

### Alvos

- `extractToolCallsFromSteps()` (`cliente.ts`)
- `normalizeToolArgs()`
- `buildChatMessages()` (historico e filtragem)
- helpers de humanizacao/contrato (quando criados)
- schemas Zod (`safeParse`)

### Exemplos de casos

- `toolCall.input` primitivo vira `{ value: ... }`
- pareamento por `toolCallId` e nao por indice
- `args/result` legados ainda aceitos
- `buildChatMessages` inclui/exclui `tool_result` conforme politica

## 5.2 Integracao (SQLite + tools)

### Alvos

- `executeTool()` com DB de teste
- `createTables()` + `seedData()`
- mutacoes reais (`criar`, `cadastrar_lote`, `editar_regra`)
- leituras semanticas (quando novas tools entrarem)

### Requisitos de fixture

Criar um "kit EscalaFlow" de seed de teste com cenarios:

- setor sem colaboradores
- setor com demanda e equipe minima
- colaborador aprendiz/estagiario
- escala com violacoes hard
- nomes ambiguos (ex: duas Marias)

### Ponto tecnico importante

As tools hoje usam `getDb()` singleton e suporte a `global.mockDb`.

Para testabilidade melhor:

- curto prazo: usar `global.mockDb` em integracao
- medio prazo: injetar `db` em `executeTool`/factory (`createIaTools({ db, solverAdapter })`)

## 5.3 Runtime/loop (AI SDK sem depender de API real)

### Alvos

- fluxo do `cliente.ts` com resultado mockado de `generateText`
- fallback de resposta forcada
- extracao de `acoes` para UI

### Estrategia

- mockar `generateText`
- simular `steps` com shapes v6 (`input/output`) e legados (`args/result`)
- validar `resposta` + `acoes`

## 5.4 Live smoke (com Gemini/OpenRouter)

### Objetivo

Detectar problemas reais de provider/modelo que mocks nao pegam.

### Regras

- nao entra no gate de PR (caro/instavel)
- roda manualmente ou em cron
- usa API keys de ambiente
- salva trace/log resumido

### Cenarios minimos

- `get_context` simples
- pergunta de leitura
- acao sem solver (ex: `explicar_violacao`)
- fluxo com `preflight`

## 5.5 Evals em batch (comportamento agencial)

### O que mede

- tool selection
- argument fidelity
- politica de erro (nao expor erro tecnico)
- encadeamento correto discovery -> validacao -> acao

### O que NAO substitui

- integracao com DB real
- E2E de UI
- smoke de provider

## 5.6 UI/componentes (renderer)

### Alvos prioritarios

- `IaToolCallsCollapsible`
- `IaChatView` (mensagem UI vs persistida)

### Casos criticos

- `args` vazio deve aparecer
- `result` falsy deve aparecer
- historico sem `result` mostra "Output nao persistido"
- JSON grande nao explode layout

## 5.7 E2E Electron

### Escopo minimo util

- abrir app
- configurar provider fake/mocado (ou interceptar IPC)
- enviar mensagem
- ver resposta no chat
- ver bloco de tool calls
- expandir output

### Observacao pragmatica

E2E Electron completo com provider real no PR e overkill no inicio. Comecar com IPC fake/mocado para UX/contrato.

## 6) Backlog tecnico detalhado (implementacao)

## 6.1 Refactors que destravam testes (alto ROI)

1. Extrair `createIaClient`/`runAgentTurn` para permitir mock de `generateText`.
2. Extrair factory de tools com dependencias injetaveis:
   - `db`
   - `solverAdapter`
   - `clock`
3. Centralizar contrato de resposta:
   - `ok()`
   - `err()`
   - `truncated()`
4. Criar helper de humanizacao (`humanizeRow`, `relatedToolsMeta`).

## 6.2 Refactors de risco (planejar depois da cobertura minima)

1. Reduzir `SYSTEM_PROMPT` drasticamente.
2. Mudar politica de historico para incluir tool summaries.
3. Trocar `generateText` por `streamText` no fluxo principal.
4. Remover hack de resposta forcada.

## 7) Plano de execucao recomendado (primeiros 10 dias uteis)

## Sprint 1 (infra + contratos)

1. Instalar Vitest/RTL/Playwright/DevTools.
2. Criar `tests/setup/db-test-utils.ts` com `createTables()` + `seedData()`.
3. Cobrir `extractToolCallsFromSteps` e `IaToolCallsCollapsible`.
4. Definir contrato `status/summary/_meta` em helpers.
5. Migrar `get_context` e `preflight` para o novo contrato.
6. Adicionar `.describe()` nos schemas dessas duas tools.

## Sprint 2 (consultar + evals)

1. Refatorar `consultar` com resposta rica e humanizacao basica.
2. Adicionar tests de integracao para `consultar`.
3. Criar eval harness local + dataset inicial (10-15 casos).
4. Rodar baseline e documentar taxa de acerto.
5. Ajustar prompt para preferir respostas semanticas.

## Sprint 3 (semanticas + CI)

1. Criar 2-3 tools semanticas de maior impacto (`buscar_colaborador`, `obter_escala_atual`, `criar_excecao`).
2. Adicionar scorers que punem uso desnecessario de `consultar`.
3. Subir CI com typecheck + test + eval local.
4. Planejar streaming e observabilidade persistente.

## 8) Criterios de sucesso (Definition of Done macro)

Considerar a evolucao "funcional e atual" quando:

- todas as tools possuem contrato padronizado de retorno
- schemas criticos usam `.describe()`
- existe `npm test` com cobertura minima de runtime/tools/UI
- existe eval batch local rodando dataset de cenarios reais
- existe CI bloqueando regressao basica
- prompt/discovery/historico nao se contradizem
- tool calls ficam observaveis localmente (DevTools ou equivalente)

## 9) O que NAO fazer (anti-patterns de projeto)

- Reescrever todas as tools de uma vez.
- Matar `consultar` antes de ter wrappers semanticos suficientes.
- Ajustar prompt sem rodar evals.
- Medir qualidade so por "pareceu bom no meu chat".
- Misturar mudanca de UX, prompt, tools e testes no mesmo mega-commit.

## 10) Proximo passo pratico (recomendado)

Se a proxima iteracao for de execucao (nao so planejamento), a ordem mais inteligente e:

1. Fase 1 inteira (infra de testes + `npm test`)
2. Cobertura de `cliente.ts` mapper + `IaToolCallsCollapsible`
3. Padrao de resposta em `get_context` e `preflight`
4. Comecar refatoracao de `consultar`

Isso cria rede de seguranca antes de mexer no coracao do sistema.
