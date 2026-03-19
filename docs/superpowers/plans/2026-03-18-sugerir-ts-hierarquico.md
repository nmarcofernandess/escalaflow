# Sugerir TS Hierarquico + Fixes Pendentes

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar Sugerir TS com step-by-step hierarquico (libera rank baixo primeiro), corrigir Voltar ao automatico, e garantir que Sugerir do grid abre drawer.

**Architecture:** Helper puro `sugerirTSHierarquico` em simula-ciclo.ts (testavel, sem React). Handler fino no SetorDetalhe que chama o helper, monta diff, e abre SugestaoSheet. Reutiliza EscalaAdvisoryOutput/SugestaoSheet sem mudancas.

**Tech Stack:** TypeScript puro (helper), React (handler + botao)

**Referencia canonica:** `regras-canonicas.md` secoes 1, 4, 5

---

### Task 1: Reverter "Voltar ao automatico"

**Files:**
- Modify: `src/renderer/src/paginas/SetorDetalhe.tsx` — handleResetarSimulacao

- [ ] **Step 1: Reverter para limpar overrides (sem null explicito)**

O handleResetarSimulacao('automatico') hoje seta override null explicito pra cada colaborador. Reverter pra simplesmente limpar overrides — o context resolve via banco.

Colapsar os modos `automatico` e `colaboradores` — ambos fazem a mesma coisa (limpar overrides, banco resolve). Remover a distinção e simplificar:

```ts
// ANTES (dois caminhos que agora fazem a mesma coisa):
if (_mode === 'colaboradores') {
  atualizarSimulacaoConfig(...)
  toast.success('Folgas restauradas a partir dos colaboradores')
} else {
  const nullOverrides = { ... }
  atualizarSimulacaoConfig(...)
  toast.success('Folgas em modo automatico — o sistema decide')
}

// DEPOIS (um caminho so):
atualizarSimulacaoConfig((prev) => ({
  ...prev,
  setor: { ...prev.setor, overrides_locais: {} },
}))
toast.success('Folgas restauradas dos colaboradores')
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/paginas/SetorDetalhe.tsx
git commit -m "fix: reverter 'Voltar ao automatico' para limpar overrides (sem null explicito)"
```

---

### Task 2: Anotar no canonico — preview = espelho fiel

**Files:**
- Modify: `regras-canonicas.md`

- [ ] **Step 1: Adicionar secao entre secao 3 e 4**

Adicionar apos secao 3 (Voltar ao automatico):

```markdown
## 3.1. Preview = espelho fiel

O preview automatico (que roda toda vez que o RH muda um dropdown) mostra EXATAMENTE o que o RH configurou — inclusive os problemas.

- Deficit em vermelho, avisos embaixo. Sem resolver sozinho.
- O TS NAO tenta corrigir automaticamente enquanto o RH mexe.
- Se o TS resolvesse sozinho, o RH nao veria os erros nem aprenderia o que esta errado.
- O preview e um ESPELHO. O Sugerir e o botao de "me ajuda".
```

- [ ] **Step 2: Commit**

```bash
git add regras-canonicas.md
git commit -m "docs: adicionar regra canonica — preview = espelho fiel"
```

---

### Task 3: Sugerir do grid → abre drawer

**Files:**
- Modify: `src/renderer/src/paginas/SetorDetalhe.tsx` — coverageActions.onSuggest

- [ ] **Step 1: Apontar onSuggest pro handleSugerirSolver**

```ts
// ANTES:
onSuggest: modoSimulacaoEfetivo === 'SETOR' ? () => handleResetarSimulacao('automatico') : undefined,

// DEPOIS (aponta pro Sugerir TS — conforme regras-canonicas secao 9):
onSuggest: modoSimulacaoEfetivo === 'SETOR' ? handleSugerirTS : undefined,
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/paginas/SetorDetalhe.tsx
git commit -m "fix: Sugerir do grid abre drawer (handleSugerirSolver)"
```

---

### Task 4: Helper `sugerirTSHierarquico` em simula-ciclo.ts

**Files:**
- Modify: `src/shared/simula-ciclo.ts`

- [ ] **Step 1: Implementar helper puro**

Adicionar apos `gerarCicloFase1` e antes do bloco de conversores:

