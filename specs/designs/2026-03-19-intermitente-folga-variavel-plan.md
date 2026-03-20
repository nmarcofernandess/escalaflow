# Intermitente Folga Variavel — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que intermitentes tenham `folga_variavel` e participem do ciclo de domingo (tipo B), mantendo tipo A (fixo) inalterado.

**Architecture:** Detectar tipo A vs B pela presenca de `folga_variavel_dia_semana`. Remover guards que forcam NULL, condicionar constraints do solver por tipo, injetar rows tipo B no preview com XOR. Sem campo novo no banco.

**Tech Stack:** TypeScript (Electron main + renderer), Python OR-Tools (solver), Vitest (testes)

**Spec:** `specs/designs/2026-03-19-intermitente-folga-variavel-design.md`

---

## Task 1: Tipos e Helpers de Deteccao

**Files:**
- Modify: `src/main/motor/validacao-compartilhada.ts:25-40`
- Modify: `src/shared/sunday-cycle.ts`
- Modify: `src/shared/index.ts`
- Test: `tests/shared/sunday-cycle-helpers.spec.ts` (novo)

- [ ] **Step 1: Escrever teste dos helpers**

```typescript
// tests/shared/sunday-cycle-helpers.spec.ts
import { describe, it, expect } from 'vitest'

describe('isIntermitenteTipoA / isIntermitenteTipoB', () => {
  const load = async () => import('@shared/sunday-cycle')

  it('CLT nao e tipo A nem tipo B', async () => {
    const { isIntermitenteTipoA, isIntermitenteTipoB } = await load()
    const clt = { tipo_trabalhador: 'CLT', folga_variavel_dia_semana: 'SEG' as const }
    expect(isIntermitenteTipoA(clt)).toBe(false)
    expect(isIntermitenteTipoB(clt)).toBe(false)
  })

  it('intermitente sem folga_variavel e tipo A', async () => {
    const { isIntermitenteTipoA, isIntermitenteTipoB } = await load()
    const tipoA = { tipo_trabalhador: 'INTERMITENTE', folga_variavel_dia_semana: null }
    expect(isIntermitenteTipoA(tipoA)).toBe(true)
    expect(isIntermitenteTipoB(tipoA)).toBe(false)
  })

  it('intermitente com folga_variavel e tipo B', async () => {
    const { isIntermitenteTipoA, isIntermitenteTipoB } = await load()
    const tipoB = { tipo_trabalhador: 'INTERMITENTE', folga_variavel_dia_semana: 'SEG' as const }
    expect(isIntermitenteTipoA(tipoB)).toBe(false)
    expect(isIntermitenteTipoB(tipoB)).toBe(true)
  })

  it('undefined tipo_trabalhador default CLT', async () => {
    const { isIntermitenteTipoA } = await load()
    expect(isIntermitenteTipoA({ folga_variavel_dia_semana: null })).toBe(false)
  })

  it('undefined folga_variavel_dia_semana = tipo A', async () => {
    const { isIntermitenteTipoA } = await load()
    expect(isIntermitenteTipoA({ tipo_trabalhador: 'INTERMITENTE' })).toBe(true)
  })
})
```

- [ ] **Step 2: Rodar teste — deve falhar**

Run: `npx vitest run tests/shared/sunday-cycle-helpers.spec.ts`
Expected: FAIL — `isIntermitenteTipoA` nao existe

- [ ] **Step 3: Implementar helpers em sunday-cycle.ts**

Adicionar import de `DiaSemana` no topo do arquivo (se nao existir) e as funcoes no final de `src/shared/sunday-cycle.ts`:

```typescript
import type { DiaSemana } from './constants'  // adicionar ao import existente se necessario

/** Intermitente tipo A: dias fixos, sem rotacao, sem folga_variavel */
export function isIntermitenteTipoA(colab: {
  tipo_trabalhador?: string
  folga_variavel_dia_semana?: DiaSemana | null
}): boolean {
  return (colab.tipo_trabalhador ?? 'CLT') === 'INTERMITENTE'
    && !colab.folga_variavel_dia_semana
}

/** Intermitente tipo B: dias ativos + folga variavel + ciclo domingo */
export function isIntermitenteTipoB(colab: {
  tipo_trabalhador?: string
  folga_variavel_dia_semana?: DiaSemana | null
}): boolean {
  return (colab.tipo_trabalhador ?? 'CLT') === 'INTERMITENTE'
    && !!colab.folga_variavel_dia_semana
}
```

