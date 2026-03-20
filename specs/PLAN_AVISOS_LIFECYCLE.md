# PLAN: Avisos Lifecycle — Phase-Based Context + Escopo + Evidencia

> **Status:** PLANEJADO
> **Criado:** 2026-03-19
> **Contexto:** Sessao de debug que revelou 5 camadas de mensagens empilhadas sem coerencia

---

## 1. O Problema (Estado Atual)

### 1.1 Sintomas reportados pelo operador

- Mensagens se repetem 2-3x com fraseado diferente
- Termos tecnicos vazam pro RH: "INFEASIBLE", "Slot", "disponiveis=2", "preview"
- Apos cancelar sugestao, erros de geracao anterior ficam grudados
- Drawer mostra avisos do "antes" e do "depois" ao mesmo tempo
- Nao fica claro o que e aviso do sistema vs resultado do solver

### 1.2 Causa raiz arquitetural

Existem **5 fontes** de mensagens que convergem sem filtro nem lifecycle:

```
┌─────────────────┐   ┌───────────────────┐   ┌──────────────────┐
│ Python Solver    │   │ TS Validator      │   │ TS Preview       │
│ (diagnostico,   │   │ (Violacao[],      │   │ (PreviewDiag[],  │
│  erro, decisoes) │   │  mensagem, regra) │   │  capacity, etc)  │
└────────┬────────┘   └────────┬──────────┘   └────────┬─────────┘
         │                     │                       │
         ▼                     ▼                       ▼
┌────────────────────────────────────────────────────────────────┐
│                    tipc.ts (traducao parcial)                   │
│  buildInfeasibleMessage() traduz ALGUNS, vaza diagnostico_resumido │
└────────────────────────────────┬───────────────────────────────┘
                                 │
                                 ▼
┌────────────────────────────────────────────────────────────────┐
│              SetorDetalhe.tsx (merge manual)                    │
│                                                                │
│  useState(avisosOperacao) ← imperativo, nunca limpo            │
│  useMemo(previewDiagnostics) ← reativo, correto                │
│  useState(advisoryResult) ← imperativo, limpo so em 2 paths    │
│  store(previewAvisos) ← reativo, correto                       │
│                                                                │
│  buildPreviewAvisos() merge 4 fontes → dedup por id QUEBRADO   │
└────────────────────────────────┬───────────────────────────────┘
                                 │
                    ┌────────────┴────────────┐
                    ▼                         ▼
            AvisosSection              SugestaoSheet
            (pagina principal)         (drawer lateral)
            mostra TUDO misturado      mostra advisory + TS "antes"
```

### 1.3 Os problemas distintos de verdade

| # | Problema | Natureza | O que resolve |
|---|---------|----------|---------------|
| A | QUANDO mostrar (lifecycle) | Engenharia de estado | Phase-based context |
| B | O QUE mostrar (conteudo) | Traducao de mensagens | Camada de humanizacao |
| C | QUANTO confiar (profundidade) | Niveis de validacao | Confianca baseada em evidencia |
| D | SOBRE O QUE o aviso fala (escopo) | Contrato de UI | Separar estado atual vs proposta vs operacao |

Todos sao **necessarios**. A sem D = a UI mostra a coisa certa na hora errada ou a coisa errada na hora certa. B sem A = avisos legiveis, mas stale. A+B sem C = user pensa que "verde no TS" significa "pronto pra gerar". A+B+C sem D = drawer continua mostrando "antes" e "depois" no mesmo balaio.

### 1.4 Exemplo concreto: porque A+B nao bastam sem C

**Cenario: Acougue, 5 pessoas, ciclo 5x2**

```
         SEG  TER  QUA  QUI  SEX  SAB  DOM
Ana(e)   T    T    T    T    T    F    F    ← estagiaria, max 6h/dia
Bruno    T    T    T    T    F    T    F
Carlos   T    T    T    F    T    T    F    ← regra individual: so trabalha tarde (14:00-20:00)
Diana    T    T    F    T    T    T    F
Eva(e)   T    F    T    T    T    T    F    ← estagiaria, max 6h/dia
```

**TS Preview analisa (nivel ciclo — dias T/F):**
- 4 pessoas por dia? Sim. ✓
- 5x2 respeitado? Sim. ✓
- Domingos equilibrados? Sim. ✓
- Cobertura vs demanda diaria? OK. ✓
- **Resultado: TUDO VERDE** ✓

**Solver analisa (nivel escala — horarios reais + restricoes individuais):**
- Terca: 4 disponiveis = Ana(estag 6h), Carlos(so tarde), Diana, Eva(estag 6h)
- Demanda terca 07:00-10:00 = 3 pessoas
- Quem pode cobrir 07:00-10:00? So Diana. Ana/Eva max 6h (podem, mas...), Carlos so tarde.
- Na pratica: com almoco, turnos reais e restricoes, cobertura impossivel na manha de terca
- **Resultado: GAP DE COBERTURA** ✗

**O que acontece na UI SEM a dimensao C:**

```
1. User configura ciclo → TS Preview: tudo verde ✓
2. User pensa "ta pronto" → clica "Gerar Escala" direto
3. Solver: INFEASIBLE ou escala com gaps
4. User: "mas tava tudo verde?!"
```

