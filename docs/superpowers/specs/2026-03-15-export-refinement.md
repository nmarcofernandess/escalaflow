# Spec: Refinamento do Sistema de Exportação

**Data:** 2026-03-15
**Contexto:** Pós-implementação do redesign de export (spec anterior). Auditoria revelou bugs, código duplicado e inconsistências.
**Status:** APROVADO — pronto para implementação

---

## TL;DR

Corrigir 4 problemas encontrados na auditoria: (1) dark mode quebra export — forceLight nunca passado, (2) ExportAvisos usa Tailwind ao invés de inline styles, (3) tipoFolga duplicado em 3 arquivos, (4) @page duplicado. Abordagem dupla: forceLight como safety net + inline styles nos componentes de export.

---

## 1. Bug: Dark Mode no Export

### 1.1 Problema

Quando o usuário está no tema dark e exporta HTML/print, 3 componentes renderizam com cores erradas:

| Componente | Usa | Risco |
|-----------|-----|-------|
| ExportAvisos | Tailwind classes (`bg-red-50`, `text-amber-800`) | Cores invertidas no dark |
| CicloGrid variant='export' | Tailwind classes (`text-success`, `bg-muted`, `border-border`) | Cores invertidas no dark |
| EscalaTimelineDiaria (modo grid) | Tailwind classes (`bg-success/10`, `text-warning`) | Cores invertidas no dark |

ExportTimelineBarras e ExportFolhaFuncionario estão SAFE (usam inline styles com cores hex hardcoded).

### 1.2 Causa raiz

`buildStandaloneHtml()` aceita `forceLight?: boolean` que remove a classe `dark` do HTML. Mas NENHUMA das 6 chamadas nos 4 arquivos passa esse parâmetro:

| Arquivo | Linha | Chamada |
|---------|-------|---------|
| EscalaPagina.tsx | ~458 | `buildStandaloneHtml(html, { title: ... })` |
| EscalaPagina.tsx | ~479 | `buildStandaloneHtml(html, { title: ... })` |
| SetorDetalhe.tsx | ~1963 | `buildStandaloneHtml(html, { title: ... })` |
| SetorDetalhe.tsx | ~1989 | `buildStandaloneHtml(html, { title: ... })` |
| ColaboradorDetalhe.tsx | ~677 | `buildStandaloneHtml(markup, { ... })` |
| ColaboradorDetalhe.tsx | ~707 | `buildStandaloneHtml(markup, { ... })` |
| EscalasHub.tsx | ~297 | `buildStandaloneHtml(html, { title: ... })` |

### 1.3 Fix (camada 1: safety net)

Adicionar `forceLight: true` em TODAS as 7 chamadas de `buildStandaloneHtml` nos 4 arquivos. Isso remove a classe `dark` do `<html>` exportado, garantindo que classes Tailwind resolvam no modo light.

### 1.4 Fix (camada 2: inline styles nos componentes de export)

Converter ExportAvisos de Tailwind classes para inline styles — seguindo o mesmo padrão de ExportTimelineBarras e ExportFolhaFuncionario. Isso elimina a dependência de CSS collection pra esse componente.

CicloGrid variant='export' e EscalaTimelineDiaria continuam com Tailwind — a camada 1 (forceLight) protege eles. Converter esses dois seria muito invasivo (CicloGrid tem 700 linhas com classes Tailwind condicionais). O forceLight é suficiente.

---

## 2. ExportAvisos: Tailwind → Inline Styles

### 2.1 Problema

O comentário na linha 64 diz "hardcoded light-mode for print" mas a implementação usa classes Tailwind:

```typescript
// ATUAL (ERRADO)
const TIPO_STYLES = {
  h: 'border border-red-200 bg-red-50 text-red-800',
  s: 'border border-amber-200 bg-amber-50 text-amber-800',
  i: 'border border-blue-200 bg-blue-50 text-blue-800',
}
```

### 2.2 Fix

Converter para inline styles com CSS properties:

```typescript
// CORRETO
const TIPO_STYLES: Record<'h' | 's' | 'i', React.CSSProperties> = {
  h: { border: '1px solid #fecaca', background: '#fef2f2', color: '#991b1b' },
  s: { border: '1px solid #fde68a', background: '#fffbeb', color: '#78350f' },
  i: { border: '1px solid #bfdbfe', background: '#eff6ff', color: '#1e40af' },
}
```

