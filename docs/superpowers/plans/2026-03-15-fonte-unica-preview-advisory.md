# Fonte Unica Preview+Advisory — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fazer o preview TS e o advisory solver convergirem na mesma verdade — multi-pass rule-aware no TS, domingo_ciclo corrigido, advisory substitui preview, e "Analisar com IA" envia contexto real.

**Architecture:** Novo `preview-multi-pass.ts` wrappa `gerarCicloFase1` com 2 passes (strict → relaxed baseado em HARD/SOFT). Diagnosticos do advisory substituem os do preview para mesmos codigos. Botao "Analisar com IA" injeta contexto do advisory/preview via `pendingAutoMessage`.

**Tech Stack:** TypeScript puro (shared), React (SetorDetalhe), Zustand (iaStore). Zero mudanca no Python.

**Spec:** `specs/BUILD_FONTE_UNICA_PREVIEW_ADVISORY.md`

---

## File Structure

### Novo

| Arquivo | Responsabilidade |
|---------|-----------------|
| `src/shared/preview-multi-pass.ts` | Wrapper: tenta strict, relaxa se SOFT, retorna output + diagnostics + metadata |
| `tests/shared/preview-multi-pass.spec.ts` | Testes: strict pass, relaxed pass, HARD fail, dom ciclo fields |

### Modificados

| Arquivo | Mudanca |
|---------|---------|
| `src/renderer/src/paginas/SetorDetalhe.tsx` | Usar multi-pass; passar domingo_ciclo; abrirAnaliseIa com contexto |
| `src/renderer/src/lib/build-avisos.ts` | Advisory diagnostics substituem preview com mesmo codigo |

---

## Chunk 1: Multi-Pass Engine + Wiring

### Task 1: preview-multi-pass.ts + testes

**Files:**
- Create: `src/shared/preview-multi-pass.ts`
- Create: `tests/shared/preview-multi-pass.spec.ts`

- [ ] **Step 1: Criar preview-multi-pass.ts**

```ts
// src/shared/preview-multi-pass.ts
import { gerarCicloFase1, type SimulaCicloFase1Input, type SimulaCicloOutput } from './simula-ciclo'
import { buildPreviewDiagnostics, type PreviewDiagnostic } from './preview-diagnostics'
import type { RuleConfig } from './types'

interface MultiPassParticipant {
  id: number
  nome: string
  sexo: 'M' | 'F'
  domingo_ciclo_trabalho?: number
  domingo_ciclo_folga?: number
  folga_fixa_dom?: boolean
}

export interface MultiPassInput {
  fase1Input: SimulaCicloFase1Input
  participants: MultiPassParticipant[]
  demandaPorDia: number[]
  trabalhamDomingo: number
  rules: RuleConfig
}

export interface MultiPassResult {
  output: SimulaCicloOutput
  diagnostics: PreviewDiagnostic[]
  pass_usado: 1 | 2
  relaxed: boolean
}

export function runPreviewMultiPass(input: MultiPassInput): MultiPassResult {
  const { fase1Input, participants, demandaPorDia, trabalhamDomingo, rules } = input

  // --- Pass 1: strict (preflight=true — sem TT garantido) ---
  const strictInput: SimulaCicloFase1Input = { ...fase1Input, preflight: true }
  const pass1 = gerarCicloFase1(strictInput)

  if (pass1.sucesso) {
    const diagnostics = buildPreviewDiagnostics({
      output: pass1,
      participants,
      demandaPorDia,
      trabalhamDomingo,
      rules,
    })
    return { output: pass1, diagnostics, pass_usado: 1, relaxed: false }
  }

  // --- Pass 1 falhou. Checar se eh relaxavel. ---
  // K > kMaxSemTT eh a causa principal de falha no preflight.
  // Se H3_DOM_MAX_CONSEC_M ou _F eh SOFT, podemos tentar sem preflight.
  const N = fase1Input.num_postos
  const K = fase1Input.trabalham_domingo
  const kMaxSemTT = Math.floor(N / 2)
  const causaEhTT = K > kMaxSemTT && K <= N

  const h3MascSoft = (rules.H3_DOM_MAX_CONSEC_M ?? rules.H3_DOM_MAX_CONSEC ?? 'HARD') !== 'HARD'
  const h3FemSoft = (rules.H3_DOM_MAX_CONSEC_F ?? rules.H3_DOM_MAX_CONSEC ?? 'HARD') !== 'HARD'
  const podeRelaxar = causaEhTT && (h3MascSoft || h3FemSoft)

  if (!podeRelaxar) {
    // Nao pode relaxar — retorna o erro do pass 1 com diagnostics
    const diagnostics = buildPreviewDiagnostics({
      output: pass1,
      participants,
      demandaPorDia,
      trabalhamDomingo,
      rules,
    })
    return { output: pass1, diagnostics, pass_usado: 1, relaxed: false }
  }

  // --- Pass 2: relaxed (preflight=false — TT pode acontecer) ---
  const relaxedInput: SimulaCicloFase1Input = { ...fase1Input, preflight: false }
  const pass2 = gerarCicloFase1(relaxedInput)

  const diagnostics = buildPreviewDiagnostics({
    output: pass2,
    participants,
    demandaPorDia,
    trabalhamDomingo,
    rules,
  })
  // Diagnostics vao naturalmente mostrar WARNING (amarelo) para dom consec SOFT
  // e ERROR (vermelho) para dom consec HARD — buildPreviewDiagnostics ja faz isso.

  return { output: pass2, diagnostics, pass_usado: 2, relaxed: true }
}
```

