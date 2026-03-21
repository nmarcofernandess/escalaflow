# Transparência de Relaxações — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminar o silêncio pós-geração — quando o solver relaxa regras (Pass 1b/2/3), o RH DEVE saber o que foi afrouxado, onde hoje vê apenas "Rascunho gerado!".

**Architecture:** Criar uma 4ª função em `resumo-user.ts` (`textoResumoRelaxacoes`) que traduz `diagnostico.pass_usado` + `regras_relaxadas` → texto humano. Consumir em 4 pontos: tools IA (`resumo_user.relaxacoes`), toast pós-geração (`SetorDetalhe.tsx`), banner visual (`EscalaResultBanner.tsx` em `EscalaPagina.tsx`), e aba Apontamentos de `EscalaPagina.tsx`. O banner já existe como código morto — só precisa ser plugado e corrigido.

**Tech Stack:** TypeScript, React, shadcn/ui (componentes já existentes)

**Spec de referência:** `specs/ANALYST_PIPELINE_SOLVER_COMPLETO.md` → seção "O Abismo de Informação"

**Dependências externas:** NENHUMA. Zero dependência do advisory hierárquico. O dado já flui do Python até o renderer.

**Limitação conhecida:** A tabela `escalas` no banco NÃO persiste `diagnostico` (pass_usado, regras_relaxadas). O dado só existe no `EscalaCompletaV3` retornado pela geração. Consequência: `diagnosticar_escala` (que carrega do banco) NÃO terá acesso a relaxações de escalas já geradas. Apenas `gerar_escala` (que tem o diagnostico fresco) pode incluir `resumo_user.relaxacoes`. Persistir diagnostico no banco é escopo futuro.

---

## File Structure

| Ação | Arquivo | Responsabilidade |
|------|---------|------------------|
| Modify | `src/shared/resumo-user.ts` | Adicionar `textoResumoRelaxacoes()` + exportar `NOMES_HUMANOS_REGRAS` |
| Modify | `src/main/ia/tools.ts` | Adicionar campo `relaxacoes` ao `resumo_user` em `gerar_escala` |
| Modify | `src/renderer/src/paginas/SetorDetalhe.tsx` | Trocar toast genérico por toast informativo com pass/relaxações |
| Modify | `src/renderer/src/componentes/EscalaResultBanner.tsx` | Corrigir `resolveTier` para pass `'1b'` + adicionar texto expandível |
| Modify | `src/renderer/src/paginas/EscalaPagina.tsx` | Importar `EscalaResultBanner` no topo + card relaxações na aba Apontamentos |
| Create | `tests/shared/resumo-user.spec.ts` | Testes unitários para `textoResumoRelaxacoes` |

---

### Task 1: `textoResumoRelaxacoes` — Função pura

**Files:**
- Create: `tests/shared/resumo-user.spec.ts`
- Modify: `src/shared/resumo-user.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/shared/resumo-user.spec.ts
import { describe, it, expect } from 'vitest'
import { textoResumoRelaxacoes, NOMES_HUMANOS_REGRAS } from '../../src/shared/resumo-user'

describe('textoResumoRelaxacoes', () => {
  it('returns null when pass 1 and no relaxations', () => {
    expect(textoResumoRelaxacoes(1, [])).toBeNull()
  })

  it('returns null when pass 1 even with empty regras', () => {
    expect(textoResumoRelaxacoes(1, [])).toBeNull()
  })

  it('returns adjustment text for pass 2 with one rule', () => {
    const result = textoResumoRelaxacoes(2, ['DIAS_TRABALHO'])
    expect(result).toContain('dias de trabalho por semana')
    expect(result).toContain('flexibilizad')
    expect(result).not.toContain('emergência')
  })

  it('returns adjustment text for pass 1b with multiple rules', () => {
    const result = textoResumoRelaxacoes('1b', ['DIAS_TRABALHO', 'MIN_DIARIO'])
    expect(result).toContain('dias de trabalho por semana')
    expect(result).toContain('jornada mínima diária')
    expect(result).not.toContain('emergência')
  })

  it('returns adjustment text for pass 1b with empty regras', () => {
    // Pass 1b means something was relaxed, even if regras_relaxadas is empty
    const result = textoResumoRelaxacoes('1b', [])
    expect(result).not.toBeNull()
    expect(result).toContain('ajustes')
  })

  it('returns emergency text for pass 3', () => {
    const result = textoResumoRelaxacoes(3, ['FOLGA_FIXA', 'TIME_WINDOW'])
    expect(result).toContain('emergência')
    expect(result).toContain('folga fixa semanal')
  })

  it('returns emergency text for EXPLORATORY mode', () => {
    const result = textoResumoRelaxacoes(2, ['H1'], 'EXPLORATORY')
    expect(result).toContain('emergência')
  })

  it('falls back to raw code for unknown rule', () => {
    const result = textoResumoRelaxacoes(2, ['REGRA_DESCONHECIDA'])
    expect(result).toContain('REGRA_DESCONHECIDA')
  })

  it('NOMES_HUMANOS_REGRAS is exported and has standard entries', () => {
    expect(NOMES_HUMANOS_REGRAS['DIAS_TRABALHO']).toBe('dias de trabalho por semana')
    expect(NOMES_HUMANOS_REGRAS['MIN_DIARIO']).toBe('jornada mínima diária')
    expect(NOMES_HUMANOS_REGRAS['H6']).toBe('intervalo de almoço')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/shared/resumo-user.spec.ts`