**Ou pior — o fluxo sugerir/cancelar:**

```
1. TS Preview: tudo verde ✓
2. User clica "Sugerir" → solver encontra gap na terca manha
3. Drawer: "Cobertura insuficiente terca 07:00-10:00"
4. User clica "Cancelar" (nao quer mudar as folgas agora)
5. UI: volta pra tudo verde ← O PROBLEMA EXISTE MAS SUMIU
6. User gera escala → surpresa
```

**O que acontece COM a dimensao C:**

```
1. User configura ciclo → TS Preview: tudo verde ✓
   MAS tag "Validacao recomendada" (amarela) ao lado do "Preview"
   → User sabe que verde do TS e pre-check, nao garantia

2. User clica "Sugerir" → solver encontra gap
3. Drawer: "Cobertura insuficiente terca 07:00-10:00"
4. User aceita sugestao do solver → tag fica "Validado" (verde)
   OU
4. User cancela → tag volta pra "Validacao recomendada" (amarela)
   → User VE que o solver encontrou algo, nao perde a informacao

5. User muda qualquer folga → tag volta pra "Validacao recomendada"
   → Dirty state invalida a validacao anterior
```

**A tag "Validacao recomendada" e o link entre os dois niveis.** Sem ela, o user nao tem como saber que o verde do TS e raso.

### 1.5 Dois niveis de validacao (nao confundir)

O sistema tem dois TS de validacao que operam em **niveis diferentes**:

```
NIVEL CICLO (antes de gerar)              NIVEL ESCALA (depois de gerar)
──────────────────────────                ─────────────────────────────
simula-ciclo.ts                           validacao-compartilhada.ts
preview-diagnostics.ts                    validador.ts

Valida PADRAO DE FOLGAS:                  Valida ALOCACOES REAIS:
  - cobertura por dia vs demanda            - almoco obrigatorio >6h (H6)
  - domingos consecutivos                   - interjornada 11h (H2)
  - capacidade (pessoas vs demanda)         - jornada max 10h (H4)
  - equilibrio de folgas                    - dias consecutivos (H1)
  - folga fixa vs variavel                  - excecoes respeitadas (H5)
  - intermitente tipo B no ciclo            - estagiario limites (H15-H16)
    (folga_variavel != null)                - feriados proibidos (H17-H18)
Trabalha com DIAS (T/F)                     - intermitente NT em dia sem regra
Nao sabe de horarios/almoco               Trabalha com HORARIOS (HH:MM)
Instantaneo (JS puro)                     Precisa de alocacoes do solver
```

**Regra critica:** A Fase 1 (sugerir/advisory) opera no NIVEL CICLO. Nunca misturar com validacoes do NIVEL ESCALA. H6 (almoco), H2 (interjornada), etc. so fazem sentido DEPOIS que o solver produziu alocacoes reais com turnos e horarios de almoco.

O TS Validator (nivel escala) fornece avisos para o **resumo de escala gerada** — quando o user abre uma escala no historico e ve os detalhes. Este fluxo ja funciona e nao faz parte deste plano.

---

## 2. Solucao A: Phase-Based Context

### 2.1 Modelo de estados (FSM)

O sistema de avisos opera como uma **maquina de estados finita deterministica**:

```
                       ┌──────────┐
             ┌────────│  PREVIEW  │◄────────────────────────┐
             │        └──────┬───┘                          │
             │               │                              │
             │    sugerir()   │  gerar()                     │
             │               │                              │
             ▼               ▼                              │
     ┌───────────────┐  ┌────────────┐                      │
     │ ADVISORY_OPEN │  │ GENERATING │                      │
     └─┬──┬──┬───────┘  └──────┬─────┘                      │
       │  │  │                 │                            │
       │  │  │no_proposal ┌────┴────┐                       │
       │  │  │            │         │                       │
       │  │  │        sucesso    falha                      │
       │  │  │            │         │                       │
  aceitar │  │            │         ▼                       │
       │  │  │            │    ┌──────────┐                 │
       │  │  └────────────┼───►│          │                 │
       │  │cancelar       │    │ PREVIEW   │                 │
       │  └───────────────┼───►│(snapshot) │                 │
       └──────────────────┘    └──────────┘                 │
                                                            │
                          ┌──────────┐                      │
              falha ─────►│INFEASIBLE│──────────────────────┘
                          └──────────┘  dismiss/sugerir
```

### 2.2 Tabela de transicoes (lifecycle)

