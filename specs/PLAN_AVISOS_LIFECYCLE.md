# PLAN: Avisos Lifecycle — Phase-Based Context + Humanizacao

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

### 1.3 Os dois problemas distintos

| # | Problema | Natureza | O que resolve |
|---|---------|----------|---------------|
| A | QUANDO mostrar (lifecycle) | Engenharia de estado | Phase-based context |
| B | O QUE mostrar (conteudo) | Traducao de mensagens | Camada de humanizacao |
| C | QUANTO confiar (profundidade) | Niveis de validacao | Tag de confianca + dirty tracking |

Todos sao **necessarios**. A sem B = avisos no momento certo mas incompreensiveis. B sem A = avisos legiveis mas duplicados/stale. A+B sem C = user pensa que "verde no TS" significa "pronto pra gerar" — e descobre os problemas so depois.

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

### 1.4 Dois niveis de validacao (nao confundir)

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
                                            - estagiario limites (H15-H16)
Trabalha com DIAS (T/F)                     - feriados proibidos (H17-H18)
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
          ┌────────│  PREVIEW  │◄───────────────┐
          │        └──────┬───┘                 │
          │               │                     │
          │    sugerir()   │  gerar()            │
          │               │                     │
          ▼               ▼                     │
  ┌───────────────┐  ┌────────────┐             │
  │ ADVISORY_OPEN │  │ GENERATING │             │
  └───────┬───┬───┘  └──────┬─────┘             │
          │   │             │                   │
   aceitar│   │cancelar     │                   │
          │   │        ┌────┴────┐              │
          │   │        │         │              │
          │   │    sucesso    falha             │
          │   │        │         │              │
          │   └────────┼────┐    ▼              │
          │            │    │ ┌──────────┐      │
          └────────────┘    └►│INFEASIBLE│      │
                            │ └──────┬───┘      │
                            │        │          │
                            │   dismiss/novo    │
                            │   sugerir         │
                            │        │          │
                            └────────┴──────────┘
```

### 2.2 Tabela de transicoes (completa)

| Estado atual | Evento | Proximo estado | Efeito colateral | Confidence |
|-------------|--------|---------------|------------------|------------|
| PREVIEW | sugerir() | ADVISORY_OPEN | advisory pipeline roda (TS → solver escalation) | — |
| PREVIEW | gerar() | GENERATING | — | — |
| PREVIEW | user_muda_folga() | PREVIEW | recalcula TS Preview | → DIRTY |
| ADVISORY_OPEN | aceitar() | PREVIEW | aplica overrides, advisoryResult = null | → SOLVER_VALIDATED |
| ADVISORY_OPEN | cancelar() | PREVIEW | advisoryResult = null | → SOLVER_HAD_WARNINGS* |
| GENERATING | sucesso | PREVIEW | escala no historico | → SOLVER_VALIDATED |
| GENERATING | infeasible | INFEASIBLE | infeasibleError = parsed | → UNVALIDATED |
| GENERATING | erro_generico | PREVIEW | toast de erro | (mantem) |
| INFEASIBLE | dismiss() | PREVIEW | infeasibleError = null | (mantem) |
| INFEASIBLE | sugerir() | ADVISORY_OPEN | infeasibleError = null | — |

*Se o advisory retornou com warnings, cancelar mantem `SOLVER_HAD_WARNINGS` — o user sabe que tem algo pendente.

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

### 2.4 Advisory deve incluir TS Preview da PROPOSTA

Problema identificado: se o advisory retorna diagnostics apenas do solver (padrao de folgas), o drawer pode omitir avisos de cobertura/capacidade que o TS Preview detectaria com os overrides propostos.

**Solucao:** Antes de retornar, o advisory recalcula o TS Preview com os overrides propostos:

```
advisory-controller pipeline:
  1. Solver Fases A→B→C → proposta de folgas
  2. Aplicar overrides propostos no previewRows (simulacao local)
  3. Rodar TS Preview (preview-diagnostics) com o novo arranjo
  4. UNIFICAR diagnostics do solver + diagnostics do TS Preview da PROPOSTA
  5. Retornar resultado com diagnostics unificados