Expected: FAIL — `textoResumoRelaxacoes` not exported

- [ ] **Step 3: Implement `textoResumoRelaxacoes`**

Add to end of `src/shared/resumo-user.ts`:

```typescript
/** Mapa de códigos de regra → nomes legíveis. Exportado para uso em componentes UI. */
export const NOMES_HUMANOS_REGRAS: Record<string, string> = {
  DIAS_TRABALHO: 'dias de trabalho por semana',
  MIN_DIARIO: 'jornada mínima diária',
  TIME_WINDOW: 'janela de horário',
  FOLGA_FIXA: 'folga fixa semanal',
  FOLGA_VARIAVEL: 'folga variável (XOR domingo)',
  H6: 'intervalo de almoço',
  H10: 'meta de horas semanais',
  H1: 'máximo 6 dias consecutivos',
}

/**
 * Texto para relaxações aplicadas pelo solver (pass > 1).
 * Consome diagnostico.pass_usado e diagnostico.regras_relaxadas.
 * Retorna null APENAS quando pass === 1 (numérico) e sem relaxações.
 * Pass '1b' (string) SEMPRE retorna texto — alguma regra foi afrouxada.
 */
export function textoResumoRelaxacoes(
  pass_usado: number | string,
  regras_relaxadas: string[],
  generation_mode?: string,
): string | null {
  // Só pass 1 (numérico exato) sem relaxações = tudo OK
  if (pass_usado === 1 && regras_relaxadas.length === 0) return null

  const nomes = regras_relaxadas.length > 0
    ? regras_relaxadas.map(r => NOMES_HUMANOS_REGRAS[r] ?? r).join(', ')
    : 'regras de produto'

  if (pass_usado === 3 || generation_mode === 'EXPLORATORY') {
    return `Escala de emergência — foram flexibilizados: ${nomes}. Revise com cuidado.`
  }
  return `Escala gerada com ajustes: ${nomes} foram flexibilizados para viabilizar a geração.`
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/shared/resumo-user.spec.ts`
Expected: ALL PASS

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: 0 errors

- [ ] **Step 6: Commit**

```bash
git add tests/shared/resumo-user.spec.ts src/shared/resumo-user.ts
git commit -m "feat: add textoResumoRelaxacoes to resumo-user.ts

Translates solver pass_usado + regras_relaxadas into user-friendly text.
Fourth function in the resumo-user family (cobertura, hard, soft, relaxacoes).
Exports NOMES_HUMANOS_REGRAS for reuse in UI components.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `resumo_user.relaxacoes` na tool `gerar_escala`

**Files:**
- Modify: `src/main/ia/tools.ts:~2204` (gerar_escala only)

**Nota:** `diagnosticar_escala` carrega do banco e NÃO tem acesso ao diagnostico do solver (pass_usado, regras_relaxadas não são persistidos na tabela `escalas`). Adicionar relaxações em `diagnosticar_escala` requer migration no schema — escopo futuro. Apenas `gerar_escala` é modificado aqui.

- [ ] **Step 1: Add import**

No topo de `src/main/ia/tools.ts`, localizar o import existente de `textoResumoCobertura` e adicionar `textoResumoRelaxacoes`:

```typescript
// Localizar:
import { textoResumoCobertura, textoResumoViolacoesHard, textoResumoViolacoesSoft } from '@shared/resumo-user'

