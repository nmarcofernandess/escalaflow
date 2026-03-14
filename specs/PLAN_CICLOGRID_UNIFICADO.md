# CicloGrid Unificado — Plano de Implementacao

> **For agentic workers:** REQUIRED: Use superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Substituir EscalaCicloResumo + SimuladorCicloGrid + CicloViewToggle por 1 componente CicloGrid unificado com view unica, preflight permanente, area de avisos e siglas padrao.

**Architecture:** Criar tipos compartilhados + componente CicloGrid + 2 conversores (escala→grid, simulacao→grid) + PreflightChecklist extraido + AvisosSection. Migrar 5 consumidores. Deletar 3 componentes antigos.

**Tech Stack:** React 19, Tailwind, shadcn/ui (Table, Select, Badge), Lucide icons, TypeScript strict.

**Spec:** `specs/SPEC_CICLOGRID_UNIFICADO.md`
**Prototipo visual:** `specs/prototipos/ciclo-grid-final.html`

---

## Chunk 1: Tipos, Constantes e Componente

### Task 1: Tipos e constantes compartilhados

**Files:**
- Create: `src/renderer/src/lib/ciclo-grid-types.ts`

- [ ] **Step 1: Criar arquivo de tipos**

```typescript
// src/renderer/src/lib/ciclo-grid-types.ts
import type { DiaSemana } from '@shared/index'

export type Simbolo = 'T' | 'FF' | 'FV' | 'DT' | 'DF' | 'I' | '.' | '-'

export interface CicloGridRow {
  id: number
  nome: string
  posto: string
  variavel: DiaSemana | null
  fixa: DiaSemana | null
  blocked: boolean
  semanas: Simbolo[][]  // [semana][dia_0_a_6] = simbolo
}

export interface CicloGridData {
  rows: CicloGridRow[]
  cobertura: number[][]   // [semana][dia] = quantas pessoas trabalham
  demanda: number[]       // [dia_seg_a_dom] = min_pessoas (7 valores)
  cicloSemanas: number    // periodo do ciclo (pra linha roxa)
}

export const DIAS_ORDEM: DiaSemana[] = ['SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB', 'DOM']
export const DIAS_CURTOS: Record<DiaSemana, string> = {
  SEG: 'Seg', TER: 'Ter', QUA: 'Qua', QUI: 'Qui', SEX: 'Sex', SAB: 'Sab', DOM: 'Dom',
}
export const DIAS_HEADER = ['S', 'T', 'Q', 'Q', 'S', 'S', 'D']

export const SIMBOLO_CONFIG: Record<Simbolo, {
  cell: string
  swatch: string
  label: string
}> = {
  T: {
    cell: 'bg-success/10 text-success font-semibold',
    swatch: 'bg-success/30 text-success',
    label: 'Trabalho',
  },
  FF: {
    cell: 'bg-slate-200 text-slate-700 font-semibold dark:bg-slate-700 dark:text-slate-200',
    swatch: 'bg-slate-300 text-slate-700 dark:bg-slate-600 dark:text-slate-200',
    label: 'Folga fixa',
  },
  FV: {
    cell: 'bg-warning/10 text-warning font-semibold',
    swatch: 'bg-warning/30 text-warning',
    label: 'Folga variavel',
  },
  DT: {
    cell: 'bg-warning/10 text-warning font-semibold ring-1 ring-inset ring-warning/40',
    swatch: 'bg-warning/30 text-warning ring-1 ring-inset ring-warning/40',
    label: 'Dom trabalhado',
  },
  DF: {
    cell: 'bg-blue-100 text-blue-700 font-semibold ring-1 ring-inset ring-blue-400 dark:bg-blue-950 dark:text-blue-400 dark:ring-blue-600',
    swatch: 'bg-blue-200 text-blue-700 ring-1 ring-inset ring-blue-400 dark:bg-blue-800 dark:text-blue-300',
    label: 'Dom folga',
  },
  I: {
    cell: 'bg-rose-100 text-rose-700 font-semibold dark:bg-rose-900 dark:text-rose-200',
    swatch: 'bg-rose-200 text-rose-700 dark:bg-rose-700 dark:text-rose-200',
    label: 'Indisponivel',
  },
  '.': {
    cell: 'text-muted-foreground',
    swatch: 'bg-muted text-muted-foreground',
    label: 'Sem alocacao',
  },
  '-': {
    cell: 'text-muted-foreground',
    swatch: '',
    label: 'Sem titular',
  },
}

export const LEGENDA_SIMBOLOS: Simbolo[] = ['T', 'FF', 'FV', 'DT', 'DF', 'I']
```

