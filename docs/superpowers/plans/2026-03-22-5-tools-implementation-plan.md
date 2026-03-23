# Context-First + 5 Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fazer a IA enxergar o preview do setor, corrigir bugs de contexto, provar via E2E no Electron real, e colapsar a surface de 30 tools (estado atual, ja reduzido de 33) para 5 tools publicas.

**Architecture:** O context bundle (`buildContextBundle`) ja existe com 13+ secoes incluindo preview. Tres bugs impedem o contexto de ser confiavel. Apos corrigir, o E2E prova que a IA responde com contexto. Depois, 5 tool families (consultar_contexto, editar_ficha, executar_acao, salvar_memoria, remover_memoria) substituem as 30 tools atomicas como surface publica do LLM — handlers internos continuam existindo como roteamento.

**Estado atual:** `IA_TOOLS` ja tem 30 entries (reducao de 33→30 ja feita). `TOOL_SCHEMAS` tem 33 entries (inclui schemas de tools removidas da surface). O alvo e 5 tools publicas.

**Tech Stack:** TypeScript, Zod, Vitest, Playwright, Electron, Vercel AI SDK, React 19

**Spec de referencia:** `docs/superpowers/specs/2026-03-21-context-tools-reduction-design.md`

**Branch:** `fix/solver-distribution-folgas`

---

## File Structure

### Files to modify

| File | Responsabilidade | Tasks |
|------|------------------|-------|
| `src/main/ia/discovery.ts` | Context bundle + preview | 1, 3 |
| `src/main/ia/tools.ts` | Tool handlers + IA_TOOLS surface | 8, 9 |
| `src/main/ia/cliente.ts` | System prompt assembly + turn metadata | 4 |
| `src/main/ia/system-prompt.ts` | Instrucoes ao LLM | 6, 10 |
| `src/shared/types.ts` | IaStreamEvent union type | 4 |
| `src/renderer/src/componentes/IaMensagemBubble.tsx` | data-turn-meta no DOM | 5 |
| `tests/ia/live/ia-chat-cli.ts` | CLI harness | 2 |
| `tests/ia/evals/run-evals.ts` | Eval harness | 2 |
| `tests/e2e/helpers/ia-chat.ts` | E2E helpers | 5 |
| `tests/e2e/ia-chat-tool-calls.spec.ts` | E2E specs | 7 |

### Files to create

| File | Responsabilidade | Tasks |
|------|------------------|-------|
| `src/main/ia/tool-families.ts` | Schemas Zod + routing para 5 tool families | 8 |
| `tests/ia/tool-families.test.ts` | Unit tests do routing adapter | 8 |

---

## Wave A: Fix Bugs + Foundation

### Task 1: Fix cobertura_media calculation

**Files:**
- Modify: `src/main/ia/discovery.ts:1111`
- Test: `npm run preview:cli -- <setor_id> --context`

O bug: divide `totalCob / 7 / max_demanda` em vez de normalizar por dia. Resultado: 78% quando deveria ser 93%.

- [ ] **Step 1: Locate and understand the bug**

Read `src/main/ia/discovery.ts` lines 1095-1135. The formula at line 1111:
```typescript
const cobertura_media = 7 > 0 ? totalCob / 7 / Math.max(1, Math.max(...demanda_por_dia)) : 0
```

Problem: divides by global max demand, not per-day demand. If demand is [5,5,5,5,5,8,8] and coverage is [5,5,5,5,5,7,7], current code gives 78% but correct is 93%.

- [ ] **Step 2: Fix the formula**

Replace line 1111 in `src/main/ia/discovery.ts`:

```typescript
// OLD:
const cobertura_media = 7 > 0 ? totalCob / 7 / Math.max(1, Math.max(...demanda_por_dia)) : 0

// NEW — normalize per-day first, then average:
const cobertura_media = cobertura_por_dia.length > 0
    ? cobertura_por_dia.reduce((sum, d) => sum + (d.demanda > 0 ? Math.min(1, d.cobertura / d.demanda) : 1), 0) / cobertura_por_dia.length
    : 0
```

Logic: for each day, compute `min(1, coverage/demand)`. Average across 7 days. If demand is 0 for a day, treat as 100% covered.

- [ ] **Step 3: Verify fix with preview CLI**

Run:
```bash
npm run preview:cli -- 1 --context
```

Expected: `cobertura_media` reflects per-day normalized average. Value should be higher than before for sectors where demand varies by day.

- [ ] **Step 4: Run typecheck**

```bash
npm run typecheck
```

Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/main/ia/discovery.ts
git commit -m "fix(ia): cobertura_media normalized per-day instead of global max_demanda"
```

---

### Task 2: Fix CLI and evals mensagemUsuario gap

**Files:**
- Modify: `tests/ia/live/ia-chat-cli.ts:136`
- Modify: `tests/ia/evals/run-evals.ts:187`

O bug: CLI e evals chamam `buildContextBriefing(contexto)` sem segundo arg. Auto-RAG (semantic search on knowledge base) nunca roda nesses caminhos. O app real passa `currentMsg`.

- [ ] **Step 1: Fix CLI — pass mensagemUsuario**

In `tests/ia/live/ia-chat-cli.ts`, find where `buildContextBriefing` is called (around line 136). Change to pass the user's message:

```typescript
// OLD:
contextBriefing = await runtime.buildContextBriefing(contexto as any)