// Substituir por:
import { textoResumoCobertura, textoResumoViolacoesHard, textoResumoViolacoesSoft, textoResumoRelaxacoes } from '@shared/resumo-user'
```

- [ ] **Step 2: Add `relaxacoes` to `gerar_escala` resumo_user (~line 2204)**

Localizar o bloco:

```typescript
const resumo_user = {
    cobertura: coberturaResumo.principal,
    ...(coberturaResumo.secundaria ? { cobertura_secundaria: coberturaResumo.secundaria } : {}),
    problemas_oficializar: textoResumoViolacoesHard(ind.violacoes_hard),
    avisos: textoResumoViolacoesSoft(ind.violacoes_soft),
    qualidade: ind.pontuacao,
}
```

Substituir por:

```typescript
const relaxacoesTexto = textoResumoRelaxacoes(
    solverResult.diagnostico?.pass_usado ?? 1,
    solverResult.diagnostico?.regras_relaxadas ?? [],
    solverResult.diagnostico?.generation_mode,
)
const resumo_user = {
    cobertura: coberturaResumo.principal,
    ...(coberturaResumo.secundaria ? { cobertura_secundaria: coberturaResumo.secundaria } : {}),
    problemas_oficializar: textoResumoViolacoesHard(ind.violacoes_hard),
    avisos: textoResumoViolacoesSoft(ind.violacoes_soft),
    qualidade: ind.pontuacao,
    ...(relaxacoesTexto ? { relaxacoes: relaxacoesTexto } : {}),
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: 0 errors

- [ ] **Step 4: Commit**

```bash
git add src/main/ia/tools.ts
git commit -m "feat: add relaxacoes to resumo_user in gerar_escala

IA Chat now informs RH about solver relaxations (pass_usado, regras_relaxadas)
in the same vocabulary as the Resumo tab. Only for gerar_escala — diagnosticar_escala
requires schema migration to persist diagnostico (future scope).

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Toast informativo em SetorDetalhe

**Files:**
- Modify: `src/renderer/src/paginas/SetorDetalhe.tsx:~1993`

- [ ] **Step 1: Locate the toast**

Find line: `toast.success('Rascunho gerado e enviado para o historico')`

O `result` neste ponto é `EscalaCompletaV3` que tem:
- `result.diagnostico?.pass_usado` (1 | '1b' | 2 | 3)
- `result.diagnostico?.regras_relaxadas` (string[])

- [ ] **Step 2: Add import**

Adicionar import de `textoResumoRelaxacoes` no topo de SetorDetalhe.tsx:

```typescript
import { textoResumoRelaxacoes } from '@shared/resumo-user'
```

- [ ] **Step 3: Replace toast**

Substituir:

```typescript
toast.success('Rascunho gerado e enviado para o historico')
```

Por:

```typescript
const passUsado = result.diagnostico?.pass_usado ?? 1
const relaxacoesTexto = textoResumoRelaxacoes(
  passUsado,
  result.diagnostico?.regras_relaxadas ?? [],
  result.diagnostico?.generation_mode,
)
if (relaxacoesTexto) {
  toast.warning(relaxacoesTexto, { duration: 8000 })
} else {
  toast.success('Rascunho gerado e enviado para o histórico')
}
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: 0 errors

- [ ] **Step 5: Test manually**

1. Abrir o app (`npm run dev`)
2. Gerar escala com setor que tem poucos colaboradores (forçar Pass 2+)
3. Verificar que o toast mostra "Escala gerada com ajustes: ..." em amarelo
4. Gerar escala com setor OK
5. Verificar que o toast mostra "Rascunho gerado..." em verde

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/paginas/SetorDetalhe.tsx
git commit -m "feat: informative toast after schedule generation

Shows solver relaxation details instead of generic 'Rascunho gerado'.
Pass 1 = green success, Pass 2+ = yellow warning with rule names.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Corrigir `resolveTier` + expandir EscalaResultBanner

**Files:**
- Modify: `src/renderer/src/componentes/EscalaResultBanner.tsx`

**Bug existente:** `resolveTier()` (linhas 43-76) checa `pass === 3`, depois `pass === 2`, depois fallthrough = verde. Como `pass_usado` pode ser `'1b'` (string), o pass `'1b'` cai no fallthrough e mostra VERDE — incorreto. Pass 1b significa que regras foram relaxadas e deve mostrar AMARELO.

- [ ] **Step 1: Fix `resolveTier` to handle '1b'**

Localizar em `EscalaResultBanner.tsx`:

```typescript
  // pass === 1
  return {
    tier: 'verde',
    mensagem: soft > 0
      ? `Escala gerada com sucesso! ${soft} aviso${soft > 1 ? 's' : ''}`
      : 'Escala gerada com sucesso!',
  }
```

Substituir por:

```typescript
  if (pass !== 1) {
    // pass '1b' or any unknown — treat as amber (something was relaxed)
    return {
      tier: 'amber',
      mensagem: soft > 0
        ? `Escala gerada com ajustes — ${soft} aviso${soft > 1 ? 's' : ''}`
        : 'Escala gerada com ajustes',
    }
  }

  return {
    tier: 'verde',
    mensagem: soft > 0
      ? `Escala gerada com sucesso! ${soft} aviso${soft > 1 ? 's' : ''}`
      : 'Escala gerada com sucesso!',
  }
```

- [ ] **Step 2: Add import and expandable relaxation text**

Adicionar import no topo:

```typescript
import { textoResumoRelaxacoes } from '@shared/resumo-user'
```

Localizar na função componente, após a mensagem principal:

```tsx
<p className="text-sm font-semibold text-foreground">{mensagem}</p>
```

Adicionar logo abaixo (dentro do mesmo div):

```tsx
{tier !== 'verde' && diagnostico && (() => {
  const texto = textoResumoRelaxacoes(
    diagnostico.pass_usado ?? 1,
    diagnostico.regras_relaxadas ?? [],
    (diagnostico as any).generation_mode,
  )
  return texto ? (
    <p className="mt-1 text-xs text-muted-foreground">{texto}</p>
  ) : null
})()}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: 0 errors

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/componentes/EscalaResultBanner.tsx
git commit -m "fix: resolveTier handles pass '1b' as amber + expandable relaxation text

Pass '1b' was falling through to green tier (bug since pass_usado is string).
Now any pass !== 1 shows amber. Added textoResumoRelaxacoes in expandable detail.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Plugar EscalaResultBanner + card Relaxações na aba Apontamentos

**Files:**
- Modify: `src/renderer/src/paginas/EscalaPagina.tsx`

**Estado atual de EscalaPagina.tsx:**
- `escalaCompleta` (state, tipo `EscalaCompletaV3`) — tem `diagnostico`, `indicadores`, `antipatterns`
- `exportOpen` / `setExportOpen` (state, linha 288) — controla export modal
- Tabs com `defaultValue="escala"` — NÃO controlado (sem `value`/`onValueChange`)
- NÃO tem handlers `handleOficializar`, `handleDescartar`, nem states `oficializando`/`descartando`
- Oficializar/descartar existem como texto ("Pode oficializar"/"Impede oficializar"), mas sem botão de ação

**Estratégia:** Simplificar o uso do banner. O `EscalaResultBanner.tsx` tem botões de Oficializar/Descartar/Exportar embutidos, mas esses precisam de handlers complexos. **Para V1, usar o banner SEM os botões de ação** — apenas como indicador visual de tier. Criar um wrapper simples.

- [ ] **Step 1: Add import**

```typescript
import { textoResumoRelaxacoes } from '@shared/resumo-user'
```

- [ ] **Step 2: Add tier indicator no topo da página**

Em vez de usar o `EscalaResultBanner` completo (que exige 6+ handlers), criar um indicador simples inline. Localizar onde o `PageHeader` é renderizado e adicionar APÓS ele:

```tsx
{escalaCompleta?.diagnostico && (() => {
  const pass = escalaCompleta.diagnostico.pass_usado ?? 1
  const isOk = pass === 1
  const isEmergency = pass === 3
  const texto = textoResumoRelaxacoes(
    pass,
    escalaCompleta.diagnostico.regras_relaxadas ?? [],
    escalaCompleta.diagnostico.generation_mode,
  )
  if (!texto) return null
  return (
    <div className={cn(
      'mx-6 mt-4 rounded-lg border-2 p-3',
      isEmergency
        ? 'border-destructive/40 bg-destructive/5'
        : 'border-warning/40 bg-warning/5',
    )}>
      <div className="flex items-center gap-2">
        <AlertTriangle className={cn('size-4 shrink-0',
          isEmergency ? 'text-destructive' : 'text-warning',
        )} />
        <p className="text-sm font-medium">{texto}</p>
      </div>
    </div>
  )
})()}
```

Garantir que `cn` e `AlertTriangle` já estão importados (provavelmente sim neste arquivo).

- [ ] **Step 3: Add card Relaxações na aba Apontamentos**

Na aba Apontamentos (TabsContent `value="apontamentos"`), existem 4 cards: Cobertura, Qualidade, Problemas, Avisos. Adicionar um 5º card para relaxações. Localizar o grid de cards (`grid grid-cols-2 gap-4` ou similar) e adicionar após o último card:

```tsx
{escalaCompleta?.diagnostico && (() => {
  const texto = textoResumoRelaxacoes(
    escalaCompleta.diagnostico.pass_usado ?? 1,
    escalaCompleta.diagnostico.regras_relaxadas ?? [],
    escalaCompleta.diagnostico.generation_mode,
  )
  if (!texto) return null
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <AlertTriangle className="size-4 text-warning" />
          Ajustes do Motor
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">{texto}</p>
      </CardContent>
    </Card>
  )
})()}
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: 0 errors

