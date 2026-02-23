# IA Bugs - Triagem e Context Pack (2026-02-22)

## Objetivo deste documento

Consolidar os problemas atuais da camada de IA/UX do EscalaFlow em um pacote de contexto técnico para virar **specs separadas** sem perder histórico.

Este documento responde:

- o que está funcionando vs. quebrado
- o que já foi implementado recentemente
- bugs reais vs. comportamento ainda não implementado
- hipóteses de causa raiz com evidência de código
- sugestão de recorte em specs independentes

## Snapshot do que foi feito (recente)

### Já implementado (nesta sequência de mudanças)

- UI de configuração multi-provider (`Gemini`, `Codex CLI`, `Claude Code CLI`, `OpenRouter`)
- persistência de config por provider em `configuracao_ia.provider_configs_json`
- catálogo dinâmico de modelos:
  - `OpenRouter` (realtime)
  - `OpenAI` (para `Codex` em modo token)
  - `Anthropic` (para `Claude` em modo token)
  - fallback estático para modos de login CLI
- `OpenRouter` runtime no chat RH (Vercel AI SDK + tools), compartilhando pipeline com Gemini
- POC de CLI manager (detectar/instalar/abrir login) para `Codex`/`Claude Code`

### Ainda NÃO implementado (por design)

- runtime do chat RH via `Codex CLI` (PTY/MCP)
- runtime do chat RH via `Claude Code CLI` (PTY/MCP)

## Resumo executivo (estado real)

### Funciona / deveria funcionar

- `Gemini` runtime (se a key for válida)
- `OpenRouter` catálogo de modelos (realtime)
- `OpenRouter` runtime do chat RH (token mode)
- POC de config/login/install para `Codex`/`Claude Code`

### Não funciona (ainda)

- chat RH usando `Codex CLI`
- chat RH usando `Claude Code CLI`

### Problemas confirmados pelo operador (Marco)

1. ~~Pedido para colocar chave OpenRouter no seed~~ ✅ RESOLVIDO
2. ~~Gemini parou (erro de API key leaked)~~ ✅ RESOLVIDO
3. ~~`Codex`/`Claude Code` mostram "IA não está ativa ou API Key está faltando"~~ ✅ RESOLVIDO
4. ~~OpenRouter/configuração "eterna" até apagar `data/escalaflow.db`~~ ✅ RESOLVIDO
5. UI da lista/catálogo de IAs está feia e jogada — 🔧 EM PROGRESSO
6. ~~Sidebar do chat IA quebra layout/posição/resize (principalmente em Configurações)~~ ✅ RESOLVIDO (Layout Contract)

---

## ISSUE 1 - Seed com chave OpenRouter ✅ RESOLVIDO

### Pedido do operador

Adicionar chave OpenRouter no seed para facilitar ambiente local.

### Estado atual

O seed já injeta **uma key Gemini hardcoded** quando `configuracao_ia` está vazia:

- `src/main/db/seed.ts:816`
- `src/main/db/seed.ts:822`
- `src/main/db/seed.ts:824`

### Problema técnico

- Colocar chave real no seed **versionado** gera:
  - vazamento de credencial no repo
  - propagação da key para builds/equipes/clones
  - comportamento confuso em DBs já existentes (seed só roda quando a tabela está vazia)

### Problema de produto/ops

Mesmo se a key for adicionada ao seed:
- **não corrige** DBs já existentes com configuração quebrada
- só "resolve" ambientes zerados

### O que já estamos vendo (evidência)

- O próprio Gemini atual no seed está quebrado por key comprometida (Issue 2)
- Isso já mostra o custo de credencial hardcoded em seed

### Recomendação (forte)

Não commitar credenciais reais no seed.

### Alternativas seguras (para spec)

1. `seed local override` gitignored (ex.: `data/dev-secrets.local.json`)
2. `.env` local + comando de bootstrap (`npm run dev:seed-ia`)
3. botão "Popular config IA local" na tela de Config (dev mode only)

### Status de implementação

