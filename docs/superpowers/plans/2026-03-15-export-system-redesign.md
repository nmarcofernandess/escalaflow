# Export System Redesign — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refatorar o sistema de exportação do EscalaFlow para suportar 3 modos (Setor, Funcionário, Em Massa), novo CicloGrid paginado, Timeline Barras (Gantt), Folha do Funcionário, avisos unificados, e tudo cabendo em A4.

**Architecture:** Componente unificado `ExportarEscala` com seções controladas por props. Modal único `ExportModal` com 3 modes. Componentes de export estáticos (sem interação) separados dos componentes interativos do app. Dados vêm do solver via IPC existente — nenhuma mudança de schema.

**Tech Stack:** React 19, TypeScript, Tailwind CSS, shadcn/ui, Electron IPC (@egoist/tipc), renderToStaticMarkup para HTML export.

**Spec:** `docs/superpowers/specs/2026-03-15-export-system-redesign.md`
**Protótipo visual:** `.superpowers/brainstorm/96051-1773612355/export-inlined.html`

---

## Regras Globais (aplicam-se a TODAS as tasks)

### R1: renderToStaticMarkup compliance
TODOS os componentes de export (`ExportarEscala`, `ExportTimelineBarras`, `ExportFolhaFuncionario`, `ExportAvisos`, `CicloGrid variant='export'`) devem ser STATELESS — sem `useState`, `useEffect`, `useRef`, event handlers, ou qualquer interatividade. `renderToStaticMarkup()` vai falhar se houver hooks.

### R2: Fontes de verdade (spec 17.1)
Dados exportados vêm EXCLUSIVAMENTE do solver/banco:
- Horários: `alocacoes.hora_inicio/hora_fim` (solver) — NÃO perfil de horário
- Almoço: `alocacoes.hora_almoco_inicio/fim` — NÃO hardcoded
- Minutos: `alocacoes.minutos_trabalho` — NÃO cálculo manual
- Status: `alocacoes.status` — NÃO deduzir do ciclo
- Violações: `escala.violacoes[]` — NÃO recalcular

### R3: Cores semânticas (spec 11)
Todos os novos componentes usam APENAS tokens semânticos:
- TRABALHO → `text-success bg-success/10`
- FOLGA FIXA → `text-muted-foreground bg-muted`
- FOLGA VARIÁVEL → `text-warning bg-warning/10`
- DOM TRABALHO → `text-warning bg-warning/10 ring-warning/40`
- DOM FOLGA → `text-primary bg-primary/10 ring-primary/30`
- INDISPONÍVEL → `text-destructive bg-destructive/10`
- Barras de turno → `bg-primary text-primary-foreground`

### R4: Page-break CSS (spec 6.2)
Aplicar em TODOS os componentes de export:
- `break-inside: avoid` em: cada bloco do CicloGrid, cada tabela semanal, cada dia da Timeline, cada tabela da Folha Funcionário
- `break-before: page` entre seções (ciclo→semanal→timeline) no ExportarEscala
- NUNCA break lateral — conteúdo sempre cabe na largura

### R5: @page dinâmico (spec 6.3)
Quem injeta o CSS de `@page`:
- `ExportarEscala.tsx` renderiza inline `<style>` com `@page { size: A4 landscape|portrait }` baseado no `mode`
- `buildStandaloneHtml()` aceita `pageOrientation` param e injeta o MESMO CSS no wrapper
- Os dois são redundantes de propósito (preview usa o do componente, HTML export usa o do wrapper)

### R6: Protótipo visual
Abrir `.superpowers/brainstorm/96051-1773612355/export-inlined.html` como REFERÊNCIA VISUAL durante toda a implementação. Cada componente deve bater com o protótipo.

### R7: CoberturaChart
Confirmar que `CoberturaChart` NÃO é importado/renderizado em NENHUM componente de export. Gráficos não entram no export — CSV basta.

### R8: print-color-adjust
Todos os componentes de export incluem:
```css
body { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
```
Já existe no `ExportarEscala` atual — manter. O `buildStandaloneHtml` também injeta.

---

## Pré-requisito: Mapa de Dados por Mode

### Mode A (Setor) — dados já disponíveis
Todos os dados existem em EscalaPagina/SetorDetalhe. Ponto de atenção: `previewAvisos` (avisos operacionais) é computado como `useMemo` no SetorDetalhe — precisa ser extraído pra helper reutilizável ou passado como prop.

### Mode B (Funcionário) — dados precisam ser carregados
ColaboradorDetalhe NÃO tem escala do setor. Criar hook `useExportFuncionario(colabId, setorId)`:
1. Buscar escala OFICIAL: `escalas WHERE setor_id = ? AND status = 'OFICIAL' ORDER BY id DESC LIMIT 1`
2. Se null → botão não renderiza
3. Se existe → buscar `escalasService.obterCompleta(escalaId)`, filtrar alocações/violações pro `colaborador_id`
4. Retornar `{ loading, data, error }`

### Mode C (Em Massa) — dados carregados sequencialmente
EscalasHub tem lista de setores. Para export:
1. Filtrar setores com status OFICIAL
2. Para cada setor selecionado, carregar `escalasService.obterCompleta()` + colaboradores + funcões + regras
3. Carregar SEQUENCIALMENTE (não `Promise.all`) — evitar sobrecarga
4. Progresso: `current / total` atualizado no state do modal

---

## Chunk 1: Fundações (helpers + componentes base)

### Task 1: Helper getISOWeekNumber

**Files:**
- Create: `src/renderer/src/lib/date-helpers.ts`
- Test: `tests/renderer/date-helpers.spec.ts`

- [ ] **Step 1: Write the test**