- [ ] **Step 5: Test manually**

1. Gerar escala (qualquer setor)
2. Abrir EscalaPagina (clicar na escala no histórico)
3. Se Pass 1: nenhum indicador extra ✅
4. Se Pass 2+: banner amarelo no topo + card "Ajustes do Motor" na aba Apontamentos ✅
5. Se Pass 3: banner vermelho ✅
6. Aba Apontamentos deve ter 5 cards (cobertura, qualidade, problemas, avisos, ajustes) ✅

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/paginas/EscalaPagina.tsx
git commit -m "feat: show solver relaxation info in EscalaPagina

Adds tier indicator at top (amber/red when solver relaxed rules).
Adds 'Ajustes do Motor' card in Apontamentos tab with relaxation details.
Uses textoResumoRelaxacoes for consistent vocabulary.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Verificação final

- [ ] **Step 1: Full typecheck**

Run: `npm run typecheck`
Expected: 0 errors

- [ ] **Step 2: Run all tests**

Run: `npm run test`
Expected: All pass (including new resumo-user tests)

- [ ] **Step 3: Manual E2E verification**

Checklist:
1. Gerar escala em setor com equipe justa (força Pass 2+)
2. Toast mostra relaxações em amarelo ✅
3. Abrir escala gerada → indicador amarelo no topo ✅
4. Aba Apontamentos → card "Ajustes do Motor" visível ✅
5. Gerar escala em setor com equipe folgada (Pass 1)
6. Toast mostra "Rascunho gerado" em verde ✅
7. Indicador no topo NÃO aparece ✅
8. Card "Ajustes do Motor" NÃO aparece ✅
9. Chat IA: perguntar "como está minha escala?" após gerar → IA menciona relaxações ✅
10. Gerar escala que force Pass 1b → toast e indicador amarelo ✅

- [ ] **Step 4: Final commit (se ajustes foram necessários)**

```bash
git add -A
git commit -m "fix: adjustments from E2E verification of relaxation transparency

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```