// NEW — pass user message for RAG parity with app:
contextBriefing = await runtime.buildContextBriefing(contexto as any, userMessage)
```

Note: `userMessage` is the current user input. Trace the variable name in the CLI's REPL loop — it may be called `line`, `input`, or `msg`. Use the exact variable name from the code.

- [ ] **Step 2: Fix evals — pass mensagemUsuario**

In `tests/ia/evals/run-evals.ts`, find where `buildContextBriefing` is called (around line 187). Change:

```typescript
// OLD:
const contextBriefing = await deps.buildContextBriefing(contexto)

// NEW:
const contextBriefing = await deps.buildContextBriefing(contexto, scenario.prompt)
```

Here `scenario.prompt` is the eval's test question. Verify the exact field name from the eval scenario type.

- [ ] **Step 3: Run typecheck**

```bash
npm run typecheck
```

Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add tests/ia/live/ia-chat-cli.ts tests/ia/evals/run-evals.ts
git commit -m "fix(ia): pass mensagemUsuario in CLI and evals for RAG parity"
```

---

### Task 3: Fix preview narrative consistency

**Files:**
- Modify: `src/main/ia/discovery.ts` (renderContextBriefing section for preview)

O bug: `cobertura_media` mostra media global, mas warnings vem do `gerarCicloFase1` que olha semana-a-semana. Resultado: briefing pode dizer "excelente cobertura" e logo abaixo mostrar "cobertura 3/4 em sabado".

- [ ] **Step 1: Find where preview is rendered in the briefing**

In `discovery.ts`, find the `renderContextBriefing()` function. Look for where `preview.cobertura_media` is used to generate text. Typically around the "Preview de ciclo" section.

- [ ] **Step 2: Add worst-day caveat to the narrative**

After the cobertura_media summary line, add a caveat if worst-day coverage is significantly below average:

```typescript
// After the cobertura_media line in the briefing:
const worstDay = preview.cobertura_por_dia.reduce(
    (worst, d) => (d.demanda > 0 && d.cobertura / d.demanda < (worst?.ratio ?? 1))
        ? { dia: d.dia, ratio: d.cobertura / d.demanda, cobertura: d.cobertura, demanda: d.demanda }
        : worst,
    null as { dia: string; ratio: number; cobertura: number; demanda: number } | null
)

if (worstDay && worstDay.ratio < 0.9) {
    lines.push(`⚠️ Pior dia: ${worstDay.dia} (${worstDay.cobertura}/${worstDay.demanda} pessoas)`)
}
```

This ensures the briefing never says "everything fine" when one day has significant deficit.

- [ ] **Step 3: Verify with preview CLI**

```bash
npm run preview:cli -- 1 --context
```

Expected: if any day has coverage below 90%, a warning line appears in the preview section.

- [ ] **Step 4: Run typecheck**

```bash
npm run typecheck
```

- [ ] **Step 5: Commit**

```bash
git add src/main/ia/discovery.ts
git commit -m "fix(ia): add worst-day caveat to preview briefing for narrative consistency"
```

---

## Wave B: Observability + Vertical Slice

### Task 4: Emit turn metadata in stream events

**Files:**
- Modify: `src/shared/types.ts:880` — add `context-meta` event type
- Modify: `src/main/ia/cliente.ts` — emit metadata after building system prompt

O objetivo: para cada turno, o sistema emite quais secoes de contexto entraram e qual pagina/setor foi usada. Isso permite ao E2E provar uso de contexto.

- [ ] **Step 1: Add context-meta event to IaStreamEvent**

In `src/shared/types.ts`, add a new member to the `IaStreamEvent` union type (after the `start-step` entry):

```typescript
export type IaStreamEvent =
  | { type: 'text-delta'; stream_id: string; delta: string }
  | { type: 'tool-call-start'; stream_id: string; tool_call_id: string; tool_name: string; args: Record<string, unknown>; estimated_seconds?: number }
  | { type: 'tool-result'; stream_id: string; tool_call_id: string; tool_name: string; result: unknown }
  | { type: 'start-step'; stream_id: string; step_index: number }
  | { type: 'context-meta'; stream_id: string; meta: IaContextMeta }  // ← NEW
  | { type: 'step-finish'; stream_id: string; step_index: number }
  | { type: 'follow-up-start'; stream_id: string }
  | { type: 'finish'; stream_id: string; resposta: string; acoes: ToolCall[] }
  | { type: 'error'; stream_id: string; message: string }

// ← NEW: Add this type near IaStreamEvent
export interface IaContextMeta {
  pagina?: string
  rota?: string
  setor_id?: number
  colaborador_id?: number
  bundle_sections: string[]
  briefing_chars: number
}
```