| Estado atual | Evento | Proximo estado | Efeito colateral |
|-------------|--------|---------------|------------------|
| PREVIEW | sugerir() | ADVISORY_OPEN | advisory pipeline roda (TS → solver escalation) |
| PREVIEW | gerar() | GENERATING | — |
| PREVIEW | user_muda_folga() | PREVIEW | recalcula TS Preview |
| ADVISORY_OPEN | aceitar() | PREVIEW | aplica overrides e persiste snapshot com hash do arranjo POS-proposta |
| ADVISORY_OPEN | cancelar() | PREVIEW | fecha drawer e, se houve warnings, persiste snapshot do hash atual |
| ADVISORY_OPEN | no_proposal() | PREVIEW | solver nao encontrou solucao; persiste snapshot `HAD_WARNINGS` pro hash atual; drawer fecha com mensagem humanizada |
| GENERATING | sucesso | PREVIEW | escala no historico + snapshot `VALIDATED` para o hash atual |
| GENERATING | infeasible | INFEASIBLE | operationFeedback = erro estruturado |
| GENERATING | erro_generico | PREVIEW | toast de erro |
| INFEASIBLE | dismiss() | PREVIEW | limpa feedback operacional |
| INFEASIBLE | sugerir() | ADVISORY_OPEN | limpa feedback operacional e abre pipeline advisory |

**Propriedade critica: toda transicao limpa o estado anterior.** Nao existe caminho onde lixo de um estado anterior sobrevive no proximo.

### 2.3 Botao unico "Sugerir" (simplificacao de UX)

Os 4 botoes atuais (Sugerir TS, Sugerir Solver, Validar, Gerar) existem por razoes de debug — comparar se TS e solver dao a mesma resposta. Para o RH, isso e ruido.

**Resultado final: 2 botoes**

| Botao | O que faz | Visivel |
|-------|-----------|---------|
| **Sugerir** | 1) TS tenta (instantaneo). 2) Se TS ok → mostra. 3) Se TS falha → escala pro solver (A→B→C). User nao sabe qual resolveu. | Sempre |
| **Gerar Escala** | Produz escala real completa (solver full). Acao final. | Sempre |

**O que morre:**

| Botao atual | Destino |
|-------------|---------|
| Sugerir TS | Absorvido pelo "Sugerir" (step 1 interno) |
| Sugerir Solver | Absorvido pelo "Sugerir" (step 2 interno, escalation) |
| Validar | **DELETADO** — sugerir com arranjo OK retorna CURRENT_VALID |

**"Voltar ao automatico"** (reset de overrides) vira item no menu `...` ou botao secundario — e um reset, nao uma sugestao.

### 2.4 Diagnostics da PROPOSTA devem ser derivados no renderer, nao no `advisory-controller`

Problema identificado: o drawer hoje recebe `advisoryResult` + `previewDiagnostics` atuais e mistura os dois. A intuicao inicial era empurrar o TS Preview da proposta para dentro do `advisory-controller`, mas o codigo real mostra que isso e o lugar errado.

**Por que backend nao e o lugar certo:**

- O preview atual ja e calculado no renderer com `runPreviewMultiPass(...)` usando `previewSetorRows`, `demandaPorDiaPreviewCiclo`, `demandaSegmentosPreviewCiclo`, `previewRuleConfig` e horario do setor.
- O `advisory-controller.ts` hoje e solver-centric: ele monta `SolverInput`, roda fases A/B/C e devolve `diagnostics + proposal.diff`. Ele **nao conhece** o estado completo do preview local.
- Empurrar o TS Preview da proposta pro main duplicaria a logica de simulacao do renderer atraves da fronteira IPC sem necessidade.

**Solucao correta:**

```
renderer pipeline:
  1. advisory-controller retorna solver diagnostics + proposal.diff
  2. SetorDetalhe deriva overrides propostos a partir de proposal.diff
  3. SetorDetalhe reaplica o mesmo pipeline local do preview (runPreviewMultiPass)
  4. SugestaoSheet recebe proposalPreviewDiagnostics
  5. Inline preview continua mostrando apenas diagnostics do estado atual
```

Isso garante que a fase `ADVISORY_OPEN` mostra uma visao coerente da **PROPOSTA**, sem obrigar o `advisory-controller` a virar espelho do renderer.

**Validacao nivel escala (H6, H2, H4...) NAO entra aqui.** Essas checks precisam de alocacoes reais (horarios, almoco, turnos) que so existem depois de "Gerar Escala". O advisory continua no nivel ciclo (dias T/F).

### 2.5 Derivacao de avisos por superficie + escopo

O erro original era tratar tudo como "fase". Mas fase e **quando** a UI esta; escopo e **sobre o que** a mensagem fala.

```typescript
type AvisosScope =
  | 'STRUCTURAL'        // sem titular, intermitente sem regra ativa, avisos derivados do setor
  | 'CURRENT_PREVIEW'   // previewDiagnostics do arranjo ATUAL
  | 'PROPOSED_PREVIEW'  // previewDiagnostics do arranjo PROPOSTO no drawer
  | 'OPERATION'         // preflight / generate / infeasible

type AvisosSurface =
  | 'INLINE_PREVIEW'
  | 'SUGESTAO_SHEET'
  | 'OPERATION_FEEDBACK'

// Shape do feedback operacional (preflight, infeasible, erros de geracao)
interface OperationFeedback {
  type: 'INFEASIBLE' | 'PREFLIGHT_BLOCK' | 'PREFLIGHT_WARNING' | 'GENERATE_ERROR'
  message: string              // mensagem crua do solver/preflight (pra log)
  details?: string[]           // sugestoes do solver, blockers do preflight
  setor_id?: number
}

// humanizar() = map cada PreviewDiagnostic por mapPreviewDiagnosticToAviso (definido em 4.4)
function derivarInlinePreview(ctx: AvisosContext): Aviso[] {
  return [
    ...ctx.structuralAvisos,
    ...ctx.currentPreviewAvisos.map(mapPreviewDiagnosticToAviso),
  ]
}

function derivarSugestaoSheet(ctx: AvisosContext): Aviso[] {
  return [
    ...ctx.advisorySolverDiagnostics.map(mapPreviewDiagnosticToAviso),
    ...ctx.proposalPreviewDiagnostics.map(mapPreviewDiagnosticToAviso),
  ]
}

function derivarOperationFeedback(ctx: AvisosContext): Aviso[] {
  return humanizarOperacao(ctx.operationFeedback)
}
```