```

Isso garante que a fase ADVISORY_OPEN mostra **1 fonte que contem tudo sobre a PROPOSTA** — sem precisar do TS Preview "antes" como prop separada.

**Validacao nivel escala (H6, H2, H4...) NAO entra aqui.** Essas checks precisam de alocacoes reais (horarios, almoco, turnos) que so existem depois de "Gerar Escala". O advisory opera no nivel ciclo (dias T/F), nao no nivel escala.

### 2.5 Derivacao de avisos por fase

```typescript
// Puro, deterministico, sem efeitos colaterais
function derivarAvisos(phase: AvisosPhase, ctx: AvisosContext): Aviso[] {
  switch (phase) {
    case 'PREVIEW':
      // Unica fonte: TS Preview do estado ATUAL (reativo, sempre fresh)
      // Nivel ciclo: cobertura, domingos, capacidade, folgas
      return humanizar(ctx.previewDiagnostics)

    case 'ADVISORY_OPEN':
      // Unica fonte: advisory.diagnostics (ja inclui TS Preview da PROPOSTA)
      // Nivel ciclo: mesmas checks, mas sobre o arranjo PROPOSTO
      return humanizar(ctx.advisoryResult.diagnostics)

    case 'GENERATING':
      // Nenhum aviso — loading state
      return []

    case 'INFEASIBLE':
      // Unica fonte: erro estruturado do solver (humanizado, colapsado)
      return humanizarInfeasible(ctx.infeasibleError)
  }
}
```

### 2.6 Prova de corretude

**Propriedade 1 — Sem duplicacao:**
Cada fase usa exatamente 1 fonte. Impossivel ter a mesma mensagem de 2 fontes diferentes.

**Propriedade 2 — Sem stale:**
Avisos sao derivados (useMemo), nao armazenados (useState). Quando a fase muda, o derivado recomputa. Nao existe `setAvisosOperacao` que precisa ser limpo manualmente.

**Propriedade 3 — Consistencia temporal:**
Em ADVISORY_OPEN, o user ve diagnostics da PROPOSTA (solver + TS Preview recalculado). Nao ve TS diagnostics do estado anterior. Contradicao impossivel.

**Propriedade 4 — Reversibilidade:**
Cancelar → fase volta pra PREVIEW → avisos sao recalculados do TS Preview do estado atual → identico ao que era antes de sugerir. Sem residuo.

**Propriedade 5 — Convergencia:**
Aceitar → overrides aplicados → simulacao recalcula → previewDiagnostics atualiza → avisos refletem o novo arranjo. Caminho unico, sem race condition (tudo e derivado sincrono no mesmo render cycle).

**Propriedade 6 — Cobertura de niveis:**
Nivel ciclo (cobertura, domingos, capacidade) coberto em PREVIEW e ADVISORY_OPEN via TS Preview. Nivel escala (almoco, interjornada, jornada max) coberto apenas apos "Gerar Escala" — no historico de escalas, que ja funciona e nao e afetado por este refactor.

### 2.7 O que MORRE

| Componente atual | Destino |
|-----------------|---------|
| `useState(avisosOperacao)` | **DELETADO** — substituido por fase INFEASIBLE |
| `useState(advisoryResult)` | Move pro context como parte do phase state |
| `buildPreviewAvisos()` (4 fontes, dedup quebrado) | **DELETADO** — substituido por `derivarAvisos()` |
| `avisosOperacao` como Source 4 no merge | **DELETADO** — nao existe mais merge |
| `previewDiagnostics` como prop do SugestaoSheet | **REMOVIDO** — advisory ja inclui TS Preview da proposta |
| Triple-duplication de previewDiagnostics | **IMPOSSIVEL** — 1 fase = 1 fonte |
| Botao "Sugerir TS" | **ABSORVIDO** pelo "Sugerir" unificado |
| Botao "Sugerir Solver" | **ABSORVIDO** pelo "Sugerir" unificado |
| Botao "Validar" | **DELETADO** — sugerir com arranjo OK = CURRENT_VALID |
| `build-avisos.ts` | **DELETADO** — arquivo inteiro |
| `REGRAS_TEXTO` em formatadores.ts | **DELETADO** — substituido por humanizar-avisos.ts |

### 2.8 Onde vive no codigo

```
src/
├── main/motor/
│   └── advisory-controller.ts   ← MODIFICADO: step 3 roda TS Preview com overrides propostos
│
├── renderer/src/
│   ├── store/
│   │   └── avisosStore.ts (NOVO) ← phase FSM + derivarAvisos()
│   │
│   ├── lib/
│   │   ├── build-avisos.ts       ← DELETADO
│   │   └── humanizar-avisos.ts (NOVO) ← dicionario + patterns + humanizar()
│   │
│   ├── componentes/
│   │   ├── AvisosSection.tsx     ← recebe avisos derivados (sem mudanca na interface)
│   │   └── SugestaoSheet.tsx     ← recebe SO advisory.diagnostics (remove prop previewDiagnostics)
│   │
│   └── paginas/
│       └── SetorDetalhe.tsx      ← simplifica: 2 botoes, chama transition() em vez de setState
│           - remove useState(avisosOperacao)
│           - remove buildPreviewAvisos merge
│           - remove handleSugerirTS, handleValidar separados
│           - handleSugerir → transition('ADVISORY_OPEN') + pipeline TS→solver
│           - handleGerarEscala → transition('GENERATING')
│           - onAceitar → transition('PREVIEW')
│           - onDescartar → transition('PREVIEW')
```

---

## 3. Solucao C: Nivel de Confianca (Validation Confidence)

### 3.1 O problema que A+B nao resolvem

Com phase-based context (A) e humanizacao (B), os avisos sao corretos e legiveis. Mas o user nao sabe **o quao profunda** foi a validacao:

- TS Preview verde = pre-check rapido (nivel ciclo, dias T/F)
- Solver verde = validacao real (nivel escala, horarios + restricoes individuais)

Se o user ve verde no TS e assume que pode gerar, vai ter surpresa. Ele precisa de um **indicador visual de profundidade**.

### 3.2 Modelo de confianca

```typescript
type ValidationConfidence =
  | 'UNVALIDATED'           // ciclo configurado mas nunca validado
  | 'TS_ONLY'               // TS Preview diz OK, solver nunca rodou pra este arranjo
  | 'SOLVER_VALIDATED'      // solver validou este arranjo exato — maximo de confianca
  | 'SOLVER_HAD_WARNINGS'   // solver rodou mas encontrou problemas — user cancelou
  | 'DIRTY'                 // user mudou algo depois da ultima validacao do solver