- **RESOLVIDO (2026-02-22)**
- Key hardcoded removida do `seed.ts` (já estava limpo por sessão anterior)
- `seed-local.ts` (gitignored) com pattern de upsert: se key no banco difere da do seed-local, atualiza automaticamente no `npm run dev`
- Key Gemini rotacionada e atualizada no seed-local
- Nunca mais precisa deletar DB pra atualizar key

---

## ISSUE 2 - Gemini parou de funcionar (erro de key leaked) ✅ RESOLVIDO

### Sintoma reportado

Erro ao testar:

`Modelo "gemini-3-flash-preview" retornou erro: Your API key was reported as leaked. Please use another API key.`

### Diagnóstico

Isso é **rejeição do Google** por key comprometida/vazada.  
Não é erro da lógica de provider do EscalaFlow.

### Evidência de código

- O teste de Gemini continua fazendo `generateText` via `@ai-sdk/google`:
  - `src/main/ia/cliente.ts:261` (função `iaTestarConexao`)
  - branch Gemini dentro dela

### Conclusão

- A key Gemini atual está inválida/banida pelo provedor.
- Precisa **rotacionar a key**.

### Impacto colateral

Como o seed ainda injeta a key antiga:
- apagar DB e subir app pode reintroduzir uma key já bloqueada

### Ação recomendada (imediata)

1. Rotacionar a key no Google AI Studio
2. Remover key hardcoded do seed (ou trocar por placeholder)
3. Atualizar configuração no app (e opcionalmente no seed local gitignored)

### Status

- **RESOLVIDO (2026-02-22)**
- Key rotacionada no Google AI Studio
- Seed-local atualizado com key nova + upsert automático
- Key hardcoded já havia sido removida do `seed.ts` versionado

---

## ISSUE 3 - `Codex` / `Claude Code` mostram "IA não está ativa ou API Key está faltando" ✅ RESOLVIDO

### Sintoma reportado

Mesmo com CLI detectado/auth ok, o chat mostra:

`⚠️ IA não está ativa ou API Key está faltando.`

### Diagnóstico confirmado (causa raiz)

O `IaChatView` ainda usa validação **legada Gemini-centric**:

- `src/renderer/src/componentes/IaChatView.tsx:65-67`
- `src/renderer/src/componentes/IaChatView.tsx:80-87`

Hoje ele considera "configurado" apenas se:

- `config.ativo === true`
- `config.api_key` truthy

Isso quebra para:

- `Codex CLI` em modo `login`
- `Claude Code CLI` em modo `login`

porque nesses casos **não existe API key no campo legado** por design.

### Problema adicional de UX

A empty state está hardcoded para Gemini:

- `src/renderer/src/componentes/IaChatView.tsx:145-148`

Texto atual sugere "Configure sua API Key do Google Gemini", mesmo quando provider selecionado é outro.

### Nota importante (não confundir)

Mesmo corrigindo esse gating, `Codex`/`Claude Code` **ainda não vão funcionar no chat RH** porque o runtime PTY/MCP não foi implementado.

Ou seja, existem **2 camadas** de problema:

1. gating errado na UI (bug real)
2. runtime CLI ausente (não implementado ainda)

### Status

- **RESOLVIDO (2026-02-22)**
- `IaChatView.tsx`: gating reescrito — libera se QUALQUER provider tem credencial (api_key, provider_configs token, ou CLI-based)
- Guard redundante no `enviar()` removido — backend já valida por provider e retorna erro específico
- Empty state dinamizada — texto genérico multi-provider em vez de "Configure Gemini"
- Indicador de modelo ativo adicionado no `IaChatInput` (substitui texto "Shift+Enter")
- `cliente.ts`: `resolveProviderApiKey()` criada — resolve key de `provider_configs_json[provider].token` com fallback pra `api_key` legado (corrige bug de dual storage onde teste passava mas chat falhava)

---

## ISSUE 4 - OpenRouter (e config IA) "só funciona" apagando o DB ✅ RESOLVIDO

### Sintoma reportado

Necessidade recorrente de:

```bash
rm data/escalaflow.db
npm run dev
```

para a config IA "destravar".

### Hipóteses fortes (prováveis) - múltiplas causas

#### H1) Seed + DB persistente mascarando estado

O seed de `configuracao_ia` só roda se a tabela está vazia:

- `src/main/db/seed.ts:818-825`

