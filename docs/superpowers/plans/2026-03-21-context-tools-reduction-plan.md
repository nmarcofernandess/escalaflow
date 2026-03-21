# Context Unificado + Reducao de Tools — Plano de Implementacao

> **Spec:** `docs/superpowers/specs/2026-03-21-context-tools-reduction-design.md`
> **Data:** 2026-03-21
> **Autor:** Monday (PCO)
> **Status:** Em execucao

---

## Objetivo Estrategico

Tornar a IA do EscalaFlow context-first de verdade:
- IA enxerga preview, contratos, knowledge catalog, escala resumida SEM tool call
- CLI `preview:cli --context` permite dev inspecionar o mesmo contexto
- CLI `ia:chat` vira harness real (init DB + inject context)
- Surface cai de 33 para 30 tools

---

## Etapas

### Etapa 1: buildContextBundle() + renderContextBriefing()

**Arquivo:** `src/main/ia/discovery.ts`

**O que fazer:**
1. Extrair a logica do `buildContextBriefing()` atual em duas funcoes:
   - `buildContextBundle(contexto, mensagem?)` → retorna objeto estruturado `ContextBundle`
   - `renderContextBriefing(bundle)` → transforma bundle em markdown string
2. `buildContextBriefing()` vira wrapper: `renderContextBriefing(await buildContextBundle(contexto, msg))`
3. Zero breaking change: quem chama `buildContextBriefing` continua funcionando

**Tipo `ContextBundle`:**
```ts
interface ContextBundle {
  rota: string
  memorias?: string
  rag?: string
  global: {
    setores: number
    colaboradores: number
    rascunhos: number
    oficiais: number
  }
  feriados_proximos?: Array<{ data: string; nome: string; proibido: boolean }>
  regras_custom?: Array<{ codigo: string; nome: string; de: string; para: string }>
  setores_lista?: Array<{ id: number; nome: string; horario: string; colabs: number }>
  setor?: SetorBundle  // nova secao rica
  colaborador?: ColaboradorBundle
  snapshot?: Record<string, any>
  alertas?: string
  alertas_backup?: string
  knowledge_catalogo?: KnowledgeCatalogo
  dica_pagina?: string
}
```

**Criterio de aceite:**
- `buildContextBriefing()` retorna o MESMO markdown de antes (backward compat)
- `buildContextBundle()` retorna objeto testavel
- Tipo `ContextBundle` exportado em `discovery.ts`

---

### Etapa 2: Enriquecer o bundle de setor com preview + contratos + escala

**Arquivo:** `src/main/ia/discovery.ts`

**O que fazer:**
1. Adicionar `preview` ao `SetorBundle`:
   - Importar `gerarCicloFase1` de `src/shared/simula-ciclo.ts`
   - Montar input a partir de dados do DB (mesmo que SetorDetalhe.tsx faz)
   - Rodar `gerarCicloFase1()` server-side
   - Extrair: ciclo, cobertura_por_dia, deficit_por_dia, ff/fv, warnings
2. Adicionar `contratos_relevantes` com perfis embutidos:
   - Query contratos usados pelos colaboradores do setor
   - JOIN com `contrato_perfis_horario`
   - Embutir perfis dentro de cada contrato
3. Enriquecer `knowledge_catalogo`:
   - Total fontes, total chunks, top 5 titulos
4. Renderizar novas secoes no `renderContextBriefing()`:
   - `### Preview de Ciclo` — cobertura, deficit, ciclo, ff/fv, warnings
   - `### Contratos Relevantes` — com perfis embutidos
   - `### Base de Conhecimento` — stats + titulos top

**Queries necessarias para preview (replicar do SetorDetalhe.tsx):**
- Colaboradores do setor com regras de horario (folga_fixa, folga_variavel, tipo_trabalhador)
- Funcoes/postos do setor
- Demandas do setor