- [ ] **Step 2: Verificar typecheck**

```bash
npm run typecheck
```

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/lib/ciclo-grid-types.ts
git commit -m "feat(C3): tipos e constantes CicloGrid unificado"
```

---

### Task 2: Conversores escala → CicloGridData e simulacao → CicloGridData

**Files:**
- Create: `src/renderer/src/lib/ciclo-grid-converters.ts`

**Referencia de dados de entrada:**
- EscalaCicloResumo consome: `Escala + Alocacao[] + Colaborador[] + Funcao[] + RegraHorarioColaborador[] + Demanda[]`
- SimuladorCicloGrid consome: `SimulaCicloOutput`
- Logica de resolucao de simbolo: `EscalaCicloResumo.tsx:430-450` (resolveSymbol) e `SimuladorCicloGrid.tsx:42-53` (resolveSimbolo)
- Logica de inferencia de folgas: `EscalaCicloResumo.tsx:361-418` (inferredFolgas useMemo)
- Logica de calculo de periodo ciclo: `EscalaCicloResumo.tsx:314-337` (periodoCiclo useMemo)
- Logica de agrupamento em semanas: `EscalaCicloResumo.tsx:280-312` (weeks useMemo)
- Logica de cobertura: contagem de 'T'/'DT' por dia

- [ ] **Step 1: Criar arquivo de conversores**

O conversor `escalaParaCicloGrid` deve:
1. Ordenar postos por `ordem` (como `EscalaCicloResumo.tsx:251-254`)
2. Mapear titular por posto (como `EscalaCicloResumo.tsx:256-263`)
3. Agrupar datas em semanas SEG-DOM (como `EscalaCicloResumo.tsx:280-312`)
4. Inferir folgas fixa/variavel (como `EscalaCicloResumo.tsx:361-418`)
5. Resolver simbolo por celula (como `EscalaCicloResumo.tsx:430-450`)
6. Calcular cobertura por dia/semana (contar status TRABALHO)
7. Calcular periodo do ciclo (como `EscalaCicloResumo.tsx:314-337`)
8. Montar demanda por dia a partir de `Demanda[]` (max min_pessoas por dia_semana)

O conversor `simulacaoParaCicloGrid` deve:
1. Mapear `SimulaCicloRow` → `CicloGridRow` (traduzir DiaStatus + indices de folga)
2. Usar `resultado.cobertura_dia` pra cobertura
3. Usar `resultado.ciclo_semanas` pra periodo

```typescript
// src/renderer/src/lib/ciclo-grid-converters.ts
import type {
  Alocacao, Colaborador, Demanda, DiaSemana,
  Escala, Funcao, RegraHorarioColaborador,
} from '@shared/index'
import type { SimulaCicloOutput } from '@shared/simula-ciclo'
import type { CicloGridData, CicloGridRow, Simbolo } from './ciclo-grid-types'
import { DIAS_ORDEM } from './ciclo-grid-types'

// ... implementar ambos conversores com a logica extraida dos componentes antigos
```

- [ ] **Step 2: Extrair a logica dos componentes existentes**

Ler `EscalaCicloResumo.tsx` linhas 237-450 e extrair todas as funcoes helper (alocMap, regrasMap, postosOrdenados, titularPorPosto, weeks, periodoCiclo, inferredFolgas, resolveSymbol) pro conversor.

Ler `SimuladorCicloGrid.tsx` linhas 42-61 e extrair resolveSimbolo, getFixaDia, getVariavelDia pro conversor.

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/lib/ciclo-grid-converters.ts
git commit -m "feat(C3): conversores escala/simulacao → CicloGridData"
```