- [ ] **Step 4: Adicionar `folga_variavel_dia_semana` a `ColabMotor`**

Em `src/main/motor/validacao-compartilhada.ts`, na interface `ColabMotor` (linhas 25-40), adicionar apos `folga_fixa_dia_semana`:

```typescript
  folga_variavel_dia_semana?: DiaSemana | null
```

- [ ] **Step 5: Exportar helpers em index.ts**

Em `src/shared/index.ts`, adicionar ao re-export de sunday-cycle (se nao esta automatico):

```typescript
export { isIntermitenteTipoA, isIntermitenteTipoB } from './sunday-cycle'
```

- [ ] **Step 6: Rodar testes — devem passar**

Run: `npx vitest run tests/shared/sunday-cycle-helpers.spec.ts`
Expected: PASS (5 testes)

Run: `npm run typecheck`
Expected: 0 erros

- [ ] **Step 7: Commit**

```bash
git add src/shared/sunday-cycle.ts src/shared/index.ts src/main/motor/validacao-compartilhada.ts tests/shared/sunday-cycle-helpers.spec.ts
git commit -m "feat: add isIntermitenteTipoA/B helpers + ColabMotor folga_variavel field"
```

---

## Task 2: Guard de Persistencia (tipc.ts)

**Files:**
- Modify: `src/main/tipc.ts:2429-2450`

**Nota:** Este task nao tem teste unitario isolado — a validacao real depende de banco rodando. O guard T5 sera testado end-to-end no Task 8.

- [ ] **Step 1: Remover force NULL da folga_variavel pra intermitente**

Em `src/main/tipc.ts`, linhas ~2436-2442, mudar:

```typescript
// ANTES:
    const folgaVariavel = isDiaEspecifico
      ? null
      : (isIntermitente
          ? null
          : hasOwnField(input, 'folga_variavel_dia_semana')
          ? (input.folga_variavel_dia_semana ?? null)
          : (existe?.folga_variavel_dia_semana ?? null))

// DEPOIS:
    const folgaVariavel = isDiaEspecifico
      ? null
      : (hasOwnField(input, 'folga_variavel_dia_semana')
          ? (input.folga_variavel_dia_semana ?? null)
          : (existe?.folga_variavel_dia_semana ?? null))
```

**IMPORTANTE:** `folga_fixa` continua forcada a NULL pra intermitente — NAO mexer nesse guard.

- [ ] **Step 2: Adicionar guard T5 — folga_variavel deve apontar pra dia com regra ativa**

Apos a atribuicao de `folgaVariavel` (aprox. linha 2443), ANTES do INSERT/UPDATE, adicionar:

```typescript
    // Guard T5: intermitente com folga_variavel precisa ter regra ativa nesse dia
    if (isIntermitente && folgaVariavel != null && !isDiaEspecifico) {
      const regraExiste = await db.query(
        `SELECT 1 FROM colaborador_regra_horario
         WHERE colaborador_id = $1 AND dia_semana_regra = $2 AND ativo = true
         LIMIT 1`,
        [input.colaborador_id, folgaVariavel],
      )
      if (regraExiste.rows.length === 0) {
        throw new Error(
          `Folga variavel '${folgaVariavel}' invalida: intermitente nao tem regra ativa para esse dia. `
          + `Cadastre a regra de horario para ${folgaVariavel} antes.`,
        )
      }
    }
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: 0 erros

- [ ] **Step 4: Commit**

```bash
git add src/main/tipc.ts
git commit -m "feat: allow folga_variavel for intermitente + guard T5 (day must have active rule)"
```

---

## Task 3: Solver Bridge — Tipo B no Pool + Sunday Cycle

**Files:**
- Modify: `src/main/motor/solver-bridge.ts:187-218, 575-606`

**NOTA CRITICA:** As funcoes `contarIntermitentesGarantidosNoDomingo` e o filtro `nDom` estao em `src/main/motor/solver-bridge.ts` (NAO em sunday-cycle.ts). O validador importa `calcularCicloDomingo` deste mesmo arquivo, entao as mudancas propagam automaticamente pro validador.

- [ ] **Step 1: Atualizar `contarIntermitentesGarantidosNoDomingo` na bridge**

Em `src/main/motor/solver-bridge.ts`, localizar `contarIntermitentesGarantidosNoDomingo` (~linha 187). Mudar pra contar APENAS tipo A:

```typescript
// ANTES:
return colabRows.reduce((count, colab) => {
  if ((colab.tipo_trabalhador ?? 'CLT') !== 'INTERMITENTE') return count
  const regraDomingo = regraGroupByColab.get(colab.id)?.dias.get('DOM')
  return count + (hasGuaranteedSundayWindow(regraDomingo) ? 1 : 0)
}, 0)