```

### 3.3 Tag visual no header do ciclo

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

### 3.4 Transicoes de confianca (FSM)

```
                     ┌──────────────┐
     novo ciclo ────►│ UNVALIDATED  │
                     └──────┬───────┘
                            │
                   TS Preview roda e diz OK
                            │
                            ▼
                     ┌──────────────┐
              ┌─────│   TS_ONLY    │◄──────────────┐
              │     └──────┬───────┘               │
              │            │                       │
              │     sugerir() →                    │
              │     solver valida                  │
              │            │                       │
              │     ┌──────┴──────┐                │
              │     │             │                │
              │  sem avisos    com avisos          │
              │     │             │                │
              │     ▼             ▼                │
              │  ┌──────────┐ ┌─────────────────┐  │
              │  │ SOLVER   │ │ SOLVER_HAD      │  │
              │  │VALIDATED │ │ WARNINGS        │  │
              │  └────┬─────┘ └────────┬────────┘  │
              │       │                │           │
              │       └──────┬─────────┘           │
              │              │                     │
              │     user muda folga                │
              │              │                     │
              │              ▼                     │
              │       ┌──────────┐                 │
              └──────►│  DIRTY   │─── TS Preview ──┘
                      └──────────┘    recalcula OK
```

### 3.5 Integracao com a FSM de phases (Solucao A)

As duas FSMs sao **ortogonais** — phase controla O QUE mostrar, confidence controla A TAG:

```typescript
// No avisosStore.ts
interface AvisosState {
  // FSM A — lifecycle
  phase: 'PREVIEW' | 'ADVISORY_OPEN' | 'GENERATING' | 'INFEASIBLE'
  advisoryResult: EscalaAdvisoryOutput | null
  infeasibleError: InfeasibleError | null

  // FSM C — confianca
  confidence: ValidationConfidence

  // Derivados
  avisos: Aviso[]           // derivado de phase + dados
  confidenceTag: TagConfig  // derivado de confidence
}