---

### Task 3: Componente CicloGrid

**Files:**
- Create: `src/renderer/src/componentes/CicloGrid.tsx`

**Referencia visual:** `specs/prototipos/ciclo-grid-final.html` — tab "Preview"

**Estrutura do componente:**
- Props: `CicloGridProps` (data, mode, onFolgaChange, className)
- Header linha 1: "Ciclo de N semanas" sem fundo + S1 S2 S3... nos colspans
- Header linha 2: com fundo (muted) — Var, Fixo, S T Q Q S S D (repete por semana)
- Body: 1 row por posto/titular. Nome+Posto empilhados. Var/Fixo como Select ou texto.
- Ultima row: COBERTURA X/Y (verde ok, vermelho deficit)
- Legenda embaixo
- Sticky: 3 colunas (nome ~130px, var ~46px, fixo ~46px) com background opaco
- Divisorias: border-left entre semanas, border-right:2px purple no fim do ciclo
- Empty state se rows.length === 0

**Componentes shadcn usados:**
- `Table, TableBody, TableCell, TableHead, TableHeader, TableRow` de `@/components/ui/table`
- `Select, SelectContent, SelectItem, SelectTrigger, SelectValue` de `@/components/ui/select`
- `cn` de `@/lib/utils`

**Tamanhos de fonte (shadcn scale):**
- Table base: text-sm (herda do Table component)
- Headers: text-xs
- Nome: text-[13px] font-medium
- Posto: text-xs text-muted-foreground
- Siglas: text-xs font-semibold
- COBERTURA: text-xs font-bold
- Barra separadora cobertura/demanda: text-[10px] text-muted-foreground

- [ ] **Step 1: Criar componente CicloGrid**

Implementar o componente completo baseado no prototipo HTML aprovado. Usar shadcn Table components. Manter FolgaSelect como funcao interna (mesmo padrao do EscalaCicloResumo).

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/componentes/CicloGrid.tsx
git commit -m "feat(C3): componente CicloGrid unificado"
```

---

## Chunk 2: Preflight, Avisos e Migracoes

### Task 4: PreflightChecklist extraido + AvisosSection

**Files:**
- Create: `src/renderer/src/componentes/PreflightChecklist.tsx`
- Create: `src/renderer/src/componentes/AvisosSection.tsx`

**Referencia:**
- `PrecondicaoItem` em `SetorDetalhe.tsx:150-179` — extrair como componente proprio
- Avisos: header "Avisos (N)" + botao "Pedir sugestao" + lista de avisos
- Prototipo: tab "Preview" do `ciclo-grid-final.html`

- [ ] **Step 1: Criar PreflightChecklist**

Extrair `PrecondicaoItem` do SetorDetalhe. O componente recebe props de cada checagem (empresa, tipos, colabs, demandas) e renderiza a lista. Aparece SEMPRE que faltam dados, nao so no empty state.

```typescript
interface PreflightChecklistProps {
  empresa: boolean
  tiposContrato: boolean
  colaboradores: boolean
  demandas: boolean
}
```

- [ ] **Step 2: Criar AvisosSection**

```typescript
interface Aviso {
  id: string
  nivel: 'error' | 'warning' | 'info'
  titulo: string
  descricao: string
}