- [ ] **Step 2: Emit context-meta in cliente.ts streaming path**

In `src/main/ia/cliente.ts`, in the streaming function (`_callWithVercelAiSdkToolsStreaming`), after `buildFullSystemPrompt` resolves, emit the metadata. Find where the bundle is built (via `buildContextBundle`) and emit:

```typescript
// After building the system prompt (around line 421):
const bundle = await buildContextBundle(contexto, currentMsg)
const contextBriefing = bundle ? renderContextBriefing(bundle) : ''
const fullSystemPrompt = contextBriefing
    ? `${SYSTEM_PROMPT}\n\n---\n${contextBriefing}`
    : SYSTEM_PROMPT

// Emit context metadata
broadcast({
    type: 'context-meta',
    stream_id: streamId,
    meta: {
        pagina: contexto?.pagina,
        rota: contexto?.rota,
        setor_id: contexto?.setor_id,
        colaborador_id: contexto?.colaborador_id,
        bundle_sections: bundle ? Object.keys(bundle).filter(k => bundle[k] != null) : [],
        briefing_chars: contextBriefing.length,
    }
})
```

**IMPORTANTE:** Isso requer:
1. Atualizar o import no topo de `cliente.ts` para incluir `buildContextBundle` e `renderContextBriefing`:
   ```typescript
   // Atualizar import de discovery.ts:
   import { buildContextBriefing, buildContextBundle, renderContextBriefing } from './discovery'
   ```
2. Refatorar `buildFullSystemPrompt` para chamar `buildContextBundle` + `renderContextBriefing` separadamente (em vez do wrapper `buildContextBriefing`) para ter acesso ao bundle intermediario.
3. Ambas funcoes JA sao exportadas de discovery.ts (linhas 73 e 240).

- [ ] **Step 3: Handle context-meta in renderer**

In the renderer's stream event handler (likely in `IaChatView.tsx` or a hook), add a case for `context-meta`:

```typescript
case 'context-meta':
    // Store the metadata for the current turn
    setCurrentTurnMeta(event.meta)
    break
```

Store the metadata in a state variable (e.g., `useRef` or map by message index) and pass it as prop to `IaMensagemBubble`:

```typescript
// In IaChatView.tsx state:
const turnMetaRef = useRef<Record<number, IaContextMeta>>({})

// In stream event handler:
case 'context-meta':
    // Store meta indexed by current message index
    turnMetaRef.current[mensagens.length] = event.meta
    break

// When rendering assistant messages:
<IaMensagemBubble
    ...existingProps
    turnMeta={turnMetaRef.current[messageIndex]}
/>
```

The `IaMensagemBubble` component needs a new optional prop `turnMeta?: IaContextMeta`.

- [ ] **Step 4: Run typecheck**

```bash
npm run typecheck
```

- [ ] **Step 5: Commit**

```bash
git add src/shared/types.ts src/main/ia/cliente.ts src/renderer/src/componentes/IaChatView.tsx
git commit -m "feat(ia): emit context-meta stream event with bundle sections and page info"
```

---

### Task 5: Expose turn metadata in DOM + E2E helper

**Files:**
- Modify: `src/renderer/src/componentes/IaMensagemBubble.tsx` — add `data-turn-meta`
- Modify: `tests/e2e/helpers/ia-chat.ts` — add `getTurnMeta()` helper

- [ ] **Step 1: Add data-turn-meta to assistant message bubble**

In `IaMensagemBubble.tsx`, when rendering an assistant message, add a data attribute with the context metadata:

```tsx
// On the assistant message wrapper div:
<div
    data-testid="ia-assistant-message"
    data-turn-meta={turnMeta ? JSON.stringify(turnMeta) : undefined}
    className={...}
>
```

The `turnMeta` comes from the `context-meta` event stored in the parent component state.

- [ ] **Step 2: Add getTurnMeta E2E helper**

In `tests/e2e/helpers/ia-chat.ts`, add:

```typescript
export async function getTurnMeta(page: Page): Promise<{
    pagina?: string
    rota?: string
    setor_id?: number
    bundle_sections: string[]
    briefing_chars: number
} | null> {
    const lastMsg = page.locator('[data-testid="ia-assistant-message"]').last()
    const metaStr = await lastMsg.getAttribute('data-turn-meta')
    if (!metaStr) return null
    try { return JSON.parse(metaStr) } catch { return null }
}
```

- [ ] **Step 3: Run typecheck**

