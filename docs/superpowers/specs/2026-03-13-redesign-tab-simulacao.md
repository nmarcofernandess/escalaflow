# Redesign Tab Simulacao — Spec V3 (blindada)

> Simulacao = planejamento do padrao de folgas. Gerar = aceitar padrao + solver.
> Mesmo grid, dois estados. F/V salvos no banco ao Gerar.
> Atualizado: 2026-03-13 21h — endereçou todos os pontos do review GPT.

---

## Decisoes Fechadas

### DF1: Semantica oficial da folga variavel

**MESMA SEMANA.** "Se trabalhou domingo daquela semana, folga no dia variavel
da mesma semana (antes do domingo no calendario)."

O solver ja esta nessa semantica (constraints.py OFFSET negativo: SEG=-6..SAB=-1).

`folga-inference.ts` esta INCONSISTENTE — olha dias DEPOIS do domingo (+1..+6 = proxima semana).
**Precisa corrigir pra olhar ANTES (-6..-1 = mesma semana).**

H19 (FOLGA_COMP_DOM) e regra separada, marcada como NO-OP no sistema atual. NAO mexer.

### DF2: Usa pinned_folga_externo?

**SIM, pra colaboradores elegiveis.** Salvar so F/V no banco nao garante que o solver
produza o mesmo padrao T/F do preview (o solver otimiza mais variaveis). Pra garantir
que "o que o RH viu = o que sai", o Gerar faz as DUAS coisas:
1. Salva F/V no banco (force=true) — persiste as regras
2. Gera pinned_folga_externo do preview — lacra o padrao T/F pro solver

Pra colaboradores NAO-elegiveis (intermitente, locked), o solver decide livremente.

O mapeamento postos→indices do solver: a bridge ordena por rank DESC. O pinned usa
colaborador_id + data (nao indice). A bridge converte pra (c_idx, d_idx) internamente.

**Fallback:** Se o solver nao consegue respeitar o pinned (INFEASIBLE), Phase 1 cai
e o multi-pass degrada normalmente. Avisos no resultado.

### DF3: Como tratar folga_fixa = DOM

**Suportado no solver e no banco. Bloqueado no preview editavel.**
- Colaborador com folga_fixa=DOM aparece no grid como read-only (locked row)
- FolgaSelect desabilitado pra esse colaborador no preview
- O solver respeita a regra normalmente
- Nao entra no calculo de N_dom_legais (ja excluido na bridge)

### DF4: Como tratar INTERMITENTE

**Fora do preview editavel.**
- Nao aparece no grid do Nivel 1 (nao tem conceito de 5x2)
- O solver lida normalmente (ja tem guards pra intermitente)
- Se o setor tem intermitente, ele nao conta no N do gerarCicloFase1

### DF5: Como tratar setor 6X1

**Fora do escopo do preview V1.**
- O preview Nivel 1 assume 5x2 (2 folgas/semana com fixa+variavel)
- Se setor.regime_escala === '6X1': nao mostrar preview, manter comportamento atual
  (so aparece grid depois de Gerar com solver)
- Futuro: adaptar gerarCicloFase1 pra 6X1

### DF6: Gerar = aceitar padrao

Clicar "Gerar Escala":
1. Salva F/V no banco (force=true)
2. Monta pinned_folga_externo do preview (T/F → band 0/3 por colab elegivel)
3. Solver roda com pinned (pula Phase 1 pra esses colabs)
4. Resultado substitui grid

Descartar = remove escala, F/V ficam no banco (regras do colaborador).
Oficializar = persiste escala como OFICIAL.

### DF7: Preview state — precedencia

```
1. Regra persistida no banco (folga_fixa/variavel da colaborador_regra_horario)
2. Nivel 1 auto preenche LACUNAS (so onde regra e null)
3. Edicao manual local sobrescreve durante a sessao
```

Na hora de salvar (Gerar), o payload e o merge completo (regras existentes + auto + edits).

### DF8: Rascunho existente vs preview

- Se existe rascunho (escala com status RASCUNHO): mostra rascunho, NAO o preview
- Gating: usar `carregandoTabEscala` como guard explicitomos:
  - `carregandoTabEscala = true` → loading spinner
  - `escalaCompleta != null` → mostra resultado (rascunho ou recem-gerado)
  - `escalaCompleta == null && !carregandoTabEscala` → mostra preview Nivel 1

### DF9: Contrato de dados

- F/V no payload IPC/renderer usam `DiaSemana` (string), NAO indices numericos
- Variavel: `Exclude<DiaSemana, 'DOM'> | null`
- Fixa: `DiaSemana | null`
- Indice numerico e detalhe interno do simula-ciclo.ts
- `salvarPadraoFolgas` aceita `force?: boolean`