Então:
- DB velho mantém configuração antiga/ruim
- seed não corrige
- apagar DB "parece resolver"

#### H2) `IaChatView` lê configuração uma vez só e não revalida após salvar

`IaChatView` busca config no `useEffect([])`:

- `src/renderer/src/componentes/IaChatView.tsx:64-68`

Isso significa:
- se usuário muda provider/token em Configurações
- o painel já montado pode ficar com estado `configurado` stale

Esse comportamento dá cara de "configuração eterna" / "só atualiza reiniciando".

#### H3) Mistura de campo legado (`api_key`) + `provider_configs_json`

A compatibilidade foi adicionada, mas ainda há pontos da UI/chat lendo apenas `api_key`.

Referências:

- DDL com `provider_configs_json`: `src/main/db/schema.ts:253-262`
- save config com compat: `src/main/tipc.ts:2758-2772`
- leitura normalizada: `src/main/tipc.ts:2472-2477`

### O que já foi feito que ajuda

- `provider_configs_json` adicionado com migration idempotente
- save/load de config já normaliza JSON
- `OpenRouter` runtime e catálogo já implementados

### O que ainda falta para estabilizar

1. refresh de status/config no painel IA após salvar config
2. invalidar/reatualizar `configurado` ao trocar provider/token
3. instrumento de debug (log de config efetiva usada pelo chat)
4. seed strategy sem credencial hardcoded

### Status

- **RESOLVIDO (2026-02-22)**
- **H1 (seed stale):** upsert no seed-local — se key difere, atualiza automaticamente
- **H2 (config stale no chat):** `IaChatView` agora escuta evento `ia-config-changed` disparado por `ConfiguracoesPagina` após salvar — refresh instantâneo sem recarregar app
- **H3 (dual storage api_key vs provider_configs):** `resolveProviderApiKey()` em `cliente.ts` resolve key do lugar certo por provider

---

## ISSUE 5 - UI da lista/config de IAs (especialmente OpenRouter) está feia/jogada

### Sintoma reportado

- layout "tosco"
- botões de atualizar/filtros/listagem sem hierarchy
- visual pouco aproveitado apesar do catálogo dinâmico estar funcionando

### Diagnóstico de produto/UI

A implementação atual ficou boa para **provar backend/integração**, mas ruim para UX:

- tudo concentrado num card denso
- seleção de modelo + metadata + config + token no mesmo fluxo visual
- sem search/tabs/lista rolável de modelos
- sem destaque de grupos (`free`, `tools`, `favorites`)

### Evidência no código atual (EscalaFlow)

- `src/renderer/src/paginas/ConfiguracoesPagina.tsx:627+`
- botão "Carregar modelos reais": `src/renderer/src/paginas/ConfiguracoesPagina.tsx:783`
- badges metadata no próprio formulário: `src/renderer/src/paginas/ConfiguracoesPagina.tsx:799`

### Estudo do Command Center (confirmado)

Sim, o Command Center **já tem** exatamente a inteligência/UX que você citou:

- fetch realtime OpenRouter:
  - `/Users/marcofernandes/commandflow/command-center-main/src/app/api/openrouter/models/route.ts:58`
- metadados `free` e `supportsTools`:
  - `/Users/marcofernandes/commandflow/command-center-main/src/hooks/useOpenRouterModels.ts:50`
  - `/Users/marcofernandes/commandflow/command-center-main/src/hooks/useOpenRouterModels.ts:56`
- UI com tabs/filtros/lista:
  - `/Users/marcofernandes/commandflow/command-center-main/src/components/features/settings/ModelsConfig.tsx:138`
  - tabs `favorites/tools/free/all`
  - busca
  - lista rolável
- model selector agrupado:
  - `/Users/marcofernandes/commandflow/command-center-main/src/components/features/chat/ModelSelector.tsx:149`

### Conclusão

Não é falta de referência.  
É uma **versão POC funcional** ainda não refatorada para uma UX de catálogo decente.

### Spec recomendada

**SPEC-AI-MODEL-CATALOG-UX**

