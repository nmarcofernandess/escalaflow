# FlowAI (Planejamento e Operacao do Tool Calling)

## Objetivo

Esta pasta centraliza a documentacao operacional e o plano de evolucao do sistema de IA/tool calling do EscalaFlow.

Ela complementa (nao substitui) a documentacao ja existente em:

- `docs/IA_TOOLCALLING_INTELLIGENCE.md`
- `docs/IA_TOOLCALLS_UI_RUNTIME_FLOW.md`
- `docs/flowia/` (fluxos especificos ja documentados, ex: cadastro em massa)

## Nota de nomenclatura (`flowia` vs `flowai`)

O projeto ja possui `docs/flowia/` (legado de fluxos). Esta pasta `docs/flowai/` foi criada para organizar:

- arquitetura do sistema de calling
- contrato para a IA (o que sabe / pode / nao pode)
- plano de evolucao tecnico
- estrategia de testes, evals e observabilidade

Recomendacao futura: consolidar os nomes em uma unica convencao, sem quebrar links antigos.

## Arquivos

| Arquivo | Objetivo |
|---|---|
| `SISTEMA_TOOL_CALLING_ATUAL_E_GUIA_IA.md` | Mapa do sistema atual, gaps, acesso/knowledge que a IA precisa e taxonomia de tools recomendada |
| `CATALOGO_TARGET_TOOLS_IA.md` | Catalogo teorico completo de tools target (P0/P1/P2/P3), consolidado com double-check no doc canonico |
| `PLANO_EVOLUCAO_TOOL_CALLING_E_TESTES.md` | Plano faseado de evolucao (arquitetura, tools, runtime, observabilidade, testes, CI) |
| `STATUS_EXECUCAO_FASES.md` | Snapshot do que ja foi implementado vs pendencias por fase |
| `DEVTOOLS_E_EVALS_RUNBOOK.md` | Como usar AI SDK DevTools, eval batch DIY e smoke live no projeto |
| `PROMPT_DEEP_DIVE_SISTEMA.md` | Roteiro de estudo profundo do sistema (apoio para analise/documentacao) |

## Como usar

1. Ler `SISTEMA_TOOL_CALLING_ATUAL_E_GUIA_IA.md` para alinhar entendimento tecnico e de dominio.
2. Usar `CATALOGO_TARGET_TOOLS_IA.md` como referencia oficial de "quais tools precisamos" (teoria completa + prioridades).
3. Executar o backlog por fases em `PLANO_EVOLUCAO_TOOL_CALLING_E_TESTES.md` (implementacao por ondas).
4. Manter `docs/flowia/*.md` para fluxos de negocio especificos (ex: importacao, ajustes, etc).

## Estado atual (consciencia de escopo)

Status de execucao (resumo rapido):

- `Fase 1` (fundacao de testes): concluida
- `Fase 2` (contrato das tools + `.describe()` + padronizacao): core concluido
- `Fase 3` (discovery + prompt + historico): **muito avancada (core implementado)**
- `Fase 4` (tools semanticas): **concluida no escopo revisado** (tools inteligentes, sem wrappers CRUD redundantes) + **Onda 2 parcial adiantada**
- `Fase 6/7` (infra de DevTools/evals/smoke): iniciada e funcional
- Catalogo teorico target de tools (double-check com doc canonico): consolidado em `CATALOGO_TARGET_TOOLS_IA.md`

Importante:

- O plano completo **nao** foi finalizado ainda.
- A `Fase 3` avancou do incremental para o estrutural:
  - historico do modelo com resumo compacto de tool calls
  - `SYSTEM_PROMPT` reescrito e depois expandido para refletir tools/fluxos reais (registry atual)
  - overlay de runtime removido (prompt novo virou a fonte principal)
  - eval batch local evoluiu para cenarios reais e esta verde (20/20 no batch atual)
- A `Fase 4` foi fechada no escopo revisado:
  - registry da IA mantido **abaixo do teto (28/30 tools)**
  - wrappers redundantes removidas (CRUD/read simples ficam nas genericas)
  - prompt sincronizado com as semanticas reais + diretriz "genericas primeiro"
  - Onda 2 parcial ja implementada (demanda por data, perfis, alertas, KPI, reset)
- Ainda pode haver refinamento apos review funcional do operador (fluxos reais do sistema).
- Durante essa pausa, foi avancada infraestrutura que nao depende do redesign do prompt:
  - DevTools local (AI SDK)
  - eval batch DIY
  - smoke live
  - testes e contratos de tools

Para status detalhado e pendencias por fase, ver:

- `STATUS_EXECUCAO_FASES.md`