- [ ] **Step 2: Criar testes**

```ts
// tests/shared/preview-multi-pass.spec.ts
import { describe, it, expect } from 'vitest'
import { runPreviewMultiPass, type MultiPassInput } from '../../src/shared/preview-multi-pass'

function makeInput(overrides: Partial<MultiPassInput> = {}): MultiPassInput {
  const N = overrides.fase1Input?.num_postos ?? 6
  const K = overrides.fase1Input?.trabalham_domingo ?? 2
  return {
    fase1Input: {
      num_postos: N,
      trabalham_domingo: K,
      num_meses: 1,
      ...overrides.fase1Input,
    },
    participants: Array.from({ length: N }, (_, i) => ({
      id: i + 1,
      nome: `Pessoa ${i + 1}`,
      sexo: (i % 2 === 0 ? 'M' : 'F') as 'M' | 'F',
    })),
    demandaPorDia: [4, 4, 4, 4, 4, 3, K],
    trabalhamDomingo: K,
    rules: {},
    ...overrides,
  }
}

describe('runPreviewMultiPass', () => {
  it('pass 1 strict sucesso quando K <= N/2', () => {
    // 6 pessoas, K=2 — kMaxSemTT=3, logo K <= kMax
    const result = runPreviewMultiPass(makeInput())
    expect(result.output.sucesso).toBe(true)
    expect(result.pass_usado).toBe(1)
    expect(result.relaxed).toBe(false)
  })

  it('pass 2 relaxed quando K > N/2 e H3 SOFT', () => {
    // 6 pessoas, K=4 — kMaxSemTT=3, precisa TT
    // H3 SOFT = pode relaxar
    const result = runPreviewMultiPass(makeInput({
      fase1Input: { num_postos: 6, trabalham_domingo: 4 },
      rules: { H3_DOM_MAX_CONSEC_M: 'SOFT', H3_DOM_MAX_CONSEC_F: 'SOFT' },
    }))
    expect(result.output.sucesso).toBe(true)
    expect(result.pass_usado).toBe(2)
    expect(result.relaxed).toBe(true)
  })

  it('diagnostics mostram WARNING (nao BLOCK) quando relaxou com SOFT', () => {
    const result = runPreviewMultiPass(makeInput({
      fase1Input: { num_postos: 6, trabalham_domingo: 4 },
      rules: { H3_DOM_MAX_CONSEC_M: 'SOFT', H3_DOM_MAX_CONSEC_F: 'SOFT' },
    }))
    // Se tem domingos consecutivos, diagnosticos devem ser warning, nao error
    const domDiags = result.diagnostics.filter(d =>
      d.code === 'H3_DOM_MAX_CONSEC_M' || d.code === 'H3_DOM_MAX_CONSEC_F'
    )
    for (const d of domDiags) {
      expect(d.severity).toBe('warning')
      expect(d.gate).toBe('ALLOW')
    }
  })

  it('falha hard quando K > N/2 e H3 HARD', () => {
    // H3 HARD = nao pode relaxar
    const result = runPreviewMultiPass(makeInput({
      fase1Input: { num_postos: 6, trabalham_domingo: 4 },
      rules: { H3_DOM_MAX_CONSEC_M: 'HARD', H3_DOM_MAX_CONSEC_F: 'HARD' },
    }))
    expect(result.output.sucesso).toBe(false)
    expect(result.pass_usado).toBe(1)
    expect(result.relaxed).toBe(false)
  })

  it('passa domingo_ciclo_trabalho/folga aos diagnosticos', () => {
    // Ciclo 1:1 (trabalha 1 dom, folga 1 dom) com capacidade exata = N/2
    const result = runPreviewMultiPass(makeInput({
      participants: Array.from({ length: 6 }, (_, i) => ({
        id: i + 1,
        nome: `P${i + 1}`,
        sexo: 'M' as const,
        domingo_ciclo_trabalho: 1,
        domingo_ciclo_folga: 1,
      })),
      fase1Input: { num_postos: 6, trabalham_domingo: 3 },
      rules: { H3_DOM_CICLO_EXATO: 'HARD' },
    }))
    // Com ciclo 1:1, capacidade exata = floor(6 * 1/2) = 3 = K. Deve passar.
    expect(result.output.sucesso).toBe(true)
    const cicloDiag = result.diagnostics.find(d => d.code === 'H3_DOM_CICLO_EXATO')
    // K=3, capacity=3 → nao deve ter diagnostico de ciclo
    expect(cicloDiag).toBeUndefined()
  })

  it('detecta ciclo exato insuficiente quando capacity < K', () => {
    // Ciclo 1:2 (trabalha 1, folga 2) → capacidade = floor(6 * 1/3) = 2
    // K=3 > 2 → diagnostico de ciclo
    const result = runPreviewMultiPass(makeInput({
      participants: Array.from({ length: 6 }, (_, i) => ({
        id: i + 1,
        nome: `P${i + 1}`,
        sexo: 'M' as const,
        domingo_ciclo_trabalho: 1,
        domingo_ciclo_folga: 2,
      })),
      fase1Input: { num_postos: 6, trabalham_domingo: 3 },
      rules: { H3_DOM_CICLO_EXATO: 'HARD' },
    }))
    const cicloDiag = result.diagnostics.find(d => d.code === 'H3_DOM_CICLO_EXATO')
    expect(cicloDiag).toBeDefined()
    expect(cicloDiag!.severity).toBe('error')
    expect(cicloDiag!.gate).toBe('CONFIRM_OVERRIDE')
  })

  it('retorna diagnostics mesmo quando output falha', () => {
    // K > N = impossivel
    const result = runPreviewMultiPass(makeInput({
      fase1Input: { num_postos: 3, trabalham_domingo: 5 },
    }))
    expect(result.output.sucesso).toBe(false)
    expect(result.diagnostics).toBeDefined()
  })
})
```