```typescript
// tests/renderer/date-helpers.spec.ts
import { describe, it, expect } from 'vitest'
import { getISOWeekNumber, agruparPorSemanaISO } from '../../src/renderer/src/lib/date-helpers'

describe('getISOWeekNumber', () => {
  it('returns correct ISO week for 2026-03-01 (S9 or S10)', () => {
    // 2026-03-01 is a Sunday — ISO week assigns it to the week of the preceding Monday
    const result = getISOWeekNumber('2026-03-01')
    expect(result).toBe(9) // ISO: Sunday belongs to previous week
  })

  it('returns S10 for 2026-03-02 (Monday)', () => {
    expect(getISOWeekNumber('2026-03-02')).toBe(10)
  })

  it('returns S1 for first week of year', () => {
    expect(getISOWeekNumber('2026-01-05')).toBe(2)
  })
})

describe('agruparPorSemanaISO', () => {
  it('groups dates into ISO weeks', () => {
    const dates = ['2026-03-01', '2026-03-02', '2026-03-08', '2026-03-09']
    const result = agruparPorSemanaISO(dates)
    expect(result.length).toBeGreaterThanOrEqual(2)
    expect(result[0].semanaLabel).toMatch(/^S\d+/)
  })
})
```

- [ ] **Step 2: Run test, verify fail**

Run: `npx vitest run tests/renderer/date-helpers.spec.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

```typescript
// src/renderer/src/lib/date-helpers.ts

/**
 * Returns ISO 8601 week number for a date string (YYYY-MM-DD).
 * ISO weeks start on Monday. Week 1 is the week containing Jan 4th.
 */
export function getISOWeekNumber(dateStr: string): number {
  const d = new Date(dateStr + 'T00:00:00')
  const dayNum = d.getUTCDay() || 7 // Sunday = 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum) // Thursday of this week
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
}

/**
 * Format week label: "S10 — 02/03 a 08/03/2026"
 */
export function formatWeekLabel(startDate: string, endDate: string): string {
  const weekNum = getISOWeekNumber(startDate)
  const fmt = (d: string) => {
    const [y, m, dd] = d.split('-')
    return `${dd}/${m}`
  }
  const year = startDate.split('-')[0]
  return `S${weekNum} — ${fmt(startDate)} a ${fmt(endDate)}/${year}`
}

/**
 * Groups an array of date strings into ISO weeks.
 * Returns array of { semanaLabel, dates, startDate, endDate }
 */
export function agruparPorSemanaISO(dates: string[]): {
  semanaLabel: string
  weekNumber: number
  dates: string[]
  startDate: string
  endDate: string
}[] {
  if (dates.length === 0) return []

  const sorted = [...dates].sort()
  const weeks: Map<number, string[]> = new Map()

  for (const d of sorted) {
    const wn = getISOWeekNumber(d)
    if (!weeks.has(wn)) weeks.set(wn, [])
    weeks.get(wn)!.push(d)
  }

  return Array.from(weeks.entries())
    .sort(([a], [b]) => a - b)
    .map(([wn, wDates]) => ({
      semanaLabel: `S${wn}`,
      weekNumber: wn,
      dates: wDates,
      startDate: wDates[0],
      endDate: wDates[wDates.length - 1],
    }))
}
```

- [ ] **Step 4: Run test, verify pass**

Run: `npx vitest run tests/renderer/date-helpers.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/lib/date-helpers.ts tests/renderer/date-helpers.spec.ts
git commit -m "feat(export): add ISO week number helpers (S10, S11...)"
```

---

### Task 2: CicloGrid variant='export' (paginação max 4 sem/bloco)

**Files:**
- Modify: `src/renderer/src/componentes/CicloGrid.tsx`
- Modify: `src/renderer/src/lib/ciclo-grid-types.ts` (add variant type)

**Ref:** Spec seções 3.1 e 18.2

- [ ] **Step 1: Add variant prop to CicloGridProps**

In `ciclo-grid-types.ts`, add nothing (variant goes in CicloGrid.tsx props).

In `CicloGrid.tsx`, update the interface:
```typescript
interface CicloGridProps {
  data: CicloGridData
  mode: 'edit' | 'view'
  variant?: 'app' | 'export'  // NEW — default 'app'
  onFolgaChange?: (...)
  coverageActions?: CicloGridCoverageActions
  frameBorderClassName?: string
  className?: string
}
```

- [ ] **Step 2: Implement paginação para variant='export'**

Inside `CicloGrid`, before the return, add block-splitting logic:

```typescript
const MAX_WEEKS_PER_BLOCK = 4
const isExport = variant === 'export'

if (isExport && totalSemanas > MAX_WEEKS_PER_BLOCK) {
  // Build array of blocks
  const blocks: { start: number; end: number }[] = []
  for (let i = 0; i < totalSemanas; i += MAX_WEEKS_PER_BLOCK) {
    blocks.push({ start: i, end: Math.min(i + MAX_WEEKS_PER_BLOCK, totalSemanas) })
  }

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      {blocks.map((block, blockIdx) => (
        <div key={blockIdx} style={{ breakInside: 'avoid' }}>
          {blocks.length > 1 && (
            <div className="text-[10px] font-semibold text-muted-foreground mb-1 pl-1.5">
              S{block.start + 1} – S{block.end}
            </div>
          )}
          {renderTable(block.start, block.end)}
        </div>
      ))}
      {renderLegenda()}
    </div>
  )
}

// Otherwise: render single table as before
return (
  <div className={cn('flex flex-col gap-3', className)}>
    {renderWrapper(renderTable(0, totalSemanas))}
    {renderLegenda()}
  </div>
)
```

Extract current table rendering into `renderTable(startWeek, endWeek)` function that renders a `<table>` for just those weeks.

For variant='export', apply these CSS differences:
- `table-layout: fixed` (distribute columns equally)
- Font size: `style={{ fontSize: 10 }}` instead of 14
- No sticky columns (not needed — fits in width)
- No `overflow-x-auto` wrapper
- No FolgaSelect (just text)
- No coverageActions buttons

- [ ] **Step 3: Verify typecheck**

Run: `npm run typecheck`
Expected: 0 errors

- [ ] **Step 4: Visual test — open the app, navigate to a setor with escala, verify CicloGrid still works in app mode**

Run: `npm run dev` — navigate to Setores → Açougue → verify CicloGrid renders normally (variant='app' is default).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/componentes/CicloGrid.tsx
git commit -m "feat(export): CicloGrid variant='export' with pagination (max 4 weeks/block)"
```

---

### Task 3: ExportTimelineBarras — componente novo

**Files:**
- Create: `src/renderer/src/componentes/ExportTimelineBarras.tsx`

