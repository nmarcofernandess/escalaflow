# Gestao de Specs — EscalaFlow

> **Como uso:** Cada spec passa pelo fluxo Superpowers: brainstorming → design → spec review → writing-plans → execution.
> Sempre usar as skills do Superpowers nas etapas (`/brainstorming`, `/write-plan`, `/execute-plan`, `/simplify`, `/verification-before-completion`).
> Specs moram em `docs/superpowers/specs/`. Plans moram em `docs/superpowers/plans/`.

---

## Specs Ativas

### Phase 0 — Context Unificado + Redução de Tools
- **Spec:** `docs/superpowers/specs/2026-03-21-context-tools-reduction-design.md` (a criar)
- **Status:** Aguardando brainstorming
- **Objetivo:** Expandir o discovery.ts com preview e dados que hoje só existem em tools. Reduzir tools de 33 → ~28-30 movendo info pro context. Criar CLI `--context` pra dev ver o que a IA vê.
- **Dependências:** Nenhuma
- **Quem bloqueia:** Phase 1 da spec Observabilidade (depende do context expandido)

### Phase 1-2-3 — Observabilidade + Sugestão Inteligente
- **Spec:** `docs/superpowers/specs/2026-03-21-observabilidade-sugestao-inteligente-design.md`
- **Status:** Design aprovado, aguardando plan
- **Objetivo:** CLI preview, Phase 1 como otimizador (2 modos), SugestaoSheet com 2 seções
- **Dependências:** Phase 0 (context expandido + tools reduzidas)
- **Fases:** Enxergar → Otimizar → Mostrar

---

## Specs Concluídas

| Data | Spec | Resultado |
|------|------|-----------|
| 2026-03-20 | Coverage Stabilization | Solver patience-based, sem modos. Implementado. |
| 2026-03-20 | Transparência Relaxações | Toast verde/amarelo com regras relaxadas. Implementado. |
| 2026-03-20 | Advisory Hierárquico | Soft pins com pesos. Parcialmente implementado. |
| 2026-03-19 | Intermitente Tipo A/B | NT, XOR, Tipo B pré-calculado. Implementado v1.8.0. |

---

## Backlog (ideias sem spec ainda)

- Painel Único de Escala — spec antiga em `docs/ANALYST_PAINEL_UNICO_ESCALA.md`
- CicloGrid Unificado — 2 componentes separados hoje, precisam virar 1
- IA editando preview via tool — extensão da Phase 0
- Export System Redesign — ver memory `project_export_system.md`
