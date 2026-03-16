# Export Refinement Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corrigir bugs de dark mode no export, eliminar código duplicado, converter ExportAvisos para inline styles, e adicionar versão do app no footer.

**Architecture:** Fixes cirúrgicos em arquivos existentes. Criar 1 helper shared novo (folga-helpers.ts). Todas as mudanças são no renderer — nenhuma mudança de IPC, banco ou schema.

**Tech Stack:** React 19, TypeScript, inline CSS properties (não Tailwind) para componentes de export.

**Spec:** `docs/superpowers/specs/2026-03-15-export-refinement.md`

---

## File Structure

| Arquivo | Ação | Responsabilidade |
|---------|------|-----------------|
| `src/renderer/src/lib/folga-helpers.ts` | CRIAR | `tipoFolga` + `encontrarDomingoDaSemana` compartilhados |
| `src/renderer/src/componentes/ExportAvisos.tsx` | MODIFICAR | Converter de Tailwind classes para inline styles |
| `src/renderer/src/componentes/ExportarEscala.tsx` | MODIFICAR | Remover tipoFolga local, remover @page style, adicionar appVersion prop, fix colabAvisos |
| `src/renderer/src/componentes/ExportTimelineBarras.tsx` | MODIFICAR | Remover tipoFolga local, importar do helper |
| `src/renderer/src/componentes/ExportFolhaFuncionario.tsx` | MODIFICAR | Remover tipoFolga local, importar do helper |
| `src/renderer/src/paginas/EscalaPagina.tsx` | MODIFICAR | Adicionar forceLight: true nas chamadas de buildStandaloneHtml |
| `src/renderer/src/paginas/SetorDetalhe.tsx` | MODIFICAR | Adicionar forceLight: true |
| `src/renderer/src/paginas/ColaboradorDetalhe.tsx` | MODIFICAR | Adicionar forceLight: true |
| `src/renderer/src/paginas/EscalasHub.tsx` | MODIFICAR | Adicionar forceLight: true |

---

## Chunk 1: Todas as tasks

### Task 1: Criar folga-helpers.ts (extrair código duplicado)

**Files:**
- Create: `src/renderer/src/lib/folga-helpers.ts`

- [ ] **Step 1: Ler as 3 versões atuais de tipoFolga**

Ler e comparar:
- `src/renderer/src/componentes/ExportarEscala.tsx` linhas 81-110 (versão com 4 params)
- `src/renderer/src/componentes/ExportFolhaFuncionario.tsx` linhas 52-90 (versão com 3 params)
- `src/renderer/src/componentes/ExportTimelineBarras.tsx` linhas 43-70 (versão com 3 params)

- [ ] **Step 2: Criar o helper unificado**

```typescript
// src/renderer/src/lib/folga-helpers.ts
import type { Alocacao, RegraHorarioColaborador } from '@shared/index'

const DAY_LABELS = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB'] as const

/**
 * Encontra o domingo da semana que contém a data.
 * Usado para verificar se o colaborador trabalhou no domingo (XOR FV same-week).
 */
export function encontrarDomingoDaSemana(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  const diff = d.getDay()
  d.setDate(d.getDate() - diff)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

/**
 * Deriva o tipo de folga a partir da regra do colaborador e das alocações.
 *
 * - FF: folga_fixa_dia_semana bate com o dia
 * - FV: folga_variavel_dia_semana bate E trabalhou domingo na mesma semana
 * - DF: é domingo
 * - F: folga genérica
 *
 * @param data Data ISO (YYYY-MM-DD)
 * @param regra Regra de horário do colaborador (pode ser undefined)
 * @param alocacoes Alocações relevantes (podem ser pré-filtradas ou completas)
 * @param colaboradorId Opcional — filtra alocações por este ID quando não pré-filtradas
 */
export function tipoFolga(
  data: string,
  regra: RegraHorarioColaborador | undefined,
  alocacoes: Alocacao[],
  colaboradorId?: number,
): 'FF' | 'FV' | 'DF' | 'F' {
  const dow = new Date(data + 'T00:00:00').getDay()
  const dayLabel = DAY_LABELS[dow]

  if (regra?.folga_fixa_dia_semana === dayLabel) return 'FF'

  if (regra?.folga_variavel_dia_semana === dayLabel) {
    const domDate = encontrarDomingoDaSemana(data)
    const domAloc = alocacoes.find(a => {
      if (a.data !== domDate) return false
      if (colaboradorId != null && a.colaborador_id !== colaboradorId) return false
      return true
    })
    if (domAloc?.status === 'TRABALHO') return 'FV'
  }

  if (dow === 0) return 'DF'
  return 'F'
}
```