Escopo sugerido:
- componente dedicado `IaModelCatalogPicker`
- tabs: `Selecionados | Com Tools | Gratuitos | Todos`
- busca
- lista rolável com virtualização opcional
- estado de loading/error/refresh
- metadata clara (preço, ctx, tools, agentic)
- seleção persistida por provider

---

## ISSUE 6 - Sidebar do chat IA quebrando layout/posição/resize (principalmente em Configurações)

### Sintomas reportados

- abre desconfigurada
- vazio preto
- não redimensiona direito
- conteúdo "entra" na sidebar esquerda
- às vezes parece fixo, às vezes quebra ao rolar
- piora na página de Configurações

### Diagnóstico (provável) - bug estrutural de layout/scroll

#### Arquitetura atual (relevante)

- `App`:
  - `main` com `overflow-auto`
  - `IaChatPanel` como sibling no mesmo row
  - `src/renderer/src/App.tsx:63-90`

- `IaChatPanel`:
  - painel absoluto + rail + transform
  - gap reservado com width animada
  - `src/renderer/src/componentes/IaChatPanel.tsx:20-69`

- páginas (ex.: Configurações):
  - containers internos também usam `overflow-y-auto`
  - cria **scroll nested**

#### Hipóteses técnicas fortes

##### H1) Nested scroll containers (principal causa)

`main` já tem `overflow-auto` (`App.tsx:67`) e `ConfiguracoesPagina` também usa:

- `src/renderer/src/paginas/ConfiguracoesPagina.tsx` (wrapper com `overflow-y-auto`)

Isso causa:
- confusão de altura disponível (`h-full`/`min-h-0`)
- painel lateral preso no container "errado"
- descompasso entre área visível e área rolada

##### H2) Painel absoluto + transform em contexto com scroll variável

`IaChatPanel` usa `aside` absoluto com `transform`:

- `src/renderer/src/componentes/IaChatPanel.tsx:36-45`

Se o parent/layout muda de size após render (especialmente em pages pesadas como Configurações), o painel pode:
- aparecer sobreposto
- abrir com "vazio" até recalcular

##### H3) Inicialização lazy do painel + medição tardia

O store inicializa só quando abre:

- `src/renderer/src/componentes/IaChatPanel.tsx:14-18`
- `src/renderer/src/store/iaStore.ts:72+`

Se a abertura acontece após scroll profundo / layout já alterado, a primeira render pode nascer em estado inconsistente.

##### H4) ScrollArea interno sem reflow após abrir

`IaChatView` usa `ScrollArea` e scroll-to-bottom automático:

- `src/renderer/src/componentes/IaChatView.tsx:160`
- `src/renderer/src/componentes/IaChatView.tsx:70-72`

Abrir painel + enviar mensagem + resize simultâneo pode causar glitch visual de viewport (preto/vazio temporário).

### O que já foi tentado

- "gambiarra" para deixar o chat aparentemente fixo
- ajustes de overflow/min-w em alguns pontos
- ainda instável

### O que falta (abordagem correta)

Não é patch isolado; precisa de spec de layout:

1. Definir **um único scroll owner** da área principal
2. Fixar contrato de altura (`h-svh`, `min-h-0`, `overflow-hidden`) por camada
3. Tornar `IaChatPanel` previsível com relação ao container pai
4. Revalidar em páginas longas (`Configurações`, listas, detalhes)

### Spec recomendada

**SPEC-IA-SIDEBAR-LAYOUT-STABILITY**

Escopo:
- auditoria de containers e scroll owners
- layout contract do shell (`App`, `SidebarInset`, `main`, páginas)
- comportamento de abertura/fechamento do painel
- tests manuais por página crítica
- correção do "black empty state" e resize

---

## Bugs reais vs. comportamentos não implementados (para não misturar no backlog)

### Bugs reais (corrigir)

- ~~Gemini key vazada/bloqueada no seed (credencial inválida)~~ ✅
- ~~`IaChatView` gating Gemini-only (`api_key`) quebrando `Codex/Claude` login mode~~ ✅
- ~~estado stale de config no painel IA (provável causa do "configurar eterno")~~ ✅
- layout/scroll da sidebar IA instável
- UX visual de catálogo/modelos (POC funcional, UX ruim)

### Não implementado (feature pendente)

