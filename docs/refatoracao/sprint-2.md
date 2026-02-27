# SPRINT 2: BUGS SECUNDARIOS + LIMPEZA

> **Status:** ✅ CONCLUIDO (2026-02-26)
> **Objetivo:** Eliminar armadilhas, codigo morto, e bugs que nao quebram escala mas corrompem dados ou crasham.
> **Escopo:** Backend + Motor + Frontend pontual (badges F/V).

---

## CONTEXTO (por que este sprint existe)

Sprint 1 corrigiu o motor: violacoes REAIS, horario per-day, timeout, AP1.
Mas o sistema ainda tem:
- **Escala gerada SEM solver** (ciclo rotativo) que pode ser oficializada com violacoes CLT
- **Badges F/V que NUNCA aparecem** (feature fantasma do Ciclos V2)
- **Armadilhas de crash**: JSON.parse sem catch, importacao parcial sem transacao
- **Codigo morto**: 4 funcoes/stores que ninguem usa

---

## BUG 3: BADGES F/V — AUTÓPSIA COMPLETA

> "Isso é lenda, nunca vi na tela." — Marco, 2026-02-26

### O que F e V significam

```
┌──────────────────────────────────────────────────────────────┐
│  F  = FOLGA FIXA                                             │
│      Ex: "Maria SEMPRE folga no SABADO"                      │
│      Configurado em: colaborador_regra_horario               │
│      Campo: folga_fixa_dia_semana = 'SAB'                    │
│                                                               │
│  (V) = FOLGA VARIAVEL (condicional)                          │
│      Ex: "Se João trabalhou DOMINGO, folga na SEGUNDA"       │
│      Configurado em: colaborador_regra_horario               │
│      Campo: folga_variavel_dia_semana = 'SEG'                │
│      Regra: XOR com domingo — works_day[dom] + works_day[var] == 1  │
└──────────────────────────────────────────────────────────────┘
```

### O fluxo completo (solver → tela)