- [ ] **Step 3: Verificar typecheck**

Run: `npm run typecheck`
Expected: 0 errors

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/lib/folga-helpers.ts
git commit -m "refactor: extract tipoFolga + encontrarDomingoDaSemana to shared helper"
```

---

### Task 2: Remover duplicatas dos 3 componentes

**Files:**
- Modify: `src/renderer/src/componentes/ExportarEscala.tsx`
- Modify: `src/renderer/src/componentes/ExportFolhaFuncionario.tsx`
- Modify: `src/renderer/src/componentes/ExportTimelineBarras.tsx`

- [ ] **Step 1: ExportarEscala.tsx — remover funções locais, adicionar import**

Adicionar no topo:
```typescript
import { tipoFolga } from '@/lib/folga-helpers'
```

Remover as funções locais `encontrarDomingoDaSemana` (linhas ~81-89) e `tipoFolga` (linhas ~92-110).

A chamada em `ExportSemanal` (linha ~371) já passa 4 args: `tipoFolga(dh.iso, regra, alocacoes, colab.id)` — compatível.

- [ ] **Step 2: ExportFolhaFuncionario.tsx — remover funções locais, adicionar import**

Adicionar no topo:
```typescript
import { tipoFolga } from '@/lib/folga-helpers'
```

Remover as funções locais `encontrarDomingoDaSemana` (linhas ~52-60) e `tipoFolga` (linhas ~72-90).

A chamada (linha ~347) usa 3 args: `tipoFolga(dt, regra, alocacoes)` — compatível (colaboradorId é opcional).

- [ ] **Step 3: ExportTimelineBarras.tsx — remover funções locais, adicionar import**

Adicionar no topo:
```typescript
import { tipoFolga } from '@/lib/folga-helpers'
```

Remover as funções locais `encontrarDomingoDaSemana` (linhas ~43-50) e `tipoFolga` (linhas ~51-70).

A chamada (linha ~601) usa 3 args: `tipoFolga(data, regra, dayAlocs)` — compatível.

- [ ] **Step 4: Verificar que não sobrou nenhuma versão local**

Run:
```bash
grep -rn "function tipoFolga\|function encontrarDomingoDaSemana" src/renderer/src/componentes/
```
Expected: 0 results (todas removidas)

```bash
grep -rn "from.*folga-helpers" src/renderer/src/componentes/
```
Expected: 3 results (os 3 imports)

- [ ] **Step 5: Verificar typecheck**

Run: `npm run typecheck`
Expected: 0 errors

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/componentes/ExportarEscala.tsx src/renderer/src/componentes/ExportFolhaFuncionario.tsx src/renderer/src/componentes/ExportTimelineBarras.tsx
git commit -m "refactor: use shared tipoFolga from folga-helpers in 3 export components"
```

---

### Task 3: Converter ExportAvisos de Tailwind para inline styles

**Files:**
- Modify: `src/renderer/src/componentes/ExportAvisos.tsx`

- [ ] **Step 1: Ler o arquivo atual completo**

- [ ] **Step 2: Substituir TIPO_STYLES de className strings para React.CSSProperties**

```typescript
// ANTES (Tailwind classes)
const TIPO_STYLES = {
  h: 'border border-red-200 bg-red-50 text-red-800',
  s: 'border border-amber-200 bg-amber-50 text-amber-800',
  i: 'border border-blue-200 bg-blue-50 text-blue-800',
} as const

// DEPOIS (inline styles)
const TIPO_STYLES: Record<'h' | 's' | 'i', React.CSSProperties> = {
  h: { border: '1px solid #fecaca', background: '#fef2f2', color: '#991b1b' },
  s: { border: '1px solid #fde68a', background: '#fffbeb', color: '#78350f' },
  i: { border: '1px solid #bfdbfe', background: '#eff6ff', color: '#1e40af' },
}
```

- [ ] **Step 3: Substituir LABEL_STYLES para inline**

```typescript
// ANTES
const LABEL_STYLES = {
  h: 'text-red-600',
  s: 'text-amber-800',
  i: 'text-blue-700',
} as const

// DEPOIS
const LABEL_STYLES: Record<'h' | 's' | 'i', React.CSSProperties> = {
  h: { color: '#dc2626' },
  s: { color: '#92400e' },
  i: { color: '#1d4ed8' },
}
```

- [ ] **Step 4: Converter todo o JSX de className para style**

Substituir cada elemento:

