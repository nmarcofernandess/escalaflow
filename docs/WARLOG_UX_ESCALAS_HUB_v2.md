<!-- WARLOG COPILOT v1.0 -->
<!-- INSTRUCAO PRA IA: Leia NEXT ACTION. So isso. -->

# WARLOG: UX EscalasHub v2 — Toolbar, BulkActions, Resumo

## RADAR
| Campo | Valor |
|-------|-------|
| Missao | Corrigir 3 lacunas UX no /escalas: toolbar unificada, bulk select pra export, merge tabs Horas+Avisos |
| Status | COMPLETE |
| Fase Atual | — |
| Total Fases | 3 |
| Criado | 2026-02-16 16:40 |
| Atualizado | 2026-02-16 18:30 |

## NEXT ACTION
**Todas as fases concluidas.** Warlog fechado.

---

## CONTEXTO

### O que o Marco pediu
1. Exportar e ViewMode tao no PageHeader (barra do breadcrumb). Devem descer pra mesma linha do buscar/filtros.
2. O export com checkboxes de setores dentro do modal nao escala (1500 setores?). Trocar pro pattern de SELECT + BulkActionBar do DietFlow: checkbox nos cards de setor, floating bar com acoes no bottom.
3. Tabs Horas e Avisos sao redundantes. Mergear em tab unico "Resumo" com tabela unificada.

### Pattern DietFlow — Bulk Actions (Referencia)

Estudado em `~/dietflow-project/dietflow-app`. Pattern completo:

```
FLUXO:
1. Botao na toolbar → Toggles selectionMode
2. Cards mostram checkbox → Top-right, hidden ate hover, visivel quando selecionado
3. Click na checkbox → Toggle selecao individual
4. Bulk bar aparece → Fixed bottom-center com acoes
5. Select all → Seleciona TODOS filtrados (nao so visiveis)
6. Botoes de acao → Executam bulk operations
7. Botao X → Sai do modo selecao

COMPONENTES CHAVE:
- useCRUDSelection: hook com selectedItems (Set), selectionMode, toggleSelection, selectAll, clearSelection
- BaseContentCard: checkbox top-right com motion animation (spring scale+opacity)
- BulkActionBarBase: fixed bottom-4 left-1/2 z-50, shadow-md
  - Checkbox indeterminate/all + "N de M setores"
  - Separator
  - Action buttons (customizaveis)
  - Close button
- BulkActionModalBase: modal de confirmacao/config com preview list + "Ver mais" (15 items)

ESTADOS DO CHECKBOX:
- Nenhum selecionado → Click seleciona TODOS filtrados
- Parcialmente selecionado → Indeterminate, click seleciona TODOS
- Todos selecionados → Click deseleciona TODOS (mantem selectionMode)
```

---

## FASES

### FASE 1: Toolbar Unificada — DONE
**Objetivo**: Mover Exportar + ViewMode pra mesma linha do buscar/filtros. Header fica so com breadcrumb.
**Instrucoes**:
1. No `EscalasHub.tsx`, remover `actions` prop do `PageHeader` (tirar Exportar + EscalaViewToggle de la)
2. Adicionar EscalaViewToggle + botao Selecionar na toolbar (div que contem buscar + filtros)
3. Layout: `[Buscar (flex-1 max-w-sm)] [Filtros] [spacer] [Grid|Timeline] [Selecionar]`
**Achados**:
- PageHeader agora so tem breadcrumb, toolbar unificada com todos os controles
- Botao "Selecionar" substituiu "Exportar" isolado — togla selectionMode
- EscalaViewToggle movido com sucesso
**Resumo**: Header limpo. Toolbar unica com buscar, filtros, view toggle e selecao.

### FASE 2: Bulk Select + BulkBar — DONE
**Objetivo**: Substituir botao Exportar isolado por pattern de selecao nos cards + floating bulk bar.
**Achados**:
- Hook `useSetorSelection` criado com Set<number>, selectionMode, toggleSelection, selectAll, clearSelection, getCheckboxState
- `BulkActionBar.tsx` criado: Card fixed bottom-4 center z-50 com animate-in, Checkbox indeterminate + Badge count + Separator + 2 botoes export + close
- `SetorEscalaSection.tsx` modificado: checkbox no CardHeader (disabled se sem escala, stopPropagation no click)
- `EscalasHub.tsx` integrado: handleOpenExport e handleCSVExport aceitam overrideSetorIds opcional pra bulk
- `ExportModal.tsx` simplificado: multi-setor removeu checkboxes de setores, mostra summary read-only dos selecionados
- shadcn Checkbox + Badge + Card + Separator + Button + Tooltip usados corretamente (zero div soup)
**Resumo**: Pattern DietFlow adaptado. Selecao nos cards, BulkBar floating, export via bulk actions.

### FASE 3: Tab Resumo (merge Horas + Avisos) — DONE
**Objetivo**: Substituir tabs Escala|Horas|Avisos por Escala|Resumo. Tabela unica com horas + avisos por colaborador.
**Achados**:
- 3 tabs → 2 tabs (Escala | Resumo)
- ResumoTable criada inline: Colaborador | Contrato | Real | Meta | Delta | Avisos
- Avisos por colaborador inline (usa REGRAS_TEXTO fallback)
- Badge no tab Resumo mostra count de colaboradores com problemas (delta fora tolerancia OU com violacoes)
- ViolacoesAgrupadas removido do import (permanece no EscalaPagina, nao deletado)
- shadcn Table + Badge + Tabs usados corretamente
**Resumo**: 2 tabs, tabela unificada, zero redundancia. Badge mostra problemas.

---

## DASHBOARD
| # | Fase | Status | Resumo | Proxima Acao |
|---|------|--------|--------|--------------|
| 1 | Toolbar Unificada | DONE | Header limpo, toolbar unica | — |
| 2 | Bulk Select + BulkBar | DONE | Selecao cards + floating bar | — |
| 3 | Tab Resumo | DONE | 2 tabs, tabela unificada | — |

---

## LOG
[2026-02-16 16:40] WARLOG CRIADO — Missao: 3 lacunas UX no /escalas. Fases: 3. Baseado em feedback do Marco + estudo do DietFlow bulk actions pattern.
[2026-02-16 17:00] FASE 1 DONE — Toolbar unificada. Header limpo. EscalaViewToggle + Selecionar na toolbar.
[2026-02-16 17:30] FASE 3 DONE — 3 tabs → 2 tabs. ResumoTable com horas+avisos unificados. Badge problemas.
[2026-02-16 18:00] FASE 2 DONE — useSetorSelection hook, BulkActionBar, checkbox nos cards, ExportModal simplificado.
[2026-02-16 18:15] VALIDACAO — tsc 0 erros, build OK, IDE 0 diagnostics. Todas 3 fases implementadas.
[2026-02-16 18:30] WARLOG COMPLETE — Todas as fases concluidas. Commit pendente.