**Ref:** Spec seções 3.3 e 18.3. Protótipo visual: tab "Timeline Barras".

**Diferenças do TimelineGrid.tsx (app) — spec 18.3:**
| Aspecto | TimelineGrid (app) | ExportTimelineBarras (export) |
|---------|-------------------|------------------------------|
| Interação | Hover, click, tooltips, popover | NENHUMA (stateless, sem hooks) |
| Navegação | ◂/▸ por dia | Todos os dias empilhados |
| Scroll | Horizontal via CSS grid | NENHUM — largura flex |
| Altura por row | 52px | 26px (compacto pra print) |
| Eixo horas | Slots 15min | Marcadores proporcionais (07, 09, 11...) |
| Cobertura | Contagem dinâmica | Barra de intensidade estática |

- [ ] **Step 1: Implement timeToPercent helper**

```typescript
function timeToPercent(time: string, open: string, close: string): number {
  const toMin = (t: string) => { const [h,m] = t.split(':').map(Number); return h*60+m }
  const total = toMin(close) - toMin(open)
  const pos = toMin(time) - toMin(open)
  return Math.max(0, Math.min(100, (pos / total) * 100))
}
```

- [ ] **Step 2: Implement tipoFolga helper**

Derivar FF/FV/DF do dia + regra do colaborador (spec 18.4):
```typescript
function tipoFolga(
  data: string, regra: RegraHorarioColaborador | undefined,
  alocacoes: Alocacao[]
): 'FF' | 'FV' | 'DF' | 'F' {
  const dow = new Date(data + 'T00:00:00').getDay()
  const dayLabel = ['DOM','SEG','TER','QUA','QUI','SEX','SAB'][dow]
  if (regra?.folga_fixa_dia_semana === dayLabel) return 'FF'
  if (regra?.folga_variavel_dia_semana === dayLabel) {
    // FV ativa se trabalhou domingo NA MESMA SEMANA
    const domDate = encontrarDomingoDaSemana(data)
    const domAloc = alocacoes.find(a => a.data === domDate)
    if (domAloc?.status === 'TRABALHO') return 'FV'
  }
  if (dow === 0) return 'DF'
  return 'F'
}

function encontrarDomingoDaSemana(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  const diff = d.getDay() // 0=DOM, 1=SEG...
  d.setDate(d.getDate() - diff) // volta pro domingo
  return d.toISOString().split('T')[0]
}
```

- [ ] **Step 3: Implement renderização por dia**

Para cada data no array `datas`:
1. Section title: `{diaSemana} {dd/mm/yyyy}` — com `break-inside: avoid`
2. Eixo de horas: marcadores proporcionais usando `timeToPercent`
   ```tsx
   <div style={{ display:'flex', marginLeft:120, marginRight:40, position:'relative', height:10 }}>
     {['07:00','09:00','11:00','13:00','15:00','17:00','19:15'].map(h => (
       <span key={h} style={{ position:'absolute', left:`${timeToPercent(h, setor.hora_abertura, setor.hora_fechamento)}%`, fontSize:7, color:'var(--ex-muted)', transform:'translateX(-50%)' }}>{h}</span>
     ))}
   </div>
   ```
3. Row por colaborador (height 26px):
   - TRABALHO: barra `bg-primary` com `hora_inicio–hora_fim` em branco dentro. Se tem almoço: gap hachurado `background: repeating-linear-gradient(45deg, transparent, transparent 2px, rgba(warning, 0.2) 2px, rgba(warning, 0.2) 4px)` com "ALM". Total à direita.
   - FOLGA: texto italic muted com tipo derivado (FF/FV/DF)
   - INDISPONÍVEL: barra hachurada `bg-destructive/10 border-dashed border-destructive` com "Atestado/Indisponível"
4. Separador `border-top`
5. Barra de cobertura:
   - Calcular: para cada hora do eixo, contar quantas alocações TRABALHO cobrem aquele slot
   - Renderizar segmentos com opacidade proporcional: 1 pessoa=0.25, 2=0.5, 3+=0.7
   - Número de pessoas dentro de cada segmento
   - "max N" à direita

- [ ] **Step 4: Aplicar regras R1-R4**

Verificar:
- [ ] Componente é STATELESS (sem useState, useEffect, useRef) → R1
- [ ] Usa `alocacoes.hora_inicio/fim` do solver → R2
- [ ] Cores semânticas (bg-primary, text-warning, etc) → R3
- [ ] `break-inside: avoid` em cada div de dia → R4
- [ ] `print-color-adjust: exact` → R8

- [ ] **Step 5: Verify typecheck**

Run: `npm run typecheck`

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/componentes/ExportTimelineBarras.tsx
git commit -m "feat(export): new ExportTimelineBarras Gantt component for print"
```

---

### Task 4: ExportFolhaFuncionario — componente novo

**Files:**
- Create: `src/renderer/src/componentes/ExportFolhaFuncionario.tsx`

**Ref:** Spec seções 3.5 e 18.4. Protótipo visual: tab "Folha Funcionário".

- [ ] **Step 1: Create the component**

```typescript
interface ExportFolhaFuncionarioProps {
  colaborador: Colaborador
  setor: Setor
  escala: Escala
  alocacoes: Alocacao[]           // already filtered for this collaborator
  violacoes?: Violacao[]          // already filtered
  avisos?: Aviso[]                // already filtered
  tipoContrato: TipoContrato
  regra?: RegraHorarioColaborador
  mostrarAvisos?: boolean
}
```

Implement:
- Employee header card (avatar initials, name, posto, contrato, stats)
- Per-week table using `agruparPorSemanaISO()` with S{week} labels
- Columns: Dia, Horário, Almoço, Total, Obs
- `tipoFolga()` logic from spec 18.4 (FF/FV/DF derivation)
- Weekly total: sum `minutos_trabalho` / contract hours
- Filtered avisos block at bottom
- Footer with legend + version
- CSS: print `@page { size: A4 portrait }`

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/componentes/ExportFolhaFuncionario.tsx
git commit -m "feat(export): new ExportFolhaFuncionario A4 portrait sheet"
```

---

### Task 5: ExportAvisos — componente novo