```
                        FLUXO F/V END-TO-END
                        ====================

 ┌─────────────────────────────────────────────────────────────┐
 │  1. CONFIGURACAO (ColaboradorDetalhe.tsx)                    │
 │     Usuario configura regra por colaborador:                │
 │     folga_fixa_dia_semana = 'SAB'                           │
 │     folga_variavel_dia_semana = 'SEG'                       │
 │     → INSERT/UPDATE em colaborador_regra_horario            │
 └───────────────────────┬─────────────────────────────────────┘
                         │
                         ▼
 ┌─────────────────────────────────────────────────────────────┐
 │  2. BRIDGE (solver-bridge.ts)                               │
 │     buildSolverInput() le regras do DB                      │
 │     e passa pro Python:                                     │
 │                                                              │
 │     { colaboradores: [{                                      │
 │         id: 5,                                               │
 │         folga_fixa_dia_semana: 'SAB',      ← ✅ passa       │
 │         folga_variavel_dia_semana: 'SEG',  ← ✅ passa       │
 │     }]}                                                      │
 └───────────────────────┬─────────────────────────────────────┘
                         │
                         ▼
 ┌─────────────────────────────────────────────────────────────┐
 │  3. SOLVER PYTHON (constraints.py)                          │
 │                                                              │
 │     add_folga_fixa_5x2():                                    │
 │       Se dia == 'SAB' → model.Add(works_day[c,d] == 0)     │
 │       ✅ FUNCIONA — solver zera dia fixo                    │
 │                                                              │
 │     add_folga_variavel_condicional():                        │
 │       works_day[c,dom] + works_day[c,var] == 1              │
 │       ✅ FUNCIONA — XOR domingo vs dia variavel             │
 └───────────────────────┬─────────────────────────────────────┘
                         │
                         ▼
 ┌─────────────────────────────────────────────────────────────┐
 │  4. OUTPUT DO SOLVER (solver_ortools.py)                    │
 │                                                              │
 │     alocacoes.append({                                       │
 │         "colaborador_id": 5,                                 │
 │         "data": "2026-03-07",                                │
 │         "status": "FOLGA",       ← so "FOLGA" generico      │
 │         "hora_inicio": None,                                 │
 │         ...                                                  │
 │     })                                                       │
 │                                                              │
 │     ⚠️  NAO INDICA SE E FIXA OU VARIAVEL                   │
 │     O solver NAO precisa — quem classifica e o FRONTEND     │
 └───────────────────────┬─────────────────────────────────────┘
                         │
                         ▼
 ┌─────────────────────────────────────────────────────────────┐
 │  5. PERSISTENCIA (solver-bridge.ts → alocacoes)             │
 │                                                              │
 │     INSERT INTO alocacoes (..., status, ...)                │
 │     VALUES (..., 'FOLGA', ...)                               │
 │                                                              │
 │     ✅ OK — status 'FOLGA' salvo. Sem campo extra.          │
 │     O F/V e derivado da REGRA, nao da alocacao.             │
 └───────────────────────┬─────────────────────────────────────┘
                         │
                         ▼
 ┌─────────────────────────────────────────────────────────────┐
 │  6. LOAD DE REGRAS (EscalaPagina.tsx)                       │
 │                                                              │
 │     const { data: regrasPadrao } = useApiData(               │
 │       () => colaboradoresService.listarRegrasPadraoSetor(    │
 │              setorId                                         │
 │           ),                                                 │
 │       [setorId],                                             │
 │     )                                                        │
 │                                                              │
 │     IPC handler (tipc.ts:1799):                              │
 │       SELECT r.* FROM colaborador_regra_horario r            │
 │       JOIN colaboradores c ON c.id = r.colaborador_id        │
 │       WHERE c.setor_id = ? AND c.ativo = true                │
 │         AND r.ativo = true                                   │
 │         AND r.dia_semana_regra IS NULL                       │
 │                                                              │
 │     → regrasMap = Map<colaborador_id, RegraHorarioColaborador>│
 │                                                              │
 │     ✅ QUERY CORRETA — retorna regras padrao (sem dia)      │
 │     ❓ MAS... so retorna se a regra FOI SALVA               │
 └───────────────────────┬─────────────────────────────────────┘
                         │
                         ▼
 ┌─────────────────────────────────────────────────────────────┐
 │  7. RENDER NO GRID (EscalaGrid.tsx:322-333)                 │
 │                                                              │
 │     if (status === 'FOLGA') {                                │
 │       const regra = regrasMap?.get(colab.id)                 │
 │       const sigla = DIAS_SEMANA_CURTO[dow]  // 'SAB'        │
 │                                                              │
 │       if (regra?.folga_fixa_dia_semana === sigla)            │
 │         → mostra 'F'                                         │
 │                                                              │
 │       if (regra?.folga_variavel_dia_semana === sigla)        │
 │         → mostra '(V)'                                       │
 │                                                              │
 │       else → mostra 'FOLGA'                                  │
 │     }                                                        │
 │                                                              │
 │     ✅ LOGICA CORRETA — compara TEXT com TEXT                │
 └─────────────────────────────────────────────────────────────┘
```

### Onde a cadeia QUEBRA

```
 ┌─────────────────────────────────────────────────────────────┐
 │  PONTO DE FALHA #1: NINGUEM CONFIGUROU A REGRA              │
 │  ════════════════════════════════════════════════            │
 │                                                              │
 │  ColaboradorDetalhe → aba "Regras" → form com               │
 │  folga_fixa_dia_semana e folga_variavel_dia_semana           │
 │                                                              │
 │  Se o RH nunca entrou nessa aba e configurou:                │
 │  → colaborador_regra_horario nao tem registro                │
 │  → regrasMap.get(colab.id) retorna undefined                 │
 │  → TODOS os dias FOLGA mostram "FOLGA" generico              │
 │  → F e (V) NUNCA aparecem                                    │
 │                                                              │
 │  DIAGNÓSTICO: Esta é a causa PRIMARIA.                       │
 │  Se a regra nao foi salva, o badge nao tem                   │
 │  como aparecer. E os pais do Marco NUNCA                     │
 │  entraram nessa tela de config.                              │
 └─────────────────────────────────────────────────────────────┘

 ┌─────────────────────────────────────────────────────────────┐
 │  PONTO DE FALHA #2: BUG NO SetorDetalhe (cosmético)         │
 │  ════════════════════════════════════════════════            │
 │                                                              │
 │  SetorDetalhe.tsx:1002-1003:                                 │
 │    const ff = r.folga_fixa_dia_semana as number | null       │
 │    const fv = r.folga_variavel_dia_semana as number | null   │
 │                                                              │
 │  O campo e TEXT ('SAB'), mas cast como number.               │
 │  Depois usa: DIAS_SEMANA_CURTO[ff]                           │
 │  → DIAS_SEMANA_CURTO['SAB'] === undefined                    │
 │  → Badge mostra "[F] undefined" em vez de "[F] SAB"          │
 │                                                              │
 │  FIX: Remover cast, usar string direto:                      │
 │    const ff = r.folga_fixa_dia_semana                        │
 │    → Badge mostra "[F] SAB" ✅                               │
 └─────────────────────────────────────────────────────────────┘
```

