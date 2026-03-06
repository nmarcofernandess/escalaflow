# FlowAI — Documentacao do Sistema de IA do EscalaFlow

> **Atualizado:** 2026-02-24 | **Tools:** 30 | **tsc:** 0 erros

## Estado atual

- **30 tools** no registry (teto de 30 atingido)
- System prompt com 9 secoes (~370 linhas)
- Discovery automatico por request (feriados, regras, excecoes, alertas)
- Multi-turn com tools no follow-up
- Knowledge Layer (4 tools: buscar, salvar, listar, explorar relacoes)
- TOOL_RESULT_MAX_CHARS = 1500 com smart truncation (preserva summary + _meta)

## Arquivos — Referencia Operacional

| Arquivo | O que e | Quando usar |
|---------|---------|-------------|
| `MAPA_TOOLS_FINAL.md` | **Mapa das 30 tools** — categorias, whitelists, cobertura, gaps | Referencia primaria de "quais tools existem e o que cobrem" |
| `TOOL_CALLING_PLAYBOOK.md` | **Guia reproduzivel** — patterns, stack, discovery, testes, prompts | Replicar a estrategia em outro projeto ou onboarding |
| `RESUMO_ABA_USUARIO_VS_IA.md` | **Aba Resumo (Ver tudo)** — o que o usuario ve vs dados internos; mapeamento para a IA usar o mesmo vocabulario | Fallback multi-turn, respostas sobre escala, tools que retornam indicadores |
| `STATUS_EXECUCAO_FASES.md` | **Tracker de fases** — o que foi feito, pendencias, proximos passos | Saber estado de implementacao e o que falta |
| `AUDIT-IA-TOOLS-v33.md` | **Auditoria v2** — 7 burrices, TOSCOs, GAPs (com status RESOLVIDO) | Revisao de qualidade e divida tecnica |

## Arquivos — Specs e Planos

| Arquivo | O que e | Status |
|---------|---------|--------|
| `SPEC-REGRA-HORARIO-DIA-SEMANA.md` | Spec para regra de horario por dia da semana | PENDENTE |
| `SPEC_REWRITE_SYSTEM_PROMPT.md` | Spec da reescrita do system prompt | CONCLUIDA |
| `SPEC_REVISAO_POS_GERACAO.md` | Spec de revisao pos-geracao de escala | CONCLUIDA |
| `CATALOGO_TARGET_TOOLS_IA.md` | Catalogo teorico completo de tools target (P0-P3) | Referencia / backlog futuro |
| `PLANO_EVOLUCAO_TOOL_CALLING_E_TESTES.md` | Plano faseado de evolucao (arquitetura, tools, runtime) | Parcialmente executado |

## Arquivos — Analise e Estudo (nao mexer)

| Arquivo | O que e |
|---------|---------|
| `COMO_O_SISTEMA_FUNCIONA.md` | Mapa completo do sistema (80 handlers, gaps, recomendacoes) |
| `RESEARCH-RAG-MEMORY-PATTERNS.md` | Pesquisa sobre RAG e memory patterns |
| `PROMPT_DEEP_DIVE_SISTEMA.md` | Roteiro de estudo profundo do sistema |
| `DIRETRIZ_TOOLS_INTELIGENTES.md` | Diretriz de quando criar tool semantica vs usar generica |
| `DEVTOOLS_E_EVALS_RUNBOOK.md` | Como usar AI SDK DevTools, eval batch e smoke live |

## Historico de mudancas

| Data | Mudanca |
|------|---------|
| 2026-02-24 | **Cleanup v2**: 33→30 tools (removidas get_context, obter_regra_horario_colaborador, obter_regras_horario_setor). 5 burrices corrigidas. 2 deduplicacoes. Docs atualizados. |
| 2026-02-23 | Knowledge Layer: +4 tools (buscar/salvar/listar conhecimento, explorar relacoes). PGlite migration. |
| 2026-02-23 | System prompt rewrite (9 secoes). Tools Wave 3 (23→28→32 tools). |
| 2026-02-23 | Auditoria v2 cross-reference com TOOL_CALLING_PLAYBOOK. |