interface AvisosSectionProps {
  avisos: Aviso[]
  onPedirSugestao?: () => void  // se undefined, botao nao aparece
}
```

Icones Lucide: `AlertTriangle` (error/warning), `Info` (info).

- [ ] **Step 3: Typecheck + Commit**

```bash
npm run typecheck
git add src/renderer/src/componentes/PreflightChecklist.tsx src/renderer/src/componentes/AvisosSection.tsx
git commit -m "feat(C2+C6): PreflightChecklist + AvisosSection"
```

---

### Task 5: Migrar SetorDetalhe

**Files:**
- Modify: `src/renderer/src/paginas/SetorDetalhe.tsx`

**O que muda:**
- Remover imports: `EscalaCicloResumo` (L102), `SimuladorCicloGrid` (L103), `CicloViewToggle, useCicloViewMode` (L105)
- Adicionar imports: `CicloGrid`, `escalaParaCicloGrid`, `PreflightChecklist`, `AvisosSection`
- Remover `PrecondicaoItem` interno (L150-179) — usar `PreflightChecklist`
- Remover `const [cicloMode, setCicloMode] = useCicloViewMode()` e usos
- Remover todas as instancias de `<CicloViewToggle>` (L2692, L2770, L2794)
- No bloco `escalaTab === 'simulacao'`:
  - Se tem escalaCompleta: usar `escalaParaCicloGrid()` → `<CicloGrid data={...} mode="view" />`
  - Se tem previewNivel1: usar `escalaParaCicloGrid()` (previewNivel1 ja gera escala+alocacoes) → `<CicloGrid data={...} mode="edit" onFolgaChange={...} />`
  - Senao: PreflightChecklist
- Preflight aparece ACIMA do grid se faltam dados (mesmo com preview visivel)
- Avisos embaixo do grid com `<AvisosSection>`
- Converter avisos do previewNivel1 (strings) pro formato `Aviso[]`

- [ ] **Step 1: Aplicar migracoes**
- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

- [ ] **Step 3: Testar visualmente**

```bash
npm run dev
```

Navegar pro SetorDetalhe → tab Simulacao. Verificar:
- Preview aparece com scroll horizontal
- F/V editaveis funcionam
- COBERTURA X/Y com cores
- Sticky cols opacos no scroll
- Avisos aparecem embaixo
- Preflight aparece se faltar dado

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/paginas/SetorDetalhe.tsx
git commit -m "feat(C3): migrar SetorDetalhe → CicloGrid unificado"
```

---

### Task 6: Migrar consumidores restantes

**Files:**
- Modify: `src/renderer/src/paginas/EscalaPagina.tsx` (L27: EscalaCicloResumo, L33: CicloViewToggle)
- Modify: `src/renderer/src/paginas/EscalasHub.tsx` (L6: EscalaCicloResumo, L7: CicloViewToggle)
- Modify: `src/renderer/src/componentes/ExportarEscala.tsx` (L15: EscalaCicloResumo)
- Modify: `src/renderer/src/paginas/SimulaCicloPagina.tsx` (L14: SimuladorCicloGrid, L13: CicloViewToggle)

- [ ] **Step 1: Migrar EscalaPagina**

Trocar `EscalaCicloResumo` por `CicloGrid mode="view"`. Remover `CicloViewToggle` e `useCicloViewMode`. Usar `escalaParaCicloGrid()` pra converter dados. Passar demandas do store.

- [ ] **Step 2: Migrar EscalasHub**

Mesmo padrao: `CicloGrid mode="view"`. Remover toggle.

- [ ] **Step 3: Migrar ExportarEscala**

`EscalaCicloResumo` com `mostrarTodasSemanas` vira `CicloGrid mode="view"`. O CicloGrid ja mostra todas as semanas por default (nao tem paginacao). Adicionar class `print-colors` no wrapper.

- [ ] **Step 4: Migrar SimulaCicloPagina**

Trocar `SimuladorCicloGrid` por `CicloGrid mode="edit"`. Usar `simulacaoParaCicloGrid()`. Remover `CicloViewToggle` e botoes de semana.

- [ ] **Step 5: Typecheck**

