# Redesign Tab Simulacao — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mostrar preview editavel do ciclo de folgas (Nivel 1) na tab Simulacao do SetorDetalhe, antes de rodar o solver, com garantia de que o padrao visto = padrao gerado.

**Architecture:** O preview usa gerarCicloFase1 (TS puro, instantaneo) convertido pro formato EscalaCicloResumo. Edicoes de F/V recalculam o preview. "Gerar Escala" salva F/V no banco (force) E passa pinned_folga_externo ao solver pra lacrar o padrao. Fixes de inconsistencia same-week sao pre-requisito.

**Tech Stack:** TypeScript (Electron main + React renderer), Python OR-Tools, PGlite

**Spec:** `docs/superpowers/specs/2026-03-13-redesign-tab-simulacao.md` (V3)

---

## Chunk 1: Fixes de inconsistencia (IC1-IC5)

Estes fixes sao independentes entre si e pre-requisito pro preview.

### Task 1: Fix folga-inference.ts — alinhar com same-week

**Files:**
- Modify: `src/shared/folga-inference.ts:71-73`

- [ ] **Step 1: Alterar offset de +1..+6 pra -6..-1**

```typescript
// ANTES (linhas 71-73):
for (let offset = 1; offset <= 6; offset += 1) {
  const next = new Date(sunday)
  next.setUTCDate(sunday.getUTCDate() + offset)
  const nextIso = utcDateToIso(next)
  if (statusByDate.get(nextIso) !== 'FOLGA') continue
  const day = diaSemanaFromIso(nextIso)

// DEPOIS:
for (let offset = -6; offset <= -1; offset += 1) {
  const prev = new Date(sunday)
  prev.setUTCDate(sunday.getUTCDate() + offset)
  const prevIso = utcDateToIso(prev)
  if (!statusByDate.has(prevIso)) continue  // dia fora do periodo
  if (statusByDate.get(prevIso) !== 'FOLGA') continue
  const day = diaSemanaFromIso(prevIso)
```

Renomear variavel `next` → `prev` e `nextIso` → `prevIso` no bloco inteiro (linhas 71-81).

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

---

### Task 2: Fix gerarHTMLFuncionario.ts — texto legacy

**Files:**
- Modify: `src/renderer/src/lib/gerarHTMLFuncionario.ts:198`

- [ ] **Step 1: Corrigir texto**

```typescript
// ANTES (linha 198):
'(V) ativa quando trabalhou domingo na semana anterior'

// DEPOIS:
'(V) ativa quando trabalhou domingo nesta semana'
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

---

### Task 3: Fix calcularCicloDomingo — incluir dia_semana=null

**Files:**
- Modify: `src/main/motor/solver-bridge.ts:174`

- [ ] **Step 1: Alterar filtro**

```typescript
// ANTES (linha 174):
const domDemandas = demandaRows.filter(d => d.dia_semana === 'DOM')

// DEPOIS:
const domDemandas = demandaRows.filter(d => d.dia_semana === 'DOM' || d.dia_semana === null)
```

- [ ] **Step 2: Rodar parity test**

```bash
npm run solver:test:parity
```

---

### Task 4: Fix FolgaSelect — restringir DOM na variavel

**Files:**
- Modify: `src/renderer/src/componentes/EscalaCicloResumo.tsx:154`

- [ ] **Step 1: Filtrar DOM quando field e variavel**

Procurar no componente FolgaSelect (linhas ~118-160) o bloco que renderiza os SelectItems:

```tsx
// ANTES:
{DIAS_ORDEM.map((dia) => (
  <SelectItem key={dia} value={dia} className="text-xs">{DIAS_CURTOS[dia]}</SelectItem>
))}

// DEPOIS:
{DIAS_ORDEM
  .filter(dia => field === 'folga_fixa_dia_semana' || dia !== 'DOM')
  .map((dia) => (
    <SelectItem key={dia} value={dia} className="text-xs">{DIAS_CURTOS[dia]}</SelectItem>
  ))}
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

---

### Task 5: Fix salvarPadraoFolgas — adicionar force param

**Files:**
- Modify: `src/main/tipc.ts` (handler colaboradoresSalvarPadraoFolgas)
- Modify: `src/renderer/src/servicos/colaboradores.ts` (servico)

- [ ] **Step 1: Adicionar force no handler IPC**