```tsx
// ANTES
<div style={{ breakInside: 'avoid' }} className="mt-6">

// DEPOIS
<div style={{ breakInside: 'avoid', marginTop: 24 }}>
```

```tsx
// ANTES
<h2 className="mb-2.5 border-b border-gray-200 pb-1.5 text-sm font-semibold text-gray-900">

// DEPOIS
<h2 style={{ marginBottom: 10, borderBottom: '1px solid #e5e7eb', paddingBottom: 6, fontSize: 14, fontWeight: 600, color: '#111827' }}>
```

```tsx
// ANTES
<h3 className={`mb-1.5 text-xs font-semibold ${LABEL_STYLES[group.tipo]}`}>

// DEPOIS
<h3 style={{ marginBottom: 6, fontSize: 12, fontWeight: 600, ...LABEL_STYLES[group.tipo] }}>
```

```tsx
// ANTES
<div key={i} className={`mb-1 rounded px-2.5 py-1.5 text-[10px] ${TIPO_STYLES[a.tipo]}`}>

// DEPOIS
<div key={i} style={{ marginBottom: 4, borderRadius: 4, padding: '6px 10px', fontSize: 10, lineHeight: 1.4, ...TIPO_STYLES[a.tipo] }}>
```

```tsx
// ANTES
<div key={group.tipo} className="mb-3">

// DEPOIS
<div key={group.tipo} style={{ marginBottom: 12 }}>
```

- [ ] **Step 5: Verificar que NÃO EXISTE nenhum className no arquivo**

Run:
```bash
grep -n "className" src/renderer/src/componentes/ExportAvisos.tsx
```
Expected: 0 results

- [ ] **Step 6: Remover import de cn se existir**

Se `import { cn } from '@/lib/utils'` existe, remover (não precisa mais de cn sem className).

- [ ] **Step 7: Verificar typecheck**

Run: `npm run typecheck`
Expected: 0 errors

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/componentes/ExportAvisos.tsx
git commit -m "fix(export): convert ExportAvisos from Tailwind classes to inline styles (dark mode safe)"
```

---

### Task 4: forceLight: true em TODAS as chamadas de buildStandaloneHtml

**Files:**
- Modify: `src/renderer/src/paginas/EscalaPagina.tsx`
- Modify: `src/renderer/src/paginas/SetorDetalhe.tsx`
- Modify: `src/renderer/src/paginas/ColaboradorDetalhe.tsx`
- Modify: `src/renderer/src/paginas/EscalasHub.tsx`

- [ ] **Step 1: Encontrar TODAS as chamadas**

Run:
```bash
grep -rn "buildStandaloneHtml" src/renderer/src/paginas/ --include="*.tsx"
```

- [ ] **Step 2: Em CADA chamada, adicionar forceLight: true**

Padrão da mudança:
```typescript
// ANTES
const fullHTML = buildStandaloneHtml(html, { title: `Escala - ${setor.nome}` })

// DEPOIS
const fullHTML = buildStandaloneHtml(html, { title: `Escala - ${setor.nome}`, forceLight: true })
```

Fazer em TODAS as chamadas encontradas (7 chamadas em 4 arquivos).

- [ ] **Step 3: Verificar typecheck**

Run: `npm run typecheck`
Expected: 0 errors

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/paginas/EscalaPagina.tsx src/renderer/src/paginas/SetorDetalhe.tsx src/renderer/src/paginas/ColaboradorDetalhe.tsx src/renderer/src/paginas/EscalasHub.tsx
git commit -m "fix(export): add forceLight:true to all buildStandaloneHtml calls (dark mode fix)"
```

---

### Task 5: Remover @page duplicado do ExportarEscala

**Files:**
- Modify: `src/renderer/src/componentes/ExportarEscala.tsx`

- [ ] **Step 1: Localizar o bloco**

Procurar o `<style dangerouslySetInnerHTML>` perto do final do componente (linhas ~619-629):

```tsx
<style
  dangerouslySetInnerHTML={{
    __html: `