```bash
npm run typecheck
```

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/paginas/EscalaPagina.tsx src/renderer/src/paginas/EscalasHub.tsx src/renderer/src/componentes/ExportarEscala.tsx src/renderer/src/paginas/SimulaCicloPagina.tsx
git commit -m "feat(C3): migrar EscalaPagina+EscalasHub+ExportarEscala+SimulaCicloPagina → CicloGrid"
```

---

## Chunk 3: Cleanup e Verificacao

### Task 7: Deletar componentes antigos (C8)

**Files:**
- Delete: `src/renderer/src/componentes/EscalaCicloResumo.tsx` (747 linhas)
- Delete: `src/renderer/src/componentes/SimuladorCicloGrid.tsx` (373 linhas)
- Delete: `src/renderer/src/componentes/CicloViewToggle.tsx` (61 linhas)

- [ ] **Step 1: Verificar que nenhum arquivo importa os componentes antigos**

```bash
# Buscar imports residuais
grep -r "EscalaCicloResumo\|SimuladorCicloGrid\|CicloViewToggle\|useCicloViewMode" src/renderer/src --include="*.tsx" --include="*.ts" -l
```

Esperado: 0 resultados (exceto os proprios arquivos a deletar).

- [ ] **Step 2: Deletar arquivos**

```bash
rm src/renderer/src/componentes/EscalaCicloResumo.tsx
rm src/renderer/src/componentes/SimuladorCicloGrid.tsx
rm src/renderer/src/componentes/CicloViewToggle.tsx
```

- [ ] **Step 3: Remover localStorage key do CicloViewToggle**

O `CicloViewToggle.tsx` persiste `ef-view-ciclo` no localStorage. Como o toggle morreu, essa key nao e mais lida. Nao precisa cleanup ativo — fica orphan e nao causa problema.

- [ ] **Step 4: Typecheck final**

```bash
npm run typecheck
```

Esperado: 0 erros.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(C8): deletar EscalaCicloResumo + SimuladorCicloGrid + CicloViewToggle (-1181 linhas)"
```

---

### Task 8: Verificacao visual completa

- [ ] **Step 1: Rodar app**

```bash
npm run dev
```

- [ ] **Step 2: Checklist visual**

| Pagina | Verificar |
|--------|-----------|
| SetorDetalhe → Simulacao | Grid unificado, scroll horizontal, sticky opaco, F/V editaveis, COBERTURA X/Y, avisos, preflight |
| SetorDetalhe → Oficial | Grid view-only, sem dropdowns |
| EscalaPagina | Grid view-only com ciclo completo |
| EscalasHub | Grid compacto por escala |
| SimulaCicloPagina | Grid edit com dados simulados |
| ExportarEscala (Ctrl+P) | Print com cores, legenda |

- [ ] **Step 3: Verificar dark mode**

Trocar tema e verificar que todas as cores de sigla funcionam em dark.

- [ ] **Step 4: Commit final se houver ajustes**

```bash
git add -A
git commit -m "fix(C3): ajustes visuais pos-verificacao"
```

---

## Resumo de arquivos

| Acao | Arquivo | Linhas |
|------|---------|--------|
| **Criar** | `src/renderer/src/lib/ciclo-grid-types.ts` | ~90 |
| **Criar** | `src/renderer/src/lib/ciclo-grid-converters.ts` | ~250 |
| **Criar** | `src/renderer/src/componentes/CicloGrid.tsx` | ~350 |
| **Criar** | `src/renderer/src/componentes/PreflightChecklist.tsx` | ~50 |
| **Criar** | `src/renderer/src/componentes/AvisosSection.tsx` | ~60 |
| **Modificar** | `src/renderer/src/paginas/SetorDetalhe.tsx` | migrar imports + render |
| **Modificar** | `src/renderer/src/paginas/EscalaPagina.tsx` | migrar imports + render |
| **Modificar** | `src/renderer/src/paginas/EscalasHub.tsx` | migrar imports + render |
| **Modificar** | `src/renderer/src/componentes/ExportarEscala.tsx` | migrar imports + render |
| **Modificar** | `src/renderer/src/paginas/SimulaCicloPagina.tsx` | migrar imports + render |
| **Deletar** | `src/renderer/src/componentes/EscalaCicloResumo.tsx` | -747 |
| **Deletar** | `src/renderer/src/componentes/SimuladorCicloGrid.tsx` | -373 |
| **Deletar** | `src/renderer/src/componentes/CicloViewToggle.tsx` | -61 |

**Saldo: ~800 novas + ~3000 modificadas - 1181 deletadas**
