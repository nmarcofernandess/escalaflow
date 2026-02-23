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
| `PLANO_EVOLUCAO_TOOL_CALLING_E_TESTES.md` | Plano faseado de evolucao (arquitetura, tools, runtime, observabilidade, testes, CI) |

## Como usar

1. Ler `SISTEMA_TOOL_CALLING_ATUAL_E_GUIA_IA.md` para alinhar entendimento tecnico e de dominio.
2. Executar o backlog por fases em `PLANO_EVOLUCAO_TOOL_CALLING_E_TESTES.md`.
3. Manter `docs/flowia/*.md` para fluxos de negocio especificos (ex: importacao, ajustes, etc).