---

## Inconsistencias a corrigir (pre-requisito)

### IC1: folga-inference.ts — alinhar com mesma semana

**Arquivo:** `src/shared/folga-inference.ts:71-73`

```typescript
// ANTES (proxima semana):
for (let offset = 1; offset <= 6; offset += 1) {
  const next = new Date(sunday)
  next.setUTCDate(sunday.getUTCDate() + offset)

// DEPOIS (mesma semana — antes do domingo):
for (let offset = -6; offset <= -1; offset += 1) {
  const prev = new Date(sunday)
  prev.setUTCDate(sunday.getUTCDate() + offset)
```

Guard: `prev` pode cair antes do inicio do periodo. Checar se a data existe nas alocacoes.

### IC2: gerarHTMLFuncionario.ts — texto legacy

**Arquivo:** `src/renderer/src/lib/gerarHTMLFuncionario.ts:198`

```html
<!-- ANTES: -->
(V) ativa quando trabalhou domingo na semana anterior

<!-- DEPOIS: -->
(V) ativa quando trabalhou domingo nesta semana
```

### IC3: calcularCicloDomingo — incluir dia_semana=null

**Arquivo:** `src/main/motor/solver-bridge.ts:174`

```typescript
// ANTES:
const domDemandas = demandaRows.filter(d => d.dia_semana === 'DOM')

// DEPOIS:
const domDemandas = demandaRows.filter(d => d.dia_semana === 'DOM' || d.dia_semana === null)
```

Consistente com preflight-capacity.ts:70 que ja faz `dia_semana === null || dia_semana === label`.

### IC4: FolgaSelect — restringir DOM na variavel

**Arquivo:** `src/renderer/src/componentes/EscalaCicloResumo.tsx:154`

```tsx
// ANTES:
{DIAS_ORDEM.map((dia) => (

// DEPOIS:
{DIAS_ORDEM.filter(dia => field === 'folga_fixa_dia_semana' || dia !== 'DOM').map((dia) => (
```

### IC5: EscalaCicloResumo inferredFolgas — alinhar com same-week

**Arquivo:** `src/renderer/src/componentes/EscalaCicloResumo.tsx`

A inferencia de folga no useMemo (linhas 337-394) usa contagem por dia da semana.
Isso funciona pra detectar o dia MAIS frequente de folga, que e agnóstico a
same-week vs cross-week. Mas se usarmos `inferFolgasFromAlocacoes` (do folga-inference.ts),
precisa estar alinhado (IC1).

Verificar se EscalaCicloResumo usa `folga-inference.ts` ou tem logica propria.
Se propria, manter (e agnóstica). Se usa folga-inference, IC1 resolve.

---

## O que muda (features novas)

### F1: Preview Nivel 1 automatico

Quando `escalaCompleta == null && !carregandoTabEscala && setor.regime_escala === '5X2'`:

1. Calcular N e K:
   ```typescript
   const N = postosAtivos.filter(p => {
     const titular = titularPorPosto.get(p.id)
     if (!titular) return false
     if (titular.tipo_trabalhador === 'INTERMITENTE') return false
     return true
   }).length

   const kDom = Math.max(0, ...(demandas ?? [])
     .filter(d => d.dia_semana === 'DOM' || d.dia_semana === null)
     .map(d => d.min_pessoas))
   const K = kDom > 0 ? kDom : sugerirK(N)
   ```

2. Merge com regras existentes:
   ```typescript
   // Ler regrasPadrao do banco (ja carregadas no SetorDetalhe)
   // Montar folgas_forcadas: regra persistida vence, auto preenche lacuna
   const folgasForcadas = postosElegiveis.map((p, idx) => {
     const regra = regrasMap.get(titularPorPosto.get(p.id)!.id)
     return {
       folga_fixa_dia: regra?.folga_fixa_dia_semana
         ? DIAS_IDX.indexOf(regra.folga_fixa_dia_semana)
         : null,  // null = auto decide
       folga_variavel_dia: regra?.folga_variavel_dia_semana
         ? DIAS_IDX.indexOf(regra.folga_variavel_dia_semana)
         : null,
     }
   })
   ```

3. Rodar `gerarCicloFase1({ num_postos: N, trabalham_domingo: K, preflight: true, folgas_forcadas })`

4. Converter resultado via `converterNivel1ParaEscala()`

5. Renderizar com EscalaCicloResumo (onFolgaChange ativo)

### F2: gerarCicloFase1 — aceitar folgas_forcadas

**Arquivo:** `src/shared/simula-ciclo.ts`