```bash
npm run typecheck
```

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/componentes/IaMensagemBubble.tsx tests/e2e/helpers/ia-chat.ts
git commit -m "feat(e2e): expose turn metadata in DOM for E2E context proof"
```

---

### Task 6: Teach IA to use preview via system prompt

**Files:**
- Modify: `src/main/ia/system-prompt.ts`

O system prompt precisa instruir o modelo a USAR o preview do contexto antes de chamar tools.

- [ ] **Step 1: Find the tool philosophy section**

In `system-prompt.ts`, find the section that tells the IA when to use tools vs context. It's typically labeled "Regras de ouro" or "Tool Philosophy" (around lines 10-15 and 300-400).

- [ ] **Step 2: Add explicit preview instruction**

Add a new rule near the golden rules:

```
- Quando o contexto traz "Preview de ciclo", USE esses dados para responder sobre folgas, cobertura, deficit e distribuicao. NAO chame consultar() para dados que ja estao no preview.
- Se o preview mostra deficit_max > 0 ou cobertura < 90% em algum dia, MENCIONE isso proativamente.
- O preview reflete o estado ATUAL das regras e colaboradores. Ele e confiavel.
```

- [ ] **Step 3: Run typecheck**

```bash
npm run typecheck
```

- [ ] **Step 4: Commit**

```bash
git add src/main/ia/system-prompt.ts
git commit -m "feat(ia): instruct LLM to use preview from context before calling tools"
```

---

### Task 7: E2E Padaria vertical slice — context proof tests

**Files:**
- Modify: `tests/e2e/ia-chat-tool-calls.spec.ts`

Estes testes provam que a IA responde com dados do contexto no Electron real.

- [ ] **Step 1: Add context-proof test for folgas**

Add a new test in `ia-chat-tool-calls.spec.ts`:

```typescript
test('folgas — responde com dados do preview sem pedir ID', async () => {
    await sendIaMessage(page, 'a distribuicao de folgas da padaria esta boa?')
    await waitForAssistantTurnComplete(page)

    const text = await getLastAssistantText(page)
    expect(text.length).toBeGreaterThan(20)

    // Must NOT ask for setor ID — context already has it
    expect(text.toLowerCase()).not.toContain('id do setor')
    expect(text.toLowerCase()).not.toContain('qual setor')

    // Context metadata should show setor was in context
    const meta = await getTurnMeta(page)
    if (meta) {
        expect(meta.bundle_sections).toContain('setor')
        expect(meta.briefing_chars).toBeGreaterThan(100)
    }
})
```

- [ ] **Step 2: Add context-proof test for deficit**

```typescript
test('deficit — resposta coerente com preview', async () => {
    await startFreshIaConversation(page)
    await sendIaMessage(page, 'tem deficit de cobertura em algum dia?')
    await waitForAssistantTurnComplete(page)

    const text = await getLastAssistantText(page)
    expect(text.length).toBeGreaterThan(20)

    // Should reference specific days or say no deficit — not ask for more info
    expect(text.toLowerCase()).not.toContain('qual setor')
})
```

- [ ] **Step 3: Add context-proof test for operacional**

```typescript
test('operacional — quem esta fora do posto usa setor atual', async () => {
    await startFreshIaConversation(page)
    await sendIaMessage(page, 'quem esta fora do posto na padaria?')
    await waitForAssistantTurnComplete(page)

    const text = await getLastAssistantText(page)
    expect(text.length).toBeGreaterThan(10)

    // Must NOT ask which sector
    expect(text.toLowerCase()).not.toContain('qual setor')
})
```

- [ ] **Step 4: Run E2E tests**

```bash
npm run test:e2e
```

Expected: smoke + existing tests + new tests pass. New tests may need API key.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/ia-chat-tool-calls.spec.ts tests/e2e/helpers/ia-chat.ts
git commit -m "test(e2e): add Padaria vertical slice with context proof assertions"
```

---

## Wave C: 5 Tools Migration

### Task 8: Create tool families adapter

**Files:**
- Create: `src/main/ia/tool-families.ts`
- Create: `tests/ia/tool-families.test.ts`
- Modify: `src/main/ia/tools.ts` — export internal handler access

O adapter cria 5 tool families com schemas Zod. Cada handler roteia para os handlers internos existentes via `executeTool()`.

- [ ] **Step 1: Write routing tests**

Create `tests/ia/tool-families.test.ts`:

```typescript
import { describe, test, expect } from 'vitest'
import { routeFamilyTool } from '../../src/main/ia/tool-families'

describe('tool-families routing', () => {
    test('consultar_contexto routes to consultar for setor', () => {
        const route = routeFamilyTool('consultar_contexto', {
            entidade: 'setor',
            id: 4,
        })
        expect(route.internalTool).toBe('consultar')
        expect(route.internalArgs.entidade).toBe('setores')
    })

    test('editar_ficha routes to criar for new colaborador', () => {
        const route = routeFamilyTool('editar_ficha', {
            entidade: 'colaborador',
            operacao: 'criar',
            dados: { nome: 'Test', setor_id: 1 },
        })
        expect(route.internalTool).toBe('criar')
        expect(route.internalArgs.entidade).toBe('colaboradores')
    })

    test('editar_ficha routes to atualizar for existing', () => {
        const route = routeFamilyTool('editar_ficha', {
            entidade: 'colaborador',
            id: 5,
            dados: { nome: 'Updated' },
        })
        expect(route.internalTool).toBe('atualizar')
        expect(route.internalArgs.id).toBe(5)
    })

    test('executar_acao routes to gerar_escala', () => {
        const route = routeFamilyTool('executar_acao', {
            acao: 'gerar_escala',
            args: { setor_id: 4, data_inicio: '2026-03-01', data_fim: '2026-03-31' },
        })
        expect(route.internalTool).toBe('gerar_escala')
    })

    test('executar_acao routes to oficializar_escala', () => {
        const route = routeFamilyTool('executar_acao', {
            acao: 'oficializar',
            args: { escala_id: 10 },
        })
        expect(route.internalTool).toBe('oficializar_escala')
    })
})
```