No handler `colaboradoresSalvarPadraoFolgas` em tipc.ts, alterar o input type:

```typescript
// ANTES:
.input<{
  padrao: Array<{
    colaborador_id: number
    folga_fixa_dia_semana: string | null
    folga_variavel_dia_semana: string | null
  }>
}>()

// DEPOIS:
.input<{
  padrao: Array<{
    colaborador_id: number
    folga_fixa_dia_semana: string | null
    folga_variavel_dia_semana: string | null
  }>
  force?: boolean
}>()
```

Na logica de merge, usar force:

```typescript
// ANTES:
const newFixa = existe.folga_fixa_dia_semana ?? item.folga_fixa_dia_semana
const newVar = existe.folga_variavel_dia_semana ?? item.folga_variavel_dia_semana

// DEPOIS:
const force = input.force ?? false
const newFixa = force ? item.folga_fixa_dia_semana : (existe.folga_fixa_dia_semana ?? item.folga_fixa_dia_semana)
const newVar = force ? item.folga_variavel_dia_semana : (existe.folga_variavel_dia_semana ?? item.folga_variavel_dia_semana)
```

- [ ] **Step 2: Atualizar servico renderer**

Em `src/renderer/src/servicos/colaboradores.ts`, no metodo `salvarPadraoFolgas`, aceitar e passar `force`:

```typescript
salvarPadraoFolgas: (padrao: Array<{...}>, force?: boolean) => {
  // ... mapping existente ...
  return client['colaboradores.salvarPadraoFolgas']({
    padrao: padrao.map(p => ({ ... })),
    force,
  }) as Promise<{ ok: boolean; count: number }>
},
```

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```

---

## Chunk 2: Engine de conversao e preview

### Task 6: gerarCicloFase1 — aceitar folgas_forcadas

**Files:**
- Modify: `src/shared/simula-ciclo.ts`

- [ ] **Step 1: Adicionar campo no interface**

```typescript
export interface SimulaCicloFase1Input {
  num_postos: number
  trabalham_domingo: number
  num_meses?: number
  preflight?: boolean
  /** F/V forcadas por posto (indice 0..N-1). null = auto decide. */
  folgas_forcadas?: Array<{
    folga_fixa_dia: number | null    // 0-5 (SEG-SAB) ou null
    folga_variavel_dia: number | null
  }>
}
```

- [ ] **Step 2: Usar folgas_forcadas no Step 2 (assign weekday offs)**

Na funcao `gerarCicloFase1`, no Step 2 (bloco que comeca com `// --- Step 2: Folgas semanais 5x2`), antes de atribuir folgas automaticamente, checar se `folgas_forcadas[p]` existe:

```typescript
for (let p = 0; p < N; p++) {
  const forcada = input.folgas_forcadas?.[p]
  const base1 = forcada?.folga_fixa_dia ?? (p % 6)
  const base2 = forcada?.folga_variavel_dia ?? ((p + 3) % 6)

  for (let w = 0; w < weeks; w++) {
    const sundayOff = grid[p][w * 7 + 6] === 'F'
    if (sundayOff) {
      grid[p][w * 7 + base1] = 'F'
    } else {
      grid[p][w * 7 + base1] = 'F'
      grid[p][w * 7 + base2] = 'F'
    }
  }
}
```

E ao construir o output, usar os valores forcados quando disponiveis:

```typescript
const folga_fixa_dia = forcada?.folga_fixa_dia ?? sorted[0]?.dia ?? 0
const folga_variavel_dia = forcada?.folga_variavel_dia ?? sorted[1]?.dia ?? null
```

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```

---

### Task 7: converterNivel1ParaEscala

**Files:**
- Modify: `src/shared/simula-ciclo.ts`

- [ ] **Step 1: Adicionar imports necessarios**

```typescript
import type { Escala, Alocacao, Colaborador, Funcao, DiaSemana, RegraHorarioColaborador } from './index'
```

Se ja tem imports parciais, adicionar os que faltam.

- [ ] **Step 2: Implementar funcao**

```typescript
const DIAS_IDX_TO_DIASEMANA: DiaSemana[] = ['SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB']