```ts
/**
 * Sugerir TS com step-by-step hierarquico.
 * Libera folgas de baixo pra cima no array (rank baixo primeiro).
 * Retorna o PRIMEIRO resultado sem deficit de cobertura.
 *
 * @param folgas - arranjo atual (indice 0 = rank alto, N-1 = rank baixo)
 * @param liberados - quantas pessoas foram liberadas (0 = sem mudanca, N = tudo livre)
 */
export interface SugerirTSResult {
  resultado: SimulaCicloOutput
  liberados: number
}

export function sugerirTSHierarquico(input: {
  folgas: Array<{
    folga_fixa_dia: number | null
    folga_variavel_dia: number | null
    folga_fixa_dom?: boolean
  }>
  num_postos: number
  trabalham_domingo: number
  num_meses?: number
  demanda_por_dia?: number[]
}): SugerirTSResult {
  const N = input.num_postos

  for (let step = 0; step <= N; step++) {
    const folgas = input.folgas.map((f, idx) => {
      // Libera de baixo pra cima: indices >= (N - step) sao liberados
      if (step > 0 && idx >= N - step) {
        return {
          folga_fixa_dia: null as number | null,
          folga_variavel_dia: null as number | null,
          folga_fixa_dom: f.folga_fixa_dom,
        }
      }
      return { ...f }
    })

    const result = gerarCicloFase1({
      num_postos: N,
      trabalham_domingo: input.trabalham_domingo,
      num_meses: input.num_meses,
      folgas_forcadas: folgas,
      demanda_por_dia: input.demanda_por_dia,
    })

    if (!result.sucesso) continue

    // Checar deficit: cobertura < demanda em qualquer dia de qualquer semana
    const hasDeficit = result.cobertura_dia.some((sem) =>
      sem.cobertura.some((cob, idx) => cob < (input.demanda_por_dia?.[idx] ?? 0)),
    )

    if (!hasDeficit) {
      return { resultado: result, liberados: step }
    }
  }

  // Nenhuma tentativa resolveu — retorna a ultima (step=N, tudo livre) com deficit
  // O loop ja cobriu step=N (tudo livre com folga_fixa_dom preservado)
  // Se chegou aqui, todas falharam — retorna a do ultimo step
  const fallbackFolgas = input.folgas.map((f) => ({
    folga_fixa_dia: null as number | null,
    folga_variavel_dia: null as number | null,
    folga_fixa_dom: f.folga_fixa_dom,
  }))
  const fallbackResult = gerarCicloFase1({
    num_postos: N,
    trabalham_domingo: input.trabalham_domingo,
    num_meses: input.num_meses,
    folgas_forcadas: fallbackFolgas,
    demanda_por_dia: input.demanda_por_dia,
  })

  return { resultado: fallbackResult, liberados: N }
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add src/shared/simula-ciclo.ts
git commit -m "feat: sugerirTSHierarquico — step-by-step de baixo pra cima"
```

---

### Task 5: Handler `handleSugerirTS` + botao no header

**Files:**
- Modify: `src/renderer/src/paginas/SetorDetalhe.tsx`

- [ ] **Step 1: Adicionar import**

Atualizar import de simula-ciclo:
```ts
import { converterPreviewParaPinned, sugerirK, sugerirTSHierarquico, type SimulaCicloOutput } from '@shared/simula-ciclo'
```

Adicionar `Lightbulb` ao import de lucide-react (ja tem ShieldCheck, Zap, etc):
```ts
import { ..., Lightbulb } from 'lucide-react'
```

- [ ] **Step 2: Implementar handler**

Adicionar apos `handleSugerirSolver`:

```ts
// ── Sugerir TS: step-by-step hierarquico (libera rank baixo primeiro) ──
const handleSugerirTS = useCallback(() => {
  if (!simulacaoPreview.resultado.sucesso) return

  const previewGrid = simulacaoPreview.resultado.grid
  const currentFolgas = previewSetorRows.map((row, idx) => {
    const gridRow = previewGrid[idx]
    return {
      colaborador_id: row.titular.id,
      fixa: (row.folgaFixaDom ? 'DOM' : idxPreviewParaDiaSemana(gridRow?.folga_fixa_dia)) as DiaSemana | null,
      variavel: idxPreviewParaDiaSemana(gridRow?.folga_variavel_dia),
    }
  })

  const { resultado, liberados } = sugerirTSHierarquico({
    folgas: previewSetorRows.map((row) => row.folgaForcada),
    num_postos: simulacaoPreview.effectiveN,
    trabalham_domingo: simulacaoPreview.effectiveK,
    num_meses: simulacaoPreviewMeses,
    demanda_por_dia: demandaPorDiaPreview,
  })

  // Build diff: current vs TS suggestion
  if (!resultado.sucesso || resultado.grid.length === 0) {
    setAdvisoryResult({
      status: 'NO_PROPOSAL',
      diagnostics: [{
        code: 'TS_FALHOU',
        severity: 'warning',
        gate: 'ALLOW',
        title: 'O sistema nao conseguiu montar um ciclo viavel.',
        detail: resultado.erro ?? 'Tente usar o Sugerir com motor para uma analise mais profunda.',
        source: 'advisory_proposal',
      }],
    })
    setSugestaoOpen(true)
    return
  }

  const diff: import('@shared/index').AdvisoryDiffItem[] = previewSetorRows.map((row, idx) => {
    const gridRow = resultado.grid[idx]
    return {
      colaborador_id: row.titular.id,
      nome: row.titular.nome,
      posto_apelido: row.funcao.apelido,
      fixa_atual: currentFolgas[idx]?.fixa ?? null,
      fixa_proposta: row.folgaFixaDom ? 'DOM' as DiaSemana : idxPreviewParaDiaSemana(gridRow?.folga_fixa_dia),
      variavel_atual: currentFolgas[idx]?.variavel ?? null,
      variavel_proposta: idxPreviewParaDiaSemana(gridRow?.folga_variavel_dia),
    }
  })

  const hasChanges = diff.some(
    (d) => d.fixa_atual !== d.fixa_proposta || d.variavel_atual !== d.variavel_proposta,
  )

  const diagnostics: import('@shared/index').PreviewDiagnostic[] = []

  if (liberados > 0 && hasChanges) {
    diagnostics.push({
      code: 'TS_REDISTRIBUIU',
      severity: 'info',
      gate: 'ALLOW',
      title: `${liberados} colaborador(es) de menor hierarquia tiveram folgas redistribuidas.`,
      detail: 'O sistema priorizou manter as folgas dos colaboradores de maior hierarquia.',
      source: 'advisory_proposal',
    })
  }

  if (!resultado.sucesso || resultado.cobertura_dia.some((sem) =>
    sem.cobertura.some((cob, i) => cob < (demandaPorDiaPreview[i] ?? 0)),
  )) {
    diagnostics.push({
      code: 'TS_NAO_RESOLVEU',
      severity: 'warning',
      gate: 'ALLOW',
      title: 'O sistema nao conseguiu eliminar todos os deficits.',
      detail: 'A equipe pode ser insuficiente para a demanda. Use o Sugerir com motor ou ajuste a demanda.',
      source: 'advisory_proposal',
    })
  }

  setAdvisoryResult({
    status: hasChanges ? 'PROPOSAL_VALID' : 'CURRENT_VALID',
    diagnostics,
    ...(hasChanges ? { proposal: { diff } } : {}),
  })
  setSugestaoOpen(true)
}, [simulacaoPreview, previewSetorRows, simulacaoPreviewMeses, demandaPorDiaPreview])
```

- [ ] **Step 3: Adicionar botao no header**

Adicionar ANTES do botao Validar (ShieldCheck), dentro do mesmo guard `modoSimulacaoEfetivo === 'SETOR'`:

```tsx
{simulacaoPreview.resultado.sucesso && modoSimulacaoEfetivo === 'SETOR' && (
  <Tooltip>
    <TooltipTrigger asChild>
      <Button
        variant="outline"
        size="icon"
        onClick={handleSugerirTS}
        disabled={advisoryLoading || gerando}
        aria-label="Sugerir com TS"
      >
        <Lightbulb className="size-4" />
      </Button>
    </TooltipTrigger>
    <TooltipContent>Sugerir com TS</TooltipContent>
  </Tooltip>
)}
```

Ordem final dos botoes: `[Sugerir TS 💡] [Validar 🛡] [Sugerir Motor ⚡] [⚙ Config] [▶ Gerar]`

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: 0 errors

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/paginas/SetorDetalhe.tsx
git commit -m "feat: Sugerir TS hierarquico — step-by-step de baixo pra cima com drawer"
```

---

### Task 6: Verificacao visual

- [ ] **Step 1: Testar cenario normal (sem conflito)**

No app, setor Acougue com folgas automaticas:
1. Clicar Sugerir TS (💡) → drawer abre → "Tudo certo!" (sem mudancas)
2. Clicar Validar (🛡) → drawer abre → resultado do solver
3. Clicar Sugerir Motor (⚡) → drawer abre → resultado do solver

- [ ] **Step 2: Testar cenario com conflito**

Colocar 3 pessoas folgando no mesmo dia (ex: Alex, Jessica, Robert todos em TER):
1. Preview mostra deficit (2/3 em TER, vermelho)
2. Sugerir TS (💡) → drawer mostra diff: "Mudei Robert de TER pra QUI" (rank baixo perdeu)
3. Aceitar → grid atualiza, deficit some

- [ ] **Step 3: Testar cenario impossivel**

Colocar todos com folga_fixa_dom = true (via MCP):
1. Preview mostra deficit em DOM
2. Sugerir TS (💡) → drawer mostra "Nao conseguiu eliminar deficits"
3. Sugerir Motor (⚡) → solver tenta Fases A→B→C

- [ ] **Step 4: Testar "Voltar ao automatico"**

1. Mudar folgas manualmente no grid
2. Clicar ↺ (reset) → "Voltar ao automatico"
3. Grid volta pro que estava salvo no banco (nao pro TS automatico)

- [ ] **Step 5: Testar Sugerir do grid**

1. Clicar Sugerir no CicloGrid (linha COBERTURA)
2. Drawer abre com resultado do solver (handleSugerirSolver)