- [ ] **Step 2: Run tests to see them fail**

```bash
npx vitest run tests/ia/tool-families.test.ts
```

Expected: FAIL — `routeFamilyTool` not found.

- [ ] **Step 3: Create tool-families.ts with schemas and routing**

Create `src/main/ia/tool-families.ts`:

```typescript
import { z } from 'zod'
import { executeTool } from './tools'

// ==================== SCHEMAS ====================

export const ConsultarContextoSchema = z.object({
    entidade: z.enum([
        'setor', 'colaborador', 'empresa', 'escala',
        'regras', 'contrato', 'feriados', 'excecoes',
    ]).describe('Tipo de entidade a consultar.'),
    id: z.number().int().positive().optional().describe('ID da entidade. Obrigatorio para setor, colaborador, escala.'),
    filtros: z.record(z.any()).optional().describe('Filtros adicionais (ex: {"ativo": true}).'),
    visao: z.enum(['resumo', 'detalhado']).optional().default('resumo').describe('Nivel de detalhe.'),
})

export const EditarFichaSchema = z.object({
    entidade: z.enum([
        'colaborador', 'setor', 'empresa', 'contrato',
        'excecao', 'demanda', 'feriado', 'posto', 'regra',
        'regra_horario', 'perfil_horario', 'horario_funcionamento',
    ]).describe('Tipo de entidade a editar.'),
    id: z.number().int().positive().optional().describe('ID do registro. Omitir para criar novo.'),
    operacao: z.enum(['criar', 'atualizar', 'remover']).default('atualizar').describe('Tipo de operacao.'),
    dados: z.record(z.any()).describe('Campos a criar/atualizar. Use snake_case.'),
})

export const ExecutarAcaoSchema = z.object({
    acao: z.enum([
        'gerar_escala', 'oficializar', 'ajustar_celula',
        'ajustar_horario', 'preflight', 'diagnosticar',
        'diagnosticar_infeasible', 'explicar_violacao',
        'resumir_horas', 'backup', 'resetar_regras',
        'cadastrar_lote',
    ]).describe('Acao a executar.'),
    args: z.record(z.any()).describe('Argumentos da acao. Variam por tipo.'),
})

export const SalvarMemoriaSchema = z.object({
    conteudo: z.string().min(1).describe('Fato curto a memorizar.'),
    id: z.number().int().positive().optional().describe('ID da memoria a atualizar. Omitir para criar nova.'),
})

export const RemoverMemoriaSchema = z.object({
    id: z.number().int().positive().describe('ID da memoria a remover.'),
})

// ==================== ROUTING ====================

interface ToolRoute {
    internalTool: string
    internalArgs: Record<string, any>
}

const ENTIDADE_TO_TABLE: Record<string, string> = {
    setor: 'setores',
    colaborador: 'colaboradores',
    empresa: 'empresa',
    escala: 'escalas',
    regras: 'regra_empresa',
    contrato: 'tipos_contrato',
    feriados: 'feriados',
    excecoes: 'excecoes',
    demanda: 'demandas',
    feriado: 'feriados',
}

export function routeFamilyTool(familyName: string, args: Record<string, any>): ToolRoute {
    switch (familyName) {
        case 'consultar_contexto': {
            const table = ENTIDADE_TO_TABLE[args.entidade] ?? args.entidade
            if (args.entidade === 'colaborador' && args.id) {
                return { internalTool: 'buscar_colaborador', internalArgs: { id: args.id } }
            }
            return {
                internalTool: 'consultar',
                internalArgs: {
                    entidade: table,
                    filtros: args.id ? { id: args.id, ...(args.filtros ?? {}) } : (args.filtros ?? {}),
                }
            }
        }

        case 'editar_ficha': {
            const table = ENTIDADE_TO_TABLE[args.entidade] ?? args.entidade
            if (args.operacao === 'remover' || args.operacao === 'deletar') {
                return { internalTool: 'deletar', internalArgs: { entidade: table, id: args.id } }
            }
            // Special routing for domain-specific handlers
            if (args.entidade === 'posto') {
                return { internalTool: 'salvar_posto_setor', internalArgs: args.dados }
            }
            if (args.entidade === 'regra') {
                return { internalTool: 'editar_regra', internalArgs: args.dados }
            }
            if (args.entidade === 'regra_horario') {
                return { internalTool: 'salvar_regra_horario_colaborador', internalArgs: args.dados }
            }
            if (args.entidade === 'perfil_horario') {
                if (args.operacao === 'remover') {
                    return { internalTool: 'deletar_perfil_horario', internalArgs: { id: args.id } }
                }
                return { internalTool: 'salvar_perfil_horario', internalArgs: args.dados }
            }
            if (args.entidade === 'horario_funcionamento') {
                return { internalTool: 'configurar_horario_funcionamento', internalArgs: args.dados }
            }
            if (args.entidade === 'demanda' && args.dados?.data_especifica) {
                return { internalTool: 'salvar_demanda_excecao_data', internalArgs: args.dados }
            }
            if (args.entidade === 'excecao' && args.dados?.data_especifica) {
                return { internalTool: 'upsert_regra_excecao_data', internalArgs: args.dados }
            }
            if (args.id) {
                return { internalTool: 'atualizar', internalArgs: { entidade: table, id: args.id, dados: args.dados } }
            }
            return { internalTool: 'criar', internalArgs: { entidade: table, dados: args.dados } }
        }

        case 'executar_acao': {
            const ACAO_TO_TOOL: Record<string, string> = {
                gerar_escala: 'gerar_escala',
                oficializar: 'oficializar_escala',
                ajustar_celula: 'ajustar_alocacao',
                ajustar_horario: 'ajustar_horario',
                preflight: 'preflight',
                diagnosticar: 'diagnosticar_escala',
                diagnosticar_infeasible: 'diagnosticar_infeasible',
                explicar_violacao: 'explicar_violacao',
                resumir_horas: 'resumir_horas_setor',
                backup: 'fazer_backup',
                resetar_regras: 'resetar_regras_empresa',
                cadastrar_lote: 'cadastrar_lote',
            }
            const internalTool = ACAO_TO_TOOL[args.acao]
            if (!internalTool) {
                return { internalTool: 'UNKNOWN', internalArgs: args }
            }
            return { internalTool, internalArgs: args.args ?? {} }
        }

        default:
            return { internalTool: familyName, internalArgs: args }
    }
}

// ==================== EXECUTE ====================

export async function executeFamilyTool(familyName: string, args: Record<string, any>): Promise<any> {
    if (familyName === 'salvar_memoria' || familyName === 'remover_memoria') {
        return executeTool(familyName, args)
    }
    const route = routeFamilyTool(familyName, args)
    if (route.internalTool === 'UNKNOWN') {
        return { status: 'error', error: `Acao desconhecida: ${args.acao}` }
    }
    return executeTool(route.internalTool, route.internalArgs)
}

// ==================== FAMILY TOOL DEFINITIONS ====================

export const FAMILY_TOOLS = [
    {
        name: 'consultar_contexto',
        description: 'Consulta dados de qualquer entidade do sistema. Use para informacao detalhada que nao esta no contexto automatico. Para setores, colaboradores e escalas, o contexto ja traz resumo — use esta tool quando precisar de detalhes extras ou filtros especificos.',
    },
    {
        name: 'editar_ficha',
        description: 'Cria, atualiza ou remove registros de qualquer entidade. Exemplos: cadastrar colaborador, ajustar horario de funcionamento, criar excecao de ferias, editar regra. Sempre use snake_case nos campos.',
    },
    {
        name: 'executar_acao',
        description: 'Executa acoes de dominio: gerar escala, oficializar, ajustar celula, preflight, diagnosticar, backup, etc. Use para operacoes que processam dados ou tem side effects significativos.',
    },
    {
        name: 'salvar_memoria',
        description: 'Salva fato curto para lembrar nas proximas conversas (ex: "Cleunice nunca troca turno"). Max 20 memorias.',
    },
    {
        name: 'remover_memoria',
        description: 'Remove uma memoria por ID.',
    },
]

export const FAMILY_SCHEMAS: Record<string, z.ZodTypeAny> = {
    consultar_contexto: ConsultarContextoSchema,
    editar_ficha: EditarFichaSchema,
    executar_acao: ExecutarAcaoSchema,
    salvar_memoria: SalvarMemoriaSchema,
    remover_memoria: RemoverMemoriaSchema,
}
```