// DEPOIS:
return colabRows.reduce((count, colab) => {
  if ((colab.tipo_trabalhador ?? 'CLT') !== 'INTERMITENTE') return count
  // Tipo B (com folga_variavel) entra no pool rotativo — nao conta como garantido
  const padrao = regraGroupByColab.get(colab.id)?.padrao
  if (padrao?.folga_variavel_dia_semana) return count
  const regraDomingo = regraGroupByColab.get(colab.id)?.dias.get('DOM')
  return count + (hasGuaranteedSundayWindow(regraDomingo) ? 1 : 0)
}, 0)
```

**NOTA:** `colabRows` nao tem `folga_variavel_dia_semana` diretamente — buscar da regra padrao via `regraGroupByColab`.

- [ ] **Step 2: Atualizar filtro nDom na bridge**

Em `src/main/motor/solver-bridge.ts`, localizar filtro `nDom` (~linha 207). Mudar:

```typescript
// ANTES:
if ((c.tipo_trabalhador ?? 'CLT') === 'INTERMITENTE') return false

// DEPOIS:
// Tipo A: fora do pool. Tipo B (com folga_variavel na regra padrao): entra no pool.
if ((c.tipo_trabalhador ?? 'CLT') === 'INTERMITENTE') {
  const padrao = regraGroupByColab.get(c.id)?.padrao
  if (!padrao?.folga_variavel_dia_semana) return false  // Tipo A: excluir
  // Tipo B: continua no pool
}
```

- [ ] **Step 3: Permitir folga_variavel na regra padrao do intermitente**

Em `src/main/motor/solver-bridge.ts`, linhas ~575-578:

```typescript
// ANTES:
if (padrao && c.tipo_trabalhador !== 'INTERMITENTE') {
  c.folga_fixa_dia_semana = ...
  c.folga_variavel_dia_semana = ...
}

// DEPOIS:
if (padrao) {
  // folga_fixa: continua NULL pra intermitente (guard no tipc.ts ja impede persistencia)
  if (c.tipo_trabalhador !== 'INTERMITENTE') {
    c.folga_fixa_dia_semana = (padrao.folga_fixa_dia_semana as DiaSemana | null) ?? null
  }
  // folga_variavel: permitida pra tipo B
  c.folga_variavel_dia_semana = (padrao.folga_variavel_dia_semana as DiaSemana | null) ?? null
}
```

- [ ] **Step 4: Ajustar dias_trabalho pra tipo B**

Em `src/main/motor/solver-bridge.ts`, linhas ~580-588:

```typescript
// ANTES:
if (c.tipo_trabalhador === 'INTERMITENTE') {
  c.dias_trabalho = group?.dias.size ?? 0
  if (c.dias_trabalho === 0) {
    console.warn(...)
  }
}