export function converterNivel1ParaEscala(
  output: SimulaCicloOutput,
  postosElegiveis: Array<{ funcao: Funcao; titular: Colaborador }>,
  setorId: number,
  periodo: { data_inicio: string; data_fim: string },
): { escala: Escala; alocacoes: Alocacao[]; regras: RegraHorarioColaborador[] } {
  const escala: Escala = {
    id: -1,
    setor_id: setorId,
    data_inicio: periodo.data_inicio,
    data_fim: periodo.data_fim,
    status: 'RASCUNHO',
    pontuacao: null,
    criada_em: new Date().toISOString(),
  }

  const alocacoes: Alocacao[] = []
  const regras: RegraHorarioColaborador[] = []
  let fakeAlocId = -1

  // Gerar datas do periodo
  const start = new Date(`${periodo.data_inicio}T00:00:00`)
  const end = new Date(`${periodo.data_fim}T00:00:00`)

  for (let rowIdx = 0; rowIdx < output.grid.length; rowIdx++) {
    const row = output.grid[rowIdx]
    const postoInfo = postosElegiveis[rowIdx]
    if (!postoInfo) continue

    const colabId = postoInfo.titular.id

    // Alocacoes: 1 por dia
    const cursor = new Date(start)
    let weekIdx = 0
    let dayIdx = 0
    while (cursor <= end) {
      const isoDate = cursor.toISOString().slice(0, 10)
      const semana = row.semanas[weekIdx]
      if (semana) {
        const diaStatus = semana.dias[dayIdx]
        alocacoes.push({
          id: fakeAlocId--,
          escala_id: -1,
          colaborador_id: colabId,
          data: isoDate,
          status: diaStatus === 'T' ? 'TRABALHO' : 'FOLGA',
          hora_inicio: null,
          hora_fim: null,
          minutos: null,
        })
      }
      dayIdx++
      if (dayIdx >= 7) { dayIdx = 0; weekIdx++ }
      cursor.setDate(cursor.getDate() + 1)
    }

    // Regra com F/V
    regras.push({
      id: -colabId,
      colaborador_id: colabId,
      dia_semana_regra: null,
      ativo: true,
      perfil_horario_id: null,
      inicio: null,
      fim: null,
      preferencia_turno_soft: null,
      folga_fixa_dia_semana: DIAS_IDX_TO_DIASEMANA[row.folga_fixa_dia] ?? null,
      folga_variavel_dia_semana: row.folga_variavel_dia != null
        ? DIAS_IDX_TO_DIASEMANA[row.folga_variavel_dia] ?? null
        : null,
    })
  }

  return { escala, alocacoes, regras }
}
```

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```

---

## Chunk 3: Integracao no SetorDetalhe

### Task 8: Preview automatico na tab Simulacao

**Files:**
- Modify: `src/renderer/src/paginas/SetorDetalhe.tsx`

- [ ] **Step 1: Adicionar imports**

```typescript
import { gerarCicloFase1, converterNivel1ParaEscala, sugerirK } from '@shared/simula-ciclo'
```

- [ ] **Step 2: Adicionar state pra preview e edicao**

Perto dos outros states de escala (linhas ~450-466):

```typescript
const [folgasEditadas, setFolgasEditadas] = useState<Map<number, { fixa: DiaSemana | null; variavel: DiaSemana | null }>>(new Map())
const [manualEditado, setManualEditado] = useState(false)
```

- [ ] **Step 3: Adicionar useMemo que gera o preview**