- [ ] **Step 3: Rodar testes**

Run: `npx vitest run tests/shared/preview-multi-pass.spec.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```
feat(preview): multi-pass engine — strict → relaxed baseado em HARD/SOFT
```

---

### Task 2: SetorDetalhe usa multi-pass + passa domingo_ciclo

**Files:**
- Modify: `src/renderer/src/paginas/SetorDetalhe.tsx`

- [ ] **Step 1: Importar multi-pass**

Adicionar import:
```ts
import { runPreviewMultiPass } from '@shared/preview-multi-pass'
```

- [ ] **Step 2: Substituir gerarCicloFase1 direto por multi-pass**

Encontrar o bloco ~linhas 1150-1164 onde `gerarCicloFase1` eh chamado. Atualmente:
```ts
const resultado = modoSimulacaoEfetivo === 'SETOR' && setor?.regime_escala !== '5X2'
  ? resultadoErro(...)
  : gerarCicloFase1({ ... preflight: false ... })
```

Substituir por:
```ts
const multiPassResult = modoSimulacaoEfetivo === 'SETOR' && setor?.regime_escala !== '5X2'
  ? null
  : runPreviewMultiPass({
      fase1Input: {
        num_postos: effectiveN,
        trabalham_domingo: effectiveK,
        num_meses: simulacaoPreviewMeses,
        folgas_forcadas: folgasForcadas.some((f) => f.folga_fixa_dia != null || f.folga_variavel_dia != null || f.folga_fixa_dom)
          ? folgasForcadas
          : undefined,
        demanda_por_dia: demandaPorDiaPreview,
      },
      participants: previewSetorRows.map((row) => ({
        id: row.titular.id,
        nome: row.titular.nome,
        sexo: row.titular.sexo,
        folga_fixa_dom: row.folgaFixaDom,
        domingo_ciclo_trabalho: colaboradores?.find((c) => c.id === row.titular.id)?.domingo_ciclo_trabalho,
        domingo_ciclo_folga: colaboradores?.find((c) => c.id === row.titular.id)?.domingo_ciclo_folga,
      })),
      demandaPorDia: demandaPorDiaPreview,
      trabalhamDomingo: effectiveK,
      rules: previewRuleConfig,
    })