- [ ] **Step 4: Run routing tests**

```bash
npx vitest run tests/ia/tool-families.test.ts
```

Expected: all 5 tests PASS.

- [ ] **Step 5: Run typecheck**

```bash
npm run typecheck
```

- [ ] **Step 6: Commit**

```bash
git add src/main/ia/tool-families.ts tests/ia/tool-families.test.ts
git commit -m "feat(ia): add tool families adapter with 5 public tools and routing"
```

---

### Task 9: Switch LLM surface from 30 to 5 tools

**Files:**
- Modify: `src/main/ia/tools.ts` — add `getVercelAiFamilyTools()`, update `IA_TOOLS_PUBLIC`
- Modify: `src/main/ia/cliente.ts` — use family tools instead of atomic tools

- [ ] **Step 1: Add family tools support in tools.ts**

In `src/main/ia/tools.ts`, add at the end (before the final export). **IMPORTANTE:** `toJsonSchema` e uma funcao PRIVADA em tools.ts — NAO exporte-a. Construa `IA_TOOLS_PUBLIC` e `getVercelAiFamilyTools` DENTRO de tools.ts onde `toJsonSchema` esta em escopo:

```typescript
// Adicionar import no topo de tools.ts:
import { FAMILY_TOOLS, FAMILY_SCHEMAS, executeFamilyTool } from './tool-families'

// Adicionar DENTRO de tools.ts (onde toJsonSchema esta acessivel):

// Public surface for LLM — 5 family tools
export const IA_TOOLS_PUBLIC = FAMILY_TOOLS.map(t => ({
    name: t.name,
    description: t.description,
    parameters: toJsonSchema(FAMILY_SCHEMAS[t.name]),
}))

export function getVercelAiFamilyTools() {
    const tools: Record<string, any> = {}
    for (const t of FAMILY_TOOLS) {
        const zodSchema = FAMILY_SCHEMAS[t.name]
        tools[t.name] = {
            description: t.description,
            parameters: zodSchema,
            execute: async (args: Record<string, any>) => {
                return await executeFamilyTool(t.name, args)
            }
        }
    }
    return tools
}
```