**Files:**
- Create: `src/renderer/src/componentes/ExportAvisos.tsx`

**Ref:** Spec seções 3.6 e 17.4.

- [ ] **Step 1: Implement merge + deduplication logic**

```typescript
import type { Violacao } from '@shared/index'
import type { Aviso } from '@/componentes/AvisosSection'

interface UnifiedAviso {
  tipo: 'h' | 's' | 'i'  // hard, soft, info
  texto: string
  colaborador_id?: number | null
}

interface ExportAvisosProps {
  violacoes?: Violacao[]
  avisos?: Aviso[]
  filtrarColaboradorId?: number  // Mode B: só avisos deste colaborador
}

function mergeAvisos(violacoes: Violacao[], avisos: Aviso[]): UnifiedAviso[] {
  const merged: UnifiedAviso[] = []

  // 1. Violações solver → mapear severidade
  for (const v of violacoes) {
    merged.push({
      tipo: v.severidade === 'HARD' ? 'h' : 's',
      texto: `${v.colaborador_nome} — ${v.mensagem || v.regra}${v.data ? ` (${formatarData(v.data)})` : ''}`,
      colaborador_id: v.colaborador_id,
    })
  }

  // 2. Avisos operacionais → mapear nivel
  for (const a of avisos) {
    merged.push({
      tipo: a.nivel === 'error' ? 'h' : a.nivel === 'warning' ? 's' : 'i',
      texto: a.titulo + (a.descricao ? ': ' + a.descricao : ''),
      colaborador_id: null, // avisos operacionais são do setor
    })
  }

  // 3. Deduplicar por texto (pode haver overlap solver↔operacional)
  const seen = new Set<string>()
  const deduped = merged.filter(a => {
    if (seen.has(a.texto)) return false
    seen.add(a.texto)
    return true
  })

  // 4. Ordenar: error → warning → info
  const order = { h: 0, s: 1, i: 2 }
  deduped.sort((a, b) => order[a.tipo] - order[b.tipo])

  return deduped
}
```

- [ ] **Step 2: Implement render**

```tsx
export function ExportAvisos({ violacoes = [], avisos = [], filtrarColaboradorId }: ExportAvisosProps) {
  let unified = mergeAvisos(violacoes, avisos)

  // Mode B: filtrar só avisos deste colaborador
  if (filtrarColaboradorId != null) {
    unified = unified.filter(a =>
      a.colaborador_id === filtrarColaboradorId || a.colaborador_id == null
    )
  }

  if (unified.length === 0) return null

  const clsMap = { h: 'av-h', s: 'av-s', i: 'av-i' }  // print CSS classes

  return (
    <div style={{ breakInside: 'avoid' }}>
      <div className="ex-sec">Avisos ({unified.length})</div>
      {unified.map((a, i) => (
        <div key={i} className={`av ${clsMap[a.tipo]}`} dangerouslySetInnerHTML={{ __html: a.texto }} />
      ))}
    </div>
  )
}
```

- [ ] **Step 3: Verificar R1 (stateless) + R3 (cores semânticas)**

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/componentes/ExportAvisos.tsx
git commit -m "feat(export): new ExportAvisos with merge, dedup, filter by collaborator"
```

---

### Task 5.5: Hook useExportFuncionario (data loading Mode B)

**Files:**
- Create: `src/renderer/src/hooks/useExportFuncionario.ts`

**Ref:** Spec seção 14.6 Mode B + Pré-requisito Mode B.

- [x] **Step 1: Implement hook** (DONE 2026-03-15)

```typescript
import { useState, useCallback } from 'react'
import { escalasService } from '@/servicos/escalas'
import { colaboradoresService } from '@/servicos/colaboradores'
import type { Escala, Alocacao, Violacao, Setor, TipoContrato, RegraHorarioColaborador } from '@shared/index'

interface FuncionarioExportData {
  colaborador: Colaborador
  setor: Setor
  escala: Escala
  alocacoes: Alocacao[]
  violacoes: Violacao[]
  tipoContrato: TipoContrato
  regra?: RegraHorarioColaborador
}

export function useExportFuncionario() {
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<FuncionarioExportData | null>(null)

  const carregar = useCallback(async (colabId: number, setorId: number) => {
    setLoading(true)
    try {
      // 1. Buscar escala OFICIAL do setor
      const escalas = await escalasService.listarPorSetor(setorId)
      const oficial = escalas.find(e => e.status === 'OFICIAL')
      if (!oficial) { setData(null); return null }

      // 2. Buscar detalhes completos
      const completa = await escalasService.obterCompleta(oficial.id)

      // 3. Filtrar pro colaborador
      const alocacoes = completa.alocacoes.filter(a => a.colaborador_id === colabId)
      const violacoes = completa.violacoes.filter(v => v.colaborador_id === colabId)

      // 4. Buscar regra + contrato + setor
      // ... (usar serviços existentes)

      const result: FuncionarioExportData = { ... }
      setData(result)
      return result
    } finally {
      setLoading(false)
    }
  }, [])

  return { loading, data, carregar }
}
```

- [x] **Step 2: Verify typecheck** (DONE 2026-03-15 — 0 errors node + web)

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/hooks/useExportFuncionario.ts
git commit -m "feat(export): useExportFuncionario hook for lazy-loading collaborator export data"
```

---

### Task 5.6: Helper buildPreviewAvisos (extrair do SetorDetalhe)

**Files:**
- Create: `src/renderer/src/lib/build-avisos.ts`
- Modify: `src/renderer/src/paginas/SetorDetalhe.tsx` (extract useMemo to helper)

**Ref:** Spec seção 14.6 Mode A — "previewAvisos é computado como useMemo no SetorDetalhe — precisa ser extraído"

- [ ] **Step 1: Extract previewAvisos computation**

Ler o `useMemo` de `previewAvisos` no SetorDetalhe.tsx e extrair pra função pura:

```typescript
// src/renderer/src/lib/build-avisos.ts
import type { Aviso } from '@/componentes/AvisosSection'

export function buildPreviewAvisos(params: {
  avisosOperacao: AvisoEscala[]
  previewDiagnostics: ...
  setorNome: string
  // ... other deps from the useMemo
}): Aviso[] {
  // ... mesma lógica que hoje está no useMemo
}
```