// DEPOIS:
if (c.tipo_trabalhador === 'INTERMITENTE') {
  c.dias_trabalho = group?.dias.size ?? 0
  // Tipo B: XOR desconta 1 dia (variavel ativa = nao trabalha nesse dia quando trabalha DOM)
  if (c.folga_variavel_dia_semana && c.dias_trabalho > 0) {
    c.dias_trabalho -= 1
  }
  if (c.dias_trabalho === 0) {
    console.warn(...)
  }
}
```

- [ ] **Step 5: Tipo B entra no pool rotativo do ciclo domingo**

Em `src/main/motor/solver-bridge.ts`, linhas ~593-606:

```typescript
// ANTES:
for (const c of colaboradores) {
  if (c.tipo_trabalhador === 'INTERMITENTE') continue

// DEPOIS:
for (const c of colaboradores) {
  // Tipo A (sem folga_variavel): fora do pool
  if (c.tipo_trabalhador === 'INTERMITENTE' && !c.folga_variavel_dia_semana) continue
```

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: 0 erros

- [ ] **Step 7: Commit**

```bash
git add src/main/motor/solver-bridge.ts
git commit -m "feat: solver bridge — tipo B intermitente enters sunday cycle pool with adjusted dias_trabalho"
```

---

## Task 4: Solver Python — Guards Condicionais + Belt-and-Suspenders

**Files:**
- Modify: `solver/constraints.py` (4 guards)
- Modify: `solver/solver_ortools.py` (belt-and-suspenders — variaveis `work` sao criadas aqui)

- [ ] **Step 1: Guard `add_folga_variavel_condicional` (XOR)**

Em `solver/constraints.py`, localizar `add_folga_variavel_condicional`, achar o guard INTERMITENTE:

```python
# ANTES:
if colabs[c].get("tipo_trabalhador", "CLT") == "INTERMITENTE":
    continue

# DEPOIS:
if colabs[c].get("tipo_trabalhador", "CLT") == "INTERMITENTE" \
   and not colabs[c].get("folga_variavel_dia_semana"):
    continue  # Tipo A: pular XOR
```

- [ ] **Step 2: Guard `add_dom_max_consecutivo`**

Mesma mudanca:

```python
# ANTES:
if colabs[c].get("tipo_trabalhador", "CLT") == "INTERMITENTE":
    continue

# DEPOIS:
if colabs[c].get("tipo_trabalhador", "CLT") == "INTERMITENTE" \
   and not colabs[c].get("folga_variavel_dia_semana"):
    continue  # Tipo A: pular dom max consecutivo
```

- [ ] **Step 3: Guard `add_domingo_ciclo_soft` (S_DOMINGO_CICLO)**

Mesma mudanca na funcao `add_domingo_ciclo_exato` (penalidade SOFT de ciclo domingo).

- [ ] **Step 4: Guard `add_domingo_ciclo_hard`**

Mesma mudanca na funcao `add_domingo_ciclo_hard` (constraint HARD de ciclo domingo).

- [ ] **Step 5: Belt-and-suspenders — forcar work=0 em dias sem regra**

**ATENCAO:** As variaveis `work` sao criadas em `solver/solver_ortools.py`, NAO em `constraints.py`. Adicionar o belt-and-suspenders em `solver_ortools.py` APOS a criacao das variaveis `work` e ANTES de chamar as constraints:

```python
# Belt-and-suspenders: intermitente NUNCA trabalha em dia sem regra
# mesmo se alguma constraint for relaxada num pass posterior
for c in range(C):
    if colabs[c].get("tipo_trabalhador", "CLT") == "INTERMITENTE":
        for d in range(D):
            key = (c, d)
            regra_dia = regras_colaborador_dia.get(key, {})
            if regra_dia.get("folga_fixa", False):
                model.Add(work[(c, d)] == 0)
```

**NOTA:** Verificar se `add_folga_fixa_5x2` em `constraints.py` ja forca `work=0` pra dias com `folga_fixa=true`. Se sim, o belt-and-suspenders e garantia ADICIONAL — nao substituta. O belt-and-suspenders garante que mesmo se `add_folga_fixa_5x2` for desligada/relaxada, o intermitente ainda nao trabalha.

- [ ] **Step 6: Commit**

```bash
git add solver/constraints.py solver/solver_ortools.py
git commit -m "feat: solver constraints — conditional guards for tipo B intermitente + belt-and-suspenders"
```

---

## Task 5: Validador TS — Guard Dia Sem Regra + Wiring folga_variavel

**Files:**
- Modify: `src/main/motor/validador.ts`
- Test: `tests/main/validador-intermitente.spec.ts` (novo)

**NOTA CRITICA:** O validador atualmente NAO consulta `folga_variavel_dia_semana` no banco. A interface `RegraHorarioColab` (validador.ts ~linha 67) e o SELECT (~linha 139) precisam ser atualizados.

- [ ] **Step 1: Adicionar `folga_variavel_dia_semana` ao SELECT e tipo do validador**

Em `src/main/motor/validador.ts`:

1. Na interface `RegraHorarioColab` (~linha 67), adicionar:
```typescript
  folga_variavel_dia_semana: DiaSemana | null
```

2. No SELECT que popula as regras (~linha 139), adicionar a coluna:
```sql
SELECT colaborador_id, dia_semana_regra, folga_fixa_dia_semana, folga_variavel_dia_semana, ...
```

3. Na construcao de `ColabMotor[]` (~linha 218-241), popular o campo:
```typescript
folga_variavel_dia_semana: regrasPadrao?.folga_variavel_dia_semana ?? null
```

- [ ] **Step 2: Escrever teste pra validacao dia sem regra**

```typescript
// tests/main/validador-intermitente.spec.ts
import { describe, it, expect } from 'vitest'

describe('validador — intermitente dia sem regra', () => {
  it('deve gerar violacao HARD se intermitente alocado em dia sem regra', () => {
    // Montar input minimo com intermitente alocado num dia sem regra ativa
    // Chamar funcao de validacao
    // Esperar violacao HARD com codigo H_INTERMITENTE_DIA_SEM_REGRA
  })

  it('nao deve gerar violacao se intermitente alocado em dia COM regra', () => {
    // Montar input com intermitente alocado num dia com regra
    // Esperar 0 violacoes desse tipo
  })
})
```

**NOTA:** A estrutura exata depende de como `validarEscalaV3` e chamada — adaptar imports e setup conforme o arquivo real.

- [ ] **Step 3: Implementar guard no validador**

Localizar onde checks HARD rodam no validador. Adicionar check pra intermitente:

```typescript
// Em validarEscalaV3 ou funcao equivalente, apos os checks existentes:
for (const c of colabs) {
  if ((c.tipo_trabalhador ?? 'CLT') !== 'INTERMITENTE') continue
  const regrasDoColab = regraGroupByColab?.get(c.id)
  if (!regrasDoColab) continue

  for (const aloc of alocacoesDoColab) {
    if (aloc.status !== 'TRABALHO') continue
    const dia = diaSemanaFromDate(aloc.data)
    if (!regrasDoColab.dias.has(dia)) {
      violacoes.push({
        codigo: 'H_INTERMITENTE_DIA_SEM_REGRA',
        severidade: 'HARD',
        colaborador_id: c.id,
        data: aloc.data,
        mensagem: `Intermitente ${c.nome} alocado em ${dia} sem regra ativa`,
      })
    }
  }
}
```

- [ ] **Step 4: Rodar teste e typecheck**

Run: `npx vitest run tests/main/validador-intermitente.spec.ts`
Expected: PASS

Run: `npm run typecheck`
Expected: 0 erros

- [ ] **Step 5: Commit**

```bash
git add src/main/motor/validador.ts tests/main/validador-intermitente.spec.ts
git commit -m "feat: validator — wire folga_variavel + HARD violation for intermitente on day without rule"
```

---

## Task 6: Preview — Tipo B no Grid com XOR

**Files:**
- Modify: `src/renderer/src/paginas/SetorDetalhe.tsx:1085-1097, 1113-1123, 1446-1479`

- [ ] **Step 1: Enriquecer `previewSetorIntermitentesRegras` com folgaVariavel e ehTipoB**

Em `src/renderer/src/paginas/SetorDetalhe.tsx`, linhas ~1085-1097. O loop existente ja percorre `regrasDoColab` — adicionar captura de `folgaVariavel` DENTRO do loop:

```typescript
// ANTES (no .map):
const regrasPorDia = new Map<DiaSemana, RegraHorarioColaborador>()
for (const regra of regrasDoColab) {
  if (regra.dia_semana_regra != null) regrasPorDia.set(regra.dia_semana_regra, regra)
}
return { colaborador, funcao, regrasPorDia }

// DEPOIS:
const regrasPorDia = new Map<DiaSemana, RegraHorarioColaborador>()
let folgaVariavel: DiaSemana | null = null
for (const regra of regrasDoColab) {
  if (regra.dia_semana_regra != null) regrasPorDia.set(regra.dia_semana_regra, regra)
  if (regra.dia_semana_regra === null && regra.folga_variavel_dia_semana) {
    folgaVariavel = regra.folga_variavel_dia_semana
  }
}
return { colaborador, funcao, regrasPorDia, folgaVariavel, ehTipoB: folgaVariavel != null }
```

- [ ] **Step 2: Atualizar `previewSetorIntermitentesDomingoGarantidos` pra excluir tipo B**

Em `src/renderer/src/paginas/SetorDetalhe.tsx`, linhas ~1113-1123:

```typescript
// DEPOIS:
const previewSetorIntermitentesDomingoGarantidos = useMemo(
  () => previewSetorIntermitentesRegras
    .filter(({ ehTipoB }) => !ehTipoB)  // Apenas tipo A
    .filter(({ regrasPorDia }) => regrasPorDia.has('DOM'))
    .length,
  [previewSetorIntermitentesRegras],
)
```

- [ ] **Step 3: Gerar rows tipo B com XOR no `simulacaoGridData`**

No bloco que constroi `intermitentesRows` (linhas ~1446-1462), tornar condicional:

```typescript
const intermitentesRows: CicloGridRow[] = previewSetorIntermitentesRegras.map(
  ({ colaborador, funcao, regrasPorDia, folgaVariavel, ehTipoB }) => {
    if (!ehTipoB) {
      // TIPO A: padrao fixo (codigo existente)
      const semanaBase: Simbolo[] = DIAS_ORDEM.map((dia) => {
        if (regrasPorDia.has(dia)) return dia === 'DOM' ? 'DT' as Simbolo : 'T' as Simbolo
        return 'NT' as Simbolo
      })
      return {
        id: colaborador.id,
        nome: colaborador.nome,
        posto: funcao.apelido,
        fixa: null,
        variavel: null,
        blocked: true,
        semanas: Array.from({ length: numSemanas }, () => [...semanaBase]),
      }
    }

    // TIPO B: XOR — usar ciclo do grid pra determinar DT/DF
    // Heuristica: usar cobertura CLT vs demanda pra decidir se intermitente trabalha DOM
    const semanas: Simbolo[][] = Array.from({ length: numSemanas }, (_, semIdx) => {
      const coberturaDOM = grid.cobertura[semIdx]?.[6] ?? 0
      const demandaDOM = grid.demanda[6] ?? 0
      const trabalhaDOM = coberturaDOM < demandaDOM

      return DIAS_ORDEM.map((dia) => {
        if (!regrasPorDia.has(dia)) return 'NT' as Simbolo
        if (dia === 'DOM') return trabalhaDOM ? 'DT' as Simbolo : 'DF' as Simbolo
        if (dia === folgaVariavel) {
          return trabalhaDOM ? 'FV' as Simbolo : 'T' as Simbolo
        }
        return 'T' as Simbolo
      }) as Simbolo[]
    })

    return {
      id: colaborador.id,
      nome: colaborador.nome,
      posto: funcao.apelido,
      fixa: null,
      variavel: folgaVariavel,
      blocked: true,
      semanas,
    }
  },
)
```

**NOTA sobre heuristica:** A heuristica `coberturaDOM < demandaDOM` e uma aproximacao. O solver usa ciclo domingo com sliding window (ex: 2/1 = trabalha 2 domingos, folga 1). O preview pode divergir em padroes exatos, mas o resultado final vem do solver. Se a heuristica produzir resultados visivelmente errados, refinar usando `cicloTrabalho`/`cicloFolga` de `calcularCicloDomingo`.

- [ ] **Step 4: Atualizar cobertura baseada nas rows geradas (respeita XOR)**

```typescript
// DEPOIS (soma baseada nas rows geradas — respeita XOR):
const coberturaAjustada = grid.cobertura.map((cobSemana, semIdx) => {
  return cobSemana.map((cob, diaIdx) => {
    const intermitentesTrabalham = intermitentesRows.filter((row) => {
      const simbolo = row.semanas[semIdx]?.[diaIdx]
      return simbolo === 'T' || simbolo === 'DT'
    }).length
    return cob + intermitentesTrabalham
  })
})
```

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: 0 erros

- [ ] **Step 6: Teste visual**

Run: `npm run dev`
Abrir setor com intermitente tipo B (Maria Clara com folga_variavel=SEG, regras SEG+DOM).
Verificar:
- Maria Clara aparece no grid
- Dias sem regra = NT
- DOM alterna DT/DF conforme cobertura
- SEG alterna T/FV (inverso do DOM)
- Cobertura soma corretamente

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/paginas/SetorDetalhe.tsx
git commit -m "feat: preview grid — tipo B intermitente with XOR rotation and NT days"
```

---

## Task 7: Testes de Paridade

**Files:**
- Create: `tests/main/solver-intermitente-tipo-b.spec.ts`

**NOTA:** Usar padroes de `tests/main/solver-intermitente-domingo.spec.ts` como referencia (ja tem `buildInput()` e `runSolver()` de infraestrutura).

- [ ] **Step 1: T1 — Tipo A, 3 dias ativos**

```typescript
describe('T1: intermitente tipo A — dias fixos', () => {
  it('solver nao aloca trabalho fora dos dias com regra', async () => {
    // Setup: intermitente com regras TER, QUI, SAB (sem folga_variavel)
    // Rodar solver
    // Verificar: SEG, QUA, SEX, DOM = FOLGA
    // Verificar: TER, QUI, SAB = TRABALHO
  })
})
```

- [ ] **Step 2: T2 — Tipo B com XOR**

```typescript
describe('T2: intermitente tipo B — XOR SEG/DOM', () => {
  it('trabalha DOM → folga SEG, nao trabalha DOM → trabalha SEG', async () => {
    // Setup: intermitente com regras SEG+DOM, folga_variavel=SEG
    // Rodar solver por 4 semanas
    // Para CADA semana: assert DOM_trabalho + SEG_trabalho == 1 (XOR)
    // assert pelo menos 1 domingo com TRABALHO e 1 com FOLGA (ciclo)
  })
})
```

- [ ] **Step 3: T3 — Tipo A + Tipo B no mesmo setor**

```typescript
describe('T3: tipo A e tipo B coexistem', () => {
  it('tipo A fixo, tipo B rotativo, cobertura soma correta', async () => {
    // Setup: 3 CLTs + 1 tipo A (TER/QUI) + 1 tipo B (SEG/DOM, variavel=SEG)
    // Rodar solver
    // Tipo A: TER e QUI = TRABALHO, resto = FOLGA (em TODAS as semanas)
    // Tipo B: XOR SEG/DOM (em CADA semana, nunca ambos TRABALHO)
  })
})
```

- [ ] **Step 4: T4 — Tipo B com variavel=QUA (combinacao diferente)**

```typescript
describe('T4: tipo B com variavel diferente de SEG', () => {
  it('XOR funciona com variavel=QUA e DOM ativo', async () => {
    // Setup: intermitente com regras QUA+DOM, folga_variavel=QUA
    // Rodar solver
    // Para CADA semana: assert DOM_trabalho + QUA_trabalho == 1
  })
})
```

- [ ] **Step 5: T8 — Multi-pass com tipo B respeita NT**

```typescript
describe('T8: multi-pass respeita NT', () => {
  it('mesmo relaxando constraints, intermitente nunca trabalha dia sem regra', async () => {
    // Setup que force multi-pass (demanda alta, poucos CLTs)
    // Tipo B com 2 dias ativos (SEG+DOM)
    // Verificar: em TODAS as alocacoes, dias != SEG e != DOM = FOLGA (nunca TRABALHO)
  })
})
```

- [ ] **Step 6: T9 — Validador concorda com solver pra tipo B**

```typescript
describe('T9: validador aceita output do solver com tipo B', () => {
  it('zero violacoes HARD na escala gerada pelo solver', async () => {
    // Setup: 3 CLTs + 1 tipo B (SEG/DOM, variavel=SEG)
    // Rodar solver
    // Passar output pro validador
    // assert violacoes_hard === 0
  })
})
```

- [ ] **Step 7: T11 — Tipo B com 7 dias ativos**

```typescript
describe('T11: tipo B com todos os dias ativos', () => {
  it('comporta como CLT — XOR normal, dias_trabalho=6', async () => {
    // Setup: intermitente com regras todos os 7 dias + folga_variavel=SEG
    // Rodar solver
    // Verificar: XOR funciona, dias_trabalho efetivo = 6
    // Verificar: nenhum dia bloqueado (todos tem regra)
  })
})
```

- [ ] **Step 8: Rodar todos os testes**

Run: `npx vitest run tests/main/solver-intermitente-tipo-b.spec.ts`
Expected: PASS todos

- [ ] **Step 9: Commit**

```bash
git add tests/main/solver-intermitente-tipo-b.spec.ts
git commit -m "test: parity tests for intermitente tipo B — XOR, multi-pass, coexistence, validator agreement"
```

---

## Checklist de Paridade Plano vs Spec

| Spec Section | Plano Task | Coberto? |
|--------------|-----------|----------|
| 2A: Guard persistencia | Task 2 | ✅ Remove force NULL + guard T5 |
| 2A: persistFolgaPatterns | Task 2 nota | ✅ Documentado (sem mudanca) |
| 2B: Bridge folga_variavel | Task 3 step 3 | ✅ |
| 2B: dias_trabalho tipo B | Task 3 step 4 | ✅ Desconta 1 |
| 2B: Pool rotativo | Task 3 step 5 | ✅ Condicional por folga_variavel |
| 2B: Guard D14 | Confirmado safe | ✅ Ja tem `!isIntermitente` |
| 2C: XOR guard | Task 4 step 1 | ✅ |
| 2C: dom_max guard | Task 4 step 2 | ✅ |
| 2C: ciclo soft guard | Task 4 step 3 | ✅ |
| 2C: ciclo hard guard | Task 4 step 4 | ✅ |
| 2C: Belt-and-suspenders | Task 4 step 5 | ✅ Em solver_ortools.py (onde `work` existe) |
| 2D: ColabMotor type | Task 1 step 4 | ✅ |
| 2D: Validador wiring | Task 5 step 1 | ✅ SELECT + RegraHorarioColab + ColabMotor build |
| 2D: Gap XOR validador | N/A | ✅ Documentado como gap (nao implementar) |
| 2D: Guard dia sem regra | Task 5 step 3 | ✅ HARD violation |
| 2E: Preview tipo A | Task 6 step 3 | ✅ Inalterado |
| 2E: Preview tipo B XOR | Task 6 step 3 | ✅ Heuristica cobertura |
| 2E: Cobertura ajustada | Task 6 step 4 | ✅ Baseada nas rows geradas |
| 2F: nDom filter | Task 3 step 2 | ✅ Em solver-bridge.ts (arquivo correto) |
| 2F: Garantidos filter | Task 3 step 1 + Task 6 step 2 | ✅ Bridge + preview |
| Testes T1 | Task 7 step 1 | ✅ Explicito |
| Testes T2 | Task 7 step 2 | ✅ Explicito |
| Testes T3 | Task 7 step 3 | ✅ Explicito |
| Testes T4 | Task 7 step 4 | ✅ Explicito (promovido de implicito) |
| Testes T5 | Guard T5 em Task 2 | ✅ Testado pelo guard diretamente |
| Testes T6 | Coberto por T2 | ✅ Se nao tem demanda DOM, XOR resolve naturalmente |
| Testes T7 | Coberto por T8 | ✅ Excecao + multi-pass |
| Testes T8 | Task 7 step 5 | ✅ Explicito |
| Testes T9 | Task 7 step 6 | ✅ Explicito (promovido de implicito) |
| Testes T10 | Preview vs solver | ⚠️ Dificil automatizar — verificacao visual na Task 6 step 6 |
| Testes T11 | Task 7 step 7 | ✅ Explicito |
| Fora de escopo | N/A | ✅ Nenhum item de fora tocado |

## Riscos Residuais

1. **Preview diverge do solver:** a heuristica de cobertura e uma aproximacao. O solver usa ciclo domingo com sliding window. Mitigacao: preview e informativo, a escala real vem do solver.
2. **ciclo-grid-converters.ts (escala oficial):** o conversor de escala oficial nao mostra NT pra intermitentes. Fora de escopo deste plano — refinamento visual futuro.
