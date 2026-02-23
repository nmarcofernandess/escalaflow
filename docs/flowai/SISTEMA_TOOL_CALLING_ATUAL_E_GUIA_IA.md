# Sistema de Tool Calling Atual (EscalaFlow) + Guia para a IA

## Contexto

Documento criado apos estudo de:

- `/Users/marcofernandes/Downloads/tool-calling-guide-v3-2.html`
- runtime atual do EscalaFlow (`src/main/ia/*`, `src/main/tipc.ts`, UI de chat, schema DB)
- docs internas existentes de IA (`docs/IA_TOOLCALLING_INTELLIGENCE.md`, `docs/IA_TOOLCALLS_UI_RUNTIME_FLOW.md`)

Data-base do diagnostico: `2026-02-23`.

## TL;DR (direto ao ponto)

- O loop agencial existe e funciona (`generateText` + `stopWhen: stepCountIs(10)`).
- O sistema atual mistura dois modelos de discovery ao mesmo tempo (prompt + `get_context()` obrigatorio).
- (Diagnostico historico) O `SYSTEM_PROMPT` estava supercarregado (423 linhas) e conflitando com o discovery injetado por `buildContextBriefing` (ja reescrito na Fase 3).
- Testes/evals/observabilidade ja foram iniciados, mas eval batch e observabilidade ainda precisam calibracao e uso recorrente.

## Atualizacao de execucao (apos o diagnostico inicial)

- Fase 1 (fundacao de testes) implementada: `Vitest`, `RTL`, `Playwright` (placeholder), scripts e testes iniciais.
- Fase 2 (contrato de tools) avancou fortemente:
  - retorno padronizado (`status`, `summary`, `_meta`)
  - `.describe()` aplicado em schemas criticos
  - `consultar` refatorado para retorno rico + humanizacao
  - demais tools padronizadas com compat legado preservada
- `gerar_escala` passou a expor `solver_status` separado do `status` da tool.
- `@ai-sdk/devtools` ja esta preparado no projeto e integrado no runtime em modo local/dev.

## 1) O que e o EscalaFlow (recorte necessario para testarmos IA)

EscalaFlow e um app desktop Electron offline para gestao de escalas de supermercado com:

- SQLite local (`better-sqlite3`)
- motor Python OR-Tools via ponte TS (`src/main/motor/solver-bridge.ts`)
- regras CLT/CCT/antipattern
- UI React/Electron
- assistente IA com tools para ler/escrever no sistema

### Entidades de dominio mais importantes para a IA

| Entidade | Papel no dominio | Risco de erro |
|---|---|---|
| `setores` | Onde a escala acontece | medio |
| `colaboradores` | Pessoas escaladas | alto |
| `tipos_contrato` | Regras de jornada/horas | alto |
| `demandas` | Cobertura necessaria por faixa/dia | alto |
| `excecoes` | Ferias/atestado/bloqueio | alto |
| `escalas` | Resultado gerado (RASCUNHO/OFICIAL) | alto |
| `alocacoes` | Celulas dia x colaborador | alto |
| `regra_definicao` / `regra_empresa` | Motor de restricoes | alto |
| `feriados` | Regras legais/CCT | alto |

### Impacto disso no tool calling

A IA nao esta fazendo "chat genérico". Ela esta:

- consultando dados operacionais
- alterando dados sensiveis
- disparando solver
- oficializando escala (efeito de negocio real)

Logo, tool design ruim aqui nao gera "resposta feia". Gera erro operacional.

## 2) Como o sistema de calling funciona hoje (runtime real)

## 2.1 Fluxo end-to-end (atual)

```text
Renderer (IaChatView.tsx)
  -> IPC `ia.chat.enviar`
    -> TIPC handler (`src/main/tipc.ts`)
      -> `iaEnviarMensagem()` (`src/main/ia/cliente.ts`)
        -> monta system prompt + historico + tools
        -> `generateText(...)` via AI SDK v6
        -> loop multi-step (`stopWhen: stepCountIs(10)`)
        -> execute tools (`src/main/ia/tools.ts`)
          -> SQLite / solver bridge / regras
        -> extrai `result.steps` => `ToolCall[]`
        -> retorna `{ resposta, acoes }`
    -> Renderer renderiza resposta + tool calls
    -> Renderer persiste mensagem sanitizada (sem `tool_calls[].result`)
```

## 2.2 Componentes-chave