```typescript
const previewNivel1 = useMemo(() => {
  // So gera se: nao tem rascunho, nao ta carregando, setor e 5x2
  if (escalaCompleta || carregandoTabEscala) return null
  if (setor?.regime_escala !== '5X2') return null
  if (!funcoesList.length || !orderedColabs.length) return null

  const postosElegiveis = funcoesList
    .filter(f => f.ativo)
    .sort((a, b) => a.ordem - b.ordem)
    .map(f => {
      const titular = orderedColabs.find(c => c.funcao_id === f.id)
      return titular && titular.tipo_trabalhador !== 'INTERMITENTE'
        ? { funcao: f, titular }
        : null
    })
    .filter(Boolean) as Array<{ funcao: Funcao; titular: Colaborador }>

  if (postosElegiveis.length < 2) return null

  const N = postosElegiveis.length
  const kDom = Math.max(0, ...(demandas ?? [])
    .filter(d => d.dia_semana === 'DOM' || d.dia_semana === null)
    .map(d => d.min_pessoas))
  const K = kDom > 0 ? kDom : sugerirK(N)

  // Merge: regra persistida vence, auto preenche lacuna
  const DIAS_IDX: DiaSemana[] = ['SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB']
  const folgasForcadas = postosElegiveis.map(p => {
    const editada = folgasEditadas.get(p.titular.id)
    const regra = regrasPadrao?.find(r => r.colaborador_id === p.titular.id)

    const fixa = editada?.fixa ?? regra?.folga_fixa_dia_semana ?? null
    const variavel = editada?.variavel ?? regra?.folga_variavel_dia_semana ?? null

    return {
      folga_fixa_dia: fixa ? DIAS_IDX.indexOf(fixa) : null,
      folga_variavel_dia: variavel ? DIAS_IDX.indexOf(variavel as DiaSemana) : null,
    }
  })

  const output = gerarCicloFase1({
    num_postos: N,
    trabalham_domingo: K,
    preflight: true,
    folgas_forcadas: folgasForcadas.some(f => f.folga_fixa_dia != null || f.folga_variavel_dia != null)
      ? folgasForcadas
      : undefined,
  })

  if (!output.sucesso) return null

  return converterNivel1ParaEscala(output, postosElegiveis, setorId, periodoGeracao)
}, [escalaCompleta, carregandoTabEscala, setor, funcoesList, orderedColabs,
    demandas, regrasPadrao, folgasEditadas, periodoGeracao, setorId])
```

- [ ] **Step 4: Renderizar preview na tab simulacao**

No bloco `{escalaTab === 'simulacao' && (` (linhas ~2308+), substituir o bloco vazio
"Nenhuma simulacao gerada" pelo preview:

```tsx
{escalaCompleta ? (
  // ... resultado do solver (JA EXISTE) ...
) : previewNivel1 ? (
  <div className="space-y-3">
    <div className="flex flex-wrap items-center gap-2">
      <p className="text-sm font-semibold">Preview do Ciclo</p>
      <Badge variant="outline" className="text-xs">Nivel 1 — sem horarios</Badge>
      {manualEditado && (
        <Button variant="ghost" size="sm" className="h-6 gap-1 text-xs"
          onClick={() => { setFolgasEditadas(new Map()); setManualEditado(false) }}>
          <RotateCcw className="size-3" /> Recalcular
        </Button>
      )}
    </div>
    <EscalaCicloResumo
      escala={previewNivel1.escala}
      alocacoes={previewNivel1.alocacoes}
      colaboradores={orderedColabs}
      funcoes={funcoesList}
      regrasPadrao={previewNivel1.regras}
      onFolgaChange={(colabId, field, value) => {
        setFolgasEditadas(prev => {
          const next = new Map(prev)
          const current = next.get(colabId) ?? { fixa: null, variavel: null }
          if (field === 'folga_fixa_dia_semana') current.fixa = value
          else current.variavel = value as Exclude<DiaSemana, 'DOM'> | null
          next.set(colabId, current)
          return next
        })
        setManualEditado(true)
      }}
      viewMode={cicloMode}
    />
  </div>
) : (
  // fallback: setor 6x1 ou sem postos
  <div className="space-y-4 rounded-lg border border-dashed px-4 py-5">
    <p className="text-sm font-medium text-foreground">
      {setor?.regime_escala === '6X1'
        ? 'Preview de ciclo disponivel apenas para setores 5x2. Use Gerar Escala.'
        : 'Configure postos e demandas para ver o preview do ciclo.'}
    </p>
  </div>
)}
```

- [ ] **Step 5: Typecheck**

```bash
npm run typecheck
```

---

### Task 9: Gerar Escala com F/V do preview

**Files:**
- Modify: `src/renderer/src/paginas/SetorDetalhe.tsx` (handleGerar)
- Modify: `src/main/motor/solver-bridge.ts` (converter pinned por colab_id)

- [ ] **Step 1: Alterar handleGerar pra salvar F/V e montar pinned**

No `handleGerar` (linhas ~1173), antes de chamar `escalasService.gerar`, adicionar:

```typescript
// Salvar F/V no banco (force) se tem preview com dados
if (previewNivel1) {
  const DIAS_IDX: DiaSemana[] = ['SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB']
  const padrao = previewNivel1.regras.map(r => ({
    colaborador_id: r.colaborador_id,
    folga_fixa_dia: r.folga_fixa_dia_semana ? DIAS_IDX.indexOf(r.folga_fixa_dia_semana) : 0,
    folga_variavel_dia: r.folga_variavel_dia_semana
      ? DIAS_IDX.indexOf(r.folga_variavel_dia_semana as DiaSemana)
      : null,
  }))
  await colaboradoresService.salvarPadraoFolgas(padrao, true)
  await reloadRegrasPadrao()
}
```

E passar pinned pro solver (converter alocacoes fake em pinned_folga_externo):

```typescript
// Montar pinned_folga_externo do preview
let pinnedFolgaExterno: Array<{ c: number; d: number; band: number }> | undefined
if (previewNivel1) {
  // Map colaborador_id → c_index (bridge ordena por rank DESC)
  const colabOrdenados = [...orderedColabs]
    .filter(c => c.tipo_trabalhador !== 'INTERMITENTE')
    .sort((a, b) => b.rank - a.rank)
  const colabIdToIdx = new Map(colabOrdenados.map((c, i) => [c.id, i]))

  // Map data → d_index
  const start = new Date(`${periodoGeracao.data_inicio}T00:00:00`)
  const datasMap = new Map<string, number>()
  const cursor = new Date(start)
  let dIdx = 0
  while (cursor.toISOString().slice(0, 10) <= periodoGeracao.data_fim) {
    datasMap.set(cursor.toISOString().slice(0, 10), dIdx++)
    cursor.setDate(cursor.getDate() + 1)
  }

  pinnedFolgaExterno = previewNivel1.alocacoes
    .filter(a => colabIdToIdx.has(a.colaborador_id))
    .map(a => ({
      c: colabIdToIdx.get(a.colaborador_id)!,
      d: datasMap.get(a.data) ?? -1,
      band: a.status === 'TRABALHO' ? 3 : 0,  // 3=INTEGRAL, 0=OFF
    }))
    .filter(p => p.d >= 0)
}

const result = await escalasService.gerar(setorId, {
  data_inicio: periodoGeracao.data_inicio,
  data_fim: periodoGeracao.data_fim,
  solveMode: solverSessionConfig.solveMode,
  maxTimeSeconds: solverSessionConfig.maxTimeSeconds,
  rulesOverride,
  pinnedFolgaExterno,
})
```

- [ ] **Step 2: Limpar state do preview apos Gerar**

Depois de `setEscalaCompleta(result)`:

```typescript
setFolgasEditadas(new Map())
setManualEditado(false)
```

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```

---

### Task 10: Verificacao final

- [ ] **Step 1: Typecheck completo**

```bash
npm run typecheck
```

- [ ] **Step 2: Parity test**

```bash
npm run solver:test:parity
```

- [ ] **Step 3: Rule policy test**

```bash
npx vitest run tests/main/rule-policy.spec.ts
```

- [ ] **Step 4: Teste visual**

```bash
npm run dev
```

Abrir setor Acougue (5 postos CLT 44h):
1. Verificar que grid do Nivel 1 aparece automaticamente na tab Simulacao
2. Editar Variavel de um colaborador → grid recalcula
3. Clicar "Recalcular" → volta pro auto
4. Clicar "Gerar Escala" → solver roda com padrao do preview
5. Comparar T/F do resultado com o que estava no preview
6. Oficializar → persiste
7. Descartar → volta pro preview

---

## Dependencias entre tasks

```
Tasks 1-5 (Fixes IC1-IC5) ── independentes entre si, fazer em paralelo
    │
    └── Tasks 6-7 (Engine) ── dependem de IC resolvidos
         │
         └── Tasks 8-9 (UI) ── dependem do engine
              │
              └── Task 10 (Verificacao) ── depende de tudo
```

## Notas pra implementadores

- Ler `CLAUDE.md` e `docs/BUILD_CICLO_V3_FONTE_UNICA.md` antes de comecar
- Spec completa: `docs/superpowers/specs/2026-03-13-redesign-tab-simulacao.md`
- snake_case ponta a ponta
- Se tocar em solver-bridge.ts ou constraints.py: rodar `npm run solver:test:parity`
- Layout Contract: NAO adicionar `overflow-y-auto` em paginas
- Setores 6X1: fora do escopo — preview nao aparece, so o fluxo normal de Gerar