- [ ] **Step 2: Refatorar SetorDetalhe pra usar o helper**

```typescript
// Antes: const previewAvisos = useMemo(() => { ... }, [...])
// Depois: const previewAvisos = useMemo(() => buildPreviewAvisos({ ... }), [...])
```

- [ ] **Step 3: Verify typecheck + visual test (SetorDetalhe still works)**

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/lib/build-avisos.ts src/renderer/src/paginas/SetorDetalhe.tsx
git commit -m "refactor: extract buildPreviewAvisos helper from SetorDetalhe"
```

---

## Chunk 2: ExportarEscala refatorado + ExportModal 3 modes

### Task 6: Refatorar ExportarEscala como componente unificado

**Files:**
- Modify: `src/renderer/src/componentes/ExportarEscala.tsx`

**Ref:** Spec seção 2.

- [ ] **Step 1: Read current ExportarEscala.tsx to understand existing props and structure**

- [ ] **Step 2: Update interface to match spec**

```typescript
interface ExportarEscalaProps {
  escala: Escala
  alocacoes: Alocacao[]
  colaboradores: Colaborador[]
  setor: Setor
  violacoes?: Violacao[]
  avisos?: Aviso[]
  tiposContrato?: TipoContrato[]
  funcoes?: Funcao[]
  horariosSemana?: SetorHorarioSemana[]
  regrasPadrao?: RegraHorarioColaborador[]

  // Section visibility
  mostrarCiclo?: boolean          // default true
  mostrarSemanal?: boolean        // default true
  mostrarTimeline?: boolean       // default true
  timelineMode?: 'barras' | 'grid'  // default 'barras'
  mostrarAvisos?: boolean         // default true

  // Mode
  mode?: 'setor' | 'funcionario'
  colaboradorId?: number
}
```

- [ ] **Step 3: Implement section toggling**

Each section renders conditionally based on its prop. Structure:

```tsx
return (
  <div className="bg-white p-5 font-sans text-xs text-gray-900 print:p-0">
    {/* Header */}
    <ExportHeader ... />

    {/* Ciclo */}
    {mostrarCiclo && mode !== 'funcionario' && (
      <section style={{ breakBefore: 'auto' }}>
        <h2 className="ex-sec">Ciclo Rotativo</h2>
        <CicloGrid data={cicloGridData} mode="view" variant="export" />
      </section>
    )}

    {/* Semanal */}
    {mostrarSemanal && mode !== 'funcionario' && (
      <section>
        <ExportSemanal ... />
      </section>
    )}

    {/* Timeline */}
    {mostrarTimeline && mode !== 'funcionario' && (
      <section style={{ breakBefore: 'page' }}>
        {timelineMode === 'barras'
          ? <ExportTimelineBarras ... />
          : <EscalaTimelineDiaria ... />
        }
      </section>
    )}

    {/* Funcionário */}
    {mode === 'funcionario' && colaboradorId && (
      <ExportFolhaFuncionario ... />
    )}

    {/* Avisos */}
    {mostrarAvisos && (
      <ExportAvisos violacoes={violacoes} avisos={avisos} />
    )}

    {/* Footer */}
    <ExportFooter ... />

    {/* Print styles — dynamic orientation */}
    <style>{`
      @media print {
        @page { size: A4 ${mode === 'funcionario' ? 'portrait' : 'landscape'}; margin: 10mm; }
      }
    `}</style>
  </div>
)
```

- [ ] **Step 4: Implement inline Semanal section**

Create a local `ExportSemanal` component inside the file (or extract to separate file) that:
- Uses `agruparPorSemanaISO()` to group alocações by week
- Renders one `<table class="sem">` per week with S{isoWeek} label
- Shows hora_inicio (bold) + hora_fim per cell for TRABALHO
- Shows FF/FV/DF for folgas (derived from regra)

- [ ] **Step 5: Verify typecheck + visual test**

Run: `npm run typecheck`
Run: `npm run dev` — navigate to escala, open export modal, verify preview renders.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/componentes/ExportarEscala.tsx
git commit -m "feat(export): refactor ExportarEscala as unified component with section toggles"
```

---

### Task 7: Refatorar ExportModal — 3 modes

**Files:**
- Modify: `src/renderer/src/componentes/ExportModal.tsx`

**Ref:** Spec seções 4.2, 4.3, 4.4, 18.5.

- [x] **Step 1: Read current ExportModal.tsx**

- [x] **Step 2: Rewrite interface for 3 modes**

Replace the old interface (`context: 'escala' | 'hub'`, `formato`, `setoresExport`, etc) with the new one from spec section 18.5:

```typescript
interface ExportModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: 'setor' | 'funcionario' | 'massa'
  escalaData?: { ... }       // mode setor
  funcionarioData?: { ... }  // mode funcionario
  massaData?: { ... }        // mode massa
  onExportHTML?: (html: string, filename: string) => void
  onPrint?: (html: string, landscape: boolean) => void
  onCSV?: (csv: string, filename: string) => void
  onExportMassa?: (setorIds: number[], incluirAvisos: boolean) => void
}
```

- [x] **Step 3: Implement Mode A (Setor)**

Left side: `<ExportPreview>` wrapping `<ExportarEscala>` with toggle-controlled props.
Right side: Toggle list (Ciclo, Semanal, Timeline + dropdown, Avisos).
Footer: Cancel, CSV, Baixar HTML, Imprimir.

- [x] **Step 4: Implement Mode B (Funcionário)**

Left side: `<ExportPreview>` wrapping `<ExportarEscala mode="funcionario">`.
Right side: Collaborator info + avisos toggle only.
Footer: Cancel, Baixar HTML, Imprimir.

- [x] **Step 5: Implement Mode C (Em Massa)**

No preview. Narrow modal.
Checkbox list of setores (only OFICIAL enabled).
Select-all with indeterminate state.
Toggle "Incluir avisos".
Footer: count + Cancel + "Exportar N setores".

- [x] **Step 6: Remove old code**

Deleted `HubOptions` and `EscalaContentOptions` (replaced by `SetorOptions` inline toggles and `LegacyContentOptions` for backward compat).
Old `context` prop handling preserved via legacy render path (auto-detected) until Task 9 migrates callers.