### Como F/V DEVERIA aparecer no grid

```
 ┌─────────────────────────────────────────────────────────────────────────┐
 │  ESCALA — Padaria (07/04 a 12/04)                    Semana 2 de 4     │
 │                                                                         │
 │  Colaborador      SEG    TER    QUA    QUI    SEX    SAB    DOM   H/sem │
 │  ┌──────────────┬──────┬──────┬──────┬──────┬──────┬──────┬──────┬─────┤
 │  │ Maria Silva   │07:00 │07:00 │07:00 │07:00 │07:00 │      │07:00│     │
 │  │ Op. Caixa     │15:20 │15:20 │15:20 │15:20 │15:20 │  F   │13:00│ 44h │
 │  ├──────────────┼──────┼──────┼──────┼──────┼──────┼──────┼──────┼─────┤
 │  │ João Santos   │07:00 │07:00 │FOLGA │07:00 │07:00 │07:00 │07:00│     │
 │  │ Repositor     │15:20 │15:20 │      │15:20 │15:20 │15:20 │13:00│ 44h │
 │  ├──────────────┼──────┼──────┼──────┼──────┼──────┼──────┼──────┼─────┤
 │  │ Ana Costa     │07:00 │ (V)  │07:00 │07:00 │07:00 │07:00 │07:00│     │
 │  │ Padeira       │15:20 │      │15:20 │15:20 │15:20 │15:20 │13:00│ 44h │
 │  └──────────────┴──────┴──────┴──────┴──────┴──────┴──────┴──────┴─────┘
 │                                                                         │
 │  LEGENDA:                                                               │
 │  ┌────────┐  ┌────────┐  ┌────────┐  ┌────────┐  ┌────────┐           │
 │  │TRABALHO│  │  F     │  │  (V)   │  │ FOLGA  │  │  AUS.  │           │
 │  │ verde  │  │cinza+F │  │cinza+V │  │ cinza  │  │ amber  │           │
 │  └────────┘  └────────┘  └────────┘  └────────┘  └────────┘           │
 │                                                                         │
 │  F   = Folga Fixa — Maria SEMPRE folga sabado                          │
 │  (V) = Folga Variavel — Ana trabalhou domingo semana passada,           │
 │        entao folga terca esta semana (XOR)                              │
 │  FOLGA = Folga normal do solver (sem regra configurada)                 │
 │                                                                         │
 │  HOJE: F e (V) aparecem como "FOLGA" generico porque                    │
 │        ninguem configurou regras no ColaboradorDetalhe                   │
 └─────────────────────────────────────────────────────────────────────────┘
```

### ResumoFolgas (componente complementar)

```
 ┌─────────────────────────────────────────────────────────────────────────┐
 │  📅 Folgas   Maria Silva [F] SAB   Ana Costa (V) TER                   │
 │              João Santos — sem regra configurada                        │
 │                                                                         │
 │  Tooltip (V): "Folga variavel: aplicada nos domingos em que trabalha.  │
 │                DOM trabalhados: 3/4"                                     │
 └─────────────────────────────────────────────────────────────────────────┘
```

### VEREDICTO F/V

| Camada | Status | Problema |
|--------|--------|----------|
| DB Schema | ✅ OK | Campos TEXT existem em `colaborador_regra_horario` |
| Bridge → Python | ✅ OK | `folga_fixa/variavel_dia_semana` passados corretamente |
| Solver constraints | ✅ OK | `add_folga_fixa_5x2` + `add_folga_variavel_condicional` funcionam |
| Solver output | ✅ OK | Nao precisa indicar F/V — e derivado da regra, nao da alocacao |
| Load de regras (IPC) | ✅ OK | Query correta, retorna regras padrao do setor |
| EscalaGrid render | ✅ OK | Compara TEXT com TEXT, logica correta |
| ResumoFolgas | ✅ OK | Mostra badges se regra existe |
| **SetorDetalhe** | ❌ BUG | Cast `as number` em campo TEXT — badges mostram "undefined" |
| **Dados reais** | ❌ VAZIO | Ninguem configurou `folga_fixa/variavel_dia_semana` nos colaboradores |