- [ ] **Step 2: Switch cliente.ts to use family tools**

In `src/main/ia/cliente.ts`, find where `getVercelAiTools()` is called and replace with `getVercelAiFamilyTools()`:

```typescript
// OLD:
const tools = getVercelAiTools()

// NEW:
const tools = getVercelAiFamilyTools()
```

Do this for BOTH streaming and non-streaming paths.

Also find where `IA_TOOLS` is used for Gemini format (if applicable) and replace with `IA_TOOLS_PUBLIC`.

- [ ] **Step 3: Update local-llm.ts similarly**

In `src/main/ia/local-llm.ts`, find where tools are loaded (line 367):

```typescript
// OLD:
const { IA_TOOLS, TOOL_SCHEMAS, executeTool } = await import('./tools')

// NEW — importar de tools.ts (onde IA_TOOLS_PUBLIC e re-exportado):
const { IA_TOOLS_PUBLIC, executeTool } = await import('./tools')
const { FAMILY_SCHEMAS, executeFamilyTool } = await import('./tool-families')
```

Depois, atualizar o loop que registra funcoes no chat session (line ~380+) para usar `IA_TOOLS_PUBLIC` em vez de `IA_TOOLS`, e `executeFamilyTool` em vez de `executeTool` para as chamadas do LLM. O `executeTool` continua disponivel para uso interno.

- [ ] **Step 4: Run typecheck**

```bash
npm run typecheck
```

Fix any import/type errors.

- [ ] **Step 5: Run unit tests**

```bash
npm run test
```

- [ ] **Step 6: Commit**

```bash
git add src/main/ia/tools.ts src/main/ia/cliente.ts src/main/ia/local-llm.ts
git commit -m "feat(ia): switch LLM surface from 30 atomic tools to 5 family tools"
```

---

### Task 10: Rewrite system prompt for 5 tools

**Files:**
- Modify: `src/main/ia/system-prompt.ts`

O system prompt precisa ensinar o modelo a usar 5 familias em vez de 30 tools atomicas.

- [ ] **Step 1: Replace the tools section in system prompt**

Find the section that describes individual tools (tool philosophy, workflows, examples). Replace with family-oriented instructions:

```
## Tools disponiveis

Voce tem 5 tools. Use-as com criterio — o contexto automatico ja traz a maioria das informacoes.

### 1. consultar_contexto
Consulta detalhada de qualquer entidade. Use SOMENTE quando o contexto nao tem a info ou voce precisa de filtros especificos.
Entidades: setor, colaborador, empresa, escala, regras, contrato, feriados, excecoes.

### 2. editar_ficha
Cria, atualiza ou remove registros. Cobre TUDO: colaboradores, excecoes, demandas, regras, postos, horarios, perfis.
- operacao: 'criar' (sem id) | 'atualizar' (com id) | 'remover' (com id)
- entidade: colaborador, setor, empresa, contrato, excecao, demanda, feriado, posto, regra, regra_horario, perfil_horario, horario_funcionamento

### 3. executar_acao
Acoes de dominio com side effects. Acoes disponiveis:
- gerar_escala: roda o motor OR-Tools
- oficializar: muda status para OFICIAL
- ajustar_celula: fixa alocacao de pessoa/dia
- ajustar_horario: muda horario de alocacao
- preflight: verifica se setor esta pronto pra gerar
- diagnosticar: revalida escala existente
- diagnosticar_infeasible: investiga por que geracao falhou
- explicar_violacao: explica regra CLT/CCT por codigo
- resumir_horas: KPI de horas por colaborador no periodo
- backup: cria snapshot
- resetar_regras: volta regras ao padrao
- cadastrar_lote: insercao em lote (ate 200)

### 4. salvar_memoria
Salva fato curto do RH (max 20 memorias).

### 5. remover_memoria
Remove memoria por ID.

## Regra de ouro sobre context vs tools

O contexto automatico JA TRAZ:
- Setor em foco (equipe, postos, demanda, excecoes)
- Preview de ciclo (cobertura por dia, deficit, folgas)
- Escala atual (status, violacoes, pode oficializar)
- Contratos com perfis de horario
- Alertas ativos
- Memorias do RH
- Feriados proximos

ANTES de chamar qualquer tool, verifique se a resposta ja esta no contexto.
Se estiver, responda direto. Se precisar de detalhe extra, use consultar_contexto.
```