- [x] **Step 7: Verify typecheck**

Run: `npm run typecheck` — PASS (0 errors node + web)

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/componentes/ExportModal.tsx
git commit -m "feat(export): refactor ExportModal with 3 modes (setor, funcionario, massa)"
```

---

### Task 8: buildStandaloneHtml + IPC handler — ajuste landscape/portrait

**Files:**
- Modify: `src/renderer/src/lib/export-standalone-html.ts`
- Modify: `src/main/tipc.ts` (exportImprimirPDF handler)
- Modify: `src/renderer/src/servicos/exportar.ts`

**Ref:** Spec seções 14.4 e 14.5.

- [ ] **Step 1: Add pageOrientation to buildStandaloneHtml**

```typescript
interface BuildStandaloneHtmlOptions {
  title?: string
  extraCss?: string
  forceLight?: boolean
  pageOrientation?: 'landscape' | 'portrait'  // NEW
}
```

Inject into the CSS:
```css
@page { size: A4 ${options.pageOrientation ?? 'landscape'}; margin: 10mm; }
```

- [ ] **Step 2: Update exportImprimirPDF handler**

Add `landscape?: boolean` to input. Pass to `printToPDF({ landscape: input.landscape ?? true })`.

- [ ] **Step 3: Update exportar service**

```typescript
imprimirPDF: (html: string, filename?: string, landscape?: boolean) =>
  client['export.imprimirPDF']({ html, filename, landscape }),
```

- [ ] **Step 4: Verify typecheck**

Run: `npm run typecheck`

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/lib/export-standalone-html.ts src/main/tipc.ts src/renderer/src/servicos/exportar.ts
git commit -m "feat(export): dynamic A4 orientation (landscape/portrait) for print and HTML"
```

---

## Chunk 3: Integração nas páginas + limpeza

### Task 9: Integrar ExportModal mode='setor' em EscalaPagina e SetorDetalhe

**Files:**
- Modify: `src/renderer/src/paginas/EscalaPagina.tsx`
- Modify: `src/renderer/src/paginas/SetorDetalhe.tsx`

**Ref:** Spec seção 5.1.

- [ ] **Step 1: Update EscalaPagina**

Replace old export state/handlers with new mode='setor' ExportModal.
Remove `gerarHTMLFuncionarioById`, `handleExportFuncionariosBatch`, batch format handling.
Wire up toggles → ExportarEscala props → preview.
Wire up onExportHTML, onPrint, onCSV callbacks using existing `renderToStaticMarkup` + `buildStandaloneHtml` flow.

Pass `avisos` (from `previewAvisos` or equivalent) into the modal data.

- [ ] **Step 2: Update SetorDetalhe**

Same pattern — replace old ExportModal usage with mode='setor'.
Reuse same export handlers.

- [ ] **Step 3: Verify typecheck + visual test**

Run: `npm run typecheck`
Run: `npm run dev` — test export flow from both EscalaPagina and SetorDetalhe.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/paginas/EscalaPagina.tsx src/renderer/src/paginas/SetorDetalhe.tsx
git commit -m "feat(export): integrate ExportModal mode='setor' in EscalaPagina and SetorDetalhe"
```

---

### Task 10: Botão "Exportar Escala" em ColaboradorDetalhe (Mode B)

**Files:**
- Modify: `src/renderer/src/paginas/ColaboradorDetalhe.tsx`

**Ref:** Spec seções 4.3 e 5.2.

- [ ] **Step 1: Add state and data loading**

```typescript
const [exportOpen, setExportOpen] = useState(false)
const [exportData, setExportData] = useState<FuncionarioExportData | null>(null)

// Check if setor has OFICIAL escala
const hasOficialEscala = useMemo(() => {
  // Query or derive from existing data
}, [colab, escalas])
```

When opening the modal, load the full escala data for the setor, filter for this collaborator.

- [ ] **Step 2: Add button in the UI**

In the page header area (next to other action buttons), conditionally render:
```tsx
{hasOficialEscala && (
  <Button variant="outline" size="sm" onClick={handleOpenExportFuncionario}>
    <Download className="mr-1 size-3.5" />
    Exportar Escala
  </Button>
)}
```

- [ ] **Step 3: Add ExportModal mode='funcionario'**

```tsx
<ExportModal
  open={exportOpen}
  onOpenChange={setExportOpen}
  mode="funcionario"
  funcionarioData={exportData}
  onExportHTML={handleExportHTML}
  onPrint={handlePrint}
/>
```

- [ ] **Step 4: Verify typecheck + visual test**

Run: `npm run typecheck`
Run: `npm run dev` — navigate to a collaborator whose setor has OFICIAL, verify button appears and modal opens.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/paginas/ColaboradorDetalhe.tsx
git commit -m "feat(export): add 'Exportar Escala' button in ColaboradorDetalhe (mode B)"
```

---

### Task 11: Botão "Exportar em Massa" em EscalasHub (Mode C)

**Files:**
- Modify: `src/renderer/src/paginas/EscalasHub.tsx`

**Ref:** Spec seções 4.4 e 5.3.

- [ ] **Step 1: Add button in page header**

```tsx
<PageHeader
  breadcrumbs={[{ label: 'Dashboard', href: '/' }, { label: 'Escalas' }]}
  actions={
    <Button variant="outline" size="sm" onClick={() => setMassaOpen(true)}>
      <Download className="mr-1 size-3.5" />
      Exportar em Massa
    </Button>
  }
/>
```

- [ ] **Step 2: Add ExportModal mode='massa'**

Build `massaData` from the existing setor list:
```typescript
const massaSetores = items.map(item => ({
  id: item.setor.id,
  nome: item.setor.nome,
  status: item.escalaAtual?.status ?? null,
}))
```

Wire up `onExportMassa` callback:
1. For each selected setor ID, load escala completa
2. Render ExportarEscala with renderToStaticMarkup
3. Wrap with buildStandaloneHtml
4. Call exportarService.batchHTML

Show progress during batch generation.

- [ ] **Step 3: Remove old HubOptions and hub-related export code**