**Conclusao:** O codigo funciona. O problema e que a feature nunca foi USADA — ninguem configurou regras de folga. O sistema e reativo (mostra F/V se regra existir), mas deveria ser proativo (sugerir configurar, ou inferir do historico).

**Fix Sprint 2:**
1. Corrigir bug `as number` no SetorDetalhe (1 linha)
2. Adicionar legenda F/(V) na legenda do grid (hoje so tem TRABALHO/FOLGA/DOMINGO/INDISPONIVEL)
3. **DECISAO NECESSARIA:** Queremos que o sistema SUGIRA folgas? (Auto-assign F/V baseado em contrato 5x2?) Ou fica manual?

---

## ITENS DO SPRINT 2

### Item 1: BUG 5 — Ciclo rotativo bypassa solver (CRITICO)

**Arquivo:** `src/main/tipc.ts`, handler `escalas.gerarPorCicloRotativo`

**Problema:** Gera alocacoes direto do ciclo modelo com INSERT bruto (TRABALHO/FOLGA). NAO roda solver. NAO valida CLT. Retorna `violacoes_hard: 0` HARDCODED.

**Impacto:** Escala pode violar CLT e app mostra como valida. Oficializacao permitida sobre escala ilegal.

**Fix proposto:** Apos INSERT das alocacoes do ciclo, chamar `validarEscalaV3(escalaId)` e retornar violacoes reais. Pattern identico ao Sprint 1 (BUG 9).

```
ANTES:
  ciclo modelo → INSERT alocacoes brutas → return { violacoes_hard: 0 } ← MENTIRA

DEPOIS:
  ciclo modelo → INSERT alocacoes brutas → validarEscalaV3(escalaId)
                                         → return { ...validacao } ← VERDADE
```

**Nota:** `persistirSolverResult` NAO serve aqui — ciclo nao roda solver. O INSERT bruto permanece.

---

### Item 2: BUG 6 — `cadastrar_lote` sem transacao

**Arquivo:** `src/main/ia/tools.ts`

**Problema:** Loop de INSERT individual. Se lote de 200 falha no 150o, 1-149 ja commitados. Sem BEGIN/COMMIT/ROLLBACK. Importacao parcial silenciosa.

**Fix proposto:**

```
ANTES:
  for registro in lote:
    try: INSERT registro
    catch: skip (dados orfaos)

DEPOIS:
  BEGIN
  for registro in lote:
    INSERT registro
  COMMIT
  (catch → ROLLBACK)
```

---

### Item 3: BUG 7 — JSON.parse sem try/catch (5 locais)

**Arquivo:** `src/main/tipc.ts` (linhas 2459, 2462, 2605, 2606, 2948)

**Problema:** `JSON.parse(m.tool_calls_json)` e `JSON.parse(m.anexos_meta_json)` sem catch. JSON corrompido = crash do handler inteiro.

**Fix proposto:** Wrap cada JSON.parse em `try/catch` com fallback `undefined`.

```typescript
// Helper
function safeJsonParse<T>(json: string | null | undefined): T | undefined {
  if (!json) return undefined
  try { return JSON.parse(json) }
  catch { return undefined }
}
```

---

### Item 4: BUG 3 — Badges F/V (fix + legenda)

**Arquivos:**
- `src/renderer/src/paginas/SetorDetalhe.tsx` — fix cast `as number`
- `src/renderer/src/componentes/EscalaGrid.tsx` — adicionar F/(V) na legenda

**Fix 4a — SetorDetalhe (1 linha):**

```typescript
// ANTES (linha 1002-1003)
const ff = r.folga_fixa_dia_semana as number | null  // ← BUG: campo e TEXT, nao number
const fv = r.folga_variavel_dia_semana as number | null

// DEPOIS
const ff = r.folga_fixa_dia_semana   // TEXT: 'SAB' | null
const fv = r.folga_variavel_dia_semana

// ANTES (linha 1009)
[F] {DIAS_SEMANA_CURTO[ff]}  // ← DIAS_SEMANA_CURTO['SAB'] = undefined

// DEPOIS
[F] {ff}  // ← mostra 'SAB' direto
```

**Fix 4b — Legenda do grid (adicionar F e V):**