- runtime do chat RH via `Codex CLI`
- runtime do chat RH via `Claude Code CLI`

---

## Proposta de recorte em specs separadas (recomendado)

1. ~~**SPEC-AI-SECRETS-AND-SEED-STRATEGY**~~ ✅ Resolvido inline (seed-local upsert)

2. ~~**SPEC-AI-CONFIG-STATE-SYNC-E-PERSISTENCIA**~~ ✅ Resolvido inline (evento ia-config-changed + resolveProviderApiKey)

3. ~~**SPEC-AI-CHAT-GATING-MULTIPROVIDER**~~ ✅ Resolvido inline (gating multi-provider + empty state genérica)

4. **SPEC-AI-MODEL-CATALOG-UX** 🔧 EM PROGRESSO (outra sessão)
   - UI estilo Command Center (tabs/busca/lista/filtros)
   - favoritos por provider (opcional)
   - UX decente para OpenRouter

5. ~~**SPEC-IA-SIDEBAR-LAYOUT-STABILITY**~~ ✅ Resolvido — Layout Contract implementado no CLAUDE.md + App.tsx/IaChatPanel/IaChatView refatorados (scroll owner único em `main`, width animation sem absolute, ScrollArea targeted)

6. ~~**SPEC-CLI-RUNTIME-PROVIDERS (Codex/Claude)**~~ ❌ DESCARTADO — Complexidade CLI (PTY/MCP/JSONL bridging) inviável para o ROI. Código CLI removido (~700 linhas tipc.ts + UI). Providers simplificados para Gemini + OpenRouter. Se no futuro quiser Anthropic/OpenAI direto, basta `@ai-sdk/anthropic` + `@ai-sdk/openai` (~50 linhas via API direta).

---

## Ações imediatas sugeridas (hotfixes antes das specs grandes)

### ~~Hotfix 1~~ ✅ APLICADO

- `IaChatView.tsx`: gating multi-provider + empty state genérica + indicador de modelo no input

### ~~Hotfix 2~~ ✅ APLICADO

- `seed.ts` já estava limpo (sessão anterior)
- `seed-local.ts`: key atualizada + upsert automático

### ~~Hotfix 3~~ ✅ APLICADO (via resolveProviderApiKey)

- `cliente.ts`: `resolveProviderApiKey()` resolve key do `provider_configs_json` correto
- Config stale resolvido via evento `ia-config-changed` entre Configurações e Chat

---

## Notas de segurança (importante)

As chaves compartilhadas em conversa/chat devem ser tratadas como **comprometidas**.

### Recomendação

- Rotacionar **Gemini** (obrigatório, já foi marcada como leaked)
- Rotacionar **OpenRouter** também (foi exposta em texto/screenshot)
- Não persistir credenciais reais em seed versionado

---

## Referências principais (EscalaFlow)

- Config IA DDL: `src/main/db/schema.ts:253`
- Seed IA: `src/main/db/seed.ts:816`
- Save/load config IA: `src/main/tipc.ts:2753`
- Catálogo dinâmico modelos: `src/main/tipc.ts:2480`
- OpenRouter runtime chat RH: `src/main/ia/cliente.ts:181`
- Gating legado do chat (bug): `src/renderer/src/componentes/IaChatView.tsx:65`
- Mensagem "API Key faltando" (bug): `src/renderer/src/componentes/IaChatView.tsx:80`
- Sidebar IA layout base: `src/renderer/src/componentes/IaChatPanel.tsx:20`
- Shell app/layout: `src/renderer/src/App.tsx:63`

## Referências de UX (Command Center)

- OpenRouter realtime + cache: `/Users/marcofernandes/commandflow/command-center-main/src/app/api/openrouter/models/route.ts:58`
- Enriquecimento `free/tools`: `/Users/marcofernandes/commandflow/command-center-main/src/hooks/useOpenRouterModels.ts:50`
- UI de catálogo com tabs/busca/lista: `/Users/marcofernandes/commandflow/command-center-main/src/components/features/settings/ModelsConfig.tsx:138`
- Dropdown selector com agrupamento: `/Users/marcofernandes/commandflow/command-center-main/src/components/features/chat/ModelSelector.tsx:149`