Remove the old `ExportModal context="hub"` usage, old format radio buttons, old batch/funcionario/csv modes from this page.

- [ ] **Step 4: Verify typecheck + visual test**

Run: `npm run typecheck`
Run: `npm run dev` — go to Escalas page, verify button and modal.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/paginas/EscalasHub.tsx
git commit -m "feat(export): add 'Exportar em Massa' in EscalasHub (mode C, OFICIAL only)"
```

---

### Task 12: View toggles no app (Ciclo/Semanal/Timeline switch)

**Files:**
- Modify: `src/renderer/src/paginas/EscalaPagina.tsx` (or SetorDetalhe — wherever the escala section lives)
- Possibly create: `src/renderer/src/hooks/useEscalaViewPrefs.ts`

**Ref:** Spec seção 19.

- [ ] **Step 1: Create view prefs hook**

```typescript
// src/renderer/src/hooks/useEscalaViewPrefs.ts
import { useState, useCallback } from 'react'

interface EscalaViewPrefs {
  showCiclo: boolean
  showSemanal: boolean
  showTimeline: boolean
  timelineView: 'barras' | 'grid'
}

const STORAGE_KEY = 'escala-view-prefs'
const DEFAULTS: EscalaViewPrefs = {
  showCiclo: true, showSemanal: true, showTimeline: true, timelineView: 'barras'
}

export function useEscalaViewPrefs() {
  const [prefs, setPrefs] = useState<EscalaViewPrefs>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : DEFAULTS
    } catch { return DEFAULTS }
  })

  const update = useCallback((partial: Partial<EscalaViewPrefs>) => {
    setPrefs(prev => {
      const next = { ...prev, ...partial }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      return next
    })
  }, [])

  return [prefs, update] as const
}
```

- [ ] **Step 2: Add toggles in escala section header**

```tsx
<div className="flex items-center gap-2">
  <Toggle pressed={prefs.showCiclo} onPressedChange={v => update({ showCiclo: v })}>Ciclo</Toggle>
  <Toggle pressed={prefs.showSemanal} onPressedChange={v => update({ showSemanal: v })}>Semanal</Toggle>
  <Toggle pressed={prefs.showTimeline} onPressedChange={v => update({ showTimeline: v })}>Timeline</Toggle>
  {prefs.showTimeline && (
    <ToggleGroup type="single" value={prefs.timelineView} onValueChange={v => update({ timelineView: v as 'barras' | 'grid' })}>
      <ToggleGroupItem value="barras"><BarChart3 className="size-4" /></ToggleGroupItem>
      <ToggleGroupItem value="grid"><Table2 className="size-4" /></ToggleGroupItem>
    </ToggleGroup>
  )}
</div>
```

- [ ] **Step 3: Conditionally render sections based on prefs**

- [ ] **Step 4: Initialize export modal toggles from prefs (spec 19.4)**

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/hooks/useEscalaViewPrefs.ts src/renderer/src/paginas/EscalaPagina.tsx
git commit -m "feat(export): view toggles for Ciclo/Semanal/Timeline in app + localStorage persistence"
```

---

### Task 13: Atualizar Semana do Ano em todos os labels

**Files:**
- Modify: `src/renderer/src/componentes/EscalaTimelineDiaria.tsx`
- Modify: `src/renderer/src/componentes/CicloGrid.tsx` (S1→ S{isoWeek} in header)
- Modify: any other place that shows "Semana 1", "Semana 2"

**Ref:** Spec seções 3.2, 10.2, 19.5.

- [ ] **Step 1: Search for "Semana" or "S1", "S2" patterns in renderer**

```bash
grep -rn "Semana \|S{sem\|semanaIdx + 1" src/renderer/src/
```

- [ ] **Step 2: Replace with `S${getISOWeekNumber(date)}` using date-helpers**

- [ ] **Step 3: Verify typecheck + visual test**

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(export): use ISO week numbers (S10, S11...) everywhere instead of S1, S2"
```

---

### Task 14: Atualizar gerarCSV para incluir avisos operacionais

**Files:**
- Modify: `src/renderer/src/lib/gerarCSV.ts`

**Ref:** Spec seção 14.8.

- [ ] **Step 1: Add optional avisos param to gerarCSVViolacoes**

```typescript
export function gerarCSVViolacoes(
  escalas: EscalaCompletaV3[],
  setores: Setor[],
  avisos?: Aviso[],
): string {
  // ... existing violations ...
  // Append operational alerts
  if (avisos?.length) {
    for (const a of avisos) {
      lines.push(row(['', setores[0]?.nome ?? '', a.id, a.nivel, '', a.titulo + (a.descricao ? ': ' + a.descricao : '')]))
    }
  }
  return lines.join('\n')
}
```

- [ ] **Step 2: Update callers to pass avisos**

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/lib/gerarCSV.ts
git commit -m "feat(export): include operational alerts in CSV violations export"
```

---

### Task 15: Limpeza de código morto

**Files:**
- Delete: `src/renderer/src/lib/gerarHTMLFuncionario.ts`
- Modify: `src/renderer/src/paginas/EscalaPagina.tsx` (remove dead imports/functions)
- Modify: `src/renderer/src/paginas/EscalasHub.tsx` (remove dead imports/functions)
- Modify: `src/renderer/src/componentes/ExportModal.tsx` (remove dead code)

**Ref:** Spec seção 15.

- [ ] **Step 1: Delete gerarHTMLFuncionario.ts**

```bash
rm src/renderer/src/lib/gerarHTMLFuncionario.ts
```

- [ ] **Step 2: Remove all imports and usages**

Search and remove:
```bash
grep -rn "gerarHTMLFuncionario" src/
grep -rn "HubOptions" src/
grep -rn "context.*=.*'hub'" src/renderer/
```

Remove: `gerarHTMLFuncionarioById`, `handleExportFuncionariosBatch`, old format state, batch-related code.

- [ ] **Step 3: Verify clean build**

```bash
npm run typecheck   # 0 errors
grep -rn "gerarHTMLFuncionario" src/   # 0 results
grep -rn "HubOptions" src/             # 0 results
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore(export): remove dead code (gerarHTMLFuncionario, HubOptions, old batch flow)"
```