**Criterio de aceite:**
- Preview aparece no briefing quando setor_id presente
- Contratos com perfis embutidos substituem necessidade de `listar_perfis_horario`
- Knowledge catalogo com titulos top substitui necessidade de `listar_conhecimento`
- Token budget: preview ~150-220 tokens, contratos ~60-120 tokens, knowledge ~50-100 tokens

---

### Etapa 3: Consolidar preflight_completo em preflight

**Arquivos:** `src/main/ia/tools.ts`

**O que fazer:**
1. Adicionar parametro opcional `detalhado?: boolean` ao schema `PreflightSchema`
2. No handler `executeTool('preflight')`:
   - Se `detalhado=true`, rodar a logica que hoje esta em `preflight_completo`
3. Remover `preflight_completo` do array `IA_TOOLS`
4. Remover `preflight_completo` do `TOOL_SCHEMAS`
5. Manter o handler de `preflight_completo` no `executeTool` como redirect interno:
   - Se alguem chama `preflight_completo`, redireciona para `preflight` com `detalhado=true`
   - Isso protege contra LLMs que cachearam o nome antigo
6. Grep por `preflight_completo` em todo o codebase e atualizar referencias

**Criterio de aceite:**
- `IA_TOOLS` tem 32 entries (33 - 1)
- `preflight({ setor_id: 4, detalhado: true })` retorna o mesmo que antigo `preflight_completo`
- `preflight({ setor_id: 4 })` retorna o mesmo que antes (sem detalhado)

---

### Etapa 4: Remover listar_perfis_horario e listar_conhecimento

**Arquivos:** `src/main/ia/tools.ts`

**O que fazer:**
1. Remover `listar_perfis_horario` do array `IA_TOOLS`
2. Remover `listar_perfis_horario` do `TOOL_SCHEMAS`
3. Manter o handler no `executeTool` como fallback silencioso (retorna toolOk com hint "use o contexto")
4. Remover `listar_conhecimento` do array `IA_TOOLS`
5. Remover `listar_conhecimento` do `TOOL_SCHEMAS`
6. Manter handler como fallback silencioso
7. Grep por ambos nomes em correction messages e descriptions de outras tools — atualizar

**Referencias conhecidas para limpar:**
- `salvar_perfil_horario` description: "Use listar_perfis_horario para ver os IDs válidos"
- `deletar_perfil_horario` description: idem
- Descriptions em IA_TOOLS que mencionem essas tools

**Criterio de aceite:**
- `IA_TOOLS` tem 30 entries (32 - 2)
- `TOOL_SCHEMAS` tem 30 entries (excluindo os 3 removidos do surface)
- Nenhuma description de tool restante referencia tool removida

---

### Etapa 5: Criar scripts/preview-cli.ts

**Arquivo:** `scripts/preview-cli.ts` (novo)

**O que fazer:**
1. Estrutura analoga ao `solver-cli.ts`:
   - Mesmo pattern de init (ESCALAFLOW_DB_PATH, initDb, createTables)
   - Mesmo pattern de parse args (positional + flags)
   - Mesmo pattern de list (listar setores)
2. Modo default: rodar preview e exibir rich output
   - Grid T/F por posto x semana
   - Cobertura por dia
   - Stats do ciclo
3. Flag `--context`: rodar `buildContextBundle()` + `renderContextBriefing()` e imprimir markdown
4. Flag `--json`: rodar preview e imprimir JSON do resultado
5. Adicionar script no package.json: `"preview:cli": "ELECTRON_RUN_AS_NODE=1 ..."`

**Criterio de aceite:**
- `npm run preview:cli -- list` lista setores
- `npm run preview:cli -- 4` mostra grid + cobertura + stats
- `npm run preview:cli -- 4 --context` mostra briefing completo em markdown
- `npm run preview:cli -- 4 --json` mostra JSON do preview

---

### Etapa 6: Corrigir ia-chat-cli.ts

**Arquivo:** `tests/ia/live/ia-chat-cli.ts`

**O que fazer:**
1. Adicionar `initDb()` + `createTables()` antes de carregar runtime
   - Mesmo pattern do solver-cli (ESCALAFLOW_DB_PATH)