| Camada | Arquivo | Responsabilidade |
|---|---|---|
| Cliente IA | `src/main/ia/cliente.ts` | Build do prompt/historico, chamada `generateText`, coleta de `steps`, fallback de resposta forcada |
| Tools | `src/main/ia/tools.ts` | Declaracao Zod/AI SDK + `executeTool()` (SQLite + solver) |
| Discovery prompt | `src/main/ia/discovery.ts` | Injeta contexto da pagina atual no system prompt |
| System prompt | `src/main/ia/system-prompt.ts` | Regras de uso, dominio, exemplos, comportamento |
| IPC | `src/main/tipc.ts` | Endpoint `ia.chat.enviar`, historico de conversas, persistencia |
| UI chat | `src/renderer/src/componentes/IaChatView.tsx` | Chamada IPC, render, persistencia sanitizada |
| UI tool calls | `src/renderer/src/componentes/IaToolCallsCollapsible.tsx` | Render de args/output e fallback para historico sem output |

## 2.3 Comportamentos importantes (atuais)

- Historico enviado ao modelo inclui apenas `usuario` e `assistente`; `tool_result` e filtrado.
- `buildContextBriefing(contexto)` e reconstruido a cada request (dados frescos no prompt).
- `SYSTEM_PROMPT` ainda manda "SEMPRE chamar get_context() primeiro", mesmo com discovery no prompt.
- Se a IA executa tools e nao retorna texto, `cliente.ts` injeta um segundo turno "forcado" sem tools.
- UI mostra tool outputs na sessao atual, mas remove `result` para persistir no SQLite (economia de payload).

## 3) Inventario atual de tools (produto)

Contagem atual: `13` tools (extraido de `src/main/ia/tools.ts`).

## 3.1 Tools existentes

| Tool | Categoria atual | Tipo | Observacao |
|---|---|---|---|
| `get_context` | discovery | read | util, mas conflita com discovery no prompt quando "obrigatoria" |
| `consultar` | generica | read | poderosa, mas crua e arriscada para IA |
| `criar` | generica | write | defaults uteis, mas contrato inconsistente por entidade |
| `atualizar` | generica | write | semantica fraca para IA |
| `deletar` | generica | write | destrutiva |
| `editar_regra` | negocio | write | boa semantica |
| `gerar_escala` | negocio | write/acao longa | integra solver |
| `ajustar_alocacao` | negocio | write | importante para fluxo de escala |
| `oficializar_escala` | negocio | write | acao critica |
| `preflight` | validacao | read/diag | excelente para layer de validacao |
| `resumo_sistema` | discovery | read | removida do registry da IA (legado/deprecated) |
| `explicar_violacao` | apoio de dominio | read | boa para UX e aprendizado |
| `cadastrar_lote` | negocio | write | muito util, alta alavanca |

## 3.2 Diagnostico por design (o que esta faltando)

- Falta separacao clara por camada (descoberta -> validacao -> acao).
- Excesso de ferramentas genericas (`consultar`, `criar`, `atualizar`) para fluxos comuns.
- Falta resposta rica padronizada (`status`, `dados`, `_meta`) em quase todas as tools.
- Falta `.describe()` em todos os schemas Zod (contagem atual: `0`).
- Falta ferramentas semanticas para intents recorrentes (buscar colaborador, listar setor, pegar escala ativa etc).

## 4) O que a IA precisa saber (knowledge contract)

Aqui esta o minimo necessario para a IA trabalhar bem no EscalaFlow sem improvisar.

## 4.1 O que a IA PRECISA saber sempre

| Tipo de conhecimento | Exemplo | Fonte recomendada |
|---|---|---|
| Dominio base | Setor, colaborador, demanda, escala, alocacao, excecao | system prompt (curto + preciso) |
| Regras criticas | Nao oficializa com violacao HARD | system prompt + retorno de tool |
| Estados de fluxo | `RASCUNHO` vs `OFICIAL` | system prompt + tool responses |
| Formatos | datas `YYYY-MM-DD`, enums de status | schema Zod + `.describe()` |
| Heuristica de operacao | discovery -> validar -> agir -> responder | system prompt enxuto + few-shots |
| Erros auto-corrigiveis | valores validos / sugestao de correcao | retorno das tools (`status:error`) |

## 4.2 O que a IA PRECISA saber de forma dinamica (por request)

| Dado dinamico | Por que importa | Como fornecer |
|---|---|---|
| Pagina/rota atual | reduz perguntas desnecessarias | `IaContexto` / `buildContextBriefing` |
| Setor/colaborador em foco | resolve "quem" sem pedir ID | `IaContexto` + discovery |
| Mapa atual de setores/escalas/colaboradores | resolucao de nome -> ID | discovery no prompt OU `get_context()` |
| Resultado das tools anteriores | continuidade multi-turno | historico com `tool_results` (compactados) ou rediscovery consistente |
| Resultado da ultima acao | evitar repeticao / confirmar status | `tool_result` + texto do assistente |

## 4.3 O que a IA NAO deve precisar saber

- Nome de tabela/coluna SQL para fluxos comuns.
- Mensagens raw de constraint do SQLite.
- Estrutura interna do solver Python.
- IDs sem traducao quando a intencao do usuario e semantica.