---

### Task 16: Teste visual completo de impressão

**Files:** None (manual testing)

- [ ] **Step 1: Test Mode A (Setor)**

1. `npm run dev`
2. Navigate to Setores → Açougue → Escala → Exportar
3. Turn all toggles ON
4. Click "Imprimir" → verify PDF is A4 landscape
5. Verify: CicloGrid paginated, Semanal with S{week}, Timeline Barras, Avisos unified
6. Turn off Ciclo → verify section disappears from preview
7. Switch Timeline dropdown to "Grid" → verify grid appears
8. Click "Baixar HTML" → open file in browser → verify self-contained
9. Click "CSV" → open in Numbers/Excel → verify encoding + separador

- [ ] **Step 2: Test Mode B (Funcionário)**

1. Navigate to Colaboradores → Mateus
2. Verify "Exportar Escala" button appears (setor has OFICIAL)
3. Click → verify modal opens with Folha do Funcionário preview
4. Click "Imprimir" → verify PDF is A4 portrait
5. Verify: employee header, weekly tables with S{week}, totals correct, avisos filtered

- [ ] **Step 3: Test Mode C (Em Massa)**

1. Navigate to Escalas
2. Click "Exportar em Massa"
3. Verify: only OFICIAL setores have enabled checkboxes
4. Select 2 → verify "Exportar 2 setores" button
5. Click → verify file picker opens, HTMLs saved to folder

- [ ] **Step 4: Test A4 fit**

1. Generate export with CicloGrid 7 weeks → verify 2 blocks (4+3), no horizontal overflow
2. Generate export with CicloGrid 2 weeks → verify 1 block, spacious
3. Generate Folha Funcionário → verify portrait, all weeks present, totals correct

- [ ] **Step 5: Commit any fixes found during testing**

```bash
git commit -m "fix(export): visual testing adjustments"
```

---

### Task 17: Validação contra Spec — Acceptance Criteria (spec seção 13)

**Ref:** Spec seção 13 — 31 critérios de aceitação organizados por mode.

- [ ] **Step 1: Mode A — Export Setor (spec 13.1)**

- [ ] Modal abre de EscalaPagina E SetorDetalhe (mesmo componente, mesmo código)
- [ ] Preview renderiza em tempo real conforme toggles ON/OFF
- [ ] Toggle OFF oculta seção, toggle ON mostra
- [ ] Dropdown Barras/Grid funciona na Timeline Diária
- [ ] Pelo menos 1 toggle ON para habilitar botões (senão disabled)
- [ ] [Print] gera PDF A4 landscape sem cortar lateralmente
- [ ] [Baixar HTML] gera arquivo self-contained que abre no browser
- [ ] [CSV] exporta alocações + comparação demanda + violações + avisos operacionais
- [ ] CicloGrid com 7 semanas pagina em 2 blocos (4+3) sem estourar
- [ ] Semanas usam número do ano (S10, S11... via getISOWeekNumber)
- [ ] Avisos unificados (solver HARD/SOFT + operacionais COB_DEFICIT etc)
- [ ] Footer com legenda correta e versão do app

- [ ] **Step 2: Mode B — Export Funcionário (spec 13.2)**

- [ ] Botão "Exportar Escala" aparece em ColaboradorDetalhe SÓ se setor tem escala OFICIAL
- [ ] Botão NÃO aparece se setor tem RASCUNHO ou sem escala
- [ ] Modal renderiza Folha do Funcionário (header + tabelas por semana)
- [ ] Toggle de avisos pessoais funciona (ON/OFF)
- [ ] Print gera PDF A4 portrait (NÃO landscape)
- [ ] HTML é self-contained
- [ ] Horários vêm do solver (alocações), NÃO do perfil de horário
- [ ] Total por semana correto: soma minutos_trabalho / horas contrato
- [ ] Semanas com S{ISO_WEEK}
- [ ] Tipo de folga derivado corretamente (FF/FV/DF vs F genérico)

- [ ] **Step 3: Mode C — Export em Massa (spec 13.3)**

- [ ] Botão "Exportar em Massa" aparece no header do EscalasHub (direita)
- [ ] Modal mostra checkboxes para setores
- [ ] Setores sem escala ou RASCUNHO ficam disabled (opacity 0.3)
- [ ] "Selecionar todos" com comportamento indeterminate correto
- [ ] Toggle "Incluir avisos" funciona
- [ ] Exporta batch de HTMLs numa pasta (1 por setor)
- [ ] Sem preview no modal

- [ ] **Step 4: Print/A4 (spec 13.4)**

- [ ] Nenhum conteúdo estoura lateralmente em A4 landscape (setor) OU portrait (func)
- [ ] Page-break vertical natural entre seções
- [ ] CicloGrid: break-inside avoid por bloco
- [ ] Escala Semanal: break-inside avoid por tabela de semana
- [ ] Timeline: break-inside avoid por dia
- [ ] Cores aparecem na impressão (print-color-adjust: exact)

- [ ] **Step 5: Verificação de limpeza (spec 15)**

```bash
# Nenhum import órfão
grep -rn "gerarHTMLFuncionario" src/   # 0 resultados
grep -rn "HubOptions" src/             # 0 resultados
grep -rn "context.*=.*'hub'" src/renderer/  # 0 resultados

# CoberturaChart NÃO aparece em export
grep -rn "CoberturaChart" src/renderer/src/componentes/Export  # 0 resultados

# Typecheck limpo
npm run typecheck  # 0 erros
```

- [ ] **Step 6: Verificação de fontes de verdade (spec 17.1)**

Abrir DevTools, inspecionar dados no preview do modal:
- [ ] `alocacoes[0].hora_inicio` vem do banco (solver output), NÃO calculado
- [ ] `alocacoes[0].minutos_trabalho` é o valor salvo, NÃO `hora_fim - hora_inicio`
- [ ] `violacoes[]` são as do banco, NÃO recalculadas no frontend
- [ ] Folha Funcionário: total semanal = soma de `minutos_trabalho`, comparado com `tipo_contrato.horas_semanais`

- [ ] **Step 7: Commit final**

```bash
git commit -m "docs: validation complete — all 31 acceptance criteria verified"
```