// Transicoes de phase ATUALIZAM confidence automaticamente:
function transition(event: AvisosEvent): void {
  switch (event) {
    case 'aceitar':
      phase = 'PREVIEW'
      confidence = advisoryResult.diagnostics.some(d => d.severity === 'error')
        ? 'SOLVER_HAD_WARNINGS'
        : 'SOLVER_VALIDATED'
      break

    case 'cancelar':
      phase = 'PREVIEW'
      confidence = lastAdvisoryHadWarnings
        ? 'SOLVER_HAD_WARNINGS'
        : confidence  // mantem o que era
      break

    case 'user_muda_folga':
      // phase nao muda (continua PREVIEW)
      confidence = 'DIRTY'
      break

    case 'gerar_sucesso':
      phase = 'PREVIEW'
      confidence = 'SOLVER_VALIDATED'
      break
  }
}
```

### 3.6 Prova de corretude da dimensao C

**Propriedade 1 — Monotonia descendente:**
Confidence so SOBE (UNVALIDATED → TS_ONLY → SOLVER_VALIDATED) por acao do sistema, e so DESCE por acao do user (mudanca manual → DIRTY). O sistema nunca rebaixa a confianca sem motivo.

**Propriedade 2 — Dirty e conservador:**
Qualquer mudanca manual no ciclo → DIRTY. Nao importa se a mudanca e "pequena" ou "nao afeta nada". Conservadorismo evita falso positivo (verde quando nao deveria).

**Propriedade 3 — Informacao nao se perde no cancelar:**
Se o solver encontrou avisos e o user cancelou, a tag mostra "Validacao encontrou avisos" (laranja) em vez de voltar pra verde/neutro. O user sabe que TEM algo pendente mesmo sem ter aceitado a sugestao.

**Propriedade 4 — Convergencia ao verde:**
O unico caminho pro verde (SOLVER_VALIDATED) e: solver rodar e aprovar o arranjo exato atual, OU gerar escala com sucesso. Nao tem atalho.

### 3.7 UX do fluxo completo com as 3 dimensoes

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

## 4. Solucao B: Camada de Humanizacao (renumerada)

### 3.1 Principio

Toda mensagem que chega de qualquer fonte (solver, TS, preflight) passa por uma funcao `humanizar()` antes de entrar no contexto de avisos. A funcao:

1. Traduz termos tecnicos
2. Formata datas (ISO → "sabado, 15/mar")
3. Remove jargao interno ("Slot" → "faixa horaria", "INFEASIBLE" → "impossivel gerar")
4. Colapsa multiplas sugestoes em 1 card com lista
5. Remove duplicatas semanticas (mesmo problema, fontes diferentes)

### 3.2 Mapeamento de traducoes

| Original | Humanizado |
|----------|-----------|
| `Solver retornou INFEASIBLE: impossivel satisfazer todas as restricoes simultaneamente` | `Nao foi possivel gerar a escala com as regras atuais.` |
| `Capacidade insuficiente em 2026-03-15: disponiveis=2, minimo requerido=3.` | `Sabado, 15/mar: so 2 pessoas disponiveis, mas a demanda pede 3.` |
| `QUA (manha: 3, tarde: 2, disponiveis: 1)` | `Quarta: demanda de 3 de manha e 2 de tarde, mas so 1 pessoa disponivel.` |
| `Slot 12:00-13:00 em 2026-03-12 tem 4 pessoas mas demanda e 2` | `Quinta, 12/mar das 12:00 as 13:00: 4 pessoas alocadas, mas a demanda e de 2.` |
| `N participante(s) intermitente(s) ficaram fora do preview.` | `N colaborador(es) intermitente(s) nao entram na simulacao automatica.` |
| `Folga variavel de Ana em QUA: sobram 1, demanda e 2.` | `Quarta com folga da Ana: fica 1 pessoa, mas a demanda e 2.` |
| `H2B_DSR_INTERJORNADA` (fallback code) | `Descanso entre jornadas insuficiente (minimo 11h)` |
| `H3_DOM_MAX_CONSEC_F` (fallback code) | `Domingos consecutivos acima do limite (mulheres)` |

### 3.3 Estrutura

```typescript
// src/renderer/src/lib/humanizar-avisos.ts (NOVO)