```
ANTES da legenda:
  ┌────────┐ ┌──────┐ ┌─────────┐ ┌─────────────┐
  │TRABALHO│ │FOLGA │ │DOM trab.│ │INDISPONIVEL │
  └────────┘ └──────┘ └─────────┘ └─────────────┘

DEPOIS:
  ┌────────┐ ┌──────┐ ┌────┐ ┌──────┐ ┌─────────┐ ┌─────────────┐
  │TRABALHO│ │FOLGA │ │ F  │ │ (V)  │ │DOM trab.│ │INDISPONIVEL │
  └────────┘ └──────┘ └────┘ └──────┘ └─────────┘ └─────────────┘
                       Fixa   Variavel
```

---

### Item 5: BUG 4 — Rascunho some ao navegar

**Arquivo:** `src/renderer/src/paginas/EscalaPagina.tsx`

**Problema:** `loadRascunho()` busca RASCUNHO do DB ao montar. Usa `simulacao_config_json` parseado via `(detail.escala as any)` — campo nao tipado. Precisa validacao end-to-end.

**Fix proposto:** Verificar se `loadRascunho` restaura estado completo ao re-montar. Se `simulacao_config_json` nao esta salvo, adicionar persistencia. Tipar campo corretamente.

---

### Item 6: Codigo morto — deletar 4 itens

| Arquivo | O que e | Por que morto |
|---------|---------|---------------|
| `src/renderer/src/estado/store.ts` | Zustand store com `setorAtivoId` | Ninguem le. `useSetorSelection` substituiu |
| `solver/constraints.py` → `add_h3_rodizio_domingo()` | Constraint antiga | Substituida por `add_folga_fixa_5x2` + `add_folga_variavel_condicional` |
| `solver/constraints.py` → `add_h19_folga_comp_domingo()` | No-op: body e `pass` | Nunca implementada |
| `tests/test-conversa.ts` (se existir) | Test antigo | Referencia a estrutura que nao existe mais |

---

### Item 7: Helpers duplicados

**Problema:** `listDays`, `dayLabel`, `minutesBetween` existem em mais de um lugar.

**Fix:** Unificar em `src/shared/utils.ts` ou equivalente. Import unico.

---

### Item 8: `knowledge.rebuildAndExportSistema` sem guard

**Arquivo:** `src/main/tipc.ts`

**Problema:** Escreve em disco (`fs.writeFileSync`) sem checar `NODE_ENV`. Em producao, `process.cwd()` aponta pra lugar errado. Rota IPC exposta ao renderer.

**Fix:** Adicionar guard `if (process.env.NODE_ENV !== 'development') throw 'dev-only'`.

---

### Item 9: Warm-start hints incluem escalas ARQUIVADAS

**Arquivo:** `src/main/motor/solver-bridge.ts`

**Problema:** Query de hints nao filtra por status. Escalas arquivadas (possivelmente com dados ruins) poluem o warm-start.

**Fix:** Adicionar `AND status != 'ARQUIVADA'` na query.

---

### Item 10: Historico IA truncado em 320 chars

**Arquivo:** `src/main/ia/cliente.ts`

**Problema:** Trunca historico de conversa em 320 chars — perde contexto.

**Fix:** Aumentar ou remover limite. Avaliar impacto no token count.

---

### Item 11: `escalasAjustar` INSERT inline duplicado

**Arquivo:** `src/main/tipc.ts`

**Problema:** Bloco de INSERT de alocacoes/decisoes/comparacao duplicado do `persistirSolverResult`. Mas `escalasAjustar` faz UPDATE na escala (nao INSERT), entao nao pode usar `persistirSolverResult` diretamente.

**Fix:** Extrair helper `persistirAlocacoesAjuste(escalaId, solverResult)` que faz DELETE+INSERT das alocacoes/decisoes/comparacao sem tocar na escala.

---

## ORDEM DE EXECUCAO