@media print {
  @page { size: A4 ${mode === 'funcionario' ? 'portrait' : 'landscape'}; margin: 10mm; }
  body { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
}
    `.trim(),
  }}
/>
```

- [ ] **Step 2: Remover o bloco inteiro**

Deletar essas ~10 linhas. A responsabilidade de @page é do `buildStandaloneHtml` (via `pageOrientation` param).

- [ ] **Step 3: Verificar typecheck**

Run: `npm run typecheck`
Expected: 0 errors

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/componentes/ExportarEscala.tsx
git commit -m "fix(export): remove duplicate @page injection from ExportarEscala (buildStandaloneHtml owns it)"
```

---

### Task 6: Fix colabAvisos + adicionar appVersion prop

**Files:**
- Modify: `src/renderer/src/componentes/ExportarEscala.tsx`

- [ ] **Step 1: Fix colabAvisos return true**

Encontrar (linhas ~478-483):
```typescript
const colabAvisos = mode === 'funcionario' && colaboradorId
  ? avisos.filter((a) => {
      // Avisos are setor-level, include all for the colaborador's context
      return true
    })
  : []
```

Substituir por:
```typescript
const colabAvisos = mode === 'funcionario' && colaboradorId ? avisos : []
```

- [ ] **Step 2: Adicionar appVersion prop**

Na interface `ExportarEscalaProps`, adicionar:
```typescript
  appVersion?: string
```

Passar pro `ExportFooter`:
```tsx
<ExportFooter
  mode={mode}
  timelineMode={timelineMode}
  mostrarTimeline={efMostrarTimeline}
  mostrarCiclo={efMostrarCiclo}
  appVersion={appVersion}   // ADD
/>
```

No `ExportFooter`, adicionar o param e usar:
```tsx
function ExportFooter({
  mode,
  timelineMode,
  mostrarTimeline,
  mostrarCiclo,
  appVersion,        // ADD
}: {
  mode: 'setor' | 'funcionario'
  timelineMode: 'barras' | 'grid'
  mostrarTimeline: boolean
  mostrarCiclo: boolean
  appVersion?: string  // ADD
}) {
  // ...
  <div>
    Gerada em {new Date().toLocaleDateString('pt-BR')} | <strong>EscalaFlow{appVersion ? ` v${appVersion}` : ''}</strong>
  </div>
```

- [ ] **Step 3: Passar appVersion dos callers**

Em cada arquivo que renderiza ExportarEscala via renderToStaticMarkup, o caller já tem `useAppVersion()` (é um hook stateful, OK no caller). Passar como prop.

Verificar quais callers existem:
```bash
grep -rn "ExportarEscala" src/renderer/src/paginas/ --include="*.tsx"
```

Para cada caller, adicionar `appVersion={appVersion ?? undefined}` no JSX do ExportarEscala.

Se `useAppVersion` não está importado, adicionar o import:
```typescript
import { useAppVersion } from '@/hooks/useAppVersion'
```

E no corpo do componente:
```typescript
const appVersion = useAppVersion()
```

- [ ] **Step 4: Verificar typecheck**

Run: `npm run typecheck`
Expected: 0 errors

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/componentes/ExportarEscala.tsx src/renderer/src/paginas/EscalaPagina.tsx src/renderer/src/paginas/SetorDetalhe.tsx src/renderer/src/paginas/ColaboradorDetalhe.tsx src/renderer/src/paginas/EscalasHub.tsx
git commit -m "fix(export): simplify colabAvisos, add appVersion to footer"
```

---

### Task 7: Verificação final

**Files:** Nenhum (validação)

- [ ] **Step 1: Verificar código duplicado removido**

```bash
grep -rn "function tipoFolga\|function encontrarDomingoDaSemana" src/renderer/src/componentes/
# Expected: 0 results

grep -rn "from.*folga-helpers" src/renderer/src/
# Expected: 3 results (ExportarEscala, ExportFolhaFuncionario, ExportTimelineBarras)
```

- [ ] **Step 2: Verificar ExportAvisos sem Tailwind**

```bash
grep -n "className" src/renderer/src/componentes/ExportAvisos.tsx
# Expected: 0 results
```

- [ ] **Step 3: Verificar forceLight em todos os callers**

```bash
grep -n "buildStandaloneHtml" src/renderer/src/paginas/*.tsx
# Cada linha deve conter "forceLight: true"
```

- [ ] **Step 4: Verificar @page removido do ExportarEscala**

```bash
grep -n "dangerouslySetInnerHTML\|@page" src/renderer/src/componentes/ExportarEscala.tsx
# Expected: 0 results
```

- [ ] **Step 5: Typecheck final**

```bash
npm run typecheck
# Expected: 0 errors
```

- [ ] **Step 6: Verificar hex inline match com protótipo (spec seção 7.1)**

Os hex usados nos componentes inline devem corresponder:
- Success: `#16a34a` / `#f0fdf4`
- Warning: `#d97706` / `#fffbeb`
- Danger: `#dc2626` / `#fef2f2`
- Primary: `#6366f1` / `#eef2ff`
- Muted: `#94a3b8`
- Border: `#e2e8f0`