- [ ] **Step 2: Remove old per-tool documentation**

Remove sections that describe individual tools by name (consultar, buscar_colaborador, criar, atualizar, etc.). These are now internal — the LLM doesn't need to know about them.

- [ ] **Step 3: Run typecheck**

```bash
npm run typecheck
```

- [ ] **Step 4: Commit**

```bash
git add src/main/ia/system-prompt.ts
git commit -m "feat(ia): rewrite system prompt for 5 tool families"
```

---

### Task 11: E2E regression + final verification

**Files:**
- Run: `tests/e2e/`
- Run: `npm run typecheck`
- Run: `npm run test`

- [ ] **Step 1: Run full typecheck**

```bash
npm run typecheck
```

Expected: 0 errors.

- [ ] **Step 2: Run unit tests**

```bash
npm run test
```

Expected: all pass (routing tests from Task 8 included).

- [ ] **Step 3: Build the app**

```bash
npm run build
```

Expected: successful build.

- [ ] **Step 4: Run E2E tests**

```bash
npm run test:e2e
```

Expected: smoke test passes. IA tests pass (may need API key).

- [ ] **Step 5: Manual smoke test**

```bash
npm run dev
```

Open app. Navigate to a setor. Open chat. Ask "a distribuicao de folgas esta boa?" — verify response uses preview data.

- [ ] **Step 6: Verify CLI parity**

```bash
npm run preview:cli -- 1 --context
```

Verify preview section shows corrected cobertura_media and worst-day caveat.

- [ ] **Step 7: Update CLAUDE.md tool counts**

In `.claude/CLAUDE.md`, find references to "30 tools" and "TOOL_SCHEMAS sincronizado com IA_TOOLS (30 entries)". Update:

```
# In the architecture section:
- **IA integrada** — Chat RH com 5 tools publicas (Vercel AI SDK + Gemini/OpenRouter + IA Local offline via node-llama-cpp)

# In the checklist:
- [ ] TOOL_SCHEMAS sincronizado com IA_TOOLS_PUBLIC (5 entries)
```

Also update the "Tools (30)" section header and count to reflect 5 public families.

- [ ] **Step 8: Update E2E helpers for family tool names**

In `tests/e2e/helpers/ia-chat.ts`, check for any hardcoded tool name sets (e.g., `IA_WRITE_TOOL_NAMES` or similar). Update to use family tool names:

```typescript
// OLD (if exists):
const WRITE_TOOLS = new Set(['criar', 'atualizar', 'deletar', ...])

// NEW:
const WRITE_TOOLS = new Set(['editar_ficha', 'executar_acao'])
```

Also update any E2E test assertions that check for specific atomic tool names (e.g., `expect(toolNames).toContain('salvar_memoria')` should still work since `salvar_memoria` remains as a family tool).

- [ ] **Step 9: Final commit**

```bash
git add -A
git commit -m "chore: update CLAUDE.md counts and E2E helpers for 5 tool families"
```

---

## Summary: Dependency Graph

```
Wave A (parallel):
  Task 1 (fix cobertura_media)
  Task 2 (fix CLI mensagemUsuario)
  Task 3 (fix preview narrative)

Wave B (requires Wave A):
  Task 4 (turn metadata emission)
  Task 5 (DOM metadata + E2E helper)  ← requires Task 4
  Task 6 (system prompt preview)
  Task 7 (E2E vertical slice)         ← requires Task 5

Wave C (requires Wave B):
  Task 8 (tool families adapter)
  Task 9 (switch LLM surface)         ← requires Task 8
  Task 10 (system prompt rewrite)     ← requires Task 9
  Task 11 (E2E regression)            ← requires Task 9 + 10
```

## Gate: Rollback criteria

Se apos Task 11 o comportamento piorar significativamente:
1. Reverter Task 9 (switch back to 30 tools in IA_TOOLS)
2. Manter Tasks 1-7 (bug fixes + observability sao valor permanente)
3. Manter Task 8 (adapter code fica disponivel para futura tentativa)

O codigo do adapter nao e destrutivo — os 30 handlers internos continuam intactos.