// 1. Dicionario de codigos → texto RH
const CODIGO_PARA_TEXTO: Record<string, string> = {
  H1_MAX_DIAS_CONSECUTIVOS: 'Limite de dias seguidos de trabalho excedido',
  H2_DESCANSO_ENTRE_JORNADAS: 'Descanso entre jornadas menor que 11 horas',
  H2B_DSR_INTERJORNADA: 'Descanso entre jornadas insuficiente',
  H3_RODIZIO_DOMINGO: 'Rodizio de domingos nao respeitado',
  H3_DOM_MAX_CONSEC: 'Limite de domingos consecutivos excedido',
  H3_DOM_MAX_CONSEC_M: 'Domingos consecutivos acima do limite (homens)',
  H3_DOM_MAX_CONSEC_F: 'Domingos consecutivos acima do limite (mulheres)',
  H4_MAX_JORNADA_DIARIA: 'Jornada acima do maximo diario (10h)',
  H5_EXCECAO_NAO_RESPEITADA: 'Excecao (ferias/atestado) nao respeitada',
  H6_ALMOCO_OBRIGATORIO: 'Almoco obrigatorio nao definido (jornada >6h)',
  H7_INTERVALO_CURTO: 'Intervalo de 15min obrigatorio nao definido (jornada >4h)',
  H10_META_SEMANAL: 'Meta de horas semanais nao atingida',
  H15_ESTAGIARIO_JORNADA: 'Estagiario com jornada acima do limite (6h/dia, 30h/sem)',
  H16_ESTAGIARIO_HORA_EXTRA: 'Estagiario nao pode fazer hora extra',
  H17_FERIADO_PROIBIDO: 'Trabalho em feriado proibido (CCT)',
  H18_FERIADO_SEM_CCT: 'Trabalho em feriado sem autorizacao CCT',
  H19_FOLGA_COMPENSATORIA_DOM: 'Folga compensatoria de domingo nao concedida',
  H20_REGRA_HORARIO_INDIVIDUAL: 'Horario individual nao respeitado',
  DIAS_TRABALHO: 'Numero incorreto de dias de trabalho na semana',
  MIN_DIARIO: 'Jornada abaixo do minimo diario (4h)',
  S_DEFICIT: 'Cobertura abaixo da demanda',
  S_SURPLUS: 'Mais pessoas que o necessario',
  S_DOMINGO_CICLO: 'Rodizio de domingos desbalanceado',
  S_TURNO_PREF: 'Preferencia de turno nao atendida',
  S_CONSISTENCIA: 'Horarios inconsistentes entre dias',
  S_SPREAD: 'Carga de trabalho desbalanceada na equipe',
  S_AP1_EXCESS: 'Jornada acima de 8h (dentro do limite legal)',
  S_CYCLE_CONSISTENCY: 'Horarios divergentes entre ciclos',
  AP1: 'Clopening — fecha e abre no dia seguinte',
  AP2: 'Horarios variam muito de um dia pro outro',
  // ... demais antipatterns
}

// 2. Regex patterns para substituicao inline
const HUMANIZADORES: Array<[RegExp, (match: RegExpMatchArray) => string]> = [
  [/Solver retornou INFEASIBLE:?\s*/i, () => ''],
  [/disponiveis=(\d+)/g, (m) => `${m[1]} pessoas disponiveis`],
  [/minimo requerido=(\d+)/g, (m) => `demanda pede ${m[1]}`],
  [/Slot (\d{2}:\d{2})-(\d{2}:\d{2})/g, (m) => `Faixa ${m[1]} as ${m[2]}`],
  [/(\d{4})-(\d{2})-(\d{2})/g, (m) => formatarDataCurta(m[0])],
  [/\bpreview\b/gi, () => 'simulacao'],
]