**Regra de ouro:** nenhuma superficie pode misturar `CURRENT_PREVIEW` com `PROPOSED_PREVIEW`.

### 2.6 Prova de corretude

**Propriedade 1 — Sem mistura temporal:**
O inline preview mostra apenas `STRUCTURAL + CURRENT_PREVIEW`. O drawer mostra apenas `solver diagnostics + PROPOSED_PREVIEW`. O feedback operacional fica separado. "Antes" e "depois" nao aparecem na mesma superficie.

**Propriedade 2 — Sem stale:**
`currentPreviewDiagnostics` e `proposalPreviewDiagnostics` sao derivados com `useMemo` a partir do estado atual e da proposta atual. Quando proposal ou override mudam, recomputa. Nao existe limpeza manual de array generico.

**Propriedade 3 — Reversibilidade real:**
Cancelar fecha o drawer e volta a mostrar apenas o estado atual. Como a proposta nunca contaminou o inline preview, nao sobra lixo semantico.

**Propriedade 4 — Convergencia ao aceitar:**
Aceitar aplica `overrides_locais`, a simulacao recalcula e o `CURRENT_PREVIEW` passa a refletir exatamente o arranjo aceito. O "depois" vira o novo "agora" por um unico caminho.

**Propriedade 5 — Cobertura de niveis preservada:**
Nivel ciclo continua em `runPreviewMultiPass` e advisory. Nivel escala continua no historico/escala gerada. Nada cruza a fronteira errada.

### 2.7 O que MORRE

| Componente atual | Destino |
|-----------------|---------|
| `buildPreviewAvisos()` como merge cego de 4 fontes | **REESCRITO ou DELETADO** — passa a derivar por superficie/escopo |
| `previewDiagnostics` atuais como prop do `SugestaoSheet` | **REMOVIDO** — drawer recebe `proposalPreviewDiagnostics` |
| `avisosOperacao: AvisoEscala[]` como lista generica | **SUBSTITUIDO** por `operationFeedback` tipado |
| Triple-duplication de preview diagnostics | **IMPOSSIVEL** — estado atual e proposta vivem em superficies diferentes |
| Botao "Sugerir TS" | **ABSORVIDO** pelo "Sugerir" unificado |
| Botao "Sugerir Solver" | **ABSORVIDO** pelo "Sugerir" unificado |
| Botao "Validar" | **DELETADO** — validar vira um resultado do proprio "Sugerir" |
| Exigencia de recalcular TS da proposta no backend | **MORRE** — isso fica no renderer, onde o preview ja vive |

### 2.8 Onde vive no codigo

```
src/
├── main/motor/
│   └── advisory-controller.ts   ← continua solver-centric; devolve diagnostics + proposal.diff
│
├── shared/
│   ├── advisory-types.ts        ← snapshot de validacao deixa de ser "accepted only"
│   ├── setor-simulacao.ts       ← persistencia do snapshot no simulacao_config_json
│   └── advisory-hash.ts (NOVO)  ← hash compartilhado entre main + renderer
│
├── renderer/src/
│   ├── hooks/
│   │   └── useAvisosController.ts (NOVO) ← phase local + derivacao por superficie/escopo
│   │
│   ├── lib/
│   │   ├── build-avisos.ts      ← reescrito como mapper por escopo OU removido
│   │   └── humanizar-operacao.ts (NOVO) ← infeasible/preflight/generate sem jargao
│   │
│   ├── componentes/
│   │   ├── AvisosSection.tsx    ← segue simples; recebe avisos ja derivados
│   │   ├── SugestaoSheet.tsx    ← recebe diagnostics da proposta, nao do estado atual
│   │   └── ValidationTag.tsx (NOVO) ← badge ao lado de "Preview"
│   │
│   └── paginas/
│       └── SetorDetalhe.tsx     ← centraliza:
│           - pipeline unificado do botao "Sugerir"
│           - derivacao de proposalPreviewDiagnostics
│           - operationFeedback separado
│           - persistencia do validation snapshot
```

---

## 3. Solucao C: Nivel de Confianca (Validation Confidence)

### 3.1 O problema que A+B nao resolvem

Com phase-based context (A) e humanizacao (B), os avisos sao corretos e legiveis. Mas o user nao sabe **o quao profunda** foi a validacao:

- TS Preview verde = pre-check rapido (nivel ciclo, dias T/F)
- Solver verde = validacao real (nivel escala, horarios + restricoes individuais)