Se a IA precisa disso para executar, a tool esta semanticamente fraca.

## 5) O que a IA precisa ter acesso (access contract)

## 5.1 Leitura (obrigatorio)

- Contexto da pagina atual (`IaContexto`)
- Mapa de dominio suficiente para resolucao de nomes (setores, colabs, escalas)
- Regras e status de escala
- Excecoes e feriados
- Diagnosticos do preflight / solver

## 5.2 Escrita (com guardrails)

| Acao | Pode executar sem confirmacao? | Observacao |
|---|---|---|
| `criar` registro simples | depende do volume | lote alto deve pedir confirmacao |
| `atualizar` ajustes pequenos | sim (com resumo) | ideal com tools semanticas |
| `deletar` | nao | exigir confirmacao explicita |
| `editar_regra` | nao (ou dupla confirmacao) | impacto sistêmico |
| `gerar_escala` | sim | precedido de `preflight` |
| `ajustar_alocacao` | sim | resumir impacto |
| `oficializar_escala` | nao | confirmar explicitamente |
| `cadastrar_lote` | depende de quantidade | mostrar plano antes se volume alto |

## 5.3 Observabilidade (acesso para dev, nao para modelo)

O modelo nao precisa ver tudo. O time precisa.

Necessario para evoluir com seguranca:

- trace de steps
- tool calls + args
- tool results (versao completa para debug)
- timing por tool
- token usage
- falhas por tool/schema

Ferramentas candidatas:

- `@ai-sdk/devtools` (imediato, local)
- Langfuse / Braintrust / LangSmith (fase posterior)

## 6) Gaps reais do sistema atual (confirmados no codigo)

## 6.1 Discovery duplicado e instrucoes conflitantes

`buildContextBriefing()` ja injeta discovery no prompt a cada request, mas `SYSTEM_PROMPT` repete "SEMPRE get_context() primeiro".

Efeito:

- custo de tokens/steps desnecessario
- fluxo mais lento
- comportamento redundante

## 6.2 Schemas Zod sem `.describe()`

`src/main/ia/tools.ts` usa Zod, mas sem `.describe()` nos campos. A IA recebe tipo/formato, mas nao recebe "de onde vem esse valor" nem contexto de uso.

Exemplo pratico:

- IA sabe `setor_id` e numero positivo
- IA nao sabe que deve extrair do mapa/discovery

## 6.3 `consultar()` ainda e um "escape hatch" dominante

Problemas:

- IA precisa saber entidade/campos
- retorno cru (`SELECT *`) em varios casos
- pouca semantica para decidir proximo step

Observacao:

- Manter `consultar` e valido como fallback/admin.
- Nao deve ser a principal interface dos fluxos comuns.

## 6.4 Continuity fraca entre mensagens

`buildChatMessages()` filtra `tool_result`. Isso reduz continuidade e obriga rediscovery/reconsulta.

O sistema compensa parcialmente porque:

- `buildContextBriefing` e regenerado
- UI persiste `args` (bom)

Mas ainda perde:

- resultado da ultima busca
- detalhes de erros/diagnosticos
- contexto de tool chain da conversa

## 6.5 Hack de resposta forcada

O fallback em `cliente.ts` resolve sintoma ("executou tool e nao falou nada"), mas nao corrige causa raiz:

- respostas pouco autoexplicativas para a IA
- falta de sinalizacao consistente de completude (`status: ok`)

## 6.6 Falta de contrato unificado de resposta de tool

Hoje cada tool retorna shapes diferentes:

- `{ erro: string }`
- array cru
- `{ sucesso: true, ... }`
- `{ ok: boolean, blockers, warnings }`

Isso funciona para humano lendo JSON, mas enfraquece previsibilidade do modelo.

## 7) Que tipo de tool realmente precisa (target design)

A resposta curta: manter o nucleo atual, mas reorganizar em camadas e adicionar tools semanticas para as intents frequentes.

Observacao (estado atual):

- Esta secao virou **resumo/taxonomia**.
- O catalogo teorico completo (com double-check no doc canonico `COMO_O_SISTEMA_FUNCIONA.md`, prioridades P0-P3 e ondas) esta em `docs/flowai/CATALOGO_TARGET_TOOLS_IA.md`.
- Nem todo handler IPC deve virar tool de IA (ex.: backup/restore e operacoes de alto risco ficam opcionais/guardadas).

## 7.1 Taxonomia recomendada (EscalaFlow)

### Camada A — Discovery (baratas, read-only)

Objetivo: resolver nomes, contexto e estado atual.

Tools recomendadas:

| Tool | Status | Motivo |
|---|---|---|
| `get_context` | manter (refatorar) | discovery global / refresh |
| `listar_setores` | nova | reduz uso de `consultar("setores")` |
| `buscar_colaborador` | nova | semantica alta para nome -> ID + dados uteis |
| `listar_escalas_do_setor` | nova | pega escala ativa/rascunho sem SQL mental |
| `obter_escala_atual` | nova | fluxo rapido de "como esta X?" |
| `listar_regras_editaveis` | nova | reduz erro em `editar_regra` |

### Camada B — Validacao / Diagnostico

Objetivo: checar se a acao faz sentido antes de escrever.

Tools recomendadas:

| Tool | Status | Motivo |
|---|---|---|
| `preflight` | manter (padronizar resposta) | ja existe e e boa |
| `explicar_violacao` | manter | suporte semantico e educativo |
| `diagnosticar_escala` | nova (ou semantica via consultar) | agrega resumo + violacoes + proximas opcoes |
| `simular_oficializacao` | opcional | checa status antes de oficializar |

### Camada C — Acoes (write)

Objetivo: mutacoes claras, idempotentes quando possivel, com guardrails.

Tools recomendadas:

| Tool | Status | Motivo |
|---|---|---|
| `gerar_escala` | manter | core action |
| `ajustar_alocacao` | manter | core action |
| `oficializar_escala` | manter + confirmacao | acao critica |
| `cadastrar_lote` | manter | alta produtividade |
| `criar_excecao` | nova (wrapper semantico) | reduz erro de `criar("excecoes")` |
| `atualizar_janela_colaborador` | nova | fluxo frequente e sensivel |
| `criar_setor` / `criar_colaborador` | novas (gradual) | semantica > `criar` generico |

### Camada D — Escape hatches (administracao)

Objetivo: manter flexibilidade sem virar interface primaria.

| Tool | Status | Regra de uso |
|---|---|---|
| `consultar` | manter (restrita) | fallback/admin/debug; nao fluxo padrao |
| `criar` | manter (transicional) | fallback enquanto wrappers semanticos nao existem |
| `atualizar` | manter (transicional) | idem |
| `deletar` | manter (protegida) | sempre com confirmacao |

## 7.2 Principio de desenho para todas as tools

### Sucesso (`status: "ok"`)

Retornar:

- `status`
- `summary` (curto, legivel)
- `dados` (ou campos semanticos)
- `_meta` (ids usaveis, proximas tools compativeis, truncagem, pagina util)

### Erro (`status: "error"`)

Retornar:

- `status: "error"`
- `code` (estavel)
- `message` (claro)
- `correction` (como corrigir)
- `valid_values` / `examples` quando aplicavel

### Truncagem (`status: "truncated"`)

Retornar:

- dados parciais
- `total`
- `returned`
- sugestao de filtros

## 7.3 Quando usar `toModelOutput`

Aplicar primeiro nas tools que:

- retornam listas grandes
- sao uteis para UI/debug completo, mas a IA nao precisa de todos os campos

Candidatas imediatas:

- `get_context`
- `consultar` (quando mantida)
- futuras `listar_*`

## 8) Guia operacional para a IA (o que e util ela fazer)

## 8.1 Workflow recomendado (curto e consistente)

```text
1. Entender intencao do usuario
2. Descobrir/resolver entidades (nome -> ID)
3. Validar impacto (quando for acao relevante)
4. Executar acao
5. Responder em linguagem natural com resumo do que fez
6. Se erro: auto-corrigir antes de expor ao usuario
```

## 8.2 O que e util a IA fazer no EscalaFlow (alto valor)

- responder perguntas operacionais sobre equipe/setores/escalas
- preparar e gerar escalas com `preflight` + `gerar_escala`
- explicar violacoes e regras
- ajustar alocacoes pontuais
- cadastrar excecoes e dados em lote
- orientar o gestor com base no contexto da tela atual

## 8.3 O que a IA deve evitar

- pedir ID se houver discovery/contexto
- expor erro tecnico de SQLite/solver
- chamar a mesma tool em loop sem mudanca de parametros
- usar `consultar` para tudo quando existir tool semantica
- oficializar/deletar sem confirmacao clara

## 9) Implicacoes para testes (ja preparando o terreno)

Para testar esse sistema direito, precisamos conseguir validar:

- escolha da tool correta
- argumentos corretos
- forma do retorno (contrato)
- auto-correcoes
- continuidade entre mensagens
- efeitos reais no SQLite
- efeitos reais no solver (ao menos smoke)

Isso exige separar testes em 4 niveis:

- unit (schemas, helpers, mapeadores)
- integracao (tools + SQLite + seed)
- loop/eval (IA SDK + tools + cenarios)
- UI/E2E (renderer + Electron)

O plano faseado esta no arquivo:

- `docs/flowai/PLANO_EVOLUCAO_TOOL_CALLING_E_TESTES.md`