// 3. Funcao principal
function humanizar(diagnostics: PreviewDiagnostic[]): Aviso[] { ... }
function humanizarInfeasible(error: InfeasibleError): Aviso[] { ... }
```

### 3.4 Prova de corretude

**Propriedade 1 — Idempotente:** Humanizar 2x produz o mesmo resultado (patterns ja humanizados nao matcham de novo).

**Propriedade 2 — Lossless:** Toda informacao original e preservada, so a forma muda. Numeros, nomes, horarios mantem-se.

**Propriedade 3 — Fallback seguro:** Se um codigo nao tem traducao, `humanizar()` retorna a `mensagem` original (que o validador sempre seta). So usa o dicionario quando `mensagem` esta ausente.

---

## 5. Plano de Execucao

### Fase 1: Context Phase + Botao Unico (resolve lifecycle e UX)

| # | Task | Arquivos | Estimativa |
|---|------|----------|-----------|
| 1.1 | Criar `avisosStore.ts` com FSM + derivarAvisos() | novo arquivo | pequeno |
| 1.2 | Mover `advisoryResult` pro store como parte do phase state | SetorDetalhe.tsx | medio |
| 1.3 | Deletar `useState(avisosOperacao)` | SetorDetalhe.tsx | pequeno |
| 1.4 | Deletar `build-avisos.ts` (arquivo inteiro) | build-avisos.ts | pequeno |
| 1.5 | Substituir calls por `transition()` nos 6 pontos | SetorDetalhe.tsx | medio |
| 1.6 | Unificar botoes: 1 "Sugerir" com escalation TS → solver | SetorDetalhe.tsx | medio |
| 1.7 | Remover botao "Validar" (sugerir com OK = CURRENT_VALID) | SetorDetalhe.tsx | pequeno |
| 1.8 | Remover `previewDiagnostics` prop do SugestaoSheet | SugestaoSheet.tsx | pequeno |
| 1.9 | AvisosSection consume `avisos` derivado do store | AvisosSection.tsx | pequeno |

### Fase 2: Advisory inclui TS Preview da proposta (resolve coerencia)

| # | Task | Arquivos | Estimativa |
|---|------|----------|-----------|
| 2.1 | Apos solver propor, recalcular TS Preview com overrides propostos | advisory-controller.ts | medio |
| 2.2 | Unificar diagnostics solver + TS Preview em 1 array | advisory-controller.ts | pequeno |
| 2.3 | Dedup por code (se solver e TS Preview dizem a mesma coisa) | advisory-controller.ts | pequeno |

### Fase 3: Humanizacao (resolve conteudo)

| # | Task | Arquivos | Estimativa |
|---|------|----------|-----------|
| 3.1 | Criar `humanizar-avisos.ts` com CODIGO_PARA_TEXTO (35 regras) | novo arquivo | medio |
| 3.2 | Implementar HUMANIZADORES regex + formatarDataCurta | humanizar-avisos.ts | pequeno |
| 3.3 | Integrar `humanizar()` na derivarAvisos() do store | avisosStore.ts | pequeno |
| 3.4 | Deletar `REGRAS_TEXTO` em formatadores.ts | formatadores.ts | pequeno |
| 3.5 | Humanizar `diagnostico_resumido` no tipc.ts (nunca mais string cru do Python) | tipc.ts | pequeno |
| 3.6 | Colapsar `sugestoes[]` do solver em 1 card com lista bullet | tipc.ts ou humanizar-avisos.ts | pequeno |

### Fase 4: Tag de Confianca (resolve profundidade)

| # | Task | Arquivos | Estimativa |
|---|------|----------|-----------|
| 4.1 | Adicionar `confidence: ValidationConfidence` no avisosStore | avisosStore.ts | pequeno |
| 4.2 | Transicoes de confidence integradas em transition() | avisosStore.ts | pequeno |
| 4.3 | Derivar `confidenceTag` (label, cor, icone) do confidence | avisosStore.ts | pequeno |
| 4.4 | Componente `ValidationTag` (badge ao lado de "Preview") | novo componente | pequeno |
| 4.5 | Detectar dirty: qualquer mudanca de override/folga → DIRTY | SetorDetalhe.tsx ou store | medio |
| 4.6 | Cancelar com warnings → SOLVER_HAD_WARNINGS (nao volta pra verde) | avisosStore.ts | pequeno |

### Fase 5: Verificacao

| # | Task |
|---|------|
| 5.1 | Testar: sugerir → aceitar → avisos refletem novo arranjo + tag "Validado" (verde) |
| 5.2 | Testar: sugerir → cancelar → avisos voltam + tag "Validacao encontrou avisos" (laranja) se tinha warnings |
| 5.3 | Testar: sugerir → cancelar (sem warnings) → tag mantem o que era |
| 5.4 | Testar: gerar → INFEASIBLE → 1 card sem jargao, sugestoes como lista |
| 5.5 | Testar: gerar → sucesso → avisos limpos, tag "Validado" (verde) |
| 5.6 | Testar: abrir escala gerada → avisos do TS Validator (H6, H2, etc.) no resumo |
| 5.7 | Testar: zero mensagens com "INFEASIBLE", "Slot", "disponiveis=", "preview", codigo raw |
| 5.8 | Testar: zero duplicacao (mesmo aviso aparece 1x, nao 2-3x) |
| 5.9 | Testar: so 2 botoes visiveis (Sugerir + Gerar Escala) |
| 5.10 | Testar: TS verde + tag amarela "Validacao recomendada" → user sabe que nao e garantia |
| 5.11 | Testar: mudar folga manualmente → tag volta pra "Validacao recomendada" (DIRTY) |
| 5.12 | Testar: so SOLVER_VALIDATED ou gerar com sucesso chegam ao verde |

---

## 6. Riscos e Mitigacoes

| Risco | Probabilidade | Mitigacao |
|-------|--------------|-----------|
| TS Preview recalcula entre transicoes, flash visual | Media | Derivacao sincrona no mesmo render cycle (useMemo, nao useEffect) |
| Algum codigo de regra sem traducao vaza | Baixa | Fallback: usa `violacao.mensagem` (sempre presente). Dicionario e bonus, nao requisito |
| Advisory recalcular TS Preview com overrides e lento | Baixa | TS Preview e JS puro, <50ms. Nao e solver. |
| Remover botao Validar quebra workflow de debug | Nenhuma | Dev pode rodar solver via CLI (`npm run solver:cli`). UI e pro RH. |
| TS Preview da proposta diverge do solver | Baixa | Ambos operam no nivel ciclo. Dedup por code resolve overlap. |
| Store novo cria acoplamento com SetorDetalhe | Baixa | Store e generico (phase + data), SetorDetalhe so chama transition() |
| Tag "Validacao recomendada" irrita user (parece que nunca ta pronto) | Media | Tag e informativa, nao bloqueante. User pode gerar sem validar — so nao ve verde. Tooltip explica. |
| Dirty detection falha (mudanca nao detectada) | Baixa | Override tracking via snapshotKey no store — qualquer mudanca no config muda o hash |

---

## 7. Criterios de Sucesso

### Dimensao A (Lifecycle)
- [ ] Zero duplicacao de avisos (mesmo problema aparece 1x, nao 2-3x)
- [ ] Cancelar sugestao = avisos identicos ao que era antes (+ tag laranja se solver tinha warnings)
- [ ] Aceitar sugestao = avisos refletem novo arranjo (TS Preview recalculado com overrides)
- [ ] INFEASIBLE = 1 card vermelho com sugestoes como lista, sem cards amarelos separados
- [ ] `buildPreviewAvisos()` / `build-avisos.ts` deletado
- [ ] `useState(avisosOperacao)` deletado

### Dimensao B (Humanizacao)
- [ ] Zero mensagens com "INFEASIBLE", "Slot", "preview", codigos H*/AP* crus na UI
- [ ] `REGRAS_TEXTO` em formatadores.ts deletado ou substituido
- [ ] Datas em formato humano (dia da semana + dd/mmm), nunca ISO

### Dimensao C (Confianca)
- [ ] Tag "Validacao recomendada" (amarelo) visivel quando TS verde mas solver nunca rodou
- [ ] Tag "Validado" (verde) so aparece apos solver aprovar ou gerar com sucesso
- [ ] Tag "Validacao encontrou avisos" (laranja) apos cancelar sugestao com warnings
- [ ] Qualquer mudanca manual de folga → tag volta pra amarelo (DIRTY)
- [ ] Unico caminho pro verde: solver validar ou gerar escala com sucesso
- [ ] Tag nunca bloqueante — user pode gerar sem validar, so nao ve verde

### Gerais
- [ ] So 2 botoes na UI: "Sugerir" e "Gerar Escala"
- [ ] Nivel ciclo (cobertura, folgas) e nivel escala (almoco, interjornada) nunca misturados
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