Se o user ve verde no TS e assume que pode gerar, vai ter surpresa. Ele precisa de um **indicador visual de profundidade**. Mas esse indicador nao pode depender de `setState` manual, senao ele vai mentir na primeira transicao esquecida.

### 3.2 Confianca baseada em evidencia, nao em transicao manual

O projeto ja tem duas pistas fortes:

- `computeAdvisoryInputHash(...)` existe hoje em `main/motor/advisory-controller.ts`
- `SetorSimulacaoConfig.advisory` ja existe em `shared/setor-simulacao.ts`, mas esta estreito demais e praticamente morto

Em vez de manter `confidence` como FSM separada, a UI deve **derivar** a confianca comparando:

1. `currentInputHash` do arranjo atual
2. `validationSnapshot.input_hash` salvo no `simulacao_config_json`
3. resultado do ultimo solver para aquele hash

### 3.3 Modelo de evidencia

```typescript
// shared/advisory-types.ts
interface ValidationSnapshot {
  input_hash: string
  generated_at: string
  outcome: 'VALIDATED' | 'HAD_WARNINGS'
  source: 'SUGERIR' | 'GERAR'
  diagnostics: PreviewDiagnostic[]
}

type ValidationConfidence =
  | 'UNVALIDATED'
  | 'TS_ONLY'
  | 'SOLVER_VALIDATED'
  | 'SOLVER_HAD_WARNINGS'
  | 'DIRTY'
```

**Compatibilidade e migracao:**

O tipo atual `SimulacaoAdvisorySnapshot` (marcado `@deprecated`) tem `origin: 'accepted_suggestion'` e `advisory_status: AdvisoryStatus`. Um normalizer deve converter o formato antigo:

```typescript
function normalizeSnapshot(raw: unknown): ValidationSnapshot | null {
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>
  // Formato antigo (SimulacaoAdvisorySnapshot)
  if (obj.origin === 'accepted_suggestion') {
    return {
      input_hash: (obj.input_hash as string) ?? '',
      generated_at: (obj.accepted_at as string) ?? new Date().toISOString(),
      outcome: 'VALIDATED',  // aceitou sugestao = validado
      source: 'SUGERIR',
      diagnostics: [],
    }
  }
  // Formato novo (ValidationSnapshot)
  if ('input_hash' in obj && 'outcome' in obj) {
    return obj as unknown as ValidationSnapshot
  }
  return null
}
```

Isso vive em `shared/advisory-types.ts` e e chamado na leitura do `simulacao_config_json`.

### 3.4 Derivacao da confianca

```typescript
function derivarConfidence(params: {
  previewGate: PreviewGate
  currentInputHash: string
  snapshot: ValidationSnapshot | null
}): ValidationConfidence {
  const { previewGate, currentInputHash, snapshot } = params

  if (!snapshot) {
    return previewGate === 'ALLOW' ? 'TS_ONLY' : 'UNVALIDATED'
  }

  if (snapshot.input_hash !== currentInputHash) {
    return 'DIRTY'
  }

  return snapshot.outcome === 'VALIDATED'
    ? 'SOLVER_VALIDATED'
    : 'SOLVER_HAD_WARNINGS'
}
```

**Ponto importante:** `DIRTY` nao e escrito em lugar nenhum. Ele aparece sozinho quando o hash atual diverge do hash validado.

### 3.5 Quando persistir o snapshot

| Evento | Hash salvo | Outcome |
|-------|------------|---------|
| `Sugerir` retorna `CURRENT_VALID` | hash atual | `VALIDATED` |
| `Sugerir` retorna proposta e user aceita | hash do arranjo POS-proposta (overrides atualizados com proposal.diff) | `VALIDATED` ou `HAD_WARNINGS` conforme diagnostics |
| `Sugerir` retorna `NO_PROPOSAL` | hash atual | `HAD_WARNINGS` |
| `Sugerir` retorna avisos e user cancela | hash atual | `HAD_WARNINGS` |
| `Gerar Escala` com sucesso | hash atual | `VALIDATED` |

**IMPORTANTE sobre hash no aceite:** o snapshot hash deve ser computado a partir do arranjo DEPOIS de aplicar `proposal.diff` nos overrides, nao do input original do advisory call. Caso contrario, `currentInputHash` (pos-aceite) diverge do snapshot hash (pre-aceite) e a tag mostra `DIRTY` imediatamente — exatamente o oposto do desejado.

Isso cobre exatamente o caso patologico do "cancelar e voltar a tudo verde": o user cancelou a mudanca, mas **nao cancela o fato de que o solver achou problema naquele hash**.

### 3.6 Tag visual no header do ciclo

A tag aparece ao lado da tag "Preview" existente no header do setor:

```
┌──────────────────────────────────────────────────────────────┐
│  Ciclo Rotativo                                              │
│  [Preview]  [Validacao recomendada ⚠]         [Sugerir] [▶]  │
│                                                              │
│     SEG  TER  QUA  QUI  SEX  SAB  DOM                       │
│  Ana  T    T    T    T    T    F    F                        │
│  ...                                                         │
└──────────────────────────────────────────────────────────────┘
```