const resultado = multiPassResult?.output
  ?? resultadoErro('Preview Nível 1 disponível apenas para setores 5x2.', 'Mude para o modo Livre ou gere pelo solver.')
```

Nota: `colaboradores` ja esta disponivel no componente (vem do AppDataStore). Se nao encontrar `domingo_ciclo_trabalho` no colaborador (campo opcional), `buildPreviewDiagnostics` usara defaults (2/1) — graceful degradation.

- [ ] **Step 3: Remover o useMemo de previewDiagnostics separado**

O multi-pass ja retorna diagnostics. Encontrar o `previewDiagnostics` useMemo (~linha 1257-1272) e substituir:

```ts
const previewDiagnostics = useMemo<PreviewDiagnostic[]>(() => {
  if (modoSimulacaoEfetivo !== 'SETOR') return []
  return multiPassResult?.diagnostics ?? []
}, [modoSimulacaoEfetivo, multiPassResult])
```

Isso elimina a chamada duplicada a `buildPreviewDiagnostics` — o multi-pass ja fez.

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: 0 erros

- [ ] **Step 5: Commit**

```
feat(preview): SetorDetalhe usa multi-pass + domingo_ciclo real
```

---

### Task 3: Advisory substitui preview diagnostics + "Analisar com IA" com contexto

**Files:**
- Modify: `src/renderer/src/lib/build-avisos.ts`
- Modify: `src/renderer/src/paginas/SetorDetalhe.tsx`

- [ ] **Step 1: build-avisos — advisory substitui preview com mesmo codigo**

Em `src/renderer/src/lib/build-avisos.ts`, ANTES do bloco que itera `advisoryDiagnostics` (~linha 92), adicionar filtro:

```ts
// Advisory diagnostics tem precedencia sobre preview diagnostics com mesmo codigo base
if (advisoryDiagnostics && advisoryDiagnostics.length > 0) {
  const advisoryBaseCodes = new Set(
    advisoryDiagnostics.map((d) => d.code.replace('ADVISORY_', '')),
  )
  // Remove preview diagnostics que o advisory ja cobre
  const filtered = entries.filter((e) => {
    if (!e.id.startsWith('diagnostic_')) return true
    const baseCode = e.id.replace('diagnostic_', '')
    return !advisoryBaseCodes.has(baseCode)
  })
  entries.length = 0
  entries.push(...filtered)
}
```

- [ ] **Step 2: abrirAnaliseIa envia contexto**

Em `SetorDetalhe.tsx`, encontrar `abrirAnaliseIa` (~linha 1254-1256). Substituir:

```ts
const abrirAnaliseIa = useCallback(() => {
  // Construir contexto a partir da melhor fonte disponivel
  const failedCriteria = advisoryResult
    ? advisoryResult.current.criteria
        .filter((c) => c.status === 'FAIL')
        .map((c) => c.title)
    : previewDiagnostics
        .filter((d) => d.severity === 'error')
        .map((d) => d.title)

  if (failedCriteria.length > 0) {
    const prompt = `Analise os problemas da escala do setor ${setor?.nome ?? ''} no periodo ${periodoGeracao.inicio} a ${periodoGeracao.fim}: ${failedCriteria.join('; ')}`
    useIaStore.getState().setPendingAutoMessage(prompt)
  }
  useIaStore.getState().setAberto(true)
}, [advisoryResult, previewDiagnostics, setor?.nome, periodoGeracao])
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: 0 erros

- [ ] **Step 4: Commit**

```
feat(preview): advisory substitui preview diagnostics + IA com contexto
```

---

### Task 4: Testes de convergencia

**Files:**
- Create: `tests/shared/preview-advisory-convergence.spec.ts`

- [ ] **Step 1: Criar testes de convergencia**

Estes testes verificam que o preview TS e o advisory solver produzem diagnosticos compatíveis para os mesmos cenarios.