2. Adicionar flags: `--setor <id>`, `--pagina <pagina>`
3. Montar `IaContexto` sintetico a partir das flags
4. Chamar `buildContextBriefing()` com esse contexto
5. Concatenar briefing ao system prompt antes de enviar pro LLM
6. Mostrar quantas tools e tamanho do context na header
7. Importar `initDb` e `createTables` (nao so `buildContextBriefing`)

**Criterio de aceite:**
- `npm run ia:chat -- --provider gemini --setor 4` nao da "DB not initialized"
- O LLM recebe o context briefing real do setor 4
- Tool calls funcionam (DB inicializado antes)
- Perguntas como "tem deficit em algum dia?" sao respondidas sem chamar tool de listagem

---

### Etapa 7: Atualizar system-prompt e docs

**Arquivos:**
- `src/main/ia/system-prompt.ts` — atualizar contagem de tools (33→30)
- `docs/ia-sistema.md` — atualizar contagem e remover tools eliminadas
- CLAUDE.md do projeto — atualizar contagem

**Criterio de aceite:**
- Nenhuma referencia a "33 tools" ou "34 tools" no codebase (exceto historico/git)
- System prompt nao menciona tools removidas

---

### Etapa 8: Typecheck + testes CLI

**O que fazer:**
1. `npm run typecheck` — zero errors
2. `npm run preview:cli -- list` — lista setores
3. `npm run preview:cli -- 4` — preview Padaria
4. `npm run preview:cli -- 4 --context` — briefing completo
5. `npm run ia:chat -- --provider gemini --setor 4` com prompts:
   - "a distribuicao de folgas da padaria esta boa?"
   - "tem deficit em algum dia no setor?"
   - "quais contratos do setor usam perfil especifico?"
   - "quais pessoas estao fora do posto?"

**Criterio de aceite:**
- Typecheck passa
- Preview CLI funciona com dados reais
- IA responde usando context (sem chamar listar_perfis_horario, listar_conhecimento, preflight_completo)

---

## Riscos e Mitigacoes

| # | Risco | Impacto | Contramedida |
|---|-------|---------|--------------|
| 1 | Preview server-side precisa de dados que so existem no snapshot React | IA fica sem preview | Replicar queries do SetorDetalhe no discovery (dados vem do DB, nao do React) |
| 2 | Remover tools quebra references em correction messages | IA sugere tool morta | Grep exaustivo + limpeza |
| 3 | ia-chat-cli com initDb cria banco vazio | Testa contra banco vazio | Reusar pattern solver-cli (ESCALAFLOW_DB_PATH) |
| 4 | Context bundle >2000 tokens | Token waste | Budget caps por secao |
| 5 | gerarCicloFase1 importa codigo React | Crash Node | simula-ciclo.ts e shared puro (verificado) |
| 6 | LLM cacheou nome preflight_completo | Tool nao encontrada | Manter handler com redirect silencioso |

---

## Rollback

Se qualquer etapa quebrar:
- Etapas 1-2: revert discovery.ts (buildContextBriefing wrapper garante backward compat)
- Etapas 3-4: re-adicionar tools ao IA_TOOLS array (handlers continuam existindo)
- Etapa 5: deletar preview-cli.ts e remover script do package.json
- Etapa 6: revert ia-chat-cli.ts
- Etapa 7: revert docs

Nenhuma etapa tem side effect irreversivel.

---

## Definition of Done

- [ ] `buildContextBundle()` existe e retorna objeto estruturado
- [ ] `renderContextBriefing()` usa bundle e gera markdown
- [ ] Preview TS no briefing do setor
- [ ] Contratos com perfis embutidos no briefing
- [ ] Knowledge catalogo no briefing
- [ ] `IA_TOOLS.length === 30`
- [ ] `npm run preview:cli -- 4 --context` funciona
- [ ] `npm run ia:chat -- --provider gemini --setor 4` funciona com DB real
- [ ] `npm run typecheck` passa
- [ ] Cenarios de prompt testados e documentados