| Confidence | Tag | Cor | Icone | Significado pro RH |
|-----------|-----|-----|-------|-------------------|
| UNVALIDATED | (sem tag) | — | — | Ciclo novo, ainda nao testado |
| TS_ONLY | "Validacao recomendada" | Amarelo | ⚠ | "Parece OK, mas clica Sugerir pra confirmar" |
| SOLVER_VALIDATED | "Validado" | Verde | ✓ | "Pode gerar com confianca" |
| SOLVER_HAD_WARNINGS | "Validacao encontrou avisos" | Laranja | ⚠ | "O solver encontrou problemas — clica Sugerir pra ver" |
| DIRTY | "Validacao recomendada" | Amarelo | ⚠ | "Voce mudou algo — clica Sugerir pra revalidar" |

**Nota de design:** `UNVALIDATED` e `TS_ONLY` sao intencionalmente indistinguiveis pro usuario (ambos pedem "clica Sugerir"). A diferenca existe internamente pra que `derivarConfidence` saiba se o TS sequer rodou. Nao adicionar tag visual extra pra UNVALIDATED.

### 3.7 Prova de corretude da dimensao C

**Propriedade 1 — Verdade unica:**
A confianca deriva de `hash atual + snapshot salvo`, nao de mutacoes manuais em varios handlers. Menos chance de mentira de UI.

**Propriedade 2 — Dirty conservador:**
Qualquer mudanca relevante no ciclo muda o hash. Se mudou o hash, a confianca some automaticamente. Nao depende de lembrar de dar `setConfidence('DIRTY')`.

**Propriedade 3 — Informacao nao se perde no cancelar:**
Cancelar fecha a proposta, mas o snapshot `HAD_WARNINGS` continua associado ao hash atual. O user volta ao estado anterior sabendo que aquele estado foi questionado pelo solver.

**Propriedade 4 — Verde sem atalho:**
So existe verde se houver snapshot `VALIDATED` para o hash atual. Verde sem solver vira impossivel por construcao.

### 3.8 UX do fluxo completo com as 3 dimensoes

```
1. User configura ciclo de folgas no grid
   Phase: PREVIEW | Avisos: TS Preview diagnostics | Tag: (sem — UNVALIDATED)

2. TS Preview recalcula automaticamente → tudo OK
   Phase: PREVIEW | Avisos: nenhum (verde) | Tag: "Validacao recomendada" (amarelo)
   → User ve: ciclo parece OK, mas o sistema recomenda validar

3. User clica "Sugerir"
   Phase: ADVISORY_OPEN | Avisos: loading... | Tag: —

4a. Solver diz OK (CURRENT_VALID)
   Phase: ADVISORY_OPEN → PREVIEW | Avisos: "Tudo certo!" | Tag: "Validado" (verde)
   → User ve: pode gerar com confianca

4b. Solver encontra problema e propoe solucao
   Phase: ADVISORY_OPEN | Avisos: "Cobertura insuficiente terca manha" | Tag: —

5a. User aceita sugestao
   Phase: PREVIEW | Avisos: TS Preview recalculado (novo arranjo) | Tag: "Validado" (verde)
   → User ve: sugestao aplicada e validada

5b. User cancela
   Phase: PREVIEW | Avisos: TS Preview (mesmos de antes) | Tag: "Validacao encontrou avisos" (laranja)
   → User ve: voltou ao que era MAS sabe que o solver encontrou algo

6. User muda uma folga manualmente
   Phase: PREVIEW | Avisos: TS Preview recalculado | Tag: "Validacao recomendada" (amarelo)
   → User ve: mudou algo, precisa revalidar

7. User clica "Gerar Escala"
   Phase: GENERATING | Avisos: — | Tag: —

8a. Sucesso
   Phase: PREVIEW | Avisos: limpos | Tag: "Validado" (verde)
   → Escala no historico com avisos do TS Validator (nivel escala: almoco, interjornada, etc.)

8b. INFEASIBLE
   Phase: INFEASIBLE | Avisos: 1 card vermelho com sugestoes | Tag: —
```

---

## 4. Solucao B: Camada de Humanizacao (focada, nao barroca)

### 4.1 Principio

Nem toda fonte precisa do mesmo tratamento.

- `PreviewDiagnostic` ja nasce relativamente humano.
- O maior vazamento de jargao hoje esta em `INFEASIBLE`, `diagnostico_resumido`, sugestoes do solver e feedback operacional.
- `REGRAS_TEXTO` em `formatadores.ts` e usado por telas de escala/violacoes e **nao precisa entrar neste refactor**.

Ou seja: a solucao correta nao e criar uma mega-biblioteca de regex para o app inteiro. E atacar o ponto onde a linguagem ainda sangra.

### 4.2 Onde humanizar

| Fonte | Tratamento |
|------|------------|
| `PreviewDiagnostic` | mapper fino `PreviewDiagnostic -> Aviso` |
| `InfeasibleError` estruturado | `humanizarInfeasible()` dedicado |
| Preflight blockers / warnings | `humanizarOperacao()` |
| `mapError()` | fallback generico para erros nao estruturados |

### 4.3 Mapeamento minimo necessario

