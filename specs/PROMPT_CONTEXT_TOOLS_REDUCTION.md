# PROMPT: Spec de Context Unificado + Redução de Tools (Phase 0)

## Contexto

Tu é a Monday, trabalhando no EscalaFlow — app desktop offline de escalas de trabalho pra supermercado.
Leia CLAUDE.md (`.claude/CLAUDE.md`) antes de qualquer coisa.

## O que é o EscalaFlow em 30 segundos

App Electron offline que gera escalas de trabalho automaticamente. Tem:
- **Motor Python** (OR-Tools CP-SAT) — gera escalas com 35 regras CLT
- **Preview TS** (`simula-ciclo.ts`) — simulação rápida de ciclo de folgas
- **IA integrada** — Chat RH com 33 tools (Vercel AI SDK + Gemini)
- **Discovery** (`discovery.ts`) — auto-contexto injetado em cada mensagem da IA

Docs pra ler ANTES de começar:
- `docs/como-funciona.md` — pipeline completo (preview → solver → validador)
- `docs/superpowers/specs/2026-03-21-observabilidade-sugestao-inteligente-design.md` — spec mãe (esta spec é a Phase 0 dela)
- `specs/gestao-specs.md` — índice de specs

## O Problema

A IA do EscalaFlow tem 33 tools e um discovery com 13 categorias de dados. Mas:

1. **O preview TS é invisível pra IA** — O discovery (`discovery.ts`) não injeta dados do preview (ciclo de folgas, cobertura por dia, déficit). A IA responde "tá ok" quando o preview mostra 2/4 de cobertura.

2. **Tools redundantes** — Várias tools existem PORQUE o context não tinha a info. Ex: `listar_perfis_horario` retorna dados que raramente mudam e poderiam estar no context. Cada tool é um round-trip (IA decide → chama → recebe → responde).

3. **Dev sem visibilidade** — O dev não tem como ver o que a IA vê. Não existe `--context` na CLI pra dumpar o briefing do discovery.

## Objetivo

Criar spec de **Phase 0** que:
1. Expande o discovery com preview e dados que hoje só existem em tools
2. Reduz tools de 33 → ~28-30 movendo info pro context e consolidando pares
3. Cria flag `--context` no CLI pra dev ver o que a IA vê

## Tarefas Concretas

### 1. Mapear o discovery atual

Lê `src/main/ia/discovery.ts` e lista TODAS as 13 categorias de dados injetadas. Pra cada uma:
- O que injeta (resumo)
- Tamanho estimado em tokens
- De onde vem (query DB? cálculo? estado React?)

### 2. Mapear as 33 tools

Lê `src/main/ia/tools.ts` e lista TODAS as 33 tools. Pra cada uma:
- Nome
- O que faz (1 linha)
- É AÇÃO (modifica dados) ou CONSULTA (read-only)?
- Se CONSULTA: a info poderia estar no context? Por que sim/não?
- Frequência estimada de uso (alta/média/baixa/rara) — inferir do system prompt e dos workflows descritos em `docs/como-funciona.md`

### 3. Propor expansão do discovery

Com base no mapeamento, propor QUAIS dados novos devem entrar no discovery:

**Obrigatório (já definido na spec mãe):**
- Preview do ciclo (`buildPreviewBriefing`) — cobertura por dia, déficit, folgas
- Perfis de horário do setor (hoje é tool `listar_perfis_horario`)

**Avaliar caso a caso:**
- Títulos da knowledge base (hoje é tool `listar_conhecimento`)
- Preflight básico (colaboradores suficientes? demanda cadastrada?) — hoje é tool `preflight`
- Regras editáveis com status atual (hoje é parcial no discovery, completo via `consultar`)

Pra cada proposta: estimar impacto em tokens e justificar.

### 4. Propor redução de tools

Com base no mapeamento, propor QUAIS tools eliminar/consolidar:

**Critérios:**
- Se a info vai pro context → tool vira redundante → ELIMINAR
- Se 2 tools fazem coisa parecida → CONSOLIDAR em 1
- Se a tool é AÇÃO (escrita) → MANTER (context é read-only)
- Se a tool é rara mas necessária → MANTER

**Já levantado (validar/expandir):**

| Candidata | Proposta | Validar |
|-----------|----------|---------|
| `listar_perfis_horario` | → context | Perfis mudam tão raramente que context é melhor? |
| `listar_conhecimento` | → context | Stats já estão no context, títulos são poucos? |
| `preflight` + `preflight_completo` | Consolidar em 1 | Flag `detalhado` resolve? |
| `ajustar_alocacao` + `ajustar_horario` | Avaliar consolidação | São ações diferentes demais? |
| `explicar_violacao` | Melhorar RAG | CLT é estática, knowledge/clt/ já tem os docs |

### 5. CLI --context

Definir flag `--context` no `scripts/preview-cli.ts` (a ser criado) que:
- Roda `buildContextBriefing()` do discovery.ts pra um setor específico
- Dumpa o Markdown completo que a IA receberia
- Dev vê EXATAMENTE o que a IA vê

### 6. Escrever a spec

Usar `/brainstorming` do Superpowers pra refinar com o Marco e depois escrever em `docs/superpowers/specs/2026-03-21-context-tools-reduction-design.md`.

A spec deve:
- Listar CADA tool com decisão (manter/context/consolidar/matar) e justificativa
- Listar CADA expansão do discovery com impacto em tokens
- Ter critérios de sucesso mensuráveis
- Referenciar a spec mãe (`2026-03-21-observabilidade-sugestao-inteligente-design.md`)

## Arquivos Relevantes

| Arquivo | O que tem |
|---------|----------|
| `src/main/ia/discovery.ts` | Auto-contexto — 13 categorias injetadas por mensagem |
| `src/main/ia/tools.ts` | 33 tools com Zod schemas + handlers |
| `src/main/ia/system-prompt.ts` | System prompt da IA (460 linhas, 8 seções) |
| `src/shared/simula-ciclo.ts` | Preview TS — `gerarCicloFase1`, `pickBestFolgaDay` |
| `docs/como-funciona.md` | Pipeline completo (preview → solver → validador) |
| `docs/superpowers/specs/2026-03-21-observabilidade-sugestao-inteligente-design.md` | Spec mãe |
| `specs/gestao-specs.md` | Índice de specs |

## Critérios de Sucesso

1. Mapeamento completo: 13 categorias discovery + 33 tools documentadas
2. Proposta clara: quais tools viram context, quais consolidam, quais ficam
3. Estimativa de tokens: impacto da expansão do discovery
4. Nenhuma tool de AÇÃO eliminada (só consultas redundantes)
5. Flag `--context` especificada
6. Spec escrita e commitada

## Regras

- `npm run typecheck` PASSA antes de qualquer commit
- NÃO implementar nada — só especificar. A implementação vem no plan.
- Perguntar ao Marco quando tiver dúvida de produto (ele sabe o que o RH usa)
- Usar `/brainstorming` do Superpowers pro fluxo de design