Adicionar campo opcional no input:
```typescript
export interface SimulaCicloFase1Input {
  // ... existente ...
  folgas_forcadas?: Array<{
    folga_fixa_dia: number | null    // 0-5 (SEG-SAB) ou null = auto
    folga_variavel_dia: number | null
  }>
}
```

No Step 2 (assign weekday offs), respeitar `folgas_forcadas[posto]` quando nao-null.
Se valor e null, usar logica auto existente.

### F3: converterNivel1ParaEscala

**Arquivo:** `src/shared/simula-ciclo.ts`

```typescript
export function converterNivel1ParaEscala(
  output: SimulaCicloOutput,
  postosElegiveis: Array<{ funcao: Funcao; titular: Colaborador }>,
  setorId: number,
  periodo: { data_inicio: string; data_fim: string },
): { escala: Escala; alocacoes: Alocacao[]; regras: RegraHorarioColaborador[] }
```

Escala fake usa SOMENTE campos que existem no type Escala real:
```typescript
{ id: -1, setor_id: setorId, data_inicio, data_fim,
  status: 'RASCUNHO', pontuacao: null, criada_em: new Date().toISOString() }
```

Alocacao fake: 1 por colaborador elegivel por dia, status TRABALHO/FOLGA, hora_inicio/fim null.

Regras: DiaSemana (nao indice numerico). Usar constante compartilhada:
```typescript
const DIAS_IDX: DiaSemana[] = ['SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB']
```

### F4: Rows locked no grid

Colaboradores com `folga_fixa=DOM` ou `tipo_trabalhador=INTERMITENTE`:
- Aparecem no grid com FolgaSelect desabilitado
- Badge "Bloqueado" ou row com opacity reduzida
- Nao entram no pinned_folga_externo (solver decide)

### F5: Montar pinned_folga_externo no Gerar

Converter preview atual pra formato do solver:
```typescript
// Para cada colaborador ELEGIVEL no preview:
// Para cada dia no periodo:
//   T → band=3 (INTEGRAL — solver decide horario)
//   F → band=0 (OFF)
// Formato: Array<{ c: colaborador_id, d: dia_index_no_periodo, band: 0|3 }>
```

A bridge (`buildSolverInput`) precisa converter `colaborador_id + data` pra
`(c_index, d_index)` que o Python espera. Adicionar essa conversao na bridge.

### F6: salvarPadraoFolgas com force

**Arquivo:** `src/main/tipc.ts`

```typescript
// Input: adicionar force?: boolean
// Logica quando force=true:
const newFixa = force ? item.folga_fixa_dia_semana : (existe.folga_fixa_dia_semana ?? item.folga_fixa_dia_semana)
const newVar = force ? item.folga_variavel_dia_semana : (existe.folga_variavel_dia_semana ?? item.folga_variavel_dia_semana)
```

### F7: Botao Recalcular

Aparece so quando `manualEditado === true`.
Reseta folgasEditadas, re-roda auto com merge de regras existentes.

### F8: Avisos inline

Derivados de `output.stats`:
- `sem_TT === false` → badge "TT detectado"
- `sem_H1_violation === false` → badge "H1 violado"
- `cobertura_min < K` → badge "Cobertura insuficiente"

---

## Arquivos que mudam

| Arquivo | Mudanca | Tipo |
|---------|---------|------|
| `src/shared/folga-inference.ts` | Offset -6..-1 (IC1) | Fix |
| `src/renderer/src/lib/gerarHTMLFuncionario.ts` | Texto "nesta semana" (IC2) | Fix |
| `src/main/motor/solver-bridge.ts` | kDom inclui null (IC3) + converter pinned por colab_id→idx | Fix + Feature |
| `src/renderer/src/componentes/EscalaCicloResumo.tsx` | FolgaSelect filtra DOM (IC4) | Fix |
| `src/shared/simula-ciclo.ts` | folgas_forcadas + converterNivel1ParaEscala (F2, F3) | Feature |
| `src/renderer/src/paginas/SetorDetalhe.tsx` | Preview auto + onFolgaChange + Recalcular + pinned no Gerar (F1, F5, F7, F8) | Feature |
| `src/main/tipc.ts` | force param em salvarPadraoFolgas (F6) | Feature |
| `src/renderer/src/servicos/colaboradores.ts` | Passar force (F6) | Feature |

## O que NAO muda

- constraints.py / solver_ortools.py (solver ja tem semantica correta)
- EscalaCicloResumo.tsx (exceto FolgaSelect filter — IC4)
- Setores 6X1 (fora do escopo V1 — mantém comportamento atual)

## Verificacao

- `npm run typecheck`
- `npm run solver:test:parity`
- Teste visual: setor 5x2 com 5+ postos → preview auto → editar F/V → Gerar → comparar T/F