| Original | Humanizado |
|----------|-----------|
| `INFEASIBLE` | `Nao foi possivel gerar uma escala viavel para este periodo.` |
| `disponiveis=2, minimo requerido=3` | `2 pessoas disponiveis, mas a demanda pede 3.` |
| `Slot 12:00-13:00` | `Faixa 12:00 as 13:00` |
| `preview` | `simulacao` |
| `diagnostico_resumido` cru | card resumido + lista de sugestoes do solver |
| `folga_variavel aponta pra dia sem regra` | `A folga variavel de [nome] esta num dia em que ele(a) nao trabalha. Ajuste a regra de horario primeiro.` |
| `tipo_trabalhador=INTERMITENTE` em diagnostics | Omitir tipo — RH sabe quem e intermitente. Falar nome + situacao. |

### 4.4 Estrutura

```typescript
// src/renderer/src/lib/humanizar-operacao.ts

function mapPreviewDiagnosticToAviso(diag: PreviewDiagnostic): Aviso { ... }

function humanizarInfeasible(error: InfeasibleError): Aviso[] { ... }

function humanizarOperacao(feedback: OperationFeedback | null): Aviso[] { ... }
```

### 4.5 Prova de corretude

**Propriedade 1 — Foco no vazamento real:** O refactor trata exatamente as fontes que hoje vazam jargao para o RH, sem arrastar telas fora do escopo.

**Propriedade 2 — Fallback seguro:** Se nao houver traducao especifica, a UI usa `mensagem`/`detail` existente ou `mapError()` — nunca codigo cru se houver texto humano disponivel.

**Propriedade 3 — Menos superficie de bug:** Humanizacao focada reduz o risco de regex global quebrar mensagens que ja estavam boas.

---

## 5. Plano de Execucao

### Fase 1: Separar superficies e matar a mistura "antes/depois"

| # | Task | Arquivos | Estimativa |
|---|------|----------|-----------|
| 1.1 | Criar controller local (`useAvisosController.ts` ou reducer em `SetorDetalhe`) | novo arquivo ou pagina | medio |
| 1.2 | Separar `INLINE_PREVIEW`, `SUGESTAO_SHEET` e `OPERATION_FEEDBACK` | SetorDetalhe.tsx | medio |
| 1.3 | Trocar `previewDiagnostics` do drawer por `proposalPreviewDiagnostics` | SugestaoSheet.tsx + SetorDetalhe.tsx | pequeno |
| 1.4 | Substituir `avisosOperacao` generico por `operationFeedback` tipado | SetorDetalhe.tsx | pequeno |
| 1.5 | Reescrever `buildPreviewAvisos()` por escopo ou remover de vez | build-avisos.ts | medio |
| 1.6 | Unificar botoes em "Sugerir" + "Gerar Escala" | SetorDetalhe.tsx | medio |

### Fase 2: Derivar preview da PROPOSTA localmente

| # | Task | Arquivos | Estimativa |
|---|------|----------|-----------|
| 2.1 | Derivar overrides propostos a partir de `advisoryResult.proposal.diff` | SetorDetalhe.tsx | pequeno |
| 2.2 | Reusar `runPreviewMultiPass(...)` com esses overrides | SetorDetalhe.tsx | medio |
| 2.3 | Mostrar no drawer apenas `solver diagnostics + proposalPreviewDiagnostics` | SugestaoSheet.tsx | pequeno |
| 2.4 | Garantir que inline preview nunca consome diagnostics da proposta | SetorDetalhe.tsx | pequeno |

### Fase 3: Confianca baseada em hash/snapshot

| # | Task | Arquivos | Estimativa |
|---|------|----------|-----------|
| 3.1 | Mover `computeAdvisoryInputHash` para `shared/advisory-hash.ts`. `advisory-controller.ts` (main) e `SetorDetalhe.tsx` (renderer) importam de shared. O arquivo shared NAO importa de main nem renderer. | novo arquivo + imports | pequeno |
| 3.2 | Expandir `SimulacaoAdvisorySnapshot` para snapshot de validacao geral | shared/advisory-types.ts | pequeno |
| 3.3 | Derivar `ValidationConfidence` por `currentHash vs snapshotHash` | SetorDetalhe.tsx ou hook | medio |
| 3.4 | Persistir snapshot ao aceitar, cancelar com warnings e gerar com sucesso | SetorDetalhe.tsx + salvarSimulacaoConfig | medio |
| 3.5 | Renderizar `ValidationTag` ao lado de "Preview" | novo componente | pequeno |

### Fase 4: Humanizacao focada

| # | Task | Arquivos | Estimativa |
|---|------|----------|-----------|
| 4.1 | Criar `humanizar-operacao.ts` para `InfeasibleError` / preflight / sugestoes | novo arquivo | pequeno |
| 4.2 | Integrar humanizacao no lane `OPERATION_FEEDBACK` | SetorDetalhe.tsx ou hook | pequeno |
| 4.3 | Revisar `tipc.ts` e `mapError()` para nao vazar mensagem crua do solver | tipc.ts + formatadores.ts | pequeno |
| 4.4 | Manter `REGRAS_TEXTO` fora deste refactor | sem mudanca | — |

### Fase 5: Verificacao