Converter TODOS os `className` do componente pra `style`:
- `className="mt-6"` → `style={{ marginTop: 24 }}`
- `className="mb-2.5 border-b border-gray-200 pb-1.5 text-sm font-semibold text-gray-900"` → `style={{ marginBottom: 10, borderBottom: '1px solid #e5e7eb', paddingBottom: 6, fontSize: 14, fontWeight: 600, color: '#111827' }}`
- E assim por diante pra cada elemento

O resultado deve ter ZERO `className` — 100% inline styles, como ExportTimelineBarras e ExportFolhaFuncionario.

---

## 3. Código Duplicado: tipoFolga + encontrarDomingoDaSemana

### 3.1 Problema

Estas 2 funções estão copy-paste em 3 arquivos:

| Arquivo | tipoFolga | encontrarDomingoDaSemana |
|---------|-----------|------------------------|
| ExportarEscala.tsx | linha 92 (4 params) | linha 81 |
| ExportFolhaFuncionario.tsx | linha 72 (3 params) | linha 52 |
| ExportTimelineBarras.tsx | linha 51 (3 params) | linha 43 |

A assinatura do `tipoFolga` varia levemente:
- ExportarEscala: `tipoFolga(data, regra, alocacoes, colaboradorId)` — colaboradorId explícito
- ExportFolhaFuncionario: `tipoFolga(data, regra, alocacoes)` — sem colaboradorId (já filtrado)
- ExportTimelineBarras: `tipoFolga(data, regra, allAlocacoes)` — sem colaboradorId

### 3.2 Fix

Criar `src/renderer/src/lib/folga-helpers.ts` com as funções compartilhadas:

```typescript
// src/renderer/src/lib/folga-helpers.ts

import type { Alocacao, RegraHorarioColaborador } from '@shared/index'

const DAY_LABELS = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB'] as const

/**
 * Encontra o domingo da semana que contém a data.
 * Usado para verificar se o colaborador trabalhou no domingo (XOR FV).
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
 * @param alocacoes Alocações relevantes (filtradas pro colaborador se necessário)
 * @param colaboradorId Opcional — se as alocações não estão pré-filtradas, filtra por este ID
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

Depois, nos 3 arquivos, remover as funções locais e importar:

```typescript
import { tipoFolga, encontrarDomingoDaSemana } from '@/lib/folga-helpers'
```

Notas:
- `encontrarDomingoDaSemana` pode continuar sendo importada individualmente nos arquivos que a usam diretamente (ExportTimelineBarras usa pra encontrar o domingo no cálculo de cobertura)
- `tipoFolga` aceita `colaboradorId?` opcional — quando chamada com alocações já filtradas (ExportFolhaFuncionario), não precisa do param. Quando chamada com todas as alocações (ExportarEscala), passa o ID.

---

## 4. @page Duplicado

### 4.1 Problema

ExportarEscala.tsx (linhas 619-629) injeta `<style>` com `@page` no body:
```html
<style>
@media print {
  @page { size: A4 landscape; margin: 10mm; }
  body { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
}
</style>
```

E `buildStandaloneHtml` (via `pageOrientation` param) TAMBÉM injeta `@page` no `<head>`:
```html
<style>
@page { size: A4 landscape; margin: 10mm; }
</style>
```

São duas regras `@page` no mesmo documento. A do `<body>` vence (parsed depois) mas é HTML inválido.

### 4.2 Fix

Remover a injeção de `<style>` do ExportarEscala.tsx (linhas 619-629). A responsabilidade de `@page` é do `buildStandaloneHtml` — o caller passa `pageOrientation` correto. O ExportarEscala não deveria ter opinião sobre tamanho de página.

Para o preview no modal (que não passa por `buildStandaloneHtml`), a orientação não importa — é um div escalado com zoom.

---

## 5. Limpeza menor: colabAvisos return true

### 5.1 Problema

ExportarEscala.tsx linhas 478-483:
```typescript
const colabAvisos = mode === 'funcionario' && colaboradorId
  ? avisos.filter((a) => {
      // Avisos are setor-level, include all for the colaborador's context
      return true
    })
  : []
```

O filter com `return true` é um no-op. Deveria ser simplesmente `avisos` ou remover o filter.

### 5.2 Fix

```typescript
const colabAvisos = mode === 'funcionario' && colaboradorId ? avisos : []
```

---

## 6. Versão do App no Footer

### 6.1 Problema

O protótipo HTML mostra `EscalaFlow v1.5.6 | 15/03/2026` no footer. O código atual mostra só `EscalaFlow` sem versão. O `useAppVersion()` hook foi removido porque não é compatível com `renderToStaticMarkup` (hooks não funcionam).

### 6.2 Fix

Passar a versão como prop pro ExportarEscala:

```typescript
interface ExportarEscalaProps {
  // ... existing props ...
  appVersion?: string  // ex: "1.5.6"
}
```

No ExportFooter, mostrar `EscalaFlow v{appVersion}` se definido, senão só `EscalaFlow`.

Nos callers (EscalaPagina, SetorDetalhe, ColaboradorDetalhe, EscalasHub), obter a versão via `useAppVersion()` (no caller, que é stateful) e passar como prop:

```typescript
const appVersion = useAppVersion()
// ...
<ExportarEscala appVersion={appVersion ?? undefined} ... />
```

---

## 7. Design System CSS não implementado

### 7.1 Observação (NÃO é bug, é decisão de design)

O protótipo HTML usava CSS vars (`--ex-bg`, `--ex-success`, etc) como design system. Os componentes React implementados usaram duas abordagens diferentes:

- ExportTimelineBarras, ExportFolhaFuncionario, ExportSemanal: **inline styles com hex hardcoded** → correto pra renderToStaticMarkup
- ExportAvisos, CicloGrid variant='export': **Tailwind classes** → funciona mas depende de CSS collection + forceLight

A decisão arquitetural é: **inline styles é o padrão correto pra componentes de export**. O forceLight é safety net. Não precisa de um design system CSS separado — os hex inline são suficientes.

Os valores hex usados nos componentes inline correspondem 1:1 com os CSS vars do protótipo:

| CSS var protótipo | Hex usado no React |
|---|---|
| `--ex-success` | `#16a34a` |
| `--ex-success-bg` | `#f0fdf4` |
| `--ex-warning` | `#d97706` |
| `--ex-warning-bg` | `#fffbeb` |
| `--ex-danger` | `#dc2626` |
| `--ex-danger-bg` | `#fef2f2` |
| `--ex-primary` | `#6366f1` |
| `--ex-primary-bg` | `#eef2ff` |
| `--ex-muted` | `#94a3b8` |
| `--ex-border` | `#e2e8f0` |

Nenhuma ação necessária. Documentar pra referência futura.

---

## 8. Checklist de Implementação

### Ordem de execução

1. Criar `src/renderer/src/lib/folga-helpers.ts` com `tipoFolga` + `encontrarDomingoDaSemana`
2. Remover duplicatas de ExportarEscala.tsx, ExportFolhaFuncionario.tsx, ExportTimelineBarras.tsx → importar do helper
3. Converter ExportAvisos.tsx de Tailwind classes para inline styles (100% inline, zero className)
4. Adicionar `forceLight: true` em TODAS as chamadas de `buildStandaloneHtml` (7 chamadas em 4 arquivos)
5. Remover `<style dangerouslySetInnerHTML>` do @page no ExportarEscala.tsx (linhas 619-629)
6. Corrigir `colabAvisos` return true → simplificar
7. Adicionar prop `appVersion?: string` ao ExportarEscala e ExportFooter, passar dos callers via `useAppVersion()`
8. `npm run typecheck` → 0 erros
9. Verificação final: grep que tipoFolga/encontrarDomingoDaSemana não existem mais como funções locais nos 3 componentes

### Critérios de aceitação

- [ ] `forceLight: true` em todas as 7 chamadas de `buildStandaloneHtml`
- [ ] ExportAvisos.tsx tem ZERO `className` — 100% inline styles
- [ ] `tipoFolga` e `encontrarDomingoDaSemana` existem APENAS em `lib/folga-helpers.ts`
- [ ] ExportarEscala.tsx não injeta `<style>` com `@page` (removido)
- [ ] `colabAvisos` sem filter `return true`
- [ ] Footer mostra `EscalaFlow v{version}` quando prop passada
- [ ] `npm run typecheck` → 0 erros
- [ ] No dark mode: exportar HTML → abrir no browser → cores corretas (light)
- [ ] Hex inline nos componentes export correspondem à tabela da seção 7.1