```
┌──────────────────────────────────────────────────────────────┐
│  PRIORIDADE CRITICA (dados errados)                          │
│  ─────────────────────────────────                           │
│  1. Item 1 (BUG 5 ciclo rotativo) — escala ilegal           │
│                                                               │
│  PRIORIDADE ALTA (armadilhas de crash)                       │
│  ─────────────────────────────────────                       │
│  2. Item 3 (BUG 7 JSON.parse) — 5 locais, rapido            │
│  3. Item 2 (BUG 6 cadastrar_lote) — transacao                │
│                                                               │
│  PRIORIDADE MEDIA (UX/feature)                               │
│  ─────────────────────────────                               │
│  4. Item 4 (BUG 3 badges F/V) — fix + legenda               │
│  5. Item 5 (BUG 4 rascunho) — verificacao end-to-end        │
│                                                               │
│  PRIORIDADE BAIXA (limpeza/debt)                             │
│  ─────────────────────────────                               │
│  6. Item 6 (codigo morto) — deletar 4 itens                 │
│  7. Item 7 (helpers duplicados) — unificar                   │
│  8. Item 8 (guard NODE_ENV) — 1 linha                        │
│  9. Item 9 (warm-start) — 1 clausula SQL                     │
│ 10. Item 10 (historico IA) — avaliar limite                  │
│ 11. Item 11 (ajustar inline) — extrair helper                │
└──────────────────────────────────────────────────────────────┘
```

---

## ARQUIVOS AFETADOS

| Arquivo | Itens |
|---------|-------|
| `src/main/tipc.ts` | 1, 3, 8, 11 |
| `src/main/ia/tools.ts` | 2 |
| `src/main/ia/cliente.ts` | 10 |
| `src/main/motor/solver-bridge.ts` | 9 |
| `src/renderer/src/paginas/SetorDetalhe.tsx` | 4a |
| `src/renderer/src/paginas/EscalaPagina.tsx` | 5 |
| `src/renderer/src/componentes/EscalaGrid.tsx` | 4b |
| `solver/constraints.py` | 6 |
| `src/renderer/src/estado/store.ts` | 6 (deletar) |
| `src/shared/utils.ts` (ou equiv.) | 7 |

---

## VERIFICACAO

```bash
npm run typecheck  # 0 erros
```

---

## CHECKLIST DE TESTE MANUAL

| # | Teste | Como verificar | Esperado |
|---|-------|---------------|----------|
| T1 | Ciclo rotativo mostra violacoes | Gerar escala por ciclo → verificar violacoes | Violacoes CLT REAIS (nao mais `violacoes_hard: 0` hardcoded) |
| T2 | Ciclo rotativo nao oficializa com violacoes | Gerar por ciclo com violacao HARD → tentar oficializar | Botao bloqueado |
| T3 | JSON corrompido nao crasha | Corromper `tool_calls_json` no banco → abrir historico IA | App funciona, campo vem como `undefined` |
| T4 | Importacao lote atomica | Via IA: "cadastre 10 colaboradores" → falhar no 5o (FK invalida) | NENHUM dos 10 criado (ROLLBACK) |
| T5 | Badges F/V no grid | Configurar regras folga pra 1 colab → gerar escala → ver grid | F e (V) aparecem nas celulas corretas |
| T6 | Badges F/V no SetorDetalhe | Mesmo setup T5 → voltar pro SetorDetalhe | Badge mostra "[F] SAB", nao "[F] undefined" |
| T7 | Legenda do grid inclui F/V | Gerar escala com colabs que tem regras F/V | Legenda mostra F (Fixa) e (V) (Variavel) |
| T8 | Rascunho persiste ao navegar | Gerar rascunho → navegar pra outra pagina → voltar | Rascunho carrega automaticamente |
| T9 | Codigo morto removido | `npm run typecheck` + grep por funcoes deletadas | 0 erros, funcoes nao existem mais |
| T10 | rebuildGraph so em dev | Tentar chamar IPC em producao | Erro ou guard bloqueia |

### Prioridade de teste

1. **T1 e T2** — CRITICOS. Se ciclo rotativo mascara violacoes, sprint falhou.
2. **T3 e T4** — ALTOS. Armadilhas de crash/dados.
3. **T5, T6, T7** — MEDIOS. Feature F/V finalmente visivel.
4. **T8-T10** — BAIXOS. Debt/limpeza.

---

## DECISAO PENDENTE (para debater)

> **Auto-assign de folgas:** Hoje F/V so aparece se alguem configurou manualmente no ColaboradorDetalhe. Queremos que o sistema SUGIRA automaticamente? Ex: contrato 5x2 → sistema pergunta "Qual dia fixo de folga?" ao gerar.
>
> Isso e Sprint 2 ou Sprint 4 (UX)?

---

*Sprint 2 a debater. Proximo: Sprint 3 (H7 + Dashboard Real).*