```ts
// tests/shared/preview-advisory-convergence.spec.ts
import { describe, it, expect } from 'vitest'
import { runPreviewMultiPass } from '../../src/shared/preview-multi-pass'
import { buildPreviewAvisos } from '../../src/renderer/src/lib/build-avisos'
import type { PreviewDiagnostic } from '../../src/shared/preview-diagnostics'

describe('preview + advisory convergence', () => {
  it('advisory diagnostics substituem preview com mesmo codigo', () => {
    const previewDiagnostics: PreviewDiagnostic[] = [
      { code: 'CAPACIDADE_DIARIA_INSUFICIENTE', severity: 'error', gate: 'BLOCK', title: 'Preview: deficit', detail: 'SEG', source: 'capacity' },
    ]
    const advisoryDiagnostics: PreviewDiagnostic[] = [
      { code: 'ADVISORY_CAPACIDADE_DIARIA_INSUFICIENTE', severity: 'info', gate: 'ALLOW', title: 'Advisory: resolvido', detail: 'OK', source: 'advisory_proposal' },
    ]

    const avisos = buildPreviewAvisos({
      previewDiagnostics,
      storePreviewAvisos: [],
      avisosOperacao: [],
      semTitular: 0,
      foraDoPreview: 0,
      advisoryDiagnostics,
    })

    // Preview ERRO deve ter sido substituido pelo advisory OK
    const previewAviso = avisos.find((a) => a.id === 'diagnostic_CAPACIDADE_DIARIA_INSUFICIENTE')
    const advisoryAviso = avisos.find((a) => a.id === 'advisory_ADVISORY_CAPACIDADE_DIARIA_INSUFICIENTE')

    expect(previewAviso).toBeUndefined() // substituido
    expect(advisoryAviso).toBeDefined()
    expect(advisoryAviso!.nivel).toBe('info') // advisory diz OK
  })

  it('preview diagnostics sobrevivem quando nao ha advisory', () => {
    const previewDiagnostics: PreviewDiagnostic[] = [
      { code: 'CAPACIDADE_DIARIA_INSUFICIENTE', severity: 'error', gate: 'BLOCK', title: 'Deficit', detail: 'SEG', source: 'capacity' },
    ]

    const avisos = buildPreviewAvisos({
      previewDiagnostics,
      storePreviewAvisos: [],
      avisosOperacao: [],
      semTitular: 0,
      foraDoPreview: 0,
    })

    expect(avisos.find((a) => a.id === 'diagnostic_CAPACIDADE_DIARIA_INSUFICIENTE')).toBeDefined()
  })

  it('multi-pass SOFT warning nao bloqueia geracao', () => {
    const result = runPreviewMultiPass({
      fase1Input: { num_postos: 6, trabalham_domingo: 4 },
      participants: Array.from({ length: 6 }, (_, i) => ({
        id: i + 1, nome: `P${i}`, sexo: 'M' as const,
      })),
      demandaPorDia: [4, 4, 4, 4, 4, 3, 4],
      trabalhamDomingo: 4,
      rules: { H3_DOM_MAX_CONSEC_M: 'SOFT', H3_DOM_MAX_CONSEC_F: 'SOFT' },
    })

    expect(result.output.sucesso).toBe(true)
    expect(result.relaxed).toBe(true)
    // Warnings nao devem ter gate BLOCK
    const blocks = result.diagnostics.filter((d) => d.gate === 'BLOCK')
    expect(blocks).toHaveLength(0)
  })

  it('multi-pass HARD violation bloqueia geracao', () => {
    const result = runPreviewMultiPass({
      fase1Input: { num_postos: 6, trabalham_domingo: 4 },
      participants: Array.from({ length: 6 }, (_, i) => ({
        id: i + 1, nome: `P${i}`, sexo: 'M' as const,
      })),
      demandaPorDia: [4, 4, 4, 4, 4, 3, 4],
      trabalhamDomingo: 4,
      rules: { H3_DOM_MAX_CONSEC_M: 'HARD', H3_DOM_MAX_CONSEC_F: 'HARD' },
    })

    expect(result.output.sucesso).toBe(false)
    // Nao relaxou
    expect(result.relaxed).toBe(false)
  })
})
```

- [ ] **Step 2: Rodar**

Run: `npx vitest run tests/shared/preview-advisory-convergence.spec.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```
test(preview): convergencia preview TS + advisory solver
```

---

### Task 5: Typecheck final + parity

**Files:** Nenhum novo

- [ ] **Step 1: Typecheck**

Run: `npm run typecheck`
Expected: 0 erros

- [ ] **Step 2: Parity test**

Run: `npm run solver:test:parity`
Expected: PASS (nenhuma mudanca no solver)

- [ ] **Step 3: Todos os testes**

Run: `npx vitest run`
Expected: todos PASS

- [ ] **Step 4: Commit final (se houver fix)**

```
chore(preview): verificacao final fonte unica
```

---

## Resumo

| Task | Descricao | Esforco |
|------|-----------|---------|
| 1 | `preview-multi-pass.ts` + 7 testes | 15 min |
| 2 | SetorDetalhe usa multi-pass + domingo_ciclo | 10 min |
| 3 | Advisory substitui preview + IA com contexto | 10 min |
| 4 | Testes de convergencia | 10 min |
| 5 | Typecheck + parity | 5 min |

**Total: 5 tasks, ~50 min**