| # | Task |
|---|------|
| 5.1 | Testar: inline preview nunca mostra diagnostics da proposta |
| 5.2 | Testar: drawer nunca mostra diagnostics do estado atual |
| 5.3 | Testar: sugerir → aceitar → novo arranjo vira o estado atual e fica verde |
| 5.4 | Testar: sugerir → cancelar com warnings → volta ao atual + tag laranja |
| 5.5 | Testar: mudar uma folga depois da validacao → hash diverge e tag volta pra amarelo |
| 5.6 | Testar: gerar → INFEASIBLE → feedback operacional unico, sem cards duplicados |
| 5.7 | Testar: zero mensagens com `INFEASIBLE`, `Slot`, `disponiveis=` na UI de RH |
| 5.8 | Testar: nivel ciclo e nivel escala nunca aparecem na mesma superficie |
| 5.9 | Testar: so 2 botoes visiveis (`Sugerir` + `Gerar Escala`) |
| 5.10 | Testar: intermitente tipo B (folga_variavel != null) aparece no preview/advisory sem jargao tecnico |
| 5.11 | Testar: guard T5 (variavel em dia sem regra) mostra erro humanizado, nao stack trace |
| 5.12 | Testar: sugerir() → NO_PROPOSAL → drawer mostra mensagem humanizada sem botao aceitar → dismiss → tag SOLVER_HAD_WARNINGS |

---

## 6. Riscos e Mitigacoes

| Risco | Probabilidade | Mitigacao |
|-------|--------------|-----------|
| Preview da proposta recalcular em lugar errado | Alta | Fazer no renderer, onde `runPreviewMultiPass` e os inputs ja existem |
| Duplicar hash em main e renderer e gerar divergencia | Media | Extrair helper para `shared/advisory-hash.ts` |
| Snapshot nao cobrir cancelar com warnings | Alta | Persistir snapshot `HAD_WARNINGS` mesmo sem aceitar proposta |
| Tag "Validacao recomendada" irrita user | Media | Tag e informativa, nao bloqueante; tooltip explica o que significa |
| Humanizacao ficar grande demais e quebrar outras telas | Media | Limitar escopo a feedback operacional desta pagina |
| Remover botao Validar quebrar debug interno | Baixa | Debug continua possivel por logs/CLI; UI do RH fica mais limpa |

---

## 7. Criterios de Sucesso

### Dimensao A (Lifecycle)
- [ ] Zero duplicacao de avisos dentro de cada superficie
- [ ] Inline preview nunca mostra diagnostics da proposta
- [ ] Drawer nunca mostra diagnostics do estado atual
- [ ] Cancelar sugestao = inline volta identico ao que era antes
- [ ] Aceitar sugestao = preview atual recalcula sobre os overrides aceitos
- [ ] INFEASIBLE = feedback operacional unico, sem merge com preview atual

### Dimensao B (Humanizacao)
- [ ] Zero mensagens com "INFEASIBLE", "Slot", "preview", codigos H*/AP* crus na UI
- [ ] `diagnostico_resumido` do solver nao aparece cru para o RH
- [ ] Datas em formato humano (dia da semana + dd/mmm), nunca ISO

### Dimensao C (Confianca)
- [ ] Tag "Validacao recomendada" (amarelo) visivel quando TS verde mas solver nunca rodou
- [ ] Tag "Validado" (verde) so aparece apos solver aprovar ou gerar com sucesso
- [ ] Tag "Validacao encontrou avisos" (laranja) apos cancelar sugestao com warnings
- [ ] Qualquer mudanca manual relevante no ciclo muda o hash e derruba a confianca
- [ ] Unico caminho pro verde: existir snapshot `VALIDATED` para o hash atual
- [ ] Tag nunca bloqueante — user pode gerar sem validar, so nao ve verde

### Gerais
- [ ] So 2 botoes na UI: "Sugerir" e "Gerar Escala"
- [ ] Nivel ciclo (cobertura, folgas) e nivel escala (almoco, interjornada) nunca misturados
- [ ] `computeAdvisoryInputHash` deixa de ser exclusivo do main
- [ ] Fluxo completo do exemplo da secao 1.4 funciona sem surpresa

---

## 8. Glossario (pra nao confundir nunca mais)

| Termo | O que e | Quando roda | Nivel |
|-------|---------|-------------|-------|
| **TS Preview** | `simula-ciclo.ts` + `preview-diagnostics.ts` | Antes de gerar, instantaneo | Ciclo (dias T/F) |
| **TS Validator** | `validacao-compartilhada.ts` + `validador.ts` | Depois de gerar, sobre alocacoes | Escala (horarios HH:MM) |
| **Advisory** | `advisory-controller.ts` → solver `solve_folga_pattern` | Ao clicar "Sugerir" | Ciclo (dias T/F) |
| **Solver full** | `solver_ortools.py` via `solver-bridge.ts` | Ao clicar "Gerar Escala" | Escala (horarios HH:MM) |
| **Preflight** | `preflight-capacity.ts` | Antes de gerar, checa pre-condicoes | Capacidade basica |

---

*Principio do EscalaFlow: O SISTEMA propoe, o RH ajusta. Se o RH precisa decifrar mensagens tecnicas, o sistema falhou.*
