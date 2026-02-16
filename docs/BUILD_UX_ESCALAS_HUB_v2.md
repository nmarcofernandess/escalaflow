# BUILD: UX EscalasHub v2 — Toolbar + BulkSelect + Resumo

## TL;DR
3 mudancas no /escalas: toolbar unificada (mover actions do header), bulk select nos cards (matar checkboxes do modal), tab Resumo (merge Horas+Avisos).

## SHADCN COMPONENTS (Inventory)
Ja instalados e usados: Button, Badge, Card, Checkbox, Dialog, Input, Label, Popover, Progress, RadioGroup, Select, Separator, Switch, Table, Tabs, Tooltip

## FASE 1: Toolbar Unificada

### Mudancas
**EscalasHub.tsx**:
- REMOVER `actions` prop do `<PageHeader>` (linhas 350-363)
- PageHeader fica so com breadcrumbs
- MOVER EscalaViewToggle + botao de selecao pra toolbar (div linhas 376-467)
- Layout: `[Search flex-1 max-w-sm] [Filtros] [ViewToggle] [SelectionToggle]`
- SelectionToggle: `<Button variant={selectionMode ? "default" : "outline"}>`
  com icone `CheckSquare` de lucide-react

### Nenhum componente novo

---

## FASE 2: Bulk Select + BulkBar

### Componentes novos

**1. `hooks/useSetorSelection.ts`**
```
State:
  selectedSetores: Set<number>
  selectionMode: boolean

Methods:
  toggleSelection(setorId: number)
  selectAll(setorIds: number[])  // recebe os FILTRADOS
  clearSelection()
  isSelected(setorId: number) → boolean
  enterSelectionMode()
  exitSelectionMode()  // limpa selecao tambem

Derived:
  selectedCount → selectedSetores.size
  checkboxState → 'none' | 'indeterminate' | 'all'
```

**2. `componentes/BulkActionBar.tsx`**
- Fixed `bottom-4 left-1/2 -translate-x-1/2` z-50
- shadcn: Card + Button + Checkbox + Separator + Badge
- Layout: `[Checkbox indeterminate] [Badge "N de M"] [Separator] [Button HTML] [Button CSV] [Button X]`
- Aparece com `transition-all` + `translate-y` animation
- Props:
  ```ts
  interface BulkActionBarProps {
    selectedCount: number
    totalCount: number
    checkboxState: 'none' | 'indeterminate' | 'all'
    onToggleAll: () => void
    onExportHTML: () => void
    onExportCSV: () => void
    onClose: () => void
  }
  ```

### Modificacoes

**SetorEscalaSection.tsx**:
- Novas props: `selectionMode?: boolean`, `isSelected?: boolean`, `onToggleSelection?: () => void`
- Renderizar shadcn Checkbox no CardHeader (top-right area, antes do Editar)
- Visivel quando: `selectionMode || isSelected`
- Disabled quando: `!escalaResumo` (sem escala)
- Checkbox shadcn padrao (nao custom)
- Click no checkbox: `e.stopPropagation()` + `onToggleSelection()`

**ExportModal.tsx**:
- REMOVER secao de checkboxes de setores do HubOptions (linhas 366-428)
- Multi-setor mode: so formato (RH/Batch/CSV), sem lista de setores
- Setores pre-selecionados vem de fora (via bulk selection)

**EscalasHub.tsx**:
- Integrar `useSetorSelection`
- Botao SelectionToggle na toolbar toggle `selectionMode`
- Passar props de selecao pro SetorEscalaSection
- BulkActionBar aparece quando `selectionMode && selectedCount > 0`
- BulkBar HTML → abre ExportModal com setores do selectedSetores
- BulkBar CSV → export direto
- BulkBar X → exitSelectionMode

### Data flow
```
Toolbar: [CheckSquare] → toggles selectionMode
  ↓
SetorEscalaSection: mostra checkbox → toggleSelection(setor.id)
  ↓
useSetorSelection: selectedSetores Set atualizado
  ↓
BulkActionBar: mostra count + acoes
  ↓
[HTML] → handleOpenExport(selectedSetores) → ExportModal (sem checkboxes)
[CSV] → handleCSVExport(selectedSetores) → direto
```

---

## FASE 3: Tab Resumo (merge Horas + Avisos)

### Mudancas em SetorEscalaSection.tsx

**SectionTabs**: 3 tabs → 2 tabs
- `[Escala] [Resumo (N)]` onde N = count de colaboradores com problema

**Novo componente interno: ResumoTable**
- Substitui HorasTable
- Colunas: `Colaborador | Contrato | Real | Meta | Delta | Avisos`
- Coluna Avisos: lista violacoes daquele colaborador (por `colaborador_id`)
  - Usa `v.mensagem || REGRAS_TEXTO[v.regra] || v.regra` (mesmo pattern)
  - Se 0: mostra "—"
- Mantém cores delta (emerald/amber/destructive)
- Mantém badge Abaixo (mesma Badge de antes)
- Badge no tab: count de colabs com delta negativo fora tolerancia OU com violacao

**REMOVER**: HorasTable (absorvida no ResumoTable)
**REMOVER**: Tab "Avisos" separada
**MANTER**: ViolacoesAgrupadas.tsx (usado em EscalaPagina, nao apagar)

### shadcn usado: Table, TableHeader, TableRow, TableHead, TableBody, TableCell, Badge, Tabs

---

## SEQUENCIA DE EXECUCAO
1. Fase 1 (Toolbar) — rapida, desbloqueia Fase 2
2. Fase 3 (Resumo) — independente
3. Fase 2 (Bulk Select) — mais complexa, por ultimo

## CHECKLIST FINAL
- [ ] tsc 0 erros
- [ ] Build OK
- [ ] Motor testes PASS
- [ ] Dark mode OK em todos componentes novos
- [ ] Zero div soup — tudo shadcn canonical
