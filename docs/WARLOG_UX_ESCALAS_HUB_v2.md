<!-- WARLOG COPILOT v1.0 -->
<!-- INSTRUCAO PRA IA: Leia NEXT ACTION. So isso. -->

# WARLOG: UX EscalasHub v2 — Toolbar, BulkActions, Resumo

## RADAR
| Campo | Valor |
|-------|-------|
| Missao | Corrigir 3 lacunas UX no /escalas: toolbar unificada, bulk select pra export, merge tabs Horas+Avisos |
| Status | PLANNING |
| Fase Atual | — |
| Total Fases | 3 |
| Criado | 2026-02-16 16:40 |
| Atualizado | 2026-02-16 16:40 |

## NEXT ACTION
**Fase**: 1 — Toolbar Unificada
**O que fazer**: Mover Exportar + ViewMode do PageHeader pra linha do buscar/filtros
**Output esperado**: Uma unica toolbar com [Buscar] [Filtros] [Grid|Timeline] [Exportar] na mesma linha

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

### Como adaptar pro EscalaFlow

```
ANTES (atual):
  Header: [Exportar] [Grid|Timeline]
  Toolbar: [Buscar] [Filtros]
  Cards: SetorEscalaSection sem checkbox
  Export: Botao isolado → Modal com checkboxes de setores dentro

DEPOIS (proposta):
  Header: (so breadcrumb)
  Toolbar: [Buscar] [Filtros] [Grid|Timeline] [CheckSquare selecao]
  Cards: SetorEscalaSection COM checkbox top-right (hover ou selectionMode)
  BulkBar: Aparece quando 1+ selecionados
    "[☑] N de M setores | [Exportar HTML] [Exportar CSV] | [X]"
  Export: Via bulk bar OU via busca individual ("Exportar escala de [Nome]")

REGRAS:
- NAO existe mais botao "Exportar" isolado
- Export em massa = selecionar setores + acao na bulk bar
- Export individual = buscar funcionario → botao contextual no banner
- Se 1 setor selecionado → modal com opcoes completas (RH/Func/Batch/CSV)
- Se 2+ setores → modal multi-setor (RH consolidado/Batch geral/CSV)
- "Select all" seleciona todos os FILTRADOS (respeita busca + filtros)
- Cards de setor SEM escala: checkbox desabilitado (nao pode exportar sem dados)
```

---

## FASES

### FASE 1: Toolbar Unificada — PENDING
**Objetivo**: Mover Exportar + ViewMode pra mesma linha do buscar/filtros. Header fica so com breadcrumb.
**Instrucoes**:
1. No `EscalasHub.tsx`, remover `actions` prop do `PageHeader` (tirar Exportar + EscalaViewToggle de la)
2. Adicionar Exportar + EscalaViewToggle na toolbar (div que contem buscar + filtros)
3. Layout: `[Buscar (flex-1 max-w-sm)] [Filtros] [Grid|Timeline] [Exportar]`
4. Manter mesma logica de disabled no Exportar (0 setores com escala = disabled)
**Output esperado**: Toolbar unica com 4 elementos. Header limpo com so breadcrumb.
**Depende de**: —
**Achados**:
**Resumo**: —

### FASE 2: Bulk Select + BulkBar — PENDING
**Objetivo**: Substituir botao Exportar isolado por pattern de selecao nos cards + floating bulk bar.
**Instrucoes**:
1. **Criar hook `useSetorSelection`**: Adaptar pattern do DietFlow `useCRUDSelection`. State: `selectedSetores: Set<number>`, `selectionMode: boolean`. Metodos: `toggleSelection`, `selectAll`, `clearSelection`, `isSelected`.
2. **Modificar SetorEscalaSection**: Adicionar prop `showSelection`, `isSelected`, `onSelectionChange`. Renderizar checkbox top-right no CardHeader (hidden default, visible on hover ou quando selected). Desabilitar checkbox se setor sem escala.
3. **Criar componente BulkBar**: Floating bar fixed bottom-4 center z-50. Layout: `[Checkbox indeterminate + "N de M setores"] [divider] [Exportar HTML] [Exportar CSV] [X fechar]`. Aparece com animation quando `selectionMode && selectedSetores.size > 0`.
4. **Botao de selecao na toolbar**: Substituir botao "Exportar" por icone CheckSquare que togla `selectionMode`. Quando ativo: primary solid. Quando inativo: flat.
5. **Conectar bulk export**: Click em "Exportar HTML" na bulk bar → abre ExportModal com setores pre-selecionados (os que estao no `selectedSetores`). Click em "Exportar CSV" → gera direto sem modal.
6. **Remover checkboxes de setores DO ExportModal**: Nao precisa mais — selecao ja foi feita nos cards. Modal so mostra formato + opcoes (avisos, horas).
7. **Manter export individual**: Busca por funcionario → banner → "Exportar escala de [Nome]" continua igual.

**Componentes envolvidos**:
- `hooks/useSetorSelection.ts` (NOVO)
- `componentes/BulkBar.tsx` (NOVO ~100 linhas)
- `componentes/SetorEscalaSection.tsx` (MODIFICAR — adicionar checkbox)
- `paginas/EscalasHub.tsx` (MODIFICAR — integrar selecao + bulk bar)
- `componentes/ExportModal.tsx` (MODIFICAR — remover HubOptions checkbox setores)

**Output esperado**: Selecao nos cards, bulk bar floating, export via bulk actions. Zero botao "Exportar" isolado.
**Depende de**: Fase 1
**Achados**:
**Resumo**: —

### FASE 3: Tab Resumo (merge Horas + Avisos) — PENDING
**Objetivo**: Substituir tabs Escala|Horas|Avisos por Escala|Resumo. Tabela unica com horas + avisos por colaborador.
**Instrucoes**:
1. No `SetorEscalaSection.tsx`, substituir `SectionTabs` de 3 tabs pra 2: `Escala` | `Resumo`
2. Criar componente `ResumoTable` (substitui HorasTable). Colunas:
   ```
   Colaborador | Contrato | Real | Meta | Delta | Avisos
   ```
   - Coluna "Avisos": lista as violacoes daquele colaborador especifico (se houver). Ex: "7 dias seguidos, abaixo meta". Se nenhuma: "—"
   - Manter cores do delta (verde/amber/vermelho)
   - Manter badge de status (OK/Abaixo)
3. Remover badge de count "Avisos(N)" da tab — agora e so "Resumo"
4. Se 0 violacoes no setor inteiro: coluna Avisos fica toda "—" (nao esconder a coluna)
5. Manter tab badge? Considerar: badge com count de problemas (delta negativo + violacoes) no tab "Resumo" seria util? Ex: `Resumo (3)` = 3 colaboradores com algum problema.

**Output esperado**: 2 tabs por secao (Escala | Resumo). Tabela unificada. Zero redundancia.
**Depende de**: —
**Achados**:
**Resumo**: —

---

## DASHBOARD
| # | Fase | Status | Resumo | Proxima Acao |
|---|------|--------|--------|--------------|
| 1 | Toolbar Unificada | PENDING | — | Mover Exportar+ViewMode pra toolbar |
| 2 | Bulk Select + BulkBar | PENDING | — | Esperar #1 |
| 3 | Tab Resumo | PENDING | — | Pode paralelo com #1 |

---

## LOG
[2026-02-16 16:40] WARLOG CRIADO — Missao: 3 lacunas UX no /escalas. Fases: 3. Baseado em feedback do Marco + estudo do DietFlow bulk actions pattern.
